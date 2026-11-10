// 보기 설정: 화면 밝기(자동 · 밝게 · 늦은 밤)와 글자 크기. 이 기기에만 저장한다.
import { useEffect, useState } from 'react'
import { isQuietHour, seasonOf } from './content.ts'

export type Theme = 'auto' | 'light' | 'dark'
export type TextSize = 'sm' | 'md' | 'lg'
/** quiet: 밤 10시 ~ 새벽 5시엔 조용한 화면 (움직임을 멈추고 더 어둡고 잔잔하게) */
export interface View { theme: Theme; text: TextSize; quiet: boolean; /** 쉬운 말로 묻기 (실험) */ easy: boolean }

const KEY = 'geuryeobom:view:v1'

export function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      theme: ['auto', 'light', 'dark'].includes(v.theme) ? v.theme : 'auto',
      text: ['sm', 'md', 'lg'].includes(v.text) ? v.text : 'md',
      quiet: v.quiet !== false,
      easy: v.easy === true,
    }
  } catch {
    return { theme: 'auto', text: 'md', quiet: true, easy: false }
  }
}

/** 자동이면: 기기가 어두운 화면이거나, 밤 9시 ~ 새벽 5시면 늦은 밤 */
export function resolveTheme(theme: Theme, hour = new Date().getHours()): 'light' | 'dark' {
  if (theme !== 'auto') return theme
  const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return systemDark || hour >= 21 || hour < 5 ? 'dark' : 'light'
}

export function applyView(v: View) {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(v.theme)
  root.dataset.text = v.text
  root.dataset.season = seasonOf()
  // 조용한 시간: 밝게로 고정해 둔 사람은 건드리지 않는다
  const quiet = v.quiet && v.theme !== 'light' && isQuietHour()
  if (quiet) {
    root.dataset.theme = 'dark'
    root.dataset.quiet = '1'
  } else delete root.dataset.quiet
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', root.dataset.theme === 'dark' ? '#1f1b19' : '#FFF9F3')
}

export function saveView(v: View) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* 저장이 막혀도 이번 화면에는 적용된다 */
  }
  applyView(v)
  window.dispatchEvent(new Event('geuryeobom:view'))
}

/** 쉬운 말로 묻기가 켜졌는지 (보기 설정을 바꾸면 바로 따라온다) */
export function useEasy() {
  const [easy, setEasy] = useState(() => loadView().easy)
  useEffect(() => {
    const f = () => setEasy(loadView().easy)
    window.addEventListener('geuryeobom:view', f)
    return () => window.removeEventListener('geuryeobom:view', f)
  }, [])
  return easy
}
