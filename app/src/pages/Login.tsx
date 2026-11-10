import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, type Guardian } from '../api'
import { useAuth } from '../auth'
import { useLabs } from '../labs'

/** 생년월일 8자리 → 오늘 만 나이 (모르면 null) */
export function ageFrom(b: string): number | null {
  if (!readBirth(b)) return null
  const t = new Date()
  const today = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
  return +today.slice(0, 4) - +b.slice(0, 4) - (today.slice(4) < b.slice(4) ? 1 : 0)
}
export const GUARDIAN_EMPTY: Guardian = { relation: '부모님', contact: '', agreed: false }
/** 만 14세 미만 가입: 보호자 관계 · 연락처 · 함께 읽고 동의 (실험) */
export function GuardianFields({ value, onChange }: { value: Guardian; onChange: (g: Guardian) => void }) {
  const set = (p: Partial<Guardian>) => onChange({ ...value, ...p })
  return (
    <fieldset className="field guardian-box">
      <legend className="guardian-title"><span className="guardian-tag">만 14세 미만</span>보호자의 동의가 필요해요</legend>
      <p className="muted small guardian-sub">보호자와 함께 적어 주세요. 연락처는 동의를 확인할 때만 쓰고, 다른 곳에 보이지 않아요.</p>
      <div className="field-row">
        <label className="field">
          <span className="field-label">보호자</span>
          <select value={value.relation} onChange={(e) => set({ relation: e.target.value })}>
            {['부모님', '보호자', '기관 담당 선생님'].map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">보호자 연락처</span>
          <input value={value.contact} maxLength={80} inputMode="email" placeholder="휴대폰 번호 또는 이메일" onChange={(e) => set({ contact: e.target.value })} required />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={value.agreed} onChange={(e) => set({ agreed: e.target.checked })} required />
        <span>보호자가 이용약관 · 개인정보 처리방침을 함께 읽고 가입에 동의했어요.</span>
      </label>
    </fieldset>
  )
}

/** 20120315 → '2012년 3월 15일' (실제 있는 날짜일 때만) */
export function readBirth(s: string): string {
  if (!/^\d{8}$/.test(s)) return ''
  const [y, m, d] = [+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)]
  const date = new Date(y, m - 1, d)
  return date.getMonth() === m - 1 && date.getDate() === d ? `${y}년 ${m}월 ${d}일` : ''
}

export function BirthField({ value, onChange, id = 'birth' }: { value: string; onChange: (v: string) => void; id?: string }) {
  const read = readBirth(value)
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>생년월일 8자리</label>
      <input
        id={id}
        name="birth"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="예) 20120315"
        maxLength={8}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
        aria-describedby={`${id}-hint`}
        required
      />
      <small id={`${id}-hint`} className={read ? 'field-ok' : 'muted'}>
        {read ? `${read}` : value.length === 8 ? '없는 날짜예요. 한 번 더 확인해 주세요.' : '연도 4자리 · 월 2자리 · 일 2자리'}
      </small>
    </div>
  )
}

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [form, setForm] = useState({ name: '', birth: '', nickname: '', remember: false, agree: false })
  const [guardian, setGuardian] = useState<Guardian>(GUARDIAN_EMPTY)
  const labs = useLabs('guardian')
  const young = labs && mode === 'signup' && (ageFrom(form.birth) ?? 99) < 14
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // 다른 사이트로 튕겨 나가지 않도록 내부 경로만 허용
  const raw = params.get('next') ?? ''
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/my'
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!readBirth(form.birth)) return setErr('생년월일을 8자리로 확인해 주세요. 예) 20120315')
    if (mode === 'signup' && !form.agree) return setErr('이용약관과 개인정보 처리방침에 동의해 주세요.')
    if (young && (!guardian.agreed || !guardian.contact.trim())) return setErr('만 14세 미만은 보호자의 동의가 필요해요. 보호자와 함께 적어 주세요.')
    setBusy(true)
    setErr('')
    try {
      const u = mode === 'login' ? await api.login(form) : await api.signup(young ? { ...form, guardian } : form)
      setUser(u)
      navigate(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }

  if (user) {
    return (
      <section className="container page empty-state">
        <p className="serif big">{user.nickname}님, 반가워요.</p>
        <Link to="/my" className="btn btn-primary">내 기록 보러 가기</Link>
      </section>
    )
  }

  return (
    <section className="container page auth-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">{mode === 'login' ? 'WELCOME BACK' : 'NICE TO MEET YOU'}</p>
          <h1 className="page-title">{mode === 'login' ? '다시 만나서 반가워요' : '처음 오셨군요'}</h1>
          <p className="muted">다른 기기에서도 이어 그릴 수 있어요.</p>
        </div>
      </header>

      <form className="card form-card auth-card" onSubmit={submit}>
        <div className="segmented" aria-label="로그인 또는 처음 시작">
          {(['login', 'signup'] as const).map((m) => (
            <label key={m} className="seg">
              <input type="radio" name="mode" checked={mode === m} onChange={() => { setMode(m); setErr('') }} />
              <span>{m === 'login' ? '로그인' : '처음이에요'}</span>
            </label>
          ))}
        </div>

        <label className="field">
          <span className="field-label">이름</span>
          <input name="name" autoComplete="name" value={form.name} maxLength={20} onChange={(e) => set({ name: e.target.value })} required />
        </label>
        <BirthField value={form.birth} onChange={(birth) => set({ birth })} />
        {mode === 'signup' && (
          <label className="field">
            <span className="field-label">별명</span>
            <input name="nickname" value={form.nickname} maxLength={12} onChange={(e) => set({ nickname: e.target.value })} required />
            <small className="muted">모임에서는 별명만 보여요.</small>
          </label>
        )}
        {young && <GuardianFields value={guardian} onChange={setGuardian} />}
        {mode === 'signup' && (
          <label className="check agree">
            <input type="checkbox" checked={form.agree} onChange={(e) => set({ agree: e.target.checked })} required />
            <span>
              <Link to="/terms" target="_blank">이용약관</Link>과 <Link to="/privacy" target="_blank">개인정보 처리방침</Link>을 읽고 동의해요.
              <small className="muted agree-sub">만 14세 미만이라면 보호자와 함께 읽어 주세요.</small>
            </span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />
          <span>
            로그인 유지 <small className="muted">· 공용 PC에서는 꺼 두세요</small>
          </span>
        </label>
        {err && <p className="alert" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '잠시만요…' : mode === 'login' ? '로그인' : '시작하기'}
        </button>
        <p className="muted small center">
          <span className="line">이름 · 생일은 확인에만 쓰고 저장하지 않아요.</span>
          <span className="line">로그인 없이도 이 기기에서 그릴 수 있어요.</span>
        </p>
      </form>
    </section>
  )
}
