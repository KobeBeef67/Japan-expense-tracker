<script lang="ts">
 import { onDestroy,onMount,tick } from 'svelte';
 import { prepareImage,captureFrame,cameraError,IMAGE_LIMITS } from '../lib/receipt-images';
 import { recognizeReceipt } from '../lib/receipt-ocr';
 import { extractReceipt,receiptCategorySuggestions } from '../lib/receipt-parser';
 import type { ReceiptExtraction } from '../lib/receipt-parser';
 import { yen,calculate } from '../lib/arithmetic';
 import type { Kind,Transaction,Tag } from '../lib/model';
 import type { ReceiptDraft } from '../lib/receipts';
 import TagSelector from './TagSelector.svelte';
 export let categories:string[]=[];
 export let transactions:Transaction[]=[];
 export let tags:Tag[]=[];
 export let onclose:()=>void;
 export let onconfirm:(draft:ReceiptDraft)=>Promise<void>;
 export let confirmLabel='Confirm and save';
 let phase:'choose'|'camera'|'image'|'recognizing'|'review'='choose';
 let video:HTMLVideoElement,fileInput:HTMLInputElement;let stream:MediaStream|null=null,devices:MediaDeviceInfo[]=[],deviceId='';
 let image:Blob|null=null,imageUrl='',via:ReceiptDraft['via']='file';let generation=0,controller:AbortController|undefined,disposed=false;
 let error='',status='',progress=0,saving=false,cameraStarting=false,processing=false;
 let date='',month='',amount='',description='',category='',type:Kind='expense',allowUnresolved=false,allowDuplicate=false,reviewed=false;
 let extraction:ReceiptExtraction|null=null,suggestions:string[]=[],seconds:number|null=null;
 let tagNames:string[]=[];
 $: duplicates=transactions.filter(t=>t.amount!==null&&amount.trim()&&(()=>{try{return t.amount===Math.abs(yen(amount));}catch{return false;}})()&&t.date===(date||null)&&t.month===month&&((category&&t.category.toLocaleLowerCase()===category.toLocaleLowerCase())||((description||category)&&t.description.toLocaleLowerCase()===(description||category).trim().toLocaleLowerCase())));
 $: rounded=(()=>{try{return amount?`¥${Math.abs(yen(amount)).toLocaleString('en-US')}`:'';}catch{return 'Invalid amount expression';}})();
 function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;if(video)video.srcObject=null;}
 function invalidate(){generation++;controller?.abort();controller=undefined;processing=false;cameraStarting=false;}
 function discardImage(){if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl='';image=null;}
 function resetDraft(){date='';month='';amount='';description='';category='';type='expense';tagNames=[];allowUnresolved=false;allowDuplicate=false;reviewed=false;extraction=null;suggestions=[];seconds=null;}
 function close(){if(saving)return;invalidate();stopCamera();discardImage();resetDraft();onclose();}
 async function startCamera(){
  invalidate();const token=generation;stopCamera();discardImage();error='';phase='camera';cameraStarting=true;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera APIs unavailable');
   const videoConstraints:MediaTrackConstraints={width:{ideal:2560},height:{ideal:1440},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}})};
   let next:MediaStream;try{next=await navigator.mediaDevices.getUserMedia({audio:false,video:videoConstraints});}catch(e){if(e instanceof DOMException&&e.name==='OverconstrainedError')next=await navigator.mediaDevices.getUserMedia({audio:false,video:deviceId?{deviceId:{exact:deviceId}}:true});else throw e;}
   if(token!==generation){next.getTracks().forEach(t=>t.stop());return;}stream=next;await tick();video.srcObject=next;await video.play();
   devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const selected=next.getVideoTracks()[0].getSettings();deviceId=selected.deviceId||deviceId;status=`Live ${video.videoWidth} × ${video.videoHeight} · keep the date and final total sharp`;
  }catch(e){if(token===generation){stopCamera();error=cameraError(e);}}finally{if(token===generation)cameraStarting=false;}
 }
 async function setImage(blob:Blob,origin:ReceiptDraft['via']){
  if(disposed)return;
  invalidate();const token=generation;stopCamera();discardImage();resetDraft();error='';processing=true;phase='image';via=origin;
  try{const prepared=await prepareImage(blob);if(token!==generation)return;image=prepared;imageUrl=URL.createObjectURL(prepared);status='Check focus and orientation, then recognize.';}catch(e){if(token===generation)error=String(e instanceof Error?e.message:e);}finally{if(token===generation)processing=false;}
 }
 async function capture(){if(!stream||processing)return;const token=generation;error='';try{const blob=await captureFrame(video);if(token===generation&&!disposed)await setImage(blob,'camera');}catch(e){if(!disposed)error=String(e instanceof Error?e.message:e);}}
 async function chooseFile(e:Event){const selected=(e.target as HTMLInputElement).files?.[0];if(selected)await setImage(selected,'file');(e.target as HTMLInputElement).value='';}
 async function rotate(){if(!image||processing)return;invalidate();const token=generation;processing=true;error='';try{const rotated=await prepareImage(image,1);if(token!==generation)return;discardImage();image=rotated;imageUrl=URL.createObjectURL(rotated);}catch(e){error=String(e);}finally{if(token===generation)processing=false;}}
 async function recognize(){if(!image||processing)return;invalidate();const token=generation;controller=new AbortController();phase='recognizing';progress=0;error='';status='Starting local Japanese / English recognition…';
  try{const result=await recognizeReceipt(image,controller.signal,(s,p)=>{if(token===generation){status=s;progress=Math.max(0,Math.min(1,p));}});if(token!==generation)return;extraction=extractReceipt(result.text);date=extraction.date||'';month=date.slice(0,7);amount=extraction.amount===null?'':String(extraction.amount);suggestions=receiptCategorySuggestions(result.text,categories);seconds=result.seconds;phase='review';status='Recognition complete. Check every field against the image.';
  }catch(e){if(token===generation){phase='review';error='Recognition failed. You can enter the fields manually, retry, or retake the photo.';status='No recognized values were saved.';}}finally{if(token===generation)controller=undefined;}
 }
 function cancelRecognition(){invalidate();phase='image';status='Recognition canceled. No ledger changes.';}
 function manual(){invalidate();stopCamera();phase='review';status='Enter the receipt details manually. Date was not detected.';}
 function retake(){invalidate();stopCamera();discardImage();resetDraft();error='';phase='choose';status='';}
 async function synthetic(name:string){const token=generation;error='';try{const response=await fetch(`/receipt-fixtures/${name}.png`);if(!response.ok)throw new Error('Synthetic fixture unavailable');const blob=await response.blob();if(token===generation&&!disposed)await setImage(blob,'synthetic');}catch(e){if(!disposed)error=String(e);}}
 async function confirm(){if(saving)return;error='';try{
  const desc=description.trim()||category.trim();if(!desc)throw new Error('Enter a description or choose a category');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Choose the reporting month');
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))throw new Error('Choose a valid date or leave it blank');
  const raw=amount.trim()?calculate(amount):null;if(raw?.isNegative())throw new Error('Use a positive amount and explicitly choose Refund when appropriate');if(raw===null&&!allowUnresolved)throw new Error('Confirm saving without an amount, or enter the total');if(duplicates.length&&!allowDuplicate)throw new Error('Review the possible duplicate warning');if(!reviewed)throw new Error('Confirm that you reviewed the receipt fields');
  saving=true;await onconfirm({date:date||null,month,description:desc,amount:raw===null?null:yen(amount),expression:amount,category,type,tagNames,via});discardImage();resetDraft();onclose();
 }catch(e){error=String(e instanceof Error?e.message:e);}finally{saving=false;}
 }
 function keydown(e:KeyboardEvent){if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();close();}if(e.key==='Tab'){const container=(e.currentTarget as Window).document.querySelector('.scanner');const controls=container?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled)');if(controls?.length){const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}
 onMount(()=>{document.querySelector<HTMLButtonElement>('.scanner .close')?.focus();});
 onDestroy(()=>{disposed=true;invalidate();stopCamera();discardImage();resetDraft();});
