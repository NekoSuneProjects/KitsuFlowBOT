import crypto from 'node:crypto';
import {WebSocket} from 'ws';
const providers={
 kick:{auth:'https://id.kick.com/oauth/authorize',token:'https://id.kick.com/oauth/token',client:'KICK_CLIENT_ID',secret:'KICK_CLIENT_SECRET',scope:process.env.KICK_AUTH_SCOPES||'user:read channel:read channel:write chat:write events:subscribe moderation:ban'},
 vpzone:{auth:'https://vpzone.tv/oauth/authorize',token:'https://vpzone.tv/api/oauth/token',client:'VPZONE_CLIENT_ID',secret:'VPZONE_CLIENT_SECRET',scope:'profile:read dashboard:read chat:read'}
};
const clean=s=>String(s??'').slice(0,250);
const pkce=()=>crypto.randomBytes(48).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('base64url');
export function installPlatforms({app,db,withUser,csrf,access,enc,dec,log,base,isOperator,relay}) {
 db.exec(`CREATE TABLE IF NOT EXISTS platform_oauth(channel TEXT NOT NULL,platform TEXT NOT NULL,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL,scopes TEXT NOT NULL,PRIMARY KEY(channel,platform));
 CREATE TABLE IF NOT EXISTS platform_delivery(platform TEXT NOT NULL,message_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(platform,message_id));`);
 db.exec("CREATE TABLE IF NOT EXISTS platform_bot_accounts(platform TEXT PRIMARY KEY,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL)");
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
     const username=String(item.username||item.sender?.username||'');
     const body=String(item.body||item.content||item.text||'').slice(0,350);
     if(!username||!body)return;
     const bot=db.prepare("SELECT external_id,display_name FROM platform_bot_accounts WHERE platform='vpzone'").get();
     const isBot=Boolean(bot&&(String(item.user_id||item.sender?.id||'')===bot.external_id||username.toLowerCase()===bot.display_name.toLowerCase()));
     void relay.relay(channel,'vpzone',username,body,{isBot}).catch(err=>log(channel,'vpzone-relay-error',err.message));
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
 const conf=type=>{const p=providers[type];if(!p)return null;return {...p,clientId:process.env[p.client],clientSecret:process.env[p.secret]}};
 const safe=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error('platform:',e.message);res.status(400).json({error:e.message})});
 const authUser=(req,res,next)=>req.session.uid?next():res.status(401).json({error:'Sign in with Twitch first'});
 const verifyChannel=(req,res,next)=>{const channel=access.channelFor(req);if(!channel||!access.can(req.session.uid,channel,'owner'))return res.status(403).json({error:'Channel owner required'});req.channelId=channel;next()};
 app.get('/api/platforms/runtime',withUser,access.channelOnly('editor'),(req,res)=>{
 const sock=vpSockets.get(req.channelId);
 res.json({vpzone:{linked:Boolean(db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone'").get(req.channelId)),chat_connected:Boolean(sock?.ws?.readyState===WebSocket.OPEN)},kick:{linked:Boolean(db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='kick'").get(req.channelId)),webhook_enabled:process.env.KICK_WEBHOOK_ENABLED!=='false',subscription_active:false,detail:'Kick event subscription registration not configured'}});
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
 async function kickBotSay(channel,text){
  const linked=db.prepare("SELECT external_id,scopes FROM platform_oauth WHERE channel=? AND platform='kick'").get(channel);
  if(!linked)throw Error('Connect your Kick broadcaster account before sending chat');
  const content=String(text||'').trim().slice(0,500);if(!content)throw Error('Empty chat message');
  const endpoint='https://api.kick.com/public/v1/chat';
  const post=async(token,body)=>{
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
   return {ok:response.ok,status:response.status,body:response.ok?'':(await response.text()).slice(0,300)};
  };
  // Use Kick app bot identity first, as StreamBOT/backendlive does.
  let initial;
  try{
   initial=await post(await kickAppToken(),{content,type:'bot'});
   if(initial.ok){log(channel,'kick-bot-message','app');return {ok:true,mode:'app-bot'}}
   if(initial.status!==401)throw Error('Kick bot chat failed: '+initial.status+' '+initial.body);
  }catch(err){
   // Do not silently downgrade network errors or other authorization failures.
   if(!initial||initial.status!==401)throw err;
  }
  appToken=null; // invalidate a possibly revoked/stale app credential
  log(channel,'kick-chat-auth','App bot token rejected (401); attempting linked broadcaster OAuth');
  if(!String(linked.scopes||'').split(/\\s+/).includes('chat:write'))throw Error('Kick app token rejected (401). Reconnect broadcaster with chat:write scope.');
  const broadcasterId=Number(linked.external_id);
  if(!Number.isSafeInteger(broadcasterId)||broadcasterId<=0)throw Error('Kick broadcaster ID invalid');
  let userToken=await refresh(channel,'kick');
  const payload={content,type:'user',broadcaster_user_id:broadcasterId};
  let fallback=await post(userToken,payload);
  if(fallback.status===401){
   const row=db.prepare("SELECT refresh_token FROM platform_oauth WHERE channel=? AND platform='kick'").get(channel);
   const p=conf('kick');
   const res=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:dec(row.refresh_token),client_id:p.clientId,client_secret:p.clientSecret}),signal:AbortSignal.timeout(12000)});
   if(!res.ok)throw Error('Kick broadcaster token refresh failed: '+res.status+'; reconnect Kick account');
   const next=await res.json();
   if(!next.access_token)throw Error('Kick token refresh missing access token');
   db.prepare("UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=? WHERE channel=? AND platform='kick'").run(enc(next.access_token),enc(next.refresh_token||dec(row.refresh_token)),Date.now()+Number(next.expires_in||3600)*1000,channel);
   fallback=await post(next.access_token,payload);
  }
  if(!fallback.ok)throw Error('Kick bot app token rejected (401); broadcaster fallback failed: '+fallback.status+' '+fallback.body);
  log(channel,'kick-bot-message','broadcaster-fallback');
  return {ok:true,mode:'broadcaster-fallback'};
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
 log(linked.channel,'kick-event',detail);
 if(kind==='chat.message.sent' || kind==='chat.message.created'){
  const body=String(event.content||event.message?.content||'').slice(0,350);
  const bot=db.prepare('SELECT external_id FROM platform_bot_accounts WHERE platform=?').get('kick');
  if(body)void relay.relay(linked.channel,'kick',event.sender?.username||actor,body,{isBot:Boolean(bot&&String(event.sender?.user_id||event.sender?.id)===bot.external_id)}).catch(err=>log(linked.channel,'relay-error',err.message));
 }
 }
 db.prepare('DELETE FROM platform_delivery WHERE created_at<?').run(Date.now()-86400000);
 res.sendStatus(204);
 }));
}