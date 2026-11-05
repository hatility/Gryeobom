// 모바일 · 태블릿 전용 화면은 /m 아래에서 열린다. 화면 코드는 PC판과 같고, 틀(머리 · 아래 탭바 · 누르기 쉬운 크기)만 다르다.
export const M = '/m'
const KEY = 'geuryeobom:layout' // 'pc' | 'm' — 사용자가 직접 고른 화면

export const onMobileRoute = (path: string) => path === M || path.startsWith(M + '/')
const toPc = (path: string) => path.slice(M.length) || '/'
// 관리자 화면 · 서버 파일은 PC판으로만 연다
const pcOnly = (path: string) => /^\/(admin|api|licenses)/.test(path)

/** 지금 주소에서 옮겨 갈 주소. 그대로면 null */
export function layoutTarget(path: string, touch: boolean, pref: string | null): string | null {
  if (onMobileRoute(path)) return pcOnly(toPc(path)) ? toPc(path) : null
  if (pcOnly(path) || pref === 'pc') return null
  return pref === 'm' || touch ? M + (path === '/' ? '' : path) : null
}

function readPref() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

/** 첫 화면 전에 한 번: 필요하면 다른 화면으로 옮기고 true */
export function routeByDevice(): boolean {
  const touch = matchMedia('(pointer: coarse)').matches
  const to = layoutTarget(location.pathname, touch, readPref())
  if (to === null) return false
  location.replace(to + location.search + location.hash)
  return true
}

export const isMobile = () => onMobileRoute(location.pathname)
export const canUseMobile = () => matchMedia('(pointer: coarse)').matches || readPref() === 'pc'

/** ‘PC 화면으로 보기’ · ‘모바일 화면으로 보기’ — 고른 것을 기억하고 같은 화면을 다른 틀로 연다 */
export function switchLayout(to: 'pc' | 'm') {
  try { localStorage.setItem(KEY, to) } catch { /* 기억 못 해도 이번엔 옮겨 간다 */ }
  const path = location.pathname
  const next = to === 'pc' ? toPc(path) : M + (path === '/' ? '' : path)
  location.assign(next + location.search + location.hash)
}
