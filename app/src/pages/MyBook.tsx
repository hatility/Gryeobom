import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth, useRepo } from '../auth'
import { BookBody } from './GraphBook'
import { formatDate } from '../store'
import type { LifeGraph as Graph } from '../types'

/** 내 기록 한 권 (/my/book): 내가 그린 모든 선을 책 한 권으로 — 그래프마다 새 쪽에서 시작 (인쇄 → PDF 저장) */
export default function MyBook() {
  const repo = useRepo()
  const { user } = useAuth()
  const [graphs, setGraphs] = useState<Graph[] | null>(null)
  useEffect(() => { repo.list().then((l) => setGraphs([...l].sort((a, b) => a.createdAt.localeCompare(b.createdAt))), () => setGraphs([])) }, [repo])
  if (!graphs) return <p className="container page loading serif is-loading">책을 엮는 중이에요…</p>
  if (!graphs.length) return <section className="container page empty-state"><h1>아직 엮을 기록이 없어요</h1><Link to="/graph/new" className="btn btn-primary">나의 그래프 그리기</Link></section>
  const moments = graphs.reduce((n, g) => n + g.entries.length, 0)
  return (
    <article className="container page book my-book">
      <div className="book-bar no-print">
        <Link to="/my" className="btn btn-text btn-sm">← 기록 모아보기</Link>
        <p className="muted small">그래프 {graphs.length}개를 한 권으로 엮었어요. 인쇄 창에서 ‘대상’을 <strong>PDF로 저장</strong>으로 고르면 파일 하나로 남아요.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>인쇄 · PDF로 저장</button>
      </div>
      <header className="book-cover my-book-cover">
        <p className="eyebrow en">MY LINES, ONE BOOK</p>
        <h1 className="book-title serif">{user ? `${user.nickname}의 기록 한 권` : '나의 기록 한 권'}</h1>
        <p className="muted">그래프 {graphs.length}개 · 순간 {moments}개 · {formatDate(graphs[0].createdAt)} ~ {formatDate(graphs.at(-1)!.updatedAt)}</p>
        <ol className="book-toc">{graphs.map((g, i) => <li key={g.id}>{String(i + 1).padStart(2, '0')} · {g.title || '나의 작은 인생 이야기'} <small className="muted">{formatDate(g.createdAt)}</small></li>)}</ol>
      </header>
      {graphs.map((g) => <section key={g.id} className="book-volume"><BookBody graph={g} /></section>)}
    </article>
  )
}
