import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, REPORT_REASONS, shareBase, type GroupDetail, type GroupMember, type GroupReport, type GroupPost, type ReportReason } from '../api'
import { useAuth } from '../auth'
import LifeGraph from '../components/LifeGraph'
import { CHEERS, lineColorOf, monthFull, monthIndex, presetLabel, scoreWord, signed, timeLabel } from '../content'
import { exportImage, smoothPath, spreadSameTime } from '../graph'
import { GROUP_POST } from '../share'
import { formatDate } from '../store'
import type { GroupPreset } from '../types'

export default function GroupPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState<'' | 'code' | 'link'>('')
  const [inviteUrl, setInviteUrl] = useState('')

  const load = () => api.group(id).then(setGroup, () => setGroup(null))
  // 누군가 고치거나 나누면 바로 보이도록: 화면을 보고 있는 동안 15초마다, 다시 돌아왔을 때 새로 받는다
  useEffect(() => {
    if (!user) return
    load()
    const tick = () => document.visibilityState === 'visible' && load()
    const t = setInterval(tick, 15_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [id, user])
  const [editInfo, setEditInfo] = useState(false)
  const [manage, setManage] = useState(false)
  // 펼쳐 둔 그래프 (처음엔 모두 접어 두고, 작은 선과 제목만)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const toggle = (pid: string, open: boolean) =>
    setOpenIds((s) => {
      const n = new Set(s)
      if (open) n.add(pid)
      else n.delete(pid)
      return n
    })
  useEffect(() => {
    if (group?.code) shareBase().then((b) => setInviteUrl(`${b}/join/${group.code}`))
  }, [group?.code])

  if (!user) {
    return (
      <section className="container page empty-state">
        <p className="serif big">모임은 로그인하면 들어갈 수 있어요.</p>
        <Link to={`/login?next=/groups/${id}`} className="btn btn-primary">로그인하기</Link>
      </section>
    )
  }
  if (group === undefined) return <p className="container page loading serif">모임을 여는 중이에요…</p>
  if (!group) {
    return (
      <section className="container page empty-state">
        <h1>모임을 찾을 수 없어요</h1>
        <p className="muted">모임이 없어졌거나, 아직 들어가지 않은 모임이에요.</p>
        <Link to="/share" className="btn btn-primary">함께 나누기로</Link>
      </section>
    )
  }

  const act = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setErr('')
    try {
      await fn()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }

  return (
    <section className="container page">
      <header className="page-head group-head">
        <div>
          <p className="eyebrow">OUR LINES, TOGETHER</p>
          <h1 className="page-title">{group.name}</h1>
          {group.intro && <p className="group-intro">{group.intro}</p>}
          {group.isManager && !editInfo && (
            <span className="group-head-actions">
              <button type="button" className="btn btn-text btn-sm" onClick={() => setEditInfo(true)}>모임 이름 · 소개 고치기</button>
            </span>
          )}
        </div>
        {group.isManager ? (
          <div className="code-box">
            <span className="muted small">모임 참여 코드</span>
            <strong className="code">{group.code}</strong>
            <span className="code-actions">
              <button
                type="button"
                className="btn btn-text btn-sm"
                onClick={() => navigator.clipboard?.writeText(group.code ?? '').then(() => setCopied('code'), () => {})}
              >
                {copied === 'code' ? '복사했어요' : '코드 복사'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard?.writeText(inviteUrl).then(() => setCopied('link'), () => {})}
              >
                {copied === 'link' ? '복사했어요' : '초대 링크 복사'}
              </button>
            </span>
            {inviteUrl && <small className="invite-url">{inviteUrl}</small>}
          </div>
        ) : null}
      </header>

      {editInfo && (
        <section className="card section-tight">
        <GroupInfoForm
          init={{ name: group.name, intro: group.intro }}
          onSave={async (info) => {
            await api.updateGroup(group.id, info)
            setEditInfo(false)
            await load()
          }}
          onCancel={() => setEditInfo(false)}
        />
        </section>
      )}

      <TopicCard group={group} onSaved={load} />
      {group.isManager && <ReportCard groupId={group.id} />}

      <MembersCard
        members={group.members}
        isOwner={group.isOwner}
        manage={manage}
        onManage={setManage}
        onRole={(m, role) => act(() => api.setMemberRole(group.id, m.id!, role))}
        onTransfer={(m) =>
          act(
            async () => {
              await api.transferGroup(group.id, m.id!)
              setManage(false)
            },
            `${m.nickname}님에게 모임장을 넘길까요? 넘긴 뒤에는 공동 모임장으로 남고, 모임 없애기 · 사람 정하기는 ${m.nickname}님이 하게 돼요.`,
          )
        }
      />

      {group.myUnposted.map((u) => (
        <section key={u.graphId} className="card repost" role="status">
          <div>
            <p className="serif repost-title">‘{u.title || '나의 작은 인생 이야기'}’가 지금 모임에 없어요</p>
            <p className="muted small">모임장이나 운영자가 모임을 지키려고 잠시 내렸을 수 있어요. 그래프를 고치면 바로 다시 올라가고, 고칠 곳이 없다면 ‘다시 올리기’를 눌러도 돼요.</p>
          </div>
          <span className="repost-actions">
            <Link to={`/graph/${u.graphId}/edit?step=2`} className="btn btn-ghost btn-sm">고치러 가기</Link>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => act(() => api.post(group.id, u.graphId, GROUP_POST))}>다시 올리기</button>
          </span>
        </section>
      ))}

      <p className="demo-note">
        서로의 선을 판단하지 않고 바라봐요. 응원은 정해진 말로만 보낼 수 있고, 몇 개를 받았는지는 그래프 주인만 볼 수 있어요.
      </p>
      {err && <p className="alert" role="alert">{err}</p>}

      <GroupStart group={group} onSaved={load} />

      {group.posts.length > 1 && <TogetherLines posts={group.posts} />}

      {group.posts.length === 0 ? (
        <div className="card empty-state">
          <p className="serif big">아직 나눈 선이 없어요.</p>
          <p className="muted">내 그래프의 결과 화면에서 ‘공유하기’를 누르면 이 모임에 나눌 수 있어요.</p>
          <Link to="/my" className="btn btn-primary">내 그래프 보러 가기</Link>
        </div>
      ) : (
        <>
        <div className="post-tools">
          <span className="muted small">나눈 선 {group.posts.length}개 · 눌러서 펼쳐 봐요</span>
          <button
            type="button"
            className="btn btn-text btn-sm"
            onClick={() => setOpenIds(openIds.size === group.posts.length ? new Set() : new Set(group.posts.map((p) => p.id)))}
          >
            {openIds.size === group.posts.length ? '모두 접기' : '모두 펼치기'}
          </button>
        </div>
        <ul className="post-list">
          {group.posts.map((p) => (
            <Post
              key={p.id}
              post={p}
              open={openIds.has(p.id)}
              onToggle={(o) => toggle(p.id, o)}
              canRemove={(p.mine && !p.bound) || group.isManager}
              onCheer={(kind) => act(() => api.cheer(p.id, kind))}
              onRemove={() =>
                act(
                  () => api.unpost(p.id),
                  p.mine ? '이 모임에서 내 그래프를 내릴까요?' : `${p.nickname}님의 그래프를 모임에서 내릴까요? (모임장 권한)`,
                )
              }
            />
          ))}
        </ul>
        </>
      )}

      <div className="form-actions group-foot">
        {group.isOwner ? (
          <button
            type="button"
            className="btn btn-text danger"
            onClick={() => act(async () => { await api.deleteGroup(group.id); navigate('/share') }, '모임을 없앨까요? 모임에 나눈 그래프도 모두 내려가요. (각자의 기록은 그대로 남아요)')}
          >
            모임 없애기
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-text danger"
            onClick={() => act(async () => { await api.leaveGroup(group.id); navigate('/share') }, '모임에서 나갈까요? 이 모임에 나눈 내 그래프도 함께 내려가요.')}
          >
            모임 나가기
          </button>
        )}
      </div>
    </section>
  )
}

