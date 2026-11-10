import type { EntryReflection, CurrentReflection, GroupPreset, LifeGraph, LineColor, TimeScale } from './types.ts'

export const STEPS = [
  { name: '나의 시간', en: 'MY TIME', whisper: '천천히 떠올려 봐도 괜찮아요.' },
  { name: '기억에 남는 순간', en: 'MOMENTS & MY LINE', whisper: '기억나는 순간을 적고, 점을 옮겨 나만의 선을 그려요.' },
  { name: '그때의 마음', en: 'THAT MOMENT', whisper: '떠오르는 만큼만 적어도 충분해요.' },
  { name: '지금의 나', en: 'ME, NOW', whisper: '지금의 나를 조금 더 알아가요.' },
]

export const MOMENT_EXAMPLES = [
  '새로운 친구를 만났던 날',
  '처음 무언가를 해냈던 순간',
  '속상했던 일',
  '누군가에게 도움을 받았던 순간',
  '진로를 고민했던 시간',
  '혼자 버텨낸 시기',
  '새로운 곳으로 떠났던 날',
]

/** 모임 응원은 정해진 말만. 자유 글은 상처가 되는 말이 오갈 수 있어 열어두지 않는다. */
export const CHEERS = ['응원해요', '공감해요', '고마워요', '함께할게요'] as const

/** 마음 색: 오늘의 한 줄에 고르는 오늘의 색. 달력과 연말 돌아보기를 물들인다. */
export const MOOD_COLORS = [
  { key: 'sun', name: '햇살', hex: '#F2C46D' },
  { key: 'peach', name: '설렘', hex: '#EFA38E' },
  { key: 'ember', name: '뜨거움', hex: '#D9776A' },
  { key: 'leaf', name: '잔잔', hex: '#9EC5AE' },
  { key: 'sky', name: '맑음', hex: '#94BEDF' },
  { key: 'lilac', name: '몽글', hex: '#C3AEE2' },
  { key: 'cloud', name: '흐림', hex: '#B5ACA5' },
  { key: 'night', name: '깊음', hex: '#6D7EA8' },
] as const
export const moodOf = (k?: string) => MOOD_COLORS.find((c) => c.key === k)

/** 조용한 시간: 밤 10시 ~ 새벽 5시 */
export const isQuietHour = (hour = new Date().getHours()) => hour >= 22 || hour < 5

export const EMOTIONS = ['설렘', '기쁨', '뿌듯함', '편안함', '고마움', '그리움', '담담함', '속상함', '외로움', '불안함', '화남', '복잡함']

export const ENTRY_QUESTIONS: { key: Exclude<keyof EntryReflection, 'extra'>; q: string; placeholder: string }[] = [
  { key: 'feeling', q: '그때 나는 어떤 기분이었나요?', placeholder: '단어 하나여도 좋아요' },
  { key: 'why', q: '그 순간이 기억에 남는 이유는 무엇일까요?', placeholder: '떠오르는 만큼만 적어봐요' },
  { key: 'now', q: '지금 돌아보면 어떤 생각이 드나요?', placeholder: '그때와 지금은 조금 다를 수도 있어요' },
  { key: 'toPast', q: '그때의 나에게 한마디를 건넨다면?', placeholder: '“그때의 나야, …”' },
  { key: 'fromPast', q: '그때의 나는 지금의 나에게 뭐라고 할까요?', placeholder: '“지금의 나야, …”' },
]

