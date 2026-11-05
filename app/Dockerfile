# 테스트용 이미지. 빌드 단계에서 테스트가 실패하면 이미지가 만들어지지 않는다.
#   target web: nginx (정적 파일 + /api 프록시)
#   target api: Node 24 + SQLite
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM node:24-alpine AS api
WORKDIR /app
COPY --from=build /app/dist-server/index.js server.js
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production DB_FILE=/data/geuryeobom.db PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/real-ip.sh /docker-entrypoint.d/40-real-ip.sh
RUN chmod +x /docker-entrypoint.d/40-real-ip.sh && touch /etc/nginx/real-ip.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
