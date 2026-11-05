import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { api } from './api'
import { useAuth } from './auth'
import Logo from './components/Logo'
import ViewSettings from './components/ViewSettings'
import Example from './pages/Example'
import Credits from './pages/Credits'
import { Privacy, Terms } from './pages/Legal'
import Home from './pages/Home'
import GraphEditor from './pages/GraphEditor'
import GraphResult from './pages/GraphResult'
import GraphBook from './pages/GraphBook'
import YearReview from './pages/YearReview'
import MyGraphs from './pages/MyGraphs'
import Share, { SharedLink } from './pages/Share'
import Login from './pages/Login'
import GroupPage from './pages/GroupPage'
import AdminPage from './pages/AdminPage'
import Join from './pages/Join'
import { canUseMobile, isMobile, switchLayout } from './device'
import { Me, MobileBar, MobileHome, MobileTabs } from './mobile'

export default function App() {
  const { pathname, search, hash } = useLocation()
  const { user, ready, setUser } = useAuth()
  const navigate = useNavigate()
  const mobile = isMobile()

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
      {mobile ? <MobileBar /> : (
      <header className="site-header no-print">
        <div className="container header-inner">
          <Logo />
          <nav aria-label="주요 메뉴" className="nav">
            <Link to="/#intro">소개</Link>
            <NavLink to="/graph/new">나의 그래프</NavLink>
            <NavLink to="/my">기록 모아보기</NavLink>
            <NavLink to="/share">함께 나누기</NavLink>
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
      {!mobile && !/^\/graph\/(new|[^/]+\/edit)/.test(pathname) && (
        <nav className="tabbar no-print" aria-label="주요 메뉴">
          {TABS.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className="tab">
              <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </>
  )
}

const TABS: [string, string, ReactNode][] = [
  ['/', '처음', <path key="i" d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />],
  ['/graph/new', '그리기', <path key="i" d="M3 17c3-6 5-8 8-4s5 2 7-4M16 5l3 3-9 9H7v-3z" />],
  ['/my', '기록', <path key="i" d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />],
  ['/share', '함께', <path key="i" d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2-5 5-5s5 2 5 5M11 20c0-3 2-5 5-5s5 2 5 5" />],
]

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
