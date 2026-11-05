FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY real-ip.sh /docker-entrypoint.d/40-real-ip.sh
RUN chmod +x /docker-entrypoint.d/40-real-ip.sh && touch /etc/nginx/real-ip.conf
COPY html /usr/share/nginx/html
EXPOSE 80
