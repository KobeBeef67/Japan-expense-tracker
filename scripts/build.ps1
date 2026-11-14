$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
if (Test-Path -LiteralPath "$taskRoot/.tools/cargo/bin/cargo.exe") {
    $env:CARGO_HOME = "$taskRoot/.tools/cargo"
    $env:RUSTUP_HOME = "$taskRoot/.tools/rustup"
    $env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
}
& npm.cmd run package
if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed' }
$portableDir = Join-Path $taskRoot 'ExpenseTracker'
New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
$taskLock = $null
try {
if (Test-Path -LiteralPath "$portableDir/data/transactions.json") {
    $taskLock = [System.IO.File]::Open("$portableDir/data/.lock", [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
    try { $taskLock.Lock(0, 1) } catch { throw 'Close the working Expense Tracker app before deployment. The new build is ready in src-tauri/target/release.' }
    $taskBackupDir = Join-Path $taskRoot ('development-backups/deploy-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
    New-Item -ItemType Directory -Force -Path $taskBackupDir | Out-Null
    Copy-Item -LiteralPath "$portableDir/data" -Destination $taskBackupDir -Recurse
    if (Test-Path -LiteralPath "$portableDir/ExpenseTracker.exe") { Copy-Item -LiteralPath "$portableDir/ExpenseTracker.exe" -Destination "$taskBackupDir/ExpenseTracker.exe" }
    Write-Host "Pre-deployment backup: $taskBackupDir"
}
Copy-Item -LiteralPath "$taskRoot/src-tauri/target/release/ExpenseTracker.exe" -Destination "$portableDir/ExpenseTracker.exe"
Copy-Item -LiteralPath "$taskRoot/README.md" -Destination "$portableDir/README.md"
foreach ($taskDoc in @('RECONCILIATION.md', 'VERIFICATION.md', 'RECEIPTS-TAGS-IMPLEMENTATION.md', 'MANUAL-RECEIPT-CHECK.md')) {
    if (Test-Path -LiteralPath (Join-Path $taskRoot $taskDoc)) { Copy-Item -LiteralPath (Join-Path $taskRoot $taskDoc) -Destination (Join-Path $portableDir $taskDoc) }
}
if (-not (Test-Path -LiteralPath "$portableDir/START-HERE.txt")) { Copy-Item -LiteralPath "$taskRoot/resources/START-HERE.txt" -Destination "$portableDir/START-HERE.txt" }
$taskLicenseDir = Join-Path $portableDir 'licenses'
New-Item -ItemType Directory -Force -Path $taskLicenseDir | Out-Null
Copy-Item -LiteralPath "$taskRoot/public/ocr/TESSERACT-JS-LICENSE.txt" -Destination "$taskLicenseDir/TESSERACT-JS-LICENSE.txt"
Copy-Item -LiteralPath "$taskRoot/public/ocr/core/LICENSE" -Destination "$taskLicenseDir/TESSERACT-CORE-LICENSE.txt"
Copy-Item -LiteralPath "$taskRoot/public/ocr/lang/LICENSE" -Destination "$taskLicenseDir/TESSDATA-LICENSE.txt"
Copy-Item -LiteralPath "$taskRoot/public/ocr/NOTICE.md" -Destination "$taskLicenseDir/OCR-NOTICE.md"
Copy-Item -LiteralPath "$taskRoot/public/ocr/worker.min.js.LICENSE.txt" -Destination "$taskLicenseDir/worker.min.js.LICENSE.txt"
if (Test-Path -LiteralPath "$taskRoot/public/ocr/licenses") {
    Copy-Item -Path "$taskRoot/public/ocr/licenses/*" -Destination $taskLicenseDir -Recurse
}
Write-Host "Built $portableDir/ExpenseTracker.exe. Existing data was preserved."
} finally {
    if ($null -ne $taskLock) { $taskLock.Dispose() }
}
