# 그려봄 — 소스 (app)

지나온 나를 그리고, 지금의 나를 만나다. — 청소년 자기이해 · 감정 회고 인생 그래프 웹앱.

```
Gryeobom/
├── app/       ← 소스 · 테스트 · Docker (여기서 개발)
│   └── deploy/    ← 배포용 템플릿 (테스트 Docker도 같은 nginx.conf 사용)
└── docs/      ← 사용 설명서 · 화면
```

`npm run release` 를 하면 저장소 바깥 `../release/v<버전>/` 에 배포 묶음이 생겨요 (web(nginx) + api(Node 24, server.js 한 파일)).
배포 묶음은 깃허브 [Releases](https://github.com/hatility/Gryeobom/releases) 에 zip 으로 올려요.

## 서버 배포

Releases 의 `geuryeobom-v<버전>.zip` (또는 직접 만든 `release/v<버전>/`) 을 서버에 풀고 그 폴더에서:

```
docker compose up -d --build              # 80 포트
PORT=8080 docker compose up -d --build    # 다른 포트
docker compose down                       # 중지 (기록은 볼륨에 남음)
```

- 로그인 쿠키는 기본이 **HTTPS 전용**입니다. 서버 앞단(리버스 프록시)에서 HTTPS를 처리하세요.
  HTTPS 없이 시험할 때만 `COOKIE_SECURE=false docker compose up -d --build`.
- 기록은 Docker 볼륨 `geuryeobom-data` 안의 `geuryeobom.db` (SQLite) 하나입니다. 백업:
  ```
  docker compose stop api
  docker run --rm -v geuryeobom-data:/data -v "$PWD":/backup alpine cp /data/geuryeobom.db /backup/
  docker compose start api
  ```

## 실행 (개발)

| 목적 | 명령 |
|---|---|
| 화면 개발 서버 | `npm install && npm run dev` (http://localhost:5173, `/api` 는 3001로 프록시) |
| API 개발 서버 | `npm run dev:api` (`data/dev.db` 사용) |
| 테스트 | `npm test` (화면 로직 + API) |
| Docker 테스트 | `docker compose up --build` → http://localhost:8080 (빌드 중 테스트 실패 시 중단) |
| 릴리스 만들기 | `npm run release` → `../release/v<버전>/` 추가 + `CHANGELOG.md` 갱신 |

## 버전 · 릴리스

정식 서비스 전이라 `0.x.x` 를 씁니다. 새 버전을 낼 때:

1. `npm version minor --no-git-tag-version` (기능) 또는 `patch` (수정)
2. `CHANGELOG.md` 맨 위에 `## [새 버전] - 날짜` 와 변경 내용을 적기
3. `npm run release` → `release/v<새 버전>/` 이 생기고 `release/CHANGELOG.md` 가 갱신됨

이미 있는 버전 폴더는 덮어쓰지 않고, CHANGELOG 에 그 버전이 없으면 멈춥니다.

## 계정 · 모임 · 안전 설계

- **계정**: 이름 + 생년월일 8자리로 가입 · 로그인, 모임에서는 별명만 보입니다. 서버에는 이름 · 생년월일 원문 없이 HMAC 지문만 저장(비밀값: `AUTH_SECRET` 환경변수, 없으면 DB에 자동 생성).
- **맞혀보기 방지**: 같은 이름으로 로그인 실패 10회 → 15분 대기. IP 기준(교실 공유 IP 고려)은 실패 30회 · 가입 60회.
- **세션**: 기본은 브라우저를 닫으면 끝(공용 PC 고려). ‘로그인 유지’ 선택 시에만 30일. HttpOnly · SameSite=Lax 쿠키.
- **요청 보호**: 변경 요청은 앱 전용 헤더 + JSON 본문만 받음(CSRF 방지). 로그인 · 가입 · 모임 코드는 실패 횟수 제한.
- **로그인 안 해도 됨**: 이 기기(localStorage)에 저장. 로그인 후 ‘내 계정으로 옮기기’ 가능.
- **모임**: 모임장이 만들면 6자리 참여 코드가 생기고, 코드를 아는 사람만 들어옵니다.
  - 모임에 나누는 내용은 공개용 데이터만(서버에서 다시 검증). 회고 · ‘지금의 나’는 절대 포함되지 않습니다.
  - 내 그래프는 언제든 내리기 가능. ‘나만 보기’로 바꾸면 모든 모임에서 자동으로 내려갑니다.
  - 모임장은 다른 사람의 그래프를 모임에서 내릴 수 있습니다(모임 지키기).
- **응원**: 정해진 4가지 말(응원해요 · 공감해요 · 고마워요 · 함께할게요)만. 받은 수는 그래프 주인만 봅니다.
- **계정 지우기**: 이름 + 생년월일 확인 후 계정 · 기록 · 모임 글이 모두 삭제됩니다.

## 아직 없는 것

- 이름과 생일을 아는 사람은 로그인할 수 있습니다. 회고를 지키려면 4자리 PIN 같은 두 번째 확인을 검토하세요.
- 만 14세 미만 가입 시 법정대리인 동의 절차(개인정보보호법)가 아직 없습니다. 정식 운영 전에 꼭 필요합니다.
- 관리자 화면, 신고 기능.
- 실패 횟수 제한은 서버 메모리 기준이라 api 를 여러 대로 늘리면 공용 저장소(예: Redis)가 필요합니다.
- 공유 **링크**는 여전히 링크 안에 내용이 담기므로 이미 보낸 링크는 회수할 수 없습니다(모임 나누기는 회수 가능).

## 구조

```
src/
├── App.tsx              라우팅 · 헤더(로그인) · 푸터
├── api.ts               서버 API 호출 · 내 계정 저장소(remoteRepo)
├── auth.tsx             로그인 상태 · 저장소 고르기(useRepo)
├── types.ts             LifeGraph / LifeEntry
├── content.ts           단계 · 질문 · 감정 · 응원 · 문구
├── store.ts             이 기기 저장소(localRepo)
├── share.ts             공유 데이터 만들기 + 검증 (서버와 같이 씀)
├── graph.ts             좌표 계산 · 곡선 · 이미지 저장
├── components/LifeGraph.tsx   SVG 인생 그래프 (드래그 · 터치 · 키보드)
└── pages/               Home · GraphEditor(5단계) · GraphResult · MyGraphs · Share · GroupPage · Login
server/
├── index.ts             진입점 (DB_FILE · PORT · COOKIE_SECURE)
├── app.ts               API 전체 (계정 · 그래프 · 모임 · 응원)
├── db.ts                SQLite 스키마
└── app.test.ts          API 테스트 (권한 · 회고 차단 · 응원 · 삭제)
```
