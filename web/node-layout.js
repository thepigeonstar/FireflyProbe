'use strict';
window.FireflyNodeLayout={
 create({key,controls,cards,list,render}){
  let mode='cards';try{if(localStorage.getItem(key)==='list')mode='list';}catch{}
  const apply=()=>{cards.hidden=mode==='list';list.hidden=mode!=='list';controls.querySelectorAll('[data-node-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.nodeLayout===mode)));};
  controls.querySelectorAll('[data-node-layout]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.nodeLayout==='list'?'list':'cards';try{localStorage.setItem(key,mode);}catch{}apply();render();}));
  apply();return {get mode(){return mode;},apply};
 }
};
if(document.querySelector('#overview-layout')){
 const grid=document.querySelector('#node-grid'),list=document.querySelector('#node-table-view'),controls=document.querySelector('#overview-layout');
 const layout=FireflyNodeLayout.create({key:'firefly:overview-layout',controls,cards:grid,list,render:()=>renderList()});
 function renderList(){
  if(layout.mode!=='list')return;
  const nodes=[...grid.querySelectorAll('.node-card [data-edit]')].map(button=>state.nodes.find(n=>n.id===button.dataset.edit)).filter(Boolean),percent=value=>Number.isFinite(value)?value.toFixed(0)+'%':'—';
  const traffic=value=>`<strong>${b(value.rx+value.tx)}</strong><small>↑ ${b(value.tx)}　↓ ${b(value.rx)}</small>`;
  list.innerHTML=`<table class="server-view-table"><caption class="visually-hidden">服务器监控列表</caption><thead><tr>${['服务器','状态','↑ 上传速度','↓ 下载速度','CPU / 内存 / 磁盘','今日流量','昨日流量','本周期 · 计费','流量额度','到期 / 运行时间','操作'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${nodes.map(n=>{const m=n.metrics,t=n.traffic,alert=n.history_error||m?.sample_error;return `<tr data-monitor-row="${n.id}"><td><button type="button" class="node-table-name-button" data-monitor-history="${n.id}">${nodeFlag(n.country_code)}${escapeHTML(n.name)}</button><small>${escapeHTML(n.group_name||'未分组')} · ${escapeHTML(m?.interface||n.interface||'自动网卡')}</small><small>${escapeHTML(n.system||systemPending(n))}</small>${alert?`<small class="node-table-alert">${escapeHTML(alert)}</small>`:''}</td><td><span class="badge ${n.status}">${{online:'在线',offline:'离线',pending:'待接入',disabled:'已停用'}[n.status]}</span></td><td>${m?b(m.tx_speed)+'/s':'—'}</td><td>${m?b(m.rx_speed)+'/s':'—'}</td><td><span>CPU ${percent(m?.cpu)}</span><small>内存 ${percent(m?.mem_total?m.mem_used/m.mem_total*100:undefined)} · 磁盘 ${percent(m?.disk_total?m.disk_used/m.disk_total*100:undefined)}</small></td><td>${traffic(t.today)}</td><td>${traffic(t.yesterday)}</td><td><strong>${b(t.measured)}</strong><small>↑ ${b(t.cycle.tx)}　↓ ${b(t.cycle.rx)}</small></td><td>${n.quota?b(n.quota):'未设置'}<small>剩余 ${t.remaining===null?'未设置':b(t.remaining)}</small></td><td><span class="${n.expired?'node-table-alert':''}">${escapeHTML(n.expires||'未设置到期日')}</span><small>${nodeUptime(m)}</small></td><td><div class="node-table-actions"><button type="button" class="link-button" data-monitor-history="${n.id}">详情</button><button type="button" class="link-button" data-monitor-edit="${n.id}">配置</button></div></td></tr>`;}).join('')||'<tr><td colspan="11" class="node-table-empty">没有匹配的服务器。</td></tr>'}</tbody></table>`;
  list.querySelectorAll('[data-monitor-history]').forEach(button=>button.onclick=()=>managementNetworkDetail(button.dataset.monitorHistory));
  list.querySelectorAll('[data-monitor-edit]').forEach(button=>button.onclick=()=>editNode(button.dataset.monitorEdit));
  list.querySelectorAll('[data-monitor-row]').forEach(row=>row.onclick=event=>{if(!event.target.closest('button,a,input,select'))managementNetworkDetail(row.dataset.monitorRow);});
 }
 const cardsRender=renderNodes;
 renderNodes=function(){cardsRender();layout.apply();renderList();};
 document.querySelector('#search').removeEventListener('input',cardsRender);document.querySelector('#search').addEventListener('input',renderNodes);
 document.querySelector('#group-filter').removeEventListener('change',cardsRender);document.querySelector('#group-filter').addEventListener('change',renderNodes);
}
