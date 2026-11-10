import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth'
import './styles.css'
import { applyView, loadView } from './view'
import { isMobile, M, routeByDevice } from './device'
import { labOn } from './labs'
import { flushPending, siteConfig } from './api'

// 첫 화면이 그려지기 전에 밝기 · 글자 크기를 맞춘다 (밤에 밝은 화면이 번쩍이지 않게)
applyView(loadView())
// 열어 둔 채로 밤 9시 · 10시를 넘겨도 밝기 · 조용한 시간이 바뀌도록
setInterval(() => applyView(loadView()), 5 * 60_000)

// 개발 테스트 서버는 색 · 탭 제목부터 다르게 (정식 사이트와 헷갈려 지우지 않게)
siteConfig().then((c) => {
  if (!c.dev) return
  document.documentElement.dataset.dev = '1'
  const mark = () => { if (!document.title.startsWith('[개발]')) document.title = `[개발] ${document.title}` }
  mark()
  new MutationObserver(mark).observe(document.querySelector('title')!, { childList: true })
})

// 인터넷이 끊긴 동안 이 기기에 둔 그래프를 연결되면 올린다
flushPending()
window.addEventListener('online', () => { flushPending() })

// 홈 화면에 앱처럼 설치 (개발 테스트 서버에서만 manifest · 아이콘을 단다)
siteConfig().then((c) => {
  if (!labOn(c, 'me')) return
  for (const [rel, href] of [['manifest', '/manifest.json'], ['apple-touch-icon', '/icons/apple-touch-icon.png']]) {
    const l = document.createElement('link')
    l.rel = rel
    l.href = href
    document.head.appendChild(l)
  }
  const m = document.createElement('meta')
  m.name = 'apple-mobile-web-app-title'
  m.content = '그려봄'
  document.head.appendChild(m)
})

// 휴대폰 · 태블릿은 /m 으로. /m 안에서는 모든 링크가 /m 을 붙여 움직인다
const moving = routeByDevice()
if (isMobile()) document.documentElement.classList.add('m')

if (!moving) createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={isMobile() ? M : undefined}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
