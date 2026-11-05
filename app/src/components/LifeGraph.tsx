import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { GraphPoint, TimeScale } from '../types'
import { sortEntries } from '../store'
import { invert, layoutLabels, smoothPath, spreadSameTime, sx, sy, ticks, type Frame } from '../graph'
import { SEASON_NAME, scoreWord, seasonOf, signed, timeLabel, type Season } from '../content'

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

interface Props {
  points: GraphPoint[]
  timeScale: TimeScale
  start: number
  end: number
  showTimeLabels?: boolean
  compact?: boolean
  editable?: boolean
  selectedId?: string | null
  emptyText?: string
  /** 겹쳐 볼 지난 선 (점선, 누를 수 없음) */
  ghost?: GraphPoint[]
  /** 내 선의 색 (CSS 색) */
  tone?: string
  onSelect?: (id: string | null) => void
  onMove?: (id: string, timePoint: number, score: number) => void
  onAdd?: (timePoint: number, score: number) => void
}

export default function LifeGraph({
  points, timeScale, start, end, showTimeLabels = true, compact, editable,
  selectedId, onSelect, onMove, onAdd, emptyText, ghost, tone,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [w, setW] = useState(640)
  const [innerSel, setInnerSel] = useState<string | null>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
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
  const h = compact ? 120 : narrow ? 290 : 360
  const f: Frame = compact
    ? { w, h, l: 10, r: 10, t: 12, b: 12, start, end }
    : { w, h, l: narrow ? 30 : 44, r: narrow ? 20 : 30, t: 34, b: 42, start, end }

  const sorted = sortEntries(points)
  const xy = spreadSameTime(sorted.map((p) => ({ x: sx(f, p.timePoint), y: sy(f, p.emotionScore) })), compact ? 6 : 18, f.l, w - f.r)
  // 나이 · 연도는 한 달 단위, 월 기준은 한 주(4분의 1달) 단위까지
  const step = timeScale === 'month' ? 4 : 12
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

  const local = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return invert(f, e.clientX - r.left, e.clientY - r.top, step)
  }

  const onPointDown = (e: PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation()
    if (!editable) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 일부 환경에서 포인터가 이미 끝난 경우 — 캡처 없이도 이동은 동작한다
    }
    drag.current = { id, moved: false }
  }
  const onPointMove = (e: PointerEvent, p: GraphPoint) => {
    if (drag.current?.id !== p.id) return
    const { timePoint, score } = local(e)
    if (timePoint !== p.timePoint || score !== p.emotionScore) {
      drag.current.moved = true
      onMove?.(p.id, timePoint, score)
    }
  }
  const onPointUp = (id: string) => {
    if (drag.current && !drag.current.moved) select(sel === id ? null : id)
    drag.current = null
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

  const desc = `${showTimeLabels ? `${timeLabel(timeScale, start)}부터 ${timeLabel(timeScale, end)}까지` : '과거부터 지금까지'}의 인생 그래프. 순간 ${sorted.length}개.`

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
        className={editable ? 'is-editable' : undefined}
      >
        <defs>
          <filter id={`${uidBase}-pencil`} x="-5%" y="-5%" width="110%" height="110%">
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
              ? ticks(start, end, timeScale === 'month' ? (narrow ? 6 : 12) : narrow ? 4 : 8).map((t) => (
                  <text key={t} x={sx(f, t)} y={h - f.b + 20} textAnchor="middle" className="g-tick">
                    {t === end ? '지금' : timeLabel(timeScale, t)}
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
              className={`g-point${isSel ? ' is-selected' : ''}`}
              transform={`translate(${x},${y})`}
              tabIndex={compact ? -1 : 0}
              role="button"
              aria-pressed={isSel}
              aria-label={`${showTimeLabels ? timeLabel(timeScale, p.timePoint) + ', ' : ''}${p.title || '이름 없는 순간'}, 마음 ${signed(p.emotionScore)} ${scoreWord(p.emotionScore)}${editable ? '. 화살표 키로 옮길 수 있어요' : ''}`}
              onPointerDown={(e) => onPointDown(e, p.id)}
              onPointerMove={(e) => onPointMove(e, p)}
              onPointerUp={() => onPointUp(p.id)}
              onPointerCancel={() => (drag.current = null)}
              onClick={(e) => {
                e.stopPropagation()
                if (!editable) select(isSel ? null : p.id)
              }}
              onKeyDown={(e) => onPointKey(e, p)}
            >
              {!compact && <circle r={24} className="g-hit" />}
              <circle r={compact ? 3.5 : isSel ? 11 : 8} className="g-dot" />
              {label && (
                <text x={label.dx} y={label.dy} textAnchor="middle" className="g-label">{label.text}</text>
              )}
            </g>
          )
        })}

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
            {showTimeLabels && <>{timeLabel(timeScale, selected.timePoint)} · </>}
            {selected.emotionLabel && <>{selected.emotionLabel} · </>}
            마음 {signed(selected.emotionScore)} ({scoreWord(selected.emotionScore)})
          </span>
          <strong>{selected.title || '이름 없는 순간'}</strong>
          {selected.description && <p>{selected.description}</p>}
        </div>
      )}
    </div>
  )
}
