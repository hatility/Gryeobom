import { useEffect, useState } from 'react'
import { api, shareBase } from '../api'
import { useAuth } from '../auth'
import { useLabs } from '../labs'

/** 실험: 만 14세 미만 — 보호자에게 보낼 확인 링크 (확인되면 사라진다) */
export default function GuardianNotice() {
  const labs = useLabs('guardian')
  const { user } = useAuth()
  const [link, setLink] = useState('')
  const [relation, setRelation] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!labs || !user) return
    api.myGuardian().then(async (g) => {
      if (g.needed && !g.confirmed && g.token) {
        setRelation(g.relation ?? '보호자')
        setLink(`${await shareBase()}/guardian/${g.token}`)
      }
    }, () => {})
  }, [labs, user])
  if (!link) return null
  const send = async () => {
    const text = `그려봄 가입 동의를 부탁드려요. 아래 링크를 열어 확인해 주세요.\n${link}`
    if (navigator.share) {
      await navigator.share({ title: '그려봄 보호자 동의', text }).catch(() => {})
      return
    }
    await navigator.clipboard?.writeText(link).catch(() => {})
    setCopied(true)
  }
  return (
    <div className="guardian-notice" role="status">
      <p><strong>보호자 확인을 기다리고 있어요.</strong> 아래 링크를 {relation}께 보내 동의를 받아 주세요.</p>
      <p className="guardian-link"><code>{link}</code></p>
      <button type="button" className="btn btn-primary btn-sm" onClick={send}>{copied ? '복사했어요' : '링크 보내기 · 복사'}</button>
    </div>
  )
}
