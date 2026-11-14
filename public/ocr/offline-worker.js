// Fail closed: receipt workers can load only this app's bundled OCR assets.
// No camera pixels or OCR text can be sent to a remote origin by this worker.
const localOrigin = self.location.origin;
const allowed = value => {
  const url = new URL(typeof value === 'string' ? value : value.url, self.location.href);
  // The selected core embeds its own WASM as a data URI. This fetch is memory-only.
  if (url.protocol === 'data:' && /^data:application\/(?:octet-stream|wasm);base64,/.test(url.href)) return url.href;
  if (url.origin !== localOrigin || !url.pathname.startsWith('/ocr/')) throw new Error(`OCR remote/resource access blocked: ${url.protocol} ${url.host} ${url.protocol === 'data:' ? 'embedded asset' : url.pathname}`);
  return url.href;
};
const localFetch = self.fetch.bind(self);
self.fetch = (input, init) => localFetch(allowed(input), init);
const localImport = self.importScripts.bind(self);
self.importScripts = (...urls) => localImport(...urls.map(allowed));
self.importScripts('/ocr/worker.min.js');
