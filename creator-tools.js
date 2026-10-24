import crypto from 'node:crypto';
import {isIP} from 'node:net';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const allowedHost=raw=>{
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname||isIP(u.hostname)||u.hostname==='localhost'||u.hostname.endsWith('.local'))throw Error('Use a public HTTPS OpenAI-compatible endpoint');
 return u.toString().replace(/\/$/,'');
};
export function installCreatorTools({app,db,withUser,csrf,access,enc,dec}){
 db.exec(`CREATE TABLE IF NOT EXISTS creator_ai_settings(channel TEXT PRIMARY KEY,endpoint TEXT NOT NULL,model TEXT NOT NULL,key_encrypted TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS multichat_sources(channel TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,tts_enabled INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS multichat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,platform TEXT NOT NULL,sender TEXT NOT NULL,content TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS multichat_channel_idx ON multichat_messages(channel,id DESC);
 CREATE TABLE IF NOT EXISTS stream_overlay_metadata(channel TEXT NOT NULL,platform TEXT NOT NULL,title TEXT NOT NULL,game TEXT NOT NULL,updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(channel,platform));`);
 const owner=[withUser,access.channelOnly('owner'),csrf];
 app.get('/api/creator-ai',withUser,access.channelOnly('owner'),(req,res)=>{
  const row=db.prepare('SELECT endpoint,model,key_encrypted FROM creator_ai_settings WHERE channel=?').get(req.channelId);
  res.set('Cache-Control','no-store').json({endpoint:row?.endpoint||'',model:row?.model||'',hasKey:Boolean(row?.key_encrypted)});
 });
 app.post('/api/creator-ai',...owner,(req,res)=>{
  try{
   const endpoint=allowedHost(String(req.body?.endpoint||'')),model=String(req.body?.model||'').trim(),key=String(req.body?.apiKey||'');
   if(!model||model.length>100||key.length>500)return res.status(400).json({error:'Invalid model or key'});
   const before=db.prepare('SELECT key_encrypted FROM creator_ai_settings WHERE channel=?').get(req.channelId);
   if(!key&&!before?.key_encrypted)return res.status(400).json({error:'Add an API key'});
   db.prepare('INSERT INTO creator_ai_settings(channel,endpoint,model,key_encrypted) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET endpoint=excluded.endpoint,model=excluded.model,key_encrypted=excluded.key_encrypted')
    .run(req.channelId,endpoint,model,key?enc(key):before.key_encrypted);
   res.json({ok:true});
  }catch(e){res.status(400).json({error:String(e.message)})}
 });
 app.post('/api/creator-ai/suggest',...owner,async(req,res)=>{
  const row=db.prepare('SELECT * FROM creator_ai_settings WHERE channel=?').get(req.channelId);
  if(!row)return res.status(409).json({error:'Configure the assistant endpoint first'});
  const game=String(req.body?.game||'').trim().slice(0,90),context=String(req.body?.context||'').trim().slice(0,200);
  if(!game)return res.status(400).json({error:'Enter the game/category first'});
  try{
   const url=allowedHost(row.endpoint);
   const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+dec(row.key_encrypted),'Content-Type':'application/json'},body:JSON.stringify({model:row.model,temperature:0.7,max_tokens:120,messages:[{role:'system',content:'Return only one catchy, discoverable live stream title, plain text, at most 110 characters. Mention the actual supplied game, avoid misleading claims, giveaways or hashtags spam, profanity and platform-policy violations. Never claim something untrue. No quotation marks.'},{role:'user',content:'Game: '+game+'\nExtra context: '+context}]}),signal:AbortSignal.timeout(18000)});
   if(!response.ok)return res.status(502).json({error:'AI provider HTTP '+response.status});
   const payload=await response.json();
   const title=String(payload.choices?.[0]?.message?.content||'').trim().replace(/^[\"']|[\"']$/g,'').replace(/[\r\n]+/g,' ').slice(0,110);
   if(!title)return res.status(502).json({error:'AI provider did not return a title'});
   res.set('Cache-Control','no-store').json({title});
  }catch(e){res.status(502).json({error:'Title suggestion failed: '+String(e.message).slice(0,130)})}
 });
 app.get('/api/multichat/settings',withUser,access.channelOnly('owner'),(req,res)=>{
  const r=db.prepare('SELECT tts_enabled FROM multichat_sources WHERE channel=?').get(req.channelId);
  res.set('Cache-Control','no-store').json({configured:Boolean(r),tts_enabled:Boolean(r?.tts_enabled)});
 });
 app.post('/api/multichat/source',...owner,(req,res)=>{
  const secret=crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO multichat_sources(channel,secret_hash,tts_enabled) VALUES(?,?,0) ON CONFLICT(channel) DO UPDATE SET secret_hash=excluded.secret_hash').run(req.channelId,hash(secret));
  res.set('Cache-Control','no-store').json({url:'/multichat/'+secret,game_url:'/obs/game/'+secret,activity_url:'/obs/activity/'+secret,warning:'Copy now. Regenerating invalidates your old OBS browser URL.'});
 });
 app.post('/api/multichat/settings',...owner,(req,res)=>{
  if(typeof req.body?.tts_enabled!=='boolean')return res.status(400).json({error:'Invalid TTS option'});
  db.prepare('UPDATE multichat_sources SET tts_enabled=? WHERE channel=?').run(req.body.tts_enabled?1:0,req.channelId);
  res.json({ok:true});
 });
 const source=(req,res,next)=>{
  const key=String(req.params.key||'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(key))return res.sendStatus(404);
  const row=db.prepare('SELECT channel,tts_enabled FROM multichat_sources WHERE secret_hash=?').get(hash(key));
  if(!row)return res.sendStatus(404);req.source=row;next();
 };
 app.get('/multichat/:key',source,(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; frame-ancestors *"});
  res.sendFile('multichat.html',{root:'public'});
 });
 app.get('/obs/game/:key',source,(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  res.sendFile('obs-game.html',{root:'public'});
 });
 app.get('/obs/activity/:key',source,(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  res.sendFile('obs-activity.html',{root:'public'});
 });
 app.get('/api/obs/game/:key',source,(req,res)=>{
  res.set('Cache-Control','no-store').json({platforms:db.prepare('SELECT platform,title,game,updated FROM stream_overlay_metadata WHERE channel=? ORDER BY platform').all(req.source.channel)});
 });
 app.get('/api/obs/activity/:key',source,(req,res)=>{
  const after=Math.max(0,Math.min(2147483647,Number(req.query.after)||0));
  const messages=db.prepare('SELECT id,platform,event_type,actor,detail,created FROM stream_activity WHERE channel=? AND id>? ORDER BY id ASC LIMIT 60').all(req.source.channel,after);
  res.set('Cache-Control','no-store').json({events:messages});
 });
 app.get('/api/obs/activity',withUser,access.channelOnly('editor'),(req,res)=>{
  const after=Math.max(0,Math.min(2147483647,Number(req.query.after)||0));
  res.set('Cache-Control','no-store').json({events:db.prepare('SELECT id,platform,event_type,actor,detail,created FROM stream_activity WHERE channel=? AND id>? ORDER BY id ASC LIMIT 100').all(req.channelId,after)});
 });
 app.get('/api/multichat/feed/:key',source,(req,res)=>{
  const after=Math.max(0,Number(req.query.after)||0);
  const messages=db.prepare('SELECT id,platform,sender,content,created FROM multichat_messages WHERE channel=? AND id>? ORDER BY id ASC LIMIT 60').all(req.source.channel,after);
  res.set('Cache-Control','no-store').json({messages,tts_enabled:Boolean(req.source.tts_enabled)});
 });
 function observe(channel,platform,sender,content){
  if(!['twitch','kick','vpzone'].includes(platform))return;
  const msg=String(content||'').trim().slice(0,350);
  if(!msg)return;
  db.prepare('INSERT INTO multichat_messages(channel,platform,sender,content) VALUES(?,?,?,?)').run(channel,platform,String(sender||'Viewer').slice(0,80),msg);
  db.prepare('DELETE FROM multichat_messages WHERE channel=? AND id<(SELECT COALESCE(MAX(id),0)-500 FROM multichat_messages WHERE channel=?)').run(channel,channel);
 }
 return {observe};
}
