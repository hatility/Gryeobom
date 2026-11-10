import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { downloadCsv, labOn, useLabs } from '../labs'
import { FLAGS, OFFICIAL, type Flag } from '../flags'
import type { DevChange, DevRelease, Scope } from '../devlog'
import { api, REPORT_REASONS, shareBase, siteConfig, type AdminBlock, type AdminHealth, type PrivacyRequest, type AdminStats, type StatKey, type AdminOrg, type AdminGroup, type AdminLink, type AdminLogin, type AdminOverview, type AdminReport, type AdminUser, type AdminNotice, type SiteConfig } from '../api'
import LifeGraph from '../components/LifeGraph'
import { NOW_QUESTIONS, questionsFor, lineColorOf, presetLabel, rangeLabel, scoreWord, signed, timeLabel } from '../content'
import { formatDate, graphPoints, graphTitle, sortEntries } from '../store'
import { GroupInfoForm } from './GroupPage'

type State = 'loading' | 'off' | 'login' | 'in'
type Tab = 'home' | 'reports' | 'notice' | 'flags' | 'inquiries' | 'orgs' | 'dormant' | 'errors' | 'devlog' | 'server' | 'blocks' | 'privacy' | 'admins' | 'users' | 'groups' | 'posts' | 'links' | 'logins' | 'settings' | 'backup'
const ROLE = { owner: '모임장', co: '공동 모임장', helper: '도우미', member: '함께하는 사람' } as const
const SCALE = { age: '나이로', year: '연도로', month: '달로' } as Record<string, string>

/** 화면 하나하나: 이름 · 설명 */
const TAB_INFO: Record<Tab, [string, string]> = {
  home: ['한눈에', '이번 주 흐름과 지금까지 쌓인 것을 한 화면에서 봐요.'],
  reports: ['신고함', '모임 사람들이 보낸 신고예요. 처리하지 않은 것이 위에 있어요.'],
  inquiries: ['문의함', '‘문의하기’ 로 들어온 문의예요. 답을 적으면 문의한 사람의 ‘내 문의’ 에 보여요. 개인정보 요청이면 요청 대장으로 옮겨 10일 안에 처리해요.'],
  notice: ['공지 · 점검', '사이트를 처음 열 때 한 번 뜨는 공지예요. 내용을 고치면 이미 본 사람에게도 다시 떠요. 점검 모드도 여기서.'],
  users: ['사람', '가입한 사람과 모든 기록이에요. 기록은 운영에 꼭 필요할 때만 열어 봐 주세요.'],
  groups: ['모임', '모임 이름 · 소개를 고치거나, 함께하는 사람과 나눈 그래프를 봐요.'],
  posts: ['나눈 그래프', '모임에 나눈 그래프예요. 내려도 본인의 기록은 그대로 남아요.'],
  links: ['공유 링크', '공유 링크로 나간 내용이에요 (회고는 담기지 않아요). 끄면 받은 사람도 더는 볼 수 없어요.'],
  orgs: ['기관', '담당자가 ‘기관’ 화면(/org)에서 직접 등록하고, 모임장이 연결 코드로 모임을 이어요. 여기서는 모든 기관을 살펴보고 필요하면 고치거나 지워요.'],
  privacy: ['요청 대장', '메일 · 전화 · 문의함으로 받은 열람 · 정정 · 삭제 · 처리정지 요청을 적어 두고 10일 안에 처리해요. 아래에 파기 기록.'],
  dormant: ['휴면 계정', '오래 다녀가지 않은 계정을 골라 정리해요 (개인정보 보유 기간). 지우면 되돌릴 수 없어요.'],
  logins: ['접속', '관리자 로그인 시도를 최근 300건까지 보여요. IP 에 별칭을 붙이면 누가 들어왔는지 알기 쉬워요.'],
  blocks: ['요청 제한 · 차단', '로그인 실패나 너무 많은 요청으로 지금 막혀 있는 곳이에요. 수련관 · 교실처럼 여럿이 한 IP 를 쓰다 막혔다면 풀어 주세요.'],
  errors: ['오류', '서버에서 난 오류(최근 500건)와 브라우저가 보낸 보안 정책 위반 보고예요. 누가 보냈는지는 남기지 않아요.'],
  server: ['서버 상태', '설정 진단 · 가동 시간 · 메모리 · DB · 디스크 · 응답 속도 · 자동 백업 · DB 점검이에요.'],
  backup: ['백업 · 복원', 'DB 를 파일 하나로 내려받거나, 그 파일로 되돌리거나, (개발 서버) 처음 상태로 비워요.'],
  settings: ['사이트 설정', '약관 · 처리방침의 운영 정보, 공유 주소, 만든 사람 정보, 약관 다시 동의를 정해요.'],
  flags: ['실험 기능 스위치', '1.1.0 부터 대부분 정식 기능이라 늘 켜져 있어요. 남은 실험 기능(보호자 동의)만 여기서 켜고 꺼요. 개발 테스트 서버는 늘 모두 켜져 있어요.'],
  admins: ['관리자 계정', '함께 운영할 관리자를 더해요. ‘보기만’ 은 열어 볼 수만 있고, ‘바꾸기까지’ 는 지우기 · 설정도 할 수 있어요.'],
  devlog: ['변경 내역', '개발 테스트 서버에서 바뀐 것을 무엇 · 어디에 · 어떻게 확인하는지와 함께 모았어요. ‘열기’ 는 새 탭으로 열려요.'],
}
/** 왼쪽 메뉴: 묶음 → [메뉴 이름, 그 안의 화면들]. 화면이 둘 이상이면 위에 작은 탭으로 */
const NAV: [string, [string, Tab[]][]][] = [
  ['운영', [['한눈에', ['home']], ['신고 · 문의', ['reports', 'inquiries']], ['공지 · 점검', ['notice']]]],
  ['사람 · 모임', [['사람', ['users']], ['모임', ['groups']], ['나눈 것', ['posts', 'links']], ['기관', ['orgs']]]],
  ['개인정보 · 보안', [['개인정보', ['privacy', 'dormant']], ['접속 · 차단', ['logins', 'blocks']], ['오류', ['errors']]]],
  ['서버 · 설정', [['서버 · 백업', ['server', 'backup']], ['설정', ['settings', 'flags', 'admins']]]],
  ['개발', [['변경 내역', ['devlog']]]],
]
/** 실험 기능이 켜졌을 때만 보이는 화면 */
const LABS_TABS: Tab[] = ['inquiries', 'orgs', 'errors', 'dormant', 'devlog', 'server', 'blocks', 'privacy', 'admins']
const ALL_TABS = Object.keys(TAB_INFO) as Tab[]

const ROLE_NAME: Record<string, string> = { owner: '처음 관리자', full: '바꾸기까지', viewer: '보기만' }
const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`)

/** 마지막으로 다녀간 때 (10분 단위로 기록된다) */
function since(iso: string): string {
  if (!iso) return '기록 없음'
  const min = (Date.now() - Date.parse(iso)) / 60_000
  if (min < 60) return '방금 전'
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`
  const d = Math.floor(min / 1440)
  return d < 30 ? `${d}일 전` : formatDate(iso)
}
/** 찾기: 띄어쓰기 · 대소문자 무시 */
const has = (q: string, ...xs: (string | null | undefined)[]) => {
  const k = q.replace(/\s+/g, '').toLowerCase()
  return !k || xs.some((x) => (x ?? '').replace(/\s+/g, '').toLowerCase().includes(k))
}

