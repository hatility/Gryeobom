import { defineConfig } from '@playwright/test'

// 화면 끝까지 따라가 보는 자동 테스트 (npm run test:e2e).
// 브라우저는 이 컴퓨터에 깔린 Chrome 을 쓴다 (따로 내려받지 않음). 서버 · 화면은 시험용 DB 로 새로 띄운다.
const API = 3311
const WEB = 5288

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB}`,
    channel: 'chrome',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // 시험용 DB 는 매번 새로 (개발용 data/dev.db 는 건드리지 않는다)
      command: `rm -f ./data/e2e.db ./data/e2e.db-wal ./data/e2e.db-shm && DB_FILE=./data/e2e.db COOKIE_SECURE=false DEV_SERVER=true ADMIN_ID=admin ADMIN_PASSWORD=e2e-admin-password-1234 PORT=${API} node server/index.ts`,
      port: API,
      reuseExistingServer: false,
    },
    {
      command: `API_PORT=${API} npx vite --port ${WEB} --strictPort`,
      port: WEB,
      reuseExistingServer: false,
    },
  ],
})
