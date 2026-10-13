export const brandDefaults = { brand_name:'萤火', brand_english:'Firefly Probe', brand_logo:'', brand_favicon:'', login_subtitle:'服务器状态与流量，一个地方看清。',public_title:'服务器状态',overview_title:'每一台服务器，尽在掌握' };
export const brandView = settings => Object.fromEntries(Object.keys(brandDefaults).map(k=>[k,settings[k] ?? brandDefaults[k]]));

export function validateBrand(input, old) {
  const result=brandView(old);
  for(const key of ['brand_name','brand_english']) {
    if(input[key]===undefined) continue;
    if(typeof input[key]!=='string' || input[key].trim().length>60 || /[\x00-\x1f\x7f]/.test(input[key])) throw new Error('品牌名称最多 60 个字符');
    result[key]=input[key].trim();
  }
  if(input.login_subtitle!==undefined){if(typeof input.login_subtitle!=='string'||input.login_subtitle.length>240||/[\x00-\x1f\x7f]/.test(input.login_subtitle))throw new Error('登录文案最多 240 个字符');result.login_subtitle=input.login_subtitle.trim();}
  for(const key of ['public_title','overview_title'])if(input[key]!==undefined){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>120||/[\x00-\x1f\x7f]/.test(input[key]))throw new Error('页面标题需为 1–120 个字符');result[key]=input[key].trim();}
  if(!result.brand_name) throw new Error('请填写显示名称');
  for(const key of ['brand_logo','brand_favicon']) {
    if(input[key]===undefined) continue;
    if(input[key]==='') {result[key]='';continue;}
    if(typeof input[key]!=='string' || input[key].length>90000) throw new Error('图标过大，请使用较小的图片');
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input[key]);
    if(!match) throw new Error('图标仅支持 PNG、JPEG、WebP 图片');
    const bytes=Buffer.from(match[2],'base64');
    if(bytes.length>65536 || bytes.toString('base64')!==match[2]) throw new Error('图标数据无效或超过 64 KiB');
    const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!valid) throw new Error('图标格式与文件内容不一致');
    result[key]=input[key];
  }
  return result;
}
