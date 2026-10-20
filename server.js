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
import {installAccess} from './access.js';

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
const botAdmin=process.env.BOT_ADMIN_TWITCH_ID;
const isOperator=id=>Boolean(botAdmin&&id===botAdmin);
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
const app=express();app.set('trust proxy',process.env.TRUST_PROXY==='true'?1:false);app.use(express.json({limit:'32kb'}));
const Store=SQLiteStoreFactory(session);
app.use(session({store:new Store({db:'sessions.sqlite',dir:'data'}),name:'sn.sid',secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:BASE.startsWith('https:'),maxAge:86400000}}));
const withUser=(req,res,next)=>req.session.uid?next():res.status(401).json({error:'Login required'});
const csrf=(req,res,next)=>{if(req.get('origin')!==BASE)return res.status(403).json({error:'Origin mismatch'});next()};
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(e=>res.status(400).json({error:e.message}));
app.get('/auth/:role',safe(async(req,res)=>{const role=req.params.role;if(!['streamer','bot'].includes(role))throw Error('Invalid role');if(role==='bot'&&!isOperator(req.session.uid))return res.status(403).send('Only the KitsuFlowBOT operator can link the global bot account. Set BOT_ADMIN_TWITCH_ID.');
const state=crypto.randomBytes(24).toString('hex');req.session.oauth={state,role,owner:req.session.uid};
const scope=role==='bot'?'user:read:chat user:write:chat user:bot moderator:manage:banned_users':'channel:bot clips:edit';
const p=new URLSearchParams({client_id:CID,redirect_uri:BASE+'/auth/callback',response_type:'code',scope,state});res.redirect('https://id.twitch.tv/oauth2/authorize?'+p)}));
app.get('/auth/callback',safe(async(req,res)=>{const s=req.session.oauth;if(!s||req.query.state!==s.state||!req.query.code)throw Error('Invalid OAuth state');delete req.session.oauth;
const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:CID,client_secret:SECRET,code:String(req.query.code),grant_type:'authorization_code',redirect_uri:BASE+'/auth/callback'})});if(!r.ok)throw Error('OAuth exchange failed');const t=await r.json();
const who=await fetch('https://api.twitch.tv/helix/users',{headers:{'Client-Id':CID,Authorization:'Bearer '+t.access_token}});if(!who.ok)throw Error('User lookup failed');const u=(await who.json()).data[0];
db.prepare('INSERT INTO accounts(id,login,display,access,refresh,expires,scopes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,display=excluded.display,access=excluded.access,refresh=excluded.refresh,expires=excluded.expires,scopes=excluded.scopes').run(u.id,u.login,u.display_name,enc(t.access_token),enc(t.refresh_token),Date.now()+t.expires_in*1000,JSON.stringify(t.scope||[]));
if(s.role==='streamer'){req.session.uid=u.id;db.prepare('INSERT INTO channels(id,login) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login').run(u.id,u.login)}
else{if(!s.owner||s.owner!==req.session.uid||!isOperator(s.owner))throw Error('Only the KitsuFlowBOT operator may configure the shared bot');db.prepare("INSERT INTO config(key,value) VALUES('bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(u.id);connectChat()}
res.redirect('/')}));
app.post('/logout',csrf,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
const access=installAccess({app,db,withUser,csrf,safe,log});
// Existing studio endpoints resolve the selected channel, not the login identity.
app.use(['/api/state','/api/settings','/api/commands','/api/clip','/api/moderate','/api/engagement','/api/creator'],withUser,(req,res,next)=>{const channel=access.channelFor(req);if(!channel)return res.status(403).json({error:'No channel access'});if(req.method!=='GET'){const required=req.path.startsWith('/api/moderate')||req.path.startsWith('/api/settings')||req.path.startsWith('/api/clip')||req.path.startsWith('/api/creator/queue')||req.path.startsWith('/api/creator/campaign/draw')||req.path.startsWith('/api/creator/redeem')?'bot_supervisor':'editor';if(!access.can(req.session.uid,channel,required))return res.status(403).json({error:'Insufficient channel permissions'});}req.channelId=channel;next()});
app.get('/api/state',withUser,(req,res)=>{const ch=db.prepare('SELECT * FROM channels WHERE id=?').get(req.channelId);res.json({channel:ch,role:access.role(req.session.uid,req.channelId),isOperator:isOperator(req.channelId),bot:(()=>{const b=getAccount(botId());return b?{id:b.id,login:b.login}:null})(),commands:db.prepare('SELECT * FROM commands WHERE channel=? ORDER BY name').all(req.channelId),logs:db.prepare('SELECT * FROM logs WHERE channel=? ORDER BY id DESC LIMIT 30').all(req.channelId)})});
app.post('/api/settings',withUser,access.channelOnly('bot_supervisor'),csrf,(req,res)=>{if(req.body.enabled===true&&!botId())return res.status(409).json({error:'Shared bot is not connected yet'});db.prepare('UPDATE channels SET enabled=?,links=? WHERE id=?').run(req.body.enabled===true?1:0,req.body.links===true?1:0,req.channelId);connectChat();res.json({ok:true})});
app.post('/api/channel/disconnect',withUser,access.channelOnly('owner'),csrf,(req,res)=>{const id=req.channelId;db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(id);db.prepare('DELETE FROM accounts WHERE id=? AND id != ?').run(id,botId()||'');connectChat();req.session.destroy(()=>res.json({ok:true}))});
app.post('/api/commands',withUser,access.channelOnly('editor'),csrf,(req,res)=>{const name=String(req.body.name||'').toLowerCase().replace(/^!/,'');const response=String(req.body.response||'');if(!/^[a-z0-9_]{1,32}$/.test(name)||['clip','ban','timeout','uptime','points','top','addquote','quote','counter'].includes(name)||!response||response.length>450||!['everyone','subscriber','moderator'].includes(req.body.level))return res.status(400).json({error:'Invalid command'});db.prepare('INSERT INTO commands(channel,name,response,cooldown,level) VALUES(?,?,?,?,?) ON CONFLICT(channel,name) DO UPDATE SET response=excluded.response,cooldown=excluded.cooldown,level=excluded.level').run(req.channelId,name,response,Math.max(0,Math.min(3600,Number(req.body.cooldown)||0)),req.body.level);res.json({ok:true})});
app.delete('/api/commands/:name',withUser,access.channelOnly('editor'),csrf,(req,res)=>{db.prepare('DELETE FROM commands WHERE channel=? AND name=?').run(req.channelId,req.params.name);res.json({ok:true})});
app.post('/api/clip',withUser,access.channelOnly('bot_supervisor'),csrf,safe(async(req,res)=>{const c=await clip(req.channelId);res.json(c)}));
app.post('/api/moderate',withUser,access.channelOnly('bot_supervisor'),csrf,safe(async(req,res)=>{if(!['ban','timeout'].includes(req.body.action))throw Error('Invalid action');const uid=await lookup(String(req.body.user||''));const seconds=req.body.action==='timeout'?Math.max(1,Math.min(1209600,Number(req.body.seconds)||600)):null;await moderate(req.channelId,uid,seconds,'Dashboard moderation');log(req.channelId,req.body.action,req.body.user);res.json({ok:true})}));
const engagement=installEngagement({app,db,withUser,csrf,safe,say,moderate,log,api});
const creator=installCreator({app,db,withUser,csrf,safe,log,say});
app.use(express.static('public'));app.listen(PORT,()=>console.log('KitsuFlowBOT on '+PORT));connectChat();
