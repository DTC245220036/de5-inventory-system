const express = require('express');
const path = require('path');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const client = require('prom-client');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ============================================================================
// 1. STRUCTURED JSON LOGGER (Phục vụ thu thập & truy vấn LogQL trên Loki)
// ============================================================================
function writeLog(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'inventory-app',
    message,
    ...meta
  };
  const line = JSON.stringify(entry);
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

// ============================================================================
// 2. CẤU HÌNH PROMETHEUS METRICS (Giám sát ứng dụng & nghiệp vụ Kho hàng)
// ============================================================================
const register = new client.Registry();
client.collectDefaultMetrics({
  register,
  prefix: 'inventory_node_'
});

const httpRequestsTotal = new client.Counter({
  name: 'inventory_http_requests_total',
  help: 'Tong so HTTP request den ung dung Quan ly Kho hang',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestDuration = new client.Histogram({
  name: 'inventory_http_request_duration_seconds',
  help: 'Thoi gian xu ly HTTP request tinh bang giay',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register]
});

const stockTransactionsCounter = new client.Counter({
  name: 'inventory_stock_transactions_total',
  help: 'Tong so giao dich nhap/xuat kho duoc thuc hien',
  labelNames: ['transaction_type'],
  registers: [register]
});

const totalProductsGauge = new client.Gauge({
  name: 'inventory_products_count',
  help: 'Tong so danh muc san pham (SKU) trong kho',
  registers: [register]
});

const lowStockGauge = new client.Gauge({
  name: 'inventory_low_stock_count',
  help: 'So san pham co ton kho thap hon hoac bang dinh muc toi thieu',
  registers: [register]
});

const totalInventoryValueGauge = new client.Gauge({
  name: 'inventory_total_value_vnd',
  help: 'Tong gia tri hang ton kho tinh theo VND',
  registers: [register]
});

const dbUpGauge = new client.Gauge({
  name: 'inventory_db_up',
  help: 'Trang thai ket noi MySQL Database (1 = UP, 0 = DOWN)',
  registers: [register]
});

// ============================================================================
// 3. KẾT NỐI CƠ SỞ DỮ LIỆU MYSQL (Connection Pool)
// ============================================================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-db',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'inventory_user',
  password: process.env.DB_PASSWORD || 'InvUser@StrongPass2026!',
  database: process.env.DB_NAME || 'inventory_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

async function refreshBusinessMetrics() {
  try {
    const [[stats]] = await pool.query(`
      SELECT
        COUNT(*) AS totalProducts,
        SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) AS lowStockCount,
        COALESCE(SUM(quantity * price), 0) AS totalValue
      FROM products
    `);
    totalProductsGauge.set(Number(stats.totalProducts || 0));
    lowStockGauge.set(Number(stats.lowStockCount || 0));
    totalInventoryValueGauge.set(Number(stats.totalValue || 0));
    dbUpGauge.set(1);
  } catch (err) {
    dbUpGauge.set(0);
    writeLog('ERROR', 'Khong the cap nhat Prometheus metrics tu MySQL', {
      event: 'METRICS_REFRESH_ERROR',
      error: err.message
    });
  }
}

// ============================================================================
// 4. MIDDLEWARE BẢO MẬT, PARSER & LOGGING
// ============================================================================
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false // Đã cấu hình chi tiết ở tầng Nginx Reverse Proxy
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware đo lường Prometheus + ghi Structured Log cho mọi HTTP request
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? req.route.path : req.path;
    const statusCode = String(res.statusCode);

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: statusCode
    });
    httpRequestDuration.observe(
      {
        method: req.method,
        route,
        status_code: statusCode
      },
      durationSec
    );

    // Không ghi log mỗi lần Prometheus scrape /metrics để tránh nhiễu log nghiệp vụ
    if (req.path !== '/metrics') {
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
      writeLog(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
        event: 'HTTP_ACCESS',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Number((durationSec * 1000).toFixed(2)),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
      });
    }
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 5. ENDPOINTS GIÁM SÁT: HEALTHCHECK & PROMETHEUS METRICS
// ============================================================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    dbUpGauge.set(1);
    res.json({
      status: 'UP',
      service: 'inventory-app',
      database: 'CONNECTED',
      process_uid: process.getuid ? process.getuid() : 'non-root',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    dbUpGauge.set(0);
    writeLog('ERROR', 'Healthcheck that bai do mat ket noi Database', {
      event: 'HEALTHCHECK_FAILED',
      error: err.message
    });
    res.status(503).json({
      status: 'DOWN',
      service: 'inventory-app',
      database: 'DISCONNECTED',
      error: err.message
    });
  }
});

