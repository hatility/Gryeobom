import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
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
		const hour = raw.timeScale === "hour";
		const startPoint = num$1(raw.startPoint, 0, hour ? 2e6 : 4e4, 1e3);
		const currentPoint = num$1(raw.currentPoint, 0, hour ? 2e6 : 4e4, 1e3);
		if (startPoint === null || currentPoint === null || startPoint > currentPoint || hour && currentPoint - startPoint > 336) return null;
		return {
			v: 1,
			title: str$1(raw.title, 40),
			timeScale: [
				"year",
				"month",
				"hour"
			].includes(raw.timeScale) ? raw.timeScale : "age",
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
		backupKeep: v("BACKUP_KEEP") === "" ? 168 : Math.max(0, Math.min(2e3, Math.floor(Number(v("BACKUP_KEEP")) || 0))),
		autoBackupDir: v("BACKUP_DIR") || void 0,
		secureCookie: v("COOKIE_SECURE") !== "false",
		devServer: v("DEV_SERVER") === "true",
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
// src/flags.ts
/**
* 실험 기능 스위치. 개발 테스트 서버(DEV_SERVER=true)에서는 모두 켜져 있고,
* 정식 서버에서는 official 묶음은 늘 켜지고(1.1.0~), 나머지만 관리자 ‘설정 → 실험 기능 스위치’ 에서 켠다 (처음엔 꺼짐).
* 서버(labs(key)) · 화면(useLabs(key))이 같은 이름을 쓴다.
*/
var FLAGS = [
	{
		key: "graph",
		official: true,
		name: "나의 선 더하기",
		desc: "인생 구간 띠 · 나만의 질문 · 전환점 · 질문 묶음 · 단어 카드 · 나의 마음 단어 · A4 한 장 · 카드 배경 · 손글씨 · 고치기 전 모습 · 문장 도우미 · 쉬운 말 · 인터넷 없이 쓰기 · 시각으로 그리기"
	},
	{
		key: "group",
		official: true,
		name: "모임 더하기",
		desc: "모임 소식 · 일정 · 출석 · 복제 · 여러 모임 한 번에 · 리포트 인쇄 · 끝내기 · 질문 묶음 · 도우미 · 진행안 · 큰 화면 진행 · QR · 종이 활동지 · 질문 정하기"
	},
	{
		key: "org",
		official: true,
		name: "기관",
		desc: "기관 리포트 · 기관 소식 한 번에 · 담당자 초대 링크 · 기관 직접 등록(등록 안내 동의) · 맨 위 기관 탭"
	},
	{
		key: "guardian",
		name: "만 14세 미만 보호자 동의",
		desc: "가입 때 보호자 정보 · 보호자 확인 링크"
	},
	{
		key: "me",
		official: true,
		name: "내 기록 · 문의 · 약관",
		desc: "내 기록 모두 내려받기 · 문의하기 · 약관 다시 동의 · 한 해 돌아보기 응원 수 · 홈 화면 설치"
	},
	{
		key: "ops",
		official: true,
		name: "운영 도구",
		desc: "관리자: 오류 · CSP · 휴면 · 통계 · 흐름 · 서버 상태 · 자동 백업 · 차단 · 요청 대장 · 파기 기록 · 계정 · 점검 · 공지 예약 · 진단 · 문의함 · 접속 표 · 새 버전 · DB 점검"
	}
];
/** 1.1.0 에서 정식이 된 묶음: 스위치와 상관없이 늘 켜진다 (보호자 동의만 아직 스위치) */
var OFFICIAL = FLAGS.filter((f) => "official" in f).map((f) => f.key);
var isFlag = (x) => FLAGS.some((f) => f.key === x);
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
  `);
	if (!db.prepare("SELECT name FROM pragma_table_info('posts')").all().some((c) => c.name === "options")) db.exec("ALTER TABLE posts ADD COLUMN options TEXT NOT NULL DEFAULT ''");
	if (!userCols.some((c) => c.name === "guardian")) db.exec("ALTER TABLE users ADD COLUMN guardian TEXT NOT NULL DEFAULT ''");
	if (!userCols.some((c) => c.name === "last_seen_at")) db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''");
	if (!circleCols.some((c) => c.name === "news")) db.exec("ALTER TABLE circles ADD COLUMN news TEXT NOT NULL DEFAULT ''");
	if (!circleCols.some((c) => c.name === "news_at")) db.exec("ALTER TABLE circles ADD COLUMN news_at TEXT NOT NULL DEFAULT ''");
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
	if (!db.prepare("SELECT name FROM pragma_table_info('circles')").all().some((c) => c.name === "closed_at")) db.exec("ALTER TABLE circles ADD COLUMN closed_at TEXT NOT NULL DEFAULT ''");
	if (!db.prepare("SELECT name FROM pragma_table_info('orgs')").all().some((c) => c.name === "invite")) db.exec("ALTER TABLE orgs ADD COLUMN invite TEXT NOT NULL DEFAULT ''");
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
  `);
	const circleCols3 = db.prepare("SELECT name FROM pragma_table_info('circles')").all();
	if (!circleCols3.some((c) => c.name === "question_set")) db.exec("ALTER TABLE circles ADD COLUMN question_set TEXT NOT NULL DEFAULT ''");
	if (!circleCols3.some((c) => c.name === "prompts")) db.exec("ALTER TABLE circles ADD COLUMN prompts TEXT NOT NULL DEFAULT ''");
	const colsOf = (t) => db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((c) => c.name);
	if (!colsOf("admin_sessions").includes("who")) db.exec("ALTER TABLE admin_sessions ADD COLUMN who TEXT NOT NULL DEFAULT ''");
	if (!colsOf("admin_sessions").includes("role")) db.exec("ALTER TABLE admin_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'");
	if (!colsOf("admin_logins").includes("who")) db.exec("ALTER TABLE admin_logins ADD COLUMN who TEXT NOT NULL DEFAULT ''");
	if (!colsOf("admin_audit").includes("who")) db.exec("ALTER TABLE admin_audit ADD COLUMN who TEXT NOT NULL DEFAULT ''");
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
  `);
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
  `);
	const inqCols = db.prepare("SELECT name FROM pragma_table_info('inquiries')").all();
	if (!inqCols.some((c) => c.name === "answer")) db.exec("ALTER TABLE inquiries ADD COLUMN answer TEXT NOT NULL DEFAULT ''");
	if (!inqCols.some((c) => c.name === "answered_at")) db.exec("ALTER TABLE inquiries ADD COLUMN answered_at TEXT NOT NULL DEFAULT ''");
	db.exec(`CREATE TRIGGER IF NOT EXISTS inquiries_with_user BEFORE DELETE ON users BEGIN DELETE FROM inquiries WHERE user_id = OLD.id; END;`);
	if (!db.prepare("SELECT name FROM pragma_table_info('orgs')").all().some((c) => c.name === "code")) db.exec("ALTER TABLE orgs ADD COLUMN code TEXT NOT NULL DEFAULT ''");
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
var AUTO = /^auto-\d{4}-\d{2}-\d{2}(-\d{2})?\.db$/;
/** 이름 속 때 (하루 백업은 그날 00시로) — 새것부터 줄 세울 때 */
var whenOf = (f) => f.replace(/^auto-(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?\.db$/, (_, d, h) => `${d}-${h ?? "00"}`);
/**
* 손질 (한 시간마다): 끝난 로그인 지우기, 통계 손보기, WAL 합치기, 자동 백업(folder 에 한 시간에 하나 · 최근 keep 개).
* 서비스를 멈추지 않는다. folder 가 없거나 keep = 0 이면 자동 백업은 하지 않는다.
* 파일 이름은 한국 시간: auto-2026-11-06-09.db (예전 하루 백업 auto-2026-11-06.db 도 함께 센다)
*/
function maintain(db, folder, keep, now = /* @__PURE__ */ new Date()) {
	const iso = now.toISOString();
	db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(iso);
	db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(iso);
	db.exec("PRAGMA optimize");
	db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	if (!folder || keep <= 0) return null;
	mkdirSync(folder, { recursive: true });
	const k = new Date(now.getTime() + 324e5).toISOString();
	const file = join(folder, `auto-${k.slice(0, 10)}-${k.slice(11, 13)}.db`);
	if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
	readdirSync(folder).filter((f) => AUTO.test(f)).sort((a, b) => whenOf(b).localeCompare(whenOf(a))).slice(keep).forEach((f) => rmSync(join(folder, f), { force: true }));
	return file;
}
/** 자동 백업을 남길 개수: 관리자 화면에서 정한 값(meta) > .env 의 BACKUP_KEEP */
function backupKeepOf(db, fallback) {
	const v = db.prepare("SELECT value FROM meta WHERE key = 'backup_keep'").get()?.value;
	return v === void 0 ? fallback : Math.max(0, Math.min(2e3, Math.floor(Number(v)) || 0));
}
/** 자동 백업 파일들 (새것 먼저) */
function listBackups(folder) {
	if (!folder || !existsSync(folder)) return [];
	return readdirSync(folder).filter((f) => AUTO.test(f)).sort((a, b) => whenOf(b).localeCompare(whenOf(a))).map((f) => ({
		name: f.slice(0, -3),
		size: statSync(join(folder, f)).size,
		at: statSync(join(folder, f)).mtime.toISOString()
	}));
}
/** DB 와 자동 백업이 차지하는 크기 (바이트) */
function storageOf(db, folder) {
	const page = db.prepare("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()").get();
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
/** 생년월일(YYYYMMDD) → 오늘(한국 시간) 만 나이 */
function ageOf(birth, today = new Date(Date.now() + 324e5)) {
	const y = +birth.slice(0, 4), md = birth.slice(4);
	const t = today.toISOString().slice(0, 10).replace(/-/g, "");
	return +t.slice(0, 4) - y - (t.slice(4) < md ? 1 : 0);
}
var GUARDIAN_RELATIONS = [
	"부모님",
	"보호자",
	"기관 담당 선생님"
];
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
/** DB 초기화로 비우는 표: 회원과 회원이 만든 모든 것 (meta · 관리자 접속 기록 · IP 별칭은 남긴다) */
var RESET_TABLES = [
	"inquiries",
	"visit_hours",
	"graph_versions",
	"csp_reports",
	"privacy_requests",
	"attendance",
	"events",
	"orgs",
	"cheers",
	"posts",
	"takedowns",
	"reports",
	"members",
	"circles",
	"links",
	"answers",
	"graphs",
	"sessions",
	"users"
];
var RESET_PHRASE = "모두 지우기";
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
	"takedowns",
	"events",
	"attendance",
	"orgs",
	"privacy_requests",
	"graph_versions",
	"inquiries",
	"purge_log"
];
/** 핸들러가 응답을 직접 썼을 때 (파일 내려받기) */
var RAW = Symbol("raw");
/** 저장할 그래프 검증. 내 기록이라도 정해진 모양 말고는 받지 않는다. */
function sanitizeGraph(raw, id) {
	if (!raw || typeof raw !== "object" || raw.id !== id) throw new HttpError(400, "기록을 읽지 못했어요.");
	if (raw.timeScale === "hour" && !(num(raw.currentPoint) > num(raw.startPoint) && num(raw.currentPoint) - num(raw.startPoint) <= 336)) throw new HttpError(400, "시간은 14일 안으로 정해 주세요.");
	const r = raw.currentReflection ?? {};
	const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, 100) : [];
	return {
		id,
		title: str(raw.title, 40),
		timeScale: [
			"year",
			"month",
			"hour"
		].includes(raw.timeScale) ? raw.timeScale : "age",
		...raw.monthRange === "recent12" || raw.monthRange === "thisYear" ? { monthRange: raw.monthRange } : {},
		...[
			"rose",
			"sage",
			"sand",
			"lilac"
		].includes(raw.lineColor) ? { lineColor: raw.lineColor } : {},
		...[
			"career",
			"relation",
			"school"
		].includes(raw.questionSet) ? { questionSet: raw.questionSet } : {},
		startPoint: raw.timeScale === "hour" ? Math.round(num(raw.startPoint) * 1e3) / 1e3 : int(raw.startPoint),
		currentPoint: raw.timeScale === "hour" ? Math.round(num(raw.currentPoint) * 1e3) / 1e3 : int(raw.currentPoint),
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
				fromPast: str(e?.reflection?.fromPast, 1e3),
				...Array.isArray(e?.reflection?.extra) ? { extra: e.reflection.extra.slice(0, 3).map((x) => str(x, 1e3)) } : {}
			},
			showOnGraph: e?.showOnGraph !== false,
			...e?.turningPoint === true ? { turningPoint: true } : {},
			...[
				"basic",
				"career",
				"relation",
				"school"
			].includes(e?.questionSet) ? { questionSet: e.questionSet } : {}
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
		...Array.isArray(raw.stages) && raw.stages.length ? { stages: raw.stages.slice(0, 8).map((x) => ({
			label: str(x?.label, 16).trim(),
			from: Math.round(num(x?.from) * 1e3) / 1e3,
			to: Math.round(num(x?.to) * 1e3) / 1e3
		})).filter((x) => x.label && x.to > x.from) } : {},
		...(() => {
			const { moments, reflect, now: nowQ } = sanitizePrompts(raw.prompts);
			return moments || reflect || nowQ ? { prompts: {
				...moments ? { moments } : {},
				...reflect ? { reflect } : {},
				...nowQ ? { now: nowQ } : {}
			} } : {};
		})(),
		...Array.isArray(raw.myQuestions) && raw.myQuestions.length ? { myQuestions: raw.myQuestions.slice(0, 3).map((q) => str(q, 100).trim()).filter(Boolean) } : {},
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
		"month",
		"hour",
		"recent12",
		"thisYear"
	].find((k) => k === raw?.choice);
	const start = int(raw?.start), end = int(raw?.end), year = (/* @__PURE__ */ new Date()).getFullYear();
	const ok = choice === "age" ? start >= 0 && end <= 120 && start < end : choice === "year" ? start >= 1900 && end <= year && start < end : choice === "month" ? start >= 22800 && end <= year * 12 + 11 && start <= end && end - start < 120 : choice === "hour" ? start > 0 && end > start && end - start <= 336 : choice === "recent12" ? end >= 22800 && end <= year * 12 + 11 : choice === "thisYear";
	if (!choice || !ok) throw new HttpError(400, "나의 시간을 한 번 더 확인해 주세요.");
	return {
		choice,
		start,
		end,
		title: clean(raw.title).slice(0, 40)
	};
}
var readPreset = (s) => s ? JSON.parse(s) : null;
/** 모임장이 정한 질문 검증. 칸마다 없으면 기본, '' 이면 묻지 않음. 아무것도 없으면 {} */
function sanitizePrompts(raw) {
	const out = {};
	const list = (x, n, max) => Array.isArray(x) ? x.map((s) => clean(s).slice(0, max)).filter(Boolean).slice(0, n) : [];
	const keyed = (x, keys) => {
		const o = {};
		for (const k of keys) if (typeof x?.[k] === "string") o[k] = clean(x[k]).slice(0, 100);
		return Object.keys(o).length ? o : void 0;
	};
	const moments = list(raw?.moments, 8, 40), present = list(raw?.present, 8, 60);
	const reflect = keyed(raw?.reflect, [
		"feeling",
		"why",
		"now",
		"toPast",
		"fromPast"
	]);
	const nowQ = keyed(raw?.now, [
		"changed",
		"word",
		"influence",
		"message",
		"oneLine"
	]);
	if (moments.length) out.moments = moments;
	if (reflect) out.reflect = reflect;
	if (nowQ) out.now = nowQ;
	if (present.length) out.present = present;
	return out;
}
var readPrompts = (s) => s ? JSON.parse(s) : null;
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
		reset: (key) => hits.delete(key),
		/** 지금 막혀 있는 키들 (관리자 ‘요청 제한 · 차단’) */
		blocked: () => [...hits].filter(([, v]) => v.until > Date.now() && v.n >= max).map(([key, v]) => ({
			key,
			n: v.n,
			until: new Date(v.until).toISOString()
		}))
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
	const cspLimit = limiter(60, HOUR);
	const contactLimit = limiter(5, HOUR);
	const adminLimit = limiter(5, 9e5);
	const adminAll = limiter(50, HOUR);
	/** 관리자 ‘요청 제한 · 차단’ 에 보일 것: [이름, 무엇으로 세는지, 제한] */
	const LIMITS = [
		[
			"가입",
			"ip",
			signupLimit
		],
		[
			"로그인",
			"ip",
			authLimit
		],
		[
			"같은 이름 (15분)",
			"name",
			nameShort
		],
		[
			"같은 이름 (하루)",
			"name",
			nameDay
		],
		[
			"모임 코드 맞히기",
			"ip",
			joinLimit
		],
		[
			"공유 링크 만들기",
			"ip",
			linkMake
		],
		[
			"없는 링크 · 확인 링크 맞히기",
			"ip",
			linkMiss
		],
		[
			"신고",
			"user",
			reportLimit
		],
		[
			"보안 정책 보고",
			"ip",
			cspLimit
		],
		[
			"문의하기",
			"ip",
			contactLimit
		],
		[
			"관리자 로그인",
			"ip",
			adminLimit
		],
		[
			"관리자 로그인 (전체)",
			"all",
			adminAll
		]
	];
	const started = Date.now();
	const timings = [];
	let served = 0, failed = 0;
	const readSecret = () => opts.authSecret || one("SELECT value FROM meta WHERE key = 'auth_secret'")?.value || (() => {
		const s = randomBytes(32).toString("hex");
		run("INSERT INTO meta (key, value) VALUES ('auth_secret', ?)", s);
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
		if (!last || Date.now() - Date.parse(last) > 6e5) {
			run("UPDATE users SET last_seen_at = ? WHERE id = ?", now(), userId);
			if (lab("ops")) {
				const k = new Date(Date.now() + 9 * HOUR);
				run("INSERT INTO visit_hours (dow, hour, n) VALUES (?, ?, 1) ON CONFLICT(dow, hour) DO UPDATE SET n = n + 1", k.getUTCDay(), k.getUTCHours());
			}
		}
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
		run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha(token), userId, new Date(Date.now() + ttl).toISOString());
		seen(userId, "");
		setCookie(res, token, remember ? ttl / 1e3 : null);
	}
	const me = (c) => {
		if (!c.user) throw new HttpError(401, "로그인이 필요해요.");
		return c.user;
	};
	/** 실험: 끝난 모임에는 새로 들어오거나 나누거나 일정을 더할 수 없다 */
	const openCircle = (closedAt) => {
		if (closedAt) throw new HttpError(400, "끝난 모임이에요. 지금은 보기만 할 수 있어요.");
	};
	const autoDir = opts.autoBackupDir || (opts.backupDir ? join(opts.backupDir, "backups") : null);
	const flagsOn = () => {
		const v = one("SELECT value FROM meta WHERE key = 'flags'")?.value;
		try {
			return v ? JSON.parse(v) : {};
		} catch {
			return {};
		}
	};
	const lab = (k) => !!opts.devServer || OFFICIAL.includes(k) || !!flagsOn()[k];
	/** 실험: 파기 기록 — 건수만 */
	const logPurge = (kind, count) => {
		if (count > 0 && lab("ops")) run("INSERT INTO purge_log (at, kind, count) VALUES (?, ?, ?)", now(), kind, count);
	};
	const isMember = (circleId, userId) => !!one("SELECT 1 FROM members WHERE circle_id = ? AND user_id = ?", circleId, userId);
	/** 모임과 그 안에서 나의 자리. manager = 모임장 또는 공동 모임장 (모임 꾸리기 · 글 내리기) */
	const memberOf = (circleId, userId) => {
		const circle = one("SELECT c.*, m.role FROM circles c JOIN members m ON m.circle_id = c.id WHERE c.id = ? AND m.user_id = ?", circleId, userId);
		if (!circle) throw new HttpError(404, "모임을 찾을 수 없어요.");
		const owner = circle.owner_id === userId;
		const manager = owner || circle.role === "co";
		const helper = circle.role === "helper" && lab("group");
		return {
			...circle,
			owner,
			manager,
			helper,
			crew: manager || helper
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
		run("INSERT INTO takedowns (circle_id, graph_id, user_id, options, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, graph_id) DO UPDATE SET options = excluded.options, at = excluded.at", p.circle_id, p.graph_id, p.user_id, p.options || JSON.stringify(GROUP_POST), now());
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
		let guardian = "";
		const birth = validBirth(c.body.birth);
		if (lab("guardian") && birth && ageOf(birth) < 14) {
			const g = c.body.guardian ?? {};
			const contact = clean(g.contact).slice(0, 80);
			const phone = contact.replace(/[^0-9]/g, "");
			if (g.agreed !== true || !GUARDIAN_RELATIONS.includes(g.relation)) throw new HttpError(400, "만 14세 미만은 보호자의 동의가 필요해요. 보호자와 함께 적어 주세요.");
			if (!(isEmail(contact) || /^01\d{8,9}$/.test(phone))) throw new HttpError(400, "보호자 연락처는 휴대폰 번호나 이메일로 적어 주세요.");
			guardian = JSON.stringify({
				relation: g.relation,
				contact: isEmail(contact) ? contact : phone,
				at: now(),
				token: randomBytes(18).toString("base64url"),
				confirmedAt: ""
			});
		}
		const user = {
			id: newId(),
			nickname
		};
		run("INSERT INTO users (id, login_key, nickname, created_at, agreed_at, guardian) VALUES (?, ?, ?, ?, ?, ?)", user.id, key, nickname, now(), now(), guardian);
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
		logPurge("탈퇴", 1);
		setCookie(c.res, "", 0);
	});
	on("GET", "/graphs", (c) => all("SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC", me(c).id).map((r) => JSON.parse(r.data)));
	on("GET", "/graphs/:id", (c) => ownGraph(c.params.id, me(c).id));
	on("PUT", "/graphs/:id", (c) => {
		const u = me(c);
		const g = sanitizeGraph(c.body.graph, c.params.id);
		const prev = one("SELECT user_id, data FROM graphs WHERE id = ?", g.id);
		if (prev && prev.user_id !== u.id) throw new HttpError(404, "기록을 찾을 수 없어요.");
		if (lab("graph") && prev) {
			const last = one("SELECT at FROM graph_versions WHERE graph_id = ? ORDER BY id DESC LIMIT 1", g.id);
			if (c.body.snapshot === true || !last || Date.now() - Date.parse(last.at) > 6e5) {
				run("INSERT INTO graph_versions (graph_id, data, at) VALUES (?, ?, ?)", g.id, prev.data, now());
				run("DELETE FROM graph_versions WHERE graph_id = ? AND id NOT IN (SELECT id FROM graph_versions WHERE graph_id = ? ORDER BY id DESC LIMIT 20)", g.id, g.id);
			}
		}
		if (g.groupId && !isMember(g.groupId, u.id)) delete g.groupId;
		if (g.groupId) g.visibility = "link";
		run("INSERT INTO graphs (id, user_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", g.id, u.id, JSON.stringify(g), g.updatedAt);
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
	on("GET", "/graphs/:id/versions", (c) => {
		labs("graph");
		const u = me(c);
		ownGraph(c.params.id, u.id);
		return all("SELECT id, at, json_extract(data, '$.title') AS title, json_array_length(data, '$.entries') AS moments, json_extract(data, '$.completed') AS done FROM graph_versions WHERE graph_id = ? ORDER BY id DESC", c.params.id).map((v) => ({
			...v,
			done: v.done === 1
		}));
	});
	on("GET", "/graphs/:id/versions/:vid", (c) => {
		labs("graph");
		const u = me(c);
		ownGraph(c.params.id, u.id);
		const v = one("SELECT data, at FROM graph_versions WHERE id = ? AND graph_id = ?", Number(c.params.vid), c.params.id);
		if (!v) throw new HttpError(404, "그 모습을 찾을 수 없어요.");
		return {
			at: v.at,
			graph: JSON.parse(v.data)
		};
	});
	on("GET", "/graphs/:id/posts", (c) => {
		const u = me(c);
		ownGraph(c.params.id, u.id);
		return all("SELECT id AS postId, circle_id AS groupId FROM posts WHERE graph_id = ?", c.params.id);
	});
	on("GET", "/groups", (c) => {
		const u = me(c);
		return all(`SELECT c.id, c.name, c.owner_id = ? AS isOwner, m.role, c.topic, c.topic_at AS topicAt, c.news, c.news_at AS newsAt, c.closed_at AS closedAt,
              (SELECT COUNT(*) FROM members WHERE circle_id = c.id) AS memberCount
         FROM circles c JOIN members m ON m.circle_id = c.id
        WHERE m.user_id = ? ORDER BY m.joined_at DESC`, u.id, u.id).map(({ isOwner, role, ...g }) => ({
			...g,
			role: isOwner === 1 ? "owner" : role === "co" ? "co" : role === "helper" ? "helper" : "member",
			nextEvent: lab("group") ? nextEventOf(g.id) : null
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
	/** 기능 묶음이 꺼져 있으면 없는 주소로. 개발 테스트 서버는 모두 켜짐 · 정식은 OFFICIAL 묶음(1.1.0~)과 관리자가 켠 묶음 (지금은 보호자 동의만 스위치) */
	const labs = (k) => {
		if (!lab(k)) throw new HttpError(404, "찾을 수 없어요.");
	};
	on("POST", "/groups/bulk", (c) => {
		labs("group");
		const u = me(c);
		const names = Array.isArray(c.body.names) ? c.body.names.map((x) => clean(x)).filter(Boolean) : [];
		if (!names.length) throw new HttpError(400, "모임 이름을 한 줄에 하나씩 적어 주세요.");
		if (names.length > 30) throw new HttpError(400, "한 번에 30개까지 만들 수 있어요.");
		const intro = groupInfo({
			name: "x",
			intro: c.body.intro
		}).intro;
		const made = [];
		db.exec("BEGIN");
		try {
			for (const n of names) {
				const { name } = groupInfo({ name: n });
				let code = newCode();
				while (one("SELECT 1 FROM circles WHERE code = ?", code)) code = newCode();
				const id = newId();
				run("INSERT INTO circles (id, name, intro, code, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, name, intro, code, u.id, now());
				run("INSERT INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)", id, u.id, now());
				made.push({
					id,
					name,
					code
				});
			}
			db.exec("COMMIT");
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
		return { groups: made };
	});
	on("GET", "/me/export", (c) => {
		labs("me");
		const u = me(c);
		const p = one("SELECT nickname, created_at, agreed_at, guardian FROM users WHERE id = ?", u.id);
		return {
			exportedAt: now(),
			service: "그려봄",
			profile: {
				nickname: p.nickname,
				createdAt: p.created_at,
				agreedAt: p.agreed_at,
				guardian: p.guardian ? JSON.parse(p.guardian) : null
			},
			graphs: all("SELECT data FROM graphs WHERE user_id = ? ORDER BY updated_at DESC", u.id).map((r) => JSON.parse(r.data)),
			answers: all("SELECT day, question, text, color FROM answers WHERE user_id = ? ORDER BY day", u.id),
			groups: all(`SELECT c.name, m.joined_at AS joinedAt, CASE WHEN c.owner_id = m.user_id THEN '모임장' WHEN m.role = 'co' THEN '공동 모임장' WHEN m.role = 'helper' THEN '도우미' ELSE '함께하는 사람' END AS role
           FROM members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ? ORDER BY m.joined_at`, u.id),
			sharedInGroups: all("SELECT c.name AS groupName, p.created_at AS createdAt, p.data FROM posts p JOIN circles c ON c.id = p.circle_id WHERE p.user_id = ? ORDER BY p.created_at", u.id).map((r) => ({
				groupName: r.groupName,
				createdAt: r.createdAt,
				graph: JSON.parse(r.data)
			})),
			links: all("SELECT code, created_at AS createdAt FROM links WHERE user_id = ? ORDER BY created_at", u.id),
			graphVersions: all("SELECT v.graph_id AS graphId, v.at, v.data FROM graph_versions v JOIN graphs g ON g.id = v.graph_id WHERE g.user_id = ? ORDER BY v.id", u.id).map((v) => ({
				graphId: v.graphId,
				at: v.at,
				graph: JSON.parse(v.data)
			})),
			cheersReceived: one("SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ?", u.id).n
		};
	});
	on("POST", "/groups/join", (c) => {
		const u = me(c);
		joinLimit.check(c.ip);
		const code = str(c.body.code, 20).trim().toUpperCase();
		const circle = one("SELECT id, closed_at FROM circles WHERE code = ?", code);
		if (!circle) {
			joinLimit.hit(c.ip);
			throw new HttpError(404, "그 코드의 모임을 찾지 못했어요. 모임장에게 코드를 한 번 더 확인해 봐요.");
		}
		if (!isMember(circle.id, u.id)) openCircle(circle.closed_at);
		run("INSERT OR IGNORE INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)", circle.id, u.id, now());
		return { id: circle.id };
	});
	/** 함께하는 사람: 모임장 → 공동 모임장 → 들어온 순서 */
	const membersOf = (circleId) => all(`SELECT u.id, u.nickname,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' WHEN m.role = 'helper' THEN 'helper' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ?
        ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 WHEN m.role = 'helper' THEN 2 ELSE 3 END, m.joined_at, m.rowid`, circleId);
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
			news: circle.news,
			newsAt: circle.news_at,
			isOwner,
			isManager: circle.manager,
			closedAt: circle.closed_at,
			questionSet: lab("group") ? circle.question_set : "",
			prompts: lab("group") ? readPrompts(circle.prompts) : null,
			isHelper: circle.helper,
			events: lab("group") ? eventsOf(circle.id, u.id) : [],
			orgs: circle.manager && lab("org") ? all("SELECT id, name FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(circle_ids) WHERE value = ?)", circle.id) : void 0,
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
		const role = c.body.role === "co" ? "co" : c.body.role === "helper" && lab("group") ? "helper" : "";
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
		return reportOf(circle.id);
	});
	/** 모임 리포트: 누가 그렸는지 없이 모임 전체의 흐름 (모임장 · 기관 담당자) */
	function reportOf(circleId) {
		const circle = { id: circleId };
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
	}
	const todayKst = () => new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);
	const daysAgoKst = (n) => (/* @__PURE__ */ new Date(Date.now() + 9 * HOUR - n * 24 * HOUR)).toISOString().slice(0, 10);
	/** 다가오는 일정 + 지난 7일 (출석을 남길 수 있게). count = 참여 인원, mine = 내가 참여했는지 */
	const eventsOf = (circleId, userId = "") => all(`SELECT e.id, e.day, e.title, (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS count,
              EXISTS (SELECT 1 FROM attendance a WHERE a.event_id = e.id AND a.user_id = ?) AS mine
         FROM events e WHERE e.circle_id = ? AND e.day >= ? ORDER BY e.day, e.created_at LIMIT 20`, userId, circleId, daysAgoKst(7)).map((e) => ({
		...e,
		mine: e.mine === 1
	}));
	const nextEventOf = (circleId) => one("SELECT id, day, title FROM events WHERE circle_id = ? AND day >= ? ORDER BY day, created_at LIMIT 1", circleId, todayKst()) ?? null;
	on("POST", "/groups/:id/events/:eid/attend", (c) => {
		labs("group");
		const u = me(c);
		memberOf(c.params.id, u.id);
		const ev = one("SELECT day FROM events WHERE id = ? AND circle_id = ?", c.params.eid, c.params.id);
		if (!ev) throw new HttpError(404, "일정을 찾을 수 없어요.");
		if (ev.day > todayKst()) throw new HttpError(400, "활동 날부터 참여를 남길 수 있어요.");
		if (ev.day < daysAgoKst(7)) throw new HttpError(400, "지난 지 7일이 넘은 활동이에요.");
		if (one("SELECT 1 FROM attendance WHERE event_id = ? AND user_id = ?", c.params.eid, u.id)) run("DELETE FROM attendance WHERE event_id = ? AND user_id = ?", c.params.eid, u.id);
		else run("INSERT INTO attendance (event_id, user_id, at) VALUES (?, ?, ?)", c.params.eid, u.id, now());
		return {
			mine: !!one("SELECT 1 FROM attendance WHERE event_id = ? AND user_id = ?", c.params.eid, u.id),
			count: one("SELECT COUNT(*) AS n FROM attendance WHERE event_id = ?", c.params.eid).n
		};
	});
	on("POST", "/groups/:id/copy", (c) => {
		labs("group");
		const u = me(c);
		const src = memberOf(c.params.id, u.id);
		if (!src.manager) throw new HttpError(403, "모임장 · 공동 모임장만 복제할 수 있어요.");
		const { name } = groupInfo({ name: c.body.name });
		let code = newCode();
		while (one("SELECT 1 FROM circles WHERE code = ?", code)) code = newCode();
		const id = newId();
		run("INSERT INTO circles (id, name, intro, code, owner_id, created_at, preset, topic, topic_at, question_set, prompts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, name, src.intro, code, u.id, now(), src.preset, src.topic, src.topic ? now() : "", src.question_set, src.prompts);
		run("INSERT INTO members (circle_id, user_id, joined_at) VALUES (?, ?, ?)", id, u.id, now());
		return {
			id,
			code
		};
	});
	on("POST", "/groups/:id/events", (c) => {
		labs("group");
		const u = me(c);
		const ec = memberOf(c.params.id, u.id);
		if (!ec.crew) throw new HttpError(403, "모임장 · 공동 모임장 · 도우미만 일정을 정할 수 있어요.");
		openCircle(ec.closed_at);
		const day = str(c.body.day, 10);
		const title = clean(c.body.title).slice(0, 40);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, "날짜를 골라 주세요.");
		if (day < todayKst()) throw new HttpError(400, "오늘이나 그 뒤의 날짜를 골라 주세요.");
		if (!title) throw new HttpError(400, "무엇을 하는지 적어 주세요.");
		if (one("SELECT COUNT(*) AS n FROM events WHERE circle_id = ? AND day >= ?", c.params.id, todayKst()).n >= 20) throw new HttpError(400, "다가오는 일정은 20개까지 둘 수 있어요.");
		const id = newId();
		run("INSERT INTO events (id, circle_id, day, title, created_at) VALUES (?, ?, ?, ?, ?)", id, c.params.id, day, title, now());
		return {
			id,
			day,
			title
		};
	});
	on("DELETE", "/groups/:id/events/:eid", (c) => {
		labs("group");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).crew) throw new HttpError(403, "모임장 · 공동 모임장 · 도우미만 일정을 지울 수 있어요.");
		run("DELETE FROM events WHERE id = ? AND circle_id = ?", c.params.eid, c.params.id);
	});
	const guardianByToken = (token) => {
		const t = str(token, 64);
		if (t.length < 16) return null;
		const row = one("SELECT id, nickname, guardian FROM users WHERE guardian <> '' AND json_extract(guardian, '$.token') = ?", t);
		return row ? {
			...row,
			g: JSON.parse(row.guardian)
		} : null;
	};
	on("GET", "/me/guardian", (c) => {
		labs("guardian");
		const u = me(c);
		const raw = one("SELECT guardian FROM users WHERE id = ?", u.id)?.guardian;
		if (!raw) return { needed: false };
		const g = JSON.parse(raw);
		return {
			needed: true,
			relation: g.relation,
			confirmed: !!g.confirmedAt,
			token: g.confirmedAt ? null : g.token ?? null
		};
	});
	on("GET", "/guardian/:token", (c) => {
		labs("guardian");
		const r = guardianByToken(c.params.token);
		if (!r) throw new HttpError(404, "확인 링크를 찾을 수 없어요. 아이에게 링크를 다시 받아 주세요.");
		return {
			nickname: r.nickname,
			relation: r.g.relation,
			confirmed: !!r.g.confirmedAt,
			confirmedAt: r.g.confirmedAt ?? ""
		};
	});
	on("POST", "/guardian/:token", (c) => {
		labs("guardian");
		linkMiss.check(c.ip);
		const r = guardianByToken(c.params.token);
		if (!r) {
			linkMiss.hit(c.ip);
			throw new HttpError(404, "확인 링크를 찾을 수 없어요. 아이에게 링크를 다시 받아 주세요.");
		}
		if (c.body.agree !== true) throw new HttpError(400, "동의 칸을 확인해 주세요.");
		if (!r.g.confirmedAt) run("UPDATE users SET guardian = ? WHERE id = ?", JSON.stringify({
			...r.g,
			confirmedAt: now()
		}), r.id);
		return { confirmed: true };
	});
	/** 기관 연결 코드 (모임장이 자기 모임을 기관에 이을 때). 없던 기관이면 이때 만든다 */
	const orgCode = (o) => {
		if (o.code) return o.code;
		let code = newCode();
		while (one("SELECT 1 FROM orgs WHERE code = ?", code)) code = newCode();
		run("UPDATE orgs SET code = ? WHERE id = ?", code, o.id);
		return code;
	};
	/** 내가 담당자인 기관 (아니면 404 — 일반 회원은 기관이 있는지도 모르게) */
	const myOrg = (id, userId) => {
		const o = one("SELECT * FROM orgs WHERE id = ? AND EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?)", id, userId);
		if (!o) throw new HttpError(404, "맡은 기관을 찾을 수 없어요.");
		return o;
	};
	const orgView = (o) => {
		const ids = JSON.parse(o.circle_ids);
		const mids = JSON.parse(o.manager_ids);
		return {
			id: o.id,
			name: o.name,
			createdAt: o.created_at,
			invite: o.invite,
			groups: ids.map((id) => one("SELECT id, name, code FROM circles WHERE id = ?", id)).filter((g) => !!g),
			managers: mids.map((id) => one("SELECT id, nickname FROM users WHERE id = ?", id)).filter((m) => !!m)
		};
	};
	on("GET", "/orgs", (c) => {
		labs("org");
		const u = me(c);
		const mine = all("SELECT * FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?) ORDER BY name", u.id);
		const q = new URL(c.req.url ?? "", "http://x").searchParams;
		const ymd = (s) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
		const from = ymd(q.get("from")), to = ymd(q.get("to"));
		if (from && to && (to < from || Date.parse(to) - Date.parse(from) > 8784 * HOUR)) throw new HttpError(400, "기간은 하루에서 1년 사이로 골라 주세요.");
		const kst = (col) => `date(${col}, '+9 hours') BETWEEN ? AND ?`;
		const periodOf = (id) => from && to ? {
			joined: one(`SELECT COUNT(*) AS n FROM members WHERE circle_id = ? AND ${kst("joined_at")}`, id, from, to).n,
			graphs: one(`SELECT COUNT(*) AS n FROM graphs WHERE json_extract(data, '$.groupId') = ? AND ${kst("json_extract(data, '$.createdAt')")}`, id, from, to).n,
			posts: one(`SELECT COUNT(*) AS n FROM posts WHERE circle_id = ? AND ${kst("created_at")}`, id, from, to).n,
			cheers: one(`SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.circle_id = ? AND ${kst("ch.created_at")}`, id, from, to).n,
			events: one("SELECT COUNT(*) AS n FROM events WHERE circle_id = ? AND day BETWEEN ? AND ?", id, from, to).n,
			attended: one("SELECT COUNT(*) AS n FROM attendance a JOIN events e ON e.id = a.event_id WHERE e.circle_id = ? AND e.day BETWEEN ? AND ?", id, from, to).n
		} : null;
		if (q.get("lite") === "1") return mine.map((o) => ({
			id: o.id,
			name: o.name,
			groupIds: JSON.parse(o.circle_ids)
		}));
		return mine.map((o) => {
			const v = orgView(o);
			const groups = v.groups.map((g) => ({
				id: g.id,
				name: g.name,
				code: g.code,
				report: reportOf(g.id),
				period: periodOf(g.id)
			}));
			const sum = (k) => groups.reduce((t, g) => t + g.report[k], 0);
			return {
				id: v.id,
				name: v.name,
				code: orgCode(o),
				invite: o.invite,
				managers: v.managers.map((m) => ({
					id: m.id,
					nickname: m.nickname,
					me: m.id === u.id
				})),
				groups,
				total: {
					groups: groups.length,
					members: sum("members"),
					sharers: sum("sharers"),
					posts: sum("posts"),
					moments: sum("moments"),
					cheers: sum("cheers"),
					done: sum("done"),
					drawing: sum("drawing")
				}
			};
		});
	});
	on("PUT", "/groups/:id/closed", (c) => {
		labs("group");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 모임을 끝낼 수 있어요.");
		const at = c.body.closed === true ? now() : "";
		run("UPDATE circles SET closed_at = ? WHERE id = ?", at, c.params.id);
		return { closedAt: at };
	});
	on("POST", "/orgs", (c) => {
		labs("org");
		const u = me(c);
		if (c.body.agree !== true) throw new HttpError(400, "기관 등록 안내에 동의해 주세요.");
		if (one("SELECT guardian FROM users WHERE id = ?", u.id)?.guardian) throw new HttpError(403, "기관 등록은 기관의 어른 담당자만 할 수 있어요. 모임은 누구나 만들 수 있어요.");
		const name = clean(c.body.name).slice(0, 40);
		if (!name) throw new HttpError(400, "기관 이름을 적어 주세요.");
		if (one("SELECT COUNT(*) AS n FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?)", u.id).n >= 5) throw new HttpError(400, "기관은 한 사람이 5곳까지 맡을 수 있어요.");
		let code = newCode();
		while (one("SELECT 1 FROM orgs WHERE code = ?", code)) code = newCode();
		const id = newId();
		run("INSERT INTO orgs (id, name, circle_ids, manager_ids, created_at, code) VALUES (?, ?, ?, ?, ?, ?)", id, name, "[]", JSON.stringify([u.id]), now(), code);
		return {
			id,
			code
		};
	});
	on("PUT", "/orgs/:id", (c) => {
		labs("org");
		const o = myOrg(c.params.id, me(c).id);
		const name = clean(c.body.name).slice(0, 40);
		if (!name) throw new HttpError(400, "기관 이름을 적어 주세요.");
		run("UPDATE orgs SET name = ? WHERE id = ?", name, o.id);
		return { name };
	});
	on("DELETE", "/orgs/:id", (c) => {
		labs("org");
		const o = myOrg(c.params.id, me(c).id);
		run("DELETE FROM orgs WHERE id = ?", o.id);
	});
	on("POST", "/orgs/:id/code", (c) => {
		labs("org");
		const o = myOrg(c.params.id, me(c).id);
		let code = newCode();
		while (one("SELECT 1 FROM orgs WHERE code = ?", code)) code = newCode();
		run("UPDATE orgs SET code = ? WHERE id = ?", code, o.id);
		return { code };
	});
	on("POST", "/orgs/:id/invite", (c) => {
		labs("org");
		const o = myOrg(c.params.id, me(c).id);
		const token = randomBytes(18).toString("base64url");
		run("UPDATE orgs SET invite = ? WHERE id = ?", token, o.id);
		return { invite: token };
	});
	on("DELETE", "/orgs/:id/invite", (c) => {
		labs("org");
		const o = myOrg(c.params.id, me(c).id);
		run("UPDATE orgs SET invite = '' WHERE id = ?", o.id);
	});
	on("POST", "/orgs/:id/leave", (c) => {
		labs("org");
		const u = me(c);
		const o = myOrg(c.params.id, u.id);
		const mids = JSON.parse(o.manager_ids).filter((x) => x !== u.id);
		if (!mids.length) throw new HttpError(400, "마지막 담당자예요. 그만두려면 기관을 지워 주세요.");
		run("UPDATE orgs SET manager_ids = ? WHERE id = ?", JSON.stringify(mids), o.id);
	});
	on("POST", "/orgs/:id/groups", (c) => {
		labs("org");
		const u = me(c);
		const o = myOrg(c.params.id, u.id);
		const gid = str(c.body.groupId, 64);
		if (!memberOf(gid, u.id).manager) throw new HttpError(403, "내가 모임장 · 공동 모임장인 모임만 더할 수 있어요. 다른 모임은 그 모임장에게 연결 코드를 알려 주세요.");
		const ids = [.../* @__PURE__ */ new Set([...JSON.parse(o.circle_ids), gid])];
		run("UPDATE orgs SET circle_ids = ? WHERE id = ?", JSON.stringify(ids), o.id);
		return { groups: ids.length };
	});
	on("DELETE", "/orgs/:id/groups/:gid", (c) => {
		labs("org");
		const o = myOrg(c.params.id, me(c).id);
		run("UPDATE orgs SET circle_ids = ? WHERE id = ?", JSON.stringify(JSON.parse(o.circle_ids).filter((x) => x !== c.params.gid)), o.id);
	});
	on("POST", "/groups/:id/org", (c) => {
		labs("org");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 기관에 이을 수 있어요.");
		joinLimit.check(c.ip);
		const o = one("SELECT * FROM orgs WHERE code <> '' AND code = ?", str(c.body.code, 20).trim().toUpperCase());
		if (!o) {
			joinLimit.hit(c.ip);
			throw new HttpError(404, "그 연결 코드의 기관을 찾지 못했어요. 기관 담당자에게 한 번 더 확인해 주세요.");
		}
		run("UPDATE orgs SET circle_ids = ? WHERE id = ?", JSON.stringify([.../* @__PURE__ */ new Set([...JSON.parse(o.circle_ids), c.params.id])]), o.id);
		return {
			id: o.id,
			name: o.name
		};
	});
	on("DELETE", "/groups/:id/org", (c) => {
		labs("org");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 기관 연결을 끊을 수 있어요.");
		for (const o of all("SELECT * FROM orgs WHERE EXISTS (SELECT 1 FROM json_each(circle_ids) WHERE value = ?)", c.params.id)) run("UPDATE orgs SET circle_ids = ? WHERE id = ?", JSON.stringify(JSON.parse(o.circle_ids).filter((x) => x !== c.params.id)), o.id);
	});
	on("PUT", "/orgs/:id/news", (c) => {
		labs("org");
		const u = me(c);
		const o = one("SELECT * FROM orgs WHERE id = ? AND EXISTS (SELECT 1 FROM json_each(manager_ids) WHERE value = ?)", c.params.id, u.id);
		if (!o) throw new HttpError(404, "맡은 기관을 찾을 수 없어요.");
		const news = cleanText(c.body.news, 300);
		const at = news ? now() : "";
		const ids = JSON.parse(o.circle_ids);
		for (const id of ids) run("UPDATE circles SET news = ?, news_at = ? WHERE id = ? AND closed_at = ''", news, at, id);
		return {
			news,
			newsAt: at,
			groups: ids.length
		};
	});
	const orgByInvite = (token) => str(token, 64).length >= 16 ? one("SELECT * FROM orgs WHERE invite <> '' AND invite = ?", str(token, 64)) : void 0;
	on("GET", "/org-invite/:token", (c) => {
		labs("org");
		linkMiss.check(c.ip);
		const o = orgByInvite(c.params.token);
		if (!o) {
			linkMiss.hit(c.ip);
			throw new HttpError(404, "초대 링크가 꺼졌거나 없는 링크예요. 운영자에게 새 링크를 받아 주세요.");
		}
		return {
			name: o.name,
			groups: JSON.parse(o.circle_ids).length,
			already: !!c.user && JSON.parse(o.manager_ids).includes(c.user.id)
		};
	});
	on("POST", "/org-invite/:token", (c) => {
		labs("org");
		const u = me(c);
		linkMiss.check(c.ip);
		const o = orgByInvite(c.params.token);
		if (!o) {
			linkMiss.hit(c.ip);
			throw new HttpError(404, "초대 링크가 꺼졌거나 없는 링크예요. 운영자에게 새 링크를 받아 주세요.");
		}
		const mids = [.../* @__PURE__ */ new Set([...JSON.parse(o.manager_ids), u.id])];
		run("UPDATE orgs SET manager_ids = ?, invite = '' WHERE id = ?", JSON.stringify(mids), o.id);
		return {
			id: o.id,
			name: o.name
		};
	});
	on("PUT", "/groups/:id/news", (c) => {
		labs("group");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).crew) throw new HttpError(403, "모임장 · 공동 모임장 · 도우미만 소식을 올릴 수 있어요.");
		const news = cleanText(c.body.news, 300);
		const at = news ? now() : "";
		run("UPDATE circles SET news = ?, news_at = ? WHERE id = ?", news, at, c.params.id);
		return {
			news,
			newsAt: at
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
	on("PUT", "/groups/:id/question-set", (c) => {
		labs("group");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 질문 묶음을 정할 수 있어요.");
		const set = [
			"career",
			"relation",
			"school"
		].includes(c.body.set) ? c.body.set : "";
		run("UPDATE circles SET question_set = ? WHERE id = ?", set, c.params.id);
		return { questionSet: set };
	});
	on("PUT", "/groups/:id/prompts", (c) => {
		labs("group");
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 질문을 정할 수 있어요.");
		const prompts = sanitizePrompts(c.body.prompts);
		const empty = !Object.keys(prompts).length;
		run("UPDATE circles SET prompts = ? WHERE id = ?", empty ? "" : JSON.stringify(prompts), c.params.id);
		return { prompts: empty ? null : prompts };
	});
	on("PUT", "/groups/:id/preset", (c) => {
		const u = me(c);
		if (!memberOf(c.params.id, u.id).manager) throw new HttpError(403, "모임장 · 공동 모임장만 나의 시간을 정할 수 있어요.");
		const preset = sanitizePreset(c.body.preset);
		if (preset?.choice === "hour" && !lab("graph")) throw new HttpError(400, "나의 시간을 한 번 더 확인해 주세요.");
		run("UPDATE circles SET preset = ? WHERE id = ?", preset ? JSON.stringify(preset) : "", c.params.id);
		return { preset };
	});
	const byCode = (c) => {
		joinLimit.check(c.ip);
		const circle = one("SELECT id, name, intro, preset, closed_at FROM circles WHERE code = ?", c.params.code.toUpperCase());
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
			id: joined ? circle.id : void 0,
			closed: !!circle.closed_at
		};
	});
	on("POST", "/invite/:code", (c) => {
		const circle = byCode(c);
		if (!(c.user && isMember(circle.id, c.user.id))) openCircle(circle.closed_at);
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
		openCircle(memberOf(c.params.id, u.id).closed_at);
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
		run("INSERT INTO links (code, user_id, graph_id, data, created_at) VALUES (?, ?, ?, ?, ?)", code, c.user?.id ?? null, graphId, JSON.stringify(shared), now());
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
	const maintenance = () => {
		if (!lab("ops")) return null;
		const v = one("SELECT value FROM meta WHERE key = 'maintenance'")?.value;
		try {
			return v ? JSON.parse(v) : null;
		} catch {
			return null;
		}
	};
	on("GET", "/config", () => {
		const m = maintenance();
		return {
			...site(),
			dev: !!opts.devServer,
			flags: FLAGS.filter((f) => lab(f.key)).map((f) => f.key),
			...m?.on ? { maintenance: {
				message: m.message,
				at: m.at
			} } : {}
		};
	});
	on("GET", "/admin/maintenance", (c) => {
		labs("ops");
		admin(c);
		return maintenance() ?? {
			on: false,
			message: "",
			at: ""
		};
	});
	on("PUT", "/admin/maintenance", (c) => {
		labs("ops");
		admin(c);
		const m = {
			on: c.body.on === true,
			message: cleanText(c.body.message, 200),
			at: now()
		};
		run("INSERT INTO meta (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(m));
		return m;
	});
	on("GET", "/health", (c) => {
		labs("ops");
		one("SELECT 1 FROM meta LIMIT 1");
		let free = -1;
		try {
			const f = statfsSync(opts.backupDir ?? tmpdir());
			free = f.bavail * f.bsize;
		} catch {}
		if (free >= 0 && free < 52428800) {
			c.res.writeHead(503, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store"
			});
			c.res.end(JSON.stringify({
				ok: false,
				reason: "disk"
			}));
			return RAW;
		}
		return {
			ok: true,
			uptimeSec: Math.round((Date.now() - started) / 1e3)
		};
	});
	const scrubUrl = (x) => {
		const s = str(x, 500);
		if (!s || !/^https?:/.test(s)) return s.slice(0, 60);
		try {
			const u = new URL(s);
			const path = u.pathname.replace(/\/(guardian|join|s|org-invite|groups|graph|invite)\/[^/]+/g, "/$1/…");
			return (opts.publicUrl && u.origin === new URL(opts.publicUrl).origin ? "" : u.origin) + path;
		} catch {
			return "";
		}
	};
	on("POST", "/csp-report", (c) => {
		labs("ops");
		cspLimit.check(c.ip);
		cspLimit.hit(c.ip);
		const items = Array.isArray(c.body) ? c.body.map((r) => r?.body ?? {}) : [c.body["csp-report"] ?? {}];
		for (const r of items.slice(0, 10)) {
			const directive = str(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"], 60).split(" ")[0];
			if (!directive) continue;
			const blocked = scrubUrl(r["blocked-uri"] ?? r.blockedURL), page = scrubUrl(r["document-uri"] ?? r.documentURL);
			const line = r["line-number"] ?? r.lineNumber;
			const source = scrubUrl(r["source-file"] ?? r.sourceFile) + (line ? `:${int(line)}` : "");
			const key = sha(`${directive}|${blocked}|${page}`);
			run(`INSERT INTO csp_reports (key, directive, blocked, page, source, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET count = count + 1, last_at = excluded.last_at, source = excluded.source`, key, directive, blocked, page, source, now(), now());
		}
		run("DELETE FROM csp_reports WHERE key IN (SELECT key FROM csp_reports ORDER BY last_at DESC LIMIT -1 OFFSET 300)");
	});
	const savedNotice = () => {
		const v = one("SELECT value FROM meta WHERE key = 'notice'")?.value;
		try {
			return v ? JSON.parse(v) : null;
		} catch {
			return null;
		}
	};
	on("GET", "/notice", () => {
		const n = savedNotice();
		const t = now();
		const inWindow = !n || (!n.from || n.from <= t) && (!n.to || t < n.to);
		return { notice: n?.on && (n.title || n.body) && inWindow ? {
			title: n.title,
			body: n.body,
			at: n.at
		} : null };
	});
	const ADMIN_COOKIE = "gb_admin";
	const same = (a, b) => timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));
	const adminOf = (req) => {
		const token = cookieOf(req, ADMIN_COOKIE);
		if (!opts.admin || !token) return null;
		const row = one("SELECT expires_at, who, role FROM admin_sessions WHERE token_hash = ?", sha(token));
		if (!row || row.expires_at <= now()) return null;
		if (row.role === "owner") return {
			who: opts.admin.id,
			role: "owner"
		};
		const acc = lab("ops") ? one("SELECT role FROM admin_accounts WHERE id = ?", row.who) : void 0;
		return acc ? {
			who: row.who,
			role: acc.role === "full" ? "full" : "viewer"
		} : null;
	};
	const admin = (c) => {
		const a = adminOf(c.req);
		if (!a) throw new HttpError(401, "관리자 로그인이 필요해요.");
		const path = new URL(c.req.url ?? "", "http://x").pathname.replace(/^\/api/, "");
		if (a.role === "viewer" && (c.req.method !== "GET" || /^\/admin\/(backup|backups\/)/.test(path))) throw new HttpError(403, "열람 전용 관리자예요. 바꾸거나 DB 를 내려받는 일은 할 수 없어요.");
		return a;
	};
	const owner = (c) => {
		const a = admin(c);
		if (a.role !== "owner") throw new HttpError(403, "처음 관리자(.env)만 할 수 있어요.");
		return a;
	};
	const hashPw = (pw) => {
		const salt = randomBytes(16);
		return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
	};
	const checkPw = (pw, stored) => {
		const [salt, hash] = stored.split(":");
		if (!salt || !hash) return false;
		return timingSafeEqual(scryptSync(pw, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
	};
	const dormantSince = (months) => (/* @__PURE__ */ new Date(Date.now() - months * 30.44 * 24 * HOUR)).toISOString();
	const dormantMonths = (x) => Math.max(3, Math.min(60, Math.floor(Number(x)) || 12));
	on("GET", "/admin/dormant", (c) => {
		labs("ops");
		admin(c);
		const months = dormantMonths(new URL(c.req.url ?? "", "http://x").searchParams.get("months"));
		return {
			months,
			users: all(`SELECT u.id, u.nickname, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
                (SELECT COUNT(*) FROM graphs g WHERE g.user_id = u.id) AS graphCount
           FROM users u WHERE COALESCE(NULLIF(u.last_seen_at, ''), u.created_at) < ? ORDER BY COALESCE(NULLIF(u.last_seen_at, ''), u.created_at) LIMIT 500`, dormantSince(months))
		};
	});
	/** 고른 휴면 계정을 지운다. 지우는 순간에도 휴면인지 다시 확인한다 (그 사이 다녀간 사람은 남긴다) */
	on("POST", "/admin/dormant/purge", (c) => {
		labs("ops");
		admin(c);
		const months = dormantMonths(c.body.months);
		const ids = Array.isArray(c.body.ids) ? c.body.ids.map((x) => str(x, 64)).slice(0, 500) : [];
		let deleted = 0;
		for (const id of ids) if (one("SELECT 1 FROM users WHERE id = ? AND COALESCE(NULLIF(last_seen_at, ''), created_at) < ?", id, dormantSince(months))) {
			run("DELETE FROM users WHERE id = ?", id);
			deleted++;
		}
		logPurge("휴면 정리", deleted);
		return { deleted };
	});
	on("GET", "/admin/errors", (c) => {
		labs("ops");
		admin(c);
		return all("SELECT at, method, path, message, stack FROM error_log ORDER BY id DESC LIMIT 200");
	});
	on("GET", "/admin/orgs", (c) => {
		labs("org");
		admin(c);
		return all("SELECT * FROM orgs ORDER BY created_at DESC").map(orgView);
	});
	/** 기관 만들기(id = new) · 고치기: 이름, 모임 참여 코드들, 담당자 계정 id 들 */
	on("PUT", "/admin/orgs/:id", (c) => {
		labs("org");
		admin(c);
		const name = clean(c.body.name).slice(0, 40);
		if (!name) throw new HttpError(400, "기관 이름을 적어 주세요.");
		const codes = Array.isArray(c.body.codes) ? c.body.codes.map((x) => str(x, 20).trim().toUpperCase()).filter(Boolean) : [];
		const circleIds = [...new Set(codes.map((code) => {
			const r = one("SELECT id FROM circles WHERE code = ?", code);
			if (!r) throw new HttpError(400, `‘${code}’ 코드의 모임을 찾지 못했어요.`);
			return r.id;
		}))];
		const managerIds = [...new Set((Array.isArray(c.body.managerIds) ? c.body.managerIds : []).map((x) => str(x, 64)).filter(Boolean))];
		for (const mid of managerIds) if (!one("SELECT 1 FROM users WHERE id = ?", mid)) throw new HttpError(400, "없는 계정이 담당자에 들어 있어요.");
		const id = c.params.id === "new" ? newId() : c.params.id;
		if (c.params.id === "new") run("INSERT INTO orgs (id, name, circle_ids, manager_ids, created_at) VALUES (?, ?, ?, ?, ?)", id, name, JSON.stringify(circleIds), JSON.stringify(managerIds), now());
		else if (!one("SELECT 1 FROM orgs WHERE id = ?", id)) throw new HttpError(404, "기관을 찾을 수 없어요.");
		else run("UPDATE orgs SET name = ?, circle_ids = ?, manager_ids = ? WHERE id = ?", name, JSON.stringify(circleIds), JSON.stringify(managerIds), id);
		return orgView(one("SELECT * FROM orgs WHERE id = ?", id));
	});
	on("DELETE", "/admin/orgs/:id", (c) => {
		labs("org");
		admin(c);
		run("DELETE FROM orgs WHERE id = ?", c.params.id);
	});
	on("GET", "/me/cheers/:year", (c) => {
		labs("me");
		const u = me(c);
		const y = /^\d{4}$/.test(c.params.year) ? c.params.year : String((/* @__PURE__ */ new Date()).getFullYear());
		return {
			year: +y,
			received: one("SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ? AND substr(date(ch.created_at, '+9 hours'), 1, 4) = ?", u.id, y).n
		};
	});
	on("GET", "/admin/me", (c) => {
		const a = adminOf(c.req);
		const alerts = a ? {
			reports: one("SELECT COUNT(*) AS n FROM reports WHERE resolved_at = '' AND deleted_at = ''").n,
			inquiries: lab("ops") ? one("SELECT COUNT(*) AS n FROM inquiries WHERE status = '새 문의'").n : 0
		} : void 0;
		return {
			enabled: !!opts.admin,
			admin: !!a,
			who: a?.who ?? "",
			role: a?.role ?? "",
			alerts
		};
	});
	on("GET", "/admin/accounts", (c) => {
		labs("ops");
		owner(c);
		return all("SELECT a.id, a.role, a.created_at AS createdAt, (SELECT MAX(at) FROM admin_logins l WHERE l.who = a.id AND l.ok = 1) AS lastLogin FROM admin_accounts a ORDER BY a.created_at");
	});
	on("PUT", "/admin/accounts/:id", (c) => {
		labs("ops");
		owner(c);
		const id = c.params.id.toLowerCase();
		if (!/^[a-z0-9_-]{3,20}$/.test(id)) throw new HttpError(400, "아이디는 영어 소문자 · 숫자 · - · _ 로 3~20자예요.");
		if (id === opts.admin.id.toLowerCase()) throw new HttpError(400, "처음 관리자와 같은 아이디는 쓸 수 없어요.");
		const role = c.body.role === "full" ? "full" : "viewer";
		const pw = str(c.body.password, 200);
		const has = one("SELECT 1 FROM admin_accounts WHERE id = ?", id);
		if (pw && pw.length < 12) throw new HttpError(400, "비밀번호는 12자 이상이어야 해요.");
		if (!has && !pw) throw new HttpError(400, "새 계정은 비밀번호(12자 이상)를 정해 주세요.");
		if (has && pw) run("UPDATE admin_accounts SET role = ?, pw_hash = ? WHERE id = ?", role, hashPw(pw), id);
		else if (has) run("UPDATE admin_accounts SET role = ? WHERE id = ?", role, id);
		else run("INSERT INTO admin_accounts (id, pw_hash, role, created_at) VALUES (?, ?, ?, ?)", id, hashPw(pw), role, now());
		if (has) run("DELETE FROM admin_sessions WHERE who = ? AND role <> 'owner'", id);
		return {
			id,
			role
		};
	});
	on("DELETE", "/admin/accounts/:id", (c) => {
		labs("ops");
		owner(c);
		run("DELETE FROM admin_accounts WHERE id = ?", c.params.id);
		run("DELETE FROM admin_sessions WHERE who = ? AND role <> 'owner'", c.params.id);
	});
	on("GET", "/admin/funnel", (c) => {
		labs("ops");
		admin(c);
		const q = new URL(c.req.url ?? "", "http://x").searchParams;
		const day = (s) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
		const to = day(q.get("to")) ?? new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);
		const from = day(q.get("from")) ?? (/* @__PURE__ */ new Date(Date.parse(to) - 2136 * HOUR)).toISOString().slice(0, 10);
		if (to < from) throw new HttpError(400, "기간을 다시 골라 주세요.");
		return {
			from,
			to,
			...one(`SELECT COUNT(*) AS signup,
              COALESCE(SUM(EXISTS (SELECT 1 FROM graphs g WHERE g.user_id = u.id)), 0) AS started,
              COALESCE(SUM(EXISTS (SELECT 1 FROM graphs g WHERE g.user_id = u.id AND json_array_length(g.data, '$.entries') > 0)), 0) AS moment,
              COALESCE(SUM(EXISTS (SELECT 1 FROM graphs g WHERE g.user_id = u.id AND json_extract(g.data, '$.completed') = 1)), 0) AS done,
              COALESCE(SUM(EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id) OR EXISTS (SELECT 1 FROM links l WHERE l.user_id = u.id)), 0) AS shared,
              COALESCE(SUM(EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id)), 0) AS grouped
         FROM users u WHERE date(u.created_at, '+9 hours') BETWEEN ? AND ?`, from, to)
		};
	});
	on("GET", "/admin/csp", (c) => {
		labs("ops");
		admin(c);
		return all("SELECT directive, blocked, page, source, count, first_at AS firstAt, last_at AS lastAt FROM csp_reports ORDER BY last_at DESC LIMIT 300");
	});
	on("DELETE", "/admin/csp", (c) => {
		labs("ops");
		admin(c);
		run("DELETE FROM csp_reports");
	});
	const savedTerms = () => {
		const v = one("SELECT value FROM meta WHERE key = 'terms'")?.value;
		try {
			return v ? JSON.parse(v) : null;
		} catch {
			return null;
		}
	};
	on("GET", "/me/terms", (c) => {
		if (!lab("me") || !c.user) return { need: false };
		const t = savedTerms();
		const agreed = one("SELECT agreed_at FROM users WHERE id = ?", c.user.id)?.agreed_at ?? "";
		return t && agreed < t.at ? {
			need: true,
			summary: t.summary,
			at: t.at
		} : { need: false };
	});
	on("POST", "/me/agree", (c) => {
		labs("me");
		const u = me(c);
		if (c.body.agree !== true) throw new HttpError(400, "바뀐 약관을 확인하고 동의해 주세요.");
		run("UPDATE users SET agreed_at = ? WHERE id = ?", now(), u.id);
	});
	on("GET", "/admin/terms", (c) => {
		labs("ops");
		admin(c);
		const t = savedTerms();
		return {
			summary: t?.summary ?? "",
			at: t?.at ?? "",
			agreed: t ? one("SELECT COUNT(*) AS n FROM users WHERE agreed_at >= ?", t.at).n : 0,
			users: one("SELECT COUNT(*) AS n FROM users").n
		};
	});
	on("PUT", "/admin/terms", (c) => {
		labs("ops");
		admin(c);
		const summary = cleanText(c.body.summary, 1e3);
		if (summary.length < 5) throw new HttpError(400, "무엇이 바뀌었는지 적어 주세요.");
		const t = {
			summary,
			at: now()
		};
		run("INSERT INTO meta (key, value) VALUES ('terms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(t));
		return t;
	});
	on("GET", "/admin/health", (c) => {
		labs("ops");
		admin(c);
		const sorted = [...timings].sort((a, b) => a - b);
		const pct = (p) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]) : 0;
		let disk = null;
		try {
			const f = statfsSync(opts.backupDir ?? tmpdir());
			disk = {
				free: f.bavail * f.bsize,
				total: f.blocks * f.bsize
			};
		} catch {}
		const m = process.memoryUsage();
		return {
			startedAt: new Date(started).toISOString(),
			uptimeSec: Math.round((Date.now() - started) / 1e3),
			node: process.version,
			memory: {
				rss: m.rss,
				heap: m.heapUsed
			},
			storage: storageOf(db, autoDir),
			disk,
			requests: {
				served,
				failed,
				recent: sorted.length,
				avg: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
				p50: pct(.5),
				p95: pct(.95),
				max: pct(1)
			},
			errors24h: one("SELECT COUNT(*) AS n FROM error_log WHERE at >= ?", (/* @__PURE__ */ new Date(Date.now() - 24 * HOUR)).toISOString()).n
		};
	});
	const keepNow = () => backupKeepOf(db, opts.backupKeep ?? 168);
	on("GET", "/admin/backups", (c) => {
		labs("ops");
		admin(c);
		return {
			keep: keepNow(),
			dir: !!autoDir,
			folder: opts.autoBackupDir ? "그려봄 폴더의 backups" : "볼륨 안 backups",
			files: listBackups(autoDir)
		};
	});
	on("PUT", "/admin/backups", (c) => {
		labs("ops");
		admin(c);
		const keep = Math.max(0, Math.min(2e3, Math.floor(Number(c.body.keep))));
		if (!Number.isFinite(keep)) throw new HttpError(400, "남길 개수를 숫자로 적어 주세요.");
		run("INSERT INTO meta (key, value) VALUES ('backup_keep', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(keep));
		return { keep };
	});
	on("POST", "/admin/backups/run", (c) => {
		labs("ops");
		admin(c);
		if (!autoDir) throw new HttpError(400, "백업 폴더가 정해지지 않은 서버예요.");
		const before = listBackups(autoDir).length;
		const f = maintain(db, autoDir, Math.max(1, keepNow()));
		return {
			file: f ? basename(f) : null,
			made: listBackups(autoDir).length > before
		};
	});
	on("GET", "/admin/backups/:name", (c) => {
		labs("ops");
		admin(c);
		if (!/^auto-\d{4}-\d{2}-\d{2}(-\d{2})?$/.test(c.params.name) || !autoDir) throw new HttpError(404, "찾을 수 없어요.");
		const file = join(autoDir, `${c.params.name}.db`);
		if (!existsSync(file)) throw new HttpError(404, "찾을 수 없어요.");
		c.res.writeHead(200, {
			"Content-Type": "application/vnd.sqlite3",
			"Content-Disposition": `attachment; filename="geuryeobom-${c.params.name}.db"`,
			"Cache-Control": "no-store"
		});
		c.res.end(readFileSync(file));
		return RAW;
	});
	on("GET", "/admin/blocks", (c) => {
		labs("ops");
		admin(c);
		const alias = (ip) => one("SELECT alias FROM ip_aliases WHERE ip = ?", ip)?.alias ?? "";
		return LIMITS.flatMap(([label, kind, l]) => l.blocked().map((b) => ({
			limit: label,
			kind,
			key: b.key,
			n: b.n,
			until: b.until,
			shown: kind === "ip" ? b.key : kind === "name" ? `이름 (가려짐 · ${b.key.slice(0, 8)})` : kind === "user" ? one("SELECT nickname FROM users WHERE id = ?", b.key)?.nickname ?? b.key : "모든 IP 합계",
			alias: kind === "ip" ? alias(b.key) : ""
		})));
	});
	on("POST", "/admin/blocks/release", (c) => {
		labs("ops");
		admin(c);
		const hit = LIMITS.find(([label]) => label === str(c.body.limit, 40));
		if (!hit) throw new HttpError(404, "찾을 수 없어요.");
		hit[2].reset(str(c.body.key, 200));
	});
	const PRIVACY_KINDS = [
		"열람",
		"정정",
		"삭제",
		"처리정지",
		"그 밖의 문의"
	];
	const PRIVACY_STATUS = [
		"받음",
		"처리 중",
		"완료",
		"거절"
	];
	on("GET", "/admin/privacy", (c) => {
		labs("ops");
		admin(c);
		return all("SELECT id, kind, who, detail, received_at AS receivedAt, status, done_at AS doneAt, note FROM privacy_requests ORDER BY status IN ('완료', '거절'), received_at DESC LIMIT 500");
	});
	on("PUT", "/admin/privacy/:id", (c) => {
		labs("ops");
		admin(c);
		const kind = PRIVACY_KINDS.includes(c.body.kind) ? c.body.kind : "";
		const status = PRIVACY_STATUS.includes(c.body.status) ? c.body.status : "받음";
		if (!kind) throw new HttpError(400, "요청 종류를 골라 주세요.");
		const day = str(c.body.receivedAt, 10);
		const received = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : now().slice(0, 10);
		const who = clean(c.body.who).slice(0, 60), detail = cleanText(c.body.detail, 500), note = cleanText(c.body.note, 500);
		const done = status === "완료" || status === "거절";
		if (c.params.id === "new") {
			const id = newId();
			run("INSERT INTO privacy_requests (id, kind, who, detail, received_at, status, done_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, kind, who, detail, received, status, done ? now() : "", note);
			return { id };
		}
		const prev = one("SELECT done_at FROM privacy_requests WHERE id = ?", c.params.id);
		if (!prev) throw new HttpError(404, "찾을 수 없어요.");
		run("UPDATE privacy_requests SET kind = ?, who = ?, detail = ?, received_at = ?, status = ?, done_at = ?, note = ? WHERE id = ?", kind, who, detail, received, status, done ? prev.done_at || now() : "", note, c.params.id);
		return { id: c.params.id };
	});
	on("DELETE", "/admin/privacy/:id", (c) => {
		labs("ops");
		admin(c);
		run("DELETE FROM privacy_requests WHERE id = ?", c.params.id);
	});
	on("POST", "/admin/orgs/:id/invite", (c) => {
		labs("org");
		admin(c);
		const token = randomBytes(18).toString("base64url");
		if (!run("UPDATE orgs SET invite = ? WHERE id = ?", token, c.params.id).changes) throw new HttpError(404, "기관을 찾을 수 없어요.");
		return { invite: token };
	});
	on("DELETE", "/admin/orgs/:id/invite", (c) => {
		labs("org");
		admin(c);
		run("UPDATE orgs SET invite = '' WHERE id = ?", c.params.id);
	});
	on("POST", "/admin/login", (c) => {
		if (!opts.admin) throw new HttpError(404, "관리자 기능이 꺼져 있어요. 서버의 .env 에 ADMIN_ID · ADMIN_PASSWORD 를 정해 주세요.");
		adminLimit.check(c.ip);
		adminAll.check("all");
		const id = str(c.body.id, 100), pw = str(c.body.password, 200);
		const idOk = same(id, opts.admin.id);
		const pwOk = same(pw, opts.admin.password);
		let who = idOk && pwOk ? {
			who: opts.admin.id,
			role: "owner"
		} : null;
		if (!who && lab("ops")) {
			const acc = one("SELECT id, pw_hash, role FROM admin_accounts WHERE id = ?", id.toLowerCase());
			if (acc && checkPw(pw, acc.pw_hash)) who = {
				who: acc.id,
				role: acc.role === "full" ? "full" : "viewer"
			};
		}
		run("INSERT INTO admin_logins (ip, ok, agent, at, who) VALUES (?, ?, ?, ?, ?)", c.ip, who ? 1 : 0, str(c.req.headers["user-agent"], 300), now(), who?.who ?? "");
		run("DELETE FROM admin_logins WHERE id <= (SELECT MAX(id) - 2000 FROM admin_logins)");
		if (!who) {
			adminLimit.hit(c.ip);
			adminAll.hit("all");
			throw new HttpError(401, "관리자 아이디나 비밀번호가 맞지 않아요.");
		}
		adminLimit.reset(c.ip);
		const token = randomBytes(32).toString("base64url");
		run("DELETE FROM admin_sessions WHERE expires_at < ?", now());
		run("INSERT INTO admin_sessions (token_hash, expires_at, who, role) VALUES (?, ?, ?, ?)", sha(token), new Date(Date.now() + 8 * HOUR).toISOString(), who.who, who.role);
		setCookie(c.res, token, null, ADMIN_COOKIE);
	});
	on("POST", "/admin/logout", (c) => {
		const token = cookieOf(c.req, ADMIN_COOKIE);
		if (token) run("DELETE FROM admin_sessions WHERE token_hash = ?", sha(token));
		setCookie(c.res, "", 0, ADMIN_COOKIE);
	});
	on("GET", "/admin/stats", (c) => {
		labs("ops");
		admin(c);
		const q = new URL(c.req.url ?? "", "http://x").searchParams;
		const day = (s) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
		const to = day(q.get("to")) ?? new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);
		const from = day(q.get("from")) ?? (/* @__PURE__ */ new Date(Date.parse(to) - 696 * HOUR)).toISOString().slice(0, 10);
		const n = Math.round((Date.parse(to) - Date.parse(from)) / (24 * HOUR)) + 1;
		if (n < 1 || n > 366) throw new HttpError(400, "기간은 하루에서 1년 사이로 골라 주세요.");
		const days = Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 24 * HOUR).toISOString().slice(0, 10));
		const per = (table, col) => {
			const rows = all(`SELECT date(${col}, '+9 hours') AS day, COUNT(*) AS n FROM ${table} WHERE date(${col}, '+9 hours') BETWEEN ? AND ? GROUP BY day`, from, to);
			return (d) => rows.find((r) => r.day === d)?.n ?? 0;
		};
		const made = "json_extract(data, '$.createdAt')";
		const s = per("users", "created_at"), g = per("graphs", made), p = per("posts", "created_at"), ch = per("cheers", "created_at"), gr = per("circles", "created_at");
		const a = all("SELECT day, COUNT(*) AS n FROM answers WHERE day BETWEEN ? AND ? GROUP BY day", from, to);
		const rows = days.map((d) => ({
			day: d,
			signups: s(d),
			graphs: g(d),
			groups: gr(d),
			posts: p(d),
			cheers: ch(d),
			answers: a.find((r) => r.day === d)?.n ?? 0
		}));
		const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
		return {
			from,
			to,
			rows,
			total: {
				signups: sum("signups"),
				graphs: sum("graphs"),
				groups: sum("groups"),
				posts: sum("posts"),
				cheers: sum("cheers"),
				answers: sum("answers")
			}
		};
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
				storage: storageOf(db, autoDir),
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
		if (run("DELETE FROM users WHERE id = ?", c.params.id).changes) logPurge("관리자가 지움", 1);
	});
	on("DELETE", "/admin/posts/:id", (c) => {
		admin(c);
		takeDown(c.params.id);
	});
	on("GET", "/admin/users/:id", (c) => {
		admin(c);
		const u = one("SELECT id, nickname, created_at, agreed_at, last_seen_at, guardian FROM users WHERE id = ?", c.params.id);
		if (!u) throw new HttpError(404, "찾을 수 없어요.");
		return {
			id: u.id,
			nickname: u.nickname,
			createdAt: u.created_at,
			agreedAt: u.agreed_at,
			lastSeenAt: u.last_seen_at,
			guardian: u.guardian ? JSON.parse(u.guardian) : null,
			sessions: one("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at >= ?", u.id, now()).n,
			cheersGiven: one("SELECT COUNT(*) AS n FROM cheers WHERE user_id = ?", u.id).n,
			cheersReceived: one("SELECT COUNT(*) AS n FROM cheers ch JOIN posts p ON p.id = ch.post_id WHERE p.user_id = ?", u.id).n,
			groups: all(`SELECT c.id, c.name, m.joined_at AS joinedAt,
                CASE WHEN c.owner_id = m.user_id THEN 'owner' WHEN m.role = 'co' THEN 'co' WHEN m.role = 'helper' THEN 'helper' ELSE 'member' END AS role
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
		return all(`SELECT l.id, l.ip, l.ok, l.agent, l.at, l.who, COALESCE(a.alias, '') AS alias
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
		if (alias) run("INSERT INTO ip_aliases (ip, alias) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET alias = excluded.alias", ip, alias);
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
				run("INSERT INTO meta (key, value) VALUES ('auth_secret', ?)", secret);
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
	on("POST", "/admin/reset", (c) => {
		if (!opts.devServer) throw new HttpError(404, "찾을 수 없어요.");
		admin(c);
		adminLimit.check(c.ip);
		if (!same(String(c.body?.password ?? ""), opts.admin.password)) {
			adminLimit.hit(c.ip);
			throw new HttpError(401, "관리자 비밀번호가 맞지 않아요.");
		}
		if (c.body?.confirm !== "모두 지우기") throw new HttpError(400, `확인 칸에 ‘${RESET_PHRASE}’ 를 그대로 적어 주세요.`);
		const dir = opts.backupDir ?? tmpdir();
		mkdirSync(dir, { recursive: true });
		const before = join(dir, `before-reset-${now().replace(/[:.]/g, "-")}.db`);
		db.exec(`VACUUM INTO '${before.replace(/'/g, "''")}'`);
		readdirSync(dir).filter((f) => f.startsWith("before-reset-")).sort().slice(0, -5).forEach((f) => rmSync(join(dir, f), { force: true }));
		db.exec("PRAGMA foreign_keys = OFF");
		try {
			db.exec("BEGIN");
			try {
				for (const t of RESET_TABLES) db.exec(`DELETE FROM ${t}`);
				db.exec("COMMIT");
			} catch (e) {
				db.exec("ROLLBACK");
				throw e;
			}
		} finally {
			db.exec("PRAGMA foreign_keys = ON");
		}
		return { before: basename(before) };
	});
	on("GET", "/admin/groups/:id", (c) => {
		admin(c);
		const circle = one("SELECT * FROM circles WHERE id = ?", c.params.id);
		if (!circle) throw new HttpError(404, "찾을 수 없어요.");
		const posts = postsOf(circle.id).map(({ userId, ...p }) => p);
		const members = all(`SELECT u.id, u.nickname, m.joined_at AS joinedAt,
              CASE WHEN c.owner_id = u.id THEN 'owner' WHEN m.role = 'co' THEN 'co' WHEN m.role = 'helper' THEN 'helper' ELSE 'member' END AS role
         FROM members m JOIN users u ON u.id = m.user_id JOIN circles c ON c.id = m.circle_id
        WHERE m.circle_id = ? ORDER BY CASE WHEN c.owner_id = u.id THEN 0 WHEN m.role = 'co' THEN 1 WHEN m.role = 'helper' THEN 2 ELSE 3 END, m.joined_at, m.rowid`, circle.id);
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
		run("INSERT INTO meta (key, value) VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(s));
		return s;
	});
	on("GET", "/admin/notice", (c) => {
		admin(c);
		return savedNotice() ?? {
			on: false,
			title: "",
			body: "",
			at: ""
		};
	});
	on("PUT", "/admin/notice", (c) => {
		admin(c);
		const title = clean(c.body?.title).slice(0, 60);
		const body = cleanText(c.body?.body, 2e3);
		const on = c.body?.on === true;
		if (on && !title && !body) throw new HttpError(400, "공지 제목이나 내용을 적어 주세요.");
		const prev = savedNotice();
		const changed = !prev || prev.title !== title || prev.body !== body || !prev.on && on;
		const when = (x) => lab("ops") && str(x, 40) && !Number.isNaN(Date.parse(str(x, 40))) ? new Date(str(x, 40)).toISOString() : "";
		const from = when(c.body?.from), to = when(c.body?.to);
		if (from && to && to <= from) throw new HttpError(400, "내리는 때는 올리는 때보다 뒤여야 해요.");
		const n = {
			on,
			title,
			body,
			at: changed ? (/* @__PURE__ */ new Date()).toISOString() : prev.at,
			from,
			to
		};
		run("INSERT INTO meta (key, value) VALUES ('notice', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(n));
		return n;
	});
	on("DELETE", "/admin/settings", (c) => {
		admin(c);
		run("DELETE FROM meta WHERE key = 'site'");
		return envSite;
	});
	on("GET", "/admin/flags", (c) => {
		admin(c);
		return {
			dev: !!opts.devServer,
			flags: flagsOn()
		};
	});
	on("PUT", "/admin/flags", (c) => {
		admin(c);
		const next = {};
		for (const [k, v] of Object.entries(c.body.flags ?? {})) if (isFlag(k)) next[k] = v === true;
		run("INSERT INTO meta (key, value) VALUES ('flags', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next));
		return { flags: next };
	});
	const INQUIRY_KINDS = [
		"궁금해요",
		"고쳐 주세요",
		"개인정보",
		"그 밖의 일"
	];
	on("POST", "/contact", (c) => {
		labs("me");
		const u = me(c);
		contactLimit.check(c.ip);
		const kind = INQUIRY_KINDS.includes(c.body.kind) ? c.body.kind : "";
		const message = cleanText(c.body.message, 1e3);
		if (!kind) throw new HttpError(400, "무엇에 대한 문의인지 골라 주세요.");
		if (message.length < 5) throw new HttpError(400, "문의 내용을 조금 더 적어 주세요.");
		contactLimit.hit(c.ip);
		run("INSERT INTO inquiries (id, user_id, nickname, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId(), u.id, u.nickname, kind, message, now());
	});
	on("GET", "/me/inquiries", (c) => {
		labs("me");
		const u = me(c);
		return all("SELECT id, kind, message, created_at AS createdAt, status, answer, answered_at AS answeredAt FROM inquiries WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", u.id);
	});
	on("GET", "/admin/inquiries", (c) => {
		labs("ops");
		admin(c);
		run("DELETE FROM inquiries WHERE done_at != '' AND done_at < ?", (/* @__PURE__ */ new Date(Date.now() - 8760 * HOUR)).toISOString());
		return all("SELECT id, nickname, kind, message, contact, created_at AS createdAt, status, note, answer, answered_at AS answeredAt, done_at AS doneAt, user_id IS NOT NULL AS member FROM inquiries ORDER BY status IN ('답함', '대장으로 옮김', '닫음'), created_at DESC LIMIT 500").map((r) => ({
			...r,
			member: r.member === 1
		}));
	});
	on("PUT", "/admin/inquiries/:id", (c) => {
		labs("ops");
		admin(c);
		const status = [
			"새 문의",
			"보는 중",
			"답함",
			"닫음"
		].includes(c.body.status) ? c.body.status : "새 문의";
		const prev = one("SELECT done_at, answer, answered_at FROM inquiries WHERE id = ?", c.params.id);
		if (!prev) throw new HttpError(404, "찾을 수 없어요.");
		const answer = c.body.answer === void 0 ? prev.answer : cleanText(c.body.answer, 2e3);
		const answeredAt = answer !== prev.answer ? answer ? now() : "" : prev.answered_at;
		const st = answer && answer !== prev.answer ? "답함" : status;
		const done = st === "답함" || st === "닫음";
		run("UPDATE inquiries SET status = ?, note = ?, answer = ?, answered_at = ?, done_at = ? WHERE id = ?", st, cleanText(c.body.note, 500), answer, answeredAt, done ? prev.done_at || now() : "", c.params.id);
	});
	on("POST", "/admin/inquiries/:id/to-privacy", (c) => {
		labs("ops");
		admin(c);
		const q = one("SELECT nickname, contact, message, created_at FROM inquiries WHERE id = ?", c.params.id);
		if (!q) throw new HttpError(404, "찾을 수 없어요.");
		const kind = [
			"열람",
			"정정",
			"삭제",
			"처리정지",
			"그 밖의 문의"
		].includes(c.body.kind) ? c.body.kind : "그 밖의 문의";
		const id = newId();
		run("INSERT INTO privacy_requests (id, kind, who, detail, received_at, status) VALUES (?, ?, ?, ?, ?, ?)", id, kind, [q.nickname, q.contact].filter(Boolean).join(" · ").slice(0, 60) || "문의함", q.message.slice(0, 500), new Date(Date.parse(q.created_at) + 9 * HOUR).toISOString().slice(0, 10), "받음");
		run("UPDATE inquiries SET status = '대장으로 옮김', done_at = ? WHERE id = ?", now(), c.params.id);
		return { id };
	});
	on("GET", "/admin/diagnose", (c) => {
		labs("ops");
		admin(c);
		const s = site();
		const files = listBackups(autoDir);
		const keep = keepNow();
		let free = -1;
		try {
			const f = statfsSync(opts.backupDir ?? tmpdir());
			free = f.bavail * f.bsize;
		} catch {}
		const pwLen = opts.admin?.password.length ?? 0;
		const fresh = !!files[0] && Date.now() - Date.parse(files[0].at) < 3 * HOUR;
		const secretLen = opts.authSecret?.length ?? 0;
		return [
			{
				name: "로그인 비밀값 (AUTH_SECRET)",
				ok: secretLen >= 32,
				detail: opts.authSecret ? secretLen >= 32 ? ".env 에 정해져 있어요." : `${secretLen}자예요. 32자 이상 무작위 값을 권장해요 (openssl rand -hex 32).` : "DB 안에 있어요. 백업 파일만 새어도 이름 · 생일을 알아낼 수 있어요. README ‘보안’ 대로 옮겨 주세요."
			},
			{
				name: "쿠키 보안 (COOKIE_SECURE)",
				ok: opts.secureCookie,
				detail: opts.secureCookie ? "https 에서만 로그인 쿠키를 보내요." : "꺼져 있어요. https 로 운영한다면 켜 주세요."
			},
			{
				name: "공유 주소 (PUBLIC_URL)",
				ok: !!s.publicUrl?.startsWith("https://"),
				detail: s.publicUrl ? s.publicUrl.startsWith("https://") ? s.publicUrl : `${s.publicUrl} — https 주소를 권장해요.` : "비어 있어요. 공유 링크 · QR 이 접속한 주소로 만들어져요."
			},
			{
				name: "관리자 비밀번호",
				ok: pwLen >= 16,
				detail: `${pwLen}자예요.${pwLen >= 16 ? "" : " 16자 이상을 권장해요."}`
			},
			{
				name: "자동 백업",
				ok: keep > 0 && fresh,
				detail: keep <= 0 ? "꺼져 있어요 (남길 개수 0)." : files[0] ? `최근 ${keep}개 남김 (한 시간에 하나) · 마지막 ${files[0].name}${fresh ? "" : " — 세 시간 넘게 새 백업이 없어요."}` : "아직 자동 백업이 없어요 (켜진 지 1분 뒤 처음 남겨요). 폴더에 쓸 수 있는지 확인해 주세요."
			},
			{
				name: "디스크 여유",
				ok: free < 0 || free > 1024 ** 3,
				detail: free < 0 ? "읽지 못했어요." : `${(free / 1024 ** 3).toFixed(1)}GB 남았어요.${free > 1024 ** 3 ? "" : " 1GB 아래예요."}`
			},
			{
				name: "운영 기관 · 문의처",
				ok: !!s.operator?.name && !!s.operator?.contact,
				detail: s.operator?.name && s.operator.contact ? `${s.operator.name} · ${s.operator.contact}` : "약관 · 처리방침에 들어갈 운영 기관 · 문의처 이메일을 ‘사이트 설정’ 에서 정해 주세요."
			},
			{
				name: "서버 종류",
				ok: true,
				detail: opts.devServer ? "개발 테스트 서버예요 (실험 기능 모두 켜짐 · DB 초기화 있음)." : "정식 서버예요."
			}
		];
	});
	on("GET", "/admin/db-check", (c) => {
		labs("ops");
		admin(c);
		return {
			integrity: one("PRAGMA integrity_check").integrity_check,
			fkProblems: all("PRAGMA foreign_key_check").length,
			freePages: one("PRAGMA freelist_count").freelist_count,
			expiredSessions: one("SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?", now()).n,
			tables: all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => ({
				name: t.name,
				rows: one(`SELECT COUNT(*) AS n FROM "${t.name}"`).n
			}))
		};
	});
	on("POST", "/admin/db-tidy", (c) => {
		labs("ops");
		admin(c);
		maintain(db, null, 0);
	});
	on("GET", "/admin/hours", (c) => {
		labs("ops");
		admin(c);
		return all("SELECT dow, hour, n FROM visit_hours");
	});
	let updateCache = null;
	on("GET", "/admin/update", async (c) => {
		labs("ops");
		admin(c);
		if (!updateCache || Date.now() - updateCache.at > 6 * HOUR) try {
			const r = await fetch("https://api.github.com/repos/hatility/Gryeobom/releases/latest", {
				headers: {
					"User-Agent": "geuryeobom-server",
					Accept: "application/vnd.github+json"
				},
				signal: AbortSignal.timeout(5e3)
			});
			const j = r.ok ? await r.json() : null;
			updateCache = {
				at: Date.now(),
				latest: j ? {
					tag: str(j.tag_name, 40),
					name: str(j.name, 100),
					url: str(j.html_url, 300),
					publishedAt: str(j.published_at, 40)
				} : null
			};
		} catch {
			updateCache = {
				at: Date.now() - 5 * HOUR,
				latest: null
			};
		}
		return { latest: updateCache.latest };
	});
	on("GET", "/admin/purges", (c) => {
		labs("ops");
		admin(c);
		return all("SELECT at, kind, count FROM purge_log ORDER BY id DESC LIMIT 500");
	});
	return async (req, res) => {
		const t0 = performance.now();
		res.once("finish", () => {
			served++;
			if (res.statusCode >= 500) failed++;
			timings.push(performance.now() - t0);
			if (timings.length > 500) timings.shift();
		});
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
			const cspReport = req.method === "POST" && path === "/csp-report" && /^application\/(csp-report|reports\+json|json)/.test(type);
			const m = req.method !== "GET" && !cspReport && !path.startsWith("/admin") && path !== "/auth/logout" ? maintenance() : null;
			if (m?.on) throw new HttpError(503, m.message ? `지금은 점검 중이에요: ${m.message}` : "지금은 점검 중이에요. 잠시 뒤에 다시 저장해 주세요.");
			if (req.method !== "GET" && !cspReport && (req.headers["x-requested-with"] !== "geuryeobom" || !(rawBody ? type === "application/octet-stream" : type.startsWith("application/json")))) throw new HttpError(403, "허용되지 않은 요청이에요.");
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
				if (lab("ops")) try {
					const err = e instanceof Error ? e : new Error(String(e));
					db.prepare("INSERT INTO error_log (at, method, path, message, stack) VALUES (?, ?, ?, ?, ?)").run((/* @__PURE__ */ new Date()).toISOString(), req.method ?? "", new URL(req.url ?? "/", "http://x").pathname.slice(0, 200), err.message.slice(0, 500), (err.stack ?? "").split("\n").slice(0, 6).join("\n").slice(0, 1500));
					db.exec("DELETE FROM error_log WHERE id <= (SELECT MAX(id) - 500 FROM error_log)");
				} catch {}
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
var autoDir = config.autoBackupDir || join(dirname(config.dbFile), "backups");
mkdirSync(autoDir, { recursive: true });
var runAs = process.env.RUN_AS?.match(/^(\d+):(\d+)$/);
if (runAs && process.getuid?.() === 0) {
	const [uid, gid] = [Number(runAs[1]), Number(runAs[2])];
	for (const d of [dirname(config.dbFile), autoDir]) try {
		chownSync(d, uid, gid);
	} catch (e) {
		console.warn(`[설정] ${d} 의 주인을 바꾸지 못했어요`, e);
	}
	process.setgid(gid);
	process.setuid(uid);
}
var db = openDb(config.dbFile);
var dataDir = dirname(config.dbFile);
createServer(createApp(db, {
	...config,
	backupDir: dataDir,
	autoBackupDir: autoDir
})).listen(config.port, () => console.log(`geuryeobom api listening on :${config.port}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
	db.close();
	process.exit(0);
});
var tidy = () => {
	try {
		const f = maintain(db, autoDir, backupKeepOf(db, config.backupKeep));
		if (f) console.log(`[손질] 자동 백업 ${f}`);
	} catch (e) {
		console.error("[손질] 실패", e);
	}
};
setTimeout(tidy, 6e4).unref();
setInterval(tidy, 36e5).unref();
export {};
