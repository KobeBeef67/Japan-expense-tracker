import { recognizeReceipt } from './receipt-ocr';
import { extractReceipt } from './receipt-parser';
/** Only synthetic packaged assets are used. This never requests camera access or writes transactions. */
export async function ocrSelfTest(){
 const results=[];
 for(const name of ['japanese','english','mixed']){
  const response=await fetch(`/receipt-fixtures/${name}.png`);if(!response.ok)throw new Error('Bundled synthetic fixture unavailable');
  const result=await recognizeReceipt(await response.blob(),new AbortController().signal,()=>{});
  const parsed=extractReceipt(result.text);results.push({fixture:name,seconds:result.seconds,date:parsed.date,amount:parsed.amount,passed:parsed.date==='2026-11-14'&&parsed.amount===1280});
 }
 return {environment:'Packaged Windows WebView2, same-origin-only OCR worker; no camera access',cameraApiAvailable:!!navigator.mediaDevices?.getUserMedia,results,passed:results.every(r=>r.passed)};
}
