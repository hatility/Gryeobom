#!/bin/sh
# 그려봄 기록 되살리기 · 새 서버로 옮기기:  ./restore.sh 백업파일.db
# 1) 지금 기록을 backups/before-restore-…db 로 먼저 남기고  2) 백업 파일로 바꾼 뒤  3) 다시 시작한다.
set -eu
cd "$(dirname "$0")"
f="${1:-}"
[ -n "$f" ] || { echo "사용법: ./restore.sh 백업파일.db"; exit 1; }
[ -f "$f" ] || { echo "파일이 없어요: $f"; exit 1; }
[ "$(head -c 15 "$f")" = "SQLite format 3" ] || { echo "SQLite DB 파일이 아니에요: $f"; exit 1; }
printf '지금 기록을 %s 로 바꿔요. 계속할까요? (yes 입력) ' "$f"
read -r answer
[ "$answer" = yes ] || { echo "그만뒀어요."; exit 1; }

dir="$(cd "$(dirname "$f")" && pwd)"; file="$(basename "$f")"; stamp="$(date +%Y%m%d-%H%M)"
mkdir -p backups
docker compose create api >/dev/null 2>&1 || true   # 새 서버라면 볼륨을 먼저 만들어 둔다
docker compose stop api
docker run --rm -v geuryeobom-data:/data -v "$PWD/backups":/backup alpine \
  sh -c "if [ -f /data/geuryeobom.db ]; then cp /data/geuryeobom.db /backup/before-restore-$stamp.db; fi"
docker run --rm -v geuryeobom-data:/data -v "$dir":/in:ro alpine \
  sh -c "rm -f /data/geuryeobom.db-wal /data/geuryeobom.db-shm && cp '/in/$file' /data/geuryeobom.db && chown 1000:1000 /data/geuryeobom.db"
docker compose up -d
echo "✓ 되살렸어요. 바꾸기 전 기록이 있었다면 backups/before-restore-$stamp.db 에 남겨 두었어요."
