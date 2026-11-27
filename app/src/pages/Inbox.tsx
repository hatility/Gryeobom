import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type GroupSummary, type ReceivedCheer } from '../api'
import { useAuth } from '../auth'
import { markNewsSeen, newsSeen } from '../labs'
import { dayLabel } from './GroupPage'

type Item = { at: string; kind: '모임 소식' | '다가오는 활동' | '응원'; title: string; body: string; to: string; fresh?: boolean }

/** 소식함 (/inbox): 모임 소식 · 다가오는 활동 · 받은 응원을 한 줄씩, 새것부터 */
export default function Inbox() {
  const { user } = useAuth()
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [cheers, setCheers] = useState<ReceivedCheer[]>([])
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!user) return
    api.groups().then(setGroups, () => setGroups([]))
    api.cheersSince(new Date(Date.now() - 30 * 86_400_000).toISOString()).then(setCheers, () => setCheers([]))
  }, [user])
  if (!user) return <section className="container page empty-state"><p className="serif big">소식함은 로그인하면 볼 수 있어요.</p><Link to="/login?next=/inbox" className="btn btn-primary">로그인</Link></section>
  if (!groups) return <p className="container page loading serif is-loading">소식을 모으는 중이에요…</p>
  const items: Item[] = [
    ...groups.filter((g) => g.news).map((g): Item => ({ at: g.newsAt ?? '', kind: '모임 소식', title: g.name, body: g.news!, to: `/groups/${g.id}`, fresh: !newsSeen(g.id, g.newsAt ?? '') })),
    ...groups.filter((g) => g.nextEvent).map((g): Item => ({ at: g.nextEvent!.day, kind: '다가오는 활동', title: g.name, body: `${dayLabel(g.nextEvent!.day)} · ${g.nextEvent!.title}`, to: `/groups/${g.id}` })),
    ...cheers.map((c): Item => ({ at: c.createdAt, kind: '응원', title: c.groupName, body: `‘${c.title || '이름 없는 이야기'}’ 에 ${c.kind}`, to: '/my' })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const unread = items.filter((i) => i.fresh)
  return (
    <section className="container page inbox-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">INBOX</p>
          <h1 className="page-title">소식함</h1>
          <p className="muted">{items.length ? `${items.length}개 · 최근 30일의 응원과 모임 소식` : '아직 소식이 없어요. 모임에 들어가면 소식 · 활동 · 응원이 여기 모여요.'}</p>
        </div>
        {unread.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { groups.forEach((g) => g.news && markNewsSeen(g.id, g.newsAt ?? '')); setTick((t) => t + 1) }}>모두 읽음으로</button>}
      </header>
      {!items.length && <div className="empty-state"><Link to="/share" className="btn btn-primary">함께 나누기로</Link></div>}
      <ol className="inbox-list">
        {items.map((i, k) => (
          <li key={k} className={`card inbox-item${i.fresh ? ' is-fresh' : ''}`}>
            <span className={`tag inbox-kind is-${i.kind === '응원' ? 'cheer' : i.kind === '모임 소식' ? 'news' : 'event'}`}>{i.kind}</span>
            <div>
              <p className="inbox-title"><strong>{i.title}</strong>{i.fresh && <b className="news-new">새 소식</b>}</p>
              <p className="inbox-body">{i.body}</p>
            </div>
            <Link to={i.to} className="btn btn-text btn-sm" onClick={() => { if (i.kind === '모임 소식') { const g = groups.find((x) => x.name === i.title); if (g) markNewsSeen(g.id, g.newsAt ?? '') } }}>보기 ›</Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
