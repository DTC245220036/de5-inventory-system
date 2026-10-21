# HỆ THỐNG QUẢN LÝ KHO HÀNG (INVENTORY MANAGEMENT SYSTEM)

> **Môn học:** Triển khai và Quản trị Hệ thống Phần mềm  
> **Đề tài số 5:** Hệ thống Quản lý Kho hàng (Nhập/xuất hàng, tồn kho, nhà cung cấp)  
> **Mã số sinh viên:** `DTC245220036`  
> **Nền tảng triển khai:** Docker & Docker Compose (Node.js + MySQL 8.0 + phpMyAdmin + Nginx Reverse Proxy HTTPS + Prometheus + Grafana + Loki + Promtail)

---

## 1. Kiến trúc Hệ thống (Docker Compose)

Toàn bộ hệ thống được triển khai hoàn chỉnh bằng **Docker Compose** gồm **11 dịch vụ (containers)** hoạt động trên **3 vùng mạng cô lập (`frontend_net`, `backend_net`, `monitoring_net`)**:

| STT | Dịch vụ (`service`) | Image / Build | Cổng truy cập | Vai trò trong hệ thống |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `nginx-proxy` | `nginx:1.27-alpine` (Custom) | `80`, `443` (HTTPS) | Reverse Proxy, chứng chỉ SSL/TLS tự ký, OWASP Security Headers, Rate Limit |
| 2 | `inventory-app` | `node:20-alpine` (Non-root) | Nội bộ `3000` | Website Quản lý Kho hàng (Sản phẩm, Nhóm hàng, Nhập/Xuất kho, Nhà cung cấp, `/metrics`) |
| 3 | `mysql-db` | `mysql:8.0` | Nội bộ `3306` | Cơ sở dữ liệu MySQL 8.0 cô lập trong mạng nội bộ `backend_net` (`internal: true`) |
| 4 | `phpmyadmin` | `phpmyadmin:5.2` | `127.0.0.1:8081` | Công cụ giao diện web quản lý cơ sở dữ liệu MySQL (`inventory_db`) |
| 5 | `prometheus` | `prom/prometheus:v2.53.0` | `127.0.0.1:9090` | Thu thập và lưu trữ Time-series Metrics từ Container, Web Server và Database |
| 6 | `grafana` | `grafana/grafana:11.1.0` | `127.0.0.1:3001` | Trực quan hóa Dashboard giám sát hệ thống và giao diện truy vấn LogQL |
| 7 | `loki` | `grafana/loki:3.0.0` | `127.0.0.1:3100` | Hệ thống lưu trữ và lập chỉ mục Log tập trung |
| 8 | `promtail` | `grafana/promtail:3.0.0` | Nội bộ `9080` | Agent thu thập log từ Docker containers & Nginx gửi về Loki |
| 9 | `nginx-exporter` | `nginx-prometheus-exporter` | Nội bộ `9113` | Thu thập metrics kết nối và request từ `/nginx_status` của Nginx |
| 10 | `mysqld-exporter` | `prom/mysqld-exporter` | Nội bộ `9104` | Thu thập metrics hiệu năng và luồng kết nối từ MySQL 8.0 |
| 11 | `cadvisor` | `gcr.io/cadvisor/cadvisor` | Nội bộ `8080` | Giám sát tài nguyên CPU, RAM, Network, Disk I/O của toàn bộ containers |

---

## 2. Cấu trúc Thư mục Dự án

