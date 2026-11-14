import { mkdir, copyFile, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
// No network requests: models are vendored in public/ocr/lang and checked into the project.
const root=process.cwd(),out=path.join(root,'public/ocr');
await mkdir(path.join(out,'core'),{recursive:true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js',path.join(out,'worker.min.js'));
await copyFile('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',path.join(out,'worker.min.js.LICENSE.txt'));
await copyFile('node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt',path.join(out,'tesseract.min.js.LICENSE.txt'));
await copyFile('node_modules/tesseract.js/LICENSE.md',path.join(out,'TESSERACT-JS-LICENSE.txt'));
await copyFile('node_modules/tesseract.js-core/LICENSE',path.join(out,'core/LICENSE'));
for(const name of await readdir('node_modules/tesseract.js-core')){
 if(/^tesseract-core.*\.wasm\.js$/.test(name))await copyFile(path.join('node_modules/tesseract.js-core',name),path.join(out,'core',name));
}
const files=['worker.min.js','core/tesseract-core.wasm.js','core/tesseract-core-simd.wasm.js','core/tesseract-core-lstm.wasm.js','core/tesseract-core-simd-lstm.wasm.js','lang/eng.traineddata','lang/jpn.traineddata'];
const manifest={engine:'tesseract.js',version:JSON.parse(await readFile('node_modules/tesseract.js/package.json','utf8')).version,coreVersion:JSON.parse(await readFile('node_modules/tesseract.js-core/package.json','utf8')).version,models:'tesseract-ocr/tessdata_fast tag 4.1.0',files:[]};
for(const file of files){const bytes=await readFile(path.join(out,file));if(bytes.length<1000)throw new Error(`Missing or truncated OCR asset: ${file}`);manifest.files.push({file,bytes:(await stat(path.join(out,file))).size,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Offline OCR assets ready: ${(manifest.files.reduce((s,f)=>s+f.bytes,0)/1024/1024).toFixed(2)} MiB`);
