import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useLabs } from '../labs'
import { api, shareBase, type GroupSummary } from '../api'
import { useAuth, useRepo } from '../auth'
import LifeGraph from '../components/LifeGraph'
import { NOW_QUESTIONS, questionsFor, lineColorOf, sinceLabel, rangeLabel, scoreWord, signed, timeLabel } from '../content'
import { exportImage, exportStoryCard, exportYearCard, loadHand, CARD_THEMES, type CardTheme } from '../graph'
import { GROUP_POST, encodeShared, toShared, type PostOptions, type SharedGraph } from '../share'
import { formatDate, graphPoints, graphTitle, normalizeGraph, sortEntries } from '../store'
import type { LifeGraph as Graph, Visibility } from '../types'

export default function GraphResult() {
  const { id = '' } = useParams()
  const repo = useRepo()
  const done = useSearchParams()[0].get('done') === '1'
  const [graph, setGraph] = useState<Graph | null | undefined>(undefined)
  const exportRef = useRef<HTMLDialogElement>(null)
  const shareRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    repo.get(id).then(setGraph, () => setGraph(null))
  }, [id, repo])

  // 지난 선과 나란히 보기: 내가 그린 다른 그래프 (남과 비교하지 않고, 지난 나와만)
  const [others, setOthers] = useState<Graph[]>([])
  const [ghostId, setGhostId] = useState('')
  // 지난 모습을 점선으로 겹쳐 보기
  const [verGhost, setVerGhost] = useState<Graph | null>(null)

  // 다시 찾아왔을 때: 완성한 그래프를 7일 넘게 지나 다시 열면 그동안의 안부를 묻는다 (이 기기 기준)
  const [since, setSince] = useState<number | null>(null)
  useEffect(() => {
    if (!graph || done) return
    const key = `geuryeobom:visit:${graph.id}`
    let prev = Date.parse(graph.updatedAt)
    try {
      const v = Number(localStorage.getItem(key))
      if (v) prev = v
      localStorage.setItem(key, String(Date.now()))
    } catch {
      /* 기억하지 못하면 마지막으로 고친 날 기준 */
    }
    const days = Math.floor((Date.now() - prev) / 86_400_000)
    setSince(graph.completed && days >= 7 ? days : null)
  }, [graph?.id])
  useEffect(() => {
    repo.list().then(setOthers, () => setOthers([]))
  }, [repo])
  // 같은 기간을 다시 그린 그래프는 처음 그린 선과 겹쳐 보는 것부터
  useEffect(() => {
    setGhostId(graph?.redrawOf ?? '')
  }, [graph?.id])

  if (graph === undefined) return <p className="container page loading serif">기록을 펼치는 중이에요…</p>
  if (!graph) {
    return (
      <section className="container page empty-state">
        <p className="eyebrow en">LOST LINE</p>
        <h1>이 기록을 찾을 수 없어요</h1>
        <p className="muted">
          {repo.remote
            ? '지워졌거나 다른 계정의 기록일 수 있어요.'
            : '로그인하지 않고 그린 기록은 처음 그린 기기의 브라우저에만 있어요. 다른 기기나 브라우저라면 보이지 않을 수 있어요.'}
        </p>
        <Link to="/my" className="btn btn-primary">기록 모아보기</Link>
      </section>
    )
  }

  const sorted = sortEntries(graph.entries)
  const comparable = others.filter((o) => o.id !== graph.id && o.timeScale === graph.timeScale && graphPoints(o).length > 1)
  const ghost = verGhost ?? comparable.find((o) => o.id === ghostId)
  // 그때의 나에게 건넨 말은 엽서로 따로 모은다 (아래 순간 목록에서는 빼서 두 번 보이지 않게)
  const letters = sorted.filter((e) => e.reflection.toPast.trim() || e.reflection.fromPast.trim())
  const r = graph.currentReflection
  const letter = NOW_QUESTIONS.filter((q) => q.key !== 'oneLine' && q.key !== 'word' && r[q.key].trim())
  const setVisibility = async (visibility: Visibility) => {
    const g = { ...graph, visibility, updatedAt: new Date().toISOString() }
    const ok = await repo.save(g)
    if (ok) setGraph(g)
    return ok
  }

  return (
    <article className="container page result">
      <header className="result-head">
        <p className="eyebrow en">MY LINE, MY STORY</p>
        <h1 className="page-title">{graphTitle(graph)}</h1>
        <p className="muted">
          {rangeLabel(graph.timeScale, graph.startPoint, graph.currentPoint)} · 처음 그린 날 {formatDate(graph.createdAt)}
          {graph.updatedAt.slice(0, 10) !== graph.createdAt.slice(0, 10) && <> · 마지막으로 고친 날 {formatDate(graph.updatedAt)}</>}
        </p>
        {!graph.completed && <p className="badge">아직 그리는 중이에요</p>}
      </header>

      {done && (
        <section className="done-card" role="status">
          <p className="eyebrow en">THE LINE IS DRAWN</p>
          <p className="serif done-title">여기까지 와 줘서 고마워요.</p>
          <p className="muted">이 선에는 당신만의 이야기가 담겨 있어요. 언제든 다시 와서 고쳐 그려도 괜찮아요.</p>
          {graph.groupId && (
            <p className="muted small">
              모임에 함께 나눴어요. 고친 내용도 모임에 바로 보여요. <Link to={`/groups/${graph.groupId}`}>모임에서 보기</Link>
            </p>
          )}
        </section>
      )}

      {since !== null && (
        <section className="revisit" role="status">
          <p className="serif revisit-title">{sinceLabel(since)} 만에 다시 왔네요.</p>
          <p className="muted small">그동안 마음에 남은 순간이 있었나요?</p>
          <Link to={`/graph/${graph.id}/edit?step=2`} className="btn btn-ghost btn-sm">순간 더하기</Link>
        </section>
      )}

      <section className={`card graph-card${done ? ' is-done' : ''}`}>
        <LifeGraph tone={lineColorOf(graph.lineColor)}
          points={graphPoints(graph)}
          timeScale={graph.timeScale}
          start={graph.startPoint}
          end={graph.currentPoint}
          ghost={ghost ? graphPoints(ghost) : undefined}
          stages={graph.stages}
        />
        <p className="hint center">점을 눌러 그때의 이야기를 다시 볼 수 있어요.</p>
        {comparable.length > 0 && (
          <div className="field ghost-pick no-print">
            <label className="field-label" htmlFor="ghost">지난 선과 나란히 보기</label>
            <select id="ghost" value={ghostId} onChange={(e) => setGhostId(e.target.value)}>
              <option value="">겹쳐 보지 않기</option>
              {comparable.map((o) => (
                <option key={o.id} value={o.id}>{graphTitle(o)} · {formatDate(o.updatedAt)}</option>
              ))}
            </select>
            {ghost && !verGhost && (
              <p className="muted small ghost-legend">
                <span className="ghost-swatch" aria-hidden="true" />점선은 ‘{graphTitle(ghost)}’ — 지난 나와 나란히.
              </p>
            )}
          </div>
        )}
        <Versions graph={graph} onPreview={setVerGhost} onRestored={(g) => { setVerGhost(null); setGraph(g) }} />
      </section>

      <div className="result-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => shareRef.current?.showModal()}>공유하기</button>
        <div className="result-group" role="group" aria-label="저장 · 인쇄">
          <p className="result-group-title">저장 · 인쇄</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportRef.current?.showModal()}>이미지로 저장</button>
          <Link to={`/graph/${graph.id}/book`} className="btn btn-ghost btn-sm">한 권으로 (PDF)</Link>
          <SheetLink id={graph.id} />
        </div>
        <div className="result-group" role="group" aria-label="고치기">
          <p className="result-group-title">고치기</p>
          <Link to={`/graph/${graph.id}/edit?step=1`} className="btn btn-ghost btn-sm">그래프 수정하기</Link>
          {graph.completed && <Link to={`/graph/new?again=${graph.id}`} className="btn btn-ghost btn-sm">같은 기간 다시 그리기</Link>}
        </div>
      </div>

      <LineStory graph={graph} />

      {(r.oneLine.trim() || r.word.trim()) && (
        <section className="now-card">
          <p className="eyebrow en">ME, NOW</p>
          <blockquote className="serif">{r.oneLine.trim() || r.word}</blockquote>
          {r.oneLine.trim() && r.word.trim() && <p className="muted">지금의 나를 닮은 단어 · <strong>{r.word}</strong></p>}
        </section>
      )}

      {graph.futureLetter && <LetterEnvelope letter={graph.futureLetter} />}

      {letters.length > 0 && (
        <section className="section-tight">
          <h2 className="section-title">그때의 나와 주고받은 말</h2>
          <ul className="postcards">
            {letters.map((e) => (
              <li key={e.id} className="postcard">
                {e.reflection.toPast.trim() && (
                  <div className="postcard-side">
                    <p className="eyebrow">지금의 내가 → {timeLabel(graph.timeScale, e.timePoint, [graph.startPoint, graph.currentPoint])}의 나에게</p>
                    <p className="serif postcard-text">{e.reflection.toPast}</p>
                  </div>
                )}
                {e.reflection.fromPast.trim() && (
                  <div className="postcard-side is-reply">
                    <p className="eyebrow">{timeLabel(graph.timeScale, e.timePoint, [graph.startPoint, graph.currentPoint])}의 내가 → 지금의 나에게</p>
                    <p className="serif postcard-text">{e.reflection.fromPast}</p>
                  </div>
                )}
                <p className="muted small postcard-from">— {e.title || '이름 없는 순간'}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section-tight">
        <h2 className="section-title">나의 순간들</h2>
        {sorted.length ? (
          <ol className="moment-list">
            {sorted.map((e) => {
              const answers = questionsFor(graph, e).filter((q) => q.key !== 'toPast' && q.key !== 'fromPast' && e.reflection[q.key].trim())
              const mine = (graph.myQuestions ?? []).map((q, i) => [q, e.reflection.extra?.[i] ?? ''] as const).filter(([, a]) => a.trim())
              return (
                <li key={e.id} className="card moment">
                  <div className="moment-head">
                    <span className="entry-time">{timeLabel(graph.timeScale, e.timePoint, [graph.startPoint, graph.currentPoint])}</span>
                    <span className="muted small">마음 {signed(e.emotionScore)} · {scoreWord(e.emotionScore)}</span>
                  </div>
                  <h3>{e.turningPoint && <span className="turning-tag" title="전환점">★</span>}{e.title || '이름 없는 순간'}</h3>
                  {e.emotionLabel && <span className="chip chip-static">{e.emotionLabel}</span>}
                  {e.description && <p>{e.description}</p>}
                  {answers.length + mine.length > 0 && (
                    <dl className="reflection">
                      {answers.map((q) => (
                        <div key={q.key}>
                          <dt>{q.q}</dt>
                          <dd>{e.reflection[q.key]}</dd>
                        </div>
                      ))}
                      {mine.map(([q, a]) => (
                        <div key={q}>
                          <dt>{q}</dt>
                          <dd>{a}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {!e.showOnGraph && <p className="muted small">그래프에는 보이지 않는 순간이에요.</p>}
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="muted">적은 순간이 없어요. 언제든 다시 와서 하나씩 적어도 괜찮아요.</p>
        )}
      </section>

      {letter.length > 0 && (
        <section className="card letter">
          <p className="letter-head serif">지금의 나에게</p>
          <dl className="reflection">
            {letter.map((q) => (
              <div key={q.key}>
                <dt>{q.q}</dt>
                <dd>{r[q.key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="closing-text small-closing">이 선에는 당신만의 이야기가 담겨 있어요.</p>

      <ExportDialog dialogRef={exportRef} graph={graph} />
      <ShareDialog dialogRef={shareRef} graph={graph} onVisibility={setVisibility} />
    </article>
  )
}

const defaultIds = (g: Graph) => new Set(g.entries.filter((e) => e.showOnGraph).map((e) => e.id))
const toggleIn = (s: Set<string>, id: string) => {
  const n = new Set(s)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}

function EntryPicker({ graph, ids, onToggle }: { graph: Graph; ids: Set<string>; onToggle: (id: string) => void }) {
  return (
    <ul className="pick-list">
      {sortEntries(graph.entries).map((e) => (
        <li key={e.id}>
          <label className="check">
            <input type="checkbox" checked={ids.has(e.id)} onChange={() => onToggle(e.id)} />
            <span>{timeLabel(graph.timeScale, e.timePoint, [graph.startPoint, graph.currentPoint])} · {e.title || '이름 없는 순간'}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

function ExportDialog({ dialogRef, graph }: { dialogRef: RefObject<HTMLDialogElement | null>; graph: Graph }) {
  const [ids, setIds] = useState(() => defaultIds(graph))
  // 달로 그린 그래프는 ‘올해 카드’도 만들 수 있다
  const yearly = graph.timeScale === 'month'
  // 한 해 안의 1월부터면 ‘N년, 나의 한 해’, 아니면 달 수로 (예전 ‘올해’ 그래프는 monthRange 로)
  const months = graph.currentPoint - graph.startPoint + 1
  const oneYear = graph.monthRange === 'thisYear' || (graph.startPoint % 12 === 0 && Math.floor(graph.startPoint / 12) === Math.floor(graph.currentPoint / 12))
  const heading = oneYear ? `${Math.floor(graph.startPoint / 12)}년, 나의 한 해` : months === 12 ? '나의 열두 달' : `나의 ${months}개월`
  const [format, setFormat] = useState<'wide' | 'story' | 'year'>(yearly && graph.completed ? 'year' : 'story')
  const [withLine, setWithLine] = useState(false)
  const [theme, setTheme] = useState<CardTheme>('paper')
  const [hand, setHand] = useState(false)
  const labs = useLabs('graph')
  const oneLine = graph.currentReflection.oneLine.trim()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = async () => {
    setBusy(true)
    setErr('')
    try {
      const base = {
        title: graphTitle(graph),
        timeScale: graph.timeScale,
        start: graph.startPoint,
        end: graph.currentPoint,
        points: graphPoints(graph, (e) => ids.has(e.id)),
        color: lineColorOf(graph.lineColor),
        theme,
        hand,
      }
      // 손글씨: 이미지에 들어갈 글자의 글꼴 조각을 먼저 받는다
      if (hand) await loadHand([base.title, ...base.points.map((p) => p.title), oneLine, '나의 열두 달 한 해 그려봄 지나온 나를 그리고, 지금의 나를 만나다 MY LINE 0123456789 살 년 월 개월 이름 없는 순간 그때 지금 · → “”'].join(''))
      const blob =
        format === 'story' ? await exportStoryCard({ ...base, line: withLine ? oneLine : undefined })
        : format === 'year' ? await exportYearCard({ ...base, heading, line: withLine ? oneLine : undefined })
        : await exportImage(base)
      if (!blob) throw new Error('no blob')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `그려봄-${graphTitle(graph)}${format === 'story' ? '-카드' : format === 'year' ? (oneYear ? '-올해카드' : '-달카드') : ''}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      dialogRef.current?.close()
    } catch {
      setErr('이미지를 만들지 못했어요. 잠시 뒤에 다시 해볼까요?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog export-dialog" aria-labelledby="export-title">
      <h2 id="export-title" className="card-title">이미지로 저장하기</h2>
      <p className="field-label export-label">모양</p>
      <div className="segmented" aria-label="이미지 모양">
        {([...(yearly ? [['year', oneYear ? '올해 카드' : '달 카드']] as const : []), ['story', '세로 카드 (폰 사진첩용)'], ['wide', '가로 그림']] as const).map(([k, label]) => (
          <label key={k} className="seg">
            <input type="radio" name="export-format" checked={format === k} onChange={() => setFormat(k)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {/* 카드 배경 */}
      {labs && (
        <fieldset className="field export-themes">
          <legend className="field-label export-label">배경</legend>
          <div className="theme-picks">
            {CARD_THEMES.map(([k, label]) => (
              <label key={k} className="theme-pick">
                <input type="radio" className="sr-only" name="card-theme" checked={theme === k} onChange={() => setTheme(k)} />
                <span className={`theme-swatch is-${k}`} aria-hidden="true" />
                <span className="theme-name">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {/* 손글씨 */}
      {labs && (
        <>
          <p className="field-label export-label">글씨</p>
          <div className="segmented" aria-label="글씨">
            {([[false, '기본'], [true, '손글씨']] as const).map(([v, label]) => (
              <label key={label} className="seg">
                <input type="radio" name="export-hand" checked={hand === v} onChange={() => { setHand(v); if (v) loadHand("손글씨").catch(() => {}) }} />
                <span className={v ? 'hand-sample' : undefined}>{label}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <p className="field-label export-label">담을 순간</p>
      <p className="muted small export-note">제목 · 선 · 고른 순간의 이름만 담겨요. 회고는 담기지 않아요.</p>
      {graph.entries.length ? (
        <EntryPicker graph={graph} ids={ids} onToggle={(id) => setIds((s) => toggleIn(s, id))} />
      ) : (
        <p className="muted">아직 순간이 없어서, 빈 선과 제목만 담겨요.</p>
      )}
      {format !== 'wide' && oneLine && (
        <label className="check">
          <input type="checkbox" checked={withLine} onChange={(e) => setWithLine(e.target.checked)} />
          <span>‘지금의 나’ 한 문장도 넣기</span>
        </label>
      )}
      {err && <p className="alert" role="alert">{err}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
          {busy ? '그리는 중…' : '이미지 만들기'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => dialogRef.current?.close()}>닫기</button>
      </div>
    </dialog>
  )
}

function ShareDialog({ dialogRef, graph, onVisibility }: {
  dialogRef: RefObject<HTMLDialogElement | null>; graph: Graph; onVisibility: (v: Visibility) => Promise<boolean>
}) {
  const { user } = useAuth()
  const [mode, setMode] = useState<'group' | 'link'>(user ? 'group' : 'link')
  const [title, setTitle] = useState(graphTitle(graph))
  const [ids, setIds] = useState(() => defaultIds(graph))
  // 그래프의 순간이 바뀌면 (더하거나 되돌리면) 고른 순간도 다시
  const entryKey = graph.entries.map((e) => e.id).join()
  useEffect(() => setIds(defaultIds(graph)), [entryKey])
  const [descriptions, setDescriptions] = useState(false)
  const [time, setTime] = useState(true)
  const close = () => dialogRef.current?.close()
  const shared = () => toShared(graph, { title, entryIds: ids, descriptions, time })
  const options = (): PostOptions => ({ title: title.trim(), entryIds: [...ids], descriptions, time })
  // 나만 보기라면, 나누는 순간 ‘함께 나누기’로 바꾼다 (따로 한 단계 더 거치지 않게)
  const ensureOpen = async () => graph.visibility === 'link' || (await onVisibility('link'))

  return (
    <dialog ref={dialogRef} className="dialog share-dialog" aria-labelledby="share-title">
      <div className="share-head">
        <h2 id="share-title" className="card-title">공유하기</h2>
        <button type="button" className="btn btn-text btn-sm" onClick={close}>닫기</button>
      </div>

      {user && (
        <div className="segmented share-mode" role="radiogroup" aria-label="어떻게 나눌까요">
          {([['group', '모임에 나누기'], ['link', '링크로 보내기']] as const).map(([k, label]) => (
            <label key={k} className="seg">
              <input type="radio" name="share-mode" checked={mode === k} onChange={() => setMode(k)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}

      <details className="share-what" open={ids.size === 0 && graph.entries.length > 0 ? true : undefined}>
        <summary>
          <span className="field-label">무엇을 나눌까요?</span>
          <span className="muted small">
            순간 {ids.size}개 · {time ? '시점 보임' : '시점 숨김'} · {descriptions ? '설명 함께' : '설명 빼고'}
          </span>
          <span className="share-what-edit">바꾸기</span>
        </summary>
        <label className="field">
          <span className="field-label">보일 제목</span>
          <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
          <small className="muted">이름이나 학교처럼 나를 알아볼 수 있는 말이 있는지 한 번 살펴봐요.</small>
        </label>
        <EntryPicker graph={graph} ids={ids} onToggle={(id) => setIds((s) => toggleIn(s, id))} />
        <label className="check">
          <input type="checkbox" checked={time} onChange={(e) => setTime(e.target.checked)} />
          나이 · 연도 · 달을 보여주기 <small className="muted">(끄면 ‘그때 → 지금’으로만)</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={descriptions} onChange={(e) => setDescriptions(e.target.checked)} />
          순간의 짧은 설명도 함께
        </label>
      </details>
      <p className="muted small">그때의 마음 · 지금의 나에 적은 글은 어떤 경우에도 나가지 않아요.</p>

      {mode === 'group' && user ? (
        <GroupShare graph={graph} ready={ids.size > 0} makeOptions={options} ensureOpen={ensureOpen} />
      ) : (
        <LinkShare graph={graph} ready={ids.size > 0} makeShared={shared} ensureOpen={ensureOpen} deps={[title, ids, descriptions, time]} />
      )}

      {graph.visibility === 'link' && !graph.groupId && (
        <button type="button" className="btn btn-text btn-sm danger share-stop" onClick={() => onVisibility('private')}>
          공유 그만하기 (나만 보기로{user ? ' · 모임 · 링크에서도 내려가요' : ''})
        </button>
      )}
      {graph.groupId && <p className="muted small">모임에서 그린 선이라 그 모임과는 늘 함께 나눠요.</p>}
    </dialog>
  )
}

/**
 * 링크로 보내기: 짧은 링크(/s/코드)를 만든다. 로그인했다면 만든 링크를 여기서 언제든 끌 수 있다.
 * 서버가 없을 때(정적 파일만)는 예전처럼 내용이 담긴 긴 링크를 만든다.
 */
function LinkShare({ graph, ready, makeShared, ensureOpen, deps }: {
  graph: Graph; ready: boolean; makeShared: () => SharedGraph; ensureOpen: () => Promise<boolean>; deps: unknown[]
}) {
  const { user } = useAuth()
  const [agreed, setAgreed] = useState(false)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [mine, setMine] = useState<{ code: string; createdAt: string }[]>([])
  const [base, setBase] = useState('')
  useEffect(() => {
    shareBase().then(setBase)
  }, [])
  const loadMine = () => (user ? api.graphLinks(graph.id).then(setMine, () => setMine([])) : Promise.resolve())
  useEffect(() => {
    loadMine()
  }, [graph.id, user])
  // 담을 내용을 바꾸면 새 링크를 다시 만든다
  useEffect(() => {
    setLink('')
    setCopied(false)
  }, deps)
  const make = async () => {
    if (!(await ensureOpen())) return
    try {
      const { code } = await api.createLink(makeShared(), user ? graph.id : undefined)
      setLink(`${base}/s/${code}`)
      loadMine()
    } catch {
      setLink(`${base}/share#${encodeShared(makeShared())}`)
    }
  }
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))
  const off = async (code: string) => {
    if (!window.confirm('이 링크를 끌까요? 받은 사람도 더는 볼 수 없어요.')) return
    await api.deleteLink(code).catch(() => {})
    if (link.endsWith(`/s/${code}`)) setLink('')
    loadMine()
  }
  return (
    <div className="share-action">
      {link ? (
        <div className="share-link">
          <input readOnly value={link} aria-label="공유 링크" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(link)}>{copied ? '복사했어요' : '복사하기'}</button>
          <a className="btn btn-text" href={link} target="_blank" rel="noreferrer">미리 보기</a>
        </div>
      ) : (
        <>
          <label className="check agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              링크를 받은 사람은 누구나 볼 수 있다는 걸 알아요.{' '}
              {user ? '만든 링크는 아래에서 언제든 끌 수 있어요.' : <strong>로그인하지 않고 만든 링크는 끌 수 없어요.</strong>}
            </span>
          </label>
          <button type="button" className="btn btn-primary btn-block" disabled={!ready || !agreed} onClick={make}>
            짧은 링크 만들기
          </button>
          {!ready && <small className="muted">{graph.entries.length ? '위 ‘무엇을 나눌까요?’ 에서 나눌 순간을 하나 이상 골라 주세요.' : '아직 순간이 없어요. 그래프에 순간을 하나 이상 더하면 링크를 만들 수 있어요.'}</small>}
        </>
      )}
      {mine.length > 0 && (
        <div className="my-links">
          <p className="field-label">이 그래프로 만든 링크 <small className="muted">{mine.length}</small></p>
          <ul>
            {mine.map((l) => (
              <li key={l.code}>
                <code>/s/{l.code}</code>
                <small className="muted">{formatDate(l.createdAt)}</small>
                <button type="button" className="btn btn-text btn-sm" onClick={() => copy(`${base}/s/${l.code}`)}>복사</button>
                <button type="button" className="btn btn-text btn-sm danger" onClick={() => off(l.code)}>끄기</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** 모임에 나누기: 모임을 고르고 큰 버튼 하나로. 나누는 중인 모임은 표시하고 바로 내릴 수 있다. */
function GroupShare({ graph, ready, makeOptions, ensureOpen }: {
  graph: Graph; ready: boolean; makeOptions: () => PostOptions; ensureOpen: () => Promise<boolean>
}) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [posted, setPosted] = useState<Record<string, string>>({}) // groupId → postId
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ text: string; groupId?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    Promise.all([api.groups(), api.graphPosts(graph.id)]).then(
      ([gs, ps]) => {
        setGroups(gs)
        const p = Object.fromEntries(ps.map((x) => [x.groupId, x.postId]))
        setPosted(p)
        return { gs, p }
      },
      (e) => {
        setMsg({ text: e.message })
        return null
      },
    )
  useEffect(() => {
    load().then((r) => {
      // 모임이 하나뿐이고 아직 안 나눴다면 미리 골라 둔다
      const open = r?.gs.filter((g) => g.id !== graph.groupId && !r.p[g.id]) ?? []
      if (open.length === 1) setPicked(new Set([open[0].id]))
    })
  }, [graph.id])

  if (groups === null) return <p className="muted small">모임을 불러오는 중이에요…</p>
  if (groups.length === 0) {
    return (
      <p className="muted small share-action">
        아직 들어간 모임이 없어요. <Link to="/share">함께 나누기</Link>에서 코드로 들어가거나 모임을 만들 수 있어요.
      </p>
    )
  }

  const choices = groups.filter((g) => g.id !== graph.groupId)
  const chosen = choices.filter((g) => picked.has(g.id))
  const share = async () => {
    setBusy(true)
    setMsg(null)
    try {
      if (!(await ensureOpen())) throw new Error('저장하지 못했어요. 잠시 뒤에 다시 해볼까요?')
      for (const g of chosen) await api.post(g.id, graph.id, makeOptions())
      await load()
      setPicked(new Set())
      setMsg({ text: `${chosen.length === 1 ? `‘${chosen[0].name}’` : `모임 ${chosen.length}곳`}에 나눴어요. 그래프를 고치면 모임에도 바로 보여요.`, groupId: chosen.length === 1 ? chosen[0].id : undefined })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '잠시 문제가 생겼어요.' })
    } finally {
      setBusy(false)
    }
  }
  const unpost = async (g: GroupSummary) => {
    setMsg(null)
    try {
      await api.unpost(posted[g.id])
      await load()
      setMsg({ text: `‘${g.name}’에서 내렸어요.` })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '잠시 문제가 생겼어요.' })
    }
  }

  return (
    <div className="share-action">
      <ul className="share-groups">
        {groups.map((g) =>
          g.id === graph.groupId ? (
            <li key={g.id} className="share-group is-bound">
              <span className="share-group-name">{g.name}</span>
              {posted[g.id] ? (
                <span className="badge badge-soft">함께 나누는 중</span>
              ) : graph.completed ? (
                // 모임장이 내렸을 때: 고친 뒤 다시 올릴 수 있다
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.post(g.id, graph.id, GROUP_POST).then(load, (e) => setMsg({ text: e.message }))}>
                  다시 올리기
                </button>
              ) : (
                <span className="badge badge-soft">완성하면 저절로</span>
              )}
            </li>
          ) : (
            <li key={g.id} className={`share-group${picked.has(g.id) ? ' is-picked' : ''}`}>
              <label className="check">
                <input type="checkbox" checked={picked.has(g.id)} onChange={() => setPicked((s) => toggleIn(s, g.id))} />
                <span className="share-group-name">{g.name}</span>
              </label>
              {posted[g.id] && (
                <span className="share-group-state">
                  <span className="badge badge-soft">나누는 중</span>
                  <button type="button" className="btn btn-text btn-sm danger" onClick={() => unpost(g)}>내리기</button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {graph.visibility === 'private' && chosen.length > 0 && (
        <p className="muted small">지금은 ‘나만 보기’예요. 나누면 ‘함께 나누기’로 바뀌어요.</p>
      )}
      {choices.length > 0 && (
        <button type="button" className="btn btn-primary btn-block" disabled={!ready || !chosen.length || busy} onClick={share}>
          {busy
            ? '나누는 중…'
            : !chosen.length
              ? '나눌 모임을 골라 주세요'
              : chosen.length === 1
                ? `‘${chosen[0].name}’에 ${posted[chosen[0].id] ? '다시 ' : ''}나누기`
                : `모임 ${chosen.length}곳에 나누기`}
        </button>
      )}
      {!ready && <small className="muted">{graph.entries.length ? '위 ‘무엇을 나눌까요?’ 에서 나눌 순간을 하나 이상 골라 주세요.' : '아직 순간이 없어요. 그래프에 순간을 하나 이상 더하면 나눌 수 있어요.'}</small>}
      {msg && (
        <p className="share-msg" role="status">
          {msg.text} {msg.groupId && <Link to={`/groups/${msg.groupId}`}>모임에서 보기</Link>}
        </p>
      )}
    </div>
  )
}

/** 봉투 그림. 닫혀 있으면 편지지는 봉투 안에 숨고, open 이면 덮개가 젖혀지며 편지지가 올라온다 */
function EnvelopeArt({ open }: { open: boolean }) {
  const clip = `env-clip-${useId().replace(/:/g, '')}`
  return (
    <svg className={`envelope-art${open ? ' is-open' : ''}`} viewBox="0 10 140 104" aria-hidden="true">
      <defs>
        {/* 편지지는 봉투 몸통(위 44 ~ 바닥 106) 안에서만 보인다 — 닫혀 있을 때 위아래로 삐져나오지 않게 */}
        <clipPath id={clip}><rect x="0" y={open ? 0 : 44} width="140" height={open ? 106 : 62} /></clipPath>
      </defs>
      <ellipse className="env-shadow" cx="70" cy="110" rx="52" ry="3.5" />
      <path className="env-flap-open" d="M14 44 L70 12 L126 44 Z" />
      <rect className="env-back" x="14" y="44" width="112" height="62" rx="6" />
      <g clipPath={`url(#${clip})`}>
        <g className="env-paper">
          <rect x="26" y="26" width="88" height="70" rx="3" />
          <line x1="38" y1="42" x2="102" y2="42" />
          <line x1="38" y1="51" x2="102" y2="51" />
          <line x1="38" y1="60" x2="84" y2="60" />
          <path className="env-paper-heart" d="M70 78 C64.5 73.5 66 69 70 72 C74 69 75.5 73.5 70 78 Z" />
        </g>
      </g>
      <path className="env-front" d="M14 50 L70 84 L126 50 L126 100 Q126 106 120 106 L20 106 Q14 106 14 100 Z" />
      <path className="env-flap" d="M14 47 Q14 44 17.5 44 L122.5 44 Q126 44 126 47 L72.5 80.5 Q70 82 67.5 80.5 Z" />
      <circle className="env-seal" cx="70" cy="78" r="7.5" />
      <path className="env-seal-heart" d="M70 82 C65.5 78.3 66.7 74.6 70 77.2 C73.3 74.6 74.5 78.3 70 82 Z" />
    </svg>
  )
}

/** 미래의 나에게 쓴 편지: 열리는 날 전에는 봉인된 봉투, 지나면 봉투를 열어 편지지로 읽는다 */
function LetterEnvelope({ letter }: { letter: NonNullable<Graph['futureLetter']> }) {
  const ready = Date.parse(letter.openAt) <= Date.now()
  const days = Math.ceil((Date.parse(letter.openAt) - Date.now()) / 86_400_000)
  const [opened, setOpened] = useState(false)
  return (
    <section className={`envelope${opened ? ' is-open' : ''}${ready ? '' : ' is-sealed'}`} aria-label="미래의 나에게 쓴 편지">
      <EnvelopeArt open={opened} />
      {!ready ? (
        <>
          <p className="serif envelope-title">미래의 나에게 쓴 편지</p>
          <p className="muted small">{formatDate(letter.openAt)}에 열려요 · {days}일 남았어요</p>
        </>
      ) : !opened ? (
        <>
          <p className="serif envelope-title">{formatDate(letter.writtenAt)}의 내가 보낸 편지가 도착했어요</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpened(true)}>봉투 열기</button>
        </>
      ) : (
        <div className="letter-paper">
          <p className="letter-paper-to">TO. 지금의 나</p>
          <p className="serif letter-paper-text">{letter.text}</p>
          <p className="letter-paper-from">FROM. {formatDate(letter.writtenAt)}의 나</p>
        </div>
      )}
    </section>
  )
}

const COUNT = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열']

/** 선이 들려주는 이야기: 기간 · 순간 수 · 가장 높이 닿은 곳과 깊이 내려간 곳. 평가하지 않고 짚어 주기만 한다. */
export function LineStory({ graph }: { graph: Graph }) {
  const pts = sortEntries(graphPoints(graph))
  if (pts.length < 2) return null
  const hi = pts.reduce((a, b) => (b.emotionScore > a.emotionScore ? b : a))
  const lo = pts.reduce((a, b) => (b.emotionScore < a.emotionScore ? b : a))
  const d = graph.currentPoint - graph.startPoint
  const span = graph.timeScale === 'month' ? `${d + 1}개월` : graph.timeScale === 'hour' ? (d < 24 ? `${Math.round(d * 10) / 10}시간` : `${Math.round(d / 24)}일`) : `${d}년`
  const count = pts.length <= 10 ? `${COUNT[pts.length]} 개의` : `${pts.length}개의`
  const at = (p: (typeof pts)[number]) => `${timeLabel(graph.timeScale, p.timePoint, [graph.startPoint, graph.currentPoint])} · ‘${p.title || '이름 없는 순간'}’`
  return (
    <section className="card story">
      <p className="eyebrow en">WHAT THE LINE TELLS</p>
      <p className="serif story-lead">{span}의 시간 속, {count} 순간</p>
      {hi.emotionScore === lo.emotionScore ? (
        <p className="muted">선이 잔잔하게 이어졌어요. 고요했던 시간도 나를 만든 시간이에요.</p>
      ) : (
        <dl className="story-points">
          <div>
            <dt>선이 가장 높이 닿은 곳</dt>
            <dd>{at(hi)}</dd>
          </div>
          <div>
            <dt>가장 깊이 내려간 곳</dt>
            <dd>{at(lo)}</dd>
          </div>
        </dl>
      )}
      <p className="serif story-close">
        <span className="line">높은 곳도 깊은 곳도,</span>{' '}
        <span className="line">모두 지나 지금의 내가 되었어요.</span>
      </p>
    </section>
  )
}

/** A4 한 장으로 인쇄 */
function SheetLink({ id }: { id: string }) {
  const labs = useLabs('graph')
  return labs ? <Link to={`/graph/${id}/sheet`} className="btn btn-ghost btn-sm">A4 한 장</Link> : null
}

/** 지난 모습 — 고칠 때 남은 모습을 점선으로 겹쳐 보고, 그 모습으로 되돌린다 (되돌리기 전 지금 모습도 남는다) */
function Versions({ graph, onPreview, onRestored }: { graph: Graph; onPreview: (g: Graph | null) => void; onRestored: (g: Graph) => void }) {
  const labs = useLabs('graph')
  const { user } = useAuth()
  const [list, setList] = useState<Awaited<ReturnType<typeof api.graphVersions>> | null>(null)
  const [pick, setPick] = useState(0)
  const [v, setV] = useState<{ at: string; graph: Graph } | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (labs && user) api.graphVersions(graph.id).then(setList, () => setList([]))
  }, [labs, user, graph.id, graph.updatedAt])
  if (!labs || !user || !list?.length) return null
  const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const choose = async (vid: number) => {
    setPick(vid)
    setMsg('')
    if (!vid) { setV(null); onPreview(null); return }
    const r = await api.graphVersion(graph.id, vid).catch(() => null)
    setV(r)
    onPreview(r?.graph ?? null)
  }
  const restore = async () => {
    if (!v || !window.confirm(`${when(v.at)}의 모습으로 되돌릴까요? 지금 모습도 ‘지난 모습’ 에 남아서 다시 돌아올 수 있어요.`)) return
    const g = normalizeGraph({ ...v.graph, id: graph.id, updatedAt: new Date().toISOString() })
    try {
      await api.restoreGraph(g)
      setPick(0)
      setV(null)
      onRestored(g)
      setMsg('되돌렸어요.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '되돌리지 못했어요.')
    }
  }
  return (
    <div className="field ghost-pick versions-pick no-print">
      <label className="field-label" htmlFor="versions">고치기 전 모습 <small className="muted">({list.length}개 남아 있어요)</small></label>
      <select id="versions" value={pick} onChange={(e) => choose(Number(e.target.value))}>
        <option value={0}>지금 모습</option>
        {list.map((x) => <option key={x.id} value={x.id}>{when(x.at)} · 순간 {x.moments}개{x.done ? ' · 완성' : ''}</option>)}
      </select>
      {v && (
        <p className="muted small ghost-legend">
          <span className="ghost-swatch" aria-hidden="true" />점선은 {when(v.at)}에 고치기 전 모습이에요.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={restore}>이 모습으로 되돌리기</button>
        </p>
      )}
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  )
}
