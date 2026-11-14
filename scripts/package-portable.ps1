# Stage a distributable from an explicit allowlist, never from the working data folder.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot

$taskVersion = (Get-Content -LiteralPath "$taskRoot/package.json" -Raw | ConvertFrom-Json).version
$taskStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff')
$taskStaging = Join-Path $taskRoot "releases/staging-$taskVersion-$taskStamp"
$taskPortable = Join-Path $taskStaging 'ExpenseTracker'
New-Item -ItemType Directory -Force -Path $taskPortable | Out-Null

# A fresh staging directory cannot accidentally inherit an old portable ledger.
Copy-Item -LiteralPath "$taskRoot/src-tauri/target/release/ExpenseTracker.exe" `
    -Destination "$taskPortable/ExpenseTracker.exe"
Copy-Item -LiteralPath "$taskRoot/README.md" -Destination "$taskPortable/README.md"
Copy-Item -LiteralPath "$taskRoot/resources/START-HERE.txt" `
    -Destination "$taskPortable/START-HERE.txt"

$taskLicenseDir = Join-Path $taskPortable 'licenses'
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
Copy-Item -Path "$taskRoot/public/ocr/licenses/*" -Destination $taskLicenseDir

$taskZip = Join-Path $taskRoot "releases/ExpenseTracker-$taskVersion-portable.zip"
Compress-Archive -LiteralPath $taskPortable -DestinationPath $taskZip -Force
Write-Host "Packaged $taskZip without runtime financial data. The executable still embeds the private workbook."
