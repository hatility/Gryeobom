import StepArt from '../components/StepArt'
import { confirmDialog } from '../components/confirm'
import { firstTime, seasonChanged } from '../components/once'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { api, type Answer, type GroupSummary } from '../api'
import { useAuth, useRepo } from '../auth'
import { MOOD_COLORS, greeting, isQuietHour, lineColorOf, moodOf, todayQuestion } from '../content'
import { dayKey, useJournal } from '../journal'
import { formatDate, graphPoints, graphTitle } from '../store'
import LifeGraphView from '../components/LifeGraph'
import { markNewsSeen, newsSeen, useLabs } from '../labs'
import GuardianNotice from '../components/GuardianNotice'
import { dayLabel } from './GroupPage'
import type { LifeGraph } from '../types'

const STEPS = [
  {
    title: '나의 시간을 돌아봐요',
    text: '돌아볼 시간의 길이를 정해요.',
    icon: <path d="M12 3a9 9 0 1 0 9 9M12 7v5l3 2" />,
  },
  {
    title: '경험을 하나씩 기록해요',
    text: '기억에 남는 순간을 점으로 남겨요.',
    icon: <path d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3" />,
  },
  {
    title: '지금의 나를 발견해요',
    text: '이어진 선에서 지금의 나를 만나요.',
    icon: <path d="M3 17c3-6 5-8 8-4s5 2 7-4M18 9h3v3" />,
  },
]

const PROMPTS = [
  ['처음으로 혼자 해낸 일', '작아도 괜찮아요. 그날을 떠올려 봐요.'],
  ['나를 바꾼 한마디', '누군가의 말이 오래 남았던 적이 있나요?'],
  ['진로를 고민했던 시간', '답을 몰랐던 날도 나를 만들었어요.'],
  ['다시 돌아가 보고 싶은 하루', '그날의 나에게 무슨 말을 건네고 싶나요?'],
]

