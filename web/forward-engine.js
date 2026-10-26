'use strict';
let forwardEngineNode='',forwardEngineLoading=false,forwardEngineGeneration=0;
function engineLog(text){return forwardingFriendlyLog(text).replace(/^FIREFLY_FINAL .*\n?/gm,'').replaceAll('FIREFLY_ENGINE_SHARED','共享进程已启用').replaceAll('FIREFLY_ENGINE_LEGACY','独立进程已恢复');}
function forwardEngineStatus(node){
 const engine=node.engine;
 if(!engine)return {kind:'unknown',label:'待加载'};
 if(engine.status==='running')return {kind:'running',label:engine.target==='legacy'?'回退中':'切换中'};
 if(engine.status==='failed')return {kind:'failed',label:'需核对'};
 if(engine.mode==='shared')return {kind:'shared',label:'已共享'};
 if(!forwardingRules.some(r=>r.node_id===node.id&&r.installed))return {kind:'draft',label:'未部署'};
 return {kind:'legacy',label:'独立进程'};
}
function forwardEngineBadge(node){const status=forwardEngineStatus(node);return `<span class="forward-engine-badge ${status.kind}">${status.label}</span>`;}
function forwardEngineNodes(){return forwardingNodes.filter(n=>n.engine?.mode==='shared'||['running','failed'].includes(n.engine?.status)||forwardingRules.some(r=>r.node_id===n.id));}
function forwardEngineOverviewRender(){
 if(!$('#forward-engine-overview'))return;
 const nodes=forwardEngineNodes(),counts={shared:0,legacy:0,draft:0,running:0,failed:0,unknown:0};
 for(const node of nodes)counts[forwardEngineStatus(node).kind]++;
 $('#forward-engine-counts').textContent=[['shared','已共享'],['legacy','独立进程'],['draft','未部署'],['running','切换中'],['failed','需核对'],['unknown','待加载']].filter(([key])=>counts[key]||['shared','legacy'].includes(key)).map(([key,label])=>`${label} ${counts[key]} 台`).join(' · ');
 const overview=$('#forward-engine-overview'),markup=nodes.map(n=>`<button type="button" class="forward-engine-row ${n.id===forwardEngineNode?'selected':''}" data-engine-node="${n.id}" aria-pressed="${n.id===forwardEngineNode}"><span>${nodeFlag(n.country_code)}${escapeHTML(n.name)}</span>${forwardEngineBadge(n)}</button>`).join('')||'<p class="muted">暂无转发服务器。</p>';
 if(overview.engineMarkup!==markup){overview.innerHTML=markup;overview.engineMarkup=markup;overview.querySelectorAll('[data-engine-node]').forEach(el=>el.onclick=()=>forwardEngineSelect(el.dataset.engineNode));}
 const select=$('#forward-engine-node'),options=nodes.map(n=>`<option value="${n.id}">${escapeHTML(n.name)} · ${forwardEngineStatus(n).label}</option>`).join('');if(select.engineMarkup!==options){select.innerHTML=options;select.engineMarkup=options;}select.value=forwardEngineNode;
}
function forwardEngineSelect(id){
 forwardEngineNode=id;forwardEngineGeneration++;forwardEngineOverviewRender();$('#forward-engine-state').textContent='正在加载…';$('#forward-engine-log').textContent='';$('#forward-engine-shared').disabled=true;$('#forward-engine-legacy').disabled=true;forwardEngineLoad();
}
async function forwardEngineLoad(){
 if(forwardEngineLoading||!$('#forwarding-dialog').open||!$('#forward-engine-state')||!forwardEngineNode)return;const id=forwardEngineNode,generation=forwardEngineGeneration;forwardEngineLoading=true;
 try{
  const data=await api('/api/forwarding/engine?'+new URLSearchParams({node:id}));if(generation!==forwardEngineGeneration||!$('#forward-engine-state'))return;
  const node=forwardingNodes.find(n=>n.id===id);if(node)node.engine={mode:data.mode,status:data.status,target:data.target};forwardServersRender();forwardEngineOverviewRender();
  $('#forward-engine-state').textContent=(data.mode==='shared'?'已共享 · 每台服务器一个 GOST':'独立进程 · 每条规则一个 GOST')+(data.status==='running'?' · 正在切换':data.status==='failed'?' · 上次操作未完成，请查看日志核对远端状态':'');
  $('#forward-engine-log').textContent=engineLog(data.log||'尚无引擎切换记录');
  $('#forward-engine-shared').disabled=data.status==='running'||data.mode==='shared'&&data.status!=='failed';$('#forward-engine-legacy').disabled=data.status==='running'||data.mode!=='shared'&&data.status!=='failed';
  $('#forward-engine-shared').textContent=data.mode==='shared'&&data.status!=='failed'?'已启用共享进程':'切换共享进程';
 }catch(e){if(generation===forwardEngineGeneration&&$('#forward-engine-state')){$('#forward-engine-state').textContent=e.message;$('#forward-engine-shared').disabled=true;$('#forward-engine-legacy').disabled=true;}}
 finally{forwardEngineLoading=false;if(generation!==forwardEngineGeneration)forwardEngineLoad();}
}
function forwardEngineOpen(){
 forwardingLogID=null;forwardingHistoryGeneration++;forwardEngineGeneration++;const nodes=forwardEngineNodes();forwardEngineNode=nodes.some(n=>n.id===forwardSelected)?forwardSelected:nodes[0]?.id||'';
 $('#forwarding-dialog-title').textContent='转发引擎';$('#forwarding-dialog-content').innerHTML=`<p id="forward-engine-counts" class="muted" aria-live="polite"></p><div id="forward-engine-overview" aria-label="各服务器转发引擎状态"></div><p class="muted">以上为主控记录的部署模式，不代表远端服务实时在线。切换失败的服务器请查看日志核对。</p><label>服务器<select id="forward-engine-node"></select></label><p id="forward-engine-state" aria-live="polite">${nodes.length?'正在加载…':'请先添加转发规则'}</p><p>共享模式将本机多条规则合并到一个 GOST 进程。每个监听端口仍是一条独立规则，可单独启停、编辑和统计流量。已共享的服务器后续新增规则，安装时会自动加入共享进程，无需重复切换。</p><p class="muted">先在服务器列表更新采集端至 0.2.5 或以上。切换与回退会短暂中断本机转发连接，保留规则和主控已保存的流量历史。共享进程故障会影响该机全部规则，节省内存的实际幅度取决于连接与流量。</p><div class="form-actions"><button type="button" class="primary" id="forward-engine-shared" disabled>切换共享进程</button><button type="button" class="secondary" id="forward-engine-legacy" disabled>回退独立进程</button></div><pre id="forward-engine-log" class="deployment-log"></pre>`;
 forwardEngineOverviewRender();$('#forward-engine-node').onchange=event=>forwardEngineSelect(event.target.value);
 for(const [selector,mode] of [['#forward-engine-shared','shared'],['#forward-engine-legacy','legacy']])$(selector).onclick=async()=>{
  const id=forwardEngineNode,generation=forwardEngineGeneration;if(!id){toast('请先选择有转发规则的服务器');return;}
  if(!confirm((mode==='shared'?'切换共享进程':'回退独立进程')+'将短暂中断这台服务器的转发连接，继续？'))return;
  $('#forward-engine-shared').disabled=true;$('#forward-engine-legacy').disabled=true;
  try{await post('/api/forwarding/engine/'+id,{mode});await forwardingLoad();if(generation===forwardEngineGeneration)await forwardEngineLoad();}
  catch(e){toast(e.message);if(generation===forwardEngineGeneration)forwardEngineLoad();}
 };
 $('#forwarding-dialog').showModal();forwardEngineLoad();
}
$('#forward-engine-open').onclick=forwardEngineOpen;
setInterval(forwardEngineLoad,2000);
