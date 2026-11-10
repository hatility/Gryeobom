import { normalizeGraph, type Repo } from './store.ts'
import type { PostOptions, SharedGraph } from './share.ts'
import type { GroupPreset, GroupPrompts, LifeGraph } from './types.ts'

export interface Me { id: string; nickname: string }
export interface ReceivedCheer { kind: string; groupName: string; title: string; createdAt: string }
export type GroupRole = 'owner' | 'co' | 'helper' | 'member'
export interface GroupEvent { id: string; day: string; title: string; /** 참여 인원 · 내가 참여했는지 (실험) */ count?: number; mine?: boolean }
export interface GroupSummary { closedAt?: string; id: string; name: string; role: GroupRole; memberCount: number; topic: string; topicAt: string; news?: string; newsAt?: string; nextEvent?: GroupEvent | null }
/** 모임 리포트: 누가 그렸는지 없이 모임 전체의 흐름. 나눈 사람이 3명이 안 되면 scores · labels 는 null */
export interface GroupReport {
  members: number; sharers: number; posts: number; newPosts: number; drawing: number; done: number; cheers: number; moments: number
  enough: boolean; scores: number[] | null; labels: { label: string; n: number }[] | null
}
/** 오늘의 질문에 남긴 한 줄 (날짜마다 하나) */
export interface Answer { day: string; question: string; text: string; color?: string }
export type ReportReason = 'hurt' | 'privacy' | 'danger' | 'other'
export const REPORT_REASONS: Record<ReportReason, string> = {
  hurt: '놀리거나 괴롭히는 내용이에요',
  privacy: '누군가의 개인정보가 드러나 있어요',
  danger: '위험해 보이거나 도움이 필요해 보여요',
  other: '그 밖의 까닭',
}
/** 함께하는 사람. id 는 모임장에게만 온다 (공동 모임장 정하기 · 넘기기) */
export interface GroupMember { id?: string; nickname: string; role: GroupRole }
export interface GroupPost {
  id: string
  nickname: string
  mine: boolean
  createdAt: string
  graph: SharedGraph
  /** 이 모임에서 그린 그래프라 저절로 나눠진 글 (그린 사람은 내릴 수 없다) */
  bound: boolean
  myCheers: string[]
  counts?: Record<string, number>
}
export interface GroupDetail {
  id: string; name: string; intro: string; topic: string; topicAt: string
  /** 모임 소식 · 다가오는 일정 (실험) */
  news?: string; newsAt?: string; events?: GroupEvent[]
  /** 끝난 모임 (실험 · 보기만) */
  closedAt?: string
  /** 이 모임이 이어진 기관 (실험 · 모임장 · 공동 모임장에게만) */
  orgs?: { id: string; name: string }[]
  /** 모임 질문 묶음 (실험) */
  questionSet?: string
  /** 모임장이 정한 질문 (실험) */
  prompts?: GroupPrompts | null
  /** 모임장 · 모임장이나 공동 모임장(모임 꾸리기) */
  isOwner: boolean; isManager: boolean
  /** 도우미 (실험): 일정 · 소식 · 큰 화면 진행 */
  isHelper?: boolean
  code?: string; preset: GroupPreset | null; members: GroupMember[]; posts: GroupPost[]
  /** 이 모임에서 다 그린 내 선인데 모임에 없는 것 (모임장이 내렸을 때 다시 올리기) */
  myUnposted: { graphId: string; title: string }[]
}
export interface Invite { name: string; intro: string; preset: GroupPreset | null; joined: boolean; id?: string; closed?: boolean }
export type InviteResult = { needSignup: true } | { id: string; user: Me }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'geuryeobom' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, '서버에 닿지 못했어요. 인터넷 연결을 확인해 주세요.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? '잠시 문제가 생겼어요. 조금 뒤에 다시 해볼까요?')
  // 서버 없이 정적 파일만 올린 경우 index.html이 돌아온다
  if (data === null) throw new ApiError(503, '지금은 계정 기능을 쓸 수 없어요.')
  return data as T
}

