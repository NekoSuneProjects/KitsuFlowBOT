// NekoLive integration: broadcaster OAuth link, shared bot token for chat output,
// and NekoLive's public chat WebSocket for incoming chat and alerts.
//
// NekoLive specifics (verified against the WEBLIVE source):
// - OAuth2 server at /oauth2/authorize + /oauth2/token (node-oauth2-server). No PKCE and
//   no /me endpoint; the token response itself carries user {id, username}.
// - Chat output: POST /api/chatbot {channel, message} with "Authorization: Bearer <bot token>".
//   Bot tokens are issued in NekoLive's Admin → Partnership page, and NekoLive only accepts
//   the post when a BotPermission row (botId, channelId=<channel name>) is active.
// - Chat input: wss://<host>/chat/channel/<name>. Reading needs no login. Messages arrive as
//   chat_message / chat_emotes; alerts as follow, subscribe, resubscribe, nyatreats,
//   donations and raid_trigger. Bot posts are rebroadcast under the "nekoai" identity.
import crypto from 'node:crypto';
import {WebSocket} from 'ws';

const SLUG=/^[A-Za-z0-9_.-]{1,64}$/;
const BOT_TOKEN=/^[a-f0-9]{64}$/i;
const clean=(value,max=250)=>String(value??'').replace(/[\r\n]+/g,' ').trim().slice(0,max);
// chat_emotes payloads mix raw viewer text with <img alt="code"> markup. Never forward
// markup: keep each emote as :code: text and drop every other tag.
const plain=html=>String(html||'')
 .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi,(_,code)=>' :'+code+': ')
 .replace(/<[^>]*>/g,'')
 .replace(/\s+/g,' ').trim();
// NekoLive alert type -> KitsuFlowBOT activity type (stream-activity accepts these as-is).
const ALERTS={follow:'follow',subscribe:'subscription',resubscribe:'subscription_renewal',nyatreats:'cheer',donations:'donation',raid_trigger:'raid'};

function config(){
 const raw=String(process.env.NEKOLIVE_BASE_URL||'').trim();
 let base=null;
 if(raw){
  try{
   const u=new URL(raw);
   const local=u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname);
   if(u.protocol==='https:'||local)base=u.origin;
  }catch{}
 }
 return {
  base,
  clientId:String(process.env.NEKOLIVE_CLIENT_ID||'').trim(),
  clientSecret:String(process.env.NEKOLIVE_CLIENT_SECRET||'').trim(),
  scope:String(process.env.NEKOLIVE_AUTH_SCOPES||'channel:read').trim()
 };
}

