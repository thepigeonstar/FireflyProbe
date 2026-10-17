const bytes=value=>{const units=['B','KiB','MiB','GiB','TiB'];let i=0;while(value>=1024&&i<4){value/=1024;i++;}return value.toFixed(1)+' '+units[i];};
export function dailyReportLines(nodes,stamp){
 let rx=0,tx=0,stale=0;const lines=nodes.map(n=>{const d=n.traffic.yesterday;rx+=d.rx;tx+=d.tx;const missing=n.history_error||!n.history_seen||stamp-n.history_seen>900;if(missing)stale++;return `${n.status==='online'?'🟢':'🔴'} ${n.name}\n昨日 上传 ${bytes(d.tx)} + 下载 ${bytes(d.rx)} = ${bytes(d.tx+d.rx)}\n周期 ${bytes(n.traffic.measured)}${n.quota?' / '+bytes(n.quota):''}${missing?'\n⚠️ 流量数据未同步或异常':''}`;});
 if(nodes.length)lines.push(`📊 昨日总 上传 ${bytes(tx)} + 下载 ${bytes(rx)} = ${bytes(tx+rx)}\n仅汇总本次日报选中的 ${nodes.length} 台服务器${stale?'\n⚠️ '+stale+' 台流量数据未同步或异常，合计可能不完整':''}`);return lines;
}