export const api = {
  me: () => req<{ user: Me | null }>('GET', '/me').then((r) => r.user).catch(() => null),
  signup: (b: { name: string; birth: string; nickname: string; remember: boolean; agree: boolean; guardian?: Guardian }) =>
    req<{ user: Me }>('POST', '/auth/signup', b).then((r) => r.user),
  login: (b: { name: string; birth: string; remember: boolean }) =>
    req<{ user: Me }>('POST', '/auth/login', b).then((r) => r.user),
  logout: () => req('POST', '/auth/logout'),
  deleteMe: (name: string, birth: string) => req('POST', '/me/delete', { name, birth }),

  graphPosts: (graphId: string) => req<{ postId: string; groupId: string }[]>('GET', `/graphs/${graphId}/posts`),
  groups: () => req<GroupSummary[]>('GET', '/groups'),
  group: (id: string) => req<GroupDetail>('GET', `/groups/${id}`),
  createGroup: (name: string, intro = '') => req<{ id: string; code: string }>('POST', '/groups', { name, intro }),
  updateGroup: (id: string, info: { name: string; intro: string }) => req<{ name: string; intro: string }>('PUT', `/groups/${id}`, info),
  joinGroup: (code: string) => req<{ id: string }>('POST', '/groups/join', { code }),
  deleteGroup: (id: string) => req('DELETE', `/groups/${id}`),
  leaveGroup: (id: string) => req('POST', `/groups/${id}/leave`),
  setMemberRole: (groupId: string, userId: string, role: 'co' | 'helper' | 'member') => req('PUT', `/groups/${groupId}/members/${userId}`, { role }),
  transferGroup: (groupId: string, userId: string) => req('POST', `/groups/${groupId}/transfer`, { userId }),
  groupReport: (id: string) => req<GroupReport>('GET', `/groups/${id}/report`),
  /** 모임 일정 */
  addEvent: (groupId: string, day: string, title: string) => req<GroupEvent>('POST', `/groups/${groupId}/events`, { day, title }),
  removeEvent: (groupId: string, id: string) => req('DELETE', `/groups/${groupId}/events/${id}`),
  /** 실험: 보호자 동의 확인 */
  myGuardian: () => req<{ needed: boolean; relation?: string; confirmed?: boolean; token?: string | null }>('GET', '/me/guardian'),
  guardianLink: (token: string) => req<{ nickname: string; relation: string; confirmed: boolean; confirmedAt: string }>('GET', `/guardian/${encodeURIComponent(token)}`),
  guardianAgree: (token: string) => req<{ confirmed: boolean }>('POST', `/guardian/${encodeURIComponent(token)}`, { agree: true }),
  /** 기관 */
  myOrgs: (from?: string, to?: string) => req<MyOrg[]>('GET', from && to ? `/orgs?from=${from}&to=${to}` : '/orgs'),
  /** 출석 · 모임 복제 · 휴면 계정 · 오류 기록 */
  attend: (groupId: string, eventId: string) => req<{ mine: boolean; count: number }>('POST', `/groups/${groupId}/events/${eventId}/attend`),
  setGroupQuestionSet: (groupId: string, set: string) => req<{ questionSet: string }>('PUT', `/groups/${groupId}/question-set`, { set }),
  graphVersions: (id: string) => req<{ id: number; at: string; title: string; moments: number; done: boolean }[]>('GET', `/graphs/${id}/versions`),
  graphVersion: (id: string, vid: number) => req<{ at: string; graph: LifeGraph }>('GET', `/graphs/${id}/versions/${vid}`).then((r) => ({ ...r, graph: normalizeGraph(r.graph) })),
  /** 지난 모습으로 되돌리기: 지금 모습을 먼저 남기고 저장 */
  restoreGraph: (g: LifeGraph) => req('PUT', `/graphs/${g.id}`, { graph: g, snapshot: true }),
  adminMaintenance: () => req<{ on: boolean; message: string; at: string }>('GET', '/admin/maintenance'),
  adminSetMaintenance: (on: boolean, message: string) => req<{ on: boolean; message: string; at: string }>('PUT', '/admin/maintenance', { on, message }),
  adminAccounts: () => req<{ id: string; role: string; createdAt: string; lastLogin: string | null }[]>('GET', '/admin/accounts'),
  adminSaveAccount: (id: string, role: string, password: string) => req('PUT', `/admin/accounts/${id}`, { role, password }),
  adminDeleteAccount: (id: string) => req('DELETE', `/admin/accounts/${id}`),
  adminFunnel: (from: string, to: string) => req<{ from: string; to: string; signup: number; started: number; moment: number; done: number; shared: number; grouped: number }>('GET', `/admin/funnel?from=${from}&to=${to}`),
  adminCsp: () => req<{ directive: string; blocked: string; page: string; source: string; count: number; firstAt: string; lastAt: string }[]>('GET', '/admin/csp'),
  adminClearCsp: () => req('DELETE', '/admin/csp'),
  adminFlags: () => req<{ dev: boolean; flags: Partial<Record<string, boolean>> }>('GET', '/admin/flags'),
  adminSetFlags: (flags: Partial<Record<string, boolean>>) => req<{ flags: Partial<Record<string, boolean>> }>('PUT', '/admin/flags', { flags }),
  contact: (b: { kind: string; message: string }) => req('POST', '/contact', b),
  myInquiries: () => req<{ id: string; kind: string; message: string; createdAt: string; status: string; answer: string; answeredAt: string }[]>('GET', '/me/inquiries'),
  adminInquiries: () => req<{ id: string; nickname: string; kind: string; message: string; contact: string; createdAt: string; status: string; note: string; answer: string; answeredAt: string; doneAt: string; member: boolean }[]>('GET', '/admin/inquiries'),
  adminSaveInquiry: (id: string, b: { status: string; note: string; answer: string }) => req('PUT', `/admin/inquiries/${id}`, b),
  adminInquiryToPrivacy: (id: string, kind: string) => req<{ id: string }>('POST', `/admin/inquiries/${id}/to-privacy`, { kind }),
  adminDiagnose: () => req<{ name: string; ok: boolean; detail: string }[]>('GET', '/admin/diagnose'),
  adminDbCheck: () => req<{ integrity: string; fkProblems: number; freePages: number; expiredSessions: number; tables: { name: string; rows: number }[] }>('GET', '/admin/db-check'),
  adminDbTidy: () => req('POST', '/admin/db-tidy'),
  adminHours: () => req<{ dow: number; hour: number; n: number }[]>('GET', '/admin/hours'),
  adminUpdate: () => req<{ latest: { tag: string; name: string; url: string; publishedAt: string } | null }>('GET', '/admin/update'),
  adminPurges: () => req<{ at: string; kind: string; count: number }[]>('GET', '/admin/purges'),
  setGroupClosed: (groupId: string, closed: boolean) => req<{ closedAt: string }>('PUT', `/groups/${groupId}/closed`, { closed }),
  myOrgsLite: () => req<{ id: string; name: string; groupIds: string[] }[]>('GET', '/orgs?lite=1'),
  createOrg: (name: string, agree: boolean) => req<{ id: string; code: string }>('POST', '/orgs', { name, agree }),
  renameOrg: (id: string, name: string) => req('PUT', `/orgs/${id}`, { name }),
  deleteOrg: (id: string) => req('DELETE', `/orgs/${id}`),
  newOrgCode: (id: string) => req<{ code: string }>('POST', `/orgs/${id}/code`),
  orgMakeInvite: (id: string) => req<{ invite: string }>('POST', `/orgs/${id}/invite`),
  orgInviteOff: (id: string) => req('DELETE', `/orgs/${id}/invite`),
  leaveOrg: (id: string) => req('POST', `/orgs/${id}/leave`),
  orgAddGroup: (id: string, groupId: string) => req('POST', `/orgs/${id}/groups`, { groupId }),
  orgRemoveGroup: (id: string, groupId: string) => req('DELETE', `/orgs/${id}/groups/${groupId}`),
  linkGroupOrg: (groupId: string, code: string) => req<{ id: string; name: string }>('POST', `/groups/${groupId}/org`, { code }),
  unlinkGroupOrg: (groupId: string) => req('DELETE', `/groups/${groupId}/org`),
  orgNews: (orgId: string, news: string) => req<{ news: string; newsAt: string; groups: number }>('PUT', `/orgs/${orgId}/news`, { news }),
  orgInvite: (token: string) => req<{ name: string; groups: number; already: boolean }>('GET', `/org-invite/${token}`),
  acceptOrgInvite: (token: string) => req<{ id: string; name: string }>('POST', `/org-invite/${token}`),
  myTerms: () => req<{ need: boolean; summary?: string; at?: string }>('GET', '/me/terms'),
  agreeTerms: () => req('POST', '/me/agree', { agree: true }),
  adminTerms: () => req<{ summary: string; at: string; agreed: number; users: number }>('GET', '/admin/terms'),
  adminSaveTerms: (summary: string) => req<{ summary: string; at: string }>('PUT', '/admin/terms', { summary }),
  adminHealth: () => req<AdminHealth>('GET', '/admin/health'),
  adminBackups: () => req<{ keep: number; dir: boolean; folder: string; files: { name: string; size: number; at: string }[] }>('GET', '/admin/backups'),
  adminSetBackupKeep: (keep: number) => req<{ keep: number }>('PUT', '/admin/backups', { keep }),
  adminRunBackup: () => req<{ file: string | null; made: boolean }>('POST', '/admin/backups/run'),
  adminBlocks: () => req<AdminBlock[]>('GET', '/admin/blocks'),
  adminReleaseBlock: (limit: string, key: string) => req('POST', '/admin/blocks/release', { limit, key }),
  adminPrivacy: () => req<PrivacyRequest[]>('GET', '/admin/privacy'),
  adminSavePrivacy: (id: string, r: Omit<PrivacyRequest, 'id' | 'doneAt'>) => req<{ id: string }>('PUT', `/admin/privacy/${id}`, r),
  adminDeletePrivacy: (id: string) => req('DELETE', `/admin/privacy/${id}`),
  adminOrgInvite: (id: string) => req<{ invite: string }>('POST', `/admin/orgs/${id}/invite`),
  adminOrgInviteOff: (id: string) => req('DELETE', `/admin/orgs/${id}/invite`),
  copyGroup: (groupId: string, name: string) => req<{ id: string; code: string }>('POST', `/groups/${groupId}/copy`, { name }),
  adminDormant: (months: number) => req<{ months: number; users: { id: string; nickname: string; createdAt: string; lastSeenAt: string; graphCount: number }[] }>('GET', `/admin/dormant?months=${months}`),
  adminPurgeDormant: (months: number, ids: string[]) => req<{ deleted: number }>('POST', '/admin/dormant/purge', { months, ids }),
  adminErrors: () => req<{ at: string; method: string; path: string; message: string; stack: string }[]>('GET', '/admin/errors'),
  adminOrgs: () => req<AdminOrg[]>('GET', '/admin/orgs'),
  adminSaveOrg: (id: string, b: { name: string; codes: string[]; managerIds: string[] }) => req<AdminOrg>('PUT', `/admin/orgs/${id}`, b),
  adminDeleteOrg: (id: string) => req('DELETE', `/admin/orgs/${id}`),
  /** 그 해에 받은 응원 수 */
  cheersOfYear: (year: number) => req<{ year: number; received: number }>('GET', `/me/cheers/${year}`),
  /** 모임 소식 */
  setNews: (id: string, news: string) => req<{ news: string; newsAt: string }>('PUT', `/groups/${id}/news`, { news }),
  setTopic: (id: string, topic: string) => req<{ topic: string; topicAt: string }>('PUT', `/groups/${id}/topic`, { topic }),
  report: (postId: string, reason: ReportReason, detail: string) => req('POST', `/posts/${postId}/report`, { reason, detail }),
  answers: () => req<Answer[]>('GET', '/me/answers'),
  saveAnswer: (a: Answer) => req<Answer>('PUT', `/me/answers/${a.day}`, { question: a.question, text: a.text, color: a.color ?? '' }),
  setPreset: (id: string, preset: GroupPreset | null) => req<{ preset: GroupPreset | null }>('PUT', `/groups/${id}/preset`, { preset }),
  setPrompts: (id: string, prompts: GroupPrompts) => req<{ prompts: GroupPrompts | null }>('PUT', `/groups/${id}/prompts`, { prompts }),
  invite: (code: string) => req<Invite>('GET', `/invite/${encodeURIComponent(code)}`),
  /** 초대 링크로 들어가기. 로그인하지 않았으면 이름 · 생일(처음이면 별명 · 동의까지)을 함께 보낸다 */
  joinByInvite: (code: string, b: { name?: string; birth?: string; nickname?: string; agree?: boolean; remember?: boolean; guardian?: Guardian } = {}) =>
    req<InviteResult>('POST', `/invite/${encodeURIComponent(code)}`, b),
  /** 모임에 나누기. 무엇을 나눌지만 보내면 서버가 그래프에서 만들고, 그래프를 고치면 다시 만든다 */
  post: (groupId: string, graphId: string, options: PostOptions) =>
    req<{ id: string }>('POST', `/groups/${groupId}/posts`, { graphId, options }),
  unpost: (postId: string) => req('DELETE', `/posts/${postId}`),
  /** 짧은 공유 링크 (/s/코드). 서버에 공개용 내용만 둔다 */
  createLink: (shared: SharedGraph, graphId?: string) => req<{ code: string }>('POST', '/links', { shared, graphId }),
  link: (code: string) => req<{ shared: SharedGraph; createdAt: string }>('GET', `/links/${encodeURIComponent(code)}`),
  graphLinks: (graphId: string) => req<{ code: string; createdAt: string }[]>('GET', `/graphs/${graphId}/links`),
  deleteLink: (code: string) => req('DELETE', `/links/${code}`),
  cheer: (postId: string, kind: string) => req<{ on: boolean }>('POST', `/posts/${postId}/cheers`, { kind }),
  /** since 이후 내 그래프에 도착한 응원 (누가 보냈는지는 오지 않는다) */
  cheersSince: (since: string) => req<ReceivedCheer[]>('GET', `/me/cheers?since=${encodeURIComponent(since)}`),

  adminMe: () => req<{ enabled: boolean; admin: boolean; who?: string; role?: '' | 'owner' | 'full' | 'viewer'; alerts?: { reports: number; inquiries: number } }>('GET', '/admin/me'),
  adminLogin: (id: string, password: string) => req('POST', '/admin/login', { id, password }),
  adminLogout: () => req('POST', '/admin/logout'),
  adminReports: (deleted = false) => req<AdminReport[]>('GET', `/admin/reports${deleted ? '?deleted=1' : ''}`),
  adminDeleteReport: (id: string, reason: string) => req('DELETE', `/admin/reports/${id}`, { reason }),
  adminResolveReport: (id: string, undo = false) => req('POST', `/admin/reports/${id}/resolve`, { undo }),
  /** 백업 파일로 되돌리기: 파일을 그대로 올리고, 관리자 비밀번호를 한 번 더 보낸다 */
  adminRestore: async (file: File, password: string) => {
    const res = await fetch('/api/admin/restore', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'geuryeobom', 'X-Admin-Password': encodeURIComponent(password) },
      body: file,
    }).catch(() => null)
    if (!res) throw new ApiError(0, '서버에 닿지 못했어요.')
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(res.status, data?.error ?? (res.status === 413 ? '파일이 너무 커요.' : '복원하지 못했어요.'))
    return data as { users: number; graphs: number; groups: number; before: string; secretMissing: boolean }
  },
  adminOverview: () => req<AdminOverview>('GET', '/admin/overview'),
  adminDelete: (kind: 'groups' | 'users' | 'posts', id: string) => req('DELETE', `/admin/${kind}/${id}`),
  adminUser: (id: string) => req<AdminUser>('GET', `/admin/users/${id}`).then((r) => ({ ...r, graphs: r.graphs.map(normalizeGraph) })),
  adminLinks: () => req<AdminLink[]>('GET', '/admin/links'),
  adminDeleteLink: (code: string) => req('DELETE', `/admin/links/${code}`),
  adminLogins: () => req<AdminLogin[]>('GET', '/admin/logins'),
  adminSetAlias: (ip: string, alias: string) => req('PUT', '/admin/ip-aliases', { ip, alias }),
  adminGroup: (id: string) => req<AdminGroup>('GET', `/admin/groups/${id}`),
  adminUpdateGroup: (id: string, info: { name: string; intro: string }) => req('PUT', `/admin/groups/${id}`, info),
  adminSettings: () => req<{ site: SiteConfig; saved: boolean; env: SiteConfig; secretInDb: boolean }>('GET', '/admin/settings'),
  adminSaveSettings: (site: SiteConfig) => req<SiteConfig>('PUT', '/admin/settings', site),
  adminResetSettings: () => req<SiteConfig>('DELETE', '/admin/settings'),
  /** DB 초기화: 회원 · 기록을 모두 지운다. 지우기 전 DB 파일 이름을 돌려준다 */
  adminReset: (password: string, confirm: string) => req<{ before: string }>('POST', '/admin/reset', { password, confirm }),
  /** 모임 여러 개를 한 번에 */
  createGroups: (names: string[], intro: string) => req<{ groups: { id: string; name: string; code: string }[] }>('POST', '/groups/bulk', { names, intro }),
  /** 기간 통계 */
  adminStats: (from: string, to: string) => req<AdminStats>('GET', `/admin/stats?from=${from}&to=${to}`),
  adminNotice: () => req<AdminNotice>('GET', '/admin/notice'),
  adminSaveNotice: (n: AdminNotice) => req<AdminNotice>('PUT', '/admin/notice', n),
  /** 지금 떠 있는 공지 (없으면 null) */
  notice: () => req<{ notice: Notice | null }>('GET', '/notice').then((r) => r.notice),
}

