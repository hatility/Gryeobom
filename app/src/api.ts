import { normalizeGraph, type Repo } from './store.ts'
import type { PostOptions, SharedGraph } from './share.ts'
import type { GroupPreset, LifeGraph } from './types.ts'

export interface Me { id: string; nickname: string }
export interface ReceivedCheer { kind: string; groupName: string; title: string; createdAt: string }
export type GroupRole = 'owner' | 'co' | 'member'
export interface GroupSummary { id: string; name: string; role: GroupRole; memberCount: number; topic: string; topicAt: string }
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
  /** 모임장 · 모임장이나 공동 모임장(모임 꾸리기) */
  isOwner: boolean; isManager: boolean
  code?: string; preset: GroupPreset | null; members: GroupMember[]; posts: GroupPost[]
  /** 이 모임에서 다 그린 내 선인데 모임에 없는 것 (모임장이 내렸을 때 다시 올리기) */
  myUnposted: { graphId: string; title: string }[]
}
export interface Invite { name: string; intro: string; preset: GroupPreset | null; joined: boolean; id?: string }
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
  signup: (b: { name: string; birth: string; nickname: string; remember: boolean; agree: boolean }) =>
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
  setMemberRole: (groupId: string, userId: string, role: 'co' | 'member') => req('PUT', `/groups/${groupId}/members/${userId}`, { role }),
  transferGroup: (groupId: string, userId: string) => req('POST', `/groups/${groupId}/transfer`, { userId }),
  groupReport: (id: string) => req<GroupReport>('GET', `/groups/${id}/report`),
  setTopic: (id: string, topic: string) => req<{ topic: string; topicAt: string }>('PUT', `/groups/${id}/topic`, { topic }),
  report: (postId: string, reason: ReportReason, detail: string) => req('POST', `/posts/${postId}/report`, { reason, detail }),
  answers: () => req<Answer[]>('GET', '/me/answers'),
  saveAnswer: (a: Answer) => req<Answer>('PUT', `/me/answers/${a.day}`, { question: a.question, text: a.text, color: a.color ?? '' }),
  setPreset: (id: string, preset: GroupPreset | null) => req<{ preset: GroupPreset | null }>('PUT', `/groups/${id}/preset`, { preset }),
  invite: (code: string) => req<Invite>('GET', `/invite/${encodeURIComponent(code)}`),
  /** 초대 링크로 들어가기. 로그인하지 않았으면 이름 · 생일(처음이면 별명 · 동의까지)을 함께 보낸다 */
  joinByInvite: (code: string, b: { name?: string; birth?: string; nickname?: string; agree?: boolean; remember?: boolean } = {}) =>
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

  adminMe: () => req<{ enabled: boolean; admin: boolean }>('GET', '/admin/me'),
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
}

export interface AdminReport {
  id: string; postId: string | null; groupId: string | null; reason: ReportReason; detail: string
  postTitle: string; postOwner: string; groupName: string; createdAt: string; resolvedAt: string; reporter: string | null
  deletedAt: string; deleteReason: string
}
export interface AdminLink { code: string; createdAt: string; nickname: string | null; graphId: string | null; graph: SharedGraph }
export interface AdminLogin { id: number; ip: string; ok: boolean; agent: string; at: string; alias: string }
export interface AdminUser {
  id: string; nickname: string; createdAt: string; agreedAt: string; lastSeenAt: string
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
export interface SiteConfig { publicUrl: string | null; developer: Developer | null; operator: Operator | null }

/** 서버 설정(.env) 중 화면에 필요한 것. 서버가 없으면 빈 설정. 한 번만 받아 둔다. */
let cfg: Promise<SiteConfig> | null = null
export const siteConfig = () =>
  (cfg ??= req<SiteConfig>('GET', '/config').catch(() => ({ publicUrl: null, developer: null, operator: null })))

/** 공유 링크의 앞부분. 서버 .env 의 PUBLIC_URL, 없거나 서버가 없으면 지금 접속한 주소. */
export const shareBase = () => siteConfig().then((c) => c.publicUrl || location.origin)

/** 로그인했을 때의 저장소: 그려봄 서버 */
export const remoteRepo: Repo = {
  remote: true,
  list: () => req<LifeGraph[]>('GET', '/graphs').then((l) => l.map(normalizeGraph)),
  get: (id) => req<LifeGraph>('GET', `/graphs/${id}`).then(normalizeGraph).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  save: (g) => req('PUT', `/graphs/${g.id}`, { graph: g }).then(() => true, () => false),
  remove: (id) => req('DELETE', `/graphs/${id}`).then(() => true, () => false),
}
