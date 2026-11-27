// 검색 엔진용 미리 그린 HTML (1.3.0): dist/ 를 잠깐 띄워 공개 화면을 브라우저로 열고, 그려진 HTML 을 dist/prerender/<주소>/index.html 로 남긴다.
// nginx 가 그 주소에서는 이 파일을 먼저 준다 (네이버 · 다음처럼 자바스크립트를 덜 읽는 검색 엔진도 글을 본다). 실패해도 빌드는 계속 (경고만).
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const ROUTES = ['/', '/welcome', '/activities', '/guide', '/example', '/share', '/credits', '/terms', '/privacy', '/contact', '/worksheet']
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' }

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  if (path.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{}') }
  let file = join(dist, path)
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

let made = 0
try {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  for (const route of ROUTES) {
    await page.goto(base + route, { waitUntil: 'networkidle' })
    await page.waitForSelector('main h1', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(300)
    // 미리 그린 표시 + 불러오는 중 글은 두지 않는다
    // 그릴 때 쓴 임시 주소(127.0.0.1:포트)는 __SITE__ 로 — nginx 가 접속한 주소로 바꿔 준다 (canonical 등)
    const html = (await page.content()).replace('<html', '<html data-prerendered="1"').replaceAll(base, '__SITE__')
    const out = join(dist, 'prerender', route === '/' ? '' : route.slice(1), 'index.html')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, html)
    made++
  }
  await browser.close()
  console.log(`✓ 미리 그린 화면 ${made}곳 → dist/prerender/`)
} catch (e) {
  console.warn('! 미리 그리기를 건너뜀 (검색 엔진용 HTML 없이 배포돼요):', e?.message ?? e)
} finally {
  server.close()
}
