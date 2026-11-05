import type { GraphPoint, TimeScale } from './types'
import { sortEntries } from './store'
import { rangeLabel, timeLabel } from './content'

export interface Pt { x: number; y: number }

/**
 * 점들을 지나는 부드러운 곡선. 연필로 이어 그린 느낌.
 * 왼쪽 → 오른쪽으로만 나아가는 곡선(monotone)이라, 점이 가까이 몰려도 선이 뒤로 감기거나 봉우리를 넘치지 않는다.
 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  const f = (n: number) => n.toFixed(1)
  const n = pts.length
  // 구간마다 기울기, 점마다 양옆 기울기의 조화평균 (부호가 바뀌는 봉우리 · 골짜기에서는 평평하게)
  const d = pts.slice(1).map((p, i) => (p.x > pts[i].x ? (p.y - pts[i].y) / (p.x - pts[i].x) : 0))
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])))
  let out = `M${f(pts[0].x)},${f(pts[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1], h = (p2.x - p1.x) / 3
    out += ` C${f(p1.x + h)},${f(p1.y + m[i] * h)} ${f(p2.x - h)},${f(p2.y - m[i + 1] * h)} ${f(p2.x)},${f(p2.y)}`
  }
  return out
}

/**
 * 같은 시기(같은 x)에 찍힌 점들을 옆으로 조금씩 벌린다. 한 줄로 쌓여 선이 위아래로 꺾이지 않게.
 * 화면에서만 벌리고 기록된 시점은 그대로다. 이웃한 점을 넘지 않을 만큼만, 그래프 칸 안에서.
 */
export function spreadSameTime(xy: Pt[], gap: number, lo: number, hi: number): Pt[] {
  const out = xy.map((p) => ({ ...p }))
  for (let i = 0; i < xy.length; ) {
    let j = i
    while (j + 1 < xy.length && Math.abs(xy[j + 1].x - xy[i].x) < 0.5) j++
    const k = j - i + 1
    if (k > 1) {
      const x = xy[i].x
      const room = Math.min(i > 0 ? x - xy[i - 1].x : Infinity, j + 1 < xy.length ? xy[j + 1].x - x : Infinity, hi - lo)
      const g = Math.min(gap, room / k)
      const first = Math.min(Math.max(x - ((k - 1) / 2) * g, lo), hi - (k - 1) * g)
      for (let n = 0; n < k; n++) out[i + n].x = first + n * g
    }
    i = j + 1
  }
  return out
}

/** 그리는 영역. w/h는 전체 크기, l/r/t/b는 여백. */
export interface Frame { w: number; h: number; l: number; r: number; t: number; b: number; start: number; end: number }

export const sx = (f: Frame, t: number) => f.l + ((t - f.start) / Math.max(1, f.end - f.start)) * (f.w - f.l - f.r)
export const sy = (f: Frame, s: number) => f.t + ((5 - s) / 10) * (f.h - f.t - f.b)

/** 화면 좌표 → (시점, 점수). 시점은 1/step 단위(나이 · 연도는 12 = 한 달), 점수는 정수로 맞추고 범위 안에 둔다. */
export function invert(f: Frame, x: number, y: number, step = 1) {
  const t = f.start + ((x - f.l) / (f.w - f.l - f.r)) * (f.end - f.start)
  const s = 5 - ((y - f.t) / (f.h - f.t - f.b)) * 10
  return {
    timePoint: Math.min(f.end, Math.max(f.start, Math.round(t * step) / step)),
    score: Math.min(5, Math.max(-5, Math.round(s))),
  }
}

export function ticks(start: number, end: number, max: number): number[] {
  const step = Math.max(1, Math.ceil((end - start) / max))
  const out: number[] = []
  for (let t = start; t < end; t += step) out.push(t)
  if (out.length > 1 && end - out[out.length - 1] < step / 2) out.pop()
  out.push(end)
  return out
}

