import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { markNewsSeen, useLabs } from '../labs'
import QrCode from '../components/QrCode'
import { api, ApiError, REPORT_REASONS, shareBase, type GroupDetail, type GroupMember, type GroupReport, type GroupPost, type ReportReason, type GroupEvent } from '../api'
import { useAuth } from '../auth'
import LifeGraph from '../components/LifeGraph'
import HourRange from '../components/HourRange'
import { CHEERS, MOMENT_EXAMPLES, NOW_QUESTIONS, PLAYBOOKS, QUESTION_SETS, lineColorOf, monthFull, monthIndex, presetLabel, scoreWord, signed, timeLabel } from '../content'
import { exportImage, smoothPath, spreadSameTime } from '../graph'
import { GROUP_POST } from '../share'
import { formatDate } from '../store'
import type { GroupPreset, GroupPrompts, NowKey, ReflectKey } from '../types'

export default function GroupPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [group, setGroup] = useState<GroupDetail | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState<'' | 'code' | 'link'>('')
  const [inviteUrl, setInviteUrl] = useState('')

  // 15초마다 다시 받다가 잠깐 끊긴 것이면 보던 화면을 그대로 둔다 (없어졌거나 나간 모임만 ‘없음’)
  const load = () => api.group(id).then(setGroup, (e) => setGroup((g) => (g && !(e instanceof ApiError && e.status >= 400 && e.status < 500) ? g : null)))
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
          <p className="eyebrow en">OUR LINES, TOGETHER</p>
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
            <InviteExtras group={group} inviteUrl={inviteUrl} />
          </div>
        ) : null}
      </header>

      {group.closedAt && (
        <p className="notice closed-note" role="status">
          {formatDate(group.closedAt)}에 끝난 모임이에요. 지금은 보기만 할 수 있어요 (새로 들어오기 · 나누기 · 일정 더하기는 멈춰요).
        </p>
      )}

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

      {!group.closedAt && <GroupStart group={group} onSaved={load} />}

      <div className="group-now">
        <NewsCard group={group} onSaved={load} />
        <TopicCard group={group} onSaved={load} />
        <EventsCard group={group} onSaved={load} />
      </div>
      {!group.isManager && <QuestionSetCard group={group} onSaved={load} />}

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

      {group.isManager && (
        <section className="group-manage" aria-label="모임 꾸리기">
          <h2 className="section-title">모임 꾸리기</h2>
          <div className="group-manage-list">
            <ReportCard groupId={group.id} groupName={group.name} />
            <PlaybooksCard group={group} onSaved={load} />
            <QuestionSetCard group={group} onSaved={load} />
            <PromptsCard group={group} onSaved={load} />
            <OrgLinkCard group={group} onSaved={load} />
          </div>
          <CopyGroupButton group={group} />
        </section>
      )}

      <div className="form-actions group-foot">
        <CloseGroupButton group={group} onSaved={load} />
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
  onRole: (m: GroupMember, role: 'co' | 'helper' | 'member') => void; onTransfer: (m: GroupMember) => void
}) {
  const groups: [GroupMember['role'], string][] = [['owner', '모임장'], ['co', '공동 모임장'], ['helper', '도우미'], ['member', '함께하는 사람']]
  return (
    <section className="card members-card">
      <div className="members-head">
        <h2 className="card-title">함께하는 사람 <small className="muted">{members.length}명</small></h2>
        {isOwner && members.length > 1 && (
          <button type="button" className="btn btn-text btn-sm" aria-expanded={manage} onClick={() => onManage(!manage)}>
            {manage ? '다 했어요' : '역할 정하기 · 모임장 넘기기'}
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
  onRole: (m: GroupMember, role: 'co' | 'helper' | 'member') => void
  onTransfer: (m: GroupMember) => void
}) {
  const labs = useLabs('group')
  return (
    <div className="members-panel">
      <p className="muted small">
        공동 모임장은 모임 이름 · 소개와 함께 그릴 시간을 정하고, 참여 코드를 보고, 모임을 지키기 위해 그래프를 내릴 수 있어요.
        모임 없애기 · 사람 정하기 · 모임장 넘기기는 모임장만 해요.{labs && ' 도우미는 활동 일정 · 모임 소식 · 큰 화면 진행만 해요 (출석 확인 · 진행을 돕는 사람).'}
      </p>
      <ul className="entry-list">
        {members.map((m) => (
          <li key={m.id ?? m.nickname} className="entry-item">
            <span className="entry-body">
              <strong>{m.nickname}</strong>
              <small>{m.role === 'owner' ? '모임장 (나)' : m.role === 'co' ? '공동 모임장' : m.role === 'helper' ? '도우미' : '함께하는 사람'}</small>
            </span>
            {m.role !== 'owner' && m.id && (
              <span className="entry-actions">
                <button type="button" className="btn btn-text btn-sm" onClick={() => onRole(m, m.role === 'co' ? 'member' : 'co')}>
                  {m.role === 'co' ? '공동 모임장 풀기' : '공동 모임장으로'}
                </button>
                {labs && m.role !== 'co' && (
                  <button type="button" className="btn btn-text btn-sm" onClick={() => onRole(m, m.role === 'helper' ? 'member' : 'helper')}>
                    {m.role === 'helper' ? '도우미 풀기' : '도우미로'}
                  </button>
                )}
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
        <p className="eyebrow en">OUR LINES</p>
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
      <div className="cheers">
        <SaveImage post={post} />
        {!post.mine && <ReportButton post={post} />}
        {canRemove && (
          <button type="button" className="btn btn-text danger btn-sm cheers-remove" onClick={onRemove}>
            {post.mine ? '내리기' : '모임에서 내리기'}
          </button>
        )}
      </div>
      </details>
      {/* 응원은 접혀 있어도 늘 보이게. 몇 개 받았는지는 그래프 주인만 본다 (인기 비교가 되지 않게) */}
      {post.mine ? (
        <p className="cheer-bar is-mine">
          <span className="cheer-bar-label">받은 응원</span>
          {Object.keys(post.counts ?? {}).length
            ? CHEERS.filter((k) => post.counts?.[k]).map((k) => <span key={k} className="cheer-count">{k} <b>{post.counts![k]}</b></span>)
            : <span className="muted small">아직 없어요. 나눈 것만으로도 충분해요.</span>}
        </p>
      ) : (
        <div className="cheer-bar" role="group" aria-label={`${post.nickname}님에게 응원 보내기`}>
          <span className="cheer-bar-label">응원 보내기</span>
          {CHEERS.map((k) => {
            const on = post.myCheers.includes(k)
            return (
              <button key={k} type="button" className="cheer-btn" aria-pressed={on} onClick={() => onCheer(k)}>
                {on && <span aria-hidden="true">✓ </span>}{k}
              </button>
            )
          })}
        </div>
      )}
    </li>
  )
}

/** 일정 · 소식을 다루는 사람: 모임장 · 공동 모임장 · 도우미(실험) */
const crew = (g: GroupDetail) => g.isManager || !!g.isHelper

/** 날짜 → ‘11월 20일 (목)’ */
export const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`
}

/** 출석 — ‘참여했어요’ 를 눌러 남기고, 몇 명이 참여했는지만 보인다 */
function AttendButton({ e, onClick }: { e: GroupEvent; onClick: () => void }) {
  return (
    <button type="button" className={`btn btn-sm attend-btn${e.mine ? ' is-on' : ''}`} aria-pressed={!!e.mine} onClick={onClick}>
      {e.mine ? '✓ 참여했어요' : '참여했어요'} <small>{e.count ?? 0}명</small>
    </button>
  )
}

/** 모임 복제 — 이름 · 소개 · 주제 · 함께 그릴 시간을 그대로 새 모임으로 (사람 · 글은 빼고) */
function CopyGroupButton({ group }: { group: GroupDetail }) {
  const labs = useLabs('group')
  const navigate = useNavigate()
  if (!labs || !group.isManager) return null
  const go = async () => {
    const name = window.prompt('새 모임 이름 (소개 · 주제 · 함께 그릴 시간은 그대로 가져와요)', `${group.name} (새 학기)`.slice(0, 30))
    if (!name?.trim()) return
    try {
      navigate(`/groups/${(await api.copyGroup(group.id, name.trim())).id}`)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '만들지 못했어요.')
    }
  }
  return <p className="copy-group"><button type="button" className="btn btn-text btn-sm" onClick={go}>이 모임 설정으로 새 모임 만들기</button></p>
}

/** 모임 활동 일정 — 다가오는 것만, 모임장 · 공동 모임장이 더하고 지운다 */
function EventsCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('group')
  const [day, setDay] = useState('')
  const [title, setTitle] = useState('')
  const [err, setErr] = useState('')
  const all = group.events ?? []
  if (!labs || (!all.length && !crew(group))) return null
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const events = all.filter((e) => e.day >= today)
  const past = all.filter((e) => e.day < today).reverse()
  const attend = (e: GroupEvent) => api.attend(group.id, e.id).then(onSaved, (x) => setErr(x.message))
  const add = async () => {
    setErr('')
    try {
      await api.addEvent(group.id, day, title.trim())
      setDay('')
      setTitle('')
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  return (
    <section className="card events-card">
      <p className="news-label">다가오는 활동{group.isHelper && !group.isManager && <Link to={`/groups/${group.id}/present`} className="btn btn-text btn-sm">큰 화면 진행 모드</Link>}</p>
      {events.length ? (
        <ul className="events-list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="event-day">{dayLabel(e.day)}{e.day === today && <b className="news-new">오늘</b>}</span>
              <span className="event-title">{e.title}</span>
              {e.day === today && <AttendButton e={e} onClick={() => attend(e)} />}
              {crew(group) && <button type="button" className="btn btn-text btn-sm danger" onClick={() => api.removeEvent(group.id, e.id).then(onSaved, () => {})} aria-label={`${e.title} 일정 지우기`}>지우기</button>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">아직 정한 활동이 없어요.</p>}
      {past.length > 0 && (
        <>
          <p className="news-label">지난 활동 <small className="muted">· 7일 안에 참여를 남길 수 있어요</small></p>
          <ul className="events-list is-past">
            {past.map((e) => (
              <li key={e.id}>
                <span className="event-day">{dayLabel(e.day)}</span>
                <span className="event-title">{e.title}</span>
                <AttendButton e={e} onClick={() => attend(e)} />
              </li>
            ))}
          </ul>
        </>
      )}
      {crew(group) && (
        <form className="event-form" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input type="date" value={day} min={today} required aria-label="날짜" onChange={(e) => setDay(e.target.value)} />
          <input value={title} maxLength={40} required placeholder="예) ‘처음 해낸 일’ 함께 그리기" aria-label="무엇을 하나요" onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" className="btn btn-ghost btn-sm">더하기</button>
        </form>
      )}
      {err && <p className="alert" role="alert">{err}</p>}
    </section>
  )
}

/** 모임 소식 — 모임장 · 공동 모임장이 모임 사람들에게 (첫 화면에도 ‘새 소식’ 으로) */
function NewsCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('group')
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(group.news ?? '')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (group.news && group.newsAt) markNewsSeen(group.id, group.newsAt)
  }, [group.id, group.news, group.newsAt])
  if (!labs || (!group.news && !crew(group))) return null
  const save = async (news: string) => {
    setErr('')
    try {
      await api.setNews(group.id, news)
      setEdit(false)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  if (edit) {
    return (
      <form className="card news-card" onSubmit={(e) => { e.preventDefault(); save(text.trim()) }}>
        <label className="field">
          <span className="field-label">모임 소식 <small className="muted">{text.length}/300</small></span>
          <textarea rows={3} value={text} maxLength={300} autoFocus placeholder="예) 다음 주 수요일은 쉬어요. 그 다음 주에 ‘처음 해낸 일’ 로 함께 그려요." onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted small">모임 사람들의 첫 화면에 ‘새 소식’ 으로 보여요. 비우고 저장하면 내려요.</p>
        {err && <p className="alert" role="alert">{err}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>닫기</button>
          <button type="submit" className="btn btn-primary btn-sm">올리기</button>
        </div>
      </form>
    )
  }
  if (!group.news) {
    return (
      <button type="button" className="card news-card topic-empty" onClick={() => { setText(''); setEdit(true) }}>
        <span className="news-label">모임 소식</span>
        <span className="muted">+ 모임 사람들에게 알릴 소식을 남겨 보세요</span>
      </button>
    )
  }
  return (
    <section className="card news-card">
      <p className="news-label">모임 소식 · {formatDate(group.newsAt ?? '')}</p>
      <p className="news-text">{group.news}</p>
      {crew(group) && <button type="button" className="btn btn-text btn-sm" onClick={() => { setText(group.news ?? ''); setEdit(true) }}>소식 고치기</button>}
    </section>
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
function ReportCard({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [r, setR] = useState<GroupReport | null>(null)
  const labs = useLabs('group')
  // 리포트만 인쇄 · PDF 로 (담당 선생님 결과 보고용)
  const print = () => {
    document.documentElement.classList.add('print-only-report')
    window.addEventListener('afterprint', () => document.documentElement.classList.remove('print-only-report'), { once: true })
    window.print()
  }
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
          <div className="report-print-head print-show">
            <p className="eyebrow">그려봄 모임 리포트</p>
            <h2>{groupName}</h2>
            <p className="muted small">{new Date().toLocaleDateString('ko-KR')} 기준 · 누가 무엇을 그렸는지는 담지 않았어요.</p>
          </div>
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
          {labs && <button type="button" className="btn btn-ghost btn-sm no-print report-print" onClick={print}>리포트 인쇄 · PDF로 저장</button>}
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
const CHOICES: [GroupPreset['choice'], string][] = [['age', '나이로'], ['year', '연도로'], ['month', '달로'], ['hour', '시간으로']]
/** 달 수(연도×12 + 0~11) ↔ <input type="month"> · 시각 수(Date.UTC 시 단위) ↔ <input type="datetime-local"> */
const toMonthInput = (t: number) => `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
const fromMonthInput = (v: string) => { const [y, m] = v.split('-').map(Number); return y * 12 + m - 1 }
const todayAt = (h: number) => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), h) / 3_600_000 }
/** 예전에 저장된 최근 12개월 · 올해는 ‘달로’ 로 바꿔 보여 준다 */
const asMonth = (p: GroupPreset): GroupPreset =>
  p.choice === 'recent12' ? { ...p, choice: 'month', start: p.end - 11 }
  : p.choice === 'thisYear' ? { ...p, choice: 'month', start: THIS_YEAR * 12, end: monthIndex() }
  : p

/** 모임에서 함께 그리기: 모임장이 정해 둔 나의 시간을 보여주고, 그 틀로 새 그래프를 시작한다 */
function GroupStart({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const p = group.preset
  return (
    <section className="card group-start">
      <div className="group-start-head">
        <div>
          <p className="eyebrow en">OUR TIME</p>
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
  const hourLab = useLabs('graph')
  const [d, setD] = useState<GroupPreset>(preset ? asMonth(preset) : { choice: 'age', start: 0, end: 17, title: '' })
  const [err, setErr] = useState('')
  const set = (p: Partial<GroupPreset>) => setD((x) => ({ ...x, ...p }))
  const choose = (choice: GroupPreset['choice']) =>
    set(
      choice === 'age' ? { choice, start: 0, end: 17 }
      : choice === 'year' ? { choice, start: THIS_YEAR - 3, end: THIS_YEAR }
      : choice === 'month' ? { choice, start: monthIndex() - 11, end: monthIndex() }
      : { choice, start: todayAt(9), end: todayAt(18) },
    )
  const save = (preset: GroupPreset | null) =>
    api.setPreset(groupId, preset).then(onDone, (e) => setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.'))
  const num = (label: string, key: 'start' | 'end', min: number, max: number) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={d[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  )
  const month = (label: string, key: 'start' | 'end') => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="month" required max={toMonthInput(monthIndex())} value={toMonthInput(d[key])} onChange={(e) => e.target.value && set({ [key]: fromMonthInput(e.target.value) })} />
    </label>
  )
  const hint =
    d.choice === 'age' ? '지금 나이는 각자 자기 나이로 바꿀 수 있어요.'
    : d.choice === 'month' ? `${monthFull(d.start)}부터 ${monthFull(d.end)}까지, ${d.end - d.start + 1}개월을 모두 같이 그려요.`
    : d.choice === 'hour' ? '하루 활동 · 캠프처럼 몇 시부터 몇 시까지를 그려요 (14일까지).'
    : '모두 같은 기간으로 그려요.'

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
          {CHOICES.filter(([c]) => c !== 'hour' || hourLab).map(([c, label]) => (
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
      {d.choice === 'month' && <div className="field-row">{month('시작 달', 'start')}{month('끝 달', 'end')}</div>}
      {d.choice === 'hour' && <HourRange whole start={d.start} end={d.end} onChange={(start, end) => set({ start, end })} />}
      <p className="muted small">{hint}</p>
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

/** QR 로 크게 · 큰 화면 진행 모드 */
function InviteExtras({ group, inviteUrl }: { group: GroupDetail; inviteUrl: string }) {
  const labs = useLabs('group')
  const dialog = useRef<HTMLDialogElement>(null)
  if (!labs || !inviteUrl) return null
  return (
    <span className="code-actions">
      <button type="button" className="btn btn-text btn-sm" onClick={() => dialog.current?.showModal()}>QR로 크게</button>
      <Link to={`/groups/${group.id}/present`} className="btn btn-text btn-sm">큰 화면 진행 모드</Link>
      <dialog ref={dialog} className="dialog qr-dialog" aria-label="모임 참여 QR" onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}>
        <h2 className="card-title qr-title">{group.name}</h2>
        <p className="muted small qr-hint">휴대폰 카메라로 찍으면 바로 들어와요</p>
        <QrCode text={inviteUrl} size={260} label={`${group.name} 모임 초대 링크 QR`} />
        <p className="qr-code-text"><span className="muted small">또는 참여 코드</span><strong>{group.code}</strong></p>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>인쇄</button>
          <button type="button" className="btn btn-primary" onClick={() => dialog.current?.close()}>닫기</button>
        </div>
      </dialog>
    </span>
  )
}

/** 모임 끝내기 (보관) · 다시 열기 — 모임장 · 공동 모임장 */
function CloseGroupButton({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('group')
  if (!labs || !group.isManager) return null
  const go = async () => {
    const closing = !group.closedAt
    if (closing && !window.confirm('모임을 끝낼까요? 나눈 그래프와 기록은 그대로 남고, 새로 들어오기 · 나누기 · 일정 더하기만 멈춰요. 언제든 다시 열 수 있어요.')) return
    await api.setGroupClosed(group.id, closing).then(onSaved, (e) => window.alert(e.message))
  }
  return <button type="button" className="btn btn-text" onClick={go}>{group.closedAt ? '모임 다시 열기' : '모임 끝내기 (보관)'}</button>
}

/** 진행안 모음 — 골라 보고, 주제로 정하거나 큰 화면 진행 모드로 연다 */
function PlaybooksCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('group')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  if (!labs || !group.isManager || group.closedAt) return null
  const p = PLAYBOOKS.find((x) => x.key === key)
  return (
    <details className="card playbooks-card">
      <summary><span className="news-label">진행안 모음</span> <span className="muted small">무엇을 할지 막막할 때 · {PLAYBOOKS.length}가지</span></summary>
      <div className="chips">
        {PLAYBOOKS.map((x) => <button key={x.key} type="button" className="chip" aria-pressed={key === x.key} onClick={() => { setKey(x.key); setMsg('') }}>{x.title}</button>)}
      </div>
      {p && (
        <div className="playbook">
          <p className="muted small">{p.who} · 약 {p.minutes}분 · 주제 ‘{p.topic}’</p>
          <ol className="playbook-steps">{p.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="muted small">💡 {p.tip}</p>
          <span className="topic-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.setTopic(group.id, p.topic).then(() => { setMsg('함께 그릴 주제로 정했어요.'); onSaved() }, (e) => setMsg(e.message))}>이 주제로 정하기</button>
            <Link to={`/groups/${group.id}/present?plan=${p.key}`} className="btn btn-primary btn-sm">큰 화면으로 진행하기</Link>
          </span>
          {msg && <p className="muted small" role="status">{msg}</p>}
        </div>
      )}
    </details>
  )
}

/** 모임 질문 묶음 — 이 모임에서 그리면 그때의 마음 질문이 이 묶음으로 시작한다 (각자 바꿀 수 있다) */
function QuestionSetCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('group')
  const [err, setErr] = useState('')
  if (!labs) return null
  const cur = group.questionSet || 'basic'
  if (!group.isManager) {
    return group.questionSet ? <p className="muted small qset-note">이 모임은 ‘{QUESTION_SETS[cur as keyof typeof QUESTION_SETS].name}’ 질문으로 돌아봐요.</p> : null
  }
  if (group.closedAt) return null
  return (
    <details className="card qset-card">
      <summary><span className="news-label">모임 질문 묶음</span> <span className="muted small">지금 ‘{QUESTION_SETS[cur as keyof typeof QUESTION_SETS].name}’ · 이 모임에서 그리면 이 질문으로 시작해요</span></summary>
      <div className="segmented">
        {Object.entries(QUESTION_SETS).map(([k, s]) => (
          <label key={k} className="seg">
            <input type="radio" name="group-qset" checked={cur === k} onChange={() => api.setGroupQuestionSet(group.id, k === 'basic' ? '' : k).then(onSaved, (e) => setErr(e.message))} />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
      {err && <p className="alert" role="alert">{err}</p>}
    </details>
  )
}

/** 질문 정하기 — 이 모임에서 그릴 때 나오는 예시 · 질문 · 큰 화면 ‘오늘 할 일’. 칸을 비우면 기본, ‘묻지 않기’ 면 빼요 */
type Row = { text: string; hide: boolean }
const rowsOf = <K extends string>(keys: K[], v?: Partial<Record<K, string>>) =>
  Object.fromEntries(keys.map((k) => [k, { text: v?.[k] ?? '', hide: v?.[k] === '' }])) as Record<K, Row>
const valuesOf = <K extends string>(rows: Record<K, Row>) => {
  const o: Partial<Record<K, string>> = {}
  for (const k in rows) if (rows[k].hide) o[k] = ''; else if (rows[k].text.trim()) o[k] = rows[k].text.trim()
  return o
}
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
function PromptsCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('group')
  const p = group.prompts ?? {}
  const reflectQs = (QUESTION_SETS[(group.questionSet || 'basic') as keyof typeof QUESTION_SETS] ?? QUESTION_SETS.basic).questions
  const [moments, setMoments] = useState((p.moments ?? []).join('\n'))
  const [present, setPresent] = useState((p.present ?? []).join('\n'))
  const [reflect, setReflect] = useState(rowsOf(reflectQs.map((q) => q.key as ReflectKey), p.reflect))
  const [now, setNow] = useState(rowsOf(NOW_QUESTIONS.map((q) => q.key as NowKey), p.now))
  const [msg, setMsg] = useState('')
  if (!labs || !group.isManager || group.closedAt) return null
  const save = (next: GroupPrompts) => api.setPrompts(group.id, next).then(() => { setMsg('저장했어요. 이제 이 모임에서 그리면 이 질문으로 시작해요.'); onSaved() }, (e) => setMsg(e.message))
  const reset = () => {
    if (!window.confirm('질문을 모두 기본으로 되돌릴까요?')) return
    setMoments(''); setPresent('')
    setReflect(rowsOf(reflectQs.map((q) => q.key as ReflectKey))); setNow(rowsOf(NOW_QUESTIONS.map((q) => q.key as NowKey)))
    save({})
  }
  const custom = !!group.prompts
  const rows = <K extends string>(qs: { key: string; q: string }[], v: Record<K, Row>, set: (f: (x: Record<K, Row>) => Record<K, Row>) => void) => (
    <ol className="prompt-rows">
      {qs.map((q) => {
        const k = q.key as K
        return (
          <li key={k} className={v[k].hide ? 'is-off' : ''}>
            <input value={v[k].text} maxLength={100} disabled={v[k].hide} placeholder={q.q} aria-label={`질문 바꾸기: ${q.q}`} onChange={(e) => { const text = e.target.value; set((x) => ({ ...x, [k]: { ...x[k], text } })) }} />
            <label className="prompt-off"><input type="checkbox" checked={v[k].hide} onChange={(e) => { const hide = e.target.checked; set((x) => ({ ...x, [k]: { ...x[k], hide } })) }} /> 묻지 않기</label>
          </li>
        )
      })}
    </ol>
  )
  return (
    <details className="card prompts-card">
      <summary><span className="news-label">질문 정하기</span> <span className="muted small">{custom ? '모임 질문을 쓰고 있어요' : '기억에 남는 순간 · 그때의 마음 · 지금의 나 · 큰 화면'}</span></summary>
      <form className="prompts-form" onSubmit={(e) => { e.preventDefault(); save({ moments: lines(moments), reflect: valuesOf(reflect), now: valuesOf(now), present: lines(present) }) }}>
        <p className="muted small">비워 두면 기본 질문이 나와요. 회색 글씨가 지금 기본 질문이에요.</p>
        <fieldset className="field prompt-part">
          <legend>기억에 남는 순간 · 예시 <small className="muted">(한 줄에 하나 · 8개까지)</small></legend>
          <textarea rows={4} value={moments} placeholder={MOMENT_EXAMPLES.join('\n')} onChange={(e) => setMoments(e.target.value)} />
        </fieldset>
        <fieldset className="field prompt-part">
          <legend>그때의 마음 · 질문</legend>
          {rows(reflectQs, reflect, setReflect)}
        </fieldset>
        <fieldset className="field prompt-part">
          <legend>지금의 나 · 질문</legend>
          {rows(NOW_QUESTIONS, now, setNow)}
        </fieldset>
        <fieldset className="field prompt-part">
          <legend>큰 화면 ‘오늘 할 일’ <small className="muted">(한 줄에 하나 · 8줄까지)</small></legend>
          <textarea rows={3} value={present} placeholder={'예) 오른쪽 QR 로 모임에 들어와요.\n떠오르는 순간을 세 개 적어요.\n짝과 한 순간만 이야기해요.'} onChange={(e) => setPresent(e.target.value)} />
        </fieldset>
        {msg && <p className="muted small" role="status">{msg}</p>}
        <div className="form-actions">
          {custom && <button type="button" className="btn btn-text btn-sm" onClick={reset}>기본으로 되돌리기</button>}
          <button type="submit" className="btn btn-primary btn-sm">저장하기</button>
        </div>
      </form>
    </details>
  )
}

/** 기관에 잇기 — 기관 담당자에게 받은 연결 코드로 (모임 회원들에게는 기관이 보이지 않는다) */
function OrgLinkCard({ group, onSaved }: { group: GroupDetail; onSaved: () => void }) {
  const labs = useLabs('org')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  if (!labs || !group.isManager || !group.orgs) return null
  if (group.orgs.length) {
    return (
      <p className="org-linked muted small">
        <span className="badge badge-soft">기관</span> {group.orgs.map((o) => o.name).join(', ')} 에 이어져 있어요 (기관 담당자가 이 모임의 흐름 — 개인을 알 수 없는 통계 — 를 봐요).{' '}
        <button type="button" className="btn btn-text btn-sm" onClick={() => window.confirm('기관과의 연결을 끊을까요?') && api.unlinkGroupOrg(group.id).then(onSaved, (e) => setMsg(e.message))}>끊기</button>
        {msg && <span role="status"> {msg}</span>}
      </p>
    )
  }
  return (
    <details className="card org-link-card">
      <summary><span className="news-label">기관에 잇기</span> <span className="muted small">수련관 · 학교 같은 기관에서 연결 코드를 받았다면</span></summary>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); api.linkGroupOrg(group.id, code).then((r) => { setMsg(`‘${r.name}’ 에 이었어요.`); setCode(''); onSaved() }, (x) => setMsg(x.message)) }}>
        <input value={code} maxLength={10} placeholder="기관 연결 코드 6자리" aria-label="기관 연결 코드" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={code.trim().length < 4}>잇기</button>
      </form>
      <p className="muted small">이으면 기관 담당자가 이 모임의 흐름(나눈 사람 수 · 응원 수 같은 통계)만 봐요. 누가 무엇을 그렸는지 · 회고는 보이지 않아요.</p>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </details>
  )
}
