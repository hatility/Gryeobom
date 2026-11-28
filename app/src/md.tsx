import { Fragment, type ReactNode } from 'react'

/**
 * 아주 작은 마크다운 (관리자가 올리는 ‘약관 바뀐 점’ 같은 글용).
 * 되는 것: 빈 줄 = 문단, 줄 바꿈 유지, ‘- ’ 목록, ‘1. ’ 번호 목록, ‘## ’ 작은 제목, **굵게**, [글](https://…) 링크.
 * HTML 은 해석하지 않고 글자 그대로 보여 준다 (React 가 이스케이프).
 */
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > i) out.push(s.slice(i, m.index))
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>)
    i = m.index + m[0].length
  }
  if (i < s.length) out.push(s.slice(i))
  return out
}

const BULLET = /^\s*[-*•]\s+/
const NUMBER = /^\s*\d+[.)]\s+/
const HEAD = /^#{1,3}\s+(.+)$/

export function Md({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    const list = BULLET.test(l) ? BULLET : NUMBER.test(l) ? NUMBER : null
    if (list) {
      const items: ReactNode[] = []
      while (i < lines.length && list.test(lines[i])) items.push(<li key={i}>{inline(lines[i].replace(list, ''))}</li>), i++
      nodes.push(list === BULLET ? <ul key={`u${i}`}>{items}</ul> : <ol key={`o${i}`}>{items}</ol>)
      continue
    }
    const h = HEAD.exec(l)
    if (h) { nodes.push(<p key={i} className="mdtext-h">{inline(h[1])}</p>); i++; continue }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBER.test(lines[i]) && !HEAD.test(lines[i])) para.push(lines[i]), i++
    nodes.push(<p key={`p${i}`}>{para.map((x, j) => <Fragment key={j}>{j > 0 && <br />}{inline(x)}</Fragment>)}</p>)
  }
  return <div className={className ? `mdtext ${className}` : 'mdtext'}>{nodes}</div>
}
