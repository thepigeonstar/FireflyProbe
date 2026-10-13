import {randomBytes} from 'node:crypto';
export function pluginNodes(nodes){return nodes.map(n=>Object.fromEntries(['id','name','group_name','status','enabled','country_code','last_seen','metrics','traffic','expires'].map(key=>[key,n[key]])));}
export function pluginFrame(source){
 const nonce=randomBytes(24).toString('base64'),code=JSON.stringify(source).replaceAll('<','\\u003c');
 const csp=`default-src 'none'; script-src 'nonce-${nonce}' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts`;
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;margin:16px;color:#24334a;background:#fff}button,input,select{font:inherit}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}@media(prefers-color-scheme:dark){body{background:#152031;color:#e5ebf4}}</style></head><body><main id="plugin-root"></main><script nonce="${nonce}">
(()=>{let port,nodes=[],cleanup,sequence=0;const pending=new Map(),container=document.getElementById('plugin-root');
 const send=value=>port?.postMessage(value);
 const api=(path,options={})=>new Promise((resolve,reject)=>{if(pending.size>=4){reject(Error('插件请求过多'));return;}let data;try{data=typeof options.body==='string'?JSON.parse(options.body):options.body;}catch{reject(Error('插件请求需要 JSON body'));return;}const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('插件请求超时'));},180000);pending.set(id,{resolve,reject,timer});send({type:'invoke',id,path,method:options.method||'GET',data});});
 window.addEventListener('message',async event=>{if(port||event.source!==parent||event.data?.type!=='firefly-init'||!event.ports[0])return;port=event.ports[0];nodes=event.data.nodes||[];port.onmessage=e=>{const data=e.data;if(data?.type==='result'){const job=pending.get(data.id);if(job){clearTimeout(job.timer);pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.value);}}else if(data?.type==='dispose'){try{cleanup?.();}catch{}port.close();}};port.start();
 try{const url=URL.createObjectURL(new Blob([${code}],{type:'text/javascript'}));let module;try{module=await import(url);}finally{URL.revokeObjectURL(url);}if(typeof module.mount!=='function')throw Error('插件缺少 mount 方法');cleanup=await module.mount({container,api,getNodes:()=>structuredClone(nodes),notify:text=>send({type:'notify',text:String(text).slice(0,200)})});new ResizeObserver(()=>send({type:'resize',height:document.body.scrollHeight})).observe(container);}catch(e){container.textContent='插件加载失败：'+e.message;send({type:'resize',height:200});}
 },{once:false});})();
</script></body></html>`;
 return {html,csp};
}
