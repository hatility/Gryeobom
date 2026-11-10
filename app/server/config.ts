import type { AppOptions } from './app.ts'

export interface Config extends AppOptions {
  dbFile: string
  port: number
  /** 자동 백업을 남길 개수 (한 시간에 하나, 0 이면 끔. 기본 168 = 7일) */
  backupKeep: number
  warnings: string[]
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 80
/** http(s) 주소면 정리한 주소, 아니면 null */
export function httpUrl(s: string): string | null {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** 환경변수(.env)를 읽어 검증한다. 잘못된 값은 끄고 경고를 남긴다(서버는 계속 뜬다). */
export function readConfig(env: Record<string, string | undefined>): Config {
  const warnings: string[] = []
  const v = (k: string) => env[k]?.trim() || ''

  let admin: Config['admin'] = null
  const id = v('ADMIN_ID')
  const password = env.ADMIN_PASSWORD ?? ''
  if (id || password) {
    if (!id || !password) warnings.push('ADMIN_ID 와 ADMIN_PASSWORD 를 둘 다 정해야 관리자 기능이 켜져요.')
    else if (password.length < 12) warnings.push('ADMIN_PASSWORD 는 12자 이상이어야 해요. 관리자 기능을 꺼 둘게요.')
    else admin = { id, password }
  }

  let publicUrl: string | null = null
  if (v('PUBLIC_URL')) {
    try {
      const u = new URL(v('PUBLIC_URL'))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
      publicUrl = `${u.origin}${u.pathname}`.replace(/\/+$/, '')
      if (u.protocol === 'http:') warnings.push('PUBLIC_URL 이 http 예요. 정식 운영에서는 https 주소를 써 주세요.')
    } catch {
      warnings.push(`PUBLIC_URL 형식이 올바르지 않아요: ${v('PUBLIC_URL')} (예: https://geuryeobom.kr)`)
    }
  }

  // 만든 사람 정보: 화면에 그대로 보이므로 길이를 자르고, 링크는 http(s) 만
  const link = (k: string) => {
    if (!v(k)) return ''
    const u = httpUrl(v(k))
    if (u) return u
    warnings.push(`${k} 는 https:// 로 시작하는 주소여야 해요.`)
    return ''
  }
  const contact = v('DEV_CONTACT')
  const developer = {
    name: v('DEV_NAME').slice(0, 40),
    org: v('DEV_ORG').slice(0, 60),
    // 연락처: 이메일이면 그대로, 아니면 주소로 검사
    contact: isEmail(contact) ? contact : link('DEV_CONTACT'),
    url: link('DEV_URL'),
  }
  // 개인정보 처리방침 ‘11. 문의처’ 의 이메일
  let privacy = v('PRIVACY_CONTACT')
  if (privacy && !isEmail(privacy)) {
    warnings.push(`PRIVACY_CONTACT 는 이메일 주소여야 해요: ${privacy} (예: privacy@example.kr)`)
    privacy = ''
  }

  const authSecret = v('AUTH_SECRET') || undefined
  if (authSecret && authSecret.length < 32) warnings.push('AUTH_SECRET 은 32자 이상의 무작위 값을 권장해요.')
  // 비워 두면 비밀값이 DB 안에 저장된다 → DB(백업) 파일 하나만 새어도 이름 · 생일을 대입해 알아낼 수 있다
  if (!authSecret) warnings.push('AUTH_SECRET 이 비어 있어 로그인 비밀값을 DB 에 저장해요. DB 백업이 새면 이름 · 생일이 드러날 수 있으니 .env 에 정해 주세요 (openssl rand -hex 32). 이미 운영 중이면 지금 DB 에 있는 값을 그대로 옮겨 적어야 해요.')

  return {
    dbFile: v('DB_FILE') || './data/geuryeobom.db',
    port: Number(v('PORT')) || 3000,
    backupKeep: v('BACKUP_KEEP') === '' ? 168 : Math.max(0, Math.min(2000, Math.floor(Number(v('BACKUP_KEEP')) || 0))),
    // 자동 백업 폴더: 배포 묶음은 그려봄 폴더의 backups 를 /backups 로 이어 둔다
    autoBackupDir: v('BACKUP_DIR') || undefined,
    secureCookie: v('COOKIE_SECURE') !== 'false',
    // 개발 테스트 서버 (개발용 배포 묶음만 true). DB 초기화가 켜지고 화면에 ‘개발 테스트 서버’ 표시가 뜬다
    devServer: v('DEV_SERVER') === 'true',
    authSecret,
    admin,
    publicUrl,
    developer: Object.values(developer).some(Boolean) ? developer : null,
    operator: v('SERVICE_OPERATOR') || privacy ? { name: v('SERVICE_OPERATOR').slice(0, 60), contact: privacy } : null,
    warnings,
  }
}