/** 이미지 저장: 제목 · 그래프 · 고른 순간의 제목만 담는다. 회고는 넣지 않는다. */
export async function exportImage(opts: {
  title: string; timeScale: TimeScale; start: number; end: number; points: GraphPoint[]; color?: string
  /** false 면 나이 · 연도를 빼고 ‘그때 → 지금’으로만 (시점을 숨기고 나눈 모임 그래프) */
  showTime?: boolean
  /** 제목 위 작은 글씨 (기본 ‘MY LINE · 그려봄’) */
  eyebrow?: string
}): Promise<Blob | null> {
  await document.fonts?.ready
  const pts = sortEntries(opts.points)
  const showTime = opts.showTime !== false
  const W = 1200
  const H = 790 + Math.ceil(pts.length / 2) * 44 + 100
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const sans = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = '"Gowun Batang", "Pretendard Variable", sans-serif'

  ctx.fillStyle = '#FFF9F3'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(149,138,130,0.08)'
  for (let x = 12; x < W; x += 24) for (let y = 12; y < H; y += 24) ctx.fillRect(x, y, 2, 2)

  ctx.fillStyle = '#958A82'; ctx.font = `600 22px ${sans}`
  ctx.fillText(opts.eyebrow ?? 'MY LINE · 그려봄', 80, 110)
  ctx.fillStyle = '#514943'; ctx.font = `700 54px ${sans}`
  ctx.fillText(opts.title, 80, 180)
  ctx.fillStyle = '#958A82'; ctx.font = `28px ${serif}`
  ctx.fillText(`${showTime ? rangeLabel(opts.timeScale, opts.start, opts.end) : '그때부터 지금까지'}, 나만의 선`, 80, 228)

  ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#F0E5DC'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.roundRect(60, 280, W - 120, 440, 28); ctx.fill(); ctx.stroke()
  const f: Frame = { w: W, h: 720, l: 130, r: 130, t: 330, b: 50, start: opts.start, end: opts.end }
  const y0 = sy(f, 0)
  ctx.setLineDash([8, 10]); ctx.strokeStyle = '#E4D6CB'
  ctx.beginPath(); ctx.moveTo(f.l, y0); ctx.lineTo(W - f.r, y0); ctx.stroke(); ctx.setLineDash([])
  ctx.fillStyle = '#958A82'; ctx.font = `22px ${serif}`
  ctx.fillText('환했던 마음', 90, f.t - 12); ctx.fillText('무거웠던 마음', 90, f.h - f.b + 34)

  const xy = spreadSameTime(pts.map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) })), 24, f.l, W - f.r)
  if (xy.length > 1) {
    ctx.strokeStyle = opts.color ?? '#E8A89A'; ctx.lineWidth = 5; ctx.lineCap = 'round'
    ctx.stroke(new Path2D(smoothPath(xy)))
  }
  xy.forEach((p) => {
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = opts.color ?? '#D99082'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  })

  // 아래 목록: **1월** · 일본 여행!  (번호 없이, 시점만 굵게)
  pts.forEach((p, i) => {
    const x = 80 + (i % 2) * 540, y = 790 + Math.floor(i / 2) * 44
    momentLine(ctx, sans, 22, x, y, 500, showTime ? timeLabel(opts.timeScale, p.timePoint) : '', p.title || '이름 없는 순간', 'left')
  })

  ctx.fillStyle = '#958A82'; ctx.font = `26px ${serif}`
  ctx.fillText('지나온 나를 그리고, 지금의 나를 만나다.  — 그려봄', 80, H - 50)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

/**
 * 순간 한 줄: 시점(굵게) · 제목. 넓이를 넘으면 제목을 …으로 줄인다.
 * align 'center' 면 x 를 가운데로 두고 그린다.
 */
function momentLine(ctx: CanvasRenderingContext2D, font: string, size: number, x: number, y: number, max: number, time: string, title: string, align: 'left' | 'center') {
  ctx.textAlign = 'left'
  ctx.fillStyle = '#514943'
  const head = time ? `${time}` : ''
  const sep = time ? ' · ' : ''
  ctx.font = `700 ${size}px ${font}`
  const hw = ctx.measureText(head).width
  ctx.font = `${size}px ${font}`
  const sw = ctx.measureText(sep).width
  let t = title
  while (t.length > 1 && hw + sw + ctx.measureText(t).width > max) t = t.slice(0, -1)
  if (t !== title) t = `${t.trimEnd()}…`
  const total = hw + sw + ctx.measureText(t).width
  let cx = align === 'center' ? x - total / 2 : x
  if (head) {
    ctx.font = `700 ${size}px ${font}`; ctx.fillText(head, cx, y); cx += hw
    ctx.font = `${size}px ${font}`; ctx.fillStyle = '#958A82'; ctx.fillText(sep, cx, y); cx += sw
    ctx.fillStyle = '#514943'
  }
  ctx.font = `${size}px ${font}`; ctx.fillText(t, cx, y)
}

export interface LabelSpot { text: string; dx: number; dy: number }

