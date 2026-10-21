# ============================================================================
# Dockerfile cho Nginx Reverse Proxy (Đề 5)
# Tự động khởi tạo chứng chỉ SSL/TLS tự ký (Self-Signed) và áp dụng Hardening
# ============================================================================
FROM nginx:1.27-alpine

# Cài đặt openssl để tự động sinh chứng chỉ HTTPS tự ký trong quá trình build
RUN apk add --no-cache openssl curl \
    && mkdir -p /etc/nginx/ssl \
    && openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
       -keyout /etc/nginx/ssl/selfsigned.key \
       -out /etc/nginx/ssl/selfsigned.crt \
       -subj "/C=VN/ST=HoChiMinh/L=HoChiMinh/O=InventorySystem-De5/OU=DevSecOps/CN=localhost" \
    && chmod 600 /etc/nginx/ssl/selfsigned.key \
    && chmod 644 /etc/nginx/ssl/selfsigned.crt \
    && chown -R nginx:nginx /etc/nginx/ssl /var/cache/nginx /var/log/nginx

# Copy file cấu hình Reverse Proxy + Security Headers
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost/nginx_status || exit 1

CMD ["nginx", "-g", "daemon off;"]
