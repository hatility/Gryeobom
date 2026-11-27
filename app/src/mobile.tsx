// 모바일 · 태블릿 전용 화면(/m)의 틀과 화면. 기능 · 저장은 PC판 화면 코드를 그대로 쓴다.
import { firstTime, seasonChanged } from './components/once'
import PageLink from './components/PageLink'
import { editHref } from './pages/MyGraphs'
import { useNewAnswers } from './pages/Contact'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useNavigate } from './nav'
import { api, siteConfig } from './api'
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
  [/^\/graph\/[^/]+\/book/, '한 권으로'], [/^\/graph\//, '나의 그래프'], [/^\/review/, '한 해 돌아보기'],
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
        {/* 탭 첫 화면은 로고 (PC 위 줄처럼 — 빈 띠가 되지 않게), 그 밖에는 뒤로 */}
        {root ? <Logo /> : (
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

/** 아래 떠 있는 둥근 메뉴 (휴대폰 · 태블릿 같게). 가운데 ‘그리기’는 동그란 버튼 */
export function MobileTabs() {
  return (
    <nav className="m-tabs no-print" aria-label="주요 메뉴">
      {TABS.map(([to, label, icon]) => (
        <PageLink key={to} to={to} end={to === '/'} className={`m-tab${to === '/graph/new' ? ' m-tab-draw' : ''}`}>
          <span className="m-tab-icon">{icon}</span>
          <span>{label}</span>
        </PageLink>
      ))}
    </nav>
  )
}

/** 모바일 첫 화면: 인사 · 새 그래프 · 이어 그리기 · 오늘의 질문 · 내 그래프 넘겨 보기 · 모임 주제 */
export function MobileHome() {
  const { user } = useAuth()
  const repo = useRepo()
  const [graphs, setGraphs] = useState<Graph[] | null>(null)
  const [reloadN, setReloadN] = useState(0)
  useEffect(() => {
    repo.list().then((l) => setGraphs([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), () => setGraphs([]))
  }, [repo, reloadN])
  const pull = usePullRefresh(() => setReloadN((n) => n + 1))
  // 처음 들어온 사람에게 한 번: 인사가 한 줄씩 떠올라요 · 계절이 바뀐 뒤 처음 오면 한마디
  const [welcome] = useState(() => !!user && firstTime(`gb-welcome-${user.id}`))
  const [season] = useState(seasonChanged)
  return (
    <div className="m-home">
      {/* 맨 위에서 아래로 당기면: 선이 그어지고 다 그어지면 다시 불러와요 */}
      {pull > 0 && <svg className="m-pull" viewBox="0 0 120 12" aria-hidden="true" style={{ '--pull': Math.min(1, pull) } as CSSProperties}><path d="M4 8C30 2 50 12 76 6s30-4 40-2" pathLength={1} /></svg>}
      <section className={`container m-hello${welcome ? ' is-welcome' : ''}`}>
        <p className="m-greet"><span className="season-dot" aria-hidden="true" />{greeting()}{season && <span className="season-new"> · {season}이 왔어요</span>}</p>
        <h1 className="m-hello-title">
          {user ? <>{user.nickname}님,<br />오늘은 어떤 선을 그려 볼까요?</> : <>지나온 나를 그리고,<br />지금의 나를 만나다.</>}
        </h1>
        {!user && <Link to="/welcome" className="m-tour">처음이라면 1분 투어 ›</Link>}
      </section>

      <section className="container">
        <Link to="/graph/new" className="m-start">
          {/* 그려봄의 선 한 줄: 카드 오른쪽에 은은하게 */}
          <svg className="m-start-line" viewBox="0 0 120 48" aria-hidden="true">
            <path d="M2 36C16 14 28 10 40 24s22 18 34 4 24-16 40-22" pathLength={1} />
            <circle cx="40" cy="24" r="3" /><circle cx="74" cy="28" r="3" /><circle cx="114" cy="6" r="4" />
            {/* 손가락: 점이 생기는 자리를 차례로 톡 — 점을 찍으면 선이 이어진다는 것 */}
            <g className="m-tap"><circle className="m-tap-ring" r="9" /><circle className="m-tap-pad" r="6" /></g>
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
                <Link to={g.completed ? `/graph/${g.id}` : editHref(g.id)} className="m-graph-card" style={{ '--line': lineColorOf(g.lineColor) } as CSSProperties}>
                  <LifeGraph compact tone={lineColorOf(g.lineColor)} points={graphPoints(g)} timeScale={g.timeScale} start={g.startPoint} end={g.currentPoint} />
                  <strong>{graphTitle(g)}</strong>
                  <small className="muted">{g.completed ? '완성' : '그리는 중'} · {formatDate(g.updatedAt)}</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <GroupTopics />
      <GroupNews />
      <OrgHomeCard />

      {graphs?.length === 0 && (
        <section className="container m-section">
          <div className="m-section-head"><h2>처음이라면</h2></div>
          <ol className="m-steps">
            <li><b>1</b>돌아볼 시간의 길이를 정해요</li>
            <li><b>2</b>기억에 남는 순간을 점으로 남겨요</li>
            <li><b>3</b>이어진 선에서 지금의 나를 만나요</li>
          </ol>
          <Link to="/example" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 16c3 0 4-8 7-8s3 6 6 6 3-5 5-5')}</span>예시 그래프 먼저 둘러보기<Chevron /></Link>
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
  const [footer, setFooter] = useState('')
  useEffect(() => { siteConfig().then((c) => setFooter(c.footer ?? '')) }, [])
  const logout = async () => {
    await api.logout().catch(() => {})
    setUser(null)
    navigate('/')
  }
  return (
    <section className="container page m-me">
      {/* PC 에서는 다른 화면과 같은 머리말 (휴대폰에서는 위 막대 제목이 대신해서 읽기용으로만) */}
      <header className="page-head">
        <div>
          <p className="eyebrow en">ME</p>
          <h1 className="page-title">나</h1>
          <p className="muted">내 기록과 보기 설정을 한곳에서 봐요.</p>
        </div>
      </header>
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
        <Link to="/my" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6')}</span>기록 모아보기<Chevron /></Link>
        {user && <Link to="/me/overview" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 17l5-6 4 4 5-7 4 5M3 21h18')}</span>내 흐름<Chevron /></Link>}
        {user && <Link to="/lines" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M4 7h16M4 12h10M4 17h13')}</span>오늘의 한 줄 모아보기<Chevron /></Link>}
        <Link to="/words" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M4 5h16v6H4zM4 13h16v6H4zM10 8h4M10 16h4')}</span>마음 서랍<Chevron /></Link>
        <Link to="/letters" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 6h18v12H3zM3 7l9 6 9-6')}</span>편지함<Chevron /></Link>
        {user && <Link to="/inbox" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M4 4h16v12H4zM4 16l3-4h10l3 4M4 16v4h16v-4')}</span>소식함<Chevron /></Link>}
        <Link to={`/review/${new Date().getFullYear()}`} className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4')}</span>한 해 돌아보기<Chevron /></Link>
        <Link to="/example" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 16c3 0 4-8 7-8s3 6 6 6 3-5 5-5')}</span>예시 그래프<Chevron /></Link>
        {labs && <Link to="/worksheet" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M6 9V3h12v6M6 18H4v-7h16v7h-2M6 15h12v6H6z')}</span>종이 활동지 인쇄<Chevron /></Link>}
        {labsOrg && user && <Link to="/org" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 21h18M5 21V7l7-4 7 4v14M9 12h.01M15 12h.01M9 16h.01M15 16h.01')}</span>기관<Chevron /></Link>}
      </nav>

      <h2 className="m-group-title">보기</h2>
      <div className="m-list m-view"><ViewPanel /></div>

      <h2 className="m-group-title">둘러보기</h2>
      <nav className="m-list">
        <Link to="/welcome" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M5 12h14M13 6l6 6-6 6')}</span>1분 투어<Chevron /></Link>
        <Link to="/activities" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 17c4 0 5-10 9-10s5 8 9 2')}</span>선 하나 활동<Chevron /></Link>
        <Link to="/guide" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M4 4h12l4 4v12H4zM8 12h8M8 16h5')}</span>진행자 안내서<Chevron /></Link>
      </nav>

      <h2 className="m-group-title">정보</h2>
      <nav className="m-list">
        <Link to="/terms" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M6 3h9l4 4v14H6zM9 12h6M9 16h6')}</span>이용약관<Chevron /></Link>
        {labsMe && <Link to="/contact" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M3 6h18v12H3zM3 7l9 6 9-6')}</span>문의하기 · 내 문의{newAnswers > 0 && <span className="m-dot">새 답 {newAnswers}</span>}<Chevron /></Link>}
        <Link to="/privacy" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z')}</span><b>개인정보 처리방침</b><Chevron /></Link>
        <Link to="/credits" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14')}</span>오픈소스<Chevron /></Link>
        <Link to="/credits?tab=team" className="m-row"><span className="m-row-ic" aria-hidden="true">{I('M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 11a2.5 2.5 0 1 0 0-5M21 20c0-2.5-2-4.2-4.5-4.6')}</span>만든 사람<Chevron /></Link>
        <button type="button" className="m-row" onClick={() => switchLayout('pc')}>PC 화면으로 보기<Chevron /></button>
        {labs && (
          <details className="m-install">
            <summary className="m-row">홈 화면에 두기<Chevron /></summary>
            {/* 휴대폰 그림: 공유 단추 → ‘홈 화면에 추가’ 가 차례로 눌려요 */}
            <svg className="m-install-art" viewBox="0 0 120 150" aria-hidden="true">
              <rect x="30" y="6" width="60" height="120" rx="10" className="mi-phone" />
              <rect x="38" y="20" width="44" height="74" rx="4" className="mi-screen" />
              <path d="M50 60c6-12 12-12 18-4s10 6 14-6" className="mi-line" />
              <g className="mi-sheet"><rect x="34" y="80" width="52" height="40" rx="6" /><rect x="40" y="88" width="40" height="8" rx="3" className="mi-pick" /><rect x="40" y="102" width="30" height="6" rx="3" /></g>
              <path d="M56 106h-2v8h12v-8h-2M60 110v-10m-3 3 3-3 3 3" className="mi-share" />
            </svg>
            <ol className="m-install-steps">
              <li>아이폰은 사파리 아래 <b>공유 단추</b> → <b>홈 화면에 추가</b></li>
              <li>안드로이드는 크롬 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b></li>
            </ol>
          </details>
        )}
      </nav>
      {footer && <p className="footer-note muted small">{footer}</p>}

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

/** 맨 위에서 아래로 당겨 새로고침: 0~1 (1 이 되면 놓았을 때 onRefresh) */
function usePullRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0)
  const cb = useRef(onRefresh)
  cb.current = onRefresh
  useEffect(() => {
    let y0 = -1, p = 0
    const start = (e: TouchEvent) => { y0 = window.scrollY <= 0 ? e.touches[0].clientY : -1 }
    const move = (e: TouchEvent) => { if (y0 < 0) return; p = Math.max(0, (e.touches[0].clientY - y0) / 110); setPull(p) }
    const end = () => { if (p >= 1) { navigator.vibrate?.(8); cb.current() } y0 = -1; p = 0; setPull(0) }
    addEventListener('touchstart', start, { passive: true }); addEventListener('touchmove', move, { passive: true }); addEventListener('touchend', end)
    return () => { removeEventListener('touchstart', start); removeEventListener('touchmove', move); removeEventListener('touchend', end) }
  }, [])
  return pull
}
