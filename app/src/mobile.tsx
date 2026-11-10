// 모바일 · 태블릿 전용 화면(/m)의 틀과 화면. 기능 · 저장은 PC판 화면 코드를 그대로 쓴다.
import { useNewAnswers } from './pages/Contact'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { api } from './api'
import { useAuth, useRepo } from './auth'
import LifeGraph from './components/LifeGraph'
import Logo from './components/Logo'
import { ViewPanel } from './components/ViewSettings'
import { greeting, lineColorOf } from './content'
import { switchLayout } from './device'
import { downloadMyData, useLabs } from './labs'
import GuardianNotice from './components/GuardianNotice'
import { GroupNews, OrgHomeCard, GroupTopics, Resume, TodayQuestion } from './pages/Home'
import { formatDate, graphPoints, graphTitle } from './store'
import type { LifeGraph as Graph } from './types'

const TITLES: [RegExp, string][] = [
  [/^\/my/, '기록'], [/^\/share/, '함께'], [/^\/me/, '나'],
  [/^\/groups\//, '모임'], [/^\/graph\/new/, '새 그래프'], [/^\/graph\/[^/]+\/edit/, '그래프 고치기'],
  [/^\/graph\/[^/]+\/book/, '그래프 책'], [/^\/graph\//, '나의 그래프'], [/^\/review/, '한 해 돌아보기'],
  [/^\/s\//, '나눈 그래프'], [/^\/join\//, '모임 들어가기'], [/^\/login/, '로그인'], [/^\/example/, '예시 그래프'],
  [/^\/credits/, '만든 사람 · 오픈소스'], [/^\/worksheet/, '활동지'], [/^\/guardian\//, '보호자 동의'], [/^\/org/, '기관'], [/^\/contact/, '문의하기'], [/^\/terms/, '이용약관'], [/^\/privacy/, '개인정보 처리방침'],
]
const ROOTS = ['/', '/my', '/share', '/me']

/** 위 앱 바: 탭 첫 화면은 제목만, 그 밖에는 뒤로 가기. 내리면 제목이 작게 떠오른다 */
export function MobileBar() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [pathname])
  const root = ROOTS.includes(pathname)
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? ''
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/'))
  return (
    <header className={`m-bar no-print${scrolled ? ' is-scrolled' : ''}${root ? ' is-root' : ''}`}>
      <div className="m-bar-side">
        {pathname === '/' ? <Logo /> : !root && (
          <button type="button" className="m-icon-btn" onClick={back} aria-label="뒤로">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
        )}
      </div>
      <p className="m-bar-title" aria-hidden={pathname === '/'}>{pathname === '/' ? '' : title}</p>
      <div className="m-bar-side end">
        {!user && pathname !== '/login' && pathname !== '/me' && <Link to={pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`} className="m-bar-login">로그인</Link>}
      </div>
    </header>
  )
}

const I = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
const TABS: [string, string, ReactNode][] = [
  ['/', '처음', I('M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z')],
  ['/my', '기록', I('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11')],
  ['/graph/new', '그리기', I('M12 5v14M5 12h14')],
  ['/share', '함께', I('M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2-5 5-5s5 2 5 5M11 20c0-3 2-5 5-5s5 2 5 5')],
  ['/me', '나', I('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6')],
]

/** 아래 탭바 (태블릿은 왼쪽 세로 메뉴). 가운데 ‘그리기’는 동그란 버튼 */
export function MobileTabs() {
  return (
    <nav className="m-tabs no-print" aria-label="주요 메뉴">
      {TABS.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={to === '/'} className={`m-tab${to === '/graph/new' ? ' m-tab-draw' : ''}`}>
          <span className="m-tab-icon">{icon}</span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

/** 모바일 첫 화면: 인사 · 새 그래프 · 이어 그리기 · 오늘의 질문 · 내 그래프 넘겨 보기 · 모임 주제 */
export function MobileHome() {
  const { user } = useAuth()
  const repo = useRepo()
  const [graphs, setGraphs] = useState<Graph[] | null>(null)
  useEffect(() => {
    repo.list().then((l) => setGraphs([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), () => setGraphs([]))
  }, [repo])
  return (
    <div className="m-home">
      <section className="container m-hello">
        <p className="m-greet"><span className="season-dot" aria-hidden="true" />{greeting()}</p>
        <h1 className="m-hello-title">
          {user ? <>{user.nickname}님,<br />오늘은 어떤 선을 그려 볼까요?</> : <>지나온 나를 그리고,<br />지금의 나를 만나다.</>}
        </h1>
      </section>

      <section className="container">
        <Link to="/graph/new" className="m-start">
          {/* 그려봄의 선 한 줄: 카드 오른쪽에 은은하게 */}
          <svg className="m-start-line" viewBox="0 0 120 48" aria-hidden="true">
            <path d="M2 36C16 14 28 10 40 24s22 18 34 4 24-16 40-22" />
            <circle cx="40" cy="24" r="3" /><circle cx="74" cy="28" r="3" /><circle cx="114" cy="6" r="4" />
          </svg>
          <span className="m-start-title">새 그래프 그리기</span>
          <span className="m-start-sub">기억에 남는 순간을 점으로 이어 봐요</span>
        </Link>
      </section>

      <div className="container"><GuardianNotice /></div>
      <Resume />
      <TodayQuestion />

      {graphs && graphs.length > 0 && (
        <section className="m-section">
          <div className="container m-section-head">
            <h2>내 그래프</h2>
            <Link to="/my">모두 보기</Link>
          </div>
          <ul className="m-scroller">
            {graphs.slice(0, 8).map((g) => (
              <li key={g.id}>
                <Link to={g.completed ? `/graph/${g.id}` : `/graph/${g.id}/edit`} className="m-graph-card" style={{ '--line': lineColorOf(g.lineColor) } as CSSProperties}>
                  <LifeGraph compact tone={lineColorOf(g.lineColor)} points={graphPoints(g)} timeScale={g.timeScale} start={g.startPoint} end={g.currentPoint} />
                  <strong>{graphTitle(g)}</strong>
                  <small className="muted">{g.completed ? '완성' : '그리는 중'} · {formatDate(g.updatedAt)}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OrgHomeCard />
      <GroupNews />
      <GroupTopics />

      {graphs?.length === 0 && (
        <section className="container m-section">
          <div className="m-section-head"><h2>처음이라면</h2></div>
          <ol className="m-steps">
            <li><b>1</b>돌아볼 시간의 길이를 정해요</li>
            <li><b>2</b>기억에 남는 순간을 점으로 남겨요</li>
            <li><b>3</b>이어진 선에서 지금의 나를 만나요</li>
          </ol>
          <Link to="/example" className="m-row">예시 그래프 먼저 둘러보기<Chevron /></Link>
        </section>
      )}
    </div>
  )
}

const Chevron = () => <svg className="m-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>

/** ‘나’ 탭: 계정 · 보기 설정 · 약관 · PC 화면 · 로그아웃 (PC 의 머리 · 바닥글이 하던 일) */
export function Me() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const labs = useLabs('group')
  const labsOrg = useLabs('org')
  const labsMe = useLabs('me')
  const newAnswers = useNewAnswers()
  const logout = async () => {
    await api.logout().catch(() => {})
    setUser(null)
    navigate('/')
  }
  return (
    <section className="container page m-me">
      <div className="m-profile">
        <span className="m-avatar" aria-hidden="true">{user ? user.nickname.slice(0, 1) : I('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6')}</span>
        <div>
          <p className="m-profile-name">{user ? `${user.nickname}님` : '로그인하지 않았어요'}</p>
          <p className="muted small">{user ? '기록은 내 계정에 있어요' : '기록은 이 기기에만 있어요'}</p>
        </div>
        {!user && <Link to="/login" className="btn btn-primary btn-sm">로그인</Link>}
      </div>

      <h2 className="m-group-title">기록</h2>
      <nav className="m-list">
        <Link to="/my" className="m-row">기록 모아보기<Chevron /></Link>
        <Link to={`/review/${new Date().getFullYear()}`} className="m-row">한 해 돌아보기<Chevron /></Link>
        <Link to="/example" className="m-row">예시 그래프<Chevron /></Link>
        {labs && <Link to="/worksheet" className="m-row">종이 활동지 인쇄<Chevron /></Link>}
        {labsOrg && user && <Link to="/org" className="m-row">기관 · 내가 맡은 기관 · 기관 등록<Chevron /></Link>}
      </nav>

      <h2 className="m-group-title">보기</h2>
      <div className="m-list m-view"><ViewPanel /></div>

      <h2 className="m-group-title">정보</h2>
      <nav className="m-list">
        <Link to="/terms" className="m-row">이용약관<Chevron /></Link>
        {labsMe && <Link to="/contact" className="m-row">문의하기 · 내 문의{newAnswers > 0 && <span className="m-dot">새 답 {newAnswers}</span>}<Chevron /></Link>}
        <Link to="/privacy" className="m-row"><b>개인정보 처리방침</b><Chevron /></Link>
        <Link to="/credits" className="m-row">오픈소스<Chevron /></Link>
        <Link to="/credits?tab=team" className="m-row">만든 사람<Chevron /></Link>
        <button type="button" className="m-row" onClick={() => switchLayout('pc')}>PC 화면으로 보기<Chevron /></button>
      </nav>

      {user && labsMe && (
        <div className="m-list">
          <button type="button" className="m-row" onClick={() => downloadMyData().catch((e) => window.alert(e.message))}>내 기록 모두 내려받기<Chevron /></button>
        </div>
      )}
      {user && (
        <div className="m-list">
          <button type="button" className="m-row danger" onClick={logout}>로그아웃</button>
        </div>
      )}

      <p className="m-me-foot serif">모든 사람의 선은 서로 달라요.<br />나만의 속도로 그려도 괜찮아요.</p>
      <p className="muted small center">© 2026 그려봄 · v{__APP_VERSION__}</p>
    </section>
  )
}
