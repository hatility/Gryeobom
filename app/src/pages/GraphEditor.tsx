import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import LifeGraph from '../components/LifeGraph'
import { EMOTIONS, ENTRY_QUESTIONS, MOMENT_EXAMPLES, NOW_QUESTIONS, STEPS, HELPLINE, EMOTION_NOTES, LINE_COLORS, WEEKS, eul, lineColorOf, iga, monthFull, monthIndex, rangeLabel, scoreWord, signed, timeLabel, timeParts, fromParts, presetLabel, presetRange } from '../content'
import { api } from '../api'
import { useAuth, useRepo } from '../auth'
import { dayKey, momentPoint } from '../journal'
import { formatDate, graphPoints, graphTitle, newEntry, newGraph, sortEntries } from '../store'
import type { GroupPreset, LifeEntry, LifeGraph as Graph, TimeScale } from '../types'

const THIS_YEAR = new Date().getFullYear()
const THIS_MONTH = monthIndex()
const LIMITS: Record<Exclude<TimeScale, 'month'>, [number, number]> = { age: [0, 120], year: [1900, THIS_YEAR] }
/** 1단계에서 고르는 시간 기준. 최근 12개월과 올해는 둘 다 월 단위(timeScale 'month')다. */
type Choice = 'age' | 'year' | 'recent12' | 'thisYear'
const CHOICES: [Choice, string][] = [['age', '나이로'], ['year', '연도로'], ['recent12', '최근 12개월'], ['thisYear', '올해']]
const DEFAULT_RANGE: Record<Choice, [number, number]> = {
  age: [0, 17],
  year: [THIS_YEAR - 17, THIS_YEAR],
  recent12: [THIS_MONTH - 11, THIS_MONTH],
  thisYear: [THIS_YEAR * 12, THIS_MONTH],
}
const choiceOf = (g: Graph): Choice =>
  g.timeScale !== 'month' ? g.timeScale : g.monthRange === 'thisYear' ? 'thisYear' : 'recent12'
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

type Update = (patch: Partial<Graph> | ((g: Graph) => Partial<Graph>)) => void
/** ‘이 모임에서 그리기’로 시작한 그래프의 모임 */
type Group = { id: string; name: string; preset: GroupPreset | null }
const LAST = STEPS.length

