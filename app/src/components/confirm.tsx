import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * 브라우저 confirm() 대신 그려봄 모양의 물음 창 (1.3.0). 돌아오는 값은 같다: 네 → true, 아니요 · Esc → false.
 *   if (!await confirmDialog('지울까요?')) return
 */
export function confirmDialog(text: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let settled = false
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      resolve(v)
      // 닫힘 이벤트 처리가 끝난 뒤에 치운다
      setTimeout(() => { root.unmount(); host.remove() }, 0)
    }
    root.render(<ConfirmBox text={text} ok={opts.ok ?? '네'} danger={!!opts.danger || /지울|지워|없앨|끊을|내릴|비울|뺄/.test(text)} onDone={done} />)
  })
}

function ConfirmBox({ text, ok, danger, onDone }: { text: string; ok: string; danger: boolean; onDone: (v: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    d.showModal()
    d.querySelector<HTMLElement>('.confirm-no')?.focus()
  }, [])
  return (
    <dialog ref={ref} className="dialog confirm-dialog" aria-labelledby="confirm-text" onCancel={(e) => { e.preventDefault(); onDone(false) }} onClose={() => onDone(false)}>
      <p id="confirm-text" className="confirm-text serif">{text}</p>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost confirm-no" onClick={() => onDone(false)}>아니요</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onDone(true)}>{ok}</button>
      </div>
    </dialog>
  )
}
