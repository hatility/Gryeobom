import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { createApp } from './app.ts'
import { readConfig } from './config.ts'
import { maintain, openDb } from './db.ts'

const config = readConfig(process.env)
for (const w of config.warnings) console.warn(`[설정] ${w}`)
console.log(`[설정] 관리자 ${config.admin ? '켜짐' : '꺼짐'} · 공유 주소 ${config.publicUrl ?? '(접속한 주소 그대로)'}`)

mkdirSync(dirname(config.dbFile), { recursive: true })
const db = openDb(config.dbFile)
const dataDir = dirname(config.dbFile)
createServer(createApp(db, { ...config, backupDir: dataDir })).listen(config.port, () => console.log(`geuryeobom api listening on :${config.port}`))

// 컨테이너에서 PID 1이면 SIGTERM을 직접 받아야 docker stop이 바로 끝난다.
// DB를 닫아야 WAL 내용이 본 파일에 합쳐져서, 볼륨의 .db 파일 하나만 백업해도 된다.
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    db.close()
    process.exit(0)
  })

// 하루 한 번 손질 + 자동 백업 (시작 1분 뒤 한 번, 그다음 6시간마다 확인 — 같은 날 백업은 하나만)
const tidy = () => {
  try {
    const f = maintain(db, dataDir, config.backupKeep)
    if (f) console.log(`[손질] 자동 백업 ${f}`)
  } catch (e) {
    console.error('[손질] 실패', e)
  }
}
setTimeout(tidy, 60_000).unref()
setInterval(tidy, 6 * 3600_000).unref()
