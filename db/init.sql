-- ============================================================================
-- ĐỀ TÀI 5: HỆ THỐNG QUẢN LÝ KHO HÀNG (INVENTORY MANAGEMENT SYSTEM)
-- File khởi tạo Cơ sở dữ liệu MySQL & Phân quyền bảo mật (Hardening DB)
-- ============================================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE DATABASE IF NOT EXISTS inventory_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE inventory_db;

-- ----------------------------------------------------------------------------
-- 1. Bảng Nhà cung cấp (Suppliers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    email VARCHAR(120) NOT NULL,
    address VARCHAR(255) NOT NULL,
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Bảng Sản phẩm / Hàng hóa tồn kho (Products)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    category VARCHAR(80) NOT NULL,
    unit VARCHAR(30) NOT NULL DEFAULT 'Cái',
    price DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 0,
    min_stock INT NOT NULL DEFAULT 10,
    location VARCHAR(60) DEFAULT 'Kệ A1',
    supplier_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_quantity_non_negative CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Bảng Giao dịch Nhập / Xuất kho (Stock Transactions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reference_code VARCHAR(50) NOT NULL UNIQUE,
    product_id INT NOT NULL,
    transaction_type ENUM('IN', 'OUT') NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    performed_by VARCHAR(100) NOT NULL DEFAULT 'Quản lý Kho',
    note VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_transactions_product FOREIGN KEY (product_id)
        REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_tx_qty_positive CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Dữ liệu mẫu (Sample Data)
-- ----------------------------------------------------------------------------
INSERT INTO suppliers (code, name, contact_person, phone, email, address, status) VALUES
('SUP-001', 'Công ty TNHH Thiết bị Công nghệ Á Châu', 'Nguyễn Văn Hòa', '0901234567', 'contact@achautech.vn', '120 Nguyễn Thị Minh Khai, Quận 3, TP.HCM', 'ACTIVE'),
('SUP-002', 'Tập đoàn Linh kiện Điện tử Việt Nhật', 'Trần Thị Mai', '0912345678', 'sales@vietnhat-elec.vn', 'KCN Bắc Thăng Long, Đông Anh, Hà Nội', 'ACTIVE'),
('SUP-003', 'Công ty CP Giải pháp Mạng & Máy chủ Sao Việt', 'Lê Hoàng Nam', '0987654321', 'support@saovietnet.vn', '45 Điện Biên Phủ, Quận Hải Châu, Đà Nẵng', 'ACTIVE'),
('SUP-004', 'Nhà phân phối Phụ kiện Công nghiệp Đại Phát', 'Phạm Minh Tuấn', '0938112233', 'info@daiphatind.vn', 'KCN Sóng Thần 2, Dĩ An, Bình Dương', 'ACTIVE');

INSERT INTO products (sku, name, category, unit, price, quantity, min_stock, location, supplier_id) VALUES
('MDL-SRV-001', 'Server Dell PowerEdge R750xs 32GB RAM', 'Máy chủ & Mạng', 'Bộ', 68500000.00, 12, 5, 'Khu A - Kệ 01', 3),
('MDL-SW-002', 'Switch Cisco Catalyst 2960X 24 Ports PoE', 'Máy chủ & Mạng', 'Cái', 18900000.00, 25, 8, 'Khu A - Kệ 02', 3),
('MDL-SSD-003', 'Ổ cứng SSD Samsung 990 PRO NVMe 1TB', 'Linh kiện lưu trữ', 'Cái', 2850000.00, 6, 15, 'Khu B - Kệ 01', 2),
('MDL-RAM-004', 'RAM Server Kingston ECC DDR4 32GB 3200MHz', 'Linh kiện máy chủ', 'Thanh', 3400000.00, 42, 10, 'Khu B - Kệ 02', 2),
('MDL-MON-005', 'Màn hình Dell UltraSharp 27 inch 4K U2723QE', 'Thiết bị văn phòng', 'Cái', 13200000.00, 18, 6, 'Khu C - Kệ 01', 1),
('MDL-UPS-006', 'Bộ lưu điện UPS APC Smart-UPS 2200VA LCD', 'Thiết bị nguồn', 'Bộ', 16500000.00, 4, 8, 'Khu D - Kệ 01', 4);

INSERT INTO stock_transactions (reference_code, product_id, transaction_type, quantity, unit_price, performed_by, note) VALUES
('PN-202610-001', 1, 'IN', 15, 68500000.00, 'Nguyễn Quản Kho', 'Nhập lô máy chủ Dell đợt 1 tháng 10'),
('PX-202610-002', 1, 'OUT', 3, 68500000.00, 'Trần Kỹ Thuật', 'Xuất lắp đặt phòng Server IDC'),
('PN-202610-003', 2, 'IN', 30, 18900000.00, 'Nguyễn Quản Kho', 'Nhập thiết bị chuyển mạch Cisco'),
('PX-202610-004', 2, 'OUT', 5, 18900000.00, 'Lê Triển Khai', 'Xuất dự án chi nhánh Quận 7'),
('PN-202610-005', 3, 'IN', 20, 2850000.00, 'Nguyễn Quản Kho', 'Nhập ổ cứng NVMe tốc độ cao'),
('PX-202610-006', 3, 'OUT', 14, 2850000.00, 'Phạm Bảo Trì', 'Nâng cấp dàn máy trạm kỹ thuật');

-- ----------------------------------------------------------------------------
-- 5. Hardening Database: Phân quyền tối thiểu (Least Privilege Principle)
-- ----------------------------------------------------------------------------
-- Cấp cho user ứng dụng (inventory_user) CHỈ quyền thao tác dữ liệu (DML)
-- trên database inventory_db, không có quyền DROP DATABASE hay SUPER.
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_db.* TO 'inventory_user'@'%';

-- Tạo tài khoản chuyên biệt với quyền tối thiểu cho Prometheus MySQL Exporter
CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY 'Exporter@StrongPass2026!' WITH MAX_USER_CONNECTIONS 3;
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';

FLUSH PRIVILEGES;
