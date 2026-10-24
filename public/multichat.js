(()=>{'use strict';
const feed=document.getElementById('feed'),statusEl=document.getElementById('connection-status');
const secret=encodeURIComponent(location.pathname.split('/').pop());
let after=0,initial=true,tts=false,rate=1.08,volume=1,emotes={};
const empty=document.createElement('div');empty.className='placeholder';empty.textContent='Waiting for messages from connected channels…';feed.append(empty);
function status(data){
 statusEl.replaceChildren();
 const names={twitch:'Twitch',kick:'Kick',vpzone:'VPZone'};
 for(const platform of ['twitch','kick','vpzone']){
  const raw=data?.[platform]?.status||'pending';
  const value=['connected','pending','failed'].includes(raw)?raw:'pending';
  const item=document.createElement('div');
  item.className='connection '+value+' platform-'+platform;
  item.setAttribute('role','status');
  item.setAttribute('aria-label',names[platform]+': '+value);
  item.title=names[platform]+' — '+value+' — '+String(data?.[platform]?.detail||'Awaiting connection');
  const badge=document.createElement('span');badge.className='connection-brand';badge.textContent=platform==='twitch'?'T':platform==='kick'?'K':'V';
  const name=document.createElement('span');name.className='connection-name';name.textContent=names[platform];
  const mark=document.createElement('span');mark.className='connection-mark';
  mark.textContent=value==='connected'?'✓':value==='failed'?'!':'';
  mark.setAttribute('aria-hidden','true');
  item.append(badge,name,mark);statusEl.append(item);
 }
}
function icon(url,name){
 try{const u=new URL(url);if(u.protocol!=='https:')return null;
 const img=document.createElement('img');img.className='chat-emote';img.src=u.href;img.alt=name;img.title=name;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(document.createTextNode(name));return img;
 }catch{return null}
}
function renderWords(target,text){
 const parts=String(text||'').split(/(\s+)/);
 for(const word of parts){const img=emotes[word]?icon(emotes[word],word):null;target.append(img||document.createTextNode(word))}
}
function content(target,item){
 let fragments=[];try{fragments=typeof item.fragments==='string'?JSON.parse(item.fragments):item.fragments||[]}catch{}
 if(!Array.isArray(fragments)||!fragments.length){renderWords(target,item.content);return}
 for(const f of fragments){
  if(f.type==='emote'&&item.platform==='twitch'&&/^\d+$/.test(f.id)){
   const img=icon('https://static-cdn.jtvnw.net/emoticons/v2/'+f.id+'/default/dark/2.0',f.text);
   target.append(img||document.createTextNode(f.text));continue;
  }
  if(f.type==='emote'&&f.url){const img=icon(f.url,f.text);target.append(img||document.createTextNode(f.text));continue}
  renderWords(target,f.text);
 }
}
function line(item){
 if(empty.isConnected)empty.remove();
 const row=document.createElement('article');row.className='message';
 const header=document.createElement('div');header.className='chat-header';
 const tag=document.createElement('span');tag.className='platform '+item.platform;tag.textContent=item.platform.toUpperCase();
 const username=document.createElement('strong');username.className='sender';username.textContent=item.sender;
 const time=document.createElement('time');time.className='chat-time';time.textContent=item.created?item.created.slice(11,16):'';
 const body=document.createElement('div');body.className='chat-body';content(body,item);
 header.append(tag,username,time);row.append(header,body);feed.append(row);
 while(feed.children.length>65)feed.firstChild.remove();
 if(!initial&&tts&&'speechSynthesis'in window){const u=new SpeechSynthesisUtterance(item.sender+' says '+item.content);u.rate=rate;u.volume=volume;u.lang='en-GB';speechSynthesis.speak(u)}
}
async function refreshEmotes(){
 try{const r=await fetch('/api/multichat/emotes/'+secret,{cache:'no-store'});if(r.ok){const j=await r.json();emotes=j.emotes||{}}}catch(e){console.warn('Emote catalog unavailable:',e.message)}
}
async function poll(){
 try{
  const r=await fetch('/api/multichat/feed/'+secret+'?after='+after,{cache:'no-store'});
  if(!r.ok)throw Error('Chat feed HTTP '+r.status);
  const data=await r.json();tts=Boolean(data.tts_enabled);rate=Number(data.tts_rate)||1.08;volume=Number(data.tts_volume??1);
  status(data.connections);
  for(const m of data.messages||[]){after=Math.max(after,Number(m.id)||0);line(m)}
  initial=false;
 }catch(e){if(empty.isConnected)empty.textContent='Chat unavailable. Check this OBS browser source key.';console.warn(e.message)}
 setTimeout(poll,1600);
}
refreshEmotes().then(poll);setInterval(refreshEmotes,15*60*1000);
})();