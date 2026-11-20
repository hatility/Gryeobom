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

/** 시각 눈금: 폭에 맞춰(라벨 하나에 70px쯤) 1 · 2 · 3 · 4 · 6 · 12시간 · 1 · 2 · 3 · 7일 간격. 며칠에 걸치면 자정에만 날짜 */
export function hourTicks(start: number, end: number, width: number): [number, string][] {
  const span = end - start, max = Math.max(2, Math.floor(width / 70))
  const step = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168].find((x) => span / x <= max) ?? 168
  const days = Math.floor(start / 24) !== Math.floor((end - 1e-6) / 24)
  const date = (t: number) => { const d = new Date(t * 3_600_000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}` }
  const out: [number, string][] = []
  for (let t = Math.ceil(start / step) * step; t <= end + 1e-6; t += step) {
    out.push([t, step >= 24 || (days && t % 24 === 0) ? date(t) : `${t % 24}시`])
  }
  return out
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
/** 이미지 카드 배경 (실험) */
export type CardTheme = 'paper' | 'dusk' | 'leaf' | 'sky'
export const CARD_THEMES: [CardTheme, string][] = [['paper', '종이'], ['dusk', '노을'], ['leaf', '풀잎'], ['sky', '하늘']]
function paintBg(ctx: CanvasRenderingContext2D, W: number, H: number, theme: CardTheme = 'paper') {
  if (theme === 'paper') {
    ctx.fillStyle = '#FFF9F3'; ctx.fillRect(0, 0, W, H)
    return
  }
  const [a, b, dot] = theme === 'dusk' ? ['#FCE1D6', '#FFF6EE', '#E8A89A'] : theme === 'leaf' ? ['#E3F0E8', '#FAFCF6', '#8FB3A2'] : ['#DDEAF6', '#F8FBFF', '#8FB0D0']
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  g.addColorStop(0, a); g.addColorStop(1, b)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // 가장자리에 옅은 점 몇 개 (꾸밈)
  ctx.fillStyle = dot; ctx.globalAlpha = 0.18
  for (const [x, y, r] of [[0.08, 0.06, 18], [0.92, 0.1, 10], [0.88, 0.94, 22], [0.1, 0.9, 12], [0.96, 0.5, 8]]) {
    ctx.beginPath(); ctx.arc(x * W, y * H, r * (W / 1080), 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** 손글씨 글꼴 (개구 · Gaegu, OFL). 고를 때만 구글 글꼴에서 불러온다 */
export const HAND = '"Gaegu", "Gowun Batang", sans-serif'
/** 그릴 글자가 든 조각만 받아 둔다 (한글 글꼴은 여러 조각으로 나뉘어 있다) */
export async function loadHand(text: string) {
  if (!document.querySelector('link[data-hand]')) {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&display=swap'
    l.dataset.hand = '1'
    const done = new Promise((ok) => { l.onload = ok; l.onerror = ok })
    document.head.append(l)
    await done
  }
  await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 40px Gaegu`, text || '그려봄')))
}


/** (실험 · 새 틀) 이미지 카드도 사이트와 같은 종이 · 테이프 · 로고 글씨로 */
const LOGO = '"Gaegu", "Gowun Batang", serif'
const SERIF = '"Gowun Batang", "AppleMyungjo", serif'
const seasonColor = () => getComputedStyle(document.documentElement).getPropertyValue('--season').trim() || '#e8a7b8'
/** 그래프 판: 테두리 대신 종이 그림자 + 위 가운데 마스킹테이프 */
function paperBoard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save()
  ctx.shadowColor = 'rgba(110,80,50,0.22)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(240,229,220,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke()
  const tw = Math.round(w * 0.2), th = Math.round(tw * 0.24)
  ctx.save()
  ctx.translate(x + w / 2, y); ctx.rotate(-2.5 * Math.PI / 180)
  ctx.globalAlpha = 0.6; ctx.fillStyle = seasonColor(); ctx.fillRect(-tw / 2, -th / 2, tw, th)
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#FFFFFF'
  for (let k = -tw / 2; k < tw / 2; k += th / 2.4) ctx.fillRect(k, -th / 2, th / 4.8, th)
  ctx.restore()
}

