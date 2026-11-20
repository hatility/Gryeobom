/** 이 기기에서 처음이면 true 를 한 번 돌려주고 기억해요 (저장소를 못 쓰면 false — 장면 없이) */
export function firstTime(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return false
    localStorage.setItem(key, '1')
    return true
  } catch { return false }
}
const SEASON_NAME: Record<string, string> = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' }
/** 지난번에 왔을 때와 계절이 달라졌으면 새 계절 이름 (처음 온 사람은 빈 값) */
export function seasonChanged(): string {
  try {
    const now = document.documentElement.dataset.season ?? ''
    const last = localStorage.getItem('gb-season')
    localStorage.setItem('gb-season', now)
    return last && now && last !== now ? SEASON_NAME[now] ?? '' : ''
  } catch { return '' }
}