export interface AdminReport {
  id: string; postId: string | null; groupId: string | null; reason: ReportReason; detail: string
  postTitle: string; postOwner: string; groupName: string; createdAt: string; resolvedAt: string; reporter: string | null
  deletedAt: string; deleteReason: string
}
export interface AdminLink { code: string; createdAt: string; nickname: string | null; graphId: string | null; graph: SharedGraph }
export interface AdminLogin { id: number; ip: string; ok: boolean; agent: string; at: string; alias: string; who?: string }
export interface AdminUser {
  id: string; nickname: string; createdAt: string; agreedAt: string; lastSeenAt: string
  /** 만 14세 미만 보호자 동의 (실험) */
  guardian?: { relation: string; contact: string; at: string; confirmedAt?: string } | null
  sessions: number; cheersGiven: number; cheersReceived: number
  answers: Answer[]
  groups: { id: string; name: string; role: GroupRole; joinedAt: string }[]
  graphs: LifeGraph[]
  posts: { id: string; groupName: string; graphId: string; createdAt: string }[]
  links: AdminLink[]
}
export interface AdminGroup {
  id: string; name: string; intro: string; code: string; createdAt: string; preset: GroupPreset | null
  members: { id: string; nickname: string; role: GroupRole; joinedAt: string }[]
  posts: { id: string; nickname: string; createdAt: string; graph: SharedGraph; bound: boolean }[]
}

