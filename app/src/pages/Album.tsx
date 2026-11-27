import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type GroupDetail } from '../api'
import { useAuth } from '../auth'
import LifeGraph from '../components/LifeGraph'
import { lineColorOf } from '../content'
import { formatDate } from '../store'

/** 모임 앨범 (/groups/:id/album): 나눈 선들을 폴라로이드처럼 한 벽에 — 인쇄하면 모임 사진첩 */
export default function Album() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined)
  useEffect(() => { if (user) api.group(id).then(setGroup, () => setGroup(null)) }, [id, user])
  if (!user) return <section className="container page empty-state"><p className="serif big">모임 앨범은 로그인하면 볼 수 있어요.</p><Link to={`/login?next=/groups/${id}/album`} className="btn btn-primary">로그인</Link></section>
  if (group === undefined) return <p className="container page loading serif is-loading">앨범을 펼치는 중이에요…</p>
  if (!group) return <section className="container page empty-state"><h1>모임을 찾을 수 없어요</h1><Link to="/share" className="btn btn-primary">함께 나누기로</Link></section>
  const posts = [...group.posts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <section className="container page album-page">
      <header className="page-head">
        <div>
          <Link to={`/groups/${group.id}`} className="btn btn-text btn-sm no-print back-top">← 모임</Link>
          <p className="eyebrow en">OUR ALBUM</p>
          <h1 className="page-title">{group.name} 앨범</h1>
          <p className="muted">{posts.length ? `나눈 선 ${posts.length}장 · 먼저 나눈 순서예요. 누가 더 낫다는 건 없어요.` : '아직 나눈 선이 없어요.'}</p>
        </div>
        {posts.length > 0 && <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>인쇄 · PDF로 저장</button>}
      </header>
      <ul className="album-grid">
        {posts.map((p, i) => (
          <li key={p.id} className="album-photo" style={{ '--tilt': `${((i % 3) - 1) * 1.2}deg` } as React.CSSProperties}>
            <div className="album-pic">
              <LifeGraph compact tone={lineColorOf(p.graph.tone)} points={p.graph.entries.map((e, k) => ({ ...e, id: `a${k}` }))} timeScale={p.graph.timeScale} start={p.graph.startPoint} end={p.graph.currentPoint} />
            </div>
            <p className="album-cap serif">{p.graph.title || '작은 인생 이야기'}</p>
            <p className="muted small">{p.nickname} · {formatDate(p.createdAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
