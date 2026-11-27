// 실험(1.3.0 사이트 지도 보드): 보드의 노드(iframe) 안에서 열렸을 때만 쓰인다.
// 보드가 iframe 이름(window.name = 'board:{...}')에 실어 보낸 상황을 이 화면에만 덮어쓴다 — 아무것도 저장하지 않는다.
import { OFFICIAL } from './flags'
import { newEntry, newGraph } from './store'
import type { LifeGraph } from './types'

export type BoardCfg = {
  theme?: 'auto' | 'light' | 'dark'
  text?: 'sm' | 'md' | 'lg'
  /** 낮(오후 2시) · 밤(밤 11시) 으로 시계를 맞춘다 */
  time?: 'day' | 'night'
  season?: 'spring' | 'summer' | 'autumn' | 'winter'
  motion?: 'reduce'
  /** 내 계정 그대로 / 로그인 안 한 손님으로: 빈 상태 · 그래프 1개 · 많이 */
  data?: 'account' | 'empty' | 'one' | 'many'
  /** 정식 서버처럼 (실험 기능 끄고 정식 묶음만) */
  labs?: 'dev' | 'official'
}

export const boardCfg: BoardCfg | null = (() => {
  try {
    return window.top !== window && window.name.startsWith('board:') ? (JSON.parse(window.name.slice(6)) as BoardCfg) : null
  } catch {
    return null
  }
})()

const GRAPHS = 'geuryeobom:graphs:v1'
/** 보드 노드 안에서 내 계정으로 저장한 그래프 id (보드가 정리할 때 쓴다) · 보드를 처음 열 때 이미 있던 그래프 id */
export const BOARD_MADE = 'geuryeobom:board:made'
export const BOARD_BASE = 'geuryeobom:board:base'

function demo(kind: 'one' | 'many'): LifeGraph[] {
  const mk = (id: string, title: string, end: number, pts: [number, number, string][]) => {
    const g = newGraph()
    Object.assign(g, { id, title, timeScale: 'age', startPoint: 0, currentPoint: end, completed: true, entries: pts.map(([t, s, ti]) => newEntry(t, s, ti)) })
    return g
  }
  const first = mk('board-demo-1', '열일곱의 나', 17, [[5, 3, '동생이 태어난 날'], [8, -2, '전학 온 봄'], [11, 4, '새 친구를 만난 날'], [14, -3, '진로를 고민한 시간'], [16, 4, '처음 무대에 선 날']])
  if (kind === 'one') return [first]
  return [
    first,
    mk('board-demo-2', '열다섯의 나', 15, [[5, 2, '동생이 태어난 날'], [8, -4, '전학 온 봄'], [11, 1, '새 친구를 만난 날'], [14, -1, '진로를 고민한 시간']]),
    mk('board-demo-3', '중학교 3년', 16, [[13, 1, '입학식'], [14, -2, '반이 바뀐 날'], [15, 3, '체육대회'], [16, 2, '졸업']]),
    mk('board-demo-4', '올해의 나', 17, [[16, 0, '새 학기'], [16.5, 4, '동아리'], [17, -1, '시험 기간']]),
    mk('board-demo-5', '캠프 사흘', 17, [[3, 1, '첫 만남'], [8, 4, '밤 이야기'], [12, 2, '헤어지는 날']]),
    mk('board-demo-6', '그리다 만 선', 17, [[6, 2, '이사']]),
  ]
}

if (boardCfg) {
  const c = boardCfg
  // 시계: 낮 · 밤 (조용한 시간 · 늦은 밤 화면을 바로 본다)
  if (c.time) {
    const h = c.time === 'night' ? 23 : 14
    Date.prototype.getHours = function () { return h }
  }
  // 계절: 앱이 5분마다 다시 정해도 보드가 고른 계절로
  if (c.season) {
    const root = document.documentElement
    const keep = () => { if (root.dataset.season !== c.season) root.dataset.season = c.season }
    new MutationObserver(keep).observe(root, { attributes: true, attributeFilter: ['data-season'] })
    keep()
  }
  // 움직임 줄이기: 장면을 바로 끝 모습으로
  if (c.motion === 'reduce') {
    const s = document.createElement('style')
    s.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}'
    document.head.append(s)
  }
  // 손님 데이터: 이 화면 안에서만 쓰는 그래프 (진짜 저장소는 건드리지 않는다)
  const guest = !!c.data && c.data !== 'account'
  if (guest) {
    let mem = c.data === 'empty' ? '[]' : JSON.stringify(demo(c.data === 'one' ? 'one' : 'many'))
    const P = Storage.prototype
    const get = P.getItem, set = P.setItem, del = P.removeItem
    P.getItem = function (this: Storage, k: string) { return this === localStorage && k === GRAPHS ? mem : get.call(this, k) }
    P.setItem = function (this: Storage, k: string, v: string) { if (this === localStorage && k === GRAPHS) mem = String(v); else set.call(this, k, v) }
    P.removeItem = function (this: Storage, k: string) { if (this === localStorage && k === GRAPHS) mem = '[]'; else del.call(this, k) }
  }
  // 3차 · 연습 데이터: 내 계정으로 보드 안에서 저장한 그래프는 표시해 두고, 보드에서 한 번에 정리한다
  if (!guest) {
    const orig = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await orig(input, init)
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const m = new URL(url, location.origin).pathname.match(/^\/api\/graphs\/([^/]+)$/)
        if (m && (init?.method ?? 'GET').toUpperCase() === 'PUT' && r.ok) {
          const made: string[] = JSON.parse(localStorage.getItem(BOARD_MADE) ?? '[]')
          if (!made.includes(m[1])) localStorage.setItem(BOARD_MADE, JSON.stringify([...made, m[1]].slice(-200)))
        }
      } catch { /* 표시만 못 할 뿐 */ }
      return r
    }
  }
  // 서버 응답 바꿔 보기: 손님이면 로그인 안 한 것처럼, 정식이면 실험 기능을 끈 설정으로
  if (guest || c.labs === 'official') {
    const orig = window.fetch.bind(window)
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } })
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, location.origin).pathname
      if (guest && path === '/api/me') return json({ user: null })
      if (c.labs === 'official' && path === '/api/config') {
        const r = await orig(input, init)
        return json({ ...(await r.json()), dev: false, flags: [...OFFICIAL] })
      }
      return orig(input, init)
    }
  }
}