export interface AdminOverview {
  counts: { users: number; graphs: number; groups: number; posts: number; links: number }
  stats: {
    completed: number; letters: number; cheers: number; moments: number; online: number; openReports: number; answers: number
    storage: { db: number; backups: number; backupBytes: number; latest: string | null }
    scales: { scale: string; n: number }[]
    week: { signups: number; visitors: number; graphs: number; posts: number; cheers: number }
    daily: { day: string; signups: number; graphs: number }[]
  }
  groups: { id: string; name: string; code: string; owner: string; createdAt: string; memberCount: number; postCount: number }[]
  users: { id: string; nickname: string; createdAt: string; lastSeenAt: string; graphCount: number; completedCount: number; groupCount: number; postCount: number }[]
  posts: { id: string; groupName: string; nickname: string; title: string; createdAt: string }[]
}

export interface Developer { name: string; org: string; contact: string; url: string }
export interface Operator { name: string; contact: string }
/** 만 14세 미만 보호자 동의 (실험) */
export interface Guardian { relation: string; contact: string; agreed: boolean }
export type StatKey = 'signups' | 'graphs' | 'groups' | 'posts' | 'cheers' | 'answers'
export interface AdminStats { from: string; to: string; rows: ({ day: string } & Record<StatKey, number>)[]; total: Record<StatKey, number> }
export interface Notice { title: string; body: string; at: string }
export interface AdminNotice extends Notice { on: boolean; /** 예약 게시 (실험) */ from?: string; to?: string }
export interface SiteConfig { publicUrl: string | null; developer: Developer | null; operator: Operator | null; /** 개발 테스트 서버 */ dev?: boolean; /** 점검 중 (실험) */ maintenance?: { message: string; at: string }; /** 켜진 실험 묶음 */ flags?: string[] }