/**
 * 함께하는 사람: 모임장 · 공동 모임장 · 함께하는 사람으로 묶어 보여준다.
 * 모임장은 ‘관리하기’로 공동 모임장을 정하거나 풀고, 모임장을 넘긴다.
 */
function MembersCard({ members, isOwner, manage, onManage, onRole, onTransfer }: {
  members: GroupMember[]; isOwner: boolean; manage: boolean; onManage: (v: boolean) => void
  onRole: (m: GroupMember, role: 'co' | 'member') => void; onTransfer: (m: GroupMember) => void
}) {
  const groups: [GroupMember['role'], string][] = [['owner', '모임장'], ['co', '공동 모임장'], ['member', '함께하는 사람']]
  return (
    <section className="card members-card">
      <div className="members-head">
        <h2 className="card-title">함께하는 사람 <small className="muted">{members.length}명</small></h2>
        {isOwner && members.length > 1 && (
          <button type="button" className="btn btn-text btn-sm" aria-expanded={manage} onClick={() => onManage(!manage)}>
            {manage ? '다 했어요' : '공동 모임장 · 모임장 넘기기'}
          </button>
        )}
      </div>
      {manage ? (
        <MembersPanel members={members} onRole={onRole} onTransfer={onTransfer} />
      ) : (
        <dl className="members-groups">
          {groups.map(([role, label]) => {
            const list = members.filter((m) => m.role === role)
            if (!list.length) return null
            return (
              <div key={role} className={`members-row is-${role}`}>
                <dt>{label}</dt>
                <dd>
                  {list.map((m, i) => (
                    <span key={i} className="member-chip">
                      <span className="member-avatar" aria-hidden="true">{[...m.nickname][0]}</span>
                      {m.nickname}
                    </span>
                  ))}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </section>
  )
}

/** 함께하는 사람 관리 (모임장): 공동 모임장 정하기 · 풀기, 모임장 넘기기 */
function MembersPanel({ members, onRole, onTransfer }: {
  members: GroupMember[]
  onRole: (m: GroupMember, role: 'co' | 'member') => void
  onTransfer: (m: GroupMember) => void
}) {
  return (
    <div className="members-panel">
      <p className="muted small">
        공동 모임장은 모임 이름 · 소개와 함께 그릴 시간을 정하고, 참여 코드를 보고, 모임을 지키기 위해 그래프를 내릴 수 있어요.
        모임 없애기 · 사람 정하기 · 모임장 넘기기는 모임장만 해요.
      </p>
      <ul className="entry-list">
        {members.map((m) => (
          <li key={m.id ?? m.nickname} className="entry-item">
            <span className="entry-body">
              <strong>{m.nickname}</strong>
              <small>{m.role === 'owner' ? '모임장 (나)' : m.role === 'co' ? '공동 모임장' : '함께하는 사람'}</small>
            </span>
            {m.role !== 'owner' && m.id && (
              <span className="entry-actions">
                <button type="button" className="btn btn-text btn-sm" onClick={() => onRole(m, m.role === 'co' ? 'member' : 'co')}>
                  {m.role === 'co' ? '공동 모임장 풀기' : '공동 모임장으로'}
                </button>
                <button type="button" className="btn btn-text btn-sm" onClick={() => onTransfer(m)}>모임장 넘기기</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 우리의 선: 모임에 나눈 선을 한 그래프에 옅게 겹친다. 기준(나이 · 연도 · 달)이 달라도
 * ‘그때 → 지금’의 상대 위치로 맞춰 그린다. 내 선만 진하게, 누구의 선인지는 이름 없이.
 */
function TogetherLines({ posts }: { posts: GroupPost[] }) {
  const W = 640, H = 190, pad = 18
  const lines = posts
    .map((p) => {
      const g = p.graph
      const span = Math.max(1, g.currentPoint - g.startPoint)
      const pts = [...g.entries]
        .sort((a, b) => a.timePoint - b.timePoint)
        .map((e) => ({ x: pad + ((e.timePoint - g.startPoint) / span) * (W - pad * 2), y: pad + ((5 - e.emotionScore) / 10) * (H - pad * 2) }))
      const xy = spreadSameTime(pts, 10, pad, W - pad)
      const last = xy[xy.length - 1]
      // 마지막 순간에서 ‘지금’까지는 점선으로 잇는다 (모두 지금에 닿도록)
      const trail = last && last.x < W - pad - 1 ? `M${last.x.toFixed(1)},${last.y.toFixed(1)} L${W - pad},${last.y.toFixed(1)}` : ''
      return { id: p.id, mine: p.mine, color: lineColorOf(g.tone), d: smoothPath(xy), trail }
    })
    .filter((l) => l.d)
  if (lines.length < 2) return null
  return (
    <section className="card together">
      <div className="together-head">
        <p className="eyebrow">OUR LINES</p>
        <h2 className="card-title">우리의 선, 함께 겹쳐 보기</h2>
        <p className="muted small">{lines.length}개의 선이 같은 시간을 지나왔어요. 모양은 달라도 모두 지금에 닿아 있어요.</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="together-svg" role="img" aria-label={`모임에 나눈 선 ${lines.length}개를 겹친 그림`}>
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} className="together-base" />
        {[...lines.filter((l) => !l.mine), ...lines.filter((l) => l.mine)].map((l) => (
          <g key={l.id} className={`together-line${l.mine ? ' is-mine' : ''}`} stroke={l.color}>
            <path d={l.d} />
            {l.trail && <path d={l.trail} className="together-trail" />}
          </g>
        ))}
        <text x={pad} y={H - 2} className="together-note">그때</text>
        <text x={W - pad} y={H - 2} textAnchor="end" className="together-note">지금</text>
      </svg>
      {lines.some((l) => l.mine) && <p className="muted small center">진한 선이 내 선이에요.</p>}
    </section>
  )
}

/** 모임에 나눈 그래프 하나. 접으면 이름 · 제목 · 작은 선만, 펼치면 그래프 · 순간 · 응원. */
function Post({ post, open, onToggle, canRemove, onCheer, onRemove }: {
  post: GroupPost; open: boolean; onToggle: (open: boolean) => void
  canRemove: boolean; onCheer: (kind: string) => void; onRemove: () => void
}) {
  const g = post.graph
  const points = g.entries.map((e, i) => ({ ...e, id: `${post.id}-${i}` }))
  // 접힌 목록의 작은 선은 순간이 놓인 구간에 맞춰 그린다 (순간이 기간 한쪽에 몰려 있어도 카드마다 같은 크기로 보이게)
  const times = points.map((p) => p.timePoint)
  const spark: [number, number] = times.length > 1 && Math.max(...times) > Math.min(...times) ? [Math.min(...times), Math.max(...times)] : [g.startPoint, g.currentPoint]
  return (
    <li className="card post">
      <details open={open} onToggle={(e) => e.currentTarget.open !== open && onToggle(e.currentTarget.open)}>
      <summary className="post-summary">
        <span className="post-summary-text">
          <span className="post-summary-who">
            <strong>{post.nickname}</strong>
            {post.mine && <span className="badge badge-soft">내 그래프</span>}
            <span className="muted small">{formatDate(post.createdAt)}</span>
          </span>
          <span className="post-summary-title">{g.title || '이름 없는 이야기'}</span>
          <span className="muted small">순간 {g.entries.length}개</span>
        </span>
        {!open && (
          <span className="post-spark">
            <LifeGraph compact tone={lineColorOf(g.tone)} points={points} timeScale={g.timeScale} start={spark[0]} end={spark[1]} />
          </span>
        )}
        <span className="post-chevron" aria-hidden="true" />
      </summary>
      {post.bound && <p className="muted small">이 모임에서 그린 선이에요. 고치면 여기에도 바로 보여요.</p>}
      <LifeGraph tone={lineColorOf(g.tone)}
        points={points}
        timeScale={g.timeScale}
        start={g.startPoint}
        end={g.currentPoint}
        showTimeLabels={g.showTime}
      />
      {g.entries.length > 0 && (
        <ol className="post-moments">
          {g.entries.map((e, i) => (
            <li key={i}>
              {g.showTime && <span className="entry-time">{timeLabel(g.timeScale, e.timePoint)}</span>}
              <span>
                <strong>{e.title || '이름 없는 순간'}</strong>
                <small className="muted"> · {e.emotionLabel ? `${e.emotionLabel} · ` : ''}마음 {signed(e.emotionScore)} {scoreWord(e.emotionScore)}</small>
                {e.description && <span className="post-desc">{e.description}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="cheers" role="group" aria-label="응원 보내기">
        {post.mine ? (
          <p className="muted small">
            받은 응원 ·{' '}
            {Object.keys(post.counts ?? {}).length
              ? CHEERS.filter((k) => post.counts?.[k]).map((k) => `${k} ${post.counts![k]}`).join(' · ')
              : '아직 없어요. 괜찮아요, 나눈 것만으로도 충분해요.'}
          </p>
        ) : (
          CHEERS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={post.myCheers.includes(k)} onClick={() => onCheer(k)}>
              {k}
            </button>
          ))
        )}
        <SaveImage post={post} />
        {!post.mine && <ReportButton post={post} />}
        {canRemove && (
          <button type="button" className="btn btn-text danger btn-sm cheers-remove" onClick={onRemove}>
            {post.mine ? '내리기' : '모임에서 내리기'}
          </button>
        )}
      </div>
      </details>
    </li>
  )
}

/** 함께 그릴 주제: 모임장 · 공동 모임장이 정하면 모임 사람들의 첫 화면에도 보인다 */
function TopicCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(group.topic)
  const [err, setErr] = useState('')
  if (!group.topic && !group.isManager) return null
  const save = async (topic: string) => {
    setErr('')
    try {
      await api.setTopic(group.id, topic)
      setEdit(false)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  if (edit) {
    return (
      <form className="card topic-card" onSubmit={(e) => { e.preventDefault(); save(text.trim()) }}>
        <label className="field">
          <span className="field-label">함께 그릴 주제 <small className="muted">{text.length}/80</small></span>
          <input value={text} maxLength={80} autoFocus placeholder="예) 이번 학기, 나를 가장 많이 웃게 한 순간" onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted small">모임 사람들의 첫 화면에도 보여요. 비우고 저장하면 주제를 내려요.</p>
        {err && <p className="alert" role="alert">{err}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>닫기</button>
          <button type="submit" className="btn btn-primary btn-sm">저장</button>
        </div>
      </form>
    )
  }
  if (!group.topic) {
    return (
      <button type="button" className="card topic-card topic-empty" onClick={() => { setText(''); setEdit(true) }}>
        <span className="eyebrow">함께 그릴 주제</span>
        <span className="muted">+ 모임 사람들과 함께 떠올릴 주제를 정해 보세요</span>
      </button>
    )
  }
  return (
    <section className="card topic-card">
      <p className="eyebrow">함께 그릴 주제 · {formatDate(group.topicAt)}</p>
      <p className="serif topic-text">{group.topic}</p>
      <span className="topic-actions">
        <Link to={`/graph/new?group=${group.id}`} className="btn btn-primary btn-sm">이 주제로 그리기</Link>
        {group.isManager && <button type="button" className="btn btn-text btn-sm" onClick={() => { setText(group.topic); setEdit(true) }}>주제 바꾸기</button>}
      </span>
    </section>
  )
}

/** 모임 리포트 (모임장 · 공동 모임장): 누가 무엇을 그렸는지는 없이, 모임 전체의 흐름만 */
function ReportCard({ groupId }: { groupId: string }) {
  const [r, setR] = useState<GroupReport | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (open) api.groupReport(groupId).then(setR, () => setR(null))
  }, [open, groupId])
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
  const max = Math.max(1, ...(r?.scores ?? []))
  return (
    <details className="card report-card" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="eyebrow">모임 리포트</span>
        <span className="muted small">누가 무엇을 그렸는지는 보이지 않아요. 모임 전체의 흐름만 담았어요.</span>
      </summary>
      {!r ? (
        <p className="muted small">불러오는 중이에요…</p>
      ) : (
        <div className="report-body">
          <ul className="report-stats">
            <li><strong>{pct(r.sharers, r.members)}%</strong><span className="muted small">선을 나눈 사람 · {r.sharers}/{r.members}명</span></li>
            <li><strong>{r.done}</strong><span className="muted small">이 모임에서 다 그린 선{r.drawing ? ` · 그리는 중 ${r.drawing}` : ''}</span></li>
            <li><strong>{r.moments}</strong><span className="muted small">함께 나눈 순간</span></li>
            <li><strong>{r.cheers}</strong><span className="muted small">오간 응원 · 이번 주 새 글 {r.newPosts}</span></li>
          </ul>
          {r.scores ? (
            <>
              <p className="field-label">나눈 순간의 마음</p>
              <ol className="report-bars" aria-label="마음 점수별 순간 수">
                {r.scores.map((n, i) => (
                  <li key={i} title={`마음 ${signed(i - 5)} · ${n}개`}>
                    <span className="bar"><i className={i > 5 ? 'is-pos' : i < 5 ? 'is-neg' : ''} style={{ height: `${(n / max) * 100}%` }} /></span>
                    <small className="muted">{signed(i - 5)}</small>
                  </li>
                ))}
              </ol>
              {r.labels && r.labels.length > 0 && (
                <p className="report-labels">
                  {r.labels.map((l) => <span key={l.label} className="chip chip-static">{l.label} <small className="muted">{l.n}</small></span>)}
                </p>
              )}
              <p className="muted small">무거운 순간이 많다고 나쁜 것이 아니에요. 서로의 이야기를 판단하지 않고 들어 주는 시간으로 써 주세요.</p>
            </>
          ) : (
            <p className="muted small">선을 나눈 사람이 3명이 되면 마음의 흐름도 보여 드려요. (누구의 마음인지 짐작되지 않게)</p>
          )}
        </div>
      )}
    </details>
  )
}

/** 신고: 운영자에게만 간다. 모임장 · 나눈 사람은 누가 신고했는지 모른다. */
function ReportButton({ post }: { post: GroupPost }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [detail, setDetail] = useState('')
  const [state, setState] = useState<'' | 'sending' | 'done'>('')
  const [err, setErr] = useState('')
  const send = async () => {
    if (!reason) return
    setState('sending')
    setErr('')
    try {
      await api.report(post.id, reason, detail.trim())
      setState('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
      setState('')
    }
  }
  return (
    <>
      <button type="button" className="btn btn-text btn-sm muted" onClick={() => ref.current?.showModal()}>신고</button>
      <dialog ref={ref} className="dialog report-dialog" onClose={() => state === 'done' && setState('')}>
        {state === 'done' ? (
          <div className="dialog-body">
            <h2 className="card-title">운영자에게 전했어요</h2>
            <p className="muted">알려 줘서 고마워요. 운영자가 살펴볼게요. 누가 신고했는지는 {post.nickname}님과 모임장에게 알리지 않아요.</p>
            {reason === 'danger' && <p className="small">지금 바로 이야기할 곳이 필요하다면 <a href="tel:1388">청소년상담 1388</a> (24시간)에 연락할 수 있어요.</p>}
            <div className="form-actions"><button type="button" className="btn btn-primary" onClick={() => ref.current?.close()}>닫기</button></div>
          </div>
        ) : (
          <form className="dialog-body" onSubmit={(e) => { e.preventDefault(); send() }}>
            <h2 className="card-title">‘{post.graph.title || '이름 없는 이야기'}’ 신고하기</h2>
            <p className="muted small">운영자에게만 전해져요. 모임장과 {post.nickname}님은 누가 신고했는지 알 수 없어요.</p>
            <fieldset className="report-reasons">
              <legend className="field-label">어떤 점이 걱정되나요?</legend>
              {(Object.keys(REPORT_REASONS) as ReportReason[]).map((k) => (
                <label key={k} className="report-reason">
                  <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
                  {REPORT_REASONS[k]}
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span className="field-label">더 알려 줄 것 <em>(선택)</em> <small className="muted">{detail.length}/300</small></span>
              <textarea rows={3} maxLength={300} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </label>
            {err && <p className="alert" role="alert">{err}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>닫기</button>
              <button type="submit" className="btn btn-primary" disabled={!reason || state === 'sending'}>보내기</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  )
}

/** 모임에 나눈 그래프를 사진(PNG)으로 저장. 나눈 내용(공개용)만 담긴다. */
function SaveImage({ post }: { post: GroupPost }) {
  const [busy, setBusy] = useState(false)
  const g = post.graph
  const save = async () => {
    setBusy(true)
    try {
      const blob = await exportImage({
        title: g.title || '이름 없는 이야기',
        eyebrow: `${post.nickname}님의 선 · 그려봄`,
        timeScale: g.timeScale,
        start: g.startPoint,
        end: g.currentPoint,
        showTime: g.showTime,
        points: g.entries.map((e, i) => ({ ...e, id: String(i) })),
        color: lineColorOf(g.tone),
      })
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `그려봄-${post.nickname}-${g.title || '이야기'}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className="btn btn-text btn-sm" disabled={busy} onClick={save}>
      {busy ? '그리는 중…' : '사진으로 저장'}
    </button>
  )
}

/** 모임 이름(30자) · 소개글(200자). 만들 때(함께 나누기)와 고칠 때(모임장) 같이 쓴다. */
export function GroupInfoForm({ init, onSave, onCancel, submitText = '고치기' }: {
  init: { name: string; intro: string }
  onSave: (info: { name: string; intro: string }) => Promise<unknown>
  onCancel?: () => void
  submitText?: string
}) {
  const [d, setD] = useState(init)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="group-info-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setErr('')
        setBusy(true)
        try {
          await onSave({ name: d.name.trim(), intro: d.intro.trim() })
        } catch (e) {
          setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="field">
        <span className="field-label">모임 이름 <small className="muted">{d.name.length}/30</small></span>
        <input value={d.name} maxLength={30} placeholder="예) 수요일 마음 모임" onChange={(e) => setD({ ...d, name: e.target.value })} required />
      </label>
      <label className="field">
        <span className="field-label">모임 소개 <em>(선택)</em> <small className="muted">{d.intro.length}/200</small></span>
        <textarea rows={3} maxLength={200} value={d.intro} placeholder="예) 매주 수요일, 서로의 선을 판단하지 않고 바라봐요." onChange={(e) => setD({ ...d, intro: e.target.value })} />
      </label>
      {err && <p className="alert" role="alert">{err}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '잠시만요…' : submitText}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>닫기</button>}
      </div>
    </form>
  )
}

const THIS_YEAR = new Date().getFullYear()
const CHOICES: [GroupPreset['choice'], string][] = [['age', '나이로'], ['year', '연도로'], ['recent12', '최근 12개월'], ['thisYear', '올해']]

/** 모임에서 함께 그리기: 모임장이 정해 둔 나의 시간을 보여주고, 그 틀로 새 그래프를 시작한다 */
function GroupStart({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const p = group.preset
  return (
    <section className="card group-start">
      <div className="group-start-head">
        <div>
          <p className="eyebrow">OUR TIME</p>
          <h2 className="card-title">{p?.title || '이 모임에서 함께 그려요'}</h2>
          <p className="muted small">
            {p
              ? presetLabel(p)
              : group.isManager
                ? '시간을 정해 두면 모두 같은 틀로 그릴 수 있어요.'
                : '정해진 시간이 없어요. 자유롭게 그려도 좋아요.'}
          </p>
        </div>
        <div className="group-start-actions">
          <Link to={`/graph/new?group=${group.id}`} className="btn btn-primary">이 모임에서 그리기</Link>
          {group.isManager && (
            <button type="button" className="btn btn-ghost" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
              {p ? '시간 바꾸기' : '시간 정하기'}
            </button>
          )}
        </div>
      </div>
      {editing && (
        <PresetForm
          groupId={group.id}
          preset={p}
          onDone={() => {
            setEditing(false)
            onSaved()
          }}
        />
      )}
    </section>
  )
}

function PresetForm({ groupId, preset, onDone }: { groupId: string; preset: GroupPreset | null; onDone: () => void }) {
  const [d, setD] = useState<GroupPreset>(preset ?? { choice: 'age', start: 0, end: 17, title: '' })
  const [err, setErr] = useState('')
  const set = (p: Partial<GroupPreset>) => setD((x) => ({ ...x, ...p }))
  const choose = (choice: GroupPreset['choice']) =>
    set(
      choice === 'age' ? { choice, start: 0, end: 17 }
      : choice === 'year' ? { choice, start: THIS_YEAR - 3, end: THIS_YEAR }
      : choice === 'recent12' ? { choice, start: 0, end: monthIndex() }
      : { choice, start: 0, end: 0 },
    )
  const save = (preset: GroupPreset | null) =>
    api.setPreset(groupId, preset).then(onDone, (e) => setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.'))
  const num = (label: string, key: 'start' | 'end', min: number, max: number) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={d[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  )

  return (
    <form
      className="preset-form"
      onSubmit={(e) => {
        e.preventDefault()
        save({ ...d, title: d.title.trim() })
      }}
    >
      <label className="field">
        <span className="field-label">그래프 이름 <em>(선택)</em></span>
        <input value={d.title} maxLength={40} placeholder="예) 1학기의 나" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <fieldset className="field">
        <legend className="field-label">어떤 기준으로 그릴까요?</legend>
        <div className="segmented">
          {CHOICES.map(([c, label]) => (
            <label key={c} className="seg">
              <input type="radio" name="preset-scale" checked={d.choice === c} onChange={() => choose(c)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {d.choice === 'age' && (
        <div className="field-row">
          {num('어디서부터 (나이)', 'start', 0, 119)}
          {num('지금 나이 (기본값)', 'end', 1, 120)}
        </div>
      )}
      {d.choice === 'year' && (
        <div className="field-row">
          {num('어디서부터 (연도)', 'start', 1900, THIS_YEAR - 1)}
          {num('어디까지 (연도)', 'end', 1901, THIS_YEAR)}
        </div>
      )}
      {d.choice === 'recent12' && (
        <label className="field">
          <span className="field-label">어느 달까지 돌아볼까요?</span>
          <select value={d.end} onChange={(e) => set({ end: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, i) => monthIndex() - i).map((t) => (
              <option key={t} value={t}>{monthFull(t)}</option>
            ))}
          </select>
        </label>
      )}
      <p className="muted small">
        {d.choice === 'age' ? '지금 나이는 각자 자기 나이로 바꿀 수 있어요.' : d.choice === 'thisYear' ? '그리는 날 기준으로 1월부터 이번 달까지예요.' : '모두 같은 기간으로 그려요.'}
      </p>
      {err && <p className="alert" role="alert">{err}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">정하기</button>
        {preset && (
          <button type="button" className="btn btn-text" onClick={() => save(null)}>정하지 않기</button>
        )}
      </div>
    </form>
  )
}
