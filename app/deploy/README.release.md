# 그려봄 v__VERSION__

> 지나온 나를 그리고, 지금의 나를 만나다.
> 9~24세 청소년을 위한 자기이해 · 감정 회고 인생 그래프 웹앱

이 폴더 하나가 배포 묶음입니다. 서버에 이 폴더만 복사해서 실행하면 됩니다.
이번 버전에서 바뀐 점은 [CHANGES.md](CHANGES.md), 전체 기록은 [../CHANGELOG.md](../CHANGELOG.md) 에 있습니다.

## 필요한 것

- Docker 와 Docker Compose
- 정식 운영이라면 앞단의 HTTPS (리버스 프록시 · 로드밸런서)

## 실행

```bash
cp .env.example .env      # 설정 파일 만들기
vi .env                   # 관리자 · 공유 주소 등 채우기
docker compose up -d --build
```

| 할 일 | 명령 |
|---|---|
| 중지 | `docker compose down` (기록은 볼륨에 남음) |
| 로그 | `docker compose logs -f api` |
| 설정 바꾼 뒤 반영 | `docker compose up -d` |

시작 로그에 `[설정]` 으로 시작하는 줄이 있으면 설정 값을 한 번 확인해 주세요.

## 설정 (`.env`)

| 이름 | 설명 | 기본값 |
|---|---|---|
| `PUBLIC_URL` | 공유 링크에 쓸 대표 주소 (예: `https://geuryeobom.kr`) | 접속한 주소 그대로 |
| `PORT` | 서버에서 열 포트 | `80` |
| `ADMIN_ID` · `ADMIN_PASSWORD` | 관리자 계정. 둘 다 있어야 `/admin` 이 열림. 비밀번호 12자 이상 | 꺼짐 |
| `COOKIE_SECURE` | 로그인 쿠키를 HTTPS 에서만. HTTPS 없이 시험할 때만 `false` | `true` |
| `AUTH_SECRET` | 로그인 키 비밀값 (`openssl rand -hex 32`). **한 번 정하면 바꾸지 마세요** | 처음 실행 때 자동 생성 |
| `SERVICE_OPERATOR` · `PRIVACY_CONTACT` | 이용약관 · 개인정보 처리방침에 들어갈 운영 기관 · 개인정보 담당자 연락처. **정식 운영 전 꼭 채우기** | 비우면 ‘정식 운영 전 정해질 예정’ |
| `DEV_NAME` · `DEV_ORG` · `DEV_CONTACT` · `DEV_URL` | 사이트 아래 ‘만든 사람’ 탭에 보일 정보. 연락처는 이메일 또는 https 주소 | 비우면 ‘그려봄 만든 사람들’ |

## 구성

```
docker-compose.yml   web + api + 기록 볼륨(geuryeobom-data)
.env.example         설정 예시
web/                 nginx: 화면 파일(html/) · /api 전달 · 보안 헤더(CSP 등)
api/                 Node 24: server.js 한 파일 (외부 패키지 없음, SQLite 내장)
```

## 기록 백업

기록은 Docker 볼륨 `geuryeobom-data` 안의 `geuryeobom.db` 파일 **하나**예요 (계정 · 그래프 · 회고 · 모임 · 링크 · 관리자 설정 모두).
백업 방법은 두 가지예요. 둘 다 서비스를 멈추지 않아요.

- **관리자 화면** → `백업 · 복원` → **DB 백업 내려받기** (브라우저로 `.db` 파일을 받아요)
- **서버에서**: `./backup.sh` → `backups/geuryeobom-날짜-시각.db`
- **자동 백업** (1.1.0~): 서버가 한 시간에 하나씩 **이 폴더(docker-compose.yml 옆)의 `backups/auto-날짜-시.db`** 를 만들고 최근 `BACKUP_KEEP`개(기본 168 = 7일)만 남겨요. 폴더는 처음 켤 때 저절로 생겨요. (1.0.x 까지는 볼륨 안 `backups/` 에 하루 하나였어요.) 같은 디스크 안이라 디스크 고장에는 대비가 안 되니, 아래 cron 이나 관리자 화면 내려받기로 **다른 곳에도** 보관해 주세요.
  - 꺼내기: `docker compose cp api:/data/backups/auto-2026-11-03.db .`

