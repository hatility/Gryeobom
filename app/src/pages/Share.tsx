import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { api, type GroupSummary } from '../api'
import { useAuth } from '../auth'
import LifeGraph from '../components/LifeGraph'
import { GroupInfoForm } from './GroupPage'
import { lineColorOf, scoreWord, signed, timeLabel } from '../content'
import { decodeShared, sanitizeShared, type SharedGraph } from '../share'

const PRINCIPLES = [
  ['기본은 나만 보기', '나누기는 내가 고를 때만 열려요.'],
  ['내가 고른 것만', '나눌 순간을 하나씩 직접 골라요.'],
  ['마음 기록은 나만', '회고는 공유 링크 · 모임에 나가지 않아요.'],
  ['평가하지 않아요', '점수도 순위도 없어요.'],
]

/** 짧은 공유 링크 (/s/:code): 서버에 둔 공개용 내용을 받아 보여준다 */
export function SharedLink() {
  const { code = '' } = useParams()
  const [shared, setShared] = useState<SharedGraph | null | undefined>(undefined)
  useEffect(() => {
    api.link(code).then((r) => setShared(sanitizeShared(r.shared)), () => setShared(null))
  }, [code])
  if (shared === undefined) return <p className="container page loading serif">선을 펼치는 중이에요…</p>
  if (!shared) return <TangledLink text="링크가 꺼졌거나 없는 링크예요. 나눠 준 사람에게 다시 한 번 받아 볼까요?" />
  return <SharedView shared={shared} />
}

function TangledLink({ text }: { text: string }) {
  return (
    <section className="container page empty-state">
      <p className="eyebrow">TANGLED LINE</p>
      <h1>링크가 조금 엉킨 것 같아요</h1>
      <p className="muted">{text}</p>
      <Link to="/" className="btn btn-primary">그려봄 둘러보기</Link>
    </section>
  )
}

function SharedView({ shared }: { shared: SharedGraph }) {
  return (
    <article className="container page result">
      <header className="result-head">
        <p className="eyebrow">SOMEONE&apos;S LINE</p>
        <h1 className="page-title">{shared.title || '누군가의 작은 인생 이야기'}</h1>
        <p className="muted">누군가 용기 내어 나눠 준 선이에요. 판단하기보다 천천히 바라봐 주세요.</p>
      </header>
      <section className="card graph-card">
        <LifeGraph tone={lineColorOf(shared.tone)}
          points={shared.entries.map((e, i) => ({ ...e, id: `s${i}` }))}
          timeScale={shared.timeScale}
          start={shared.startPoint}
          end={shared.currentPoint}
          showTimeLabels={shared.showTime}
        />
      </section>
      {shared.entries.length > 0 && (
        <ol className="moment-list">
          {shared.entries.map((e, i) => (
            <li key={i} className="card moment">
              <div className="moment-head">
                {shared.showTime && <span className="entry-time">{timeLabel(shared.timeScale, e.timePoint)}</span>}
                <span className="muted small">마음 {signed(e.emotionScore)} · {scoreWord(e.emotionScore)}</span>
              </div>
              <h3>{e.title || '이름 없는 순간'}</h3>
              {e.emotionLabel && <span className="chip chip-static">{e.emotionLabel}</span>}
              {e.description && <p>{e.description}</p>}
            </li>
          ))}
        </ol>
      )}
      <aside className="card soft-card center">
        <p className="serif big">다른 사람과 달라도 괜찮아요.</p>
        <p className="muted small">이 페이지는 나눠 준 사람이 고른 내용만 보여줘요. 그때의 마음 기록은 담기지 않아요.</p>
        <Link to="/graph/new" className="btn btn-primary">나도 나의 선 그려보기</Link>
      </aside>
    </article>
  )
}

export default function Share() {
  const { hash } = useLocation()
  const { user } = useAuth()
  const code = hash.slice(1)
  const shared = useMemo(() => (code ? decodeShared(code) : null), [code])

  // 예전(0.14.x까지)의 긴 링크(#…)도 계속 열린다
  if (code && !shared) return <TangledLink text="링크가 잘렸거나 바뀌었을 수 있어요. 나눠 준 사람에게 다시 한 번 받아 볼까요?" />
  if (shared) return <SharedView shared={shared} />

  return (
    <section className="container page">
      <header className="page-head">
        <div>
          <p className="eyebrow">TOGETHER, GENTLY</p>
          <h1 className="page-title">함께 나누기</h1>
          <p className="muted">각자의 선을 있는 그대로 바라봐요.</p>
        </div>
      </header>

      <ul className="principles">
        {PRINCIPLES.map(([t, d], i) => (
          <li key={t} className="card">
            <span className="flow-num">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="card-title">{t}</h2>
            <p className="muted small">{d}</p>
          </li>
        ))}
      </ul>

      {user ? (
        <GroupsHub />
      ) : (
        <div className="card soft-card center section-tight">
          <p className="serif big">모임은 로그인하면 함께할 수 있어요.</p>
          <p className="muted small">공유 링크는 로그인 없이도 돼요.</p>
          <Link to="/login?next=/share" className="btn btn-primary">로그인하기</Link>
        </div>
      )}
    </section>
  )
}

function GroupsHub() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api.groups().then(setGroups, (e) => setErr(e.message))
  }, [])

  const run = async (fn: () => Promise<{ id: string }>) => {
    setErr('')
    try {
      navigate(`/groups/${(await fn()).id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }

  return (
    <section className="section-tight">
      <h2 className="section-title">나의 모임</h2>
      {err && <p className="alert" role="alert">{err}</p>}
      {groups === null ? (
        <p className="muted serif">불러오는 중이에요…</p>
      ) : groups.length ? (
        <ul className="entry-list">
          {groups.map((g) => (
            <li key={g.id} className="entry-item">
              <span className="entry-body">
                <strong>{g.name}</strong>
                <small>{g.memberCount}명{g.role === 'owner' ? ' · 내가 모임장' : g.role === 'co' ? ' · 공동 모임장' : ''}</small>
              </span>
              <Link to={`/groups/${g.id}`} className="btn btn-text">들어가기</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">아직 들어간 모임이 없어요. 선생님께 받은 코드로 들어가거나, 새 모임을 만들어 봐요.</p>
      )}

      <div className="hub-forms">
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api.joinGroup(code)) }}>
          <h3 className="card-title">코드로 들어가기</h3>
          <label className="field">
            <span className="field-label">모임 참여 코드</span>
            <input value={code} maxLength={6} autoCapitalize="characters" placeholder="예) K7M2QX" onChange={(e) => setCode(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-primary">들어가기</button>
        </form>
        <div className="card new-group">
          <h3 className="card-title">새 모임 만들기</h3>
          <GroupInfoForm
            init={{ name: '', intro: '' }}
            submitText="만들기"
            onSave={async ({ name, intro }) => navigate(`/groups/${(await api.createGroup(name, intro)).id}`)}
          />
          <small className="muted">만들면 참여 코드와 초대 링크가 생겨요. 아는 사람만 들어올 수 있어요.</small>
        </div>
      </div>
    </section>
  )
}
