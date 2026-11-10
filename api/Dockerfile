FROM node:24-alpine
WORKDIR /app
COPY server.js ./
# 기록(SQLite)은 /data 볼륨에, 자동 백업은 /backups (그려봄 폴더의 backups 를 이어 붙인다).
# root 로 켜져 두 폴더의 주인을 node 로 맞춘 뒤 곧바로 node 사용자(1000)로 내려간다 (server.js 의 RUN_AS).
RUN mkdir -p /data /backups && chown node:node /data /backups
ENV NODE_ENV=production DB_FILE=/data/geuryeobom.db PORT=3000 BACKUP_DIR=/backups RUN_AS=1000:1000
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
