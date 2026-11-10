import { useEffect, useState } from 'react'
import { siteConfig, type SiteConfig } from './api'
import type { Flag } from './flags'

/** 이 묶음이 켜졌는지: 개발 테스트 서버는 늘, 정식은 관리자 ‘실험 기능 스위치’ 에서 켠 것만. any = 하나라도 */
export const labOn = (c: SiteConfig, key: Flag | 'any') => !!c.dev || (key === 'any' ? !!c.flags?.length : !!c.flags?.includes(key))

/** 실험 기능이 켜졌는지 (묶음: src/flags.ts) */
export function useLabs(key: Flag | 'any') {
  const [on, setOn] = useState(false)
  useEffect(() => {
    siteConfig().then((c) => setOn(labOn(c, key)))
  }, [key])
  return on
}

/** 내 기록 모두 내려받기 (JSON 파일 하나) */
export async function downloadMyData() {
  const res = await fetch('/api/me/export', { credentials: 'same-origin' })
  if (!res.ok) throw new Error('내려받지 못했어요. 잠시 뒤에 다시 해 볼까요?')
  const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `그려봄-내기록-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** 표를 CSV 로 (엑셀에서 한글이 깨지지 않게 BOM) */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** 모임 소식을 이 기기에서 읽었는지 (소식 시각으로) */
const NEWS_KEY = (id: string) => `geuryeobom:news:${id}`
export function newsSeen(id: string, at: string) {
  try { return localStorage.getItem(NEWS_KEY(id)) === at } catch { return false }
}
export function markNewsSeen(id: string, at: string) {
  try { localStorage.setItem(NEWS_KEY(id), at) } catch { /* 기억 못 하면 다음에도 새 소식으로 */ }
}
