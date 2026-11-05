FROM node:24-alpine
WORKDIR /app
COPY server.js ./
# 기록(SQLite)은 /data 볼륨에. node 사용자로 실행한다.
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production DB_FILE=/data/geuryeobom.db PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
