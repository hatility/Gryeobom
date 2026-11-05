import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, REPORT_REASONS, shareBase, type AdminGroup, type AdminLink, type AdminLogin, type AdminOverview, type AdminReport, type AdminUser, type SiteConfig } from '../api'
import LifeGraph from '../components/LifeGraph'
import { ENTRY_QUESTIONS, NOW_QUESTIONS, lineColorOf, presetLabel, rangeLabel, scoreWord, signed, timeLabel } from '../content'
import { formatDate, graphPoints, graphTitle, sortEntries } from '../store'
import { GroupInfoForm } from './GroupPage'

type State = 'loading' | 'off' | 'login' | 'in'
type Tab = 'home' | 'reports' | 'users' | 'groups' | 'posts' | 'links' | 'logins' | 'settings' | 'backup'
const ROLE = { owner: '모임장', co: '공동 모임장', member: '함께하는 사람' } as const
const SCALE = { age: '나이로', year: '연도로', month: '달로' } as Record<string, string>

/** 왼쪽 메뉴: 묶음 → [탭, 이름, 설명] */
const NAV: [string, [Tab, string, string][]][] = [
  ['운영', [
    ['home', '한눈에', '이번 주 흐름과 지금까지 쌓인 것을 한 화면에서 봐요.'],
    ['reports', '신고함', '모임 사람들이 보낸 신고예요. 처리하지 않은 것이 위에 있어요.'],
  ]],
  ['사람과 기록', [
    ['users', '사람', '가입한 사람과 모든 기록이에요. 기록은 운영에 꼭 필요할 때만 열어 봐 주세요.'],
    ['groups', '모임', '모임 이름 · 소개를 고치거나, 함께하는 사람과 나눈 그래프를 봐요.'],
    ['posts', '나눈 그래프', '모임에 나눈 그래프예요. 내려도 본인의 기록은 그대로 남아요.'],
    ['links', '공유 링크', '공유 링크로 나간 내용이에요 (회고는 담기지 않아요). 끄면 받은 사람도 더는 볼 수 없어요.'],
  ]],
  ['관리', [
    ['logins', '관리자 접속', '관리자 로그인 시도를 최근 300건까지 보여요. IP 에 별칭을 붙이면 누가 들어왔는지 알기 쉬워요.'],
    ['settings', '사이트 설정', '약관 · 처리방침의 운영 정보, 공유 주소, 만든 사람 정보를 정해요.'],
    ['backup', '백업 · 복원', 'DB 를 파일 하나로 내려받거나, 그 파일로 되돌려요.'],
  ]],
]
const ALL_TABS = NAV.flatMap(([, items]) => items)

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
  const [state, setState] = useState<State>('loading')
  const [data, setData] = useState<AdminOverview | null>(null)
  const [form, setForm] = useState({ id: '', password: '' })
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    return t && ALL_TABS.some(([k]) => k === t) ? t : 'home'
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
        <p className="eyebrow">ADMIN</p>
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
            <p className="eyebrow">ADMIN</p>
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
  const urgent = data?.stats.openReports ?? 0
  const choose = (t: Tab) => {
    setTab(t)
    setView(null)
    setQ('')
    const u = new URL(window.location.href)
    u.searchParams.set('tab', t)
    window.history.replaceState(null, '', u)
  }
  const [, title, desc] = ALL_TABS.find(([k]) => k === tab)!
  const searchable = !view && (tab === 'users' || tab === 'groups' || tab === 'posts')

  const users = data?.users.filter((u) => has(q, u.nickname)) ?? []
  const groups = data?.groups.filter((g) => has(q, g.name, g.owner, g.code)) ?? []
  const posts = data?.posts.filter((p) => has(q, p.title, p.nickname, p.groupName)) ?? []

  return (
    <section className="container page admin">
      <header className="admin-top">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1 className="page-title">운영</h1>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>관리자 로그아웃</button>
      </header>

      <div className="admin-layout">
        <nav className="admin-nav" aria-label="관리 메뉴">
          {NAV.map(([group, items]) => (
            <div key={group} className="admin-nav-group">
              <p className="admin-nav-title">{group}</p>
              {items.map(([key, label]) => (
                <button key={key} type="button" className="admin-nav-item" aria-current={tab === key ? 'page' : undefined} onClick={() => choose(key)}>
                  <span>{label}</span>
                  {key === 'reports' && urgent > 0 ? <span className="admin-badge is-alert">{urgent}</span> : count[key] !== undefined && <span className="admin-badge">{count[key]}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-main">
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

          {tab === 'settings' ? (
            <SiteSettings />
          ) : tab === 'backup' ? (
            <>
              <BackupCard />
              <RestoreCard onDone={load} />
            </>
          ) : tab === 'links' ? (
            <LinksTab />
          ) : tab === 'logins' ? (
            <LoginsTab />
          ) : tab === 'reports' ? (
            <ReportsTab onGroup={openGroup} onChanged={load} />
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
            <Overview data={data} onUser={openUser} onReports={() => choose('reports')} />
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
          <h3>{user.nickname}</h3>
          <p className="muted small">
            {formatDate(user.createdAt)} 가입 · 마지막 방문 <strong>{since(user.lastSeenAt)}</strong> · 로그인된 기기 {user.sessions}곳
          </p>
          <p className="muted small">약관 동의 {user.agreedAt ? formatDate(user.agreedAt) : '기록 없음 (0.11.0 이전 가입)'} · 계정 id <code>{user.id}</code></p>
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
                <Answers items={ENTRY_QUESTIONS.map((q) => [q.q, e.reflection[q.key]])} />
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
          l.ok ? '들어옴' : <span key="r" className="danger">틀림</span>,
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
      <p className="muted small">서버도 하루 한 번 볼륨 안 <code>backups/auto-날짜.db</code> 로 자동 백업을 남겨요 (최근 <code>BACKUP_KEEP</code>개, 기본 7). 같은 디스크 안이라 디스크가 고장 나면 함께 잃으니, 가끔은 여기서 내려받아 다른 곳에도 보관해 주세요.</p>
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
