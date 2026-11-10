import { useEffect, useRef, useState } from 'react'
import { loadView, saveView, type TextSize, type Theme, type View } from '../view'
import { useLabs } from '../labs'

const THEMES: [Theme, string][] = [['auto', '자동'], ['light', '밝게'], ['dark', '늦은 밤']]
const SIZES: [TextSize, string][] = [['sm', '작게'], ['md', '보통'], ['lg', '크게']]

/** 헤더의 ‘보기’ 버튼: 화면 밝기와 글자 크기. 이 기기에만 기억한다. */
export default function ViewSettings() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="view-settings" ref={ref}>
      <button
        type="button"
        className="btn btn-text btn-sm view-btn"
        aria-expanded={open}
        aria-label="보기 설정 (화면 밝기 · 글자 크기)"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 0 0 16z" />
        </svg>
        <span className="view-btn-text">보기</span>
      </button>
      {open && (
        <div className="view-pop card" role="dialog" aria-label="보기 설정">
          <ViewPanel />
        </div>
      )}
    </div>
  )
}

/** 화면 밝기 · 조용한 시간 · 글자 크기. PC 는 ‘보기’ 팝업, 모바일은 ‘나’ 화면에 그대로 놓는다 */
export function ViewPanel() {
  const labs = useLabs('graph')
  const [v, setV] = useState<View>(loadView)
  const set = (p: Partial<View>) => {
    const next = { ...v, ...p }
    setV(next)
    saveView(next)
  }
  return (
    <>
      <fieldset className="field">
        <legend className="field-label">화면 밝기</legend>
        <div className="segmented">
          {THEMES.map(([t, label]) => (
            <label key={t} className="seg">
              <input type="radio" name="view-theme" checked={v.theme === t} onChange={() => set({ theme: t })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <small className="muted">자동은 밤 9시가 지나면 은은하게 어두워져요.</small>
      </fieldset>
      {labs && (
        <label className="check view-quiet">
          <input type="checkbox" checked={v.easy} onChange={(e) => set({ easy: e.target.checked })} />
          <span>쉬운 말로 묻기 <small className="muted">그때의 마음 · 지금의 나 질문을 더 짧고 쉬운 말로 바꿔요.</small></span>
        </label>
      )}
      <label className="check view-quiet">
        <input type="checkbox" checked={v.quiet} onChange={(e) => set({ quiet: e.target.checked })} />
        <span>
          조용한 시간 <small className="muted">밤 10시 ~ 새벽 5시엔 움직임을 멈추고 더 잔잔하게, 질문도 잠들기 전에 어울리는 것으로 바꿔요.</small>
        </span>
      </label>
      <fieldset className="field">
        <legend className="field-label">글자 크기</legend>
        <div className="segmented">
          {SIZES.map(([s, label]) => (
            <label key={s} className="seg">
              <input type="radio" name="view-text" checked={v.text === s} onChange={() => set({ text: s })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}
