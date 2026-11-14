import { createWorker, OEM, PSM } from 'tesseract.js';
import { withCancellation } from './cancellation';
export interface OcrResult {
  text: string;
  seconds: number;
}
export type ReceiptOcrMode = 'receipt' | 'amount';
/** One disposable worker per scan. No language cache, image files, or OCR-text logging. */
export async function recognizeReceipt(
  image: Blob,
  signal: AbortSignal,
  progress: (status: string, value: number) => void,
  mode: ReceiptOcrMode = 'receipt',
): Promise<OcrResult> {
  const started = performance.now();
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const abort = () => {
    if (worker) void worker.terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    const initializing = createWorker(mode === 'amount' ? ['eng'] : ['jpn', 'eng'], OEM.LSTM_ONLY, {
      workerPath: new URL('/ocr/offline-worker.js', location.href).href,
      corePath: new URL('/ocr/core', location.href).href,
      langPath: new URL('/ocr/lang', location.href).href,
      workerBlobURL: false,
      gzip: false,
      cacheMethod: 'none',
      logger: (m) => {
        if (!signal.aborted) progress(m.status, m.progress);
      },
      errorHandler: () => {
        /* Error is returned to the caller; never log receipt content. */
      },
    });
    // createWorker exposes its handle after initialization; cancel immediately in the UI,
    // then terminate a late initialized worker before it can receive an image.
    void initializing.then(
      (w) => {
        if (signal.aborted) void w.terminate();
      },
      () => {},
    );
    worker = await withCancellation(initializing, signal);
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    await withCancellation(
      worker.setParameters({
        tessedit_pageseg_mode: mode === 'amount' ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      }),
      signal,
    );
    const result = await withCancellation(worker.recognize(image, {}, { text: true }), signal);
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    return { text: result.data.text, seconds: (performance.now() - started) / 1000 };
  } finally {
    signal.removeEventListener('abort', abort);
    await worker?.terminate();
  }
}
