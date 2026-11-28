import EmptyDoodle from '../components/EmptyDoodle'
import { confirmDialog } from '../components/confirm'
import { useNewAnswers } from './Contact'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useNavigate } from '../nav'
import { api, remoteRepo, type Answer, type ReceivedCheer } from '../api'
import { useAuth, useRepo } from '../auth'
import LifeGraph from '../components/LifeGraph'
import { eul, lineColorOf, moodOf } from '../content'
import { formatDate, graphPoints, graphTitle, localRepo } from '../store'
import type { LifeGraph as Graph } from '../types'
import { dayKey, useJournal } from '../journal'
import { BirthField } from './Login'
import { downloadMyData, useLabs } from '../labs'
import MoodWords from '../components/MoodWords'

/** 멈춘 단계를 기억해 두었으면 그 단계로 (편집기가 이 기기에 남긴 것) */
export const editHref = (id: string) => { let step = 0; try { step = Number(localStorage.getItem(`geuryeobom:step:${id}`)) } catch { /* 기억 못 하면 1단계부터 */ } return `/graph/${id}/edit${step > 1 ? `?step=${step}` : ''}` }

export default function MyGraphs() {
  const repo = useRepo()
  const { user } = useAuth()
  const [graphs, setGraphs] = useState<Graph[] | null>(null)
  const [localCount, setLocalCount] = useState(0)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('') // 검색 (1.3.0): 이름 · 순간 · 마음 단어 · 한 줄
  const star = async (g: Graph) => {
    const n = { ...g, starred: !g.starred }
    if (await repo.save(n)) setGraphs((gs) => gs && gs.map((x) => (x.id === g.id ? n : x)))
  }
  const hit = (g: Graph, k: string) => [g.title, g.currentReflection.word, g.currentReflection.oneLine, ...g.entries.flatMap((e) => [e.title, e.description, e.emotionLabel])].some((t) => t.toLowerCase().includes(k))
  const key = q.trim().toLowerCase()
  const shown = (graphs ?? []).filter((g) => !key || hit(g, key)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred))

  const load = () =>
    repo.list().then(setGraphs, () => {
      setGraphs([])
      setErr('기록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')
    })
  useEffect(() => {
    load()
    // 로그인했는데 이 기기에만 남아 있는 기록이 있으면 옮길 수 있게 알려준다
    if (user) localRepo.list().then((l) => setLocalCount(l.length))
  }, [repo, user])

  const remove = async (g: Graph) => {
    if (!await confirmDialog(`‘${graphTitle(g)}’ 기록을 지울까요? 지운 뒤에는 되돌릴 수 없어요.`)) return
    if (await repo.remove(g.id)) setGraphs((gs) => gs?.filter((x) => x.id !== g.id) ?? null)
    else setErr('지우지 못했어요. 잠시 뒤에 다시 해볼까요?')
  }

  const moveLocal = async () => {
    const local = await localRepo.list()
    for (const g of local) {
      if (!(await remoteRepo.save(g))) {
        setErr('옮기는 중에 문제가 생겼어요. 남은 기록은 이 기기에 그대로 있어요.')
        break
      }
      await localRepo.remove(g.id)
    }
    setLocalCount((await localRepo.list()).length)
    load()
  }

  return (
    <section className="container page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">MY STORIES, MY COLLECTION</p>
          <h1 className="page-title">기록 모아보기</h1>
          <p className="muted">내가 그린 선들이, 나의 이야기가 되는 곳.</p>
        </div>
        {graphs && graphs.length > 0 && <Link to="/graph/new" className="btn btn-primary">새 그래프 그리기</Link>}
      </header>

      <NewAnswers />
      {user && localCount > 0 && (
        <div className="demo-note move-note">
          <span>이 기기에만 저장된 기록이 {localCount}개 있어요. 내 계정으로 옮기면 다른 기기에서도 볼 수 있고, 이 기기에서는 지워져요.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={moveLocal}>내 계정으로 옮기기</button>
        </div>
      )}
      {user && <ReceivedCheers />}
      {(new Date().getMonth() === 11 || new Date().getMonth() === 0) && (
        <Link to={`/review/${new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear()}`} className="card review-banner">
          <span className="eyebrow en">MY YEAR, MY LINE</span>
          <span className="serif review-banner-title">한 해를 돌아볼 시간이에요</span>
          <span className="muted small">남긴 한 줄과 마음 색, 선 위의 순간들을 한 장으로 ›</span>
        </Link>
      )}
      {err && <p className="alert" role="alert">{err}</p>}

      {graphs === null ? (
        <p className="muted serif is-loading">불러오는 중이에요…</p>
      ) : graphs.length === 0 ? (
        <div className="card empty-state my-empty">
          {/* 빈 폴라로이드 틀: 첫 장이 붙을 자리 */}
          <Link to="/graph/new" className="empty-polaroid" aria-label="첫 그래프 그리기"><span className="empty-polaroid-photo"><EmptyDoodle /></span><span className="empty-polaroid-cap">첫 장을 붙여 봐요</span></Link>
          <p className="serif big">아직 그려진 이야기가 없어요.</p>
          <p className="muted">첫 번째 나의 그래프를 그려볼까요?</p>
          <Link to="/graph/new" className="btn btn-primary">나의 그래프 그리기</Link>
        </div>
      ) : (<>
        {graphs.length > 3 && (
          <p className="my-search no-print">
            <input type="search" value={q} placeholder="이름 · 순간 · 마음 단어로 찾기" aria-label="기록 찾기" onChange={(e) => setQ(e.target.value)} />
            {key && <small className="muted">{shown.length}개</small>}
          </p>
        )}
        {key && !shown.length && <p className="list-empty">‘{q}’ 가 들어간 기록이 없어요.</p>}
        <ul className="tile-grid">
          {shown.map((g) => (
            <li key={g.id} className="card tile">
              <Link to={g.completed ? `/graph/${g.id}` : editHref(g.id)} className="tile-link">
                <LifeGraph compact tone={lineColorOf(g.lineColor)} points={graphPoints(g)} timeScale={g.timeScale} start={g.startPoint} end={g.currentPoint} />
                <h2>{graphTitle(g)}</h2>
              </Link>
              {/* 날짜는 한 줄로 (두 줄 · 한 줄이 섞여 카드 아래 버튼 줄이 들쭉날쭉하던 것) — 처음 그린 날은 가리키면 */}
              <p className="muted small" title={`처음 그린 날 ${formatDate(g.createdAt)}`}>
                {formatDate(g.createdAt) === formatDate(g.updatedAt) ? `${formatDate(g.createdAt)}에 그림` : `${formatDate(g.updatedAt)}에 고침`}
              </p>
              <div className="tile-foot">
                <span className="badge">{g.completed ? '완성' : '그리는 중'}</span>
                <span className="badge badge-soft">{g.visibility === 'link' ? '함께 나누기' : '나만 보기'}</span>
                <span className="spacer" />
                <button type="button" className={`btn btn-text star${g.starred ? ' is-on' : ''}`} aria-pressed={!!g.starred} aria-label={g.starred ? '별 표시 지우기' : '별 표시'} onClick={() => star(g)}>{g.starred ? '★' : '☆'}</button>
                <Link to={editHref(g.id)} className="btn btn-text">고치기</Link>
                <button type="button" className="btn btn-text danger" onClick={() => remove(g)}>지우기</button>
              </div>
            </li>
          ))}
        </ul>
      </>)}

      <p className="my-more no-print">{(graphs?.length ?? 0) > 0 && <Link to="/my/book" className="chip">내 기록 한 권 (PDF)</Link>}<Link to="/me/overview" className="chip">내 흐름</Link>{user && <Link to="/lines" className="chip">오늘의 한 줄 모아보기</Link>}<Link to="/words" className="chip">마음 서랍</Link><Link to="/letters" className="chip">편지함</Link>{user && <Link to="/inbox" className="chip">소식함</Link>}</p>
      <MoodWords graphs={graphs ?? []} />
      <MyAnswers graphs={graphs ?? []} />

      <p className="muted small center storage-note">
        {user
          ? `${user.nickname}님의 기록은 내 계정에 있어요.`
          : '기록은 이 기기의 브라우저에만 있어요.'}
      </p>
      {user && <ExportMine />}
      {user && <DeleteAccount />}
    </section>
  )
}

