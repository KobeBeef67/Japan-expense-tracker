# Offline OCR resources

All resources in this directory are packaged locally. No runtime CDN is used.

- Tesseract.js 6.0.1: https://github.com/naptha/tesseract.js — Apache-2.0; see TESSERACT-JS-LICENSE.txt.
- Tesseract.js-core: version and hashes in manifest.json; https://github.com/naptha/tesseract.js-core — Apache-2.0; see core/LICENSE. WASM is included inside the four `.wasm.js` builds to avoid a second binary fetch.
- Japanese and English LSTM models: https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0 — Apache-2.0; see lang/LICENSE.

Bundled worker dependencies also include MIT/BSD/Apache components. See `worker.min.js.LICENSE.txt`, `tesseract.min.js.LICENSE.txt`, and `licenses/` for retained copyright/license texts, including buffer, ieee754, regenerator, zlib.js, wasm-feature-detect, and Leptonica.

`scripts/prepare-ocr.mjs` copies the installed worker/core and checks vendored language files. It performs no downloads. `manifest.json` records bundled versions, sizes, and SHA-256 hashes.