export async function exportImage(opts: {
  title: string; timeScale: TimeScale; start: number; end: number; points: GraphPoint[]; color?: string; theme?: CardTheme; /** 손글씨(실험) */ hand?: boolean
  /** false 면 나이 · 연도를 빼고 ‘그때 → 지금’으로만 (시점을 숨기고 나눈 모임 그래프) */
  showTime?: boolean
  /** 제목 위 작은 글씨 (기본: 로고 글씨 ‘그려봄’) */
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
  const sans = opts.hand ? HAND : '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = opts.hand ? HAND : '"Gowun Batang", "Pretendard Variable", sans-serif'

  paintBg(ctx, W, H, opts.theme)
  ctx.fillStyle = 'rgba(149,138,130,0.08)'
  for (let x = 12; x < W; x += 24) for (let y = 12; y < H; y += 24) ctx.fillRect(x, y, 2, 2)

  ctx.fillStyle = '#958A82'; ctx.font = opts.eyebrow ? `600 22px ${sans}` : `700 34px ${opts.hand ? HAND : LOGO}`
  ctx.fillText(opts.eyebrow ?? '그려봄', 80, 110)
  ctx.fillStyle = '#514943'
  ctx.fillText(fitLine(ctx, opts.title, W - 160, (px) => `700 ${px}px ${serif}`, 54), 80, 180)
  ctx.fillStyle = '#958A82'; ctx.font = `28px ${serif}`
  ctx.fillText(`${showTime ? rangeLabel(opts.timeScale, opts.start, opts.end) : '그때부터 지금까지'}, 나만의 선`, 80, 228)

  paperBoard(ctx, 60, 280, W - 120, 440, 28)
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
    momentLine(ctx, sans, 22, x, y, 500, showTime ? timeLabel(opts.timeScale, p.timePoint, [opts.start, opts.end]) : '', p.title || '이름 없는 순간', 'left')
  })

  ctx.fillStyle = '#958A82'; ctx.font = `26px ${serif}`
  ctx.fillText('지나온 나를 그리고, 지금의 나를 만나다.  — 그려봄', 80, H - 50)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

/** 한 줄에 들어가게: 글자를 조금씩 줄여 보고(처음의 60%까지), 그래도 넘치면 … 로 자른다. ctx.font 를 맞는 크기로 바꿔 둔다 */
function fitLine(ctx: CanvasRenderingContext2D, text: string, max: number, font: (px: number) => string, px: number): string {
  const min = Math.round(px * 0.6)
  for (; px > min; px -= 2) { ctx.font = font(px); if (ctx.measureText(text).width <= max) return text }
  ctx.font = font(px)
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
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
    // 이름 없는 순간은 점만 (그래프에 ‘이름 없는 순간’ 이 여러 번 찍히지 않게) — 고른 점일 때만 이름표
    if (!p.title.trim() && i !== keep) continue
    const chars = [...(p.title.trim() || '이름 없는 순간')]
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
export interface StoryOpts {
  title: string; timeScale: TimeScale; start: number; end: number; points: GraphPoint[]; line?: string; color?: string; theme?: CardTheme; /** 손글씨(실험) */ hand?: boolean
  /** 정사각형(1080×1080, 피드용) — 판을 줄이고 순간은 세 개까지 */
  square?: boolean
  /** 그때와 지금: 지난 선(흐린 점선)과 그 이름 */
  ghost?: { points: GraphPoint[]; label: string }
}
export async function exportStoryCard(opts: StoryOpts): Promise<Blob | null> {
  await document.fonts?.ready
  const c = drawStoryCard(opts, 1)
  return c ? new Promise((res) => c.toBlob(res, 'image/png')) : null
}

/**
 * 카드 영상 (실험): 같은 세로 카드에서 선이 왼쪽부터 그려지고, 점이 하나씩 찍히고, 끝에 ‘지금의 나’ 가 도착해요.
 * 약 4초 · 브라우저가 되는 형식으로 (mp4 가 되면 mp4, 아니면 webm).
 */
export async function exportStoryVideo(opts: StoryOpts): Promise<{ blob: Blob; ext: string } | null> {
  await document.fonts?.ready
  return recordCard((k, c) => drawStoryCard(opts, k, c))
}

/** 카드를 k=0→1 로 그리며 녹화 (2.8초 그리고 1.3초 머물러요). mp4 가 되면 mp4, 아니면 webm */
async function recordCard(draw: (k: number, c?: HTMLCanvasElement) => HTMLCanvasElement | null): Promise<{ blob: Blob; ext: string } | null> {
  const c = draw(0)
  if (!c || typeof MediaRecorder === 'undefined' || !c.captureStream) return null
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) return null
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise<void>((ok) => { rec.onstop = () => ok() })
  rec.start()
  const t0 = performance.now(), dur = 2800, hold = 1300
  await new Promise<void>((ok) => {
    const tick = () => {
      const t = performance.now() - t0
      const k = Math.min(1, t / dur)
      draw(1 - (1 - k) ** 2, c)
      if (t < dur + hold) requestAnimationFrame(tick); else ok()
    }
    requestAnimationFrame(tick)
  })
  rec.stop()
  await done
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm' }
}

