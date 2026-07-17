# pack-extension.ps1
# Script tu dong validate va dong goi Chrome Extension MediaFetch Helper
# Chay: cd d:\Tooldowload\extension && powershell -ExecutionPolicy Bypass -File pack-extension.ps1

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ok = $true

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  MediaFetch Extension - Validate & Pack Tool" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# --- Doc manifest.json ---
$manifestPath = Join-Path $scriptDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
  Write-Host "[FAIL] Khong tim thay manifest.json!" -ForegroundColor Red
  exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "[OK] Doc manifest.json thanh cong" -ForegroundColor DarkGray

# --- Kiem tra cac field bat buoc cua manifest ---
Write-Host ""
Write-Host "--- Kiem tra Manifest Fields ---" -ForegroundColor Yellow

$requiredFields = @("manifest_version", "name", "version", "description", "background", "action", "icons")
foreach ($field in $requiredFields) {
  if ($manifest.$field) {
    Write-Host "  [PASS] '$field' ton tai" -ForegroundColor Green
  } else {
    Write-Host "  [FAIL] '$field' bi thieu trong manifest.json!" -ForegroundColor Red
    $ok = $false
  }
}

if ($manifest.manifest_version -ne 3) {
  Write-Host "  [WARN] manifest_version nen la 3 (Manifest V3)" -ForegroundColor Yellow
}

# --- Kiem tra cac file duoc khai bao trong manifest ---
Write-Host ""
Write-Host "--- Kiem tra File ton tai ---" -ForegroundColor Yellow

$filesToCheck = @()

if ($manifest.background -and $manifest.background.service_worker) {
  $filesToCheck += $manifest.background.service_worker
}

if ($manifest.action -and $manifest.action.default_popup) {
  $filesToCheck += $manifest.action.default_popup
}

if ($manifest.action -and $manifest.action.default_icon) {
  $manifest.action.default_icon.PSObject.Properties | ForEach-Object {
    $filesToCheck += $_.Value
  }
}

if ($manifest.icons) {
  $manifest.icons.PSObject.Properties | ForEach-Object {
    $filesToCheck += $_.Value
  }
}

if ($manifest.content_scripts) {
  foreach ($cs in $manifest.content_scripts) {
    if ($cs.js) { $filesToCheck += $cs.js }
    if ($cs.css) { $filesToCheck += $cs.css }
  }
}

$filesToCheck = $filesToCheck | Select-Object -Unique
foreach ($relPath in $filesToCheck) {
  $fullPath = Join-Path $scriptDir $relPath
  if (Test-Path $fullPath) {
    $size = (Get-Item $fullPath).Length
    Write-Host "  [PASS] $relPath ($size bytes)" -ForegroundColor Green
  } else {
    Write-Host "  [FAIL] File khong ton tai: $relPath" -ForegroundColor Red
    $ok = $false
  }
}

# --- Kiem tra popup.html khong dung inline script ---
Write-Host ""
Write-Host "--- Kiem tra CSP Compliance ---" -ForegroundColor Yellow

$popupHtmlPath = Join-Path $scriptDir "popup\popup.html"
if (Test-Path $popupHtmlPath) {
  $popupContent = Get-Content $popupHtmlPath -Raw
  if ($popupContent -match '<script>') {
    Write-Host "  [FAIL] popup.html co inline <script> - Chrome MV3 se tu choi!" -ForegroundColor Red
    $ok = $false
  } else {
    Write-Host "  [PASS] Khong co inline script trong popup.html" -ForegroundColor Green
  }
  if ($popupContent -match 'Content-Security-Policy') {
    Write-Host "  [PASS] CSP meta tag duoc khai bao" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] Khong tim thay CSP meta trong popup.html" -ForegroundColor Yellow
  }
}

# --- Kiem tra background.js khong dung XMLHttpRequest ---
$bgPath = Join-Path $scriptDir "background.js"
if (Test-Path $bgPath) {
  $bgContent = Get-Content $bgPath -Raw
  if ($bgContent -match 'XMLHttpRequest|new XHR') {
    Write-Host "  [FAIL] background.js dung XMLHttpRequest (khong duoc phep trong MV3 SW)!" -ForegroundColor Red
    $ok = $false
  } else {
    Write-Host "  [PASS] background.js khong dung XMLHttpRequest" -ForegroundColor Green
  }
  if ($bgContent -match 'unhandledrejection') {
    Write-Host "  [PASS] background.js co global error handler" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] background.js thieu unhandledrejection handler" -ForegroundColor Yellow
  }
}

# --- Tom tat ket qua ---
Write-Host ""
Write-Host "--- Ket qua Validate ---" -ForegroundColor Yellow

if (-not $ok) {
  Write-Host ""
  Write-Host "[FAIL] Co loi can sua truoc khi dong goi. Xem chi tiet o tren." -ForegroundColor Red
  Write-Host ""
  exit 1
}

Write-Host "  [SUCCESS] Tat ca kiem tra PASSED!" -ForegroundColor Green

# --- Dong goi ZIP ---
Write-Host ""
Write-Host "--- Dong goi Extension ---" -ForegroundColor Yellow

$version = $manifest.version
$zipName = "MediaFetch-Extension-v$version.zip"
$zipPath = Join-Path (Split-Path $scriptDir -Parent) $zipName

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
  Write-Host "  [DEL] Da xoa ban cu: $zipName" -ForegroundColor DarkGray
}

$excludeNames = @("generate-icons.js", "pack-extension.ps1")
$tempDir = Join-Path $env:TEMP "mediafetch_ext_pack"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Get-ChildItem $scriptDir -Recurse | Where-Object {
  -not $_.PSIsContainer -and ($excludeNames -notcontains $_.Name)
} | ForEach-Object {
  $relativePath = $_.FullName.Substring($scriptDir.Length + 1)
  $destPath = Join-Path $tempDir $relativePath
  $destDir = Split-Path $destPath -Parent
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
  Copy-Item $_.FullName -Destination $destPath
}

Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
Remove-Item $tempDir -Recurse -Force

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1024, 1)
Write-Host "  [ZIP] Da tao: $zipName ($zipSize KB)" -ForegroundColor Cyan
Write-Host "  [LOC] Duong dan: $zipPath" -ForegroundColor DarkGray

# --- Huong dan cai dat ---
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Huong dan Nap Extension vao Chrome:" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Cach 1 - Load Unpacked (Development):" -ForegroundColor White
Write-Host "    1. Mo Chrome -> Gõ vao dia chi: chrome://extensions" -ForegroundColor Gray
Write-Host "    2. Bat cong tac 'Developer mode' (goc tren phai)" -ForegroundColor Gray
Write-Host "    3. Click 'Load unpacked'" -ForegroundColor Gray
Write-Host "    4. Chon thu muc: $scriptDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Cach 2 - Cai tu ZIP:" -ForegroundColor White
Write-Host "    Keo tha file $zipName vao trang chrome://extensions" -ForegroundColor Gray
Write-Host ""
Write-Host "  [OK] Sau khi cai: Icon MediaFetch se xuat hien tren toolbar" -ForegroundColor Green
Write-Host ""
