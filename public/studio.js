(()=>{'use strict';
const $=s=>document.querySelector(s),e=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x}, h=(tag,cls,...children)=>{const x=e(tag,undefined,cls);for(const y of children)if(y!=null)x.append(typeof y==='string'?document.createTextNode(y):y);return x};
let state=null,access=null,creator=null,engagement=null,page='overview';
const groups=[['WORKSPACE',[['overview','◫','Overview'],['activity','◷','Activity Feed'],['reports','▥','Data & Reports']]],['BOT MANAGEMENT',[['commands','⌘','Custom Commands'],['timers','◴','Timers'],['moderation','◇','Moderation'],['voice','◉','Voice & Clips']]],['COMMUNITY',[['loyalty','✧','Loyalty & Points'],['campaigns','♢','Giveaways & Contests'],['store','▣','Stream Store'],['queue','☷','Viewer Queue'],['quotes','❞','Quotes & Counters']]],['STREAM TOOLS',[['overlays','▤','Overlay Studio'],['connections','⇄','Connections']]],['SETTINGS',[['channel','⚙','Channel Settings'],['team','♙','Team & Invites'],['admin','♛','Admin Panel']]]];
const ownerPages=new Set(['connections','team','channel','overlays']);
const descriptions={overview:'A clear view of everything happening across your channel.',activity:'Recent messages, moderation and bot activity.',reports:'Understand loyalty activity, redemptions and channel engagement.',commands:'Create and manage the commands your viewers can use.',timers:'Schedule automatic Twitch chat announcements.',moderation:'Keep your community safe with moderation controls.',voice:'Create clips with your voice or a single click.',loyalty:'Configure loyalty rewards and view community standings.',campaigns:'Run community giveaways and draw winners.',store:'Manage redeemable loyalty-point rewards.',queue:'Organise who plays or joins you next.',quotes:'Capture favourite moments and manage counters.',overlays:'Create OBS browser sources for your stream.',connections:'View broadcaster and shared public bot status.',channel:'Manage your own channel and security credentials.',team:'Invite editors and trusted moderators.',admin:'Configure and monitor the public bot for all channels.'};
function notify(text){$('#notice').textContent=text;setTimeout(()=>{if($('#notice').textContent===text)$('#notice').textContent=''},6500)}
async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let x;try{x=await r.json()}catch{x={error:'Unexpected server response'}}if(!r.ok)throw Error(x.error||'Request failed');return x}
const error=fn=>async(...args)=>{try{return await fn(...args)}catch(ex){notify(ex.message)}};
async function load(){try{state=await api('/api/state');access=await api('/api/access');creator=await api('/api/creator');engagement=await api('/api/engagement');$('#shell').hidden=false;$('#login').hidden=true;buildNav();updateChrome();buildNav();await show(page)}catch(ex){if(ex.message==='Login required'){location.replace('/login');return}else{$('#shell').hidden=false;notify(ex.message)}}}
const card=(title,description)=>{const c=h('section','card');c.append(e('h2',title));if(description)c.append(e('div',description,'description'));return c};
const wrap=(...things)=>h('div','grid cols2',...things);
const grid=(cls,...things)=>h('div','grid '+cls,...things);
const actions=(...things)=>h('div','actions',...things);
const btn=(label,handler,cls='')=>{const b=e('button',label,'btn '+cls);b.onclick=error(async()=>{b.disabled=true;try{await handler()}finally{b.disabled=false}});return b};
const link=(label,url,cls='')=>{const x=e('a',label,'btn '+cls);x.href=url;return x};
const input=(label,value='',type='text')=>{const l=h('label','field',e('span',label));let x=e(type==='textarea'?'textarea':type==='select'?'select':'input');if(type!=='textarea'&&type!=='select')x.type=type;if(type==='checkbox')x.checked=!!value;else x.value=value??'';l.append(x);return {node:l,value:()=>type==='checkbox'?x.checked:type==='number'?Number(x.value):x.value,el:x}};
function selector(label,options,initial){const i=input(label,initial,'select');for(const opt of options){const o=e('option',Array.isArray(opt)?opt[1]:opt);o.value=Array.isArray(opt)?opt[0]:opt;i.el.append(o)}i.el.value=initial;return i}
const form=(title,fields,buttonText,run)=>{const c=card(title),fieldsBox=h('div','fields');const refs={};for(const spec of fields){let f=spec[2]==='options'?selector(spec[1],spec[3],spec[4]||spec[3][0]):input(spec[1],spec[3]??'',spec[2]||'text');refs[spec[0]]=f;fieldsBox.append(f.node)}c.append(fieldsBox,actions(btn(buttonText,async()=>{await run(Object.fromEntries(Object.entries(refs).map(([k,v])=>[k,v.value()])));notify('Saved successfully');await reloadView()},'primary')));return c};
const table=(cols,rows)=>{if(!rows?.length)return e('div','No records yet.','empty');const t=e('table',undefined,'table'),thead=e('thead'),tr=e('tr');cols.forEach(c=>tr.append(e('th',c)));thead.append(tr);t.append(thead);const tbody=e('tbody');for(const values of rows){const r=e('tr');for(const val of values)r.append(h('td','',val instanceof Node?val:String(val??'')));tbody.append(r)}t.append(tbody);return t};
async function reloadView(){state=await api('/api/state');access=await api('/api/access');creator=await api('/api/creator');engagement=await api('/api/engagement');updateChrome();await show(page)}
function buildNav(){const nav=$('#nav');nav.replaceChildren();for(const [heading,items] of groups){const visible=items.filter(([id])=>(id!=='admin'||state.isOperator)&&(!ownerPages.has(id)||access.role==='owner'));if(!visible.length)continue;nav.append(e('div',heading,'nav-group'));for(const [id,icon,title] of visible){const b=h('button','nav-link',e('span',icon,'glyph'),e('span',title));b.dataset.page=id;b.onclick=()=>show(id);nav.append(b)}}}
function updateChrome(){$('#channel-label').textContent=state.channel?.login||'Channel';$('#profile-name').textContent=state.channel?.login||'Account';const st=$('#global-status');st.textContent=state.bot?'Global Bot: @'+state.bot.login:'Public bot not connected';st.className='pill '+(state.bot?'good':'warn')}
function popup(){const menu=$('#profile-menu');menu.replaceChildren();menu.hidden=!menu.hidden;if(menu.hidden)return;menu.append(e('div','SWITCH CHANNEL','nav-group'));for(const ch of access.channels){const b=e('button',(ch.id===access.active_channel?'✓ ':'')+ch.login+' — '+ch.role);b.onclick=error(async()=>{await api('/api/channels/select','POST',{channel:ch.id});location.reload()});menu.append(b)}const log=e('button','Sign out');log.onclick=error(async()=>{await api('/logout','POST');location.reload()});menu.append(log)}
$('#profile').onclick=popup;$('#side-channel').onclick=popup;$('#refresh').onclick=error(reloadView);
const list=(items,display,onRemove)=>{const box=e('div');if(!items.length)return e('div','Nothing configured yet.','empty');for(const item of items){const row=h('div','list-row',e('div',display(item)));if(onRemove)row.append(btn('Remove',async()=>{if(!confirm('Remove this item?'))return;await onRemove(item);await reloadView()},'danger'));box.append(row)}return box};
const stat=(label,num,icon,foot)=>h('section','card',e('div',icon,'stat-icon'),e('div',label,'stat-label'),e('div',String(num),'stat-value'),e('div',foot,'stat-foot'));
const banner=(title,desc,action)=>h('div','banner',h('div','',e('strong',title),e('p',desc)),e('div',undefined,'spacer'),action);
function overview(){const v=e('div',undefined,'stack');v.append(grid('stats',stat('Loyalty members',creator.stats.members,'♙','Active chat participants'),stat('Points in circulation',creator.stats.points.toLocaleString(),'✧','Current balances'),stat('Store redemptions',creator.stats.redemptions,'▣','All-time requests'),stat('Active commands',state.commands.length,'⌘','Available in this channel')));
if(!state.channel.enabled)v.append(banner('Your channel bot is currently disabled','Enable the bot to start receiving channel chat and responding to commands.',btn('Channel settings →',()=>show('connections'),'primary')));
v.append(wrap(h('section','card',e('h2','Recent activity'),table(['When','Event','Details'],creator.activity.slice(0,8).map(x=>[x.created,x.event,x.detail])),actions(btn('View activity feed',()=>show('activity')))),h('section','card',e('h2','Channel health'),h('div','list-row',e('span','Streamer account'),e('strong','Connected')),h('div','list-row',e('span','Shared Twitch bot'),e('strong',state.bot?'@'+state.bot.login:'Not linked')),h('div','list-row',e('span','Bot enabled'),e('strong',state.channel.enabled?'Yes':'No')),h('div','list-row',e('span','Your access'),e('strong',state.role)))));return v}
async function activity(){
 const events=await api('/api/stream-activity');
 const c=card('Activity feed','Live follows, subscriptions, gifts, Bits, Kicks and raids, where supported. Announcement settings below are owner-only and post only to the originating chat.');
 if(!events.length)c.append(e('div','No stream engagement events received yet. Events appear once platform subscriptions are connected.','empty'));
 else c.append(table(['When','Platform','Event','Viewer','Details'],events.map(x=>[x.created,x.platform.toUpperCase(),x.event_type.replaceAll('_',' '),x.actor||'—',x.detail||'—'])));
 c.dataset.liveActivity='true';
 if(access.role!=='owner')return c;
 const config=await api('/api/stream-announcements');
 const settings=card('Platform-local event announcements','Each toggle controls only its own platform. Announcements are disabled by default; customise the message and save each event.');
 const names={follow:'New follower',subscription:'New subscription',subscription_gift:'Gifted subscriptions',cheer:'Twitch Bits',kicks:'Kick Kicks',raid:'Raid'};
 for(const platform of ['twitch','kick','vpzone']){
  const group=h('section','kf-settings-section',e('h3',platform.toUpperCase()));
  for(const entry of config.settings.filter(x=>x.platform===platform)){
   const toggle=input('Post '+(names[entry.event_type]||entry.event_type)+' to '+platform+' chat',entry.enabled,'checkbox');
   const template=input('Announcement message',entry.template);
   group.append(h('div','kf-result',grid('cols2',toggle.node,template.node),actions(btn('Save '+(names[entry.event_type]||entry.event_type),async()=>{
    await api('/api/stream-announcements','POST',{platform,event_type:entry.event_type,enabled:toggle.value(),template:template.value()});
    notify(platform.toUpperCase()+' '+entry.event_type+' announcement saved');
   },'primary'))));
  }
  settings.append(group);
 }
 return h('div','stack',c,settings);
}
// All feature panels keep a consistent header, icon and accent treatment.
function enhanceCreatorPanels(root){
 const icons=new Map([['Unified creator profile','◉'],['Set title and game on linked platforms','▤'],['AI stream title helper','✦'],['Multi-chat OBS browser source','◈'],['Linked streaming channels','⇄']]);
 root.querySelectorAll('.card').forEach(c=>{
  const heading=c.querySelector(':scope > h2');
  if(!heading||!icons.has(heading.textContent)||heading.parentElement.classList.contains('kf-panel-heading'))return;
  const description=heading.nextElementSibling?.classList.contains('description')?heading.nextElementSibling:null;
  const title=heading.textContent,wrapper=h('div','kf-panel-heading',e('span',icons.get(title),'kf-panel-icon'));
  const copy=h('div','');
  copy.append(heading);
  if(description)copy.append(description);
  wrapper.append(copy);
  c.prepend(wrapper);
 });
}
function reports(){return grid('stats',stat('Total members',creator.stats.members,'♙','Chat-based activity'),stat('Loyalty points',creator.stats.points,'✧','Current issued balances'),stat('Redemptions',creator.stats.redemptions,'▣','Store requests'),stat('Queue',creator.queue.length,'☷','Waiting viewers'))}
function editorSlot(id){const node=h('div','');node.id=id;return node}
function editCommand(item){
 const pane=card('Edit !'+item.name,'Update the response, permission and cooldown without deleting the command.');
 const response=input('Bot response',item.response,'textarea');
 const cooldown=input('Cooldown (seconds)',item.cooldown,'number');
 const level=selector('Permission',['everyone','subscriber','moderator'],item.level);
 pane.append(grid('cols2',response.node,cooldown.node,level.node),
  actions(btn('Save changes',async()=>{await api('/api/commands','POST',{name:item.name,response:response.value(),cooldown:cooldown.value(),level:level.value()});notify('Command updated');await reloadView()},'primary'),
   btn('Cancel',()=>reloadView())));
 return pane;
}
async function globalCommandsPanel(){
 const data=await api('/api/commands/global');
 const panel=card('Global bot commands','Choose which built-in commands viewers can use. Supermods are explicitly assigned by the channel owner.');
 const rows=data.commands.map(cmd=>{
  const enabled=input('Enable !'+cmd.name,Boolean(cmd.enabled),'checkbox');
  return h('div','kf-result',
   h('div','',e('strong','!'+cmd.name),e('div',cmd.description+' · '+cmd.level,'description')),
   enabled.node,
   actions(btn('Save',async()=>{await api('/api/commands/global','POST',{name:cmd.name,enabled:enabled.value()});notify('Global command preference saved')},'primary')));
 });
 panel.append(...rows);
 const modPanel=card('Supermods','Only the channel owner and assigned supermods may use sensitive !settitle, !setgame, !setpoints and !addpoints commands. Regular Twitch moderators can use !so.');
 const name=input('Twitch username to grant supermod access');
 modPanel.append(name.node,actions(btn('Add supermod',async()=>{await api('/api/commands/supermod','POST',{login:name.value(),enabled:true});notify('Supermod added');await reloadView()},'primary')));
 for(const mod of data.supermods)modPanel.append(h('div','kf-result',e('strong','@'+mod.login),actions(btn('Remove',async()=>{if(!confirm('Remove supermod @'+mod.login+'?'))return;await api('/api/commands/supermod','POST',{login:mod.login,enabled:false});await reloadView()},'danger'))));
 return access.role==='owner'?h('div','stack',panel,modPanel):h('div','stack',panel);
}
async function commands(){
 const globals=await globalCommandsPanel();
 const records=state.commands.map(x=>[
  '!'+x.name,x.response,x.level,
  actions(btn('Edit',()=>{const target=$('#command-editor');target.replaceChildren(editCommand(x));target.scrollIntoView({behavior:'smooth',block:'nearest'})}),
   btn('Delete',async()=>{if(!confirm('Delete !'+x.name+'?'))return;await api('/api/commands/'+encodeURIComponent(x.name),'DELETE');await reloadView()},'danger'))
 ]);
 return h('div','stack',h('div','grid cols2',
  form('Create custom command',[['name','Command name (! without prefix)'],['response','Bot response'],['cooldown','Cooldown in seconds','number',10],['level','Permission','options',['everyone','subscriber','moderator']]],'Save command',x=>api('/api/commands','POST',x)),
  h('section','card',e('h2','Saved commands'),table(['Command','Response','Level','Actions'],records))),
  editorSlot('command-editor'),globals);
}
function editTimer(item){
 const pane=card('Edit timer: '+item.name,'Update its message, interval and enabled state.');
 const message=input('Announcement message',item.message,'textarea');
 const minutes=input('Interval (minutes)',item.minutes,'number');
 const enabled=input('Enabled',Boolean(item.enabled),'checkbox');
 pane.append(grid('cols2',message.node,minutes.node,enabled.node),
  actions(btn('Save changes',async()=>{await api('/api/engagement/timer','POST',{name:item.name,message:message.value(),minutes:minutes.value(),enabled:enabled.value()});notify('Timer updated');await reloadView()},'primary'),
   btn('Cancel',()=>reloadView())));
 return pane;
}
function timers(){
 const rows=engagement.timers.map(x=>[
  x.name,x.message,'Every '+x.minutes+' min',x.enabled?'Enabled':'Paused',
  actions(btn('Edit',()=>{const target=$('#timer-editor');target.replaceChildren(editTimer(x));target.scrollIntoView({behavior:'smooth',block:'nearest'})}),
   btn('Delete',async()=>{if(!confirm('Delete timer '+x.name+'?'))return;await api('/api/engagement/timer/'+encodeURIComponent(x.name),'DELETE');await reloadView()},'danger'))
 ]);
 return h('div','stack',h('div','grid cols2',
   form('Create chat timer',[['name','Timer name'],['message','Announcement message'],['minutes','Interval (minutes)','number',15]],'Save timer',x=>api('/api/engagement/timer','POST',x)),
   h('section','card',e('h2','Current timers'),e('p','Timers post only while live and viewers have chatted in the past 10 minutes.','description'),table(['Name','Message','Interval','Status','Actions'],rows))),
   editorSlot('timer-editor'));
}
async function moderation(){
 const scam=await api('/api/scam-protection');
 const section=card('Scam link protection','Opt-in: OFF by default. Checks known phishing, malicious and scam domains, including obfuscated (dot) links.');
 const enabled=input('Enable automatic Twitch scam moderation',Boolean(scam.enabled),'checkbox');
 const action=selector('Action when a blocked domain is detected',[['ban','Ban user'],['timeout','Timeout for 1 second']],scam.action||'ban');
 section.append(enabled.node,action.node,e('p','Twitch bot performs moderation with a recorded reason. Requires the linked bot to have chat moderation permissions. Kick/VPZone auto-ban is not enabled without verified moderation integration. Third-party lists may produce false positives.','description'),
 e('p','Cached threat domains: '+(scam.feed?.domains||0),'description'),
 actions(btn('Save scam protection',async()=>{await api('/api/scam-protection','POST',{enabled:enabled.value(),action:action.value()});notify('Scam protection settings saved');await reloadView()},'primary')));
 return h('div','stack',section,wrap(
 form('Banned words',[['word','Word or phrase'],['action','Action','options',['log','timeout','ban']]],'Add word',x=>api('/api/engagement/word','POST',x)),
 form('Manual moderation',[['user','Twitch username'],['action','Action','options',['timeout','ban']],['seconds','Timeout length in seconds','number',600]],'Apply action',async x=>{if(!confirm('Moderate @'+x.user+'?'))return;await api('/api/moderate','POST',x)})),
 h('section','card',e('h2','Configured word filters'),list(engagement.words,x=>x.word+' → '+x.action,x=>api('/api/engagement/word/'+encodeURIComponent(x.word),'DELETE'))));
}
async function voice(){
 const voiceData=await api('/api/voice');
 const s=voiceData.settings;
 const v=card('Server-side voice detection — Twitch, Kick & VPZone','Works in Firefox because transcription runs inside Docker, not the browser. Only enabled, live channels are processed.');
 const enabled=input('Enable live audio recognition',Boolean(s.enabled),'checkbox');
 const phrase=input('Trigger phrase',s.phrase);
 const cooldown=input('Clip cooldown (seconds)',s.cooldown,'number');
 const status=e('div',voiceData.workerConfigured?'Voice worker secret configured':'Voice worker is not configured. Set VOICE_WORKER_SECRET and start the Docker voice profile.','description');
 v.append(grid('cols2',enabled.node,phrase.node,cooldown.node),status,
 actions(btn('Save server voice settings',async()=>{await api('/api/voice','POST',{enabled:enabled.value(),phrase:phrase.value(),cooldown:cooldown.value()});notify('Voice settings updated');await reloadView()},'primary'),
 btn('Disable listening',async()=>{await api('/api/voice','POST',{enabled:false,phrase:phrase.value(),cooldown:cooldown.value()});notify('Server voice detection disabled');await reloadView()},'danger'),
 btn('Create clip now',async()=>{const x=await api('/api/clip','POST');notify('Clip created: '+x.id)})));
 const history=card('Recent voice clips','Results of phrases detected from stream audio.');
 history.append(table(['When','Phrase','Clip'],voiceData.events.map(x=>[x.created,x.phrase,x.clip_id||'Failed'])));
 const extra=await api('/api/voice/platforms');
 const platformCard=card('Kick & VPZone voice detection','Use the server audio worker on linked streams. Voice phrases are logged, but these platforms do not currently offer a supported public clip creation API.');
 for(const platform of ['kick','vpzone']){
  const cfg=extra.settings.find(x=>x.platform===platform);
  const enabled=input('Enable '+(platform==='kick'?'Kick':'VPZone')+' listening',Boolean(cfg.enabled),'checkbox');
  const phrase=input('Trigger phrase',cfg.phrase);
  const cooldown=input('Cooldown in seconds',cfg.cooldown,'number');
  platformCard.append(e('h3',platform==='kick'?'Kick live stream':'VPZone live stream'),grid('cols2',enabled.node,phrase.node,cooldown.node),actions(btn('Save '+platform+' voice settings',async()=>{
   await api('/api/voice/platforms/'+platform,'POST',{enabled:enabled.value(),phrase:phrase.value(),cooldown:cooldown.value()});
   notify(platform+' voice settings updated');await reloadView();
  },'primary')));
 }
 const triggerLog=card('Other platform voice triggers','Recognition is recorded even when no supported native clip creation API exists.');
 triggerLog.append(table(['Platform','Phrase','Result','When'],extra.history.map(x=>[x.platform,x.phrase,x.result,x.created])));
 const desktop=card('Desktop Voice Companion','Your PC listens to its microphone locally, then securely asks this dashboard to clip supported live platforms. No OBS required.');
 if(access.role==='owner'){
  const companion=await api('/api/voice-companion');
  const cfg=companion.settings;
  const phraseLocal=input('Voice trigger',cfg.phrase);
  const cooldownLocal=input('Cooldown (seconds)',cfg.cooldown,'number');
  const routing=input('Live platform routing',cfg.routing,'select');
  for(const [id,label] of [['all','All selected platforms'],['first','First successful native clip']]){const item=e('option',label);item.value=id;routing.el.append(item)}routing.el.value=cfg.routing;
  const picks={};
  for(const platform of ['twitch','kick','vpzone'])picks[platform]=input(platform.toUpperCase()+' (native clip API '+(platform==='twitch'?'supported':'unavailable')+')',cfg.platforms.includes(platform),'checkbox');
  desktop.append(grid('cols2',phraseLocal.node,cooldownLocal.node,routing.node,...Object.values(picks).map(p=>p.node)),
   actions(btn('Save companion settings',async()=>{
    await api('/api/voice-companion/settings','POST',{phrase:phraseLocal.value(),routing:routing.value(),cooldown:cooldownLocal.value(),platforms:Object.keys(picks).filter(p=>picks[p].value())});
    notify('Desktop companion settings saved');await reloadView();
   },'primary')));
  const keyOutput=e('div','','description');
  desktop.append(actions(btn('Pair a PC',async()=>{
   const x=await api('/api/voice-companion/devices','POST',{label:'My PC'});
   keyOutput.replaceChildren(e('strong','One-time device key (copy now):'),e('code',x.key));
   notify('Pairing key created. Keep it private; it is shown only once.');
  },'primary')),keyOutput);
  desktop.append(e('h3','Paired computers'));
  if(!companion.devices.length)desktop.append(e('p','No computers paired yet.','description'));
  for(const device of companion.devices)desktop.append(h('div','list-row',e('span',device.label+' · '+(device.last_seen||'Never connected')),btn('Revoke',async()=>{await api('/api/voice-companion/devices/'+device.id+'/revoke','POST',{});await reloadView()},'danger')));
  const desktopHistory=card('Desktop clip results','Twitch creates native clips when live. Kick and VPZone report unsupported, rather than claiming a clip exists.');
  desktopHistory.append(table(['When','Platform','Result','Details'],companion.history.map(x=>[x.created,x.platform,x.status,x.clip_id||x.detail])));
  desktop.append(e('p','Companion source and Windows/Linux downloads: GitHub desktopapp branch (voice-companion/). Install Python, Vosk, sounddevice and a local speech model on the PC.','description'));
  return h('div','stack',desktop,desktopHistory,v,history,platformCard,triggerLog);
 }
 return h('div','stack',v,history,platformCard,triggerLog);
}
function loyalty(){return wrap(form('Loyalty settings',[['enabled','Enabled','checkbox',!!engagement.loyalty.enabled],['points_per_interval','Points per interval','number',engagement.loyalty.points_per_interval],['interval_minutes','Interval minutes','number',engagement.loyalty.interval_minutes]],'Save loyalty',x=>api('/api/engagement/loyalty','POST',x)),h('section','card',e('h2','Points leaderboard'),table(['Viewer','Points','Estimated active minutes'],creator.leaderboard.map(x=>[x.username,x.points,x.watch_minutes]))))}
function campaigns(){return wrap(form('New giveaway or contest',[['title','Title'],['kind','Type','options',['giveaway','contest']],['cost','Entry points','number',0]],'Create event',x=>api('/api/creator/campaign','POST',x)),h('section','card',e('h2','Events'),table(['Title','Type','Status','Draw'],creator.campaigns.map(x=>[x.title,x.kind,x.status,x.status==='open'?btn('Draw winner',async()=>{const y=await api('/api/creator/campaign/draw','POST',{id:x.id});notify('Winner: '+y.winner);await reloadView()}):x.winner||'Closed']))))}
function store(){return wrap(form('New store reward',[['title','Reward name'],['cost','Points cost','number',100],['stock','Stock (-1 unlimited)','number',-1]],'Create reward',x=>api('/api/creator/store','POST',x)),h('section','card',e('h2','Available rewards'),table(['Reward','Cost','Stock'],creator.store.map(x=>[x.title,x.cost,x.stock<0?'Unlimited':x.stock]))),h('section','card',e('h2','Redemption requests'),table(['Viewer','Status','Manage'],creator.redemptions.map(x=>[x.username,x.status,x.status==='pending'?actions(btn('Fulfill',async()=>{await api('/api/creator/redeem/resolve','POST',{id:x.id,status:'fulfilled'});await reloadView()}),btn('Refund',async()=>{await api('/api/creator/redeem/resolve','POST',{id:x.id,status:'refunded'});await reloadView()},'danger')):'Completed']))))}
function queue(){return h('section','card',e('h2','Viewer Queue'),e('p','Viewers use !queue join or !queue leave in chat.','description'),actions(btn('Call next viewer',async()=>{const x=await api('/api/creator/queue/next','POST');notify(x.next?'Next: '+x.next:'Queue empty');await reloadView()},'primary'),btn('Clear queue',async()=>{if(!confirm('Clear all viewers?'))return;await api('/api/creator/queue/clear','POST');await reloadView()},'danger')),table(['Position','Viewer','Joined'],creator.queue.map((x,i)=>[i+1,x.username,x.added])))}
function quotes(){return wrap(form('Save a quote',[['text','Quote text']],'Add quote',x=>api('/api/engagement/quote','POST',x)),form('Configure counter',[['name','Counter name'],['value','Current count','number',0]],'Save counter',x=>api('/api/engagement/counter','POST',x)),h('section','card',e('h2','Quotes'),list(engagement.quotes,x=>'#'+x.id+' '+x.text,x=>api('/api/engagement/quote/'+x.id,'DELETE'))),h('section','card',e('h2','Counters'),list(engagement.counters,x=>x.name+' = '+x.value,x=>api('/api/engagement/counter/'+x.name,'DELETE'))))}
function overlays(){return wrap(form('New OBS overlay',[['title','Overlay name'],['kind','Widget','options',['alerts','leaderboard','queue','ticker']]],'Create overlay',x=>api('/api/creator/overlay','POST',x)),h('section','card',e('h2','Browser source widgets'),table(['Widget','Type','Actions'],creator.overlays.map(x=>[x.title,x.kind,actions(link('Open source ↗','/overlay/'+x.public_key),btn('Test',async()=>{await api('/api/creator/overlay/test','POST',{id:x.id,message:'KitsuFlowBOT test notification'});notify('Test event sent')}))]))))}
async function connections(){
 const c=card('Unified creator profile','Twitch is your primary login. Connect Kick and VPZone to this same workspace. Your saved settings and custom commands belong to this creator account.');
 c.append(h('div','kf-connection-surface',h('div','kf-identity',e('div','Twitch broadcaster','kf-identity-label'),e('strong','@'+state.channel.login)),h('div','kf-identity',e('div','Shared bot','kf-identity-label'),e('strong',state.bot?'@'+state.bot.login:'Not connected'))));
 const enabled=input('Enable bot for my channel',!!state.channel.enabled,'checkbox'),links=input('Timeout unapproved links',!!state.channel.links,'checkbox');
 c.append(grid('cols2',enabled.node,links.node),actions(btn('Save Twitch settings',async()=>{await api('/api/settings','POST',{enabled:enabled.value(),links:links.value()});await reloadView()},'primary')));
 const metadata=card('Set title and game on linked platforms','Search each platform native game catalog, select its own category, then apply the same stream title to all selected platforms.');
 const titleInput=input('Stream title','');
 const gameInput=input('Search game / category (example: AION 2)','');
 const lookup=e('div','','stack');
 const output=e('div','','stack');
 const chosen={},checkboxes={};
 for(const platform of ['twitch','kick','vpzone'])checkboxes[platform]=input('Update '+platform.toUpperCase(),true,'checkbox');
 metadata.append(grid('cols2',titleInput.node,gameInput.node),h('div','kf-settings-section',e('div','Publish to platforms','kf-settings-section-label'),h('div','kf-platforms',...Object.values(checkboxes).map(x=>x.node))),h('div','actions kf-editor-actions',btn('Find platform games',async()=>{
  const data=await api('/api/stream-metadata/categories?q='+encodeURIComponent(gameInput.value()));
  lookup.replaceChildren();
  for(const platform of ['twitch','kick','vpzone']){
   const results=data[platform]||[];
   const select=input(platform.toUpperCase()+' category', '', 'select');
   select.el.append(new Option('Select category',''));
   for(const cat of results){const opt=new Option(cat.name,cat.id);select.el.append(opt)}
   if(results.length===1)select.el.value=results[0].id;
   select.el.onchange=()=>{chosen[platform]=results.find(x=>x.id===select.el.value)||null};
   if(results.length===1)chosen[platform]=results[0];
   lookup.append(select.node);
   if(data[platform+'_error'])lookup.append(e('p',platform+': '+data[platform+'_error'],'description'));
   else if(!results.length)lookup.append(e('p',platform+': no matching categories returned','description'));
  }
 },'primary'),btn('Update selected platforms',async()=>{
  const platforms=Object.entries(checkboxes).filter(([,v])=>v.value()).map(([k])=>k);
  if(platforms.some(p=>!chosen[p])){notify('Choose a native category for every selected platform');return}
  const x=await api('/api/stream-metadata/sync','POST',{title:titleInput.value(),platforms,categories:chosen});
  output.replaceChildren();
  for(const item of x.results)output.append(e('div',item.platform.toUpperCase()+': '+item.status+(item.error?' — '+item.error:' — '+item.category),'description'));
 },'primary')),lookup,output);
 c.append(metadata);
 const aiCard=card('AI stream title helper','Describe your stream in a few words. KitsuFlowBOT uses its server-configured AI service to suggest a catchy, searchable title. Review the suggestion before publishing.');
 const aiContext=input('Title idea or vibe','Chill gameplay, welcoming to newcomers');
 aiCard.append(aiContext.node,actions(btn('Suggest a stream title',async()=>{
  const x=await api('/api/creator-ai/suggest','POST',{game:gameInput.value(),context:aiContext.value()});
  titleInput.el.value=x.title;
  notify('Suggested title added to the Stream title field. Review it before publishing.');
 },'primary')));
 c.append(aiCard);
 const dockCard=card('OBS Stream Control Dock','Edit your Twitch, Kick and VPZone stream title and game, or generate an AI title, from a private OBS Custom Browser Dock. Unlike the game/title overlay, this dock is a control panel and requires your broadcaster login.');
 dockCard.append(actions(link('Open OBS Stream Control Dock ↗','/obs/stream-control')),e('p','In OBS: Docks → Custom Browser Docks → add your KitsuFlowBOT URL ending in /obs/stream-control. Sign in with your broadcaster account in the dock.','description'));
 c.append(dockCard);
 const multiCard=card('Multi-chat OBS browser source','Read combined Twitch, Kick and VPZone chat in OBS without cross-posting. The private source URL acts as a secret, and browser speech synthesis can read messages aloud.');
 const multi=await api('/api/multichat/settings').catch(()=>({configured:false,tts_enabled:false}));
 const speech=input('Enable browser TTS',multi.tts_enabled,'checkbox');
 const ttsRate=input('TTS speaking rate (0.5 - 2)',multi.tts_rate??1.08,'number');
 const ttsVolume=input('TTS volume (0 - 1)',multi.tts_volume??1,'number');
 const ttsProvider=input('TTS provider','browser','select');
 for(const [id,name] of [['browser','Free browser speech voices'],['kokoro','Self-hosted Kokoro neural voices']])ttsProvider.el.append(new Option(name,id));
 ttsProvider.el.value=multi.tts_provider||'browser';
 const ttsVoice=input('Voice', '', 'select');
 const kokoroVoices=[
  ['af_heart','Heart - American female'],['af_bella','Bella - American female'],['af_nicole','Nicole - American female'],['af_sarah','Sarah - American female'],['af_sky','Sky - American female'],
  ['am_adam','Adam - American male'],['am_michael','Michael - American male'],
  ['bf_alice','Alice - British female'],['bf_emma','Emma - British female'],['bf_isabella','Isabella - British female'],['bf_lily','Lily - British female'],
  ['bm_daniel','Daniel - British male'],['bm_fable','Fable - British male'],['bm_george','George - British male'],['bm_lewis','Lewis - British male']
 ];
 function updateTtsVoices(){
  const saved=ttsVoice.el.value||multi.tts_voice||'';
  ttsVoice.el.replaceChildren(new Option('System default / provider default',''));
  if(ttsProvider.value()==='kokoro'){
   for(const [id,name] of kokoroVoices)ttsVoice.el.add(new Option(name,id));
  }else{
   const available=typeof speechSynthesis!=='undefined'?speechSynthesis.getVoices():[];
   for(const voice of available)ttsVoice.el.add(new Option(voice.name+' ('+voice.lang+')'+(voice.localService?' - local':''),voice.name));
  }
  if([...ttsVoice.el.options].some(o=>o.value===saved))ttsVoice.el.value=saved;
 }
 ttsProvider.el.addEventListener('change',()=>{ttsVoice.el.value='';updateTtsVoices()});
 if(typeof speechSynthesis!=='undefined')speechSynthesis.addEventListener('voiceschanged',()=>{if(ttsProvider.value()==='browser')updateTtsVoices()});
 updateTtsVoices();
 const ttsPreview=btn('Preview selected voice',()=>{
  if(ttsProvider.value()!=='browser'){notify('Kokoro voice previews require a configured backend and active OBS source.');return}
  if(!('speechSynthesis' in window)){notify('Browser speech synthesis is unavailable here');return}
  const sample=new SpeechSynthesisUtterance('Hello! Your KitsuFlowBOT multi-chat voice is ready.');
  sample.lang=ttsLang.value()||'en-GB';sample.rate=Number(ttsRate.value())||1;sample.pitch=Number(ttsPitch.value())||1;
  const selected=speechSynthesis.getVoices().find(v=>v.name===ttsVoice.value());if(selected)sample.voice=selected;
  speechSynthesis.cancel();speechSynthesis.speak(sample);
 });
 const ttsLang=input('Voice language (for example en-GB)',multi.tts_lang||'en-GB');
 const ttsPitch=input('Pitch (0 - 2)',multi.tts_pitch??1,'number');
 const ttsMax=input('Maximum TTS message characters (20 - 500)',multi.tts_max_length??300,'number');
 const ttsCooldown=input('Per-viewer TTS cooldown in seconds',multi.tts_cooldown??15,'number');
 const ttsTemplate=input('Spoken message template ({username}, {message}, {platform})',multi.tts_template||'{username} says {message}');
 const ttsPlatforms={};for(const p of ['twitch','kick','vpzone'])ttsPlatforms[p]=input('Read '+p.toUpperCase()+' chat',multi.tts_platforms?.includes(p)??true,'checkbox');
 const voicesHelp=e('p','Voices are listed based on the selected engine. Browser voices depend on those installed in this browser/OBS; Kokoro voices require KOKORO_TTS_URL. SleepyChat proprietary voice names are not guaranteed equivalents.','description');
 const sourceOut=e('div',multi.configured?'Source configured. Regenerate to get a replacement URL.':'No browser source URL generated yet.','description');
 multiCard.append(grid('cols2',speech.node,ttsProvider.node,ttsRate.node,ttsVolume.node,ttsVoice.node,ttsLang.node,ttsPitch.node,ttsMax.node,ttsCooldown.node,ttsTemplate.node,...Object.values(ttsPlatforms).map(x=>x.node)),voicesHelp,actions(ttsPreview,btn('Save TTS option',async()=>{await api('/api/multichat/settings','POST',{tts_enabled:speech.value(),tts_provider:ttsProvider.value(),tts_rate:ttsRate.value(),tts_volume:ttsVolume.value(),tts_voice:ttsVoice.value(),tts_lang:ttsLang.value(),tts_pitch:Number(ttsPitch.value()),tts_max_length:Number(ttsMax.value()),tts_cooldown:Number(ttsCooldown.value()),tts_template:ttsTemplate.value(),tts_platforms:Object.keys(ttsPlatforms).filter(p=>ttsPlatforms[p].value())});notify('Multi-chat TTS saved')},'primary'),btn('Generate / rotate OBS URL',async()=>{
  const x=await api('/api/multichat/source','POST',{});
  const url=location.origin+x.url;
  sourceOut.replaceChildren(e('span','Keep these OBS browser URLs private:'),h('div','list-row',e('span','Multi-chat'),link(url,url)),h('div','list-row',e('span','Game & title'),link(location.origin+x.game_url,location.origin+x.game_url)),h('div','list-row',e('span','Activity Feed'),link(location.origin+x.activity_url,location.origin+x.activity_url)));
  notify('OBS browser URL generated; copy it now');
 })),sourceOut);
 c.append(multiCard);

 const runtime=await api('/api/platforms/runtime').catch(()=>null);
 const providerCard=card('Linked streaming channels','Kick and VPZone attach to your Twitch-based profile. You stay signed in with Twitch, and manage them from one dashboard. Connected platforms share creator settings and commands where their chat integrations support them.');
 let result;try{result=await api('/api/platforms')}catch(err){providerCard.append(e('div','Could not load Kick/VPZone connections: '+err.message,'empty'));result={platforms:[]}}
 for(const provider of result.platforms.filter(x=>x.platform!=='twitch')){
   const row=h('div','list-row',h('div','',e('strong',provider.platform==='kick'?'Kick':'VPZone'),e('div',provider.connection?'Linked: '+provider.connection.display_name+' · '+(provider.platform==='vpzone'?(runtime?.vpzone?.chat_connected?'Chat connected':'Chat disconnected'):(runtime?.kick?.subscription_active?'Chat subscribed':'Chat subscription pending')):provider.configured?'Ready for OAuth connection':'Developer app credentials required','tiny')));
   if(provider.connection){
     row.append(actions(btn('View channel',async()=>{const data=await api('/api/platforms/'+provider.platform+'/channel');notify(provider.platform+' channel information loaded');console.info(data)}),btn('Disconnect',async()=>{if(!confirm('Disconnect '+provider.platform+'?'))return;await api('/api/platforms/'+provider.platform+'/disconnect','POST');await reloadView()},'danger')));
   }else if(provider.configured){
     row.append(link('Connect '+provider.platform,'/auth/platform/'+provider.platform,'primary'));
   }else row.append(e('span','Not configured','pill'));
   providerCard.append(row);
 }
 const relayData=await api('/api/relay').catch(()=>({enabled:false,routes:[],history:[]}));
 const relayCard=card('Cross-platform chat relay','One master toggle. Choose which connected platforms participate; enabled platforms share messages with each other. OBS multi-chat works independently without relay.');
 const relayEnabled=input('Enable cross-platform chat relay',Boolean(relayData.enabled),'checkbox');
 const active=new Set((relayData.routes||[]).filter(r=>r.enabled).flatMap(r=>[r.source,r.target]));
 const selected={};
 for(const platform of ['twitch','kick','vpzone'])selected[platform]=input('Include '+platform.toUpperCase(),active.has(platform),'checkbox');
 relayCard.append(relayEnabled.node,h('div','kf-platforms',...Object.values(selected).map(x=>x.node)),actions(btn('Save relay settings',async()=>{
  const platforms=Object.entries(selected).filter(([,control])=>control.value()).map(([name])=>name);
  await api('/api/relay/group','POST',{enabled:relayEnabled.value(),platforms});
  notify('Cross-platform relay settings saved');
  await reloadView();
 },'primary')));
 const relayLog=card('Chat relay history','Latest routed messages and their delivery status.');
 relayLog.append(table(['Source','Target','Sender','Status'],relayData.history.map(x=>[x.source,x.target,x.sender,x.status])));
 const feed=card('Cross-platform activity','Verified provider events appear here when event delivery is configured. Twitch remains the primary dashboard login.');
 const events=await api('/api/platform-events').catch(()=>[]);
 feed.append(table(['Platform','Type','When'],events.slice(0,30).map(x=>[x.platform,x.event_type,x.created])));
 const layout=h('div','stack',c,providerCard,relayCard,relayLog,feed);
 enhanceCreatorPanels(layout);
 return layout;
}
function channel(){const c=card('Channel configuration','Owner-only channel credentials and access');c.append(h('div','list-row',e('span','Account ID'),e('strong',access.account_id)),h('div','list-row',e('span','Your role'),e('strong',access.role)));if(access.role==='owner'){c.append(actions(btn('Create API token (reports:read)',async()=>{const x=await api('/api/access/tokens','POST',{scopes:['reports:read'],days:7});const out=e('textarea');out.className='key-block';out.value=x.token;out.readOnly=true;out.style.width='100%';out.rows=5;c.append(out);notify('Copy the token now; it will not be shown again')}),btn('Rotate overlay integration token',async()=>{if(!confirm('Rotate overlay integration credential?'))return;const x=await api('/api/access/overlay-token/rotate','POST');const out=e('textarea');out.value=x.token;out.readOnly=true;out.rows=4;out.className='key-block';out.style.width='100%';c.append(out)})))}return c}
function team(){const c=card('Team & invitation links','Create an expiring, one-use invite. Recipients must log into Twitch before accepting it.');if(access.role!=='owner'){c.append(e('p','Only channel owners can manage invitations.','muted'));return c}const r=selector('Role',access.role==='owner'?['editor','bot_supervisor','full_control']:['editor','bot_supervisor'],'editor'),days=input('Valid for days',1,'number');c.append(grid('cols2',r.node,days.node),actions(btn('Generate invitation',async()=>{const x=await api('/api/access/invite','POST',{role:r.value(),days:days.value()});const out=e('textarea');out.className='key-block';out.value=x.link;out.readOnly=true;out.rows=3;out.style.width='100%';c.append(out);notify('Copy your invitation URL')},'primary')),e('h3','Team members'),table(['User ID','Role','Remove'],access.members.map(x=>[x.user_id,x.role,btn('Remove',async()=>{await api('/api/access/members/'+x.user_id+'/remove','POST');await reloadView()},'danger')])));return c}
async function admin(){if(!state.isOperator)return card('Restricted','Only the configured Twitch administrator can access this page.');const x=await api('/api/admin/overview');const c=card('Global public Twitch bot','The public bot account is connected once by the platform owner. Streamers can then enable this bot for their own channels.');c.append(banner(x.bot?'Public bot connected: @'+x.bot.login:'Public bot needs authorisation',x.bot?'EventSub: '+x.connection_status+' · Twitch ID: '+x.bot.id:'Sign into the intended Twitch bot account when Twitch asks for authorisation.',link(x.bot?'Reauthorise public bot':'Connect public Twitch bot','/auth/connect/bot','primary')),grid('stats',stat('Registered channels',x.channels.length,'♙','All configured channels'),stat('Enabled channels',x.enabled_count,'✓','Channels using the bot'),stat('Connection',x.connection_status,'⇄','EventSub WebSocket status'),stat('OAuth',x.bot?'Connected':'Not linked','◇','Global bot identity')));const device=card('Connect bot from another browser or device','Use a one-time Twitch activation code. Sign into the dedicated bot Twitch account on the other browser; never authorise your streamer account here.');
const deviceOutput=e('div',undefined,'stack');
const activate=btn('Generate Twitch device code',async()=>{
  const result=await api('/api/admin/bot/device/start','POST');
  deviceOutput.replaceChildren();
  deviceOutput.append(
    e('div','Code: '+result.user_code,'stat-value'),
    e('div','Expires: '+new Date(result.expires_at).toLocaleTimeString(),'description'),
    link('Open Twitch activation ↗',result.verification_uri,'primary')
  );
  deviceOutput.append(btn('Check authorisation',async()=>{
    const status=await api('/api/admin/bot/device/check','POST');
    if(status.status==='connected'){
      notify('Global bot connected: @'+status.bot.login);
      await reloadView();
    }else{
      notify(status.status==='pending'?'Awaiting approval. Retry after '+(status.retry_after||5)+' seconds.':'Device code expired; generate a new code.');
    }
  }));
});
device.append(actions(activate),deviceOutput);
c.append(device);
 const platformBots=card('Shared Kick / VPZone bot accounts','Platform administrators can link dedicated bot accounts without replacing broadcaster accounts.');
 const pb=await api('/api/admin/platform-bots');
 for(const platform of ['kick','vpzone']){
  const bot=pb.bots.find(b=>b.platform===platform),config=pb.configured.find(b=>b.platform===platform);
  platformBots.append(h('div','list-row',h('div','',e('strong',platform.toUpperCase()),e('div',bot?'Shared bot @'+bot.display_name:config?.ready?'Not connected':'Configure OAuth client credentials first','tiny')),actions(config?.ready?link(bot?'Reauthorise':'Connect bot','/auth/platform-bot/'+platform,'primary'):e('span','Not configured','tiny'),bot?btn('Disconnect',async()=>{if(!confirm('Disconnect '+platform+' shared bot?'))return;await api('/api/admin/platform-bots/'+platform+'/disconnect','POST');await reloadView()},'danger'):null)));
 }
 c.append(platformBots);
c.append(actions(btn('Reconnect bot EventSub',async()=>{await api('/api/admin/bot/reconnect','POST');notify('Reconnection requested');await show('admin')})),e('h3','Connected channels'),table(['Channel','Twitch ID','Enabled'],x.channels.map(v=>['@'+v.login,v.id,v.enabled?'Yes':'No'])));if(x.bot?.login===state.channel.login)c.append(e('div','Warning: The bot and broadcaster are the same Twitch account. For a public multi-channel bot, authorise a dedicated bot Twitch account instead.','empty'));const logs=await adminLogs();const diagnostics=card('Bot & platform logs','Operational diagnostics, integration errors, chat command logs and connection history.');diagnostics.append(table(['Time','Channel','Type','Detail'],logs.map(v=>[v.created,v.login||v.channel,v.event,v.detail])));return h('div','stack',c,diagnostics)}
async function adminLogs(){return await api('/api/admin/logs').catch(()=>[])}

