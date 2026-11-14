import { createWorker, OEM, PSM } from 'tesseract.js';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
const start = performance.now();
const worker = await createWorker(['jpn', 'eng'], OEM.LSTM_ONLY, {
  langPath: 'public/ocr/lang',
  gzip: false,
  cacheMethod: 'none',
  logger: () => {},
  errorHandler: () => {},
});
const coldStartSeconds = (performance.now() - start) / 1000,
  results = [];
try {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    user_defined_dpi: '300',
    preserve_interword_spaces: '1',
  });
  for (const name of ['japanese', 'english', 'mixed']) {
    const t = performance.now();
    const result = await worker.recognize(`public/receipt-fixtures/${name}.png`);
    results.push({
      fixture: name,
      seconds: (performance.now() - t) / 1000,
      text: result.data.text,
    });
  }
} finally {
  await worker.terminate();
}
const report = {
  environment:
    'Node worker, bundled Japanese/English models; synthetic fixtures only. Packaged WebView2 verification is separate.',
  coldStartSeconds,
  results,
  processPeakRssMiB: process.resourceUsage().maxRSS / 1024,
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/ocr-benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