export function installNekoLive({app,db,withUser,csrf,access,enc,dec,log,base,isOperator,relay,streamActivity}){
 // platform_oauth and platform_bot_accounts are created by platform-integrations.js.
 const linkedRow=channel=>db.prepare("SELECT external_id,display_name,scopes FROM platform_oauth WHERE channel=? AND platform='nekolive'").get(channel);
 const botRow=()=>db.prepare("SELECT display_name,access_token FROM platform_bot_accounts WHERE platform='nekolive'").get();
 const safe=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error('nekolive:',e.message);res.status(400).json({error:e.message})});
 const requireAdmin=(req,res,next)=>isOperator(req.session.uid)?next():res.status(403).json({error:'Admin access required'});
 const redirectUri=()=>base+'/auth/nekolive/callback';

 // ---- chat output through the shared NekoLive bot ----
 async function say(channel,text){
  const cfg=config();
  if(!cfg.base)throw Error('NEKOLIVE_BASE_URL is not configured');
  const linked=linkedRow(channel);
  if(!linked||!SLUG.test(linked.display_name))throw Error('Link your NekoLive channel first');
  const bot=botRow();
  if(!bot)throw Error('NekoLive bot token is not configured. Add it in Admin Panel.');
  const message=String(text||'').trim().slice(0,400);
  if(!message)throw Error('Message is empty');
  const target=linked.display_name.toLowerCase();
  const response=await fetch(cfg.base+'/api/chatbot',{method:'POST',redirect:'error',
   headers:{Authorization:'Bearer '+dec(bot.access_token),'Content-Type':'application/json'},
   body:JSON.stringify({channel:target,message}),signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>({}));
  if(response.status===401)throw Error('NekoLive rejected the bot token. Replace it in Admin Panel.');
  if(response.status===403)throw Error('NekoLive has no active bot permission for channel "'+target+'". A NekoLive admin must grant the bot access to this channel.');
  if(!response.ok||body.success!==1)throw Error('NekoLive bot message failed ('+response.status+'): '+clean(body.error||'unknown error',200));
  log(channel,'nekolive-bot-message',target);
  return {ok:true};
 }

 // ---- custom commands from NekoLive chat ----
 // NekoLive's chat roles are derived from a client-supplied user ID, so they are not
 // trustworthy for permission checks. Only 'everyone' commands run, as for VPZone/Kick.
 const cooldowns=new Map();
 async function command(channel,username,body){
  const parts=body.split(/\s+/),name=parts[0]?.toLowerCase();
  if(!name?.startsWith('!'))return;
  const key=name.slice(1);
  if(!/^[a-z0-9_]{1,32}$/.test(key))return;
  const cmd=db.prepare('SELECT response,cooldown,level FROM commands WHERE channel=? AND name=?').get(channel,key);
  if(!cmd||cmd.level!=='everyone'||!botRow())return;
  const throttle=channel+':nekolive:'+key,now=Date.now();
  if((cooldowns.get(throttle)||0)>now)return;
  cooldowns.set(throttle,now+Math.max(0,Number(cmd.cooldown)||0)*1000);
  if(cooldowns.size>2000)for(const [k,t] of cooldowns)if(t<now)cooldowns.delete(k);
  const owner=db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login||'';
  await say(channel,String(cmd.response).replaceAll('{user}',username).replaceAll('{channel}',owner).replaceAll('{args}',parts.slice(1).join(' ')));
  log(channel,'nekolive-command',key);
 }

 // ---- incoming chat and alerts ----
 function handle(channel,msg){
  const type=String(msg?.type||'');
  if(ALERTS[type]){
   const actor=clean(type==='raid_trigger'?msg.from:msg.username,100);
   const detail=type==='raid_trigger'?String(msg.viewers??''):(type==='subscribe'||type==='resubscribe')?clean(msg.tier,90):String(msg.amount??msg.value??'');
   streamActivity.emit(channel,'nekolive',ALERTS[type],actor,detail,null);
   const text=clean(String(msg.message||'').replaceAll('{name}',actor).replaceAll('{amount}',detail).replaceAll('{tier}',clean(msg.tier,60)),300);
   if(text)void relay.relay(channel,'nekolive',actor||'nekolive',text,{kind:'alerts'}).catch(err=>log(channel,'nekolive-relay-error',err.message));
   return;
  }
  if(type!=='chat_message'&&type!=='chat_emotes')return;
  const username=clean(msg.username,40);
  const body=(type==='chat_emotes'?plain(msg.message):String(msg.message||'').trim()).slice(0,350);
  if(!username||!body)return;
  // Every bot post (including ours) is rebroadcast by NekoLive as "nekoai".
  const roles=msg.roles||{};
  if(username.toLowerCase()==='nekoai'||roles.bot===true||roles.verifiedBot===true)return;
  void relay.relay(channel,'nekolive',username,body,{isBot:false}).catch(err=>log(channel,'nekolive-relay-error',err.message));
  void command(channel,username,body).catch(err=>log(channel,'nekolive-command-error',err.message));
 }

 const sockets=new Map(); // KitsuFlowBOT channel -> {slug,ws,timer,heartbeat,failures,status,detail}
 function stop(channel){
  const entry=sockets.get(channel);if(!entry)return;
  sockets.delete(channel);clearTimeout(entry.timer);clearInterval(entry.heartbeat);
  try{entry.ws?.close()}catch{}
 }
 function connect(channel,slug){
  const cfg=config();
  if(!cfg.base||!SLUG.test(slug))return;
  const existing=sockets.get(channel);
  if(existing?.slug===slug&&existing.ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(existing.ws.readyState))return;
  stop(channel);
  const entry={slug,ws:null,timer:null,heartbeat:null,failures:0,status:'pending',detail:'Connecting'};
  sockets.set(channel,entry);
  const open=()=>{
   if(sockets.get(channel)!==entry)return;
   if(!db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='nekolive' AND display_name=?").get(channel,slug)){sockets.delete(channel);return}
   const url=cfg.base.replace(/^http/,'ws')+'/chat/channel/'+encodeURIComponent(slug.toLowerCase());
   const ws=new WebSocket(url,{handshakeTimeout:15000,headers:{'User-Agent':'KitsuFlowBOT'}});
   entry.ws=ws;let alive=true;
   ws.on('open',()=>{
    entry.failures=0;entry.status='connected';entry.detail='Live chat WebSocket';
    log(channel,'nekolive-chat-connected',slug);
    // NekoLive sends no keepalive; use protocol pings so half-open sockets get replaced.
    entry.heartbeat=setInterval(()=>{if(!alive){ws.terminate();return}alive=false;try{ws.ping()}catch{}},30000);
    entry.heartbeat.unref?.();
   });
   ws.on('pong',()=>{alive=true});
   ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(String(raw))}catch{return} // NekoLive also sends bare text replies.
    try{handle(channel,msg)}catch(err){log(channel,'nekolive-event-error',err.message)}
   });
   ws.on('error',err=>{entry.detail=clean(err.message,120);if(entry.failures<3)log(channel,'nekolive-ws-error',err.message)});
   ws.on('close',code=>{
    clearInterval(entry.heartbeat);
    if(sockets.get(channel)!==entry)return;
    entry.status=code===4001?'failed':'pending';
    entry.detail=code===4001?'NekoLive channel "'+slug+'" not found':'Reconnecting';
    const delay=Math.min(120000,10000*2**Math.min(entry.failures++,4));
    entry.timer=setTimeout(open,delay);entry.timer.unref?.();
   });
  };
  open();
 }
 const chatStatus=channel=>{
  const linked=linkedRow(channel);
  if(!linked)return {status:'pending',detail:'Connect NekoLive'};
  const entry=sockets.get(channel);
  if(!entry)return {status:'failed',detail:config().base?'Chat listener stopped':'NEKOLIVE_BASE_URL not configured'};
  return {status:entry.status,detail:entry.detail};
 };

 // ---- broadcaster OAuth link ----
 app.get('/auth/nekolive',withUser,safe(async(req,res)=>{
  const channel=access.channelFor(req);
  if(!channel||!access.can(req.session.uid,channel,'owner'))return res.status(403).json({error:'Channel owner required'});
  const cfg=config();
  if(!cfg.base||!cfg.clientId||!cfg.clientSecret)throw Error('NekoLive OAuth is not configured on this server');
  const state=crypto.randomBytes(32).toString('base64url');
  req.session.nekoliveOAuth={state,channel,owner:req.session.uid,expires:Date.now()+600000};
  res.redirect(cfg.base+'/oauth2/authorize?'+new URLSearchParams({response_type:'code',client_id:cfg.clientId,redirect_uri:redirectUri(),scope:cfg.scope,state}));
 }));
 app.get('/auth/nekolive/callback',withUser,safe(async(req,res)=>{
  const o=req.session.nekoliveOAuth;delete req.session.nekoliveOAuth;
  if(!o||o.state!==req.query.state||o.expires<Date.now()||o.owner!==req.session.uid||!access.can(req.session.uid,o.channel,'owner'))throw Error('Invalid or expired NekoLive authorisation session');
  if(req.query.error)return res.redirect('/dashboard?nekolive=denied');
  if(!req.query.code)throw Error('NekoLive did not return an authorisation code');
  const cfg=config();
  const response=await fetch(cfg.base+'/oauth2/token',{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
   body:new URLSearchParams({grant_type:'authorization_code',code:String(req.query.code),redirect_uri:redirectUri(),client_id:cfg.clientId,client_secret:cfg.clientSecret}),
   signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('NekoLive token exchange returned '+response.status);
  const token=await response.json();
  const id=String(token.user?.id??''),name=String(token.user?.username||'');
  if(!token.access_token||!id||!SLUG.test(name))throw Error('NekoLive did not return a usable account identity');
  const expires=Date.parse(token.accessTokenExpiresAt||'')||Date.now()+Number(token.expires_in||3600)*1000;
  db.prepare('INSERT INTO platform_oauth(channel,platform,external_id,display_name,access_token,refresh_token,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes')
   .run(o.channel,'nekolive',id,name,enc(token.access_token),enc(String(token.refresh_token||'')),expires,String(token.scope||cfg.scope));
  db.prepare('INSERT OR REPLACE INTO provider_accounts(id,channel,platform,external_id,display_name,status) VALUES(?,?,?,?,?,?)').run(o.channel+':nekolive',o.channel,'nekolive',id,name,'connected');
  log(o.channel,'provider-linked','nekolive '+name);
  connect(o.channel,name);
  res.redirect('/dashboard?connected=nekolive');
 }));
 app.get('/api/nekolive',withUser,access.channelOnly('owner'),(req,res)=>{
  const cfg=config(),linked=linkedRow(req.channelId),bot=botRow();
  res.set('Cache-Control','no-store').json({
   configured:{base:Boolean(cfg.base),oauth:Boolean(cfg.base&&cfg.clientId&&cfg.clientSecret),bot:Boolean(bot)},
   base:cfg.base,linked:linked?{display_name:linked.display_name,external_id:linked.external_id}:null,
   bot:bot?{display_name:bot.display_name}:null,chat:chatStatus(req.channelId)
  });
 });
 app.post('/api/nekolive/disconnect',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  stop(req.channelId);
  db.prepare("DELETE FROM platform_oauth WHERE channel=? AND platform='nekolive'").run(req.channelId);
  db.prepare("DELETE FROM provider_accounts WHERE channel=? AND platform='nekolive'").run(req.channelId);
  log(req.channelId,'provider-disconnected','nekolive');
  res.json({ok:true});
 });
 app.post('/api/nekolive/chat',withUser,access.channelOnly('owner'),csrf,safe(async(req,res)=>{
  res.json(await say(req.channelId,req.body?.message||'KitsuFlowBOT chat test: NekoLive messaging is connected.'));
 }));

 // ---- shared bot token (platform administrators) ----
 app.get('/api/admin/nekolive/bot',withUser,requireAdmin,(req,res)=>{
  const bot=botRow();
  res.set('Cache-Control','no-store').json({base:config().base,bot:bot?{display_name:bot.display_name}:null});
 });
 app.post('/api/admin/nekolive/bot',withUser,requireAdmin,csrf,(req,res)=>{
  const token=String(req.body?.token||'').trim(),name=clean(req.body?.name,60);
  if(!BOT_TOKEN.test(token))return res.status(400).json({error:'Paste the 64-character bot token from NekoLive (Admin → Partnership → bot tokens)'});
  if(name.length<2)return res.status(400).json({error:'Enter the bot account name shown on NekoLive'});
  db.prepare('INSERT INTO platform_bot_accounts(platform,external_id,display_name,access_token,refresh_token,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at')
   .run('nekolive',name,name,enc(token),enc(''),Number.MAX_SAFE_INTEGER);
  log(req.session.uid,'nekolive-bot-configured',name);
  res.json({ok:true});
 });
 app.post('/api/admin/nekolive/bot/disconnect',withUser,requireAdmin,csrf,(req,res)=>{
  db.prepare("DELETE FROM platform_bot_accounts WHERE platform='nekolive'").run();
  res.json({ok:true});
 });

 relay.register('nekolive',say);
 streamActivity.setSender('nekolive',say);
 // Restore chat listeners after restarts.
 for(const row of db.prepare("SELECT channel,display_name FROM platform_oauth WHERE platform='nekolive'").all())connect(row.channel,row.display_name);
 return {chatStatus,say};
}