type EntryQuestion = (typeof ENTRY_QUESTIONS)[number]
/** 그때의 마음 질문 묶음 (실험). 칸(key)은 같고 묻는 말만 다르다 → 바꿔도 적은 글은 그대로 */
export const QUESTION_SETS: Record<'basic' | 'career' | 'relation' | 'school', { name: string; questions: EntryQuestion[] }> = {
  basic: { name: '기본', questions: ENTRY_QUESTIONS },
  career: {
    name: '진로',
    questions: [
      { key: 'feeling', q: '그때 나는 무엇이 되고 싶었나요?', placeholder: '막연해도 괜찮아요' },
      { key: 'why', q: '그 순간이 내 꿈이나 진로에 어떤 영향을 주었나요?', placeholder: '작은 영향도 좋아요' },
      { key: 'now', q: '지금 돌아보면 그때 무엇을 배웠을까요?', placeholder: '그때는 몰랐던 것도 괜찮아요' },
      { key: 'toPast', q: '진로를 고민하던 그때의 나에게 한마디?', placeholder: '“그때의 나야, …”' },
      { key: 'fromPast', q: '그때의 나는 지금의 나에게 뭐라고 할까요?', placeholder: '“지금의 나야, …”' },
    ],
  },
  relation: {
    name: '관계',
    questions: [
      { key: 'feeling', q: '그때 내 곁에는 누가 있었나요?', placeholder: '이름 대신 ‘친구’, ‘가족’ 이라고 적어도 돼요' },
      { key: 'why', q: '그 사람(들)과의 일이 왜 기억에 남을까요?', placeholder: '떠오르는 만큼만' },
      { key: 'now', q: '지금 그 관계를 돌아보면 어떤 마음이 드나요?', placeholder: '고마움도, 아쉬움도 괜찮아요' },
      { key: 'toPast', q: '그때의 나에게, 혹은 그 사람에게 한마디?', placeholder: '보내지 않는 말이에요' },
      { key: 'fromPast', q: '그때의 나는 지금의 나에게 뭐라고 할까요?', placeholder: '“지금의 나야, …”' },
    ],
  },
  school: {
    name: '학교생활',
    questions: [
      { key: 'feeling', q: '그때 학교에서 나는 어떤 모습이었나요?', placeholder: '조용한, 바쁜, 웃긴 …' },
      { key: 'why', q: '그 일이 학교생활에서 특별했던 이유는?', placeholder: '수업, 쉬는 시간, 동아리 …' },
      { key: 'now', q: '지금의 학교생활과 비교하면 어떤가요?', placeholder: '달라진 것, 그대로인 것' },
      { key: 'toPast', q: '그때 교실에 있던 나에게 한마디?', placeholder: '“그때의 나야, …”' },
      { key: 'fromPast', q: '그때의 나는 지금의 나에게 뭐라고 할까요?', placeholder: '“지금의 나야, …”' },
    ],
  },
}
/** 이 그래프의 그때의 마음 질문들 */
/** 이 순간에 쓰는 질문 묶음 이름 (순간마다 고른 것 > 그래프의 것 > 기본) */
export const setOf = (g: { questionSet?: string }, e: { questionSet?: string }) => (e.questionSet ?? g.questionSet ?? 'basic') as keyof typeof QUESTION_SETS
/** 이 순간의 질문 (순간마다 고른 묶음이 있으면 그것) */
export const questionsFor = (g: { questionSet?: string }, e: { questionSet?: string }) => QUESTION_SETS[setOf(g, e)]?.questions ?? ENTRY_QUESTIONS
/** 나이로 어울리는 묶음 추천: 19살까지 학교생활 · 39살까지 진로 · 그 뒤는 기본 */
export const setByAge = (age: number): 'basic' | 'career' | 'school' => (age < 20 ? 'school' : age < 40 ? 'career' : 'basic')
export const questionsOf = (g: { questionSet?: string }) => QUESTION_SETS[(g.questionSet as keyof typeof QUESTION_SETS) ?? 'basic']?.questions ?? ENTRY_QUESTIONS

/** ‘지금의 나를 표현하는 단어’ 가 막막할 때 눌러 고르는 카드 (실험) */
export const WORD_CARDS = ['자라는 중', '조용한 단단함', '천천히 가는 사람', '호기심 많은', '다정한', '버티는 중', '새로 시작하는', '웃음 많은', '생각이 깊은', '용기 내는 중', '나를 알아가는 중', '흔들려도 괜찮은', '꿈꾸는', '따뜻한', '솔직한', '쉬어 가는 중']

export const NOW_QUESTIONS: { key: keyof CurrentReflection; q: string; placeholder: string; short?: boolean }[] = [
  { key: 'changed', q: '예전과 비교해 달라진 점이 있나요?', placeholder: '작은 변화도 괜찮아요' },
  { key: 'word', q: '지금의 나를 가장 잘 표현하는 단어는 무엇인가요?', placeholder: '예) 자라는 중, 조용한 단단함', short: true },
  { key: 'influence', q: '지금의 나에게 영향을 준 순간이 있나요?', placeholder: '그래프 속 순간이어도, 아니어도 좋아요' },
  { key: 'message', q: '지금의 나에게 해주고 싶은 말이 있나요?', placeholder: '“여기까지 오느라 수고했어.”' },
  { key: 'oneLine', q: '한 문장으로 지금의 나를 표현한다면?', placeholder: '예) 나는 천천히, 나만의 속도로 자라고 있다.', short: true },
]

