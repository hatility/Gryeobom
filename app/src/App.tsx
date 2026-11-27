import EmptyDoodle from './components/EmptyDoodle'
import Welcome from './pages/Welcome'
import Lines from './pages/Lines'
import Words from './pages/Words'
import Letters from './pages/Letters'
import Overview from './pages/Overview'
import Inbox from './pages/Inbox'
import Guide from './pages/Guide'
import Activities from './pages/Activities'
import Album from './pages/Album'
import Live from './pages/Live'
import MyBook from './pages/MyBook'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { useNavigate } from './nav'
import { api, siteConfig, type Notice } from './api'
import { useAuth } from './auth'
import Logo from './components/Logo'
import PageLink from './components/PageLink'
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
import Board from './pages/Board'
import Join from './pages/Join'
import Worksheet from './pages/Worksheet'
import GuardianConsent from './pages/GuardianConsent'
import OrgHome, { OrgDetail, OrgInvite } from './pages/OrgReport'
import Contact from './pages/Contact'
import { useLabs } from './labs'
import { useRouteMeta } from './seo'
import { flushSync } from 'react-dom'
import { canUseMobile, isMobile, M, switchLayout } from './device'
import { Me, MobileBar, MobileHome, MobileTabs } from './mobile'

export default function App() {
  const { pathname, search, hash } = useLocation()
  const { user, ready, setUser } = useAuth()
  const navigate = useNavigate()
  const mobile = isMobile()
  useRouteMeta(pathname)
  const orgs = useMyOrgs(pathname.startsWith('/org') ? pathname : '')

  useEffect(() => {
    if (pathname === '/' && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  // 화면 전환 효과를 모든 안쪽 링크에 (PageLink 만이 아니라 Link · 글 속 링크까지). 같은 사이트 안의 보통 클릭만 — 새 탭 · 다운로드 · 다른 틀(PC ↔ 휴대폰) · 움직임 줄이기 · 조용한 시간은 그대로
  useEffect(() => {
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
    if (!d.startViewTransition) return
    const base = mobile ? M : ''
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return
      if (base ? !(a.pathname === base || a.pathname.startsWith(base + '/')) : a.pathname === M || a.pathname.startsWith(M + '/')) return
      if (/^\/(api|licenses|admin\/backup)/.test(a.pathname) || /\.(pdf|png|jpe?g|zip|txt)$/.test(a.pathname)) return
      const to = (a.pathname.slice(base.length) || '/') + a.search + a.hash
      if (a.pathname === location.pathname && a.search === location.search) return // 같은 화면 안 이동(#) 은 그대로
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.quiet) return
      e.preventDefault()
      d.startViewTransition(() => flushSync(() => navigate(to)))
    }
    document.addEventListener('click', onClick, true) // 라우터보다 먼저 받아야 전환 안에서 이동한다
    return () => document.removeEventListener('click', onClick, true)
  }, [navigate, mobile])

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
      <OfflineNote />
      <QuietNote />
      {mobile ? <MobileBar /> : (
      // 1.2.0-ui 실험 ‘새 사이트’: 위에는 로고 · 로그인만, 이동은 화면 아래 가운데 떠 있는 둥근 메뉴(독) — 휴대폰 탭과 같은 앱
      <>
      <header className="topline no-print">
        <Logo />
        <span className="topline-side">
          <ViewSettings />
          {user ? (
            <>
              <Link to="/my" className="topline-me" title={`${user.nickname}님`}><span className="rail-avatar" aria-hidden="true">{user.nickname.slice(0, 1)}</span>{user.nickname}님</Link>
              <button type="button" className="btn btn-text btn-sm" onClick={logout}>로그아웃</button>
            </>
          ) : (
            <Link to={pathname === '/' || pathname === '/login' ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`} className="btn btn-ghost btn-sm">로그인</Link>
          )}
        </span>
      </header>
      <nav className="dock no-print" aria-label="주요 메뉴">
        <PageLink to="/" end className="dock-item"><span className="rail-icon">{RI('M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z')}</span><span>처음</span></PageLink>
        <PageLink to="/my" className="dock-item"><span className="rail-icon">{RI('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11')}</span><span>기록</span></PageLink>
        <PageLink to="/graph/new" className="dock-draw" aria-label="새 그래프 그리기"><span className="rail-icon">{RI('M12 5v14M5 12h14')}</span></PageLink>
        <PageLink to="/share" className="dock-item"><span className="rail-icon">{RI('M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2-5 5-5s5 2 5 5M11 20c0-3 2-5 5-5s5 2 5 5')}</span><span>함께</span></PageLink>
        {orgs?.length ? (
          <PageLink to="/org" className="dock-item"><span className="rail-icon">{RI('M4 20V9l8-5 8 5v11M9 20v-6h6v6M4 20h16')}</span><span>기관</span></PageLink>
        ) : (
          <Link to="/#intro" className="dock-item"><span className="rail-icon">{RI('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01')}</span><span>소개</span></Link>
        )}
      </nav>
      </>
      )}

      <main id="main">
        {/* 로그인 여부를 알아야 어느 저장소(이 기기/내 계정)를 쓸지 정할 수 있다 */}
        {ready ? (
          <ErrorBoundary>
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
            <Route path="/my/book" element={<MyBook />} />
            <Route path="/share" element={<Share />} />
            <Route path="/s/:code" element={<SharedLink />} />
            <Route path="/groups/:id" element={<GroupPage />} />
            <Route path="/join/:code" element={<Join />} />
            <Route path="/login" element={<Login />} />
            {/* 관리자 화면은 PC판으로 연다 */}
            <Route path="/admin" element={mobile ? <ToPc /> : <AdminPage />} />
            <Route path="/example" element={<Example />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/lines" element={<Lines />} />
            <Route path="/words" element={<Words />} />
            <Route path="/letters" element={<Letters />} />
            <Route path="/me/overview" element={<Overview />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/guide" element={<Guide />} />
            <Route path="/activities" element={<Activities />} />
            <Route path="/groups/:id/album" element={<Album />} />
            <Route path="/groups/:id/live" element={<Live />} />
            <Route path="/board" element={<Board />} />
            <Route path="/worksheet" element={<Worksheet />} />
            <Route path="/guardian/:token" element={<GuardianConsent />} />
            <Route path="/org" element={<OrgHome />} />
            <Route path="/org/:id" element={<OrgDetail />} />
            <Route path="/credits" element={<Credits />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </ErrorBoundary>
        ) : (
          <p className="container page loading serif">천천히 불러오는 중이에요…</p>
        )}
      </main>

      {!mobile && <SiteFooter />}

      {/* 모바일: 앱처럼 아래 탭바. 작성 중에는 단계 이동 버튼이 그 자리를 쓴다 */}
      {/* 모바일 · 태블릿(/m)은 앱 탭바 (그리기 가운데) */}
      {mobile && !/^\/graph\/(new|[^/]+\/edit)/.test(pathname) && <MobileTabs />}
    </>
  )
}

/** 세로 메뉴 아이콘 (모바일 탭과 같은 선 아이콘) */
const RI = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>

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

/** 인터넷이 끊기면 html[data-offline] — 로고 아래 선이 끊어져 보이고 한 줄 알림 (다시 이어지면 사라져요) */
function useOffline() {
  const [off, setOff] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const on = () => setOff(false), down = () => setOff(true)
    addEventListener('online', on); addEventListener('offline', down)
    return () => { removeEventListener('online', on); removeEventListener('offline', down) }
  }, [])
  useEffect(() => { document.documentElement.toggleAttribute('data-offline', off) }, [off])
  return off
}
/**
 * 오류 · 안내 상자(role=alert)가 새로 뜨면, 아래 떠 있는 메뉴에 가려지는 자리일 때 화면을 살짝 올려 보이게 해요.
 * (로그인 · 문의 · 나누기 등 11곳 — 한 곳에서)
 */
function useAlertsInView() {
  useEffect(() => {
    const seen = new WeakSet<Element>()
    const check = () => {
      for (const el of document.querySelectorAll('main [role="alert"]')) {
        if (seen.has(el)) continue
        seen.add(el)
        const r = el.getBoundingClientRect()
        if (r.height && r.bottom > innerHeight - 110) el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      }
    }
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])
}

export function OfflineNote() {
  useAlertsInView()
  const off = useOffline()
  return off ? <p className="offline-note no-print" role="status">인터넷이 잠시 끊겼어요. 다시 이어지면 이 알림이 사라져요.</p> : null
}

/** 화면을 그리다 문제가 생기면: 길 잃은 선 + 다시 불러오기 (빈 화면으로 멈추지 않게) */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="container page empty-state">
        <EmptyDoodle />
        <h1>잠깐 길이 엉켰어요</h1>
        <p className="muted">화면을 그리다 문제가 생겼어요. 적던 것은 저장된 만큼 남아 있어요. 다시 불러와 볼까요?</p>
        <svg className="lost-path" viewBox="0 0 120 40" aria-hidden="true"><path d="M8 6C30 2 40 30 62 20S96 4 100 34" pathLength={1} /><path d="M94 28l6 7 6-8" className="lost-tip" /></svg>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>다시 불러오기</button>
      </section>
    )
  }
}

function NotFound() {
  return (
    <section className="container page empty-state">
      <EmptyDoodle />
      <h1>길을 잠시 잃었어요</h1>
      <p className="muted">찾으려던 페이지가 없어요. 처음으로 돌아가 천천히 다시 시작해 봐요.</p>
      {/* 길 잃은 선이 ‘처음으로’ 버튼까지 이어져요 */}
      <svg className="lost-path" viewBox="0 0 120 40" aria-hidden="true"><path d="M8 6C30 2 40 30 62 20S96 4 100 34" pathLength={1} /><path d="M94 28l6 7 6-8" className="lost-tip" /></svg>
      <div className="lost-actions">
        <Link to="/" className="btn btn-primary">처음으로</Link>
        {window.history.length > 1 && <button type="button" className="btn" onClick={() => window.history.back()}>이전 화면으로</button>}
      </div>
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
/**
 * 푸터 (1.3.0 · A안): 종이 한 장에 네 칸 — 로고 · 한 줄 / 그리기 / 함께 / 정보, 아래에 © 와 작은 링크.
 * 하틸리티 메인 푸터와 같은 짜임새, 결(종이 · 고운바탕 · 손글씨 로고 · 마스킹테이프 · 점선)은 그려봄 것.
 */
const HATILITY_URL = 'https://github.com/hatility'
function SiteFooter() {
  const { user } = useAuth()
  const labsGroup = useLabs('group')
  const labsOrg = useLabs('org')
  const labsMe = useLabs('me')
  // 소스 저장소 주소(관리자 .env 의 DEV_URL): 있을 때만 ‘소스 저장소’ 링크 — ‘만든 곳’ 표(하틸리티)와 겹치지 않는 다른 곳
  const [repo, setRepo] = useState('')
  useEffect(() => { siteConfig().then((c) => setRepo(c.developer?.url ?? '')) }, [])
  const I = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
  return (
    <footer className="site-footer no-print">
      <div className="container">
        <div className="foot-card">
          <div className="foot-grid">
            <div className="foot-brand">
              <Link to="/" className="foot-logo" aria-label="그려봄 처음으로">그려봄</Link>
              <p className="serif foot-line">모든 사람의 선은 서로 달라요.<br />나만의 속도로 그려도 괜찮아요.</p>
              <FooterNote />
              <a className="foot-made" href={HATILITY_URL} target="_blank" rel="noreferrer">
                <img className="foot-made-ic" src="/hatility-mascot.png" alt="" width={32} height={32} loading="lazy" />
                <span><b>하틸리티가 만든 상자</b><small>하남시청소년수련관 Team HATILITY</small></span>
              </a>
            </div>
            <nav aria-label="그리기">
              <h2 className="foot-title">그리기</h2>
              <ul>
                <li><Link to="/graph/new">{I('M12 5v14M5 12h14')}나의 그래프 그리기</Link></li>
                <li><Link to="/example">{I('M3 16c3 0 4-8 7-8s3 6 6 6 3-5 5-5')}예시 그래프</Link></li>
                <li><Link to="/welcome">{I('M5 12h14M13 6l6 6-6 6')}1분 투어</Link></li>
                <li><Link to="/activities">{I('M4 7h16M4 12h10M4 17h13')}선 하나 활동</Link></li>
              </ul>
            </nav>
            <nav aria-label="함께">
              <h2 className="foot-title">함께</h2>
              <ul>
                <li><Link to="/share">{I('M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 6 2 6 5')}함께 나누기</Link></li>
                <li><Link to="/guide">{I('M4 4h12l4 4v12H4zM8 12h8M8 16h5')}진행자 안내서</Link></li>
                {labsGroup && <li><Link to="/worksheet">{I('M6 9V3h12v6M6 18H4v-7h16v7h-2M6 15h12v6H6z')}종이 활동지</Link></li>}
                {labsOrg && <li><Link to="/org">{I('M4 20V9l8-5 8 5v11M9 20v-6h6v6')}기관</Link></li>}
              </ul>
            </nav>
            <nav aria-label="정보">
              <h2 className="foot-title">정보</h2>
              <ul>
                {labsMe && <li><Link to="/contact">{I('M3 6h18v12H3zM3 7l9 6 9-6')}문의하기</Link></li>}
                <li><Link to="/credits?tab=team">{I('M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5')}만든 사람</Link></li>
                <li><Link to="/credits">{I('M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14')}오픈소스</Link></li>
                {repo && <li><a href={repo} target="_blank" rel="noreferrer">{I('M9 18l-5-6 5-6M15 6l5 6-5 6')}소스 저장소</a></li>}
              </ul>
            </nav>
          </div>
          <p className="foot-copy">
            <span>© 2026 그려봄 · v{__APP_VERSION__} · {user ? '내 계정에 저장' : '이 기기에 저장'}</span>
            <span className="foot-small">
              <Link to="/terms">이용약관</Link>
              <Link to="/privacy" className="is-strong">개인정보 처리방침</Link>
              <Link to="/credits?tab=team">AI 와 함께 만들었어요</Link>
              {canUseMobile() && <button type="button" className="foot-switch" onClick={() => switchLayout('m')}>모바일 화면으로 보기</button>}
            </span>
          </p>
        </div>
      </div>
    </footer>
  )
}

/** 조용한 시간(밤 10시 ~ 새벽 5시)이 적용된 날 처음 한 번: 왜 화면이 잔잔한지 한 줄 (7초 뒤 사라짐 · 보기에서 끌 수 있다고) */
function QuietNote() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!document.documentElement.dataset.quiet) return
    const key = 'geuryeobom:quiet-note', today = new Date().toDateString()
    try {
      if (localStorage.getItem(key) === today) return
      localStorage.setItem(key, today)
    } catch { /* 기억 못 하면 열 때마다 한 번 */ }
    setShow(true)
    const t = setTimeout(() => setShow(false), 7000)
    return () => clearTimeout(t)
  }, [])
  return show ? <p className="offline-note quiet-note no-print" role="status">조용한 시간이에요. 움직임을 멈추고 잔잔하게 보여 드려요 · ‘보기’ 에서 끌 수 있어요</p> : null
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
  return <p className="offline-banner" role="status"><strong>인터넷이 끊겼어요.</strong> 지금도 할 수 있는 일 · 그리기 · 내 기록 보기 · 이미지로 저장. 적는 것은 이 기기에 잠시 두었다가 연결되면 저절로 올려요. 나누기 · 모임 · 응원은 연결된 뒤에 돼요.</p>
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

/** 사이트 설정의 ‘푸터 한 줄’ (운영 기관 홍보 등) */
function FooterNote() {
  const [t, setT] = useState('')
  useEffect(() => { siteConfig().then((c) => setT(c.footer ?? '')) }, [])
  return t ? <p className="footer-note muted small">{t}</p> : null
}
