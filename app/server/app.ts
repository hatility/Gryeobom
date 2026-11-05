import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CHEERS, MOOD_COLORS } from '../src/content.ts'
import { GROUP_POST, postShared, sanitizePostOptions, sanitizeShared, type PostOptions } from '../src/share.ts'
import type { GroupPreset, LifeGraph } from '../src/types.ts'
import { httpUrl, isEmail } from './config.ts'
import { isOurDb, openDb, storageOf, type Db } from './db.ts'

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

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 6자리 모임 코드
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
// 공유 링크 코드: 대소문자 · 숫자 8자 (57^8 ≈ 1.1경, 맞혀 보기는 linkMiss 가 막는다)
const LINK_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newLinkCode = () => Array.from({ length: 8 }, () => LINK_CHARS[randomInt(LINK_CHARS.length)]).join('')
/** 신고 까닭: 놀림 · 괴롭힘 / 개인정보 / 위험해 보여요(도움이 필요해 보임) / 그 밖에 */
const REPORT_REASONS = ['hurt', 'privacy', 'danger', 'other']
/** 웹 복원 때 백업에서 옮길 표. 관리자 세션 · 관리자 접속 기록은 지금 것을 그대로 둔다. */
const RESTORE_TABLES = ['meta', 'users', 'sessions', 'graphs', 'circles', 'members', 'posts', 'cheers', 'links', 'ip_aliases', 'answers', 'reports', 'takedowns']
/** 핸들러가 응답을 직접 썼을 때 (파일 내려받기) */
const RAW = Symbol('raw')

/** 저장할 그래프 검증. 내 기록이라도 정해진 모양 말고는 받지 않는다. */
function sanitizeGraph(raw: any, id: string): LifeGraph {
  if (!raw || typeof raw !== 'object' || raw.id !== id) throw new HttpError(400, '기록을 읽지 못했어요.')
  const r = raw.currentReflection ?? {}
  const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, 100) : []
  return {
    id,
    title: str(raw.title, 40),
    timeScale: raw.timeScale === 'year' || raw.timeScale === 'month' ? raw.timeScale : 'age',
    ...(raw.monthRange === 'recent12' || raw.monthRange === 'thisYear' ? { monthRange: raw.monthRange } : {}),
    ...(['rose', 'sage', 'sand', 'lilac'].includes(raw.lineColor) ? { lineColor: raw.lineColor } : {}),
    startPoint: int(raw.startPoint),
    currentPoint: int(raw.currentPoint),
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
      },
      showOnGraph: e?.showOnGraph !== false,
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
    completed: raw.completed === true,
    createdAt: str(raw.createdAt, 40) || now(),
    updatedAt: now(),
  }
}