/**
 * 점 이름표 자리 정하기. 점마다 위 · 아래 · 한 칸 더 위 · 한 칸 더 아래 순서로 빈자리를 찾고,
 * 다른 이름표 · 점과 겹치면 다음 자리로. 둘 곳이 없으면 null(숨김 — 점을 누르면 보인다).
 * 고른 점(keep)은 먼저 자리를 잡는다.
 */
export function layoutLabels(
  pts: { x: number; y: number; title: string; up: boolean }[],
  area: { w: number; top: number; bottom: number },
  maxChars: number,
  keep = -1,
  avoid: { l: number; r: number; t: number; b: number }[] = [], // 비워 둘 곳 (축 글씨 등)
): (LabelSpot | null)[] {
  const textW = (s: string) => [...s].reduce((n, ch) => n + (/[ㄱ-힝]/.test(ch) ? 12.5 : 7), 0)
  const boxes = [...pts.map((p) => ({ l: p.x - 10, r: p.x + 10, t: p.y - 10, b: p.y + 10 })), ...avoid] // 점 자리
  const hit = (a: (typeof boxes)[number]) => boxes.some((o) => o.l < a.r && a.l < o.r && o.t < a.b && a.t < o.b)
  const out: (LabelSpot | null)[] = pts.map(() => null)
  const order = [...pts.keys()]
  if (keep >= 0) order.sort((a, b) => (a === keep ? -1 : b === keep ? 1 : 0))
  for (const i of order) {
    const p = pts[i]
    const chars = [...(p.title || '이름 없는 순간')]
    const text = chars.length > maxChars ? `${chars.slice(0, maxChars).join('').trimEnd()}…` : chars.join('')
    const half = textW(text) / 2 + 4
    const cx = Math.min(Math.max(p.x, half + 2), area.w - half - 2)
    for (const dy of p.up ? [-18, 30, -36, 48] : [30, -18, 48, -36]) {
      const box = { l: cx - half, r: cx + half, t: p.y + dy - 12, b: p.y + dy + 4 }
      if (box.t < area.top || box.b > area.bottom || hit(box)) continue
      boxes.push(box)
      out[i] = { text, dx: cx - p.x, dy }
      break
    }
  }
  return out
}

/**
 * 세로 카드(9:16, 1080×1920): 폰 사진첩에 남기기 좋은 한 장.
 * 제목 · 기간 · 선 · 고른 순간의 이름, 원하면 ‘지금의 나’ 한 문장. 회고는 넣지 않는다.
 */
export async function exportStoryCard(opts: {
  title: string; timeScale: TimeScale; start: number; end: number; points: GraphPoint[]; line?: string; color?: string
}): Promise<Blob | null> {
  await document.fonts?.ready
  const W = 1080, H = 1920
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const sans = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = '"Gowun Batang", "AppleMyungjo", serif'
  const pts = sortEntries(opts.points)
  const center = (text: string, y: number, font: string, color: string) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y)
  }
  /** 한 줄 넓이를 넘으면 줄을 나눠 가운데 정렬로 그린다 */
  const wrap = (text: string, y: number, font: string, color: string, max: number, lh: number) => {
    ctx.font = font
    const lines: string[] = []
    let cur = ''
    for (const word of text.split(' ')) {
      const next = cur ? `${cur} ${word}` : word
      if (ctx.measureText(next).width > max && cur) { lines.push(cur); cur = word } else cur = next
    }
    if (cur) lines.push(cur)
    lines.forEach((l, i) => center(l, y + i * lh, font, color))
    return y + lines.length * lh
  }

  ctx.fillStyle = '#FFF9F3'; ctx.fillRect(0, 0, W, H)
  center('MY LIFE, MY LINE', 220, `600 30px ${sans}`, '#958A82')
  let y = wrap(opts.title, 330, `700 72px ${sans}`, '#514943', W - 200, 92)
  center(rangeLabel(opts.timeScale, opts.start, opts.end), y + 20, `34px ${serif}`, '#958A82')

  // 선
  ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#F0E5DC'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.roundRect(80, 560, W - 160, 640, 40); ctx.fill(); ctx.stroke()
  const f: Frame = { w: W, h: 1200, l: 150, r: 150, t: 640, b: 80, start: opts.start, end: opts.end }
  ctx.setLineDash([10, 12]); ctx.strokeStyle = '#E4D6CB'
  ctx.beginPath(); ctx.moveTo(f.l, sy(f, 0)); ctx.lineTo(W - f.r, sy(f, 0)); ctx.stroke(); ctx.setLineDash([])
  const xy = pts.map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) }))
  if (xy.length > 1) {
    ctx.strokeStyle = opts.color ?? '#E8A89A'; ctx.lineWidth = 7; ctx.lineCap = 'round'
    ctx.stroke(new Path2D(smoothPath(xy)))
  }
  xy.forEach((p) => {
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = opts.color ?? '#D99082'; ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  })

  // 순간 이름 (최대 6개)
  y = 1290
  pts.slice(0, 6).forEach((p) => {
    momentLine(ctx, sans, 34, W / 2, y, W - 240, timeLabel(opts.timeScale, p.timePoint), p.title || '이름 없는 순간', 'center')
    y += 58
  })
  if (opts.line) wrap(`“${opts.line}”`, Math.max(y + 60, 1700), `40px ${serif}`, '#514943', W - 220, 60)
  center('그려봄 · 지나온 나를 그리고, 지금의 나를 만나다', H - 90, `28px ${serif}`, '#958A82')
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

