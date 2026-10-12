'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes=value=>{let n=value||0;const units=['B','KiB','MiB','GiB','TiB'];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i?1:0)+' '+units[i];};
const $=selector=>document.querySelector(selector);
const nodeId=/^\/public\/servers\/([a-f0-9-]{36})$/.exec(location.pathname)?.[1];
const isHistory=Boolean(nodeId)||location.pathname==='/public/network';
const endpoint=nodeId?`/api/public/nodes/${nodeId}/history`:isHistory?'/api/public/history':'/api/public';
let busy=false;
function chart(data){
  const rows=data.minutes;if(!rows.length)return '<p class="muted">暂无最近 24 小时网速记录，接入后约一分钟开始保存。</p>';
  const max=Math.max(1,...rows.map(r=>r.rx+r.tx)),start=data.start,end=data.server_time;
  const paths=[['rx','#43a598'],['tx','#5d78da'],['total','#bd9650']].map(([key,color])=>{let path='',last=0;for(const r of rows){const x=60+Math.max(0,Math.min(1,(r.minute-start)/(end-start)))*790,y=250-Math.max(0,key==='total'?r.rx+r.tx:r[key])/max*200;path+=(last&&r.minute-last<=120?' L':' M')+x.toFixed(1)+' '+y.toFixed(1);last=r.minute;}return `<path d="${path}" stroke="${color}" fill="none" stroke-width="2"/>`;}).join('');
  const axis=[0,.5,1].map(f=>`<path d="M60 ${250-f*200}H850" stroke="#e4eaf4"/><text x="60" y="${240-f*200}" fill="#7b8591" font-size="11">${esc(bytes(max*f))}/s</text>`).join('');
  const labels=[0,.25,.5,.75,1].map(f=>{const time=new Date((start+(end-start)*f)*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});return `<text x="${60+790*f}" y="278" text-anchor="${f===0?'start':f===1?'end':'middle'}" fill="#7b8591" font-size="11">${esc(time)}</text>`;}).join('');
  return `<svg class="public-history-chart" viewBox="0 0 900 300" role="img" aria-label="最近24小时上传、下载和合计网速趋势">${axis}${paths}${labels}</svg><div class="public-legend"><span class="download">↓ 下载</span><span class="upload">↑ 上传</span><span>⇅ 合计</span></div>`;
}
function renderHistory(data){
  $('#public-title').textContent=data.name+' · 最近 24 小时';$('#public-back').hidden=false;$('#public-network').hidden=true;$('#public-grid').classList.add('public-history');
  const rows=data.minutes,peak=Math.max(0,...rows.map(r=>r.rx+r.tx)),average=rows.length?rows.reduce((sum,r)=>sum+r.rx+r.tx,0)/rows.length:0;
  $('#public-grid').innerHTML=`<article class="panel"><div class="section-heading"><div><h2>实时网络记录</h2><p>每分钟平均值，最近 24 小时滚动窗口；数据缺口保留为空白。${nodeId?'':'只统计已公开且启用的服务器。'}</p></div></div>${chart(data)}<div class="public-history-stats"><span>最高合计网速 <strong>${bytes(peak)}/s</strong></span><span>已有样本平均 <strong>${bytes(average)}/s</strong></span><span>记录数 <strong>${rows.length} 分钟</strong></span></div><details><summary>查看每分钟记录</summary><div class="table-scroll public-history-table"><table><thead><tr><th>时间</th><th>↑ 上传</th><th>↓ 下载</th><th>合计</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><td>${esc(new Date(r.minute*1000).toLocaleString('zh-CN',{hour12:false}))}</td><td>${bytes(r.tx)}/s</td><td>${bytes(r.rx)}/s</td><td>${bytes(r.rx+r.tx)}/s</td></tr>`).join('')||'<tr><td colspan="4">暂无记录</td></tr>'}</tbody></table></div></details></article>`;
}
function renderServers(data){
  $('#public-network').hidden=!data.network;
  if(data.network)$('#public-network').innerHTML=`<a href="/public/network" class="summary-card public-network-card"><div class="label">当前总网速<span class="summary-icon">⇅</span></div><div class="metric">${bytes(data.network.rx+data.network.tx)}<small>/s</small></div><div class="caption">↑ ${bytes(data.network.tx)}/s　↓ ${bytes(data.network.rx)}/s</div><p class="public-open">查看最近 24 小时记录 →</p></a>`;
  $('#public-grid').innerHTML=data.nodes.map(n=>{const link=data.show_network,tag=link?'a':'article';return `<${tag} class="node-card" ${link?`href="/public/servers/${n.id}" aria-label="${esc(n.name)} 最近24小时网速"`:''}><div class="node-head"><div><div class="node-name">${esc(n.name)}</div><div class="node-group">${esc(n.group_name)}</div></div><span class="badge ${n.status}">${{online:'在线',offline:'离线',pending:'待接入',disabled:'已停用'}[n.status]}</span></div><div class="node-body">${n.metrics?`<div class="speed-row"><span>↑ ${bytes(n.metrics.tx_speed)}/s</span><span>↓ ${bytes(n.metrics.rx_speed)}/s</span></div><p>CPU ${n.metrics.cpu.toFixed(0)}% · 内存 ${n.metrics.mem_percent.toFixed(0)}% · 磁盘 ${n.metrics.disk_percent.toFixed(0)}%</p>`:''}${n.traffic?`<p>今日 ${bytes(n.traffic.today)} · 本月 ${bytes(n.traffic.month)}</p>`:''}<small>最后上报：${n.last_seen?esc(new Date(n.last_seen*1000).toLocaleString()):'等待接入'}</small>${link?'<p class="public-open">查看最近 24 小时网速 →</p>':''}</div></${tag}>`;}).join('')||'<p class="muted">暂无公开服务器。</p>';
}
async function refresh(){
  if(busy)return;busy=true;
  try{const response=await fetch(endpoint),data=await response.json();if(!response.ok)throw new Error(data.error||'公开展示尚未启用');document.title=data.brand.brand_name+' · '+(isHistory?data.name+' 网速记录':'服务器状态');$('#public-name').textContent=data.brand.brand_name;$('#public-logo').src=data.brand.brand_logo||'/firefly.svg';$('#brand-favicon').href=data.brand.brand_favicon||data.brand.brand_logo||'/firefly.svg';$('#public-status').textContent='已同步 · '+new Date(data.server_time*1000).toLocaleTimeString();if(isHistory)renderHistory(data);else renderServers(data);}
  catch(e){$('#public-status').textContent=e.message;$('#public-grid').innerHTML='';$('#public-network').hidden=true;if(isHistory)$('#public-back').hidden=false;}
  finally{busy=false;}
}
refresh();setInterval(refresh,isHistory?15000:5000);
