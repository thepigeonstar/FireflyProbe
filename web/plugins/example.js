export function mount({container,getNodes}){
 const title=document.createElement('h2');title.textContent='服务器分组统计';container.append(title);
 const groups=new Map();for(const node of getNodes()){const name=node.group_name||'未分组';groups.set(name,(groups.get(name)||0)+1);}
 for(const [name,count] of groups){const line=document.createElement('p');line.textContent=name+'：'+count+' 台';container.append(line);}
 if(!groups.size){const text=document.createElement('p');text.textContent='尚未添加服务器';container.append(text);}
 return ()=>container.replaceChildren();
}
