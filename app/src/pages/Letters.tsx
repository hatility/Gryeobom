import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useRepo } from '../auth'
import { formatDate, graphTitle, sortEntries } from '../store'
import { timeLabel } from '../content'
import type { LifeGraph } from '../types'

type Letter = { kind: '미래의 나에게' | '그때의 나에게' | '그때의 내가'; text: string; from: string; when: string; to: string; locked?: string }

/** 편지함 (/letters): 미래의 나에게 쓴 편지 · 그때의 나와 주고받은 말을 한 곳에 (어디에도 나가지 않아요) */
export default function Letters() {
  const repo = useRepo()
  const [graphs, setGraphs] = useState<LifeGraph[] | null>(null)
  useEffect(() => { repo.list().then(setGraphs, () => setGraphs([])) }, [repo])
  if (!graphs) return <p className="container page loading serif is-loading">편지함을 여는 중이에요…</p>
  const letters: Letter[] = []
  for (const g of graphs) {
    const to = `/graph/${g.id}`
    if (g.futureLetter) {
      const open = Date.parse(g.futureLetter.openAt) <= Date.now()
      letters.push({ kind: '미래의 나에게', text: open ? g.futureLetter.text : '', from: `${formatDate(g.futureLetter.writtenAt)}에 씀`, when: graphTitle(g), to, locked: open ? undefined : formatDate(g.futureLetter.openAt) })
    }
    for (const e of sortEntries(g.entries)) {
      const when = `${timeLabel(g.timeScale, e.timePoint, [g.startPoint, g.currentPoint])} · ${e.title || '이름 없는 순간'}`
      if (e.reflection.toPast.trim()) letters.push({ kind: '그때의 나에게', text: e.reflection.toPast, from: graphTitle(g), when, to })
      if (e.reflection.fromPast.trim()) letters.push({ kind: '그때의 내가', text: e.reflection.fromPast, from: graphTitle(g), when, to })
    }
  }
  return (
    <section className="container page letters-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">LETTERS TO MYSELF</p>
          <h1 className="page-title">편지함</h1>
          <p className="muted">{letters.length ? `${letters.length}통 · 미래의 나에게 쓴 편지와 그때의 나와 주고받은 말. 나만 볼 수 있어요.` : '아직 편지가 없어요. 그때의 마음 단계에서 그때의 나에게 한마디를, 마지막 단계에서 미래의 나에게 편지를 남길 수 있어요.'}</p>
        </div>
      </header>
      {!letters.length && <div className="empty-state"><Link to="/graph/new" className="btn btn-primary">나의 그래프 그리기</Link></div>}
      <ul className="letters">
        {letters.map((l, i) => (
          <li key={i} className={`letter-card${l.locked ? ' is-locked' : ''}`}>
            <p className="eyebrow">{l.kind}</p>
            {l.locked ? <p className="serif letter-locked">{l.locked}에 열려요.</p> : <p className="serif letter-text">{l.text}</p>}
            <p className="muted small letter-meta">{l.when} · {l.from} · <Link to={l.to}>그래프 보기</Link></p>
          </li>
        ))}
      </ul>
    </section>
  )
}
