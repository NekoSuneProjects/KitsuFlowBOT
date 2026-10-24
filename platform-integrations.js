import crypto from 'node:crypto';
import {WebSocket} from 'ws';
const providers={
 kick:{auth:'https://id.kick.com/oauth/authorize',token:'https://id.kick.com/oauth/token',client:'KICK_CLIENT_ID',secret:'KICK_CLIENT_SECRET',scope:process.env.KICK_AUTH_SCOPES||'user:read channel:read channel:write chat:write events:subscribe moderation:ban'},
 vpzone:{auth:'https://vpzone.tv/oauth/authorize',token:'https://vpzone.tv/api/oauth/token',client:'VPZONE_CLIENT_ID',secret:'VPZONE_CLIENT_SECRET',scope:'profile:read dashboard:read chat:read chat:write'}
};
const clean=s=>String(s??'').slice(0,250);
const pkce=()=>crypto.randomBytes(48).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('base64url');
export function installPlatforms({app,db,withUser,csrf,access,enc,dec,log,base,isOperator,relay,streamActivity}) {
 db.exec(`CREATE TABLE IF NOT EXISTS platform_oauth(channel TEXT NOT NULL,platform TEXT NOT NULL,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL,scopes TEXT NOT NULL,PRIMARY KEY(channel,platform));
 CREATE TABLE IF NOT EXISTS platform_delivery(platform TEXT NOT NULL,message_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(platform,message_id));`);
 db.exec("CREATE TABLE IF NOT EXISTS platform_bot_accounts(platform TEXT PRIMARY KEY,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL)");
 const vpCommandCooldowns=new Map();
 async function handleVpzoneCommand(channel,username,body,raw){
  const parts=body.trim().split(/\s+/);
  const name=parts[0]?.toLowerCase();
  if(!name?.startsWith('!'))return;
  const key=name.slice(1);
  if(!/^[a-z0-9_]{1,32}$/.test(key))return;
  const cmd=db.prepare('SELECT name,response,cooldown,level FROM commands WHERE channel=? AND name=?').get(channel,key);
  if(!cmd)return;
  // Do not elevate viewers to moderator/subscriber; only unrestricted custom commands are safe here.
  if(cmd.level!=='everyone')return;
  const throttleKey=channel+':vpzone:'+key,now=Date.now();
  if((vpCommandCooldowns.get(throttleKey)||0)>now)return;
  const bot=db.prepare("SELECT 1 FROM platform_bot_accounts WHERE platform='vpzone'").get();
  if(!bot)return;
  vpCommandCooldowns.set(throttleKey,now+Math.max(0,Number(cmd.cooldown)||0)*1000);
  const broadcaster=db.prepare("SELECT login FROM channels WHERE id=?").get(channel);
  const reply=String(cmd.response).replaceAll('{user}',username).replaceAll('{channel}',broadcaster?.login||'').replaceAll('{args}',parts.slice(1).join(' ')).slice(0,450);
  await vpzoneBotSay(channel,reply);
  log(channel,'vpzone-command',key);
 }
 const vpSockets=new Map();
 function vpzoneConnect(channel,slug){
  if(!/^[a-z0-9_-]{2,32}$/i.test(slug))return;
  const existing=vpSockets.get(channel);
  if(existing?.slug===slug&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(existing.ws.readyState))return;
  if(existing){clearTimeout(existing.timer);existing.ws.close();vpSockets.delete(channel)}
  const entry={slug,ws:null,timer:null};
  const connect=()=>{
   if(db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone' AND display_name=?").get(channel,slug)===undefined){vpSockets.delete(channel);return}
   const ws=new WebSocket('wss://chat.vpzone.tv/ws?channel='+encodeURIComponent(slug));entry.ws=ws;
   ws.on('open',()=>log(channel,'vpzone-chat-connected',slug));
   ws.on('message',raw=>{
    try{
     const event=JSON.parse(String(raw));const item=event.message||event.data||event;
     const eventKind=String(event.type||event.event||'');
     if(eventKind)streamActivity.emit(channel,'vpzone',eventKind,String(item.username||item.sender?.username||''),String(item.amount||item.message||'').slice(0,200),String(event.id||'')||null);
     const username=String(item.username||item.sender?.username||'');
     const body=String(item.body||item.content||item.text||'').slice(0,350);
     if(!username||!body)return;
     const bot=db.prepare("SELECT external_id,display_name FROM platform_bot_accounts WHERE platform='vpzone'").get();
     const isBot=Boolean(bot&&(String(item.user_id||item.sender?.id||'')===bot.external_id||username.toLowerCase()===bot.display_name.toLowerCase()));
     if(!isBot){
      void relay.relay(channel,'vpzone',username,body,{isBot:false}).catch(err=>log(channel,'vpzone-relay-error',err.message));
      void handleVpzoneCommand(channel,username,body,item).catch(err=>log(channel,'vpzone-command-error',err.message));
     }
    }catch(err){log(channel,'vpzone-event-error',err.message)}
   });
   ws.on('error',err=>log(channel,'vpzone-ws-error',err.message));
   ws.on('close',()=>{if(vpSockets.get(channel)!==entry)return;entry.timer=setTimeout(connect,10000);entry.timer.unref?.()});
  };
  vpSockets.set(channel,entry);connect();
 }
 function vpzoneDisconnect(channel){const entry=vpSockets.get(channel);if(!entry)return;vpSockets.delete(channel);clearTimeout(entry.timer);entry.ws?.close()}
 // Restore chat connectivity after process restarts as well as after OAuth callbacks.
 const restore=()=>{for(const item of db.prepare("SELECT channel,display_name FROM platform_oauth WHERE platform='vpzone'").all())vpzoneConnect(item.channel,item.display_name)};
 restore();
 db.exec("CREATE TABLE IF NOT EXISTS kick_chat_status(channel TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',detail TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0)");
 const commandCooldowns=new Map();
 async function kickIncomingCommand(channel,event){
  const body=String(event.content||'').trim(),sender=event.sender||{};
  const parts=body.split(/\\s+/),name=parts[0]?.toLowerCase();
  if(!name?.startsWith('!'))return;
  const key=name.slice(1);
  if(!/^[a-z0-9_]{1,32}$/.test(key))return;
  const cmd=db.prepare('SELECT name,response,cooldown,level FROM commands WHERE channel=? AND name=?').get(channel,key);
  if(!cmd||cmd.level!=='everyone')return;
  const ck=channel+':kick:'+key,now=Date.now();if((commandCooldowns.get(ck)||0)>now)return;
  commandCooldowns.set(ck,now+Math.max(0,Number(cmd.cooldown)||0)*1000);
  const username=clean(sender.username||'viewer');
  const reply=String(cmd.response).replaceAll('{user}',username).replaceAll('{channel}',db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login||'').replaceAll('{args}',parts.slice(1).join(' ')).slice(0,500);
  await kickBotSay(channel,reply);
  log(channel,'kick-command',key);
 }
 async function subscribeKickChat(channel){
  const account=db.prepare("SELECT external_id,scopes FROM platform_oauth WHERE platform='kick' AND channel=?").get(channel);
  if(!account)return;
  const status=(state,detail)=>db.prepare('INSERT INTO kick_chat_status(channel,status,detail,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated_at=excluded.updated_at').run(channel,state,String(detail).slice(0,240),Date.now());
  if(process.env.KICK_WEBHOOK_ENABLED==='false')return status('disabled','KICK_WEBHOOK_ENABLED=false');
  if(!String(account.scopes||'').split(/[\s,]+/).includes('events:subscribe'))return status('missing_scope','Stored Kick OAuth grant lacks events:subscribe; reauthorise the linked broadcaster in Connections. Saved: '+String(account.scopes||'(none)'))
  try{
   const token=await refresh(channel,'kick');
   const url='https://api.kick.com/public/v1/events/subscriptions';
   const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
   const response=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('List subscriptions HTTP '+response.status);
   const data=await response.json();
   const rows=Array.isArray(data.data)?data.data:Array.isArray(data.data?.subscriptions)?data.data.subscriptions:[];
   const wanted=['chat.message.sent','channel.followed','channel.subscription.new','channel.subscription.renewal','channel.subscription.gifts','kicks.gifted'];
   const existing=new Set(rows.map(x=>String(x.event?.name||x.event||x.name||'')));
   const missing=wanted.filter(name=>!existing.has(name));
   if(!missing.length)return status('subscribed','Chat and engagement subscriptions already registered');
   const created=await fetch(url,{method:'POST',headers,body:JSON.stringify({broadcaster_user_id:Number(account.external_id),method:'webhook',events:missing.map(name=>({name,version:1}))}),signal:AbortSignal.timeout(12000)});
   if(!created.ok)throw Error('Create Kick subscriptions HTTP '+created.status+' '+(await created.text()).slice(0,150));
   status('subscribed','Chat and engagement subscriptions requested: '+missing.join(', '));
   log(channel,'kick-event-subscriptions','registered: '+missing.join(', '));
  }catch(err){status('error',err.message);log(channel,'kick-subscription-error',err.message)}
 }
 const conf=type=>{const p=providers[type];if(!p)return null;return {...p,clientId:process.env[p.client],clientSecret:process.env[p.secret]}};
 const safe=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error('platform:',e.message);res.status(400).json({error:e.message})});
 const authUser=(req,res,next)=>req.session.uid?next():res.status(401).json({error:'Sign in with Twitch first'});
 const verifyChannel=(req,res,next)=>{const channel=access.channelFor(req);if(!channel||!access.can(req.session.uid,channel,'owner'))return res.status(403).json({error:'Channel owner required'});req.channelId=channel;next()};
 app.post('/api/platforms/kick/subscribe',withUser,access.channelOnly('owner'),csrf,safe(async(req,res)=>{await subscribeKickChat(req.channelId);res.json(db.prepare('SELECT status,detail,updated_at FROM kick_chat_status WHERE channel=?').get(req.channelId))}));
 app.get('/api/platforms/runtime',withUser,access.channelOnly('editor'),(req,res)=>{
 const sock=vpSockets.get(req.channelId);
 res.json({vpzone:{linked:Boolean(db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone'").get(req.channelId)),chat_connected:Boolean(sock?.ws?.readyState===WebSocket.OPEN)},kick:{linked:Boolean(db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='kick'").get(req.channelId)),webhook_enabled:process.env.KICK_WEBHOOK_ENABLED!=='false',subscription_active:db.prepare('SELECT status FROM kick_chat_status WHERE channel=?').get(req.channelId)?.status==='subscribed',detail:db.prepare('SELECT detail FROM kick_chat_status WHERE channel=?').get(req.channelId)?.detail||'Subscription not registered'}});
 });
 app.get('/api/platforms/kick/scopes',withUser,access.channelOnly('editor'),(req,res)=>{
  const account=db.prepare("SELECT scopes FROM platform_oauth WHERE channel=? AND platform='kick'").get(req.channelId);
  const requested=String(conf('kick')?.scope||'').split(/[\s,]+/).filter(Boolean);
  const stored=String(account?.scopes||'').split(/[\s,]+/).filter(Boolean);
  res.set('Cache-Control','no-store').json({linked:Boolean(account),requested,stored,missing:requested.filter(scope=>!stored.includes(scope)),requiresReauthorisation:!stored.includes('events:subscribe')});
 });
 app.get('/api/platforms',withUser,access.channelOnly('editor'),(req,res)=>{
 const rows=db.prepare('SELECT platform,external_id,display_name,expires_at,scopes FROM platform_oauth WHERE channel=?').all(req.channelId);
 res.json({platforms:['twitch','kick','vpzone'].map(platform=>({platform,configured:platform==='twitch'||Boolean(conf(platform)?.clientId&&conf(platform)?.clientSecret),connection:rows.find(r=>r.platform===platform)||null}))});
 });
 // Platform administrators authorise a separate shared bot identity, not the broadcaster identity.
 const requireAdmin=(req,res,next)=>isOperator(req.session.uid)?next():res.status(403).json({error:'Admin access required'});
 app.get('/api/admin/platform-bots',withUser,requireAdmin,(req,res)=>{
  res.json({bots:db.prepare('SELECT platform,external_id,display_name,expires_at FROM platform_bot_accounts ORDER BY platform').all(),configured:['kick','vpzone'].map(platform=>({platform,ready:Boolean(conf(platform)?.clientId&&conf(platform)?.clientSecret)}))});
 });
 app.get('/auth/platform-bot/:platform',authUser,requireAdmin,safe(async(req,res)=>{
  const type=req.params.platform,p=conf(type);if(!p?.clientId||!p.clientSecret)throw Error('Platform application not configured');
  const state=pkce(),verifier=pkce(),redirect=base+'/auth/platform-bot/callback/'+type;
  req.session.botPlatformOAuth={type,state,verifier,admin:req.session.uid,expires:Date.now()+600000};
  const scope=type==='kick'?'user:read chat:write':p.scope;
  res.redirect(p.auth+'?'+new URLSearchParams({response_type:'code',client_id:p.clientId,redirect_uri:redirect,scope,state,code_challenge:hash(verifier),code_challenge_method:'S256'}));
 }));
 app.get('/auth/platform-bot/callback/:platform',authUser,requireAdmin,safe(async(req,res)=>{
  const o=req.session.botPlatformOAuth;delete req.session.botPlatformOAuth;
  const type=req.params.platform,p=conf(type);
  if(!o||o.type!==type||o.admin!==req.session.uid||o.state!==req.query.state||o.expires<Date.now()||!req.query.code)throw Error('Invalid bot authorization state');
  const redirect=base+'/auth/platform-bot/callback/'+type;
  const tokenResp=await fetch(p.token,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:p.clientId,client_secret:p.clientSecret,redirect_uri:redirect,code:String(req.query.code),code_verifier:o.verifier}),signal:AbortSignal.timeout(12000)});
  if(!tokenResp.ok)throw Error('Platform bot OAuth failed: '+tokenResp.status);
  const token=await tokenResp.json();if(!token.access_token||!token.refresh_token)throw Error('Bot must provide renewable OAuth token');
  let identity;
  if(type==='kick'){
   const r=await fetch('https://api.kick.com/public/v1/users',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('Kick bot user lookup failed');
   const users=(await r.json()).data, user=Array.isArray(users)?users[0]:users;
   identity={id:String(user?.user_id||user?.id||''),name:clean(user?.name||user?.username||'')};
  }else{
   const r=await fetch('https://vpzone.tv/api/v1/me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('VPZone bot user lookup failed');
   const me=(await r.json()).data;identity={id:String(me?.profile?.id||''),name:clean(me?.profile?.username||me?.channel?.slug||'')};
  }
  if(!identity.id||!identity.name)throw Error('Missing linked bot identity');
  const broadcaster=db.prepare('SELECT 1 FROM platform_oauth WHERE platform=? AND external_id=? LIMIT 1').get(type,identity.id);
  if(broadcaster)throw Error('Dedicated bot account must not be a linked broadcaster account');
  db.prepare('INSERT INTO platform_bot_accounts(platform,external_id,display_name,access_token,refresh_token,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at').run(type,identity.id,identity.name,enc(token.access_token),enc(token.refresh_token),Date.now()+Number(token.expires_in||3600)*1000);
  res.redirect('/dashboard?bot='+type);
 }));
 app.post('/api/admin/platform-bots/:platform/disconnect',withUser,requireAdmin,csrf,(req,res)=>{
  if(!providers[req.params.platform])return res.sendStatus(404);
  db.prepare('DELETE FROM platform_bot_accounts WHERE platform=?').run(req.params.platform);res.json({ok:true});
 });
 app.get('/auth/platform/:platform',authUser,verifyChannel,safe(async(req,res)=>{
 const type=req.params.platform,p=conf(type);if(!p?.clientId||!p.clientSecret)throw Error('Platform OAuth app not configured');
 const state=pkce(),verifier=pkce(),redirect=base+'/auth/platform/callback/'+type;
 req.session.platformOAuth={type,state,verifier,channel:req.channelId,owner:req.session.uid,expires:Date.now()+600000};
 const query=new URLSearchParams({response_type:'code',client_id:p.clientId,redirect_uri:redirect,scope:p.scope,state,code_challenge:hash(verifier),code_challenge_method:'S256'});
 res.redirect(p.auth+'?'+query);
 }));
 app.get('/auth/platform/callback/:platform',authUser,safe(async(req,res)=>{
 const o=req.session.platformOAuth;delete req.session.platformOAuth;
 const type=req.params.platform,p=conf(type);
 if(!o||o.type!==type||o.state!==req.query.state||!req.query.code||o.expires<Date.now()||o.owner!==req.session.uid||!access.can(req.session.uid,o.channel,'owner'))throw Error('Invalid or expired OAuth session');
 const redirect=base+'/auth/platform/callback/'+type;
 const body=new URLSearchParams({grant_type:'authorization_code',client_id:p.clientId,client_secret:p.clientSecret,redirect_uri:redirect,code:String(req.query.code),code_verifier:o.verifier});
 const response=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(type+' token exchange returned '+response.status);
 const token=await response.json();if(!token.access_token||!token.refresh_token)throw Error('Provider did not return renewable token');
 let identity;
 if(type==='vpzone'){
 const r=await fetch('https://vpzone.tv/api/v1/me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('VPZone identity failed '+r.status);
 const payload=(await r.json()).data;
 if(!payload?.profile?.id||!payload.channel?.slug)throw Error('VPZone account has no channel slug');
 identity={id:payload.profile.id,display:payload.channel.slug};
 }else{
 const r=await fetch('https://api.kick.com/public/v1/users',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Kick identity failed '+r.status);
 const payload=(await r.json()).data;
 const user=Array.isArray(payload)?payload[0]:payload;
 if(!user?.user_id&&!user?.id)throw Error('Kick identity unavailable');
 identity={id:String(user.user_id||user.id),display:clean(user.name||user.username||user.slug||user.user_id)};
 }
 db.prepare('INSERT INTO platform_oauth(channel,platform,external_id,display_name,access_token,refresh_token,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes').run(o.channel,type,identity.id,identity.display,enc(token.access_token),enc(token.refresh_token),Date.now()+Number(token.expires_in||3600)*1000,String(token.scope||p.scope));
 db.prepare('INSERT OR REPLACE INTO provider_accounts(id,channel,platform,external_id,display_name,status) VALUES(?,?,?,?,?,?)').run(o.channel+':'+type,o.channel,type,identity.id,identity.display,'connected');
 log(o.channel,'provider-linked',type+' '+identity.display);
 if(type==='kick')void subscribeKickChat(o.channel);
 if(type==='vpzone')vpzoneConnect(o.channel,identity.display);
 res.redirect('/dashboard?connected='+encodeURIComponent(type));
 }));
 app.post('/api/platforms/:platform/disconnect',withUser,verifyChannel,csrf,(req,res)=>{
 const type=req.params.platform;if(!providers[type])return res.sendStatus(404);
 db.prepare('DELETE FROM platform_oauth WHERE channel=? AND platform=?').run(req.channelId,type);
 if(type==='vpzone')vpzoneDisconnect(req.channelId);
 db.prepare('DELETE FROM provider_accounts WHERE channel=? AND platform=?').run(req.channelId,type);
 log(req.channelId,'provider-disconnected',type);res.json({ok:true});
 });
 async function refresh(channel,type){
 const row=db.prepare('SELECT * FROM platform_oauth WHERE channel=? AND platform=?').get(channel,type),p=conf(type);
 if(!row||!p?.clientId)return null;if(row.expires_at>Date.now()+120000)return dec(row.access_token);
 const b=new URLSearchParams({grant_type:'refresh_token',refresh_token:dec(row.refresh_token),client_id:p.clientId,client_secret:p.clientSecret});
 const r=await fetch(p.token,{method:'POST',body:b,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(type+' refresh failed '+r.status);
 const t=await r.json();if(!t.access_token||!t.refresh_token)throw Error('Missing rotated token');
 db.prepare('UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=? WHERE channel=? AND platform=?').run(enc(t.access_token),enc(t.refresh_token),Date.now()+Number(t.expires_in||3600)*1000,channel,type);
 return t.access_token;
 }
 // VPZone chat sending requires an explicitly linked dedicated bot identity.
 // Broadcaster OAuth is never used silently as a bot substitute.
 async function vpzoneBotAccessToken(){
  const row=db.prepare("SELECT * FROM platform_bot_accounts WHERE platform='vpzone'").get();
  if(!row)throw Error('VPZone bot not connected. Link it in Admin Panel first.');
  if(row.expires_at>Date.now()+120000)return dec(row.access_token);
  const p=conf('vpzone');if(!p?.clientId||!p.clientSecret)throw Error('VPZone developer credentials missing');
  const response=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:dec(row.refresh_token),client_id:p.clientId,client_secret:p.clientSecret}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('VPZone bot OAuth expired or revoked ('+response.status+'). Reconnect bot from Admin Panel.');
  const json=await response.json();
  if(!json.access_token||!json.refresh_token)throw Error('VPZone did not return rotated bot tokens');
  db.prepare("UPDATE platform_bot_accounts SET access_token=?,refresh_token=?,expires_at=? WHERE platform='vpzone'").run(enc(json.access_token),enc(json.refresh_token),Date.now()+Number(json.expires_in||3600)*1000);
  return json.access_token;
 }
 async function vpzoneBotSay(channel,text){
  const linked=db.prepare("SELECT display_name FROM platform_oauth WHERE channel=? AND platform='vpzone'").get(channel);
  if(!linked)throw Error('Link your VPZone broadcaster channel first');
  if(!/^[a-z0-9_-]{2,32}$/i.test(linked.display_name))throw Error('Invalid VPZone channel slug');
  const content=String(text||'').trim().slice(0,300);
  if(!content)throw Error('Message is empty');
  const token=await vpzoneBotAccessToken();
  const url='https://vpzone.tv/api/v1/channels/'+encodeURIComponent(linked.display_name)+'/chat';
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({message:content}),signal:AbortSignal.timeout(12000)});
  if(!response.ok){
   const reason=(await response.text()).slice(0,280);
   if(response.status===401||response.status===403)throw Error('VPZone bot chat permission denied ('+response.status+'). Reconnect the dedicated bot with chat:write. '+reason);
   throw Error('VPZone bot message failed ('+response.status+'): '+reason);
  }
  log(channel,'vpzone-bot-message',linked.display_name);
  return {ok:true};
 }
 relay.register('vpzone',vpzoneBotSay);
 app.post('/api/platforms/vpzone/chat',withUser,access.channelOnly('bot_supervisor'),csrf,safe(async(req,res)=>{
  res.json(await vpzoneBotSay(req.channelId,req.body?.message));
 }));
 // Kick's official bot mode uses app credentials, not the Twitch shared-bot identity.
 let appToken=null;
 async function kickAppToken(){
  if(appToken&&appToken.expires>Date.now()+60000)return appToken.value;
  const p=conf('kick');if(!p?.clientId||!p.clientSecret)throw Error('Kick application credentials are missing');
  const response=await fetch('https://id.kick.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:p.clientId,client_secret:p.clientSecret,grant_type:'client_credentials'}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Kick app token failed: '+response.status);
  const token=await response.json();if(!token.access_token)throw Error('Kick app token unavailable');
  appToken={value:token.access_token,expires:Date.now()+Number(token.expires_in||3600)*1000};return appToken.value;
 }
 async function kickBotAccessToken(force=false){
  const row=db.prepare("SELECT * FROM platform_bot_accounts WHERE platform='kick'").get();
  if(!row)throw Error('Kick bot account is not connected. Connect a separate bot in Admin Panel.');
  if(!force&&row.expires_at>Date.now()+120000)return dec(row.access_token);
  const p=conf('kick');if(!p?.clientId||!p.clientSecret)throw Error('Kick OAuth application credentials missing');
  const response=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:dec(row.refresh_token),client_id:p.clientId,client_secret:p.clientSecret}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Kick bot OAuth refresh failed ('+response.status+'). Reconnect the dedicated Kick bot in Admin Panel.');
  const token=await response.json();
  if(!token.access_token)throw Error('Kick bot OAuth refresh did not return an access token');
  db.prepare("UPDATE platform_bot_accounts SET access_token=?,refresh_token=?,expires_at=? WHERE platform='kick'").run(enc(token.access_token),enc(token.refresh_token||dec(row.refresh_token)),Date.now()+Number(token.expires_in||3600)*1000);
  return token.access_token;
 }
 async function kickBotSay(channel,text){
  // Kick's official Chat API requires UserAccessToken with chat:write even when type='bot'.
  // Always use the OAuth grant for this creator's selected, linked Kick channel.
  const linked=db.prepare("SELECT external_id,scopes FROM platform_oauth WHERE channel=? AND platform='kick'").get(channel);
  if(!linked||!/^[0-9]+$/.test(String(linked.external_id)))throw Error('Connect the selected creator\'s Kick channel through OAuth');
  if(!String(linked.scopes||'').split(/\s+/).includes('chat:write'))throw Error('Kick chat:write permission missing. Reconnect this creator\'s Kick OAuth in Connections.');
  const content=String(text||'').trim().slice(0,500);
  if(!content)throw Error('Empty Kick bot message');
  const send=async(token)=>{
   const response=await fetch('https://api.kick.com/public/v1/chat',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({content,type:'bot'}),signal:AbortSignal.timeout(12000)});
   return {status:response.status,ok:response.ok,detail:response.ok?'':(await response.text()).slice(0,300)};
  };
  let result=await send(await refresh(channel,'kick'));
  if(result.status===401){
   const row=db.prepare("SELECT refresh_token FROM platform_oauth WHERE channel=? AND platform='kick'").get(channel);
   const p=conf('kick');
   const response=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:dec(row.refresh_token),client_id:p.clientId,client_secret:p.clientSecret}),signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Kick linked channel token refresh rejected ('+response.status+'). Reconnect Kick through Connections.');
   const t=await response.json();
   if(!t.access_token)throw Error('Kick did not issue a renewed channel token');
   db.prepare("UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=? WHERE channel=? AND platform='kick'").run(enc(t.access_token),enc(t.refresh_token||dec(row.refresh_token)),Date.now()+Number(t.expires_in||3600)*1000,channel);
   result=await send(t.access_token);
  }
  if(!result.ok)throw Error('Kick bot-mode chat failed ('+result.status+'): '+result.detail+'. Verify the linked Kick broadcaster granted chat:write and has app bot posting enabled.');
  log(channel,'kick-bot-message','oauth-bot-mode');
  return {ok:true,mode:'oauth-bot'};
 }
 relay.register('kick',kickBotSay);
 app.post('/api/platforms/kick/chat',withUser,access.channelOnly('bot_supervisor'),csrf,safe(async(req,res)=>{
  const result=await kickBotSay(req.channelId,req.body.message);res.json(result);
 }));
 app.get('/api/platforms/linked',withUser,access.channelOnly('editor'),(req,res)=>{
  res.json({linked:db.prepare('SELECT platform,external_id,display_name FROM platform_oauth WHERE channel=?').all(req.channelId)});
 });
 app.get('/api/platforms/:platform/channel',withUser,access.channelOnly('editor'),safe(async(req,res)=>{
 const type=req.params.platform;if(!providers[type])return res.sendStatus(404);
 const row=db.prepare('SELECT * FROM platform_oauth WHERE channel=? AND platform=?').get(req.channelId,type);
 if(!row)return res.status(404).json({error:'Platform not connected'});
 const token=await refresh(req.channelId,type);
 const url=type==='vpzone'?'https://vpzone.tv/api/v1/channels/'+encodeURIComponent(row.display_name):'https://api.kick.com/public/v1/channels?broadcaster_user_id='+encodeURIComponent(row.external_id);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error(type+' channel query failed '+r.status);res.json({platform:type,data:await r.json()});
 }));
 // Kick signs the raw bytes using its rotating RSA public key.
 let kickKey=null,keyTime=0;
 async function currentKickKey(){if(kickKey&&Date.now()-keyTime<3600000)return kickKey;
 const r=await fetch('https://api.kick.com/public/v1/public-key',{signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Kick public key retrieval failed');const j=await r.json();const pem=j.data?.public_key||j.public_key;
 if(!pem)throw Error('Kick public key missing');kickKey=crypto.createPublicKey(pem);keyTime=Date.now();return kickKey}
 app.post('/webhooks/kick',safe(async(req,res)=>{
 if(process.env.KICK_WEBHOOK_ENABLED==='false')return res.sendStatus(204);
 const msg=req.get('Kick-Event-Message-Id'),timestamp=req.get('Kick-Event-Message-Timestamp'),sig=req.get('Kick-Event-Signature'),kind=req.get('Kick-Event-Type');
 if(!msg||!timestamp||!sig||!kind||!Buffer.isBuffer(req.rawBody))return res.sendStatus(400);
 const time=Date.parse(timestamp);if(!Number.isFinite(time)||Math.abs(Date.now()-time)>300000)return res.sendStatus(401);
 const signed=Buffer.concat([Buffer.from(msg+'.'+timestamp+'.'),req.rawBody]);
 const key=await currentKickKey();
 if(!crypto.verify('RSA-SHA256',signed,key,Buffer.from(sig,'base64')))return res.sendStatus(401);
 if(db.prepare('SELECT 1 FROM platform_delivery WHERE platform=? AND message_id=?').get('kick',msg))return res.sendStatus(204);
 const event=JSON.parse(req.rawBody.toString('utf8'));
 const broadcaster=String(event.broadcaster?.user_id||event.broadcaster_user_id||event.broadcaster?.id||'');
 const linked=db.prepare('SELECT channel FROM platform_oauth WHERE platform=? AND external_id=?').get('kick',broadcaster);
 db.prepare('INSERT INTO platform_delivery(platform,message_id,created_at) VALUES(?,?,?)').run('kick',msg,Date.now());
 if(linked){
 const actor=clean(event.follower?.username||event.sender?.username||event.user?.username||event.subscriber?.username||'');
 const detail=clean(kind+' '+actor);
 db.prepare('INSERT INTO platform_events(channel,platform,event_type,actor,detail) VALUES(?,?,?,?,?)').run(linked.channel,'kick',kind,actor,detail);
 db.prepare('INSERT INTO overlay_events(channel,kind,message) VALUES(?,?,?)').run(linked.channel,kind,detail);
 streamActivity.emit(linked.channel,'kick',kind,actor,detail,msg);
 log(linked.channel,'kick-event',detail);
 if(kind==='chat.message.sent' || kind==='chat.message.created'){
  const body=String(event.content||event.message?.content||'').slice(0,350);
  const bot=db.prepare('SELECT external_id FROM platform_bot_accounts WHERE platform=?').get('kick');
  if(body){
   const isBot=Boolean((bot&&String(event.sender?.user_id||event.sender?.id)===bot.external_id)||event.sender?.is_bot===true||(process.env.KICK_BOT_USERNAME&&String(event.sender?.username||'').toLowerCase()===process.env.KICK_BOT_USERNAME.toLowerCase()));
   if(!isBot&&event.sender?.is_anonymous!==true){
    void relay.relay(linked.channel,'kick',event.sender?.username||actor,body,{isBot:false}).catch(err=>log(linked.channel,'relay-error',err.message));
    void kickIncomingCommand(linked.channel,event).catch(err=>log(linked.channel,'kick-command-error',err.message));
   }
  }
 }
 }
 db.prepare('DELETE FROM platform_delivery WHERE created_at<?').run(Date.now()-86400000);
 res.sendStatus(204);
 }));
 setImmediate(()=>{for(const row of db.prepare("SELECT channel FROM platform_oauth WHERE platform='kick'").all())void subscribeKickChat(row.channel)});
}