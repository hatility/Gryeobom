import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { useJournal } from '../journal'
import type { Answer } from '../api'

/** 오늘의 한 줄 모아보기 (/lines): 달마다 묶어서, 이어 쓴 날 수와 함께 */
export default function Lines() {
  const { user } = useAuth()
  const journal = useJournal()
  const [list, setList] = useState<Answer[] | null>(null)
  useEffect(() => { journal.list().then((l) => setList([...l].sort((a, b) => b.day.localeCompare(a.day))), () => setList([])) }, [journal])
  if (!user) return <section className="container page empty-state"><p className="serif big">오늘의 한 줄은 로그인한 계정에 남아요.</p><Link to="/login?next=/lines" className="btn btn-primary">로그인</Link></section>
  if (!list) return <p className="container page loading serif is-loading">한 줄들을 모으는 중이에요…</p>
  const months = new Map<string, Answer[]>()
  for (const a of list) { const k = a.day.slice(0, 7); months.set(k, [...(months.get(k) ?? []), a]) }
  return (
    <section className="container page lines-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">ONE LINE A DAY</p>
          <h1 className="page-title">오늘의 한 줄 모아보기</h1>
          <p className="muted">{list.length ? `${list.length}줄 · 이어 쓴 날 ${streak(list)}일` : '아직 남긴 한 줄이 없어요. 첫 화면의 오늘의 질문에 한 줄을 남겨 봐요.'}</p>
        </div>
      </header>
      {!list.length && <div className="empty-state"><Link to="/" className="btn btn-primary">오늘의 질문으로</Link></div>}
      {[...months.entries()].map(([m, rows]) => (
        <section key={m} className="lines-month">
          <h2 className="section-title">{m.slice(0, 4)}년 {Number(m.slice(5))}월 <small className="muted">{rows.length}줄</small></h2>
          <ol className="lines-list">
            {rows.map((a) => (
              <li key={a.day} className="card lines-item" style={a.color ? { '--dot': a.color } as React.CSSProperties : undefined}>
                <time className="lines-day" dateTime={a.day}>{Number(a.day.slice(8))}일</time>
                <div>
                  <p className="muted small lines-q">{a.question}</p>
                  <p className="serif lines-text">{a.text}</p>
                </div>
                <Link to={`/my#answers`} className="btn btn-text btn-sm">순간으로 옮기기 ›</Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </section>
  )
}

/** 오늘(또는 어제)부터 거꾸로 이어진 날 수 */
function streak(list: Answer[]) {
  const days = new Set(list.map((a) => a.day))
  let n = 0
  const d = new Date()
  const key = () => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (!days.has(key())) d.setDate(d.getDate() - 1)
  while (days.has(key())) { n++; d.setDate(d.getDate() - 1) }
  return n
}