/**
 * 나이 · 연도의 시점은 소수로 한 달까지 담는다. whole = 몇 살 · 몇 년, part = 그 안의 언제쯤.
 *   나이: part 0 = 그냥 그 나이, 1~11 = N개월   (3살 6개월 = 3 + 6/12)
 *   연도: part 0 = 그냥 그 해,   1~12 = N월     (2019년 5월 = 2019 + 4/12, 1월만 2019.001 — ‘그냥 그 해’와 구별하려고)
 *   월:   part 0 = 그냥 그 달,   1~4 = N째 주   (셋째 주 = 달 + 2/4, 첫째 주만 달 + 0.001)
 */
/*   시각(hour · 실험): part 0 = 정각, 1~5 = 10분 · 20분 … 50분 (14시 30분 = 시각 + 3/6) */
const PER: Record<TimeScale, number> = { age: 12, year: 12, month: 4, hour: 6 }
export const WEEKS = ['', '첫째 주', '둘째 주', '셋째 주', '넷째 주']
export function timeParts(scale: TimeScale, t: number): { whole: number; part: number } {
  const whole = Math.floor(t + 1e-6)
  const f = t - whole
  if (f < 1e-6) return { whole, part: 0 }
  const k = Math.min(PER[scale] - 1, Math.round(f * PER[scale]))
  return { whole, part: scale === 'age' || scale === 'hour' ? k : k + 1 }
}
export function fromParts(scale: TimeScale, whole: number, part: number): number {
  if (!part) return whole
  if (scale === 'age' || scale === 'hour') return whole + part / PER[scale]
  return part === 1 ? whole + 0.001 : whole + (part - 1) / PER[scale]
}

/* 시각: 정수 = Date.UTC(연, 월, 일, 시) / 3_600_000 (벽시계 그대로 · 시간대 없음) */
const HOUR = 3_600_000
const hourDate = (t: number) => new Date(Math.floor(t + 1e-6) * HOUR)
const hm = (t: number) => {
  const { whole, part } = timeParts('hour', t)
  const h = ((whole % 24) + 24) % 24
  return part ? `${h}시 ${part * 10}분` : `${h}시`
}
const md = (t: number) => `${hourDate(t).getUTCMonth() + 1}월 ${hourDate(t).getUTCDate()}일`
const sameDay = (a: number, b: number) => Math.floor(a / 24 + 1e-9) === Math.floor(b / 24 + 1e-9)
/** <input type="datetime-local"> 값 ↔ 시각 */
export function hourOf(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) / HOUR + Math.round(+m[5] / 10) / 6 : null
}
export function hourInput(t: number): string {
  const { whole, part } = timeParts('hour', t)
  return `${new Date(whole * HOUR).toISOString().slice(0, 13)}:${String(part * 10).padStart(2, '0')}`
}
/** 오늘 h시 (벽시계) */
export const todayAt = (h: number, d = new Date()) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h) / HOUR
/** <input type="month"> 값 ↔ 달 */
export const monthOf = (s: string) => (/^\d{4}-\d{2}$/.test(s) ? +s.slice(0, 4) * 12 + +s.slice(5) - 1 : null)
export const monthInput = (t: number) => `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`

/** span: 그래프의 [시작, 끝]. 시각이면 하루 안의 기간은 ‘14시 30분’, 여러 날이면 ‘11월 8일 14시’ */
export function timeLabel(scale: TimeScale, t: number, span?: [number, number]): string {
  if (scale === 'hour') return span && sameDay(span[0], span[1]) ? hm(t) : `${md(t)} ${hm(t)}`
  const { whole, part } = timeParts(scale, t)
  if (scale === 'month') return part ? `${(whole % 12) + 1}월 ${WEEKS[part]}` : `${(whole % 12) + 1}월`
  if (scale === 'age') return part ? `${whole}살 ${part}개월` : `${whole}살`
  return part ? `${whole}년 ${part}월` : `${whole}년`
}