/** 세로 · 정사각 카드 그리기. k(0~1): 선이 그려진 만큼 — 1 이면 다 그린 카드 */
function drawStoryCard(opts: StoryOpts, k: number, canvas?: HTMLCanvasElement): HTMLCanvasElement | null {
  const sq = !!opts.square
  const W = 1080, H = sq ? 1080 : 1920
  // 자리: [제목 y, 판 위, 판 높이, 순간 첫 줄, 순간 수, 한 문장 최소 y]
  const L = sq ? { head: 110, title: 195, box: 330, boxH: 450, list: 850, n: 3, line: 0 } : { head: 200, title: 310, box: 500, boxH: 760, list: 1340, n: 6, line: 1700 }
  const c = canvas ?? document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const sans = opts.hand ? HAND : '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = opts.hand ? HAND : '"Gowun Batang", "AppleMyungjo", serif'
  const pts = sortEntries(opts.points)
  const center = (text: string, y: number, font: string, color: string) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y)
  }
  /** 한 줄 넓이를 넘으면 줄을 나눠 가운데 정렬로 그린다 */
  const wrap = (text: string, y: number, font: string, color: string, max: number, lh: number) => {
    ctx.font = font
    const lines: string[] = []
    let cur = ''
    for (let word of text.split(' ')) {
      // 띄어쓰기 없는 긴 말은 글자 단위로 나눈다
      while (word.length > 1 && ctx.measureText(word).width > max) {
        let k = word.length - 1
        while (k > 1 && ctx.measureText(word.slice(0, k)).width > max) k--
        if (cur) { lines.push(cur); cur = '' }
        lines.push(word.slice(0, k)); word = word.slice(k)
      }
      const next = cur ? `${cur} ${word}` : word
      if (ctx.measureText(next).width > max && cur) { lines.push(cur); cur = word } else cur = next
    }
    if (cur) lines.push(cur)
    // 아래 그림과 겹치지 않게 두 줄까지만
    if (lines.length > 2) lines.splice(1, lines.length - 1, `${lines[1].slice(0, -1)}…`)
    lines.forEach((l, i) => center(l, y + i * lh, font, color))
    return y + lines.length * lh
  }

  paintBg(ctx, W, H, opts.theme)
  // 1.2.0: 영어 머리글 대신 ‘그려봄’ (화면과 같게) · 그래프 판을 키워 선이 카드의 주인공
  center('그려봄', L.head, `700 ${sq ? 44 : 50}px ${opts.hand ? HAND : LOGO}`, '#958A82')
  let y = wrap(opts.title, L.title, `700 ${sq ? 60 : 72}px ${serif}`, '#514943', W - 200, sq ? 76 : 92)
  center(rangeLabel(opts.timeScale, opts.start, opts.end), y + 20, `34px ${serif}`, '#958A82')

  // 선
  paperBoard(ctx, 60, L.box, W - 120, L.boxH, 44)
  const f: Frame = { w: W, h: L.box + L.boxH, l: 120, r: 130, t: L.box + 80, b: 120, start: opts.start, end: opts.end }
  ctx.setLineDash([10, 12]); ctx.strokeStyle = '#E4D6CB'
  ctx.beginPath(); ctx.moveTo(f.l, sy(f, 0)); ctx.lineTo(W - f.r, sy(f, 0)); ctx.stroke(); ctx.setLineDash([])
  const xy = pts.map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) }))
  if (opts.ghost && opts.ghost.points.length > 1) {
    const gxy = sortEntries(opts.ghost.points).filter((p) => p.timePoint >= opts.start && p.timePoint <= opts.end).map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) }))
    ctx.save(); ctx.setLineDash([12, 12]); ctx.strokeStyle = '#B9ADA4'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    if (gxy.length > 1) ctx.stroke(new Path2D(smoothPath(gxy)))
    ctx.restore()
    ctx.font = `26px ${sans}`; ctx.fillStyle = '#958A82'; ctx.textAlign = 'left'
    ctx.fillText(`점선 · ${opts.ghost.label}`, f.l, L.box + 50)
  }
  // 영상: 왼쪽부터 reveal 까지만 (선 · 점), ‘지금의 나’ 는 다 그린 뒤에
  const reveal = f.l - 20 + (W - f.r + 40 - (f.l - 20)) * k
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, reveal, H); ctx.clip()
  if (xy.length > 1) {
    ctx.strokeStyle = opts.color ?? '#E8A89A'; ctx.lineWidth = 7; ctx.lineCap = 'round'
    ctx.stroke(new Path2D(smoothPath(xy)))
  }
  ctx.restore()
  xy.filter((p) => p.x <= reveal).forEach((p) => {
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = opts.color ?? '#D99082'; ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  })
  // 지금의 나: 마지막 순간의 높이에서 오른쪽 끝, 옅은 빛 + 찬 점 (화면 그래프와 같은 끝맺음)
  const last = xy[xy.length - 1]
  const now = { x: sx(f, opts.end), y: last ? last.y : sy(f, 0) }
  if (k >= 0.97) { // 영상에선 선이 끝에 닿을 때 도착
  if (last && last.x < now.x - 4) {
    ctx.setLineDash([6, 10]); ctx.strokeStyle = opts.color ?? '#D99082'; ctx.globalAlpha = 0.5; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(now.x, now.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
  }
  ctx.fillStyle = opts.color ?? '#D99082'
  ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(now.x, now.y, 32, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
  ctx.beginPath(); ctx.arc(now.x, now.y, 15, 0, Math.PI * 2); ctx.fill()
  ctx.font = `600 30px ${sans}`; ctx.textAlign = 'right'; ctx.fillStyle = '#514943'
  // 이름표 자리: 위 · 아래 · 점 왼쪽 중에 들어오는 선과 안 겹치고 판 안에 드는 첫 자리
  const tw = ctx.measureText('지금의 나').width
  const segs = [xy[xy.length - 2], last].every(Boolean) ? [[xy[xy.length - 2], last], [last, now]] : [[now, now]]
  const clear = (b: { l: number; r: number; t: number; b: number }) =>
    b.t > L.box + 16 && b.b < L.box + L.boxH - 70 &&
    !segs.some(([a, z]) => Array.from({ length: 41 }, (_, k) => ({ x: a.x + ((z.x - a.x) * k) / 40, y: a.y + ((z.y - a.y) * k) / 40 }))
      .some((p) => p.x > b.l - 8 && p.x < b.r + 8 && p.y > b.t - 8 && p.y < b.b + 8))
  const fromBelow = segs[0][0].y > now.y
  const spots = [
    { x: now.x + 40, y: now.y + (fromBelow ? -46 : 66) },
    { x: now.x + 40, y: now.y + (fromBelow ? 66 : -46) },
    { x: now.x - 40, y: now.y + 10 },
  ]
  const spot = spots.find((s) => clear({ l: s.x - tw, r: s.x, t: s.y - 26, b: s.y + 6 })) ?? spots[0]
  ctx.fillText('지금의 나', spot.x, spot.y)
  }
  // 그때 · 지금
  ctx.font = `28px ${sans}`; ctx.fillStyle = '#958A82'
  ctx.textAlign = 'left'; ctx.fillText('그때', f.l, L.box + L.boxH - 40)
  ctx.textAlign = 'right'; ctx.fillText('지금', W - f.r, L.box + L.boxH - 40)

  // 순간 이름 (세로 6개 · 정사각형 3개)
  y = L.list
  pts.slice(0, L.n).forEach((p) => {
    momentLine(ctx, sans, 34, W / 2, y, W - 240, timeLabel(opts.timeScale, p.timePoint, [opts.start, opts.end]), p.title || '이름 없는 순간', 'center')
    y += 58
  })
  if (opts.line && !sq) wrap(`“${opts.line}”`, Math.max(y + 60, L.line), `40px ${serif}`, '#514943', W - 220, 60)
  center('그려봄 · 지나온 나를 그리고, 지금의 나를 만나다', H - (sq ? 40 : 90), `28px ${serif}`, '#958A82')
  return c
}

/**
 * 올해 카드(4:5, 1080×1350): 월 기준 그래프를 한 해의 이야기로. 선 · 가장 환했던 순간 · 가장 무거웠던 순간 · 지금의 나 한 문장.
 * 회고는 넣지 않는다.
 */
export interface YearOpts {
  heading: string; title: string; timeScale: TimeScale; start: number; end: number; points: GraphPoint[]; line?: string; color?: string; theme?: CardTheme; /** 손글씨(실험) */ hand?: boolean
}
export async function exportYearCard(opts: YearOpts): Promise<Blob | null> {
  await document.fonts?.ready
  const c = drawYearCard(opts, 1)
  return c ? new Promise((res) => c.toBlob(res, 'image/png')) : null
}
/** 올해 카드 영상 (실험): 선이 1월부터 그려져요 */
export async function exportYearVideo(opts: YearOpts) {
  await document.fonts?.ready
  return recordCard((k, c) => drawYearCard(opts, k, c))
}
function drawYearCard(opts: YearOpts, k: number, canvas?: HTMLCanvasElement): HTMLCanvasElement | null {
  const W = 1080, H = 1350
  const c = canvas ?? document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const sans = opts.hand ? HAND : '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif'
  const serif = opts.hand ? HAND : '"Gowun Batang", "AppleMyungjo", serif'
  const pts = sortEntries(opts.points)
  const color = opts.color ?? '#D99082'
  const center = (text: string, y: number, font: string, fill: string) => {
    ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y)
  }

  paintBg(ctx, W, H, opts.theme)
  ctx.fillStyle = 'rgba(149,138,130,0.07)'
  for (let x = 14; x < W; x += 28) for (let y = 14; y < H; y += 28) ctx.fillRect(x, y, 2, 2)
  center('그려봄', 150, `700 46px ${opts.hand ? HAND : LOGO}`, '#958A82')
  center(opts.heading, 250, `700 ${opts.heading.length > 10 ? 68 : 76}px ${serif}`, '#514943')
  center(fitLine(ctx, opts.title, W - 200, (px) => `${px}px ${serif}`, 34), 312, ctx.font, '#958A82')

  // 선 (달마다 계절 띠를 옅게)
  const f: Frame = { w: W, h: 820, l: 130, r: 130, t: 420, b: 40, start: opts.start, end: opts.end }
  paperBoard(ctx, 80, 370, W - 160, 470, 36)
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
  const reveal = f.l - 20 + (W - f.r + 40 - (f.l - 20)) * k
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, reveal, H); ctx.clip()
  if (xy.length > 1) {
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round'
    ctx.stroke(new Path2D(smoothPath(xy)))
  }
  ctx.restore()
  xy.filter((p) => p.x <= reveal).forEach((p) => {
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
      momentLine(ctx, sans, 36, W / 2, y + 52, W - 260, timeLabel(opts.timeScale, p.timePoint, [opts.start, opts.end]), p.title || '이름 없는 순간', 'center')
      y += 130
    }
  }
  if (opts.line) {
    ctx.font = `38px ${serif}`
    center(`“${opts.line.length > 32 ? `${opts.line.slice(0, 31)}…` : opts.line}”`, Math.max(y + 30, 1190), `38px ${serif}`, '#514943')
  }
  center('그려봄 · 높은 곳도 깊은 곳도, 모두 지나 지금의 내가 되었어요', H - 60, `26px ${serif}`, '#958A82')
  return c
}

