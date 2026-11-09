'use strict';
function forwardDeleteButton(){const button=$('#forward-delete');if(button)button.disabled=forwardBatch.status==='running'||!forwardingRules.length;}
$('#forward-delete').onclick=()=>{
 const node=forwardSelected,group=forwardGroup,rules=forwardingRules.filter(forwardInScope);
 $('#forward-batch-dialog h2').textContent='批量删除转发规则';
 $('#forward-batch-content').innerHTML=`<p>当前服务器 / 分组共 ${rules.length} 条规则，包含其他分页及状态的规则。</p><p class="error">删除会停止选中的萤火转发规则，并删除其配置和转发流量历史。无法撤销；其他入口引用的地址不会自动修改。</p><p class="muted">只处理萤火管理的规则，其他程序创建的 GOST 不会移除。已安装规则需连接 SSH，失败或跳过的配置保留。</p><div class="form-actions"><button type="button" class="secondary" id="forward-delete-all">全选</button><button type="button" class="secondary" id="forward-delete-none">全不选</button></div><div class="forward-copy-list" id="forward-delete-choices">${rules.map(r=>`<label class="check forward-copy-option"><input type="checkbox" value="${r.id}"><span>${escapeHTML(r.name||'未命名')}<small>${escapeHTML(forwardingNodes.find(n=>n.id===r.node_id)?.name||'未知服务器')} · ${r.listen_port} · ${r.protocol.toUpperCase()} → ${escapeHTML(r.target_host)}:${r.target_port}</small></span></label>`).join('')}</div><div class="form-actions"><button type="button" class="secondary danger-button" id="forward-delete-confirm" disabled>删除选中（0）</button></div>`;
 const checks=[...$('#forward-delete-choices').querySelectorAll('input')],selected=()=>checks.filter(c=>c.checked).map(c=>c.value),refresh=()=>{const count=selected().length;$('#forward-delete-confirm').disabled=!count;$('#forward-delete-confirm').textContent=`删除选中（${count}）`;};
 checks.forEach(c=>c.onchange=refresh);
 $('#forward-delete-all').onclick=()=>{checks.forEach(c=>c.checked=true);refresh();};
 $('#forward-delete-none').onclick=()=>{checks.forEach(c=>c.checked=false);refresh();};
 $('#forward-delete-confirm').onclick=async event=>{const ids=selected();if(!ids.length||!confirm(`确认停止并删除选中的 ${ids.length} 条规则及其转发流量历史？此操作无法撤销。`))return;event.target.disabled=true;try{forwardBatch=await post('/api/forwarding/batch',{action:'remove',rule_ids:ids,node_id:node,group_id:group});forwardBatchDialog();forwardBatchRender();await forwardingLoad();}catch(e){toast(e.message);event.target.disabled=false;}};
 $('#forward-batch-dialog').showModal();
};
