import {validDate} from './store.mjs';
export const commonCurrencies=['CNY','USD','EUR','GBP','JPY','HKD','KRW','SGD','AUD','CAD','CHF','NZD','TWD','INR','RUB','TRY','BRL','MXN','THB','MYR','IDR','PHP','VND','ZAR','SEK','NOK','DKK','PLN','AED','SAR'];
export const moneyRound=n=>Math.round((n+Number.EPSILON)*100)/100;
export function nodeCost(node,rates) {
  const rate=node.cost_currency==='CNY'?1:rates.rates[node.cost_currency]?.rate;
  const monthly=node.cost_amount/node.cost_months;
  const missing=node.cost_active&&node.cost_amount>0&&!rate;
  return {amount:node.cost_amount,currency:node.cost_currency,months:node.cost_months,active:Boolean(node.cost_active),monthly_native:monthly,rate:rate??null,monthly_rmb:missing?null:moneyRound(node.cost_active?monthly*(rate??1):0),rate_date:node.cost_currency==='CNY'?'':rates.rates[node.cost_currency]?.date??''};
}
export function costSummary(nodes,rates) {
  let total=0,missing=0,count=0;const groups=Object.create(null);
  const rows=nodes.map(n=>{const cost=nodeCost(n,rates);if(n.cost_active&&n.cost_amount>0){count++;if(cost.rate){const value=n.cost_amount/n.cost_months*cost.rate;total+=value;groups[n.group_name||'未分组']=(groups[n.group_name||'未分组']??0)+value;}else missing++;}return {id:n.id,name:n.name,group_name:n.group_name,enabled:Boolean(n.enabled),...cost};});
  return {monthly_rmb:missing?null:moneyRound(total),known_monthly_rmb:moneyRound(total),annual_rmb:missing?null:moneyRound(total*12),count,missing,groups:Object.entries(groups).map(([name,value])=>({name,monthly_rmb:moneyRound(value)})),rows};
}
export function createRates(getDB,options={}) {
  let busy=false;
  const read=()=>({rates:{CNY:{rate:1,date:''}},updated:0,last_attempt:0,error:'',source:'Frankfurter v2',...JSON.parse(getDB().prepare("SELECT value FROM settings WHERE key='fx'").get()?.value??'{}')});
  const write=data=>getDB().prepare("INSERT INTO settings VALUES('fx',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(data));
  async function refresh(force=false) {
    const old=read(),stamp=Math.floor(Date.now()/1000);
    if(busy)return {...old,busy:true};
    if(!force&&stamp-(old.error?old.last_attempt:old.updated)<(old.error?3600:86400))return old;
    if(options.disableExternal&&!options.fetchRates)return old;
    busy=true;
    try {
      let rows;
      if(options.fetchRates)rows=await options.fetchRates();
      else {const response=await fetch('https://api.frankfurter.dev/v2/rates?base=CNY',{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw new Error('汇率服务暂不可用');const text=await response.text();if(text.length>512*1024)throw new Error('汇率响应过大');rows=JSON.parse(text);}
      if(!Array.isArray(rows))throw new Error('汇率格式无效');
      const rates={...old.rates,CNY:{rate:1,date:''}};let accepted=0;
      for(const r of rows){if(r.base==='CNY'&&/^[A-Z]{3}$/.test(r.quote)&&validDate(r.date)&&r.date<=new Date().toISOString().slice(0,10)&&Number.isFinite(r.rate)&&r.rate>1e-12&&r.rate<1e12){rates[r.quote]={rate:1/r.rate,date:r.date};accepted++;}}
      if(!accepted)throw new Error('没有有效汇率');
      const result={...old,rates,updated:stamp,last_attempt:stamp,error:''};write(result);return result;
    }catch(e){const result={...old,last_attempt:stamp,error:(e.message==='fetch failed'?'无法连接汇率服务，请稍后重试':String(e.message)).slice(0,150)};write(result);return result;}finally{busy=false;}
  }
  return {read,refresh,get busy(){return busy;}};
}
