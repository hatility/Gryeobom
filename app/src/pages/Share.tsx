import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { api, shareBase, type GroupSummary } from '../api'
import { downloadCsv, useLabs } from '../labs'
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
      <p className="eyebrow en">TANGLED LINE</p>
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
        <p className="eyebrow en">SOMEONE&apos;S LINE</p>
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
          <p className="eyebrow en">TOGETHER, GENTLY</p>
          <h1 className="page-title">함께 나누기</h1>
          <p className="muted">각자의 선을 있는 그대로 바라봐요.</p>
        </div>
      </header>

      <ul className="share-principles" aria-label="나누기 약속">
        {PRINCIPLES.map(([t, d]) => (
          <li key={t}><strong>{t}</strong> <span className="muted">{d}</span></li>
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
  const labsOrg = useLabs('org')
  // 내가 담당자인 기관 — 그 기관에 묶인 모임은 기관 아래에 모아 보인다
  const [orgs, setOrgs] = useState<{ id: string; name: string; groupIds: string[] }[]>([])

  useEffect(() => {
    api.groups().then(setGroups, (e) => setErr(e.message))
  }, [])
  useEffect(() => {
    if (labsOrg) api.myOrgsLite().then(setOrgs, () => {})
  }, [labsOrg])
  const orgOf = (id: string) => orgs.find((o) => o.groupIds.includes(id))
  const roleText = (g: GroupSummary) => (g.role === 'owner' ? ' · 내가 모임장' : g.role === 'co' ? ' · 공동 모임장' : g.role === 'helper' ? ' · 도우미' : '')

  const run = async (fn: () => Promise<{ id: string }>) => {
    setErr('')
    try {
      navigate(`/groups/${(await fn()).id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  const active = groups?.filter((g) => !g.closedAt) ?? []
  const closed = groups?.filter((g) => g.closedAt) ?? []

  return (
    <section className="section-tight">
      <h2 className="section-title">나의 모임 {active.length > 0 && <small className="muted">{active.length}</small>}</h2>
      {err && <p className="alert" role="alert">{err}</p>}
      {groups === null ? (
        <p className="muted serif">불러오는 중이에요…</p>
      ) : active.length ? (
        <ul className="group-rows">
          {active.map((g) => {
            const org = orgOf(g.id)
            return (
              <li key={g.id}>
                <Link to={`/groups/${g.id}`} className="group-row">
                  <span className="group-row-name">{g.name}</span>
                  {org && <span className="badge badge-soft group-row-org">{org.name}</span>}
                  <small className="muted">{g.memberCount}명{roleText(g)}</small>
                  <span className="group-row-go" aria-hidden="true">›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="muted">아직 들어간 모임이 없어요. 선생님께 받은 코드로 들어가거나, 새 모임을 만들어 봐요.</p>
      )}
      {/* 끝난 모임은 접어서 보관 */}
      {closed.length > 0 && (
        <details className="closed-groups">
          <summary className="muted small">끝난 모임 {closed.length}개 (보관)</summary>
          <ul className="group-rows">
            {closed.map((g) => (
              <li key={g.id}>
                <Link to={`/groups/${g.id}`} className="group-row is-closed">
                  <span className="group-row-name">{g.name}</span>
                  <small className="muted">{g.memberCount}명 · {g.closedAt!.slice(0, 10)} 에 끝남</small>
                  <span className="group-row-go" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="hub-forms">
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api.joinGroup(code)) }}>
          <h3 className="card-title">코드로 들어가기</h3>
          <label className="field">
            <span className="field-label">모임 참여 코드</span>
            <input value={code} maxLength={6} autoCapitalize="characters" placeholder="예) K7M2QX" onChange={(e) => setCode(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-primary">들어가기</button>
          <p className="join-tip muted small">초대 링크를 받았다면 링크를 누르기만 해도 돼요. 모임장이 큰 화면에 띄운 QR 을 휴대폰 카메라로 찍어도 들어와요.</p>
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
      <BulkGroups onDone={() => api.groups().then(setGroups, () => {})} />
      {labsOrg && orgs.length === 0 && (
        <p className="muted small org-register-line">기관으로 운영하시나요? <Link to="/org">기관 등록하기 ›</Link></p>
      )}
    </section>
  )
}

/** 반 · 프로그램 단위로 모임을 여러 개 한 번에 만들고, 참여 코드 표를 인쇄하거나 내려받는다 */
function BulkGroups({ onDone }: { onDone: () => void }) {
  const labs = useLabs('group')
  const [names, setNames] = useState('')
  const [intro, setIntro] = useState('')
  const [made, setMade] = useState<{ id: string; name: string; code: string }[] | null>(null)
  const [base, setBase] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (labs) shareBase().then(setBase)
  }, [labs])
  if (!labs) return null
  const list = names.split('\n').map((s) => s.trim()).filter(Boolean)
  const go = async () => {
    setErr('')
    setBusy(true)
    try {
      setMade((await api.createGroups(list, intro)).groups)
      setNames('')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  const print = () => {
    document.documentElement.classList.add('print-only-codes')
    window.addEventListener('afterprint', () => document.documentElement.classList.remove('print-only-codes'), { once: true })
    window.print()
  }
  return (
    <details className="card bulk-groups">
      <summary><strong>여러 모임 한 번에 만들기</strong> <small className="muted">기관 · 반 단위</small></summary>
      <p className="small">교실에서 종이로 먼저 해 보려면 <Link to="/worksheet">종이 활동지 인쇄</Link> 를 써 보세요.</p>
      <p className="muted small">한 줄에 모임 이름 하나씩, 30개까지. 만든 사람이 모든 모임의 모임장이 돼요.</p>
      <label className="field">
        <span className="field-label">모임 이름 ({list.length}/30)</span>
        <textarea rows={5} value={names} placeholder={'예)\n1반\n2반\n수요일 진로반'} onChange={(e) => setNames(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">모임 소개 <em>(선택 · 모두 같게)</em></span>
        <input value={intro} maxLength={200} onChange={(e) => setIntro(e.target.value)} />
      </label>
      {err && <p className="alert" role="alert">{err}</p>}
      <button type="button" className="btn btn-primary" disabled={!list.length || list.length > 30 || busy} onClick={go}>{busy ? '만드는 중…' : `${list.length}개 만들기`}</button>
      {made && (
        <div className="codes-sheet">
          <h3 className="card-title">참여 코드 ({made.length}개)</h3>
          <table className="codes-table">
            <thead><tr><th>모임</th><th>참여 코드</th><th>초대 링크</th></tr></thead>
            <tbody>
              {made.map((g) => (
                <tr key={g.id}><td><Link to={`/groups/${g.id}`}>{g.name}</Link></td><td className="code-cell">{g.code}</td><td className="muted small">{base}/join/{g.code}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions no-print">
            <button type="button" className="btn btn-ghost" onClick={print}>인쇄 · PDF</button>
            <button type="button" className="btn btn-text" onClick={() => downloadCsv('그려봄-모임-참여코드.csv', [['모임', '참여 코드', '초대 링크'], ...made.map((g) => [g.name, g.code, `${base}/join/${g.code}`])])}>표로 내려받기 (CSV)</button>
          </div>
        </div>
      )}
    </details>
  )
}