/** 오늘의 질문에 남긴 한 줄 모아보기: 달력 (남긴 날에 점) · 목록. 마음에 드는 한 줄은 그래프의 순간으로 옮긴다. */
function MyAnswers({ graphs }: { graphs: Graph[] }) {
  const journal = useJournal()
  const navigate = useNavigate()
  const [list, setList] = useState<Answer[] | null>(null)
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar')
  const [month, setMonth] = useState(() => dayKey().slice(0, 7)) // YYYY-MM
  const [pick, setPick] = useState<string | null>(null) // 고른 날
  const [moving, setMoving] = useState<Answer | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    journal.list().then(setList, () => setList([]))
  }, [journal])
  // 첫 화면의 ‘지난 한 줄 보기’(/my#answers)로 왔으면 여기로
  useEffect(() => {
    if (list?.length && window.location.hash === '#answers') document.getElementById('answers')?.scrollIntoView({ behavior: 'smooth' })
  }, [list])
  if (!list?.length) return null
  const byDay = new Map(list.map((a) => [a.day, a]))
  const remove = async (a: Answer) => {
    if (!await confirmDialog('이 한 줄을 지울까요?')) return
    if (await journal.save({ ...a, text: '' })) setList((l) => l?.filter((x) => x.day !== a.day) ?? null)
  }
  const move = (a: Answer, g: Graph) =>
    navigate(`/graph/${g.id}/edit?step=2&moment=${encodeURIComponent(a.text)}&q=${encodeURIComponent(a.question)}&at=${a.day}`)

  // 달력: 그 달 1일의 요일만큼 비우고 날짜를 채운다
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1).getDay()
  const days = new Date(y, m, 0).getDate()
  const shift = (k: number) => {
    const d = new Date(y, m - 1 + k, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    setPick(null)
  }
  const inMonth = list.filter((a) => a.day.startsWith(month)).length
  const picked = pick ? byDay.get(pick) : undefined
  const shown = all ? list : list.slice(0, 7)

  const Item = ({ a }: { a: Answer }) => (
    <li>
      <span className="answers-day">
        {moodOf(a.color) && <i className="look-back-dot" style={{ background: moodOf(a.color)!.hex }} title={moodOf(a.color)!.name} aria-hidden="true" />}
        {Number(a.day.slice(5, 7))}월 {Number(a.day.slice(8))}일{a.day.slice(0, 4) !== String(new Date().getFullYear()) && ` · ${a.day.slice(0, 4)}`}
      </span>
      <span className="answers-body">
        <small className="muted">{a.question}</small>
        <span className="serif">{a.text}</span>
      </span>
      <span className="answers-actions">
        {graphs.length > 0 && <button type="button" className="btn btn-text btn-sm" onClick={() => setMoving(moving?.day === a.day ? null : a)}>순간으로 옮기기</button>}
        <button type="button" className="btn btn-text btn-sm muted" aria-label={`${a.day}의 한 줄 지우기`} onClick={() => remove(a)}>지우기</button>
      </span>
      {moving?.day === a.day && (
        <span className="answers-move">
          <small className="muted">어느 그래프에 담을까요? 그 날짜쯤에 순간으로 놓여요.</small>
          <span className="chips">
            {graphs.map((g) => <button key={g.id} type="button" className="chip" onClick={() => move(a, g)}>{graphTitle(g)}</button>)}
          </span>
        </span>
      )}
    </li>
  )

  return (
    <section id="answers" className="card answers-card">
      <div className="answers-head">
        <h2 className="card-title">나의 한 줄 <small className="muted">{list.length}</small></h2>
        <div className="segmented segmented-sm" role="tablist" aria-label="보기">
          {(['calendar', 'list'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className="seg-btn" onClick={() => setMode(k)}>{k === 'calendar' ? '달력' : '목록'}</button>
          ))}
        </div>
      </div>
      <p className="muted small">첫 화면 ‘오늘의 질문’에 남긴 답이에요. 나만 볼 수 있어요. <Link to={`/review/${new Date().getFullYear()}`}>올해 돌아보기 ›</Link></p>

      {mode === 'calendar' ? (
        <>
          <div className="cal-head">
            <button type="button" className="btn btn-text btn-sm" aria-label="지난달" onClick={() => shift(-1)}>←</button>
            <strong>{y}년 {m}월</strong> <small className="muted">{inMonth}일 남겼어요</small>
            <button type="button" className="btn btn-text btn-sm" aria-label="다음 달" onClick={() => shift(1)} disabled={month >= dayKey().slice(0, 7)}>→</button>
          </div>
          <ol className="cal" aria-label={`${y}년 ${m}월`}>
            {['일', '월', '화', '수', '목', '금', '토'].map((w) => <li key={w} className="cal-w" aria-hidden="true">{w}</li>)}
            {Array.from({ length: first }, (_, i) => <li key={`e${i}`} aria-hidden="true" />)}
            {Array.from({ length: days }, (_, i) => {
              const day = `${month}-${String(i + 1).padStart(2, '0')}`
              const a = byDay.get(day)
              return (
                <li key={day}>
                  <button
                    type="button"
                    className={`cal-day${a ? ' has' : ''}${moodOf(a?.color) ? ' has-color' : ''}${pick === day ? ' is-pick' : ''}${day === dayKey() ? ' is-today' : ''}`}
                    style={moodOf(a?.color) ? ({ '--mood': moodOf(a?.color)!.hex } as CSSProperties) : undefined}
                    disabled={!a}
                    aria-label={`${m}월 ${i + 1}일${a ? `, 한 줄 있음${moodOf(a.color) ? ` · ${moodOf(a.color)!.name}` : ''}` : ''}`}
                    onClick={() => setPick(pick === day ? null : day)}
                  >
                    {i + 1}
                  </button>
                </li>
              )
            })}
          </ol>
          {picked ? <ol className="answers"><Item a={picked} /></ol> : <p className="muted small center">점이 있는 날을 누르면 그날의 한 줄이 보여요.</p>}
        </>
      ) : (
        <>
          <ol className="answers">{shown.map((a) => <Item key={a.day} a={a} />)}</ol>
          {list.length > 7 && <button type="button" className="btn btn-text btn-sm" onClick={() => setAll((v) => !v)}>{all ? '접기' : `모두 보기 (${list.length})`}</button>}
        </>
      )}
    </section>
  )
}