```text
de5-inventory-system/
├── .env.example                        # File mẫu cấu hình biến môi trường & mật khẩu
├── .gitignore                          # Cấu hình loại trừ file tạm
├── docker-compose.yml                  # File điều phối toàn bộ 11 dịch vụ & 3 mạng cô lập
├── generate-ssl.ps1                    # Script tạo chứng chỉ SSL tự ký trên Windows
├── generate-ssl.sh                     # Script tạo chứng chỉ SSL tự ký trên Linux/macOS
├── README.md                           # Tài liệu hướng dẫn chạy và demo hệ thống
├── app/                                # Mã nguồn Ứng dụng Web Quản lý Kho hàng
│   ├── Dockerfile                      # Multi-layer Dockerfile chạy Non-root user (node)
│   ├── package.json                    # Khai báo thư viện (express, mysql2, prom-client, helmet)
│   ├── server.js                       # REST API + ACID Transaction + Prometheus + JSON Log
│   └── public/                         # Giao diện người dùng (HTML/CSS/JS)
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── db/                                 # Khởi tạo & Bảo mật Cơ sở dữ liệu MySQL
│   ├── init.sql                        # Schema 3 bảng, dữ liệu mẫu & phân quyền Least Privilege
│   └── my.cnf                          # Cấu hình Hardening MySQL (local_infile=0, ...)
├── nginx/                              # Cấu hình Nginx Reverse Proxy
│   ├── Dockerfile                      # Tự động sinh chứng chỉ SSL tự ký khi build
│   └── nginx.conf                      # Reverse Proxy + HTTPS TLS 1.2/1.3 + Security Headers
└── monitoring/                         # Hệ thống Giám sát & Log tập trung
    ├── prometheus/
    │   └── prometheus.yml              # Cấu hình scrape 5 jobs (app, nginx, mysql, cadvisor...)
    ├── loki/
    │   └── loki-config.yml             # Cấu hình Loki Server
    ├── promtail/
    │   └── promtail-config.yml         # Cấu hình Promtail đọc Docker socket & JSON pipeline
    └── grafana/
        └── provisioning/               # Tự động nạp Datasources (Prometheus, Loki) & Dashboard
            ├── datasources/
            │   └── datasources.yml
            └── dashboards/
                ├── dashboards.yml
                └── inventory-system-dashboard.json
```

---

## 3. Hướng dẫn Chạy Hệ thống bằng Docker Compose

### Bước 1: Clone repository và tạo file môi trường `.env`
```bash
git clone https://github.com/DTC245220036/de5-inventory-system.git
cd de5-inventory-system
cp .env.example .env
```

### Bước 2: Khởi chạy toàn bộ dịch vụ bằng Docker Compose
```bash
docker compose up -d --build
```

### Bước 3: Kiểm tra trạng thái hoạt động của các containers
```bash
docker compose ps
```

*(Khi cần dừng hệ thống, sử dụng lệnh: `docker compose down`)*

---

## 4. Hướng dẫn Truy cập & Demo Đầy đủ các Thành phần

### 4.1. Website Quản lý Kho hàng & Nginx Reverse Proxy (HTTPS / Security Headers)
- **Truy cập qua HTTPS (cổng 443):** `https://localhost` *(Chọn **Advanced -> Proceed to localhost** đối với chứng chỉ SSL tự ký)*.
- **Truy cập qua HTTP (cổng 80):** `http://localhost`
- **Các chức năng chính trên Website:**
  - **Tồn kho & Sản phẩm:** Xem danh sách tồn kho, tìm kiếm theo Mã Model / Tên hàng / Vị trí kệ, lọc cảnh báo hàng sắp hết, **Thêm / Sửa / Xóa** mặt hàng.
  - **Phiếu Nhập / Xuất kho:** Lập phiếu Nhập kho (`IN`) và Xuất kho (`OUT`) có kiểm tra tồn kho an toàn bằng MySQL Transaction; hỗ trợ đồng bộ tồn kho.
  - **Nhà cung cấp:** Quản lý danh sách đối tác cung ứng (**Thêm / Sửa / Xóa** nhà cung cấp).
- **Lệnh kiểm tra HTTPS và Security Headers của Nginx:**
  ```bash
  curl -k -I https://localhost
  ```

---

### 4.2. Công cụ Quản lý Cơ sở dữ liệu (phpMyAdmin + MySQL 8.0)
- **Địa chỉ truy cập phpMyAdmin:** `http://localhost:8081`
- **Tài khoản ứng dụng (Đã giới hạn quyền Least Privilege):**
  - **Tên đăng nhập:** `inventory_user`
  - **Mật khẩu:** `InvUser@StrongPass2026!`
- **Tài khoản quản trị hệ thống (`root`):**
  - **Tên đăng nhập:** `root`
  - **Mật khẩu:** `RootDb@Inv#2026!Secure99`
- **Cơ sở dữ liệu:** `inventory_db` (gồm 3 bảng: `products`, `stock_transactions`, `suppliers`).

---

### 4.3. Hệ thống Giám sát (Prometheus + Grafana Dashboard)
1. **Prometheus UI:**
   - **Địa chỉ:** `http://localhost:9090/targets`
   - Kiểm tra toàn bộ 5 jobs (`inventory-app`, `nginx-proxy`, `mysql-db`, `cadvisor-containers`, `prometheus`) đều ở trạng thái **`UP`**.
