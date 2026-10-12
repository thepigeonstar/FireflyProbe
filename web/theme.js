(()=>{
  const followSystem=document.documentElement.dataset.themeMode==='system';
  const key='firefly-theme',mq=matchMedia('(prefers-color-scheme: dark)');let choice='';
  try{if(!followSystem)choice=localStorage.getItem(key)||'';}catch{}
  function apply(){const dark=followSystem?mq.matches:choice==='dark'||choice!=='light'&&mq.matches;document.documentElement.dataset.theme=dark?'dark':'light';document.querySelectorAll('[data-theme-toggle]').forEach(button=>{button.textContent=dark?'☀':'☾';button.setAttribute('aria-label',dark?'切换浅色模式':'切换深色模式');button.title=button.getAttribute('aria-label');});}
  function bind(){document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>{choice=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,choice);}catch{}apply();}));apply();}
  mq.addEventListener('change',apply);addEventListener('storage',event=>{if(!followSystem&&event.key===key){choice=event.newValue||'';apply();}});apply();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