정기 백업은 cron 에 걸어 두면 돼요 (예: 매일 새벽 4시, 30일 지난 것은 지우기).

```bash
0 4 * * * cd /srv/geuryeobom/v__VERSION__ && ./backup.sh && find backups -name 'geuryeobom-*.db' -mtime +30 -delete
```

> 백업 파일에는 모든 회고가 들어 있어요. 서버 밖으로 옮길 때는 암호를 건 저장소에만 두세요.

### 백업으로 되돌리기 (복원)

- **관리자 화면** → `백업 · 복원` → **백업으로 되돌리기**: `.db` 파일을 고르고, 관리자 비밀번호를 한 번 더 넣고, 확인에 체크하면 돼요. 서비스를 멈추지 않아요 (200MB 까지).
  - 바꾸기 전의 DB 는 볼륨 안에 `before-restore-날짜.db` 로 최근 5개까지 남아요. 잘못 되돌렸다면 그 파일을 꺼내(`docker compose cp api:/data/before-restore-….db .`) 다시 올리면 돼요.
  - 예전 버전에서 만든 백업도 돼요 (새로 생긴 칸은 빈 값으로 채워요).
  - 백업한 뒤에 탈퇴한 사람이 있으면 그 계정이 되살아나요. 되돌린 뒤 관리자 화면 ‘사람’에서 다시 지워 주세요.
- **서버에서**: `./restore.sh geuryeobom-….db` (잠깐 멈추고 파일을 통째로 바꿔요. 아래 ‘다른 서버로 옮기기’)

## 다른 서버로 옮기기

DB 가 파일 하나라서, **파일 하나 + `.env`** 만 옮기면 돼요. 따로 DB 서버를 옮기거나 변환할 필요는 없어요.

1. **새 서버 준비** — Docker 를 설치하고, 이 버전 폴더를 통째로 복사해요. 지금 서버의 `.env` 도 같이 복사해요.
   - `.env` 의 `AUTH_SECRET` 은 **절대 바꾸지 마세요.** 바꾸면 모든 사람이 로그인할 수 없어요. 비워 두었다면 DB 안에 있어서 함께 옮겨져요.
2. **지금 서버에서 마지막 백업** — 옮기는 동안 새 기록이 생기지 않게 잠깐 멈추고 백업해요.
   ```bash
   ./backup.sh && docker compose stop
   ```
3. **백업 파일을 새 서버로** — `scp backups/geuryeobom-….db 새서버:/srv/geuryeobom/v__VERSION__/`
4. **새 서버에서 되살리기** — `./restore.sh geuryeobom-….db` (볼륨이 없으면 만들고, 넣고, 띄워요)
5. **확인** — 관리자 화면의 숫자(가입한 사람 · 그래프 · 모임)가 예전 서버와 같은지, 내 계정으로 로그인되는지 봐요.
6. **주소 옮기기** — 도메인(DNS)을 새 서버로 바꾸고, HTTPS 를 다시 붙여요. 주소가 바뀌면 `.env` 의 `PUBLIC_URL` 도 고쳐요 (짧은 링크 `/s/…` 는 주소만 바뀌고 그대로 열려요).
7. **예전 서버는 며칠 그대로** — 문제가 없으면 그때 지워요. 되돌릴 때는 예전 서버를 `docker compose up -d` 로 다시 켜면 돼요.

새 버전으로 올릴 때(같은 서버)는 새 버전 폴더에서 `docker compose up -d --build` 만 하면 돼요. 볼륨 이름이 같아서 기록을 그대로 쓰고, 새로 생긴 칸은 처음 시작할 때 저절로 더해져요 (예전 기록은 지우지 않아요). 그래도 올리기 전에 `./backup.sh` 를 한 번 해 두세요.