/** 서버 설정(.env) 중 화면에 필요한 것. 서버가 없으면 빈 설정. 한 번만 받아 둔다. */
let cfg: Promise<SiteConfig> | null = null
export const siteConfig = () =>
  (cfg ??= req<SiteConfig>('GET', '/config').catch((): SiteConfig => ({ publicUrl: null, developer: null, operator: null })))

/** 공유 링크의 앞부분. 서버 .env 의 PUBLIC_URL, 없거나 서버가 없으면 지금 접속한 주소. */
export const shareBase = () => siteConfig().then((c) => c.publicUrl || location.origin)

/** 로그인했을 때의 저장소: 그려봄 서버 */
export const remoteRepo: Repo = {
  remote: true,
  list: () => req<LifeGraph[]>('GET', '/graphs').then((l) => l.map(normalizeGraph)),
  get: (id) => req<LifeGraph>('GET', `/graphs/${id}`).then(normalizeGraph).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  save: (g) =>
    req('PUT', `/graphs/${g.id}`, { graph: g }).then(
      () => {
        dropPending(g.id)
        return true
      },
      // 인터넷이 끊겼으면 이 기기에 잠시 두었다가 연결되면 올린다
      (e) => siteConfig().then((c) => {
        if (!(e instanceof ApiError && e.status === 0 && (c.dev || c.flags?.includes('graph')))) return false
        setPending({ ...pendingAll(), [g.id]: g })
        return true
      }),
    ),
  remove: (id) => req('DELETE', `/graphs/${id}`).then(() => true, () => false),
}

