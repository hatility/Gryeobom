import type { LifeGraph, LineColor, TimeScale } from './types.ts'
import { graphTitle, sortEntries } from './store.ts'

/**
 * 공유 링크에 담기는 공개용 데이터.
 * 회고(reflection)와 '지금의 나' 기록은 절대 들어가지 않는다.
 * 데이터는 URL의 # 뒤에 담겨 서버로 전송되지 않는다.
 */
export interface SharedGraph {
  v: 1
  title: string
  timeScale: TimeScale
  showTime: boolean
  tone?: LineColor
  startPoint: number
  currentPoint: number
  entries: { title: string; timePoint: number; emotionScore: number; emotionLabel: string; description: string }[]
}

export interface ShareOptions {
  title: string
  entryIds: Set<string>
  descriptions: boolean
  time: boolean
}

export function toShared(g: LifeGraph, o: ShareOptions): SharedGraph {
  const span = Math.max(1, g.currentPoint - g.startPoint)
  return {
    v: 1,
    title: o.title.trim().slice(0, 40),
    timeScale: g.timeScale,
    showTime: o.time,
    tone: g.lineColor,
    startPoint: o.time ? g.startPoint : 0,
    currentPoint: o.time ? g.currentPoint : 100,
    entries: sortEntries(g.entries.filter((e) => o.entryIds.has(e.id))).map((e) => ({
      title: e.title,
      emotionLabel: e.emotionLabel,
      emotionScore: e.emotionScore,
      // 시점을 숨기면 0~100 사이의 상대 위치만 남긴다
      timePoint: o.time ? e.timePoint : Math.round(((e.timePoint - g.startPoint) / span) * 100),
      description: o.descriptions ? e.description : '',
    })),
  }
}

/**
 * 모임에 나눈 그래프의 ‘무엇을 나눌지’. 서버가 이걸 기억해 두었다가, 그래프를 고칠 때마다 모임 글을 다시 만든다.
 * title 이 비면 그래프 제목을, entryIds 가 null 이면 그래프에 보이는 순간 모두를 쓴다 (모임에서 그린 그래프).
 */
export interface PostOptions { title: string; entryIds: string[] | null; descriptions: boolean; time: boolean }

/** 모임에서 그린 그래프가 완성되면 저절로 나눌 때: 보이는 순간 · 시점 · 설명 (회고는 언제나 빠진다) */
export const GROUP_POST: PostOptions = { title: '', entryIds: null, descriptions: true, time: true }

export const postShared = (g: LifeGraph, o: PostOptions): SharedGraph =>
  toShared(g, {
    title: o.title || graphTitle(g),
    entryIds: new Set(o.entryIds ?? g.entries.filter((e) => e.showOnGraph).map((e) => e.id)),
    descriptions: o.descriptions,
    time: o.time,
  })

export function sanitizePostOptions(raw: any): PostOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const ids = raw.entryIds === null ? null : Array.isArray(raw.entryIds) ? raw.entryIds.slice(0, 100).map((x: unknown) => str(x, 64)) : undefined
  if (ids === undefined) return null
  return { title: str(raw.title, 40).trim(), entryIds: ids, descriptions: raw.descriptions === true, time: raw.time === true }
}

export function encodeShared(s: SharedGraph): string {
  let bin = ''
  new TextEncoder().encode(JSON.stringify(s)).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '')
const num = (x: unknown, min: number, max: number, per = 1) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x * per) / per)) : null

/** 링크는 누구나 만들 수 있으므로, 받은 데이터는 모양과 범위를 모두 다시 검증한다. */
export function decodeShared(code: string): SharedGraph | null {
  if (!code || code.length > 30000) return null
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
    return sanitizeShared(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))))
  } catch {
    return null
  }
}

/** 공유 데이터 검증. 링크를 열 때와 서버가 모임 글을 받을 때 같이 쓴다. 정해진 필드 말고는 모두 버린다. */
export function sanitizeShared(raw: any): SharedGraph | null {
  try {
    if (raw?.v !== 1 || !Array.isArray(raw.entries)) return null
    // 월 기준은 연도×12 라서 3만 근처까지 간다
    const startPoint = num(raw.startPoint, 0, 40000)
    const currentPoint = num(raw.currentPoint, 0, 40000)
    // 같을 수도 있다: '올해' 기준을 1월에 그리면 한 달뿐이다
    if (startPoint === null || currentPoint === null || startPoint > currentPoint) return null
    return {
      v: 1,
      title: str(raw.title, 40),
      timeScale: raw.timeScale === 'year' || raw.timeScale === 'month' ? raw.timeScale : 'age',
      showTime: raw.showTime === true,
      ...(['rose', 'sage', 'sand', 'lilac'].includes(raw.tone) ? { tone: raw.tone } : {}),
      startPoint,
      currentPoint,
      entries: raw.entries.slice(0, 60).flatMap((e: Record<string, unknown>) => {
        // 나이 · 연도는 한 달 단위 소수까지 (content.ts timeParts)
        const timePoint = num(e?.timePoint, startPoint, currentPoint, 1000)
        const emotionScore = num(e?.emotionScore, -5, 5)
        if (timePoint === null || emotionScore === null) return []
        return [{ title: str(e.title, 40), timePoint, emotionScore, emotionLabel: str(e.emotionLabel, 12), description: str(e.description, 300) }]
      }),
    }
  } catch {
    return null
  }
}