/**
 * 올해 카드(4:5, 1080×1350): 월 기준 그래프를 한 해의 이야기로. 선 · 가장 환했던 순간 · 가장 무거웠던 순간 · 지금의 나 한 문장.
 * 회고는 넣지 않는다.
 */
export async function exportYearCard(opts: {
  heading: string; title: string; timeScale: TimeScale; start: number; end: number; points: GraphPoint[]; line?: string; color?: string
}): Promise<Blob | null> {
  await document.fonts?.ready
  const W = 1080, H = 1350
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const sans = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = '"Gowun Batang", "AppleMyungjo", serif'
  const pts = sortEntries(opts.points)
  const color = opts.color ?? '#D99082'
  const center = (text: string, y: number, font: string, fill: string) => {
    ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y)
  }

  ctx.fillStyle = '#FFF9F3'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(149,138,130,0.07)'
  for (let x = 14; x < W; x += 28) for (let y = 14; y < H; y += 28) ctx.fillRect(x, y, 2, 2)
  center('MY YEAR, MY LINE', 150, `600 28px ${sans}`, '#958A82')
  center(opts.heading, 250, `700 76px ${sans}`, '#514943')
  center(opts.title, 312, `34px ${serif}`, '#958A82')

  // 선 (달마다 계절 띠를 옅게)
  const f: Frame = { w: W, h: 820, l: 130, r: 130, t: 420, b: 40, start: opts.start, end: opts.end }
  ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#F0E5DC'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.roundRect(80, 370, W - 160, 470, 36); ctx.fill(); ctx.stroke()
  const tint: Record<string, string> = { spring: 'rgba(240,170,180,0.10)', summer: 'rgba(120,190,170,0.10)', autumn: 'rgba(225,165,95,0.10)', winter: 'rgba(150,170,210,0.10)' }
  if (opts.timeScale === 'month') {
    for (let t = Math.ceil(opts.start); t <= opts.end; t++) {
      const m = (t % 12) + 1
      const season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'
      const x1 = Math.max(f.l, sx(f, t - 0.5)), x2 = Math.min(W - f.r, sx(f, t + 0.5))
      ctx.fillStyle = tint[season]; ctx.fillRect(x1, f.t - 20, x2 - x1, f.h - f.t - f.b + 40)
    }
  }
  ctx.setLineDash([8, 10]); ctx.strokeStyle = '#E4D6CB'
  ctx.beginPath(); ctx.moveTo(f.l, sy(f, 0)); ctx.lineTo(W - f.r, sy(f, 0)); ctx.stroke(); ctx.setLineDash([])
  const xy = spreadSameTime(pts.map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) })), 20, f.l, W - f.r)
  if (xy.length > 1) {
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round'
    ctx.stroke(new Path2D(smoothPath(xy)))
  }
  xy.forEach((p) => {
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = color; ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  })

  // 가장 환했던 순간 · 가장 무거웠던 순간
  let y = 930
  if (pts.length) {
    const hi = pts.reduce((a, b) => (b.emotionScore > a.emotionScore ? b : a))
    const lo = pts.reduce((a, b) => (b.emotionScore < a.emotionScore ? b : a))
    const rows: [string, GraphPoint][] = hi.emotionScore === lo.emotionScore ? [['잔잔하게 이어진 한 해', hi]] : [['가장 환했던 순간', hi], ['가장 무거웠던 순간', lo]]
    for (const [label, p] of rows) {
      center(label, y, `600 26px ${sans}`, '#958A82')
      momentLine(ctx, sans, 36, W / 2, y + 52, W - 260, timeLabel(opts.timeScale, p.timePoint), p.title || '이름 없는 순간', 'center')
      y += 130
    }
  }
  if (opts.line) {
    ctx.font = `38px ${serif}`
    center(`“${opts.line.length > 32 ? `${opts.line.slice(0, 31)}…` : opts.line}”`, Math.max(y + 30, 1190), `38px ${serif}`, '#514943')
  }
  center('그려봄 · 높은 곳도 깊은 곳도, 모두 지나 지금의 내가 되었어요', H - 60, `26px ${serif}`, '#958A82')
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