/** 모임장이 정한 ‘나의 시간’ 검증. null 은 ‘정하지 않음’. */
function sanitizePreset(raw: any): GroupPreset | null {
  if (raw === null) return null
  const choice = (['age', 'year', 'recent12', 'thisYear'] as const).find((k) => k === raw?.choice)
  const start = int(raw?.start), end = int(raw?.end), year = new Date().getFullYear()
  const ok =
    choice === 'age' ? start >= 0 && end <= 120 && start < end
    : choice === 'year' ? start >= 1900 && end <= year && start < end
    : choice === 'recent12' ? end >= 1900 * 12 && end <= year * 12 + 11
    : choice === 'thisYear'
  if (!choice || !ok) throw new HttpError(400, '나의 시간을 한 번 더 확인해 주세요.')
  return { choice, start, end, title: clean(raw.title).slice(0, 40) }
}
const readPreset = (s: string): GroupPreset | null => (s ? JSON.parse(s) : null)

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
  /** 웹에서 복원하기 전에 지금 DB 를 남겨 둘 폴더 (보통 DB 파일 옆). 없으면 임시 폴더 */
  backupDir?: string
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
  const adminLimit = limiter(5, 15 * 60_000)
  // 여러 IP 로 나눠 관리자 비밀번호를 맞혀 보는 것 막기: 모든 IP 를 합쳐 한 시간에 틀린 시도 50번까지
  const adminAll = limiter(50, HOUR)

  // 서버 비밀값: AUTH_SECRET 설정값, 없으면 처음 실행할 때 만들어 DB에 둔다
  const readSecret = () =>
    opts.authSecret ||
    one<{ value: string }>("SELECT value FROM meta WHERE key = 'auth_secret'")?.value ||
    (() => {
      const s = randomBytes(32).toString('hex')
      run("INSERT INTO meta VALUES ('auth_secret', ?)", s)
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
    if (!last || Date.now() - Date.parse(last) > 10 * 60_000) run('UPDATE users SET last_seen_at = ? WHERE id = ?', now(), userId)
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
    run('INSERT INTO sessions VALUES (?, ?, ?)', sha(token), userId, new Date(Date.now() + ttl).toISOString())
    seen(userId, '')
    setCookie(res, token, remember ? ttl / 1000 : null)
  }

  const me = (c: Ctx) => {
    if (!c.user) throw new HttpError(401, '로그인이 필요해요.')
    return c.user
  }
  const isMember = (circleId: string, userId: string) => !!one('SELECT 1 FROM members WHERE circle_id = ? AND user_id = ?', circleId, userId)
  /** 모임과 그 안에서 나의 자리. manager = 모임장 또는 공동 모임장 (모임 꾸리기 · 글 내리기) */
  const memberOf = (circleId: string, userId: string) => {
    const circle = one<{ id: string; name: string; intro: string; code: string; owner_id: string; preset: string; role: string; topic: string; topic_at: string }>(
      'SELECT c.*, m.role FROM circles c JOIN members m ON m.circle_id = c.id WHERE c.id = ? AND m.user_id = ?',
      circleId, userId,
    )
    if (!circle) throw new HttpError(404, '모임을 찾을 수 없어요.')
    const owner = circle.owner_id === userId
    return { ...circle, owner, manager: owner || circle.role === 'co' }
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
      'INSERT INTO takedowns VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, graph_id) DO UPDATE SET options = excluded.options, at = excluded.at',
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
    const user = { id: newId(), nickname }
    run('INSERT INTO users (id, login_key, nickname, created_at, agreed_at) VALUES (?, ?, ?, ?, ?)', user.id, key, nickname, now(), now())
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
    // 모임에서 그린 그래프: 들어가 있는 모임일 때만 이어 두고, 늘 ‘함께 나누기’
    if (g.groupId && !isMember(g.groupId, u.id)) delete g.groupId
    if (g.groupId) g.visibility = 'link'
    run(
      'INSERT INTO graphs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
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

  on('GET', '/graphs/:id/posts', (c) => {
    const u = me(c)
    ownGraph(c.params.id, u.id)
    return all('SELECT id AS postId, circle_id AS groupId FROM posts WHERE graph_id = ?', c.params.id)
  })

  /* ───── 모임 ───── */

  on('GET', '/groups', (c) => {
    const u = me(c)
    return all<{ id: string; name: string; isOwner: number; role: string; memberCount: number; topic: string; topicAt: string }>(
      `SELECT c.id, c.name, c.owner_id = ? AS isOwner, m.role, c.topic, c.topic_at AS topicAt,
              (SELECT COUNT(*) FROM members WHERE circle_id = c.id) AS memberCount
         FROM circles c JOIN members m ON m.circle_id = c.id
        WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
      u.id, u.id,
    ).map(({ isOwner, role, ...g }) => ({ ...g, role: isOwner === 1 ? 'owner' : role === 'co' ? 'co' : 'member' }))
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

  on('POST', '/groups/join', (c) => {
    const u = me(c)
    joinLimit.check(c.ip)
    const code = str(c.body.code, 20).trim().toUpperCase()
    const circle = one<{ id: string }>('SELECT id FROM circles WHERE code = ?', code)
    if (!circle) {
      joinLimit.hit(c.ip)
      throw new HttpError(404, '그 코드의 모임을 찾지 못했어요. 모임장에게 코드를 한 번 더 확인해 봐요.')
    }
    run('INSERT OR IGNORE INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)', circle.id, u.id, now())
    return { id: circle.id }
  })

  /** 함께하는 사람: 모임장 → 공동 모임장 → 들어온 순서 */
  const membersOf = (circleId: string) =>
    all<{ id: string; nickname: string; role: 'owner' | 'co' | 'member' }>(
      `SELECT u.id, u.nickname,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ?
        ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 ELSE 2 END, m.joined_at, m.rowid`,
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
      id: circle.id, name: circle.name, intro: circle.intro, topic: circle.topic, topicAt: circle.topic_at, isOwner, isManager: circle.manager,
      code: circle.manager ? circle.code : undefined, preset: readPreset(circle.preset), members, posts,
    }
  })

  // 공동 모임장 정하기 · 풀기 (모임장만)
  on('PUT', '/groups/:id/members/:uid', (c) => {
    const u = me(c)
    const circle = ownerOf(c.params.id, u.id, '공동 모임장을 정할')
    if (c.params.uid === circle.owner_id) throw new HttpError(400, '모임장은 이미 모임을 꾸리고 있어요.')
    const role = c.body.role === 'co' ? 'co' : ''
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

  on('PUT', '/groups/:id/preset', (c) => {
    const u = me(c)
    if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, '모임장 · 공동 모임장만 나의 시간을 정할 수 있어요.')
    const preset = sanitizePreset(c.body.preset)
    run('UPDATE circles SET preset = ? WHERE id = ?', preset ? JSON.stringify(preset) : '', c.params.id)
    return { preset }
  })

  /* ───── 초대 링크 (/join/:code) ───── */

  const byCode = (c: Ctx) => {
    joinLimit.check(c.ip)
    const circle = one<{ id: string; name: string; intro: string; preset: string }>('SELECT id, name, intro, preset FROM circles WHERE code = ?', c.params.code.toUpperCase())
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
    return { name: circle.name, intro: circle.intro, preset: readPreset(circle.preset), joined, id: joined ? circle.id : undefined }
  })

  // 초대 링크로 들어가기. 로그인하지 않았다면 이름 + 생년월일로 바로 확인하고,
  // 처음 온 사람이면 { needSignup } 을 돌려준 뒤 별명 · 약관 동의를 더 받아 계정을 만든다.
  on('POST', '/invite/:code', (c) => {
    const circle = byCode(c)
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
    memberOf(c.params.id, u.id)
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
    run('INSERT INTO links VALUES (?, ?, ?, ?, ?)', code, c.user?.id ?? null, graphId, JSON.stringify(shared), now())
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

  on('GET', '/config', () => site())

  // 관리자는 사람 계정과 따로 간다 (아이디 · 비밀번호는 .env, 세션 8시간, 로그인 유지 없음).
  // 관리자는 운영에 필요할 때 모든 기록(회고 포함)을 볼 수 있고, 사이트 설정을 고칠 수 있다.
  const ADMIN_COOKIE = 'gb_admin'
  const same = (a: string, b: string) => timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)))
  const isAdmin = (req: IncomingMessage) => {
    const token = cookieOf(req, ADMIN_COOKIE)
    if (!opts.admin || !token) return false
    const row = one<{ expires_at: string }>('SELECT expires_at FROM admin_sessions WHERE token_hash = ?', sha(token))
    return !!row && row.expires_at > now()
  }
  const admin = (c: Ctx) => {
    if (!isAdmin(c.req)) throw new HttpError(401, '관리자 로그인이 필요해요.')
  }

  on('GET', '/admin/me', (c) => ({ enabled: !!opts.admin, admin: isAdmin(c.req) }))

  on('POST', '/admin/login', (c) => {
    if (!opts.admin) throw new HttpError(404, '관리자 기능이 꺼져 있어요. 서버의 .env 에 ADMIN_ID · ADMIN_PASSWORD 를 정해 주세요.')
    adminLimit.check(c.ip)
    adminAll.check('all')
    // 둘 다 비교한 뒤에 판단해서, 아이디만 맞는지 응답 시간으로 알 수 없게 한다
    const idOk = same(str(c.body.id, 100), opts.admin.id)
    const pwOk = same(str(c.body.password, 200), opts.admin.password)
    // 누가 관리자 화면에 들어왔는지 알 수 있게 IP · 브라우저 · 성공 여부를 남긴다 (최근 2000건)
    run('INSERT INTO admin_logins (ip, ok, agent, at) VALUES (?, ?, ?, ?)', c.ip, idOk && pwOk ? 1 : 0, str(c.req.headers['user-agent'], 300), now())
    run('DELETE FROM admin_logins WHERE id <= (SELECT MAX(id) - 2000 FROM admin_logins)')
    if (!idOk || !pwOk) {
      adminLimit.hit(c.ip)
      adminAll.hit('all')
      throw new HttpError(401, '관리자 아이디나 비밀번호가 맞지 않아요.')
    }
    adminLimit.reset(c.ip)
    const token = randomBytes(32).toString('base64url')
    run('DELETE FROM admin_sessions WHERE expires_at < ?', now())
    run('INSERT INTO admin_sessions VALUES (?, ?)', sha(token), new Date(Date.now() + 8 * HOUR).toISOString())
    setCookie(c.res, token, null, ADMIN_COOKIE)
  })

  on('POST', '/admin/logout', (c) => {
    const token = cookieOf(c.req, ADMIN_COOKIE)
    if (token) run('DELETE FROM admin_sessions WHERE token_hash = ?', sha(token))
    setCookie(c.res, '', 0, ADMIN_COOKIE)
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
        storage: storageOf(db, opts.backupDir ?? null),
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
    run('DELETE FROM users WHERE id = ?', c.params.id)
  })
  on('DELETE', '/admin/posts/:id', (c) => {
    admin(c)
    takeDown(c.params.id)
  })

  // 한 사람의 모든 것: 계정 정보 · 들어간 모임과 자리 · 모든 기록(회고 · 지금의 나 · 미래 편지 포함) · 모임에 나눈 것 · 공유 링크
  on('GET', '/admin/users/:id', (c) => {
    admin(c)
    const u = one<{ id: string; nickname: string; created_at: string; agreed_at: string; last_seen_at: string }>(
      'SELECT id, nickname, created_at, agreed_at, last_seen_at FROM users WHERE id = ?',
      c.params.id,
    )
    if (!u) throw new HttpError(404, '찾을 수 없어요.')
    return {
      id: u.id, nickname: u.nickname, createdAt: u.created_at, agreedAt: u.agreed_at, lastSeenAt: u.last_seen_at,
      sessions: one<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at >= ?', u.id, now())!.n,
      cheersGiven: one<{ n: number }>('SELECT COUNT(*) AS n FROM cheers WHERE user_id = ?', u.id)!.n,
      cheersReceived: one<{ n: number }>('SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ?', u.id)!.n,
      groups: all(
        `SELECT c.id, c.name, m.joined_at AS joinedAt,
                CASE WHEN c.owner_id = m.user_id THEN 'owner' WHEN m.role = 'co' THEN 'co' ELSE 'member' END AS role
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
      `SELECT l.id, l.ip, l.ok, l.agent, l.at, COALESCE(a.alias, '') AS alias
         FROM admin_logins l LEFT JOIN ip_aliases a ON a.ip = l.ip ORDER BY l.id DESC LIMIT 300`,
    ).map((r: any) => ({ ...r, ok: r.ok === 1 }))
  })
  on('PUT', '/admin/ip-aliases', (c) => {
    admin(c)
    const ip = str(c.body.ip, 64).trim()
    const alias = clean(c.body.alias).slice(0, 30)
    if (!ip) throw new HttpError(400, 'IP 를 읽지 못했어요.')
    if (alias) run('INSERT INTO ip_aliases VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET alias = excluded.alias', ip, alias)
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
        run("INSERT INTO meta VALUES ('auth_secret', ?)", secret)
        secretMissing = true
      }
      secret = readSecret()
      const n = (t: string) => one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n
      return { users: n('users'), graphs: n('graphs'), groups: n('circles'), before: basename(before), secretMissing }
    } finally {
      cleanup()
    }
  })

  on('GET', '/admin/groups/:id', (c) => {
    admin(c)
    const circle = one<{ id: string; name: string; intro: string; code: string; preset: string }>('SELECT * FROM circles WHERE id = ?', c.params.id)
    if (!circle) throw new HttpError(404, '찾을 수 없어요.')
    const posts = postsOf(circle.id).map(({ userId, ...p }) => p)
    const members = all<{ id: string; nickname: string; role: string; joinedAt: string }>(
      `SELECT u.id, u.nickname, m.joined_at AS joinedAt,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ? ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 ELSE 2 END, m.joined_at, m.rowid`,
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
    run("INSERT INTO meta VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(s))
    return s
  })
  on('DELETE', '/admin/settings', (c) => {
    admin(c)
    run("DELETE FROM meta WHERE key = 'site'")
    return envSite
  })

  return async (req: IncomingMessage, res: ServerResponse) => {
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
      if (req.method !== 'GET' && (req.headers['x-requested-with'] !== 'geuryeobom' || !(rawBody ? type === 'application/octet-stream' : type.startsWith('application/json')))) {
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
        send(500, { error: '잠시 문제가 생겼어요. 조금 뒤에 다시 해볼까요?' })
      }
    }
  }
}
