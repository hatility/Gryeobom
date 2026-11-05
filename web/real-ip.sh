#!/bin/sh
# 앞단 프록시(리버스 프록시 · 로드밸런서 · Cloudflare 등) 뒤에서 진짜 접속 IP 를 남기기.
# TRUSTED_PROXIES 에 적은 주소(대역)에서 온 요청만 X-Forwarded-For 를 믿는다. 비우면 아무것도 믿지 않는다.
# 예) TRUSTED_PROXIES="172.16.0.0/12 192.168.0.0/16"
out=/etc/nginx/real-ip.conf
: > "$out"
for p in $TRUSTED_PROXIES; do
  case "$p" in
    *[!0-9a-fA-F:./]*) echo "[real-ip] 무시: $p (IP 또는 CIDR 만 적어 주세요)" ;;
    *) echo "set_real_ip_from $p;" >> "$out" ;;
  esac
done
if [ -s "$out" ]; then
  printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >> "$out"
  echo "[real-ip] 믿는 프록시: $TRUSTED_PROXIES"
fi