export const monthIndex = (d = new Date()) => d.getFullYear() * 12 + d.getMonth()
export const monthFull = (t: number) => `${Math.floor(t / 12)}년 ${(t % 12) + 1}월`

/** 결과 화면 · 이미지에 쓰는 기간 설명 */
export function rangeLabel(scale: TimeScale, start: number, end: number): string {
  if (scale === 'month') return `${monthFull(start)}부터 ${monthFull(end)}까지, ${end - start + 1}개월`
  if (scale === 'hour') return `${hourDate(start).getUTCFullYear()}년 ${md(start)} ${hm(start)}부터 ${sameDay(start, end) ? hm(end) : `${md(end)} ${hm(end)}`}까지`
  return `${timeLabel(scale, start)}부터 지금까지`
}

/** 그릴 수 있는 기간인지: 달은 같은 달도 되고 36개월까지, 시각은 14일까지 */
export function rangeValid(g: { timeScale: TimeScale; startPoint: number; currentPoint: number }): boolean {
  const span = g.currentPoint - g.startPoint
  if (g.timeScale === 'month') return span >= 0 && span <= 35
  if (g.timeScale === 'hour') return span > 0 && span <= 336
  return span > 0
}
/** 끝이 ‘지금’ 인지 (눈금에 ‘지금’ 이라 쓸지) */
export const endsNow = (scale: TimeScale, end: number) => scale === 'age' || scale === 'year' || (scale === 'month' && end === monthIndex())

/** 점수를 평가가 아닌 '마음의 결'로 읽어 준다. */
export function scoreWord(s: number): string {
  if (s >= 4) return '아주 환했어요'
  if (s >= 2) return '환했어요'
  if (s >= 1) return '조금 환했어요'
  if (s === 0) return '잔잔했어요'
  if (s >= -1) return '조금 무거웠어요'
  if (s >= -3) return '무거웠어요'
  return '많이 무거웠어요'
}

export const signed = (s: number) => (s > 0 ? `+${s}` : `${s}`)

/** 시간대(시작 시각)별 표현. 계절 뒤에 붙는다: ‘가을 늦은 밤’ */
const TIME_WORDS: [number, string[]][] = [
  [0, ['고요한 새벽', '깊은 새벽', '조용한 새벽']],
  [5, ['이른 아침', '막 깨어난 아침', '새벽빛 아침']],
  [8, ['맑은 아침', '상쾌한 아침', '햇살 드는 아침']],
  [11, ['볕 좋은 한낮', '느긋한 한낮', '환한 한낮']],
  [14, ['조용한 오후', '나른한 오후', '따스한 오후']],
  [17, ['해 질 녘', '노을 지는 저녁', '저녁 무렵']],
  [19, ['포근한 저녁', '하루를 닫는 저녁', '고요한 저녁']],
  [21, ['늦은 밤', '별이 뜬 밤', '고요한 밤']],
]
const MEET_WORDS = ['나를 만나는 작은 시간', '나에게 말을 거는 시간', '지나온 길을 돌아보는 시간', '내 마음을 들여다보는 시간', '나를 천천히 읽는 시간', '나의 선을 그려 보는 시간']

/** 1월 1일 = 1 */
const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000)

/** 첫 줄 인사: 계절 + 시간대 + 문구. 날짜마다 표현이 바뀐다 → ‘가을 늦은 밤, 나를 만나는 작은 시간’ */
export function greeting(d = new Date()): string {
  const day = dayOfYear(d)
  const words = TIME_WORDS.filter(([from]) => d.getHours() >= from).pop()![1]
  return `${SEASON_NAME[seasonOf(d.getMonth() + 1)]} ${words[day % words.length]}, ${MEET_WORDS[day % MEET_WORDS.length]}`
}

/** 받침에 맞춰 '이/가' 고르기: ‘전학’이, ‘여름 캠프’가 */
export function iga(word: string): string {
  const code = word.trim().charCodeAt(word.trim().length - 1) - 0xac00
  if (code < 0 || code > 11171) return '이(가)'
  return code % 28 ? '이' : '가'
}

