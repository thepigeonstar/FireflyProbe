'use strict';
let trafficRankDate='',trafficRankData=null,trafficRankError='',trafficRankAt=0,trafficRankRequest=0,trafficRankLoading=false,trafficRankAll=false,quotaRankAll=false;
function trafficRankToday(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:state.settings.timezone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function trafficRankNote(n){return n?.history_error?'⚠ 流量同步异常':!n?.history_seen?'尚未同步':Date.now()/1000-n.history_seen>900?'⚠ 历史值，超过 15 分钟未同步':'';}
function trafficRankName(n){return `<button type="button" class="link-button rank-node" data-ranking-node="${n.id}">${nodeFlag(n.country_code)}${escapeHTML(n.name)}</button>`;}
function trafficRankingsRender(){
 if(!state.csrf||state.page!=='traffic-rankings')return;const today=trafficRankToday();$('#traffic-rank-date').max=today;if(!trafficRankDate)$('#traffic-rank-date').value=today;
 const data=trafficRankData,valid=data?.date===(trafficRankDate||today),all=valid?data.rows.filter(n=>n.has_sample):[],daily=trafficRankAll?all:all.slice(0,5);
 $('#traffic-ranking-note').textContent=trafficRankError||(!valid?'正在加载…':`${data.date} · ${data.timezone} · 上传 + 下载${data.rows.some(n=>!n.has_sample)?'；'+data.rows.filter(n=>!n.has_sample).length+' 台无当日样本，未参与排名':''}`);
 if(valid)$('#traffic-rank-date').min=data.start;
 $('#traffic-ranking-rows').innerHTML=daily.map((n,i)=>`<li><span class="rank-number">${i+1}</span><div class="rank-main">${trafficRankName(n)}<small>↑ ${b(n.tx)}　↓ ${b(n.rx)}${n.id&&trafficRankNote(state.nodes.find(x=>x.id===n.id))?' · '+escapeHTML(trafficRankNote(state.nodes.find(x=>x.id===n.id))):''}</small></div><strong>${b(n.total)}</strong></li>`).join('')||`<li class="rank-empty">${!valid?'': '该日暂无已同步的流量记录'}</li>`;
 $('#traffic-rank-all').hidden=all.length<=5;$('#traffic-rank-all').textContent=trafficRankAll?'收起':'查看全部 '+all.length+' 台';
 const percent=$('#quota-rank-sort').value==='ratio',quota=state.nodes.filter(n=>n.enabled&&n.quota>0&&n.history_seen&&n.traffic.remaining!==null).sort((a,b)=>percent?b.traffic.ratio-a.traffic.ratio||a.name.localeCompare(b.name):a.traffic.remaining-b.traffic.remaining||a.name.localeCompare(b.name)),visible=quotaRankAll?quota:quota.slice(0,5);
 $('#quota-ranking-rows').innerHTML=visible.map((n,i)=>{const t=n.traffic;return `<li><span class="rank-number">${i+1}</span><div class="rank-main">${trafficRankName(n)}<small>已用 ${t.ratio.toFixed(1)}% · 周期至 ${escapeHTML(t.bounds.end)}${trafficRankNote(n)?' · '+escapeHTML(trafficRankNote(n)):''}${t.forecast?' · 预计 '+escapeHTML(t.forecast)+' 用尽':''}</small></div><strong class="${t.ratio>=95?'rank-danger':t.ratio>=80?'rank-warning':''}">${b(t.remaining)}<small>剩余</small></strong></li>`;}).join('')||'<li class="rank-empty">暂无已设置额度并同步流量的服务器</li>';
 $('#quota-rank-all').hidden=quota.length<=5;$('#quota-rank-all').textContent=quotaRankAll?'收起':'查看全部 '+quota.length+' 台';
 $('#traffic-rankings').querySelectorAll('[data-ranking-node]').forEach(button=>button.onclick=()=>managementNetworkDetail(button.dataset.rankingNode));
 if(state.page==='traffic-rankings'&&!trafficRankLoading&&((!valid&&!trafficRankError)||Date.now()-trafficRankAt>60000))trafficRankLoad();
}
async function trafficRankLoad(){const request=++trafficRankRequest,date=trafficRankDate||trafficRankToday(),csrf=state.csrf;trafficRankLoading=true;trafficRankAt=Date.now();trafficRankError='';try{const result=await api('/api/traffic/rankings?'+new URLSearchParams({date}));if(request!==trafficRankRequest||csrf!==state.csrf)return;trafficRankData=result;}catch(e){if(request===trafficRankRequest)trafficRankError=e.message;}finally{if(request===trafficRankRequest){trafficRankLoading=false;trafficRankingsRender();}}}
function trafficRankChoose(date){trafficRankDate=date;$('#traffic-rank-date').value=date;trafficRankError='';trafficRankData=null;trafficRankLoading=true;trafficRankingsRender();trafficRankLoad();}
$('#traffic-rank-date').onchange=event=>trafficRankChoose(event.target.value||trafficRankToday());
$('#traffic-rank-today').onclick=()=>trafficRankChoose(trafficRankToday());
$('#traffic-rank-yesterday').onclick=()=>trafficRankChoose(new Date(Date.parse(trafficRankToday()+'T12:00:00Z')-864e5).toISOString().slice(0,10));
$('#traffic-rank-all').onclick=()=>{trafficRankAll=!trafficRankAll;trafficRankingsRender();};$('#quota-rank-all').onclick=()=>{quotaRankAll=!quotaRankAll;trafficRankingsRender();};$('#quota-rank-sort').onchange=trafficRankingsRender;
const trafficRankSummary=renderSummary;renderSummary=function(){trafficRankSummary();trafficRankingsRender();};
const trafficRankPage=page;page=function(name){$('#traffic-rankings-page').hidden=true;if(name!=='traffic-rankings')return trafficRankPage(name);trafficRankPage('overview');state.page=name;document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!=='traffic-rankings-page');$('#page-label').textContent='仪表盘 / 流量排名';trafficRankingsRender();window.scrollTo(0,0);};
$('#open-traffic-rankings').onclick=()=>page('traffic-rankings');$('#traffic-rankings-back').onclick=()=>page('overview');
