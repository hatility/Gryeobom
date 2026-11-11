# 그려봄 — 소스 (app)

지나온 나를 그리고, 지금의 나를 만나다. — 청소년 자기이해 · 감정 회고 인생 그래프 웹앱 (v1.1.1)

서비스 소개 · 설치는 저장소 맨 위 [README](../README.md) 와 [사용 설명서](../docs/GUIDE.md) 에 있어요. 여기는 **고치고 만드는 사람**을 위한 안내예요.

## 실행 (개발)

| 목적 | 명령 |
|---|---|
| 설치 | `npm install` |
| API 개발 서버 | `npm run dev:api` → http://localhost:3001 (`data/dev.db`, `DEV_SERVER=true` 라 실험 기능이 모두 켜져요) |
| 화면 개발 서버 | `npm run dev` → http://localhost:5173 (`/api` 는 3001 로) · 휴대폰 화면은 `/m` |
| 관리자 화면 | `ADMIN_ID=admin ADMIN_PASSWORD=12자이상비밀번호 npm run dev:api` 로 띄운 뒤 `/admin` |
| 테스트 | `npm test` (서버 · 화면 로직 94개) · `npm run test:e2e` (브라우저 흐름, Playwright) |
| 빌드 | `npm run build` (타입 검사 → 화면 → 오픈소스 고지 확인 → 서버 번들) |
| 배포 묶음 | `npm run release` → `../release/v<버전>/` 정식 묶음 + `../release/개발용/v<버전>-dev/` (이미 있는 버전은 `-- --force`) |

## 버전 올리기

1. `package.json` 의 `version` 을 올려요 (기능 `1.x.0`, 고침 `1.x.y`).
2. `CHANGELOG.md` 맨 위에 `## [새 버전] - 날짜` 와 바뀐 것을 적어요. 없으면 릴리스가 멈춰요.
3. 화면 · 데이터를 다루는 방식이 바뀌면 `src/pages/Legal.tsx` 의 약관 · 처리방침과 `POLICY_DATE` 를 함께 고쳐요.
4. `npm run release`

> **DB 는 앞으로만 올라가요.** 새 칸 · 표는 `server/db.ts` 에서 처음 시작할 때 저절로 더해져요. 새 버전이 연 DB 를 예전 버전으로 열면 깨질 수 있으니, INSERT 는 늘 **칸 이름을 적어서** 쓰고(`INSERT INTO t (a, b) VALUES (?, ?)`), 되돌릴 땐 백업으로 복원해요.

## 실험 기능 스위치

`src/flags.ts` 의 묶음마다 서버는 `labs(key)`, 화면은 `useLabs(key)` 로 확인해요.

- 1.1.0 에서 `graph · group · org · me · ops` 는 **정식**(`official: true`) — 늘 켜져요.
- `guardian`(만 14세 미만 보호자 동의)만 관리자 **설정 → 실험 기능 스위치** 에서 켜요.
- 개발 테스트 서버(`DEV_SERVER=true`)는 모두 켜져 있어요.

## 안전 설계 (요약)

- **계정**: 이름 + 생년월일 8자리. 서버에는 원문 없이 HMAC 지문만(`AUTH_SECRET`). 같은 이름 · IP 의 실패 횟수 제한.
- **세션**: 기본은 브라우저를 닫으면 끝, ‘로그인 유지’ 때만 30일. HttpOnly · SameSite=Lax 쿠키, 변경 요청은 앱 전용 헤더 + JSON 만.
- **회고는 밖으로 나가지 않아요**: 공유 링크 · 모임에는 공개용 데이터만 (서버에서 다시 거름).
- **비교하지 않아요**: 응원은 정해진 네 마디, 받은 수는 그린 사람만. 모임 · 기관 리포트는 누구인지 드러나지 않는 통계만.
- **기관 등록**: 등록 안내 동의(`agree`) 필수, 보호자 기록이 있는 계정(만 14세 미만)은 막아요.
- **운영자**: 관리자 로그인 기록(IP), 신고 기록 지울 때 까닭, 열람 전용 관리자 계정.

## 구조

```
src/
├── App.tsx · main.tsx      라우팅 · 머리 · 바닥 · 알림 · PC / 모바일(/m) 나누기
├── mobile.tsx              모바일 첫 화면 · 탭바 · ‘나’ 화면
├── api.ts                  서버 API · 내 계정 저장소 · 인터넷 없이 쓰기(보낼 것 모아 두기)
├── auth.tsx · labs.ts      로그인 상태 · 실험 기능 확인
├── flags.ts                실험 기능 묶음 (정식 표시)
├── types.ts · content.ts   데이터 모양 · 질문 · 시간 표시(나이 · 연도 · 달 · 시각) · 진행안
├── store.ts · share.ts     이 기기 저장소 · 공유 데이터 만들기 + 검증 (서버와 같이 씀)
├── graph.ts                좌표 · 곡선 · 시각 눈금 · 이미지 카드
├── devlog.ts               관리자 ‘변경 내역’ 탭의 확인 목록
├── components/             LifeGraph(SVG 그래프) · HourRange(날짜 · 시각) · QrCode · ViewSettings …
└── pages/                  Home · GraphEditor(4단계) · GraphResult · GraphBook · MyGraphs · YearReview ·
                            Share · GroupPage · GroupPresent · OrgReport · Contact · AdminPage · Legal …
server/
├── index.ts                진입점 (환경변수 · 시간마다 정리 · 자동 백업)
├── config.ts               .env 읽고 검증
├── app.ts                  API 전체
├── db.ts                   SQLite 스키마 · 칸 더하기 · 백업
└── app.test.ts             API 테스트 (권한 · 회고 차단 · 실험 기능 · 다른 버전 DB)
e2e/                        브라우저 흐름 테스트
deploy/                     배포 템플릿 (nginx · Dockerfile · .env.example · backup.sh · restore.sh)
scripts/                    release.mjs(배포 묶음) · licenses.mjs(오픈소스 고지 · 원문 대조)
```
