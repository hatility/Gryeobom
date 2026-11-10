import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, type Invite } from '../api'
import { useAuth } from '../auth'
import { presetLabel } from '../content'
import { BirthField, GUARDIAN_EMPTY, GuardianFields, ageFrom, readBirth } from './Login'
import { useLabs } from '../labs'
import type { Guardian } from '../api'

/**
 * 초대 링크(/join/:code). 로그인하지 않았으면 이름 · 생년월일 · 별명 · 동의를 한 화면에서 받아,
 * 처음이면 바로 가입하고 이미 계정이 있으면 그 계정으로 들어간다. 다음에는 같은 이름 · 생일로 로그인해 이어 쓴다.
 */
export default function Join() {
  const { code = '' } = useParams()
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined)
  const [form, setForm] = useState({ name: '', birth: '', nickname: '', agree: false, remember: false })
  const [guardian, setGuardian] = useState<Guardian>(GUARDIAN_EMPTY)
  const labs = useLabs('guardian')
  const young = labs && !user && (ageFrom(form.birth) ?? 99) < 14
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))

  useEffect(() => {
    api.invite(code).then(setInvite, (e) => {
      setInvite(null)
      setErr(e instanceof Error ? e.message : '')
    })
  }, [code, user])

  const enter = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!user && !readBirth(form.birth)) return setErr('생년월일을 8자리로 확인해 주세요. 예) 20120315')
    if (!user && !form.agree) return setErr('이용약관과 개인정보 처리방침에 동의해 주세요.')
    if (young && (!guardian.agreed || !guardian.contact.trim())) return setErr('만 14세 미만은 보호자의 동의가 필요해요. 보호자와 함께 적어 주세요.')
    setBusy(true)
    setErr('')
    try {
      const r = await api.joinByInvite(code, user ? {} : { ...form, nickname: form.nickname.trim(), ...(young ? { guardian } : {}) })
      if ('needSignup' in r) return setErr('모임에서 보일 별명을 적어 주세요.')
      setUser(r.user)
      navigate(`/groups/${r.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }

  if (invite === undefined) return <p className="container page loading serif">초대장을 펼치는 중이에요…</p>
  if (!invite) {
    return (
      <section className="container page empty-state">
        <p className="eyebrow en">TANGLED LINE</p>
        <h1>초대장을 찾지 못했어요</h1>
        <p className="muted">{err || '링크가 잘렸거나, 모임이 없어졌을 수 있어요.'}</p>
        <Link to="/" className="btn btn-primary">그려봄 둘러보기</Link>
      </section>
    )
  }

  return (
    <section className="container page auth-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">YOU&apos;RE INVITED</p>
          <h1 className="page-title">‘{invite.name}’에 초대받았어요</h1>
          <p className="muted">
            {invite.preset ? `함께 그릴 시간 · ${presetLabel(invite.preset)}` : '서로의 선을 판단하지 않고 바라보는 모임이에요.'}
          </p>
          {invite.intro && <p className="group-intro">{invite.intro}</p>}
        </div>
      </header>

      {invite.joined ? (
        <div className="card form-card auth-card center">
          <p className="serif big">이미 함께하고 있는 모임이에요.</p>
          <Link to={`/groups/${invite.id}`} className="btn btn-primary btn-block">모임으로 가기</Link>
        </div>
      ) : user ? (
        <div className="card form-card auth-card center">
          <p className="serif big">{user.nickname}님으로 들어갈까요?</p>
          {err && <p className="alert" role="alert">{err}</p>}
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => enter()}>
            {busy ? '잠시만요…' : '모임에 들어가기'}
          </button>
        </div>
      ) : (
        <form className="card form-card auth-card" onSubmit={enter}>
          <p className="muted small">
            처음이면 여기서 바로 가입돼요.
            <br />
            전에 그려봄을 썼다면 그 계정으로 이어서 들어가요.
          </p>
          <label className="field">
            <span className="field-label">이름</span>
            <input name="name" autoComplete="name" value={form.name} maxLength={20} onChange={(e) => set({ name: e.target.value })} required />
          </label>
          <BirthField value={form.birth} onChange={(birth) => set({ birth })} />
          <label className="field">
            <span className="field-label">별명</span>
            <input name="nickname" value={form.nickname} maxLength={12} onChange={(e) => set({ nickname: e.target.value })} required />
            <small className="muted">모임에서는 별명만 보여요. 이미 계정이 있으면 원래 별명 그대로예요.</small>
          </label>
          {young && <GuardianFields value={guardian} onChange={setGuardian} />}
          <label className="check agree">
            <input type="checkbox" checked={form.agree} onChange={(e) => set({ agree: e.target.checked })} required />
            <span>
              <Link to="/terms" target="_blank">이용약관</Link>과 <Link to="/privacy" target="_blank">개인정보 처리방침</Link>을 읽고 동의해요.
              <small className="muted agree-sub">만 14세 미만이라면 보호자와 함께 읽어 주세요.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />
            <span>
              로그인 유지 <small className="muted">· 공용 PC에서는 꺼 두세요</small>
            </span>
          </label>
          {err && <p className="alert" role="alert">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? '잠시만요…' : '가입하고 모임에 들어가기'}
          </button>
          <ul className="join-notes muted small">
            <li>다음에도 같은 이름과 생년월일로 로그인하면 이어서 써요.</li>
            <li>이름과 생년월일은 본인 확인에만 쓰고, 그대로 저장하지 않아요.</li>
          </ul>
        </form>
      )}
    </section>
  )
}
