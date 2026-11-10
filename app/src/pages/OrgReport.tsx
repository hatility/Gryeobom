import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, shareBase, type GroupSummary, type MyOrg } from '../api'
import { useAuth } from '../auth'
import { useLabs } from '../labs'

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

/**
 * 실험: 기관 (/org) — 내가 담당자인 기관 목록과 ‘기관 등록하기’.
 * 기관은 담당자만 본다 (모임 회원에게는 기관이 있는지도 보이지 않는다).
 */
export default function OrgHome() {
  const labs = useLabs('org')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null)
  const [name, setName] = useState('')
  const [checks, setChecks] = useState([false, false, false])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (labs && user) api.myOrgs().then(setOrgs, (e) => { setOrgs([]); setErr(e.message) })
  }, [labs, user])
  if (!labs) return null
  if (!user) return <section className="container page empty-state"><p className="serif big">로그인하면 볼 수 있어요.</p><Link to="/login?next=/org" className="btn btn-primary">로그인</Link></section>
  const register = async () => {
    setErr('')
    try {
      navigate(`/org/${(await api.createOrg(name.trim(), true)).id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '등록하지 못했어요.')
    }
  }
  const agreed = checks.every(Boolean)
  return (
    <section className="container page org-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">기관</p>
          <h1 className="page-title">내가 맡은 기관</h1>
          <p className="muted">수련관 · 학교 · 복지관처럼 여러 모임을 꾸리는 곳이에요. 기관 담당자는 묶인 모임의 흐름(개인을 알 수 없는 통계)만 모아 봐요.</p>
        </div>
      </header>
      <div className="org-home">
        <div className="org-home-main">
          {orgs === null ? <p className="muted serif">불러오는 중이에요…</p> : (
            orgs.length > 0 && <ul className="card org-cards">
              {orgs.map((o) => (
                <li key={o.id}>
                  <Link to={`/org/${o.id}`} className="org-card-link">
                    <span className="org-card-name">{o.name}</span>
                    <span className="org-card-meta">모임 {o.total.groups}개 · 함께하는 사람 {o.total.members}명 · 담당자 {o.managers.length}명</span>
                    <span className="org-card-go" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <form className="card form-card org-register" onSubmit={(e) => { e.preventDefault(); if (name.trim() && agreed) register() }}>
            <h2 className="card-title">{orgs?.length ? '기관 하나 더 등록하기' : '기관 등록하기'}</h2>
            <fieldset className="org-notice">
              <legend>기관 등록 전에 확인해 주세요</legend>
              {ORG_NOTICE.map((t, i) => (
                <label key={i} className="check">
                  <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((x, k) => (k === i ? e.target.checked : x)))} />
                  <span>{t}</span>
                </label>
              ))}
            </fieldset>
            <p className="org-alt muted small">기관이 아니라 친구 · 동아리끼리라면 → <Link to="/share">모임 만들기 ›</Link></p>
            <div className="inline-form">
              <input value={name} maxLength={40} placeholder="예) ○○시 청소년수련관" aria-label="기관 이름" onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim() || !agreed}>등록하기</button>
            </div>
            {err && <p className="alert" role="alert">{err}</p>}
          </form>
        </div>
        <aside className="card org-guide" aria-label="기관 쓰는 법">
          <h2 className="card-title">기관은 이렇게 써요</h2>
          <ol className="org-steps">
            <li><strong>기관 등록</strong><span className="muted small">등록한 사람이 첫 담당자가 돼요.</span></li>
            <li><strong>모임 잇기</strong><span className="muted small">내 모임을 더하거나, 다른 모임장에게 기관의 ‘연결 코드’ 를 알려 주면 그 모임장이 이어요.</span></li>
            <li><strong>기관 리포트</strong><span className="muted small">묶인 모임의 흐름을 개인을 알 수 없는 통계로 모아 봐요.</span></li>
          </ol>
          <div className="org-sees">
            <p><strong>담당자가 볼 수 있는 것</strong><span className="muted small">모임 수 · 참여 인원 · 나눈 순간의 마음 분포 같은 전체 통계</span></p>
            <p><strong>볼 수 없는 것</strong><span className="muted small">누가 무엇을 그렸는지, 그때의 마음 · 지금의 나</span></p>
          </div>
          <Link to="/share" className="btn btn-text btn-sm">기관이 아니라면 모임 만들기 ›</Link>
        </aside>
      </div>
    </section>
  )
}

const ORG_NOTICE = [
  '학교 · 청소년수련관 · 복지관 등 실제 기관에서 모임을 꾸리는 담당자예요.',
  '장난이나 기관이 아닌 등록은 운영자가 지울 수 있어요.',
  '기관 담당자는 묶인 모임의 통계만 보고, 회원 한 사람의 기록은 볼 수 없어요.',
]

type Tab = 'report' | 'groups' | 'people'

/** 기관 하나 (/org/:id) — 리포트 · 모임 · 담당자와 설정. 담당자만 */
export function OrgDetail() {
  const { id = '' } = useParams()
  const labs = useLabs('org')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [org, setOrg] = useState<MyOrg | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('report')
  const [range, setRange] = useState<[string, string] | null>(null)
  const load = () => api.myOrgs(range?.[0], range?.[1]).then((l) => setOrg(l.find((o) => o.id === id) ?? null), () => setOrg((o) => o ?? null))
  useEffect(() => {
    if (labs && user) load()
  }, [labs, user, id, range])
  if (!labs) return null
  if (!user) return <section className="container page empty-state"><p className="serif big">로그인하면 볼 수 있어요.</p><Link to={`/login?next=/org/${id}`} className="btn btn-primary">로그인</Link></section>
  if (org === undefined) return <p className="container page loading serif">불러오는 중이에요…</p>
  if (!org) return <section className="container page empty-state"><p className="serif big">맡은 기관이 아니거나 없어진 기관이에요.</p><Link to="/org" className="btn btn-primary">내가 맡은 기관</Link></section>
  return (
    <section className="container page org-page">
      <header className="page-head">
        <div>
          <Link to="/org" className="btn btn-text btn-sm no-print back-top">← 내가 맡은 기관</Link>
          <h1 className="page-title">{org.name}</h1>
          <p className="muted">모임 {org.total.groups}개 · 함께하는 사람 {org.total.members}명 · 담당자 {org.managers.map((m) => m.nickname).join(', ')}</p>
        </div>
        {tab === 'report' && <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>인쇄 · PDF</button>}
      </header>
      <div className="org-tabs no-print" role="tablist">
        {([['report', '리포트'], ['groups', `모임 ${org.groups.length}`], ['people', '담당자 · 설정']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="admin-subtab" onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'report' ? <OrgReportView org={org} range={range} setRange={setRange} />
        : tab === 'groups' ? <OrgGroups org={org} onChange={load} />
        : <OrgPeople org={org} onChange={load} onGone={() => navigate('/org')} />}
    </section>
  )
}

function OrgReportView({ org, range, setRange }: { org: MyOrg; range: [string, string] | null; setRange: (r: [string, string] | null) => void }) {
  const now = new Date()
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const q = Math.floor(now.getMonth() / 3)
  const presets: [string, [string, string]][] = [
    ['이번 달', [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)]],
    ['지난달', [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))]],
    ['이번 분기', [ymd(new Date(now.getFullYear(), q * 3, 1)), ymd(now)]],
    ['올해', [`${now.getFullYear()}-01-01`, ymd(now)]],
  ]
  if (!org.groups.length) return <p className="card muted">아직 묶인 모임이 없어요. ‘모임’ 탭에서 내 모임을 더하거나, 연결 코드를 모임장에게 알려 주세요.</p>
  return (
    <>
      <div className="stats-range org-range no-print">
        <span className="stats-presets">
          <button type="button" className="chip" aria-pressed={!range} onClick={() => setRange(null)}>누적만</button>
          {presets.map(([label, r]) => <button key={label} type="button" className="chip" aria-pressed={range?.[0] === r[0] && range?.[1] === r[1]} onClick={() => setRange(r)}>{label}</button>)}
        </span>
        <input type="date" value={range?.[0] ?? ''} aria-label="시작 날짜" onChange={(e) => e.target.value && setRange([e.target.value, range?.[1] ?? ymd(now)])} />
        <span className="muted">~</span>
        <input type="date" value={range?.[1] ?? ''} aria-label="끝 날짜" onChange={(e) => e.target.value && setRange([range?.[0] ?? e.target.value, e.target.value])} />
      </div>
      <article className="card org-card">
        <h2 className="card-title">{org.name} <small className="muted">· {new Date().toLocaleDateString('ko-KR')} 기준 · 누가 무엇을 그렸는지는 보이지 않아요</small></h2>
        <ul className="stats-total">
          <li><strong>{org.total.groups}</strong><span className="muted small">모임</span></li>
          <li><strong>{org.total.members}</strong><span className="muted small">함께하는 사람</span></li>
          <li><strong>{pct(org.total.sharers, org.total.members)}%</strong><span className="muted small">선을 나눈 사람</span></li>
          <li><strong>{org.total.done}</strong><span className="muted small">다 그린 선</span></li>
          <li><strong>{org.total.moments}</strong><span className="muted small">나눈 순간</span></li>
          <li><strong>{org.total.cheers}</strong><span className="muted small">오간 응원</span></li>
        </ul>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead><tr><th>모임</th><th>사람</th><th>나눈 사람</th><th>다 그린 선</th><th>그리는 중</th><th>나눈 순간</th><th>응원</th><th>이번 주 새 글</th></tr></thead>
            <tbody>
              {org.groups.map((g) => (
                <tr key={g.id}><td>{g.name}</td><td>{g.report.members}</td><td>{g.report.sharers} ({pct(g.report.sharers, g.report.members)}%)</td><td>{g.report.done}</td><td>{g.report.drawing}</td><td>{g.report.moments}</td><td>{g.report.cheers}</td><td>{g.report.newPosts}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {range && (
          <>
            <h3 className="field-label">{range[0]} ~ {range[1]} 동안</h3>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead><tr><th>모임</th><th>새로 들어온 사람</th><th>모임에서 그린 그래프</th><th>나눈 글</th><th>응원</th><th>활동</th><th>참여(연인원)</th></tr></thead>
                <tbody>
                  {org.groups.map((g) => g.period && (
                    <tr key={g.id}><td>{g.name}</td><td>{g.period.joined}</td><td>{g.period.graphs}</td><td>{g.period.posts}</td><td>{g.period.cheers}</td><td>{g.period.events}</td><td>{g.period.attended}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <OrgNews org={org} />
      </article>
    </>
  )
}

/** 기관의 모임: 내 모임 더하기 · 빼기, 다른 모임은 연결 코드로 */
function OrgGroups({ org, onChange }: { org: MyOrg; onChange: () => void }) {
  const [mine, setMine] = useState<GroupSummary[]>([])
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.groups().then((gs) => setMine(gs.filter((g) => (g.role === 'owner' || g.role === 'co') && !g.closedAt)), () => {})
  }, [])
  const inOrg = new Set(org.groups.map((g) => g.id))
  const addable = mine.filter((g) => !inOrg.has(g.id))
  const act = (p: Promise<unknown>, done: string) => p.then(() => { setMsg(done); onChange() }, (e) => setMsg(e.message))
  return (
    <div className="org-section">
      <section className="card">
        <h2 className="card-title">묶인 모임 <small className="muted">{org.groups.length}개</small></h2>
        {org.groups.length ? (
          <ul className="entry-list">
            {org.groups.map((g) => (
              <li key={g.id} className="entry-item">
                <span className="entry-body"><strong>{g.name}</strong><small>{g.report.members}명 · 참여 코드 {g.code}</small></span>
                <span className="entry-actions">
                  {mine.some((m) => m.id === g.id) && <Link to={`/groups/${g.id}`} className="btn btn-text btn-sm">들어가기</Link>}
                  <button type="button" className="btn btn-text btn-sm danger" onClick={() => window.confirm(`‘${g.name}’ 을 기관에서 뺄까요? 모임은 그대로예요.`) && act(api.orgRemoveGroup(org.id, g.id), '뺐어요.')}>빼기</button>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">아직 묶인 모임이 없어요.</p>}
      </section>
      <section className="card">
        <h2 className="card-title">내 모임 더하기</h2>
        {addable.length ? (
          <div className="chips">{addable.map((g) => <button key={g.id} type="button" className="chip" onClick={() => act(api.orgAddGroup(org.id, g.id), `‘${g.name}’ 을 더했어요.`)}>+ {g.name}</button>)}</div>
        ) : <p className="muted small">내가 모임장 · 공동 모임장인 모임은 모두 묶였어요.</p>}
      </section>
      <section className="card">
        <h2 className="card-title">다른 모임장의 모임 잇기</h2>
        <p className="muted small">아래 연결 코드를 모임장에게 알려 주세요. 모임장이 자기 모임 화면의 ‘기관에 잇기’ 에 적으면 이 기관에 묶여요. 모임 회원들에게는 기관이 보이지 않아요.</p>
        <p className="org-code"><span className="muted small">연결 코드</span><strong>{org.code}</strong>
          <button type="button" className="btn btn-text btn-sm" onClick={() => navigator.clipboard?.writeText(org.code).then(() => setMsg('연결 코드를 복사했어요.'), () => {})}>복사</button>
          <button type="button" className="btn btn-text btn-sm" onClick={() => window.confirm('연결 코드를 새로 만들까요? 예전 코드는 더 쓸 수 없어요 (이미 묶인 모임은 그대로).') && act(api.newOrgCode(org.id), '새 연결 코드를 만들었어요.')}>새로 만들기</button>
        </p>
      </section>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  )
}

/** 담당자 · 설정: 담당자 초대 링크 · 이름 바꾸기 · 그만하기 · 지우기 */
function OrgPeople({ org, onChange, onGone }: { org: MyOrg; onChange: () => void; onGone: () => void }) {
  const [name, setName] = useState(org.name)
  const [base, setBase] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    shareBase().then(setBase)
  }, [])
  const act = (p: Promise<unknown>, done: string) => p.then(() => { setMsg(done); onChange() }, (e) => setMsg(e.message))
  const url = org.invite ? `${base}/org-invite/${org.invite}` : ''
  return (
    <div className="org-section">
      <section className="card">
        <h2 className="card-title">담당자 <small className="muted">{org.managers.length}명</small></h2>
        <ul className="org-managers">{org.managers.map((m) => <li key={m.id} className="chip chip-static">{m.nickname}{m.me ? ' (나)' : ''}</li>)}</ul>
        <p className="muted small">함께 맡을 사람에게 초대 링크를 보내요. 로그인하고 ‘맡을게요’ 를 누르면 담당자가 되고, 링크는 한 번 쓰면 꺼져요.</p>
        {url ? (
          <div className="share-link">
            <input readOnly value={url} aria-label="담당자 초대 링크" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigator.clipboard?.writeText(url).then(() => setMsg('초대 링크를 복사했어요.'), () => {})}>복사</button>
            <button type="button" className="btn btn-text btn-sm danger" onClick={() => act(api.orgInviteOff(org.id), '링크를 껐어요.')}>끄기</button>
          </div>
        ) : <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(api.orgMakeInvite(org.id), '초대 링크를 만들었어요.')}>담당자 초대 링크 만들기</button>}
      </section>
      <form className="card" onSubmit={(e) => { e.preventDefault(); act(api.renameOrg(org.id, name.trim()), '이름을 바꿨어요.') }}>
        <h2 className="card-title">기관 이름</h2>
        <div className="inline-form">
          <input value={name} maxLength={40} aria-label="기관 이름" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={!name.trim() || name.trim() === org.name}>바꾸기</button>
        </div>
      </form>
      <section className="card org-danger">
        <h2 className="card-title">기관 그만두기</h2>
        <p className="muted small">기관을 지워도 묶인 모임과 회원 · 기록은 그대로 남아요.</p>
        <div className="form-actions">
          {org.managers.length > 1 && <button type="button" className="btn btn-text danger" onClick={() => window.confirm('이 기관의 담당자를 그만둘까요? 다른 담당자는 그대로예요.') && api.leaveOrg(org.id).then(onGone, (e) => setMsg(e.message))}>담당자 그만두기</button>}
          <button type="button" className="btn btn-text danger" onClick={() => window.confirm(`‘${org.name}’ 기관을 지울까요? 묶인 모임과 회원 · 기록은 그대로예요.`) && api.deleteOrg(org.id).then(onGone, (e) => setMsg(e.message))}>기관 지우기</button>
        </div>
      </section>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  )
}

/** 맡은 모임 모두에 같은 소식을 한 번에 (끝난 모임은 빼고) */
function OrgNews({ org }: { org: MyOrg }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const send = async (news: string) => {
    if (!news && !window.confirm(`${org.groups.length}개 모임의 소식을 모두 내릴까요?`)) return
    try {
      const r = await api.orgNews(org.id, news)
      setMsg(news ? `${r.groups}개 모임에 소식을 올렸어요.` : '모든 모임의 소식을 내렸어요.')
      setText('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    }
  }
  return (
    <details className="org-news no-print">
      <summary className="field-label">모든 모임에 소식 보내기</summary>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text.trim()) }}>
        <textarea rows={3} maxLength={300} value={text} placeholder="예) 다음 주는 기관 휴관이라 모임을 쉬어요." aria-label="모든 모임에 보낼 소식" onChange={(e) => setText(e.target.value)} />
        <p className="muted small">각 모임의 ‘모임 소식’ 을 이 글로 바꿔요 (모임장이 쓴 소식 대신). 끝난 모임에는 가지 않아요. {text.length}/300</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>{org.groups.length}개 모임에 올리기</button>
          <button type="button" className="btn btn-text btn-sm danger" onClick={() => send('')}>모두 내리기</button>
        </div>
        {msg && <p className="muted small" role="status">{msg}</p>}
      </form>
    </details>
  )
}

/** 기관 담당자 초대 링크 (/org-invite/:token) — 로그인한 사람이 ‘맡을게요’ 를 누르면 담당자가 된다 */
export function OrgInvite() {
  const { token = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [info, setInfo] = useState<{ name: string; groups: number; already: boolean } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.orgInvite(token).then(setInfo, (e) => setErr(e.message))
  }, [token, user])
  if (err) return <section className="container page empty-state"><p className="serif big">{err}</p></section>
  if (!info) return <p className="container page loading serif">확인하는 중이에요…</p>
  const accept = () => api.acceptOrgInvite(token).then((r) => navigate(`/org/${r.id}`), (e) => setErr(e.message))
  return (
    <section className="container page auth-page">
      <div className="card form-card auth-card">
        <p className="eyebrow">기관 담당자 초대</p>
        <h1 className="card-title">‘{info.name}’ 의 담당자가 되어 주세요</h1>
        <p className="muted">모임 {info.groups}개의 리포트를 모아 볼 수 있어요. 누가 무엇을 그렸는지 · 회고는 보이지 않아요.</p>
        {info.already ? (
          <Link to="/org" className="btn btn-primary btn-block">이미 담당자예요 · 기관 보기</Link>
        ) : user ? (
          <button type="button" className="btn btn-primary btn-block" onClick={accept}>{user.nickname} 계정으로 맡을게요</button>
        ) : (
          <Link to={`/login?next=${encodeURIComponent(`/org-invite/${token}`)}`} className="btn btn-primary btn-block">로그인하고 맡기</Link>
        )}
        <p className="muted small">이 링크는 한 번 쓰면 꺼져요.</p>
      </div>
    </section>
  )
}
