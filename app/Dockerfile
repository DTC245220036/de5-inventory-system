# ============================================================================
# Dockerfile cho Ứng dụng Quản lý Kho hàng (Đề 5)
# Áp dụng Container Hardening: Multi-layer tối giản + Non-root User (node)
# ============================================================================
FROM node:20-alpine

# Cài đặt curl để phục vụ Docker HEALTHCHECK
RUN apk add --no-cache curl

# Thiết lập thư mục làm việc
WORKDIR /usr/src/app

# Copy file khai báo thư viện và cài đặt production dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy mã nguồn ứng dụng và phân quyền sở hữu cho non-root user 'node' (UID 1000)
COPY --chown=node:node . .

# Thiết lập biến môi trường Production
ENV NODE_ENV=production
ENV PORT=3000

# HARDENING: Chuyển sang chạy dưới quyền non-root user 'node' (UID 1000)
USER node

EXPOSE 3000

# Kiểm tra sức khỏe container định kỳ
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
