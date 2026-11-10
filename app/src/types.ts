/**
 * age: 나이, year: 연도, month: 월 (연도×12 + 0~11, 소수는 그 달의 몇째 주)
 * hour (실험): 시각. 정수 = Date.UTC(연, 월, 일, 시) / 3_600_000 (벽시계 기준 · 시간대 없음), 소수 = 분/60 (10분 단위)
 */
export type TimeScale = 'age' | 'year' | 'month' | 'hour'
export type Visibility = 'private' | 'link'
export type LineColor = 'rose' | 'sage' | 'sand' | 'lilac'

export interface EntryReflection {
  feeling: string
  why: string
  now: string
  toPast: string
  /** 그때의 내가 지금의 나에게 (0.10.0~) */
  fromPast: string
  /** 나만의 질문에 적은 답 (실험 · graph.myQuestions 와 같은 순서) */
  extra?: string[]
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
  /** 내 인생의 전환점 (실험 · 그래프에 별로) */
  turningPoint?: boolean
  /** 이 순간만 다른 질문 묶음 (실험 · 없으면 그래프의 묶음) */
  questionSet?: 'basic' | 'career' | 'relation' | 'school'
}

/** 인생 구간 띠 하나 (실험): 예) 초등학교 7~13 */
export interface LifeStage { label: string; from: number; to: number }

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
  /** 그때의 마음 질문 묶음 (실험 · 없으면 기본) */
  questionSet?: 'career' | 'relation' | 'school'
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
  /** 인생 구간 띠 (실험) */
  stages?: LifeStage[]
  /** 나만의 질문 (실험 · 3개까지). 그때의 마음에 기본 질문과 함께 나온다 */
  myQuestions?: string[]
  /** 모임장이 정한 질문 (실험): 모임에서 그리기 시작할 때 모임의 것을 그대로 옮겨 둔다 (나중에 모임이 바꿔도 이 그래프는 그대로) */
  prompts?: Pick<GroupPrompts, 'moments' | 'reflect' | 'now'>
  completed: boolean
  createdAt: string
  updatedAt: string
}

/** 모임장이 미리 정해 둔 ‘나의 시간’. 초대받은 사람은 이걸 바탕으로 그린다 (0.12.0~) */
export interface GroupPreset {
  /** month: 달로(시작 달 ~ 끝 달) · hour (실험): 시각으로. recent12 · thisYear 는 예전에 저장된 것 (읽기만, 새로는 month) */
  choice: 'age' | 'year' | 'month' | 'hour' | 'recent12' | 'thisYear'
  /** age · year 의 시작 · month: 시작 달(연도×12 + 0~11) · hour: 시작 시각(TimeScale hour 와 같은 수) */
  start: number
  /** age: 지금 나이 기본값(각자 바꿀 수 있음) · year: 끝 연도 · month · recent12: 끝 달 · hour: 끝 시각 */
  end: number
  /** 그래프 이름 (비우면 각자 정함) */
  title: string
}

/** 그때의 마음 질문 칸 · 지금의 나 질문 칸 */
export type ReflectKey = 'feeling' | 'why' | 'now' | 'toPast' | 'fromPast'
export type NowKey = 'changed' | 'word' | 'influence' | 'message' | 'oneLine'

/**
 * 모임장이 정하는 질문 (실험). 칸마다: 값이 없으면 기본 질문, 글이 있으면 그 글로 바꿔 묻고, '' 이면 그 질문은 묻지 않는다.
 * moments: 기억에 남는 순간 예시 (8개까지 · 비우면 기본 예시) · present: 큰 화면 진행의 ‘오늘 할 일’ (8줄까지 · 비우면 진행안/기본)
 */
export interface GroupPrompts {
  moments?: string[]
  reflect?: Partial<Record<ReflectKey, string>>
  now?: Partial<Record<NowKey, string>>
  present?: string[]
}

/** 그래프에 그릴 점 하나. 개인 기록과 공유 기록이 함께 쓴다. */
export interface GraphPoint {
  id: string
  title: string
  timePoint: number
  emotionScore: number
  emotionLabel?: string
  description?: string
  turningPoint?: boolean
}
