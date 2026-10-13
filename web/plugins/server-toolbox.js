export function mount({container,getNodes,api}){
 const title=document.createElement('h2');title.textContent='服务器工具箱';container.append(title);
 const note=document.createElement('p');note.textContent='先在插件页面授予需要的权限。SSH 操作使用后台已保存的连接配置；写操作由后台确认。';container.append(note);
 const select=document.createElement('select');for(const node of getNodes()){const option=document.createElement('option');option.value=node.id;option.textContent=node.name;select.append(option);}container.append(select);
 const output=document.createElement('pre');output.style.whiteSpace='pre-wrap';
 const button=(text,action)=>{const element=document.createElement('button');element.textContent=text;element.style.margin='8px';element.onclick=async()=>{element.disabled=true;try{const value=await action();output.textContent=JSON.stringify(value,null,2);}catch(e){output.textContent=e.message;}finally{element.disabled=false;}};container.append(element);};
 button('刷新监控',()=>api('/api/nodes'));
 button('最近 30 天流量',()=>api('/api/traffic/history?days=30&node='+encodeURIComponent(select.value)));
 button('费用汇总',()=>api('/api/costs'));
 const name=document.createElement('input');name.placeholder='新的服务器名称';container.append(name);
 button('修改名称',()=>api('/api/nodes/'+select.value,{method:'PUT',body:JSON.stringify({name:name.value})}));
 button('测试已配置 SSH',()=>api('/api/nodes/'+select.value+'/ssh/test',{method:'POST',body:'{}'}));
 button('安装／更新采集端',()=>api('/api/nodes/'+select.value+'/ssh/deploy',{method:'POST',body:'{}'}));
 const message=document.createElement('textarea');message.placeholder='发送到主控已配置的 Telegram';message.maxLength=3000;container.append(message);
 button('发送通知',()=>api('/api/notifications/send',{method:'POST',body:JSON.stringify({message:message.value})}));
 container.append(output);return ()=>container.replaceChildren();
}
