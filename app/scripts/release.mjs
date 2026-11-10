// release/v<버전>/ 에 배포용 Docker 묶음을 만듭니다. 소스 · node_modules 는 넣지 않습니다.
// 이전 버전 폴더는 그대로 두고, 버전 목록(README.md) · CHANGELOG.md · .gitignore 를 갱신합니다.
//   v<버전>/README.md · CHANGES.md · .env.example · docker-compose.yml
//   v<버전>/web/   nginx: Dockerfile · nginx.conf · html/
//   v<버전>/api/   Node 24: Dockerfile · server.js(번들 1개)
// 이미 있는 버전은 덮어쓰지 않습니다. 꼭 다시 만들어야 하면: node scripts/release.mjs --force
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p) => new URL(p, import.meta.url)
const { version } = JSON.parse(readFileSync(at('../package.json'), 'utf8'))
const release = at('../../release/')
const dir = new URL(`v${version}/`, release)
const out = (p) => new URL(p, dir)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const changelog = readFileSync(at('../CHANGELOG.md'), 'utf8')
/** CHANGELOG 에서 한 버전의 내용만 잘라낸다 */
const section = (v) => {
  const rest = changelog.slice(changelog.indexOf(`## [${v}]`))
  const end = rest.search(/\n---\n|\n## \[/)
  return (end > 0 ? rest.slice(0, end) : rest).trim()
}

if (!changelog.includes(`## [${version}]`)) fail(`CHANGELOG.md 에 ## [${version}] 변경 내용을 먼저 적어 주세요.`)
if (existsSync(dir) && !process.argv.includes('--force')) {
  fail(`v${version} 은 이미 릴리스돼 있어요. package.json 버전을 올리거나, 꼭 다시 만들려면 --force 를 붙여 주세요.`)
}

rmSync(dir, { recursive: true, force: true })
mkdirSync(out('web/'), { recursive: true })
mkdirSync(out('api/'), { recursive: true })

const tpl = (p) => readFileSync(at(`../deploy/${p}`), 'utf8').replaceAll('__VERSION__', version)
cpSync(at('../dist/'), out('web/html/'), { recursive: true })
cpSync(at('../deploy/nginx.conf'), out('web/nginx.conf'))
cpSync(at('../deploy/web.Dockerfile'), out('web/Dockerfile'))
cpSync(at('../deploy/real-ip.sh'), out('web/real-ip.sh'))
cpSync(at('../dist-server/index.js'), out('api/server.js'))
cpSync(at('../deploy/api.Dockerfile'), out('api/Dockerfile'))
cpSync(at('../deploy/.env.example'), out('.env.example'))
cpSync(at('../deploy/backup.sh'), out('backup.sh'))
cpSync(at('../deploy/restore.sh'), out('restore.sh'))
cpSync(at('../../LICENSE'), out('LICENSE'))
cpSync(at('../../NOTICE.md'), out('NOTICE.md'))
writeFileSync(out('docker-compose.yml'), tpl('docker-compose.yml'))
writeFileSync(out('README.md'), tpl('README.release.md'))
writeFileSync(out('CHANGES.md'), `# 그려봄 v${version} 변경 내용\n\n${section(version).replace(/^## .*\n+/, '')}\n`)

// ── 개발 테스트용 묶음: release/개발용/v<버전>-dev/ ──
// 정식 묶음과 같은 화면 · 서버에, DB 볼륨 · 컨테이너 · 이미지 · 기본 포트를 따로 쓰고 DEV_SERVER=true (DB 초기화 · ‘개발 테스트 서버’ 표시)
const devRoot = new URL('개발용/', release)
const devDir = new URL(`v${version}-dev/`, devRoot)
rmSync(devDir, { recursive: true, force: true })
mkdirSync(devRoot, { recursive: true })
cpSync(dir, devDir, { recursive: true })
const dev = (p, fn) => {
  const f = new URL(p, devDir)
  writeFileSync(f, fn(readFileSync(f, 'utf8').replaceAll('geuryeobom-data', 'geuryeobom-dev-data')))
}
const DEV_NOTE = `> ⚠ **개발 테스트용 묶음**이에요. 정식 운영에는 \`배포/v${version}/\` 를 쓰세요.\n> DB 볼륨(\`geuryeobom-dev-data\`) · 컨테이너 · 기본 포트(8090)가 정식과 따로라 같은 서버에 함께 띄워도 섞이지 않아요.\n> 관리자 화면에 **DB 초기화**가 있고, 화면 구석에 ‘개발 테스트 서버’ 표시가 떠요.\n> **실험 기능**(만 14세 미만 보호자 동의 · 내 기록 내려받기 · 여러 모임 한 번에 · 리포트 인쇄 · 기간별 통계 · 홈 화면 설치 · 카드 배경 · 질문 묶음 · 모임 소식 · 활동 일정 · 종이 활동지 · 관리자 활동 기록 · 마음 단어 · 기관 담당자 · 출석 · 모임 복제 · 단어 카드 · 휴면 계정 · 최근 오류 · 그 밖에 관리자 ‘변경 내역’ 의 실험 기능 모두)도 여기서만 켜져요.\n\n`
dev('docker-compose.yml', (s) =>
  `# ⚠ 개발 테스트용 — 정식과 DB 볼륨 · 컨테이너 · 포트가 따로예요\nname: geuryeobom-dev\n` +
  s.replace(/geuryeobom-(web|api):/g, 'geuryeobom-dev-$1:')
    .replace('"${PORT:-80}:80"', '"${PORT:-8090}:80"')
    .replace(/(\n\s+COOKIE_SECURE: [^\n]+)/, '$1\n      DEV_SERVER: "true"')
    // 실험: 헬스체크가 DB · 디스크까지 본다 (/api/health 는 개발 테스트 서버에만 있다)
    .replace("http://127.0.0.1:3000/api/me", "http://127.0.0.1:3000/api/health"))
// 실험: 보안 정책(CSP) 위반을 브라우저가 서버로 알린다 (관리자 ‘최근 오류’ 아래)
dev('web/nginx.conf', (s) => s.replace(`form-action 'self'"`, `form-action 'self'; report-uri /api/csp-report"`))
if (!readFileSync(new URL('web/nginx.conf', devDir), 'utf8').includes('report-uri /api/csp-report')) fail('개발용 nginx.conf 에 report-uri 를 넣지 못했어요.')
if (!readFileSync(new URL('docker-compose.yml', devDir), 'utf8').includes('/api/health')) fail('개발용 헬스체크를 바꾸지 못했어요.')
dev('backup.sh', (s) => s)
dev('restore.sh', (s) => s)
dev('README.md', (s) => s.replace(/^(# [^\n]*\n)/, `$1\n${DEV_NOTE}`))
dev('.env.example', (s) => `# ⚠ 개발 테스트용 묶음의 설정이에요. 정식 서버의 .env 를 그대로 옮기지 말고 따로 정해 주세요.\n#   (AUTH_SECRET · 관리자 비밀번호도 정식과 다르게) · 기본 포트는 8090 이에요.\n\n${s}`)
if (!readFileSync(new URL('docker-compose.yml', devDir), 'utf8').includes('DEV_SERVER: "true"')) fail('개발용 docker-compose.yml 에 DEV_SERVER 를 넣지 못했어요.')

// ── release/ 최상위: 전체 변경 기록 · 버전 목록 · .gitignore ──
writeFileSync(new URL('CHANGELOG.md', release), changelog)
writeFileSync(new URL('.gitignore', release), '.env\n.DS_Store\nbackups/\n*.db\n')
const versions = readdirSync(release)
  .filter((d) => /^v\d+\.\d+\.\d+$/.test(d))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
const rows = versions.map((d) => {
  const v = d.slice(1)
  const head = changelog.match(new RegExp(`^## \\[${v.replace(/\./g, '\\.')}\\] - (\\S+)\\n\\n([^#\\n].*)?`, 'm'))
  const kind = existsSync(new URL(`${d}/api/`, release)) ? '화면 + 서버' : '화면만'
  return `| [${d}](${d}/) | ${head?.[1] ?? ''} | ${kind} | ${head?.[2] ?? ''} |`
})
writeFileSync(
  new URL('README.md', release),
  `# 그려봄 릴리스

> 지나온 나를 그리고, 지금의 나를 만나다. — 9~24세 청소년 자기이해 · 감정 회고 인생 그래프

버전마다 폴더가 하나씩 있고(0.x 묶음은 \`지난 버전/\` 에 보관 — 운영에는 쓰지 마세요), 최신 폴더만 서버에 복사해
\`docker compose up -d --build\` 로 실행합니다. 각 폴더의 \`README.md\` 에 실행 방법, \`CHANGES.md\` 에 그 버전의 변경 내용이 있습니다.

**최신: [${versions[0]}](${versions[0]}/)** · 전체 변경 기록: [CHANGELOG.md](CHANGELOG.md)

> 🧪 개발 테스트 서버에는 \`개발용/v<버전>-dev/\` 를 쓰세요 — DB 볼륨(\`geuryeobom-dev-data\`) · 컨테이너 · 포트(8090)가 정식과 따로이고, DB 초기화가 켜져 있어요. 정식 서버에는 올리지 마세요.

| 버전 | 날짜 | 구성 | 요약 |
|---|---|---|---|
${rows.join('\n')}

> \`.env\` 에는 관리자 비밀번호 같은 값이 들어가므로 저장소에 올리지 않습니다 (\`.gitignore\`).
`,
)
console.log(`✓ release v${version}:`, fileURLToPath(dir))
console.log(`✓ 개발용 v${version}-dev:`, fileURLToPath(devDir))
