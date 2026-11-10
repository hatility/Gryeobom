import { useEffect, useState, type CSSProperties } from 'react'
import MoodWords, { topWords } from '../components/MoodWords'
import { useLabs } from '../labs'
import { api } from '../api'
import { Link, useParams } from 'react-router'
import type { Answer } from '../api'
import { useAuth, useRepo } from '../auth'
import { MOOD_COLORS, moodOf, scoreWord, signed } from '../content'
import { exportReviewCard, type ReviewData } from '../graph'
import { useJournal } from '../journal'
import { graphTitle } from '../store'
import type { LifeGraph } from '../types'

/** 그 해에 놓인 순간: 달 · 연도 기준 그래프만 (나이 기준은 언제인지 정확히 알 수 없어 뺀다) */
function momentsIn(graphs: LifeGraph[], year: number) {
  return graphs.flatMap((g) =>
    g.timeScale === 'age'
      ? []
      : g.entries
          .filter((e) => (g.timeScale === 'hour' ? new Date(e.timePoint * 3_600_000).getUTCFullYear() : Math.floor((g.timeScale === 'month' ? e.timePoint / 12 : e.timePoint) + 1e-6)) === year)
          .map((e) => ({ title: e.title || '이름 없는 순간', score: e.emotionScore, graph: graphTitle(g) })),
  )
}