export interface ReviewData {
  year: number; days: number; graphs: number; moments: number
  /** 날짜(YYYY-MM-DD) → 마음 색 */
  colors: Record<string, string>
  /** 한 줄을 남긴 날 */
  answered: string[]
  top: { name: string; hex: string } | null
  hi: string | null; lo: string | null; last: string | null
  /** 자주 쓴 마음 단어 · 받은 응원 */
  words?: string[]; cheers?: number
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
  const serif = SERIF
  const center = (text: string, y: number, font: string, fill: string) => {
    ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y)
  }
  const clip = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s)

  ctx.fillStyle = '#FFF9F3'; ctx.fillRect(0, 0, W, H)
  center('그려봄', 130, `700 44px ${LOGO}`, '#958A82')
  center(`${d.year}년의 나`, 220, `700 64px ${serif}`, '#514943')

  // 숫자 셋
  const stats: [number, string][] = [[d.days, '한 줄을 남긴 날'], [d.graphs, '새로 그린 선'], [d.moments, '이 해의 순간']]
  stats.forEach(([n, label], i) => {
    const x = W / 2 + (i - 1) * 290
    ctx.textAlign = 'center'
    ctx.font = `700 64px ${sans}`; ctx.fillStyle = '#514943'; ctx.fillText(String(n), x, 345)
    ctx.font = `24px ${sans}`; ctx.fillStyle = '#958A82'; ctx.fillText(label, x, 385)
  })

  // 마음 색 지도: 12줄 × 31칸
  paperBoard(ctx, 90, 440, W - 180, 470, 32)
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
  if (d.words?.length && y < H - 220) { center('자주 쓴 마음 단어', y, `600 22px ${sans}`, '#958A82'); center(d.words.slice(0, 5).join(' · '), y + 42, `30px ${serif}`, '#D99082'); y += 100 }
  if (d.cheers && y < H - 200) { center(`모임에서 받은 응원 ${d.cheers}번`, y, `600 24px ${sans}`, '#958A82'); y += 60 }
  if (d.last && y < H - 140) center(`“${clip(d.last, 28)}”`, Math.max(y + 10, H - 150), `30px ${serif}`, '#7d726b')
  center('그려봄 · 한 줄씩, 한 해가 되었어요', H - 60, `24px ${serif}`, '#958A82')
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

