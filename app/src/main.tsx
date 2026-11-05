import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth'
import './styles.css'
import { applyView, loadView } from './view'
import { isMobile, M, routeByDevice } from './device'

// 첫 화면이 그려지기 전에 밝기 · 글자 크기를 맞춘다 (밤에 밝은 화면이 번쩍이지 않게)
applyView(loadView())
// 열어 둔 채로 밤 9시 · 10시를 넘겨도 밝기 · 조용한 시간이 바뀌도록
setInterval(() => applyView(loadView()), 5 * 60_000)

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
