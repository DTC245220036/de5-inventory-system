const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND'
});

let cachedProducts = [];
let cachedSuppliers = [];

function showToast(msg, isError = false) {
  const el = document.getElementById('toast-message');
  el.textContent = msg;
  el.className = `toast ${isError ? 'err' : 'ok'}`;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 4500);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatModelCode(code) {
  return escapeHtml(String(code ?? '').replace(/^SKU-/i, 'MDL-'));
}

async function checkHealth() {
  const badge = document.getElementById('health-badge');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (res.ok && data.status === 'UP') {
      badge.textContent = `● Hệ thống ổn định (DB: OK • UID: ${data.process_uid})`;
      badge.className = 'badge badge-ok';
    } else {
      badge.textContent = '● Lỗi kết nối Database';
      badge.className = 'badge badge-danger';
    }
  } catch {
    badge.textContent = '● Mất kết nối máy chủ';
    badge.className = 'badge badge-danger';
  }
}

async function loadSummary() {
  try {
    const res = await fetch('/api/summary');
    const data = await res.json();
    document.getElementById('kpi-products').textContent = data.total_products ?? 0;
    document.getElementById('kpi-units').textContent = data.total_units ?? 0;
    document.getElementById('kpi-value').textContent = vndFormatter.format(data.total_value ?? 0);
    document.getElementById('kpi-low-stock').textContent = `${data.low_stock_count ?? 0} mặt hàng`;
    document.getElementById('kpi-suppliers').textContent = `${data.total_suppliers ?? 0} NCC`;
    document.getElementById('kpi-in').textContent = data.total_in_units ?? 0;
    document.getElementById('kpi-out').textContent = data.total_out_units ?? 0;
  } catch (err) {
    console.error('Lỗi tải tổng quan:', err);
  }
}

