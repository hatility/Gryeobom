import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Answer } from '../api'
import { useAuth, useRepo } from '../auth'
import { useJournal } from '../journal'
import LifeGraph from '../components/LifeGraph'
import { topWords } from '../components/MoodWords'
import { lineColorOf, scoreWord, signed } from '../content'
import { formatDate, graphPoints, graphTitle } from '../store'
import type { LifeGraph as Graph } from '../types'

/** 내 흐름 (/me/overview): 내가 그린 모든 선을 숫자 몇 개와 선 한 줄로 — 비교가 아니라 흐름 */
export default function Overview() {
  const repo = useRepo()
  const { user } = useAuth()
  const journal = useJournal()
  const [graphs, setGraphs] = useState<Graph[] | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [cheers, setCheers] = useState<number | null>(null)
  useEffect(() => {
    repo.list().then(setGraphs, () => setGraphs([]))
    journal.list().then(setAnswers, () => setAnswers([]))
    if (user) api.cheersOfYear(new Date().getFullYear()).then((r) => setCheers(r.received), () => setCheers(null))
  }, [repo, journal, user])
  if (!graphs) return <p className="container page loading serif is-loading">흐름을 모으는 중이에요…</p>
  const moments = graphs.flatMap((g) => g.entries.map((e) => ({ ...e, g })))
  const avg = moments.length ? moments.reduce((n, e) => n + e.emotionScore, 0) / moments.length : 0
  const hi = moments.reduce<typeof moments[number] | null>((a, e) => (!a || e.emotionScore > a.emotionScore ? e : a), null)
  const lo = moments.reduce<typeof moments[number] | null>((a, e) => (!a || e.emotionScore < a.emotionScore ? e : a), null)
  const latest = [...graphs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const first = [...graphs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  const words = topWords(graphs, 6)
  const kpi: [string, string, string][] = [
    ['그린 선', `${graphs.length}`, `완성 ${graphs.filter((g) => g.completed).length}`],
    ['남긴 순간', `${moments.length}`, moments.length ? `평균 마음 ${signed(Math.round(avg * 10) / 10)} · ${scoreWord(Math.round(avg))}` : ''],
    ['오늘의 한 줄', `${answers.length}`, answers.length ? `마지막 ${formatDate(answers.map((a) => a.day).sort().at(-1)!)}` : ''],
    ...(cheers !== null ? [['올해 받은 응원', `${cheers}`, '누가 보냈는지는 보이지 않아요'] as [string, string, string]] : []),
  ]
  return (
    <section className="container page overview-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">MY FLOW</p>
          <h1 className="page-title">내 흐름</h1>
          <p className="muted">{first ? `${formatDate(first.createdAt)}에 첫 선을 그렸어요. 남과 비교하지 않고, 지난 나와만 나란히.` : '아직 그린 선이 없어요.'}</p>
        </div>
      </header>
      {!graphs.length && <div className="empty-state"><Link to="/graph/new" className="btn btn-primary">나의 그래프 그리기</Link></div>}
      {graphs.length > 0 && (<>
        <ul className="overview-kpi">
          {kpi.map(([k, v, s]) => <li key={k} className="card"><span className="muted small">{k}</span><strong>{v}</strong>{s && <small className="muted">{s}</small>}</li>)}
        </ul>
        {latest && (
          <section className="card graph-card">
            <p className="eyebrow en">LATEST LINE</p>
            <h2 className="card-title">{graphTitle(latest)} <small className="muted">{formatDate(latest.updatedAt)}</small></h2>
            <LifeGraph tone={lineColorOf(latest.lineColor)} points={graphPoints(latest)} timeScale={latest.timeScale} start={latest.startPoint} end={latest.currentPoint} stages={latest.stages} />
          </section>
        )}
        <div className="overview-two">
          {hi && lo && (
            <section className="card">
              <h2 className="card-title">가장 환했던 때 · 가장 무거웠던 때</h2>
              <ul className="entry-list">
                <li className="entry-item"><span className="entry-body"><strong>{hi.title || '이름 없는 순간'} <small>{signed(hi.emotionScore)}</small></strong><small>{graphTitle(hi.g)}</small></span><span className="entry-actions"><Link to={`/graph/${hi.g.id}`} className="btn btn-text btn-sm">보기 ›</Link></span></li>
                <li className="entry-item"><span className="entry-body"><strong>{lo.title || '이름 없는 순간'} <small>{signed(lo.emotionScore)}</small></strong><small>{graphTitle(lo.g)}</small></span><span className="entry-actions"><Link to={`/graph/${lo.g.id}`} className="btn btn-text btn-sm">보기 ›</Link></span></li>
              </ul>
            </section>
          )}
          {words.length > 0 && (
            <section className="card">
              <h2 className="card-title">자주 쓴 마음 단어</h2>
              <p className="overview-words">{words.map((w) => <Link key={w} to="/words" className="chip">{w}</Link>)}</p>
              <p className="muted small"><Link to="/words">마음 서랍 열기 ›</Link></p>
            </section>
          )}
        </div>
        <p className="muted small center">더 보기 · <Link to="/lines">오늘의 한 줄 모아보기</Link> · <Link to="/letters">편지함</Link> · <Link to={`/review/${new Date().getFullYear()}`}>한 해 돌아보기</Link></p>
      </>)}
    </section>
  )
}
