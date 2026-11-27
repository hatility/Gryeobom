import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import { api, shareBase, type GroupDetail, type GroupReport } from '../api'
import { useAuth } from '../auth'
import QrCode from '../components/QrCode'
import { TogetherLines, dayLabel } from './GroupPage'

/**
 * 함께 그리기 (/groups/:id/live): 모임 시간에 큰 화면에 띄워 두는 실시간 판.
 * 지금 그리는 중인 사람 수 · 방금 나눈 선 · 모두의 선 겹쳐 보기 · 들어오는 QR.
 * ponytail: 5초 폴링 — 모임이 수십 명이 넘고 서버가 버거우면 SSE 로 바꾼다 (/groups/:id 와 /report 두 번 요청).
 */
export default function Live() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined)
  const [report, setReport] = useState<GroupReport | null>(null)
  const [base, setBase] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => { shareBase().then(setBase) }, [])
  useEffect(() => {
    if (!user) return
    const tick = () => {
      api.group(id).then((g) => {
        setGroup(g)
        const ids = new Set(g.posts.map((p) => p.id))
        if (seen.current) { const n = g.posts.find((p) => !seen.current!.has(p.id)); if (n) { setFresh(`${n.nickname}님이 방금 선을 나눴어요`); setTimeout(() => setFresh(null), 6000) } }
        seen.current = ids
      }, () => setGroup((g) => g ?? null))
      api.groupReport(id).then(setReport, () => {})
    }
    tick()
    const t = setInterval(() => document.visibilityState === 'visible' && tick(), 5000)
    return () => clearInterval(t)
  }, [id, user])
  if (!user) return <section className="container page empty-state"><p className="serif big">로그인하면 볼 수 있어요.</p><Link to={`/login?next=/groups/${id}/live`} className="btn btn-primary">로그인</Link></section>
  if (group === undefined) return <p className="container page loading serif is-loading">함께 그릴 판을 펴는 중이에요…</p>
  if (!group) return <section className="container page empty-state"><h1>모임을 찾을 수 없어요</h1><Link to="/share" className="btn btn-primary">함께 나누기로</Link></section>
  const posts = [...group.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const ev = group.events?.find((e) => e.day >= new Date().toISOString().slice(0, 10))
  return (
    <section className="present live" style={{ '--n': Math.max(1, posts.length) } as CSSProperties}>
      <header className="present-top">
        <div>
          <p className="present-group">{group.name}{ev && <> · {dayLabel(ev.day)} · {ev.title}</>}</p>
          <h1 className="present-topic">{group.topic || '함께 그려요'}</h1>
        </div>
        <span className="present-bar no-print"><Link to={`/groups/${group.id}`} className="btn btn-ghost btn-sm">모임으로</Link><Link to={`/groups/${group.id}/present`} className="btn btn-ghost btn-sm">진행 화면</Link></span>
      </header>
      <div className="live-main">
        <section className="present-card live-board">
          <p className="present-label">모두의 선 <span>{posts.length}개</span></p>
          {posts.length > 1 ? <TogetherLines posts={posts} /> : <p className="present-end-none muted">나눈 선이 둘 이상이면 여기에 겹쳐 보여요.</p>}
          <p className={`live-fresh serif${fresh ? ' is-on' : ''}`} role="status" aria-live="polite">{fresh ?? (posts[0] ? `마지막으로 ${posts[0].nickname}님이 나눴어요` : '첫 선을 기다리고 있어요')}</p>
        </section>
        <aside className="present-side">
          <section className="present-card live-now">
            <p className="present-label">지금</p>
            <ul className="live-stats">
              <li><strong>{report?.drawing ?? '–'}</strong><span>그리는 중</span></li>
              <li><strong>{report?.done ?? posts.length}</strong><span>다 그림</span></li>
              <li><strong>{group.members.length}</strong><span>함께</span></li>
            </ul>
          </section>
          {group.code && base && (
            <section className="present-card live-qr">
              <p className="present-label">들어오기</p>
              <QrCode text={`${base}/join/${group.code}`} size={180} label={`초대 QR · ${group.code}`} />
              <p className="present-code"><strong className="code">{group.code}</strong><small className="muted">함께 나누기 → 코드로 들어가기</small></p>
            </section>
          )}
        </aside>
      </div>
    </section>
  )
}