const views={overview,activity,reports,commands,timers,moderation,voice,loyalty,campaigns,store,queue,quotes,overlays,connections,channel,team,admin};
async function show(id){if((id==='admin'&&!state.isOperator)||(ownerPages.has(id)&&access.role!=='owner'))id='overview';page=id;$('#crumb').textContent=groups.flatMap(x=>x[1]).find(x=>x[0]===id)?.[2]||id;$('#page-title').textContent=$('#crumb').textContent;$('#page-desc').textContent=descriptions[id];$('#kicker').textContent=id==='admin'?'PLATFORM ADMINISTRATION':'CREATOR CONTROL CENTER';document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===id));const view=$('#view');view.replaceChildren(e('p','Loading...','muted'));try{const result=await views[id]();view.replaceChildren(result)}catch(ex){view.replaceChildren(e('div','Failed to load page: '+ex.message,'empty'))}}
// Live dashboard activity refresh while the Activity Feed page is displayed.
let lastActivitySignature='';
async function refreshActivity(){
 try{
  if(page==='activity'){
   const events=await api('/api/stream-activity');
   const signature=JSON.stringify(events);
   if(signature!==lastActivitySignature){
    lastActivitySignature=signature;
    const container=document.querySelector('#view .card');
    if(container){
     const old=container.querySelector('table,.empty');
     const replacement=events.length?table(['When','Platform','Event','Viewer','Details'],events.map(x=>[x.created,x.platform.toUpperCase(),x.event_type.replaceAll('_',' '),x.actor||'—',x.detail||'—'])):e('div','No stream engagement events received yet.','empty');
     if(old)old.replaceWith(replacement);else container.append(replacement);
    }
   }
  }
 }catch(err){console.warn('Activity refresh:',err.message)}
 setTimeout(refreshActivity,1800);
}
setTimeout(refreshActivity,1800);
fetch('/api/build-info',{cache:'no-store'}).then(r=>r.json()).then(info=>{const el=$('#studio-version');if(el)el.textContent='Studio · '+String(info.version).slice(0,12)}).catch(()=>{});
load();
})();