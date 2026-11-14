# Build and update the working portable app, with a recoverable deployment backup.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot

# A normal developer install uses cargo on PATH. This optional local toolchain is ignored by Git.
if (Test-Path -LiteralPath "$taskRoot/.tools/cargo/bin/cargo.exe") {
    $env:CARGO_HOME = "$taskRoot/.tools/cargo"
    $env:RUSTUP_HOME = "$taskRoot/.tools/rustup"
    $env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
}

& npm.cmd run package
if ($LASTEXITCODE -ne 0) {
    throw 'Tauri build failed'
}

$portableDir = Join-Path $taskRoot 'ExpenseTracker'
New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
$taskLock = $null

try {
    # Use the same lock file as the app, so data cannot change during the backup/copy.
    if (Test-Path -LiteralPath "$portableDir/data/transactions.json") {
        $taskLock = [System.IO.File]::Open(
            "$portableDir/data/.lock",
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::ReadWrite
        )

        try {
            $taskLock.Lock(0, 1)
        } catch {
            throw 'Close the working Expense Tracker app before deployment. The new build is ready in src-tauri/target/release.'
        }

        $taskStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff')
        $taskBackupDir = Join-Path $taskRoot "development-backups/deploy-$taskStamp"
        New-Item -ItemType Directory -Force -Path $taskBackupDir | Out-Null
        Copy-Item -LiteralPath "$portableDir/data" -Destination $taskBackupDir -Recurse

        if (Test-Path -LiteralPath "$portableDir/ExpenseTracker.exe") {
            Copy-Item -LiteralPath "$portableDir/ExpenseTracker.exe" `
                -Destination "$taskBackupDir/ExpenseTracker.exe"
        }
        Write-Host "Pre-deployment backup: $taskBackupDir"
    }

    # Replace only the executable/docs; leave the working financial JSON in place.
    Copy-Item -LiteralPath "$taskRoot/src-tauri/target/release/ExpenseTracker.exe" `
        -Destination "$portableDir/ExpenseTracker.exe"
    Copy-Item -LiteralPath "$taskRoot/README.md" -Destination "$portableDir/README.md"

    $taskOptionalDocs = @(
        'RECONCILIATION.md'
        'VERIFICATION.md'
        'RECEIPTS-TAGS-IMPLEMENTATION.md'
        'MANUAL-RECEIPT-CHECK.md'
    )
    foreach ($taskDoc in $taskOptionalDocs) {
        $taskDocPath = Join-Path $taskRoot $taskDoc
        if (Test-Path -LiteralPath $taskDocPath) {
            Copy-Item -LiteralPath $taskDocPath -Destination (Join-Path $portableDir $taskDoc)
        }
    }
    if (-not (Test-Path -LiteralPath "$portableDir/START-HERE.txt")) {
        Copy-Item -LiteralPath "$taskRoot/resources/START-HERE.txt" `
            -Destination "$portableDir/START-HERE.txt"
    }

    # The executable embeds OCR assets. Ship their readable license texts alongside it as well.
    $taskLicenseDir = Join-Path $portableDir 'licenses'
    New-Item -ItemType Directory -Force -Path $taskLicenseDir | Out-Null
    $taskLicenseFiles = @{
        'public/ocr/TESSERACT-JS-LICENSE.txt' = 'TESSERACT-JS-LICENSE.txt'
        'public/ocr/core/LICENSE' = 'TESSERACT-CORE-LICENSE.txt'
        'public/ocr/lang/LICENSE' = 'TESSDATA-LICENSE.txt'
        'public/ocr/NOTICE.md' = 'OCR-NOTICE.md'
        'public/ocr/worker.min.js.LICENSE.txt' = 'worker.min.js.LICENSE.txt'
    }
    foreach ($taskSource in $taskLicenseFiles.Keys) {
        Copy-Item -LiteralPath (Join-Path $taskRoot $taskSource) `
            -Destination (Join-Path $taskLicenseDir $taskLicenseFiles[$taskSource])
    }
    if (Test-Path -LiteralPath "$taskRoot/public/ocr/licenses") {
        Copy-Item -Path "$taskRoot/public/ocr/licenses/*" -Destination $taskLicenseDir -Recurse
    }

    Write-Host "Built $portableDir/ExpenseTracker.exe. Existing data was preserved."
} finally {
    # Disposing releases the OS lock even when a copy or backup fails.
    if ($null -ne $taskLock) {
        $taskLock.Dispose()
    }
}
