export function networkChart(data){
  const rows=data.minutes;
  if(!rows.length)return '<p class="muted">暂无最近 24 小时网速记录，接入后约一分钟开始保存。</p>';
  const number=value=>Number.isFinite(value)?Math.max(0,value):0;
  const bytes=value=>{let n=number(value),i=0;const units=['B','KiB','MiB','GiB','TiB'];while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i?1:0)+' '+units[i];};
  const max=Math.max(1,...rows.map(r=>number(r.rx)+number(r.tx))),span=Math.max(1,data.server_time-data.start);
  const paths=[['rx','#43a598'],['tx','#5d78da'],['total','#bd9650']].map(([key,color])=>{let path='',last=0;for(const r of rows){const x=60+Math.max(0,Math.min(1,(r.minute-data.start)/span))*790,value=key==='total'?number(r.rx)+number(r.tx):number(r[key]),y=250-value/max*200;path+=(last&&r.minute-last<=120?' L':' M')+x.toFixed(1)+' '+y.toFixed(1);last=r.minute;}return `<path d="${path}" stroke="${color}" fill="none" stroke-width="2"/>`;}).join('');
  const axis=[0,.5,1].map(f=>`<path d="M60 ${250-f*200}H850" stroke="#e4eaf4"/><text x="60" y="${240-f*200}" fill="#7b8591" font-size="11">${bytes(max*f)}/s</text>`).join('');
  const labels=[0,.25,.5,.75,1].map(f=>{const date=new Date((data.start+span*f)*1000),time=date.toLocaleTimeString('zh-CN',{timeZone:data.timezone||'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});return `<text x="${60+790*f}" y="278" text-anchor="${f===0?'start':f===1?'end':'middle'}" fill="#7b8591" font-size="11">${time}</text>`;}).join('');
  return `<svg class="public-history-chart" viewBox="0 0 900 300" role="img" aria-label="最近24小时上传、下载和合计网速趋势">${axis}${paths}${labels}</svg><div class="public-legend"><span class="download">↓ 下载</span><span class="upload">↑ 上传</span><span>⇅ 合计</span></div>`;
}
