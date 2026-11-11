import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import LifeGraph from '../components/LifeGraph'
import HourRange from '../components/HourRange'
import { EASY_Q, STARTERS, EMOTIONS, QUESTION_SETS, setOf, setByAge, WORD_CARDS, questionsOf, NOW_QUESTIONS, STEPS, HELPLINE, EMOTION_NOTES, LINE_COLORS, WEEKS, eul, lineColorOf, iga, monthFull, monthIndex, rangeLabel, scoreWord, signed, timeLabel, timeParts, fromParts, presetLabel, presetRange, hourInput, hourOf, monthInput, monthOf, rangeValid, todayAt, withPrompts, momentExamples } from '../content'
import { api } from '../api'
import { useAuth, useRepo } from '../auth'
import { dayKey, momentPoint } from '../journal'
import { isMobile } from '../device'
import { useLabs } from '../labs'
import { useEasy } from '../view'
import { formatDate, graphPoints, graphTitle, newEntry, newGraph, sortEntries } from '../store'
import type { GroupPreset, GroupPrompts, LifeEntry, LifeGraph as Graph, TimeScale } from '../types'

const THIS_YEAR = new Date().getFullYear()
const THIS_MONTH = monthIndex()
const LIMITS: Record<'age' | 'year', [number, number]> = { age: [0, 120], year: [1900, THIS_YEAR] }
/** 1단계에서 고르는 시간 기준. 달로: 시작 달 ~ 끝 달 (예전의 ‘최근 12개월’ · ‘올해’ 를 하나로). 시간으로(실험): 하루 · 며칠의 시각 */
const CHOICES: [TimeScale, string][] = [['age', '나이로'], ['year', '연도로'], ['month', '달로'], ['hour', '시간으로']]
const defaultRange = (c: TimeScale): [number, number] =>
  c === 'age' ? [0, 17] : c === 'year' ? [THIS_YEAR - 17, THIS_YEAR] : c === 'month' ? [THIS_MONTH - 11, THIS_MONTH] : [todayAt(9), todayAt(18)]
