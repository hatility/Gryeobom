import { api, type Answer } from './api'
import { useAuth } from './auth'
import { fromParts, monthIndex } from './content'
import type { LifeGraph } from './types'

// 오늘의 질문에 남긴 한 줄. 로그인한 계정에만 남긴다 (1.0.0~, 이 기기에는 저장하지 않는다). 날짜마다 하나.

/** 이 기기의 날짜 (YYYY-MM-DD) */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface Journal {
  list(): Promise<Answer[]>
  /** 비운 글은 지운다 */
  save(a: Answer): Promise<boolean>
}

/** 로그인하지 않았을 때: 읽을 것도 쓸 곳도 없다 */
const none: Journal = { list: async () => [], save: async () => false }

const remote: Journal = {
  list: () => api.answers(),
  save: (a) => api.saveAnswer({ ...a, text: a.text.trim() }).then(() => true, () => false),
}

export const useJournal = () => (useAuth().user ? remote : none)

/** 한 줄을 남긴 날을 그래프의 시점으로 (그래프 기간 밖이면 가장 가까운 끝으로) */
export function momentPoint(g: LifeGraph, day: string): number {
  const d = new Date(`${day}T12:00:00`)
  const t =
    g.timeScale === 'month' ? fromParts('month', monthIndex(d), Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1))
    : g.timeScale === 'year' ? fromParts('year', d.getFullYear(), d.getMonth() + 1)
    : Math.round((g.currentPoint - (Date.now() - d.getTime()) / (365.25 * 86_400_000)) * 12) / 12 // 나이: 지금 나이에서 지난 만큼 빼서
  return Math.min(g.currentPoint, Math.max(g.startPoint, t))
}