export default function Home() {
  useReveal()
  const { user } = useAuth()
  const repo = useRepo()
  // 그래프가 있는 사람: 소개 대신 내 최근 그래프가 첫 화면의 주인공 (모바일 첫 화면과 같은 생각)
  const [recent, setRecent] = useState<LifeGraph | null | undefined>(undefined)
  useEffect(() => {
    repo.list().then((l) => { const s = [...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); setRecent(s.find((g) => g.entries.length > 1) ?? s[0] ?? null) }, () => setRecent(null))
  }, [repo])
  const returning = !!recent
  // 다른 화면에서 ‘소개’ 로 왔을 때: 최근 그래프를 불러와 소개 자리가 정해진 뒤에 그곳으로
  useEffect(() => {
    if (recent !== undefined && location.hash === '#intro') document.getElementById('intro')?.scrollIntoView()
  }, [recent])
  // 위 메뉴 ‘소개’(/#intro) 가 늘 갈 곳: 처음 온 사람은 첫 화면 바로 아래, 다시 온 사람은 맨 아래
  const intro = (
      <section id="intro" className="container section reveal">
        <p className="eyebrow center en">HOW IT FLOWS</p>
        <h2 className="section-title center">세 걸음이면 충분해요</h2>
        {/* 세 걸음 그림은 차례로 한 번씩 움직여요 (보일 때) */}
        <FlowSteps />
      </section>
  )
  return (
    <>
      {returning ? <WelcomeBack g={recent} nickname={user?.nickname} /> : (
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow hero-eyebrow">
            <span className="season-dot" aria-hidden="true" />
            {greeting()}
          </p>
          <h1 className="hero-title">
            지나온 나를 <span className="accent-word">그리고,</span>
            <br />
            지금의 나를 만나다.
          </h1>
          <p className="hero-desc">
            {/* 데스크톱 2줄 · 모바일 3줄 (m-break 가 모바일에서만 줄을 나눈다) */}
            <span className="desc-line">
              기뻤던 순간도, 힘들었던 순간도<span className="m-break"> </span>모두 지금의 나를 만든 이야기예요.
            </span>
            <span className="desc-line">나만의 선으로 천천히 그려봐요.</span>
          </p>
          <div className="hero-actions">
            <Link to="/graph/new" className="btn btn-primary btn-lg">나의 그래프 그리기</Link>
            <Link to="/#intro" className="btn btn-ghost btn-lg">프로그램 알아보기</Link>
          </div>
          <p className="hero-example-row"><Link to="/welcome" className="hero-example">처음이라면 1분 투어</Link><span className="hero-example-dot" aria-hidden="true">·</span><Link to="/example" className="hero-example">예시 그래프 먼저 보기</Link></p>
        </div>
        <HeroArt />
      </section>
      )}

      <div className="container"><GuardianNotice /></div>
      {/* 위 최근 그래프 카드가 그리던 그래프면 ‘이어서 그리기’ 를 두 번 말하지 않게 */}
      {!(recent && !recent.completed) && <Resume />}
      <TodayQuestion />
      <GroupTopics />
      <GroupNews />
      <OrgHomeCard />

      {!returning && intro}

      <section className="container section prompts-section reveal">
        <div className="prompts-copy">
          <p className="eyebrow en">QUESTIONS TO BEGIN</p>
          <h2 className="section-title">어디서부터 떠올려야 할지<br />모르겠다면</h2>
          <p className="muted">
            <span className="line">거창한 일이 아니어도 괜찮아요.</span>{' '}
            <span className="line">높고 낮음은 그때의 마음일 뿐이에요.</span>
          </p>
        </div>
        <ul className="prompts" aria-label="이런 질문으로 시작해 볼 수 있어요">
          {PROMPTS.map(([t, d]) => (
            <li key={t} className="prompt">
              <p className="serif prompt-title">{t}</p>
              <p className="muted small">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      {returning && intro}
      {!returning && (
      <section className="container section closing reveal">
        <div className="closing-band">
        <p className="closing-text serif">
          지금의 나는,
          <br />
          지나온 모든 순간이 모여 만들어졌어요.
        </p>
        <Link to="/graph/new" className="btn btn-primary btn-lg">시작하기</Link>
        </div>
      </section>
      )}
    </>
  )
}

/** 다시 온 사람의 첫 화면: 인사 · 할 일 두 개 · 최근 그래프 한 장 */
function WelcomeBack({ g, nickname }: { g: LifeGraph; nickname?: string }) {
  const [season] = useState(seasonChanged)
  const { user } = useAuth()
  const [welcome] = useState(() => !!user && firstTime(`gb-welcome-pc-${user.id}`))
  const tone = lineColorOf(g.lineColor)
  return (
    <section className={`hero hero-back container${welcome ? ' is-welcome' : ''}`}>
      {/* 처음 들어온 사람에게 한 번: 인사 아래로 선이 그어지고 첫 점이 톡 */}
      {welcome && <svg className="welcome-line" viewBox="0 0 220 30" aria-hidden="true"><path d="M4 22C40 8 70 26 110 14s66-2 100-8" pathLength={1} /><circle cx="210" cy="6" r="5" /></svg>}
      <div className="hero-copy">
        <p className="eyebrow hero-eyebrow"><span className="season-dot" aria-hidden="true" />{greeting()}{season && <span className="season-new"> · {season}이 왔어요</span>}</p>
        <h1 className="hero-title hero-title-back">{nickname ? `${nickname}님,` : '다시 만나 반가워요,'}<br />오늘은 어떤 선을 그려 볼까요?</h1>
        <div className="hero-actions">
          <Link to="/graph/new" className="btn btn-primary btn-lg">새 그래프 그리기</Link>
          <Link to="/my" className="btn btn-ghost btn-lg">기록 모아보기</Link>
        </div>
      </div>
      <Link to={g.completed ? `/graph/${g.id}` : `/graph/${g.id}/edit`} className="card recent-card" style={{ '--line': tone } as CSSProperties}>
        <span className="recent-head">
          <span className="recent-kicker">{g.completed ? '최근 그래프' : '그리는 중'}</span>
          <span className="muted small">{formatDate(g.updatedAt)}</span>
        </span>
        <strong className="serif recent-title">{graphTitle(g)}</strong>
        <LifeGraphView compact tone={tone} points={graphPoints(g)} timeScale={g.timeScale} start={g.startPoint} end={g.currentPoint} />
        <span className="recent-go">{g.completed ? '다시 보기 ›' : '이어서 그리기 ›'}</span>
      </Link>
    </section>
  )
}

/** 처음 온 사람의 첫 화면 그림: 손끝이 점 셋을 찍으면 선이 이어지고 ‘지금의 나’ 에 닿아요 (한 번만 · 움직임 줄이기면 끝 모습) */
function FlowSteps() {
  const [ref, seen] = useSeen<HTMLOListElement>()
  return (
    <ol ref={ref} className={`flow${seen ? ' is-seen' : ''}`}>
          {STEPS.map((s, i) => (
            <li key={s.title} className="flow-step">
              <StepArt kind={(['time', 'moment', 'reflect'] as const)[i]} />
              <span className="flow-num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </li>
          ))}
    </ol>
  )
}

/** 장면은 그림이 거의 다 보일 때 한 번 시작 (아래 둥근 메뉴 높이만큼 빼고 잰다 · 아주 낮은 창에서도 언젠가는 시작) */
function useSeen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true)
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold: Math.min(0.85, ((innerHeight - 90) / Math.max(1, el.offsetHeight)) * 0.9), rootMargin: '0px 0px -90px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, seen] as const
}

function HeroArt() {
  const grid = [70, 130, 190, 250]
  // 손끝 장면은 그림이 거의 다 보일 때 시작 (낮은 화면에서 아래 메뉴 · 화면 밖에서 먼저 지나가 버리지 않게)
  const [ref, seen] = useSeen<HTMLElement>()
  return (
    <figure ref={ref} className={`hero-art${seen ? ' is-seen' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 480 320">
        <rect x="1" y="1" width="478" height="318" rx="16" className="art-paper" />
        {grid.map((y) => <line key={y} x1="40" x2="440" y1={y} y2={y} className="art-grid" />)}
        <line x1="40" y1="160" x2="440" y2="160" className="art-base" />
        <path
          className="art-line"
          pathLength={1}
          d="M40,190 C80,140 110,118 140,130 S200,232 240,220 S300,92 340,100 S400,150 440,80"
        />
        <g className="art-dots">
          {([[140, 130, 112, '첫 무대'], [240, 220, 248, '전학 온 봄'], [340, 100, 82, '새 친구']] as const).map(([x, y, ty, t], i) => (
            <g key={t} className="art-pt" style={{ '--i': i } as CSSProperties}>
              <circle cx={x} cy={y} r="14" className="art-ripple" />
              <circle cx={x} cy={y} r="6" />
              <text x={x} y={ty} textAnchor="middle" className="art-word">{t}</text>
            </g>
          ))}
          <g className="art-pt art-pt-now">
            <circle cx="440" cy="80" r="8" className="art-now" />
            <text x="432" y="58" textAnchor="end" className="art-word">지금의 나</text>
          </g>
        </g>
        <g className="art-cursor">
          <path d="M0 0L0 17L4.6 12.6L7.8 19.6L10.6 18.4L7.6 11.6L13.6 11.6Z" />
        </g>
        <text x="40" y="296" className="art-axis">그때</text>
        <text x="440" y="296" textAnchor="end" className="art-axis">지금</text>
      </svg>
      <figcaption className="serif">이 선에는 당신만의 이야기가 담겨 있어요.</figcaption>
    </figure>
  )
}

/** 화면에 들어온 .reveal 구역을 살짝 떠오르게. 지원하지 않는 환경에서는 그냥 다 보인다. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.reveal')]
    if (!('IntersectionObserver' in window)) return
    els.forEach((el) => el.classList.add('is-waiting'))
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return
          e.target.classList.remove('is-waiting')
          io.unobserve(e.target)
        }),
      { rootMargin: '0px 0px -10% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

/** 다 못 그린 이야기가 있으면 첫 화면에서 바로 이어 그리게 */
export function Resume() {
  const repo = useRepo()
  const [g, setG] = useState<LifeGraph | null>(null)
  const load = () => repo.list().then((list) => setG(list.find((x) => !x.completed && (x.entries.length > 0 || x.title.trim())) ?? null), () => {})
  useEffect(() => {
    load()
  }, [repo])
  if (!g) return null
  // 끝까지 그리지 않아도 괜찮다: 그리던 그래프를 여기서 바로 지울 수 있다 (다음 것이 있으면 그게 보인다)
  const remove = async () => {
    if (!await confirmDialog(`그리던 ‘${graphTitle(g)}’를 지울까요? 지운 뒤에는 되돌릴 수 없어요.`)) return
    if (await repo.remove(g.id)) load()
  }
  let step = g.entries.length ? 2 : 1
  try {
    step = Math.min(4, Math.max(1, Number(localStorage.getItem(`geuryeobom:step:${g.id}`)) || step))
  } catch {
    /* 기억이 없으면 순간이 있을 때 2단계부터 */
  }
  return (
    <section className="container">
      <div className="card resume">
        <div className="resume-copy">
          <p className="eyebrow en">CONTINUE</p>
          <p className="serif resume-title">그리던 이야기가 있어요</p>
          <p className="muted small resume-sub">‘{graphTitle(g)}’ · {step}단계에서 멈췄어요</p>
        </div>
        <span className="resume-actions">
          <button type="button" className="btn btn-text btn-sm danger" onClick={remove}>지우기</button>
          <Link to={`/graph/${g.id}/edit?step=${step}`} className="btn btn-primary">이어서 그리기</Link>
        </span>
      </div>
    </section>
  )
}

/** 오늘의 질문 — 날마다 바뀌는 질문에 한 줄과 오늘의 마음 색을 남긴다 (로그인한 계정만) */
export function TodayQuestion() {
  const d = new Date()
  const day = dayKey(d)
  const quiet = isQuietHour(d.getHours())
  const journal = useJournal()
  const { user } = useAuth()
  const [list, setList] = useState<Answer[]>([])
  const [text, setText] = useState('')
  const [color, setColor] = useState('')
  const [saved, setSaved] = useState<Answer | null | undefined>(undefined) // undefined = 불러오는 중, null = 아직 없음
  const [state, setState] = useState<'' | 'saving' | 'error'>('')
  useEffect(() => {
    journal.list().then(
      (l) => {
        const mine = l.find((a) => a.day === day) ?? null
        setList(l)
        setSaved(mine)
        setText(mine?.text ?? '')
        setColor(mine?.color ?? '')
      },
      () => setSaved(null),
    )
  }, [journal, day])
  // 모임장이 오늘 정한 ‘함께 그릴 주제’ 가 있으면 그것이 오늘의 질문 (1.3.0) — 이미 남긴 날은 그때의 질문 그대로
  const [gq, setGq] = useState<{ name: string; topic: string } | null>(null)
  useEffect(() => {
    if (!user) return setGq(null)
    api.groups().then((gs) => { const g = gs.find((x) => x.topic && x.topicAt?.slice(0, 10) === day); setGq(g ? { name: g.name, topic: g.topic } : null) }, () => setGq(null))
  }, [user, day])
  const question = saved?.question || gq?.topic || todayQuestion(d)
  const [popped, setPopped] = useState(0)
  const save = async () => {
    setState('saving')
    const a = { day, question, text: text.trim(), color }
    if (!(await journal.save(a))) return setState('error')
    setSaved(a.text ? a : null)
    setList((l) => [...(a.text ? [a] : []), ...l.filter((x) => x.day !== day)])
    setState('')
    if (a.text) setPopped((n) => n + 1)
  }
  const dirty = saved !== undefined && (text.trim() !== (saved?.text ?? '') || (!!text.trim() && color !== (saved?.color ?? '')))
  const back = lookBack(list, d)
  // 오늘(또는 어제)까지 하루도 빠짐없이 이어서 남긴 날 수
  const streak = (() => {
    const days = new Set(list.map((x) => x.day))
    const t = new Date(d)
    if (!days.has(dayKey(t))) t.setDate(t.getDate() - 1)
    let n = 0
    while (days.has(dayKey(t))) { n++; t.setDate(t.getDate() - 1) }
    return n
  })()
  return (
    <section className="container today-wrap">
      <div className={`today${quiet ? ' is-quiet' : ''}`}>
        <p className="eyebrow">{quiet ? '잠들기 전 질문' : gq && question === gq.topic ? `‘${gq.name}’ 모임의 오늘 질문` : '오늘의 질문'} · {d.getMonth() + 1}월 {d.getDate()}일</p>
        {streak >= 2 && <p className={`today-streak${streak >= 7 ? ' is-7' : streak >= 3 ? ' is-3' : ''}`}><i aria-hidden="true" />{streak}일째 이어서 남기고 있어요</p>}
        <p className="serif today-q">{question}</p>
        {!user ? (
          <p className="today-foot today-login">
            <span>한 줄로 답을 남기고 달력에 모아 보려면 로그인해 주세요.</span>
            <Link to="/login?next=/">로그인하고 남기기 ›</Link>
          </p>
        ) : (<>
        <form className="today-answer" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label className="sr-only" htmlFor="today-answer">오늘의 한 줄</label>
          <input id="today-answer" value={text} maxLength={300} placeholder={quiet ? '오늘은 한 줄이면 충분해요' : '한 줄로 남겨 봐요'} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="today-save" disabled={!dirty || state === 'saving'}>{saved && !text.trim() ? '지우기' : '남기기'}</button>
        </form>
        <div className="mood-pick" role="radiogroup" aria-label="오늘의 마음 색">
          <span className="mood-pick-label">오늘의 색</span>
          {MOOD_COLORS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={color === m.key}
              className="mood-dot"
              style={{ '--mood': m.hex } as CSSProperties}
              title={m.name}
              aria-label={m.name}
              onClick={() => setColor(color === m.key ? '' : m.key)}
            />
          ))}
          <span className="mood-name">{moodOf(color)?.name ?? ''}</span>
        </div>
        <p className="today-foot">
          <span>{state === 'error' ? '저장하지 못했어요. 잠시 뒤 다시 해 볼까요?' : saved && !dirty ? '✓ 오늘의 한 줄을 남겼어요' : '나만 볼 수 있어요'}
            {/* 남긴 순간: 오늘 칸이 고른 색으로 물들었다는 작은 점 */}
            {popped > 0 && saved && !dirty && <i key={popped} className="today-pop" style={{ '--mood': moodOf(saved.color)?.hex ?? 'var(--primary-hover)' } as CSSProperties} aria-hidden="true" />}
          </span>
          {list.length > 0 && <Link to="/my#answers">지난 한 줄 {list.length}개 · 달력으로 보기 ›</Link>}
        </p>
        {back && (
          <figure className="look-back">
            <figcaption>{back.label}의 나</figcaption>
            <blockquote className="serif">
              {moodOf(back.a.color) && <i className="look-back-dot" style={{ background: moodOf(back.a.color)!.hex }} aria-hidden="true" />}
              “{back.a.text}”
            </blockquote>
            <small className="muted">{back.a.question}</small>
          </figure>
        )}
        </>)}
      </div>
    </section>
  )
}

/** 그때 오늘: 1년 전 → 한 달 전 → 일주일 전 같은 날에 남긴 한 줄 (가장 먼 것부터) */
function lookBack(list: Answer[], d: Date): { label: string; a: Answer } | null {
  // 그 달에 없는 날(2월 30일 · 4월 31일 · 윤년이 아닌 2월 29일)은 다음 달로 넘어가지 않게 건너뛴다
  const at = (y: number, m: number, dd: number) => {
    const t = new Date(y, m, dd)
    return t.getDate() === dd ? list.find((a) => a.day === dayKey(t)) : undefined
  }
  const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate()
  for (let k = 5; k >= 1; k--) {
    const a = at(y - k, m, dd)
    if (a) return { label: `${k}년 전 오늘`, a }
  }
  const month = at(y, m - 1, dd)
  if (month) return { label: '한 달 전 오늘', a: month }
  const week = at(y, m, dd - 7)
  return week ? { label: '일주일 전 오늘', a: week } : null
}

/** 내가 맡은 기관 (없거나 실험이 꺼져 있으면 빈 목록) — 첫 화면 한 줄 · 맨 위 ‘기관’ 메뉴 */
/** refresh: 바뀌면 다시 불러온다 (기관 화면에서 등록 · 지우기를 한 뒤 맨 위 탭이 바로 맞게) */
export function useMyOrgs(refresh = '') {
  const { user } = useAuth()
  const labs = useLabs('org')
  // null: 아직 모름 (불러오는 중 · 로그인 안 함 · 실험 꺼짐)
  const [orgs, setOrgs] = useState<{ id: string; name: string; groupIds: string[] }[] | null>(null)
  useEffect(() => {
    if (user && labs) api.myOrgsLite().then(setOrgs, () => setOrgs(null))
    else setOrgs(null)
  }, [user, labs, refresh])
  return orgs
}

/** 기관 담당자라면 첫 화면에 ‘내가 맡은 기관’ */
export function OrgHomeCard() {
  const orgs = useMyOrgs()
  if (!orgs) return null
  if (!orgs.length) {
    return (
      <section className="container news-wrap">
        <p className="org-home-invite muted small">학교 · 수련관 · 복지관 담당자이신가요? <Link to="/org">기관 등록하기 ›</Link></p>
      </section>
    )
  }
  // 기관이 여럿이어도 첫 화면에는 한 줄만 — 자세한 것은 ‘기관’ 화면에서
  return (
    <section className="container news-wrap">
      <p className="org-home-invite muted small">내가 맡은 기관 · <Link to="/org">{orgs.length > 1 ? `${orgs[0].name} 외 ${orgs.length - 1}곳` : orgs[0].name} ›</Link></p>
    </section>
  )
}

/** 내가 들어간 모임의 소식 (새 소식은 표시) */
export function GroupNews() {
  const { user } = useAuth()
  const labs = useLabs('group')
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [, setTick] = useState(0) // 읽음 표시를 바꾸면 다시 그리기
  useEffect(() => {
    if (user && labs) api.groups().then((gs) => setGroups(gs.filter((g) => g.news || g.nextEvent)), () => setGroups([]))
    else setGroups([])
  }, [user, labs])
  if (!groups.length) return null
  const unread = groups.filter((g) => g.news && !newsSeen(g.id, g.newsAt ?? ''))
  return (
    <section className="container news-wrap">
      {unread.length > 1 && <p className="news-readall"><button type="button" className="btn btn-text btn-sm" onClick={() => { unread.forEach((g) => markNewsSeen(g.id, g.newsAt ?? '')); setTick((t) => t + 1) }}>새 소식 {unread.length}개 모두 읽음으로</button></p>}
      <ul className="news-list">
        {groups.map((g) => (
          <li key={g.id}>
            <Link to={`/groups/${g.id}`} className="card news-item">
              <span className="news-label">{g.name}{g.news ? ' · 모임 소식' : ''}{g.news && !newsSeen(g.id, g.newsAt ?? '') && <b className="news-new">새 소식</b>}</span>
              {g.news && <span className="news-text">{g.news}</span>}
              {g.nextEvent && <span className="news-event">다음 활동 · {dayLabel(g.nextEvent.day)} · {g.nextEvent.title}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 내가 들어간 모임에서 정한 ‘함께 그릴 주제’ */
export function GroupTopics() {
  const { user } = useAuth()
  const [groups, setGroups] = useState<GroupSummary[]>([])
  useEffect(() => {
    if (user) api.groups().then((gs) => setGroups(gs.filter((g) => g.topic)), () => setGroups([]))
    else setGroups([])
  }, [user])
  if (!groups.length) return null
  return (
    <section className="container topics-wrap">
      <ul className="topics">
        {groups.map((g) => (
          <li key={g.id} className="card topic-card">
            <p className="eyebrow">{g.name} · 함께 그릴 주제</p>
            <p className="serif topic-text">{g.topic}</p>
            <span className="topic-actions">
              <Link to={`/graph/new?group=${g.id}`} className="btn btn-primary btn-sm">이 주제로 그리기</Link>
              <Link to={`/groups/${g.id}`} className="btn btn-text btn-sm">모임으로 가기</Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
