import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
// src/content.ts
/** 모임 응원은 정해진 말만. 자유 글은 상처가 되는 말이 오갈 수 있어 열어두지 않는다. */
var CHEERS = [
	"응원해요",
	"공감해요",
	"고마워요",
	"함께할게요"
];
/** 마음 색: 오늘의 한 줄에 고르는 오늘의 색. 달력과 연말 돌아보기를 물들인다. */
var MOOD_COLORS = [
	{
		key: "sun",
		name: "햇살",
		hex: "#F2C46D"
	},
	{
		key: "peach",
		name: "설렘",
		hex: "#EFA38E"
	},
	{
		key: "ember",
		name: "뜨거움",
		hex: "#D9776A"
	},
	{
		key: "leaf",
		name: "잔잔",
		hex: "#9EC5AE"
	},
	{
		key: "sky",
		name: "맑음",
		hex: "#94BEDF"
	},
	{
		key: "lilac",
		name: "몽글",
		hex: "#C3AEE2"
	},
	{
		key: "cloud",
		name: "흐림",
		hex: "#B5ACA5"
	},
	{
		key: "night",
		name: "깊음",
		hex: "#6D7EA8"
	}
];
// src/store.ts
/** 과거 → 현재 순서. 같은 시점이면 적은 순서를 유지한다. */
var sortEntries = (entries) => [...entries].sort((a, b) => a.timePoint - b.timePoint);
var graphTitle = (g) => g.title.trim() || "나의 작은 인생 이야기";
// src/share.ts
function toShared(g, o) {
	const span = Math.max(1, g.currentPoint - g.startPoint);
	return {
		v: 1,
		title: o.title.trim().slice(0, 40),
		timeScale: g.timeScale,
		showTime: o.time,
		tone: g.lineColor,
		startPoint: o.time ? g.startPoint : 0,
		currentPoint: o.time ? g.currentPoint : 100,
		entries: sortEntries(g.entries.filter((e) => o.entryIds.has(e.id))).map((e) => ({
			title: e.title,
			emotionLabel: e.emotionLabel,
			emotionScore: e.emotionScore,
			timePoint: o.time ? e.timePoint : Math.round((e.timePoint - g.startPoint) / span * 100),
			description: o.descriptions ? e.description : ""
		}))
	};
}
/** 모임에서 그린 그래프가 완성되면 저절로 나눌 때: 보이는 순간 · 시점 · 설명 (회고는 언제나 빠진다) */
var GROUP_POST = {
	title: "",
	entryIds: null,
	descriptions: true,
	time: true
};
var postShared = (g, o) => toShared(g, {
	title: o.title || graphTitle(g),
	entryIds: new Set(o.entryIds ?? g.entries.filter((e) => e.showOnGraph).map((e) => e.id)),
	descriptions: o.descriptions,
	time: o.time
});
function sanitizePostOptions(raw) {
	if (!raw || typeof raw !== "object") return null;
	const ids = raw.entryIds === null ? null : Array.isArray(raw.entryIds) ? raw.entryIds.slice(0, 100).map((x) => str$1(x, 64)) : void 0;
	if (ids === void 0) return null;
	return {
		title: str$1(raw.title, 40).trim(),
		entryIds: ids,
		descriptions: raw.descriptions === true,
		time: raw.time === true
	};
}
var str$1 = (x, max) => typeof x === "string" ? x.slice(0, max) : "";
var num$1 = (x, min, max, per = 1) => typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x * per) / per)) : null;
/** 공유 데이터 검증. 링크를 열 때와 서버가 모임 글을 받을 때 같이 쓴다. 정해진 필드 말고는 모두 버린다. */
function sanitizeShared(raw) {
	try {
		if (raw?.v !== 1 || !Array.isArray(raw.entries)) return null;
		const startPoint = num$1(raw.startPoint, 0, 4e4);
		const currentPoint = num$1(raw.currentPoint, 0, 4e4);
		if (startPoint === null || currentPoint === null || startPoint > currentPoint) return null;
		return {
			v: 1,
			title: str$1(raw.title, 40),
			timeScale: raw.timeScale === "year" || raw.timeScale === "month" ? raw.timeScale : "age",
			showTime: raw.showTime === true,
			...[
				"rose",
				"sage",
				"sand",
				"lilac"
			].includes(raw.tone) ? { tone: raw.tone } : {},
			startPoint,
			currentPoint,
			entries: raw.entries.slice(0, 60).flatMap((e) => {
				const timePoint = num$1(e?.timePoint, startPoint, currentPoint, 1e3);
				const emotionScore = num$1(e?.emotionScore, -5, 5);
				if (timePoint === null || emotionScore === null) return [];
				return [{
					title: str$1(e.title, 40),
					timePoint,
					emotionScore,
					emotionLabel: str$1(e.emotionLabel, 12),
					description: str$1(e.description, 300)
				}];
			})
		};
	} catch {
		return null;
	}
}
// server/config.ts
var isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 80;
/** http(s) 주소면 정리한 주소, 아니면 null */
function httpUrl(s) {
	try {
		const u = new URL(s);
		return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
	} catch {
		return null;
	}
}
/** 환경변수(.env)를 읽어 검증한다. 잘못된 값은 끄고 경고를 남긴다(서버는 계속 뜬다). */
function readConfig(env) {
	const warnings = [];
	const v = (k) => env[k]?.trim() || "";
	let admin = null;
	const id = v("ADMIN_ID");
	const password = env.ADMIN_PASSWORD ?? "";
	if (id || password) {
		if (!id || !password) warnings.push("ADMIN_ID 와 ADMIN_PASSWORD 를 둘 다 정해야 관리자 기능이 켜져요.");
		else if (password.length < 12) warnings.push("ADMIN_PASSWORD 는 12자 이상이어야 해요. 관리자 기능을 꺼 둘게요.");
		else admin = {
			id,
			password
		};
	}
	let publicUrl = null;
	if (v("PUBLIC_URL")) try {
		const u = new URL(v("PUBLIC_URL"));
		if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
		publicUrl = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
		if (u.protocol === "http:") warnings.push("PUBLIC_URL 이 http 예요. 정식 운영에서는 https 주소를 써 주세요.");
	} catch {
		warnings.push(`PUBLIC_URL 형식이 올바르지 않아요: ${v("PUBLIC_URL")} (예: https://geuryeobom.kr)`);
	}
	const link = (k) => {
		if (!v(k)) return "";
		const u = httpUrl(v(k));
		if (u) return u;
		warnings.push(`${k} 는 https:// 로 시작하는 주소여야 해요.`);
		return "";
	};
	const contact = v("DEV_CONTACT");
	const developer = {
		name: v("DEV_NAME").slice(0, 40),
		org: v("DEV_ORG").slice(0, 60),
		contact: isEmail(contact) ? contact : link("DEV_CONTACT"),
		url: link("DEV_URL")
	};
	let privacy = v("PRIVACY_CONTACT");
	if (privacy && !isEmail(privacy)) {
		warnings.push(`PRIVACY_CONTACT 는 이메일 주소여야 해요: ${privacy} (예: privacy@example.kr)`);
		privacy = "";
	}
	const authSecret = v("AUTH_SECRET") || void 0;
	if (authSecret && authSecret.length < 32) warnings.push("AUTH_SECRET 은 32자 이상의 무작위 값을 권장해요.");
	if (!authSecret) warnings.push("AUTH_SECRET 이 비어 있어 로그인 비밀값을 DB 에 저장해요. DB 백업이 새면 이름 · 생일이 드러날 수 있으니 .env 에 정해 주세요 (openssl rand -hex 32). 이미 운영 중이면 지금 DB 에 있는 값을 그대로 옮겨 적어야 해요.");
	return {
		dbFile: v("DB_FILE") || "./data/geuryeobom.db",
		port: Number(v("PORT")) || 3e3,
		backupKeep: v("BACKUP_KEEP") === "" ? 7 : Math.max(0, Math.min(365, Math.floor(Number(v("BACKUP_KEEP")) || 0))),
		secureCookie: v("COOKIE_SECURE") !== "false",
		authSecret,
		admin,
		publicUrl,
		developer: Object.values(developer).some(Boolean) ? developer : null,
		operator: v("SERVICE_OPERATOR") || privacy ? {
			name: v("SERVICE_OPERATOR").slice(0, 60),
			contact: privacy
		} : null,
		warnings
	};
}
// server/db.ts
var { DatabaseSync } = process.getBuiltinModule("node:sqlite");
/** 그려봄의 DB 파일인지 (복원 전에, 아무 SQLite 파일로 덮어쓰지 않게). 열지 못하면 false. */
function isOurDb(file) {
	try {
		const d = new DatabaseSync(file, { readOnly: true });
		try {
			const names = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
			return [
				"meta",
				"users",
				"graphs"
			].every((n) => names.includes(n));
		} finally {
			d.close();
		}
	} catch {
		return false;
	}
}
function openDb(file) {
	const db = new DatabaseSync(file);
	if (db.prepare("SELECT name FROM pragma_table_info('users')").all().some((c) => c.name === "pw_hash")) throw new Error("v0.3.0 형식(비밀번호 로그인)의 DB예요. v0.4.0부터 이름+생년월일 로그인이라 그대로 쓸 수 없어요. 미리보기 데이터라면 볼륨을 지우고 다시 시작해 주세요: docker compose down -v");
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
  `);
	const userCols = db.prepare("SELECT name FROM pragma_table_info('users')").all();
	if (!userCols.some((c) => c.name === "agreed_at")) db.exec("ALTER TABLE users ADD COLUMN agreed_at TEXT NOT NULL DEFAULT ''");
	if (!db.prepare("SELECT name FROM pragma_table_info('cheers')").all().some((c) => c.name === "created_at")) db.exec("ALTER TABLE cheers ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
	const circleCols = db.prepare("SELECT name FROM pragma_table_info('circles')").all();
	if (!circleCols.some((c) => c.name === "preset")) db.exec("ALTER TABLE circles ADD COLUMN preset TEXT NOT NULL DEFAULT ''");
	if (!circleCols.some((c) => c.name === "intro")) db.exec("ALTER TABLE circles ADD COLUMN intro TEXT NOT NULL DEFAULT ''");
	if (!db.prepare("SELECT name FROM pragma_table_info('members')").all().some((c) => c.name === "role")) db.exec("ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT ''");
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
  `);
	if (!db.prepare("SELECT name FROM pragma_table_info('posts')").all().some((c) => c.name === "options")) db.exec("ALTER TABLE posts ADD COLUMN options TEXT NOT NULL DEFAULT ''");
	if (!userCols.some((c) => c.name === "last_seen_at")) db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''");
	if (!circleCols.some((c) => c.name === "topic")) db.exec("ALTER TABLE circles ADD COLUMN topic TEXT NOT NULL DEFAULT ''");
	if (!circleCols.some((c) => c.name === "topic_at")) db.exec("ALTER TABLE circles ADD COLUMN topic_at TEXT NOT NULL DEFAULT ''");
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
  `);
	const reportCols = db.prepare("SELECT name FROM pragma_table_info('reports')").all();
	if (!reportCols.some((c) => c.name === "deleted_at")) db.exec("ALTER TABLE reports ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
	if (!reportCols.some((c) => c.name === "delete_reason")) db.exec("ALTER TABLE reports ADD COLUMN delete_reason TEXT NOT NULL DEFAULT ''");
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
  `);
	if (!db.prepare("SELECT name FROM pragma_table_info('answers')").all().some((c) => c.name === "color")) db.exec("ALTER TABLE answers ADD COLUMN color TEXT NOT NULL DEFAULT ''");
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
  `);
	return db;
}
/**
* 하루 한 번 손질: 끝난 로그인 지우기, 통계 손보기, WAL 합치기, 자동 백업(dir/backups, 최근 keep 개).
* 서비스를 멈추지 않는다. keep = 0 이면 자동 백업은 하지 않는다.
*/
function maintain(db, dir, keep, now = /* @__PURE__ */ new Date()) {
	const iso = now.toISOString();
	db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(iso);
	db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(iso);
	db.exec("PRAGMA optimize");
	db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	if (!dir || keep <= 0) return null;
	const folder = join(dir, "backups");
	mkdirSync(folder, { recursive: true });
	const file = join(folder, `auto-${iso.slice(0, 10)}.db`);
	if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
	readdirSync(folder).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep).forEach((f) => rmSync(join(folder, f), { force: true }));
	return file;
}
/** DB 와 자동 백업이 차지하는 크기 (바이트) */
function storageOf(db, dir) {
	const page = db.prepare("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()").get();
	const folder = dir ? join(dir, "backups") : null;
	const files = folder && existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".db")).sort() : [];
	return {
		db: page.n,
		backups: files.length,
		backupBytes: files.reduce((n, f) => n + statSync(join(folder, f)).size, 0),
		latest: files.at(-1) ?? null
	};
}
// server/app.ts
var HttpError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
	}
};
var COOKIE = "gb_session";
var HOUR = 36e5;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var newId = () => randomBytes(12).toString("base64url");
var sha = (s) => createHash("sha256").update(s).digest("hex");
var str = (x, max) => typeof x === "string" ? x.slice(0, max) : "";
var num = (x) => typeof x === "number" && Number.isFinite(x) ? x : 0;
var int = (x) => Math.round(num(x));
var clean = (x) => str(x, 200).replace(/[\u0000-\u001f\u007f]/g, "").trim();
/** 여러 줄 글(모임 소개): 줄바꿈만 남기고 제어 문자는 뺀다 */
var cleanText = (x, max) => str(x, max).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
/** 모임 이름(1~30자) · 소개글(200자까지) */
function groupInfo(b) {
	const name = clean(b.name);
	if (name.length < 1 || name.length > 30) throw new HttpError(400, "모임 이름은 1~30자로 정해 주세요.");
	return {
		name,
		intro: cleanText(b.intro, 200)
	};
}
/** 이름 비교용: 띄어쓰기 · 대소문자 차이는 같은 이름으로 본다 */
var normName = (x) => clean(x).normalize("NFC").replace(/\s+/g, "").toLowerCase();
/** 생년월일 8자리(YYYYMMDD) 검증. 실제 있는 날짜이고 오늘 이전이어야 한다. */
function validBirth(x) {
	const s = str(x, 8);
	if (!/^\d{8}$/.test(s)) return null;
	const [y, m, d] = [
		+s.slice(0, 4),
		+s.slice(4, 6),
		+s.slice(6, 8)
	];
	const date = new Date(Date.UTC(y, m - 1, d));
	if (y < 1900 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || date > /* @__PURE__ */ new Date()) return null;
	return s;
}
var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(31)]).join("");
var LINK_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var newLinkCode = () => Array.from({ length: 8 }, () => LINK_CHARS[randomInt(56)]).join("");
/** 신고 까닭: 놀림 · 괴롭힘 / 개인정보 / 위험해 보여요(도움이 필요해 보임) / 그 밖에 */
var REPORT_REASONS = [
	"hurt",
	"privacy",
	"danger",
	"other"
];
/** 웹 복원 때 백업에서 옮길 표. 관리자 세션 · 관리자 접속 기록은 지금 것을 그대로 둔다. */
var RESTORE_TABLES = [
	"meta",
	"users",
	"sessions",
	"graphs",
	"circles",
	"members",
	"posts",
	"cheers",
	"links",
	"ip_aliases",
	"answers",
	"reports",
	"takedowns"
];
/** 핸들러가 응답을 직접 썼을 때 (파일 내려받기) */
var RAW = Symbol("raw");
/** 저장할 그래프 검증. 내 기록이라도 정해진 모양 말고는 받지 않는다. */
function sanitizeGraph(raw, id) {
	if (!raw || typeof raw !== "object" || raw.id !== id) throw new HttpError(400, "기록을 읽지 못했어요.");
	const r = raw.currentReflection ?? {};
	const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, 100) : [];
	return {
		id,
		title: str(raw.title, 40),
		timeScale: raw.timeScale === "year" || raw.timeScale === "month" ? raw.timeScale : "age",
		...raw.monthRange === "recent12" || raw.monthRange === "thisYear" ? { monthRange: raw.monthRange } : {},
		...[
			"rose",
			"sage",
			"sand",
			"lilac"
		].includes(raw.lineColor) ? { lineColor: raw.lineColor } : {},
		startPoint: int(raw.startPoint),
		currentPoint: int(raw.currentPoint),
		visibility: raw.visibility === "link" ? "link" : "private",
		...str(raw.groupId, 64) ? { groupId: str(raw.groupId, 64) } : {},
		entries: entries.map((e) => ({
			id: str(e?.id, 64) || newId(),
			title: str(e?.title, 40),
			timePoint: Math.round(num(e?.timePoint) * 1e3) / 1e3,
			description: str(e?.description, 300),
			emotionScore: Math.min(5, Math.max(-5, int(e?.emotionScore))),
			emotionLabel: str(e?.emotionLabel, 12),
			reflection: {
				feeling: str(e?.reflection?.feeling, 1e3),
				why: str(e?.reflection?.why, 1e3),
				now: str(e?.reflection?.now, 1e3),
				toPast: str(e?.reflection?.toPast, 1e3),
				fromPast: str(e?.reflection?.fromPast, 1e3)
			},
			showOnGraph: e?.showOnGraph !== false
		})),
		currentReflection: {
			changed: str(r.changed, 1e3),
			word: str(r.word, 60),
			influence: str(r.influence, 1e3),
			message: str(r.message, 1e3),
			oneLine: str(r.oneLine, 60)
		},
		...str(raw.futureLetter?.text, 500).trim() && !Number.isNaN(Date.parse(str(raw.futureLetter?.openAt, 40))) ? { futureLetter: {
			text: str(raw.futureLetter.text, 500).trim(),
			openAt: new Date(raw.futureLetter.openAt).toISOString(),
			writtenAt: str(raw.futureLetter.writtenAt, 40) || now()
		} } : {},
		...str(raw.redrawOf, 64) ? { redrawOf: str(raw.redrawOf, 64) } : {},
		completed: raw.completed === true,
		createdAt: str(raw.createdAt, 40) || now(),
		updatedAt: now()
	};
}
/** 모임장이 정한 ‘나의 시간’ 검증. null 은 ‘정하지 않음’. */
function sanitizePreset(raw) {
	if (raw === null) return null;
	const choice = [
		"age",
		"year",
		"recent12",
		"thisYear"
	].find((k) => k === raw?.choice);
	const start = int(raw?.start), end = int(raw?.end), year = (/* @__PURE__ */ new Date()).getFullYear();
	const ok = choice === "age" ? start >= 0 && end <= 120 && start < end : choice === "year" ? start >= 1900 && end <= year && start < end : choice === "recent12" ? end >= 22800 && end <= year * 12 + 11 : choice === "thisYear";
	if (!choice || !ok) throw new HttpError(400, "나의 시간을 한 번 더 확인해 주세요.");
	return {
		choice,
		start,
		end,
		title: clean(raw.title).slice(0, 40)
	};
}
var readPreset = (s) => s ? JSON.parse(s) : null;
/** 실패 횟수 제한 (로그인 · 가입 · 모임 코드 맞히기 방지). ponytail: 메모리 기반이라 서버 1대 기준. */
function limiter(max, windowMs) {
	const hits = /* @__PURE__ */ new Map();
	return {
		check(key) {
			const h = hits.get(key);
			if (h && h.until > Date.now() && h.n >= max) throw new HttpError(429, "잠시 쉬었다가 다시 해볼까요? (조금 뒤에 다시 시도할 수 있어요)");
		},
		hit(key) {
			if (hits.size > 2e4) {
				for (const [k, v] of hits) if (v.until < Date.now()) hits.delete(k);
			}
			const h = hits.get(key);
			if (!h || h.until < Date.now()) hits.set(key, {
				n: 1,
				until: Date.now() + windowMs
			});
			else h.n++;
		},
		reset: (key) => hits.delete(key)
	};
}
/** 본문을 그대로 (DB 복원 파일). 너무 크면 멈춘다. */
async function readRaw(req, max) {
	const chunks = [];
	let size = 0;
	for await (const ch of req) {
		size += ch.length;
		if (size > max) throw new HttpError(413, `파일이 너무 커요 (${Math.round(max / 1024 / 1024)}MB 까지).`);
		chunks.push(ch);
	}
	return Buffer.concat(chunks);
}
async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const ch of req) {
		size += ch.length;
		if (size > 2e6) throw new HttpError(413, "내용이 너무 길어요.");
		chunks.push(ch);
	}
	if (!size) return {};
	try {
		const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return v && typeof v === "object" ? v : {};
	} catch {
		throw new HttpError(400, "요청을 읽지 못했어요.");
	}
}
/** 관리자가 고친 사이트 설정 검증. 화면에 그대로 보이므로 길이를 자르고, 주소는 http(s) · 문의처는 이메일만. */
function sanitizeSite(b) {
	const t = (x, max) => clean(x).slice(0, max);
	const bad = (msg) => {
		throw new HttpError(400, msg);
	};
	const url = (x, what) => {
		const s = t(x, 200);
		return s ? httpUrl(s) ?? bad(`${what}는 https:// 로 시작하는 주소로 적어 주세요.`) : "";
	};
	const publicUrl = url(b?.publicUrl, "공유 주소").replace(/\/+$/, "") || null;
	const dc = t(b?.developer?.contact, 200);
	const developer = {
		name: t(b?.developer?.name, 40),
		org: t(b?.developer?.org, 60),
		contact: !dc ? "" : isEmail(dc) ? dc : url(dc, "만든 사람 연락처"),
		url: url(b?.developer?.url, "저장소 주소")
	};
	const oc = t(b?.operator?.contact, 80);
	if (oc && !isEmail(oc)) bad("문의처는 이메일 주소로 적어 주세요. 예) privacy@example.kr");
	const operator = {
		name: t(b?.operator?.name, 60),
		contact: oc
	};
	return {
		publicUrl,
		developer: Object.values(developer).some(Boolean) ? developer : null,
		operator: operator.name || operator.contact ? operator : null
	};
}
function createApp(db, opts) {
	const one = (sql, ...p) => db.prepare(sql).get(...p);
	const all = (sql, ...p) => db.prepare(sql).all(...p);
	const run = (sql, ...p) => db.prepare(sql).run(...p);
	const signupLimit = limiter(60, 9e5);
	const authLimit = limiter(30, 9e5);
	const nameShort = limiter(10, 9e5);
	const nameDay = limiter(30, 24 * HOUR);
	const names = {
		check: (k) => (nameShort.check(k), nameDay.check(k)),
		hit: (k) => (nameShort.hit(k), nameDay.hit(k))
	};
	const joinLimit = limiter(20, 9e5);
	const linkMake = limiter(30, 9e5);
	const linkMiss = limiter(60, 9e5);
	const reportLimit = limiter(20, HOUR);
	const adminLimit = limiter(5, 9e5);
	const adminAll = limiter(50, HOUR);
	const readSecret = () => opts.authSecret || one("SELECT value FROM meta WHERE key = 'auth_secret'")?.value || (() => {
		const s = randomBytes(32).toString("hex");
		run("INSERT INTO meta VALUES ('auth_secret', ?)", s);
		return s;
	})();
	let secret = readSecret();
	const hmac = (s) => createHmac("sha256", secret).update(s).digest("hex");
	/** 이름 + 생년월일 → 로그인 키. 잘못된 값이면 400. */
	function loginKey(body) {
		const name = normName(body.name);
		const birth = validBirth(body.birth);
		if (name.length < 1 || name.length > 20) throw new HttpError(400, "이름을 적어 주세요.");
		if (!birth) throw new HttpError(400, "생년월일은 8자리 숫자로 적어 주세요. 예) 20120315");
		return {
			key: hmac(`${name}|${birth}`),
			nameKey: hmac(name)
		};
	}
	const cookieOf = (req, name = COOKIE) => (req.headers.cookie ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
	function setCookie(res, value, maxAgeSec, name = COOKIE) {
		res.setHeader("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${opts.secureCookie ? "; Secure" : ""}${maxAgeSec === null ? "" : `; Max-Age=${maxAgeSec}`}`);
	}
	/** 마지막으로 다녀간 시각. 요청마다 쓰지 않게 10분이 지났을 때만 */
	function seen(userId, last) {
		if (!last || Date.now() - Date.parse(last) > 6e5) run("UPDATE users SET last_seen_at = ? WHERE id = ?", now(), userId);
	}
	function currentUser(req) {
		const token = cookieOf(req);
		if (!token) return null;
		const row = one("SELECT u.id, u.nickname, u.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", sha(token));
		if (!row || row.expires_at < now()) return null;
		seen(row.id, row.last_seen_at);
		return {
			id: row.id,
			nickname: row.nickname
		};
	}
	function startSession(res, userId, remember) {
		const token = randomBytes(32).toString("base64url");
		const ttl = remember ? 720 * HOUR : 12 * HOUR;
		run("DELETE FROM sessions WHERE expires_at < ?", now());
		run("INSERT INTO sessions VALUES (?, ?, ?)", sha(token), userId, new Date(Date.now() + ttl).toISOString());
		seen(userId, "");
		setCookie(res, token, remember ? ttl / 1e3 : null);
	}
	const me = (c) => {
		if (!c.user) throw new HttpError(401, "로그인이 필요해요.");
		return c.user;
	};
	const isMember = (circleId, userId) => !!one("SELECT 1 FROM members WHERE circle_id = ? AND user_id = ?", circleId, userId);
	/** 모임과 그 안에서 나의 자리. manager = 모임장 또는 공동 모임장 (모임 꾸리기 · 글 내리기) */
	const memberOf = (circleId, userId) => {
		const circle = one("SELECT c.*, m.role FROM circles c JOIN members m ON m.circle_id = c.id WHERE c.id = ? AND m.user_id = ?", circleId, userId);
		if (!circle) throw new HttpError(404, "모임을 찾을 수 없어요.");
		const owner = circle.owner_id === userId;
		return {
			...circle,
			owner,
			manager: owner || circle.role === "co"
		};
	};
	const ownerOf = (circleId, userId, what) => {
		const circle = memberOf(circleId, userId);
		if (!circle.owner) throw new HttpError(403, `모임장만 ${what} 수 있어요.`);
		return circle;
	};
	const ownGraph = (id, userId) => {
		const row = one("SELECT data FROM graphs WHERE id = ? AND user_id = ?", id, userId);
		if (!row) throw new HttpError(404, "기록을 찾을 수 없어요.");
		return JSON.parse(row.data);
	};
	/** 모임에 나누기 · 다시 나누기. ‘무엇을 나눌지’도 같이 두어, 그래프를 고치면 다시 만든다. 기간이 잘못된 그래프면 null. */
	const upsertPost = (circleId, userId, g, o) => {
		const shared = sanitizeShared(postShared(g, o));
		if (!shared) return null;
		const data = JSON.stringify(shared), options = JSON.stringify(o);
		run("DELETE FROM takedowns WHERE circle_id = ? AND graph_id = ?", circleId, g.id);
		const existing = one("SELECT id FROM posts WHERE circle_id = ? AND graph_id = ?", circleId, g.id);
		if (existing) {
			run("UPDATE posts SET data = ?, options = ? WHERE id = ?", data, options, existing.id);
			return existing.id;
		}
		const id = newId();
		run("INSERT INTO posts (id, circle_id, user_id, graph_id, data, created_at, options) VALUES (?, ?, ?, ?, ?, ?, ?)", id, circleId, userId, g.id, data, now(), options);
		return id;
	};
	/** 모임장 · 운영자가 남의 글을 내릴 때: 무엇을 나눴는지 기억해 두고, 그린 사람이 그래프를 고치면 바로 다시 나눈다 */
	const takeDown = (postId) => {
		const p = one("SELECT circle_id, graph_id, user_id, options FROM posts WHERE id = ?", postId);
		if (!p) return;
		run("INSERT INTO takedowns VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, graph_id) DO UPDATE SET options = excluded.options, at = excluded.at", p.circle_id, p.graph_id, p.user_id, p.options || JSON.stringify(GROUP_POST), now());
		run("DELETE FROM posts WHERE id = ?", postId);
	};
	const routes = [];
	const on = (method, path, h) => routes.push([
		method,
		new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[\\w-]{1,64})")}$`),
		h
	]);
	on("GET", "/me", (c) => ({ user: c.user }));
	on("GET", "/me/cheers", (c) => {
		const u = me(c);
		const since = new URL(c.req.url ?? "/", "http://x").searchParams.get("since") ?? "";
		if (Number.isNaN(Date.parse(since))) throw new HttpError(400, "날짜를 읽지 못했어요.");
		return all(`SELECT ch.kind, c.name AS groupName, p.data, ch.created_at AS createdAt
         FROM cheers ch JOIN posts p ON p.id = ch.post_id JOIN circles c ON c.id = p.circle_id
        WHERE p.user_id = ? AND ch.created_at > ? ORDER BY ch.created_at DESC LIMIT 20`, u.id, new Date(since).toISOString()).map(({ data, ...r }) => ({
			...r,
			title: JSON.parse(data).title
		}));
	});
	/**
	* 새 계정 만들기 (가입 · 초대 링크로 처음 온 사람). 별명과 약관 동의가 있어야 한다.
	* ‘이미 있음’(409)은 그 이름+생일이 맞다는 신호라, 만들기 시도는 이름 기준 횟수에 센다.
	*/
	function createUser(c, key, nameKey) {
		names.check(nameKey);
		signupLimit.check(c.ip);
		if (c.body.agree !== true) throw new HttpError(400, "이용약관과 개인정보 처리방침에 동의해 주세요.");
		const nickname = clean(c.body.nickname);
		if (nickname.length < 1 || nickname.length > 12) throw new HttpError(400, "별명은 1~12자로 정해 주세요.");
		signupLimit.hit(c.ip);
		names.hit(nameKey);
		if (one("SELECT 1 FROM users WHERE login_key = ?", key)) throw new HttpError(409, "같은 이름과 생년월일로 만든 계정이 이미 있어요. 로그인해 주세요.");
		const user = {
			id: newId(),
			nickname
		};
		run("INSERT INTO users (id, login_key, nickname, created_at, agreed_at) VALUES (?, ?, ?, ?, ?)", user.id, key, nickname, now(), now());
		startSession(c.res, user.id, c.body.remember === true);
		return user;
	}
	on("POST", "/auth/signup", (c) => {
		const { key, nameKey } = loginKey(c.body);
		return { user: createUser(c, key, nameKey) };
	});
	on("POST", "/auth/login", (c) => {
		authLimit.check(c.ip);
		const { key, nameKey } = loginKey(c.body);
		names.check(nameKey);
		const row = one("SELECT id, nickname FROM users WHERE login_key = ?", key);
		if (!row) {
			authLimit.hit(c.ip);
			names.hit(nameKey);
			throw new HttpError(401, "이름이나 생년월일이 맞지 않아요. 처음이라면 ‘처음이에요’에서 시작해 주세요.");
		}
		authLimit.reset(c.ip);
		startSession(c.res, row.id, c.body.remember === true);
		return { user: row };
	});
	on("POST", "/auth/logout", (c) => {
		const token = cookieOf(c.req);
		if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha(token));
		setCookie(c.res, "", 0);
	});
	on("POST", "/me/delete", (c) => {
		const u = me(c);
		if (!one("SELECT 1 FROM users WHERE id = ? AND login_key = ?", u.id, loginKey(c.body).key)) throw new HttpError(401, "이름이나 생년월일이 맞지 않아요.");
		run("DELETE FROM users WHERE id = ?", u.id);
		setCookie(c.res, "", 0);
	});
	on("GET", "/graphs", (c) => all("SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC", me(c).id).map((r) => JSON.parse(r.data)));
	on("GET", "/graphs/:id", (c) => ownGraph(c.params.id, me(c).id));
	on("PUT", "/graphs/:id", (c) => {
		const u = me(c);
		const g = sanitizeGraph(c.body.graph, c.params.id);
		const prev = one("SELECT user_id, data FROM graphs WHERE id = ?", g.id);
		if (prev && prev.user_id !== u.id) throw new HttpError(404, "기록을 찾을 수 없어요.");
		if (g.groupId && !isMember(g.groupId, u.id)) delete g.groupId;
		if (g.groupId) g.visibility = "link";
		run("INSERT INTO graphs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", g.id, u.id, JSON.stringify(g), g.updatedAt);
		if (g.visibility === "private") {
			run("DELETE FROM posts WHERE graph_id = ?", g.id);
			run("DELETE FROM links WHERE graph_id = ?", g.id);
		} else {
			for (const p of all("SELECT circle_id, options FROM posts WHERE graph_id = ? AND options != ''", g.id)) upsertPost(p.circle_id, u.id, g, JSON.parse(p.options));
			for (const t of all("SELECT circle_id, options FROM takedowns WHERE graph_id = ? AND user_id = ?", g.id, u.id)) if (isMember(t.circle_id, u.id)) upsertPost(t.circle_id, u.id, g, sanitizePostOptions(JSON.parse(t.options)) ?? GROUP_POST);
			else run("DELETE FROM takedowns WHERE circle_id = ? AND graph_id = ?", t.circle_id, g.id);
			const wasDone = prev ? JSON.parse(prev.data).completed : false;
			if (g.groupId && g.completed && !wasDone) upsertPost(g.groupId, u.id, g, GROUP_POST);
		}
		return g;
	});
	on("DELETE", "/graphs/:id", (c) => {
		run("DELETE FROM graphs WHERE id = ? AND user_id = ?", c.params.id, me(c).id);
	});
	on("GET", "/graphs/:id/posts", (c) => {
		const u = me(c);
		ownGraph(c.params.id, u.id);
		return all("SELECT id AS postId, circle_id AS groupId FROM posts WHERE graph_id = ?", c.params.id);
	});
	on("GET", "/groups", (c) => {
		const u = me(c);
		return all(`SELECT c.id, c.name, c.owner_id = ? AS isOwner, m.role, c.topic, c.topic_at AS topicAt,
              (SELECT COUNT(*) FROM members WHERE circle_id = c.id) AS memberCount
         FROM circles c JOIN members m ON m.circle_id = c.id
        WHERE m.user_id = ? ORDER BY m.joined_at DESC`, u.id, u.id).map(({ isOwner, role, ...g }) => ({
			...g,
			role: isOwner === 1 ? "owner" : role === "co" ? "co" : "member"
		}));
	});
	on("POST", "/groups", (c) => {
		const u = me(c);
		const { name, intro } = groupInfo(c.body);
		let code = newCode();
		while (one("SELECT 1 FROM circles WHERE code = ?", code)) code = newCode();
		const id = newId();
		run("INSERT INTO circles (id, name, intro, code, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, name, intro, code, u.id, now());
		run("INSERT INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)", id, u.id, now());
		return {
			id,
			code
		};
	});
	on("POST", "/groups/join", (c) => {
		const u = me(c);
		joinLimit.check(c.ip);
		const code = str(c.body.code, 20).trim().toUpperCase();
		const circle = one("SELECT id FROM circles WHERE code = ?", code);
		if (!circle) {
			joinLimit.hit(c.ip);
			throw new HttpError(404, "그 코드의 모임을 찾지 못했어요. 모임장에게 코드를 한 번 더 확인해 봐요.");
		}
		run("INSERT OR IGNORE INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)", circle.id, u.id, now());
		return { id: circle.id };
	});
	/** 함께하는 사람: 모임장 → 공동 모임장 → 들어온 순서 */
	const membersOf = (circleId) => all(`SELECT u.id, u.nickname,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ?
        ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 ELSE 2 END, m.joined_at, m.rowid`, circleId);
	/** 모임에 나눈 글. bound = 이 모임에서 그린 그래프라 저절로 나눠진 글 */
	const postsOf = (circleId) => all(`SELECT p.id, p.user_id, u.nickname, p.data, p.created_at, json_extract(gr.data, '$.groupId') AS gid
         FROM posts p JOIN users u ON u.id = p.user_id JOIN graphs gr ON gr.id = p.graph_id
        WHERE p.circle_id = ? ORDER BY p.created_at DESC`, circleId).map((p) => ({
		id: p.id,
		userId: p.user_id,
		nickname: p.nickname,
		createdAt: p.created_at,
		graph: JSON.parse(p.data),
		bound: p.gid === circleId
	}));
	on("GET", "/groups/:id", (c) => {
		const u = me(c);
		const circle = memberOf(c.params.id, u.id);
		const isOwner = circle.owner;
		const posts = postsOf(circle.id).map(({ userId, ...p }) => {
			const mine = userId === u.id;
			const myCheers = all("SELECT kind FROM cheers WHERE post_id = ? AND user_id = ?", p.id, u.id).map((r) => r.kind);
			const counts = mine ? Object.fromEntries(all("SELECT kind, COUNT(*) AS n FROM cheers WHERE post_id = ? GROUP BY kind", p.id).map((r) => [r.kind, r.n])) : void 0;
			return {
				...p,
				mine,
				myCheers,
				counts
			};
		});
		const members = membersOf(circle.id).map((m) => isOwner ? m : {
			nickname: m.nickname,
			role: m.role
		});
		return {
			myUnposted: all(`SELECT g.id, g.data FROM graphs g
        WHERE g.user_id = ? AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.graph_id = g.id AND p.circle_id = ?)
          AND ((json_extract(g.data, '$.groupId') = ? AND json_extract(g.data, '$.completed') = 1)
               OR EXISTS (SELECT 1 FROM takedowns t WHERE t.graph_id = g.id AND t.circle_id = ?))`, u.id, circle.id, circle.id, circle.id).map((r) => ({
				graphId: r.id,
				title: JSON.parse(r.data).title
			})),
			id: circle.id,
			name: circle.name,
			intro: circle.intro,
			topic: circle.topic,
			topicAt: circle.topic_at,
			isOwner,
			isManager: circle.manager,
			code: circle.manager ? circle.code : void 0,
			preset: readPreset(circle.preset),
			members,
			posts
		};
	});
	on("PUT", "/groups/:id/members/:uid", (c) => {
		const u = me(c);
		const circle = ownerOf(c.params.id, u.id, "공동 모임장을 정할");
		if (c.params.uid === circle.owner_id) throw new HttpError(400, "모임장은 이미 모임을 꾸리고 있어요.");
		const role = c.body.role === "co" ? "co" : "";
		if (!run("UPDATE members SET role = ? WHERE circle_id = ? AND user_id = ?", role, circle.id, c.params.uid).changes) throw new HttpError(404, "이 모임에 함께하는 사람이 아니에요.");
		return { role: role || "member" };
	});
	on("POST", "/groups/:id/transfer", (c) => {
		const u = me(c);
		const circle = ownerOf(c.params.id, u.id, "모임장을 넘길");
		const to = str(c.body.userId, 64);
		if (to === u.id || !isMember(circle.id, to)) throw new HttpError(400, "모임에 함께하는 다른 사람에게만 넘길 수 있어요.");
		run("UPDATE circles SET owner_id = ? WHERE id = ?", to, circle.id);
		run("UPDATE members SET role = '' WHERE circle_id = ? AND user_id = ?", circle.id, to);
		run("UPDATE members SET role = 'co' WHERE circle_id = ? AND user_id = ?", circle.id, u.id);
	});
	on("PUT", "/groups/:id", (c) => {
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 모임 이름과 소개를 고칠 수 있어요.");
		const info = groupInfo(c.body);
		run("UPDATE circles SET name = ?, intro = ? WHERE id = ?", info.name, info.intro, c.params.id);
		return info;
	});
	on("GET", "/groups/:id/report", (c) => {
		const u = me(c);
		const circle = memberOf(c.params.id, u.id);
		if (!circle.manager) throw new HttpError(403, "모임장 · 공동 모임장만 볼 수 있어요.");
		const members = one("SELECT COUNT(*) AS n FROM members WHERE circle_id = ?", circle.id).n;
		const posts = all("SELECT user_id, data, created_at FROM posts WHERE circle_id = ?", circle.id);
		const sharers = new Set(posts.map((p) => p.user_id)).size;
		const bound = one(`SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(data, '$.completed') = 1), 0) AS done FROM graphs
        WHERE json_extract(data, '$.groupId') = ? AND user_id IN (SELECT user_id FROM members WHERE circle_id = ?)`, circle.id, circle.id);
		const cheers = one("SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.circle_id = ?", circle.id).n;
		const week = (/* @__PURE__ */ new Date(Date.now() - 168 * HOUR)).toISOString();
		const enough = sharers >= 3;
		const scores = Array.from({ length: 11 }, () => 0);
		const labels = /* @__PURE__ */ new Map();
		let moments = 0;
		for (const p of posts) for (const e of JSON.parse(p.data).entries) {
			moments++;
			scores[Math.min(10, Math.max(0, Math.round(e.emotionScore) + 5))]++;
			if (e.emotionLabel) labels.set(e.emotionLabel, (labels.get(e.emotionLabel) ?? 0) + 1);
		}
		return {
			members,
			sharers,
			posts: posts.length,
			newPosts: posts.filter((p) => p.created_at >= week).length,
			drawing: bound.n - bound.done,
			done: bound.done,
			cheers,
			moments,
			enough,
			scores: enough ? scores : null,
			labels: enough ? [...labels].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({
				label,
				n
			})) : null
		};
	});
	on("PUT", "/groups/:id/topic", (c) => {
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 주제를 정할 수 있어요.");
		const topic = clean(c.body.topic).slice(0, 80);
		const at = topic ? now() : "";
		run("UPDATE circles SET topic = ?, topic_at = ? WHERE id = ?", topic, at, c.params.id);
		return {
			topic,
			topicAt: at
		};
	});
	on("PUT", "/groups/:id/preset", (c) => {
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 나의 시간을 정할 수 있어요.");
		const preset = sanitizePreset(c.body.preset);
		run("UPDATE circles SET preset = ? WHERE id = ?", preset ? JSON.stringify(preset) : "", c.params.id);
		return { preset };
	});
	const byCode = (c) => {
		joinLimit.check(c.ip);
		const circle = one("SELECT id, name, intro, preset FROM circles WHERE code = ?", c.params.code.toUpperCase());
		if (!circle) {
			joinLimit.hit(c.ip);
			throw new HttpError(404, "초대 링크가 맞지 않거나, 모임이 없어졌어요.");
		}
		return circle;
	};
	on("GET", "/invite/:code", (c) => {
		const circle = byCode(c);
		const joined = !!c.user && !!one("SELECT 1 FROM members WHERE circle_id = ? AND user_id = ?", circle.id, c.user.id);
		return {
			name: circle.name,
			intro: circle.intro,
			preset: readPreset(circle.preset),
			joined,
			id: joined ? circle.id : void 0
		};
	});
	on("POST", "/invite/:code", (c) => {
		const circle = byCode(c);
		let user = c.user;
		if (!user) {
			authLimit.check(c.ip);
			const { key, nameKey } = loginKey(c.body);
			names.check(nameKey);
			user = one("SELECT id, nickname FROM users WHERE login_key = ?", key) ?? null;
			if (user) {
				authLimit.reset(c.ip);
				startSession(c.res, user.id, c.body.remember === true);
			} else if (c.body.nickname === void 0) {
				authLimit.hit(c.ip);
				names.hit(nameKey);
				return { needSignup: true };
			} else {
				authLimit.hit(c.ip);
				user = createUser(c, key, nameKey);
			}
		}
		run("INSERT OR IGNORE INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)", circle.id, user.id, now());
		return {
			id: circle.id,
			user
		};
	});
	on("DELETE", "/groups/:id", (c) => {
		const u = me(c);
		ownerOf(c.params.id, u.id, "모임을 없앨");
		run("DELETE FROM circles WHERE id = ?", c.params.id);
	});
	on("POST", "/groups/:id/leave", (c) => {
		const u = me(c);
		if (memberOf(c.params.id, u.id).owner) throw new HttpError(400, "모임장은 나갈 수 없어요. 다른 사람에게 모임장을 넘기거나, 모임을 없애 주세요.");
		run("DELETE FROM posts WHERE circle_id = ? AND user_id = ?", c.params.id, u.id);
		run("DELETE FROM takedowns WHERE circle_id = ? AND user_id = ?", c.params.id, u.id);
		run("DELETE FROM members WHERE circle_id = ? AND user_id = ?", c.params.id, u.id);
	});
	on("POST", "/groups/:id/posts", (c) => {
		const u = me(c);
		memberOf(c.params.id, u.id);
		const g = ownGraph(str(c.body.graphId, 64), u.id);
		if (g.visibility !== "link") throw new HttpError(403, "먼저 이 그래프를 '함께 나누기'로 바꿔 주세요.");
		const o = sanitizePostOptions(c.body.options);
		if (!o) throw new HttpError(400, "나눌 내용을 읽지 못했어요.");
		const id = upsertPost(c.params.id, u.id, g, o);
		if (!id) throw new HttpError(400, "그래프의 기간을 먼저 확인해 주세요.");
		return { id };
	});
	on("DELETE", "/posts/:id", (c) => {
		const u = me(c);
		const post = one("SELECT p.user_id, p.circle_id, json_extract(g.data, '$.groupId') AS gid FROM posts p JOIN graphs g ON g.id = p.graph_id WHERE p.id = ?", c.params.id);
		if (!post) throw new HttpError(404, "찾을 수 없어요.");
		const circle = memberOf(post.circle_id, u.id);
		if (post.user_id !== u.id && !circle.manager) throw new HttpError(403, "내가 나눈 것만 내릴 수 있어요.");
		if (!circle.manager && post.gid === post.circle_id) throw new HttpError(403, "이 모임에서 그린 선은 모임에 함께 나눠져요. 내리려면 그래프를 지우거나 모임에서 나가 주세요.");
		if (post.user_id === u.id) run("DELETE FROM posts WHERE id = ?", c.params.id);
		else takeDown(c.params.id);
	});
	on("POST", "/posts/:id/cheers", (c) => {
		const u = me(c);
		const kind = str(c.body.kind, 20);
		if (!CHEERS.includes(kind)) throw new HttpError(400, "보낼 수 없는 응원이에요.");
		const post = one("SELECT user_id, circle_id FROM posts WHERE id = ?", c.params.id);
		if (!post) throw new HttpError(404, "찾을 수 없어요.");
		memberOf(post.circle_id, u.id);
		if (post.user_id === u.id) throw new HttpError(400, "내 그래프에는 응원을 보낼 수 없어요.");
		const had = one("SELECT 1 FROM cheers WHERE post_id = ? AND user_id = ? AND kind = ?", c.params.id, u.id, kind);
		if (had) run("DELETE FROM cheers WHERE post_id = ? AND user_id = ? AND kind = ?", c.params.id, u.id, kind);
		else run("INSERT INTO cheers (post_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)", c.params.id, u.id, kind, now());
		return { on: !had };
	});
	on("POST", "/posts/:id/report", (c) => {
		const u = me(c);
		reportLimit.check(u.id);
		const reason = str(c.body.reason, 20);
		if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, "신고하는 까닭을 골라 주세요.");
		const post = one(`SELECT p.user_id, p.circle_id, p.data, u.nickname, c.name AS group_name
         FROM posts p JOIN users u ON u.id = p.user_id JOIN circles c ON c.id = p.circle_id WHERE p.id = ?`, c.params.id);
		if (!post) throw new HttpError(404, "찾을 수 없어요.");
		memberOf(post.circle_id, u.id);
		if (post.user_id === u.id) throw new HttpError(400, "내가 나눈 글은 신고할 수 없어요.");
		reportLimit.hit(u.id);
		run(`INSERT OR IGNORE INTO reports (id, post_id, circle_id, reporter_id, reason, detail, post_title, post_owner, group_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, newId(), c.params.id, post.circle_id, u.id, reason, cleanText(c.body.detail, 300), str(JSON.parse(post.data).title, 40), post.nickname, post.group_name, now());
	});
	on("GET", "/me/answers", (c) => all("SELECT day, question, text, color, updated_at AS updatedAt FROM answers WHERE user_id = ? ORDER BY day DESC LIMIT 1200", me(c).id));
	on("PUT", "/me/answers/:day", (c) => {
		const u = me(c);
		const day = c.params.day;
		const t = Date.parse(`${day}T00:00:00Z`);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t) || t > Date.now() + 48 * HOUR) throw new HttpError(400, "날짜를 읽지 못했어요.");
		const text = cleanText(c.body.text, 300);
		if (!text) {
			run("DELETE FROM answers WHERE user_id = ? AND day = ?", u.id, day);
			return {
				day,
				text: ""
			};
		}
		const question = clean(c.body.question).slice(0, 100);
		const color = MOOD_COLORS.some((m) => m.key === c.body.color) ? c.body.color : "";
		run(`INSERT INTO answers (user_id, day, question, text, updated_at, color) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET question = excluded.question, text = excluded.text, updated_at = excluded.updated_at, color = excluded.color`, u.id, day, question, text, now(), color);
		return {
			day,
			question,
			text,
			color
		};
	});
	const linksOf = (where, ...p) => all(`SELECT l.code, l.data, l.created_at AS createdAt, u.nickname, l.graph_id AS graphId
         FROM links l LEFT JOIN users u ON u.id = l.user_id WHERE ${where} ORDER BY l.created_at DESC LIMIT 500`, ...p).map(({ data, ...l }) => ({
		...l,
		graph: JSON.parse(data)
	}));
	on("POST", "/links", (c) => {
		linkMake.check(c.ip);
		const shared = sanitizeShared(c.body.shared);
		if (!shared) throw new HttpError(400, "나눌 내용을 읽지 못했어요.");
		linkMake.hit(c.ip);
		const graphId = c.user && one("SELECT 1 FROM graphs WHERE id = ? AND user_id = ?", str(c.body.graphId, 64), c.user.id) ? str(c.body.graphId, 64) : null;
		let code = newLinkCode();
		while (one("SELECT 1 FROM links WHERE code = ?", code)) code = newLinkCode();
		run("INSERT INTO links VALUES (?, ?, ?, ?, ?)", code, c.user?.id ?? null, graphId, JSON.stringify(shared), now());
		return { code };
	});
	on("GET", "/links/:code", (c) => {
		linkMiss.check(c.ip);
		const row = one("SELECT data, created_at FROM links WHERE code = ?", c.params.code);
		if (!row) {
			linkMiss.hit(c.ip);
			throw new HttpError(404, "링크가 꺼졌거나 없는 링크예요.");
		}
		return {
			shared: JSON.parse(row.data),
			createdAt: row.created_at
		};
	});
	on("GET", "/graphs/:id/links", (c) => {
		const u = me(c);
		ownGraph(c.params.id, u.id);
		return all("SELECT code, created_at AS createdAt FROM links WHERE graph_id = ? AND user_id = ? ORDER BY created_at DESC", c.params.id, u.id);
	});
	on("DELETE", "/links/:code", (c) => {
		const u = me(c);
		if (!run("DELETE FROM links WHERE code = ? AND user_id = ?", c.params.code, u.id).changes) throw new HttpError(404, "내가 만든 링크만 끌 수 있어요.");
	});
	const envSite = {
		publicUrl: opts.publicUrl ?? null,
		developer: opts.developer ?? null,
		operator: opts.operator ?? null
	};
	const savedSite = () => {
		const row = one("SELECT value FROM meta WHERE key = 'site'");
		return row ? JSON.parse(row.value) : null;
	};
	const site = () => savedSite() ?? envSite;
	on("GET", "/config", () => site());
	const ADMIN_COOKIE = "gb_admin";
	const same = (a, b) => timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
	const isAdmin = (req) => {
		const token = cookieOf(req, ADMIN_COOKIE);
		if (!opts.admin || !token) return false;
		const row = one("SELECT expires_at FROM admin_sessions WHERE token_hash = ?", sha(token));
		return !!row && row.expires_at > now();
	};
	const admin = (c) => {
		if (!isAdmin(c.req)) throw new HttpError(401, "관리자 로그인이 필요해요.");
	};
	on("GET", "/admin/me", (c) => ({
		enabled: !!opts.admin,
		admin: isAdmin(c.req)
	}));
	on("POST", "/admin/login", (c) => {
		if (!opts.admin) throw new HttpError(404, "관리자 기능이 꺼져 있어요. 서버의 .env 에 ADMIN_ID · ADMIN_PASSWORD 를 정해 주세요.");
		adminLimit.check(c.ip);
		adminAll.check("all");
		const idOk = same(str(c.body.id, 100), opts.admin.id);
		const pwOk = same(str(c.body.password, 200), opts.admin.password);
		run("INSERT INTO admin_logins (ip, ok, agent, at) VALUES (?, ?, ?, ?)", c.ip, idOk && pwOk ? 1 : 0, str(c.req.headers["user-agent"], 300), now());
		run("DELETE FROM admin_logins WHERE id <= (SELECT MAX(id) - 2000 FROM admin_logins)");
		if (!idOk || !pwOk) {
			adminLimit.hit(c.ip);
			adminAll.hit("all");
			throw new HttpError(401, "관리자 아이디나 비밀번호가 맞지 않아요.");
		}
		adminLimit.reset(c.ip);
		const token = randomBytes(32).toString("base64url");
		run("DELETE FROM admin_sessions WHERE expires_at < ?", now());
		run("INSERT INTO admin_sessions VALUES (?, ?)", sha(token), new Date(Date.now() + 8 * HOUR).toISOString());
		setCookie(c.res, token, null, ADMIN_COOKIE);
	});
	on("POST", "/admin/logout", (c) => {
		const token = cookieOf(c.req, ADMIN_COOKIE);
		if (token) run("DELETE FROM admin_sessions WHERE token_hash = ?", sha(token));
		setCookie(c.res, "", 0, ADMIN_COOKIE);
	});
	on("GET", "/admin/overview", (c) => {
		admin(c);
		const count = (table, where = "1", ...args) => one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...args).n;
		const ago = (days) => (/* @__PURE__ */ new Date(Date.now() - days * 24 * HOUR)).toISOString();
		const week = ago(7);
		const made = "json_extract(data, '$.createdAt')";
		const perDay = (table, col) => all(`SELECT date(${col}, '+9 hours') AS day, COUNT(*) AS n FROM ${table} WHERE ${col} >= ? GROUP BY day`, ago(14));
		const days = Array.from({ length: 14 }, (_, i) => (/* @__PURE__ */ new Date(Date.now() + 9 * HOUR - (13 - i) * 24 * HOUR)).toISOString().slice(0, 10));
		const signups = perDay("users", "created_at");
		const graphsMade = perDay("graphs", made);
		const pick = (rows, d) => rows.find((r) => r.day === d)?.n ?? 0;
		return {
			counts: {
				users: count("users"),
				graphs: count("graphs"),
				groups: count("circles"),
				posts: count("posts"),
				links: count("links")
			},
			stats: {
				completed: count("graphs", "json_extract(data, '$.completed') = 1"),
				letters: count("graphs", "json_extract(data, '$.futureLetter') IS NOT NULL"),
				cheers: count("cheers"),
				moments: one("SELECT COALESCE(SUM(json_array_length(data, '$.entries')), 0) AS n FROM graphs").n,
				scales: all("SELECT json_extract(data, '$.timeScale') AS scale, COUNT(*) AS n FROM graphs GROUP BY scale"),
				week: {
					signups: count("users", "created_at >= ?", week),
					visitors: count("users", "last_seen_at >= ?", week),
					graphs: count("graphs", `${made} >= ?`, week),
					posts: count("posts", "created_at >= ?", week),
					cheers: count("cheers", "created_at >= ?", week)
				},
				online: count("users", "last_seen_at >= ?", ago(1 / 24)),
				openReports: count("reports", "resolved_at = '' AND deleted_at = ''"),
				storage: storageOf(db, opts.backupDir ?? null),
				answers: count("answers"),
				daily: days.map((d) => ({
					day: d,
					signups: pick(signups, d),
					graphs: pick(graphsMade, d)
				}))
			},
			groups: all(`SELECT c.id, c.name, c.code, u.nickname AS owner, c.created_at AS createdAt,
                (SELECT COUNT(*) FROM members WHERE circle_id = c.id) AS memberCount,
                (SELECT COUNT(*) FROM posts WHERE circle_id = c.id) AS postCount
           FROM circles c JOIN users u ON u.id = c.owner_id ORDER BY c.created_at DESC LIMIT 200`),
			users: all(`SELECT u.id, u.nickname, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
                (SELECT COUNT(*) FROM graphs WHERE user_id = u.id) AS graphCount,
                (SELECT COUNT(*) FROM graphs WHERE user_id = u.id AND json_extract(data, '$.completed') = 1) AS completedCount,
                (SELECT COUNT(*) FROM members WHERE user_id = u.id) AS groupCount,
                (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS postCount
           FROM users u ORDER BY u.created_at DESC LIMIT 200`),
			posts: all(`SELECT p.id, c.name AS groupName, u.nickname, p.data, p.created_at AS createdAt
           FROM posts p JOIN circles c ON c.id = p.circle_id JOIN users u ON u.id = p.user_id
          ORDER BY p.created_at DESC LIMIT 100`).map(({ data, ...p }) => ({
				...p,
				title: JSON.parse(data).title
			}))
		};
	});
	on("DELETE", "/admin/groups/:id", (c) => {
		admin(c);
		run("DELETE FROM circles WHERE id = ?", c.params.id);
	});
	on("DELETE", "/admin/users/:id", (c) => {
		admin(c);
		run("DELETE FROM users WHERE id = ?", c.params.id);
	});
	on("DELETE", "/admin/posts/:id", (c) => {
		admin(c);
		takeDown(c.params.id);
	});
	on("GET", "/admin/users/:id", (c) => {
		admin(c);
		const u = one("SELECT id, nickname, created_at, agreed_at, last_seen_at FROM users WHERE id = ?", c.params.id);
		if (!u) throw new HttpError(404, "찾을 수 없어요.");
		return {
			id: u.id,
			nickname: u.nickname,
			createdAt: u.created_at,
			agreedAt: u.agreed_at,
			lastSeenAt: u.last_seen_at,
			sessions: one("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at >= ?", u.id, now()).n,
			cheersGiven: one("SELECT COUNT(*) AS n FROM cheers WHERE user_id = ?", u.id).n,
			cheersReceived: one("SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ?", u.id).n,
			groups: all(`SELECT c.id, c.name, m.joined_at AS joinedAt,
                CASE WHEN c.owner_id = m.user_id THEN 'owner' WHEN m.role = 'co' THEN 'co' ELSE 'member' END AS role
           FROM members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ? ORDER BY m.joined_at DESC`, u.id),
			graphs: all("SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC", u.id).map((r) => JSON.parse(r.data)),
			posts: all("SELECT p.id, c.name AS groupName, p.graph_id AS graphId, p.created_at AS createdAt FROM posts p JOIN circles c ON c.id = p.circle_id WHERE p.user_id = ? ORDER BY p.created_at DESC", u.id),
			links: linksOf("l.user_id = ?", u.id),
			answers: all("SELECT day, question, text, color FROM answers WHERE user_id = ? ORDER BY day DESC LIMIT 100", u.id)
		};
	});
	on("GET", "/admin/reports", (c) => {
		admin(c);
		const year = (/* @__PURE__ */ new Date(Date.now() - 8760 * HOUR)).toISOString();
		run("DELETE FROM reports WHERE (resolved_at != '' AND resolved_at < ?) OR (deleted_at != '' AND deleted_at < ?)", year, year);
		const deleted = new URL(c.req.url ?? "/", "http://x").searchParams.get("deleted") === "1";
		return all(`SELECT r.id, r.post_id AS postId, r.circle_id AS groupId, r.reason, r.detail, r.post_title AS postTitle, r.post_owner AS postOwner,
              r.group_name AS groupName, r.created_at AS createdAt, r.resolved_at AS resolvedAt, u.nickname AS reporter,
              r.deleted_at AS deletedAt, r.delete_reason AS deleteReason
         FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
        WHERE ${deleted ? "r.deleted_at != ''" : "r.deleted_at = ''"}
        ORDER BY r.resolved_at != '', r.created_at DESC LIMIT 300`);
	});
	on("DELETE", "/admin/reports/:id", (c) => {
		admin(c);
		const reason = cleanText(c.body.reason, 200);
		if (reason.length < 2) throw new HttpError(400, "지우는 까닭을 적어 주세요.");
		if (!run("UPDATE reports SET deleted_at = ?, delete_reason = ? WHERE id = ? AND deleted_at = ''", now(), reason, c.params.id).changes) throw new HttpError(404, "찾을 수 없어요.");
	});
	on("POST", "/admin/reports/:id/resolve", (c) => {
		admin(c);
		run("UPDATE reports SET resolved_at = ? WHERE id = ?", c.body.undo === true ? "" : now(), c.params.id);
	});
	on("GET", "/admin/links", (c) => {
		admin(c);
		return linksOf("1 = 1");
	});
	on("DELETE", "/admin/links/:code", (c) => {
		admin(c);
		run("DELETE FROM links WHERE code = ?", c.params.code);
	});
	on("GET", "/admin/logins", (c) => {
		admin(c);
		return all(`SELECT l.id, l.ip, l.ok, l.agent, l.at, COALESCE(a.alias, '') AS alias
         FROM admin_logins l LEFT JOIN ip_aliases a ON a.ip = l.ip ORDER BY l.id DESC LIMIT 300`).map((r) => ({
			...r,
			ok: r.ok === 1
		}));
	});
	on("PUT", "/admin/ip-aliases", (c) => {
		admin(c);
		const ip = str(c.body.ip, 64).trim();
		const alias = clean(c.body.alias).slice(0, 30);
		if (!ip) throw new HttpError(400, "IP 를 읽지 못했어요.");
		if (alias) run("INSERT INTO ip_aliases VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET alias = excluded.alias", ip, alias);
		else run("DELETE FROM ip_aliases WHERE ip = ?", ip);
		return {
			ip,
			alias
		};
	});
	on("GET", "/admin/backup", (c) => {
		admin(c);
		const tmp = join(tmpdir(), `geuryeobom-backup-${randomBytes(6).toString("hex")}.db`);
		db.exec(`VACUUM INTO '${tmp}'`);
		const file = readFileSync(tmp);
		rmSync(tmp, { force: true });
		const day = now().slice(0, 10);
		c.res.writeHead(200, {
			"Content-Type": "application/vnd.sqlite3",
			"Content-Disposition": `attachment; filename="geuryeobom-${day}.db"`,
			"Cache-Control": "no-store"
		});
		c.res.end(file);
		return RAW;
	});
	on("POST", "/admin/restore", async (c) => {
		admin(c);
		adminLimit.check(c.ip);
		let pw = "";
		try {
			pw = decodeURIComponent(String(c.req.headers["x-admin-password"] ?? ""));
		} catch {}
		if (!same(pw, opts.admin.password)) {
			adminLimit.hit(c.ip);
			throw new HttpError(401, "관리자 비밀번호가 맞지 않아요.");
		}
		const buf = await readRaw(c.req, 209715200);
		if (buf.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") throw new HttpError(400, "그려봄 백업 파일(.db)이 아니에요.");
		const tmp = join(tmpdir(), `geuryeobom-restore-${randomBytes(6).toString("hex")}.db`);
		const cleanup = () => [
			"",
			"-wal",
			"-shm"
		].forEach((x) => rmSync(tmp + x, { force: true }));
		writeFileSync(tmp, buf);
		try {
			if (!isOurDb(tmp)) throw new HttpError(400, "그려봄 백업 파일이 아니거나 열 수 없어요.");
			const up = openDb(tmp);
			const ok = up.prepare("PRAGMA integrity_check").get().integrity_check;
			up.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			up.close();
			if (ok !== "ok") throw new HttpError(400, "백업 파일이 손상돼 있어요.");
			const dir = opts.backupDir ?? tmpdir();
			mkdirSync(dir, { recursive: true });
			const before = join(dir, `before-restore-${now().replace(/[:.]/g, "-")}.db`);
			db.exec(`VACUUM INTO '${before.replace(/'/g, "''")}'`);
			readdirSync(dir).filter((f) => f.startsWith("before-restore-")).sort().slice(0, -5).forEach((f) => rmSync(join(dir, f), { force: true }));
			const colsOf = (schema, t) => all("SELECT name FROM pragma_table_info(?, ?)", t, schema).map((r) => r.name);
			db.prepare("ATTACH DATABASE ? AS up").run(tmp);
			db.exec("PRAGMA foreign_keys = OFF");
			try {
				db.exec("BEGIN");
				try {
					for (const t of RESTORE_TABLES) {
						const theirs = colsOf("up", t);
						const cols = colsOf("main", t).filter((n) => theirs.includes(n)).map((n) => `"${n}"`).join(", ");
						db.exec(`DELETE FROM main.${t}`);
						if (cols) db.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM up.${t}`);
					}
					db.exec("COMMIT");
				} catch (e) {
					db.exec("ROLLBACK");
					throw e;
				}
			} finally {
				db.exec("PRAGMA foreign_keys = ON");
				db.exec("DETACH DATABASE up");
			}
			let secretMissing = false;
			if (!opts.authSecret && !one("SELECT 1 FROM meta WHERE key = 'auth_secret'")) {
				run("INSERT INTO meta VALUES ('auth_secret', ?)", secret);
				secretMissing = true;
			}
			secret = readSecret();
			const n = (t) => one(`SELECT COUNT(*) AS n FROM ${t}`).n;
			return {
				users: n("users"),
				graphs: n("graphs"),
				groups: n("circles"),
				before: basename(before),
				secretMissing
			};
		} finally {
			cleanup();
		}
	});
	on("GET", "/admin/groups/:id", (c) => {
		admin(c);
		const circle = one("SELECT * FROM circles WHERE id = ?", c.params.id);
		if (!circle) throw new HttpError(404, "찾을 수 없어요.");
		const posts = postsOf(circle.id).map(({ userId, ...p }) => p);
		const members = all(`SELECT u.id, u.nickname, m.joined_at AS joinedAt,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ? ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 ELSE 2 END, m.joined_at, m.rowid`, circle.id);
		const created = one("SELECT created_at FROM circles WHERE id = ?", circle.id).created_at;
		return {
			id: circle.id,
			name: circle.name,
			intro: circle.intro,
			code: circle.code,
			createdAt: created,
			preset: readPreset(circle.preset),
			members,
			posts
		};
	});
	on("PUT", "/admin/groups/:id", (c) => {
		admin(c);
		const info = groupInfo(c.body);
		if (!run("UPDATE circles SET name = ?, intro = ? WHERE id = ?", info.name, info.intro, c.params.id).changes) throw new HttpError(404, "찾을 수 없어요.");
		return info;
	});
	on("GET", "/admin/settings", (c) => {
		admin(c);
		return {
			site: site(),
			saved: !!savedSite(),
			env: envSite,
			secretInDb: !opts.authSecret
		};
	});
	on("PUT", "/admin/settings", (c) => {
		admin(c);
		const s = sanitizeSite(c.body);
		run("INSERT INTO meta VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(s));
		return s;
	});
	on("DELETE", "/admin/settings", (c) => {
		admin(c);
		run("DELETE FROM meta WHERE key = 'site'");
		return envSite;
	});
	return async (req, res) => {
		const send = (status, data) => {
			res.writeHead(status, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store"
			});
			res.end(JSON.stringify(data));
		};
		try {
			const path = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/api/, "");
			let match = null;
			const route = routes.find(([m, re]) => m === req.method && (match = re.exec(path)));
			if (!route || !match) throw new HttpError(404, "찾을 수 없어요.");
			const rawBody = req.method === "POST" && path === "/admin/restore";
			const type = String(req.headers["content-type"]);
			if (req.method !== "GET" && (req.headers["x-requested-with"] !== "geuryeobom" || !(rawBody ? type === "application/octet-stream" : type.startsWith("application/json")))) throw new HttpError(403, "허용되지 않은 요청이에요.");
			const ip = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "");
			const body = req.method === "GET" || rawBody ? {} : await readJson(req);
			const result = await route[2]({
				req,
				res,
				user: currentUser(req),
				params: match.groups ?? {},
				body,
				ip
			});
			if (result !== RAW) send(200, result ?? { ok: true });
		} catch (e) {
			if (e instanceof HttpError) send(e.status, { error: e.message });
			else {
				console.error(e);
				send(500, { error: "잠시 문제가 생겼어요. 조금 뒤에 다시 해볼까요?" });
			}
		}
	};
}
// server/index.ts
var config = readConfig(process.env);
for (const w of config.warnings) console.warn(`[설정] ${w}`);
console.log(`[설정] 관리자 ${config.admin ? "켜짐" : "꺼짐"} · 공유 주소 ${config.publicUrl ?? "(접속한 주소 그대로)"}`);
mkdirSync(dirname(config.dbFile), { recursive: true });
var db = openDb(config.dbFile);
var dataDir = dirname(config.dbFile);
createServer(createApp(db, {
	...config,
	backupDir: dataDir
})).listen(config.port, () => console.log(`geuryeobom api listening on :${config.port}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
	db.close();
	process.exit(0);
});
var tidy = () => {
	try {
		const f = maintain(db, dataDir, config.backupKeep);
		if (f) console.log(`[손질] 자동 백업 ${f}`);
	} catch (e) {
		console.error("[손질] 실패", e);
	}
};
setTimeout(tidy, 6e4).unref();
setInterval(tidy, 216e5).unref();
export {};
