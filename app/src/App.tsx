import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { api, siteConfig, type Notice } from './api'
import { useAuth } from './auth'
import Logo from './components/Logo'
import ViewSettings from './components/ViewSettings'
import Example from './pages/Example'
import Credits from './pages/Credits'
import { Privacy, Terms } from './pages/Legal'
import Home, { useMyOrgs } from './pages/Home'
import GraphEditor from './pages/GraphEditor'
import GraphResult from './pages/GraphResult'
import GraphBook, { GraphSheet } from './pages/GraphBook'
import GroupPresent from './pages/GroupPresent'
import YearReview from './pages/YearReview'
import MyGraphs from './pages/MyGraphs'
import Share, { SharedLink } from './pages/Share'
import Login from './pages/Login'
import GroupPage from './pages/GroupPage'
import AdminPage from './pages/AdminPage'
import Join from './pages/Join'
import Worksheet from './pages/Worksheet'
import GuardianConsent from './pages/GuardianConsent'
import OrgHome, { OrgDetail, OrgInvite } from './pages/OrgReport'
import Contact from './pages/Contact'
import { useLabs } from './labs'
import { canUseMobile, isMobile, switchLayout } from './device'
import { Me, MobileBar, MobileHome, MobileTabs } from './mobile'

export default function App() {
  const { pathname, search, hash } = useLocation()
  const { user, ready, setUser } = useAuth()
  const navigate = useNavigate()
  const mobile = isMobile()
  const orgs = useMyOrgs(pathname.startsWith('/org') ? pathname : '')

  useEffect(() => {
    if (pathname === '/' && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  const logout = async () => {
    await api.logout().catch(() => {})
    setUser(null)
    navigate('/')
  }

  return (
    <>
      <a className="skip-link" href="#main">본문으로 건너뛰기</a>
      {!pathname.startsWith('/admin') && <NoticePopup />}
      {!pathname.startsWith('/admin') && <MaintenanceBanner />}
      <OfflineBanner />
      {/* 글을 쓰는 동안에는 가리지 않게 */}
      {!pathname.startsWith('/admin') && !/^\/graph\/(new|[^/]+\/edit)|\/present$/.test(pathname) && <AdminAlert />}
      {user && !/^\/(terms|privacy|admin)/.test(pathname) && <TermsPrompt onLogout={logout} />}
      <DevBadge />
      {mobile ? <MobileBar /> : (
      <header className="site-header no-print">
        <div className="container header-inner">
          <Logo />
          <nav aria-label="주요 메뉴" className="nav">
            <Link to="/#intro">소개</Link>
            <NavLink to="/graph/new">나의 그래프</NavLink>
            <NavLink to="/my">기록 모아보기</NavLink>
            <NavLink to="/share">함께 나누기</NavLink>
            {!!orgs?.length && <NavLink to="/org">기관</NavLink>}
          </nav>
          <ViewSettings />
          {user ? (
            <span className="header-user">
              <Link to="/my" className="btn btn-ghost btn-sm">{user.nickname}님</Link>
              <button type="button" className="btn btn-text btn-sm" onClick={logout}>로그아웃</button>
            </span>
          ) : (
            <Link to={pathname === '/' || pathname === '/login' ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`} className="btn btn-ghost btn-sm header-cta">로그인</Link>
          )}
        </div>
      </header>
      )}

      <main id="main">
        {/* 로그인 여부를 알아야 어느 저장소(이 기기/내 계정)를 쓸지 정할 수 있다 */}
        {ready ? (
          <Routes>
            <Route path="/" element={mobile ? <MobileHome /> : <Home />} />
            <Route path="/me" element={<Me />} />
            <Route path="/graph/new" element={<GraphEditor />} />
            <Route path="/graph/:id/edit" element={<GraphEditor />} />
            <Route path="/graph/:id" element={<GraphResult />} />
            <Route path="/graph/:id/book" element={<GraphBook />} />
            <Route path="/graph/:id/sheet" element={<GraphSheet />} />
            <Route path="/groups/:id/present" element={<GroupPresent />} />
            <Route path="/org-invite/:token" element={<OrgInvite />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/review/:year?" element={<YearReview />} />
            <Route path="/my" element={<MyGraphs />} />
            <Route path="/share" element={<Share />} />
            <Route path="/s/:code" element={<SharedLink />} />
            <Route path="/groups/:id" element={<GroupPage />} />
            <Route path="/join/:code" element={<Join />} />
            <Route path="/login" element={<Login />} />
            {/* 관리자 화면은 PC판으로 연다 */}
            <Route path="/admin" element={mobile ? <ToPc /> : <AdminPage />} />
            <Route path="/example" element={<Example />} />
            <Route path="/worksheet" element={<Worksheet />} />
            <Route path="/guardian/:token" element={<GuardianConsent />} />
            <Route path="/org" element={<OrgHome />} />
            <Route path="/org/:id" element={<OrgDetail />} />
            <Route path="/credits" element={<Credits />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        ) : (
          <p className="container page loading serif">천천히 불러오는 중이에요…</p>
        )}
      </main>

      {!mobile && (
      <footer className="site-footer no-print">
        <div className="container footer-inner">
          <p className="serif">
            <span className="line">모든 사람의 선은 서로 달라요.</span>{' '}
            <span className="line">나만의 속도로 그려도 괜찮아요.</span>
          </p>
          <nav className="footer-links" aria-label="사이트 정보">
            <span className="footer-group">
              <Link to="/terms">이용약관</Link>
              <Link to="/privacy" className="is-strong">개인정보 처리방침</Link>
              <ContactLink />
            </span>
            <span className="footer-group">
              <Link to="/credits">오픈소스</Link>
              <Link to="/credits?tab=team">만든 사람</Link>
            </span>
          </nav>
          <p className="footer-meta">
            © 2026 그려봄 · v{__APP_VERSION__} · {user ? '내 계정에 저장' : '이 기기에 저장'}
          </p>
          {canUseMobile() && (
            <button type="button" className="btn btn-text btn-sm layout-switch" onClick={() => switchLayout('m')}>모바일 화면으로 보기</button>
          )}
        </div>
      </footer>
      )}

      {/* 모바일: 앱처럼 아래 탭바. 작성 중에는 단계 이동 버튼이 그 자리를 쓴다 */}
      {/* 모바일 · 태블릿(/m)은 앱 탭바 (그리기 가운데) */}
      {mobile && !/^\/graph\/(new|[^/]+\/edit)/.test(pathname) && <MobileTabs />}
    </>
  )
}

/** 개발 테스트 서버 표시: 정식 사이트와 헷갈리지 않게 화면 구석에 늘 */
function DevBadge() {
  const [dev, setDev] = useState(false)
  useEffect(() => {
    siteConfig().then((c) => setDev(!!c.dev))
  }, [])
  return dev ? <p className="dev-badge no-print" role="note">개발 테스트 서버</p> : null
}

const SEEN = 'geuryeobom:notice'
/** 관리자 공지: 처음 열 때 한 번. 확인을 누르면 이 기기에서는 같은 공지가 다시 뜨지 않는다 (고치면 다시) */
function NoticePopup() {
  const [n, setN] = useState<Notice | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    api.notice().then((x) => {
      let seen: string | null = null
      try { seen = localStorage.getItem(SEEN) } catch { /* 기억 못 하면 매번 보여 준다 */ }
      if (x && seen !== x.at) setN(x)
    }, () => {})
  }, [])
  useEffect(() => {
    if (n && !ref.current?.open) ref.current?.showModal()
  }, [n])
  if (!n) return null
  const ok = () => {
    try { localStorage.setItem(SEEN, n.at) } catch { /* 이번만 닫는다 */ }
    ref.current?.close()
    setN(null)
  }
  return (
    <dialog ref={ref} className="dialog notice-dialog" aria-labelledby="notice-title" onCancel={ok}>
      {/* 처음 초점은 제목에 (버튼에 두면 굵은 테두리가 먼저 보인다) */}
      <p className="eyebrow notice-eyebrow">알려 드려요</p>
      <h2 id="notice-title" className="card-title" tabIndex={-1} autoFocus>{n.title || '공지'}</h2>
      {n.body && <p className="notice-body">{n.body}</p>}
      <button type="button" className="btn btn-primary btn-block" onClick={ok}>확인</button>
    </dialog>
  )
}

function ToPc() {
  // 고른 화면(모바일)은 그대로 두고 관리자만 PC판으로
  useEffect(() => location.replace('/admin' + location.search), [])
  return <p className="container page loading serif">PC 화면으로 옮기는 중이에요…</p>
}

function NotFound() {
  return (
    <section className="container page empty-state">
      <p className="eyebrow">LOST LINE</p>
      <h1>길을 잠시 잃었어요</h1>
      <p className="muted">찾으려던 페이지가 없어요. 처음으로 돌아가 천천히 다시 시작해 봐요.</p>
      <Link to="/" className="btn btn-primary">처음으로</Link>
    </section>
  )
}

/** 약관 · 처리방침이 바뀌었으면 바뀐 점을 보여 주고 다시 동의를 받는다 (그 전에 동의한 사람만) */
function TermsPrompt({ onLogout }: { onLogout: () => void }) {
  const [t, setT] = useState<{ summary: string } | null>(null)
  const [ok, setOk] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    api.myTerms().then((r) => r.need && setT({ summary: r.summary ?? '' }), () => {})
  }, [])
  useEffect(() => {
    if (t && ref.current && !ref.current.open) ref.current.showModal()
  }, [t])
  if (!t) return null
  return (
    <dialog ref={ref} className="dialog notice-dialog terms-dialog" aria-labelledby="terms-title" onCancel={(e) => e.preventDefault()}>
      <p className="eyebrow">약관이 바뀌었어요</p>
      <h2 id="terms-title" className="card-title">바뀐 점을 확인해 주세요</h2>
      <p className="notice-body">{t.summary}</p>
      <p className="muted small"><Link to="/terms" target="_blank">이용약관</Link> · <Link to="/privacy" target="_blank">개인정보 처리방침</Link> 전문은 새 창으로 열려요.</p>
      <label className="check agree"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> 바뀐 이용약관과 개인정보 처리방침을 읽었고 동의해요</label>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => api.agreeTerms().then(() => { ref.current?.close(); setT(null) }, () => {})}>동의하고 계속하기</button>
        <button type="button" className="btn btn-text" onClick={() => { ref.current?.close(); onLogout() }}>동의하지 않고 로그아웃</button>
      </div>
      <p className="muted small">동의하지 않으면 ‘기록 모아보기 → 계정 지우기’ 로 탈퇴할 수 있어요.</p>
    </dialog>
  )
}

/** 점검 중이면 화면 맨 위에 (보기는 되고 저장은 잠시 멈춤) */
function MaintenanceBanner() {
  const [m, setM] = useState<{ message: string } | null>(null)
  useEffect(() => {
    siteConfig().then((c) => setM(c.maintenance ?? null))
  }, [])
  if (!m) return null
  return (
    <p className="maint-banner" role="status">
      <strong>점검 중이에요</strong>{m.message && <> · {m.message}</>}<span> 지금은 보기만 할 수 있고, 적은 것은 저장되지 않아요.</span>
    </p>
  )
}

/** 바닥글 ‘문의하기’ */
function ContactLink() {
  return useLabs('me') ? <Link to="/contact">문의하기</Link> : null
}

/** 인터넷이 끊기면 위에 안내 (적는 것은 이 기기에 두었다가 연결되면 올린다) */
function OfflineBanner() {
  const labs = useLabs('graph')
  const [off, setOff] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)
  useEffect(() => {
    const on = () => setOff(false), down = () => setOff(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', down)
    }
  }, [])
  if (!labs || !off) return null
  return <p className="offline-banner" role="status"><strong>인터넷이 끊겼어요.</strong> 그래프에 적는 것은 이 기기에 잠시 두었다가, 연결되면 저절로 올려요.</p>
}

/** 관리자로 로그인한 브라우저라면, 사이트 어디서나 새 신고 · 문의를 작게 알린다 (1분마다 확인) */
function AdminAlert() {
  const [a, setA] = useState({ reports: 0, inquiries: 0 })
  const [hidden, setHidden] = useState(-1)
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined
    let live = true // 첫 응답보다 화면이 먼저 사라지면 타이머를 만들지 않는다
    const check = () => api.adminMe().then((m) => {
      if (!live || !m.admin || !m.alerts) return
      setA(m.alerts)
      t ??= setInterval(check, 60_000)
    }, () => {})
    check()
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  const n = a.reports + a.inquiries
  if (!n || n === hidden) return null
  return (
    <p className="admin-alert no-print" role="status">
      <Link to={`/admin?tab=${a.inquiries ? 'inquiries' : 'reports'}`}>
        <span aria-hidden="true">●</span> {[a.inquiries > 0 && `새 문의 ${a.inquiries}`, a.reports > 0 && `신고 ${a.reports}`].filter(Boolean).join(' · ')}
      </Link>
      <button type="button" aria-label="알림 닫기" onClick={() => setHidden(n)}>✕</button>
    </p>
  )
}