/** 기관 (실험) */
export interface AdminHealth {
  startedAt: string; uptimeSec: number; node: string; memory: { rss: number; heap: number }
  storage: { db: number; backups: number; backupBytes: number; latest: string | null }; disk: { free: number; total: number } | null
  requests: { served: number; failed: number; recent: number; avg: number; p50: number; p95: number; max: number }; errors24h: number
}
export interface AdminBlock { limit: string; kind: 'ip' | 'name' | 'user' | 'all'; key: string; shown: string; alias: string; n: number; until: string }
export interface PrivacyRequest { id: string; kind: string; who: string; detail: string; receivedAt: string; status: string; doneAt: string; note: string }
export interface AdminOrg { invite?: string; id: string; name: string; createdAt: string; groups: { id: string; name: string; code: string }[]; managers: { id: string; nickname: string }[] }
export interface OrgPeriod { joined: number; graphs: number; posts: number; cheers: number; events: number; attended: number }
export interface MyOrg { id: string; name: string; code: string; invite: string; managers: { id: string; nickname: string; me: boolean }[]; groups: { id: string; name: string; code: string; report: GroupReport; period: OrgPeriod | null }[]; total: { groups: number; members: number; sharers: number; posts: number; moments: number; cheers: number; done: number; drawing: number } }