2. **Grafana Dashboard:**
   - **Địa chỉ:** `http://localhost:3001`
   - **Tài khoản:** `admin`
   - **Mật khẩu:** `Grafana@Admin#2026!Secure`
   - **Cách mở Dashboard:** Vào menu **Dashboards** -> Thư mục **De 5 - Quan Ly Kho Hang** -> Chọn **"Đề 5: Giám sát Hệ thống Quản lý Kho hàng (Inventory System)"** để theo dõi trực quan:
     - Trạng thái MySQL Database, tổng số Model, cảnh báo hàng sắp hết, tổng giá trị tồn kho, Nginx active connections.
     - Tốc độ HTTP Request/s của Web App & Nginx, mức sử dụng RAM của từng Container (`cAdvisor`), tốc độ truy vấn MySQL (`Queries/sec`) và luồng log thời gian thực.

---

### 4.4. Hệ thống Log Tập trung (Loki + Promtail) & Truy vấn LogQL
Truy cập **Grafana (`http://localhost:3001/explore`)** -> Chọn nguồn dữ liệu **Loki** và thực hiện các câu truy vấn **LogQL** sau:

1. **Xem toàn bộ log hoạt động của ứng dụng Quản lý Kho hàng:**
   ```logql
   {service="inventory-app"}
   ```
2. **Lọc các giao dịch Nhập kho (`STOCK_IN`) và Xuất kho (`STOCK_OUT`):**
   ```logql
   {service="inventory-app"} | json | event=~"STOCK_IN|STOCK_OUT"
   ```
3. **Truy tìm các cảnh báo tồn kho thấp (`LOW_STOCK_ALERT`) hoặc lỗi hệ thống (`WARN` / `ERROR`):**
   ```logql
   {service="inventory-app", level=~"WARN|ERROR"}
   ```
4. **Lọc Access Log của Nginx Reverse Proxy có mã trạng thái lỗi (HTTP >= 400):**
   ```logql
   {service="nginx-proxy"} | json | status >= 400
   ```
5. **Thống kê tốc độ sinh log theo từng dịch vụ trong mỗi 1 phút:**
   ```logql
   sum by (service) (rate({service=~"inventory-app|nginx-proxy"}[1m]))
   ```

---

### 4.5. Các Biện pháp Bảo mật Hệ thống (System Hardening) & Lệnh Kiểm chứng

1. **Non-root Container:**
   - Container `inventory-app` chạy bằng tài khoản `node` (`UID=1000`), không dùng quyền `root`.
   - Kiểm chứng trên giao diện web (nhãn `UID: 1000` ở góc phải) hoặc bằng lệnh:
     ```bash
     docker compose exec inventory-app id
     ```
2. **Read-Only Root Filesystem, Drop Capabilities & No-New-Privileges:**
   - `inventory-app` bật `read_only: true`, gỡ bỏ toàn bộ Linux capabilities (`cap_drop: [ALL]`) và bật `security_opt: [no-new-privileges:true]` trên các dịch vụ.
   - Kiểm chứng chống ghi file trái phép:
     ```bash
     docker compose exec inventory-app touch /usr/src/app/test.txt
     ```
3. **Network Isolation (Cô lập mạng 3 lớp):**
   - `frontend_net`: Chỉ kết nối `nginx-proxy`, `inventory-app` và `phpmyadmin`.
   - `backend_net` (`internal: true`): Cô lập hoàn toàn `mysql-db`, không mở cổng `3306` ra ngoài máy host.
   - `monitoring_net`: Dành riêng cho Prometheus, Grafana, Loki, Promtail và các Exporters.
4. **Database Least Privilege & Hardening `my.cnf`:**
   - Tài khoản ứng dụng `inventory_user` chỉ được cấp quyền `SELECT, INSERT, UPDATE, DELETE` trên `inventory_db` (không có quyền `DROP`, `ALTER`, `SUPER`).
   - Vô hiệu hóa `local_infile = 0` và `symbolic-links = 0` trong `db/my.cnf`.
   - Kiểm chứng quyền của user DB:
     ```bash
     docker compose exec mysql-db mysql -u inventory_user -pInvUser@StrongPass2026! -e "SHOW GRANTS;"
     ```
5. **Mật khẩu mạnh, Giới hạn Tài nguyên & Nginx Security Headers:**
   - Toàn bộ mật khẩu độ phức tạp cao được quản lý qua biến môi trường `.env`.
   - Giới hạn CPU và RAM (`deploy.resources.limits`) cho các dịch vụ trọng yếu chống tấn công cạn kiệt tài nguyên (DoS).
   - Nginx cấu hình HTTPS `TLSv1.2`/`TLSv1.3`, ẩn phiên bản `server_tokens off`, giới hạn tốc độ `15r/s` và đính kèm bộ 7 HTTP Security Headers chuẩn OWASP.
