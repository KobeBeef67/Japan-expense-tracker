# Build and run on a Windows PC

This guide starts from a clean source checkout. Personal workbooks, transactions, photos, and private reports are not required and are not included in the repository.

For a walkthrough of how the code fits together, read [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Install the required tools

| Tool                            | What to install                                                                                              | Why it is needed                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Git                             | [Git for Windows](https://git-scm.com/downloads/win), if cloning                                             | Download and version the source   |
| Node.js                         | [An LTS release](https://nodejs.org/en/download) satisfying **Node 22.12 or newer**                          | npm, Svelte, TypeScript, and Vite |
| Rust                            | [rustup](https://rustup.rs/), using the stable **MSVC** Windows toolchain                                    | Compile the Tauri backend         |
| Microsoft C++ Build Tools       | Visual Studio Build Tools with **Desktop development with C++**, MSVC x64/x86 tools, and a Windows 10/11 SDK | Link the Windows executable       |
| Microsoft Edge WebView2 Runtime | [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/), if not already installed         | Render the desktop UI             |

The C++ tools and WebView2 requirements follow the [official Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/). Python is optional; it is not needed to build or run the app.

After installation, reopen PowerShell so PATH changes take effect. Check the tools:

```powershell
node --version
npm.cmd --version
rustc --version
cargo --version
```

If rustup selected a GNU toolchain, switch to MSVC:

```powershell
rustup default stable-x86_64-pc-windows-msvc
```

The supported release target for this project is Windows x64. Cross-platform releases have not been verified.

## 2. Get the source

Download/extract a source archive, or clone the repository once it has a remote. Replace the example URL below with that remote:

```powershell
git clone "YOUR_REPOSITORY_URL" expense-tracker
Set-Location expense-tracker
```

Run subsequent commands in the project root, where `package.json` and `src-tauri` are located. A normal checkout does not include `.tools`, `node_modules`, a compiled executable, or private data.

## 3. Install JavaScript dependencies

```powershell
npm.cmd ci
```

`npm ci` installs the versions recorded in `package-lock.json`. Do not replace it with a dependency upgrade just to get started. Rust dependencies are fetched automatically on the first native build.

Internet access is needed to install development dependencies. The compiled application uses local JSON and bundled OCR assets and does not require an internet connection for normal use.

## 4. Run the desktop app during development

Close other running instances of Expense Tracker first, then run:

```powershell
npm.cmd run desktop
```

This starts Vite on port **1420** and launches the Tauri desktop window. Source changes refresh/rebuild the appropriate part of the app. Stop development with `Ctrl+C` in its terminal.

The native app uses the directory beside its executable for financial data. With the default development target, this is normally:

```text
src-tauri/target/debug/data/
```

The exact location is shown in the app. It is separate from `ExpenseTracker/data` used by the working portable release. If `CARGO_TARGET_DIR` is customized, the executable and its adjacent data move accordingly.

`npm.cmd run dev` starts only the browser preview. That preview intentionally has volatile in-memory state; use `npm.cmd run desktop` to exercise native saves, backups, and restore.

## 5. Build a portable release

```powershell
npm.cmd run package
```

This checks/builds the frontend and compiles the optimized Windows executable. The first native build can take several minutes while Rust dependencies compile.

Output:

```text
src-tauri/target/release/ExpenseTracker.exe
```

Copy the executable into a writable folder outside Program Files. Opening it creates an adjacent `data` directory. Keep that directory with the executable when moving the portable app. The executable is unsigned; running it does not require Node.js, Rust, or a development server, but it does require WebView2.

### Optional: update the project's working portable folder

Instead of building with `npm run package` directly, you can run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

This script:

1. Builds the release.
2. Acquires the existing data-folder lock; it stops if the working app is open.
3. Backs up existing working data and executable under `development-backups`.
4. Copies the new executable/docs/licenses into `ExpenseTracker` without replacing financial JSON.

The `-ExecutionPolicy Bypass` setting applies to this PowerShell process; it is not a persistent change to the PC's execution policy. Read scripts before running them.

### Optional: create a distribution ZIP

After a successful release build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1
```

The script creates a fresh staging folder and `releases/ExpenseTracker-<version>-portable.zip` using an explicit file allowlist. It does not copy the working runtime data directory.

If a private workbook was present in `public` during the build, its contents are embedded in the executable. Such a binary/ZIP remains private even without a `data` folder.

## 6. Run checks

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
```

- Vitest covers arithmetic, synthetic workbook import/reconciliation, receipt extraction, image limits, tag operations, and cancellation.
- The frontend build runs Svelte/TypeScript checks before Vite.
- Rust tests cover storage, recovery, locking, migration, and restore. They use an optional ignored private fixture locally, or synthetic data in a clean checkout.

No personal files are needed. Camera/real-receipt verification is separate: synthetic tests cannot prove your webcam's focus or recognition quality. Camera permission is requested only after you deliberately start it in the scanner.

### Optional OCR benchmark

```powershell
node scripts/test-ocr.mjs
```

This reads the bundled synthetic images and local language models. It does not access a camera or read private receipt photos. Results go to ignored `test-results`.

### Optional headless UI checks

Install Playwright separately without modifying the lockfile, then run the UI checks after building the frontend:

```powershell
npm.cmd install --no-save --package-lock=false playwright
npm.cmd run build
node scripts/test-ui.mjs
```

The script launches installed Microsoft Edge headlessly. It uses a simulated camera and mocked transaction persistence, not physical camera access or your working ledger. If Edge is missing, install it or intentionally change the script's browser configuration. `RUNTIME_NODE_MODULES` can point to an existing Playwright module directory.

## 7. Keep formatting consistent

```powershell
npm.cmd run format
npm.cmd run format:check

rustup component add rustfmt
npm.cmd run format:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

`.editorconfig`, `.prettierrc.json`, and `rustfmt.toml` define project conventions. The formatter's explicit file list and `.prettierignore` keep private data, generated build output, and third-party OCR bundles untouched.

The two optional Python utilities use Black formatting. To edit/regenerate those utilities/fixtures, create a Python virtual environment and install Black/Pillow there. Pillow/font availability is needed only to regenerate synthetic images; the committed PNGs are already ready to use.

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install black pillow
.\.venv\Scripts\python.exe -m black scripts/inspect_workbook.py scripts/make-receipt-fixtures.py
```

## Optional local workbook

No workbook is shipped in Git. External selection accepts the specific legacy layout supported by `src/lib/importer.ts`; arbitrary spreadsheets are not supported automatically.

For a personal build with included-workbook preview, put a private copy at `public/Japan expenses.xlsx`. Git ignores it, but the release embeds it. Keep the original workbook unchanged and never force-add private workbooks, data, photos, binaries, or archives.

## Troubleshooting

| Symptom                                           | Check                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node`, `npm`, or `cargo` not found               | Reopen PowerShell; confirm the installer added the tool to PATH                                                                                                                |
| `npm.ps1` cannot run                              | Use the documented `npm.cmd` commands                                                                                                                                          |
| Vite reports an unsupported Node version          | Check `node --version`; use a supported version meeting the project's Vite requirement                                                                                         |
| Linker/Windows resource errors                    | Install the C++ desktop workload and Windows SDK; verify Rust is using MSVC                                                                                                    |
| Desktop window cannot start                       | Confirm WebView2 is installed and the executable folder is writable                                                                                                            |
| Port 1420 is occupied                             | Stop the other Vite/dev process before starting this project                                                                                                                   |
| Existing app opens instead of the dev window      | Close other instances; the application has single-instance protection                                                                                                          |
| Deployment says the data folder is open           | Close the working app yourself, then rerun the deployment script                                                                                                               |
| Included-workbook preview is unavailable          | A clean checkout has no private workbook; use external selection or add a local ignored copy                                                                                   |
| Camera unavailable or permission denied           | Choose an image instead; handle camera permissions yourself in Windows                                                                                                         |
| OCR is inaccurate                                 | Review/correct fields; check focus, lighting, framing, and actual capture resolution. Use supported focus controls; unavailable controls depend on your camera/driver/WebView2 |
| Save reports an external change/revision conflict | Preserve files, close the app, and reopen to reload state; do not overwrite data to dismiss the warning                                                                        |

## Camera and long-receipt checks (v1.2)

Use a separate portable folder for hardware testing. No automated test proves your actual webcam works.

1. Start camera yourself and grant permission. Check the reported capture resolution and sharpness.
2. If available, switch focus modes, use Refocus once, or choose manual mode and adjust focus distance. Adjust exposure/brightness as needed. Check confirmation messages and the actual preview. Click the preview for a focus-area request only if supported.
3. Capture the receipt date, choose Add camera photo, then capture the total. You can instead select multiple JPEG/PNG files. Keep photos from the same receipt together.
4. Select each numbered photo to inspect it; rotate or remove as needed. Recognize offline processes all photos into one draft. Check the date and total against the photos. Conflicts remain unresolved, and totals are never added together.
5. Confirm once to save one transaction, or close to discard all photos. Images and full recognized text are not written to ledger JSON.

Limits: six photos per receipt, 60 MB aggregate prepared images, plus the existing per-photo size/dimension limits. Camera controls depend on what the device exposes; fixed-focus hardware cannot be made autofocus through software.

## Crop a captured receipt (v1.2.1)

After Capture photo or choosing a file, select its numbered photo and choose **Crop selected photo**. Drag a rectangle around the date, total, or receipt text; percentage inputs provide keyboard control. Choose **Amount only (one line)** for an isolated price, otherwise leave **Receipt text / date** selected. Apply crop, then Recognize offline. One distinct candidate automatically fills the amount field. Multiple different unlabelled amounts remain unresolved; a unique labelled total keeps priority. Repeated copies of the same value across photos count as one candidate, never a sum. All values remain editable and require review before saving.

Cancel crop preserves the current draft and photo. Restore full photo resets cropping and rotation. Applying a crop clears previous recognition/review fields so they cannot be saved as stale results. All originals and edits stay in memory within the 60 MB review limit; finishing or closing discards them. Receipt/date crops keep the selected pixels without padding. Amount-only crops receive a 20-pixel white margin; neither mode enlarges the text. Version 1.2.2 fixes a date-recognition regression caused by adding that margin to grey-paper date crops.

## Verify clipboard paste (v1.3)

In the separate test build, copy an image with Windows Snipping Tool or another app, open Scan receipt, and press Ctrl+V. Check the preview, crop if needed, then Recognize offline. Paste a second image to combine receipt sections. Try Paste image too; grant any clipboard permission yourself. If the button is unsupported or denied, use Ctrl+V or file selection. Plain text should still paste into description/amount fields normally.

The automated tests use synthetic clipboard objects/events and never inspect or replace your real Windows clipboard. Actual Windows/WebView2 clipboard integration therefore remains a user-run check. Clipboard provenance is supported from v1.3 onward; earlier executables cannot validate that input value.
