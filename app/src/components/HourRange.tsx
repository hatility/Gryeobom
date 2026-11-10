import { useState } from 'react'
import { hourInput, hourOf } from '../content'

/**
 * ‘시간으로’ 고르기: 날짜 하나 + 시작 · 끝 시각. 며칠에 걸치면 ‘다른 날에 끝나요’ 로 끝 날짜를 따로.
 * 값은 TimeScale hour 수 (hourInput · hourOf 와 같은 형식). whole: 시 단위만 (모임 미리 정하기)
 */
export default function HourRange({ start, end, onChange, whole = false }: {
  start: number; end: number; onChange: (start: number, end: number) => void; whole?: boolean
}) {
  const s = hourInput(start), e = hourInput(end)
  const [split, setSplit] = useState(s.slice(0, 10) !== e.slice(0, 10))
  const at = (date: string, time: string) => {
    const v = hourOf(`${date}T${time}`)
    return v === null ? null : whole ? Math.floor(v) : v
  }
  const set = (sd: string, st: string, ed: string, et: string) => {
    const a = at(sd, st), b = at(split ? ed : sd, et)
    if (a !== null && b !== null) onChange(a, b)
  }
  const step = whole ? 3600 : 600
  return (
    <div className="hour-range">
      <div className="field-row hour-dates">
        <label className="field">
          <span className="field-label">{split ? '시작 날짜' : '날짜'}</span>
          <input type="date" required value={s.slice(0, 10)} onChange={(x) => x.target.value && set(x.target.value, s.slice(11), e.slice(0, 10), e.slice(11))} />
        </label>
        {split && (
          <label className="field">
            <span className="field-label">끝 날짜</span>
            <input type="date" required min={s.slice(0, 10)} value={e.slice(0, 10)} onChange={(x) => x.target.value && set(s.slice(0, 10), s.slice(11), x.target.value, e.slice(11))} />
          </label>
        )}
      </div>
      <div className="field-row hour-times">
        <label className="field">
          <span className="field-label">시작 시각</span>
          <input type="time" required step={step} value={s.slice(11)} onChange={(x) => x.target.value && set(s.slice(0, 10), x.target.value, e.slice(0, 10), e.slice(11))} />
        </label>
        <label className="field">
          <span className="field-label">끝 시각</span>
          <input type="time" required step={step} value={e.slice(11)} onChange={(x) => x.target.value && set(s.slice(0, 10), s.slice(11), e.slice(0, 10), x.target.value)} />
        </label>
      </div>
      <label className="check hour-split">
        <input type="checkbox" checked={split} onChange={(x) => {
          setSplit(x.target.checked)
          // 같은 날로 되돌리면 끝 날짜를 시작 날짜로
          if (!x.target.checked) { const b = at(s.slice(0, 10), e.slice(11)); if (b !== null) onChange(start, b) }
        }} />
        <span>다른 날에 끝나요</span>
      </label>
    </div>
  )
}
