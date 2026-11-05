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

// ── release/ 최상위: 전체 변경 기록 · 버전 목록 · .gitignore ──
writeFileSync(new URL('CHANGELOG.md', release), changelog)
writeFileSync(new URL('.gitignore', release), '.env\n.DS_Store\n')
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

| 버전 | 날짜 | 구성 | 요약 |
|---|---|---|---|
${rows.join('\n')}

> \`.env\` 에는 관리자 비밀번호 같은 값이 들어가므로 저장소에 올리지 않습니다 (\`.gitignore\`).
`,
)
console.log(`✓ release v${version}:`, fileURLToPath(dir))
