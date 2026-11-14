$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskVersion = (Get-Content -LiteralPath "$taskRoot/package.json" -Raw | ConvertFrom-Json).version
$taskStaging = Join-Path $taskRoot ('releases/staging-' + $taskVersion + '-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
$taskPortable = Join-Path $taskStaging 'ExpenseTracker'
New-Item -ItemType Directory -Force -Path $taskPortable | Out-Null
# Explicit allowlist: never recursively package the working portable directory or data.
Copy-Item -LiteralPath "$taskRoot/src-tauri/target/release/ExpenseTracker.exe" -Destination "$taskPortable/ExpenseTracker.exe"
foreach ($taskDoc in @('README.md')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot $taskDoc) -Destination (Join-Path $taskPortable $taskDoc)
}
Copy-Item -LiteralPath "$taskRoot/resources/START-HERE.txt" -Destination "$taskPortable/START-HERE.txt"
$taskLicenseDir = Join-Path $taskPortable 'licenses'
New-Item -ItemType Directory -Force -Path $taskLicenseDir | Out-Null
Copy-Item -LiteralPath "$taskRoot/public/ocr/TESSERACT-JS-LICENSE.txt" -Destination "$taskLicenseDir/TESSERACT-JS-LICENSE.txt"
Copy-Item -LiteralPath "$taskRoot/public/ocr/core/LICENSE" -Destination "$taskLicenseDir/TESSERACT-CORE-LICENSE.txt"
Copy-Item -LiteralPath "$taskRoot/public/ocr/lang/LICENSE" -Destination "$taskLicenseDir/TESSDATA-LICENSE.txt"
Copy-Item -LiteralPath "$taskRoot/public/ocr/NOTICE.md" -Destination "$taskLicenseDir/OCR-NOTICE.md"
Copy-Item -LiteralPath "$taskRoot/public/ocr/worker.min.js.LICENSE.txt" -Destination "$taskLicenseDir/worker.min.js.LICENSE.txt"
Copy-Item -Path "$taskRoot/public/ocr/licenses/*" -Destination $taskLicenseDir
$taskZip = Join-Path $taskRoot "releases/ExpenseTracker-$taskVersion-portable.zip"
Compress-Archive -LiteralPath $taskPortable -DestinationPath $taskZip -Force
Write-Host "Packaged $taskZip without runtime financial data. The executable still embeds the private workbook."
