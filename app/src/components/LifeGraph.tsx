import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { GraphPoint, LifeStage, TimeScale } from '../types'
import { sortEntries } from '../store'
import { hourTicks, invert, layoutLabels, smoothPath, spreadSameTime, sx, sy, ticks, type Frame } from '../graph'
import { SEASON_NAME, endsNow, rangeLabel, scoreWord, seasonOf, signed, timeLabel, type Season } from '../content'

/** 달 범위를 계절 띠로 묶는다 (t = 연도×12 + 0~11) */
function seasonBands(start: number, end: number) {
  const out: { season: Season; from: number; to: number }[] = []
  for (let t = Math.ceil(start); t <= end; t++) {
    const season = seasonOf((t % 12) + 1)
    const last = out[out.length - 1]
    if (last?.season === season) last.to = t
    else out.push({ season, from: t, to: t })
  }
  return out
}

/** 전환점 별 (가운데가 점 자리) */
const starPath = (R: number, r = R * 0.45) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r : R
    return `${i ? 'L' : 'M'}${(Math.cos(a) * k).toFixed(1)},${(Math.sin(a) * k).toFixed(1)}`
  }).join('') + 'Z'

interface Props {
  points: GraphPoint[]
  timeScale: TimeScale
  start: number
  end: number
  showTimeLabels?: boolean
  compact?: boolean
  editable?: boolean
  /** 점 끌기를 끈다 (모바일 · 태블릿: 점을 누르면 고치는 창에서 시점 · 마음 높이를 고른다) */
  noDrag?: boolean
  selectedId?: string | null
  emptyText?: string
  /** 겹쳐 볼 지난 선 (점선, 누를 수 없음) */
  ghost?: GraphPoint[]
  /** 내 선의 색 (CSS 색) */
  tone?: string
  /** 인생 구간 띠 (실험): 시간 눈금 아래에 이름 띠로 */
  stages?: LifeStage[]
  onSelect?: (id: string | null) => void
  onMove?: (id: string, timePoint: number, score: number) => void
  onAdd?: (timePoint: number, score: number) => void
}