</script>

<svelte:window onkeydowncapture={keydown} onpagehide={()=>{invalidate();stopCamera();discardImage();}}/>
<div class="backdrop">
 <div class="scanner" role="dialog" aria-modal="true" aria-labelledby="scanner-title" tabindex="-1">
  <header><div><h2 id="scanner-title">Scan receipt · offline</h2><small>Japanese + English · one receipt, one reviewed entry</small></div><button class="close" disabled={saving} onclick={close} aria-label="Close scanner">Close ×</button></header>
  <p class="privacy">Photos and recognized text stay in memory for this review and are discarded when you finish or cancel. No photos or full OCR text are saved.</p>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  {#if phase==='choose'}
   <div class="choose"><button class="primary" onclick={startCamera}>Start camera</button><button onclick={()=>fileInput.click()}>Choose JPEG / PNG</button><button onclick={manual}>Enter details manually</button></div>
   <p>Frame a sharp, well-lit view of the purchase date and final total. Long receipts may need an image showing those areas. Webcam close-focus quality varies.</p>
   <details><summary>Offline synthetic checks</summary><p>These generated examples contain no private receipt data. Expected date: 2026-11-14. Total: ¥1,280; cash ¥2,000 and change ¥720 must not become the total.</p>{#each ['japanese','english','mixed'] as name}<button onclick={()=>synthetic(name)}>{name} test receipt</button>{/each}</details>
  {:else if phase==='camera'}
   {#if devices.length>1}<label>Camera<select bind:value={deviceId} disabled={cameraStarting} onchange={startCamera}>{#each devices as d}<option value={d.deviceId}>{d.label||'Camera'}</option>{/each}</select></label>{/if}
   <div class="camera"><video bind:this={video} autoplay muted playsinline aria-label="Live receipt camera preview"></video><div class="guide"><span>Date and final total inside the guide</span></div></div>
   <p role="status">{status}</p><div class="controls"><button class="primary" disabled={cameraStarting||!stream} onclick={capture}>{cameraStarting?'Starting camera…':'Capture photo'}</button><button onclick={()=>fileInput.click()}>Choose image instead</button><button disabled={cameraStarting} onclick={startCamera}>Retry camera</button><button onclick={retake}>Back</button></div>
  {:else}
   <div class:review={phase==='review'} class="content">
    {#if imageUrl}<div class="photo"><img src={imageUrl} alt="Receipt being reviewed; not saved"/></div>{/if}
    <div class="right-pane">
     {#if phase==='recognizing'}<h3>Recognizing locally…</h3><progress value={progress} max="1"></progress><p role="status">{status} · {Math.round(progress*100)}%</p><button onclick={cancelRecognition}>Cancel recognition</button><button onclick={manual}>Enter manually</button>
     {:else if phase==='image'}<p role="status">{processing?'Preparing image…':status}</p><div class="controls"><button class="primary" disabled={!image||processing} onclick={recognize}>Recognize offline</button><button disabled={!image||processing} onclick={rotate}>Rotate 90°</button><button onclick={retake}>Retake / replace</button><button onclick={manual}>Enter manually</button></div>
     {:else}<h3>Review required</h3><p>{seconds===null?'No OCR suggestion is required to continue.':`Recognition took ${seconds.toFixed(1)} seconds. Results may be wrong.`}</p>
      {#if extraction?.warnings.length}<div class="warning">{extraction.warnings.join(' · ')}</div>{/if}
      {#if !date}<p class="warning">Date not detected / not selected. Leave it blank if unknown; choose a reporting month.</p>{/if}
      <form onsubmit={e=>{e.preventDefault();void confirm();}}>
       <div class="fields"><label>Date (optional)<input type="date" bind:value={date}/></label><label>Reporting month (required)<input type="month" bind:value={month} required/></label>
        <label>Final total / calculation<input aria-label="Final total / calculation" bind:value={amount} placeholder="Blank = unresolved"/><small>{rounded}</small></label><label>Transaction type<select bind:value={type}><option value="expense">Expense</option><option value="refund">Refund / reimbursement</option></select></label>
        <label>Category<input bind:value={category} list="receipt-categories" placeholder="Choose or enter category"/></label><label>Description (optional)<input bind:value={description} placeholder="Uses category when left blank"/></label></div>
       <TagSelector {tags} bind:names={tagNames} disabled={saving}/>
       {#if suggestions.length}<p class="suggestions">Category suggestions:{#each suggestions as s}<button type="button" onclick={()=>category=s}>{s}</button>{/each}</p>{/if}
       {#if extraction?.dateCandidates.length&&extraction.dateCandidates.length>1}<div class="candidates">Possible dates:{#each extraction.dateCandidates as d}<button type="button" onclick={()=>{date=d;if(!month)month=d.slice(0,7);}}>{d}</button>{/each}</div>{/if}
       {#if extraction?.candidates.length}<details><summary>Possible totals ({extraction.candidates.length}) — inspect against the photo</summary>{#each extraction.candidates as c}<div class="candidate"><button type="button" onclick={()=>amount=String(c.amount)}>¥{c.amount.toLocaleString('en-US')}</button><span>{c.explicit?'Total label':'Unlabelled amount'} · {c.context}</span></div>{/each}</details>{/if}
       {#if !amount.trim()}<label class="check"><input type="checkbox" bind:checked={allowUnresolved}/>Save without an amount as an unresolved entry</label>{/if}
       {#if duplicates.length}<div class="warning">Possible duplicate: {duplicates.length} existing {duplicates.length===1?'entry matches':'entries match'} this date, amount, and description/category. Matching purchases can be legitimate.<label class="check"><input type="checkbox" bind:checked={allowDuplicate}/>Save as a separate transaction anyway</label></div>{/if}
       <label class="check"><input type="checkbox" bind:checked={reviewed}/>I reviewed the date, reporting month, total, category, and type</label>
       <div class="controls"><button class="primary" type="submit" disabled={saving}>{saving?'Saving…':confirmLabel}</button><button type="button" disabled={saving||!image} onclick={recognize}>Retry recognition</button><button type="button" disabled={saving} onclick={retake}>Retake / replace</button></div>
      </form>
     {/if}
    </div>
   </div>
  {/if}
  <small class="limits">JPEG / PNG only · ≤{IMAGE_LIMITS.bytes/1024/1024} MB · ≤24 MP · ≤10,000 px per side. Images resize to ≤2,600 px per side for OCR.</small>
 </div>
</div>
<input hidden type="file" accept="image/jpeg,image/png" bind:this={fileInput} onchange={chooseFile}/>
<datalist id="receipt-categories">{#each categories as c}<option value={c}></option>{/each}</datalist>

<style>
 .backdrop{position:fixed;inset:0;z-index:50;background:#16291fd0;display:flex;align-items:center;justify-content:center;padding:24px}.scanner{background:#fafcf8;border-radius:12px;width:min(1100px,100%);max-height:94vh;overflow:auto;padding:22px;color:#24372b;box-shadow:0 12px 70px #0006}header{display:flex;justify-content:space-between;gap:20px;align-items:start}h2{font-size:19px}h3{margin-top:0}.privacy{background:#e8f0e2;padding:10px 12px;font-size:11px}.choose,.controls{display:flex;flex-wrap:wrap;gap:9px;margin:14px 0}.camera{position:relative;background:#152218;max-height:50vh;overflow:hidden;border-radius:8px;margin-top:12px}.camera video{display:block;width:100%;height:48vh;object-fit:contain;transform:none}.guide{position:absolute;inset:8% 20%;border:2px dashed #f3f7c9;pointer-events:none;display:flex;justify-content:center;align-items:end}.guide span{font-size:11px;background:#173323c9;color:white;padding:5px}.content{display:grid;grid-template-columns:minmax(200px,1fr) minmax(300px,1.2fr);gap:22px}.photo{background:#e4e9df;padding:8px;border-radius:8px}.photo img{display:block;width:100%;height:58vh;object-fit:contain}.right-pane{min-width:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:11px}.fields input,.fields select{width:100%}.check{display:flex;flex-direction:row;align-items:start;gap:7px;margin:13px 0;font-size:12px}.check input{margin:2px 0}.warning{padding:10px;background:#fff0d1;color:#80602b;font-size:12px;line-height:1.5}.candidates,.suggestions{font-size:11px;margin:10px 0}.candidates button,.suggestions button{margin:4px;font-size:11px}.candidate{display:flex;gap:9px;align-items:center;margin:6px 0;font-size:11px}.candidate span{overflow-wrap:anywhere}.limits{margin-top:16px;color:#83907c}.error{background:#fbe8e0;color:#98442d;padding:12px}progress{width:100%;accent-color:#315e46}details button{margin:5px}small{font-size:11px}p{line-height:1.5}@media(max-width:850px){.content{grid-template-columns:1fr}.photo img{height:25vh}.scanner{padding:16px}.backdrop{padding:10px}}
</style>