export default function GraphEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const step = Math.min(LAST, Math.max(1, Number(params.get('step')) || 1))
  const repo = useRepo()
  // undefined = 불러오는 중, null = 없음
  const [graph, setGraph] = useState<Graph | null | undefined>(() => (id ? undefined : newGraph()))
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>(id ? 'saved' : 'idle')
  const dirty = useRef(false)
  const persisted = useRef(!!id)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const quitRef = useRef<HTMLDialogElement>(null)
  const removed = useRef(false) // 지운 뒤에는 자동 저장이 되살리지 않게

  // 모임에서 시작한 그래프(?group=모임id): 그 모임에 이어 두고, 모임장이 정해 둔 나의 시간을 미리 채운다.
  // 이어 둔 그래프는 완성하면 모임에 저절로 나눠진다 (서버가 한다)
  const { user } = useAuth()
  const groupId = graph?.groupId ?? params.get('group')
  const [group, setGroup] = useState<Group | null>(null)
  useEffect(() => {
    if (!groupId || !user) return setGroup(null)
    api.group(groupId).then(
      (g) => {
        setGroup({ id: g.id, name: g.name, preset: g.preset })
        if (persisted.current || dirty.current) return // 이미 쓰기 시작한 그래프는 건드리지 않는다
        const p = g.preset
        setGraph((x) => x && !x.groupId ? { ...x, ...(p ? { ...presetRange(p), title: p.title || x.title } : {}), groupId: g.id, visibility: 'link' } : x)
      },
      () => setGroup(null),
    )
  }, [groupId, user])

  // 같은 기간 다시 그리기(?again=그래프id): 그때의 기간 · 선 색 · 제목을 그대로 두고, 그때의 선을 흐리게 겹쳐 본다
  const pastId = graph?.redrawOf ?? (id ? null : params.get('again'))
  const [past, setPast] = useState<Graph | null>(null)
  useEffect(() => {
    if (!pastId) return setPast(null)
    repo.get(pastId).then(
      (g) => {
        setPast(g)
        if (!g || persisted.current || dirty.current) return
        setGraph((x) =>
          x && !x.redrawOf
            ? { ...x, timeScale: g.timeScale, monthRange: g.monthRange, startPoint: g.startPoint, currentPoint: g.currentPoint, lineColor: g.lineColor, title: g.title, redrawOf: g.id }
            : x,
        )
      },
      () => setPast(null),
    )
  }, [pastId, repo])

  // 오늘의 한 줄을 순간으로 옮기기 (?moment=글&q=질문&at=날짜): 불러온 그래프에 순간 하나를 그 날짜쯤에 놓는다.
  // 불러오기가 두 번 끝나도(개발 모드 등) 같은 순간 하나만 들어가게, 만든 순간을 기억해 둔다.
  const pending = useRef<LifeEntry | null>(null)
  const withMoment = (g: Graph | null): Graph | null => {
    const text = params.get('moment')?.trim()
    if (!g || !text) return g
    if (!pending.current) {
      const e = newEntry(momentPoint(g, params.get('at') ?? dayKey()), 0, [...text].slice(0, 40).join(''))
      e.description = [...`${text.length > 40 ? `${text}\n` : ''}‘${params.get('q') ?? '오늘의 질문'}’에 남긴 한 줄`].slice(0, 300).join('')
      pending.current = e
      setNote(`‘${e.title}’${iga(e.title)} 선 위에 놓였어요. 마음 점수를 정해 볼까요?`)
      setParams((p) => {
        ;['moment', 'q', 'at'].forEach((k) => p.delete(k))
        return p
      }, { replace: true })
    }
    const e = pending.current
    if (g.entries.some((x) => x.id === e.id)) return g
    dirty.current = true
    return { ...g, entries: [...g.entries, e], updatedAt: new Date().toISOString() }
  }

  // 같은 화면이 /graph/new ↔ /graph/:id/edit 사이를 오갈 때 맞는 기록을 띄운다
  useEffect(() => {
    if (id && graph?.id !== id) {
      dirty.current = false
      persisted.current = true
      setGraph(undefined)
      repo.get(id).then((g) => setGraph(withMoment(g)), () => setGraph(null))
      setSave('saved')
    } else if (!id && graph && persisted.current) {
      dirty.current = false
      persisted.current = false
      setGraph(newGraph())
      setSave('idle')
    }
  }, [id])

  // 바뀔 때마다 자동 저장. 서버에는 0.5초 모아서, 순서대로 보낸다.
  // 첫 저장 뒤에는 새로고침해도 이어 쓸 수 있게 주소를 바꾼다.
  useEffect(() => {
    if (!graph || !dirty.current) return
    setSave('saving')
    const t = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (removed.current) return
        const ok = await repo.save(graph)
        setSave(ok ? 'saved' : 'error')
        if (ok && !persisted.current) {
          persisted.current = true
          navigate(`/graph/${graph.id}/edit${location.search}`, { replace: true })
        }
      })
    }, repo.remote ? 500 : 0)
    return () => clearTimeout(t)
  }, [graph])

  // 저장 중이거나 실패했을 때만 떠나기 전 한 번 더 묻는다
  useEffect(() => {
    if (save !== 'error' && save !== 'saving') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [save])

  // 순간을 담으면, 안내 문장 자리에 잠깐 말을 건넨다 (지울 때는 아래 ‘되돌리기’ 알림이)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 4000)
    return () => clearTimeout(t)
  }, [note])
  const placed = (title: string) => {
    const t = title.trim() || '새로운 순간'
    setNote(`‘${t}’${iga(t)} 선 위에 놓였어요.`)
  }

  // 지우기는 묻지 않고 바로, 대신 6초 동안 되돌릴 수 있게
  const [undo, setUndo] = useState<{ entry: LifeEntry; index: number } | null>(null)
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 6000)
    return () => clearTimeout(t)
  }, [undo])

  // 어느 단계에서 멈췄는지 이 기기에 기억해 두었다가, 메인의 ‘이어서 그리기’가 그 단계로 연다
  useEffect(() => {
    if (!graph?.id || !persisted.current) return
    try {
      localStorage.setItem(`geuryeobom:step:${graph.id}`, String(step))
    } catch {
      /* 기억하지 못해도 이어 그리기는 1단계부터 열릴 뿐 */
    }
  }, [step, graph?.id, save])

  if (graph === undefined) return <p className="container page loading serif">기록을 펼치는 중이에요…</p>
  if (!graph) {
    return (
      <section className="container page empty-state">
        <h1>이 기록을 찾을 수 없어요</h1>
        <p className="muted">
          {repo.remote
            ? '지워졌거나 다른 계정의 기록일 수 있어요.'
            : '로그인하지 않고 그린 기록은 처음 그린 기기의 브라우저에만 있어요. 다른 기기라면 보이지 않을 수 있어요.'}
        </p>
        <Link to="/my" className="btn btn-primary">기록 모아보기</Link>
      </section>
    )
  }

  const update: Update = (patch) => {
    dirty.current = true
    setGraph((g) => g && { ...g, ...(typeof patch === 'function' ? patch(g) : patch), updatedAt: new Date().toISOString() })
  }
  const removeEntry = (entryId: string) => {
    const index = graph.entries.findIndex((e) => e.id === entryId)
    if (index < 0) return false
    setUndo({ entry: graph.entries[index], index })
    update((g) => ({ entries: g.entries.filter((e) => e.id !== entryId) }))
    return true
  }
  const restore = () => {
    if (!undo) return
    update((g) => {
      const entries = [...g.entries]
      entries.splice(Math.min(undo.index, entries.length), 0, undo.entry)
      return { entries }
    })
    setUndo(null)
  }
  // 월 기준 '올해'는 1월에 한 달뿐일 수 있다
  const rangeOk = graph.timeScale === 'month' || graph.startPoint < graph.currentPoint
  const goTo = (n: number) => {
    setParams((p) => {
      p.set('step', String(n))
      return p
    })
    window.scrollTo({ top: 0 })
  }
  const finish = async () => {
    const done = { ...graph, completed: true, updatedAt: new Date().toISOString() }
    setSave('saving')
    await queue.current
    if (await repo.save(done)) navigate(`/graph/${done.id}?done=1`)
    else setSave('error')
  }
  const where = repo.remote ? '내 계정' : '이 기기'
  const s = STEPS[step - 1]

  return (
    <div className="container page editor">
      <header className="editor-head">
        <div className="editor-title-row">
          <div>
            <p className="eyebrow">STEP {step} · {s.en}</p>
            <h1 className="page-title">{s.name}</h1>
          </div>
          <span className="editor-head-side">
          {!graph.completed && (graph.entries.length > 0 || persisted.current) && (
            <button type="button" className="btn btn-text btn-sm" onClick={() => quitRef.current?.showModal()}>그만 그리기</button>
          )}
          <p key={save} className={`save-badge is-${save}`} role="status">
            {save === 'saved'
              ? `✓ ${where}에 저장`
              : save === 'saving'
                ? '저장하는 중…'
                : save === 'error'
                  ? '! 저장하지 못했어요'
                  : `${where}에 자동 저장`}
          </p>
          </span>
        </div>
        <ol className="stepper">
          {STEPS.map((st, i) => (
            <li key={st.name}>
              <button
                type="button"
                className={i + 1 < step ? 'is-done' : undefined}
                aria-current={i + 1 === step ? 'step' : undefined}
                disabled={!rangeOk && i > 0}
                onClick={() => goTo(i + 1)}
              >
                <span className="stepper-num">{i + 1}</span>
                <span className="stepper-name">{st.name}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="progress" role="progressbar" aria-label="작성 진행률" aria-valuemin={1} aria-valuemax={LAST} aria-valuenow={step}>
          <span style={{ width: `${(step / LAST) * 100}%` }} />
        </div>
        <p key={note || step} className={`whisper serif${note ? ' is-note' : ''}`} aria-live="polite">{note || s.whisper}</p>
        {save === 'error' && (
          <p className="alert" role="alert">
            {repo.remote
              ? '서버에 저장하지 못했어요. 인터넷 연결을 확인해 주세요. 다음에 고칠 때 다시 저장을 시도해요.'
              : '브라우저 저장 공간이 가득 찼거나 저장이 막혀 있어요.'}{' '}
            페이지를 닫으면 방금 적은 내용이 사라질 수 있어요.
          </p>
        )}
      </header>

      {/* 단계가 바뀔 때마다 새로 그려져 살짝 떠오르며 나타난다 */}
      <div key={step} className="step-body">
        {step === 1 && <StepTime graph={graph} update={update} group={group} />}
        {step === 2 && <StepMoments graph={graph} update={update} removeEntry={removeEntry} onPlaced={placed} past={past} />}
        {step === 3 && <StepReflect graph={graph} update={update} />}
        {step === 4 && <StepNow graph={graph} update={update} />}
      </div>

      {undo && (
        <div className="toast" role="status">
          <span className="toast-text">
            ‘{undo.entry.title || '이름 없는 순간'}’{eul(undo.entry.title || '이름 없는 순간')} 지웠어요
          </span>
          <button type="button" className="btn btn-text btn-sm toast-action" onClick={restore}>되돌리기</button>
        </div>
      )}

      {/* 끝까지 그리지 않아도 괜찮다: 나중에 이어 그리거나, 이 그래프를 지운다 */}
      <dialog ref={quitRef} className="dialog quit-dialog" aria-labelledby="quit-title">
        <h2 id="quit-title" className="card-title">오늘은 여기까지 할까요?</h2>
        <p className="muted">적은 내용은 {where}에 저장돼 있어요. 언제든 첫 화면이나 기록 모아보기에서 이어 그릴 수 있어요.</p>
        <div className="quit-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>나중에 이어 그리기</button>
          <button
            type="button"
            className="btn btn-ghost danger"
            onClick={async () => {
              if (!window.confirm('이 그래프를 지울까요? 적은 순간과 마음이 모두 지워지고 되돌릴 수 없어요.')) return
              removed.current = true
              await queue.current
              await repo.remove(graph.id)
              navigate('/my')
            }}
          >
            이 그래프 지우기
          </button>
          <button type="button" className="btn btn-text" onClick={() => quitRef.current?.close()}>계속 그리기</button>
        </div>
      </dialog>

      <nav className="step-nav" aria-label="단계 이동">
        <button type="button" className="btn btn-ghost" disabled={step === 1} onClick={() => goTo(step - 1)}>
          ← 이전
        </button>
        <span className="step-count">{step} / {LAST}</span>
        {step < LAST ? (
          <button type="button" className="btn btn-primary" disabled={!rangeOk} onClick={() => goTo(step + 1)}>
            다음 →
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={finish}>
            {group ? '완성하고 모임에 나누기' : '나의 이야기 완성하기'}
          </button>
        )}
      </nav>
    </div>
  )
}

/* ───────── 1단계: 나의 시간 ───────── */

function StepTime({ graph, update, group }: { graph: Graph; update: Update; group: Group | null }) {
  const age = graph.timeScale === 'age'
  const choice = choiceOf(graph)
  const lim = LIMITS[graph.timeScale === 'year' ? 'year' : 'age']
  // 기준을 바꿔도 이미 적은 순간은 새 범위 안의 같은 비율 위치로 옮긴다
  const setChoice = (next: Choice) => {
    if (next === choice) return
    const [start, end] = DEFAULT_RANGE[next]
    const span = Math.max(1, graph.currentPoint - graph.startPoint)
    const monthly = next === 'recent12' || next === 'thisYear'
    update({
      timeScale: monthly ? 'month' : next,
      monthRange: monthly ? next : undefined,
      startPoint: start,
      currentPoint: end,
      entries: graph.entries.map((e) => ({
        ...e,
        timePoint: clamp(start + Math.round(((e.timePoint - graph.startPoint) / span) * (end - start)), start, end),
      })),
    })
  }

  // 왼쪽 미리보기 · 오른쪽 입력 (모바일은 입력이 먼저)
  return (
    <div className="split split-time">
    <TimePreview graph={graph} group={group} />
    <section className="card form-card">
      <label className="field">
        <span className="field-label">그래프에 이름을 붙여볼까요?</span>
        <input
          value={graph.title}
          maxLength={40}
          placeholder="나의 작은 인생 이야기"
          onChange={(e) => update({ title: e.target.value })}
        />
        <small className="muted">비워 두면 ‘나의 작은 인생 이야기’로 불러요.</small>
      </label>

      {group?.preset ? (
        <div className="field">
          <span className="field-label">나의 시간</span>
          <p className="field-note">
            <strong>{presetLabel(group.preset)}</strong>
            <span className="muted small"> ‘{group.name}’ 모임이 함께 정해 둔 시간이에요.</span>
          </p>
          {age && (
            <NumberField label="지금 나이" value={graph.currentPoint} min={graph.startPoint + 1} max={lim[1]} onChange={(v) => update({ currentPoint: v })} />
          )}
        </div>
      ) : (
        <>
        <fieldset className="field">
          <legend className="field-label">어떤 기준으로 시간을 셀까요?</legend>
          <div className="segmented">
            {CHOICES.map(([c, label]) => (
              <label key={c} className="seg">
                <input type="radio" name="scale" checked={choice === c} onChange={() => setChoice(c)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {choice === 'thisYear' ? (
          <p className="field-note">
            <strong>{monthFull(graph.startPoint)}부터 {monthFull(graph.currentPoint)}까지</strong>
            <span className="muted small"> 올해를 한 달씩 천천히 돌아봐요.</span>
          </p>
        ) : choice === 'recent12' ? (
          <label className="field">
            <span className="field-label">어느 달까지 돌아볼까요?</span>
            <select
              value={graph.currentPoint}
              onChange={(e) => {
                const end = Number(e.target.value)
                update({ startPoint: end - 11, currentPoint: end })
              }}
            >
              {range(THIS_MONTH - 23, THIS_MONTH).reverse().map((t) => (
                <option key={t} value={t}>{monthFull(t)}{t === THIS_MONTH ? ' (이번 달)' : ''}</option>
              ))}
            </select>
            <small className="muted">
              {monthFull(graph.startPoint)}부터 {monthFull(graph.currentPoint)}까지, 열두 달을 한 달씩 천천히 돌아봐요.
            </small>
          </label>
        ) : (
          <div className="field-row">
            <NumberField
              label={age ? '어디서부터 그릴까요? (나이)' : '어디서부터 그릴까요? (연도)'}
              value={graph.startPoint} min={lim[0]} max={lim[1]}
              onChange={(v) => update({ startPoint: v })}
            />
            <NumberField
              label={age ? '지금 나이' : '지금 연도'}
              value={graph.currentPoint} min={lim[0]} max={lim[1]}
              onChange={(v) => update({ currentPoint: v })}
            />
          </div>
        )}
        </>
      )}
      {graph.timeScale === 'month' ? null : graph.startPoint >= graph.currentPoint ? (
        <p className="alert" role="alert">시작 시점은 지금보다 앞이어야 해요. 숫자를 한 번만 다시 확인해 줄래요?</p>
      ) : (
        <p className="muted small">대략적인 시간이면 충분해요.</p>
      )}

      <fieldset className="field">
        <legend className="field-label">내 선의 색 <em>(취향대로)</em></legend>
        <div className="tones">
          {LINE_COLORS.map((c) => (
            <label key={c.key} className="tone" style={{ '--tone': c.color } as CSSProperties}>
              <input type="radio" name="line-color" checked={(graph.lineColor ?? 'rose') === c.key} onChange={() => update({ lineColor: c.key })} />
              <span><i aria-hidden="true" />{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {group ? (
        <div className="field">
          <span className="field-label">누가 볼 수 있을까요?</span>
          <p className="field-note">
            <strong>‘{group.name}’ 모임과 함께 나눠요</strong>
            <span className="muted small"> 완성하면 순간 · 시점 · 짧은 설명이 모임에 저절로 나눠지고, 고친 내용도 바로 보여요. 그때의 마음 · 지금의 나는 나가지 않아요.</span>
          </p>
        </div>
      ) : (
      <fieldset className="field">
        <legend className="field-label">누가 볼 수 있을까요?</legend>
        <div className="choice-cards">
          <label className="choice">
            <input type="radio" name="vis" checked={graph.visibility === 'private'} onChange={() => update({ visibility: 'private' })} />
            <span>
              <strong>나만 보기</strong>
              <small>기본이에요. 나만 봐요.</small>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="vis" checked={graph.visibility === 'link'} onChange={() => update({ visibility: 'link' })} />
            <span>
              <strong>함께 나누기</strong>
              <small>고른 것만, 회고는 빼고 나눠요.</small>
            </span>
          </label>
        </div>
      </fieldset>
      )}
    </section>
    </div>
  )
}

/** 1단계 왼쪽: 고른 제목 · 기간으로 그려질 선의 틀을 미리 보여준다 */
function TimePreview({ graph, group }: { graph: Graph; group: Group | null }) {
  const ok = graph.timeScale === 'month' || graph.startPoint < graph.currentPoint
  return (
    <aside className="card graph-card sticky time-preview" aria-label="미리보기">
      <p className="eyebrow">PREVIEW</p>
      <div className="preview-head">
        <p className="serif preview-title">{graphTitle(graph)}</p>
        <p className="muted small">{ok ? rangeLabel(graph.timeScale, graph.startPoint, graph.currentPoint) : '기간을 다시 확인해 주세요'}</p>
      </div>
      {ok && (
        <LifeGraph tone={lineColorOf(graph.lineColor)}
          points={graphPoints(graph)}
          timeScale={graph.timeScale}
          start={graph.startPoint}
          end={graph.currentPoint}
          emptyText="순간을 적으면 여기에 선이 그려져요"
        />
      )}
      <div className="preview-notes">
        <p className="field-label">시작하기 전에</p>
        <ul>
          <li>정확하지 않아도 괜찮아요.</li>
          <li>가까운 시간은 ‘최근 12개월’로, 주 단위까지 봐요.</li>
          <li>
            {group
              ? `완성하면 ‘${group.name}’ 모임에 나눠져요.`
              : graph.visibility === 'private'
                ? '지금은 나만 볼 수 있어요.'
                : '완성한 뒤 고른 것만 나눠요.'}
          </li>
        </ul>
      </div>
    </aside>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isInteger(v) && v >= min && v <= max) onChange(v)
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  )
}

/**
 * 언제였는지 + ‘언제쯤’(선택). 나이 · 연도는 한 달, 월 기준(최근 12개월 · 올해)은 한 주 단위까지 고를 수 있다.
 * 지금 시점에서는 더 뒤로 갈 수 없다.
 */
function WhenField({ scale, value, min, max, onChange }: {
  scale: TimeScale; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  const { whole, part } = timeParts(scale, value)
  const atEnd = whole >= max
  const parts =
    scale === 'age' ? range(1, 11).map((k) => [k, `${k}개월`] as const)
    : scale === 'year' ? range(1, 12).map((k) => [k, `${k}월`] as const)
    : range(1, 4).map((k) => [k, WEEKS[k]] as const)
  const setWhole = (v: number) => onChange(v >= max ? v : fromParts(scale, v, part))
  return (
    <div className="field-row when-row">
      {scale === 'month' ? (
        <label className="field">
          <span className="field-label">그때는 몇 월이었나요?</span>
          <select value={whole} onChange={(e) => setWhole(Number(e.target.value))}>
            {range(min, max).map((t) => (
              <option key={t} value={t}>{monthFull(t)}</option>
            ))}
          </select>
        </label>
      ) : (
        <NumberField
          label={scale === 'age' ? '그때 나는 몇 살이었나요?' : '그때는 몇 년도였나요?'}
          value={whole}
          min={min}
          max={max}
          onChange={setWhole}
        />
      )}
      <label className="field">
        <span className="field-label">{scale === 'age' ? '몇 개월쯤?' : scale === 'year' ? '몇 월쯤?' : '몇째 주쯤?'} <em>(선택)</em></span>
        <select value={atEnd ? 0 : part} disabled={atEnd} onChange={(e) => onChange(fromParts(scale, whole, Number(e.target.value)))}>
          <option value={0}>{atEnd ? '지금' : '잘 모르겠어요'}</option>
          {parts.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

/* ───────── 2단계: 기억에 남는 순간 + 나의 선 ───────── */

const isBlank = (e: LifeEntry) => !e.title.trim() && !e.description.trim() && !e.emotionLabel && e.emotionScore === 0

/**
 * 위의 선에서 점을 끌어 옮기거나 빈 곳을 눌러 더하고, 아래에서 순간을 적는다.
 * 순간(목록 · 점)을 누르면 팝업에서 고치고, 적는 대로 바로 저장된다.
 */
function StepMoments({ graph, update, removeEntry, onPlaced, past }: {
  graph: Graph; update: Update; removeEntry: (id: string) => boolean; onPlaced: (title: string) => void
  /** 다시 그리는 중이면 처음 그린 그래프 (흐린 점선으로) */
  past: Graph | null
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [allExamples, setAllExamples] = useState(false) // 모바일: 처음엔 4개만
  const dialog = useRef<HTMLDialogElement>(null)
  // 방금 만든 순간: 닫을 때 ‘선 위에 놓였어요’, ‘새로운 순간 적기’로 열고 아무것도 안 적었으면 조용히 지운다
  const fresh = useRef<{ id: string; dropIfBlank: boolean } | null>(null)
  const entry = graph.entries.find((e) => e.id === openId)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (openId && !d.open) d.showModal()
    else if (!openId && d.open) d.close()
  }, [openId])

  const add = (timePoint: number, score = 0, title = '', dropIfBlank = false) => {
    const e = newEntry(timePoint, score, title)
    update((g) => ({ entries: [...g.entries, e] }))
    fresh.current = { id: e.id, dropIfBlank }
    setOpenId(e.id)
  }
  const middle = () => Math.round((graph.startPoint + graph.currentPoint) / 2)
  const patch = (id: string, p: Partial<LifeEntry>) =>
    update((g) => ({ entries: g.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }))
  const close = () => {
    const f = fresh.current
    fresh.current = null
    setOpenId(null)
    if (!entry) return
    if (f?.id === entry.id && f.dropIfBlank && isBlank(entry)) {
      update((g) => ({ entries: g.entries.filter((e) => e.id !== entry.id) }))
      return
    }
    const title = entry.title.trim(), description = entry.description.trim()
    if (title !== entry.title || description !== entry.description) patch(entry.id, { title, description })
    if (f?.id === entry.id) onPlaced(title)
  }

  return (
    <div className="split split-moments">
      <aside className="card graph-card">
        <p className="eyebrow">MY LINE, SO FAR</p>
        <p className="hint">
          점을 끌어 옮기고, 빈 곳을 눌러 더해요. 점을 누르면 고칠 수 있어요.
          <span className="kbd-hint"> · 키보드는 Tab으로 고르고 화살표로 옮겨요</span>
        </p>
        <LifeGraph tone={lineColorOf(graph.lineColor)}
          editable
          points={graphPoints(graph)}
          timeScale={graph.timeScale}
          start={graph.startPoint}
          end={graph.currentPoint}
          selectedId={openId}
          onSelect={(id) => id && setOpenId(id)}
          onMove={(id, timePoint, emotionScore) => patch(id, { timePoint, emotionScore })}
          onAdd={(t, score) => add(t, score)}
          ghost={past ? graphPoints(past) : undefined}
        />
        {past && (
          <p className="muted small ghost-legend">
            <span className="ghost-swatch" aria-hidden="true" />점선은 {formatDate(past.createdAt)}에 그린 ‘{graphTitle(past)}’예요. 지금의 마음으로 다시 그려 봐요.
          </p>
        )}
      </aside>
      <section className="card">
        <h2 className="card-title">어떤 순간이 떠오르나요?</h2>
        <p className="muted small">예시는 참고만 해요. 꼭 이런 순간이 아니어도 괜찮아요.</p>
        <div className={`chips chips-examples${allExamples ? ' is-open' : ''}`}>
          {MOMENT_EXAMPLES.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => add(middle(), 0, t)}>+ {t}</button>
          ))}
          <button type="button" className="chip chip-toggle" aria-expanded={allExamples} onClick={() => setAllExamples((o) => !o)}>
            {allExamples ? '접기' : `예시 더 보기 +${MOMENT_EXAMPLES.length - 4}`}
          </button>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => add(middle(), 0, '', true)}>
          새로운 순간 적기
        </button>
        <h3 className="field-label">나의 순간들 <small className="muted">과거 → 지금 · 누르면 고칠 수 있어요</small></h3>
        <EntryList graph={graph} onEdit={setOpenId} onRemove={removeEntry} />
      </section>
      <dialog
        ref={dialog}
        className="dialog entry-dialog"
        aria-labelledby="entry-dialog-title"
        onCancel={(e) => {
          e.preventDefault() // Esc 도 같은 길로 닫는다
          close()
        }}
      >
        {entry && (
          <EntryForm
            key={entry.id}
            entry={entry}
            graph={graph}
            isNew={fresh.current?.id === entry.id}
            onChange={(p) => patch(entry.id, p)}
            onClose={close}
            onDelete={() => {
              fresh.current = null
              setOpenId(null)
              removeEntry(entry.id)
            }}
          />
        )}
      </dialog>
    </div>
  )
}

function EntryList({ graph, onEdit, onRemove }: { graph: Graph; onEdit: (id: string) => void; onRemove: (id: string) => void }) {
  const sorted = sortEntries(graph.entries)
  if (!sorted.length) return <p className="list-empty serif">첫 순간 하나면 선이 시작돼요.</p>
  return (
    <ul className="entry-list">
      {sorted.map((e) => (
        <li key={e.id} className="entry-item">
          <button type="button" className="entry-open" onClick={() => onEdit(e.id)}>
            <span className="entry-time">{timeLabel(graph.timeScale, e.timePoint)}</span>
            <span className="entry-body">
              <strong>{e.title || '이름 없는 순간'}</strong>
              <small>
                {e.emotionLabel && `${e.emotionLabel} · `}마음 {signed(e.emotionScore)}
                {!e.showOnGraph && ' · 그래프에 숨김'}
              </small>
            </span>
          </button>
          <span className="entry-actions">
            <button type="button" className="btn btn-text" onClick={() => onEdit(e.id)}>고치기</button>
            <button type="button" className="btn btn-text danger" onClick={() => onRemove(e.id)}>지우기</button>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 순간 하나 고치기 (팝업). 적는 대로 바로 그래프에 들어가고 저장된다. */
function EntryForm({ entry: d, graph, isNew, onChange, onClose, onDelete }: {
  entry: LifeEntry; graph: Graph; isNew: boolean
  onChange: (p: Partial<LifeEntry>) => void; onClose: () => void; onDelete: () => void
}) {
  const set = onChange
  const custom = d.emotionLabel && !EMOTIONS.includes(d.emotionLabel) ? d.emotionLabel : ''
  const timePoint = clamp(d.timePoint, graph.startPoint, graph.currentPoint)

  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="entry-form-head">
        <h2 id="entry-dialog-title" className="card-title">{isNew ? '새로운 순간' : '이 순간 다시 보기'}</h2>
        <small className="muted">적는 대로 저장돼요</small>
      </div>
      <label className="field">
        <span className="field-label">어떤 순간이었나요?</span>
        <input
          value={d.title}
          maxLength={40}
          autoFocus
          placeholder="예) 새로운 친구를 만났던 날"
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <WhenField scale={graph.timeScale} value={timePoint} min={graph.startPoint} max={graph.currentPoint} onChange={(v) => set({ timePoint: v })} />
      <label className="field">
        <span className="field-label">짧은 설명 <em>(선택)</em></span>
        <textarea
          rows={3}
          maxLength={300}
          value={d.description}
          placeholder="생각나는 만큼만 적어도 괜찮아요. 자세히 적지 않아도 돼요."
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <fieldset className="field">
        <legend className="field-label">그때 느꼈던 감정 <em>(선택)</em></legend>
        <div className="chips">
          {EMOTIONS.map((em) => (
            <button
              key={em}
              type="button"
              className="chip"
              aria-pressed={d.emotionLabel === em}
              onClick={() => set({ emotionLabel: d.emotionLabel === em ? '' : em })}
            >
              {em}
            </button>
          ))}
        </div>
        {EMOTION_NOTES[d.emotionLabel] && (
          <p key={d.emotionLabel} className="emotion-note" aria-live="polite">
            <strong>{d.emotionLabel}</strong> — {EMOTION_NOTES[d.emotionLabel]}
          </p>
        )}
        <input
          className="input-sm"
          maxLength={12}
          value={custom}
          placeholder="다른 감정이라면 직접 적어도 좋아요"
          aria-label="감정 직접 적기"
          onChange={(e) => set({ emotionLabel: e.target.value })}
        />
      </fieldset>
      <div className="field">
        <label className="field-label" htmlFor={`score-${d.id}`}>그때 내 마음의 높이</label>
        <input
          id={`score-${d.id}`}
          type="range"
          min={-5}
          max={5}
          step={1}
          value={d.emotionScore}
          aria-valuetext={`${signed(d.emotionScore)}, ${scoreWord(d.emotionScore)}`}
          onChange={(e) => set({ emotionScore: Number(e.target.value) })}
        />
        <div className="range-scale" aria-hidden="true">
          <span>−5 무거웠어요</span>
          <output className="mood" style={{ '--mood': moodColor(d.emotionScore) } as CSSProperties}>
            {signed(d.emotionScore)} · {scoreWord(d.emotionScore)}
          </output>
          <span>환했어요 +5</span>
        </div>
        {d.emotionScore <= -3 ? (
          <div className="care" role="status">
            <p className="care-note serif">그때 많이 힘들었겠어요. 적고 싶은 만큼만 적어도 괜찮아요.</p>
            {d.emotionScore <= -4 && <HelpLine />}
          </div>
        ) : (
          <small className="muted">높낮이는 잘함이 아니라 그때의 마음이에요.</small>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={d.showOnGraph} onChange={(e) => set({ showOnGraph: e.target.checked })} />
        그래프에 점으로 보여주기
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">{isNew ? '이 순간 담기' : '다 고쳤어요'}</button>
        <button type="button" className="btn btn-text danger" onClick={onDelete}>지우기</button>
      </div>
    </form>
  )
}

/* ───────── 3단계: 그때의 마음 ───────── */

function StepReflect({ graph, update }: { graph: Graph; update: Update }) {
  const sorted = sortEntries(graph.entries)
  const setR = (id: string, key: keyof LifeEntry['reflection'], v: string) =>
    update((g) => ({ entries: g.entries.map((e) => (e.id === id ? { ...e, reflection: { ...e.reflection, [key]: v } } : e)) }))

  if (!sorted.length) {
    return (
      <section className="card empty-state">
        <p className="serif big">아직 적은 순간이 없어요.</p>
        <p className="muted">괜찮아요. 바로 지금의 나를 돌아봐도 좋아요.</p>
      </section>
    )
  }
  return (
    <>
      <div className="reflect-top">
        <p className="privacy-note">여기 적은 마음은 공유 링크 · 모임에 나가지 않아요.</p>
        <Breathe />
      </div>
      {sorted.map((e, i) => {
        const filled = ENTRY_QUESTIONS.filter((q) => e.reflection[q.key].trim()).length
        return (
          <details key={e.id} className="card reflect-card" open={i === 0}>
            <summary>
              <span className="entry-time">{timeLabel(graph.timeScale, e.timePoint)}</span>
              <strong>{e.title || '이름 없는 순간'}</strong>
              <span className="reflect-count">{filled ? `${filled}개 적었어요` : '건너뛰어도 괜찮아요'}</span>
            </summary>
            {ENTRY_QUESTIONS.map((q) => (
              <label key={q.key} className="field">
                <span className="field-label">{q.q}</span>
                <textarea
                  rows={2}
                  maxLength={1000}
                  placeholder={q.placeholder}
                  value={e.reflection[q.key]}
                  onChange={(ev) => setR(e.id, q.key, ev.target.value)}
                />
              </label>
            ))}
          </details>
        )
      })}
    </>
  )
}

/* ───────── 4단계: 지금의 나 ───────── */

function StepNow({ graph, update }: { graph: Graph; update: Update }) {
  const r = graph.currentReflection
  const set = (key: keyof typeof r, v: string) => update((g) => ({ currentReflection: { ...g.currentReflection, [key]: v } }))
  return (
    <section className="card letter">
      <p className="letter-head serif">지금의 나에게</p>
      {graph.entries.length > 0 && (
        <div className="recall">
          <ul className="recall-list">
            {sortEntries(graph.entries).slice(0, 6).map((e) => (
              <li key={e.id}>
                <span className="entry-time">{timeLabel(graph.timeScale, e.timePoint)}</span>
                <span className="recall-title">{e.title || '이름 없는 순간'}</span>
              </li>
            ))}
          </ul>
          <p className="serif recall-text">이 순간들을 지나, 지금의 내가 있어요.</p>
        </div>
      )}
      <p className="muted small">마음이 가는 질문 하나면 충분해요.</p>
      {NOW_QUESTIONS.map((q) => (
        <label key={q.key} className="field">
          <span className="field-label">{q.q}</span>
          {q.short ? (
            <input maxLength={60} placeholder={q.placeholder} value={r[q.key]} onChange={(e) => set(q.key, e.target.value)} />
          ) : (
            <textarea rows={3} maxLength={1000} placeholder={q.placeholder} value={r[q.key]} onChange={(e) => set(q.key, e.target.value)} />
          )}
        </label>
      ))}
      <FutureLetter graph={graph} update={update} />
    </section>
  )
}

const LETTER_WHEN: [number, string][] = [[1, '한 달 뒤'], [3, '세 달 뒤'], [6, '여섯 달 뒤'], [12, '1년 뒤']]
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + n)
  return d.toISOString()
}

/** 미래의 나에게 한 통. 정한 날이 지나야 결과 화면에서 열린다. 어디에도 나가지 않는다. */
function FutureLetter({ graph, update }: { graph: Graph; update: Update }) {
  const fl = graph.futureLetter
  const writtenAt = fl?.writtenAt ?? new Date().toISOString()
  const months = fl ? Math.round((Date.parse(fl.openAt) - Date.parse(fl.writtenAt)) / (30.44 * 86_400_000)) : 12
  const put = (text: string, m: number) =>
    update({ futureLetter: text.trim() ? { text, writtenAt, openAt: addMonths(writtenAt, m) } : undefined })
  return (
    <div className="future-letter">
      <p className="letter-head serif">미래의 나에게 <em className="muted small">(선택)</em></p>
      <p className="muted small">정한 날이 지나 이 그래프를 다시 열면, 봉투가 열리며 지금 쓴 편지가 도착해요. 그 전에는 나도 열어 볼 수 없어요.</p>
      <label className="field">
        <span className="field-label">그때의 나에게 건네고 싶은 말</span>
        <textarea rows={3} maxLength={500} placeholder="“잘 지내고 있니? 지금의 나는 …”" value={fl?.text ?? ''} onChange={(e) => put(e.target.value, months)} />
      </label>
      <fieldset className="field">
        <legend className="field-label">언제 열어 볼까요?</legend>
        <div className="segmented">
          {LETTER_WHEN.map(([m, label]) => (
            <label key={m} className="seg">
              <input type="radio" name="letter-when" checked={months === m} disabled={!fl} onChange={() => fl && put(fl.text, m)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

/** 마음 점수 옆의 작은 점 색. 평가가 아니라 분위기만 — 글자로 점수를 함께 알려준다 */
function moodColor(s: number): string {
  if (s > 0) return `color-mix(in srgb, var(--chart-pos) ${40 + s * 12}%, white)`
  if (s < 0) return `color-mix(in srgb, var(--chart-neg) ${40 - s * 12}%, white)`
  return 'var(--chart-neutral)'
}

/** 힘든 기억이 떠오를 때 잠깐 쉬어 가는 숨 고르기 (4초 들이쉬고 · 6초 내쉬기) */
function Breathe() {
  const [on, setOn] = useState(false)
  // rest(작은 원)로 먼저 그린 뒤 다음 프레임에 'in' — 첫 들숨부터 원이 천천히 커지게
  const [phase, setPhase] = useState<'rest' | 'in' | 'out'>('rest')
  useEffect(() => {
    if (!on) return setPhase('rest')
    let t: ReturnType<typeof setTimeout>
    const step = (p: 'in' | 'out') => {
      setPhase(p)
      t = setTimeout(() => step(p === 'in' ? 'out' : 'in'), p === 'in' ? 4000 : 6000)
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => step('in')))
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [on])

  if (!on) {
    return (
      <button type="button" className="btn btn-text btn-sm breathe-open" onClick={() => setOn(true)}>
        잠깐 숨 고르기
      </button>
    )
  }
  return (
    <div className="breathe card" role="group" aria-label="숨 고르기">
      <div className="breathe-stage" aria-hidden="true">
        <div className={`breathe-circle is-${phase}`} />
      </div>
      <p className="serif breathe-text" aria-live="polite">{phase === 'out' ? '길게 내쉬어요…' : '천천히 들이쉬고…'}</p>
      <p className="muted small">힘든 기억은 다 적지 않아도 괜찮아요.</p>
      <HelpLine />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOn(false)}>괜찮아졌어요</button>
    </div>
  )
}

/** 힘들 때 기댈 곳. 마음 점수가 아주 낮을 때 · 숨 고르기를 열었을 때 조용히 보여준다. */
function HelpLine() {
  return (
    <p className="helpline">
      <span>혼자 힘들 땐 이야기 나눌 곳이 있어요.</span>
      <a href={`tel:${HELPLINE.tel}`} className="helpline-call">{HELPLINE.label}</a>
      <small className="muted">{HELPLINE.note}</small>
    </p>
  )
}