/* ───── 실험: 인터넷 없이 쓰기 ───── */
const PENDING = 'geuryeobom:pending'
const pendingAll = (): Record<string, LifeGraph> => {
  try { return JSON.parse(localStorage.getItem(PENDING) ?? '{}') } catch { return {} }
}
const setPending = (m: Record<string, LifeGraph>) => {
  try {
    if (Object.keys(m).length) localStorage.setItem(PENDING, JSON.stringify(m))
    else localStorage.removeItem(PENDING)
  } catch { /* 기기 저장이 막혀 있으면 어쩔 수 없다 */ }
}
const dropPending = (id: string) => {
  const m = pendingAll()
  if (m[id]) { delete m[id]; setPending(m) }
}
/**
 * 이 기기에 둔 것을 올린다 (연결이 돌아올 때 · 처음 열 때).
 * ponytail: 그 사이 다른 기기에서 고쳤어도 이 기기 것이 이긴다 (마지막 저장이 이김). 겹치면 ‘고치기 전 모습’ 으로 되돌릴 수 있다.
 */
export async function flushPending() {
  for (const [id, g] of Object.entries(pendingAll())) {
    try {
      await req('PUT', `/graphs/${id}`, { graph: g })
      dropPending(id)
    } catch (e) {
      // 서버가 받지 않는 그래프(지워짐 · 남의 것)는 버리고, 아직 연결이 안 되면 그대로 둔다
      if (e instanceof ApiError && e.status !== 0 && e.status !== 503 && e.status !== 401) dropPending(id)
    }
  }
}