app.get('/metrics', async (req, res) => {
  await refreshBusinessMetrics();
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ============================================================================
// 6. REST API NGHIỆP VỤ QUẢN LÝ KHO HÀNG (ĐỀ 5)
// ============================================================================

// 6.1. Tổng quan Dashboard Kho hàng
app.get('/api/summary', async (req, res) => {
  try {
    const [[productStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_products,
        COALESCE(SUM(quantity), 0) AS total_units,
        COALESCE(SUM(quantity * price), 0) AS total_value,
        SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) AS low_stock_count
      FROM products
    `);

    const [[supplierStats]] = await pool.query(`
      SELECT COUNT(*) AS total_suppliers
      FROM suppliers
      WHERE status = 'ACTIVE'
    `);

    const [[txStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN transaction_type = 'IN' THEN quantity ELSE 0 END) AS total_in_units,
        SUM(CASE WHEN transaction_type = 'OUT' THEN quantity ELSE 0 END) AS total_out_units
      FROM stock_transactions
    `);

    const [lowStockItems] = await pool.query(`
      SELECT p.id, p.sku, p.name, p.category, p.unit, p.quantity, p.min_stock, p.location, s.name AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.quantity <= p.min_stock
      ORDER BY (p.quantity - p.min_stock) ASC
    `);

    res.json({
      total_products: Number(productStats.total_products || 0),
      total_units: Number(productStats.total_units || 0),
      total_value: Number(productStats.total_value || 0),
      low_stock_count: Number(productStats.low_stock_count || 0),
      total_suppliers: Number(supplierStats.total_suppliers || 0),
      total_transactions: Number(txStats.total_transactions || 0),
      total_in_units: Number(txStats.total_in_units || 0),
      total_out_units: Number(txStats.total_out_units || 0),
      low_stock_items: lowStockItems
    });
  } catch (err) {
    writeLog('ERROR', 'Loi truy van thong ke kho hang', { event: 'SUMMARY_ERROR', error: err.message });
    res.status(500).json({ error: 'Không thể tải dữ liệu tổng quan kho hàng.' });
  }
});

// 6.2. Quản lý Sản phẩm & Tồn kho (Products)
app.get('/api/products', async (req, res) => {
  try {
    const { search, category, lowStock } = req.query;
    let sql = `
      SELECT p.*, s.name AS supplier_name, s.code AS supplier_code
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (p.sku LIKE ? OR p.name LIKE ? OR p.location LIKE ?)';
      const keyword = `%${search.trim()}%`;
      params.push(keyword, keyword, keyword);
    }
    if (category) {
      sql += ' AND p.category = ?';
      params.push(category);
    }
    if (lowStock === 'true') {
      sql += ' AND p.quantity <= p.min_stock';
    }

    sql += ' ORDER BY p.id DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    writeLog('ERROR', 'Loi lay danh sach san pham', { event: 'PRODUCT_LIST_ERROR', error: err.message });
    res.status(500).json({ error: 'Không thể tải danh sách sản phẩm.' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { sku, name, category, unit, price, quantity, min_stock, location, supplier_id } = req.body;
    if (!sku || !name || !category) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Mã Model, Tên sản phẩm và Nhóm hàng.' });
    }

    const initialQty = Number(quantity || 0);
    const [result] = await pool.query(
      `INSERT INTO products (sku, name, category, unit, price, quantity, min_stock, location, supplier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sku.trim().toUpperCase(),
        name.trim(),
        category.trim(),
        unit || 'Cái',
        Number(price || 0),
        initialQty,
        Number(min_stock || 10),
        location || 'Khu A - Kệ 01',
        supplier_id ? Number(supplier_id) : null
      ]
    );

    // Tự động ghi nhận phiếu Nhập kho đầu kỳ cho sản phẩm mới (giữ nguyên toàn bộ lịch sử cũ)
    if (initialQty > 0) {
      const refCode = `PN-${Date.now().toString().slice(-7)}`;
      await pool.query(
        `INSERT INTO stock_transactions (reference_code, product_id, transaction_type, quantity, unit_price, performed_by, note)
         VALUES (?, ?, 'IN', ?, ?, ?, ?)`,
        [
          refCode,
          result.insertId,
          initialQty,
          Number(price || 0),
          'Quản lý Kho',
          `Nhập kho đầu kỳ mặt hàng ${name.trim()}`
        ]
      );
    }

    writeLog('INFO', `Them san pham moi thanh cong: ${sku}`, {
      event: 'PRODUCT_CREATED',
      product_id: result.insertId,
      sku: sku.trim().toUpperCase(),
      initial_quantity: Number(quantity || 0)
    });

    await refreshBusinessMetrics();
    res.status(201).json({ id: result.insertId, message: 'Thêm sản phẩm thành công!' });
  } catch (err) {
    writeLog('WARN', 'Khong the them san pham moi', {
      event: 'PRODUCT_CREATE_FAILED',
      sku: req.body?.sku,
      error: err.message
    });
    res.status(400).json({ error: err.code === 'ER_DUP_ENTRY' ? 'Mã Model đã tồn tại trong hệ thống!' : err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const { sku, name, category, unit, price, quantity, min_stock, location, supplier_id } = req.body;
    await pool.query(
      `UPDATE products
       SET sku = ?, name = ?, category = ?, unit = ?, price = ?, quantity = ?, min_stock = ?, location = ?, supplier_id = ?
       WHERE id = ?`,
      [
        sku.trim().toUpperCase(),
        name.trim(),
        category.trim(),
        unit || 'Cái',
        Number(price || 0),
        Number(quantity ?? 0),
        Number(min_stock || 10),
        location || 'Khu A - Kệ 01',
        supplier_id ? Number(supplier_id) : null,
        productId
      ]
    );

    // Đồng bộ lại đơn giá trong lịch sử phiếu nhập/xuất của sản phẩm này
    await pool.query('UPDATE stock_transactions SET unit_price = ? WHERE product_id = ?', [
      Number(price || 0),
      productId
    ]);

    writeLog('INFO', `Cap nhat thong tin san pham ID=${productId}`, {
      event: 'PRODUCT_UPDATED',
      product_id: productId,
      sku
    });

    await refreshBusinessMetrics();
    res.json({ message: 'Cập nhật sản phẩm thành công!' });
  } catch (err) {
    writeLog('ERROR', 'Loi cap nhat san pham', { event: 'PRODUCT_UPDATE_ERROR', error: err.message });
    res.status(400).json({ error: err.code === 'ER_DUP_ENTRY' ? 'Mã Model đã tồn tại trong hệ thống!' : err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const productId = Number(req.params.id);
    await pool.query('DELETE FROM products WHERE id = ?', [productId]);
    writeLog('WARN', `Xoa san pham khoi kho ID=${productId}`, {
      event: 'PRODUCT_DELETED',
      product_id: productId
    });
    await refreshBusinessMetrics();
    res.json({ message: 'Đã xóa sản phẩm khỏi hệ thống.' });
  } catch (err) {
    writeLog('ERROR', 'Loi xoa san pham', { event: 'PRODUCT_DELETE_ERROR', error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// 6.3. Quản lý Nhà cung cấp (Suppliers)
app.get('/api/suppliers', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, COUNT(p.id) AS product_count
      FROM suppliers s
      LEFT JOIN products p ON p.supplier_id = s.id
      GROUP BY s.id
      ORDER BY s.id DESC
    `);
    res.json(rows);
  } catch (err) {
    writeLog('ERROR', 'Loi lay danh sach nha cung cap', { event: 'SUPPLIER_LIST_ERROR', error: err.message });
    res.status(500).json({ error: 'Không thể tải danh sách nhà cung cấp.' });
  }
});

app.post('/api/suppliers', async (req, res) => {
  try {
    const { code, name, contact_person, phone, email, address, status } = req.body;
    if (!code || !name || !phone) {
      return res.status(400).json({ error: 'Vui lòng nhập Mã NCC, Tên nhà cung cấp và Số điện thoại.' });
    }
    const [result] = await pool.query(
      `INSERT INTO suppliers (code, name, contact_person, phone, email, address, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        code.trim().toUpperCase(),
        name.trim(),
        contact_person || 'Đại diện kinh doanh',
        phone.trim(),
        email || 'contact@supplier.vn',
        address || 'Việt Nam',
        status || 'ACTIVE'
      ]
    );
    writeLog('INFO', `Them nha cung cap moi: ${code}`, {
      event: 'SUPPLIER_CREATED',
      supplier_id: result.insertId,
      code: code.trim().toUpperCase()
    });
    res.status(201).json({ id: result.insertId, message: 'Thêm nhà cung cấp thành công!' });
  } catch (err) {
    writeLog('WARN', 'Them nha cung cap that bai', { event: 'SUPPLIER_CREATE_FAILED', error: err.message });
    res.status(400).json({ error: err.code === 'ER_DUP_ENTRY' ? 'Mã nhà cung cấp đã tồn tại!' : err.message });
  }
});

app.put('/api/suppliers/:id', async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    const { code, name, contact_person, phone, email, address } = req.body;
    if (!code || !name || !phone) {
      return res.status(400).json({ error: 'Vui lòng nhập Mã NCC, Tên nhà cung cấp và Số điện thoại.' });
    }
    await pool.query(
      `UPDATE suppliers
       SET code = ?, name = ?, contact_person = ?, phone = ?, email = ?, address = ?
       WHERE id = ?`,
      [
        code.trim().toUpperCase(),
        name.trim(),
        contact_person || 'Đại diện kinh doanh',
        phone.trim(),
        email || 'contact@supplier.vn',
        address || 'Việt Nam',
        supplierId
      ]
    );
    writeLog('INFO', `Cap nhat nha cung cap ID=${supplierId}`, {
      event: 'SUPPLIER_UPDATED',
      supplier_id: supplierId,
      code: code.trim().toUpperCase()
    });
    res.json({ message: 'Cập nhật nhà cung cấp thành công!' });
  } catch (err) {
    writeLog('ERROR', 'Loi cap nhat nha cung cap', { event: 'SUPPLIER_UPDATE_ERROR', error: err.message });
    res.status(400).json({ error: err.code === 'ER_DUP_ENTRY' ? 'Mã nhà cung cấp đã tồn tại!' : err.message });
  }
});

app.delete('/api/suppliers/:id', async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    await pool.query('DELETE FROM suppliers WHERE id = ?', [supplierId]);
    writeLog('WARN', `Xoa nha cung cap ID=${supplierId}`, {
      event: 'SUPPLIER_DELETED',
      supplier_id: supplierId
    });
    res.json({ message: 'Đã xóa nhà cung cấp.' });
  } catch (err) {
    writeLog('ERROR', 'Loi xoa nha cung cap', { event: 'SUPPLIER_DELETE_ERROR', error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// 6.4. Quản lý Giao dịch Nhập / Xuất Kho (Stock Transactions - ACID Transaction)
app.get('/api/transactions', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, p.sku, p.name AS product_name, p.unit
      FROM stock_transactions t
      JOIN products p ON t.product_id = p.id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    writeLog('ERROR', 'Loi lay lich su nhap xuat kho', { event: 'TRANSACTION_LIST_ERROR', error: err.message });
    res.status(500).json({ error: 'Không thể tải lịch sử nhập/xuất kho.' });
  }
});

app.post('/api/transactions', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { product_id, transaction_type, quantity, performed_by, note } = req.body;
    const qty = Number(quantity);

    if (!product_id || !['IN', 'OUT'].includes(transaction_type) || !qty || qty <= 0) {
      conn.release();
      return res.status(400).json({ error: 'Thông tin phiếu nhập/xuất không hợp lệ (số lượng phải > 0).' });
    }

    await conn.beginTransaction();

    // Khóa bản ghi sản phẩm (FOR UPDATE) để tránh race condition khi xuất kho đồng thời
    const [[product]] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [Number(product_id)]);
    if (!product) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm trong kho.' });
    }

    if (transaction_type === 'OUT' && product.quantity < qty) {
      await conn.rollback();
      conn.release();
      writeLog('WARN', `Tu choi xuat kho do khong du ton kho: SKU=${product.sku}`, {
        event: 'STOCK_OUT_INSUFFICIENT',
        sku: product.sku,
        requested: qty,
        available: product.quantity
      });
      return res.status(400).json({
        error: `Tồn kho không đủ! Hiện còn ${product.quantity} ${product.unit}, không thể xuất ${qty} ${product.unit}.`
      });
    }

    const newQuantity = transaction_type === 'IN' ? product.quantity + qty : product.quantity - qty;
    const prefix = transaction_type === 'IN' ? 'PN' : 'PX';
    const refCode = `${prefix}-${Date.now().toString().slice(-7)}`;

    await conn.query('UPDATE products SET quantity = ? WHERE id = ?', [newQuantity, product.id]);
    const [txResult] = await conn.query(
      `INSERT INTO stock_transactions (reference_code, product_id, transaction_type, quantity, unit_price, performed_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        refCode,
        product.id,
        transaction_type,
        qty,
        product.price,
        performed_by || 'Quản lý Kho',
        note || (transaction_type === 'IN' ? 'Nhập hàng vào kho' : 'Xuất hàng khỏi kho')
      ]
    );

    await conn.commit();
    conn.release();

    stockTransactionsCounter.inc({ transaction_type });

    writeLog('INFO', `Giao dich ${transaction_type} thanh cong: ${refCode} (${qty} ${product.unit} - ${product.sku})`, {
      event: transaction_type === 'IN' ? 'STOCK_IN' : 'STOCK_OUT',
      reference_code: refCode,
      sku: product.sku,
      quantity: qty,
      new_stock: newQuantity,
      performed_by: performed_by || 'Quản lý Kho'
    });

    if (newQuantity <= product.min_stock) {
      writeLog('WARN', `CANH BAO TON KHO THAP: San pham ${product.sku} chi con ${newQuantity}/${product.min_stock}`, {
        event: 'LOW_STOCK_ALERT',
        sku: product.sku,
        product_name: product.name,
        current_stock: newQuantity,
        min_stock: product.min_stock
      });
    }

    await refreshBusinessMetrics();

    res.status(201).json({
      id: txResult.insertId,
      reference_code: refCode,
      new_quantity: newQuantity,
      message: `Lập phiếu ${transaction_type === 'IN' ? 'Nhập kho' : 'Xuất kho'} (${refCode}) thành công!`
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    writeLog('ERROR', 'Loi xu ly giao dich nhap/xuat kho', {
      event: 'STOCK_TRANSACTION_ERROR',
      error: err.message
    });
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý phiếu nhập/xuất kho.' });
  }
});

// Đồng bộ lịch sử Nhập/Xuất kho khớp với Bảng Sản phẩm & Nhà cung cấp MÀ KHÔNG XÓA lịch sử cũ
async function syncTransactionsWithProducts() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [products] = await conn.query(`
      SELECT p.*, s.name AS supplier_name, s.contact_person
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.id ASC
    `);

    for (const p of products) {
      // 1. Cập nhật lại đơn giá trên các phiếu hiện có của sản phẩm này (không xóa phiếu cũ)
      await conn.query('UPDATE stock_transactions SET unit_price = ? WHERE product_id = ?', [
        Number(p.price || 0),
        p.id
      ]);

      // 2. Kiểm tra tổng Nhập - Xuất hiện có của sản phẩm này
      const [[txSummary]] = await conn.query(
        `SELECT
           COUNT(*) AS tx_count,
           COALESCE(SUM(CASE WHEN transaction_type = 'IN' THEN quantity ELSE -quantity END), 0) AS net_qty
         FROM stock_transactions
         WHERE product_id = ?`,
        [p.id]
      );

      const currentQty = Number(p.quantity || 0);
      const txCount = Number(txSummary.tx_count || 0);
      const netQty = Number(txSummary.net_qty || 0);
      const supplierLabel = p.supplier_name ? `từ ${p.supplier_name}` : 'vào kho chính';

      if (txCount === 0 && currentQty > 0) {
        // Nếu sản phẩm chưa có phiếu nào thì thêm phiếu Nhập kho đầu kỳ
        const inCode = `PN-${Date.now().toString().slice(-6)}-${p.id}`;
        await conn.query(
          `INSERT INTO stock_transactions (reference_code, product_id, transaction_type, quantity, unit_price, performed_by, note)
           VALUES (?, ?, 'IN', ?, ?, ?, ?)`,
          [
            inCode,
            p.id,
            currentQty,
            Number(p.price || 0),
            p.contact_person || 'Quản lý Kho',
            `Nhập lô hàng ${p.name} ${supplierLabel}`
          ]
        );
      } else if (txCount > 0 && netQty !== currentQty) {
        // Nếu số lượng tồn kho đã được chỉnh sửa khác với tổng phiếu cũ, thêm 1 phiếu cân bằng (giữ nguyên toàn bộ phiếu trước đó)
        const diff = currentQty - netQty;
        const txType = diff > 0 ? 'IN' : 'OUT';
        const prefix = diff > 0 ? 'PN' : 'PX';
        const adjCode = `${prefix}-${Date.now().toString().slice(-6)}-${p.id}`;
        await conn.query(
          `INSERT INTO stock_transactions (reference_code, product_id, transaction_type, quantity, unit_price, performed_by, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            adjCode,
            p.id,
            txType,
            Math.abs(diff),
            Number(p.price || 0),
            'Quản lý Kho',
            diff > 0
              ? `Nhập bổ sung cân bằng tồn kho ${p.name}`
              : `Xuất điều chỉnh cân bằng tồn kho ${p.name}`
          ]
        );
      }
    }

    await conn.commit();
    conn.release();
    await refreshBusinessMetrics();
    writeLog('INFO', 'Da dong bo bo sung du lieu phieu Nhap/Xuat kho (giu nguyen lich su cu)', {
      event: 'TRANSACTIONS_SYNCED',
      product_count: products.length
    });
    return products.length;
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

app.post('/api/transactions/sync', async (req, res) => {
  try {
    const count = await syncTransactionsWithProducts();
    res.json({
      message: `Đã đồng bộ bổ sung lịch sử Nhập/Xuất kho cho ${count} sản phẩm (giữ nguyên toàn bộ các phiếu trước đó)!`
    });
  } catch (err) {
    writeLog('ERROR', 'Loi dong bo giao dich nhap xuat kho', {
      event: 'TRANSACTION_SYNC_ERROR',
      error: err.message
    });
    res.status(500).json({ error: 'Không thể đồng bộ dữ liệu nhập/xuất kho.' });
  }
});

// Khởi động Server
app.listen(PORT, '0.0.0.0', () => {
  writeLog('INFO', `He thong Quan ly Kho hang (De 5) dang chay tai cong ${PORT}`, {
    event: 'SERVER_STARTED',
    port: PORT,
    node_env: process.env.NODE_ENV || 'development',
    uid: process.getuid ? process.getuid() : 'non-root'
  });
  refreshBusinessMetrics();
});
