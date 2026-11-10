import { chownSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { createApp } from './app.ts'
import { readConfig } from './config.ts'
import { backupKeepOf, maintain, openDb } from './db.ts'

const config = readConfig(process.env)
for (const w of config.warnings) console.warn(`[설정] ${w}`)
console.log(`[설정] 관리자 ${config.admin ? '켜짐' : '꺼짐'} · 공유 주소 ${config.publicUrl ?? '(접속한 주소 그대로)'}`)

mkdirSync(dirname(config.dbFile), { recursive: true })
const autoDir = config.autoBackupDir || join(dirname(config.dbFile), 'backups')
mkdirSync(autoDir, { recursive: true })
// 컨테이너가 root 로 켜졌다면(RUN_AS=1000:1000): 데이터 · 백업 폴더를 그 사용자에게 맡기고 바로 그 사용자로 내려간다.
// 그려봄 폴더의 backups 처럼 밖에서 이어 붙인 폴더는 root 것이라 node 사용자가 쓰지 못하기 때문
const runAs = process.env.RUN_AS?.match(/^(\d+):(\d+)$/)
if (runAs && process.getuid?.() === 0) {
  const [uid, gid] = [Number(runAs[1]), Number(runAs[2])]
  for (const d of [dirname(config.dbFile), autoDir]) {
    try { chownSync(d, uid, gid) } catch (e) { console.warn(`[설정] ${d} 의 주인을 바꾸지 못했어요`, e) }
  }
  process.setgid!(gid)
  process.setuid!(uid)
}
const db = openDb(config.dbFile)
const dataDir = dirname(config.dbFile)
createServer(createApp(db, { ...config, backupDir: dataDir, autoBackupDir: autoDir })).listen(config.port, () => console.log(`geuryeobom api listening on :${config.port}`))

// 컨테이너에서 PID 1이면 SIGTERM을 직접 받아야 docker stop이 바로 끝난다.
// DB를 닫아야 WAL 내용이 본 파일에 합쳐져서, 볼륨의 .db 파일 하나만 백업해도 된다.
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    db.close()
    process.exit(0)
  })

// 손질 + 자동 백업 (시작 1분 뒤 한 번, 그다음 한 시간마다 — 같은 시간 백업은 하나만, 최근 BACKUP_KEEP 개)
const tidy = () => {
  try {
    const f = maintain(db, autoDir, backupKeepOf(db, config.backupKeep))
    if (f) console.log(`[손질] 자동 백업 ${f}`)
  } catch (e) {
    console.error('[손질] 실패', e)
  }
}
setTimeout(tidy, 60_000).unref()
setInterval(tidy, 3600_000).unref()