async function loadProducts() {
  const search = document.getElementById('search-product').value.trim();
  const lowStock = document.getElementById('filter-low-stock').checked;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (lowStock) params.set('lowStock', 'true');

  const res = await fetch(`/api/products?${params.toString()}`);
  const products = await res.json();
  cachedProducts = Array.isArray(products) ? products : [];
  const tbody = document.getElementById('products-tbody');

  if (cachedProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">Không có sản phẩm nào phù hợp.</td></tr>';
  } else {
    tbody.innerHTML = cachedProducts
      .map((p) => {
        const isLow = Number(p.quantity) <= Number(p.min_stock);
        const statusBadge = isLow
          ? `<span class="badge badge-danger">Sắp hết (Min: ${p.min_stock})</span>`
          : `<span class="badge badge-ok">Đủ hàng (Min: ${p.min_stock})</span>`;
        return `
          <tr>
            <td class="nowrap-code"><strong>${formatModelCode(p.sku)}</strong></td>
            <td class="col-name">${escapeHtml(p.name)}</td>
            <td class="nowrap-code">${escapeHtml(p.category)}</td>
            <td class="nowrap-code">${escapeHtml(p.location)}</td>
            <td class="num">${vndFormatter.format(p.price)}</td>
            <td class="num"><strong>${p.quantity}</strong> ${escapeHtml(p.unit)}</td>
            <td class="nowrap-code">${statusBadge}</td>
            <td class="col-name">${escapeHtml(p.supplier_name || 'Chưa gán')}</td>
            <td class="nowrap-code">
              <div class="action-group">
                <button type="button" class="btn btn-edit btn-sm" onclick="startEditProduct(${p.id})">Sửa</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">Xóa</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  // Cập nhật dropdown chọn sản phẩm ở form Nhập/Xuất kho
  const txSelect = document.getElementById('tx-product');
  const allRes = await fetch('/api/products');
  const allProducts = await allRes.json();
  if (Array.isArray(allProducts)) {
    txSelect.innerHTML =
      '<option value="">-- Chọn sản phẩm --</option>' +
      allProducts
        .map(
          (p) =>
            `<option value="${p.id}">[${formatModelCode(p.sku)}] ${escapeHtml(p.name)} (Tồn: ${p.quantity} ${escapeHtml(p.unit)})</option>`
        )
        .join('');
  }
}

async function loadSuppliers() {
  const res = await fetch('/api/suppliers');
  const suppliers = await res.json();
  cachedSuppliers = Array.isArray(suppliers) ? suppliers : [];
  const tbody = document.getElementById('suppliers-tbody');
  const select = document.getElementById('prod-supplier');

  if (cachedSuppliers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">Chưa có nhà cung cấp nào.</td></tr>';
    select.innerHTML = '<option value="">-- Chọn nhà cung cấp --</option>';
    return;
  }

  tbody.innerHTML = cachedSuppliers
    .map(
      (s) => `
      <tr>
        <td class="nowrap-code"><strong>${escapeHtml(s.code)}</strong></td>
        <td class="col-name">${escapeHtml(s.name)}</td>
        <td class="nowrap-code">${escapeHtml(s.contact_person)}</td>
        <td class="nowrap-code">${escapeHtml(s.phone)}</td>
        <td class="nowrap-code">${escapeHtml(s.email)}</td>
        <td class="num"><b>${s.product_count ?? 0}</b> Model</td>
        <td class="col-address">${escapeHtml(s.address)}</td>
        <td class="nowrap-code">
          <div class="action-group">
            <button type="button" class="btn btn-edit btn-sm" onclick="startEditSupplier(${s.id})">Sửa</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="deleteSupplier(${s.id})">Xóa</button>
          </div>
        </td>
      </tr>
    `
    )
    .join('');

  select.innerHTML =
    '<option value="">-- Chọn nhà cung cấp --</option>' +
    cachedSuppliers.map((s) => `<option value="${s.id}">[${escapeHtml(s.code)}] ${escapeHtml(s.name)}</option>`).join('');
}

async function loadTransactions() {
  const res = await fetch('/api/transactions');
  const rows = await res.json();
  const tbody = document.getElementById('tx-tbody');

  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">Chưa có giao dịch nhập/xuất kho.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((t) => {
      const badge =
        t.transaction_type === 'IN'
          ? '<span class="badge badge-in">📥 NHẬP KHO</span>'
          : '<span class="badge badge-warn">📤 XUẤT KHO</span>';
      const timeStr = new Date(t.created_at).toLocaleString('vi-VN');
      return `
        <tr>
          <td class="nowrap-code"><strong>${escapeHtml(t.reference_code)}</strong></td>
          <td class="nowrap-code">${badge}</td>
          <td class="nowrap-code">${formatModelCode(t.sku)}</td>
          <td>${escapeHtml(t.product_name)}</td>
          <td class="num"><strong>${t.quantity}</strong> ${escapeHtml(t.unit)}</td>
          <td class="num">${vndFormatter.format(t.unit_price)}</td>
          <td>${escapeHtml(t.performed_by)}</td>
          <td>${escapeHtml(t.note || '')}</td>
          <td>${escapeHtml(timeStr)}</td>
        </tr>
      `;
    })
    .join('');
}

// ============================================================================
// CHỨC NĂNG SỬA & XÓA SẢN PHẨM TỒN KHO
// ============================================================================
function startEditProduct(id) {
  const product = cachedProducts.find((p) => Number(p.id) === Number(id));
  if (!product) return;

  document.getElementById('prod-edit-id').value = product.id;
  document.getElementById('prod-sku').value = String(product.sku || '').replace(/^SKU-/i, 'MDL-');
  document.getElementById('prod-name').value = product.name || '';
  document.getElementById('prod-category').value = product.category || '';
  document.getElementById('prod-unit').value = product.unit || 'Cái';
  document.getElementById('prod-price').value = Number(product.price || 0);
  document.getElementById('prod-location').value = product.location || '';
  document.getElementById('prod-qty').value = Number(product.quantity || 0);
  document.getElementById('prod-min').value = Number(product.min_stock || 5);
  document.getElementById('prod-supplier').value = product.supplier_id || '';

  document.getElementById('product-form-title').textContent = 'Cập nhật Sản phẩm';
  document.getElementById('prod-qty-label').textContent = 'Số lượng tồn kho';
  document.getElementById('btn-submit-product').textContent = '💾 Lưu Cập nhật';
  document.getElementById('btn-cancel-product').hidden = false;
  document.getElementById('prod-sku').focus();
}

function resetProductForm() {
  const form = document.getElementById('form-add-product');
  form.reset();
  document.getElementById('prod-edit-id').value = '';
  document.getElementById('product-form-title').textContent = 'Thêm Sản phẩm Mới';
  document.getElementById('prod-qty-label').textContent = 'Tồn đầu kỳ';
  document.getElementById('btn-submit-product').textContent = '+ Lưu Sản phẩm vào Kho';
  document.getElementById('btn-cancel-product').hidden = true;
}

async function deleteProduct(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa sản phẩm này khỏi kho?')) return;
  const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (res.ok) {
    showToast(data.message);
    if (String(document.getElementById('prod-edit-id').value) === String(id)) {
      resetProductForm();
    }
    await Promise.all([loadSummary(), loadProducts(), loadTransactions()]);
  } else {
    showToast(data.error || 'Lỗi xóa sản phẩm', true);
  }
}

// ============================================================================
// CHỨC NĂNG SỬA & XÓA NHÀ CUNG CẤP
// ============================================================================
function startEditSupplier(id) {
  const supplier = cachedSuppliers.find((s) => Number(s.id) === Number(id));
  if (!supplier) return;

  document.getElementById('sup-edit-id').value = supplier.id;
  document.getElementById('sup-code').value = supplier.code || '';
  document.getElementById('sup-name').value = supplier.name || '';
  document.getElementById('sup-contact').value = supplier.contact_person || '';
  document.getElementById('sup-phone').value = supplier.phone || '';
  document.getElementById('sup-email').value = supplier.email || '';
  document.getElementById('sup-address').value = supplier.address || '';

  document.getElementById('supplier-form-title').textContent = 'Cập nhật Nhà Cung Cấp';
  document.getElementById('btn-submit-supplier').textContent = '💾 Lưu Cập nhật NCC';
  document.getElementById('btn-cancel-supplier').hidden = false;
  document.getElementById('sup-code').focus();
}

function resetSupplierForm() {
  const form = document.getElementById('form-add-supplier');
  form.reset();
  document.getElementById('sup-edit-id').value = '';
  document.getElementById('supplier-form-title').textContent = 'Thêm Nhà Cung Cấp';
  document.getElementById('btn-submit-supplier').textContent = '+ Thêm Nhà Cung Cấp';
  document.getElementById('btn-cancel-supplier').hidden = true;
}

async function deleteSupplier(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa nhà cung cấp này?')) return;
  const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (res.ok) {
    showToast(data.message);
    if (String(document.getElementById('sup-edit-id').value) === String(id)) {
      resetSupplierForm();
    }
    await Promise.all([loadSummary(), loadSuppliers(), loadProducts()]);
  } else {
    showToast(data.error || 'Lỗi xóa nhà cung cấp', true);
  }
}

window.startEditProduct = startEditProduct;
window.deleteProduct = deleteProduct;
window.startEditSupplier = startEditSupplier;
window.deleteSupplier = deleteSupplier;

document.addEventListener('DOMContentLoaded', () => {
  // Chuyển đổi tab
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.remove('active');
        p.hidden = true;
      });
      btn.classList.add('active');
      const panel = document.getElementById(btn.dataset.tab);
      panel.classList.add('active');
      panel.hidden = false;
    });
  });

  // Tìm kiếm & lọc sản phẩm
  document.getElementById('search-product').addEventListener('input', loadProducts);
  document.getElementById('filter-low-stock').addEventListener('change', loadProducts);
  document.getElementById('btn-refresh-products').addEventListener('click', loadProducts);
  document.getElementById('btn-refresh-tx').addEventListener('click', loadTransactions);
  document.getElementById('btn-sync-tx').addEventListener('click', async () => {
    const res = await fetch('/api/transactions/sync', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      await Promise.all([loadSummary(), loadTransactions()]);
    } else {
      showToast(data.error || 'Không thể đồng bộ dữ liệu nhập/xuất kho', true);
    }
  });
  document.getElementById('btn-refresh-suppliers').addEventListener('click', loadSuppliers);

  // Nút Hủy sửa
  document.getElementById('btn-cancel-product').addEventListener('click', resetProductForm);
  document.getElementById('btn-cancel-supplier').addEventListener('click', resetSupplierForm);

  // Submit Thêm mới hoặc Cập nhật Sản phẩm
  document.getElementById('form-add-product').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('prod-edit-id').value;
    const payload = {
      sku: document.getElementById('prod-sku').value,
      name: document.getElementById('prod-name').value,
      category: document.getElementById('prod-category').value,
      unit: document.getElementById('prod-unit').value,
      price: Number(document.getElementById('prod-price').value),
      location: document.getElementById('prod-location').value,
      quantity: Number(document.getElementById('prod-qty').value),
      min_stock: Number(document.getElementById('prod-min').value),
      supplier_id: document.getElementById('prod-supplier').value || null
    };

    const url = editId ? `/api/products/${editId}` : '/api/products';
    const method = editId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      resetProductForm();
      await Promise.all([loadSummary(), loadProducts(), loadTransactions()]);
    } else {
      showToast(data.error || 'Không thể lưu sản phẩm', true);
    }
  });

  // Submit lập phiếu nhập/xuất kho
  document.getElementById('form-add-tx').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      product_id: Number(document.getElementById('tx-product').value),
      transaction_type: document.getElementById('tx-type').value,
      quantity: Number(document.getElementById('tx-qty').value),
      performed_by: document.getElementById('tx-user').value,
      note: document.getElementById('tx-note').value
    };
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      document.getElementById('tx-note').value = '';
      await Promise.all([loadSummary(), loadProducts(), loadTransactions()]);
    } else {
      showToast(data.error || 'Không thể lập phiếu', true);
    }
  });

  // Submit Thêm mới hoặc Cập nhật Nhà cung cấp
  document.getElementById('form-add-supplier').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('sup-edit-id').value;
    const payload = {
      code: document.getElementById('sup-code').value,
      name: document.getElementById('sup-name').value,
      contact_person: document.getElementById('sup-contact').value,
      phone: document.getElementById('sup-phone').value,
      email: document.getElementById('sup-email').value,
      address: document.getElementById('sup-address').value
    };

    const url = editId ? `/api/suppliers/${editId}` : '/api/suppliers';
    const method = editId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      resetSupplierForm();
      await Promise.all([loadSummary(), loadSuppliers(), loadProducts()]);
    } else {
      showToast(data.error || 'Không thể lưu nhà cung cấp', true);
    }
  });

  // Khởi chạy lần đầu
  checkHealth();
  loadSummary();
  loadSuppliers().then(loadProducts);
  loadTransactions();
});
