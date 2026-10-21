#!/usr/bin/env bash
# ============================================================================
# Script tạo chứng chỉ SSL/TLS tự ký (Self-Signed Certificate) cho Nginx
# Sử dụng trên Linux / macOS / Git Bash
# ============================================================================
set -e
mkdir -p nginx/ssl

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/selfsigned.key \
  -out nginx/ssl/selfsigned.crt \
  -subj "/C=VN/ST=HoChiMinh/L=HoChiMinh/O=InventorySystem-De5/OU=DevSecOps/CN=localhost"

echo "[OK] Da tao chung chi SSL tu ky tai thu muc nginx/ssl/"
