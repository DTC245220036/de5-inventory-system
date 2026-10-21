# ============================================================================
# Script tạo chứng chỉ SSL/TLS tự ký (Self-Signed Certificate) cho Nginx
# Sử dụng trên Windows PowerShell
# ============================================================================
$sslDir = Join-Path $PSScriptRoot "nginx\ssl"
if (-not (Test-Path $sslDir)) {
    New-Item -ItemType Directory -Path $sslDir -Force | Out-Null
}

$crtFile = Join-Path $sslDir "selfsigned.crt"
$keyFile = Join-Path $sslDir "selfsigned.key"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
  -keyout $keyFile `
  -out $crtFile `
  -subj "/C=VN/ST=HoChiMinh/L=HoChiMinh/O=InventorySystem-De5/OU=DevSecOps/CN=localhost"

Write-Host "[OK] Da tao chung chi SSL tu ky tai: $sslDir" -ForegroundColor Green
