import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Node 24 내장 SQLite. import 대신 getBuiltinModule을 쓰는 건 번들러(vite)가 node:sqlite를 몰라서다.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')

export type Db = InstanceType<typeof DatabaseSync>

/** 그려봄의 DB 파일인지 (복원 전에, 아무 SQLite 파일로 덮어쓰지 않게). 열지 못하면 false. */
export function isOurDb(file: string): boolean {
  try {
    const d = new DatabaseSync(file, { readOnly: true })
    try {
      const names = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
      return ['meta', 'users', 'graphs'].every((n) => names.includes(n))
    } finally {
      d.close()
    }
  } catch {
    return false
  }
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  // v0.3.0(아이디+비밀번호) DB는 옮길 방법이 없다(생년월일이 없음). 조용히 지우지 않고 멈춘다.
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[]
  if (cols.some((c) => c.name === 'pw_hash')) {
    throw new Error(
      'v0.3.0 형식(비밀번호 로그인)의 DB예요. v0.4.0부터 이름+생년월일 로그인이라 그대로 쓸 수 없어요. ' +
        '미리보기 데이터라면 볼륨을 지우고 다시 시작해 주세요: docker compose down -v',
    )
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    -- 이름과 생년월일은 저장하지 않는다. login_key = HMAC(서버 비밀값, 이름|생년월일)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login_key TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graphs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS graphs_user ON graphs(user_id);

    -- 모임 (groups는 SQLite 예약어라 circles)
    CREATE TABLE IF NOT EXISTS circles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (circle_id, user_id)
    );
    -- 모임에 나눈 그래프. data는 공개용 SharedGraph만 담는다 (회고 없음)
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      graph_id TEXT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (circle_id, graph_id)
    );
    CREATE TABLE IF NOT EXISTS cheers (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (post_id, user_id, kind)
    );
  `)
  // 0.9.x 이전 DB: 응원에 보낸 시각 칸이 없었다. 지우지 않고 칸만 더한다.
  // 0.11.0: 약관 · 개인정보 처리방침에 동의한 시각 (예전 계정은 빈 칸)
  const userCols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[]
  if (!userCols.some((c) => c.name === 'agreed_at')) db.exec("ALTER TABLE users ADD COLUMN agreed_at TEXT NOT NULL DEFAULT ''")
  const cheerCols = db.prepare("SELECT name FROM pragma_table_info('cheers')").all() as { name: string }[]
  if (!cheerCols.some((c) => c.name === 'created_at')) db.exec("ALTER TABLE cheers ADD COLUMN created_at TEXT NOT NULL DEFAULT ''")
  // 0.12.0: 모임장이 미리 정한 ‘나의 시간’ (JSON, 없으면 빈 칸)
  const circleCols = db.prepare("SELECT name FROM pragma_table_info('circles')").all() as { name: string }[]
  if (!circleCols.some((c) => c.name === 'preset')) db.exec("ALTER TABLE circles ADD COLUMN preset TEXT NOT NULL DEFAULT ''")
  // 0.13.0: 모임 소개글 · 모임 글이 ‘무엇을 나눌지’(JSON PostOptions, 비면 예전 글이라 다시 만들지 않는다)
  if (!circleCols.some((c) => c.name === 'intro')) db.exec("ALTER TABLE circles ADD COLUMN intro TEXT NOT NULL DEFAULT ''")
  // 0.14.0: 공동 모임장 ('' = 함께하는 사람, 'co' = 공동 모임장. 모임장은 circles.owner_id)
  const memberCols = db.prepare("SELECT name FROM pragma_table_info('members')").all() as { name: string }[]
  if (!memberCols.some((c) => c.name === 'role')) db.exec("ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT ''")
  // 0.15.0: 짧은 공유 링크 · 관리자 접속 기록 · IP 별칭
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      code TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      graph_id TEXT REFERENCES graphs(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS links_graph ON links(graph_id);
    CREATE TABLE IF NOT EXISTS admin_logins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      ok INTEGER NOT NULL,
      agent TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ip_aliases (ip TEXT PRIMARY KEY, alias TEXT NOT NULL);
    -- 모임 활동 일정 (실험)
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_circle ON events(circle_id, day);
    -- 기관: 여러 모임을 묶고 담당자에게 모임 리포트만 모아 보여 준다 (실험). circle_ids · manager_ids 는 JSON 배열
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      circle_ids TEXT NOT NULL DEFAULT '[]',
      manager_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    -- 모임 활동 출석 (실험): 누가 참여했는지는 본인만, 모임장 · 기관 담당자는 인원 수만
    CREATE TABLE IF NOT EXISTS attendance (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );
    -- 서버 오류 기록 (실험): 누가 보냈는지는 남기지 않는다
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT NOT NULL DEFAULT ''
    );
    -- 관리자 활동 기록 (누가 언제 무엇을 열람 · 지웠는지 · 실험)
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      ip TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT ''
    );
  `)
  const postCols = db.prepare("SELECT name FROM pragma_table_info('posts')").all() as { name: string }[]
  if (!postCols.some((c) => c.name === 'options')) db.exec("ALTER TABLE posts ADD COLUMN options TEXT NOT NULL DEFAULT ''")
  // 0.16.0: 마지막으로 다녀간 시각 (관리자 현황용, 10분 단위로만 갱신. 예전 계정은 빈 칸)
  // 만 14세 미만 보호자 동의 (개발 테스트 서버의 실험 기능): {relation, contact, at} JSON
  if (!userCols.some((c) => c.name === 'guardian')) db.exec("ALTER TABLE users ADD COLUMN guardian TEXT NOT NULL DEFAULT ''")
  if (!userCols.some((c) => c.name === 'last_seen_at')) db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''")
  // 0.17.0: 모임의 ‘함께 그릴 주제’ · 오늘의 질문에 남긴 한 줄 · 모임 글 신고
  // 모임 소식 (모임장 · 공동 모임장이 모임 사람들에게 · 실험)
  if (!circleCols.some((c) => c.name === 'news')) db.exec("ALTER TABLE circles ADD COLUMN news TEXT NOT NULL DEFAULT ''")
  if (!circleCols.some((c) => c.name === 'news_at')) db.exec("ALTER TABLE circles ADD COLUMN news_at TEXT NOT NULL DEFAULT ''")
  if (!circleCols.some((c) => c.name === 'topic')) db.exec("ALTER TABLE circles ADD COLUMN topic TEXT NOT NULL DEFAULT ''")
  if (!circleCols.some((c) => c.name === 'topic_at')) db.exec("ALTER TABLE circles ADD COLUMN topic_at TEXT NOT NULL DEFAULT ''")
  db.exec(`
    CREATE TABLE IF NOT EXISTS answers (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      question TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, day)
    );
    -- 신고: 글이 내려가도 무엇을 신고했는지 남도록 제목 · 나눈 사람 · 모임 이름을 함께 적어 둔다
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
      circle_id TEXT REFERENCES circles(id) ON DELETE SET NULL,
      reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      post_title TEXT NOT NULL DEFAULT '',
      post_owner TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(post_id, reporter_id);
  `)
  // 1.0.0: 신고 기록 지우기(사유를 남기고 숨김) · 모임장 / 운영자가 내린 글(고치면 바로 다시 나눈다)
  const reportCols = db.prepare("SELECT name FROM pragma_table_info('reports')").all() as { name: string }[]
  if (!reportCols.some((c) => c.name === 'deleted_at')) db.exec("ALTER TABLE reports ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''")
  if (!reportCols.some((c) => c.name === 'delete_reason')) db.exec("ALTER TABLE reports ADD COLUMN delete_reason TEXT NOT NULL DEFAULT ''")
  db.exec(`
    CREATE TABLE IF NOT EXISTS takedowns (
      circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      graph_id TEXT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      options TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL,
      PRIMARY KEY (circle_id, graph_id)
    );
    CREATE INDEX IF NOT EXISTS takedowns_graph ON takedowns(graph_id);
  `)
  // 0.19.0: 오늘의 한 줄에 고른 마음 색 (예전 한 줄은 빈 칸)
  const answerCols = db.prepare("SELECT name FROM pragma_table_info('answers')").all() as { name: string }[]
  if (!answerCols.some((c) => c.name === 'color')) db.exec("ALTER TABLE answers ADD COLUMN color TEXT NOT NULL DEFAULT ''")
  // 실험(labs-5): 모임 끝내기(보관) · 기관 담당자 초대 링크 · 개인정보 처리 요청 대장
  const circleCols2 = db.prepare("SELECT name FROM pragma_table_info('circles')").all() as { name: string }[]
  if (!circleCols2.some((c) => c.name === 'closed_at')) db.exec("ALTER TABLE circles ADD COLUMN closed_at TEXT NOT NULL DEFAULT ''")
  const orgCols = db.prepare("SELECT name FROM pragma_table_info('orgs')").all() as { name: string }[]
  if (!orgCols.some((c) => c.name === 'invite')) db.exec("ALTER TABLE orgs ADD COLUMN invite TEXT NOT NULL DEFAULT ''")
  db.exec(`
    -- 열람 · 정정 · 삭제 · 처리정지 요청 (개인정보 보호법: 10일 안에 답한다). 메일 · 전화로 받은 것을 운영자가 적는다
    CREATE TABLE IF NOT EXISTS privacy_requests (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      who TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '받음',
      done_at TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
  `)
  // 실험(labs-6): 그래프 지난 모습 · 모임 질문 묶음 · 관리자 계정 여러 개 · 보안 정책(CSP) 위반 보고
  const circleCols3 = db.prepare("SELECT name FROM pragma_table_info('circles')").all() as { name: string }[]
  if (!circleCols3.some((c) => c.name === 'question_set')) db.exec("ALTER TABLE circles ADD COLUMN question_set TEXT NOT NULL DEFAULT ''")
  // 실험(11차): 모임장이 정한 질문 (GroupPrompts JSON, 비면 기본)
  if (!circleCols3.some((c) => c.name === 'prompts')) db.exec("ALTER TABLE circles ADD COLUMN prompts TEXT NOT NULL DEFAULT ''")
  const colsOf = (t: string) => (db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name)
  if (!colsOf('admin_sessions').includes('who')) db.exec("ALTER TABLE admin_sessions ADD COLUMN who TEXT NOT NULL DEFAULT ''")
  if (!colsOf('admin_sessions').includes('role')) db.exec("ALTER TABLE admin_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'")
  if (!colsOf('admin_logins').includes('who')) db.exec("ALTER TABLE admin_logins ADD COLUMN who TEXT NOT NULL DEFAULT ''")
  if (!colsOf('admin_audit').includes('who')) db.exec("ALTER TABLE admin_audit ADD COLUMN who TEXT NOT NULL DEFAULT ''")
  db.exec(`
    -- 고칠 때마다 남는 그래프의 지난 모습 (10분에 하나, 그래프마다 최근 20개)
    CREATE TABLE IF NOT EXISTS graph_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS graph_versions_graph ON graph_versions(graph_id, id);
    -- .env 의 관리자 말고 더 둔 관리자 (full: 바꾸기까지 · viewer: 보기만). 비밀번호는 scrypt
    CREATE TABLE IF NOT EXISTS admin_accounts (
      id TEXT PRIMARY KEY,
      pw_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    -- 브라우저가 보낸 보안 정책 위반 보고 (같은 것은 묶어 횟수만). 주소의 코드 · 토큰은 가린다
    CREATE TABLE IF NOT EXISTS csp_reports (
      key TEXT PRIMARY KEY,
      directive TEXT NOT NULL,
      blocked TEXT NOT NULL,
      page TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 1,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL
    );
  `)
  // 실험(labs-7): 문의함 · 시간대별 접속 · 파기 기록
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      nickname TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '새 문의',
      note TEXT NOT NULL DEFAULT '',
      done_at TEXT NOT NULL DEFAULT ''
    );
    -- 요일(0=일) · 시(한국 시간)마다 다녀간 횟수 (로그인한 사람이 10분에 한 번 세짐, 누구인지는 남기지 않는다)
    CREATE TABLE IF NOT EXISTS visit_hours (
      dow INTEGER NOT NULL,
      hour INTEGER NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dow, hour)
    );
    -- 지운 기록의 건수만 (탈퇴 · 휴면 정리 · 관리자 지움). 누구인지는 남기지 않는다
    CREATE TABLE IF NOT EXISTS purge_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      count INTEGER NOT NULL
    );
  `)
  // 실험(labs-8): 문의 답 (이용자가 ‘내 문의’ 에서 본다) · 탈퇴하면 문의도 함께 지운다 · 기관 연결 코드
  const inqCols = db.prepare("SELECT name FROM pragma_table_info('inquiries')").all() as { name: string }[]
  if (!inqCols.some((c) => c.name === 'answer')) db.exec("ALTER TABLE inquiries ADD COLUMN answer TEXT NOT NULL DEFAULT ''")
  if (!inqCols.some((c) => c.name === 'answered_at')) db.exec("ALTER TABLE inquiries ADD COLUMN answered_at TEXT NOT NULL DEFAULT ''")
  db.exec(`CREATE TRIGGER IF NOT EXISTS inquiries_with_user BEFORE DELETE ON users BEGIN DELETE FROM inquiries WHERE user_id = OLD.id; END;`)
  const orgCols2 = db.prepare("SELECT name FROM pragma_table_info('orgs')").all() as { name: string }[]
  if (!orgCols2.some((c) => c.name === 'code')) db.exec("ALTER TABLE orgs ADD COLUMN code TEXT NOT NULL DEFAULT ''")
  // 0.18.0: 오래 쓰면 느려지는 곳 — 계정 지우기(CASCADE) · 모임 글 · 로그인 정리가 표 전체를 훑지 않게
  db.exec(`
    CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
    CREATE INDEX IF NOT EXISTS posts_circle ON posts(circle_id, created_at);
    CREATE INDEX IF NOT EXISTS posts_graph ON posts(graph_id);
    CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id);
    CREATE INDEX IF NOT EXISTS cheers_user ON cheers(user_id);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS links_user ON links(user_id);
    CREATE INDEX IF NOT EXISTS reports_reporter ON reports(reporter_id);
  `)
  return db
}

const AUTO = /^auto-\d{4}-\d{2}-\d{2}(-\d{2})?\.db$/
/** 이름 속 때 (하루 백업은 그날 00시로) — 새것부터 줄 세울 때 */
const whenOf = (f: string) => f.replace(/^auto-(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?\.db$/, (_, d: string, h?: string) => `${d}-${h ?? '00'}`)
/**
 * 손질 (한 시간마다): 끝난 로그인 지우기, 통계 손보기, WAL 합치기, 자동 백업(folder 에 한 시간에 하나 · 최근 keep 개).
 * 서비스를 멈추지 않는다. folder 가 없거나 keep = 0 이면 자동 백업은 하지 않는다.
 * 파일 이름은 한국 시간: auto-2026-11-06-09.db (예전 하루 백업 auto-2026-11-06.db 도 함께 센다)
 */
export function maintain(db: Db, folder: string | null, keep: number, now = new Date()): string | null {
  const iso = now.toISOString()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(iso)
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(iso)
  db.exec('PRAGMA optimize')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  if (!folder || keep <= 0) return null
  mkdirSync(folder, { recursive: true })
  const k = new Date(now.getTime() + 9 * 3600_000).toISOString()
  const file = join(folder, `auto-${k.slice(0, 10)}-${k.slice(11, 13)}.db`)
  if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  // 새것부터 keep 개만 (같은 날의 하루 백업 · 시간 백업이 섞여도 만든 때 순서로)
  readdirSync(folder).filter((f) => AUTO.test(f)).sort((a, b) => whenOf(b).localeCompare(whenOf(a)))
    .slice(keep).forEach((f) => rmSync(join(folder, f), { force: true }))
  return file
}

/** 자동 백업을 남길 개수: 관리자 화면에서 정한 값(meta) > .env 의 BACKUP_KEEP */
export function backupKeepOf(db: Db, fallback: number): number {
  const v = (db.prepare("SELECT value FROM meta WHERE key = 'backup_keep'").get() as { value: string } | undefined)?.value
  return v === undefined ? fallback : Math.max(0, Math.min(2000, Math.floor(Number(v)) || 0))
}

/** 자동 백업 파일들 (새것 먼저) */
export function listBackups(folder: string | null) {
  if (!folder || !existsSync(folder)) return []
  return readdirSync(folder).filter((f) => AUTO.test(f)).sort((a, b) => whenOf(b).localeCompare(whenOf(a)))
    .map((f) => ({ name: f.slice(0, -3), size: statSync(join(folder, f)).size, at: statSync(join(folder, f)).mtime.toISOString() }))
}

/** DB 와 자동 백업이 차지하는 크기 (바이트) */
export function storageOf(db: Db, folder: string | null) {
  const page = db.prepare('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()').get() as { n: number }
  const files = folder && existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.db')).sort() : []
  return { db: page.n, backups: files.length, backupBytes: files.reduce((n, f) => n + statSync(join(folder!, f)).size, 0), latest: files.at(-1) ?? null }
}
