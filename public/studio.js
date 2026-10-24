(()=>{'use strict';
const $=s=>document.querySelector(s),e=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x}, h=(tag,cls,...children)=>{const x=e(tag,undefined,cls);for(const y of children)if(y!=null)x.append(typeof y==='string'?document.createTextNode(y):y);return x};
let state=null,access=null,creator=null,engagement=null,page='overview';
const groups=[['WORKSPACE',[['overview','◫','Overview'],['activity','◷','Activity Feed'],['reports','▥','Data & Reports']]],['BOT MANAGEMENT',[['commands','⌘','Custom Commands'],['timers','◴','Timers'],['moderation','◇','Moderation'],['voice','◉','Voice & Clips']]],['COMMUNITY',[['loyalty','✧','Loyalty & Points'],['campaigns','♢','Giveaways & Contests'],['store','▣','Stream Store'],['queue','☷','Viewer Queue'],['quotes','❞','Quotes & Counters']]],['STREAM TOOLS',[['overlays','▤','Overlay Studio'],['connections','⇄','Connections']]],['SETTINGS',[['channel','⚙','Channel Settings'],['team','♙','Team & Invites'],['admin','♛','Admin Panel']]]];
const descriptions={overview:'A clear view of everything happening across your channel.',activity:'Recent messages, moderation and bot activity.',reports:'Understand loyalty activity, redemptions and channel engagement.',commands:'Create and manage the commands your viewers can use.',timers:'Schedule automatic Twitch chat announcements.',moderation:'Keep your community safe with moderation controls.',voice:'Create clips with your voice or a single click.',loyalty:'Configure loyalty rewards and view community standings.',campaigns:'Run community giveaways and draw winners.',store:'Manage redeemable loyalty-point rewards.',queue:'Organise who plays or joins you next.',quotes:'Capture favourite moments and manage counters.',overlays:'Create OBS browser sources for your stream.',connections:'View broadcaster and shared public bot status.',channel:'Manage your own channel and security credentials.',team:'Invite editors and trusted moderators.',admin:'Configure and monitor the public bot for all channels.'};
function notify(text){$('#notice').textContent=text;setTimeout(()=>{if($('#notice').textContent===text)$('#notice').textContent=''},6500)}
async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let x;try{x=await r.json()}catch{x={error:'Unexpected server response'}}if(!r.ok)throw Error(x.error||'Request failed');return x}
const error=fn=>async(...args)=>{try{return await fn(...args)}catch(ex){notify(ex.message)}};
async function load(){try{state=await api('/api/state');access=await api('/api/access');creator=await api('/api/creator');engagement=await api('/api/engagement');$('#shell').hidden=false;$('#login').hidden=true;buildNav();updateChrome();await show(page)}catch(ex){if(ex.message==='Login required'){location.replace('/login');return}else{$('#shell').hidden=false;notify(ex.message)}}}
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
function buildNav(){const nav=$('#nav');nav.replaceChildren();for(const [heading,items] of groups){const visible=items.filter(([id])=>id!=='admin'||state.isOperator);if(!visible.length)continue;nav.append(e('div',heading,'nav-group'));for(const [id,icon,title] of visible){const b=h('button','nav-link',e('span',icon,'glyph'),e('span',title));b.dataset.page=id;b.onclick=()=>show(id);nav.append(b)}}}
function updateChrome(){$('#channel-label').textContent=state.channel?.login||'Channel';$('#profile-name').textContent=state.channel?.login||'Account';const st=$('#global-status');st.textContent=state.bot?'Global Bot: @'+state.bot.login:'Public bot not connected';st.className='pill '+(state.bot?'good':'warn')}
function popup(){const menu=$('#profile-menu');menu.replaceChildren();menu.hidden=!menu.hidden;if(menu.hidden)return;menu.append(e('div','SWITCH CHANNEL','nav-group'));for(const ch of access.channels){const b=e('button',(ch.id===access.active_channel?'✓ ':'')+ch.login+' — '+ch.role);b.onclick=error(async()=>{await api('/api/channels/select','POST',{channel:ch.id});location.reload()});menu.append(b)}const log=e('button','Sign out');log.onclick=error(async()=>{await api('/logout','POST');location.reload()});menu.append(log)}
$('#profile').onclick=popup;$('#side-channel').onclick=popup;$('#refresh').onclick=error(reloadView);
const list=(items,display,onRemove)=>{const box=e('div');if(!items.length)return e('div','Nothing configured yet.','empty');for(const item of items){const row=h('div','list-row',e('div',display(item)));if(onRemove)row.append(btn('Remove',async()=>{if(!confirm('Remove this item?'))return;await onRemove(item);await reloadView()},'danger'));box.append(row)}return box};
const stat=(label,num,icon,foot)=>h('section','card',e('div',icon,'stat-icon'),e('div',label,'stat-label'),e('div',String(num),'stat-value'),e('div',foot,'stat-foot'));
const banner=(title,desc,action)=>h('div','banner',h('div','',e('strong',title),e('p',desc)),e('div',undefined,'spacer'),action);
function overview(){const v=e('div',undefined,'stack');v.append(grid('stats',stat('Loyalty members',creator.stats.members,'♙','Active chat participants'),stat('Points in circulation',creator.stats.points.toLocaleString(),'✧','Current balances'),stat('Store redemptions',creator.stats.redemptions,'▣','All-time requests'),stat('Active commands',state.commands.length,'⌘','Available in this channel')));
if(!state.channel.enabled)v.append(banner('Your channel bot is currently disabled','Enable the bot to start receiving channel chat and responding to commands.',btn('Channel settings →',()=>show('connections'),'primary')));
v.append(wrap(h('section','card',e('h2','Recent activity'),table(['When','Event','Details'],creator.activity.slice(0,8).map(x=>[x.created,x.event,x.detail])),actions(btn('View activity feed',()=>show('activity')))),h('section','card',e('h2','Channel health'),h('div','list-row',e('span','Streamer account'),e('strong','Connected')),h('div','list-row',e('span','Shared Twitch bot'),e('strong',state.bot?'@'+state.bot.login:'Not linked')),h('div','list-row',e('span','Bot enabled'),e('strong',state.channel.enabled?'Yes':'No')),h('div','list-row',e('span','Your access'),e('strong',state.role)))));return v}
function activity(){const c=card('Activity feed','Channel-scoped event history.');c.append(table(['Time','Event type','Description'],creator.activity.map(x=>[x.created,x.event,x.detail])));return c}
function reports(){return grid('stats',stat('Total members',creator.stats.members,'♙','Chat-based activity'),stat('Loyalty points',creator.stats.points,'✧','Current issued balances'),stat('Redemptions',creator.stats.redemptions,'▣','Store requests'),stat('Queue',creator.queue.length,'☷','Waiting viewers'))}
function commands(){return wrap(form('Create custom command',[['name','Command name (! without prefix)'],['response','Bot response'],['cooldown','Cooldown in seconds','number',10],['level','Permission','options',['everyone','subscriber','moderator']]],'Save command',x=>api('/api/commands','POST',x)),h('section','card',e('h2','Saved commands'),table(['Command','Response','Level','Action'],state.commands.map(x=>['!'+x.name,x.response,x.level,btn('Delete',async()=>{await api('/api/commands/'+encodeURIComponent(x.name),'DELETE');await reloadView()},'danger')]))))}
function timers(){return wrap(form('Create chat timer',[['name','Timer name'],['message','Announcement message'],['minutes','Interval (minutes)','number',15]],'Save timer',x=>api('/api/engagement/timer','POST',x)),h('section','card',e('h2','Current timers'),list(engagement.timers,x=>x.name+' · Every '+x.minutes+' minutes · '+x.message,x=>api('/api/engagement/timer/'+x.name,'DELETE'))))}
function moderation(){return wrap(form('Banned words',[['word','Word or phrase'],['action','Action','options',['log','timeout','ban']]],'Add word',x=>api('/api/engagement/word','POST',x)),form('Manual moderation',[['user','Twitch username'],['action','Action','options',['timeout','ban']],['seconds','Timeout length in seconds','number',600]],'Apply action',async x=>{if(!confirm('Moderate @'+x.user+'?'))return;await api('/api/moderate','POST',x)}),h('section','card',e('h2','Configured word filters'),list(engagement.words,x=>x.word+' → '+x.action,x=>api('/api/engagement/word/'+encodeURIComponent(x.word),'DELETE'))))}
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
 c.append(h('div','list-row',e('span','Twitch broadcaster'),e('strong','@'+state.channel.login)),h('div','list-row',e('span','Shared bot'),e('strong',state.bot?'@'+state.bot.login:'Not connected')));
 const enabled=input('Enable bot for my channel',!!state.channel.enabled,'checkbox'),links=input('Timeout unapproved links',!!state.channel.links,'checkbox');
 c.append(grid('cols2',enabled.node,links.node),actions(btn('Save Twitch settings',async()=>{await api('/api/settings','POST',{enabled:enabled.value(),links:links.value()});await reloadView()},'primary')));
 const runtime=await api('/api/platforms/runtime').catch(()=>null);
 const providerCard=card('Linked streaming channels','Kick and VPZone attach to your Twitch-based profile. You stay signed in with Twitch, and manage them from one dashboard. Twitch bot chat commands currently work only on Twitch; connected-provider chat adapters will reuse these shared settings when supported.');
 let result;try{result=await api('/api/platforms')}catch(err){providerCard.append(e('div','Could not load Kick/VPZone connections: '+err.message,'empty'));result={platforms:[]}}
 for(const provider of result.platforms.filter(x=>x.platform!=='twitch')){
   const row=h('div','list-row',h('div','',e('strong',provider.platform==='kick'?'Kick':'VPZone'),e('div',provider.connection?'Linked: '+provider.connection.display_name+' · '+(provider.platform==='vpzone'?(runtime?.vpzone?.chat_connected?'Chat connected':'Chat disconnected'):'Webhook subscription not active'):provider.configured?'Ready for OAuth connection':'Developer app credentials required','tiny')));
   if(provider.connection){
     row.append(actions(btn('View channel',async()=>{const data=await api('/api/platforms/'+provider.platform+'/channel');notify(provider.platform+' channel information loaded');console.info(data)}),btn('Disconnect',async()=>{if(!confirm('Disconnect '+provider.platform+'?'))return;await api('/api/platforms/'+provider.platform+'/disconnect','POST');await reloadView()},'danger')));
   }else if(provider.configured){
     row.append(link('Connect '+provider.platform,'/auth/platform/'+provider.platform,'primary'));
   }else row.append(e('span','Not configured','pill'));
   providerCard.append(row);
 }
 const botChat=card('Kick application bot chat','Send using Kick developer application bot mode (type: bot). This is not the streamer or a separate user account.');
 const msg=input('Test message','KitsuFlowBOT connected to Kick');
 botChat.append(msg.node,actions(btn('Send via Kick bot',async()=>{await api('/api/platforms/kick/chat','POST',{message:msg.value()});notify('Kick application bot message sent')},'primary')));
 const vpTest=card('VPZone dedicated bot chat','Test posting through your VPZone bot account connected in Admin Panel (chat:write required).');
 const vpMsg=input('VPZone test message','Hello from KitsuFlowBOT!');
 vpTest.append(vpMsg.node,actions(btn('Send via VPZone bot',async()=>{await api('/api/platforms/vpzone/chat','POST',{message:vpMsg.value()});notify('VPZone bot message sent')},'primary')));
 const relayData=await api('/api/relay').catch(()=>({routes:[],history:[]}));
 const relayCard=card('Cross-platform chat relay','Relay is off by default. Enable only directions you want. Messages are labelled by source and protected against loops.');
 for(const [source,target] of [['twitch','kick'],['kick','twitch'],['twitch','vpzone'],['vpzone','twitch'],['kick','vpzone'],['vpzone','kick']]){
  const original=relayData.routes.find(r=>r.source===source&&r.target===target);
  const toggle=input(source.toUpperCase()+' → '+target.toUpperCase(),Boolean(original?.enabled),'checkbox');
  const line=h('div','list-row',toggle.node,btn('Save',async()=>{await api('/api/relay','POST',{source,target,enabled:toggle.value()});notify('Relay updated');await reloadView()}));
  relayCard.append(line);
 }
 const relayLog=card('Chat relay history','Latest routed messages and their delivery status.');
 relayLog.append(table(['Source','Target','Sender','Status'],relayData.history.map(x=>[x.source,x.target,x.sender,x.status])));
 const feed=card('Cross-platform activity','Verified provider events appear here when event delivery is configured. Twitch remains the primary dashboard login.');
 const events=await api('/api/platform-events').catch(()=>[]);
 feed.append(table(['Platform','Type','When'],events.slice(0,30).map(x=>[x.platform,x.event_type,x.created])));
 return h('div','stack',c,providerCard,botChat,vpTest,relayCard,relayLog,feed);
}
function channel(){const c=card('Channel configuration','Owner-only channel credentials and access');c.append(h('div','list-row',e('span','Account ID'),e('strong',access.account_id)),h('div','list-row',e('span','Your role'),e('strong',access.role)));if(access.role==='owner'){c.append(actions(btn('Create API token (reports:read)',async()=>{const x=await api('/api/access/tokens','POST',{scopes:['reports:read'],days:7});const out=e('textarea');out.className='key-block';out.value=x.token;out.readOnly=true;out.style.width='100%';out.rows=5;c.append(out);notify('Copy the token now; it will not be shown again')}),btn('Rotate overlay integration token',async()=>{if(!confirm('Rotate overlay integration credential?'))return;const x=await api('/api/access/overlay-token/rotate','POST');const out=e('textarea');out.value=x.token;out.readOnly=true;out.rows=4;out.className='key-block';out.style.width='100%';c.append(out)})))}return c}
function team(){const c=card('Team & invitation links','Create an expiring, one-use invite. Recipients must log into Twitch before accepting it.');if(!['owner','full_control'].includes(access.role)){c.append(e('p','Only owners and Full Control staff can invite users.','muted'));return c}const r=selector('Role',access.role==='owner'?['editor','bot_supervisor','full_control']:['editor','bot_supervisor'],'editor'),days=input('Valid for days',1,'number');c.append(grid('cols2',r.node,days.node),actions(btn('Generate invitation',async()=>{const x=await api('/api/access/invite','POST',{role:r.value(),days:days.value()});const out=e('textarea');out.className='key-block';out.value=x.link;out.readOnly=true;out.rows=3;out.style.width='100%';c.append(out);notify('Copy your invitation URL')},'primary')),e('h3','Team members'),table(['User ID','Role','Remove'],access.members.map(x=>[x.user_id,x.role,btn('Remove',async()=>{await api('/api/access/members/'+x.user_id+'/remove','POST');await reloadView()},'danger')])));return c}
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
c.append(actions(btn('Reconnect bot EventSub',async()=>{await api('/api/admin/bot/reconnect','POST');notify('Reconnection requested');await show('admin')})),e('h3','Connected channels'),table(['Channel','Twitch ID','Enabled'],x.channels.map(v=>['@'+v.login,v.id,v.enabled?'Yes':'No'])));if(x.bot?.login===state.channel.login)c.append(e('div','Warning: The bot and broadcaster are the same Twitch account. For a public multi-channel bot, authorise a dedicated bot Twitch account instead.','empty'));return c}
const views={overview,activity,reports,commands,timers,moderation,voice,loyalty,campaigns,store,queue,quotes,overlays,connections,channel,team,admin};
async function show(id){if(id==='admin'&&!state.isOperator)id='overview';page=id;$('#crumb').textContent=groups.flatMap(x=>x[1]).find(x=>x[0]===id)?.[2]||id;$('#page-title').textContent=$('#crumb').textContent;$('#page-desc').textContent=descriptions[id];$('#kicker').textContent=id==='admin'?'PLATFORM ADMINISTRATION':'CREATOR CONTROL CENTER';document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===id));const view=$('#view');view.replaceChildren(e('p','Loading...','muted'));try{const result=await views[id]();view.replaceChildren(result)}catch(ex){view.replaceChildren(e('div','Failed to load page: '+ex.message,'empty'))}}
fetch('/api/build-info',{cache:'no-store'}).then(r=>r.json()).then(info=>{const el=$('#studio-version');if(el)el.textContent='Studio · '+String(info.version).slice(0,12)}).catch(()=>{});
load();
})();