/** 모임 리포트 한 장 (4:5, 1080×1350): 모임 이름 · 숫자 넷 · 누가 무엇을 그렸는지는 담지 않아요 */
export async function exportGroupCard(d: { name: string; stats: [string, string][] }): Promise<Blob | null> {
  await document.fonts?.ready
  const W = 1080, H = 1350
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d'); if (!ctx) return null
  const center = (t: string, y: number, font: string, fill: string) => { ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = 'center'; ctx.fillText(t, W / 2, y) }
  paintBg(ctx, W, H, 'paper')
  center('그려봄', 150, `700 46px ${LOGO}`, '#958A82')
  center(d.name, 250, `700 70px ${SERIF}`, '#514943')
  center(`${new Date().toLocaleDateString('ko-KR')} · 우리 모임의 흐름`, 312, `30px ${SERIF}`, '#958A82')
  paperBoard(ctx, 90, 380, W - 180, 700, 36)
  d.stats.slice(0, 4).forEach(([n, label], i) => {
    const x = i % 2 ? W * 0.7 : W * 0.3, y = 560 + Math.floor(i / 2) * 290
    ctx.textAlign = 'center'; ctx.fillStyle = '#514943'; ctx.font = `700 96px ${SERIF}`; ctx.fillText(n, x, y)
    ctx.fillStyle = '#958A82'; ctx.font = `30px ${SERIF}`; ctx.fillText(label, x, y + 56)
  })
  center('누가 무엇을 그렸는지는 담지 않았어요', H - 150, `28px ${SERIF}`, '#958A82')
  center('그려봄 · 서로의 선을 판단하지 않고 바라봐요', H - 70, `26px ${SERIF}`, '#958A82')
  return new Promise((res) => c.toBlob(res, 'image/png'))
}