export interface ReviewData {
  year: number; days: number; graphs: number; moments: number
  /** 날짜(YYYY-MM-DD) → 마음 색 */
  colors: Record<string, string>
  /** 한 줄을 남긴 날 */
  answered: string[]
  top: { name: string; hex: string } | null
  hi: string | null; lo: string | null; last: string | null
}

/** 연말 돌아보기 한 장 (4:5, 1080×1350): 숫자 셋 · 마음 색 지도(하루 한 칸) · 환했던 / 무거웠던 순간 · 마지막 한 줄 */
export async function exportReviewCard(d: ReviewData): Promise<Blob | null> {
  await document.fonts?.ready
  const W = 1080, H = 1350
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const sans = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = '"Gowun Batang", "AppleMyungjo", serif'
  const center = (text: string, y: number, font: string, fill: string) => {
    ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y)
  }
  const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s)

  ctx.fillStyle = '#FFF9F3'; ctx.fillRect(0, 0, W, H)
  center('MY YEAR, MY LINE', 130, `600 26px ${sans}`, '#958A82')
  center(`${d.year}년의 나`, 220, `64px ${serif}`, '#514943')

  // 숫자 셋
  const stats: [number, string][] = [[d.days, '한 줄을 남긴 날'], [d.graphs, '새로 그린 선'], [d.moments, '이 해의 순간']]
  stats.forEach(([n, label], i) => {
    const x = W / 2 + (i - 1) * 290
    ctx.textAlign = 'center'
    ctx.font = `700 64px ${sans}`; ctx.fillStyle = '#514943'; ctx.fillText(String(n), x, 345)
    ctx.font = `24px ${sans}`; ctx.fillStyle = '#958A82'; ctx.fillText(label, x, 385)
  })

  // 마음 색 지도: 12줄 × 31칸
  ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#F0E5DC'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.roundRect(90, 440, W - 180, 470, 32); ctx.fill(); ctx.stroke()
  const answered = new Set(d.answered)
  const cell = 21, gap = 3, left = 210, top = 480
  for (let m = 0; m < 12; m++) {
    ctx.font = `22px ${sans}`; ctx.fillStyle = '#958A82'; ctx.textAlign = 'right'
    ctx.fillText(`${m + 1}월`, left - 18, top + m * (cell + 13) + cell - 4)
    const days = new Date(d.year, m + 1, 0).getDate()
    for (let k = 0; k < days; k++) {
      const key = `${d.year}-${String(m + 1).padStart(2, '0')}-${String(k + 1).padStart(2, '0')}`
      ctx.fillStyle = d.colors[key] ?? (answered.has(key) ? '#D9CFC6' : '#F3ECE5')
      ctx.beginPath(); ctx.roundRect(left + k * (cell + gap), top + m * (cell + 13), cell, cell, 6); ctx.fill()
    }
  }

  let y = 990
  if (d.top) {
    ctx.textAlign = 'center'; ctx.font = `28px ${serif}`; ctx.fillStyle = '#514943'
    const text = `가장 많이 고른 색은 ‘${d.top.name}’`
    const w = ctx.measureText(text).width
    ctx.fillStyle = d.top.hex; ctx.beginPath(); ctx.arc(W / 2 - w / 2 - 26, y - 9, 12, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#514943'; ctx.fillText(text, W / 2 + 8, y)
    y += 70
  }
  if (d.hi) { center('가장 환했던 순간', y, `600 22px ${sans}`, '#958A82'); center(clip(d.hi, 24), y + 42, `32px ${serif}`, '#514943'); y += 100 }
  if (d.lo) { center('가장 무거웠던 순간 — 그래도 지나왔어요', y, `600 22px ${sans}`, '#958A82'); center(clip(d.lo, 24), y + 42, `32px ${serif}`, '#514943'); y += 100 }
  if (d.last && y < H - 140) center(`“${clip(d.last, 28)}”`, Math.max(y + 10, H - 150), `30px ${serif}`, '#7d726b')
  center('그려봄 · 한 줄씩, 한 해가 되었어요', H - 60, `24px ${serif}`, '#958A82')
  return new Promise((res) => c.toBlob(res, 'image/png'))
}
