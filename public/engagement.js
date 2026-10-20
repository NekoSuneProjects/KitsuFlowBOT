// StreamNexus engagement dashboard — loaded alongside the main Studio UI.
(async()=>{
const root=document.querySelector('#root'),notice=document.querySelector('#message');
const api=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data};
const t=(tag,txt)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;return e};
const field=(label,type='text',value='')=>{const wrap=t('label',label+' '),input=t('input');input.type=type;if(type==='checkbox')input.checked=Boolean(value);else input.value=value;wrap.append(input);return {wrap,input}};
const forms=[
{title:'Chat timers',route:'timer',fields:[['name','Name'],['message','Message'],['minutes','Every N minutes','number',15]],key:'timers',display:x=>x.name+' · every '+x.minutes+'m · '+x.message},
{title:'Counters',route:'counter',fields:[['name','Name'],['value','Starting/current value','number',0]],key:'counters',display:x=>x.name+' = '+x.value},
{title:'Banned words',route:'word',fields:[['word','Word or phrase'],['action','Action: log, timeout, ban','text','timeout']],key:'words',display:x=>x.word+' → '+x.action},
{title:'Quotes',route:'quote',fields:[['text','Quote text']],key:'quotes',display:x=>'#'+x.id+' '+x.text}
];
async function paint(){
 const state=await api('/api/engagement');document.querySelectorAll('.engagement-panel').forEach(e=>e.remove());
 for(const config of forms){const p=t('section');p.className='panel engagement-panel';p.append(t('h2',config.title));const form=t('form'),fields={};
 for(const [key,label,type='text',def=''] of config.fields){const input=field(label,type,def);fields[key]=input.input;form.append(input.wrap)}
 const submit=t('button','Save');submit.type='submit';form.append(submit);form.onsubmit=async e=>{e.preventDefault();try{const body=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.type==='number'?Number(v.value):v.value]));await api('/api/engagement/'+config.route,'POST',body);notice.textContent=config.title+' saved';await paint()}catch(err){notice.textContent=err.message}};p.append(form);
 for(const row of state[config.key]){const item=t('div',config.display(row)+' ');item.className='item';const del=t('button','Remove');del.onclick=async()=>{if(!confirm('Remove this item?'))return;try{await api('/api/engagement/'+config.route+'/'+encodeURIComponent(row[config.route==='quote'?'id':config.route==='word'?'word':'name']),'DELETE');await paint()}catch(err){notice.textContent=err.message}};item.append(del);p.append(item)}root.append(p)}
 const p=t('section');p.className='panel engagement-panel';p.append(t('h2','Viewer loyalty points'));p.append(t('p','Points are earned by recently active chatters while the stream is live. Twitch does not provide a complete viewer list, so passive lurkers cannot be reliably credited by this chat-based method.'));
 const enabled=field('Enable viewer points','checkbox',state.loyalty.enabled),points=field('Points per reward','number',state.loyalty.points_per_interval),interval=field('Reward interval (minutes)','number',state.loyalty.interval_minutes);p.append(enabled.wrap,points.wrap,interval.wrap);
 const save=t('button','Save loyalty settings');save.onclick=async()=>{try{await api('/api/engagement/loyalty','POST',{enabled:enabled.input.checked,points_per_interval:Number(points.input.value),interval_minutes:Number(interval.input.value)});await paint()}catch(err){notice.textContent=err.message}};p.append(save,t('h3','Top viewers'));for(const v of state.leaderboard)p.append(t('div',v.username+' · '+v.points+' points'));root.append(p);
}
const orig=window.fetch;let mounted=false;
const observer=new MutationObserver(()=>{if(!mounted&&document.querySelector('#root .panel h2')?.textContent==='Connections'){mounted=true;paint().catch(e=>{notice.textContent=e.message})}});
observer.observe(root,{childList:true,subtree:false});
})();