/** 받침에 맞춰 '을/를': ‘전학’을, ‘여름 캠프’를 */
export function eul(word: string): string {
  const code = word.trim().charCodeAt(word.trim().length - 1) - 0xac00
  if (code < 0 || code > 11171) return '을(를)'
  return code % 28 ? '을' : '를'
}

/** 오늘의 질문 — 날마다 하나씩. 미래 계획이 아니라 지나온 시간과 지금의 나에 대한 질문만. */
export const DAILY_QUESTIONS = [
  '요즘 나를 웃게 한 건 뭐였나요?',
  '최근에 고마웠던 사람이 있나요?',
  '어릴 때 좋아했던 놀이는 뭐였나요?',
  '요즘 자주 듣는 노래가 있나요?',
  '오늘 나에게 수고했다고 말해 준다면?',
  '처음으로 혼자 해 본 일은 뭐였나요?',
  '나를 편하게 해 주는 곳은 어디인가요?',
  '최근에 용기 냈던 순간이 있나요?',
  '예전의 나와 달라진 점 하나는?',
  '기억에 남는 선생님이 있나요?',
  '오래 마음에 남은 한마디가 있나요?',
  '최근에 새로 알게 된 나의 모습은?',
  '가장 오래 간직한 물건은 뭐예요?',
  '요즘 마음이 편해지는 시간은 언제예요?',
  '어릴 적 나에게 해 주고 싶은 말은?',
  '최근에 잘 견뎌낸 일이 있나요?',
  '나를 닮은 계절은 언제인가요?',
  '요즘 가장 자주 느끼는 감정은?',
  '누군가를 도와줬던 기억이 있나요?',
  '지금의 나를 색으로 표현한다면?',
  '최근에 마음이 놓였던 순간은?',
  '좋아하는 냄새에 얽힌 기억이 있나요?',
  '한동안 잊고 지낸 즐거움이 있나요?',
  '오늘 하루를 한 단어로 말한다면?',
  '나를 웃게 하는 사람은 누구인가요?',
  '요즘 스스로 대견했던 일은?',
  '비 오는 날 떠오르는 기억이 있나요?',
  '최근에 나를 위해 한 일은?',
  '처음 친구가 된 날이 기억나나요?',
  '요즘 즐겨 먹는 음식은 뭐예요?',
  '최근에 크게 웃었던 일은?',
  '나만 아는 작은 행복이 있나요?',
  '오늘 가장 좋았던 순간은?',
  '어릴 때 꿈꾸던 건 뭐였나요?',
  '요즘 나에게 힘이 되는 말은?',
  '최근에 마음이 따뜻해졌던 일은?',
  '기억에 남는 생일이 있나요?',
  '좋아하는 하늘의 모습은?',
  '요즘 푹 빠져 있는 것이 있나요?',
  '최근에 칭찬받았던 일은?',
  '처음 해 보고 신기했던 일은?',
  '누군가와 함께 걸었던 길이 기억나나요?',
  '내가 좋아하는 나의 모습은?',
  '요즘 자주 가는 곳은 어디예요?',
  '실수했지만 괜찮았던 일이 있나요?',
  '오래된 사진 속 나는 어떤 모습인가요?',
  '요즘 마음에 드는 단어가 있나요?',
  '혼자 있을 때 주로 뭘 하나요?',
  '최근에 새로 시작한 일이 있나요?',
  '잠들기 전 자주 떠오르는 생각은?',
  '기억에 남는 여행이나 나들이는?',
  '가장 좋아하는 계절의 한 장면은?',
  '포기하지 않고 끝까지 해낸 일은?',
  '나를 이해해 준 사람이 있었나요?',
  '요즘 나를 설레게 하는 건?',
  '어릴 때 무서워했던 것은 뭐였나요?',
  '지금은 괜찮아진 걱정이 있나요?',
  '최근에 배운 것 중 기억나는 건?',
  '좋아하는 책이나 이야기가 있나요?',
  '요즘 나의 하루는 어떤 날씨 같나요?',
  '고맙다고 말하지 못한 일이 있나요?',
  '최근에 나를 놀라게 한 일은?',
  '마음이 복잡할 때 나는 무엇을 하나요?',
  '좋아하는 소리가 있나요?',
  '처음으로 뿌듯했던 기억은?',
  '친구에게 배운 좋은 것이 있나요?',
  '요즘 감사한 작은 일 하나는?',
  '어릴 적 살던 곳에서 떠오르는 풍경은?',
  '지금 내 자리에서 가장 아끼는 물건은?',
  '최근에 오래 바라본 것이 있나요?',
  '나를 한 문장으로 소개한다면?',
  '요즘 마음이 쓰이는 일이 있나요?',
  '최근에 누군가와 나눈 좋은 대화는?',
  '기억에 남는 첫눈이 있나요?',
  '내가 잘하는 작은 일 하나는?',
  '요즘 기다려지는 시간은 언제예요?',
  '최근에 마음껏 쉬었던 날은?',
  '오래 못 본 사람 중 떠오르는 사람은?',
  '어릴 때 즐겨 보던 만화나 영화는?',
  '오늘 본 것 중 기억에 남는 건?',
  '다시 가 보고 싶은 장소가 있나요?',
  '요즘 나에게 가장 필요한 건 뭘까요?',
  '나를 위로해 준 노래가 있나요?',
  '최근에 솔직하게 말했던 순간은?',
  '예전엔 몰랐지만 지금은 아는 것은?',
  '좋아하는 간식에 얽힌 기억은?',
  '최근에 누군가를 응원했던 일은?',
  '계절이 바뀔 때 떠오르는 기억은?',
  '나만의 기분 전환 방법은?',
  '최근에 손으로 만든 것이 있나요?',
  '요즘 곁에 있으면 편한 사람은?',
  '기억에 남는 하루를 하나 고른다면?',
  '지금 떠오르는 고마운 순간은?',
  '처음 학교에 갔던 날이 기억나나요?',
  '요즘 가장 많이 웃는 시간은?',
  '내가 좋아하는 우리 동네의 모습은?',
  '생각을 바꿔서 잘된 일이 있나요?',
  '오늘의 나에게 해 주고 싶은 칭찬은?',
  '올해 가장 따뜻했던 순간은?',
  '지금 이 순간 드는 생각은?',
]