export default function AdminPage() {
  const labs = useLabs('ops')
  const labsOrg = useLabs('org')
  const [dev, setDev] = useState(false)
  useEffect(() => {
    siteConfig().then((c) => setDev(!!c.dev))
  }, [])
  /** 이 탭이 보이는지: 실험 탭은 그 묶음이 켜졌을 때 (변경 내역은 개발 서버만) */
  const shown = (k: Tab) => (k === 'admins' ? labs && me.role === 'owner' : !LABS_TABS.includes(k) || (k === 'devlog' ? dev : k === 'orgs' ? labsOrg : labs))
  const [state, setState] = useState<State>('loading')
  const [me, setMe] = useState<{ who?: string; role?: string }>({})
  // 신고 · 문의 알림: 30초마다 확인, 늘어나면 위에 알림 · 탭 제목에 숫자
  const [alerts, setAlerts] = useState({ reports: 0, inquiries: 0 })
  const [fresh, setFresh] = useState('')
  const lastAlerts = useRef<{ reports: number; inquiries: number } | null>(null)
  const refreshAlerts = () => api.adminMe().then((m) => {
    if (!m.alerts) return
    const was = lastAlerts.current
    if (was) {
      const r = m.alerts.reports - was.reports, q = m.alerts.inquiries - was.inquiries
      if (r > 0 || q > 0) setFresh([q > 0 && `새 문의 ${q}건`, r > 0 && `새 신고 ${r}건`].filter(Boolean).join(' · '))
    }
    lastAlerts.current = m.alerts
    setAlerts(m.alerts)
  }, () => {})
  useEffect(() => {
    if (state !== 'in') return
    refreshAlerts()
    const t = setInterval(refreshAlerts, 30_000)
    return () => clearInterval(t)
  }, [state])
  useEffect(() => {
    const n = alerts.reports + alerts.inquiries
    // 개발 서버의 ‘[개발] ’ 머리말 뒤에 붙인다 (앞에 붙이면 머리말이 한 번 더 붙는다)
    const base = document.title.replace(/\(\d+\) /, '')
    document.title = n ? base.replace(/^(\[개발\] )?/, `$1(${n}) `) : base
    return () => { document.title = document.title.replace(/\(\d+\) /, '') }
  }, [alerts])
  const [data, setData] = useState<AdminOverview | null>(null)
  const [form, setForm] = useState({ id: '', password: '' })
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    return t && ALL_TABS.includes(t) ? t : 'home'
  })
  const [q, setQ] = useState('')
  // 펼쳐 보는 것: 한 사람의 모든 기록, 또는 모임 하나
  const [view, setView] = useState<{ kind: 'user'; user: AdminUser } | { kind: 'group'; group: AdminGroup } | null>(null)
  const open = async (fn: () => Promise<NonNullable<typeof view>>) => {
    setErr('')
    try {
      setView(await fn())
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  const openUser = (id: string) => {
    setTab('users')
    return open(async () => ({ kind: 'user', user: await api.adminUser(id) }))
  }
  const openGroup = (id: string) => {
    setTab('groups')
    return open(async () => ({ kind: 'group', group: await api.adminGroup(id) }))
  }

  const load = () => api.adminOverview().then(setData, (e) => setErr(e.message))
  useEffect(() => {
    api.adminMe().then(
      (m) => {
        setMe(m)
        setState(!m.enabled ? 'off' : m.admin ? 'in' : 'login')
        if (m.admin) load()
      },
      () => setState('off'),
    )
  }, [])

  const login = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      await api.adminLogin(form.id, form.password)
      api.adminMe().then(setMe, () => {})
      setForm({ id: '', password: '' })
      setState('in')
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  const logout = async () => {
    await api.adminLogout().catch(() => {})
    setData(null)
    setAlerts({ reports: 0, inquiries: 0 })
    setFresh('')
    lastAlerts.current = null
    setState('login')
  }
  const remove = async (kind: 'groups' | 'users' | 'posts', id: string, text: string) => {
    if (!window.confirm(text)) return
    setErr('')
    try {
      await api.adminDelete(kind, id)
      setView(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }

  if (state === 'loading') return <p className="container page loading serif">확인하는 중이에요…</p>
  if (state === 'off') {
    return (
      <section className="container page empty-state">
        <p className="eyebrow en">ADMIN</p>
        <h1 className="page-title">관리자 기능이 꺼져 있어요</h1>
        <p className="muted">서버의 <code>.env</code> 에 <code>ADMIN_ID</code> · <code>ADMIN_PASSWORD</code>(12자 이상)를 정하고 다시 시작해 주세요.</p>
      </section>
    )
  }
  if (state === 'login') {
    return (
      <section className="container page auth-page">
        <header className="page-head">
          <div>
            <p className="eyebrow en">ADMIN</p>
            <h1 className="page-title">관리자 로그인</h1>
            <p className="muted">운영자만 들어올 수 있어요.</p>
          </div>
        </header>
        <form className="card form-card auth-card" onSubmit={login}>
          <label className="field">
            <span className="field-label">관리자 아이디</span>
            <input name="admin-id" autoComplete="username" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field-label">비밀번호</span>
            <input name="admin-password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          {err && <p className="alert" role="alert">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block">로그인</button>
        </form>
      </section>
    )
  }

  const c = data?.counts
  const count: Partial<Record<Tab, number | undefined>> = { users: c?.users, groups: c?.groups, posts: c?.posts, links: c?.links }
  const urgent = alerts.reports + alerts.inquiries
  const choose = (t: Tab) => {
    setTab(t)
    setView(null)
    setQ('')
    const u = new URL(window.location.href)
    u.searchParams.set('tab', t)
    window.history.replaceState(null, '', u)
  }
  const [title, desc] = TAB_INFO[tab]
  // 지금 화면이 든 메뉴와, 그 메뉴의 보이는 화면들 (둘 이상이면 위에 작은 탭)
  const navOf = NAV.flatMap(([, items]) => items).find(([, tabs]) => tabs.includes(tab))
  const siblings = navOf ? navOf[1].filter(shown) : []
  const searchable = !view && (tab === 'users' || tab === 'groups' || tab === 'posts')

  const users = data?.users.filter((u) => has(q, u.nickname)) ?? []
  const groups = data?.groups.filter((g) => has(q, g.name, g.owner, g.code)) ?? []
  const posts = data?.posts.filter((p) => has(q, p.title, p.nickname, p.groupName)) ?? []

  return (
    <section className="container page admin">
      <header className="admin-top">
        <div>
          <p className="eyebrow en">ADMIN</p>
          <h1 className="page-title">운영</h1>
        </div>
        <span className="admin-who">
          {me.who && labs && <span className="muted small">{me.who} · {ROLE_NAME[me.role ?? ''] ?? ''}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>관리자 로그아웃</button>
        </span>
      </header>
      {me.role === 'viewer' && <p className="notice admin-viewer-note">보기만 하는 관리자 계정이에요. 지우기 · 저장 · DB 내려받기를 누르면 막혀요.</p>}
      {fresh && (
        <p className="admin-fresh" role="status">
          <strong>{fresh} 이 왔어요</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFresh(''); choose(alerts.inquiries ? 'inquiries' : 'reports') }}>보러 가기</button>
          <button type="button" className="btn btn-text btn-sm" onClick={() => setFresh('')}>닫기</button>
        </p>
      )}

      <div className="admin-layout">
        <nav className="admin-nav" aria-label="관리 메뉴">
          {NAV.map(([group, all]) => [group, all.map(([label, tabs]) => [label, tabs.filter(shown)] as const).filter(([, tabs]) => tabs.length)] as const)
            .filter(([, items]) => items.length).map(([group, items]) => (
            <div key={group} className="admin-nav-group">
              <p className="admin-nav-title">{group}</p>
              {items.map(([label, tabs]) => {
                const here = tabs.includes(tab)
                const n = tabs.length === 1 ? count[tabs[0]] : undefined
                return (
                  <button key={label} type="button" className="admin-nav-item" aria-current={here ? 'page' : undefined} onClick={() => choose(here ? tab : tabs[0])}>
                    <span>{label}</span>
                    {tabs.includes('reports') && urgent > 0 ? <span className="admin-badge is-alert">{urgent}</span> : n !== undefined && <span className="admin-badge">{n}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="admin-main">
          {!view && siblings.length > 1 && (
            <div className="admin-subtabs" role="tablist" aria-label={navOf![0]}>
              {siblings.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={t === tab} className="admin-subtab" onClick={() => choose(t)}>
                  {TAB_INFO[t][0]}
                  {t === 'reports' && alerts.reports > 0 && <span className="admin-badge is-alert">{alerts.reports}</span>}
                  {t === 'inquiries' && alerts.inquiries > 0 && <span className="admin-badge is-alert">{alerts.inquiries}</span>}
                  {count[t] !== undefined && <span className="admin-badge">{count[t]}</span>}
                </button>
              ))}
            </div>
          )}
          <header className="admin-section-head">
            <div>
              <h2>{view?.kind === 'user' ? `사람 · ${view.user.nickname}` : view?.kind === 'group' ? `모임 · ${view.group.name}` : title}</h2>
              {!view && <p className="muted small">{desc}</p>}
            </div>
            {searchable && (
              <input
                type="search"
                className="admin-search"
                value={q}
                placeholder={tab === 'users' ? '별명으로 찾기' : tab === 'groups' ? '모임 이름 · 모임장 · 코드' : '제목 · 나눈 사람 · 모임'}
                aria-label="찾기"
                onChange={(e) => setQ(e.target.value)}
              />
            )}
          </header>
          {err && <p className="alert" role="alert">{err}</p>}

          {tab === 'devlog' ? (
            <DevlogTab />
          ) : tab === 'flags' ? (
            <FlagsTab />
          ) : tab === 'inquiries' ? (
            <InquiriesTab onChanged={refreshAlerts} />

          ) : tab === 'admins' ? (
            me.role === 'owner' ? <AccountsTab /> : <p className="muted">관리자 계정은 처음 관리자(.env 의 ADMIN_ID)만 정할 수 있어요.</p>
          ) : tab === 'server' ? (
            <>
              <DiagnoseCard />
              <ServerTab />
              <DbCheckCard />
            </>
          ) : tab === 'blocks' ? (
            <BlocksTab />
          ) : tab === 'privacy' ? (
            <>
              <PrivacyTab />
              <PurgesCard />
            </>
          ) : tab === 'dormant' ? (
            <DormantTab onDone={load} />
          ) : tab === 'errors' ? (
            <>
              <ErrorsTab />
              <CspCard />
            </>
          ) : tab === 'orgs' ? (
            <OrgsTab users={data?.users ?? []} />
          ) : tab === 'notice' ? (
            <>
              <NoticeSettings />
              <DevOnly flag="ops"><MaintenanceCard /></DevOnly>
            </>
          ) : tab === 'settings' ? (
            <>
              <SiteSettings />
              <DevOnly flag="me"><TermsSettings /></DevOnly>
            </>
          ) : tab === 'backup' ? (
            <>
              <BackupCard />
              <RestoreCard onDone={load} />
              {/* DB 초기화는 개발 테스트 서버에만 */}
              <DevOnly><ResetCard onDone={load} /></DevOnly>
            </>
          ) : tab === 'links' ? (
            <LinksTab />
          ) : tab === 'logins' ? (
            <LoginsTab />
          ) : tab === 'reports' ? (
            <ReportsTab onGroup={openGroup} onChanged={() => { load(); refreshAlerts() }} />
          ) : view?.kind === 'user' ? (
            <UserPanel user={view.user} onClose={() => setView(null)} onGroup={openGroup} />
          ) : view?.kind === 'group' ? (
            <GroupPanel
              key={view.group.id}
              group={view.group}
              onClose={() => setView(null)}
              onSaved={async () => {
                await openGroup(view.group.id)
                await load()
              }}
              onUser={openUser}
            />
          ) : !data ? (
            <p className="muted serif">불러오는 중이에요…</p>
          ) : tab === 'home' ? (
            <>
              <Overview data={data} onUser={openUser} onReports={() => choose('reports')} />
              <DevOnly flag="ops"><UpdateCard /></DevOnly>
              <DevOnly flag="ops"><StatsCard /></DevOnly>
              <DevOnly flag="ops"><FunnelCard /></DevOnly>
              <DevOnly flag="ops"><HoursCard /></DevOnly>
            </>
          ) : tab === 'users' ? (
            <AdminTable
              empty={q ? '찾는 사람이 없어요.' : '아직 가입한 사람이 없어요.'}
              head={['별명', '그래프 (완성)', '모임', '나눈 그래프', '마지막 방문', '가입한 날', '']}
              rows={users.map((u) => [
                <button key="n" type="button" className="admin-link" onClick={() => openUser(u.id)}>{u.nickname}</button>,
                <span key="g">{u.graphCount} <small className="muted">({u.completedCount})</small></span>,
                u.groupCount, u.postCount,
                <span key="s" className={u.lastSeenAt ? '' : 'muted'}>{since(u.lastSeenAt)}</span>,
                formatDate(u.createdAt),
                <span key="d" className="admin-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openUser(u.id)}>자세히</button>
                  <button type="button" className="btn btn-text danger btn-sm" onClick={() => remove('users', u.id, `‘${u.nickname}’ 계정을 지울까요? 그 사람의 모든 기록이 함께 지워지고 되돌릴 수 없어요.`)}>지우기</button>
                </span>,
              ])}
            />
          ) : tab === 'groups' ? (
            <AdminTable
              empty={q ? '찾는 모임이 없어요.' : '아직 모임이 없어요.'}
              head={['이름', '모임장', '사람', '나눈 그래프', '참여 코드', '만든 날', '']}
              rows={groups.map((g) => [
                <button key="n" type="button" className="admin-link admin-name" onClick={() => openGroup(g.id)}>{g.name}</button>, g.owner, g.memberCount, g.postCount, <code key="c">{g.code}</code>, formatDate(g.createdAt),
                <span key="d" className="admin-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openGroup(g.id)}>보기 · 고치기</button>
                  <button type="button" className="btn btn-text danger btn-sm" onClick={() => remove('groups', g.id, `‘${g.name}’ 모임을 없앨까요? 모임에 나눈 그래프도 모두 내려가요.`)}>없애기</button>
                </span>,
              ])}
            />
          ) : (
            <AdminTable
              empty={q ? '찾는 그래프가 없어요.' : '아직 나눈 그래프가 없어요.'}
              head={['제목', '나눈 사람', '모임', '나눈 날', '']}
              rows={posts.map((p) => [
                <strong key="n" className="admin-name">{p.title || '이름 없는 이야기'}</strong>, p.nickname, <span key="g" className="admin-name">{p.groupName}</span>, formatDate(p.createdAt),
                <button key="d" type="button" className="btn btn-text danger btn-sm" onClick={() => remove('posts', p.id, `‘${p.title || '이름 없는 이야기'}’ 를 모임에서 내릴까요? (본인의 기록은 그대로 남아요)`)}>내리기</button>,
              ])}
            />
          )}
        </div>
      </div>
    </section>
  )
}

/** 신고함: 무엇을 · 누가 · 왜. 모임으로 가 보거나, 글을 내리거나, 처리 완료로 둔다. */
function ReportsTab({ onGroup, onChanged }: { onGroup: (id: string) => void; onChanged: () => void }) {
  const [list, setList] = useState<AdminReport[] | null>(null)
  const [err, setErr] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const load = () => api.adminReports(showDeleted).then(setList, (e) => setErr(e.message))
  useEffect(() => {
    setList(null)
    load()
  }, [showDeleted])
  const [deleting, setDeleting] = useState<AdminReport | null>(null)
  const remove = (r: AdminReport) => setDeleting(r)
  const act = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setErr('')
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  const toggle = (
    <div className="segmented-sm admin-report-toggle" role="tablist" aria-label="신고 보기">
      <button type="button" role="tab" className="seg-btn" aria-selected={!showDeleted} onClick={() => setShowDeleted(false)}>신고</button>
      <button type="button" role="tab" className="seg-btn" aria-selected={showDeleted} onClick={() => setShowDeleted(true)}>지운 신고</button>
    </div>
  )
  if (!list) return <>{toggle}<p className="muted serif">불러오는 중이에요…</p></>
  if (!list.length) return <>{toggle}<p className="card admin-empty muted">{showDeleted ? '지운 신고 기록이 없어요.' : '아직 들어온 신고가 없어요.'}</p></>
  return (
    <>
      {toggle}
      {err && <p className="alert" role="alert">{err}</p>}
      <ul className="admin-reports">
        {list.map((r) => (
          <li key={r.id} className={`card admin-report${r.resolvedAt ? ' is-done' : ''}${r.reason === 'danger' && !r.resolvedAt ? ' is-danger' : ''}`}>
            <div className="admin-report-head">
              <span className={`tag${r.reason === 'danger' ? ' is-alert' : ''}`}>{REPORT_REASONS[r.reason]}</span>
              <small className="muted">{new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</small>
              {r.resolvedAt && <span className="tag is-on">처리함 · {formatDate(r.resolvedAt)}</span>}
            </div>
            <p className="admin-report-title">
              <strong>‘{r.postTitle || '이름 없는 이야기'}’</strong> <span className="muted">· {r.postOwner}님이 {r.groupName}에 나눈 그래프</span>
              {!r.postId && <span className="tag">이미 내려감</span>}
            </p>
            {r.detail && <p className="admin-report-detail serif">“{r.detail}”</p>}
            <p className="muted small">신고한 사람 · {r.reporter ?? '탈퇴한 사람'}</p>
            {r.deletedAt && <p className="small admin-report-deleted">지움 · {formatDate(r.deletedAt)} · 까닭: {r.deleteReason}</p>}
            {r.reason === 'danger' && !r.resolvedAt && !r.deletedAt && <p className="small danger">도움이 필요해 보인다는 신고예요. 모임장 · 기관 담당자와 함께 살펴보고, 필요하면 청소년상담 1388 을 안내해 주세요.</p>}
            {!r.deletedAt && <div className="admin-actions">
              {r.groupId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGroup(r.groupId!)}>모임에서 보기</button>}
              {r.postId && !r.resolvedAt && (
                <button type="button" className="btn btn-text danger btn-sm" onClick={() => act(() => api.adminDelete('posts', r.postId!), `‘${r.postTitle}’ 를 모임에서 내릴까요? (본인의 기록은 그대로 남아요)`)}>글 내리기</button>
              )}
              <button type="button" className={r.resolvedAt ? 'btn btn-text btn-sm' : 'btn btn-primary btn-sm'} onClick={() => act(() => api.adminResolveReport(r.id, !!r.resolvedAt))}>
                {r.resolvedAt ? '다시 열기' : '처리 완료'}
              </button>
              <button type="button" className="btn btn-text btn-sm muted" onClick={() => remove(r)}>기록 지우기</button>
            </div>}
          </li>
        ))}
      </ul>
      {deleting && (
        <DeleteReportDialog
          report={deleting}
          onClose={() => setDeleting(null)}
          onDone={async () => {
            setDeleting(null)
            await load()
            onChanged()
          }}
        />
      )}
      <p className="muted small">처리한 신고와 지운 신고는 1년 뒤 완전히 지워져요. 운영자가 글을 내리면, 그린 사람이 그래프를 고칠 때 바로 다시 나눠져요.</p>
    </>
  )
}

const DELETE_REASONS = ['시험 신고', '중복 신고', '잘못 들어온 신고', '이미 처리한 일']

/** 신고 기록 지우기 팝업: 무엇을 지우는지 보여 주고, 까닭(2자 이상)을 받아야 지운다 */
function DeleteReportDialog({ report, onClose, onDone }: { report: AdminReport; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const ok = reason.trim().length >= 2
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    setErr('')
    try {
      await api.adminDeleteReport(report.id, reason.trim())
      ref.current?.close()
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '지우지 못했어요.')
      setBusy(false)
    }
  }
  return (
    <dialog ref={ref} className="dialog delete-report-dialog" aria-labelledby="del-report-title" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <h2 id="del-report-title" className="card-title">신고 기록 지우기</h2>
        <div className="del-report-target">
          <span className="tag">{REPORT_REASONS[report.reason]}</span>
          <strong>‘{report.postTitle || '이름 없는 이야기'}’</strong>
          <small className="muted">{report.postOwner}님 · {report.groupName} · {new Date(report.createdAt).toLocaleDateString('ko-KR')} 신고</small>
        </div>
        <fieldset className="del-report-quick">
          <legend className="field-label">지우는 까닭</legend>
          <div className="chips">
            {DELETE_REASONS.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <textarea
            rows={2}
            maxLength={200}
            value={reason}
            autoFocus
            placeholder="직접 적어도 돼요 (2자 이상)"
            aria-label="지우는 까닭"
            onChange={(e) => setReason(e.target.value)}
          />
        </fieldset>
        <p className="muted small">지운 기록은 목록에서 사라지지만, ‘지운 신고’에서 지운 날 · 까닭과 함께 1년 동안 볼 수 있어요.</p>
        {err && <p className="alert" role="alert">{err}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>취소</button>
          <button type="submit" className="btn btn-danger" disabled={!ok || busy}>{busy ? '지우는 중…' : '기록 지우기'}</button>
        </div>
      </form>
    </dialog>
  )
}

/** 백업 파일로 되돌리기: 파일 · 관리자 비밀번호 · 확인 세 가지를 모두 받아야 누를 수 있다 */
function RestoreCard({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pw, setPw] = useState('')
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const go = async (e: FormEvent) => {
    e.preventDefault()
    if (!file || !pw || !sure) return
    if (!window.confirm(`지금 DB 를 ‘${file.name}’ 내용으로 바꿀까요? 백업 뒤에 생긴 기록은 사라져요.`)) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.adminRestore(file, pw)
      setMsg({
        ok: true,
        text: `되돌렸어요. 사람 ${r.users}명 · 그래프 ${r.graphs}개 · 모임 ${r.groups}개. 바꾸기 전의 DB 는 서버의 데이터 폴더에 ‘${r.before}’ 로 남겨 두었어요.` +
          (r.secretMissing ? ' 이 백업에는 로그인 비밀값이 없어요(그 서버는 .env 의 AUTH_SECRET 을 썼어요). 그 값을 이 서버의 .env 에도 넣고 다시 시작해야 회원들이 로그인할 수 있어요.' : ''),
      })
      setFile(null)
      setPw('')
      setSure(false)
      if (fileRef.current) fileRef.current.value = ''
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '되돌리지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card admin-settings restore-card" onSubmit={go}>
      <h3 className="card-title">백업으로 되돌리기 (복원)</h3>
      <p className="muted small">
        내려받아 둔 <code>.db</code> 파일로 모든 계정 · 기록 · 모임을 그때로 되돌려요. 예전 버전에서 만든 백업도 돼요.
        바꾸기 전의 DB 는 서버에 따로 남겨 두니(최근 5개), 잘못 골랐다면 그 파일로 다시 되돌릴 수 있어요. 관리자 접속 기록과 지금 로그인은 그대로예요.
      </p>
      <p className="alert">백업한 뒤에 탈퇴한 사람이 있다면 그 계정과 기록이 되살아나요. 되돌린 뒤 ‘사람’에서 그 계정을 다시 지워 주세요 (개인정보 처리방침 ‘파기’).</p>
      <label className="field">
        <span className="field-label">백업 파일 (.db)</span>
        <input ref={fileRef} type="file" accept=".db,.sqlite,application/vnd.sqlite3,application/octet-stream" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <small className="muted">{file.name} · {(file.size / 1024 / 1024).toFixed(2)}MB</small>}
      </label>
      <label className="field">
        <span className="field-label">관리자 비밀번호 (한 번 더)</span>
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        <span>지금 내용이 모두 이 백업으로 바뀌고, 백업 뒤에 생긴 기록은 사라진다는 걸 알아요.</span>
      </label>
      {msg && <p className={msg.ok ? 'notice' : 'alert'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-danger" disabled={!file || !pw || !sure || busy}>{busy ? '되돌리는 중…' : '이 백업으로 되돌리기'}</button>
      </div>
    </form>
  )
}

const STAT_COLS: [StatKey, string][] = [['signups', '새 가입'], ['graphs', '새 그래프'], ['groups', '새 모임'], ['posts', '나눔'], ['cheers', '응원'], ['answers', '오늘의 한 줄']]
const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
/** 기간을 골라 날마다 몇 개가 생겼는지 — 실적 보고용 표 (CSV) */
function StatsCard() {
  const today = new Date()
  const presets: [string, () => [string, string]][] = [
    ['최근 30일', () => [ymd(new Date(today.getTime() - 29 * 864e5)), ymd(today)]],
    ['이번 달', () => [ymd(today).slice(0, 8) + '01', ymd(today)]],
    ['지난달', () => {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1), last = new Date(today.getFullYear(), today.getMonth(), 0)
      return [`${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`, `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`]
    }],
    ['올해', () => [`${today.getFullYear()}-01-01`, ymd(today)]],
  ]
  const [range, setRange] = useState<[string, string]>(presets[0][1])
  const [s, setS] = useState<AdminStats | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setErr('')
    api.adminStats(range[0], range[1]).then(setS, (e) => { setS(null); setErr(e.message) })
  }, [range])
  return (
    <section className="card stats-card">
      <div className="stats-head">
        <h3 className="card-title">기간별 통계</h3>
        <span className="stats-presets">
          {presets.map(([label, fn]) => <button key={label} type="button" className="chip" onClick={() => setRange(fn())}>{label}</button>)}
        </span>
      </div>
      <div className="stats-range">
        <input type="date" value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} aria-label="시작 날짜" />
        <span className="muted">~</span>
        <input type="date" value={range[1]} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} aria-label="끝 날짜" />
        {s && <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`그려봄-통계-${s.from}_${s.to}.csv`, [['날짜', ...STAT_COLS.map(([, l]) => l)], ...s.rows.map((r) => [r.day, ...STAT_COLS.map(([k]) => r[k])]), ['합계', ...STAT_COLS.map(([k]) => s.total[k])]])}>표로 내려받기 (CSV)</button>}
      </div>
      {err && <p className="alert" role="alert">{err}</p>}
      {s && (
        <>
          <ul className="stats-total">
            {STAT_COLS.map(([k, label]) => <li key={k}><strong>{s.total[k]}</strong><span className="muted small">{label}</span></li>)}
          </ul>
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead><tr><th>날짜</th>{STAT_COLS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>
                {[...s.rows].reverse().map((r) => <tr key={r.day}><td>{r.day.slice(5).replace('-', '.')}</td>{STAT_COLS.map(([k]) => <td key={k} className={r[k] ? '' : 'muted'}>{r[k]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * 개발 테스트 서버: 릴리스 로그 (무엇 · 어디에 · 확인 방법). 내용은 src/devlog.ts — 필요할 때만 불러온다.
 * 왼쪽 묶음 목록(확인한 비율) · 오른쪽 항목(눌러 펼침). 확인 칸은 이 브라우저에 기억한다.
 */
const DEVLOG_KEY = 'geuryeobom:devlog-checked'
function DevlogTab() {
  const [log, setLog] = useState<DevRelease[] | null>(null)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'' | Scope>('')
  const [todo, setTodo] = useState(false)
  const [rel, setRel] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(DEVLOG_KEY) ?? '{}') } catch { return {} }
  })
  useEffect(() => {
    import('../devlog').then((m) => { setLog(m.DEVLOG); setRel(m.DEVLOG[0]?.id ?? '') })
  }, [])
  if (!log) return <p className="muted">불러오는 중이에요…</p>
  const key = (r: DevRelease, c: DevChange, x: string) => `${r.id}|${c.title}|${x}`
  const toggleCheck = (k: string) => {
    const next = { ...done, [k]: !done[k] }
    if (!next[k]) delete next[k]
    setDone(next)
    try { localStorage.setItem(DEVLOG_KEY, JSON.stringify(next)) } catch { /* 기억 못 해도 화면은 그대로 */ }
  }
  const itemDone = (r: DevRelease, c: DevChange) => c.check.every((x) => done[key(r, c, x)])
  const progress = (r: DevRelease) => r.items.reduce((n, c) => n + (itemDone(r, c) ? 1 : 0), 0)
  const searching = !!q || !!scope || todo
  const match = (r: DevRelease, c: DevChange) => (!scope || c.scope === scope) && (!todo || !itemDone(r, c)) && has(q, c.title, c.where, c.what, c.files, c.path, ...c.check)
  // 찾는 중이면 모든 묶음에서, 아니면 고른 묶음만
  const shown = log.filter((r) => searching || r.id === rel).map((r) => ({ r, items: r.items.filter((c) => match(r, c)) })).filter((x) => x.items.length)
  const ids = shown.flatMap(({ r, items }) => items.map((c) => `${r.id}|${c.title}`))
  const allOpen = ids.length > 0 && ids.every((i) => open.has(i))
  const flip = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const total = log.reduce((n, r) => n + r.items.length, 0)
  const checked = log.reduce((n, r) => n + progress(r), 0)
  return (
    <div className="devlog2">
      <aside className="devlog-rels" aria-label="묶음">
        <p className="muted small">확인 {checked} / {total}</p>
        {log.map((r) => {
          const p = progress(r)
          return (
            <button key={r.id} type="button" className="devlog-rel" aria-current={!searching && rel === r.id ? 'true' : undefined} onClick={() => { setRel(r.id); setQ(''); setScope(''); setTodo(false) }}>
              <strong>{r.title}</strong>
              <small className="muted">{r.date} · {r.items.length}개</small>
              <span className="devlog-bar" aria-label={`${r.items.length}개 중 ${p}개 확인`}><i style={{ width: `${(p / r.items.length) * 100}%` }} /></span>
            </button>
          )
        })}
      </aside>
      <div className="devlog-main">
        <div className="devlog-tools">
          <input type="search" value={q} placeholder="찾기 (예: 출석, QR, /org)" aria-label="변경 내역 찾기" onChange={(e) => setQ(e.target.value)} />
          <span className="stats-presets">
            {(['', '개발만', '정식 · 개발'] as const).map((x) => <button key={x} type="button" className="chip" aria-pressed={scope === x} onClick={() => setScope(x)}>{x || '모두'}</button>)}
            <button type="button" className="chip" aria-pressed={todo} onClick={() => setTodo(!todo)}>확인 안 한 것만</button>
          </span>
          <button type="button" className="btn btn-text btn-sm" onClick={() => setOpen(allOpen ? new Set() : new Set(ids))}>{allOpen ? '모두 접기' : '모두 펼치기'}</button>
        </div>
        {!searching && (() => {
          const r = log.find((x) => x.id === rel)
          return r ? <p className="devlog-summary2"><strong>{r.title}</strong> · {r.date}<br /><span className="muted small">{r.summary}</span></p> : null
        })()}
        {!shown.length && <p className="muted">{todo ? '모두 확인했어요 👍' : '찾는 항목이 없어요.'}</p>}
        {shown.map(({ r, items }) => (
          <section key={r.id} className="devlog-group">
            {searching && <p className="devlog-group-title">{r.title} <small className="muted">· {r.date}</small></p>}
            <ul className="devlog-rows">
              {items.map((c) => {
                const id = `${r.id}|${c.title}`, isOpen = open.has(id), ok = itemDone(r, c)
                const n = c.check.filter((x) => done[key(r, c, x)]).length
                return (
                  <li key={id} className={`devlog-row${ok ? ' is-done' : ''}${isOpen ? ' is-open' : ''}`}>
                    <button type="button" className="devlog-row-head" aria-expanded={isOpen} onClick={() => flip(id)}>
                      <span className="devlog-state" aria-hidden="true">{ok ? '✓' : n ? '◐' : '○'}</span>
                      <span className="devlog-row-title"><strong>{c.title}</strong><small className="muted">{c.where}</small></span>
                      <span className={`badge ${c.scope === '개발만' ? 'badge-dev' : 'badge-soft'}`}>{c.scope === '개발만' ? '개발' : '정식'}</span>
                      <small className="muted devlog-count">{n}/{c.check.length}</small>
                    </button>
                    {isOpen && (
                      <div className="devlog-row-body">
                        <p className="devlog-what">{c.what}</p>
                        {c.path && <p className="devlog-where"><code>{c.path}</code> <a className="btn btn-text btn-sm" href={c.path} target="_blank" rel="noreferrer">열기 ↗</a></p>}
                        <ul className="devlog-checks">
                          {c.check.map((x) => (
                            <li key={x}><label className="check"><input type="checkbox" checked={!!done[key(r, c, x)]} onChange={() => toggleCheck(key(r, c, x))} /> <span>{x}</span></label></li>
                          ))}
                        </ul>
                        {c.files && <p className="muted small devlog-files">코드 · {c.files}</p>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/** 휴면 계정 정리 */
function DormantTab({ onDone }: { onDone: () => void }) {
  const [months, setMonths] = useState(12)
  const [list, setList] = useState<Awaited<ReturnType<typeof api.adminDormant>>['users'] | null>(null)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState('')
  const load = () => api.adminDormant(months).then((r) => { setList(r.users); setPick(new Set()) }, (e) => setMsg(e.message))
  useEffect(() => {
    load()
  }, [months])
  const purge = async () => {
    if (!pick.size || !window.confirm(`고른 ${pick.size}개 계정과 그 기록을 모두 지울까요? 되돌릴 수 없어요.`)) return
    const r = await api.adminPurgeDormant(months, [...pick]).catch((e) => { setMsg(e.message); return null })
    if (r) setMsg(`${r.deleted}개 계정을 정리했어요.`)
    load()
    onDone()
  }
  return (
    <>
      <div className="stats-range">
        <label className="field-label" htmlFor="dormant-months">마지막으로 다녀간 지</label>
        <select id="dormant-months" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[6, 12, 24].map((m) => <option key={m} value={m}>{m}개월 넘음</option>)}
        </select>
        {list && list.length > 0 && <button type="button" className="btn btn-text btn-sm" onClick={() => setPick(pick.size === list.length ? new Set() : new Set(list.map((u) => u.id)))}>{pick.size === list.length ? '모두 풀기' : '모두 고르기'}</button>}
        <button type="button" className="btn btn-danger btn-sm" disabled={!pick.size} onClick={purge}>고른 {pick.size}개 정리하기</button>
      </div>
      <p className="muted small">개인정보 처리방침의 보유 기간에 맞춰 정리해요. 정리하기 전 ‘DB 백업 내려받기’ 를 해 두면 안전해요. 지우는 순간에도 다시 확인해, 그 사이 다녀간 사람은 남겨요.</p>
      {msg && <p className="notice" role="status">{msg}</p>}
      <AdminTable
        head={['', '별명', '가입', '마지막으로 다녀감', '그래프']}
        empty="휴면 계정이 없어요."
        rows={(list ?? []).map((u) => [
          <input key="c" type="checkbox" aria-label={`${u.nickname} 고르기`} checked={pick.has(u.id)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n })} />,
          u.nickname, formatDate(u.createdAt), u.lastSeenAt ? formatDate(u.lastSeenAt) : '기록 없음', u.graphCount,
        ])}
      />
    </>
  )
}

/** 최근 서버 오류 */
function ErrorsTab() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminErrors>> | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.adminErrors().then(setRows, (e) => setErr(e.message))
  }, [])
  if (err) return <p className="alert" role="alert">{err}</p>
  if (!rows) return <p className="muted">불러오는 중이에요…</p>
  if (!rows.length) return <p className="muted">최근 오류가 없어요. 잘 돌아가고 있어요.</p>
  return (
    <ul className="error-list">
      {rows.map((r, i) => (
        <li key={i} className="card">
          <p className="small"><strong>{new Date(r.at).toLocaleString('ko-KR')}</strong> · <code>{r.method} {r.path}</code></p>
          <p className="error-msg">{r.message}</p>
          {r.stack && <details><summary className="muted small">자세히</summary><pre>{r.stack}</pre></details>}
        </li>
      ))}
    </ul>
  )
}

/** 기관 — 모임 묶기 · 담당자 정하기 */
function OrgsTab({ users }: { users: AdminOverview['users'] }) {
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null)
  const [edit, setEdit] = useState<{ id: string; name: string; codes: string; managers: string[] } | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => api.adminOrgs().then(setOrgs, (e) => setMsg(e.message))
  useEffect(() => {
    load()
  }, [])
  const save = async () => {
    if (!edit) return
    setMsg('')
    try {
      await api.adminSaveOrg(edit.id, { name: edit.name, codes: edit.codes.split(/[\s,]+/).filter(Boolean), managerIds: edit.managers })
      setEdit(null)
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장하지 못했어요.')
    }
  }
  const remove = async (o: AdminOrg) => {
    if (!window.confirm(`‘${o.name}’ 기관을 지울까요? 모임 · 계정은 그대로 남아요.`)) return
    await api.adminDeleteOrg(o.id).catch(() => {})
    load()
  }
  if (edit) {
    const shown = users.filter((u) => edit.managers.includes(u.id) || has(q, u.nickname)).slice(0, 30)
    return (
      <form className="card form-card admin-settings" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="field"><span className="field-label">기관 이름</span><input value={edit.name} maxLength={40} required onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label className="field">
          <span className="field-label">묶을 모임의 참여 코드</span>
          <textarea rows={3} value={edit.codes} placeholder="예) K7M2QX DTQWCX (띄어 쓰거나 줄을 바꿔요)" onChange={(e) => setEdit({ ...edit, codes: e.target.value })} />
        </label>
        <fieldset className="field">
          <legend className="field-label">기관 담당자 ({edit.managers.length}명)</legend>
          <input value={q} placeholder="별명으로 찾기" aria-label="담당자 별명으로 찾기" onChange={(e) => setQ(e.target.value)} />
          <ul className="pick-list">
            {shown.map((u) => (
              <li key={u.id}>
                <label className="check">
                  <input type="checkbox" checked={edit.managers.includes(u.id)} onChange={(e) => setEdit({ ...edit, managers: e.target.checked ? [...edit.managers, u.id] : edit.managers.filter((x) => x !== u.id) })} />
                  <span>{u.nickname} <small className="muted">· 가입 {formatDate(u.createdAt)} · {u.id}</small></span>
                </label>
              </li>
            ))}
          </ul>
          <small className="muted">담당자는 ‘기관 리포트’(/org)에서 이 모임들의 리포트만 모아 봐요. 개인 기록은 볼 수 없어요.</small>
        </fieldset>
        {(() => { const o = orgs?.find((x) => x.id === edit.id); return o ? <div className="field"><span className="field-label">담당자 초대 링크</span><OrgInviteButton org={o} onChange={load} /></div> : null })()}
        {msg && <p className="alert" role="alert">{msg}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">저장</button>
          <button type="button" className="btn btn-text" onClick={() => setEdit(null)}>닫기</button>
        </div>
      </form>
    )
  }
  return (
    <>
      <div className="admin-toolbar">
        <span className="muted small">{orgs ? `기관 ${orgs.length}곳` : '불러오는 중이에요…'}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: 'new', name: '', codes: '', managers: [] })}>+ 관리자가 직접 만들기</button>
      </div>
      {msg && <p className="alert" role="alert">{msg}</p>}
      {orgs && !orgs.length && (
        <div className="card admin-empty">
          <p className="serif">아직 등록된 기관이 없어요.</p>
          <p className="muted small">수련관 · 학교 담당자가 로그인해서 ‘기관’ 화면(/org)에서 등록하면 여기에 보여요. 담당자 대신 만들어 줄 때만 위의 ‘관리자가 직접 만들기’ 를 써요.</p>
        </div>
      )}
      {orgs && orgs.length > 0 && (
        <AdminTable
          head={['기관', '등록', '담당자', '모임', '']}
          empty=""
          rows={orgs.map((o) => [
            <strong key="n">{o.name}</strong>,
            formatDate(o.createdAt),
            o.managers.map((m) => m.nickname).join(', ') || <span key="m" className="muted">없음</span>,
            <span key="g" title={o.groups.map((g) => `${g.name} ${g.code}`).join('\n')}>{o.groups.length}개</span>,
            <span key="a" className="row-actions">
              <button type="button" className="btn btn-text btn-sm" onClick={() => setEdit({ id: o.id, name: o.name, codes: o.groups.map((g) => g.code).join(' '), managers: o.managers.map((m) => m.id) })}>고치기</button>
              <button type="button" className="btn btn-text btn-sm danger" onClick={() => remove(o)}>지우기</button>
            </span>,
          ])}
        />
      )}
    </>
  )
}

/** 개발 테스트 서버에서만 (flag 를 주면 그 실험 묶음이 켜졌을 때도) 보이는 것 */
function DevOnly({ children, flag }: { children: ReactNode; flag?: Flag }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    siteConfig().then((c) => setOn(flag ? labOn(c, flag) : !!c.dev))
  }, [flag])
  return on ? <>{children}</> : null
}

const RESET_PHRASE = '모두 지우기'
/** DB 초기화: 회원 · 기록을 모두 지우고 처음 상태로. 비밀번호 · 확인 문구 · 확인 창을 모두 거쳐야 한다. */
function ResetCard({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ready = !!pw && phrase === RESET_PHRASE && !busy
  const go = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    if (!window.confirm('정말 모든 회원과 기록을 지울까요? 지운 뒤에는 이 화면에서 되돌릴 수 없어요.')) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.adminReset(pw, phrase)
      setMsg({ ok: true, text: `처음 상태로 돌렸어요. 지우기 전의 DB 는 서버의 데이터 폴더에 ‘${r.before}’ 로 남겨 두었어요 (위 ‘복원’ 으로 되돌릴 수 있어요).` })
      setPw('')
      setPhrase('')
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '지우지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card admin-settings restore-card reset-card" onSubmit={go}>
      <h3 className="card-title">DB 초기화 (처음 상태로)</h3>
      <p className="muted small">
        모든 회원 · 그래프 · 모임 · 나눈 그래프 · 공유 링크 · 한 줄 · 응원 · 신고를 지워요. 회원은 모두 로그아웃돼요.
        사이트 설정 · 공지 팝업 · 로그인 비밀값 · 관리자 접속 기록은 그대로 남아요.
      </p>
      <p className="alert">시험 운영을 마치고 새로 시작할 때만 써 주세요. 먼저 위에서 ‘DB 백업 내려받기’ 를 해 두면 안전해요. 지우기 전 DB 도 서버에 남겨 두지만(최근 5개), 서버를 옮기면 함께 사라질 수 있어요.</p>
      <label className="field">
        <span className="field-label">관리자 비밀번호 (한 번 더)</span>
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">확인을 위해 <strong>{RESET_PHRASE}</strong> 를 그대로 적어 주세요</span>
        <input value={phrase} placeholder={RESET_PHRASE} autoComplete="off" onChange={(e) => setPhrase(e.target.value)} />
      </label>
      {msg && <p className={msg.ok ? 'notice' : 'alert'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-danger" disabled={!ready}>{busy ? '지우는 중…' : '모든 기록 지우고 처음으로'}</button>
      </div>
    </form>
  )
}

function AdminTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <section>
      {rows.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** 한 사람의 모든 것: 계정 · 들어간 모임 · 나눈 것 · 공유 링크 · 모든 기록(회고 · 지금의 나 · 미래 편지) */
function UserPanel({ user, onClose, onGroup }: { user: AdminUser; onClose: () => void; onGroup: (id: string) => void }) {
  const titleOf = (id: string | null) => graphTitle(user.graphs.find((g) => g.id === id) ?? { title: '' })
  return (
    <section className="admin-person">
      <button type="button" className="btn btn-text btn-sm admin-back" onClick={onClose}>← 사람 목록으로</button>

      <header className="card person-head">
        <span className="person-avatar" aria-hidden="true">{[...user.nickname][0]}</span>
        <div className="person-who">
          <div className="person-title">
            <h3>{user.nickname}</h3>
            <span className={`person-chip${user.lastSeenAt && Date.now() - Date.parse(user.lastSeenAt) < 86400_000 ? ' is-on' : ''}`}>마지막 방문 {since(user.lastSeenAt)}</span>
            {user.guardian && (
              <span className={`person-chip ${user.guardian.confirmedAt ? 'is-ok' : 'is-warn'}`}>
                만 14세 미만 · {user.guardian.confirmedAt ? '보호자 확인됨' : '보호자 확인 기다림'}
              </span>
            )}
          </div>
          <dl className="person-facts">
            <div><dt>가입</dt><dd>{formatDate(user.createdAt)}</dd></div>
            <div><dt>약관 동의</dt><dd>{user.agreedAt ? formatDate(user.agreedAt) : '기록 없음'}</dd></div>
            <div><dt>로그인된 기기</dt><dd>{user.sessions}곳</dd></div>
          </dl>
          {/* 계정 id · 보호자 연락처는 필요할 때만 펼쳐 본다 */}
          <details className="person-more">
            <summary>자세히 · 계정 id{user.guardian ? ' · 보호자 정보' : ''}</summary>
            <dl className="person-facts">
              <div><dt>계정 id</dt><dd><code>{user.id}</code> <button type="button" className="btn btn-text btn-sm" onClick={() => navigator.clipboard?.writeText(user.id)}>복사</button></dd></div>
              {!user.agreedAt && <div><dt>약관 동의</dt><dd className="muted">0.11.0 이전에 가입해 기록이 없어요</dd></div>}
              {user.guardian && <>
                <div><dt>보호자</dt><dd>{user.guardian.relation} · {formatDate(user.guardian.at)} 가입 때 동의</dd></div>
                <div><dt>보호자 연락처</dt><dd><code>{user.guardian.contact}</code></dd></div>
                <div><dt>보호자 확인</dt><dd>{user.guardian.confirmedAt ? `${formatDate(user.guardian.confirmedAt)} 링크로 확인` : '아직 링크를 열지 않았어요'}</dd></div>
              </>}
            </dl>
          </details>
        </div>
      </header>

      <ul className="person-stats">
        <li><strong>{user.graphs.length}</strong><span>그래프 <small>완성 {user.graphs.filter((g) => g.completed).length}</small></span></li>
        <li><strong>{user.graphs.reduce((n, g) => n + g.entries.length, 0)}</strong><span>순간</span></li>
        <li><strong>{user.groups.length}</strong><span>들어간 모임</span></li>
        <li><strong>{user.posts.length}</strong><span>나눈 그래프</span></li>
        <li><strong>{user.answers.length}</strong><span>오늘의 한 줄</span></li>
        <li><strong>{user.cheersReceived}<small> / {user.cheersGiven}</small></strong><span>응원 받음 / 보냄</span></li>
      </ul>

      <div className="person-grid">
        <section className="card person-box">
          <h4>들어간 모임</h4>
          {user.groups.length ? (
            <ul className="person-rows">
              {user.groups.map((g) => (
                <li key={g.id}>
                  <button type="button" className="admin-link" onClick={() => onGroup(g.id)}>{g.name}</button>
                  <span className="tag">{ROLE[g.role]}</span>
                  <small className="muted">{formatDate(g.joinedAt)}부터</small>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">들어간 모임이 없어요.</p>}
        </section>
        <section className="card person-box">
          <h4>모임에 나눈 그래프</h4>
          {user.posts.length ? (
            <ul className="person-rows">
              {user.posts.map((p) => (
                <li key={p.id}>
                  <strong>{titleOf(p.graphId)}</strong>
                  <small className="muted">→ {p.groupName} · {formatDate(p.createdAt)}</small>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">없어요.</p>}
        </section>
      </div>

      <section className="card person-box">
        <h4>만든 공유 링크 <small className="muted">{user.links.length}</small></h4>
        {user.links.length ? <LinkList links={user.links} /> : <p className="muted small">없어요. (로그인하지 않고 만든 링크는 누가 만들었는지 남지 않아요)</p>}
      </section>

      {user.answers.length > 0 && (
        <details className="card person-box admin-graph">
          <summary><span className="admin-graph-title"><strong>오늘의 한 줄 {user.answers.length}개</strong></span></summary>
          <ol className="answers">
            {user.answers.map((a) => (
              <li key={a.day}>
                <span className="answers-day">{a.day}</span>
                <span className="answers-body"><small className="muted">{a.question}</small><span className="serif">{a.text}</span></span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <section className="card person-box">
      <h3 className="field-label">모든 기록 <small className="muted">{user.graphs.length}</small></h3>
      {!user.graphs.length && <p className="muted small">아직 그린 그래프가 없어요.</p>}
      {user.graphs.map((g, i) => (
        <details key={g.id} className="admin-graph" open={i === 0}>
          <summary>
            <span className="admin-graph-title">
              <strong>{graphTitle(g)}</strong>
              <small className="muted">{rangeLabel(g.timeScale, g.startPoint, g.currentPoint)} · 순간 {g.entries.length}개</small>
            </span>
            <span className="admin-tags">
              <span className={g.completed ? 'tag is-on' : 'tag'}>{g.completed ? '완성' : '그리는 중'}</span>
              <span className="tag">{g.visibility === 'link' ? '함께 나누기' : '나만 보기'}</span>
              {g.groupId && <span className="tag">모임에서 그린 선</span>}
              {g.futureLetter && <span className="tag">미래 편지</span>}
              <small className="muted">처음 {formatDate(g.createdAt)} · 마지막 {formatDate(g.updatedAt)}</small>
            </span>
          </summary>
          <LifeGraph tone={lineColorOf(g.lineColor)} points={graphPoints(g)} timeScale={g.timeScale} start={g.startPoint} end={g.currentPoint} />
          <ol className="moment-list">
            {sortEntries(g.entries).map((e) => (
              <li key={e.id} className="card moment">
                <div className="moment-head">
                  <span className="entry-time">{timeLabel(g.timeScale, e.timePoint)}</span>
                  <span className="muted small">{e.emotionLabel && `${e.emotionLabel} · `}마음 {signed(e.emotionScore)} · {scoreWord(e.emotionScore)}{!e.showOnGraph && ' · 그래프에 숨김'}</span>
                </div>
                <h3>{e.title || '이름 없는 순간'}</h3>
                {e.description && <p>{e.description}</p>}
                <Answers items={questionsFor(g, e).map((q) => [q.q, e.reflection[q.key]])} />
              </li>
            ))}
          </ol>
          <div className="admin-now-grid">
            <Answers title="지금의 나" items={NOW_QUESTIONS.map((q) => [q.q, g.currentReflection[q.key]])} />
            {g.futureLetter && (
              <Answers title={`미래의 나에게 · ${formatDate(g.futureLetter.openAt)}에 열려요`} items={[[`${formatDate(g.futureLetter.writtenAt)}에 씀`, g.futureLetter.text]]} />
            )}
          </div>
        </details>
      ))}
      </section>
    </section>
  )
}

/** 공유 링크 목록: 주소(눌러서 열기) · 제목 · 만든 사람 · 만든 날 · 끄기 */
function LinkList({ links, onOff }: { links: AdminLink[]; onOff?: (code: string) => void }) {
  const [base, setBase] = useState('')
  useEffect(() => {
    shareBase().then(setBase)
  }, [])
  return (
    <AdminTable
      empty="아직 만든 링크가 없어요."
      head={['링크', '제목', '만든 사람', '순간', '만든 날', '']}
      rows={links.map((l) => [
        <a key="a" href={`${base}/s/${l.code}`} target="_blank" rel="noreferrer"><code>/s/{l.code}</code></a>,
        <span key="t" className="admin-name">{l.graph.title || '이름 없는 이야기'}</span>,
        l.nickname ?? <span key="n" className="muted">로그인 안 함</span>,
        `${l.graph.entries.length}개`,
        formatDate(l.createdAt),
        onOff ? <button key="d" type="button" className="btn btn-text danger btn-sm" onClick={() => onOff(l.code)}>끄기</button> : '',
      ])}
    />
  )
}

function LinksTab() {
  const [links, setLinks] = useState<AdminLink[] | null>(null)
  const load = () => api.adminLinks().then(setLinks, () => setLinks([]))
  useEffect(() => {
    load()
  }, [])
  if (!links) return <p className="muted serif">불러오는 중이에요…</p>
  return (
    <>
      <LinkList
        links={links}
        onOff={async (code) => {
          if (!window.confirm('이 링크를 끌까요?')) return
          await api.adminDeleteLink(code)
          load()
        }}
      />
    </>
  )
}

/** 관리자 접속 기록: 언제 · 어느 IP(별칭) · 성공 여부 · 브라우저. 별칭은 그 자리에서 고친다. */
function LoginsTab() {
  const [logs, setLogs] = useState<AdminLogin[] | null>(null)
  const [edit, setEdit] = useState<{ ip: string; alias: string } | null>(null)
  const load = () => api.adminLogins().then(setLogs, () => setLogs([]))
  useEffect(() => {
    load()
  }, [])
  if (!logs) return <p className="muted serif">불러오는 중이에요…</p>
  const save = async () => {
    if (!edit) return
    await api.adminSetAlias(edit.ip, edit.alias)
    setEdit(null)
    load()
  }
  const browser = (ua: string) =>
    `${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '기타'} · ${/iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '?'}`
  const fails = logs.filter((l) => !l.ok && Date.now() - Date.parse(l.at) < 86_400_000).length
  return (
    <>
      {fails > 0 && <p className="alert" role="alert">최근 24시간 동안 틀린 관리자 로그인 시도가 {fails}번 있었어요. 모르는 IP 라면 비밀번호를 바꿔 주세요.</p>}
      <AdminTable
        empty="아직 기록이 없어요."
        head={['시각', 'IP', '별칭', '결과', '브라우저']}
        rows={logs.map((l) => [
          new Date(l.at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }),
          <code key="i">{l.ip}</code>,
          edit?.ip === l.ip ? (
            <span key="e" className="alias-edit">
              <input value={edit.alias} maxLength={30} placeholder="예) 사무실 PC" autoFocus onChange={(e) => setEdit({ ...edit, alias: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
              <button type="button" className="btn btn-primary btn-sm" onClick={save}>저장</button>
            </span>
          ) : (
            <button key="e" type="button" className="btn btn-text btn-sm" onClick={() => setEdit({ ip: l.ip, alias: l.alias })}>{l.alias || '+ 별칭'}</button>
          ),
          l.ok ? `들어옴${l.who ? ` · ${l.who}` : ''}` : <span key="r" className="danger">틀림</span>,
          <span key="b" title={l.agent}>{browser(l.agent)}</span>,
        ])}
      />
    </>
  )
}

/** DB 백업 내려받기 (서버 옮길 때 · 정기 백업) */
function BackupCard() {
  const [secretInDb, setSecretInDb] = useState(false)
  useEffect(() => {
    api.adminSettings().then((r) => setSecretInDb(r.secretInDb), () => {})
  }, [])
  return (
    <section className="card admin-settings">
      <h3 className="card-title">백업 내려받기</h3>
      {secretInDb && (
        <p className="alert" role="alert">
          지금은 로그인 비밀값(<code>AUTH_SECRET</code>)이 DB 안에 있어요. 이 상태의 백업 파일이 새면, 흔한 이름과 생일을 하나씩 대입해 회원의 이름 · 생년월일을 알아낼 수 있어요.
          서버의 <code>.env</code> 에 <code>AUTH_SECRET</code> 을 정해 두면 백업 파일만으로는 알 수 없어요. (이미 운영 중이면 DB 에 있는 값을 그대로 옮겨 적어야 기존 계정이 로그인돼요 — README ‘보안’)
        </p>
      )}
      <p className="muted small">
        지금 DB 를 파일 하나(<code>.db</code>)로 내려받아요. 모든 계정 · 기록 · 회고가 들어 있으니 안전한 곳에만 보관해 주세요.
        새 서버로 옮길 때는 이 파일을 새 서버에 넣으면 돼요 (방법은 배포 묶음의 README ‘서버 옮기기’).
      </p>
      <a className="btn btn-primary" href="/api/admin/backup" download>DB 백업 내려받기</a>
      <p className="muted small">서버도 한 시간에 하나씩 그려봄 폴더(docker-compose.yml 옆)의 <code>backups/auto-날짜-시.db</code> 로 자동 백업을 남겨요 (최근 <code>BACKUP_KEEP</code>개, 기본 168 = 7일). 같은 디스크 안이라 디스크가 고장 나면 함께 잃으니, 가끔은 여기서 내려받아 다른 곳에도 보관해 주세요.</p>
      <p className="muted small">.env 의 <code>AUTH_SECRET</code> 을 정해 두었다면 새 서버에도 같은 값을 넣어야 모두 그대로 로그인할 수 있어요. 비워 두었다면 DB 안에 있어서 함께 옮겨져요.</p>
    </section>
  )
}

function Answers({ title, items }: { title?: string; items: [string, string][] }) {
  const filled = items.filter(([, a]) => a.trim())
  if (!filled.length) return null
  const list = (
    <dl className="reflection">
      {filled.map(([q, a]) => (
        <div key={q}>
          <dt>{q}</dt>
          <dd>{a}</dd>
        </div>
      ))}
    </dl>
  )
  if (!title) return list
  return (
    <section className="card admin-answers">
      <h4 className="field-label">{title}</h4>
      {list}
    </section>
  )
}

/** 한눈에: 이번 주 · 지난 2주 흐름 · 쌓인 것 · 그래프를 어떻게 그리는지 · 최근에 다녀간 사람 */
function Overview({ data, onUser, onReports }: { data: AdminOverview; onUser: (id: string) => void; onReports: () => void }) {
  const { counts: c, stats: s } = data
  const max = Math.max(1, ...s.daily.flatMap((d) => [d.signups, d.graphs]))
  const recent = data.users.filter((u) => u.lastSeenAt).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 6)
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')
  const kpis: [string, ReactNode, string][] = [
    ['지금 (1시간 안)', s.online, '다녀간 사람'],
    ['이번 주 다녀간 사람', s.week.visitors, `가입한 사람의 ${pct(s.week.visitors, c.users)}`],
    ['이번 주 새로 가입', s.week.signups, `모두 ${c.users}명`],
    ['이번 주 새 그래프', s.week.graphs, `모두 ${c.graphs}개`],
    ['이번 주 모임에 나눔', s.week.posts, `모두 ${c.posts}개`],
    ['이번 주 응원', s.week.cheers, `모두 ${s.cheers}번`],
  ]
  return (
    <div className="admin-overview">
      {s.openReports > 0 && (
        <button type="button" className="card admin-alert" onClick={onReports}>
          <strong>처리하지 않은 신고 {s.openReports}건</strong>
          <span className="muted small">신고함에서 살펴봐 주세요 →</span>
        </button>
      )}
      <ul className="admin-kpis">
        {kpis.map(([label, n, sub]) => (
          <li key={label} className="card">
            <span className="muted small">{label}</span>
            <strong>{n}</strong>
            <small className="muted">{sub}</small>
          </li>
        ))}
      </ul>

      <section className="card">
        <h2 className="card-title">지난 2주</h2>
        <p className="admin-legend muted small"><i className="is-a" /> 가입 <i className="is-b" /> 새 그래프</p>
        <ol className="admin-bars" aria-label="지난 14일 가입과 새 그래프">
          {s.daily.map((d) => (
            <li key={d.day} title={`${d.day} · 가입 ${d.signups} · 새 그래프 ${d.graphs}`}>
              <span className="bars">
                <i className="is-a" style={{ height: `${(d.signups / max) * 100}%` }} />
                <i className="is-b" style={{ height: `${(d.graphs / max) * 100}%` }} />
              </span>
              <small className="muted">{Number(d.day.slice(8))}</small>
            </li>
          ))}
        </ol>
      </section>

      <div className="admin-two">
        <section className="card">
          <h2 className="card-title">쌓인 것</h2>
          <dl className="admin-facts">
            <div><dt>완성한 그래프</dt><dd>{s.completed} <small className="muted">/ {c.graphs} · {pct(s.completed, c.graphs)}</small></dd></div>
            <div><dt>담긴 순간</dt><dd>{s.moments} <small className="muted">· 그래프당 {c.graphs ? (s.moments / c.graphs).toFixed(1) : 0}</small></dd></div>
            <div><dt>미래 편지</dt><dd>{s.letters}통</dd></div>
            <div><dt>오늘의 한 줄</dt><dd>{s.answers}개</dd></div>
            <div><dt>DB 크기</dt><dd>{mb(s.storage.db)}</dd></div>
            <div><dt>자동 백업</dt><dd>{s.storage.backups ? `${s.storage.backups}개 · ${mb(s.storage.backupBytes)}` : '아직 없음'}</dd></div>
            <div><dt>모임 · 공유 링크</dt><dd>{c.groups} · {c.links}</dd></div>
          </dl>
          <p className="field-label">어떻게 그리나요</p>
          <ul className="admin-split">
            {s.scales.map((x) => (
              <li key={x.scale}>
                <span>{SCALE[x.scale] ?? x.scale}</span>
                <span className="track"><i style={{ width: pct(x.n, c.graphs) }} /></span>
                <small className="muted">{x.n}</small>
              </li>
            ))}
            {!s.scales.length && <li className="muted small">아직 그래프가 없어요.</li>}
          </ul>
        </section>
        <section className="card">
          <h2 className="card-title">최근에 다녀간 사람</h2>
          {recent.length ? (
            <ul className="admin-recent">
              {recent.map((u) => (
                <li key={u.id}>
                  <button type="button" className="btn btn-text btn-sm" onClick={() => onUser(u.id)}>{u.nickname}</button>
                  <small className="muted">{since(u.lastSeenAt)} · 그래프 {u.graphCount}</small>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">아직 기록이 없어요. (0.16.0부터 남아요)</p>}
        </section>
      </div>
    </div>
  )
}

/** 모임 하나: 이름 · 소개 고치기, 함께하는 사람(자리 · 들어온 날), 나눈 그래프와 그 순간들 */
function GroupPanel({ group, onClose, onSaved, onUser }: { group: AdminGroup; onClose: () => void; onSaved: () => Promise<void>; onUser: (id: string) => void }) {
  return (
    <section className="card admin-panel">
      <div className="admin-panel-head">
        <button type="button" className="btn btn-text btn-sm" onClick={onClose}>← 모임 목록으로</button>
      </div>
      <dl className="admin-facts">
        <div><dt>참여 코드</dt><dd><code>{group.code}</code></dd></div>
        <div><dt>만든 날</dt><dd>{formatDate(group.createdAt)}</dd></div>
        <div><dt>함께 그릴 시간</dt><dd>{group.preset ? presetLabel(group.preset) : '정하지 않음'}</dd></div>
      </dl>
      <GroupInfoForm init={{ name: group.name, intro: group.intro }} onSave={(info) => api.adminUpdateGroup(group.id, info).then(onSaved)} />

      <h3 className="field-label">함께하는 사람 <small className="muted">{group.members.length}</small></h3>
      <AdminTable
        empty="아무도 없어요."
        head={['별명', '자리', '들어온 날', '']}
        rows={group.members.map((m) => [
          <strong key="n">{m.nickname}</strong>, ROLE[m.role], formatDate(m.joinedAt),
          <button key="o" type="button" className="btn btn-text btn-sm" onClick={() => onUser(m.id)}>이 사람 보기</button>,
        ])}
      />

      <h3 className="field-label">나눈 그래프 <small className="muted">{group.posts.length}</small></h3>
      {group.posts.map((p) => (
        <details key={p.id} className="admin-graph">
          <summary>
            <strong>{p.graph.title || '이름 없는 이야기'}</strong>
            <span className="muted small"> · {p.nickname} · {formatDate(p.createdAt)} · 순간 {p.graph.entries.length}개{p.bound ? ' · 모임에서 그린 선' : ''}{p.graph.showTime ? '' : ' · 시점 숨김'}</span>
          </summary>
          <LifeGraph
            tone={lineColorOf(p.graph.tone)}
            points={p.graph.entries.map((e, i) => ({ ...e, id: `${p.id}-${i}` }))}
            timeScale={p.graph.timeScale}
            start={p.graph.startPoint}
            end={p.graph.currentPoint}
            showTimeLabels={p.graph.showTime}
          />
          <ol className="admin-list">
            {p.graph.entries.map((e, i) => (
              <li key={i}>
                {p.graph.showTime && <strong>{timeLabel(p.graph.timeScale, e.timePoint)} · </strong>}
                {e.title || '이름 없는 순간'} <small className="muted">· {e.emotionLabel && `${e.emotionLabel} · `}마음 {signed(e.emotionScore)}</small>
                {e.description && <span className="post-desc">{e.description}</span>}
              </li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  )
}

/** 공지 팝업: 켜 두면 사이트를 처음 열 때 한 번 뜬다 (기기마다). 내용을 고치면 다시 뜬다. */
/** datetime-local ↔ ISO (이 브라우저의 시간대로) */
const toLocal = (iso?: string) => (iso ? new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '')
const noticeWindow = (d: AdminNotice) => {
  const t = new Date().toISOString()
  const f = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (d.from && t < d.from) return `예약됨 · ${f(d.from)}부터 떠요${d.to ? ` (${f(d.to)}에 내려가요)` : ''}`
  if (d.to && t >= d.to) return `${f(d.to)}에 내려갔어요 (지금은 뜨지 않아요)`
  return `지금 떠 있어요${d.to ? ` · ${f(d.to)}에 저절로 내려가요` : ''}`
}

function NoticeSettings() {
  const [d, setD] = useState<AdminNotice | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.adminNotice().then(setD, (e) => setMsg(e.message))
  }, [])
  if (!d) return msg ? <p className="alert" role="alert">{msg}</p> : null
  const save = async (next: AdminNotice, done: string) => {
    setMsg('')
    try {
      setD(await api.adminSaveNotice(next))
      setMsg(done)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  return (
    <section className="admin-settings-wrap">
      <p className="muted small">
        {d.on ? `지금 떠 있어요 · ${formatDate(d.at)} 에 올림` : '지금은 꺼져 있어요.'}
      </p>
      <form
        className="card form-card admin-settings"
        onSubmit={(e) => {
          e.preventDefault()
          save({ ...d, on: true }, '올렸어요. 사이트를 여는 사람에게 한 번 떠요.')
        }}
      >
        <label className="field">
          <span className="field-label">제목</span>
          <input value={d.title} maxLength={60} placeholder="예) 11월 23일 밤 점검 안내" onChange={(e) => setD({ ...d, title: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">내용</span>
          <textarea rows={6} maxLength={2000} value={d.body} placeholder="줄을 바꾸면 그대로 보여요." onChange={(e) => setD({ ...d, body: e.target.value })} />
          <small className="muted">{d.body.length}/2000</small>
        </label>
        <DevOnly flag="ops">
          <div className="field-row notice-when">
            <label className="field">
              <span className="field-label">올리는 때 <em>(비우면 바로)</em></span>
              <input type="datetime-local" value={toLocal(d.from)} onChange={(e) => setD({ ...d, from: fromLocal(e.target.value) })} />
            </label>
            <label className="field">
              <span className="field-label">내리는 때 <em>(비우면 직접 내릴 때까지)</em></span>
              <input type="datetime-local" value={toLocal(d.to)} onChange={(e) => setD({ ...d, to: fromLocal(e.target.value) })} />
            </label>
          </div>
          {d.on && (d.from || d.to) && <p className="muted small">{noticeWindow(d)}</p>}
        </DevOnly>
        {msg && <p className="muted small" role="status">{msg}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">{d.on ? '고쳐서 다시 올리기' : '공지 올리기'}</button>
          {d.on && <button type="button" className="btn btn-text danger" onClick={() => save({ ...d, on: false }, '내렸어요. 더는 뜨지 않아요.')}>내리기</button>}
        </div>
      </form>
    </section>
  )
}

const EMPTY_SITE: SiteConfig = { publicUrl: null, developer: null, operator: null }

/** 사이트 설정: 공유 주소 · 운영 기관 · 문의처 이메일 · 만든 사람. 저장하면 .env 대신 이 값을 쓴다. */
function SiteSettings() {
  const [d, setD] = useState<{ publicUrl: string; opName: string; opContact: string; devName: string; devOrg: string; devContact: string; devUrl: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [msg, setMsg] = useState('')
  const fill = (s: SiteConfig) =>
    setD({
      publicUrl: s.publicUrl ?? '',
      opName: s.operator?.name ?? '', opContact: s.operator?.contact ?? '',
      devName: s.developer?.name ?? '', devOrg: s.developer?.org ?? '', devContact: s.developer?.contact ?? '', devUrl: s.developer?.url ?? '',
    })
  useEffect(() => {
    api.adminSettings().then((r) => {
      fill(r.site)
      setSaved(r.saved)
    }, (e) => setMsg(e.message))
  }, [])
  if (!d) return null
  const set = (p: Partial<typeof d>) => setD({ ...d, ...p })
  const run = async (fn: () => Promise<SiteConfig>, done: string, nowSaved: boolean) => {
    setMsg('')
    try {
      fill(await fn())
      setSaved(nowSaved)
      setMsg(done)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  const field = (label: string, key: keyof typeof d, opts: { type?: string; placeholder?: string; max?: number; hint?: string } = {}) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type={opts.type ?? 'text'} value={d[key]} maxLength={opts.max ?? 200} placeholder={opts.placeholder} onChange={(e) => set({ [key]: e.target.value })} />
      {opts.hint && <small className="muted">{opts.hint}</small>}
    </label>
  )
  return (
    <section className="admin-settings-wrap">
      <p className="muted small">{saved ? '지금은 관리자 화면에서 정한 값을 써요.' : '지금은 서버의 .env 값을 써요. 저장하면 이 값으로 바뀌어요.'}</p>
      <form
        className="card form-card admin-settings"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => api.adminSaveSettings({
            ...EMPTY_SITE,
            publicUrl: d.publicUrl.trim() || null,
            operator: { name: d.opName, contact: d.opContact },
            developer: { name: d.devName, org: d.devOrg, contact: d.devContact, url: d.devUrl },
          }), '저장했어요. 새로 여는 화면부터 바로 보여요.', true)
        }}
      >
        <p className="field-label">이용약관 · 개인정보 처리방침</p>
        <div className="field-row">
          {field('운영 기관', 'opName', { max: 60, placeholder: '예) ○○청소년수련관', hint: '이용약관 · 처리방침에 운영자로 보여요.' })}
          {field('문의처 이메일', 'opContact', { type: 'email', max: 80, placeholder: 'privacy@example.kr', hint: '개인정보 처리방침 ‘11. 문의처’에 보여요.' })}
        </div>
        <p className="field-label">주소</p>
        {field('공유 링크 대표 주소', 'publicUrl', { type: 'url', placeholder: 'https://geuryeobom.kr', hint: '비우면 사용자가 접속한 주소를 그대로 써요.' })}
        <p className="field-label">만든 사람 (/credits?tab=team)</p>
        <div className="field-row">
          {field('이름', 'devName', { max: 40, placeholder: '그려봄 개발팀' })}
          {field('소속', 'devOrg', { max: 60 })}
        </div>
        <div className="field-row">
          {field('연락 (이메일 또는 https 주소)', 'devContact', { max: 200 })}
          {field('저장소 주소', 'devUrl', { type: 'url', placeholder: 'https://github.com/…' })}
        </div>
        <p className="muted small">관리자 아이디 · 비밀번호, 로그인 비밀값(AUTH_SECRET), 쿠키 · 포트 설정은 보안을 위해 서버의 .env 에서만 바꿀 수 있어요.</p>
        {msg && <p className="muted small" role="status">{msg}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">저장하기</button>
          {saved && (
            <button type="button" className="btn btn-text" onClick={() => window.confirm('관리자 화면에서 정한 값을 지우고 .env 값으로 되돌릴까요?') && run(api.adminResetSettings, '.env 값으로 되돌렸어요.', false)}>
              .env 값으로 되돌리기
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)}GB` : mb(n))
const fmtUptime = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`
}

/** 서버 상태 + 자동 백업 */
function ServerTab() {
  const [h, setH] = useState<AdminHealth | null>(null)
  const [b, setB] = useState<Awaited<ReturnType<typeof api.adminBackups>> | null>(null)
  const [keep, setKeep] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => {
    api.adminHealth().then(setH, (e) => setMsg(e.message))
    api.adminBackups().then((r) => { setB(r); setKeep(String(r.keep)) }, (e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
    const t = setInterval(() => api.adminHealth().then(setH, () => {}), 10_000)
    return () => clearInterval(t)
  }, [])
  const act = async (fn: () => Promise<string>) => {
    setMsg('')
    try { setMsg(await fn()); load() } catch (e) { setMsg(e instanceof Error ? e.message : '잠시 문제가 생겼어요.') }
  }
  const diskLow = h?.disk && h.disk.free / h.disk.total < 0.1
  return (
    <>
      {msg && <p className="notice" role="status">{msg}</p>}
      {h && (
        <section className="card admin-settings">
          <h3 className="card-title">지금 서버 <small className="muted">· 10초마다 새로</small></h3>
          <ul className="stats-total health-grid">
            <li><strong>{fmtUptime(h.uptimeSec)}</strong><span className="muted small">켜진 지</span></li>
            <li><strong>{h.requests.p50}<small>ms</small></strong><span className="muted small">보통 응답 (가운데값)</span></li>
            <li className={h.requests.p95 > 1000 ? 'is-warn' : ''}><strong>{h.requests.p95}<small>ms</small></strong><span className="muted small">느린 응답 (상위 5%)</span></li>
            <li><strong>{h.requests.served.toLocaleString()}</strong><span className="muted small">켜진 뒤 처리한 요청</span></li>
            <li className={h.errors24h ? 'is-warn' : ''}><strong>{h.errors24h}</strong><span className="muted small">최근 24시간 오류</span></li>
            <li><strong>{fmtBytes(h.memory.rss)}</strong><span className="muted small">메모리</span></li>
            <li><strong>{fmtBytes(h.storage.db)}</strong><span className="muted small">DB 크기</span></li>
            {h.disk && <li className={diskLow ? 'is-warn' : ''}><strong>{fmtBytes(h.disk.free)}</strong><span className="muted small">디스크 남음 / {fmtBytes(h.disk.total)}</span></li>}
          </ul>
          <p className="muted small">{new Date(h.startedAt).toLocaleString('ko-KR')}에 켜짐 · Node {h.node} · 최근 {h.requests.recent}건 기준 평균 {h.requests.avg}ms · 가장 느린 {h.requests.max}ms{diskLow ? ' · ⚠ 디스크가 10% 아래로 남았어요' : ''}</p>
        </section>
      )}
      {b && (
        <section className="card admin-settings">
          <h3 className="card-title">자동 백업</h3>
          <p className="muted small">서버가 한 시간에 하나씩 {b.folder} 폴더에 남기고, 정한 개수보다 오래된 것은 지워요 (168개 = 7일). 같은 디스크 안이니 가끔은 내려받아 다른 곳에도 보관해 주세요.</p>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act(async () => `최근 ${(await api.adminSetBackupKeep(Number(keep))).keep}개를 남겨요.`) }}>
            <label className="field-label" htmlFor="backup-keep">남길 개수</label>
            <input id="backup-keep" type="number" min={0} max={365} value={keep} onChange={(e) => setKeep(e.target.value)} />
            <button type="submit" className="btn btn-ghost btn-sm">저장</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!b.dir} onClick={() => act(async () => ((await api.adminRunBackup()).made ? '지금 백업을 하나 남겼어요.' : '이번 시간 백업은 이미 있어요 (한 시간에 하나).'))}>지금 백업 남기기</button>
          </form>
          {Number(keep) === 0 && <p className="alert">0 이면 자동 백업을 하지 않아요.</p>}
          <AdminTable
            head={['파일', '크기', '남긴 때', '']}
            empty="아직 자동 백업이 없어요."
            rows={b.files.map((f) => [<code key="n">{f.name}.db</code>, mb(f.size), new Date(f.at).toLocaleString('ko-KR'), <a key="d" className="btn btn-text btn-sm" href={`/api/admin/backups/${f.name}`} download>내려받기</a>])}
          />
        </section>
      )}
    </>
  )
}

/** 요청 제한 · 차단 현황 */
function BlocksTab() {
  const [rows, setRows] = useState<AdminBlock[] | null>(null)
  const [err, setErr] = useState('')
  const load = () => api.adminBlocks().then(setRows, (e) => setErr(e.message))
  useEffect(() => {
    load()
  }, [])
  if (err) return <p className="alert" role="alert">{err}</p>
  if (!rows) return <p className="muted">불러오는 중이에요…</p>
  return (
    <>
      <div className="admin-toolbar">
        <span className="muted small">{rows.length ? `지금 막힌 곳 ${rows.length}곳` : '지금 막힌 곳 없음'}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>새로 보기</button>
      </div>
      {!rows.length ? (
        <div className="card admin-empty">
          <p className="serif">지금 막힌 곳이 없어요.</p>
          <p className="muted small">막힌 기록은 서버 메모리에만 있어서 서버를 다시 켜면 모두 풀려요. 이름은 가려진 값으로만 보여요.</p>
        </div>
      ) : (
      <AdminTable
        head={['무엇', '누구', '시도', '풀리는 때', '']}
        empty=""
        rows={rows.map((r) => [
          r.limit,
          <span key="w">{r.alias ? `${r.alias} (${r.shown})` : r.shown}</span>,
          `${r.n}번`,
          new Date(r.until).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }),
          <button key="r" type="button" className="btn btn-ghost btn-sm" onClick={() => api.adminReleaseBlock(r.limit, r.key).then(load, (e) => setErr(e.message))}>풀기</button>,
        ])}
      />
      )}
    </>
  )
}

const PRIVACY_KINDS = ['열람', '정정', '삭제', '처리정지', '그 밖의 문의']
const PRIVACY_STATUS = ['받음', '처리 중', '완료', '거절']
/** 받은 날부터 10일 (개인정보 보호법 시행령: 10일 안에 열람 · 정정 · 삭제 · 처리정지에 답한다) */
const dueOf = (day: string) => new Date(Date.parse(`${day}T00:00:00+09:00`) + 10 * 86400_000)

/** 개인정보 처리 요청 대장 */
function PrivacyTab() {
  const [rows, setRows] = useState<PrivacyRequest[] | null>(null)
  const [edit, setEdit] = useState<PrivacyRequest | null>(null)
  const [err, setErr] = useState('')
  const load = () => api.adminPrivacy().then(setRows, (e) => setErr(e.message))
  useEffect(() => {
    load()
  }, [])
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const save = async () => {
    if (!edit) return
    setErr('')
    try {
      const { id, doneAt: _d, ...r } = edit
      await api.adminSavePrivacy(id, r)
      setEdit(null)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했어요.')
    }
  }
  if (edit) {
    return (
      <form className="card form-card admin-settings" onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="field-row">
          <label className="field"><span className="field-label">종류</span>
            <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{PRIVACY_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          </label>
          <label className="field"><span className="field-label">받은 날</span><input type="date" value={edit.receivedAt} max={today} onChange={(e) => setEdit({ ...edit, receivedAt: e.target.value })} /></label>
          <label className="field"><span className="field-label">상태</span>
            <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{PRIVACY_STATUS.map((k) => <option key={k}>{k}</option>)}</select>
          </label>
        </div>
        <label className="field"><span className="field-label">요청한 사람 <em>(별명 · 연락 방법 정도만)</em></span><input value={edit.who} maxLength={60} placeholder="예) 바다 · 메일로 받음" onChange={(e) => setEdit({ ...edit, who: e.target.value })} /></label>
        <label className="field"><span className="field-label">요청 내용</span><textarea rows={3} maxLength={500} value={edit.detail} onChange={(e) => setEdit({ ...edit, detail: e.target.value })} /></label>
        <label className="field"><span className="field-label">처리 내용 · 답한 방법</span><textarea rows={3} maxLength={500} value={edit.note} placeholder="예) 11/7 내 기록 파일을 메일로 보냄" onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
        <p className="muted small">받은 날부터 10일 안({dueOf(edit.receivedAt).toLocaleDateString('ko-KR')}까지)에 처리하거나 늦어지는 까닭을 알려야 해요. 이름 · 생년월일 같은 정보는 적지 마세요.</p>
        {err && <p className="alert" role="alert">{err}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">저장</button>
          <button type="button" className="btn btn-text" onClick={() => setEdit(null)}>닫기</button>
        </div>
      </form>
    )
  }
  return (
    <>
      <p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit({ id: 'new', kind: '열람', who: '', detail: '', receivedAt: today, status: '받음', doneAt: '', note: '' })}>+ 요청 적기</button>
        {rows && rows.length > 0 && <button type="button" className="btn btn-text btn-sm" onClick={() => downloadCsv('그려봄-개인정보-처리요청.csv', [['받은 날', '종류', '요청한 사람', '내용', '상태', '처리한 때', '처리 내용'], ...rows.map((r) => [r.receivedAt, r.kind, r.who, r.detail, r.status, r.doneAt, r.note])])}>CSV 로 내려받기</button>}
      </p>
      {err && <p className="alert" role="alert">{err}</p>}
      <AdminTable
        head={['받은 날', '종류', '요청한 사람', '상태', '기한', '']}
        empty="적어 둔 요청이 없어요."
        rows={(rows ?? []).map((r) => {
          const open = r.status === '받음' || r.status === '처리 중'
          const due = dueOf(r.receivedAt)
          const late = open && Date.now() > due.getTime()
          return [
            r.receivedAt, r.kind, r.who || '—',
            <span key="s" className={`badge ${open ? 'badge-dev' : 'badge-soft'}`}>{r.status}</span>,
            open ? <span key="d" className={late ? 'danger' : ''}>{late ? '기한 지남 · ' : ''}{due.toLocaleDateString('ko-KR')}</span> : <span key="d" className="muted">{r.doneAt ? formatDate(r.doneAt) : ''}</span>,
            <span key="a" className="row-actions">
              <button type="button" className="btn btn-text btn-sm" onClick={() => setEdit(r)}>고치기</button>
              <button type="button" className="btn btn-text btn-sm danger" onClick={() => window.confirm('이 기록을 지울까요?') && api.adminDeletePrivacy(r.id).then(load, () => {})}>지우기</button>
            </span>,
          ]
        })}
      />
    </>
  )
}

/** 약관 재동의 — 바뀐 점을 올리면, 그 전에 동의한 사람은 다음에 들어올 때 다시 동의한다 */
function TermsSettings() {
  const [t, setT] = useState<Awaited<ReturnType<typeof api.adminTerms>> | null>(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => api.adminTerms().then((r) => { setT(r); setText(r.summary) }, (e) => setMsg(e.message))
  useEffect(() => {
    load()
  }, [])
  if (!t) return msg ? <p className="alert" role="alert">{msg}</p> : null
  return (
    <form className="card form-card admin-settings" onSubmit={(e) => {
      e.preventDefault()
      if (!window.confirm('다시 동의를 받을까요? 지금까지 동의한 사람 모두 다음에 들어올 때 이 내용을 보고 동의해야 해요.')) return
      api.adminSaveTerms(text).then(() => { setMsg('올렸어요. 다음에 들어오는 사람부터 다시 동의를 받아요.'); load() }, (e) => setMsg(e.message))
    }}>
      <h3 className="card-title">약관 다시 동의 받기</h3>
      <p className="muted small">이용약관 · 개인정보 처리방침을 고친 뒤, 바뀐 점을 짧게 적어 올려요. 그 전에 동의한 사람은 다음에 들어올 때 이 내용을 보고 다시 동의해요 (동의하지 않으면 로그아웃).</p>
      {t.at && <p className="muted small">마지막 요청 · {new Date(t.at).toLocaleString('ko-KR')} · 다시 동의한 사람 {t.agreed} / {t.users}명</p>}
      <label className="field">
        <span className="field-label">바뀐 점</span>
        <textarea rows={4} maxLength={1000} value={text} placeholder="예) 모임 활동 출석 기록을 새로 남겨요 (개인정보 처리방침 2. 처리하는 항목)." onChange={(e) => setText(e.target.value)} />
      </label>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={text.trim().length < 5}>다시 동의 받기</button></div>
    </form>
  )
}

/** 기관 담당자 초대 링크 (한 번 쓰면 꺼진다) */
function OrgInviteButton({ org, onChange }: { org: AdminOrg; onChange: () => void }) {
  const [base, setBase] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    shareBase().then(setBase)
  }, [])
  if (!org.invite) return <button type="button" className="btn btn-text btn-sm" onClick={() => api.adminOrgInvite(org.id).then(onChange, () => {})}>담당자 초대 링크</button>
  const url = `${base}/org-invite/${org.invite}`
  return (
    <span className="org-invite">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {})}>{copied ? '복사했어요' : '초대 링크 복사'}</button>
      <button type="button" className="btn btn-text btn-sm danger" onClick={() => api.adminOrgInviteOff(org.id).then(onChange, () => {})}>링크 끄기</button>
      <small className="muted invite-url">{url}</small>
    </span>
  )
}

/** 점검 모드 — 켜면 관리자 말고는 저장 · 가입이 잠시 멈추고, 화면 맨 위에 안내가 뜬다 */
function MaintenanceCard() {
  const [m, setM] = useState<{ on: boolean; message: string; at: string } | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.adminMaintenance().then(setM, (e) => setMsg(e.message))
  }, [])
  if (!m) return msg ? <p className="alert" role="alert">{msg}</p> : null
  const save = (on: boolean) => api.adminSetMaintenance(on, m.message).then((r) => { setM(r); setMsg(on ? '점검 모드를 켰어요. 새로 여는 화면부터 안내가 떠요.' : '점검 모드를 껐어요.') }, (e) => setMsg(e.message))
  return (
    <form className={`card form-card admin-settings${m.on ? ' is-maint' : ''}`} onSubmit={(e) => { e.preventDefault(); save(true) }}>
      <h3 className="card-title">점검 모드 {m.on && <span className="badge badge-dev">켜져 있어요</span>}</h3>
      <p className="muted small">서버를 옮기거나 백업을 되돌리기 전에 켜 두세요. 사람들은 보기만 할 수 있고 저장 · 가입 · 나누기가 잠시 멈춰요 (관리자 화면은 그대로). 작성 중인 글은 저장되지 않으니 짧게 써 주세요.</p>
      <label className="field">
        <span className="field-label">안내 한 줄 <em>(선택)</em></span>
        <input value={m.message} maxLength={200} placeholder="예) 밤 11시 30분까지 서버를 옮겨요" onChange={(e) => setM({ ...m, message: e.target.value })} />
      </label>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">{m.on ? '안내 고치기' : '점검 모드 켜기'}</button>
        {m.on && <button type="button" className="btn btn-ghost" onClick={() => save(false)}>끄기</button>}
      </div>
    </form>
  )
}

/** 관리자 계정 여러 개 (처음 관리자만) */
function AccountsTab() {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.adminAccounts>> | null>(null)
  const [form, setForm] = useState({ id: '', role: 'viewer', password: '' })
  const [msg, setMsg] = useState('')
  const load = () => api.adminAccounts().then(setList, (e) => setMsg(e.message))
  useEffect(() => {
    load()
  }, [])
  const save = async (id: string, role: string, password: string, done: string) => {
    setMsg('')
    try {
      await api.adminSaveAccount(id, role, password)
      setMsg(done)
      setForm({ id: '', role: 'viewer', password: '' })
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장하지 못했어요.')
    }
  }
  return (
    <>
      <form className="card form-card admin-settings" onSubmit={(e) => { e.preventDefault(); save(form.id.trim(), form.role, form.password, `‘${form.id.trim()}’ 계정을 만들었어요.`) }}>
        <h3 className="card-title">관리자 더하기</h3>
        <div className="field-row">
          <label className="field"><span className="field-label">아이디</span><input value={form.id} maxLength={20} autoComplete="off" placeholder="영어 소문자 · 숫자 3~20자" onChange={(e) => setForm({ ...form, id: e.target.value })} required /></label>
          <label className="field"><span className="field-label">비밀번호 (12자 이상)</span><input type="password" autoComplete="new-password" value={form.password} minLength={12} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        </div>
        <fieldset className="field">
          <legend className="field-label">할 수 있는 일</legend>
          <div className="segmented">
            {([['viewer', '보기만'], ['full', '바꾸기까지']] as const).map(([k, label]) => (
              <label key={k} className="seg"><input type="radio" name="acc-role" checked={form.role === k} onChange={() => setForm({ ...form, role: k })} /><span>{label}</span></label>
            ))}
          </div>
          <small className="muted">보기만: 목록 · 기록을 열어 볼 수 있어요 (지우기 · 저장 · DB 내려받기는 막혀요). 바꾸기까지: 처음 관리자와 같지만, 관리자 계정은 정할 수 없고 DB 복원 · 초기화에는 처음 관리자 비밀번호가 필요해요.</small>
        </fieldset>
        {msg && <p className="muted small" role="status">{msg}</p>}
        <div className="form-actions"><button type="submit" className="btn btn-primary">만들기</button></div>
      </form>
      <AdminTable
        head={['아이디', '할 수 있는 일', '만든 날', '마지막 로그인', '']}
        empty="더한 관리자가 없어요."
        rows={(list ?? []).map((a) => [
          <code key="i">{a.id}</code>,
          <select key="r" value={a.role} aria-label={`${a.id} 권한`} onChange={(e) => save(a.id, e.target.value, '', `‘${a.id}’ 의 권한을 바꿨어요 (그 계정은 다시 로그인해야 해요).`)}>
            <option value="viewer">보기만</option><option value="full">바꾸기까지</option>
          </select>,
          formatDate(a.createdAt),
          a.lastLogin ? new Date(a.lastLogin).toLocaleString('ko-KR') : '아직 없음',
          <span key="a" className="row-actions">
            <button type="button" className="btn btn-text btn-sm" onClick={() => { const pw = window.prompt(`‘${a.id}’ 의 새 비밀번호 (12자 이상)`); if (pw) save(a.id, a.role, pw, '비밀번호를 바꿨어요.') }}>비밀번호 바꾸기</button>
            <button type="button" className="btn btn-text btn-sm danger" onClick={() => window.confirm(`‘${a.id}’ 관리자 계정을 지울까요? 바로 로그아웃돼요.`) && api.adminDeleteAccount(a.id).then(load, () => {})}>지우기</button>
          </span>,
        ])}
      />
    </>
  )
}

/** 가입부터 나누기까지 — 기간에 가입한 사람이 어디까지 갔는지 */
const FUNNEL: [string, string][] = [['signup', '가입'], ['started', '그래프 시작'], ['moment', '순간 하나 이상'], ['done', '완성'], ['shared', '나누기 (모임 · 링크)'], ['grouped', '모임에 들어감']]
function FunnelCard() {
  const [days, setDays] = useState(90)
  const [r, setR] = useState<Awaited<ReturnType<typeof api.adminFunnel>> | null>(null)
  useEffect(() => {
    const to = new Date()
    api.adminFunnel(ymd(new Date(to.getTime() - (days - 1) * 86400_000)), ymd(to)).then(setR, () => {})
  }, [days])
  if (!r) return null
  const v = r as unknown as Record<string, number>
  const top = Math.max(1, v.signup)
  return (
    <section className="card admin-settings funnel-card">
      <h3 className="card-title">가입부터 나누기까지</h3>
      <div className="stats-range">
        <span className="stats-presets">{[30, 90, 365].map((d) => <button key={d} type="button" className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>최근 {d}일</button>)}</span>
        <span className="muted small">{r.from} ~ {r.to} 에 가입한 사람</span>
      </div>
      <ol className="funnel">
        {FUNNEL.map(([k, label], i) => {
          // ‘모임에 들어감’ 은 앞 단계와 따로라 가입 대비
          const prev = k === 'grouped' || !i ? v.signup : v[FUNNEL[i - 1][0]]
          return (
            <li key={k}>
              <span className="funnel-label">{label}</span>
              <span className="funnel-bar"><i style={{ width: `${(v[k] / top) * 100}%` }} /></span>
              <strong>{v[k]}명</strong>
              <small className="muted">{i ? `${prev ? Math.round((v[k] / prev) * 100) : 0}%` : ''}</small>
            </li>
          )
        })}
      </ol>
      <p className="muted small">오른쪽 % 는 바로 앞 단계에서 넘어온 비율이에요 (‘모임에 들어감’ 은 가입한 사람 대비). 사람 수만 세요.</p>
    </section>
  )
}

/** 보안 정책(CSP) 위반 보고 — 개발 묶음의 nginx 가 브라우저에게 알려 달라고 한다 */
function CspCard() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminCsp>> | null>(null)
  const load = () => api.adminCsp().then(setRows, () => setRows([]))
  useEffect(() => {
    load()
  }, [])
  if (!rows) return null
  return (
    <section className="card admin-settings">
      <h3 className="card-title">보안 정책(CSP) 위반 보고</h3>
      <p className="muted small">브라우저가 막은 스크립트 · 글꼴 · 그림이 있으면 여기 쌓여요 (같은 것은 묶어서 횟수만). 확장 프로그램 때문에 생기는 것도 있어요. 주소 속 코드 · 토큰은 가려요.
        {rows.length > 0 && <> <button type="button" className="btn btn-text btn-sm" onClick={() => window.confirm('보고를 모두 비울까요?') && api.adminClearCsp().then(load, () => {})}>모두 비우기</button></>}
      </p>
      <AdminTable
        head={['막은 규칙', '막힌 것', '화면', '횟수', '마지막']}
        empty="보고가 없어요. 정책에 맞게 잘 돌아가고 있어요."
        rows={rows.map((r) => [<code key="d">{r.directive}</code>, <span key="b" className="admin-name" title={r.source}>{r.blocked || '—'}</span>, r.page || '—', r.count, new Date(r.lastAt).toLocaleString('ko-KR')])}
      />
    </section>
  )
}

/** 실험 기능 스위치 — 묶음마다 켜고 끈다 */
function FlagsTab() {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminFlags>> | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.adminFlags().then(setD, (e) => setMsg(e.message))
  }, [])
  if (!d) return msg ? <p className="alert" role="alert">{msg}</p> : null
  const flip = async (k: Flag, on: boolean) => {
    const next = { ...d.flags, [k]: on }
    try {
      setD({ ...d, flags: (await api.adminSetFlags(next)).flags })
      setMsg(`‘${FLAGS.find((f) => f.key === k)!.name}’ 를 ${on ? '켰어요' : '껐어요'}. 사람들은 새로 열 때부터 바뀌어요.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '바꾸지 못했어요.')
    }
  }
  return (
    <>
      {d.dev && <p className="notice">개발 테스트 서버라 모든 실험 기능이 늘 켜져 있어요. 여기서 고른 것은 이 서버 DB 에 저장만 되고, 정식 서버에서는 정식 서버의 관리자 화면에서 켜요.</p>}
      <ul className="flag-list">
        {FLAGS.map((f) => {
          const official = OFFICIAL.includes(f.key)
          const on = official || !!d.flags[f.key]
          return (
            <li key={f.key} className={`card flag-item${on || d.dev ? ' is-on' : ''}`}>
              <label className="flag-switch">
                <input type="checkbox" role="switch" checked={on} disabled={official} onChange={(e) => flip(f.key, e.target.checked)} />
                <span className="flag-knob" aria-hidden="true" />
                <span className="flag-text"><strong>{f.name}{official && <em className="badge badge-soft flag-official">정식</em>}</strong><small className="muted">{f.desc}</small></span>
              </label>
            </li>
          )
        })}
      </ul>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <p className="muted small">‘정식’ 묶음은 1.1.0 부터 늘 켜져 있어요. 남은 실험 기능은 켜기 전에 ‘변경 내역’ 과 테스트 체크리스트로 확인하고, 이용약관 · 개인정보 처리방침에 그 묶음의 문장이 함께 보이는지 살펴 주세요.</p>
    </>
  )
}

/** 문의함 */
function InquiriesTab({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminInquiries>> | null>(null)
  const [open, setOpen] = useState('')
  const [err, setErr] = useState('')
  const load = () => { onChanged(); return api.adminInquiries().then(setRows, (e) => setErr(e.message)) }
  useEffect(() => {
    load()
  }, [])
  if (err) return <p className="alert" role="alert">{err}</p>
  if (!rows) return <p className="muted">불러오는 중이에요…</p>
  if (!rows.length) return <p className="muted">아직 들어온 문의가 없어요. 로그인한 사람이 바닥글 ‘문의하기’ (모바일은 ‘나’) 에서 남길 수 있어요.</p>
  return (
    <ul className="inquiry-list">
      {rows.map((q) => (
        <li key={q.id} className={`card inquiry${q.status === '새 문의' ? ' is-new' : ''}`}>
          <button type="button" className="inquiry-head" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? '' : q.id)}>
            <span className={`badge ${q.status === '새 문의' ? 'badge-dev' : 'badge-soft'}`}>{q.status}</span>{q.answer && <small className="muted">답함</small>}
            <strong>{q.kind}</strong>
            <span className="inquiry-preview">{q.message}</span>
            <small className="muted">{new Date(q.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>
          </button>
          {open === q.id && <InquiryBody q={q} onDone={load} />}
        </li>
      ))}
    </ul>
  )
}
function InquiryBody({ q, onDone }: { q: Awaited<ReturnType<typeof api.adminInquiries>>[number]; onDone: () => void }) {
  const [status, setStatus] = useState(q.status === '대장으로 옮김' ? '닫음' : q.status)
  const [note, setNote] = useState(q.note)
  const [answer, setAnswer] = useState(q.answer)
  const [msg, setMsg] = useState('')
  return (
    <div className="inquiry-body">
      <p className="inquiry-message">{q.message}</p>
      <p className="muted small">{q.member ? `회원 · ${q.nickname}` : '탈퇴했거나 예전에 로그인 없이 남긴 문의'}{q.contact && <> · 예전에 적은 연락처 <code>{q.contact}</code></>}</p>
      <label className="field">
        <span className="field-label">이용자에게 보낼 답 {q.answeredAt && <small className="muted">· {new Date(q.answeredAt).toLocaleString('ko-KR')}에 보냄</small>}</span>
        <textarea rows={4} maxLength={2000} value={answer} placeholder="여기 적은 답은 문의한 사람의 ‘문의하기 → 내 문의’ 에 보이고, 기록 모아보기에 ‘새 답’ 으로 알려요." onChange={(e) => setAnswer(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field"><span className="field-label">상태</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>{['새 문의', '보는 중', '답함', '닫음'].map((k) => <option key={k}>{k}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">운영자 메모 <small className="muted">(이용자에게 안 보여요)</small></span><input value={note} maxLength={500} placeholder="예) 11/7 요청 대장으로 옮김" onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!q.member && !!answer && answer !== q.answer} onClick={() => api.adminSaveInquiry(q.id, { status, note, answer }).then(() => { setMsg(answer && answer !== q.answer ? '답을 보냈어요.' : '저장했어요.'); onDone() }, (e) => setMsg(e.message))}>{answer && answer !== q.answer ? '답 보내기' : '저장'}</button>
        {q.status !== '대장으로 옮김' && (
          <select className="inquiry-move" value="" aria-label="개인정보 요청 대장으로 옮기기" onChange={(e) => e.target.value && api.adminInquiryToPrivacy(q.id, e.target.value).then(() => { setMsg('요청 대장에 적었어요 (관리 → 개인정보 요청 대장).'); onDone() }, (x) => setMsg(x.message))}>
            <option value="">요청 대장으로 옮기기…</option>
            {['열람', '정정', '삭제', '처리정지', '그 밖의 문의'].map((k) => <option key={k} value={k}>{k} 요청으로</option>)}
          </select>
        )}
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <p className="muted small">답한 · 닫은 문의는 1년 뒤 저절로 지워져요.</p>
    </div>
  )
}

/** 설정 진단 */
function DiagnoseCard() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminDiagnose>> | null>(null)
  useEffect(() => {
    api.adminDiagnose().then(setRows, () => {})
  }, [])
  if (!rows) return null
  const bad = rows.filter((r) => !r.ok).length
  return (
    <section className="card admin-settings">
      <h3 className="card-title">설정 진단 <small className="muted">· {bad ? `${bad}가지 살펴볼 것` : '모두 괜찮아요'}</small></h3>
      <ul className="diag-list">
        {rows.map((r) => (
          <li key={r.name} className={r.ok ? 'is-ok' : 'is-bad'}>
            <span className="diag-mark" aria-label={r.ok ? '괜찮음' : '살펴볼 것'}>{r.ok ? '✓' : '!'}</span>
            <span><strong>{r.name}</strong><small className="muted">{r.detail}</small></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** DB 점검 · 손질 */
function DbCheckCard() {
  const [r, setR] = useState<Awaited<ReturnType<typeof api.adminDbCheck>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const check = async () => {
    setBusy(true)
    setMsg('')
    try { setR(await api.adminDbCheck()) } catch (e) { setMsg(e instanceof Error ? e.message : '점검하지 못했어요.') } finally { setBusy(false) }
  }
  return (
    <section className="card admin-settings">
      <h3 className="card-title">DB 점검</h3>
      <p className="muted small">파일이 망가지지 않았는지 · 연결이 끊긴 기록이 없는지 확인해요. 손질은 끝난 로그인을 지우고 통계를 다시 매겨요 (하루 한 번 저절로 하는 것과 같아요).</p>
      <div className="form-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={check}>{busy ? '점검하는 중…' : '지금 점검'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.adminDbTidy().then(() => { setMsg('손질했어요.'); check() }, (e) => setMsg(e.message))}>지금 손질</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
      {r && (
        <>
          <ul className="diag-list">
            <li className={r.integrity === 'ok' ? 'is-ok' : 'is-bad'}><span className="diag-mark">{r.integrity === 'ok' ? '✓' : '!'}</span><span><strong>파일 무결성</strong><small className="muted">{r.integrity === 'ok' ? '망가진 곳이 없어요.' : r.integrity}</small></span></li>
            <li className={r.fkProblems ? 'is-bad' : 'is-ok'}><span className="diag-mark">{r.fkProblems ? '!' : '✓'}</span><span><strong>연결</strong><small className="muted">{r.fkProblems ? `끊긴 연결 ${r.fkProblems}건 — 백업 후 알려 주세요.` : '끊긴 연결이 없어요.'}</small></span></li>
            <li className="is-ok"><span className="diag-mark">·</span><span><strong>정리할 것</strong><small className="muted">끝난 로그인 {r.expiredSessions}개 · 빈 페이지 {r.freePages}개</small></span></li>
          </ul>
          <details><summary className="muted small">표마다 줄 수</summary>
            <AdminTable head={['표', '줄']} empty="" rows={r.tables.map((t) => [<code key="n">{t.name}</code>, t.rows.toLocaleString()])} />
          </details>
        </>
      )}
    </section>
  )
}

/** 시간대별 접속 (요일 × 시간) */
const DOW = ['일', '월', '화', '수', '목', '금', '토']
function HoursCard() {
  const [rows, setRows] = useState<{ dow: number; hour: number; n: number }[] | null>(null)
  useEffect(() => {
    api.adminHours().then(setRows, () => {})
  }, [])
  if (!rows) return null
  const at = (d: number, h: number) => rows.find((r) => r.dow === d && r.hour === h)?.n ?? 0
  const max = Math.max(1, ...rows.map((r) => r.n))
  const top = [...rows].sort((a, b) => b.n - a.n).slice(0, 3)
  return (
    <section className="card admin-settings hours-card">
      <h3 className="card-title">언제 많이 쓰나요</h3>
      <p className="muted small">로그인한 사람이 다녀간 횟수를 요일 · 시간(한국 시간)마다 세요 (한 사람이 10분에 한 번, 누구인지는 남기지 않아요).{top.length > 0 && <> 가장 많은 때 · {top.map((t) => `${DOW[t.dow]} ${t.hour}시`).join(', ')}</>}</p>
      <div className="hours-wrap">
        <table className="hours" aria-label="요일과 시간별 접속">
          <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{h % 3 === 0 ? h : ''}</th>)}</tr></thead>
          <tbody>
            {DOW.map((d, i) => (
              <tr key={d}><th scope="row">{d}</th>{Array.from({ length: 24 }, (_, h) => {
                const n = at(i, h)
                return <td key={h} title={`${d} ${h}시 · ${n}번`} style={{ '--a': n / max } as CSSProperties} />
              })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 새 버전 알림 */
function UpdateCard() {
  const [u, setU] = useState<Awaited<ReturnType<typeof api.adminUpdate>>['latest'] | undefined>(undefined)
  useEffect(() => {
    api.adminUpdate().then((r) => setU(r.latest), () => setU(null))
  }, [])
  if (!u) return null
  const newer = (a: string, b: string) => {
    const x = a.replace(/^v/, '').split('.').map(Number), y = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
    return false
  }
  if (!newer(u.tag, __APP_VERSION__)) return <p className="muted small update-ok">최신 버전이에요 · 지금 v{__APP_VERSION__} (깃허브 최신 {u.tag})</p>
  return (
    <section className="card update-card" role="status">
      <strong>새 버전 {u.tag} 이 나왔어요</strong> <span className="muted small">· 지금 v{__APP_VERSION__} · {formatDate(u.publishedAt)}</span>
      <p className="muted small">올리기 전에 꼭 DB 백업을 내려받고, 릴리스 안내를 읽어 주세요.</p>
      <a className="btn btn-ghost btn-sm" href={u.url} target="_blank" rel="noreferrer">릴리스 보기 ↗</a>
    </section>
  )
}

/** 파기 기록 (건수만) */
function PurgesCard() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminPurges>> | null>(null)
  useEffect(() => {
    api.adminPurges().then(setRows, () => {})
  }, [])
  if (!rows) return null
  const total = (k: string) => rows.filter((r) => r.kind === k).reduce((n, r) => n + r.count, 0)
  return (
    <section className="card admin-settings">
      <h3 className="card-title">파기 기록 <small className="muted">· 탈퇴 {total('탈퇴')} · 휴면 정리 {total('휴면 정리')} · 관리자가 지움 {total('관리자가 지움')}</small></h3>
      <p className="muted small">계정과 기록을 지운 때와 건수만 남겨요 (누구인지는 남기지 않아요). 개인정보 점검 때 파기했다는 근거로 써요.
        {rows.length > 0 && <> <button type="button" className="btn btn-text btn-sm" onClick={() => downloadCsv('그려봄-파기기록.csv', [['때', '까닭', '건수'], ...rows.map((r) => [r.at, r.kind, r.count])])}>CSV 로 내려받기</button></>}
      </p>
      <AdminTable head={['때', '까닭', '건수']} empty="아직 지운 계정이 없어요." rows={rows.slice(0, 50).map((r) => [new Date(r.at).toLocaleString('ko-KR'), r.kind, r.count])} />
    </section>
  )
}
