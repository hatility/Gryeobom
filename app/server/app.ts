import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CHEERS, MOOD_COLORS } from '../src/content.ts'
import { GROUP_POST, postShared, sanitizePostOptions, sanitizeShared, type PostOptions } from '../src/share.ts'
import type { GroupPreset, GroupPrompts, LifeGraph } from '../src/types.ts'
import { httpUrl, isEmail } from './config.ts'
import { FLAGS, OFFICIAL, isFlag, type Flag } from '../src/flags.ts'
import { backupKeepOf, isOurDb, listBackups, maintain, openDb, storageOf, type Db } from './db.ts'

export interface User { id: string; nickname: string }

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  user: User | null
  params: Record<string, string>
  body: any
  ip: string
}

const COOKIE = 'gb_session'
const HOUR = 3600_000
const now = () => new Date().toISOString()
const newId = () => randomBytes(12).toString('base64url')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '')
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const int = (x: unknown) => Math.round(num(x))
const clean = (x: unknown) => str(x, 200).replace(/[\u0000-\u001f\u007f]/g, '').trim()
/** 여러 줄 글(모임 소개): 줄바꿈만 남기고 제어 문자는 뺀다 */
const cleanText = (x: unknown, max: number) => str(x, max).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim()

/** 모임 이름(1~30자) · 소개글(200자까지) */
function groupInfo(b: any) {
  const name = clean(b.name)
  if (name.length < 1 || name.length > 30) throw new HttpError(400, '모임 이름은 1~30자로 정해 주세요.')
  return { name, intro: cleanText(b.intro, 200) }
}

/** 이름 비교용: 띄어쓰기 · 대소문자 차이는 같은 이름으로 본다 */
const normName = (x: unknown) => clean(x).normalize('NFC').replace(/\s+/g, '').toLowerCase()

/** 생년월일 8자리(YYYYMMDD) 검증. 실제 있는 날짜이고 오늘 이전이어야 한다. */
function validBirth(x: unknown): string | null {
  const s = str(x, 8)
  if (!/^\d{8}$/.test(s)) return null
  const [y, m, d] = [+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)]
  const date = new Date(Date.UTC(y, m - 1, d))
  if (y < 1900 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || date > new Date()) return null
  return s
}

/** 생년월일(YYYYMMDD) → 오늘(한국 시간) 만 나이 */
export function ageOf(birth: string, today = new Date(Date.now() + 9 * 3600_000)) {
  const y = +birth.slice(0, 4), md = birth.slice(4)
  const t = today.toISOString().slice(0, 10).replace(/-/g, '')
  return +t.slice(0, 4) - y - (t.slice(4) < md ? 1 : 0)
}
export const GUARDIAN_RELATIONS = ['부모님', '보호자', '기관 담당 선생님']

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 6자리 모임 코드
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
// 공유 링크 코드: 대소문자 · 숫자 8자 (57^8 ≈ 1.1경, 맞혀 보기는 linkMiss 가 막는다)
const LINK_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newLinkCode = () => Array.from({ length: 8 }, () => LINK_CHARS[randomInt(LINK_CHARS.length)]).join('')
/** 신고 까닭: 놀림 · 괴롭힘 / 개인정보 / 위험해 보여요(도움이 필요해 보임) / 그 밖에 */
const REPORT_REASONS = ['hurt', 'privacy', 'danger', 'other']
/** 웹 복원 때 백업에서 옮길 표. 관리자 세션 · 관리자 접속 기록은 지금 것을 그대로 둔다. */
/** DB 초기화로 비우는 표: 회원과 회원이 만든 모든 것 (meta · 관리자 접속 기록 · IP 별칭은 남긴다) */
const RESET_TABLES = ['inquiries', 'visit_hours', 'graph_versions', 'csp_reports', 'privacy_requests', 'attendance', 'events', 'orgs', 'cheers', 'posts', 'takedowns', 'reports', 'members', 'circles', 'links', 'answers', 'graphs', 'sessions', 'users']
export const RESET_PHRASE = '모두 지우기'
const RESTORE_TABLES = ['meta', 'users', 'sessions', 'graphs', 'circles', 'members', 'posts', 'cheers', 'links', 'ip_aliases', 'answers', 'reports', 'takedowns', 'events', 'attendance', 'orgs', 'privacy_requests', 'graph_versions', 'inquiries', 'purge_log']
/** 핸들러가 응답을 직접 썼을 때 (파일 내려받기) */
const RAW = Symbol('raw')

/** 저장할 그래프 검증. 내 기록이라도 정해진 모양 말고는 받지 않는다. */
function sanitizeGraph(raw: any, id: string): LifeGraph {
  if (!raw || typeof raw !== 'object' || raw.id !== id) throw new HttpError(400, '기록을 읽지 못했어요.')
  // 시각(hour)은 끝이 시작보다 뒤이고 14일까지
  if (raw.timeScale === 'hour' && !(num(raw.currentPoint) > num(raw.startPoint) && num(raw.currentPoint) - num(raw.startPoint) <= 336)) throw new HttpError(400, '시간은 14일 안으로 정해 주세요.')
  const r = raw.currentReflection ?? {}
  const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, 100) : []
  return {
    id,
    title: str(raw.title, 40),
    timeScale: ['year', 'month', 'hour'].includes(raw.timeScale) ? raw.timeScale : 'age',
    ...(raw.monthRange === 'recent12' || raw.monthRange === 'thisYear' ? { monthRange: raw.monthRange } : {}),
    ...(['rose', 'sage', 'sand', 'lilac'].includes(raw.lineColor) ? { lineColor: raw.lineColor } : {}),
    ...(['career', 'relation', 'school'].includes(raw.questionSet) ? { questionSet: raw.questionSet } : {}),
    // 시각(hour)은 10분 단위 소수까지 둔다
    startPoint: raw.timeScale === 'hour' ? Math.round(num(raw.startPoint) * 1000) / 1000 : int(raw.startPoint),
    currentPoint: raw.timeScale === 'hour' ? Math.round(num(raw.currentPoint) * 1000) / 1000 : int(raw.currentPoint),
    visibility: raw.visibility === 'link' ? 'link' : 'private',
    ...(str(raw.groupId, 64) ? { groupId: str(raw.groupId, 64) } : {}),
    entries: entries.map((e: any) => ({
      id: str(e?.id, 64) || newId(),
      title: str(e?.title, 40),
      timePoint: Math.round(num(e?.timePoint) * 1000) / 1000, // 나이 · 연도는 한 달 단위 소수까지
      description: str(e?.description, 300),
      emotionScore: Math.min(5, Math.max(-5, int(e?.emotionScore))),
      emotionLabel: str(e?.emotionLabel, 12),
      reflection: {
        feeling: str(e?.reflection?.feeling, 1000),
        why: str(e?.reflection?.why, 1000),
        now: str(e?.reflection?.now, 1000),
        toPast: str(e?.reflection?.toPast, 1000),
        fromPast: str(e?.reflection?.fromPast, 1000),
        // 실험: 나만의 질문에 적은 답 (graph.myQuestions 와 같은 순서)
        ...(Array.isArray(e?.reflection?.extra) ? { extra: e.reflection.extra.slice(0, 3).map((x: unknown) => str(x, 1000)) } : {}),
      },
      showOnGraph: e?.showOnGraph !== false,
      ...(e?.turningPoint === true ? { turningPoint: true } : {}),
      ...(['basic', 'career', 'relation', 'school'].includes(e?.questionSet) ? { questionSet: e.questionSet } : {}),
    })),
    currentReflection: {
      changed: str(r.changed, 1000),
      word: str(r.word, 60),
      influence: str(r.influence, 1000),
      message: str(r.message, 1000),
      oneLine: str(r.oneLine, 60),
    },
    // 미래의 나에게 쓴 편지: 정한 날 이후에 열린다. 회고처럼 어디에도 나가지 않는다.
    ...(str(raw.futureLetter?.text, 500).trim() && !Number.isNaN(Date.parse(str(raw.futureLetter?.openAt, 40)))
      ? { futureLetter: { text: str(raw.futureLetter.text, 500).trim(), openAt: new Date(raw.futureLetter.openAt).toISOString(), writtenAt: str(raw.futureLetter.writtenAt, 40) || now() } }
      : {}),
    ...(str(raw.redrawOf, 64) ? { redrawOf: str(raw.redrawOf, 64) } : {}),
    // 실험: 인생 구간 띠 (8개까지) · 나만의 질문 (3개까지)
    ...(Array.isArray(raw.stages) && raw.stages.length
      ? { stages: raw.stages.slice(0, 8).map((x: any) => ({ label: str(x?.label, 16).trim(), from: Math.round(num(x?.from) * 1000) / 1000, to: Math.round(num(x?.to) * 1000) / 1000 })).filter((x: { label: string; from: number; to: number }) => x.label && x.to > x.from) }
      : {}),
    // 모임장이 정한 질문을 옮겨 둔 것 (큰 화면 진행 줄은 그래프에 두지 않는다)
    ...(() => {
      const { moments, reflect, now: nowQ } = sanitizePrompts(raw.prompts)
      return moments || reflect || nowQ ? { prompts: { ...(moments ? { moments } : {}), ...(reflect ? { reflect } : {}), ...(nowQ ? { now: nowQ } : {}) } } : {}
    })(),
    ...(Array.isArray(raw.myQuestions) && raw.myQuestions.length ? { myQuestions: raw.myQuestions.slice(0, 3).map((q: unknown) => str(q, 100).trim()).filter(Boolean) } : {}),
    completed: raw.completed === true,
    createdAt: str(raw.createdAt, 40) || now(),
    updatedAt: now(),
  }
}

/** 모임장이 정한 ‘나의 시간’ 검증. null 은 ‘정하지 않음’. */
function sanitizePreset(raw: any): GroupPreset | null {
  if (raw === null) return null
  const choice = (['age', 'year', 'month', 'hour', 'recent12', 'thisYear'] as const).find((k) => k === raw?.choice)
  const start = int(raw?.start), end = int(raw?.end), year = new Date().getFullYear()
  const ok =
    choice === 'age' ? start >= 0 && end <= 120 && start < end
    : choice === 'year' ? start >= 1900 && end <= year && start < end
    // 달로: 시작 달 ~ 끝 달 (10년까지)
    : choice === 'month' ? start >= 1900 * 12 && end <= year * 12 + 11 && start <= end && end - start < 120
    // 시간으로: 시작 시각 ~ 끝 시각 (14일까지)
    : choice === 'hour' ? start > 0 && end > start && end - start <= 14 * 24
    : choice === 'recent12' ? end >= 1900 * 12 && end <= year * 12 + 11
    : choice === 'thisYear'
  if (!choice || !ok) throw new HttpError(400, '나의 시간을 한 번 더 확인해 주세요.')
  return { choice, start, end, title: clean(raw.title).slice(0, 40) }
}
const readPreset = (s: string): GroupPreset | null => (s ? JSON.parse(s) : null)

/** 모임장이 정한 질문 검증. 칸마다 없으면 기본, '' 이면 묻지 않음. 아무것도 없으면 {} */
export function sanitizePrompts(raw: any): GroupPrompts {
  const out: GroupPrompts = {}
  const list = (x: unknown, n: number, max: number) => (Array.isArray(x) ? x.map((s) => clean(s).slice(0, max)).filter(Boolean).slice(0, n) : [])
  const keyed = (x: any, keys: string[]) => {
    const o: Record<string, string> = {}
    for (const k of keys) if (typeof x?.[k] === 'string') o[k] = clean(x[k]).slice(0, 100)
    return Object.keys(o).length ? o : undefined
  }
  const moments = list(raw?.moments, 8, 40), present = list(raw?.present, 8, 60)
  const reflect = keyed(raw?.reflect, ['feeling', 'why', 'now', 'toPast', 'fromPast'])
  const nowQ = keyed(raw?.now, ['changed', 'word', 'influence', 'message', 'oneLine'])
  if (moments.length) out.moments = moments
  if (reflect) out.reflect = reflect
  if (nowQ) out.now = nowQ
  if (present.length) out.present = present
  return out
}
const readPrompts = (s: string): GroupPrompts | null => (s ? JSON.parse(s) : null)

/** 실패 횟수 제한 (로그인 · 가입 · 모임 코드 맞히기 방지). ponytail: 메모리 기반이라 서버 1대 기준. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>()
  return {
    check(key: string) {
      const h = hits.get(key)
      if (h && h.until > Date.now() && h.n >= max) throw new HttpError(429, '잠시 쉬었다가 다시 해볼까요? (조금 뒤에 다시 시도할 수 있어요)')
    },
    hit(key: string) {
      // 오래된 기록은 가끔 비운다 (IP · 이름이 끝없이 쌓여 메모리를 먹지 않게)
      if (hits.size > 20_000) for (const [k, v] of hits) if (v.until < Date.now()) hits.delete(k)
      const h = hits.get(key)
      if (!h || h.until < Date.now()) hits.set(key, { n: 1, until: Date.now() + windowMs })
      else h.n++
    },
    reset: (key: string) => hits.delete(key),
    /** 지금 막혀 있는 키들 (관리자 ‘요청 제한 · 차단’) */
    blocked: () => [...hits].filter(([, v]) => v.until > Date.now() && v.n >= max).map(([key, v]) => ({ key, n: v.n, until: new Date(v.until).toISOString() })),
  }
}

/** 본문을 그대로 (DB 복원 파일). 너무 크면 멈춘다. */
async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const ch of req) {
    size += ch.length
    if (size > max) throw new HttpError(413, `파일이 너무 커요 (${Math.round(max / 1024 / 1024)}MB 까지).`)
    chunks.push(ch)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const ch of req) {
    size += ch.length
    if (size > 2_000_000) throw new HttpError(413, '내용이 너무 길어요.') // 순간 100개에 회고를 가득 적어도 들어가게 (한글 약 1.6MB)
    chunks.push(ch)
  }
  if (!size) return {}
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return v && typeof v === 'object' ? v : {}
  } catch {
    throw new HttpError(400, '요청을 읽지 못했어요.')
  }
}

export interface Developer { name: string; org: string; contact: string; url: string }
/** 이용약관 · 개인정보 처리방침에 들어갈 운영 정보 (.env 의 SERVICE_OPERATOR · PRIVACY_*) */
export interface Operator { name: string; contact: string }

/** 화면에 보이는 사이트 설정 (/config). .env 가 기본이고, 관리자 화면에서 고칠 수 있다. */
export interface Site { publicUrl: string | null; developer: Developer | null; operator: Operator | null }

/** 관리자가 고친 사이트 설정 검증. 화면에 그대로 보이므로 길이를 자르고, 주소는 http(s) · 문의처는 이메일만. */
function sanitizeSite(b: any): Site {
  const t = (x: unknown, max: number) => clean(x).slice(0, max)
  const bad = (msg: string): never => {
    throw new HttpError(400, msg)
  }
  const url = (x: unknown, what: string) => {
    const s = t(x, 200)
    return s ? (httpUrl(s) ?? bad(`${what}는 https:// 로 시작하는 주소로 적어 주세요.`)) : ''
  }
  const publicUrl = url(b?.publicUrl, '공유 주소').replace(/\/+$/, '') || null
  const dc = t(b?.developer?.contact, 200)
  const developer = {
    name: t(b?.developer?.name, 40),
    org: t(b?.developer?.org, 60),
    contact: !dc ? '' : isEmail(dc) ? dc : url(dc, '만든 사람 연락처'),
    url: url(b?.developer?.url, '저장소 주소'),
  }
  const oc = t(b?.operator?.contact, 80)
  if (oc && !isEmail(oc)) bad('문의처는 이메일 주소로 적어 주세요. 예) privacy@example.kr')
  const operator = { name: t(b?.operator?.name, 60), contact: oc }
  return {
    publicUrl,
    developer: Object.values(developer).some(Boolean) ? developer : null,
    operator: operator.name || operator.contact ? operator : null,
  }
}

export interface AppOptions {
  secureCookie: boolean
  /** 로그인 키(HMAC) 비밀값. 없으면 처음 실행할 때 만들어 DB에 둔다 */
  authSecret?: string
  /** 관리자 계정. 없으면 관리자 기능이 꺼진다 */
  admin?: { id: string; password: string } | null
  /** 사이트 아래 ‘만든 사람’ 탭에 보일 정보 (.env 의 DEV_*) */
  developer?: Developer | null
  operator?: Operator | null
  /** 공유 링크에 쓸 대표 주소 (예: https://geuryeobom.kr). 없으면 화면이 지금 주소를 쓴다 */
  publicUrl?: string | null
  /** 개발 테스트 서버인지 (개발용 배포 묶음의 DEV_SERVER=true). 정식 버전은 늘 false → DB 초기화가 없다 */
  devServer?: boolean
  /** 웹에서 복원하기 전에 지금 DB 를 남겨 둘 폴더 (보통 DB 파일 옆). 없으면 임시 폴더 */
  backupDir?: string
  /** 자동 백업 폴더 (.env 의 BACKUP_DIR, 없으면 backupDir/backups) */
  autoBackupDir?: string
  /** 자동 백업을 남길 개수 (.env 의 BACKUP_KEEP). 관리자 화면에서 바꾸면 그 값 */
  backupKeep?: number
}