/** 잠들기 전에 어울리는 질문 (조용한 시간에만) — 무겁지 않게, 하루를 내려놓는 쪽으로 */
export const NIGHT_QUESTIONS = [
  '오늘 하루, 가장 고마웠던 순간은?',
  '오늘 나에게 가장 잘했다고 말해 주고 싶은 것은?',
  '오늘 마음에 남은 장면 하나는?',
  '내일의 나에게 한마디 건넨다면?',
  '오늘 내려놓고 싶은 걱정 하나는?',
  '오늘 들었던 말 중 기억에 남는 것은?',
  '오늘 나를 웃게 한 작은 일은?',
  '지금 이 밤, 마음은 어떤 날씨인가요?',
  '오늘 하루를 색 하나로 칠한다면?',
  '오늘 수고한 나에게 해 주고 싶은 말은?',
  '오늘 누군가에게 고마웠던 일이 있나요?',
  '오늘 가장 편안했던 시간은 언제였나요?',
  '잠들기 전 떠오르는 얼굴이 있나요?',
  '오늘 새로 알게 된 것이 있나요?',
  '오늘의 나를 한 단어로 말한다면?',
  '오늘 하루 중 다시 보고 싶은 장면은?',
]

export function todayQuestion(d = new Date()): string {
  if (isQuietHour(d.getHours())) return NIGHT_QUESTIONS[dayOfYear(d) % NIGHT_QUESTIONS.length]
  return DAILY_QUESTIONS[dayOfYear(d) % DAILY_QUESTIONS.length]
}

/** 힘들 때 기댈 곳 (청소년상담 1388: 24시간, 전화 · 문자 · 카카오톡) */
export const HELPLINE = { label: '청소년상담 1388', tel: '1388', note: '24시간 · 문자 #1388' }

/** 감정 단어 풀이 — 고른 감정 아래에 한 줄로. 9살도 자기 마음에 이름을 붙이기 쉽게. */
export const EMOTION_NOTES: Record<string, string> = {
  설렘: '무언가를 기다리며 두근거리는 마음',
  기쁨: '밝고 즐거워서 웃음이 나는 마음',
  뿌듯함: '해낸 일이 스스로 자랑스러운 마음',
  편안함: '걱정 없이 느긋하고 놓이는 마음',
  고마움: '누군가에게 감사한 마음',
  그리움: '다시 보고 싶은 마음',
  담담함: '크게 흔들리지 않고 조용한 마음',
  속상함: '마음이 아프고 서운한 마음',
  외로움: '혼자 남은 것 같은 마음',
  불안함: '어떻게 될지 몰라 조마조마한 마음',
  화남: '억울하거나 답답해서 뜨거워진 마음',
  복잡함: '여러 마음이 한꺼번에 섞인 마음',
}

