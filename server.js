import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import Database from 'better-sqlite3';
import {WebSocket} from 'ws';
import crypto from 'node:crypto';
import path from 'node:path';
import {installEngagement} from './engagement.js';
import {installCreator} from './creator.js';
import {installVoice} from './voice.js';
import {installAccess} from './access.js';
import {installPlatforms} from './platform-integrations.js';

const PORT=Number(process.env.PORT||3000), BASE=(process.env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
const CID=process.env.TWITCH_CLIENT_ID, SECRET=process.env.TWITCH_CLIENT_SECRET;
const KEY=Buffer.from(process.env.TOKEN_KEY||'','hex');
if(!CID||!SECRET||KEY.length!==32||!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<24) throw Error('Set Twitch credentials, 32-byte TOKEN_KEY and SESSION_SECRET in .env');
const db=new Database(process.env.DB_PATH||'data/streamnexus.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,login TEXT NOT NULL,display TEXT NOT NULL,access TEXT NOT NULL,refresh TEXT NOT NULL,expires INTEGER NOT NULL,scopes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,login TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,links INTEGER NOT NULL DEFAULT 1,blocked TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS commands(channel TEXT NOT NULL,name TEXT NOT NULL,response TEXT NOT NULL,cooldown INTEGER NOT NULL DEFAULT 10,level TEXT NOT NULL DEFAULT 'everyone',PRIMARY KEY(channel,name));
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const enc=s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',KEY,iv),b=Buffer.concat([c.update(s,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64')};
const dec=s=>{const b=Buffer.from(s,'base64'),d=crypto.createDecipheriv('aes-256-gcm',KEY,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString()};
const log=(id,event,detail)=>db.prepare('INSERT INTO logs(channel,event,detail) VALUES(?,?,?)').run(id,event,String(detail).slice(0,500));
const getAccount=id=>db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
async function token(id){let a=getAccount(id);if(!a)throw Error('Account not connected');
if(a.expires>Date.now()+120000)return dec(a.access);
const p=new URLSearchParams({client_id:CID,client_secret:SECRET,grant_type:'refresh_token',refresh_token:dec(a.refresh)});
const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:p});if(!r.ok)throw Error('Twitch refresh failed: '+r.status);
const t=await r.json();db.prepare('UPDATE accounts SET access=?,refresh=?,expires=? WHERE id=?').run(enc(t.access_token),enc(t.refresh_token||dec(a.refresh)),Date.now()+t.expires_in*1000,id);return t.access_token}
async function api(id,route,method='GET',body){const t=await token(id);const r=await fetch('https://api.twitch.tv/helix/'+route,{method,headers:{'Client-Id':CID,Authorization:'Bearer '+t,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const x=await r.text();if(!r.ok)throw Error('Twitch '+r.status+': '+x.slice(0,300));return x?JSON.parse(x):{}}
const botId=()=>db.prepare("SELECT value FROM config WHERE key='bot_id'").get()?.value;
const adminIds=new Set((process.env.BOT_ADMIN_TWITCH_IDS||process.env.BOT_ADMIN_TWITCH_ID||'').split(',').map(s=>s.trim()).filter(s=>/^[0-9]+$/.test(s)));
const isOperator=id=>Boolean(id&&adminIds.has(String(id)));
const BOT_SCOPES='user:read:chat user:write:chat user:bot moderator:manage:banned_users';
const STREAMER_SCOPES=[
 'channel:bot','clips:edit','user:read:email','user:read:broadcast','channel:manage:broadcast',
 'channel:manage:redemptions','channel:read:redemptions','bits:read','channel:read:subscriptions',
 'channel:manage:polls','channel:read:polls','channel:manage:predictions','channel:read:predictions',
 'moderator:read:followers','moderator:read:chatters','moderation:read',
 'channel:read:hype_train','channel:read:ads','channel:manage:ads'
].join(' ');
async function say(channel,message){const id=botId();if(!id)throw Error('Connect bot first');await api(id,'chat/messages','POST',{broadcaster_id:channel,sender_id:id,message:String(message).slice(0,500)})}
async function lookup(login){const id=botId();if(!id)throw Error('Bot not connected');const u=await api(id,'users?login='+encodeURIComponent(login.replace(/^@/,'')));if(!u.data?.[0])throw Error('User not found');return u.data[0].id}
async function moderate(channel,user,duration,reason){const id=botId();if(!id)throw Error('Connect bot first');if(id===user||channel===user)throw Error('Cannot moderate bot or broadcaster');await api(id,'moderation/bans?broadcaster_id='+channel+'&moderator_id='+id,'POST',{data:{user_id:user,...(duration?{duration}:{}),reason:reason||'KitsuFlowBOT moderation'}})}
async function clip(channel){const data=await api(channel,'clips?broadcaster_id='+channel,'POST');const c=data.data?.[0];if(!c)throw Error('No live clip returned');log(channel,'clip',c.edit_url||c.id);return c}
const cooldowns=new Map();
const allowed=(level,e)=>level==='everyone'||e.badges?.some(b=>b.set_id==='broadcaster'||b.set_id==='moderator')||(level==='subscriber'&&e.badges?.some(b=>b.set_id==='subscriber'));
async function message(e){const ch=db.prepare('SELECT * FROM channels WHERE id=? AND enabled=1').get(e.broadcaster_user_id);if(!ch||e.chatter_user_id===botId())return;
const value=(e.message?.text||'').trim(),parts=value.split(/\s+/),cmd=parts[0]?.toLowerCase(),isMod=e.badges?.some(b=>b.set_id==='moderator'||b.set_id==='broadcaster');
if(ch.links&&!isMod&&/https?:\/\/|(?:[a-z0-9-]+\.)+(?:com|net|org|xyz|click|shop|ru|co\.uk)\b/i.test(value)){try{await moderate(ch.id,e.chatter_user_id,60,'Unapproved URL');log(ch.id,'timeout',e.chatter_user_login+' URL')}catch(err){log(ch.id,'error',err.message)}return}
try{
if(await engagement.onMessage(ch,e,value,parts,isMod))return;
if(await creator.onMessage(ch,e,value,parts,isMod))return;
if(!cmd?.startsWith('!'))return;
if(cmd==='!clip'){if(!isMod)return;const c=await clip(ch.id);await say(ch.id,'Clip created: https://clips.twitch.tv/'+c.id);return}
if((cmd==='!ban'||cmd==='!timeout')&&isMod){const target=parts[1];if(!target)return;const uid=await lookup(target);const seconds=cmd==='!timeout'?Math.max(1,Math.min(1209600,Number(parts[2])||600)):null;await moderate(ch.id,uid,seconds,parts.slice(cmd==='!timeout'?3:2).join(' ')||'Moderator command');log(ch.id,cmd,target);await say(ch.id,target+' '+(seconds?'timed out':'banned'));return}
if(cmd==='!uptime'){const s=await api(ch.id,'streams?user_id='+ch.id);await say(ch.id,s.data?.[0]?'Live since '+new Date(s.data[0].started_at).toLocaleString():'Stream is offline');return}
const custom=db.prepare('SELECT * FROM commands WHERE channel=? AND name=?').get(ch.id,cmd.slice(1));if(!custom||engagement.reserved.has(cmd.slice(1))||!allowed(custom.level,e))return;
const key=ch.id+':'+custom.name,now=Date.now();if(now<(cooldowns.get(key)||0))return;cooldowns.set(key,now+custom.cooldown*1000);
await say(ch.id,custom.response.replaceAll('{user}',e.chatter_user_name).replaceAll('{channel}',ch.login).replaceAll('{args}',parts.slice(1).join(' ')));
}catch(err){log(ch.id,'error',err.message)}
}
const sockets=new Map();
async function connectChat(){const id=botId();if(!id)return;
const prev=sockets.get('bot');if(prev)prev.close();
let ws=new WebSocket('wss://eventsub.wss.twitch.tv/ws');sockets.set('bot',ws);
ws.on('message',async raw=>{try{const d=JSON.parse(raw);const type=d.metadata?.message_type;
if(type==='session_reconnect'){ws.close();ws=new WebSocket(d.payload.session.reconnect_url);sockets.set('bot',ws);return}
if(type==='notification'&&d.metadata.subscription_type==='channel.chat.message'){await message(d.payload.event);return}
if(type==='session_welcome'){const channels=db.prepare('SELECT id FROM channels WHERE enabled=1').all();for(const ch of channels){try{await api(id,'eventsub/subscriptions','POST',{type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:ch.id,user_id:id},transport:{method:'websocket',session_id:d.payload.session.id}})}catch(err){log(ch.id,'error','EventSub: '+err.message)}}}
}catch(e){console.error('EventSub',e.message)}});
ws.on('close',()=>{if(sockets.get('bot')===ws)setTimeout(connectChat,5000)});ws.on('error',e=>console.error('WS',e.message))}
const app=express();app.set('trust proxy',process.env.TRUST_PROXY==='true'?1:false);app.use(express.json({limit:'256kb',verify:(req,res,buffer)=>{if(req.path==='/webhooks/kick')req.rawBody=Buffer.from(buffer)}}));
const Store=SQLiteStoreFactory(session);
app.use(session({store:new Store({db:'sessions.sqlite',dir:'data'}),name:'sn.sid',secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:BASE.startsWith('https:'),maxAge:86400000}}));
const withUser=(req,res,next)=>req.session.uid?next():res.status(401).json({error:'Login required'});
const csrf=(req,res,next)=>{if(req.get('origin')!==BASE)return res.status(403).json({error:'Origin mismatch'});next()};
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(e=>res.status(400).json({error:e.message}));
app.get('/auth/connect/:role',safe(async(req,res)=>{const role=req.params.role;if(!['streamer','bot'].includes(role))throw Error('Invalid role');if(role==='bot'&&!isOperator(req.session.uid))return res.status(403).send('Only the KitsuFlowBOT operator can link the global bot account. Set BOT_ADMIN_TWITCH_ID.');
const state=crypto.randomBytes(24).toString('hex');req.session.oauth={state,role,owner:req.session.uid};
const scope=role==='bot'?BOT_SCOPES:STREAMER_SCOPES;
const p=new URLSearchParams({client_id:CID,redirect_uri:BASE+'/auth/callback',response_type:'code',scope,state});res.redirect('https://id.twitch.tv/oauth2/authorize?'+p)}));
app.get('/auth/callback',safe(async(req,res)=>{const s=req.session.oauth;if(!s||req.query.state!==s.state||!req.query.code)throw Error('Invalid OAuth state');delete req.session.oauth;
const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:CID,client_secret:SECRET,code:String(req.query.code),grant_type:'authorization_code',redirect_uri:BASE+'/auth/callback'})});if(!r.ok)throw Error('OAuth exchange failed');const t=await r.json();
const who=await fetch('https://api.twitch.tv/helix/users',{headers:{'Client-Id':CID,Authorization:'Bearer '+t.access_token}});if(!who.ok)throw Error('User lookup failed');const u=(await who.json()).data[0];
db.prepare('INSERT INTO accounts(id,login,display,access,refresh,expires,scopes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,display=excluded.display,access=excluded.access,refresh=excluded.refresh,expires=excluded.expires,scopes=excluded.scopes').run(u.id,u.login,u.display_name,enc(t.access_token),enc(t.refresh_token),Date.now()+t.expires_in*1000,JSON.stringify(t.scope||[]));
if(s.role==='bot'&&u.id===s.owner)throw Error('A separate bot Twitch account is required; do not authorise your admin streamer account as the bot.');
if(s.role==='streamer'){req.session.uid=u.id;db.prepare('INSERT INTO channels(id,login) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login').run(u.id,u.login)}
else{if(!s.owner||s.owner!==req.session.uid||!isOperator(s.owner))throw Error('Only the KitsuFlowBOT operator may configure the shared bot');db.prepare("INSERT INTO config(key,value) VALUES('bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(u.id);connectChat()}
res.redirect('/')}));
app.post('/logout',csrf,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
const access=installAccess({app,db,withUser,csrf,safe,log});
// Existing studio endpoints resolve the selected channel, not the login identity.
app.use(['/api/state','/api/settings','/api/commands','/api/clip','/api/moderate','/api/engagement','/api/creator'],withUser,(req,res,next)=>{const channel=access.channelFor(req);if(!channel)return res.status(403).json({error:'No channel access'});if(req.method!=='GET'){const required=req.path.startsWith('/api/moderate')||req.path.startsWith('/api/settings')||req.path.startsWith('/api/clip')||req.path.startsWith('/api/creator/queue')||req.path.startsWith('/api/creator/campaign/draw')||req.path.startsWith('/api/creator/redeem')?'bot_supervisor':'editor';if(!access.can(req.session.uid,channel,required))return res.status(403).json({error:'Insufficient channel permissions'});}req.channelId=channel;next()});
app.get('/api/admin/overview',withUser,(req,res)=>{if(!isOperator(req.session.uid))return res.status(403).json({error:'Operator access required'});const b=getAccount(botId());const channels=db.prepare('SELECT id,login,enabled FROM channels ORDER BY login').all();res.set('Cache-Control','no-store').json({operator:true,bot:b?{id:b.id,login:b.login,display:b.display,expires:b.expires,scopes:JSON.parse(b.scopes||'[]')}:null,channels,enabled_count:channels.filter(x=>x.enabled).length,connection_status:b?(sockets.get('bot')?.readyState===1?'connected':'disconnected'):'not_configured'});});
app.post('/api/admin/bot/reconnect',withUser,csrf,safe(async(req,res)=>{if(!isOperator(req.session.uid))return res.status(403).json({error:'Operator access required'});if(!botId())return res.status(409).json({error:'Authorise the public bot first'});await token(botId());await connectChat();log(req.session.uid,'bot-reconnect','Operator requested EventSub reconnection');res.json({ok:true})}));
// The device grant is an alternative for administrators who have the dedicated bot signed in on another browser/device.
db.exec("CREATE TABLE IF NOT EXISTS bot_device_grants(admin_id TEXT PRIMARY KEY,device_secret TEXT NOT NULL,expires_at INTEGER NOT NULL,interval_seconds INTEGER NOT NULL,next_poll INTEGER NOT NULL,verification_uri TEXT NOT NULL,user_code TEXT NOT NULL)");
const requireAdmin=(req,res,next)=>isOperator(req.session.uid)?next():res.status(403).json({error:'Admin Twitch ID is not authorised'});
async function storeBotToken(t,adminId){
 const check=await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+t.access_token}});
 if(!check.ok)throw Error('Unable to validate Twitch bot token');
 const identity=await check.json();
 if(identity.client_id!==CID)throw Error('Token belongs to another Twitch application');
 if(identity.user_id===adminId)throw Error('Streamer/admin account cannot be linked as shared bot. Authorise a dedicated bot account.');
 const required=BOT_SCOPES.split(' ');
 if(required.some(v=>!identity.scopes?.includes(v)))throw Error('Bot permission scopes were not granted.');
 const info=await fetch('https://api.twitch.tv/helix/users',{headers:{'Client-Id':CID,Authorization:'Bearer '+t.access_token}});
 if(!info.ok)throw Error('Unable to retrieve bot identity');
 const bot=(await info.json()).data?.[0];
 if(!bot||bot.id!==identity.user_id)throw Error('Invalid Twitch bot identity');
 db.transaction(()=>{
 db.prepare('INSERT INTO accounts(id,login,display,access,refresh,expires,scopes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,display=excluded.display,access=excluded.access,refresh=excluded.refresh,expires=excluded.expires,scopes=excluded.scopes').run(bot.id,bot.login,bot.display_name,enc(t.access_token),enc(t.refresh_token),Date.now()+t.expires_in*1000,JSON.stringify(t.scope||identity.scopes));
 db.prepare("INSERT INTO config(key,value) VALUES('bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(bot.id);
 })();
 connectChat();
 return {id:bot.id,login:bot.login};
}
app.post('/api/admin/bot/device/start',withUser,requireAdmin,csrf,safe(async(req,res)=>{
 const response=await fetch('https://id.twitch.tv/oauth2/device',{method:'POST',body:new URLSearchParams({client_id:CID,scopes:BOT_SCOPES})});
 const d=await response.json();if(!response.ok||!d.device_code||!d.user_code)throw Error('Twitch device authorization failed');
 const interval=Math.max(5,Number(d.interval)||5),expiresAt=Date.now()+Number(d.expires_in||600)*1000;
 db.prepare('INSERT INTO bot_device_grants(admin_id,device_secret,expires_at,interval_seconds,next_poll,verification_uri,user_code) VALUES(?,?,?,?,?,?,?) ON CONFLICT(admin_id) DO UPDATE SET device_secret=excluded.device_secret,expires_at=excluded.expires_at,interval_seconds=excluded.interval_seconds,next_poll=excluded.next_poll,verification_uri=excluded.verification_uri,user_code=excluded.user_code').run(req.session.uid,enc(d.device_code),expiresAt,interval,0,d.verification_uri,d.user_code);
 res.json({verification_uri:d.verification_uri,user_code:d.user_code,expires_at:expiresAt,interval_seconds:interval});
}));
app.post('/api/admin/bot/device/check',withUser,requireAdmin,csrf,safe(async(req,res)=>{
 const row=db.prepare('SELECT * FROM bot_device_grants WHERE admin_id=?').get(req.session.uid);
 if(!row)return res.status(404).json({error:'No device authorization in progress'});
 if(row.expires_at<Date.now()){db.prepare('DELETE FROM bot_device_grants WHERE admin_id=?').run(req.session.uid);return res.json({status:'expired'})}
 if(row.next_poll>Date.now())return res.json({status:'pending',retry_after:Math.ceil((row.next_poll-Date.now())/1000)});
 db.prepare('UPDATE bot_device_grants SET next_poll=? WHERE admin_id=?').run(Date.now()+row.interval_seconds*1000,req.session.uid);
 const response=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:CID,client_secret:SECRET,device_code:dec(row.device_secret),grant_type:'urn:ietf:params:oauth:grant-type:device_code'})});
 const body=await response.json();
 if(!response.ok){
 const status=body.message||body.error||'';
 if(/authorization_pending|slow_down/i.test(status))return res.json({status:'pending',retry_after:row.interval_seconds});
 if(/expired|invalid device code|access_denied/i.test(status)){db.prepare('DELETE FROM bot_device_grants WHERE admin_id=?').run(req.session.uid);return res.json({status:'expired'})}
 throw Error('Twitch device authorization failed: '+String(status).slice(0,140));
 }
 db.prepare('DELETE FROM bot_device_grants WHERE admin_id=?').run(req.session.uid);
 const bot=await storeBotToken(body,req.session.uid);
 res.json({status:'connected',bot});
}));
app.get('/api/admin/bot/status',withUser,requireAdmin,(req,res)=>{
 const id=botId(),b=getAccount(id);
 res.json({admins_configured:adminIds.size,bot:b?{id:b.id,login:b.login,scopes:JSON.parse(b.scopes||'[]')}:null,connected:Boolean(b)});
});
app.get('/api/state',withUser,(req,res)=>{const ch=db.prepare('SELECT * FROM channels WHERE id=?').get(req.channelId);res.json({channel:ch,role:access.role(req.session.uid,req.channelId),isOperator:isOperator(req.session.uid),bot:(()=>{const b=getAccount(botId());return b?{id:b.id,login:b.login}:null})(),commands:db.prepare('SELECT * FROM commands WHERE channel=? ORDER BY name').all(req.channelId),logs:db.prepare('SELECT * FROM logs WHERE channel=? ORDER BY id DESC LIMIT 30').all(req.channelId)})});
app.post('/api/settings',withUser,access.channelOnly('bot_supervisor'),csrf,(req,res)=>{if(req.body.enabled===true&&!botId())return res.status(409).json({error:'Shared bot is not connected yet'});db.prepare('UPDATE channels SET enabled=?,links=? WHERE id=?').run(req.body.enabled===true?1:0,req.body.links===true?1:0,req.channelId);connectChat();res.json({ok:true})});
app.post('/api/channel/disconnect',withUser,access.channelOnly('owner'),csrf,(req,res)=>{const id=req.channelId;db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(id);db.prepare('DELETE FROM accounts WHERE id=? AND id != ?').run(id,botId()||'');connectChat();req.session.destroy(()=>res.json({ok:true}))});
app.post('/api/commands',withUser,access.channelOnly('editor'),csrf,(req,res)=>{const name=String(req.body.name||'').toLowerCase().replace(/^!/,'');const response=String(req.body.response||'');if(!/^[a-z0-9_]{1,32}$/.test(name)||['clip','ban','timeout','uptime','points','top','addquote','quote','counter'].includes(name)||!response||response.length>450||!['everyone','subscriber','moderator'].includes(req.body.level))return res.status(400).json({error:'Invalid command'});db.prepare('INSERT INTO commands(channel,name,response,cooldown,level) VALUES(?,?,?,?,?) ON CONFLICT(channel,name) DO UPDATE SET response=excluded.response,cooldown=excluded.cooldown,level=excluded.level').run(req.channelId,name,response,Math.max(0,Math.min(3600,Number(req.body.cooldown)||0)),req.body.level);res.json({ok:true})});
app.delete('/api/commands/:name',withUser,access.channelOnly('editor'),csrf,(req,res)=>{db.prepare('DELETE FROM commands WHERE channel=? AND name=?').run(req.channelId,req.params.name);res.json({ok:true})});
app.post('/api/clip',withUser,access.channelOnly('bot_supervisor'),csrf,safe(async(req,res)=>{const c=await clip(req.channelId);res.json(c)}));
app.post('/api/moderate',withUser,access.channelOnly('bot_supervisor'),csrf,safe(async(req,res)=>{if(!['ban','timeout'].includes(req.body.action))throw Error('Invalid action');const uid=await lookup(String(req.body.user||''));const seconds=req.body.action==='timeout'?Math.max(1,Math.min(1209600,Number(req.body.seconds)||600)):null;await moderate(req.channelId,uid,seconds,'Dashboard moderation');log(req.channelId,req.body.action,req.body.user);res.json({ok:true})}));
const engagement=installEngagement({app,db,withUser,csrf,safe,say,moderate,log,api});
const creator=installCreator({app,db,withUser,csrf,safe,log,say});
installVoice({app,db,withUser,csrf,access,api,clip,log,say});
installPlatforms({app,db,withUser,csrf,access,enc,dec,log,base:BASE});
app.use(express.static('public'));app.listen(PORT,()=>console.log('KitsuFlowBOT on '+PORT));connectChat();
