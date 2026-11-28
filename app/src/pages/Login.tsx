import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useNavigate } from '../nav'
import { ApiError, api } from '../api'
import { useAuth } from '../auth'

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
        placeholder="예) 2012.03.15"
        maxLength={10}
        value={value.replace(/^(\d{4})(\d{1,2})/, '$1.$2').replace(/^(\d{4}\.\d{2})(\d{1,2})/, '$1.$2')}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
        aria-describedby={`${id}-hint`}
        required
      />
      <small id={`${id}-hint`} className={read ? 'field-ok' : 'muted'}>
        {read ? `${read}` : value.length === 8 ? '없는 날짜예요. 한 번 더 확인해 주세요.' : '숫자만 이어서 적으면 점은 저절로 찍혀요'}
      </small>
    </div>
  )
}

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [form, setForm] = useState({ name: '', birth: '', nickname: '', remember: false, agree: false, age14: false })
  const [err, setErr] = useState('')
  const [dup, setDup] = useState(false) // 같은 이름 · 생일 계정이 이미 있음
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
    setBusy(true)
    setErr('')
    try {
      const u = mode === 'login' ? await api.login(form) : await api.signup(form)
      setUser(u)
      navigate(next)
    } catch (e) {
      setDup(e instanceof ApiError && e.status === 409)
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
        {mode === 'signup' && (
          <label className="check agree">
            <input type="checkbox" checked={form.agree} onChange={(e) => set({ agree: e.target.checked })} required />
            <span>
              <Link to="/terms" target="_blank">이용약관</Link>과 <Link to="/privacy" target="_blank">개인정보 처리방침</Link>을 읽고 동의해요.
            </span>
          </label>
        )}
        {mode === 'signup' && (
          <label className="check agree">
            <input type="checkbox" checked={form.age14} onChange={(e) => set({ age14: e.target.checked })} required />
            <span>저는 만 14세 이상이에요.</span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />
          <span>
            로그인 유지 <small className="muted">· 공용 PC에서는 꺼 두세요</small>
          </span>
        </label>
        {err && (
          <p className="alert" role="alert">
            {err}
            {dup && mode === 'signup' && <> <button type="button" className="btn btn-text btn-sm" onClick={() => { setMode('login'); setErr(''); setDup(false) }}>같은 이름 · 생일로 로그인하기</button></>}
          </p>
        )}
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
