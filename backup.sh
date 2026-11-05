#!/bin/sh
# 그려봄 기록 백업:  ./backup.sh   →  backups/geuryeobom-YYYYMMDD-HHMM.db
# 서비스를 멈추지 않고, SQLite 의 VACUUM INTO 로 ‘한 순간의 온전한 사본’을 만든다.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
name="geuryeobom-$(date +%Y%m%d-%H%M).db"
docker compose exec -T api node -e "
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync('/data/geuryeobom.db')
  db.exec(\"VACUUM INTO '/data/.backup-tmp.db'\")
  db.close()
"
docker run --rm -v geuryeobom-data:/data -v "$PWD/backups":/backup alpine mv /data/.backup-tmp.db "/backup/$name"
echo "✓ backups/$name  (모든 계정 · 기록 · 회고가 들어 있어요. 안전한 곳에만 보관해 주세요)"
