// Headless tests only: no physical camera access, desktop input, or live financial data.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve('playwright', {
    paths: [
      process.cwd(),
      process.env.RUNTIME_NODE_MODULES ||
        'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules',
    ],
  }),
);
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve('dist', '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(path.resolve('dist') + path.sep)) throw new Error('Outside assets');
    const bytes = await readFile(target);
    res.setHeader(
      'Content-Type',
      target.endsWith('.js')
        ? 'text/javascript'
        : target.endsWith('.css')
          ? 'text/css'
          : target.endsWith('.html')
            ? 'text/html'
            : target.endsWith('.png')
              ? 'image/png'
              : 'application/octet-stream',
    );
    res.setHeader('Content-Security-Policy', config.app.security.csp);
    res.setHeader('Cache-Control', 'no-store');
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const issues = [];
page.on('pageerror', (error) => issues.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') issues.push(message.text().slice(0, 500));
});
await context.route('**/*', (route) =>
  route.request().url().startsWith(origin) ? route.continue() : route.abort(),
);
await page.addInitScript(() => {
  const row = (id, type, amount, description, tagIds = []) => ({
    id,
    type,
    amount,
    description,
    tagIds,
    month: '2026-11',
    date: '2026-11-14',
    category: 'Food',
    notes: 'keep',
    flags: [],
  });
  window.testLedger = {
    schemaVersion: 2,
    revision: 0,
    tags: [{ id: 'travel', name: 'Travel' }],
    transactions: [
      row('a', 'expense', 100, 'Meal A', ['travel']),
      row('b', 'refund', 25, 'Refund B', ['travel']),
      row('c', 'income', 500, 'Sale C', ['travel']),
      row('d', 'expense', null, 'Unknown D', ['travel']),
    ],
    deletedSourceIds: [],
    imports: [],
  };
  window.testSaves = 0;
  window.failNextSave = false;
  window.lastExport = '';
  window.cameraMode = 'deny';
  window.cameraRequests = [];
  window.fakeTracks = [];
  window.clipboardMode = 'image';
  window.clipboardReads = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    get: () => ({
      read:
        window.clipboardMode === 'unavailable'
          ? undefined
          : async () => {
              window.clipboardReads++;
              if (window.clipboardMode === 'denied')
                throw new DOMException('Synthetic denial', 'NotAllowedError');
              if (window.clipboardMode === 'empty') return [];
              if (window.clipboardMode === 'hold')
                return new Promise((resolve) => {
                  window.resolveClipboard = resolve;
                });
              const image = await (await fetch('/receipt-fixtures/english.png')).blob();
              return [
                {
                  types: ['image/png', 'text/html'],
                  getType: async (type) => {
                    if (type !== 'image/png')
                      throw new Error('Unexpected clipboard representation');
                    return image;
                  },
                },
              ];
            },
    }),
  });
  window.cameraChanges = [];
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      if (cmd === 'load')
        return {
          ledger: structuredClone(window.testLedger),
          settings: { schemaVersion: 1, categories: ['Food', 'Housing', 'Transport', 'Shopping'] },
          path: 'isolated test data',
          recovery: '',
        };
      if (cmd === 'save') {
        if (window.failNextSave) {
          window.failNextSave = false;
          throw new Error('Synthetic disk-full failure');
        }
        if (args.expected !== window.testLedger.revision) throw new Error('Revision conflict');
        window.testLedger = { ...structuredClone(args.ledger), revision: args.expected + 1 };
        window.testSaves++;
        return structuredClone(window.testLedger);
      }
      if (cmd === 'export_csv') {
        window.lastExport = args.csv;
        return 'synthetic-export.csv';
      }
      if (cmd === 'backups') return [];
      throw new Error(`Unexpected command: ${cmd}`);
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'fake1', label: 'Synthetic camera' },
        { kind: 'videoinput', deviceId: 'fake2', label: 'Second synthetic camera' },
      ],
      getUserMedia: async (constraints) => {
        window.cameraRequests.push(constraints);
        if (window.cameraMode === 'deny')
          throw new DOMException('Synthetic denial', 'NotAllowedError');
        if (window.cameraMode === 'busy')
          throw new DOMException('Synthetic busy', 'NotReadableError');
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 1100;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 900, 1100);
        ctx.fillStyle = 'black';
        ctx.font = '40px sans-serif';
        ctx.fillText('SYNTHETIC CAMERA', 60, 100);
        ctx.fillText('2026-11-14', 60, 200);
        ctx.fillText('TOTAL 1280', 60, 300);
        const stream = canvas.captureStream(10);
        if (window.cameraMode === 'controls') {
          const track = stream.getVideoTracks()[0];
          let settings = {
            focusMode: 'continuous',
            exposureMode: 'continuous',
            focusDistance: 1,
            brightness: 0,
            pointsOfInterest: [],
          };
          track.getCapabilities = () => ({
            focusMode: ['continuous', 'manual', 'single-shot'],
            exposureMode: ['continuous', 'manual'],
            focusDistance: { min: 0, max: 10, step: 0.1 },
            brightness: { min: -1, max: 1, step: 0.1 },
          });
          track.getSettings = () => ({ ...settings });
          track.applyConstraints = async (constraints) => {
            window.cameraChanges.push(constraints);
            settings = { ...settings, ...constraints.advanced[0] };
          };
        }
        window.fakeTracks.push(...stream.getTracks());
        return stream;
      },
    },
  });
});
const check = async (name, fn) => {
  await fn();
  console.log(`PASS ${name}`);
};
const receiptDialog = () => page.getByRole('dialog', { name: 'Scan receipt · offline' });
try {
  await page.goto(origin);
  await page.getByText('● Saved locally', { exact: true }).waitFor();
  await check('manual entry adds multiple tags in one save', async () => {
    await page.getByLabel('Description', { exact: true }).fill('Lunch test');
    await page.getByLabel('Amount', { exact: true }).fill('15470/4');
    const input = page.getByLabel('Tags', { exact: true });
    await input.fill('Sample trip A');
    await input.press('Enter');
    await input.fill('Travel');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Add entry ↵', exact: true }).click();
    await page.waitForFunction(() => window.testLedger.transactions.length === 5);
    assert.equal(await page.evaluate(() => window.testLedger.transactions.at(-1).amount), 3868);
    assert.equal(await page.evaluate(() => window.testLedger.transactions.at(-1).tagIds.length), 2);
  });
  await check('tag view separates refunds and net spending from other income', async () => {
    await page.getByRole('button', { name: /Tags & collections/ }).click();
    await page.getByRole('button', { name: 'Travel 5', exact: true }).click();
    const stats = page.locator('.stats');
    assert.match(await stats.innerText(), /3,968/); // income and salary appear separately
    assert.match(await stats.innerText(), /3,943/);
    assert.match(await stats.innerText(), /25/);
    await page.screenshot({ path: 'test-results/tags-ui.png', fullPage: true });
  });
  await check(
    'bulk tags preserve unrelated fields and rename collisions require merge',
    async () => {
      await page.getByRole('checkbox', { name: 'Select Meal A a', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Select Refund B b', exact: true }).check();
      const bulk = page.getByLabel('Bulk tags', { exact: true });
      await bulk.fill('Trip Beta');
      await bulk.press('Enter');
      await page.getByRole('button', { name: 'Add tags to selected', exact: true }).click();
      await page.waitForFunction(() => window.testLedger.tags.some((t) => t.name === 'Trip Beta'));
      assert.equal(await page.evaluate(() => window.testLedger.transactions[0].notes), 'keep');
      assert.equal(await page.evaluate(() => window.testLedger.transactions[2].tagIds.length), 1);
      await page.getByRole('button', { name: 'Sample trip A 1', exact: true }).click();
      await page.getByLabel('Rename tag', { exact: true }).fill('TRIP BETA');
      assert.equal(
        await page.getByRole('button', { name: 'Merge tags', exact: true }).isDisabled(),
        true,
      );
      await page.getByRole('checkbox', { name: /Merge membership into/ }).check();
      await page.getByRole('button', { name: 'Merge tags', exact: true }).click();
      await page.waitForFunction(
        () => !window.testLedger.tags.some((t) => t.name === 'Sample trip A'),
      );
      assert.equal(
        await page.evaluate(() => new Set(window.testLedger.transactions.at(-1).tagIds).size),
        2,
      );
    },
  );
  await check('CSV retains JSON tag membership and undo restores merged tags', async () => {
    await page.getByRole('button', { name: 'Export filtered CSV', exact: true }).click();
    await page.waitForFunction(() => window.lastExport);
    assert.match(await page.evaluate(() => window.lastExport), /tag_names_json/);
    await page.getByRole('button', { name: 'Undo Ctrl Z', exact: true }).click();
    await page.waitForFunction(() =>
      window.testLedger.tags.some((t) => t.name === 'Sample trip A'),
    );
  });
  await page.getByRole('button', { name: /Monthly ledger/ }).click();
  await check('camera denial and busy paths recover without microphone access', async () => {
    await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
    await receiptDialog().getByRole('button', { name: 'Start camera', exact: true }).click();
    await receiptDialog()
      .getByRole('alert')
      .filter({ hasText: 'Camera access was denied' })
      .waitFor();
    await page.evaluate(() => (window.cameraMode = 'busy'));
    await receiptDialog().getByRole('button', { name: 'Retry camera', exact: true }).click();
    await receiptDialog().getByRole('alert').filter({ hasText: 'busy' }).waitFor();
    assert.equal(
      await page.evaluate(() => window.cameraRequests.every((r) => r.audio === false)),
      true,
    );
    await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
  });
  await check('synthetic camera capture releases all video tracks', async () => {
    await page.evaluate(() => (window.cameraMode = 'ok'));
    await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
    await receiptDialog().getByRole('button', { name: 'Start camera', exact: true }).click();
    await receiptDialog()
      .getByText('Focus mode: unavailable from this camera.', { exact: true })
      .waitFor();
    await receiptDialog().getByRole('button', { name: 'Capture photo', exact: true }).click();
    await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.fakeTracks.every((t) => t.readyState === 'ended')),
      true,
    );
    await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
  });
  await check(
    'exposed focus controls and spot focus apply constraints; extra capture preserves first photo',
    async () => {
      await page.evaluate(() => (window.cameraMode = 'controls'));
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Start camera', exact: true }).click();
      await receiptDialog().getByLabel('Focus mode', { exact: true }).selectOption('manual');
      await receiptDialog()
        .getByText('Camera confirmed the setting. Check sharpness in the preview.', { exact: true })
        .waitFor();
      const distance = receiptDialog().getByLabel(/Manual focus distance:/);
      assert.equal(await distance.isEnabled(), true);
      await distance.evaluate((input) => {
        input.value = '2';
      });
      await distance.dispatchEvent('change');
      await receiptDialog().getByLabel('Focus mode', { exact: true }).selectOption('continuous');
      await receiptDialog()
        .getByRole('button', { name: 'Choose focus area in camera preview' })
        .click();
      await receiptDialog()
        .getByText('Camera confirmed the selected focus area. Check sharpness.', { exact: true })
        .waitFor();
      const changes = await page.evaluate(() => window.cameraChanges);
      const overlayColor = await receiptDialog()
        .getByRole('button', { name: 'Choose focus area in camera preview' })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(overlayColor, 'rgba(0, 0, 0, 0)');
      await page.screenshot({ path: 'test-results/camera-controls-ui.png', fullPage: true });
      assert.ok(changes.some((c) => c.advanced[0].focusDistance === 2));
      assert.ok(
        changes.some((c) => Math.abs((c.advanced[0].pointsOfInterest?.[0].x ?? -1) - 0.5) < 0.01),
      );
      await receiptDialog().getByRole('button', { name: 'Capture photo', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Add camera photo', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Capture photo', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Photo 2', exact: true }).waitFor();
      await receiptDialog()
        .getByRole('button', { name: 'Remove selected photo', exact: true })
        .click();
      assert.equal(
        await receiptDialog().getByRole('button', { name: 'Photo 2', exact: true }).count(),
        0,
      );
      await receiptDialog().getByRole('button', { name: 'Rotate 90°', exact: true }).click();
      await receiptDialog()
        .getByRole('button', { name: 'Recognize offline', exact: true })
        .waitFor({ state: 'visible' });
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
      assert.ok(
        await page.evaluate(() => window.fakeTracks.every((t) => t.readyState === 'ended')),
      );
    },
  );
  await check(
    'captured photo supports reverse drag crop, cancel, keyboard crop, rotate and restore',
    async () => {
      await page.evaluate(() => (window.cameraMode = 'ok'));
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Start camera', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Capture photo', exact: true }).click();
      const preview = receiptDialog().getByAltText('Receipt being reviewed; not saved', {
        exact: true,
      });
      await preview.waitFor();
      const dimensions = () =>
        preview.evaluate(async (img) => {
          await img.decode();
          return { width: img.naturalWidth, height: img.naturalHeight };
        });
      const original = await dimensions();
      assert.deepEqual(original, { width: 900, height: 1100 });
      await receiptDialog()
        .getByRole('button', { name: 'Crop selected photo', exact: true })
        .click();
      const surface = receiptDialog().getByRole('button', {
        name: 'Drag to select crop area',
        exact: true,
      });
      await surface.waitFor();
      await surface.scrollIntoViewIfNeeded();
      const bounds = await surface.boundingBox();
      await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.8);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2, {
        steps: 8,
      });
      await page.mouse.up();
      assert.ok(
        Math.abs(
          Number(await receiptDialog().getByLabel('Left (%)', { exact: true }).inputValue()) - 20,
        ) < 1,
      );
      await receiptDialog().getByRole('button', { name: 'Apply crop', exact: true }).click();
      await preview.waitFor();
      let cropped = await dimensions();
      assert.ok(Math.abs(cropped.width - 900 * 0.6) <= 3);
      assert.ok(Math.abs(cropped.height - 1100 * 0.6) <= 3);
      await receiptDialog()
        .getByRole('button', { name: 'Restore full photo', exact: true })
        .click();
      assert.deepEqual(await dimensions(), original);
      await receiptDialog()
        .getByRole('button', { name: 'Crop selected photo', exact: true })
        .click();
      await receiptDialog().getByLabel('Width (%)', { exact: true }).fill('0');
      assert.equal(
        await receiptDialog().getByRole('button', { name: 'Apply crop', exact: true }).isDisabled(),
        true,
      );
      await receiptDialog().getByRole('button', { name: 'Cancel crop', exact: true }).click();
      assert.deepEqual(await dimensions(), original);
      await receiptDialog()
        .getByRole('button', { name: 'Crop selected photo', exact: true })
        .click();
      for (const [field, value] of [
        ['Left (%)', '0'],
        ['Top (%)', '0'],
        ['Width (%)', '50'],
        ['Height (%)', '50'],
      ]) {
        await receiptDialog().getByLabel(field, { exact: true }).fill(value);
      }
      await page.screenshot({ path: 'test-results/crop-selection-ui.png', fullPage: true });
      await receiptDialog().getByRole('button', { name: 'Apply crop', exact: true }).click();
      await preview.waitFor();
      assert.deepEqual(await dimensions(), { width: 450, height: 550 });
      await receiptDialog().getByRole('button', { name: 'Rotate 90°', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('img[alt="Receipt being reviewed; not saved"]')?.naturalWidth ===
          550,
      );
      await receiptDialog()
        .getByRole('button', { name: 'Restore full photo', exact: true })
        .click();
      assert.deepEqual(await dimensions(), original);
      await receiptDialog()
        .getByRole('button', { name: 'Crop selected photo', exact: true })
        .click();
      for (const [field, value] of [
        ['Left (%)', '0'],
        ['Top (%)', '0'],
        ['Width (%)', '50'],
        ['Height (%)', '50'],
      ]) {
        await receiptDialog().getByLabel(field, { exact: true }).fill(value);
      }
      await receiptDialog().getByLabel('Crop contains', { exact: true }).selectOption('amount');
      await receiptDialog().getByRole('button', { name: 'Apply crop', exact: true }).click();
      assert.deepEqual(await dimensions(), { width: 490, height: 590 });
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
      assert.ok(
        await page.evaluate(() => window.fakeTracks.every((track) => track.readyState === 'ended')),
      );
    },
  );
  const photoFile = async (name, lines) => ({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(
      await page.evaluate((lines) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1000;
        canvas.height = 500;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 1000, 500);
        ctx.fillStyle = 'black';
        ctx.font = '60px Arial';
        lines.forEach((line, index) => ctx.fillText(line, 60, 100 + index * 100));
        return canvas.toDataURL('image/png').split(',')[1];
      }, lines),
      'base64',
    ),
  });
  const pasteImages = async (count = 1, invalid = false, oversized = false) =>
    page.evaluate(
      async ({ count, invalid, oversized }) => {
        const image = oversized
          ? new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' })
          : invalid
            ? new Blob(['invalid image'], { type: 'image/png' })
            : await (await fetch('/receipt-fixtures/english.png')).blob();
        const data = new DataTransfer();
        for (let index = 0; index < count; index++)
          data.items.add(new File([image], `screenshot-${index}.png`, { type: 'image/png' }));
        const event = new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        document.activeElement.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { count, invalid, oversized },
    );
  await check(
    'image paste adds photos, preserves text paste and existing drafts on rejection, and respects limits',
    async () => {
      const reads = await page.evaluate(() => window.clipboardReads);
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      assert.equal(await page.evaluate(() => window.clipboardReads), reads);
      assert.equal(await pasteImages(), true);
      await receiptDialog().getByRole('button', { name: 'Photo 1', exact: true }).waitFor();
      await receiptDialog().getByRole('button', { name: 'Enter manually', exact: true }).click();
      const description = receiptDialog().getByLabel('Description (optional)', { exact: true });
      await description.fill('Keep this draft');
      const textPrevented = await description.evaluate((input) => {
        const data = new DataTransfer();
        data.setData('text/plain', 'ordinary text');
        const event = new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert.equal(textPrevented, false);
      await pasteImages(1, true);
      await receiptDialog()
        .getByRole('alert')
        .filter({ hasText: 'readable JPEG or PNG' })
        .waitFor();
      assert.equal(await description.inputValue(), 'Keep this draft');
      await pasteImages(1, false, true);
      await receiptDialog().getByRole('alert').filter({ hasText: '20 MB' }).waitFor();
      assert.equal(await description.inputValue(), 'Keep this draft');
      await receiptDialog()
        .getByRole('button', { name: 'Crop selected photo', exact: true })
        .click();
      await pasteImages();
      await receiptDialog().getByRole('alert').filter({ hasText: 'Finish or cancel' }).waitFor();
      await receiptDialog().getByRole('button', { name: 'Cancel crop', exact: true }).click();
      await pasteImages(6);
      await receiptDialog().getByRole('button', { name: 'Photo 6', exact: true }).waitFor();
      await receiptDialog().getByRole('alert').filter({ hasText: 'Use up to 6 photos' }).waitFor();
      assert.equal(
        await receiptDialog().getByRole('button', { name: 'Photo 7', exact: true }).count(),
        0,
      );
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
      assert.equal(await pasteImages(), false);
      assert.equal(await page.evaluate(() => window.clipboardReads), reads);
    },
  );
  await check(
    'explicit clipboard access has denied/empty/unsupported fallbacks and ignores late results after close',
    async () => {
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      for (const [mode, message] of [
        ['denied', 'Clipboard access was denied'],
        ['empty', 'No image found'],
        ['unavailable', 'Clipboard button is unavailable'],
      ]) {
        await page.evaluate((mode) => (window.clipboardMode = mode), mode);
        await receiptDialog().getByRole('button', { name: 'Paste image', exact: true }).click();
        await receiptDialog().getByRole('alert').filter({ hasText: message }).waitFor();
      }
      await page.evaluate(() => (window.clipboardMode = 'hold'));
      await receiptDialog().getByRole('button', { name: 'Paste image', exact: true }).click();
      await receiptDialog()
        .getByRole('button', { name: 'Reading clipboard…', exact: true })
        .waitFor();
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
      await page.evaluate(() => window.resolveClipboard([]));
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Start camera', exact: true }).waitFor();
      assert.equal(
        await receiptDialog().getByRole('button', { name: 'Photo 1', exact: true }).count(),
        0,
      );
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
    },
  );
  await check(
    'clipboard screenshot OCR fills date/total and saves only reviewed provenance',
    async () => {
      const count = await page.evaluate(() => window.testLedger.transactions.length);
      await page.evaluate(() => (window.clipboardMode = 'image'));
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Paste image', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Photo 1', exact: true }).waitFor();
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 60000 });
      assert.equal(
        await receiptDialog().getByLabel('Date (optional)', { exact: true }).inputValue(),
        '2026-11-14',
      );
      assert.equal(
        await receiptDialog().getByLabel('Final total / calculation', { exact: true }).inputValue(),
        '1280',
      );
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count);
      await receiptDialog().getByLabel('Category', { exact: true }).fill('Clipboard');
      await receiptDialog()
        .getByLabel('Description (optional)', { exact: true })
        .fill('Digital receipt test');
      await receiptDialog()
        .getByRole('checkbox', { name: /I reviewed the date/ })
        .check();
      await receiptDialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
      await receiptDialog().waitFor({ state: 'hidden' });
      const saved = await page.evaluate(() => window.testLedger.transactions.at(-1));
      assert.equal(saved.receipt.input, 'clipboard');
      assert.equal(saved.amount, 1280);
      assert.deepEqual(Object.keys(saved.receipt).sort(), [
        'engine',
        'input',
        'origin',
        'reviewedAt',
      ]);
      assert.ok(!JSON.stringify(saved).includes('SYNTHETIC TEST RECEIPT'));
    },
  );
  await check('file plus pasted image stays one receipt with mixed provenance', async () => {
    await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
    await page
      .locator('input[type=file][accept="image/jpeg,image/png"]')
      .setInputFiles('public/receipt-fixtures/english.png');
    await receiptDialog().getByRole('button', { name: 'Photo 1', exact: true }).waitFor();
    await pasteImages();
    await receiptDialog().getByRole('button', { name: 'Photo 2', exact: true }).waitFor();
    await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
    await receiptDialog().getByText('Review required', { exact: true }).waitFor({ timeout: 60000 });
    assert.equal(
      await receiptDialog().getByLabel('Final total / calculation', { exact: true }).inputValue(),
      '1280',
    );
    await receiptDialog().getByLabel('Category', { exact: true }).fill('Mixed');
    await receiptDialog()
      .getByRole('checkbox', { name: /I reviewed the date/ })
      .check();
    await receiptDialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
    await receiptDialog().waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => window.testLedger.transactions.at(-1).receipt.input),
      'mixed',
    );
  });
  await check(
    'one unlabelled amount fills automatically without saving and remains editable',
    async () => {
      const count = await page.evaluate(() => window.testLedger.transactions.length);
      const amountPhoto = await photoFile('amount.png', ['¥770']);
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await page
        .locator('input[type=file][accept="image/jpeg,image/png"]')
        .setInputFiles(amountPhoto);
      await receiptDialog()
        .getByRole('button', { name: 'Crop selected photo', exact: true })
        .click();
      for (const [field, value] of [
        ['Left (%)', '0'],
        ['Top (%)', '0'],
        ['Width (%)', '100'],
        ['Height (%)', '100'],
      ]) {
        await receiptDialog().getByLabel(field, { exact: true }).fill(value);
      }
      await receiptDialog().getByLabel('Crop contains', { exact: true }).selectOption('amount');
      await receiptDialog().getByRole('button', { name: 'Apply crop', exact: true }).click();
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 60000 });
      const amount = receiptDialog().getByLabel('Final total / calculation', { exact: true });
      assert.equal(await amount.inputValue(), '770');
      assert.equal(
        await receiptDialog()
          .getByRole('checkbox', { name: /I reviewed the date/ })
          .isChecked(),
        false,
      );
      await amount.fill('771');
      assert.equal(await amount.inputValue(), '771');
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count);
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
    },
  );
  await check(
    'two separate photos OCR date and total into one reviewed entry; conflicting total stays unresolved',
    async () => {
      const count = await page.evaluate(() => window.testLedger.transactions.length);
      const datePhoto = await photoFile('date.png', ['SYNTHETIC RECEIPT', '2026-11-14']);
      const totalPhoto = await photoFile('total.png', ['TOTAL 1280', 'CASH 2000', 'CHANGE 720']);
      const conflictPhoto = await photoFile('conflict.png', ['TOTAL 700']);
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      const upload = page.locator('input[type=file][accept="image/jpeg,image/png"]');
      await upload.setInputFiles([datePhoto, totalPhoto]);
      await receiptDialog().getByRole('button', { name: 'Photo 2', exact: true }).waitFor();
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 60000 });
      assert.equal(
        await receiptDialog().getByLabel('Date (optional)', { exact: true }).inputValue(),
        '2026-11-14',
      );
      assert.equal(
        await receiptDialog().getByLabel('Final total / calculation', { exact: true }).inputValue(),
        '1280',
      );
      await upload.setInputFiles(conflictPhoto);
      await receiptDialog().getByRole('button', { name: 'Photo 3', exact: true }).waitFor();
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 60000 });
      assert.equal(
        await receiptDialog().getByLabel('Final total / calculation', { exact: true }).inputValue(),
        '',
      );
      await receiptDialog()
        .getByText(/Photos contain conflicting totals/)
        .waitFor();
      await receiptDialog()
        .getByRole('button', { name: 'Remove selected photo', exact: true })
        .click();
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByRole('button', { name: 'Cancel recognition', exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count);
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 60000 });
      await receiptDialog().getByLabel('Category', { exact: true }).fill('Transport');
      await receiptDialog()
        .getByRole('checkbox', { name: /I reviewed the date/ })
        .check();
      await receiptDialog()
        .getByRole('button', { name: 'Confirm and save', exact: true })
        .dblclick();
      await receiptDialog().waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count + 1);
      const saved = await page.evaluate(() => window.testLedger.transactions.at(-1));
      assert.equal(saved.amount, 1280);
      assert.deepEqual(Object.keys(saved.receipt).sort(), [
        'engine',
        'input',
        'origin',
        'reviewedAt',
      ]);
    },
  );
  await check(
    'local Japanese worker recognizes final total under release CSP; cancel changes nothing',
    async () => {
      const count = await page.evaluate(() => window.testLedger.transactions.length);
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await receiptDialog().getByText('Offline synthetic checks', { exact: true }).click();
      await receiptDialog()
        .getByRole('button', { name: 'japanese test receipt', exact: true })
        .click();
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 45000 });
      assert.equal(
        await receiptDialog().getByLabel('Final total / calculation', { exact: true }).inputValue(),
        '1280',
      );
      assert.equal(
        await receiptDialog().getByLabel('Date (optional)', { exact: true }).inputValue(),
        '2026-11-14',
      );
      await page.screenshot({ path: 'test-results/receipt-review-ui.png', fullPage: true });
      await receiptDialog().getByRole('button', { name: 'Close scanner', exact: true }).click();
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count);
    },
  );
  await check(
    'failed receipt save preserves review; double confirmation creates one entry without photo/text',
    async () => {
      const count = await page.evaluate(() => window.testLedger.transactions.length);
      await page.getByRole('button', { name: 'Scan receipt', exact: true }).click();
      await page
        .locator('input[type=file][accept="image/jpeg,image/png"]')
        .setInputFiles('public/receipt-fixtures/english.png');
      await receiptDialog().getByRole('button', { name: 'Recognize offline', exact: true }).click();
      await receiptDialog()
        .getByText('Review required', { exact: true })
        .waitFor({ timeout: 45000 });
      await receiptDialog().getByLabel('Category', { exact: true }).fill('Food');
      const tags = receiptDialog().getByLabel('Tags', { exact: true });
      await tags.fill('Travel');
      await tags.press('Enter');
      await receiptDialog()
        .getByRole('checkbox', { name: /I reviewed the date/ })
        .check();
      await page.evaluate(() => (window.failNextSave = true));
      await receiptDialog().getByRole('button', { name: 'Confirm and save', exact: true }).click();
      await receiptDialog()
        .getByRole('alert')
        .filter({ hasText: 'Synthetic disk-full failure' })
        .waitFor();
      assert.equal(
        await receiptDialog().getByLabel('Final total / calculation', { exact: true }).inputValue(),
        '1280',
      );
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count);
      await receiptDialog()
        .getByRole('button', { name: 'Confirm and save', exact: true })
        .dblclick();
      await receiptDialog().waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.testLedger.transactions.length), count + 1);
      const saved = await page.evaluate(() => window.testLedger.transactions.at(-1));
      assert.equal(saved.description, 'Food');
      assert.equal(saved.amount, 1280);
      assert.equal(saved.receipt.origin, 'receipt-scan');
      assert.ok(saved.tagIds.length);
      assert.equal(saved.source, undefined);
      assert.deepEqual(Object.keys(saved.receipt).sort(), [
        'engine',
        'input',
        'origin',
        'reviewedAt',
      ]);
      assert.ok(!JSON.stringify(saved).includes('SYNTHETIC TEST RECEIPT'));
    },
  );
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/headless-ui-report.json',
    JSON.stringify(
      {
        passed: true,
        environment:
          'Headless Edge, release assets/CSP, mocked IPC and synthetic camera; no desktop control',
        checks: 16,
        issues,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({ path: 'test-results/ui-failure.png', fullPage: true });
  await writeFile(
    'test-results/headless-ui-report.json',
    JSON.stringify({ passed: false, error: String(e), issues }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
