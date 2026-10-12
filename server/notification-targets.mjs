export const notificationTypes=['quota','report','offline','resource','expiry'];
export function notificationSelected(settings,type,id){const ids=settings.notification_targets?.[type];return ids===null||ids===undefined||ids.includes(id);}
export function validateTargets(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!notificationTypes.includes(k)))throw new Error('通知服务器选择格式无效');
  const result={};
  for(const type of notificationTypes){const ids=value[type]??null;if(ids!==null&&(!Array.isArray(ids)||ids.length>200||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))))throw new Error('通知服务器列表无效');result[type]=ids===null?null:[...new Set(ids)];}
  return result;
}