/** 내 선의 색. 평가가 아니라 취향 — 어떤 색이든 같은 무게. */
export const LINE_COLORS: { key: LineColor; label: string; color: string }[] = [
  { key: 'rose', label: '노을', color: '#d99082' },
  { key: 'sage', label: '풀잎', color: '#7fa894' },
  { key: 'sand', label: '모래', color: '#c39a5e' },
  { key: 'lilac', label: '라일락', color: '#a08cc4' },
]
export const lineColorOf = (k?: LineColor) => (LINE_COLORS.find((c) => c.key === k) ?? LINE_COLORS[0]).color

/** 계절: 3~5 봄, 6~8 여름, 9~11 가을, 12~2 겨울 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export function seasonOf(month = new Date().getMonth() + 1): Season {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}
export const SEASON_NAME: Record<Season, string> = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' }

/** 다시 찾아온 간격을 다정하게: 9일 → '9일', 21일 → '3주', 70일 → '2달' */
export function sinceLabel(days: number): string {
  if (days < 14) return `${days}일`
  if (days < 60) return `${Math.round(days / 7)}주`
  if (days < 365) return `${Math.round(days / 30)}달`
  return `${Math.round(days / 365)}년`
}

/** 모임장이 정한 나의 시간 → 그래프 범위. ‘올해’는 그리는 날 기준으로 1월~이번 달. */
export function presetRange(p: GroupPreset): Pick<LifeGraph, 'timeScale' | 'monthRange' | 'startPoint' | 'currentPoint'> {
  if (p.choice === 'recent12') return { timeScale: 'month', monthRange: undefined, startPoint: p.end - 11, currentPoint: p.end }
  if (p.choice === 'thisYear') return { timeScale: 'month', monthRange: undefined, startPoint: new Date().getFullYear() * 12, currentPoint: monthIndex() }
  return { timeScale: p.choice, monthRange: undefined, startPoint: p.start, currentPoint: p.end }
}

export function presetLabel(p: GroupPreset): string {
  if (p.choice === 'age') return `나이로 · ${p.start}살부터 지금까지`
  if (p.choice === 'year') return `연도로 · ${p.start}년부터 ${p.end}년까지`
  if (p.choice === 'month') return `달로 · ${monthFull(p.start)}부터 ${monthFull(p.end)}까지`
  if (p.choice === 'hour') return `시간으로 · ${rangeLabel('hour', p.start, p.end)}`
  if (p.choice === 'recent12') return `${monthFull(p.end - 11)}부터 ${monthFull(p.end)}까지, 열두 달`
  return '올해 · 1월부터 이번 달까지'
}

/**
 * 모임장이 정한 질문 (실험)을 덮어씌운다: 글이 있으면 그 글로 바꿔 묻고, '' 이면 그 질문은 뺀다.
 * moments: 비어 있지 않으면 기본 예시 대신
 */
export function withPrompts<Q extends { key: string; q: string }>(qs: Q[], over?: Partial<Record<string, string>>): Q[] {
  if (!over) return qs
  return qs.flatMap((q) => (over[q.key] === undefined ? [q] : over[q.key]!.trim() ? [{ ...q, q: over[q.key]!.trim() }] : []))
}
export const momentExamples = (g: { prompts?: { moments?: string[] } }) => (g.prompts?.moments?.length ? g.prompts.moments : MOMENT_EXAMPLES)