> 관리자 접속 기록의 IP 는 nginx 가 본 주소예요. 앞에 다른 프록시(로드밸런서 · Cloudflare 등)를 두면 그 프록시의 IP 가 찍히니, 그때는 web/nginx.conf 의 `X-Real-IP` 를 프록시가 넘겨주는 헤더로 바꿔 주세요.

## 오래 운영할 때

- **디스크**: 관리자 ‘한눈에 → 쌓인 것’에 DB · 자동 백업 크기가 보여요. 회원 1,000명이 그래프 3개씩 회고까지 적어도 DB 는 대략 100MB 안팎이에요. 컨테이너 로그는 10MB × 3개까지만 남겨요.
- **손질**: 서버가 하루 한 번 끝난 로그인 지우기 · DB 통계 손보기 · WAL 합치기를 해요. 따로 할 일은 없어요.
- **이미지 업데이트**: 몇 달에 한 번 `docker compose build --pull && docker compose up -d` 로 Node · nginx · Alpine 보안 패치를 받아 주세요. Node 24 는 2028년 4월까지 지원돼요. 이미지가 바뀌면 오픈소스 고지(licenses/)도 다시 모아야 해요.
- **한 대짜리 구조**: SQLite + 서버 한 대라 수련관 · 학교 규모(수천 명)에는 충분하지만, 서버를 여러 대로 늘릴 수는 없어요. 다시 시작하면 로그인 시도 제한 횟수가 처음부터 다시 세어져요.

## 보안 점검 목록 (운영 전에 꼭)

- **`AUTH_SECRET` 을 `.env` 에 정해 두세요.** 비워 두면 로그인 비밀값이 DB 안에 저장돼서, DB 백업 파일 하나만 새어도 흔한 이름 × 생일을 대입해 회원의 이름 · 생년월일을 알아낼 수 있어요.
  - 처음 설치라면: `openssl rand -hex 32` 값을 넣고 시작해요.
  - 이미 비워 둔 채 운영 중이라면: 지금 DB 의 값을 꺼내 그대로 `.env` 에 적어야 기존 계정이 그대로 로그인돼요.
    ```bash
    docker compose exec -T api node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/data/geuryeobom.db').prepare(\"SELECT value FROM meta WHERE key='auth_secret'\").get().value)"
    ```
- **HTTPS 뒤에서만** 운영하세요 (`COOKIE_SECURE=true` 기본값 유지). 앞단 프록시에서 HSTS 를 켜 두면 더 좋아요.
- **api 컨테이너 포트를 밖으로 열지 마세요.** 접속 IP 는 nginx 가 넘겨주는 `X-Real-IP` 를 믿기 때문에, api 를 직접 열면 IP 를 속여 횟수 제한을 피할 수 있어요 (기본 compose 는 열지 않아요).
- **관리자 비밀번호는 길고 무작위로** (12자 이상, 다른 곳에 쓰지 않는 것). 관리자 화면 → 접속 기록에서 낯선 IP 를 가끔 확인해요.
- **백업 파일**에는 모든 회고가 들어 있어요. 암호를 건 저장소에만 두고, 필요 없어지면 지워요.

## 개인정보 · 안전

- 로그인은 이름 + 생년월일 8자리. 서버에는 원문 없이 지문(HMAC)만 저장합니다.
- 그때의 마음 · 지금의 나 · 미래 편지는 공유 링크 · 모임에 나가지 않습니다. 관리자는 운영에 필요할 때 모든 기록을 볼 수 있습니다.
- 이름과 생일을 아는 사람은 로그인할 수 있습니다. 만 14세 미만 가입 시 보호자 동의 절차는 운영 전에 따로 마련해야 합니다.

## 라이선스

[GNU AGPL-3.0](LICENSE). 수정해서 서비스로 운영하면 그 소스도 사용자에게 공개해야 합니다 (`.env` 의 `DEV_URL` 에 저장소 주소를 넣으면 ‘만든 사람’ 탭에 보입니다).
저작권자(하남시청소년수련관 · 하남시청소년수련관 Team HATILITY · 윤예성 · 이명균)는 예외입니다 — [NOTICE.md](NOTICE.md).
