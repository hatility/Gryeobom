import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { api, type Answer, type GroupSummary } from '../api'
import { useAuth, useRepo } from '../auth'
import { MOOD_COLORS, greeting, isQuietHour, moodOf, todayQuestion } from '../content'
import { dayKey, useJournal } from '../journal'
import { graphTitle } from '../store'
import { newsSeen, useLabs } from '../labs'
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
  return (
    <>
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow hero-eyebrow">
            <span className="season-dot" aria-hidden="true" />
            {greeting()}<span className="eyebrow-en"> · MY LIFE, MY LINE</span>
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
          <Link to="/example" className="hero-example">예시 그래프 먼저 둘러보기 →</Link>
        </div>
        <HeroArt />
      </section>

      <div className="container"><GuardianNotice /></div>
      <Resume />
      <TodayQuestion />
      <OrgHomeCard />
      <GroupNews />
      <GroupTopics />

      <section id="intro" className="container section reveal">
        <p className="eyebrow center en">HOW IT FLOWS</p>
        <h2 className="section-title center">세 걸음이면 충분해요</h2>
        <ol className="flow">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card flow-card">
              <div className="flow-top">
                <span className="flow-num">{String(i + 1).padStart(2, '0')}</span>
                <svg className="flow-icon" viewBox="0 0 24 24" aria-hidden="true">{s.icon}</svg>
              </div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

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

      <section className="container section closing reveal">
        <p className="closing-text serif">
          지금의 나는,
          <br />
          지나온 모든 순간이 모여 만들어졌어요.
        </p>
        <Link to="/graph/new" className="btn btn-primary btn-lg">시작하기</Link>
      </section>
    </>
  )
}

function HeroArt() {
  const grid = [70, 130, 190, 250]
  return (
    <figure className="hero-art" aria-hidden="true">
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
          <circle cx="140" cy="130" r="6" />
          <circle cx="240" cy="220" r="6" />
          <circle cx="340" cy="100" r="6" />
          <circle cx="440" cy="80" r="8" className="art-now" />
        </g>
        <g className="art-words">
          <text x="140" y="112" textAnchor="middle">첫 무대</text>
          <text x="240" y="248" textAnchor="middle">전학 온 봄</text>
          <text x="340" y="82" textAnchor="middle">새 친구</text>
          <text x="432" y="58" textAnchor="end">지금의 나</text>
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
    if (!window.confirm(`그리던 ‘${graphTitle(g)}’를 지울까요? 지운 뒤에는 되돌릴 수 없어요.`)) return
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
  // 이미 남긴 날은 그때의 질문을 그대로 (밤 질문으로 남겼다면 그 질문)
  const question = saved?.question || todayQuestion(d)
  const save = async () => {
    setState('saving')
    const a = { day, question, text: text.trim(), color }
    if (!(await journal.save(a))) return setState('error')
    setSaved(a.text ? a : null)
    setList((l) => [...(a.text ? [a] : []), ...l.filter((x) => x.day !== day)])
    setState('')
  }
  const dirty = saved !== undefined && (text.trim() !== (saved?.text ?? '') || (!!text.trim() && color !== (saved?.color ?? '')))
  const back = lookBack(list, d)
  return (
    <section className="container today-wrap">
      <div className={`today${quiet ? ' is-quiet' : ''}`}>
        <p className="eyebrow">{quiet ? '잠들기 전 질문' : '오늘의 질문'} · {d.getMonth() + 1}월 {d.getDate()}일</p>
        <p className="serif today-q">{question}</p>
        {!user ? (
          <p className="today-foot today-login">
            <span>한 줄로 답을 남기고 달력에 모아 보려면 로그인해 주세요.</span>
            <Link to="/login?next=/">로그인하고 남기기 →</Link>
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
          <span>{state === 'error' ? '저장하지 못했어요. 잠시 뒤 다시 해 볼까요?' : saved && !dirty ? '✓ 오늘의 한 줄을 남겼어요' : '나만 볼 수 있어요'}</span>
          {list.length > 0 && <Link to="/my#answers">지난 한 줄 {list.length}개 · 달력으로 보기 →</Link>}
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
      <Link to="/org" className="card news-item org-home-card">
        <span className="news-label">내가 맡은 기관 {orgs.length}곳</span>
        <span className="news-text">{orgs.map((o) => o.name).join(' · ')}</span>
        <span className="news-event">리포트 · 모임 · 담당자 보기 ›</span>
      </Link>
    </section>
  )
}

/** 내가 들어간 모임의 소식 (새 소식은 표시) */
export function GroupNews() {
  const { user } = useAuth()
  const labs = useLabs('group')
  const [groups, setGroups] = useState<GroupSummary[]>([])
  useEffect(() => {
    if (user && labs) api.groups().then((gs) => setGroups(gs.filter((g) => g.news || g.nextEvent)), () => setGroups([]))
    else setGroups([])
  }, [user, labs])
  if (!groups.length) return null
  return (
    <section className="container news-wrap">
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
              <Link to={`/groups/${g.id}`} className="btn btn-text btn-sm">모임 가기</Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
