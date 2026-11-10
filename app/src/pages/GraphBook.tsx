import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth, useRepo } from '../auth'
import LifeGraph from '../components/LifeGraph'
import { NOW_QUESTIONS, questionsFor, lineColorOf, rangeLabel, scoreWord, signed, timeLabel } from '../content'
import { formatDate, graphPoints, graphTitle, sortEntries } from '../store'
import type { LifeGraph as Graph } from '../types'

/**
 * 한 권으로 저장: 그래프 · 순간 · 회고 · 지금의 나를 책처럼 이어 붙인 인쇄용 화면.
 * 브라우저의 인쇄 창에서 ‘PDF로 저장’을 고르면 파일 하나가 된다 (따로 라이브러리 없이).
 * 아직 열리지 않은 미래 편지는 담지 않는다.
 */
export default function GraphBook() {
  const { id = '' } = useParams()
  const repo = useRepo()
  const { user } = useAuth()
  const [graph, setGraph] = useState<Graph | null | undefined>(undefined)
  useEffect(() => {
    repo.get(id).then(setGraph, () => setGraph(null))
  }, [id, repo])

  if (graph === undefined) return <p className="container page loading serif">책을 엮는 중이에요…</p>
  if (!graph) {
    return (
      <section className="container page empty-state">
        <h1>이 기록을 찾을 수 없어요</h1>
        <Link to="/my" className="btn btn-primary">기록 모아보기</Link>
      </section>
    )
  }
  const entries = sortEntries(graph.entries)
  const r = graph.currentReflection
  const nowAnswers = NOW_QUESTIONS.filter((q) => q.key !== 'oneLine' && r[q.key].trim())
  const letter = graph.futureLetter
  const letterOpen = letter && Date.parse(letter.openAt) <= Date.now()

  return (
    <article className="container page book">
      <div className="book-bar no-print">
        <Link to={`/graph/${graph.id}`} className="btn btn-text btn-sm">← 그래프로</Link>
        <p className="muted small">인쇄 창에서 ‘대상’을 <strong>PDF로 저장</strong>으로 고르면 파일 하나로 남아요.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>PDF로 저장 · 인쇄</button>
      </div>

      <header className="book-cover">
        <p className="eyebrow en">MY LIFE, MY LINE</p>
        <h1 className="book-title serif">{graphTitle(graph)}</h1>
        <p className="muted">{rangeLabel(graph.timeScale, graph.startPoint, graph.currentPoint)} · 순간 {entries.length}개</p>
        <div className="book-graph">
          <LifeGraph tone={lineColorOf(graph.lineColor)} points={graphPoints(graph)} timeScale={graph.timeScale} start={graph.startPoint} end={graph.currentPoint} stages={graph.stages} />
        </div>
        <p className="muted small">{user ? `${user.nickname} · ` : ''}처음 그린 날 {formatDate(graph.createdAt)} · 엮은 날 {formatDate(new Date().toISOString())}</p>
      </header>

      {entries.map((e, i) => {
        const answers = questionsFor(graph, e).filter((q) => e.reflection[q.key].trim())
        return (
          <section key={e.id} className="book-chapter">
            <p className="book-num">{String(i + 1).padStart(2, '0')} · {timeLabel(graph.timeScale, e.timePoint, [graph.startPoint, graph.currentPoint])}</p>
            <h2 className="serif">{e.turningPoint && <span className="turning-tag">★</span>}{e.title || '이름 없는 순간'}</h2>
            <p className="muted small">{e.emotionLabel && `${e.emotionLabel} · `}마음 {signed(e.emotionScore)} · {scoreWord(e.emotionScore)}</p>
            {e.description && <p className="book-desc">{e.description}</p>}
            {answers.length > 0 && (
              <dl className="book-qa">
                {answers.map((q) => (
                  <div key={q.key}>
                    <dt>{q.q}</dt>
                    <dd className="serif">{e.reflection[q.key]}</dd>
                  </div>
                ))}
                {(graph.myQuestions ?? []).map((q, k) => e.reflection.extra?.[k]?.trim() ? (
                  <div key={`x${k}`}>
                    <dt>{q}</dt>
                    <dd className="serif">{e.reflection.extra[k]}</dd>
                  </div>
                ) : null)}
              </dl>
            )}
          </section>
        )
      })}

      {(nowAnswers.length > 0 || r.oneLine.trim() || letter) && (
        <section className="book-chapter book-now">
          <p className="book-num">지금의 나</p>
          {r.oneLine.trim() && <h2 className="serif">{r.oneLine}</h2>}
          {nowAnswers.length > 0 && (
            <dl className="book-qa">
              {nowAnswers.map((q) => (
                <div key={q.key}>
                  <dt>{q.q}</dt>
                  <dd className="serif">{r[q.key]}</dd>
                </div>
              ))}
            </dl>
          )}
          {letter && (letterOpen ? (
            <div className="book-letter">
              <p className="book-num">미래의 나에게 · {formatDate(letter.writtenAt)}에 씀</p>
              <p className="serif">{letter.text}</p>
            </div>
          ) : (
            <p className="muted small">미래의 나에게 쓴 편지는 {formatDate(letter.openAt)}에 열려요. 그때 다시 엮으면 함께 담겨요.</p>
          ))}
        </section>
      )}
    </article>
  )
}

