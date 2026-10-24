(()=>{'use strict';
const el=document.getElementById('items');
const mode=location.pathname.includes('/game/')?'game':'activity';
const key=encodeURIComponent(location.pathname.split('/').pop());
let last=0,first=true,signature='';
function item(parts,platform=''){
 const card=document.createElement('article');card.className='overlay-card platform-'+String(platform).toLowerCase();
 for(const [value,cls] of parts){const node=document.createElement('div');node.className=cls;node.textContent=String(value??'');card.append(node)}
 return card;
}
function state(message,problem=false){el.replaceChildren(item([['KITSUFLOW · '+(mode==='game'?'STREAM INFO':'ACTIVITY'),'tag'],[message,problem?'detail error-state':'overlay-subtitle']]));}
state(mode==='game'?'Waiting for a game and title to be set in your logged-in dashboard.':'Waiting for your first follow, sub, Bits, Kicks or raid event.');
async function refresh(){
 try{
  const res=await fetch('/api/obs/'+mode+'/'+key+(mode==='activity'?'?after='+last:''),{cache:'no-store'});
  if(!res.ok)throw Error('Overlay feed HTTP '+res.status);
  const data=await res.json();
  if(mode==='game'){
   const list=Array.isArray(data.platforms)?data.platforms:[];
   const next=JSON.stringify(list);
   if(next!==signature){
    signature=next;el.replaceChildren();
    if(!list.length)state('No synced stream metadata yet. Set a title and platform game in Connections.');
    else for(const v of list)el.append(item([[v.platform.toUpperCase(),'tag'],[v.title||'Untitled stream','headline'],[v.game||'Category not set','detail']],v.platform));
   }
  }else{
   const events=Array.isArray(data.events)?data.events:[];
   if(events.length){
    if(first)el.replaceChildren();
    for(const v of events){
     last=Math.max(last,Number(v.id)||0);
     const eventName=String(v.event_type||'event').replaceAll('_',' ');
     el.prepend(item([[String(v.platform||'').toUpperCase()+' · '+eventName,'tag'],[String(v.actor||'Viewer')+(v.detail?' · '+v.detail:''),'activity']],v.platform));
    }
    while(el.childElementCount>8)el.lastElementChild.remove();
   }
   first=false;
  }
 }catch(error){console.warn('OBS overlay:',error.message);if(!el.childElementCount)state('Could not load overlay data. Check your private overlay URL.',true)}
 setTimeout(refresh,1600);
}
refresh();
})();