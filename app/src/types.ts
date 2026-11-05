/** age: 나이, year: 연도, month: 월 (연도×12 + 0~11, 소수는 그 달의 몇째 주) */
export type TimeScale = 'age' | 'year' | 'month'
export type Visibility = 'private' | 'link'
export type LineColor = 'rose' | 'sage' | 'sand' | 'lilac'

export interface EntryReflection {
  feeling: string
  why: string
  now: string
  toPast: string
  /** 그때의 내가 지금의 나에게 (0.10.0~) */
  fromPast: string
}

export interface LifeEntry {
  id: string
  title: string
  timePoint: number
  description: string
  emotionScore: number // -5 ~ +5, 그때의 주관적인 마음
  emotionLabel: string
  reflection: EntryReflection
  showOnGraph: boolean
}

export interface CurrentReflection {
  changed: string
  word: string
  influence: string
  message: string
  oneLine: string
}

export interface LifeGraph {
  id: string
  title: string
  timeScale: TimeScale
  /** month일 때만: 최근 12개월인지, 올해(1월~이번 달)인지 */
  monthRange?: 'recent12' | 'thisYear'
  /** 내 선의 색 (0.10.0~, 없으면 rose) */
  lineColor?: LineColor
  startPoint: number
  currentPoint: number
  visibility: Visibility
  /** ‘이 모임에서 그리기’로 시작한 그래프의 모임 (0.13.0~). 완성하면 그 모임에 저절로 나눠지고, 늘 ‘함께 나누기’다 */
  groupId?: string
  entries: LifeEntry[]
  currentReflection: CurrentReflection
  /** 미래의 나에게 쓴 편지 (0.15.0~). openAt 이 지나야 열린다. 어디에도 나가지 않는다. */
  futureLetter?: { text: string; openAt: string; writtenAt: string }
  /** 같은 기간을 다시 그린 것이면 처음 그린 그래프 id (그 선을 흐리게 겹쳐 본다) */
  redrawOf?: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

/** 모임장이 미리 정해 둔 ‘나의 시간’. 초대받은 사람은 이걸 바탕으로 그린다 (0.12.0~) */
export interface GroupPreset {
  choice: 'age' | 'year' | 'recent12' | 'thisYear'
  /** age · year 의 시작 */
  start: number
  /** age: 지금 나이 기본값(각자 바꿀 수 있음) · year: 끝 연도 · recent12: 마지막 달(연도×12 + 0~11) */
  end: number
  /** 그래프 이름 (비우면 각자 정함) */
  title: string
}

/** 그래프에 그릴 점 하나. 개인 기록과 공유 기록이 함께 쓴다. */
export interface GraphPoint {
  id: string
  title: string
  timePoint: number
  emotionScore: number
  emotionLabel?: string
  description?: string
}
