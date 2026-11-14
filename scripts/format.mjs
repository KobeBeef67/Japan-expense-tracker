/** Format only our source/config/docs. Never rewrite private data or vendored OCR assets. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as prettier from 'prettier';

const checkOnly = process.argv.includes('--check');
const sourceDirectories = ['src', 'scripts'];
const projectFiles = [
  '.prettierrc.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'svelte.config.js',
  'index.html',
  'README.md',
  'SETUP.md',
  'ARCHITECTURE.md',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/default.json',
  'public/ocr/offline-worker.js',
  'public/ocr/NOTICE.md',
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(filename) : [filename];
    }),
  );
  return nestedFiles.flat();
}

const sourceFiles = (await Promise.all(sourceDirectories.map(listFiles))).flat();
let changedCount = 0;

for (const filename of [...projectFiles, ...sourceFiles]) {
  const information = await prettier.getFileInfo(filename, {
    ignorePath: '.prettierignore',
    plugins: ['prettier-plugin-svelte'],
  });
  if (information.ignored || !information.inferredParser) continue;

  let original;
  try {
    original = await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }

  const configuration = await prettier.resolveConfig(filename);
  const formatted = await prettier.format(original, { ...configuration, filepath: filename });
  if (original === formatted) continue;

  changedCount += 1;
  console.log(`${checkOnly ? 'Needs formatting' : 'Formatted'}: ${filename}`);
  if (!checkOnly) await writeFile(filename, formatted);
}

if (checkOnly && changedCount) process.exitCode = 1;
console.log(`${changedCount} file(s) ${checkOnly ? 'need formatting' : 'formatted'}.`);