/** 모임장을 위한 진행안 모음 (실험). topic 은 ‘함께 그릴 주제’ 로 바로 정할 수 있다 */
export interface Playbook { key: string; title: string; minutes: number; who: string; topic: string; steps: string[]; tip: string }
export const PLAYBOOKS: Playbook[] = [
  {
    key: 'first', title: '처음 만난 날 — 나를 소개하는 선', minutes: 50, who: '처음 모인 모임 · 모든 나이', topic: '나를 소개하는 세 순간',
    steps: ['인사 · 오늘 할 일 알려 주기 (5분)', '예시 그래프 함께 보기 — ‘예시 보기’ (5분)', '각자 순간 세 개만 적기 (15분)', '둘씩 짝지어 한 순간만 이야기하기 (10분)', '원하는 사람만 모임에 나누고 응원 보내기 (10분)', '‘오늘의 한 줄’ 로 마무리 (5분)'],
    tip: '처음에는 마음 높이를 정확히 정하지 않아도 된다고 꼭 말해 주세요.',
  },
  {
    key: 'proud', title: '처음 해낸 일', minutes: 45, who: '초등 · 중학생', topic: '처음 해낸 일, 그때의 나',
    steps: ['‘처음 해낸 일’ 떠올리기 — 자전거, 혼자 버스 타기 같은 예 (5분)', '순간 적고 마음 높이 고르기 (15분)', '그때의 마음 질문 두 개만 적기 (10분)', '함께 그린 선 보며 비슷한 점 찾기 (10분)', '정리 · 응원 (5분)'],
    tip: '힘들었던 순간을 꼭 적지 않아도 괜찮다고 알려 주세요.',
  },
  {
    key: 'term', title: '이번 학기 돌아보기', minutes: 50, who: '학기 · 활동 마무리', topic: '이번 학기, 나를 웃게 한 순간',
    steps: ['시간 기준을 ‘달로’ 고르고 시작 · 끝 달 정하기 (5분)', '달마다 떠오르는 순간 적기 (15분)', '가장 높았던 · 낮았던 달 이야기하기 (10분)', '‘지금의 나’ 한 문장 쓰기 (10분)', '모임 리포트 함께 보기 (10분)'],
    tip: '끝나면 모임 리포트를 인쇄해 결과 보고에 쓸 수 있어요.',
  },
  {
    key: 'career', title: '진로 — 되고 싶었던 나', minutes: 60, who: '중 · 고등학생 · 청년', topic: '되고 싶었던 나, 지금의 나',
    steps: ['그때의 마음 질문을 ‘진로’ 로 바꾸는 법 알려 주기 (5분)', '꿈이 바뀐 순간들 적기 (15분)', '전환점 하나에 ★ 표시하기 (5분)', '진로 질문에 답하기 (15분)', '미래의 나에게 편지 쓰기 (10분)', '나누고 싶은 사람만 나누기 (10분)'],
    tip: '‘아직 모르겠다’ 도 좋은 답이라고 말해 주세요.',
  },
  {
    key: 'senior', title: '내 인생의 전환점 — 어르신과 함께', minutes: 60, who: '어르신 · 평생학습', topic: '내 인생의 전환점',
    steps: ['글자 크기 · 화면 설정 함께 맞추기 (5분)', '시간 기준을 ‘연도로’ 고르고 인생 구간 띠 정하기 (10분)', '기억나는 순간 적기 — 대신 적어 드려도 좋아요 (20분)', '전환점에 ★ 표시하고 이야기 나누기 (15분)', 'A4 한 장으로 인쇄해 가져가기 (10분)'],
    tip: '종이 활동지로 먼저 적고 나중에 옮겨도 괜찮아요.',
  },
]

/** 쉬운 말로 묻기 (보기 → 쉬운 말). 기본 질문 묶음과 ‘지금의 나’ 질문만 */
export const EASY_Q: Record<string, string> = {
  feeling: '그때 마음이 어땠어요?',
  why: '왜 그런 마음이 들었을까요?',
  now: '지금 보면 어떤 생각이 들어요?',
  toPast: '그때의 나에게 한마디 해 줄래요?',
  fromPast: '그때의 나는 지금의 나에게 뭐라고 할까요?',
  changed: '예전과 달라진 게 있어요?',
  word: '지금의 나를 한 낱말로 말하면?',
  influence: '나를 바꾼 순간이 있었나요?',
  message: '지금의 나에게 하고 싶은 말은?',
  oneLine: '지금의 나를 한 문장으로 말하면?',
}
/** 막막할 때 눌러 넣는 문장 시작 */
export const STARTERS = ['그때 나는 ', '지금 생각해 보면 ', '사실은 ', '그 덕분에 ', '그래도 ']
