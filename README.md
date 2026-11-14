# Expense Tracker

Portable Windows expense tracker using Tauri 2, Svelte 5, TypeScript, and local JSON files. No runtime server, account, SQLite, cloud OCR, or external AI API is required.

## Features

- Monthly/history views, fast keyboard entry, restricted arithmetic, whole-yen rounding, editable categories, autocomplete, duplicate entry, and undo.
- Offline Japanese/English receipt OCR with camera/image input and mandatory manual review.
- Multiple tags, collection spending totals, bulk changes, rename/merge/removal, and any/all tag filters.
- Autosave, atomic replacement, revision checks, file locking, dated backups, restore, and CSV export.
- A fixed-layout legacy workbook importer preserving provenance, reporting month, undated entries, and unresolved amounts.

## Privacy boundary

This repository contains source, dependency lockfiles, public OCR models/licenses, generated icons, and **synthetic** receipt fixtures. It excludes personal workbooks, financial JSON, backups, exports, real receipt photos, private reports/handoffs, diagnostic output, toolchains, and build artifacts.

Executables and release archives are excluded too: a local build can embed a private workbook. The original local files remain on disk; `.gitignore` excludes them from version control. Do not force-add ignored files. Review the staged diff and assets again before any future publication.

## Run and build

Requirements: Windows x64, Microsoft Edge WebView2, Node.js 22+, stable Rust MSVC, and Microsoft C++ Build Tools with Windows SDK.

```powershell
npm.cmd ci
npm.cmd run desktop

# Build the portable executable:
npm.cmd run package
```

Output: `src-tauri/target/release/ExpenseTracker.exe`. The packaged app needs no development server or Node/Rust installation.

`scripts/build.ps1` can use an optional local Rust toolchain under `.tools`. Close the working app first; the script backs up existing data/binary before copying the new executable and preserves financial JSON. Private documentation is copied only when present.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

`scripts/package-portable.ps1` stages a release with an explicit file allowlist, without working runtime data. A binary built with a private workbook embedded is still private even if no `data` directory is packaged.

## Data and accounting

The app uses `data/transactions.json`, `data/settings.json`, and `data/backups` beside its executable, independent of the working directory. Use a writable folder outside Program Files and move the complete portable folder together.

Ledger schema 2 uses stable transaction IDs, a central tag registry, and per-transaction tag IDs. Legacy trip labels migrate with a pre-migration backup; old backups migrate during restore. Future schemas are refused rather than overwritten.

Amounts are whole nonnegative yen; transaction type controls accounting direction. Expressions use exact rational arithmetic and round exact halves away from zero. Unknown amounts remain null; undated entries retain their reporting month.

Savings = salary + other income + refunds − expenses, with no opening bank balance. Collection net spending = expenses − refunds; other income/salary are shown separately.

## Offline OCR

Tesseract.js, its WASM core, and Japanese/English LSTM resources are bundled locally in `public/ocr`, with model versions, hashes, and licenses. `scripts/prepare-ocr.mjs` prepares installed assets before development/build and makes no downloads.

The camera starts after a deliberate action and requests video only. Images and complete OCR text remain in memory for review and are not intentionally saved. Every receipt requires confirmation. Webcam focus, lighting, framing, and resolution affect recognition. JPEG/PNG fallback is available; the current camera UI does not expose optical focus controls.

`public/receipt-fixtures` contains generated examples, not real receipts or proof of webcam accuracy. Hardware verification remains separate from synthetic tests.

## Optional private workbook

No workbook is included. External selection remains available for the supported legacy layout. Included-workbook preview requires an optional local `public/Japan expenses.xlsx`, which is ignored and will be embedded in a local build if present. The importer is not a generic spreadsheet synchronizer.

An original private regression suite can remain locally as ignored `src/lib/private-workbook.test.ts`. Public importer tests instead generate fictional workbooks in memory. Native history tests use an optional ignored local ledger fixture when available, otherwise synthetic data.

## Checks

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/test-ocr.mjs
```

Core tests require no personal files. Headless UI checks use Playwright, mocked persistence, and a simulated camera, without desktop control. Install Playwright or set `RUNTIME_NODE_MODULES` to its module root before running `node scripts/test-ui.mjs`. Native storage is tested separately in Rust.

## Source map

| Path | Responsibility |
|---|---|
| `src/App.svelte` | Main UI and save/undo orchestration |
| `src/components/ReceiptScanner.svelte` | Capture, recognition, review, cleanup |
| `src/components/TagSelector.svelte` | Shared tag selection |
| `src/lib/arithmetic.ts` | Restricted expressions and rounding |
| `src/lib/importer.ts` | Legacy workbook import/reconciliation |
| `src/lib/receipt-*.ts` | Images, OCR, and field extraction |
| `src/lib/tags.ts` | Tag operations, matching, spending totals |
| `src-tauri/src/storage.rs` | Native persistence, recovery, backups |
| `src-tauri/src/migration.rs` | Migration and tag/receipt validation |

See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and the bundled OCR notices for dependencies and third-party licensing.
