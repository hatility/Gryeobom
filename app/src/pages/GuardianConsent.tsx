import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'

/** 실험: 보호자 동의 확인 (/guardian/:token) — 로그인 없이, 아이가 보낸 링크로 연다 */
export default function GuardianConsent() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.guardianLink>> | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.guardianLink(token).then(setInfo, (e) => { setInfo(null); setErr(e.message) })
  }, [token])
  const go = async () => {
    setBusy(true)
    setErr('')
    try {
      await api.guardianAgree(token)
      setInfo((i) => (i ? { ...i, confirmed: true } : i))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '잠시 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }
  if (info === undefined) return <p className="container page loading serif">불러오는 중이에요…</p>
  return (
    <section className="container page guardian-page">
      <div className="card form-card">
        <h1 className="page-title">보호자 동의 확인</h1>
        {!info ? (
          <p className="alert" role="alert">{err}</p>
        ) : info.confirmed ? (
          <>
            <p className="serif big">고마워요. 동의가 확인됐어요.</p>
            <p className="muted">‘{info.nickname}’ 님은 이제 그려봄을 이어서 쓸 수 있어요. 언제든 운영 기관 문의처로 열람 · 정정 · 삭제를 요청할 수 있어요.</p>
          </>
        ) : (
          <>
            <p>‘<strong>{info.nickname}</strong>’ 님이 그려봄에 가입하면서 {info.relation}의 동의를 부탁했어요. 그려봄은 지나온 시간을 인생 그래프로 그리고 돌아보는 청소년 프로그램이에요.</p>
            <ul className="muted small">
              <li>이름 · 생년월일은 저장하지 않고, 로그인 확인용 변환값만 둬요.</li>
              <li>그래프 · 회고는 기본이 ‘나만 보기’ 이고, 아이가 고를 때만 모임 · 링크로 나눠요. 회고는 어디에도 나가지 않아요.</li>
              <li>보호자 연락처는 동의 확인에만 쓰고, 다른 회원에게 보이지 않아요.</li>
            </ul>
            <p className="small">자세한 내용: <Link to="/terms" target="_blank">이용약관</Link> · <Link to="/privacy" target="_blank">개인정보 처리방침</Link></p>
            <label className="check agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>보호자로서 이용약관과 개인정보 처리방침을 읽고, 아이의 가입과 개인정보 처리에 동의해요.</span>
            </label>
            {err && <p className="alert" role="alert">{err}</p>}
            <button type="button" className="btn btn-primary" disabled={!agree || busy} onClick={go}>{busy ? '확인하는 중…' : '동의해요'}</button>
          </>
        )}
      </div>
    </section>
  )
}
