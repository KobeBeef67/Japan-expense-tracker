export function withCancellation<T>(job:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Canceled','AbortError'));
  if(signal.aborted){job.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  job.then(value=>{signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
