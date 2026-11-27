import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useRepo } from '../auth'
import { graphTitle, sortEntries } from '../store'
import { timeLabel } from '../content'
import type { LifeGraph } from '../types'

/** 마음 서랍 (/words): 순간마다 고른 감정 · ‘지금의 나’ 단어를 서랍처럼 — 단어를 열면 그 마음이 담긴 순간들 */
export default function Words() {
  const repo = useRepo()
  const [graphs, setGraphs] = useState<LifeGraph[] | null>(null)
  const [open, setOpen] = useState('')
  useEffect(() => { repo.list().then(setGraphs, () => setGraphs([])) }, [repo])
  if (!graphs) return <p className="container page loading serif is-loading">서랍을 여는 중이에요…</p>
  const drawers = new Map<string, { graph: LifeGraph; title: string; when: string; score: number; to: string }[]>()
  for (const g of graphs) {
    for (const e of sortEntries(g.entries)) {
      const w = e.emotionLabel.trim()
      if (w) drawers.set(w, [...(drawers.get(w) ?? []), { graph: g, title: e.title || '이름 없는 순간', when: timeLabel(g.timeScale, e.timePoint, [g.startPoint, g.currentPoint]), score: e.emotionScore, to: `/graph/${g.id}` }])
    }
    const w = g.currentReflection.word.trim()
    if (w) drawers.set(w, [...(drawers.get(w) ?? []), { graph: g, title: '지금의 나를 닮은 단어', when: graphTitle(g), score: 0, to: `/graph/${g.id}` }])
  }
  const words = [...drawers.entries()].sort((a, b) => b[1].length - a[1].length)
  const cur = open && drawers.get(open)
  return (
    <section className="container page words-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">DRAWERS OF FEELINGS</p>
          <h1 className="page-title">마음 서랍</h1>
          <p className="muted">{words.length ? `${words.length}칸 · 서랍을 열면 그 마음이 담긴 순간이 나와요. 나만 볼 수 있어요.` : '아직 서랍이 비어 있어요. 순간마다 그때의 감정을 고르면 여기에 모여요.'}</p>
        </div>
      </header>
      {!words.length && <div className="empty-state"><Link to="/graph/new" className="btn btn-primary">나의 그래프 그리기</Link></div>}
      <ul className="drawers" aria-label="마음 단어">
        {words.map(([w, list]) => (
          <li key={w}>
            <button type="button" className={`drawer${open === w ? ' is-open' : ''}`} aria-expanded={open === w} onClick={() => setOpen(open === w ? '' : w)} style={{ '--n': Math.min(1, list.length / (words[0][1].length || 1)) } as React.CSSProperties}>
              <span className="drawer-knob" aria-hidden="true" />
              <b>{w}</b><small>{list.length}</small>
            </button>
          </li>
        ))}
      </ul>
      {cur && (
        <section className="card drawer-open" aria-live="polite">
          <h2 className="card-title">‘{open}’ 서랍 <small className="muted">{cur.length}개</small></h2>
          <ul className="entry-list">
            {cur.map((m, i) => (
              <li key={i} className="entry-item">
                <span className="entry-body"><strong>{m.title}</strong><small>{m.when} · {graphTitle(m.graph)}</small></span>
                <span className="entry-actions"><Link to={m.to} className="btn btn-text btn-sm">보기 ›</Link></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