/** 내 기록을 파일 하나로 (개발 테스트 서버) */
function ExportMine() {
  const labs = useLabs('me')
  const [msg, setMsg] = useState('')
  if (!labs) return null
  return (
    <p className="center export-mine">
      <button type="button" className="btn btn-text btn-sm" onClick={() => downloadMyData().then(() => setMsg('내려받았어요.'), (e) => setMsg(e.message))}>내 기록 모두 내려받기 (JSON)</button>
      {msg && <small className="muted"> {msg}</small>}
    </p>
  )
}

function DeleteAccount() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [birth, setBirth] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    if (!await confirmDialog('계정과 모든 기록, 모임에 나눈 그래프가 모두 지워져요. 되돌릴 수 없어요. 정말 지울까요?')) return
    try {
      await api.deleteMe(name, birth)
      setUser(null)
      navigate('/')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  return (
    <details className="account-danger">
      <summary className="muted small">계정 지우기</summary>
      <form className="field" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <p className="muted small">확인을 위해 이름과 생년월일을 한 번 더 적어 주세요.</p>
        <label className="field">
          <span className="field-label">이름</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} required />
        </label>
        <BirthField id="del-birth" value={birth} onChange={setBirth} />
        {err && <p className="alert" role="alert">{err}</p>}
        <button type="submit" className="btn btn-text danger">계정과 모든 기록 지우기</button>
      </form>
    </details>
  )
}