/** 연말 돌아보기: 한 해의 한 줄 · 마음 색 · 가장 환했던 / 무거웠던 순간을 한 장으로 */
export default function YearReview() {
  const { year: y } = useParams()
  const now = new Date()
  const year = Math.min(now.getFullYear(), Math.max(2000, Number(y) || now.getFullYear()))
  const journal = useJournal()
  const repo = useRepo()
  const [answers, setAnswers] = useState<Answer[] | null>(null)
  const [graphs, setGraphs] = useState<LifeGraph[]>([])
  const [busy, setBusy] = useState(false)
  const { user } = useAuth()
  const labs = useLabs('me')
  const [cheers, setCheers] = useState(0)
  useEffect(() => {
    if (labs && user) api.cheersOfYear(year).then((r) => setCheers(r.received), () => {})
  }, [labs, user, year])
  useEffect(() => {
    journal.list().then((l) => setAnswers(l.filter((a) => a.day.startsWith(`${year}-`))), () => setAnswers([]))
    repo.list().then(setGraphs, () => setGraphs([]))
  }, [journal, repo, year])

  if (!answers) return <p className="container page loading serif">한 해를 펼치는 중이에요…</p>
  const byDay = new Map(answers.map((a) => [a.day, a]))
  const moments = momentsIn(graphs, year)
  const madeThisYear = graphs.filter((g) => g.createdAt.startsWith(`${year}-`)).length
  const hi = moments.length ? moments.reduce((a, b) => (b.score > a.score ? b : a)) : null
  const lo = moments.length ? moments.reduce((a, b) => (b.score < a.score ? b : a)) : null
  const counts = MOOD_COLORS.map((m) => ({ ...m, n: answers.filter((a) => a.color === m.key).length })).filter((m) => m.n).sort((a, b) => b.n - a.n)
  const sorted = [...answers].sort((a, b) => a.day.localeCompare(b.day))
  const data: ReviewData = {
    year,
    days: answers.length,
    graphs: madeThisYear,
    moments: moments.length,
    colors: Object.fromEntries(answers.filter((a) => moodOf(a.color)).map((a) => [a.day, moodOf(a.color)!.hex])),
    answered: answers.map((a) => a.day),
    top: counts[0] ? { name: counts[0].name, hex: counts[0].hex } : null,
    hi: hi && hi.score > 0 ? hi.title : null,
    lo: lo && lo.score < 0 ? lo.title : null,
    last: sorted.at(-1)?.text ?? null,
    ...(labs ? { words: topWords(graphs.filter((g) => g.createdAt.startsWith(`${year}-`) || g.updatedAt.startsWith(`${year}-`))), cheers } : {}),
  }
  const empty = !answers.length && !moments.length && !madeThisYear
  const save = async () => {
    setBusy(true)
    const blob = await exportReviewCard(data).catch(() => null)
    setBusy(false)
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `그려봄-${year}년-돌아보기.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <section className="container page review">
      <header className="review-head">
        <p className="eyebrow en">MY YEAR, MY LINE</p>
        <h1 className="page-title serif">{year}년의 나</h1>
        <p className="muted">한 해 동안 남긴 한 줄과 마음의 색, 그리고 선 위의 순간들이에요.</p>
        <nav className="review-years" aria-label="다른 해">
          <Link to={`/review/${year - 1}`} className="btn btn-text btn-sm">← {year - 1}년</Link>
          {year < now.getFullYear() && <Link to={`/review/${year + 1}`} className="btn btn-text btn-sm">{year + 1}년 →</Link>}
        </nav>
      </header>

      {empty ? (
        <div className="card empty-state">
          <p className="serif big">{year}년에는 아직 남긴 이야기가 없어요.</p>
          <p className="muted">{user ? '첫 화면의 ‘오늘의 질문’에 한 줄을 남기면, 이 곳이 조금씩 채워져요.' : '오늘의 한 줄은 로그인한 계정에 남아요. 로그인하면 한 해의 마음 색을 모아 볼 수 있어요.'}</p>
          <Link to={user ? '/' : `/login?next=/review/${year}`} className="btn btn-primary">{user ? '오늘의 질문 보러 가기' : '로그인하기'}</Link>
        </div>
      ) : (
        <>
          <ul className="review-stats">
            <li><strong>{answers.length}</strong><span>일 동안 한 줄을 남겼어요</span></li>
            <li><strong>{madeThisYear}</strong><span>개의 선을 새로 그렸어요</span></li>
            <li><strong>{moments.length}</strong><span>개의 순간이 이 해에 놓였어요</span></li>
          </ul>

          <section className="card review-colors">
            <h2 className="card-title">마음 색 지도</h2>
            <p className="muted small">한 칸이 하루예요. 고른 색으로 물들고, 색 없이 남긴 날은 옅은 점이에요.</p>
            <ol className="mood-map" aria-label={`${year}년 마음 색`}>
              {Array.from({ length: 12 }, (_, m) => (
                <li key={m}>
                  <span className="mood-map-m">{m + 1}월</span>
                  <span className="mood-map-days">
                    {Array.from({ length: new Date(year, m + 1, 0).getDate() }, (_, d) => {
                      const day = `${year}-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`
                      const a = byDay.get(day)
                      const mood = moodOf(a?.color)
                      return <i key={d} className={a ? (mood ? 'is-color' : 'is-on') : ''} style={mood ? ({ '--mood': mood.hex } as CSSProperties) : undefined} title={a ? `${m + 1}월 ${d + 1}일 · ${a.text}` : undefined} />
                    })}
                  </span>
                </li>
              ))}
            </ol>
            {counts.length > 0 && (
              <p className="review-top">
                가장 많이 고른 색은 <span className="mood-chip" style={{ '--mood': counts[0].hex } as CSSProperties}>{counts[0].name}</span>
                {counts.slice(1, 4).map((c) => <span key={c.key} className="mood-chip is-soft" style={{ '--mood': c.hex } as CSSProperties}>{c.name} {c.n}</span>)}
              </p>
            )}
          </section>

          <div className="review-two">
            {hi && hi.score > 0 && (
              <section className="card review-moment is-hi">
                <p className="eyebrow">가장 환했던 순간</p>
                <p className="serif review-moment-title">{hi.title}</p>
                <small className="muted">{hi.graph} · 마음 {signed(hi.score)} {scoreWord(hi.score)}</small>
              </section>
            )}
            {lo && lo.score < 0 && (
              <section className="card review-moment is-lo">
                <p className="eyebrow">가장 무거웠던 순간</p>
                <p className="serif review-moment-title">{lo.title}</p>
                <small className="muted">{lo.graph} · 마음 {signed(lo.score)} {scoreWord(lo.score)} — 그래도 지나왔어요.</small>
              </section>
            )}
          </div>

          {sorted.length > 0 && (
            <section className="card review-lines">
              <div>
                <p className="eyebrow">처음 남긴 한 줄 · {Number(sorted[0].day.slice(5, 7))}월 {Number(sorted[0].day.slice(8))}일</p>
                <p className="serif">“{sorted[0].text}”</p>
              </div>
              {sorted.length > 1 && (
                <div>
                  <p className="eyebrow">가장 최근의 한 줄 · {Number(sorted.at(-1)!.day.slice(5, 7))}월 {Number(sorted.at(-1)!.day.slice(8))}일</p>
                  <p className="serif">“{sorted.at(-1)!.text}”</p>
                </div>
              )}
            </section>
          )}

          {labs && user && <p className="review-cheers serif center">올해 모임에서 받은 응원 <strong>{cheers}</strong>번</p>}
          <MoodWords graphs={graphs.filter((g) => g.createdAt.startsWith(`${year}-`) || g.updatedAt.startsWith(`${year}-`))} title={`${year}년의 마음 단어`} />

          <div className="review-actions">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '만드는 중…' : '한 장으로 저장하기'}</button>
            <Link to="/my#answers" className="btn btn-ghost">나의 한 줄로</Link>
          </div>
          <p className="muted small center">나이로 그린 그래프는 언제의 순간인지 정확히 알 수 없어 여기에 담지 않았어요.</p>
        </>
      )}
    </section>
  )
}
