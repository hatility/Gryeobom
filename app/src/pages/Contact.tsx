import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { useLabs } from '../labs'
import { formatDate } from '../store'

const KINDS = ['궁금해요', '고쳐 주세요', '개인정보', '그 밖의 일']
type Mine = Awaited<ReturnType<typeof api.myInquiries>>

/** 이 기기에서 마지막으로 확인한 답의 때 (새 답 알림용) */
const SEEN = 'geuryeobom:answers-seen'
export const answersSeen = () => { try { return localStorage.getItem(SEEN) ?? '' } catch { return '' } }
const markSeen = (at: string) => { try { if (at) localStorage.setItem(SEEN, at) } catch { /* 기억 못 해도 괜찮다 */ } }

/** 아직 보지 않은 답이 몇 개인지 (기록 모아보기 · 모바일 ‘나’ 에 알림) */
export function useNewAnswers() {
  const labs = useLabs('me')
  const { user } = useAuth()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (labs && user) api.myInquiries().then((l) => setN(l.filter((q) => q.answeredAt && q.answeredAt > answersSeen()).length), () => {})
  }, [labs, user])
  return n
}

/**
 * 실험: 문의하기 — 로그인한 사람만. 메일을 보내지 않으니 운영자의 답은 여기 ‘내 문의’ 에서 본다.
 */
export default function Contact() {
  const labs = useLabs('me')
  const { user } = useAuth()
  const [kind, setKind] = useState('')
  const [message, setMessage] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState<Mine | null>(null)
  const load = () => api.myInquiries().then((l) => {
    setMine(l)
    markSeen(l.map((q) => q.answeredAt).filter(Boolean).sort().at(-1) ?? '')
  }, () => setMine([]))
  useEffect(() => {
    if (labs && user) load()
  }, [labs, user])
  if (!labs) return null
  if (!user) {
    return (
      <section className="container page empty-state">
        <p className="serif big">문의는 로그인하면 남길 수 있어요.</p>
        <p className="muted">메일을 따로 보내지 않아서, 운영자의 답은 이 화면의 ‘내 문의’ 에서 볼 수 있어요.</p>
        <Link to="/login?next=/contact" className="btn btn-primary">로그인하기</Link>
      </section>
    )
  }
  const send = async () => {
    setErr('')
    setMsg('')
    setBusy(true)
    try {
      await api.contact({ kind, message: message.trim() })
      setKind('')
      setMessage('')
      setMsg('문의를 받았어요. 답이 오면 아래 ‘내 문의’ 와 기록 모아보기에 알려 드려요.')
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '보내지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="container page contact-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">문의하기</h1>
          <p className="muted">궁금한 점 · 고쳐야 할 것 · 내 개인정보(열람 · 고치기 · 지우기) 요청을 남겨 주세요. 운영자만 보고, 답은 아래 ‘내 문의’ 에 와요.</p>
        </div>
      </header>
      <form className="card form-card" onSubmit={(e) => { e.preventDefault(); send() }}>
        <fieldset className="field">
          <legend className="field-label">무엇에 대한 문의인가요?</legend>
          <div className="segmented">
            {KINDS.map((k) => (
              <label key={k} className="seg"><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} required /><span>{k}</span></label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span className="field-label">내용 <small className="muted">{message.length}/1000</small></span>
          <textarea rows={6} maxLength={1000} required value={message} placeholder="예) 모임에 들어가는 코드를 잃어버렸어요." onChange={(e) => setMessage(e.target.value)} />
          <small className="muted">‘{user.nickname}’ 계정으로 보내요. 이름 · 생년월일 · 연락처는 적지 않아도 돼요.</small>
        </label>
        {err && <p className="alert" role="alert">{err}</p>}
        {msg && <p className="notice" role="status">{msg}</p>}
        <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || !kind || message.trim().length < 5}>보내기</button></div>
      </form>

      <section className="section-tight">
        <h2 className="section-title">내 문의 {mine && mine.length > 0 && <small className="muted">{mine.length}</small>}</h2>
        {mine === null ? <p className="muted">불러오는 중이에요…</p> : !mine.length ? <p className="muted">아직 남긴 문의가 없어요.</p> : (
          <ul className="my-inquiries">
            {mine.map((q) => (
              <li key={q.id} className="card">
                <p className="my-inq-head">
                  <span className={`badge ${q.answer ? 'badge-soft' : 'badge-dev'}`}>{q.answer ? '답이 왔어요' : q.status === '닫음' ? '닫음' : '기다리는 중'}</span>
                  <strong>{q.kind}</strong>
                  <small className="muted">{formatDate(q.createdAt)}</small>
                </p>
                <p className="my-inq-text">{q.message}</p>
                {q.answer && (
                  <div className="my-inq-answer">
                    <p className="eyebrow">운영자의 답 · {formatDate(q.answeredAt)}</p>
                    <p>{q.answer}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