export function createApp(db: Db, opts: AppOptions) {
  const one = <T>(sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined
  const all = <T>(sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[]
  const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p)

  // 수련관 · 교실은 여럿이 IP 하나를 같이 쓰므로 IP 기준은 넉넉하게, 사람(이름) 기준은 빡빡하게.
  const signupLimit = limiter(60, 15 * 60_000)
  const authLimit = limiter(30, 15 * 60_000)
  // 같은 이름으로 생일을 하나씩 맞혀 보는 것 막기 (IP 가 달라도): 15분에 10번, 하루에 30번.
  // 로그인 · 가입(이미 있음) · 초대 링크 가입 모두 이 한 곳을 거친다 — 한 길만 막으면 다른 길로 맞혀 볼 수 있다.
  const nameShort = limiter(10, 15 * 60_000)
  const nameDay = limiter(30, 24 * HOUR)
  const names = {
    check: (k: string) => (nameShort.check(k), nameDay.check(k)),
    hit: (k: string) => (nameShort.hit(k), nameDay.hit(k)),
  }
  const joinLimit = limiter(20, 15 * 60_000)
  const linkMake = limiter(30, 15 * 60_000) // 짧은 링크 만들기 (IP 기준)
  const linkMiss = limiter(60, 15 * 60_000) // 없는 링크 코드 맞혀 보기 막기

  const reportLimit = limiter(20, HOUR) // 신고 (사람 기준)
  const cspLimit = limiter(60, HOUR) // 보안 정책 위반 보고 (IP 기준)
  const contactLimit = limiter(5, HOUR) // 문의하기 (IP 기준)
  const adminLimit = limiter(5, 15 * 60_000)
  // 여러 IP 로 나눠 관리자 비밀번호를 맞혀 보는 것 막기: 모든 IP 를 합쳐 한 시간에 틀린 시도 50번까지
  const adminAll = limiter(50, HOUR)
  /** 관리자 ‘요청 제한 · 차단’ 에 보일 것: [이름, 무엇으로 세는지, 제한] */
  const LIMITS: [string, 'ip' | 'name' | 'user' | 'all', ReturnType<typeof limiter>][] = [
    ['가입', 'ip', signupLimit], ['로그인', 'ip', authLimit], ['같은 이름 (15분)', 'name', nameShort], ['같은 이름 (하루)', 'name', nameDay],
    ['모임 코드 맞히기', 'ip', joinLimit], ['공유 링크 만들기', 'ip', linkMake], ['없는 링크 · 확인 링크 맞히기', 'ip', linkMiss],
    ['신고', 'user', reportLimit], ['보안 정책 보고', 'ip', cspLimit], ['문의하기', 'ip', contactLimit], ['관리자 로그인', 'ip', adminLimit], ['관리자 로그인 (전체)', 'all', adminAll],
  ]
  // 실험: 서버 상태 — 최근 응답 시간 (500건) · 처리 수
  const started = Date.now()
  const timings: number[] = []
  let served = 0, failed = 0

  // 서버 비밀값: AUTH_SECRET 설정값, 없으면 처음 실행할 때 만들어 DB에 둔다
  const readSecret = () =>
    opts.authSecret ||
    one<{ value: string }>("SELECT value FROM meta WHERE key = 'auth_secret'")?.value ||
    (() => {
      const s = randomBytes(32).toString('hex')
      run("INSERT INTO meta (key, value) VALUES ('auth_secret', ?)", s)
      return s
    })()
  let secret = readSecret() // 웹에서 복원하면 DB 안의 비밀값이 바뀔 수 있어 다시 읽는다
  const hmac = (s: string) => createHmac('sha256', secret).update(s).digest('hex')

  /** 이름 + 생년월일 → 로그인 키. 잘못된 값이면 400. */
  function loginKey(body: any) {
    const name = normName(body.name)
    const birth = validBirth(body.birth)
    if (name.length < 1 || name.length > 20) throw new HttpError(400, '이름을 적어 주세요.')
    if (!birth) throw new HttpError(400, '생년월일은 8자리 숫자로 적어 주세요. 예) 20120315')
    return { key: hmac(`${name}|${birth}`), nameKey: hmac(name) }
  }

  const cookieOf = (req: IncomingMessage, name = COOKIE) =>
    (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)

  function setCookie(res: ServerResponse, value: string, maxAgeSec: number | null, name = COOKIE) {
    res.setHeader(
      'Set-Cookie',
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${opts.secureCookie ? '; Secure' : ''}${maxAgeSec === null ? '' : `; Max-Age=${maxAgeSec}`}`,
    )
  }

  /** 마지막으로 다녀간 시각. 요청마다 쓰지 않게 10분이 지났을 때만 */
  function seen(userId: string, last: string) {
    if (!last || Date.now() - Date.parse(last) > 10 * 60_000) {
      run('UPDATE users SET last_seen_at = ? WHERE id = ?', now(), userId)
      // 실험: 시간대별 접속 (요일 · 시간마다 횟수만)
      if (lab('ops')) {
        const k = new Date(Date.now() + 9 * HOUR)
        run('INSERT INTO visit_hours (dow, hour, n) VALUES (?, ?, 1) ON CONFLICT(dow, hour) DO UPDATE SET n = n + 1', k.getUTCDay(), k.getUTCHours())
      }
    }
  }

  function currentUser(req: IncomingMessage): User | null {
    const token = cookieOf(req)
    if (!token) return null
    const row = one<User & { expires_at: string; last_seen_at: string }>(
      'SELECT u.id, u.nickname, u.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      sha(token),
    )
    if (!row || row.expires_at < now()) return null
    seen(row.id, row.last_seen_at)
    return { id: row.id, nickname: row.nickname }
  }

  // 공용 PC를 생각해 기본은 브라우저를 닫으면 끝나는 세션(서버 쪽 12시간). '로그인 유지'일 때만 30일.
  function startSession(res: ServerResponse, userId: string, remember: boolean) {
    const token = randomBytes(32).toString('base64url')
    const ttl = remember ? 30 * 24 * HOUR : 12 * HOUR
    run('DELETE FROM sessions WHERE expires_at < ?', now())
    run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, new Date(Date.now() + ttl).toISOString())
    seen(userId, '')
    setCookie(res, token, remember ? ttl / 1000 : null)
  }

  const me = (c: Ctx) => {
    if (!c.user) throw new HttpError(401, '로그인이 필요해요.')
    return c.user
  }
  /** 실험: 끝난 모임에는 새로 들어오거나 나누거나 일정을 더할 수 없다 */
  const openCircle = (closedAt: string | undefined) => {
    if (closedAt) throw new HttpError(400, '끝난 모임이에요. 지금은 보기만 할 수 있어요.')
  }
  const autoDir = opts.autoBackupDir || (opts.backupDir ? join(opts.backupDir, 'backups') : null)
  const flagsOn = (): Partial<Record<Flag, boolean>> => {
    const v = one<{ value: string }>("SELECT value FROM meta WHERE key = 'flags'")?.value
    try { return v ? JSON.parse(v) : {} } catch { return {} }
  }
  const lab = (k: Flag) => !!opts.devServer || OFFICIAL.includes(k) || !!flagsOn()[k]
  /** 실험: 파기 기록 — 건수만 */
  const logPurge = (kind: string, count: number) => {
    if (count > 0 && lab('ops')) run('INSERT INTO purge_log (at, kind, count) VALUES (?, ?, ?)', now(), kind, count)
  }
  const isMember = (circleId: string, userId: string) => !!one('SELECT 1 FROM members WHERE circle_id = ? AND user_id = ?', circleId, userId)
  /** 모임과 그 안에서 나의 자리. manager = 모임장 또는 공동 모임장 (모임 꾸리기 · 글 내리기) */
  const memberOf = (circleId: string, userId: string) => {
    const circle = one<{ id: string; name: string; intro: string; code: string; owner_id: string; preset: string; role: string; topic: string; topic_at: string; news: string; news_at: string; closed_at: string; question_set: string; prompts: string }>(
      'SELECT c.*, m.role FROM circles c JOIN members m ON m.circle_id = c.id WHERE c.id = ? AND m.user_id = ?',
      circleId, userId,
    )
    if (!circle) throw new HttpError(404, '모임을 찾을 수 없어요.')
    const owner = circle.owner_id === userId
    const manager = owner || circle.role === 'co'
    // 실험: 도우미 — 일정 · 모임 소식 · 큰 화면 진행만 (사람 · 글 · 설정은 못 한다)
    const helper = circle.role === 'helper' && lab('group')
    return { ...circle, owner, manager, helper, crew: manager || helper }
  }
  const ownerOf = (circleId: string, userId: string, what: string) => {
    const circle = memberOf(circleId, userId)
    if (!circle.owner) throw new HttpError(403, `모임장만 ${what} 수 있어요.`)
    return circle
  }
  const ownGraph = (id: string, userId: string) => {
    const row = one<{ data: string }>('SELECT data FROM graphs WHERE id = ? AND user_id = ?', id, userId)
    if (!row) throw new HttpError(404, '기록을 찾을 수 없어요.')
    return JSON.parse(row.data) as LifeGraph
  }

  /** 모임에 나누기 · 다시 나누기. ‘무엇을 나눌지’도 같이 두어, 그래프를 고치면 다시 만든다. 기간이 잘못된 그래프면 null. */
  const upsertPost = (circleId: string, userId: string, g: LifeGraph, o: PostOptions): string | null => {
    const shared = sanitizeShared(postShared(g, o))
    if (!shared) return null
    const data = JSON.stringify(shared), options = JSON.stringify(o)
    run('DELETE FROM takedowns WHERE circle_id = ? AND graph_id = ?', circleId, g.id)
    const existing = one<{ id: string }>('SELECT id FROM posts WHERE circle_id = ? AND graph_id = ?', circleId, g.id)
    if (existing) {
      run('UPDATE posts SET data = ?, options = ? WHERE id = ?', data, options, existing.id)
      return existing.id
    }
    const id = newId()
    run('INSERT INTO posts (id, circle_id, user_id, graph_id, data, created_at, options) VALUES (?, ?, ?, ?, ?, ?, ?)', id, circleId, userId, g.id, data, now(), options)
    return id
  }

  /** 모임장 · 운영자가 남의 글을 내릴 때: 무엇을 나눴는지 기억해 두고, 그린 사람이 그래프를 고치면 바로 다시 나눈다 */
  const takeDown = (postId: string) => {
    const p = one<{ circle_id: string; graph_id: string; user_id: string; options: string }>('SELECT circle_id, graph_id, user_id, options FROM posts WHERE id = ?', postId)
    if (!p) return
    run(
      'INSERT INTO takedowns (circle_id, graph_id, user_id, options, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, graph_id) DO UPDATE SET options = excluded.options, at = excluded.at',
      p.circle_id, p.graph_id, p.user_id, p.options || JSON.stringify(GROUP_POST), now(),
    )
    run('DELETE FROM posts WHERE id = ?', postId)
  }

  type Handler = (c: Ctx) => unknown
  const routes: [string, RegExp, Handler][] = []
  const on = (method: string, path: string, h: Handler) =>
    routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[\\w-]{1,64})')}$`), h])

  /* ───── 계정 ───── */

  on('GET', '/me', (c) => ({ user: c.user }))

  // 내 그래프에 since 이후 도착한 응원. 누가 보냈는지는 내려주지 않는다.
  on('GET', '/me/cheers', (c) => {
    const u = me(c)
    const since = new URL(c.req.url ?? '/', 'http://x').searchParams.get('since') ?? ''
    if (Number.isNaN(Date.parse(since))) throw new HttpError(400, '날짜를 읽지 못했어요.')
    return all<{ kind: string; groupName: string; data: string; createdAt: string }>(
      `SELECT ch.kind, c.name AS groupName, p.data, ch.created_at AS createdAt
         FROM cheers ch JOIN posts p ON p.id = ch.post_id JOIN circles c ON c.id = p.circle_id
        WHERE p.user_id = ? AND ch.created_at > ? ORDER BY ch.created_at DESC LIMIT 20`,
      u.id, new Date(since).toISOString(),
    ).map(({ data, ...r }) => ({ ...r, title: (JSON.parse(data) as { title: string }).title }))
  })

  /**
   * 새 계정 만들기 (가입 · 초대 링크로 처음 온 사람). 별명과 약관 동의가 있어야 한다.
   * ‘이미 있음’(409)은 그 이름+생일이 맞다는 신호라, 만들기 시도는 이름 기준 횟수에 센다.
   */
  function createUser(c: Ctx, key: string, nameKey: string): User {
    names.check(nameKey)
    signupLimit.check(c.ip)
    if (c.body.agree !== true) throw new HttpError(400, '이용약관과 개인정보 처리방침에 동의해 주세요.')
    const nickname = clean(c.body.nickname)
    if (nickname.length < 1 || nickname.length > 12) throw new HttpError(400, '별명은 1~12자로 정해 주세요.')
    signupLimit.hit(c.ip) // 성공 · 중복 시도는 센다 (계정 대량 생성 · 가입 여부 떠보기 방지)
    names.hit(nameKey)
    if (one('SELECT 1 FROM users WHERE login_key = ?', key)) {
      throw new HttpError(409, '같은 이름과 생년월일로 만든 계정이 이미 있어요. 로그인해 주세요.')
    }
    // 실험 기능(개발 테스트 서버): 만 14세 미만은 보호자 동의를 함께 받는다
    let guardian = ''
    const birth = validBirth(c.body.birth)
    if (lab('guardian') && birth && ageOf(birth) < 14) {
      const g = c.body.guardian ?? {}
      const contact = clean(g.contact).slice(0, 80)
      const phone = contact.replace(/[^0-9]/g, '')
      if (g.agreed !== true || !GUARDIAN_RELATIONS.includes(g.relation)) throw new HttpError(400, '만 14세 미만은 보호자의 동의가 필요해요. 보호자와 함께 적어 주세요.')
      if (!(isEmail(contact) || /^01\d{8,9}$/.test(phone))) throw new HttpError(400, '보호자 연락처는 휴대폰 번호나 이메일로 적어 주세요.')
      // token: 보호자에게 보낼 확인 링크(/guardian/토큰). 보호자가 열어 동의하면 confirmedAt 이 생긴다
      guardian = JSON.stringify({ relation: g.relation, contact: isEmail(contact) ? contact : phone, at: now(), token: randomBytes(18).toString('base64url'), confirmedAt: '' })
    }
    const user = { id: newId(), nickname }
    run('INSERT INTO users (id, login_key, nickname, created_at, agreed_at, guardian) VALUES (?, ?, ?, ?, ?, ?)', user.id, key, nickname, now(), now(), guardian)
    startSession(c.res, user.id, c.body.remember === true)
    return user
  }

  on('POST', '/auth/signup', (c) => {
    const { key, nameKey } = loginKey(c.body)
    return { user: createUser(c, key, nameKey) }
  })

  on('POST', '/auth/login', (c) => {
    authLimit.check(c.ip)
    const { key, nameKey } = loginKey(c.body)
    names.check(nameKey)
    const row = one<User>('SELECT id, nickname FROM users WHERE login_key = ?', key)
    if (!row) {
      authLimit.hit(c.ip)
      names.hit(nameKey)
      throw new HttpError(401, '이름이나 생년월일이 맞지 않아요. 처음이라면 ‘처음이에요’에서 시작해 주세요.')
    }
    authLimit.reset(c.ip)
    startSession(c.res, row.id, c.body.remember === true)
    return { user: row }
  })

  on('POST', '/auth/logout', (c) => {
    const token = cookieOf(c.req)
    if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token))
    setCookie(c.res, '', 0)
  })

  // 계정과 모든 기록 지우기. 이름과 생년월일을 한 번 더 확인한다.
  on('POST', '/me/delete', (c) => {
    const u = me(c)
    if (!one('SELECT 1 FROM users WHERE id = ? AND login_key = ?', u.id, loginKey(c.body).key)) {
      throw new HttpError(401, '이름이나 생년월일이 맞지 않아요.')
    }
    run('DELETE FROM users WHERE id = ?', u.id)
    logPurge('탈퇴', 1)
    setCookie(c.res, '', 0)
  })

  /* ───── 내 그래프 ───── */

  on('GET', '/graphs', (c) =>
    all<{ data: string }>('SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC', me(c).id).map((r) => JSON.parse(r.data)),
  )

  on('GET', '/graphs/:id', (c) => ownGraph(c.params.id, me(c).id))

  on('PUT', '/graphs/:id', (c) => {
    const u = me(c)
    const g = sanitizeGraph(c.body.graph, c.params.id)
    const prev = one<{ user_id: string; data: string }>('SELECT user_id, data FROM graphs WHERE id = ?', g.id)
    if (prev && prev.user_id !== u.id) throw new HttpError(404, '기록을 찾을 수 없어요.')
    // 실험: 지난 모습 — 고치기 전 모습을 10분에 하나 남긴다 (되돌리기 직전에는 꼭). 그래프마다 최근 20개
    if (lab('graph') && prev) {
      const last = one<{ at: string }>('SELECT at FROM graph_versions WHERE graph_id = ? ORDER BY id DESC LIMIT 1', g.id)
      if (c.body.snapshot === true || !last || Date.now() - Date.parse(last.at) > 10 * 60_000) {
        run('INSERT INTO graph_versions (graph_id, data, at) VALUES (?, ?, ?)', g.id, prev.data, now())
        run('DELETE FROM graph_versions WHERE graph_id = ? AND id NOT IN (SELECT id FROM graph_versions WHERE graph_id = ? ORDER BY id DESC LIMIT 20)', g.id, g.id)
      }
    }
    // 모임에서 그린 그래프: 들어가 있는 모임일 때만 이어 두고, 늘 ‘함께 나누기’
    if (g.groupId && !isMember(g.groupId, u.id)) delete g.groupId
    if (g.groupId) g.visibility = 'link'
    run(
      'INSERT INTO graphs (id, user_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      g.id, u.id, JSON.stringify(g), g.updatedAt,
    )
    // '나만 보기'로 바꾸면 모임에 나눈 것 · 공유 링크도 모두 내린다
    if (g.visibility === 'private') {
      run('DELETE FROM posts WHERE graph_id = ?', g.id)
      run('DELETE FROM links WHERE graph_id = ?', g.id)
    }
    else {
      // 고친 내용은 모임에 나눈 글에도 바로 (예전 글은 ‘무엇을 나눌지’가 없어 그대로 둔다)
      for (const p of all<{ circle_id: string; options: string }>("SELECT circle_id, options FROM posts WHERE graph_id = ? AND options != ''", g.id)) {
        upsertPost(p.circle_id, u.id, g, JSON.parse(p.options))
      }
      // 모임장 · 운영자가 내린 글: 그린 사람이 고치면 바로 다시 나눈다 (아직 그 모임에 있을 때만)
      for (const t of all<{ circle_id: string; options: string }>('SELECT circle_id, options FROM takedowns WHERE graph_id = ? AND user_id = ?', g.id, u.id)) {
        if (isMember(t.circle_id, u.id)) upsertPost(t.circle_id, u.id, g, sanitizePostOptions(JSON.parse(t.options)) ?? GROUP_POST)
        else run('DELETE FROM takedowns WHERE circle_id = ? AND graph_id = ?', t.circle_id, g.id)
      }
      // 모임에서 그린 그래프는 처음 완성하는 순간 그 모임에 나눈다 (뒤에 모임장이 내리면 다시 올리지 않는다)
      const wasDone = prev ? (JSON.parse(prev.data) as LifeGraph).completed : false
      if (g.groupId && g.completed && !wasDone) upsertPost(g.groupId, u.id, g, GROUP_POST)
    }
    return g
  })

  on('DELETE', '/graphs/:id', (c) => {
    run('DELETE FROM graphs WHERE id = ? AND user_id = ?', c.params.id, me(c).id)
  })

  // 실험: 지난 모습 목록 · 하나 열기 (되돌리기는 그 모습을 그대로 저장한다 — PUT 에 snapshot)
  on('GET', '/graphs/:id/versions', (c) => {
    labs('graph')
    const u = me(c)
    ownGraph(c.params.id, u.id)
    return all<{ id: number; at: string; title: string; moments: number; done: number }>(
      "SELECT id, at, json_extract(data, '$.title') AS title, json_array_length(data, '$.entries') AS moments, json_extract(data, '$.completed') AS done FROM graph_versions WHERE graph_id = ? ORDER BY id DESC",
      c.params.id,
    ).map((v) => ({ ...v, done: v.done === 1 }))
  })
  on('GET', '/graphs/:id/versions/:vid', (c) => {
    labs('graph')
    const u = me(c)
    ownGraph(c.params.id, u.id)
    const v = one<{ data: string; at: string }>('SELECT data, at FROM graph_versions WHERE id = ? AND graph_id = ?', Number(c.params.vid), c.params.id)
    if (!v) throw new HttpError(404, '그 모습을 찾을 수 없어요.')
    return { at: v.at, graph: JSON.parse(v.data) }
  })

  on('GET', '/graphs/:id/posts', (c) => {
    const u = me(c)
    ownGraph(c.params.id, u.id)
    return all('SELECT id AS postId, circle_id AS groupId FROM posts WHERE graph_id = ?', c.params.id)
  })

  /* ───── 모임 ───── */

  on('GET', '/groups', (c) => {
    const u = me(c)
    return all<{ id: string; name: string; isOwner: number; role: string; memberCount: number; topic: string; topicAt: string; news: string; newsAt: string; closedAt: string }>(
      `SELECT c.id, c.name, c.owner_id = ? AS isOwner, m.role, c.topic, c.topic_at AS topicAt, c.news, c.news_at AS newsAt, c.closed_at AS closedAt,
              (SELECT COUNT(*) FROM members WHERE circle_id = c.id) AS memberCount
         FROM circles c JOIN members m ON m.circle_id = c.id
        WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
      u.id, u.id,
    ).map(({ isOwner, role, ...g }) => ({ ...g, role: isOwner === 1 ? 'owner' : role === 'co' ? 'co' : role === 'helper' ? 'helper' : 'member', nextEvent: lab('group') ? nextEventOf(g.id) : null }))
  })

  on('POST', '/groups', (c) => {
    const u = me(c)
    const { name, intro } = groupInfo(c.body)
    let code = newCode()
    while (one('SELECT 1 FROM circles WHERE code = ?', code)) code = newCode()
    const id = newId()
    run('INSERT INTO circles (id, name, intro, code, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, intro, code, u.id, now())
    run('INSERT INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)', id, u.id, now())
    return { id, code }
  })

  /** 기능 묶음이 꺼져 있으면 없는 주소로. 개발 테스트 서버는 모두 켜짐 · 정식은 OFFICIAL 묶음(1.1.0~)과 관리자가 켠 묶음 (지금은 보호자 동의만 스위치) */
  const labs = (k: Flag) => {
    if (!lab(k)) throw new HttpError(404, '찾을 수 없어요.')
  }

  // 실험: 기관용 — 모임 여러 개를 한 번에 (만든 사람이 모두의 모임장)
  on('POST', '/groups/bulk', (c) => {
    labs('group')
    const u = me(c)
    const names: string[] = Array.isArray(c.body.names) ? c.body.names.map((x: unknown) => clean(x)).filter(Boolean) : []
    if (!names.length) throw new HttpError(400, '모임 이름을 한 줄에 하나씩 적어 주세요.')
    if (names.length > 30) throw new HttpError(400, '한 번에 30개까지 만들 수 있어요.')
    const intro = groupInfo({ name: 'x', intro: c.body.intro }).intro
    const made: { id: string; name: string; code: string }[] = []
    db.exec('BEGIN')
    try {
      for (const n of names) {
        const { name } = groupInfo({ name: n })
        let code = newCode()
        while (one('SELECT 1 FROM circles WHERE code = ?', code)) code = newCode()
        const id = newId()
        run('INSERT INTO circles (id, name, intro, code, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, intro, code, u.id, now())
        run('INSERT INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)', id, u.id, now())
        made.push({ id, name, code })
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { groups: made }
  })

  // 실험: 내 기록 모두 내려받기 (개인정보 열람 · 옮기기)
  on('GET', '/me/export', (c) => {
    labs('me')
    const u = me(c)
    const p = one<{ nickname: string; created_at: string; agreed_at: string; guardian: string }>('SELECT nickname, created_at, agreed_at, guardian FROM users WHERE id = ?', u.id)!
    return {
      exportedAt: now(),
      service: '그려봄',
      profile: { nickname: p.nickname, createdAt: p.created_at, agreedAt: p.agreed_at, guardian: p.guardian ? JSON.parse(p.guardian) : null },
      graphs: all<{ data: string }>('SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC', u.id).map((r) => JSON.parse(r.data)),
      answers: all('SELECT day, question, text, color FROM answers WHERE user_id = ? ORDER BY day', u.id),
      groups: all(
        `SELECT c.name, m.joined_at AS joinedAt, CASE WHEN c.owner_id = m.user_id THEN '모임장' WHEN m.role = 'co' THEN '공동 모임장' WHEN m.role = 'helper' THEN '도우미' ELSE '함께하는 사람' END AS role
           FROM members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ? ORDER BY m.joined_at`, u.id),
      sharedInGroups: all<{ groupName: string; createdAt: string; data: string }>(
        'SELECT c.name AS groupName, p.created_at AS createdAt, p.data FROM posts p JOIN circles c ON c.id = p.circle_id WHERE p.user_id = ? ORDER BY p.created_at', u.id,
      ).map((r) => ({ groupName: r.groupName, createdAt: r.createdAt, graph: JSON.parse(r.data) })),
      links: all('SELECT code, created_at AS createdAt FROM links WHERE user_id = ? ORDER BY created_at', u.id),
      graphVersions: all<{ graphId: string; at: string; data: string }>('SELECT v.graph_id AS graphId, v.at, v.data FROM graph_versions v JOIN graphs g ON g.id = v.graph_id WHERE g.user_id = ? ORDER BY v.id', u.id).map((v) => ({ graphId: v.graphId, at: v.at, graph: JSON.parse(v.data) })),
      cheersReceived: one<{ n: number }>('SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ?', u.id)!.n,
    }
  })

  on('POST', '/groups/join', (c) => {
    const u = me(c)
    joinLimit.check(c.ip)
    const code = str(c.body.code, 20).trim().toUpperCase()
    const circle = one<{ id: string; closed_at: string }>('SELECT id, closed_at FROM circles WHERE code = ?', code)
    if (!circle) {
      joinLimit.hit(c.ip)
      throw new HttpError(404, '그 코드의 모임을 찾지 못했어요. 모임장에게 코드를 한 번 더 확인해 봐요.')
    }
    if (!isMember(circle.id, u.id)) openCircle(circle.closed_at)
    run('INSERT OR IGNORE INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)', circle.id, u.id, now())
    return { id: circle.id }
  })

  /** 함께하는 사람: 모임장 → 공동 모임장 → 들어온 순서 */
  const membersOf = (circleId: string) =>
    all<{ id: string; nickname: string; role: 'owner' | 'co' | 'helper' | 'member' }>(
      `SELECT u.id, u.nickname,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' WHEN m.role = 'helper' THEN 'helper' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ?
        ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 WHEN m.role = 'helper' THEN 2 ELSE 3 END, m.joined_at, m.rowid`,
      circleId,
    )
  /** 모임에 나눈 글. bound = 이 모임에서 그린 그래프라 저절로 나눠진 글 */
  const postsOf = (circleId: string) =>
    all<{ id: string; user_id: string; nickname: string; data: string; created_at: string; gid: string | null }>(
      `SELECT p.id, p.user_id, u.nickname, p.data, p.created_at, json_extract(gr.data, '$.groupId') AS gid
         FROM posts p JOIN users u ON u.id = p.user_id JOIN graphs gr ON gr.id = p.graph_id
        WHERE p.circle_id = ? ORDER BY p.created_at DESC`,
      circleId,
    ).map((p) => ({ id: p.id, userId: p.user_id, nickname: p.nickname, createdAt: p.created_at, graph: JSON.parse(p.data), bound: p.gid === circleId }))

  on('GET', '/groups/:id', (c) => {
    const u = me(c)
    const circle = memberOf(c.params.id, u.id)
    const isOwner = circle.owner
    const posts = postsOf(circle.id).map(({ userId, ...p }) => {
      const mine = userId === u.id
      const myCheers = all<{ kind: string }>('SELECT kind FROM cheers WHERE post_id = ? AND user_id = ?', p.id, u.id).map((r) => r.kind)
      // 응원 수는 그래프 주인에게만 보여준다 (인기 비교가 되지 않도록)
      const counts = mine
        ? Object.fromEntries(all<{ kind: string; n: number }>('SELECT kind, COUNT(*) AS n FROM cheers WHERE post_id = ? GROUP BY kind', p.id).map((r) => [r.kind, r.n]))
        : undefined
      return { ...p, mine, myCheers, counts }
    })
    // 사람을 가리키는 id 는 모임장에게만 (위임 · 공동 모임장 정하기에 쓴다)
    const members = membersOf(circle.id).map((m) => (isOwner ? m : { nickname: m.nickname, role: m.role }))
    // 이 모임에서 다 그린 내 선인데 지금 모임에 없는 것 (모임장이 내렸거나) → 다시 올릴 수 있게 알려준다
    const myUnposted = all<{ id: string; data: string }>(
      `SELECT g.id, g.data FROM graphs g
        WHERE g.user_id = ? AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.graph_id = g.id AND p.circle_id = ?)
          AND ((json_extract(g.data, '$.groupId') = ? AND json_extract(g.data, '$.completed') = 1)
               OR EXISTS (SELECT 1 FROM takedowns t WHERE t.graph_id = g.id AND t.circle_id = ?))`,
      u.id, circle.id, circle.id, circle.id,
    ).map((r) => ({ graphId: r.id, title: (JSON.parse(r.data) as LifeGraph).title }))
    return {
      myUnposted,
      id: circle.id, name: circle.name, intro: circle.intro, topic: circle.topic, topicAt: circle.topic_at, news: circle.news, newsAt: circle.news_at, isOwner, isManager: circle.manager, closedAt: circle.closed_at, questionSet: lab('group') ? circle.question_set : '', prompts: lab('group') ? readPrompts(circle.prompts) : null, isHelper: circle.helper,
      events: lab('group') ? eventsOf(circle.id, u.id) : [],
      orgs: circle.manager && lab('org') ? all<{ id: string; name: string }>('SELECT id, name FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(circle_ids) WHERE value = ?)', circle.id) : undefined,
      code: circle.manager ? circle.code : undefined, preset: readPreset(circle.preset), members, posts,
    }
  })

  // 공동 모임장 정하기 · 풀기 (모임장만)
  on('PUT', '/groups/:id/members/:uid', (c) => {
    const u = me(c)
    const circle = ownerOf(c.params.id, u.id, '공동 모임장을 정할')
    if (c.params.uid === circle.owner_id) throw new HttpError(400, '모임장은 이미 모임을 꾸리고 있어요.')
    const role = c.body.role === 'co' ? 'co' : c.body.role === 'helper' && lab('group') ? 'helper' : ''
    if (!run('UPDATE members SET role = ? WHERE circle_id = ? AND user_id = ?', role, circle.id, c.params.uid).changes) {
      throw new HttpError(404, '이 모임에 함께하는 사람이 아니에요.')
    }
    return { role: role || 'member' }
  })

  // 모임장 넘기기 (모임장만). 넘긴 사람은 공동 모임장으로 남는다.
  on('POST', '/groups/:id/transfer', (c) => {
    const u = me(c)
    const circle = ownerOf(c.params.id, u.id, '모임장을 넘길')
    const to = str(c.body.userId, 64)
    if (to === u.id || !isMember(circle.id, to)) throw new HttpError(400, '모임에 함께하는 다른 사람에게만 넘길 수 있어요.')
    run('UPDATE circles SET owner_id = ? WHERE id = ?', to, circle.id)
    run("UPDATE members SET role = '' WHERE circle_id = ? AND user_id = ?", circle.id, to)
    run("UPDATE members SET role = 'co' WHERE circle_id = ? AND user_id = ?", circle.id, u.id)
  })

  on('PUT', '/groups/:id', (c) => {
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 모임 이름과 소개를 고칠 수 있어요.')
    const info = groupInfo(c.body)
    run('UPDATE circles SET name = ?, intro = ? WHERE id = ?', info.name, info.intro, c.params.id)
    return info
  })

  // 모임 리포트 (모임장 · 공동 모임장): 누가 무엇을 그렸는지는 빼고 모임 전체의 흐름만.
  // 모임에 나눈 공개용 내용(마음 점수 · 감정 이름)만 쓰고, 회고는 쓰지 않는다. 나눈 사람이 3명이 안 되면 마음 분포는 숨긴다(누군지 짐작되지 않게).
  on('GET', '/groups/:id/report', (c) => {
    const u = me(c)
    const circle = memberOf(c.params.id, u.id)
    if (!circle.manager) throw new HttpError(403, '모임장 · 공동 모임장만 볼 수 있어요.')
    return reportOf(circle.id)
  })
  /** 모임 리포트: 누가 그렸는지 없이 모임 전체의 흐름 (모임장 · 기관 담당자) */
  function reportOf(circleId: string) {
    const circle = { id: circleId }
    const members = one<{ n: number }>('SELECT COUNT(*) AS n FROM members WHERE circle_id = ?', circle.id)!.n
    const posts = all<{ user_id: string; data: string; created_at: string }>('SELECT user_id, data, created_at FROM posts WHERE circle_id = ?', circle.id)
    const sharers = new Set(posts.map((p) => p.user_id)).size
    const bound = one<{ n: number; done: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(data, '$.completed') = 1), 0) AS done FROM graphs
        WHERE json_extract(data, '$.groupId') = ? AND user_id IN (SELECT user_id FROM members WHERE circle_id = ?)`,
      circle.id, circle.id,
    )!
    const cheers = one<{ n: number }>('SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.circle_id = ?', circle.id)!.n
    const week = new Date(Date.now() - 7 * 24 * HOUR).toISOString()
    const enough = sharers >= 3
    const scores = Array.from({ length: 11 }, () => 0)
    const labels = new Map<string, number>()
    let moments = 0
    for (const p of posts) {
      for (const e of (JSON.parse(p.data) as { entries: { emotionScore: number; emotionLabel: string }[] }).entries) {
        moments++
        scores[Math.min(10, Math.max(0, Math.round(e.emotionScore) + 5))]++
        if (e.emotionLabel) labels.set(e.emotionLabel, (labels.get(e.emotionLabel) ?? 0) + 1)
      }
    }
    return {
      members, sharers, posts: posts.length, newPosts: posts.filter((p) => p.created_at >= week).length,
      drawing: bound.n - bound.done, done: bound.done, cheers, moments, enough,
      scores: enough ? scores : null,
      labels: enough ? [...labels].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ label, n })) : null,
    }
  }

  // 실험: 모임 활동 일정 — 오늘(한국 시간)부터 다가오는 것만 보인다
  const todayKst = () => new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10)
  const daysAgoKst = (n: number) => new Date(Date.now() + 9 * HOUR - n * 24 * HOUR).toISOString().slice(0, 10)
  /** 다가오는 일정 + 지난 7일 (출석을 남길 수 있게). count = 참여 인원, mine = 내가 참여했는지 */
  const eventsOf = (circleId: string, userId = '') =>
    all<{ id: string; day: string; title: string; count: number; mine: number }>(
      `SELECT e.id, e.day, e.title, (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS count,
              EXISTS (SELECT 1 FROM attendance a WHERE a.event_id = e.id AND a.user_id = ?) AS mine
         FROM events e WHERE e.circle_id = ? AND e.day >= ? ORDER BY e.day, e.created_at LIMIT 20`,
      userId, circleId, daysAgoKst(7),
    ).map((e) => ({ ...e, mine: e.mine === 1 }))
  const nextEventOf = (circleId: string) => one<{ id: string; day: string; title: string }>('SELECT id, day, title FROM events WHERE circle_id = ? AND day >= ? ORDER BY day, created_at LIMIT 1', circleId, todayKst()) ?? null
  // 실험: 출석 — 활동 날부터 7일 안에 ‘참여했어요’ 를 누르고 풀 수 있다
  on('POST', '/groups/:id/events/:eid/attend', (c) => {
    labs('group')
    const u = me(c)
    memberOf(c.params.id, u.id)
    const ev = one<{ day: string }>('SELECT day FROM events WHERE id = ? AND circle_id = ?', c.params.eid, c.params.id)
    if (!ev) throw new HttpError(404, '일정을 찾을 수 없어요.')
    if (ev.day > todayKst()) throw new HttpError(400, '활동 날부터 참여를 남길 수 있어요.')
    if (ev.day < daysAgoKst(7)) throw new HttpError(400, '지난 지 7일이 넘은 활동이에요.')
    if (one('SELECT 1 FROM attendance WHERE event_id = ? AND user_id = ?', c.params.eid, u.id)) run('DELETE FROM attendance WHERE event_id = ? AND user_id = ?', c.params.eid, u.id)
    else run('INSERT INTO attendance (event_id, user_id, at) VALUES (?, ?, ?)', c.params.eid, u.id, now())
    return { mine: !!one('SELECT 1 FROM attendance WHERE event_id = ? AND user_id = ?', c.params.eid, u.id), count: one<{ n: number }>('SELECT COUNT(*) AS n FROM attendance WHERE event_id = ?', c.params.eid)!.n }
  })

  // 실험: 모임 복제 — 이름 · 소개 · 함께 그릴 주제 · 함께 그릴 시간을 그대로, 사람과 글은 빼고 새 모임으로
  on('POST', '/groups/:id/copy', (c) => {
    labs('group')
    const u = me(c)
    const src = memberOf(c.params.id, u.id)
    if (!src.manager) throw new HttpError(403, '모임장 · 공동 모임장만 복제할 수 있어요.')
    const { name } = groupInfo({ name: c.body.name })
    let code = newCode()
    while (one('SELECT 1 FROM circles WHERE code = ?', code)) code = newCode()
    const id = newId()
    run('INSERT INTO circles (id, name, intro, code, owner_id, created_at, preset, topic, topic_at, question_set, prompts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, name, src.intro, code, u.id, now(), src.preset, src.topic, src.topic ? now() : '', src.question_set, src.prompts)
    run('INSERT INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)', id, u.id, now())
    return { id, code }
  })
  on('POST', '/groups/:id/events', (c) => {
    labs('group')
    const u = me(c)
    const ec = memberOf(c.params.id, u.id)
    if (!ec.crew) throw new HttpError(403, '모임장 · 공동 모임장 · 도우미만 일정을 정할 수 있어요.')
    openCircle(ec.closed_at)
    const day = str(c.body.day, 10)
    const title = clean(c.body.title).slice(0, 40)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, '날짜를 골라 주세요.')
    if (day < todayKst()) throw new HttpError(400, '오늘이나 그 뒤의 날짜를 골라 주세요.')
    if (!title) throw new HttpError(400, '무엇을 하는지 적어 주세요.')
    if (one<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE circle_id = ? AND day >= ?', c.params.id, todayKst())!.n >= 20) throw new HttpError(400, '다가오는 일정은 20개까지 둘 수 있어요.')
    const id = newId()
    run('INSERT INTO events (id, circle_id, day, title, created_at) VALUES (?, ?, ?, ?, ?)', id, c.params.id, day, title, now())
    return { id, day, title }
  })
  on('DELETE', '/groups/:id/events/:eid', (c) => {
    labs('group')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).crew) throw new HttpError(403, '모임장 · 공동 모임장 · 도우미만 일정을 지울 수 있어요.')
    run('DELETE FROM events WHERE id = ? AND circle_id = ?', c.params.eid, c.params.id)
  })

  // 실험: 만 14세 미만 보호자 동의 확인 — 아이가 보호자에게 보낸 링크(/guardian/토큰)를 보호자가 열어 동의한다
  type GuardianRec = { relation: string; contact: string; at: string; token?: string; confirmedAt?: string }
  const guardianByToken = (token: string) => {
    const t = str(token, 64)
    if (t.length < 16) return null
    const row = one<{ id: string; nickname: string; guardian: string }>("SELECT id, nickname, guardian FROM users WHERE guardian <> '' AND json_extract(guardian, '$.token') = ?", t)
    return row ? { ...row, g: JSON.parse(row.guardian) as GuardianRec } : null
  }
  on('GET', '/me/guardian', (c) => {
    labs('guardian')
    const u = me(c)
    const raw = one<{ guardian: string }>('SELECT guardian FROM users WHERE id = ?', u.id)?.guardian
    if (!raw) return { needed: false }
    const g = JSON.parse(raw) as GuardianRec
    return { needed: true, relation: g.relation, confirmed: !!g.confirmedAt, token: g.confirmedAt ? null : g.token ?? null }
  })
  on('GET', '/guardian/:token', (c) => {
    labs('guardian')
    const r = guardianByToken(c.params.token)
    if (!r) throw new HttpError(404, '확인 링크를 찾을 수 없어요. 아이에게 링크를 다시 받아 주세요.')
    return { nickname: r.nickname, relation: r.g.relation, confirmed: !!r.g.confirmedAt, confirmedAt: r.g.confirmedAt ?? '' }
  })
  on('POST', '/guardian/:token', (c) => {
    labs('guardian')
    linkMiss.check(c.ip)
    const r = guardianByToken(c.params.token)
    if (!r) {
      linkMiss.hit(c.ip)
      throw new HttpError(404, '확인 링크를 찾을 수 없어요. 아이에게 링크를 다시 받아 주세요.')
    }
    if (c.body.agree !== true) throw new HttpError(400, '동의 칸을 확인해 주세요.')
    if (!r.g.confirmedAt) run('UPDATE users SET guardian = ? WHERE id = ?', JSON.stringify({ ...r.g, confirmedAt: now() }), r.id)
    return { confirmed: true }
  })

  // 실험: 기관 담당자 — 맡은 기관의 모임 리포트만 모아 본다 (개인 기록은 없다)
  type OrgRow = { id: string; name: string; circle_ids: string; manager_ids: string; created_at: string; invite: string; code: string }
  /** 기관 연결 코드 (모임장이 자기 모임을 기관에 이을 때). 없던 기관이면 이때 만든다 */
  const orgCode = (o: OrgRow) => {
    if (o.code) return o.code
    let code = newCode()
    while (one('SELECT 1 FROM orgs WHERE code = ?', code)) code = newCode()
    run('UPDATE orgs SET code = ? WHERE id = ?', code, o.id)
    return code
  }
  /** 내가 담당자인 기관 (아니면 404 — 일반 회원은 기관이 있는지도 모르게) */
  const myOrg = (id: string, userId: string) => {
    const o = one<OrgRow>('SELECT * FROM orgs WHERE id = ? AND EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?)', id, userId)
    if (!o) throw new HttpError(404, '맡은 기관을 찾을 수 없어요.')
    return o
  }
  const orgView = (o: OrgRow) => {
    const ids = JSON.parse(o.circle_ids) as string[]
    const mids = JSON.parse(o.manager_ids) as string[]
    return {
      id: o.id, name: o.name, createdAt: o.created_at, invite: o.invite,
      groups: ids.map((id) => one<{ id: string; name: string; code: string }>('SELECT id, name, code FROM circles WHERE id = ?', id)).filter((g): g is { id: string; name: string; code: string } => !!g),
      managers: mids.map((id) => one<{ id: string; nickname: string }>('SELECT id, nickname FROM users WHERE id = ?', id)).filter((m): m is { id: string; nickname: string } => !!m),
    }
  }
  on('GET', '/orgs', (c) => {
    labs('org')
    const u = me(c)
    const mine = all<OrgRow>('SELECT * FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?) ORDER BY name', u.id)
    // 기간(선택): from ~ to (한국 시간 날짜) 동안 생긴 것만 센 표를 함께
    const q = new URL(c.req.url ?? '', 'http://x').searchParams
    const ymd = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
    const from = ymd(q.get('from')), to = ymd(q.get('to'))
    if (from && to && (to < from || Date.parse(to) - Date.parse(from) > 366 * 24 * HOUR)) throw new HttpError(400, '기간은 하루에서 1년 사이로 골라 주세요.')
    const kst = (col: string) => `date(${col}, '+9 hours') BETWEEN ? AND ?`
    const periodOf = (id: string) => from && to ? {
      joined: one<{ n: number }>(`SELECT COUNT(*) AS n FROM members WHERE circle_id = ? AND ${kst('joined_at')}`, id, from, to)!.n,
      graphs: one<{ n: number }>(`SELECT COUNT(*) AS n FROM graphs WHERE json_extract(data, '$.groupId') = ? AND ${kst("json_extract(data, '$.createdAt')")}`, id, from, to)!.n,
      posts: one<{ n: number }>(`SELECT COUNT(*) AS n FROM posts WHERE circle_id = ? AND ${kst('created_at')}`, id, from, to)!.n,
      cheers: one<{ n: number }>(`SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.circle_id = ? AND ${kst('ch.created_at')}`, id, from, to)!.n,
      events: one<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE circle_id = ? AND day BETWEEN ? AND ?', id, from, to)!.n,
      attended: one<{ n: number }>('SELECT COUNT(*) AS n FROM attendance a JOIN events e ON e.id = a.event_id WHERE e.circle_id = ? AND e.day BETWEEN ? AND ?', id, from, to)!.n,
    } : null
    // lite: 이름 · 모임 id 만 (첫 화면 · 모임 목록에서 기관별로 묶을 때)
    if (q.get('lite') === '1') return mine.map((o) => ({ id: o.id, name: o.name, groupIds: JSON.parse(o.circle_ids) as string[] }))
    return mine.map((o) => {
      const v = orgView(o)
      const groups = v.groups.map((g) => ({ id: g.id, name: g.name, code: g.code, report: reportOf(g.id), period: periodOf(g.id) }))
      const sum = (k: 'members' | 'sharers' | 'posts' | 'moments' | 'cheers' | 'done' | 'drawing') => groups.reduce((t, g) => t + g.report[k], 0)
      return {
        id: v.id, name: v.name, code: orgCode(o), invite: o.invite, managers: v.managers.map((m) => ({ id: m.id, nickname: m.nickname, me: m.id === u.id })), groups,
        total: { groups: groups.length, members: sum('members'), sharers: sum('sharers'), posts: sum('posts'), moments: sum('moments'), cheers: sum('cheers'), done: sum('done'), drawing: sum('drawing') },
      }
    })
  })

  // 실험: 모임 끝내기 (보관) · 다시 열기 — 모임장 · 공동 모임장. 끝나면 보기만 된다 (기록은 그대로)
  on('PUT', '/groups/:id/closed', (c) => {
    labs('group')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 모임을 끝낼 수 있어요.')
    const at = c.body.closed === true ? now() : ''
    run('UPDATE circles SET closed_at = ? WHERE id = ?', at, c.params.id)
    return { closedAt: at }
  })

  // 실험: 기관 직접 등록 — 등록한 사람이 첫 담당자 (한 사람이 5곳까지)
  on('POST', '/orgs', (c) => {
    labs('org')
    const u = me(c)
    if (c.body.agree !== true) throw new HttpError(400, '기관 등록 안내에 동의해 주세요.')
    // 생일은 저장하지 않는다 — 만 14세 미만으로 가입해 보호자 기록이 있는 계정만 알 수 있다
    if (one<{ guardian: string }>('SELECT guardian FROM users WHERE id = ?', u.id)?.guardian) throw new HttpError(403, '기관 등록은 기관의 어른 담당자만 할 수 있어요. 모임은 누구나 만들 수 있어요.')
    const name = clean(c.body.name).slice(0, 40)
    if (!name) throw new HttpError(400, '기관 이름을 적어 주세요.')
    if (one<{ n: number }>('SELECT COUNT(*) AS n FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?)', u.id)!.n >= 5) throw new HttpError(400, '기관은 한 사람이 5곳까지 맡을 수 있어요.')
    let code = newCode()
    while (one('SELECT 1 FROM orgs WHERE code = ?', code)) code = newCode()
    const id = newId()
    run('INSERT INTO orgs (id, name, circle_ids, manager_ids, created_at, code) VALUES (?, ?, ?, ?, ?, ?)', id, name, '[]', JSON.stringify([u.id]), now(), code)
    return { id, code }
  })
  // 기관 이름 바꾸기 · 지우기 (담당자)
  on('PUT', '/orgs/:id', (c) => {
    labs('org')
    const o = myOrg(c.params.id, me(c).id)
    const name = clean(c.body.name).slice(0, 40)
    if (!name) throw new HttpError(400, '기관 이름을 적어 주세요.')
    run('UPDATE orgs SET name = ? WHERE id = ?', name, o.id)
    return { name }
  })
  on('DELETE', '/orgs/:id', (c) => {
    labs('org')
    const o = myOrg(c.params.id, me(c).id)
    run('DELETE FROM orgs WHERE id = ?', o.id) // 모임 · 계정은 그대로
  })
  // 연결 코드 새로 (예전 코드는 더 쓸 수 없다)
  on('POST', '/orgs/:id/code', (c) => {
    labs('org')
    const o = myOrg(c.params.id, me(c).id)
    let code = newCode()
    while (one('SELECT 1 FROM orgs WHERE code = ?', code)) code = newCode()
    run('UPDATE orgs SET code = ? WHERE id = ?', code, o.id)
    return { code }
  })
  // 담당자 초대 링크 (담당자가 직접 만들고 끈다 · 한 번 쓰면 꺼짐)
  on('POST', '/orgs/:id/invite', (c) => {
    labs('org')
    const o = myOrg(c.params.id, me(c).id)
    const token = randomBytes(18).toString('base64url')
    run('UPDATE orgs SET invite = ? WHERE id = ?', token, o.id)
    return { invite: token }
  })
  on('DELETE', '/orgs/:id/invite', (c) => {
    labs('org')
    const o = myOrg(c.params.id, me(c).id)
    run("UPDATE orgs SET invite = '' WHERE id = ?", o.id)
  })
  // 담당자 그만하기 (마지막 담당자는 기관을 지워야 한다)
  on('POST', '/orgs/:id/leave', (c) => {
    labs('org')
    const u = me(c)
    const o = myOrg(c.params.id, u.id)
    const mids = (JSON.parse(o.manager_ids) as string[]).filter((x) => x !== u.id)
    if (!mids.length) throw new HttpError(400, '마지막 담당자예요. 그만두려면 기관을 지워 주세요.')
    run('UPDATE orgs SET manager_ids = ? WHERE id = ?', JSON.stringify(mids), o.id)
  })
  // 내가 꾸리는(모임장 · 공동 모임장) 모임을 기관에 더하기 · 빼기 (빼기는 담당자라면 어느 모임이든)
  on('POST', '/orgs/:id/groups', (c) => {
    labs('org')
    const u = me(c)
    const o = myOrg(c.params.id, u.id)
    const gid = str(c.body.groupId, 64)
    if (!memberOf(gid, u.id).manager) throw new HttpError(403, '내가 모임장 · 공동 모임장인 모임만 더할 수 있어요. 다른 모임은 그 모임장에게 연결 코드를 알려 주세요.')
    const ids = [...new Set([...(JSON.parse(o.circle_ids) as string[]), gid])]
    run('UPDATE orgs SET circle_ids = ? WHERE id = ?', JSON.stringify(ids), o.id)
    return { groups: ids.length }
  })
  on('DELETE', '/orgs/:id/groups/:gid', (c) => {
    labs('org')
    const o = myOrg(c.params.id, me(c).id)
    run('UPDATE orgs SET circle_ids = ? WHERE id = ?', JSON.stringify((JSON.parse(o.circle_ids) as string[]).filter((x) => x !== c.params.gid)), o.id)
  })
  // 모임 쪽: 모임장 · 공동 모임장이 기관의 연결 코드로 모임을 기관에 잇거나 끊는다
  on('POST', '/groups/:id/org', (c) => {
    labs('org')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 기관에 이을 수 있어요.')
    joinLimit.check(c.ip)
    const o = one<OrgRow>("SELECT * FROM orgs WHERE code <> '' AND code = ?", str(c.body.code, 20).trim().toUpperCase())
    if (!o) {
      joinLimit.hit(c.ip)
      throw new HttpError(404, '그 연결 코드의 기관을 찾지 못했어요. 기관 담당자에게 한 번 더 확인해 주세요.')
    }
    run('UPDATE orgs SET circle_ids = ? WHERE id = ?', JSON.stringify([...new Set([...(JSON.parse(o.circle_ids) as string[]), c.params.id])]), o.id)
    return { id: o.id, name: o.name }
  })
  on('DELETE', '/groups/:id/org', (c) => {
    labs('org')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 기관 연결을 끊을 수 있어요.')
    for (const o of all<OrgRow>('SELECT * FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(circle_ids) WHERE value = ?)', c.params.id)) {
      run('UPDATE orgs SET circle_ids = ? WHERE id = ?', JSON.stringify((JSON.parse(o.circle_ids) as string[]).filter((x) => x !== c.params.id)), o.id)
    }
  })

  // 실험: 기관 담당자가 맡은 모임 모두에 같은 소식을 한 번에 (비우면 모두 내린다)
  on('PUT', '/orgs/:id/news', (c) => {
    labs('org')
    const u = me(c)
    const o = one<OrgRow>('SELECT * FROM orgs WHERE id = ? AND EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?)', c.params.id, u.id)
    if (!o) throw new HttpError(404, '맡은 기관을 찾을 수 없어요.')
    const news = cleanText(c.body.news, 300)
    const at = news ? now() : ''
    const ids = JSON.parse(o.circle_ids) as string[]
    for (const id of ids) run("UPDATE circles SET news = ?, news_at = ? WHERE id = ? AND closed_at = ''", news, at, id)
    return { news, newsAt: at, groups: ids.length }
  })

  // 실험: 기관 담당자 초대 링크 — 관리자가 만들고, 로그인한 사람이 열어 ‘맡을게요’ 를 누르면 담당자가 된다 (한 번 쓰면 꺼진다)
  const orgByInvite = (token: string) => (str(token, 64).length >= 16 ? one<OrgRow>("SELECT * FROM orgs WHERE invite <> '' AND invite = ?", str(token, 64)) : undefined)
  on('GET', '/org-invite/:token', (c) => {
    labs('org')
    linkMiss.check(c.ip)
    const o = orgByInvite(c.params.token)
    if (!o) {
      linkMiss.hit(c.ip)
      throw new HttpError(404, '초대 링크가 꺼졌거나 없는 링크예요. 운영자에게 새 링크를 받아 주세요.')
    }
    return { name: o.name, groups: (JSON.parse(o.circle_ids) as string[]).length, already: !!c.user && (JSON.parse(o.manager_ids) as string[]).includes(c.user.id) }
  })
  on('POST', '/org-invite/:token', (c) => {
    labs('org')
    const u = me(c)
    linkMiss.check(c.ip)
    const o = orgByInvite(c.params.token)
    if (!o) {
      linkMiss.hit(c.ip)
      throw new HttpError(404, '초대 링크가 꺼졌거나 없는 링크예요. 운영자에게 새 링크를 받아 주세요.')
    }
    const mids = [...new Set([...(JSON.parse(o.manager_ids) as string[]), u.id])]
    run("UPDATE orgs SET manager_ids = ?, invite = '' WHERE id = ?", JSON.stringify(mids), o.id)
    return { id: o.id, name: o.name }
  })

  // 실험: 모임 소식 (모임장 · 공동 모임장 → 모임 사람들). 비우면 내린다.
  on('PUT', '/groups/:id/news', (c) => {
    labs('group')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).crew) throw new HttpError(403, '모임장 · 공동 모임장 · 도우미만 소식을 올릴 수 있어요.')
    const news = cleanText(c.body.news, 300)
    const at = news ? now() : ''
    run('UPDATE circles SET news = ?, news_at = ? WHERE id = ?', news, at, c.params.id)
    return { news, newsAt: at }
  })

  // 함께 그릴 주제 (모임장 · 공동 모임장): 모임 화면과 모임 사람들의 첫 화면에 보인다. 비우면 내린다.
  on('PUT', '/groups/:id/topic', (c) => {
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 주제를 정할 수 있어요.')
    const topic = clean(c.body.topic).slice(0, 80)
    const at = topic ? now() : ''
    run('UPDATE circles SET topic = ?, topic_at = ? WHERE id = ?', topic, at, c.params.id)
    return { topic, topicAt: at }
  })

  // 실험: 모임 질문 묶음 — 이 모임에서 그리면 그때의 마음 질문이 이 묶음으로 시작한다
  on('PUT', '/groups/:id/question-set', (c) => {
    labs('group')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 질문 묶음을 정할 수 있어요.')
    const set = ['career', 'relation', 'school'].includes(c.body.set) ? (c.body.set as string) : ''
    run('UPDATE circles SET question_set = ? WHERE id = ?', set, c.params.id)
    return { questionSet: set }
  })

  // 실험: 모임장이 정한 질문 — 기억에 남는 순간 예시 · 그때의 마음 · 지금의 나 · 큰 화면 ‘오늘 할 일’
  on('PUT', '/groups/:id/prompts', (c) => {
    labs('group')
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 질문을 정할 수 있어요.')
    const prompts = sanitizePrompts(c.body.prompts)
    const empty = !Object.keys(prompts).length
    run('UPDATE circles SET prompts = ? WHERE id = ?', empty ? '' : JSON.stringify(prompts), c.params.id)
    return { prompts: empty ? null : prompts }
  })

  on('PUT', '/groups/:id/preset', (c) => {
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 나의 시간을 정할 수 있어요.')
    const preset = sanitizePreset(c.body.preset)
    if (preset?.choice === 'hour' && !lab('graph')) throw new HttpError(400, '나의 시간을 한 번 더 확인해 주세요.')
    run('UPDATE circles SET preset = ? WHERE id = ?', preset ? JSON.stringify(preset) : '', c.params.id)
    return { preset }
  })

  /* ───── 초대 링크 (/join/:code) ───── */

  const byCode = (c: Ctx) => {
    joinLimit.check(c.ip)
    const circle = one<{ id: string; name: string; intro: string; preset: string; closed_at: string }>('SELECT id, name, intro, preset, closed_at FROM circles WHERE code = ?', c.params.code.toUpperCase())
    if (!circle) {
      joinLimit.hit(c.ip)
      throw new HttpError(404, '초대 링크가 맞지 않거나, 모임이 없어졌어요.')
    }
    return circle
  }

  // 로그인 없이도 볼 수 있다: 모임 이름과 미리 정한 나의 시간만 (함께하는 사람 · 나눈 그래프는 들어온 뒤에)
  on('GET', '/invite/:code', (c) => {
    const circle = byCode(c)
    const joined = !!c.user && !!one('SELECT 1 FROM members WHERE circle_id = ? AND user_id = ?', circle.id, c.user.id)
    return { name: circle.name, intro: circle.intro, preset: readPreset(circle.preset), joined, id: joined ? circle.id : undefined, closed: !!circle.closed_at }
  })

  // 초대 링크로 들어가기. 로그인하지 않았다면 이름 + 생년월일로 바로 확인하고,
  // 처음 온 사람이면 { needSignup } 을 돌려준 뒤 별명 · 약관 동의를 더 받아 계정을 만든다.
  on('POST', '/invite/:code', (c) => {
    const circle = byCode(c)
    if (!(c.user && isMember(circle.id, c.user.id))) openCircle(circle.closed_at)
    let user = c.user
    if (!user) {
      authLimit.check(c.ip)
      const { key, nameKey } = loginKey(c.body)
      names.check(nameKey)
      user = one<User>('SELECT id, nickname FROM users WHERE login_key = ?', key) ?? null
      if (user) {
        authLimit.reset(c.ip)
        startSession(c.res, user.id, c.body.remember === true)
      } else if (c.body.nickname === undefined) {
        authLimit.hit(c.ip)
        names.hit(nameKey)
        return { needSignup: true }
      } else {
        // 없는 이름+생일이면 새 계정을 만든다 — 이것도 그 이름으로 한 번 시도한 것으로 센다 (createUser)
        authLimit.hit(c.ip)
        user = createUser(c, key, nameKey)
      }
    }
    run('INSERT OR IGNORE INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)', circle.id, user.id, now())
    return { id: circle.id, user }
  })

  on('DELETE', '/groups/:id', (c) => {
    const u = me(c)
    ownerOf(c.params.id, u.id, '모임을 없앨')
    run('DELETE FROM circles WHERE id = ?', c.params.id)
  })

  on('POST', '/groups/:id/leave', (c) => {
    const u = me(c)
    if (memberOf(c.params.id, u.id).owner) throw new HttpError(400, '모임장은 나갈 수 없어요. 다른 사람에게 모임장을 넘기거나, 모임을 없애 주세요.')
    run('DELETE FROM posts WHERE circle_id = ? AND user_id = ?', c.params.id, u.id)
    run('DELETE FROM takedowns WHERE circle_id = ? AND user_id = ?', c.params.id, u.id)
    run('DELETE FROM members WHERE circle_id = ? AND user_id = ?', c.params.id, u.id)
  })

  on('POST', '/groups/:id/posts', (c) => {
    const u = me(c)
    openCircle(memberOf(c.params.id, u.id).closed_at)
    const g = ownGraph(str(c.body.graphId, 64), u.id)
    if (g.visibility !== 'link') throw new HttpError(403, "먼저 이 그래프를 '함께 나누기'로 바꿔 주세요.")
    // 나눌 내용은 서버가 그래프에서 직접 만든다 (회고는 들어갈 자리가 없다)
    const o = sanitizePostOptions(c.body.options)
    if (!o) throw new HttpError(400, '나눌 내용을 읽지 못했어요.')
    const id = upsertPost(c.params.id, u.id, g, o)
    if (!id) throw new HttpError(400, '그래프의 기간을 먼저 확인해 주세요.')
    return { id }
  })

  // 내가 나눈 글은 언제든 내리고, 모임장은 모임을 지키기 위해 내릴 수 있다.
  // 이 모임에서 그린 그래프는 모임과 함께하는 선이라, 그래프를 지우거나 모임을 나가야 내려간다.
  on('DELETE', '/posts/:id', (c) => {
    const u = me(c)
    const post = one<{ user_id: string; circle_id: string; gid: string | null }>(
      "SELECT p.user_id, p.circle_id, json_extract(g.data, '$.groupId') AS gid FROM posts p JOIN graphs g ON g.id = p.graph_id WHERE p.id = ?",
      c.params.id,
    )
    if (!post) throw new HttpError(404, '찾을 수 없어요.')
    const circle = memberOf(post.circle_id, u.id)
    if (post.user_id !== u.id && !circle.manager) throw new HttpError(403, '내가 나눈 것만 내릴 수 있어요.')
    if (!circle.manager && post.gid === post.circle_id) {
      throw new HttpError(403, '이 모임에서 그린 선은 모임에 함께 나눠져요. 내리려면 그래프를 지우거나 모임에서 나가 주세요.')
    }
    if (post.user_id === u.id) run('DELETE FROM posts WHERE id = ?', c.params.id) // 내가 내린 글은 다시 올리지 않는다
    else takeDown(c.params.id)
  })

  on('POST', '/posts/:id/cheers', (c) => {
    const u = me(c)
    const kind = str(c.body.kind, 20)
    if (!(CHEERS as readonly string[]).includes(kind)) throw new HttpError(400, '보낼 수 없는 응원이에요.')
    const post = one<{ user_id: string; circle_id: string }>('SELECT user_id, circle_id FROM posts WHERE id = ?', c.params.id)
    if (!post) throw new HttpError(404, '찾을 수 없어요.')
    memberOf(post.circle_id, u.id)
    if (post.user_id === u.id) throw new HttpError(400, '내 그래프에는 응원을 보낼 수 없어요.')
    const had = one('SELECT 1 FROM cheers WHERE post_id = ? AND user_id = ? AND kind = ?', c.params.id, u.id, kind)
    if (had) run('DELETE FROM cheers WHERE post_id = ? AND user_id = ? AND kind = ?', c.params.id, u.id, kind)
    else run('INSERT INTO cheers (post_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)', c.params.id, u.id, kind, now())
    return { on: !had }
  })

  // 모임 글 신고: 운영자에게만 간다 (모임장 · 나눈 사람에게는 알리지 않는다). 한 글에 한 사람 한 번.
  on('POST', '/posts/:id/report', (c) => {
    const u = me(c)
    reportLimit.check(u.id)
    const reason = str(c.body.reason, 20)
    if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, '신고하는 까닭을 골라 주세요.')
    const post = one<{ user_id: string; circle_id: string; data: string; nickname: string; group_name: string }>(
      `SELECT p.user_id, p.circle_id, p.data, u.nickname, c.name AS group_name
         FROM posts p JOIN users u ON u.id = p.user_id JOIN circles c ON c.id = p.circle_id WHERE p.id = ?`,
      c.params.id,
    )
    if (!post) throw new HttpError(404, '찾을 수 없어요.')
    memberOf(post.circle_id, u.id)
    if (post.user_id === u.id) throw new HttpError(400, '내가 나눈 글은 신고할 수 없어요.')
    reportLimit.hit(u.id)
    run(
      `INSERT OR IGNORE INTO reports (id, post_id, circle_id, reporter_id, reason, detail, post_title, post_owner, group_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), c.params.id, post.circle_id, u.id, reason, cleanText(c.body.detail, 300),
      str((JSON.parse(post.data) as { title?: string }).title, 40), post.nickname, post.group_name, now(),
    )
  })

  /* ───── 오늘의 질문에 남긴 한 줄 ───── */

  on('GET', '/me/answers', (c) =>
    all('SELECT day, question, text, color, updated_at AS updatedAt FROM answers WHERE user_id = ? ORDER BY day DESC LIMIT 1200', me(c).id),
  )
  // 날짜(YYYY-MM-DD)마다 하나. 비우면 지운다. 시간대 차이로 하루 앞선 날까지만 받는다.
  on('PUT', '/me/answers/:day', (c) => {
    const u = me(c)
    const day = c.params.day
    const t = Date.parse(`${day}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t) || t > Date.now() + 2 * 24 * HOUR) throw new HttpError(400, '날짜를 읽지 못했어요.')
    const text = cleanText(c.body.text, 300)
    if (!text) {
      run('DELETE FROM answers WHERE user_id = ? AND day = ?', u.id, day)
      return { day, text: '' }
    }
    const question = clean(c.body.question).slice(0, 100)
    const color = MOOD_COLORS.some((m) => m.key === c.body.color) ? (c.body.color as string) : ''
    run(
      `INSERT INTO answers (user_id, day, question, text, updated_at, color) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET question = excluded.question, text = excluded.text, updated_at = excluded.updated_at, color = excluded.color`,
      u.id, day, question, text, now(), color,
    )
    return { day, question, text, color }
  })

  /* ───── 짧은 공유 링크 (/s/:code) ─────
   * 링크에 담을 공개용 내용(회고 없음)을 서버에 두고 짧은 코드만 나눈다. 만든 사람은 언제든 끌 수 있다.
   * 로그인하지 않아도 만들 수 있고(그때는 누가 만들었는지 남지 않는다), 그래프를 지우면 그 링크도 꺼진다. */

  const linksOf = (where: string, ...p: any[]) =>
    all<{ code: string; data: string; createdAt: string; nickname: string | null; graphId: string | null }>(
      `SELECT l.code, l.data, l.created_at AS createdAt, u.nickname, l.graph_id AS graphId
         FROM links l LEFT JOIN users u ON u.id = l.user_id WHERE ${where} ORDER BY l.created_at DESC LIMIT 500`,
      ...p,
    ).map(({ data, ...l }) => ({ ...l, graph: JSON.parse(data) }))

  on('POST', '/links', (c) => {
    linkMake.check(c.ip)
    const shared = sanitizeShared(c.body.shared)
    if (!shared) throw new HttpError(400, '나눌 내용을 읽지 못했어요.')
    linkMake.hit(c.ip)
    // 로그인했고 내 그래프면 이어 둔다 (그래프를 지우면 링크도 꺼지고, 내 링크 목록에 보인다)
    const graphId = c.user && one('SELECT 1 FROM graphs WHERE id = ? AND user_id = ?', str(c.body.graphId, 64), c.user.id) ? str(c.body.graphId, 64) : null
    let code = newLinkCode()
    while (one('SELECT 1 FROM links WHERE code = ?', code)) code = newLinkCode()
    run('INSERT INTO links (code, user_id, graph_id, data, created_at) VALUES (?, ?, ?, ?, ?)', code, c.user?.id ?? null, graphId, JSON.stringify(shared), now())
    return { code }
  })

  on('GET', '/links/:code', (c) => {
    linkMiss.check(c.ip)
    const row = one<{ data: string; created_at: string }>('SELECT data, created_at FROM links WHERE code = ?', c.params.code)
    if (!row) {
      linkMiss.hit(c.ip)
      throw new HttpError(404, '링크가 꺼졌거나 없는 링크예요.')
    }
    return { shared: JSON.parse(row.data), createdAt: row.created_at }
  })

  on('GET', '/graphs/:id/links', (c) => {
    const u = me(c)
    ownGraph(c.params.id, u.id)
    return all('SELECT code, created_at AS createdAt FROM links WHERE graph_id = ? AND user_id = ? ORDER BY created_at DESC', c.params.id, u.id)
  })

  on('DELETE', '/links/:code', (c) => {
    const u = me(c)
    if (!run('DELETE FROM links WHERE code = ? AND user_id = ?', c.params.code, u.id).changes) throw new HttpError(404, '내가 만든 링크만 끌 수 있어요.')
  })

  /* ───── 설정 · 관리자 ───── */

  // 화면에 보이는 사이트 설정: 관리자 화면에서 저장한 값이 있으면 그것, 없으면 .env
  const envSite: Site = { publicUrl: opts.publicUrl ?? null, developer: opts.developer ?? null, operator: opts.operator ?? null }
  const savedSite = () => {
    const row = one<{ value: string }>("SELECT value FROM meta WHERE key = 'site'")
    return row ? (JSON.parse(row.value) as Site) : null
  }
  const site = () => savedSite() ?? envSite

  // 실험: 점검 모드 — 켜 두면 관리자 말고는 저장 · 가입 같은 바꾸는 요청을 잠시 막는다 (보기는 된다)
  interface Maint { on: boolean; message: string; at: string }
  const maintenance = (): Maint | null => {
    if (!lab('ops')) return null
    const v = one<{ value: string }>("SELECT value FROM meta WHERE key = 'maintenance'")?.value
    try { return v ? JSON.parse(v) : null } catch { return null }
  }
  on('GET', '/config', () => {
    const m = maintenance()
    return { ...site(), dev: !!opts.devServer, flags: FLAGS.filter((f) => lab(f.key)).map((f) => f.key), ...(m?.on ? { maintenance: { message: m.message, at: m.at } } : {}) }
  })
  on('GET', '/admin/maintenance', (c) => {
    labs('ops')
    admin(c)
    return maintenance() ?? { on: false, message: '', at: '' }
  })
  on('PUT', '/admin/maintenance', (c) => {
    labs('ops')
    admin(c)
    const m: Maint = { on: c.body.on === true, message: cleanText(c.body.message, 200), at: now() }
    run("INSERT INTO meta (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(m))
    return m
  })

  // 실험: 헬스체크 (Docker 가 30초마다) — DB 를 실제로 읽고, 디스크가 50MB 아래면 아프다고 답한다
  on('GET', '/health', (c) => {
    labs('ops')
    one('SELECT 1 FROM meta LIMIT 1')
    let free = -1
    try {
      const f = statfsSync(opts.backupDir ?? tmpdir())
      free = f.bavail * f.bsize
    } catch { /* 디스크 정보를 못 읽는 환경 */ }
    if (free >= 0 && free < 50 * 1024 * 1024) {
      c.res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      c.res.end(JSON.stringify({ ok: false, reason: 'disk' }))
      return RAW
    }
    return { ok: true, uptimeSec: Math.round((Date.now() - started) / 1000) }
  })

  // 실험: 보안 정책(CSP) 위반 보고 — 브라우저가 보낸다 (개발 묶음의 nginx 만 report-uri 를 건다)
  const scrubUrl = (x: unknown) => {
    const s = str(x, 500)
    if (!s || !/^https?:/.test(s)) return s.slice(0, 60) // inline · eval · data 같은 말
    try {
      const u = new URL(s)
      const path = u.pathname.replace(/\/(guardian|join|s|org-invite|groups|graph|invite)\/[^/]+/g, '/$1/…')
      return (opts.publicUrl && u.origin === new URL(opts.publicUrl).origin ? '' : u.origin) + path
    } catch { return '' }
  }
  on('POST', '/csp-report', (c) => {
    labs('ops')
    cspLimit.check(c.ip)
    cspLimit.hit(c.ip)
    const items: any[] = Array.isArray(c.body) ? c.body.map((r: any) => r?.body ?? {}) : [c.body['csp-report'] ?? {}]
    for (const r of items.slice(0, 10)) {
      const directive = str(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'], 60).split(' ')[0]
      if (!directive) continue
      const blocked = scrubUrl(r['blocked-uri'] ?? r.blockedURL), page = scrubUrl(r['document-uri'] ?? r.documentURL)
      const line = r['line-number'] ?? r.lineNumber
      const source = scrubUrl(r['source-file'] ?? r.sourceFile) + (line ? `:${int(line)}` : '')
      const key = sha(`${directive}|${blocked}|${page}`)
      run(`INSERT INTO csp_reports (key, directive, blocked, page, source, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET count = count + 1, last_at = excluded.last_at, source = excluded.source`, key, directive, blocked, page, source, now(), now())
    }
    run('DELETE FROM csp_reports WHERE key IN (SELECT key FROM csp_reports ORDER BY last_at DESC LIMIT -1 OFFSET 300)')
  })

  // 공지 팝업: 관리자가 켜 두면 사이트를 처음 열 때 한 번 뜬다. at 이 바뀌면(내용을 고치면) 다시 뜬다.
  /** from · to: (실험) 이 사이에만 뜬다. 빈 칸이면 제한 없음 */
  interface Notice { on: boolean; title: string; body: string; at: string; from?: string; to?: string }
  const savedNotice = (): Notice | null => {
    const v = one<{ value: string }>("SELECT value FROM meta WHERE key = 'notice'")?.value
    try { return v ? JSON.parse(v) : null } catch { return null }
  }
  on('GET', '/notice', () => {
    const n = savedNotice()
    const t = now()
    const inWindow = !n || ((!n.from || n.from <= t) && (!n.to || t < n.to))
    return { notice: n?.on && (n.title || n.body) && inWindow ? { title: n.title, body: n.body, at: n.at } : null }
  })

  // 관리자는 사람 계정과 따로 간다 (아이디 · 비밀번호는 .env, 세션 8시간, 로그인 유지 없음).
  // 관리자는 운영에 필요할 때 모든 기록(회고 포함)을 볼 수 있고, 사이트 설정을 고칠 수 있다.
  const ADMIN_COOKIE = 'gb_admin'
  const same = (a: string, b: string) => timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)))
  /** 로그인한 관리자: owner = .env 의 관리자, full · viewer = 실험: 더 둔 관리자 (지운 계정의 세션은 끊긴다) */
  type AdminWho = { who: string; role: 'owner' | 'full' | 'viewer' }
  const adminOf = (req: IncomingMessage): AdminWho | null => {
    const token = cookieOf(req, ADMIN_COOKIE)
    if (!opts.admin || !token) return null
    const row = one<{ expires_at: string; who: string; role: string }>('SELECT expires_at, who, role FROM admin_sessions WHERE token_hash = ?', sha(token))
    if (!row || row.expires_at <= now()) return null
    if (row.role === 'owner') return { who: opts.admin.id, role: 'owner' }
    const acc = lab('ops') ? one<{ role: string }>('SELECT role FROM admin_accounts WHERE id = ?', row.who) : undefined
    return acc ? { who: row.who, role: acc.role === 'full' ? 'full' : 'viewer' } : null
  }
  const isAdmin = (req: IncomingMessage) => !!adminOf(req)
  const admin = (c: Ctx): AdminWho => {
    const a = adminOf(c.req)
    if (!a) throw new HttpError(401, '관리자 로그인이 필요해요.')
    // 열람 전용: 보기만 (바꾸기 · DB 내려받기는 안 된다)
    const path = new URL(c.req.url ?? '', 'http://x').pathname.replace(/^\/api/, '')
    if (a.role === 'viewer' && (c.req.method !== 'GET' || /^\/admin\/(backup|backups\/)/.test(path))) throw new HttpError(403, '열람 전용 관리자예요. 바꾸거나 DB 를 내려받는 일은 할 수 없어요.')
    return a
  }
  const owner = (c: Ctx) => {
    const a = admin(c)
    if (a.role !== 'owner') throw new HttpError(403, '처음 관리자(.env)만 할 수 있어요.')
    return a
  }
  // scrypt 로 비밀번호 저장 · 확인 (salt:hash)
  const hashPw = (pw: string) => {
    const salt = randomBytes(16)
    return `${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`
  }
  const checkPw = (pw: string, stored: string) => {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    return timingSafeEqual(scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'))
  }
  // 실험: 휴면 계정 — 마지막으로 다녀간 지(없으면 가입한 지) N개월이 지난 계정
  const dormantSince = (months: number) => new Date(Date.now() - months * 30.44 * 24 * HOUR).toISOString()
  const dormantMonths = (x: unknown) => Math.max(3, Math.min(60, Math.floor(Number(x)) || 12))
  on('GET', '/admin/dormant', (c) => {
    labs('ops')
    admin(c)
    const months = dormantMonths(new URL(c.req.url ?? '', 'http://x').searchParams.get('months'))
    return {
      months,
      users: all<{ id: string; nickname: string; createdAt: string; lastSeenAt: string; graphCount: number }>(
        `SELECT u.id, u.nickname, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
                (SELECT COUNT(*) FROM graphs g WHERE g.user_id = u.id) AS graphCount
           FROM users u WHERE COALESCE(NULLIF(u.last_seen_at, ''), u.created_at) < ? ORDER BY COALESCE(NULLIF(u.last_seen_at, ''), u.created_at) LIMIT 500`,
        dormantSince(months),
      ),
    }
  })
  /** 고른 휴면 계정을 지운다. 지우는 순간에도 휴면인지 다시 확인한다 (그 사이 다녀간 사람은 남긴다) */
  on('POST', '/admin/dormant/purge', (c) => {
    labs('ops')
    admin(c)
    const months = dormantMonths(c.body.months)
    const ids: string[] = Array.isArray(c.body.ids) ? c.body.ids.map((x: unknown) => str(x, 64)).slice(0, 500) : []
    let deleted = 0
    for (const id of ids) {
      if (one("SELECT 1 FROM users WHERE id = ? AND COALESCE(NULLIF(last_seen_at, ''), created_at) < ?", id, dormantSince(months))) {
        run('DELETE FROM users WHERE id = ?', id)
        deleted++
      }
    }
    logPurge('휴면 정리', deleted)
    return { deleted }
  })
  on('GET', '/admin/errors', (c) => {
    labs('ops')
    admin(c)
    return all('SELECT at, method, path, message, stack FROM error_log ORDER BY id DESC LIMIT 200')
  })

  on('GET', '/admin/orgs', (c) => {
    labs('org')
    admin(c)
    return all<OrgRow>('SELECT * FROM orgs ORDER BY created_at DESC').map(orgView)
  })
  /** 기관 만들기(id = new) · 고치기: 이름, 모임 참여 코드들, 담당자 계정 id 들 */
  on('PUT', '/admin/orgs/:id', (c) => {
    labs('org')
    admin(c)
    const name = clean(c.body.name).slice(0, 40)
    if (!name) throw new HttpError(400, '기관 이름을 적어 주세요.')
    const codes: string[] = Array.isArray(c.body.codes) ? c.body.codes.map((x: unknown) => str(x, 20).trim().toUpperCase()).filter(Boolean) : []
    const circleIds = [...new Set(codes.map((code) => {
      const r = one<{ id: string }>('SELECT id FROM circles WHERE code = ?', code)
      if (!r) throw new HttpError(400, `‘${code}’ 코드의 모임을 찾지 못했어요.`)
      return r.id
    }))]
    const managerIds = [...new Set((Array.isArray(c.body.managerIds) ? c.body.managerIds : []).map((x: unknown) => str(x, 64)).filter(Boolean))] as string[]
    for (const mid of managerIds) if (!one('SELECT 1 FROM users WHERE id = ?', mid)) throw new HttpError(400, '없는 계정이 담당자에 들어 있어요.')
    const id = c.params.id === 'new' ? newId() : c.params.id
    if (c.params.id === 'new') run('INSERT INTO orgs (id, name, circle_ids, manager_ids, created_at) VALUES (?, ?, ?, ?, ?)', id, name, JSON.stringify(circleIds), JSON.stringify(managerIds), now())
    else if (!one('SELECT 1 FROM orgs WHERE id = ?', id)) throw new HttpError(404, '기관을 찾을 수 없어요.')
    else run('UPDATE orgs SET name = ?, circle_ids = ?, manager_ids = ? WHERE id = ?', name, JSON.stringify(circleIds), JSON.stringify(managerIds), id)
    return orgView(one<OrgRow>('SELECT * FROM orgs WHERE id = ?', id)!)
  })
  on('DELETE', '/admin/orgs/:id', (c) => {
    labs('org')
    admin(c)
    run('DELETE FROM orgs WHERE id = ?', c.params.id)
  })

  // 실험: 한 해 돌아보기 — 그 해에 내가 받은 응원 수
  on('GET', '/me/cheers/:year', (c) => {
    labs('me')
    const u = me(c)
    const y = /^\d{4}$/.test(c.params.year) ? c.params.year : String(new Date().getFullYear())
    return { year: +y, received: one<{ n: number }>("SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ? AND substr(date(ch.created_at, '+9 hours'), 1, 4) = ?", u.id, y)!.n }
  })

  on('GET', '/admin/me', (c) => {
    const a = adminOf(c.req)
    // 처리하지 않은 신고 · 새 문의 수 (관리자에게만 · 화면의 알림)
    const alerts = a ? {
      reports: one<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE resolved_at = '' AND deleted_at = ''")!.n,
      inquiries: lab('ops') ? one<{ n: number }>("SELECT COUNT(*) AS n FROM inquiries WHERE status = '새 문의'")!.n : 0,
    } : undefined
    return { enabled: !!opts.admin, admin: !!a, who: a?.who ?? '', role: a?.role ?? '', alerts }
  })

  // 실험: 관리자 계정 여러 개 — 처음 관리자(.env)만 만들고 지운다. full = 바꾸기까지, viewer = 보기만
  on('GET', '/admin/accounts', (c) => {
    labs('ops')
    owner(c)
    return all<{ id: string; role: string; createdAt: string; lastLogin: string | null }>(
      'SELECT a.id, a.role, a.created_at AS createdAt, (SELECT MAX(at) FROM admin_logins l WHERE l.who = a.id AND l.ok = 1) AS lastLogin FROM admin_accounts a ORDER BY a.created_at',
    )
  })
  on('PUT', '/admin/accounts/:id', (c) => {
    labs('ops')
    owner(c)
    const id = c.params.id.toLowerCase()
    if (!/^[a-z0-9_-]{3,20}$/.test(id)) throw new HttpError(400, '아이디는 영어 소문자 · 숫자 · - · _ 로 3~20자예요.')
    if (id === opts.admin!.id.toLowerCase()) throw new HttpError(400, '처음 관리자와 같은 아이디는 쓸 수 없어요.')
    const role = c.body.role === 'full' ? 'full' : 'viewer'
    const pw = str(c.body.password, 200)
    const has = one('SELECT 1 FROM admin_accounts WHERE id = ?', id)
    if (pw && pw.length < 12) throw new HttpError(400, '비밀번호는 12자 이상이어야 해요.')
    if (!has && !pw) throw new HttpError(400, '새 계정은 비밀번호(12자 이상)를 정해 주세요.')
    if (has && pw) run('UPDATE admin_accounts SET role = ?, pw_hash = ? WHERE id = ?', role, hashPw(pw), id)
    else if (has) run('UPDATE admin_accounts SET role = ? WHERE id = ?', role, id)
    else run('INSERT INTO admin_accounts (id, pw_hash, role, created_at) VALUES (?, ?, ?, ?)', id, hashPw(pw), role, now())
    // 권한 · 비밀번호를 바꾸면 그 계정의 로그인은 끊는다
    if (has) run("DELETE FROM admin_sessions WHERE who = ? AND role <> 'owner'", id)
    return { id, role }
  })
  on('DELETE', '/admin/accounts/:id', (c) => {
    labs('ops')
    owner(c)
    run('DELETE FROM admin_accounts WHERE id = ?', c.params.id)
    run("DELETE FROM admin_sessions WHERE who = ? AND role <> 'owner'", c.params.id)
  })

  // 실험: 가입부터 나누기까지 — 기간에 가입한 사람이 어디까지 갔는지 (사람 수만)
  on('GET', '/admin/funnel', (c) => {
    labs('ops')
    admin(c)
    const q = new URL(c.req.url ?? '', 'http://x').searchParams
    const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
    const to = day(q.get('to')) ?? new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10)
    const from = day(q.get('from')) ?? new Date(Date.parse(to) - 89 * 24 * HOUR).toISOString().slice(0, 10)
    if (to < from) throw new HttpError(400, '기간을 다시 골라 주세요.')
    const r = one<Record<string, number>>(
      `SELECT COUNT(*) AS signup,
              COALESCE(SUM(EXISTS (SELECT 1 FROM graphs g WHERE g.user_id = u.id)), 0) AS started,
              COALESCE(SUM(EXISTS (SELECT 1 FROM graphs g WHERE g.user_id = u.id AND json_array_length(g.data, '$.entries') > 0)), 0) AS moment,
              COALESCE(SUM(EXISTS (SELECT 1 FROM graphs g WHERE g.user_id = u.id AND json_extract(g.data, '$.completed') = 1)), 0) AS done,
              COALESCE(SUM(EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id) OR EXISTS (SELECT 1 FROM links l WHERE l.user_id = u.id)), 0) AS shared,
              COALESCE(SUM(EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id)), 0) AS grouped
         FROM users u WHERE date(u.created_at, '+9 hours') BETWEEN ? AND ?`,
      from, to,
    )!
    return { from, to, ...r }
  })

  // 실험: 보안 정책 위반 보고 보기 · 비우기
  on('GET', '/admin/csp', (c) => {
    labs('ops')
    admin(c)
    return all('SELECT directive, blocked, page, source, count, first_at AS firstAt, last_at AS lastAt FROM csp_reports ORDER BY last_at DESC LIMIT 300')
  })
  on('DELETE', '/admin/csp', (c) => {
    labs('ops')
    admin(c)
    run('DELETE FROM csp_reports')
  })

  // 실험: 약관 재동의 — 관리자가 ‘바뀐 점’ 을 올리면, 그 전에 동의한 사람은 다음에 들어올 때 다시 동의한다
  interface Terms { summary: string; at: string }
  const savedTerms = (): Terms | null => {
    const v = one<{ value: string }>("SELECT value FROM meta WHERE key = 'terms'")?.value
    try { return v ? JSON.parse(v) : null } catch { return null }
  }
  on('GET', '/me/terms', (c) => {
    if (!lab('me') || !c.user) return { need: false }
    const t = savedTerms()
    const agreed = one<{ agreed_at: string }>('SELECT agreed_at FROM users WHERE id = ?', c.user.id)?.agreed_at ?? ''
    return t && agreed < t.at ? { need: true, summary: t.summary, at: t.at } : { need: false }
  })
  on('POST', '/me/agree', (c) => {
    labs('me')
    const u = me(c)
    if (c.body.agree !== true) throw new HttpError(400, '바뀐 약관을 확인하고 동의해 주세요.')
    run('UPDATE users SET agreed_at = ? WHERE id = ?', now(), u.id)
  })
  on('GET', '/admin/terms', (c) => {
    labs('ops')
    admin(c)
    const t = savedTerms()
    return { summary: t?.summary ?? '', at: t?.at ?? '', agreed: t ? one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE agreed_at >= ?', t.at)!.n : 0, users: one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n }
  })
  on('PUT', '/admin/terms', (c) => {
    labs('ops')
    admin(c)
    const summary = cleanText(c.body.summary, 1000)
    if (summary.length < 5) throw new HttpError(400, '무엇이 바뀌었는지 적어 주세요.')
    const t: Terms = { summary, at: now() }
    run("INSERT INTO meta (key, value) VALUES ('terms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(t))
    return t
  })

  // 실험: 서버 상태 — 가동 시간 · 메모리 · DB · 디스크 · 최근 응답 시간
  on('GET', '/admin/health', (c) => {
    labs('ops')
    admin(c)
    const sorted = [...timings].sort((a, b) => a - b)
    const pct = (p: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]) : 0)
    let disk: { free: number; total: number } | null = null
    try {
      const f = statfsSync(opts.backupDir ?? tmpdir())
      disk = { free: f.bavail * f.bsize, total: f.blocks * f.bsize }
    } catch { /* 디스크 정보를 못 읽는 환경 */ }
    const m = process.memoryUsage()
    return {
      startedAt: new Date(started).toISOString(), uptimeSec: Math.round((Date.now() - started) / 1000), node: process.version,
      memory: { rss: m.rss, heap: m.heapUsed }, storage: storageOf(db, autoDir), disk,
      requests: { served, failed, recent: sorted.length, avg: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0, p50: pct(0.5), p95: pct(0.95), max: pct(1) },
      errors24h: one<{ n: number }>('SELECT COUNT(*) AS n FROM error_log WHERE at >= ?', new Date(Date.now() - 24 * HOUR).toISOString())!.n,
    }
  })

  // 실험: 자동 백업 — 남길 개수 정하기 · 지금 하나 남기기 · 내려받기
  const keepNow = () => backupKeepOf(db, opts.backupKeep ?? 168)
  on('GET', '/admin/backups', (c) => {
    labs('ops')
    admin(c)
    return { keep: keepNow(), dir: !!autoDir, folder: opts.autoBackupDir ? '그려봄 폴더의 backups' : '볼륨 안 backups', files: listBackups(autoDir) }
  })
  on('PUT', '/admin/backups', (c) => {
    labs('ops')
    admin(c)
    const keep = Math.max(0, Math.min(2000, Math.floor(Number(c.body.keep))))
    if (!Number.isFinite(keep)) throw new HttpError(400, '남길 개수를 숫자로 적어 주세요.')
    run("INSERT INTO meta (key, value) VALUES ('backup_keep', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(keep))
    return { keep }
  })
  on('POST', '/admin/backups/run', (c) => {
    labs('ops')
    admin(c)
    if (!autoDir) throw new HttpError(400, '백업 폴더가 정해지지 않은 서버예요.')
    const before = listBackups(autoDir).length
    const f = maintain(db, autoDir, Math.max(1, keepNow()))
    return { file: f ? basename(f) : null, made: listBackups(autoDir).length > before }
  })
  on('GET', '/admin/backups/:name', (c) => {
    labs('ops')
    admin(c)
    if (!/^auto-\d{4}-\d{2}-\d{2}(-\d{2})?$/.test(c.params.name) || !autoDir) throw new HttpError(404, '찾을 수 없어요.')
    const file = join(autoDir, `${c.params.name}.db`)
    if (!existsSync(file)) throw new HttpError(404, '찾을 수 없어요.')
    c.res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': `attachment; filename="geuryeobom-${c.params.name}.db"`, 'Cache-Control': 'no-store' })
    c.res.end(readFileSync(file))
    return RAW
  })

  // 실험: 요청 제한 · 차단 현황 — 지금 막힌 IP · 이름(가려진 값) · 계정. 풀면 바로 다시 시도할 수 있다
  on('GET', '/admin/blocks', (c) => {
    labs('ops')
    admin(c)
    const alias = (ip: string) => one<{ alias: string }>('SELECT alias FROM ip_aliases WHERE ip = ?', ip)?.alias ?? ''
    return LIMITS.flatMap(([label, kind, l]) => l.blocked().map((b) => ({
      limit: label, kind, key: b.key, n: b.n, until: b.until,
      shown: kind === 'ip' ? b.key : kind === 'name' ? `이름 (가려짐 · ${b.key.slice(0, 8)})` : kind === 'user' ? (one<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', b.key)?.nickname ?? b.key) : '모든 IP 합계',
      alias: kind === 'ip' ? alias(b.key) : '',
    })))
  })
  on('POST', '/admin/blocks/release', (c) => {
    labs('ops')
    admin(c)
    const hit = LIMITS.find(([label]) => label === str(c.body.limit, 40))
    if (!hit) throw new HttpError(404, '찾을 수 없어요.')
    hit[2].reset(str(c.body.key, 200))
  })

  // 실험: 개인정보 처리 요청 대장 — 메일 · 전화로 받은 열람 · 정정 · 삭제 · 처리정지 요청과 처리 결과 (10일 안에)
  const PRIVACY_KINDS = ['열람', '정정', '삭제', '처리정지', '그 밖의 문의']
  const PRIVACY_STATUS = ['받음', '처리 중', '완료', '거절']
  on('GET', '/admin/privacy', (c) => {
    labs('ops')
    admin(c)
    return all('SELECT id, kind, who, detail, received_at AS receivedAt, status, done_at AS doneAt, note FROM privacy_requests ORDER BY status IN (\'완료\', \'거절\'), received_at DESC LIMIT 500')
  })
  on('PUT', '/admin/privacy/:id', (c) => {
    labs('ops')
    admin(c)
    const kind = PRIVACY_KINDS.includes(c.body.kind) ? (c.body.kind as string) : ''
    const status = PRIVACY_STATUS.includes(c.body.status) ? (c.body.status as string) : '받음'
    if (!kind) throw new HttpError(400, '요청 종류를 골라 주세요.')
    const day = str(c.body.receivedAt, 10)
    const received = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : now().slice(0, 10)
    const who = clean(c.body.who).slice(0, 60), detail = cleanText(c.body.detail, 500), note = cleanText(c.body.note, 500)
    const done = status === '완료' || status === '거절'
    if (c.params.id === 'new') {
      const id = newId()
      run('INSERT INTO privacy_requests (id, kind, who, detail, received_at, status, done_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, kind, who, detail, received, status, done ? now() : '', note)
      return { id }
    }
    const prev = one<{ done_at: string }>('SELECT done_at FROM privacy_requests WHERE id = ?', c.params.id)
    if (!prev) throw new HttpError(404, '찾을 수 없어요.')
    run('UPDATE privacy_requests SET kind = ?, who = ?, detail = ?, received_at = ?, status = ?, done_at = ?, note = ? WHERE id = ?',
      kind, who, detail, received, status, done ? prev.done_at || now() : '', note, c.params.id)
    return { id: c.params.id }
  })
  on('DELETE', '/admin/privacy/:id', (c) => {
    labs('ops')
    admin(c)
    run('DELETE FROM privacy_requests WHERE id = ?', c.params.id)
  })

  // 실험: 기관 담당자 초대 링크 만들기 · 끄기
  on('POST', '/admin/orgs/:id/invite', (c) => {
    labs('org')
    admin(c)
    const token = randomBytes(18).toString('base64url')
    if (!run('UPDATE orgs SET invite = ? WHERE id = ?', token, c.params.id).changes) throw new HttpError(404, '기관을 찾을 수 없어요.')
    return { invite: token }
  })
  on('DELETE', '/admin/orgs/:id/invite', (c) => {
    labs('org')
    admin(c)
    run("UPDATE orgs SET invite = '' WHERE id = ?", c.params.id)
  })

  on('POST', '/admin/login', (c) => {
    if (!opts.admin) throw new HttpError(404, '관리자 기능이 꺼져 있어요. 서버의 .env 에 ADMIN_ID · ADMIN_PASSWORD 를 정해 주세요.')
    adminLimit.check(c.ip)
    adminAll.check('all')
    // 둘 다 비교한 뒤에 판단해서, 아이디만 맞는지 응답 시간으로 알 수 없게 한다
    const id = str(c.body.id, 100), pw = str(c.body.password, 200)
    const idOk = same(id, opts.admin.id)
    const pwOk = same(pw, opts.admin.password)
    // 실험: 더 둔 관리자 계정 (개발 테스트 서버)
    let who: AdminWho | null = idOk && pwOk ? { who: opts.admin.id, role: 'owner' } : null
    if (!who && lab('ops')) {
      const acc = one<{ id: string; pw_hash: string; role: string }>('SELECT id, pw_hash, role FROM admin_accounts WHERE id = ?', id.toLowerCase())
      if (acc && checkPw(pw, acc.pw_hash)) who = { who: acc.id, role: acc.role === 'full' ? 'full' : 'viewer' }
    }
    // 누가 관리자 화면에 들어왔는지 알 수 있게 IP · 브라우저 · 성공 여부를 남긴다 (최근 2000건)
    run('INSERT INTO admin_logins (ip, ok, agent, at, who) VALUES (?, ?, ?, ?, ?)', c.ip, who ? 1 : 0, str(c.req.headers['user-agent'], 300), now(), who?.who ?? '')
    run('DELETE FROM admin_logins WHERE id <= (SELECT MAX(id) - 2000 FROM admin_logins)')
    if (!who) {
      adminLimit.hit(c.ip)
      adminAll.hit('all')
      throw new HttpError(401, '관리자 아이디나 비밀번호가 맞지 않아요.')
    }
    adminLimit.reset(c.ip)
    const token = randomBytes(32).toString('base64url')
    run('DELETE FROM admin_sessions WHERE expires_at < ?', now())
    run('INSERT INTO admin_sessions (token_hash, expires_at, who, role) VALUES (?, ?, ?, ?)', sha(token), new Date(Date.now() + 8 * HOUR).toISOString(), who.who, who.role)
    setCookie(c.res, token, null, ADMIN_COOKIE)
  })

  on('POST', '/admin/logout', (c) => {
    const token = cookieOf(c.req, ADMIN_COOKIE)
    if (token) run('DELETE FROM admin_sessions WHERE token_hash = ?', sha(token))
    setCookie(c.res, '', 0, ADMIN_COOKIE)
  })

  // 실험: 기간을 골라 날마다 몇 개가 생겼는지 (한국 시간 기준, 최대 1년)
  on('GET', '/admin/stats', (c) => {
    labs('ops')
    admin(c)
    const q = new URL(c.req.url ?? '', 'http://x').searchParams
    const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
    const to = day(q.get('to')) ?? new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10)
    const from = day(q.get('from')) ?? new Date(Date.parse(to) - 29 * 24 * HOUR).toISOString().slice(0, 10)
    const n = Math.round((Date.parse(to) - Date.parse(from)) / (24 * HOUR)) + 1
    if (n < 1 || n > 366) throw new HttpError(400, '기간은 하루에서 1년 사이로 골라 주세요.')
    const days = Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 24 * HOUR).toISOString().slice(0, 10))
    const per = (table: string, col: string) => {
      const rows = all<{ day: string; n: number }>(
        `SELECT date(${col}, '+9 hours') AS day, COUNT(*) AS n FROM ${table} WHERE date(${col}, '+9 hours') BETWEEN ? AND ? GROUP BY day`, from, to)
      return (d: string) => rows.find((r) => r.day === d)?.n ?? 0
    }
    const made = "json_extract(data, '$.createdAt')"
    const s = per('users', 'created_at'), g = per('graphs', made), p = per('posts', 'created_at'), ch = per('cheers', 'created_at'), gr = per('circles', 'created_at')
    const a = all<{ day: string; n: number }>('SELECT day, COUNT(*) AS n FROM answers WHERE day BETWEEN ? AND ? GROUP BY day', from, to)
    const rows = days.map((d) => ({ day: d, signups: s(d), graphs: g(d), groups: gr(d), posts: p(d), cheers: ch(d), answers: a.find((r) => r.day === d)?.n ?? 0 }))
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + (r[k] as number), 0)
    return { from, to, rows, total: { signups: sum('signups'), graphs: sum('graphs'), groups: sum('groups'), posts: sum('posts'), cheers: sum('cheers'), answers: sum('answers') } }
  })

  on('GET', '/admin/overview', (c) => {
    admin(c)
    const count = (table: string, where = '1', ...args: unknown[]) => one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...args)!.n
    const ago = (days: number) => new Date(Date.now() - days * 24 * HOUR).toISOString()
    const week = ago(7)
    const made = "json_extract(data, '$.createdAt')"
    // 날짜는 한국 시간으로 묶는다
    const perDay = (table: string, col: string) =>
      all<{ day: string; n: number }>(`SELECT date(${col}, '+9 hours') AS day, COUNT(*) AS n FROM ${table} WHERE ${col} >= ? GROUP BY day`, ago(14))
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() + 9 * HOUR - (13 - i) * 24 * HOUR).toISOString().slice(0, 10))
    const signups = perDay('users', 'created_at')
    const graphsMade = perDay('graphs', made)
    const pick = (rows: { day: string; n: number }[], d: string) => rows.find((r) => r.day === d)?.n ?? 0
    return {
      counts: { users: count('users'), graphs: count('graphs'), groups: count('circles'), posts: count('posts'), links: count('links') },
      stats: {
        completed: count('graphs', "json_extract(data, '$.completed') = 1"),
        letters: count('graphs', "json_extract(data, '$.futureLetter') IS NOT NULL"),
        cheers: count('cheers'),
        moments: one<{ n: number }>("SELECT COALESCE(SUM(json_array_length(data, '$.entries')), 0) AS n FROM graphs")!.n,
        scales: all<{ scale: string; n: number }>("SELECT json_extract(data, '$.timeScale') AS scale, COUNT(*) AS n FROM graphs GROUP BY scale"),
        week: {
          signups: count('users', 'created_at >= ?', week),
          visitors: count('users', 'last_seen_at >= ?', week),
          graphs: count('graphs', `${made} >= ?`, week),
          posts: count('posts', 'created_at >= ?', week),
          cheers: count('cheers', 'created_at >= ?', week),
        },
        online: count('users', 'last_seen_at >= ?', ago(1 / 24)),
        openReports: count('reports', "resolved_at = '' AND deleted_at = ''"),
        storage: storageOf(db, autoDir),
        answers: count('answers'),
        daily: days.map((d) => ({ day: d, signups: pick(signups, d), graphs: pick(graphsMade, d) })),
      },
      groups: all(
        `SELECT c.id, c.name, c.code, u.nickname AS owner, c.created_at AS createdAt,
                (SELECT COUNT(*) FROM members WHERE circle_id = c.id) AS memberCount,
                (SELECT COUNT(*) FROM posts WHERE circle_id = c.id) AS postCount
           FROM circles c JOIN users u ON u.id = c.owner_id ORDER BY c.created_at DESC LIMIT 200`,
      ),
      users: all(
        `SELECT u.id, u.nickname, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
                (SELECT COUNT(*) FROM graphs WHERE user_id = u.id) AS graphCount,
                (SELECT COUNT(*) FROM graphs WHERE user_id = u.id AND json_extract(data, '$.completed') = 1) AS completedCount,
                (SELECT COUNT(*) FROM members WHERE user_id = u.id) AS groupCount,
                (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS postCount
           FROM users u ORDER BY u.created_at DESC LIMIT 200`,
      ),
      posts: all<{ id: string; groupName: string; nickname: string; data: string; createdAt: string }>(
        `SELECT p.id, c.name AS groupName, u.nickname, p.data, p.created_at AS createdAt
           FROM posts p JOIN circles c ON c.id = p.circle_id JOIN users u ON u.id = p.user_id
          ORDER BY p.created_at DESC LIMIT 100`,
      ).map(({ data, ...p }) => ({ ...p, title: (JSON.parse(data) as { title: string }).title })),
    }
  })

  on('DELETE', '/admin/groups/:id', (c) => {
    admin(c)
    run('DELETE FROM circles WHERE id = ?', c.params.id)
  })
  on('DELETE', '/admin/users/:id', (c) => {
    admin(c)
    if (run('DELETE FROM users WHERE id = ?', c.params.id).changes) logPurge('관리자가 지움', 1)
  })
  on('DELETE', '/admin/posts/:id', (c) => {
    admin(c)
    takeDown(c.params.id)
  })

  // 한 사람의 모든 것: 계정 정보 · 들어간 모임과 자리 · 모든 기록(회고 · 지금의 나 · 미래 편지 포함) · 모임에 나눈 것 · 공유 링크
  on('GET', '/admin/users/:id', (c) => {
    admin(c)
    const u = one<{ id: string; nickname: string; created_at: string; agreed_at: string; last_seen_at: string; guardian: string }>(
      'SELECT id, nickname, created_at, agreed_at, last_seen_at, guardian FROM users WHERE id = ?',
      c.params.id,
    )
    if (!u) throw new HttpError(404, '찾을 수 없어요.')
    return {
      id: u.id, nickname: u.nickname, createdAt: u.created_at, agreedAt: u.agreed_at, lastSeenAt: u.last_seen_at,
      guardian: u.guardian ? JSON.parse(u.guardian) : null,
      sessions: one<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at >= ?', u.id, now())!.n,
      cheersGiven: one<{ n: number }>('SELECT COUNT(*) AS n FROM cheers WHERE user_id = ?', u.id)!.n,
      cheersReceived: one<{ n: number }>('SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ?', u.id)!.n,
      groups: all(
        `SELECT c.id, c.name, m.joined_at AS joinedAt,
                CASE WHEN c.owner_id = m.user_id THEN 'owner' WHEN m.role = 'co' THEN 'co' WHEN m.role = 'helper' THEN 'helper' ELSE 'member' END AS role
           FROM members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
        u.id,
      ),
      graphs: all<{ data: string }>('SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC', u.id).map((r) => JSON.parse(r.data)),
      posts: all<{ id: string; groupName: string; graphId: string; createdAt: string }>(
        'SELECT p.id, c.name AS groupName, p.graph_id AS graphId, p.created_at AS createdAt FROM posts p JOIN circles c ON c.id = p.circle_id WHERE p.user_id = ? ORDER BY p.created_at DESC',
        u.id,
      ),
      links: linksOf('l.user_id = ?', u.id),
      answers: all('SELECT day, question, text, color FROM answers WHERE user_id = ? ORDER BY day DESC LIMIT 100', u.id),
    }
  })

  // 신고함: 처리하지 않은 것 먼저. 처리한 지 1년 지난 것은 지운다.
  on('GET', '/admin/reports', (c) => {
    admin(c)
    const year = new Date(Date.now() - 365 * 24 * HOUR).toISOString()
    run("DELETE FROM reports WHERE (resolved_at != '' AND resolved_at < ?) OR (deleted_at != '' AND deleted_at < ?)", year, year)
    const deleted = new URL(c.req.url ?? '/', 'http://x').searchParams.get('deleted') === '1'
    return all(
      `SELECT r.id, r.post_id AS postId, r.circle_id AS groupId, r.reason, r.detail, r.post_title AS postTitle, r.post_owner AS postOwner,
              r.group_name AS groupName, r.created_at AS createdAt, r.resolved_at AS resolvedAt, u.nickname AS reporter,
              r.deleted_at AS deletedAt, r.delete_reason AS deleteReason
         FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
        WHERE ${deleted ? "r.deleted_at != ''" : "r.deleted_at = ''"}
        ORDER BY r.resolved_at != '', r.created_at DESC LIMIT 300`,
    )
  })
  // 신고 기록 지우기 (시험 · 잘못 들어온 신고): 사유를 꼭 남기고, ‘지운 신고’에서 1년 동안 볼 수 있다
  on('DELETE', '/admin/reports/:id', (c) => {
    admin(c)
    const reason = cleanText(c.body.reason, 200)
    if (reason.length < 2) throw new HttpError(400, '지우는 까닭을 적어 주세요.')
    if (!run("UPDATE reports SET deleted_at = ?, delete_reason = ? WHERE id = ? AND deleted_at = ''", now(), reason, c.params.id).changes) {
      throw new HttpError(404, '찾을 수 없어요.')
    }
  })
  on('POST', '/admin/reports/:id/resolve', (c) => {
    admin(c)
    run('UPDATE reports SET resolved_at = ? WHERE id = ?', c.body.undo === true ? '' : now(), c.params.id)
  })

  // 공유 링크 모두 (누가 · 어떤 그래프로 · 언제)
  on('GET', '/admin/links', (c) => {
    admin(c)
    return linksOf('1 = 1')
  })
  on('DELETE', '/admin/links/:code', (c) => {
    admin(c)
    run('DELETE FROM links WHERE code = ?', c.params.code)
  })

  // 관리자 접속 기록 · IP 별칭
  on('GET', '/admin/logins', (c) => {
    admin(c)
    return all(
      `SELECT l.id, l.ip, l.ok, l.agent, l.at, l.who, COALESCE(a.alias, '') AS alias
         FROM admin_logins l LEFT JOIN ip_aliases a ON a.ip = l.ip ORDER BY l.id DESC LIMIT 300`,
    ).map((r: any) => ({ ...r, ok: r.ok === 1 }))
  })
  on('PUT', '/admin/ip-aliases', (c) => {
    admin(c)
    const ip = str(c.body.ip, 64).trim()
    const alias = clean(c.body.alias).slice(0, 30)
    if (!ip) throw new HttpError(400, 'IP 를 읽지 못했어요.')
    if (alias) run('INSERT INTO ip_aliases (ip, alias) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET alias = excluded.alias', ip, alias)
    else run('DELETE FROM ip_aliases WHERE ip = ?', ip)
    return { ip, alias }
  })

  // DB 백업 내려받기: 지금 상태를 파일 하나로 (서버 옮길 때 · 정기 백업). 회고까지 모두 들어 있으니 안전하게 보관.
  on('GET', '/admin/backup', (c) => {
    admin(c)
    const tmp = join(tmpdir(), `geuryeobom-backup-${randomBytes(6).toString('hex')}.db`)
    db.exec(`VACUUM INTO '${tmp}'`)
    const file = readFileSync(tmp)
    rmSync(tmp, { force: true })
    const day = now().slice(0, 10)
    c.res.writeHead(200, {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="geuryeobom-${day}.db"`,
      'Cache-Control': 'no-store',
    })
    c.res.end(file)
    return RAW
  })

  // 백업 파일로 되돌리기 (웹에서). 관리자 비밀번호를 한 번 더 받고, 바꾸기 전의 DB 를 backupDir 에 남긴다.
  // 백업 파일은 임시로 열어 지금 버전의 모양으로 맞춘 뒤(openDb), 표마다 같은 칸만 옮긴다 — 예전 버전 백업도 된다.
  on('POST', '/admin/restore', async (c) => {
    admin(c)
    adminLimit.check(c.ip)
    let pw = ''
    try {
      pw = decodeURIComponent(String(c.req.headers['x-admin-password'] ?? ''))
    } catch {
      /* 읽지 못하면 틀린 것으로 */
    }
    if (!same(pw, opts.admin!.password)) {
      adminLimit.hit(c.ip)
      throw new HttpError(401, '관리자 비밀번호가 맞지 않아요.')
    }
    const buf = await readRaw(c.req, 200 * 1024 * 1024)
    if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') throw new HttpError(400, '그려봄 백업 파일(.db)이 아니에요.')
    const tmp = join(tmpdir(), `geuryeobom-restore-${randomBytes(6).toString('hex')}.db`)
    const cleanup = () => ['', '-wal', '-shm'].forEach((x) => rmSync(tmp + x, { force: true }))
    writeFileSync(tmp, buf)
    try {
      if (!isOurDb(tmp)) throw new HttpError(400, '그려봄 백업 파일이 아니거나 열 수 없어요.')
      const up = openDb(tmp)
      const ok = (up.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
      up.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      up.close()
      if (ok !== 'ok') throw new HttpError(400, '백업 파일이 손상돼 있어요.')

      // 지금 DB 를 먼저 남긴다 (최근 5개만)
      const dir = opts.backupDir ?? tmpdir()
      mkdirSync(dir, { recursive: true })
      const before = join(dir, `before-restore-${now().replace(/[:.]/g, '-')}.db`)
      db.exec(`VACUUM INTO '${before.replace(/'/g, "''")}'`)
      readdirSync(dir).filter((f) => f.startsWith('before-restore-')).sort().slice(0, -5).forEach((f) => rmSync(join(dir, f), { force: true }))

      const colsOf = (schema: string, t: string) => all<{ name: string }>('SELECT name FROM pragma_table_info(?, ?)', t, schema).map((r) => r.name)
      db.prepare('ATTACH DATABASE ? AS up').run(tmp)
      db.exec('PRAGMA foreign_keys = OFF')
      try {
        db.exec('BEGIN')
        try {
          for (const t of RESTORE_TABLES) {
            const theirs = colsOf('up', t)
            const cols = colsOf('main', t).filter((n) => theirs.includes(n)).map((n) => `"${n}"`).join(', ')
            db.exec(`DELETE FROM main.${t}`)
            if (cols) db.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM up.${t}`)
          }
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      } finally {
        db.exec('PRAGMA foreign_keys = ON')
        db.exec('DETACH DATABASE up')
      }

      // 로그인 비밀값: .env 에 없으면 백업 안의 값을 쓴다. 백업에도 없으면(그 서버는 .env 에 두었던 것) 지금 값을 남기되 알린다.
      let secretMissing = false
      if (!opts.authSecret && !one("SELECT 1 FROM meta WHERE key = 'auth_secret'")) {
        run("INSERT INTO meta (key, value) VALUES ('auth_secret', ?)", secret)
        secretMissing = true
      }
      secret = readSecret()
      const n = (t: string) => one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n
      return { users: n('users'), graphs: n('graphs'), groups: n('circles'), before: basename(before), secretMissing }
    } finally {
      cleanup()
    }
  })

  // DB 초기화: 회원 · 기록을 모두 지우고 처음 상태로. 사이트 설정 · 공지 · 로그인 비밀값 · 관리자 접속 기록은 남긴다.
  // 지우기 전 DB 는 서버에 남겨 두어(최근 5개) 복원으로 되돌릴 수 있다.
  on('POST', '/admin/reset', (c) => {
    // 정식 버전에는 없는 기능: 개발 테스트 서버에서만
    if (!opts.devServer) throw new HttpError(404, '찾을 수 없어요.')
    admin(c)
    adminLimit.check(c.ip)
    if (!same(String(c.body?.password ?? ''), opts.admin!.password)) {
      adminLimit.hit(c.ip)
      throw new HttpError(401, '관리자 비밀번호가 맞지 않아요.')
    }
    if (c.body?.confirm !== RESET_PHRASE) throw new HttpError(400, `확인 칸에 ‘${RESET_PHRASE}’ 를 그대로 적어 주세요.`)
    const dir = opts.backupDir ?? tmpdir()
    mkdirSync(dir, { recursive: true })
    const before = join(dir, `before-reset-${now().replace(/[:.]/g, '-')}.db`)
    db.exec(`VACUUM INTO '${before.replace(/'/g, "''")}'`)
    readdirSync(dir).filter((f) => f.startsWith('before-reset-')).sort().slice(0, -5).forEach((f) => rmSync(join(dir, f), { force: true }))
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.exec('BEGIN')
      try {
        for (const t of RESET_TABLES) db.exec(`DELETE FROM ${t}`)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
    return { before: basename(before) }
  })

  on('GET', '/admin/groups/:id', (c) => {
    admin(c)
    const circle = one<{ id: string; name: string; intro: string; code: string; preset: string }>('SELECT * FROM circles WHERE id = ?', c.params.id)
    if (!circle) throw new HttpError(404, '찾을 수 없어요.')
    const posts = postsOf(circle.id).map(({ userId, ...p }) => p)
    const members = all<{ id: string; nickname: string; role: string; joinedAt: string }>(
      `SELECT u.id, u.nickname, m.joined_at AS joinedAt,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' WHEN m.role = 'helper' THEN 'helper' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ? ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 WHEN m.role = 'helper' THEN 2 ELSE 3 END, m.joined_at, m.rowid`,
      circle.id,
    )
    const created = one<{ created_at: string }>('SELECT created_at FROM circles WHERE id = ?', circle.id)!.created_at
    return { id: circle.id, name: circle.name, intro: circle.intro, code: circle.code, createdAt: created, preset: readPreset(circle.preset), members, posts }
  })

  on('PUT', '/admin/groups/:id', (c) => {
    admin(c)
    const info = groupInfo(c.body)
    if (!run('UPDATE circles SET name = ?, intro = ? WHERE id = ?', info.name, info.intro, c.params.id).changes) throw new HttpError(404, '찾을 수 없어요.')
    return info
  })

  // 사이트 설정: saved = 관리자 화면에서 저장한 값을 쓰는 중인지, env = .env 값 (되돌리기용)
  on('GET', '/admin/settings', (c) => {
    admin(c)
    // secretInDb: 로그인 비밀값이 DB 안에 있는지 (그러면 백업 파일만으로 이름 · 생일을 알아낼 수 있어 따로 알린다)
    return { site: site(), saved: !!savedSite(), env: envSite, secretInDb: !opts.authSecret }
  })
  on('PUT', '/admin/settings', (c) => {
    admin(c)
    const s = sanitizeSite(c.body)
    run("INSERT INTO meta (key, value) VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(s))
    return s
  })
  on('GET', '/admin/notice', (c) => {
    admin(c)
    return savedNotice() ?? { on: false, title: '', body: '', at: '' }
  })
  on('PUT', '/admin/notice', (c) => {
    admin(c)
    const title = clean(c.body?.title).slice(0, 60)
    const body = cleanText(c.body?.body, 2000)
    const on = c.body?.on === true
    if (on && !title && !body) throw new HttpError(400, '공지 제목이나 내용을 적어 주세요.')
    const prev = savedNotice()
    // 내용이 바뀌었거나 새로 켰을 때만 at 을 새로 → 이미 본 사람에게도 다시 뜬다
    const changed = !prev || prev.title !== title || prev.body !== body || (!prev.on && on)
    // 실험: 예약 게시 (시작 · 끝 시각, 비우면 바로 · 내릴 때까지)
    const when = (x: unknown) => (lab('ops') && str(x, 40) && !Number.isNaN(Date.parse(str(x, 40))) ? new Date(str(x, 40)).toISOString() : '')
    const from = when(c.body?.from), to = when(c.body?.to)
    if (from && to && to <= from) throw new HttpError(400, '내리는 때는 올리는 때보다 뒤여야 해요.')
    const n: Notice = { on, title, body, at: changed ? new Date().toISOString() : prev.at, from, to }
    run("INSERT INTO meta (key, value) VALUES ('notice', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(n))
    return n
  })
  on('DELETE', '/admin/settings', (c) => {
    admin(c)
    run("DELETE FROM meta WHERE key = 'site'")
    return envSite
  })

  /* ───── 실험 7차 ───── */

  // 실험 기능 스위치 — 정식 서버에서 아직 정식이 아닌 묶음(보호자 동의)을 켠다. OFFICIAL 묶음은 저장값과 상관없이 켜짐
  on('GET', '/admin/flags', (c) => {
    admin(c)
    return { dev: !!opts.devServer, flags: flagsOn() }
  })
  on('PUT', '/admin/flags', (c) => {
    admin(c)
    const next: Partial<Record<Flag, boolean>> = {}
    for (const [k, v] of Object.entries(c.body.flags ?? {})) if (isFlag(k)) next[k] = v === true
    run("INSERT INTO meta (key, value) VALUES ('flags', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next))
    return { flags: next }
  })

  // 실험: 문의하기 — 로그인하지 않아도 된다. 운영자만 본다
  const INQUIRY_KINDS = ['궁금해요', '고쳐 주세요', '개인정보', '그 밖의 일']
  // 로그인한 사람만 (메일을 보내지 않으니, 답은 사이트의 ‘내 문의’ 에서 본다)
  on('POST', '/contact', (c) => {
    labs('me')
    const u = me(c)
    contactLimit.check(c.ip)
    const kind = INQUIRY_KINDS.includes(c.body.kind) ? (c.body.kind as string) : ''
    const message = cleanText(c.body.message, 1000)
    if (!kind) throw new HttpError(400, '무엇에 대한 문의인지 골라 주세요.')
    if (message.length < 5) throw new HttpError(400, '문의 내용을 조금 더 적어 주세요.')
    contactLimit.hit(c.ip)
    run('INSERT INTO inquiries (id, user_id, nickname, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), u.id, u.nickname, kind, message, now())
  })
  // 내 문의와 운영자의 답
  on('GET', '/me/inquiries', (c) => {
    labs('me')
    const u = me(c)
    return all('SELECT id, kind, message, created_at AS createdAt, status, answer, answered_at AS answeredAt FROM inquiries WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', u.id)
  })
  on('GET', '/admin/inquiries', (c) => {
    labs('ops')
    admin(c)
    // 처리한 지 1년 지난 문의는 지운다
    run("DELETE FROM inquiries WHERE done_at != '' AND done_at < ?", new Date(Date.now() - 365 * 24 * HOUR).toISOString())
    return all<{ member: number }>("SELECT id, nickname, kind, message, contact, created_at AS createdAt, status, note, answer, answered_at AS answeredAt, done_at AS doneAt, user_id IS NOT NULL AS member FROM inquiries ORDER BY status IN ('답함', '대장으로 옮김', '닫음'), created_at DESC LIMIT 500")
      .map((r) => ({ ...r, member: r.member === 1 }))
  })
  on('PUT', '/admin/inquiries/:id', (c) => {
    labs('ops')
    admin(c)
    const status = ['새 문의', '보는 중', '답함', '닫음'].includes(c.body.status) ? (c.body.status as string) : '새 문의'
    const prev = one<{ done_at: string; answer: string; answered_at: string }>('SELECT done_at, answer, answered_at FROM inquiries WHERE id = ?', c.params.id)
    if (!prev) throw new HttpError(404, '찾을 수 없어요.')
    // 답: 이용자의 ‘내 문의’ 에 보인다. 처음 적거나 고치면 그때를 답한 때로 (그러면 ‘답함’)
    const answer = c.body.answer === undefined ? prev.answer : cleanText(c.body.answer, 2000)
    const answeredAt = answer !== prev.answer ? (answer ? now() : '') : prev.answered_at
    const st = answer && answer !== prev.answer ? '답함' : status
    const done = st === '답함' || st === '닫음'
    run('UPDATE inquiries SET status = ?, note = ?, answer = ?, answered_at = ?, done_at = ? WHERE id = ?', st, cleanText(c.body.note, 500), answer, answeredAt, done ? prev.done_at || now() : '', c.params.id)
  })
  on('POST', '/admin/inquiries/:id/to-privacy', (c) => {
    labs('ops')
    admin(c)
    const q = one<{ nickname: string; contact: string; message: string; created_at: string }>('SELECT nickname, contact, message, created_at FROM inquiries WHERE id = ?', c.params.id)
    if (!q) throw new HttpError(404, '찾을 수 없어요.')
    const kind = ['열람', '정정', '삭제', '처리정지', '그 밖의 문의'].includes(c.body.kind) ? (c.body.kind as string) : '그 밖의 문의'
    const id = newId()
    run('INSERT INTO privacy_requests (id, kind, who, detail, received_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      id, kind, [q.nickname, q.contact].filter(Boolean).join(' · ').slice(0, 60) || '문의함', q.message.slice(0, 500), new Date(Date.parse(q.created_at) + 9 * HOUR).toISOString().slice(0, 10), '받음')
    run("UPDATE inquiries SET status = '대장으로 옮김', done_at = ? WHERE id = ?", now(), c.params.id)
    return { id }
  })

  // 실험: 설정 진단 — 운영에 꼭 맞춰 둘 것들을 점검표로
  on('GET', '/admin/diagnose', (c) => {
    labs('ops')
    admin(c)
    const s = site()
    const files = listBackups(autoDir)
    const keep = keepNow()
    let free = -1
    try {
      const f = statfsSync(opts.backupDir ?? tmpdir())
      free = f.bavail * f.bsize
    } catch { /* 못 읽는 환경 */ }
    const pwLen = opts.admin?.password.length ?? 0
    const fresh = !!files[0] && Date.now() - Date.parse(files[0].at) < 3 * HOUR
    const secretLen = opts.authSecret?.length ?? 0
    return [
      { name: '로그인 비밀값 (AUTH_SECRET)', ok: secretLen >= 32, detail: opts.authSecret ? (secretLen >= 32 ? '.env 에 정해져 있어요.' : `${secretLen}자예요. 32자 이상 무작위 값을 권장해요 (openssl rand -hex 32).`) : 'DB 안에 있어요. 백업 파일만 새어도 이름 · 생일을 알아낼 수 있어요. README ‘보안’ 대로 옮겨 주세요.' },
      { name: '쿠키 보안 (COOKIE_SECURE)', ok: opts.secureCookie, detail: opts.secureCookie ? 'https 에서만 로그인 쿠키를 보내요.' : '꺼져 있어요. https 로 운영한다면 켜 주세요.' },
      { name: '공유 주소 (PUBLIC_URL)', ok: !!s.publicUrl?.startsWith('https://'), detail: s.publicUrl ? (s.publicUrl.startsWith('https://') ? s.publicUrl : `${s.publicUrl} — https 주소를 권장해요.`) : '비어 있어요. 공유 링크 · QR 이 접속한 주소로 만들어져요.' },
      { name: '관리자 비밀번호', ok: pwLen >= 16, detail: `${pwLen}자예요.${pwLen >= 16 ? '' : ' 16자 이상을 권장해요.'}` },
      { name: '자동 백업', ok: keep > 0 && fresh, detail: keep <= 0 ? '꺼져 있어요 (남길 개수 0).' : files[0] ? `최근 ${keep}개 남김 (한 시간에 하나) · 마지막 ${files[0].name}${fresh ? '' : ' — 세 시간 넘게 새 백업이 없어요.'}` : '아직 자동 백업이 없어요 (켜진 지 1분 뒤 처음 남겨요). 폴더에 쓸 수 있는지 확인해 주세요.' },
      { name: '디스크 여유', ok: free < 0 || free > 1024 ** 3, detail: free < 0 ? '읽지 못했어요.' : `${(free / 1024 ** 3).toFixed(1)}GB 남았어요.${free > 1024 ** 3 ? '' : ' 1GB 아래예요.'}` },
      { name: '운영 기관 · 문의처', ok: !!s.operator?.name && !!s.operator?.contact, detail: s.operator?.name && s.operator.contact ? `${s.operator.name} · ${s.operator.contact}` : '약관 · 처리방침에 들어갈 운영 기관 · 문의처 이메일을 ‘사이트 설정’ 에서 정해 주세요.' },
      { name: '서버 종류', ok: true, detail: opts.devServer ? '개발 테스트 서버예요 (실험 기능 모두 켜짐 · DB 초기화 있음).' : '정식 서버예요.' },
    ]
  })

  // 실험: DB 점검 · 손질
  on('GET', '/admin/db-check', (c) => {
    labs('ops')
    admin(c)
    return {
      integrity: one<{ integrity_check: string }>('PRAGMA integrity_check')!.integrity_check,
      fkProblems: all('PRAGMA foreign_key_check').length,
      freePages: one<{ freelist_count: number }>('PRAGMA freelist_count')!.freelist_count,
      expiredSessions: one<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?', now())!.n,
      tables: all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map((t) => ({ name: t.name, rows: one<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t.name}"`)!.n })),
    }
  })
  on('POST', '/admin/db-tidy', (c) => {
    labs('ops')
    admin(c)
    maintain(db, null, 0) // 끝난 로그인 지우기 · 통계 손보기 · WAL 합치기 (백업은 하지 않는다)
  })

  // 실험: 시간대별 접속 (요일 × 시간)
  on('GET', '/admin/hours', (c) => {
    labs('ops')
    admin(c)
    return all('SELECT dow, hour, n FROM visit_hours')
  })

  // 실험: 새 버전 알림 — 깃허브 릴리스 (6시간마다 한 번만 묻는다)
  let updateCache: { at: number; latest: { tag: string; name: string; url: string; publishedAt: string } | null } | null = null
  on('GET', '/admin/update', async (c) => {
    labs('ops')
    admin(c)
    if (!updateCache || Date.now() - updateCache.at > 6 * HOUR) {
      try {
        const r = await fetch('https://api.github.com/repos/hatility/Gryeobom/releases/latest', { headers: { 'User-Agent': 'geuryeobom-server', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) })
        const j: any = r.ok ? await r.json() : null
        updateCache = { at: Date.now(), latest: j ? { tag: str(j.tag_name, 40), name: str(j.name, 100), url: str(j.html_url, 300), publishedAt: str(j.published_at, 40) } : null }
      } catch {
        updateCache = { at: Date.now() - 5 * HOUR, latest: null } // 못 물으면 한 시간 뒤 다시
      }
    }
    return { latest: updateCache.latest }
  })

  // 실험: 파기 기록 (건수만)
  on('GET', '/admin/purges', (c) => {
    labs('ops')
    admin(c)
    return all('SELECT at, kind, count FROM purge_log ORDER BY id DESC LIMIT 500')
  })

  return async (req: IncomingMessage, res: ServerResponse) => {
    const t0 = performance.now()
    res.once('finish', () => {
      served++
      if (res.statusCode >= 500) failed++
      timings.push(performance.now() - t0)
      if (timings.length > 500) timings.shift()
    })
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    try {
      const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/api/, '')
      let match: RegExpExecArray | null = null
      const route = routes.find(([m, re]) => m === req.method && (match = re.exec(path)))
      if (!route || !match) throw new HttpError(404, '찾을 수 없어요.')
      // 다른 사이트에서 보낸 요청 막기: 이 앱의 fetch만 붙이는 헤더 + JSON 본문
      // DB 복원만 파일(바이너리) 본문을 받는다. 헤더 확인은 똑같이.
      const rawBody = req.method === 'POST' && path === '/admin/restore'
      const type = String(req.headers['content-type'])
      // 브라우저가 보내는 보안 정책 보고는 이 앱의 헤더를 붙이지 않는다 (보고 형식의 본문만 받는다)
      const cspReport = req.method === 'POST' && path === '/csp-report' && /^application\/(csp-report|reports\+json|json)/.test(type)
      const m = req.method !== 'GET' && !cspReport && !path.startsWith('/admin') && path !== '/auth/logout' ? maintenance() : null
      if (m?.on) throw new HttpError(503, m.message ? `지금은 점검 중이에요: ${m.message}` : '지금은 점검 중이에요. 잠시 뒤에 다시 저장해 주세요.')
      if (req.method !== 'GET' && !cspReport && (req.headers['x-requested-with'] !== 'geuryeobom' || !(rawBody ? type === 'application/octet-stream' : type.startsWith('application/json')))) {
        throw new HttpError(403, '허용되지 않은 요청이에요.')
      }
      const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '')
      const body = req.method === 'GET' || rawBody ? {} : await readJson(req)
      const result = await route[2]({ req, res, user: currentUser(req), params: (match as RegExpExecArray).groups ?? {}, body, ip })
      if (result !== RAW) send(200, result ?? { ok: true })
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message })
      else {
        console.error(e)
        // 실험: 관리자 ‘최근 오류’ 에 남긴다 (누가 보냈는지 · 본문은 남기지 않는다)
        if (lab('ops')) {
          try {
            const err = e instanceof Error ? e : new Error(String(e))
            db.prepare('INSERT INTO error_log (at, method, path, message, stack) VALUES (?, ?, ?, ?, ?)').run(
              new Date().toISOString(), req.method ?? '', new URL(req.url ?? '/', 'http://x').pathname.slice(0, 200), err.message.slice(0, 500), (err.stack ?? '').split('\n').slice(0, 6).join('\n').slice(0, 1500))
            db.exec('DELETE FROM error_log WHERE id <= (SELECT MAX(id) - 500 FROM error_log)')
          } catch {
            /* 기록하다 실패해도 응답은 그대로 */
          }
        }
        send(500, { error: '잠시 문제가 생겼어요. 조금 뒤에 다시 해볼까요?' })
      }
    }
  }
}