/** 모임에서 받은 응원 알림. 누가 보냈는지는 알려주지 않는다. ‘잘 받았어요’를 누르면 그 뒤에 온 것만 다시 보인다. */
function ReceivedCheers() {
  const KEY = 'geuryeobom:cheers-seen'
  const [list, setList] = useState<ReceivedCheer[]>([])
  useEffect(() => {
    let since = new Date(Date.now() - 14 * 86_400_000).toISOString() // 처음엔 최근 2주
    try {
      since = localStorage.getItem(KEY) || since
    } catch {
      /* 기억이 없으면 최근 2주 */
    }
    api.cheersSince(since).then(setList, () => setList([]))
  }, [])
  if (!list.length) return null
  const seen = () => {
    try {
      localStorage.setItem(KEY, list[0].createdAt)
    } catch {
      /* 다음에도 같은 응원이 한 번 더 보일 뿐 */
    }
    setList([])
  }
  return (
    <section className="card cheer-notice" role="status">
      {/* 받은 응원만큼 꽃잎이 살짝 내려온다 (숫자 비교 없이, 동작 줄이기 설정이면 멈춘다) */}
      <div className="petals" aria-hidden="true">
        {Array.from({ length: Math.min(list.length * 3, 18) }, (_, i) => (
          <span key={i} style={{ left: `${(i * 37 + 8) % 92}%`, animationDelay: `${(i * 0.45) % 3.2}s`, animationDuration: `${5 + (i % 4)}s` }} />
        ))}
      </div>
      <p className="eyebrow en">NEW CHEERS</p>
      <p className="serif cheer-title">마음이 도착했어요</p>
      <ul className="cheer-list">
        {list.slice(0, 4).map((c, i) => (
          <li key={i}>
            <span>누군가 <strong>‘{c.kind}’</strong>{eul(c.kind)} 보냈어요</span>
            <small className="muted">{c.groupName} · {c.title || '이름 없는 이야기'}</small>
          </li>
        ))}
      </ul>
      {list.length > 4 && <p className="muted small">그리고 {list.length - 4}개 더</p>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={seen}>고마워요, 잘 받았어요</button>
    </section>
  )
}

/** 문의에 새 답이 왔으면 */
function NewAnswers() {
  const n = useNewAnswers()
  if (!n) return null
  return <Link to="/contact" className="card new-answers" role="status"><strong>문의에 답이 왔어요</strong> <span className="muted small">{n}개 · 눌러서 보기</span></Link>
}
