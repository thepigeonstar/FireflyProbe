'use strict';
const managementApi=api;
api=async function(path,options={}) {
  if(options.body&&/^\/api\/nodes(?:\/[a-f0-9-]{36})?$/.test(path)&&['POST','PUT'].includes(options.method)){
    const data=JSON.parse(options.body);data.ssh_port=Number(data.ssh_port);data.ssh_clear=$('#node-form').elements.ssh_clear.checked;
    options={...options,body:JSON.stringify(data)};
  }
  return managementApi(path,options);
};
const managementPage=page;
page=function(name){
  $('#servers-page').hidden=name!=='servers';
  if(name==='servers'){
    state.page=name;for(const p of ['overview','settings','guide','costs'])$('#'+p+'-page').hidden=true;
    document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===name));$('#page-label').textContent='服务器列表';window.scrollTo(0,0);managementServers();
  }else managementPage(name);
};
const managementEdit=editNode;
editNode=function(id){managementEdit(id);const form=$('#node-form'),n=state.nodes.find(x=>x.id===id);for(const k of ['ssh_host','ssh_port','ssh_user'])form.elements[k].value=n?.[k]??({ssh_host:'',ssh_port:22,ssh_user:'root'}[k]);form.elements.ssh_password.value='';form.elements.ssh_clear.checked=false;$('#ssh-password-status').textContent=n?.ssh_configured?'已保存密码；留空保留，输入新密码可替换。':'加密保存，页面不会回显。';};
const managementSummary=renderSummary;
const trafficDirections=t=>`↑ ${b(t.tx)}　↓ ${b(t.rx)}`;
renderSummary=function(){
  managementSummary();const cards=$('#summary').children,enabled=state.nodes.filter(n=>n.enabled);
  cards[0].querySelector('.caption').innerHTML=['offline','pending'].map(status=>`<button class="summary-link" data-summary-status="${status}">${enabled.filter(n=>n.status===status).length} 台${status==='offline'?'离线':'待接入'}</button>`).join(' · ');
  cards[0].querySelector('.metric').setAttribute('role','button');cards[0].querySelector('.metric').tabIndex=0;
  const online=()=>managementOpenStatus('online');cards[0].querySelector('.metric').addEventListener('click',online);cards[0].querySelector('.metric').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();online();}});
  for(const [index,key] of [[2,'today'],[3,'month']])cards[index].querySelector('.caption').textContent=trafficDirections(enabled.reduce((s,n)=>({rx:s.rx+n.traffic[key].rx,tx:s.tx+n.traffic[key].tx}),{rx:0,tx:0}));
  const cost=$('#summary .cost-card');if(cost){cost.setAttribute('role','button');cost.tabIndex=0;cost.setAttribute('aria-label','查看月均固定支出对应服务器');cost.addEventListener('click',()=>page('costs'));cost.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();page('costs');}});}
  $('#summary').querySelectorAll('[data-summary-status]').forEach(x=>x.addEventListener('click',()=>managementOpenStatus(x.dataset.summaryStatus)));
};
function managementOpenStatus(status){$('#server-status').value=status;$('#server-search').value='';page('servers');}
const managementNodes=renderNodes;
renderNodes=function(){
  managementNodes();$('#node-grid').querySelectorAll('.node-card').forEach(card=>{const n=state.nodes.find(x=>x.id===card.querySelector('[data-edit]').dataset.edit);card.querySelectorAll('.traffic-grid>div').forEach((cell,index)=>cell.insertAdjacentHTML('beforeend',`<small class="traffic-directions">${trafficDirections(n.traffic[['today','yesterday','cycle'][index]])}</small>`));});
  if(state.page==='servers')managementServers();
};
// Replace the direct event callbacks captured by the older render function.
$('#search').removeEventListener('input',managementNodes);$('#search').addEventListener('input',renderNodes);
$('#group-filter').removeEventListener('change',managementNodes);$('#group-filter').addEventListener('change',renderNodes);
function managementServers(){
  const term=$('#server-search').value.trim().toLowerCase(),status=$('#server-status').value;
  const nodes=state.nodes.filter(n=>(!status||n.status===status)&&(!term||`${n.name} ${n.group_name} ${n.ssh_host}`.toLowerCase().includes(term)));
  const labels={online:'在线',offline:'离线',pending:'待接入',disabled:'已停用'};
  $('#server-table').innerHTML=`<table><thead><tr><th>服务器</th><th>IP / SSH</th><th>状态</th><th>月均费用</th><th>到期 / 上报</th><th>操作</th></tr></thead><tbody>${nodes.map(n=>`<tr><td><strong>${escapeHTML(n.name)}</strong><small class="table-note">${escapeHTML(n.group_name||'未分组')}</small></td><td>${escapeHTML(n.ssh_host||'未设置 IP')}<small class="table-note">${escapeHTML(n.ssh_user)} · ${n.ssh_port}${n.ssh_configured?' · 密码已保存':''}</small></td><td><span class="badge ${n.status}">${labels[n.status]}</span>${n.maintenance?'<small class="table-note">维护中</small>':''}</td><td>${n.cost.active&&n.cost.amount>0?extraMoney(n.cost.monthly_rmb):'不计入'}<small class="table-note">${n.cost.amount.toFixed(2)} ${escapeHTML(n.cost.currency)} / ${n.cost.months} 个月</small></td><td>${escapeHTML(n.expires||'无到期日')}<small class="table-note">${escapeHTML(timestamp(n.last_seen))}</small></td><td><div class="server-actions"><button class="link-button" data-server-edit="${n.id}">配置</button><button class="link-button" data-server-detail="${n.id}">详情 / 删除</button><button class="link-button" data-ssh-test="${n.id}">测试 SSH</button><button class="secondary" data-ssh-deploy="${n.id}" ${n.ssh_configured&&n.ssh_host&&n.enabled&&n.ssh_job?.status!=='running'?'':'disabled'}>一键部署</button>${n.ssh_job?`<button class="link-button" data-ssh-log="${n.id}">部署日志</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="6">暂无匹配服务器。可切换状态筛选，或点击添加服务器。</td></tr>'}</tbody></table>`;
  for(const [attr,fn] of [['server-edit',editNode],['server-detail',detail],['ssh-test',id=>managementSSH(id,false)],['ssh-deploy',id=>managementSSH(id,true)],['ssh-log',managementShowJob]])$('#server-table').querySelectorAll(`[data-${attr}]`).forEach(x=>x.addEventListener('click',()=>fn(x.getAttribute('data-'+attr))));
}
$('#server-search').addEventListener('input',managementServers);$('#server-status').addEventListener('change',managementServers);
async function managementShowJob(id){const n=state.nodes.find(x=>x.id===id);if(!n?.ssh_job)return;$('#ssh-title').textContent=n.name+' · 部署日志';$('#ssh-dialog').showModal();try{const job=await api('/api/ssh/jobs/'+n.ssh_job.id);$('#ssh-log').textContent=job.log;$('#ssh-result').textContent={running:'部署正在进行…',success:'部署完成',failed:'部署失败或中止'}[job.status];}catch(e){$('#ssh-result').textContent=e.message;}}
let managementPolling=null;
async function managementSSH(id,deploy){
  if(managementPolling){toast('请等待当前部署完成，再开始新的操作');return;}
  const n=state.nodes.find(x=>x.id===id);if(!n?.ssh_host||!n.ssh_configured){toast('请先在配置中保存 IP、SSH 用户名和密码');return;}
  $('#ssh-title').textContent=`${n.name} · ${deploy?'一键部署':'测试 SSH'}`;$('#ssh-log').textContent='';$('#ssh-result').textContent='正在连接并核验服务器指纹…';$('#ssh-dialog').showModal();
  try{
    const probe=await post(`/api/nodes/${id}/ssh/probe`);
    if(!probe.trusted){$('#ssh-result').textContent=`SSH 指纹：${probe.fingerprint}`;if(!confirm(`请核对 ${n.ssh_host}:${n.ssh_port} 的 SSH 主机指纹：\n${probe.fingerprint}\n\n可在服务器执行 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 核对。确认信任并继续？`)){$('#ssh-result').textContent='已取消，未保存指纹或部署。';return;}await post(`/api/nodes/${id}/ssh/trust`,{fingerprint:probe.fingerprint});}
    const test=await post(`/api/nodes/${id}/ssh/test`);$('#ssh-result').textContent=test.message;
    if(!deploy){await refresh();return;}
    const job=await post(`/api/nodes/${id}/ssh/deploy`);managementPolling=job.id;
    const poll=async()=>{try{const current=await api('/api/ssh/jobs/'+job.id);$('#ssh-log').textContent=current.log;$('#ssh-result').textContent={running:'正在部署，可关闭窗口，任务会继续。',success:'采集端部署完成；收到上报后显示在线。',failed:'部署未完成，请查看日志。'}[current.status];if(current.status==='running')setTimeout(poll,1500);else{managementPolling=null;await refresh();}}catch(e){managementPolling=null;$('#ssh-result').textContent=e.message;}};await poll();
  }catch(e){$('#ssh-result').textContent=e.message;}
}
const managementToken=showToken;
showToken=function(result){managementToken(result);$('#token-ssh-deploy')?.remove();const n=state.nodes.find(x=>x.id===result.id);if(n?.ssh_configured&&n.ssh_host){const button=document.createElement('button');button.type='button';button.id='token-ssh-deploy';button.className='primary';button.textContent='通过 SSH 一键部署';button.addEventListener('click',()=>{$('#token-dialog').close();managementSSH(n.id,true);});$('#copy-install').insertAdjacentElement('afterend',button);}};
