const regions=new Intl.DisplayNames(['zh-CN'],{type:'region'});
export function publicNodeName(node){
 if(node.public_show_name===true||node.public_show_name===1)return node.name;
 const code=node.country_override||node.country_code;
 if(!/^[A-Z]{2}$/.test(code||''))return '未知地区';
 try{return regions.of(code)||'未知地区';}catch{return '未知地区';}
}