/** 그래프 기간 안에서의 시점 이름 (시각이면 하루 안은 시각만) */
const tl = (g: Graph, t: number) => timeLabel(g.timeScale, t, [g.startPoint, g.currentPoint])
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
  const finishing = useRef(false) // 완성 저장 뒤에 밀려 있던 자동 저장이 미완성으로 덮어쓰지 않게

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
        const qs = g.questionSet as Graph['questionSet'] | ''
        // 모임장이 정한 질문 (실험): 시작할 때 옮겨 둔다 (나중에 모임이 바꿔도 이 그래프는 그대로)
        const pr = (g as { prompts?: GroupPrompts | null }).prompts
        const prompts = pr && (pr.moments?.length || pr.reflect || pr.now) ? { moments: pr.moments, reflect: pr.reflect, now: pr.now } : undefined
        setGraph((x) => x && !x.groupId ? { ...x, ...(p ? { ...presetRange(p), title: p.title || x.title } : {}), ...(qs ? { questionSet: qs } : {}), ...(prompts ? { prompts } : {}), groupId: g.id, visibility: 'link' } : x)
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
        if (removed.current || finishing.current) return
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
  const rangeOk = rangeValid(graph)
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
    finishing.current = true
    await queue.current
    if (await repo.save(done)) navigate(`/graph/${done.id}?done=1`)
    else {
      finishing.current = false
      setSave('error')
    }
  }
  const where = repo.remote ? '내 계정' : '이 기기'
  const s = STEPS[step - 1]

  return (
    <div className="container page editor">
      <header className="editor-head">
        <div className="editor-title-row">
          <div>
            <p className="eyebrow en">STEP {step} · {s.en}</p>
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
        {(note || !(isMobile() && step === 2)) && <p key={note || step} className={`whisper serif${note ? ' is-note' : ''}`} aria-live="polite">{note || s.whisper}</p>}
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
        {step === 1 && <StepTime graph={graph} update={update} group={group} onDone={() => goTo(2)} />}
        {step === 2 && <StepMoments graph={graph} update={update} removeEntry={removeEntry} onPlaced={placed} past={past} />}
        {step === 3 && <StepReflect graph={graph} update={update} onDone={() => goTo(4)} />}
        {step === 4 && <StepNow graph={graph} update={update} onFinish={finish} />}
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

function StepTime({ graph, update, group, onDone }: { graph: Graph; update: Update; group: Group | null; /** 모바일: 마지막 장에서 2단계로 */ onDone?: () => void }) {
  const labs = useLabs('graph')
  const age = graph.timeScale === 'age'
  const choice = graph.timeScale
  const lim = LIMITS[graph.timeScale === 'year' ? 'year' : 'age']
  // 기준을 바꿔도 이미 적은 순간은 새 범위 안의 같은 비율 위치로 옮긴다 (구간 띠는 단위가 달라 비운다)
  const setChoice = (next: TimeScale) => {
    if (next === choice) return
    // 잘못 눌러도 이미 적은 순간들이 조용히 옮겨져 저장되지 않게 (되돌리려면 ‘고치기 전 모습’ 뿐이다)
    const label = CHOICES.find(([c]) => c === next)?.[1] ?? ''
    if (graph.entries.length && !window.confirm(`기준을 ‘${label}’ 로 바꾸면 적어 둔 순간 ${graph.entries.length}개의 때가 새 기간 안으로 옮겨져요${graph.stages?.length ? ' (인생 구간 띠는 비워져요)' : ''}. 바꿀까요?`)) return
    const [start, end] = defaultRange(next)
    const span = Math.max(1, graph.currentPoint - graph.startPoint)
    update({
      timeScale: next,
      monthRange: undefined,
      stages: undefined,
      startPoint: start,
      currentPoint: end,
      entries: graph.entries.map((e) => ({
        ...e,
        timePoint: clamp(start + Math.round(((e.timePoint - graph.startPoint) / span) * (end - start)), start, end),
      })),
    })
  }
  const ok = rangeValid(graph)

  const nameField = (
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
  )
  const timeField = (<>
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
            {CHOICES.filter(([c]) => c !== 'hour' || labs || choice === 'hour').map(([c, label]) => (
              <label key={c} className="seg">
                <input type="radio" name="scale" checked={choice === c} onChange={() => setChoice(c)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {choice === 'month' ? (
          <div className="field-row">
            <label className="field">
              <span className="field-label">시작 달</span>
              <input type="month" value={monthInput(graph.startPoint)} max={monthInput(THIS_MONTH)} onChange={(e) => { const v = monthOf(e.target.value); if (v !== null) update({ startPoint: v }) }} />
            </label>
            <label className="field">
              <span className="field-label">끝 달</span>
              <input type="month" value={monthInput(graph.currentPoint)} max={monthInput(THIS_MONTH)} onChange={(e) => { const v = monthOf(e.target.value); if (v !== null) update({ currentPoint: v }) }} />
            </label>
          </div>
        ) : choice === 'hour' ? (
          <HourRange start={graph.startPoint} end={graph.currentPoint} onChange={(startPoint, currentPoint) => update({ startPoint, currentPoint })} />
        ) : (
          <div className="field-row">
            <NumberField
              label={isMobile() ? (age ? '시작 나이' : '시작 연도') : age ? '어디서부터 그릴까요? (나이)' : '어디서부터 그릴까요? (연도)'}
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
      {!ok ? (
        <p className="alert" role="alert">
          {choice === 'month' ? '끝 달은 시작 달과 같거나 뒤여야 하고, 36개월까지 그릴 수 있어요.'
            : choice === 'hour' ? '끝 시각은 시작보다 뒤여야 하고, 14일까지 그릴 수 있어요.'
            : '시작 시점은 지금보다 앞이어야 해요. 숫자를 한 번만 다시 확인해 줄래요?'}
        </p>
      ) : (
        <p className="muted small">{choice === 'month' ? `${rangeLabel('month', graph.startPoint, graph.currentPoint)} · 주 단위까지 적을 수 있어요.` : choice === 'hour' ? `${rangeLabel('hour', graph.startPoint, graph.currentPoint)} · 10분 단위로 적어요.` : '대략적인 시간이면 충분해요.'}</p>
      )}
  </>)
  const lookField = (<>
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

      {labs && (
        <details className="stages-more" open={!!graph.stages?.length}>
          <summary>인생 구간 띠 더하기 <em className="muted">(선택)</em></summary>
          <StagesField graph={graph} update={update} />
        </details>
      )}
  </>)
  const whoField = (<>
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
        <div className="segmented">
          <label className="seg">
            <input type="radio" name="vis" checked={graph.visibility === 'private'} onChange={() => update({ visibility: 'private' })} />
            <span>나만 보기</span>
          </label>
          <label className="seg">
            <input type="radio" name="vis" checked={graph.visibility === 'link'} onChange={() => update({ visibility: 'link' })} />
            <span>함께 나누기</span>
          </label>
        </div>
        <small className="muted">{graph.visibility === 'private' ? '기본이에요. 나만 봐요.' : '완성한 뒤 고른 순간만, 회고는 빼고 나눠요.'}</small>
      </fieldset>
      )}
  </>)
  const sections: [string, string, ReactNode, boolean][] = [
    ['name', '이름', nameField, !!graph.title.trim()],
    ['time', '나의 시간', timeField, true],
    ['look', labs ? '선 색 · 구간 띠' : '선 색', lookField, true],
    ['who', '누가 볼까요', whoField, true],
  ]
  // 모바일 · 태블릿: 한 장에 하나씩 (위는 작은 미리보기). PC: 왼쪽 미리보기 · 오른쪽에 구역을 나눠서
  if (isMobile()) {
    return (
      <div className="split split-time is-paged">
        <TimePreview graph={graph} group={group} />
        <section className="card form-card">
          <QuestionPager
            pages={sections.map(([key, , node, done]) => ({ key, done, node }))}
            onEnd={ok ? onDone : undefined}
            endLabel="기억에 남는 순간으로"
          />
        </section>
      </div>
    )
  }
  return (
    <div className="split split-time">
      <TimePreview graph={graph} group={group} />
      <section className="card form-card form-sections time-form">
        {sections.map(([key, , node]) => (
          <div key={key} className="form-section">{node}</div>
        ))}
      </section>
    </div>
  )
}

/** 인생 구간 띠 — 이름과 시작 · 끝 (한 칸 단위). 그래프 시간 눈금 아래에 색 띠로 깔린다 */
function StagesField({ graph, update }: { graph: Graph; update: Update }) {
  const stages = graph.stages ?? []
  const pts = range(graph.startPoint, graph.currentPoint)
  if (pts.length < 2) return null
  const set = (next: NonNullable<Graph['stages']>) => update({ stages: next.length ? next : undefined })
  const patch = (i: number, p: Partial<NonNullable<Graph['stages']>[number]>) => set(stages.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const add = () => {
    const from = clamp(stages.at(-1)?.to ?? graph.startPoint, graph.startPoint, graph.currentPoint - 1)
    set([...stages, { label: '', from, to: Math.min(graph.currentPoint, from + Math.max(1, Math.round((graph.currentPoint - graph.startPoint) / 4))) }])
  }
  return (
    <fieldset className="field stages-field">
      <legend className="field-label">인생 구간 띠 <em>(선택)</em></legend>
      <small className="muted">예) 초등학교 · 중학교 · 첫 직장. 그래프 아래에 색 띠로 깔려요. 이름을 비워 두면 저장되지 않아요.</small>
      {stages.map((st, i) => (
        <div key={i} className={`stage-row is-${i % 5}`}>
          <input value={st.label} maxLength={16} placeholder="구간 이름" aria-label={`${i + 1}번째 구간 이름`} onChange={(e) => patch(i, { label: e.target.value })} />
          <select aria-label={`${i + 1}번째 구간 시작`} value={st.from} onChange={(e) => { const from = Number(e.target.value); patch(i, { from, to: Math.max(st.to, from + 1) }) }}>
            {pts.slice(0, -1).map((t) => <option key={t} value={t}>{tl(graph, t)}</option>)}
          </select>
          <span aria-hidden="true">~</span>
          <select aria-label={`${i + 1}번째 구간 끝`} value={st.to} onChange={(e) => patch(i, { to: Number(e.target.value) })}>
            {pts.filter((t) => t > st.from).map((t) => <option key={t} value={t}>{tl(graph, t)}</option>)}
          </select>
          <button type="button" className="btn btn-text btn-sm danger" onClick={() => set(stages.filter((_, k) => k !== i))}>빼기</button>
        </div>
      ))}
      {stages.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={add}>+ 구간 더하기</button>}
    </fieldset>
  )
}

/** 1단계 왼쪽: 고른 제목 · 기간으로 그려질 선의 틀을 미리 보여준다 */
function TimePreview({ graph, group }: { graph: Graph; group: Group | null }) {
  const ok = rangeValid(graph)
  return (
    <aside className="card graph-card sticky time-preview" aria-label="미리보기">
      <p className="eyebrow en">PREVIEW</p>
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
          stages={graph.stages}
          emptyText="순간을 적으면 여기에 선이 그려져요"
        />
      )}
      <p className="preview-notes muted small">
        정확하지 않아도 괜찮아요 · {group
          ? `완성하면 ‘${group.name}’ 모임에 나눠져요.`
          : graph.visibility === 'private'
            ? '지금은 나만 볼 수 있어요.'
            : '완성한 뒤 고른 것만 나눠요.'}
      </p>
    </aside>
  )
}

/** 긴 글 칸(1000자): 거의 다 찼을 때만 글자 수를 보여 준다 (평소에는 조용히) */
function NearLimit({ n, max = 1000 }: { n: number; max?: number }) {
  return n >= max * 0.8 ? <small className="muted field-count">{n}/{max}</small> : null
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
 * 언제였는지 + ‘언제쯤’(선택). 나이 · 연도는 한 달, 달 기준은 한 주, 시각은 10분 단위까지 고를 수 있다.
 * 지금 시점에서는 더 뒤로 갈 수 없다.
 */
function WhenField({ scale, value, min, max, onChange }: {
  scale: TimeScale; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  if (scale === 'hour') {
    return (
      <label className="field">
        <span className="field-label">그때는 언제였나요?</span>
        <input type="datetime-local" step={600} min={hourInput(min)} max={hourInput(max)} value={hourInput(value)}
          onChange={(e) => { const v = hourOf(e.target.value); if (v !== null) onChange(clamp(v, min, max)) }} />
      </label>
    )
  }
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
  // 모임장이 정한 예시가 있으면 그것 (실험)
  const examples = momentExamples(useLabs('group') ? graph : {})
  const dialog = useRef<HTMLDialogElement>(null)
  // 방금 만든 순간: 닫을 때 ‘선 위에 놓였어요’, ‘+ 순간 적기’ 로 열고 아무것도 안 적었으면 조용히 지운다
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
  // 새 순간은 가장 넓게 빈 구간의 가운데에 (여러 개를 더해도 한 점에 겹치지 않게)
  const middle = () => {
    const ts = [graph.startPoint, ...graph.entries.map((e) => e.timePoint), graph.currentPoint].sort((a, b) => a - b)
    let at = 0
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > ts[at + 1] - ts[at]) at = i - 1
    return Math.round((ts[at] + ts[at + 1]) / 2)
  }
  const patch = (id: string, p: Partial<LifeEntry>) =>
    update((g) => ({ entries: g.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) }))
  /** dismiss: ✕ · Esc 로 그냥 닫기 — 새로 만든 순간에 이름도 설명도 없으면 빼고 닫는다 */
  const close = (dismiss = false) => {
    const f = fresh.current
    fresh.current = null
    setOpenId(null)
    if (!entry) return
    const empty = f?.id === entry.id && (f.dropIfBlank ? isBlank(entry) : dismiss && !entry.title.trim() && !entry.description.trim())
    if (empty) {
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
        <div className="graph-card-head">
          <p className="eyebrow en">MY LINE, SO FAR</p>
          {!isMobile() && <button type="button" className="btn btn-primary btn-sm" onClick={() => add(middle(), 0, '', true)}>+ 순간 적기</button>}
        </div>
        {/* 모바일: 빈 그래프에는 그래프 안 안내만, 순간이 생기면 고치는 법만 */}
        {(!isMobile() || graph.entries.length > 0) && (
          <p className="hint">
            {isMobile()
              ? '빈 곳을 누르면 더해지고, 점을 누르면 고칠 수 있어요.'
              : '빈 곳을 누르거나 ‘+ 순간 적기’ 로 더하고, 점을 끌어 옮겨요.'}
            <span className="kbd-hint"> · 키보드: Tab 으로 고르고 화살표로 옮겨요</span>
          </p>
        )}
        <LifeGraph tone={lineColorOf(graph.lineColor)}
          editable
          noDrag={isMobile()}
          points={graphPoints(graph)}
          timeScale={graph.timeScale}
          start={graph.startPoint}
          end={graph.currentPoint}
          selectedId={openId}
          onSelect={(id) => id && setOpenId(id)}
          onMove={(id, timePoint, emotionScore) => patch(id, { timePoint, emotionScore })}
          onAdd={(t, score) => add(t, score)}
          ghost={past ? graphPoints(past) : undefined}
          stages={graph.stages}
        />
        {past && (
          <p className="muted small ghost-legend">
            <span className="ghost-swatch" aria-hidden="true" />점선은 {formatDate(past.createdAt)}에 그린 ‘{graphTitle(past)}’예요. 지금의 마음으로 다시 그려 봐요.
          </p>
        )}
        {/* 순간이 없을 때만: 막막하면 예시에서 (누르면 같은 창이 그 이름으로 열린다) */}
        {!isMobile() && graph.entries.length === 0 && (
          <details className="moment-examples">
            <summary>무엇을 적을지 막막하면 · 예시에서 고르기</summary>
            <div className="chips">
              {examples.map((t) => <button key={t} type="button" className="chip" onClick={() => add(middle(), 0, t)}>+ {t}</button>)}
            </div>
          </details>
        )}
      </aside>
      {isMobile() ? (
        // 모바일 · 태블릿: 더하는 길은 버튼 하나로, 예시는 순간이 없을 때만 접어서
        <section className="card moments-card-m">
          <button type="button" className="btn btn-primary btn-block" onClick={() => add(middle(), 0, '', true)}>+ 순간 적기</button>
          {graph.entries.length === 0 && (
            <details className="moment-examples">
              <summary>무엇을 적을지 막막하면 · 예시에서 고르기</summary>
              <div className="chips">
                {examples.map((t) => <button key={t} type="button" className="chip" onClick={() => add(middle(), 0, t)}>+ {t}</button>)}
              </div>
            </details>
          )}
          {graph.entries.length > 0 && (
            <>
              <h3 className="field-label moments-list-title">나의 순간들 <small className="muted">{graph.entries.length}개</small></h3>
              <EntryList graph={graph} onEdit={setOpenId} onRemove={removeEntry} />
            </>
          )}
        </section>
      ) : graph.entries.length > 0 && (
        <section className="card moments-list-card">
          <h2 className="card-title">나의 순간들 <small className="muted">{graph.entries.length}개 · 과거 → 지금 · 누르면 고칠 수 있어요</small></h2>
          <EntryList graph={graph} onEdit={setOpenId} onRemove={removeEntry} />
        </section>
      )}
      <dialog
        ref={dialog}
        className="dialog entry-dialog"
        aria-labelledby="entry-dialog-title"
        onCancel={(e) => {
          e.preventDefault() // Esc 는 ✕ 와 같이 그냥 닫기
          close(true)
        }}
      >
        {entry && (
          <EntryForm
            key={entry.id}
            entry={entry}
            graph={graph}
            isNew={fresh.current?.id === entry.id}
            onChange={(p) => patch(entry.id, p)}
            onClose={() => close()}
            onDismiss={() => close(true)}
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
            <span className="entry-time">{tl(graph, e.timePoint)}</span>
            <span className="entry-body">
              <strong>{e.turningPoint && <span className="turning-tag" title="전환점">★</span>}{e.title || '이름 없는 순간'}</strong>
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
function EntryForm({ entry: d, graph, isNew, onChange, onClose, onDismiss, onDelete }: {
  entry: LifeEntry; graph: Graph; isNew: boolean
  onChange: (p: Partial<LifeEntry>) => void; onClose: () => void; onDismiss: () => void; onDelete: () => void
}) {
  const set = onChange
  const labs = useLabs('graph')
  const custom = d.emotionLabel && !EMOTIONS.includes(d.emotionLabel) ? d.emotionLabel : ''
  const timePoint = clamp(d.timePoint, graph.startPoint, graph.currentPoint)
  // 모바일 · 태블릿(/m): 한 화면에 한 질문씩 넘기며 적는다. PC 는 한 장에 모두.
  const paged = isMobile()
  const [page, setPage] = useState(0)

  const sections = [
    <>
      <label className="field">
        <span className="field-label">어떤 순간이었나요?</span>
        <input
          value={d.title}
          maxLength={40}
          // 이미 적은 순간을 다시 열 때는 폰 자판이 화면을 가리지 않게 바로 입력칸으로 가지 않는다
          autoFocus={isNew || !paged}
          placeholder="예) 새로운 친구를 만났던 날"
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
    </>,
    <>
      <WhenField scale={graph.timeScale} value={timePoint} min={graph.startPoint} max={graph.currentPoint} onChange={(v) => set({ timePoint: v })} />
    </>,
    <>
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
    </>,
    <>
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
    </>,
    <>
      <label className="field">
        <span className="field-label">짧은 설명 <em>(선택)</em> <small className="muted">{d.description.length}/300</small></span>
        <textarea
          rows={3}
          maxLength={300}
          value={d.description}
          placeholder="생각나는 만큼만 적어도 괜찮아요. 자세히 적지 않아도 돼요."
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={d.showOnGraph} onChange={(e) => set({ showOnGraph: e.target.checked })} />
        그래프에 점으로 보여주기
      </label>
      {labs && (
        <label className="check">
          <input type="checkbox" checked={!!d.turningPoint} onChange={(e) => set({ turningPoint: e.target.checked || undefined })} />
          <span>★ 내 인생의 전환점이에요 <small className="muted">(그래프에 별로 보여요)</small></span>
        </label>
      )}
    </>
  ]
  const last = !paged || page === sections.length - 1

  return (
    <form
      className={`entry-form${paged ? ' is-paged' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (last) onClose()
        else setPage(page + 1) // 자판의 ‘이동’ 을 누르면 다음 질문으로
      }}
    >
      <div className="entry-form-head">
        {/* 폰에서 이미 적은 순간을 열 때는 제목에 머문다 (자판 · ✕ 테두리가 먼저 뜨지 않게) */}
        <h2 id="entry-dialog-title" className="card-title" tabIndex={-1} autoFocus={paged && !isNew}>{isNew ? '새로운 순간' : '이 순간 다시 보기'}</h2>
        <small className="muted">적는 대로 저장돼요</small>
        {/* 모바일 · 태블릿: 이미 적은 순간은 위쪽에서 지운다 (아래는 이전 · 다음만) */}
        {paged && !isNew && <button type="button" className="btn btn-text btn-sm danger entry-delete" onClick={onDelete}>지우기</button>}
        {/* 그냥 닫기: 적은 것은 그대로 남고, 아무것도 적지 않은 새 순간은 조용히 빠진다 */}
        <button type="button" className="entry-close" onClick={onDismiss} aria-label="닫기">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {paged && (
        <ol className="entry-pages" aria-label={`${sections.length}개 중 ${page + 1}번째 질문`}>
          {sections.map((_, i) => (
            <li key={i} className={i === page ? 'is-on' : i < page ? 'is-done' : undefined}>
              <button type="button" onClick={() => setPage(i)} aria-label={`${i + 1}번째 질문`} />
            </li>
          ))}
        </ol>
      )}
      {paged ? <div key={page} className="entry-page">{sections[page]}</div> : sections.map((s, i) => <div key={i} className="form-section entry-section">{s}</div>)}
      <div className="form-actions">
        {paged && page > 0 && <button type="button" className="btn btn-ghost" onClick={() => setPage(page - 1)}>이전</button>}
        {last
          ? <button type="submit" className="btn btn-primary">{isNew ? '이 순간 담기' : '다 고쳤어요'}</button>
          : <button type="submit" className="btn btn-primary">다음</button>}
        {!paged && <button type="button" className="btn btn-text danger" onClick={onDelete}>지우기</button>}
      </div>
    </form>
  )
}

/* ───────── 3단계: 그때의 마음 ───────── */

function StepReflect({ graph, update, onDone }: { graph: Graph; update: Update; /** 모바일: 마지막 순간의 마지막 질문에서 4단계로 */ onDone?: () => void }) {
  const sorted = sortEntries(graph.entries)
  const labs = useLabs('graph')
  const paged = isMobile()
  const easy = useEasy() && labs
  const groupLabs = useLabs('group')
  // 펼친 순간 하나 · ‘질문 더 보기’ 를 연 순간들
  const [openId, setOpenId] = useState<string | null>(sorted[0]?.id ?? null)
  const [more, setMore] = useState<string[]>([])
  /** 이 순간의 질문: 순간마다 고른 묶음 > 그래프의 묶음, 기본 묶음이면 쉬운 말도. 모임장이 정한 질문(실험)이 있으면 그것으로 */
  const questionsOfEntry = (e: LifeEntry) => {
    const set = setOf(graph, e)
    const qs = allQuestions({ ...graph, questionSet: set === 'basic' ? undefined : set }, labs).map((q) => (easy && set === 'basic' && EASY_Q[q.key] ? { ...q, q: EASY_Q[q.key] } : q))
    return groupLabs ? withPrompts(qs, graph.prompts?.reflect) : qs
  }
  const setEntrySet = (id: string, set: string) => update((g) => ({ entries: g.entries.map((e) => (e.id === id ? { ...e, questionSet: set as LifeEntry['questionSet'] } : e)) }))
  const setR = (id: string, key: string, v: string) =>
    update((g) => ({
      entries: g.entries.map((e) => {
        if (e.id !== id) return e
        if (!key.startsWith('x')) return { ...e, reflection: { ...e.reflection, [key]: v } }
        const extra = [...(e.reflection.extra ?? [])]
        extra[Number(key.slice(1))] = v
        return { ...e, reflection: { ...e.reflection, extra: Array.from(extra, (x) => x ?? '') } }
      }),
    }))

  const mixed = graph.entries.some((e) => e.questionSet && e.questionSet !== (graph.questionSet ?? 'basic'))
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
      {/* 질문 묶음 — 접어 두고, 필요할 때만 펼쳐 바꾼다 (적은 글은 그대로) */}
      {labs && (
        <details className="card reflect-setup">
          <summary>질문 바꾸기 <small className="muted">지금: {mixed ? '순간마다 달라요' : QUESTION_SETS[graph.questionSet ?? 'basic'].name}{graph.myQuestions?.length ? ` · 나만의 질문 ${graph.myQuestions.length}개` : ''}</small></summary>
          <fieldset className="field question-sets">
            <legend className="sr-only">질문 묶음</legend>
            <div className="segmented">
              {Object.entries(QUESTION_SETS).map(([k, set]) => (
                <label key={k} className="seg">
                  <input type="radio" name="question-set" checked={!mixed && (graph.questionSet ?? 'basic') === k} onChange={() => update((g) => ({ questionSet: k === 'basic' ? undefined : (k as Graph['questionSet']), entries: g.entries.map(({ questionSet: _q, ...e }) => e) }))} />
                  <span>{set.name}</span>
                </label>
              ))}
            </div>
            <p className="muted small">모든 순간에 한 번에 바뀌고, 적은 글은 그대로 남아요.
              {graph.timeScale === 'age' && (
                <button type="button" className="btn btn-text btn-sm" title="19살까지 학교생활 · 39살까지 진로 · 그 뒤 기본" onClick={() => update((g) => ({ entries: g.entries.map((e) => ({ ...e, questionSet: setByAge(e.timePoint) })) }))}>
                  나이에 맞춰 고르기
                </button>
              )}
            </p>
          </fieldset>
          <MyQuestions graph={graph} update={update} />
        </details>
      )}
      <div className="reflect-top">
        <p className="privacy-note">여기 적은 마음은 공유 링크 · 모임에 나가지 않아요.</p>
        <Breathe />
        {onDone && <button type="button" className="btn btn-ghost btn-sm reflect-skip" onClick={onDone}>건너뛰고 지금의 나로 ›</button>}
      </div>
      {paged ? (
        <ReflectPaged graph={graph} sorted={sorted} questionsOf={questionsOfEntry} setR={setR} onDone={onDone} onSet={labs ? setEntrySet : undefined} />
      ) : sorted.map((e, i) => {
        const questions = questionsOfEntry(e)
        const filled = questions.filter((q) => answerOf(e, q.key).trim()).length
        // 처음엔 두 질문만. 더 적었거나 ‘질문 더 보기’ 를 누르면 모두
        const all = more.includes(e.id) || questions.slice(2).some((q) => answerOf(e, q.key).trim())
        const next = sorted[i + 1]
        return (
          <details key={e.id} className="card reflect-card" open={openId === e.id}
            onToggle={(ev) => { const o = (ev.currentTarget as HTMLDetailsElement).open; if (o) setOpenId(e.id); else if (openId === e.id) setOpenId(null) }}>
            <summary>
              <span className="entry-time">{tl(graph, e.timePoint)}</span>
              <strong>{e.title || '이름 없는 순간'}</strong>
              {filled > 0 && <span className="reflect-count">{filled}/{questions.length} 적었어요</span>}
            </summary>
            {(all ? questions : questions.slice(0, 2)).map((q) => (
              <label key={q.key} className="field">
                <span className="field-label">{q.q}</span>
                <textarea
                  rows={2}
                  maxLength={1000}
                  placeholder={q.placeholder}
                  value={answerOf(e, q.key)}
                  onChange={(ev) => setR(e.id, q.key, ev.target.value)}
                />
                <NearLimit n={answerOf(e, q.key).length} />
                {labs && <Starters onPick={(t) => setR(e.id, q.key, addStart(answerOf(e, q.key), t))} />}
              </label>
            ))}
            <div className="reflect-card-foot">
              {!all && questions.length > 2 && (
                <button type="button" className="btn btn-text btn-sm" onClick={() => setMore((m) => [...m, e.id])}>질문 더 보기 ({questions.length - 2})</button>
              )}
              {labs && <EntrySetPick value={setOf(graph, e)} onChange={(v) => setEntrySet(e.id, v)} />}
              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(next?.id ?? null)}>
                {next ? (filled ? '다음 순간 ›' : '이 순간 건너뛰기 ›') : '접기'}
              </button>
            </div>
          </details>
        )
      })}
    </>
  )
}

/** 그때의 마음 질문: 고른 묶음 + (실험) 나만의 질문(key x0 · x1 · x2) */
type Question = { key: string; q: string; placeholder: string }
const allQuestions = (g: Graph, labs: boolean): Question[] => [
  ...questionsOf(g),
  ...(labs ? (g.myQuestions ?? []).map((q, i) => ({ key: `x${i}`, q, placeholder: '내가 만든 질문이에요' })) : []),
]
const answerOf = (e: LifeEntry, key: string) =>
  key.startsWith('x') ? (e.reflection.extra?.[Number(key.slice(1))] ?? '') : ((e.reflection as unknown as Record<string, string>)[key] ?? '')

/** 나만의 질문 (3개까지). 빼면 그 질문에 적은 답도 함께 빠진다 */
function MyQuestions({ graph, update }: { graph: Graph; update: Update }) {
  const list = graph.myQuestions ?? []
  const [open, setOpen] = useState(list.length > 0)
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (!t || list.length >= 3) return
    update({ myQuestions: [...list, t] })
    setText('')
  }
  const remove = (i: number) =>
    update((g) => ({
      myQuestions: list.length > 1 ? list.filter((_, k) => k !== i) : undefined,
      entries: g.entries.map((e) => (e.reflection.extra ? { ...e, reflection: { ...e.reflection, extra: e.reflection.extra.filter((_, k) => k !== i) } } : e)),
    }))
  if (!open) {
    return <button type="button" className="btn btn-text btn-sm my-q-open" onClick={() => setOpen(true)}>+ 나만의 질문 더하기 <small className="muted">(선택 · 3개까지)</small></button>
  }
  return (
    <div className="my-questions">
      <p className="field-label">나만의 질문 <em>(선택 · 3개까지)</em> {!list.length && <button type="button" className="btn btn-text btn-sm" onClick={() => setOpen(false)}>접기</button>}</p>
      {list.length > 0 && (
        <ol className="my-q-list">
          {list.map((q, i) => (
            <li key={`${i}-${q}`}><span>{q}</span><button type="button" className="btn btn-text btn-sm danger" onClick={() => remove(i)}>빼기</button></li>
          ))}
        </ol>
      )}
      {list.length < 3 && (
        <div className="inline-form">
          <input value={text} maxLength={100} placeholder="예) 그때 곁에 있던 사람은 누구였나요?" aria-label="나만의 질문" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!text.trim()} onClick={add}>더하기</button>
        </div>
      )}
    </div>
  )
}

/**
 * 모바일 · 태블릿: 질문을 한 장에 하나씩. 위 점으로 어디쯤인지 · 적었는지 보이고, 눌러서 건너간다.
 * onEnd: 마지막 장에서 ‘다음’ 을 누르면 (예: 다음 순간으로)
 */
function QuestionPager({ pages, onEnd, endLabel = '다음', resetKey }: {
  pages: { key: string; done: boolean; node: ReactNode }[]
  onEnd?: () => void
  endLabel?: string
  /** 바뀌면 첫 장으로 (순간을 바꿀 때) */
  resetKey?: string
}) {
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [resetKey])
  const at = Math.min(i, pages.length - 1)
  const last = at === pages.length - 1
  return (
    <div className="q-pager">
      <div className="q-pager-top">
        <ol className="q-dots" aria-label={`${pages.length}개 중 ${at + 1}번째`}>
          {pages.map((p, k) => (
            <li key={p.key}>
              <button type="button" className={`${k === at ? 'is-on' : ''}${p.done ? ' is-done' : ''}`} aria-label={`${k + 1}번째${p.done ? ' (적음)' : ''}`} aria-current={k === at ? 'step' : undefined} onClick={() => setI(k)} />
            </li>
          ))}
        </ol>
        <span className="muted small">{at + 1} / {pages.length}</span>
      </div>
      <div key={`${resetKey ?? ''}-${at}`} className="q-page">{pages[at].node}</div>
      <div className="q-pager-nav">
        <button type="button" className="btn btn-text btn-sm" disabled={at === 0} onClick={() => setI(at - 1)}>‹ 이전 질문</button>
        {!last ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setI(at + 1)}>다음 질문 ›</button>
        ) : onEnd ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEnd}>{endLabel} ›</button>
        ) : <span className="muted small q-end">✓ 마지막 질문이에요</span>}
      </div>
    </div>
  )
}

/** 모바일 · 태블릿 3단계: 위에 순간 칩(적은 수), 고른 순간의 질문을 한 장씩 */
function ReflectPaged({ graph, sorted, questionsOf, setR, onDone, onSet }: {
  graph: Graph; sorted: LifeEntry[]; questionsOf: (e: LifeEntry) => Question[]
  setR: (id: string, key: string, v: string) => void
  onDone?: () => void
  /** 이 순간의 질문 묶음 바꾸기 */
  onSet?: (id: string, set: string) => void
}) {
  const [pick, setPick] = useState(sorted[0]?.id ?? '')
  const idx = Math.max(0, sorted.findIndex((e) => e.id === pick))
  const e = sorted[idx]
  const filledOf = (x: LifeEntry) => questionsOf(x).filter((q) => answerOf(x, q.key).trim()).length
  const next = sorted[idx + 1]
  return (
    <section className="card reflect-paged">
      {/* 지금 돌아보는 순간 하나만 크게. ‹ › 로 넘기고, 가운데를 누르면 폰의 목록에서 고른다 */}
      <div className="moment-pager">
        <button type="button" className="m-icon-btn" disabled={idx === 0} onClick={() => setPick(sorted[idx - 1].id)} aria-label="이전 순간">‹</button>
        <label className="moment-head-main">
          <span className="moment-head-meta">순간 {idx + 1} / {sorted.length} · {tl(graph, e.timePoint)}</span>
          <strong className="moment-head-title">{e.title || '이름 없는 순간'} <span aria-hidden="true">▾</span></strong>
          <span className="moment-head-meta">{filledOf(e) ? `${filledOf(e)}/${questionsOf(e).length} 적었어요` : '아직 적지 않았어요'}</span>
          <select className="moment-head-select" value={e.id} aria-label="돌아볼 순간 고르기" onChange={(ev) => setPick(ev.target.value)}>
            {sorted.map((x, k) => (
              <option key={x.id} value={x.id}>{k + 1}. {tl(graph, x.timePoint)} · {x.title || '이름 없는 순간'} ({filledOf(x)}/{questionsOf(x).length} 적음)</option>
            ))}
          </select>
        </label>
        <button type="button" className="m-icon-btn" disabled={!next} onClick={() => next && setPick(next.id)} aria-label="다음 순간">›</button>
      </div>
      {onSet && <EntrySetPick value={setOf(graph, e)} onChange={(v) => onSet(e.id, v)} />}
      <QuestionPager
        resetKey={`${e.id}-${setOf(graph, e)}`}
        pages={questionsOf(e).map((q) => ({
          key: q.key,
          done: !!answerOf(e, q.key).trim(),
          node: (
            <label className="field">
              <span className="field-label">{q.q}</span>
              <textarea rows={4} maxLength={1000} placeholder={q.placeholder} value={answerOf(e, q.key)} onChange={(ev) => setR(e.id, q.key, ev.target.value)} />
              <NearLimit n={answerOf(e, q.key).length} />
              <StartersIf onPick={(t) => setR(e.id, q.key, addStart(answerOf(e, q.key), t))} />
            </label>
          ),
        }))}
        onEnd={next ? () => setPick(next.id) : onDone}
        endLabel={next ? `다음 순간: ${next.title || '이름 없는 순간'}` : '지금의 나로'}
      />
      <p className="muted small reflect-paged-note">건너뛰어도 괜찮아요. 마음이 가는 질문만 적어요.</p>
    </section>
  )
}

/* ───────── 4단계: 지금의 나 ───────── */

/** 먼저 묻는 두 질문 (단어 · 한 문장). 나머지는 ‘더 적어 보기’ 에 */
const NOW_FIRST = ['word', 'oneLine']
function StepNow({ graph, update, onFinish }: { graph: Graph; update: Update; onFinish: () => void }) {
  const labs = useLabs('graph')
  const groupLabs = useLabs('group')
  const r = graph.currentReflection
  const set = (key: keyof typeof r, v: string) => update((g) => ({ currentReflection: { ...g.currentReflection, [key]: v } }))
  const paged = isMobile()
  const easy = useEasy() && labs
  // 모임장이 정한 질문(실험)으로 바꾸거나 빼고, 단어 · 한 문장을 먼저
  const qs = (groupLabs ? withPrompts(NOW_QUESTIONS, graph.prompts?.now) : NOW_QUESTIONS).map((q) => ({ ...q, q: (easy && !graph.prompts?.now?.[q.key] && EASY_Q[q.key]) || q.q }))
  const first = qs.filter((q) => NOW_FIRST.includes(q.key)).sort((a, b) => NOW_FIRST.indexOf(a.key) - NOW_FIRST.indexOf(b.key))
  const rest = qs.filter((q) => !NOW_FIRST.includes(q.key))
  const [moreOpen, setMoreOpen] = useState(() => rest.some((q) => r[q.key].trim()))
  /** 질문 하나 (단어 카드 포함) */
  const nowField = (q: (typeof qs)[number]) => (
    <label className="field">
      <span className="field-label">{q.q}</span>
      {q.short ? (
        <>
          <input maxLength={60} placeholder={q.placeholder} value={r[q.key]} onChange={(e) => set(q.key, e.target.value)} />
          {/* 막막하면 단어 카드에서 골라요 */}
          {labs && q.key === 'word' && (
            <details className="word-more">
              <summary>막막하면 단어 카드에서 고르기</summary>
              <span className="chips word-cards" role="group" aria-label="단어 카드에서 고르기">
                {WORD_CARDS.map((w) => (
                  <button key={w} type="button" className="chip" aria-pressed={r.word === w} onClick={(e) => { e.preventDefault(); set('word', r.word === w ? '' : w) }}>{w}</button>
                ))}
              </span>
            </details>
          )}
        </>
      ) : (
        <>
          <textarea rows={paged ? 4 : 3} maxLength={1000} placeholder={q.placeholder} value={r[q.key]} onChange={(e) => set(q.key, e.target.value)} />
          <NearLimit n={r[q.key].length} />
          {labs && paged && <Starters onPick={(t) => set(q.key, addStart(r[q.key], t))} />}
        </>
      )}
    </label>
  )
  return (
    <>
    <section className="card letter">
      <div className="letter-top">
        <p className="letter-head serif">지금의 나에게</p>
        <button type="button" className="btn btn-text btn-sm" onClick={onFinish}>적지 않고 완성하기 ›</button>
      </div>
      {/* 지나온 순간은 한 줄로 (질문이 바로 보이게) */}
      {graph.entries.length > 0 && (() => {
        const names = sortEntries(graph.entries).map((e) => e.title || '이름 없는 순간')
        return <p className="serif recall-inline">{names.slice(0, 3).join(' · ')}{names.length > 3 ? ` 외 ${names.length - 3}개` : ''}의 순간을 지나, 지금의 내가 있어요.</p>
      })()}
      {paged ? (
        <QuestionPager
          pages={[
            ...[...first, ...rest].map((q) => ({ key: q.key, done: !!r[q.key].trim(), node: nowField(q) })),
            { key: 'letter', done: !!graph.futureLetter, node: <FutureLetter graph={graph} update={update} /> },
          ]}
        />
      ) : <>
        {first.map((q) => <div key={q.key} className="form-section">{nowField(q)}</div>)}
        {rest.length > 0 && (moreOpen
          ? rest.map((q) => <div key={q.key} className="form-section">{nowField(q)}</div>)
          : <button type="button" className="btn btn-ghost btn-sm now-more" onClick={() => setMoreOpen(true)}>+ 더 적어 보기 <small className="muted">질문 {rest.length}개 더</small></button>)}
      </>}
      <p className="muted small">마음이 가는 질문 하나면 충분해요. 비워 두고 완성해도 괜찮아요.</p>
    </section>
    {!paged && (
      <details className="card letter letter-future" open={!!graph.futureLetter}>
        <summary className="letter-future-sum">✉ 미래의 나에게 편지 쓰기 <small className="muted">(선택)</small></summary>
        <FutureLetter graph={graph} update={update} />
      </details>
    )}
    </>
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
  // 편지를 쓰기 전에도 열 날을 먼저 고를 수 있게, 고른 값은 여기 기억해 두었다가 쓰기 시작할 때 쓴다
  const [picked, setPicked] = useState(12)
  const months = fl ? Math.round((Date.parse(fl.openAt) - Date.parse(fl.writtenAt)) / (30.44 * 86_400_000)) : picked
  const put = (text: string, m: number) =>
    update({ futureLetter: text.trim() ? { text, writtenAt, openAt: addMonths(writtenAt, m) } : undefined })
  const choose = (m: number) => {
    setPicked(m)
    if (fl) put(fl.text, m)
  }
  return (
    <div className="future-letter">
      <p className="letter-head serif">
        <svg className="letter-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 6l9 7 9-7" /></svg>
        미래의 나에게 <em className="muted small">(선택)</em>
      </p>
      <p className="muted small">정한 날이 지나 이 그래프를 다시 열면, 봉투가 열리며 지금 쓴 편지가 도착해요. 그 전에는 나도 열어 볼 수 없어요.</p>
      <label className="field">
        <span className="field-label">그때의 나에게 건네고 싶은 말 <small className="muted">{(fl?.text ?? '').length}/500</small></span>
        <textarea rows={3} maxLength={500} placeholder="“잘 지내고 있니? 지금의 나는 …”" value={fl?.text ?? ''} onChange={(e) => put(e.target.value, months)} />
      </label>
      <fieldset className="field">
        <legend className="field-label">언제 열어 볼까요?</legend>
        <div className="segmented">
          {LETTER_WHEN.map(([m, label]) => (
            <label key={m} className="seg">
              <input type="radio" name="letter-when" checked={months === m} onChange={() => choose(m)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {/* 고른 기간으로 실제 열리는 날 */}
      <p className="letter-open">✉ {(() => { const d = new Date(addMonths(writtenAt, months)); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` })()}에 열려요{fl ? '' : ' (편지를 쓰면 이 날로 정해져요)'}</p>
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

/** 막막할 때 눌러 넣는 문장 시작 (적은 글 뒤에 이어 붙인다). 적고 있는 칸에만 보인다 — 누를 때 칸의 초점을 빼앗지 않는다 */
const addStart = (cur: string, t: string) => (cur.trim() ? `${cur.replace(/\s*$/, ' ')}${t}` : t)
function Starters({ onPick }: { onPick: (t: string) => void }) {
  return (
    <span className="starters" role="group" aria-label="문장 시작 넣기">
      <span className="starters-hint" aria-hidden="true">막막하면</span>
      {STARTERS.map((t) => <button key={t} type="button" className="starter" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); onPick(t) }}>{t.trim()}…</button>)}
    </span>
  )
}
/** 모바일 한 장 안에서 (훅을 쓸 수 있게 따로) */
function StartersIf({ onPick }: { onPick: (t: string) => void }) {
  return useLabs('graph') ? <Starters onPick={onPick} /> : null
}

/** 이 순간의 질문 묶음 고르기 */
function EntrySetPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="entry-qset">
      <span className="muted small">이 순간의 질문</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(QUESTION_SETS).map(([k, set]) => <option key={k} value={k}>{set.name}</option>)}
      </select>
    </label>
  )
}