/**
 * 실험: A4 한 장 — 그래프 · 순간 목록(시점 · 마음 · 전환점) · 지금의 나 한 줄을 한 장에.
 * 회고(그때의 마음)는 담지 않는다 (게시판 · 교실에 붙여도 되게).
 */
export function GraphSheet() {
  const { id = '' } = useParams()
  const repo = useRepo()
  const { user } = useAuth()
  const [graph, setGraph] = useState<Graph | null | undefined>(undefined)
  useEffect(() => {
    repo.get(id).then(setGraph, () => setGraph(null))
  }, [id, repo])
  if (graph === undefined) return <p className="container page loading serif">한 장으로 엮는 중이에요…</p>
  if (!graph) return <section className="container page empty-state"><h1>이 기록을 찾을 수 없어요</h1><Link to="/my" className="btn btn-primary">기록 모아보기</Link></section>
  const entries = sortEntries(graph.entries)
  const r = graph.currentReflection
  return (
    <article className="container page sheet">
      <div className="book-bar no-print">
        <Link to={`/graph/${graph.id}`} className="btn btn-text btn-sm">← 그래프로</Link>
        <p className="muted small">A4 세로 한 장이에요. 그때의 마음(회고)은 담지 않아요.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>인쇄 · PDF로 저장</button>
      </div>
      <header className="sheet-head">
        <h1 className="serif">{graphTitle(graph)}</h1>
        <p className="muted small">{rangeLabel(graph.timeScale, graph.startPoint, graph.currentPoint)} · 순간 {entries.length}개{user ? ` · ${user.nickname}` : ''} · {formatDate(new Date().toISOString())}</p>
      </header>
      <div className="sheet-graph">
        <LifeGraph tone={lineColorOf(graph.lineColor)} points={graphPoints(graph)} timeScale={graph.timeScale} start={graph.startPoint} end={graph.currentPoint} stages={graph.stages} />
      </div>
      {entries.length > 0 && (
        <ol className="sheet-moments">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="sheet-time">{timeLabel(graph.timeScale, e.timePoint, [graph.startPoint, graph.currentPoint])}</span>
              <strong>{e.turningPoint && <span className="turning-tag">★</span>}{e.title || '이름 없는 순간'}</strong>
              <span className="muted">{e.emotionLabel && `${e.emotionLabel} · `}{signed(e.emotionScore)}</span>
            </li>
          ))}
        </ol>
      )}
      {(r.oneLine.trim() || r.word.trim()) && (
        <footer className="sheet-now">
          <p className="eyebrow">지금의 나</p>
          {r.oneLine.trim() && <p className="serif">{r.oneLine}</p>}
          {r.word.trim() && <p className="muted small">나를 닮은 단어 · {r.word}</p>}
        </footer>
      )}
    </article>
  )
}
