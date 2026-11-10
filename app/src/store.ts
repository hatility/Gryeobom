import type { LifeEntry, LifeGraph } from './types.ts'

// 로그인하지 않았을 때의 저장소: 이 기기의 localStorage. 로그인하면 api.ts의 remoteRepo를 쓴다.
const KEY = 'geuryeobom:graphs:v1'

/** 그래프 저장소. 이 기기(localRepo)와 내 계정(remoteRepo)이 같은 모양을 가진다. */
export interface Repo {
  remote: boolean
  list(): Promise<LifeGraph[]>
  get(id: string): Promise<LifeGraph | null>
  save(g: LifeGraph): Promise<boolean>
  remove(id: string): Promise<boolean>
}

export const uid = () => crypto.randomUUID()

export function loadAll(): LifeGraph[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeAll(all: LifeGraph[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

export const getGraph = (id: string) => loadAll().find((g) => g.id === id) ?? null

export function saveGraph(g: LifeGraph): boolean {
  return writeAll([...loadAll().filter((x) => x.id !== g.id), g])
}

export function deleteGraph(id: string): boolean {
  return writeAll(loadAll().filter((g) => g.id !== id))
}

const EMPTY_REFLECTION = { feeling: '', why: '', now: '', toPast: '', fromPast: '' }

/** 예전 버전에서 저장한 기록에 새로 생긴 칸을 채운다 (없으면 빈 칸 · 기본 색) */
export function normalizeGraph(g: LifeGraph): LifeGraph {
  return {
    ...g,
    lineColor: g.lineColor ?? 'rose',
    // 예전 기기 저장본에는 없는 칸이 있을 수 있다 (없으면 4단계에서 .trim() 이 깨진다)
    currentReflection: { changed: '', word: '', influence: '', message: '', oneLine: '', ...(g.currentReflection as Partial<LifeGraph['currentReflection']> | undefined) },
    entries: g.entries.map((e) => ({ ...e, reflection: { ...EMPTY_REFLECTION, ...e.reflection } })),
  }
}

export const localRepo: Repo = {
  remote: false,
  list: async () => loadAll().map(normalizeGraph).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  get: async (id) => {
    const g = getGraph(id)
    return g && normalizeGraph(g)
  },
  save: async (g) => saveGraph(g),
  remove: async (id) => deleteGraph(id),
}

export function newGraph(): LifeGraph {
  const now = new Date().toISOString()
  return {
    id: uid(),
    title: '',
    timeScale: 'age',
    startPoint: 0,
    currentPoint: 17,
    visibility: 'private',
    entries: [],
    currentReflection: { changed: '', word: '', influence: '', message: '', oneLine: '' },
    completed: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function newEntry(timePoint: number, emotionScore = 0, title = ''): LifeEntry {
  return {
    id: uid(),
    title,
    timePoint,
    description: '',
    emotionScore,
    emotionLabel: '',
    reflection: { feeling: '', why: '', now: '', toPast: '', fromPast: '' },
    showOnGraph: true,
  }
}

/** 과거 → 현재 순서. 같은 시점이면 적은 순서를 유지한다. */
export const sortEntries = <T extends { timePoint: number }>(entries: T[]) =>
  [...entries].sort((a, b) => a.timePoint - b.timePoint)

/** 그래프에 찍을 점. 범위를 벗어난 순간은 가까운 끝에 놓는다. */
export const graphPoints = (g: LifeGraph, pick: (e: LifeEntry) => boolean = (e) => e.showOnGraph) =>
  g.entries.filter(pick).map((e) => ({ ...e, timePoint: Math.min(g.currentPoint, Math.max(g.startPoint, e.timePoint)) }))

export const graphTitle = (g: { title: string }) => g.title.trim() || '나의 작은 인생 이야기'

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
