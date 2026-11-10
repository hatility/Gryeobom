import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api, shareBase, type GroupDetail } from '../api'
import { useAuth } from '../auth'
import QrCode from '../components/QrCode'
import { PLAYBOOKS } from '../content'
import { useLabs } from '../labs'
import { dayLabel } from './GroupPage'

const pad = (n: number) => String(n).padStart(2, '0')
/** 진행 단계의 ‘(5분)’ → 300초 */
const minutesOf = (step: string) => Number(/\((\d+)분\)/.exec(step)?.[1] ?? 0) * 60
const stepText = (s: string) => s.replace(/\s*\(\d+분\)$/, '')

/**
 * 실험: 큰 화면 진행 모드 (프로젝터 · TV). 위에 모임 · 주제, 왼쪽에 진행 단계(전체 목록 · 지금 단계 크게),
 * 오른쪽에 타이머와 들어오는 QR. 단계를 넘기면 그 단계의 시간(‘(5분)’)으로 타이머가 맞춰진다.
 * 키보드: ← → 단계, 스페이스 타이머. 모임장 · 공동 모임장만.
 */
export default function GroupPresent() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const labs = useLabs('group')
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined)
  const [url, setUrl] = useState('')
  const plan = PLAYBOOKS.find((p) => p.key === params.get('plan'))
  const [step, setStep] = useState(0)
  const [total, setTotal] = useState(() => (plan ? minutesOf(plan.steps[0]) : 0) || 5 * 60)
  const [left, setLeft] = useState(total)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!user) return
    const load = () => api.group(id).then(setGroup, () => setGroup(null))
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [id, user])
  useEffect(() => {
    if (group?.code) shareBase().then((b) => setUrl(`${b}/join/${group.code}`))
  }, [group?.code])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) { setRunning(false); return 0 }
      return s - 1
    }), 1000)
    return () => clearInterval(t)
  }, [running])

  const setTimer = (sec: number) => {
    setRunning(false)
    setTotal(sec)
    setLeft(sec)
  }
  // 고른 진행안(?plan=)이 먼저, 없으면 모임장이 적어 둔 ‘오늘 할 일’ (실험 · 질문 정하기)
  const custom = group?.prompts?.present?.length ? group.prompts.present : null
  const steps = plan?.steps ?? custom
  const stepsTitle = plan?.title ?? '오늘 할 일'
  // 적어 둔 할 일은 모임을 받은 뒤에 오니, 그때 첫 단계 시간으로 맞춘다
  const firstCustom = plan ? '' : custom?.[0] ?? ''
  useEffect(() => {
    const sec = minutesOf(firstCustom)
    if (sec) { setRunning(false); setTotal(sec); setLeft(sec) }
  }, [firstCustom])
  const go = (i: number) => {
    if (!steps || i < 0 || i >= steps.length) return
    setStep(i)
    const sec = minutesOf(steps[i])
    if (sec) setTimer(sec)
  }
  // 발표할 때 손이 키보드에 있으니: ← → 단계, 스페이스 시작 · 멈춤
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button')) return
      if (e.key === 'ArrowRight') go(step + 1)
      else if (e.key === 'ArrowLeft') go(step - 1)
      else if (e.key === ' ') { e.preventDefault(); if (left) setRunning((r) => !r) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!labs) return null
  if (group === undefined) return <p className="container page loading serif">여는 중이에요…</p>
  if (!group || !(group.isManager || group.isHelper)) {
    return (
      <section className="container page empty-state">
        <h1>모임장 · 공동 모임장 · 도우미만 열 수 있어요</h1>
        <Link to={`/groups/${id}`} className="btn btn-primary">모임으로</Link>
      </section>
    )
  }
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const ev = group.events?.find((e) => e.day === today)
  const full = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})
  const topic = group.topic || plan?.topic || '오늘, 나의 선을 그려요'

  return (
    <section className="present">
      <header className="present-top">
        <div>
          <p className="present-group">{group.name} · {dayLabel(today)}{ev && <> · {ev.title}</>}</p>
          <h1 className={`present-topic${topic.length > 55 ? ' is-xlong' : topic.length > 28 ? ' is-long' : ''}`}>{topic}</h1>
        </div>
        <span className="present-bar no-print">
          <Link to={`/groups/${group.id}`} className="btn btn-text btn-sm">← 모임으로</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={full}>전체 화면</button>
        </span>
      </header>

      <div className="present-main">
        <div className="present-card present-plan">
          {steps ? (
            <>
              <p className="present-label">{stepsTitle} <span>{step + 1} / {steps.length}</span></p>
              <p className="present-step">{stepText(steps[step])}</p>
              {steps[step + 1] && <p className="present-next">다음 · {stepText(steps[step + 1])}</p>}
              <ol className="present-steps">
                {steps.map((s, i) => (
                  <li key={`${i}-${s}`} className={i === step ? 'is-now' : i < step ? 'is-done' : undefined}>
                    <button type="button" onClick={() => go(i)}>{s}</button>
                  </li>
                ))}
              </ol>
              <span className="present-step-nav">
                <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => go(step - 1)}>‹ 이전 단계</button>
                <button type="button" className="btn btn-primary" disabled={step === steps.length - 1} onClick={() => go(step + 1)}>다음 단계 ›</button>
              </span>
            </>
          ) : (
            <>
              <p className="present-label">오늘 할 일</p>
              <ol className="present-howto">
                <li>오른쪽 QR 을 휴대폰 카메라로 찍어 모임에 들어와요.</li>
                <li>‘이 주제로 그리기’ 를 눌러 떠오르는 순간을 적어요.</li>
                <li>다 그리면 모임에 저절로 나눠져요. 서로의 선에 응원을 보내요.</li>
              </ol>
              <p className="present-next">모임 화면 ‘모임 꾸리기 → 질문 정하기’ 에서 오늘 할 일을 바꾸거나, ‘진행안 모음’ 에서 골라요.</p>
            </>
          )}
        </div>

        <aside className="present-side">
          <div className="present-card present-timer">
            <p className={`present-clock${left === 0 ? ' is-done' : ''}`} role="timer" aria-label={`남은 시간 ${Math.floor(left / 60)}분 ${left % 60}초`}>{pad(Math.floor(left / 60))}:{pad(left % 60)}</p>
            <span className="present-progress" aria-hidden="true"><i style={{ width: `${total ? (left / total) * 100 : 0}%` }} /></span>
            <span className="present-timer-ctl">
              {[3, 5, 10, 15].map((m) => <button key={m} type="button" className="chip" aria-pressed={total === m * 60} onClick={() => setTimer(m * 60)}>{m}분</button>)}
            </span>
            <span className="present-timer-go">
              <button type="button" className="btn btn-primary" disabled={!left} onClick={() => setRunning(!running)}>{running ? '멈춤' : left < total ? '이어서' : '시작'}</button>
              <button type="button" className="btn btn-text" onClick={() => setTimer(total)}>처음으로</button>
            </span>
          </div>
          {!group.closedAt && group.code && (
            <div className="present-card present-join">
              {url && <QrCode text={url} size={170} label="모임 참여 QR" />}
              <div>
                <p className="present-code"><span>참여 코드</span><strong>{group.code}</strong></p>
                <p className="present-count"><strong>{group.members.length}</strong>명 함께해요{ev && <><br />오늘 참여 <strong>{ev.count ?? 0}</strong>명</>}</p>
              </div>
            </div>
          )}
        </aside>
      </div>
      <p className="present-keys muted small no-print">키보드 · ← → 단계 · 스페이스 타이머</p>
    </section>
  )
}
