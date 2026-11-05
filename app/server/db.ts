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
  `)
  const postCols = db.prepare("SELECT name FROM pragma_table_info('posts')").all() as { name: string }[]
  if (!postCols.some((c) => c.name === 'options')) db.exec("ALTER TABLE posts ADD COLUMN options TEXT NOT NULL DEFAULT ''")
  // 0.16.0: 마지막으로 다녀간 시각 (관리자 현황용, 10분 단위로만 갱신. 예전 계정은 빈 칸)
  if (!userCols.some((c) => c.name === 'last_seen_at')) db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''")
  // 0.17.0: 모임의 ‘함께 그릴 주제’ · 오늘의 질문에 남긴 한 줄 · 모임 글 신고
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

/**
 * 하루 한 번 손질: 끝난 로그인 지우기, 통계 손보기, WAL 합치기, 자동 백업(dir/backups, 최근 keep 개).
 * 서비스를 멈추지 않는다. keep = 0 이면 자동 백업은 하지 않는다.
 */
export function maintain(db: Db, dir: string | null, keep: number, now = new Date()): string | null {
  const iso = now.toISOString()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(iso)
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(iso)
  db.exec('PRAGMA optimize')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  if (!dir || keep <= 0) return null
  const folder = join(dir, 'backups')
  mkdirSync(folder, { recursive: true })
  const file = join(folder, `auto-${iso.slice(0, 10)}.db`)
  if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  readdirSync(folder).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep).forEach((f) => rmSync(join(folder, f), { force: true }))
  return file
}

/** DB 와 자동 백업이 차지하는 크기 (바이트) */
export function storageOf(db: Db, dir: string | null) {
  const page = db.prepare('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()').get() as { n: number }
  const folder = dir ? join(dir, 'backups') : null
  const files = folder && existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.db')).sort() : []
  return { db: page.n, backups: files.length, backupBytes: files.reduce((n, f) => n + statSync(join(folder!, f)).size, 0), latest: files.at(-1) ?? null }
}