export default function LifeGraph({
  points, timeScale, start, end, showTimeLabels = true, compact, editable, noDrag,
  selectedId, onSelect, onMove, onAdd, emptyText, ghost, tone, stages,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [w, setW] = useState(640)
  const [innerSel, setInnerSel] = useState<string | null>(null)
  // 끌기: 손가락이 처음 닿은 자리에서 얼마나 움직였는지만큼 점을 옮긴다 (점이 손가락 밑으로 튀지 않게)
  const drag = useRef<{ id: string; moved: boolean; x0: number; y0: number; px: number; py: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const uidBase = useId().replace(/:/g, '')

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setW(el.clientWidth || 640)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width || 640))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sel = selectedId !== undefined ? selectedId : innerSel
  const select = onSelect ?? setInnerSel
  const narrow = w < 420
  // 폰에서 고칠 때는 위아래를 넉넉히 (마음 한 칸이 손가락으로 집을 만큼)
  // 구간 띠가 있으면 아래에 한 줄 더 (그래프 칸은 그대로)
  const bands = !compact && stages?.length ? stages.filter((s) => s.to > start && s.from < end) : []
  const extra = bands.length ? 30 : 0
  const h = (compact ? 120 : narrow ? (editable ? 360 : 290) : 360) + extra
  const f: Frame = compact
    ? { w, h, l: 10, r: 10, t: 12, b: 12, start, end }
    : { w, h, l: narrow ? 30 : 44, r: narrow ? 20 : 30, t: 34, b: 42 + extra, start, end }

  const sorted = sortEntries(points)
  const xy = spreadSameTime(sorted.map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) })), compact ? 6 : 18, f.l, w - f.r)
  // 나이 · 연도는 한 달 단위, 월 기준은 한 주(4분의 1달) 단위까지
  const step = timeScale === 'month' ? 4 : timeScale === 'hour' ? 6 : 12
  const tl = (t: number) => timeLabel(timeScale, t, [start, end])
  const line = smoothPath(xy)
  // 지난 선은 이 그래프의 기간 안에 있는 점만 (끝에 몰려 모양이 바뀌지 않게)
  const ghostLine = ghost
    ? smoothPath(spreadSameTime(sortEntries(ghost.filter((p) => p.timePoint >= start && p.timePoint <= end)).map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) })), 18, f.l, w - f.r))
    : ''
  const y0 = sy(f, 0)
  const area = xy.length > 1 ? `${line} L${xy[xy.length - 1].x},${y0} L${xy[0].x},${y0} Z` : ''
  const selected = sorted.find((p) => p.id === sel)
  // ‘지금의 나’: 맨 끝 지금 자리의 빛나는 점. 마지막 순간의 높이에서, 순간이 없으면 0에서.
  const last = xy[xy.length - 1]
  const now = { x: sx(f, end), y: last ? last.y : y0 }
  const reachesNow = sorted.length > 0 && sorted[sorted.length - 1].timePoint >= end
  const allLabels = compact
    ? []
    : layoutLabels(
        [...sorted.map((p, i) => ({ ...xy[i], title: p.title, up: p.emotionScore >= 0 })), ...(reachesNow ? [] : [{ ...now, title: '지금의 나', up: true }])],
        { w, top: 2, bottom: h - f.b + 4 },
        narrow ? 7 : 10,
        sorted.findIndex((p) => p.id === sel),
        // ‘↑ 환했던 마음’ · ‘↓ 무거웠던 마음’ 글씨 자리
        [
          { l: f.l, r: f.l + 100, t: f.t - 26, b: f.t - 8 },
          { l: f.l, r: f.l + 100, t: sy(f, -5) - 20, b: sy(f, -5) },
        ],
      )
  const labels = allLabels.slice(0, sorted.length)
  const nowLabel = reachesNow ? null : allLabels[sorted.length]

  // 끌 때 시간 눈금: 한 칸이 8px 보다 좁으면 덜 잘게 (폰에서 한 달이 2px 이면 점이 떨린다)
  const unitPx = (w - f.l - f.r) / Math.max(1, end - start)
  const dragStep = Math.max(1, Math.min(step, Math.floor(unitPx / 8)))

  // 끄는 동안 화면이 같이 굴러가지 않게 (iOS 는 SVG 안의 touch-action 을 따르지 않는다)
  useEffect(() => {
    const el = svg.current
    if (!el || !editable || noDrag) return
    const stop = (e: TouchEvent) => drag.current && e.cancelable && e.preventDefault()
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [editable, noDrag])

  const onPointDown = (e: PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation()
    if (!editable) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 일부 환경에서 포인터가 이미 끝난 경우 — 캡처 없이도 이동은 동작한다
    }
    const i = sorted.findIndex((p) => p.id === id)
    drag.current = { id, moved: false, x0: e.clientX, y0: e.clientY, px: xy[i].x, py: xy[i].y }
  }
  const onPointMove = (e: PointerEvent, p: GraphPoint) => {
    const d = drag.current
    if (noDrag || d?.id !== p.id) return
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0
    // 살짝 떨린 건 누르기로 (6px 안쪽)
    if (!d.moved && Math.hypot(dx, dy) < 6) return
    if (!d.moved) setDragId(p.id)
    d.moved = true
    const moved = invert(f, d.px + dx, d.py + dy, dragStep)
    const score = moved.score
    // 위아래로만 끌면 시간은 그대로 (거친 눈금에 맞춰 바뀌지 않게)
    const timePoint = Math.abs(dx) < 8 ? p.timePoint : moved.timePoint
    if (timePoint !== p.timePoint || score !== p.emotionScore) {
      if (score !== p.emotionScore) navigator.vibrate?.(6)
      onMove?.(p.id, timePoint, score)
    }
  }
  const onPointUp = (id: string) => {
    if (drag.current && !drag.current.moved) select(sel === id ? null : id)
    drag.current = null
    setDragId(null)
  }
  const onPointKey = (e: KeyboardEvent, p: GraphPoint) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      select(sel === p.id ? null : p.id)
    } else if (editable && delta[e.key]) {
      e.preventDefault()
      const [dt, ds] = delta[e.key]
      onMove?.(p.id, Math.min(end, Math.max(start, p.timePoint + dt)), Math.min(5, Math.max(-5, p.emotionScore + ds)))
    }
  }

  const di = dragId ? sorted.findIndex((p) => p.id === dragId) : -1
  const dragging = di >= 0 ? xy[di] : null
  const dragText = di >= 0 ? `${showTimeLabels ? tl(sorted[di].timePoint) + ' · ' : ''}마음 ${signed(sorted[di].emotionScore)}` : ''
  const bubbleW = dragText.length * 8.5 + 28

  const desc = `${showTimeLabels ? rangeLabel(timeScale, start, end).replace(/, \d+개월$/, '') : '과거부터 지금까지'}의 인생 그래프. 순간 ${sorted.length}개.`

  return (
    <div className={`life-graph${compact ? ' is-compact' : ''}`} ref={wrap} style={tone ? ({ '--line': tone } as CSSProperties) : undefined}>
      <svg
        ref={svg}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role={compact ? undefined : 'group'}
        aria-label={compact ? undefined : desc}
        aria-hidden={compact || undefined}
        className={editable ? `is-editable${noDrag ? ' no-drag' : ''}` : undefined}
      >
        <defs>
          {/* 영역을 그래프 크기로: % 로 두면 완전히 수평인 선(모든 순간 마음 0)은 높이 0 이라 사라진다 */}
          <filter id={`${uidBase}-pencil`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={w + 20} height={h + 20}>
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="0.9" />
          </filter>
          <clipPath id={`${uidBase}-up`}><rect x="0" y="0" width={w} height={y0} /></clipPath>
          <clipPath id={`${uidBase}-down`}><rect x="0" y={y0} width={w} height={h - y0} /></clipPath>
        </defs>

        {editable && (
          <rect
            x={f.l} y={f.t} width={Math.max(0, w - f.l - f.r)} height={Math.max(0, h - f.t - f.b)}
            fill="transparent"
            onClick={(e) => {
              const r = svg.current!.getBoundingClientRect()
              const { timePoint, score } = invert(f, e.clientX - r.left, e.clientY - r.top, step)
              onAdd?.(timePoint, score)
            }}
          />
        )}

        {/* 월 기준이면 봄 · 여름 · 가을 · 겨울을 은은한 색 띠로 (같은 계절은 한 띠로) */}
        {!compact && timeScale === 'month' && showTimeLabels && (
          <g className="g-seasons" aria-hidden="true">
            {seasonBands(start, end).map((b) => {
              const x1 = Math.max(f.l, sx(f, b.from - 0.5)), x2 = Math.min(w - f.r, sx(f, b.to + 0.5))
              return (
                <g key={b.from}>
                  <rect x={x1} y={f.t} width={Math.max(0, x2 - x1)} height={h - f.t - f.b} className={`g-season is-${b.season}`} />
                  {/* 이름은 띠의 오른쪽 아래 (왼쪽 아래 ‘무거웠던 마음’ 글씨와 겹치지 않게) */}
                  {x2 - x1 > 28 && x2 > f.l + 130 && <text x={x2 - 6} y={h - f.b - 8} textAnchor="end" className="g-season-label">{SEASON_NAME[b.season]}</text>}
                </g>
              )
            })}
          </g>
        )}

        {/* 인생 구간 띠: 그래프 칸에는 아주 옅게, 시간 눈금 아래에는 이름 띠 */}
        {bands.length > 0 && (
          <g className="g-stages" aria-hidden="true">
            {bands.map((b, i) => {
              const x1 = Math.max(f.l, sx(f, Math.max(start, b.from))), x2 = Math.min(w - f.r, sx(f, Math.min(end, b.to)))
              const bw = Math.max(0, x2 - x1 - 2)
              return (
                <g key={`${b.label}-${i}`} className={`g-stage is-${i % 5}`}>
                  <rect x={x1 + 1} y={f.t} width={bw} height={h - f.t - f.b} className="g-stage-tint" />
                  <rect x={x1 + 1} y={h - f.b + 30} width={bw} height={20} rx={6} className="g-stage-bar" />
                  {bw > 24 && <text x={(x1 + x2) / 2} y={h - f.b + 44} textAnchor="middle" className="g-stage-label">{bw < b.label.length * 11 ? b.label.slice(0, Math.max(1, Math.floor(bw / 11) - 1)) + '…' : b.label}</text>}
                </g>
              )
            })}
          </g>
        )}

        {!compact && (
          <g className="g-axis" aria-hidden="true">
            {[5, -5].map((s) => (
              <line key={s} x1={f.l} x2={w - f.r} y1={sy(f, s)} y2={sy(f, s)} className="g-grid" />
            ))}
            <text x={f.l + 4} y={f.t - 12} className="g-note">↑ 환했던 마음</text>
            <text x={f.l + 4} y={sy(f, -5) - 7} className="g-note">↓ 무거웠던 마음</text>
            {[5, 0, -5].map((s) => (
              <text key={s} x={f.l - 8} y={sy(f, s) + 4} textAnchor="end" className="g-tick">{signed(s)}</text>
            ))}
            {showTimeLabels
              ? timeScale === 'hour'
                ? hourTicks(start, end, w - f.l - f.r).map(([t, label]) => (
                    <text key={t} x={sx(f, t)} y={h - f.b + 20} textAnchor="middle" className="g-tick">{label}</text>
                  ))
                : ticks(start, end, timeScale === 'month' ? (narrow ? 6 : 12) : narrow ? 4 : 8).map((t) => (
                  <text key={t} x={sx(f, t)} y={h - f.b + 20} textAnchor="middle" className="g-tick">
                    {t === end && endsNow(timeScale, end) ? '지금' : tl(t)}
                  </text>
                ))
              : (
                <>
                  <text x={f.l} y={h - f.b + 20} className="g-tick">그때</text>
                  <text x={w - f.r} y={h - f.b + 20} textAnchor="end" className="g-tick">지금</text>
                </>
              )}
          </g>
        )}

        <line
          x1={f.l} x2={w - f.r} y1={y0} y2={y0}
          className="g-base" filter={`url(#${uidBase}-pencil)`}
          aria-hidden="true"
        />

        {ghostLine && <path d={ghostLine} className="g-ghost" aria-hidden="true" />}

        {area && (
          <g aria-hidden="true" className="g-area">
            <path d={area} clipPath={`url(#${uidBase}-up)`} className="g-area-up" />
            <path d={area} clipPath={`url(#${uidBase}-down)`} className="g-area-down" />
          </g>
        )}
        {line && (
          <path d={line} className="g-line" pathLength={1} filter={`url(#${uidBase}-pencil)`} aria-hidden="true" />
        )}

        {!compact && !reachesNow && (
          <g className="g-now" aria-hidden="true">
            {last && <path d={`M${last.x},${last.y} L${now.x},${now.y}`} className="g-now-trail" />}
            <circle cx={now.x} cy={now.y} r={13} className="g-now-glow" />
            <circle cx={now.x} cy={now.y} r={6} className="g-now-dot" />
            {nowLabel && (
              <text x={now.x + nowLabel.dx} y={now.y + nowLabel.dy} textAnchor="middle" className="g-label g-now-label">{nowLabel.text}</text>
            )}
          </g>
        )}

        {sorted.map((p, i) => {
          const { x, y } = xy[i]
          const isSel = p.id === sel
          const label = labels[i]
          return (
            <g
              key={p.id}
              className={`g-point${isSel ? ' is-selected' : ''}${p.id === dragId ? ' is-dragging' : ''}`}
              transform={`translate(${x},${y})`}
              tabIndex={compact ? -1 : 0}
              role="button"
              aria-pressed={isSel}
              aria-label={`${showTimeLabels ? tl(p.timePoint) + ', ' : ''}${p.turningPoint ? '전환점, ' : ''}${p.title || '이름 없는 순간'}, 마음 ${signed(p.emotionScore)} ${scoreWord(p.emotionScore)}${editable ? '. 화살표 키로 옮길 수 있어요' : ''}`}
              onPointerDown={(e) => onPointDown(e, p.id)}
              onPointerMove={(e) => onPointMove(e, p)}
              onPointerUp={() => onPointUp(p.id)}
              onPointerCancel={() => { drag.current = null; setDragId(null) }}
              onClick={(e) => {
                e.stopPropagation()
                if (!editable) select(isSel ? null : p.id)
              }}
              onKeyDown={(e) => onPointKey(e, p)}
            >
              {!compact && <circle r={24} className="g-hit" />}
              {p.turningPoint && !compact
                ? <path d={starPath(isSel ? 15 : 12)} className="g-dot g-star" />
                : <circle r={compact ? 3.5 : isSel ? 11 : 8} className="g-dot" />}
              {label && (
                <text x={label.dx} y={label.dy} textAnchor="middle" className="g-label">{label.text}</text>
              )}
            </g>
          )
        })}

        {/* 끄는 동안: 손가락에 가리지 않게 점 위에 지금 자리를 띄우고, 축까지 안내선 */}
        {dragging && (
          <g className="g-drag" aria-hidden="true">
            <line x1={dragging.x} x2={dragging.x} y1={dragging.y} y2={h - f.b} />
            <line x1={f.l} x2={dragging.x} y1={dragging.y} y2={dragging.y} />
            <g transform={`translate(${Math.min(w - 4 - bubbleW / 2, Math.max(4 + bubbleW / 2, dragging.x))},${dragging.y > 70 ? dragging.y - 54 : dragging.y + 30})`}>
              <rect x={-bubbleW / 2} y={-15} width={bubbleW} height={30} rx={15} />
              <text y={5} textAnchor="middle">{dragText}</text>
            </g>
          </g>
        )}

        {!compact && sorted.length === 0 && (
          // 0선 아래, 그래프 칸 가운데: 위쪽 오른끝의 ‘지금의 나’ 이름표와 겹치지 않게
          <text x={(f.l + w - f.r) / 2} y={y0 + 36} textAnchor="middle" className={narrow ? 'g-empty is-narrow' : 'g-empty'}>
            {emptyText ?? (editable ? '빈 곳을 눌러 첫 순간을 찍어봐요' : '아직 그려진 순간이 없어요')}
          </text>
        )}
      </svg>

      {!compact && !editable && selected && (
        <div className="graph-note" role="status">
          <span className="note-meta">
            {showTimeLabels && <>{tl(selected.timePoint)} · </>}
            {selected.emotionLabel && <>{selected.emotionLabel} · </>}
            마음 {signed(selected.emotionScore)} ({scoreWord(selected.emotionScore)})
          </span>
          <strong>{selected.turningPoint && <span className="turning-tag">★ 전환점</span>}{selected.title || '이름 없는 순간'}</strong>
          {selected.description && <p>{selected.description}</p>}
        </div>
      )}
    </div>
  )
}
