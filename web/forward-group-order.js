'use strict';
function forwardGroupSelectRefresh(){
 forwardGroupFilterRender();const select=$('#forward-group-edit');if(!select)return;const previous=select.value;
 select.innerHTML='<option value="">新建分组</option>'+forwardGroups.map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');
 select.value=forwardGroups.some(g=>g.id===previous)?previous:'';if(previous&&!select.value)select.dispatchEvent(new Event('change'));
}
function forwardGroupDragClear(){
 forwardGroupDragging=null;$('#forward-group-directory')?.querySelectorAll('.dragging,.group-drag-before,.group-drag-after').forEach(row=>row.classList.remove('dragging','group-drag-before','group-drag-after'));
}
async function forwardGroupSaveOrder(ids,expected,focusID){
 if(forwardGroupOrdering||JSON.stringify(ids)===JSON.stringify(expected))return;
 forwardGroupOrdering=true;forwardGroupRevision++;
 const form=$('#forward-group-form'),controls=[...$('#forwarding-dialog-content').querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
 const status=$('#forward-group-order-status');if(status)status.textContent='正在保存分组顺序…';
 try{const result=await post('/api/forwarding/groups/order',{ids,expected_ids:expected});forwardGroups=result.groups;forwardGroupSelectRefresh();if($('#forwarding-dialog').open&&$('#forward-group-directory')){forwardGroupDirectoryRender();$('#forward-group-order-status').textContent='分组顺序已保存';}toast('分组顺序已保存');}
 catch(e){toast(e.message);try{forwardGroups=await api('/api/forwarding/groups');forwardGroupSelectRefresh();}catch{}if($('#forwarding-dialog').open&&$('#forward-group-directory')){forwardGroupDirectoryRender();$('#forward-group-order-status').textContent=e.message;}}
 finally{forwardGroupOrdering=false;controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});if(form?.isConnected&&focusID)$('#forward-group-directory')?.querySelector(`[data-group-drag="${focusID}"]`)?.focus();}
}
function forwardGroupDirectoryRender(){
 const directory=$('#forward-group-directory');if(!directory)return;const scroll=directory.scrollTop;
 directory.innerHTML=forwardGroups.map(g=>`<div class="forward-group-row" data-group-row="${g.id}"><button type="button" class="drag-handle group-drag-handle" draggable="true" data-group-drag="${g.id}" title="拖动排序，也可用上下方向键" aria-label="调整 ${escapeHTML(g.name)} 的分组顺序">⠿</button><div class="forward-group-info"><strong>${escapeHTML(g.name)}</strong><small>${g.node_ids.length} 台服务器</small></div><div><button type="button" class="secondary" data-group-edit="${g.id}">编辑</button><button type="button" class="secondary danger-button" data-group-delete="${g.id}">删除</button></div></div>`).join('')||'<p class="muted">还没有分组，可在下方新建。</p>';
 directory.scrollTop=scroll;
 directory.querySelectorAll('[data-group-edit]').forEach(button=>button.onclick=()=>{if(forwardGroupOrdering)return;$('#forward-group-edit').value=button.dataset.groupEdit;$('#forward-group-edit').dispatchEvent(new Event('change'));$('#forward-group-name').focus();});
 directory.querySelectorAll('[data-group-delete]').forEach(button=>button.onclick=()=>{if(forwardGroupOrdering)return;$('#forward-group-edit').value=button.dataset.groupDelete;$('#forward-group-edit').dispatchEvent(new Event('change'));$('#forward-group-delete').click();});
 directory.querySelectorAll('[data-group-row]').forEach(row=>{
  const handle=row.querySelector('[data-group-drag]');
  handle.ondragstart=event=>{if(forwardGroupOrdering){event.preventDefault();return;}forwardGroupDragging=handle.dataset.groupDrag;row.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',forwardGroupDragging);};
  handle.ondragend=forwardGroupDragClear;
  handle.onkeydown=event=>{if(!['ArrowUp','ArrowDown'].includes(event.key)||forwardGroupOrdering)return;event.preventDefault();const expected=[...directory.querySelectorAll('[data-group-row]')].map(el=>el.dataset.groupRow),ids=[...expected],from=ids.indexOf(handle.dataset.groupDrag),to=from+(event.key==='ArrowUp'?-1:1);if(to<0||to>=ids.length)return;[ids[from],ids[to]]=[ids[to],ids[from]];forwardGroupSaveOrder(ids,expected,handle.dataset.groupDrag);};
  row.ondragover=event=>{if(!forwardGroupDragging||forwardGroupOrdering||forwardGroupDragging===row.dataset.groupRow)return;event.preventDefault();directory.querySelectorAll('.group-drag-before,.group-drag-after').forEach(el=>el.classList.remove('group-drag-before','group-drag-after'));row.classList.add(event.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'group-drag-before':'group-drag-after');};
  row.ondrop=event=>{if(!forwardGroupDragging||forwardGroupOrdering)return;event.preventDefault();const dragged=forwardGroupDragging,expected=[...directory.querySelectorAll('[data-group-row]')].map(el=>el.dataset.groupRow),moving=directory.querySelector(`[data-group-row="${dragged}"]`);if(moving&&moving!==row){if(event.clientY<row.getBoundingClientRect().top+row.offsetHeight/2)row.before(moving);else row.after(moving);}const ids=[...directory.querySelectorAll('[data-group-row]')].map(el=>el.dataset.groupRow);forwardGroupDragClear();forwardGroupSaveOrder(ids,expected,dragged);};
 });
}
