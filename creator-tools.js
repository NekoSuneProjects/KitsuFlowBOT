import crypto from 'node:crypto';
import {isIP} from 'node:net';
const envAi=()=>({endpoint:String(process.env.AI_TITLE_API_URL||'').trim(),model:String(process.env.AI_TITLE_MODEL||'').trim(),key:String(process.env.AI_TITLE_API_KEY||'').trim()});
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
 for(const [column,definition] of [['tts_rate','REAL NOT NULL DEFAULT 1.08'],['tts_volume','REAL NOT NULL DEFAULT 1']]){
  const columns=db.prepare('PRAGMA table_info(multichat_sources)').all().map(r=>r.name);
  if(!columns.includes(column))db.exec('ALTER TABLE multichat_sources ADD COLUMN '+column+' '+definition);
 }
 for(const [column,definition] of [['fragments','TEXT NOT NULL DEFAULT \'[]\'']]){const columns=db.prepare('PRAGMA table_info(multichat_messages)').all().map(x=>x.name);if(!columns.includes(column))db.exec('ALTER TABLE multichat_messages ADD COLUMN '+column+' '+definition);}
 const emoteCache=new Map();
 const emoteFetch=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(6500)});if(!response.ok)throw Error('Emote provider HTTP '+response.status);return response.json()};
 const emoteCatalog=async channel=>{
  const cache=emoteCache.get(channel);if(cache&&Date.now()-cache.time<900000)return cache.data;
  const user=db.prepare('SELECT login,id FROM channels WHERE id=?').get(channel)||{};
  const linked=db.prepare("SELECT external_id FROM platform_oauth WHERE channel=? AND platform='kick'").get(channel);
  const data={};const add=(name,url)=>{if(typeof name==='string'&&name.length<85&&/^https:\/\//.test(url))data[name]=url};
  const tasks=[
   emoteFetch('https://api.betterttv.net/3/cached/emotes/global').then(x=>x.forEach(v=>add(v.code,'https://cdn.betterttv.net/emote/'+v.id+'/2x'))),
   emoteFetch('https://api.frankerfacez.com/v1/set/global').then(x=>{for(const id of x.default_sets||[])for(const v of x.sets?.[id]?.emoticons||[])add(v.name,'https:'+String(v.urls?.['2']||v.urls?.['1']||'').replace(/^https:/,''))}),
   ...(user.id?[emoteFetch('https://api.betterttv.net/3/cached/users/twitch/'+encodeURIComponent(user.id)).then(x=>{for(const v of [...(x.channelEmotes||[]),...(x.sharedEmotes||[])])add(v.code,'https://cdn.betterttv.net/emote/'+v.id+'/2x')}),
   emoteFetch('https://api.frankerfacez.com/v1/room/id/'+encodeURIComponent(user.id)).then(x=>{for(const set of Object.values(x.sets||{}))for(const v of set.emoticons||[])add(v.name,'https:'+String(v.urls?.['2']||v.urls?.['1']||'').replace(/^https:/,''))}),
   emoteFetch('https://7tv.io/v3/users/twitch/'+encodeURIComponent(user.id)).then(x=>{for(const v of x.emote_set?.emotes||[]){const host=v.data?.host;if(!host?.url)continue;const file=host.files?.find(f=>f.name==='2x.webp')||host.files?.find(f=>f.name==='1x.webp');if(file)add(v.name,'https:'+String(host.url).replace(/^https:/,'')+'/'+file.name)}})]:[]),
   ...(linked?.external_id?[emoteFetch('https://api.betterttv.net/3/cached/users/kick/'+encodeURIComponent(linked.external_id)).then(x=>{for(const v of [...(x.channelEmotes||[]),...(x.sharedEmotes||[])])add(v.code,'https://cdn.betterttv.net/emote/'+v.id+'/2x')})]:[])
  ];
  await Promise.allSettled(tasks);
  emoteCache.set(channel,{time:Date.now(),data});return data;
 };
 const owner=[withUser,access.channelOnly('owner'),csrf];
 let providerStatus=()=>({});
 const setProviderStatus=fn=>{providerStatus=fn};
 app.post('/api/creator-ai/suggest',...owner,async(req,res)=>{
  const active=envAi();
  if(!active.endpoint||!active.model)return res.status(409).json({error:'Configure AI_TITLE_API_URL and AI_TITLE_MODEL on the server'});
  const game=String(req.body?.game||'').trim().slice(0,90),context=String(req.body?.context||'').trim().slice(0,200);
  if(!game)return res.status(400).json({error:'Enter the game/category first'});
  try{
   // Endpoint settings are administered only through server environment variables.
   const url=new URL(active.endpoint);
   if(!['http:','https:'].includes(url.protocol))throw Error('Invalid server AI URL scheme');
   const response=await fetch(url,{method:'POST',redirect:'error',headers:{...(active.key?{Authorization:'Bearer '+active.key}:{}),'Content-Type':'application/json'},body:JSON.stringify({model:active.model,temperature:0.7,max_tokens:120,messages:[{role:'system',content:'Return only one catchy, discoverable live stream title, plain text, at most 110 characters. Mention the actual supplied game, avoid misleading claims, giveaways or hashtags spam, profanity and platform-policy violations. Never claim something untrue. No quotation marks.'},{role:'user',content:'Game: '+game+'\nExtra context: '+context}]}),signal:AbortSignal.timeout(18000)});
   if(!response.ok)return res.status(502).json({error:'AI provider HTTP '+response.status});
   const payload=await response.json();
   const title=String(payload.choices?.[0]?.message?.content||'').trim().replace(/^[\"']|[\"']$/g,'').replace(/[\r\n]+/g,' ').slice(0,110);
   if(!title)return res.status(502).json({error:'AI provider did not return a title'});
   res.set('Cache-Control','no-store').json({title});
  }catch(e){res.status(502).json({error:'Title suggestion failed: '+String(e.message).slice(0,130)})}
 });
 app.get('/api/multichat/settings',withUser,access.channelOnly('owner'),(req,res)=>{
  const r=db.prepare('SELECT tts_enabled,tts_rate,tts_volume FROM multichat_sources WHERE channel=?').get(req.channelId);
  res.set('Cache-Control','no-store').json({configured:Boolean(r),tts_enabled:Boolean(r?.tts_enabled),tts_rate:r?.tts_rate??1.08,tts_volume:r?.tts_volume??1});
 });
 app.post('/api/multichat/source',...owner,(req,res)=>{
  const secret=crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO multichat_sources(channel,secret_hash,tts_enabled) VALUES(?,?,0) ON CONFLICT(channel) DO UPDATE SET secret_hash=excluded.secret_hash').run(req.channelId,hash(secret));
  res.set('Cache-Control','no-store').json({url:'/multichat/'+secret,game_url:'/obs/game/'+secret,activity_url:'/obs/activity/'+secret,warning:'Copy now. Regenerating invalidates your old OBS browser URL.'});
 });
 app.post('/api/multichat/settings',...owner,(req,res)=>{
  if(typeof req.body?.tts_enabled!=='boolean')return res.status(400).json({error:'Invalid TTS option'});
  const rate=Number(req.body.tts_rate??1.08),volume=Number(req.body.tts_volume??1);
  if(!Number.isFinite(rate)||rate<0.5||rate>2||!Number.isFinite(volume)||volume<0||volume>1)return res.status(400).json({error:'Invalid TTS rate or volume'});
  db.prepare('UPDATE multichat_sources SET tts_enabled=?,tts_rate=?,tts_volume=? WHERE channel=?').run(req.body.tts_enabled?1:0,rate,volume,req.channelId);
  res.json({ok:true});
 });
 const source=(req,res,next)=>{
  const key=String(req.params.key||'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(key))return res.sendStatus(404);
  const row=db.prepare('SELECT channel,tts_enabled,tts_rate,tts_volume FROM multichat_sources WHERE secret_hash=?').get(hash(key));
  if(!row)return res.sendStatus(404);req.source=row;next();
 };
 app.get('/multichat/:key',source,(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https://static-cdn.jtvnw.net https://cdn.betterttv.net https://cdn.frankerfacez.com https://*.7tv.app https://cdn.7tv.app https://*.7tv.io; object-src 'none'; frame-ancestors *"});
  res.sendFile('multichat.html',{root:'public'});
 });
 // OBS Custom Browser Dock: authenticated editing only. Overlay bearer URLs remain read-only.
 app.get('/obs/stream-control',withUser,access.channelOnly('owner'),(req,res)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.sendFile('obs-stream-control.html',{root:'public'});
 });
 app.get('/api/obs/stream-info',withUser,access.channelOnly('owner'),(req,res)=>{
  res.set('Cache-Control','no-store').json({platforms:db.prepare('SELECT platform,title,game,updated FROM stream_overlay_metadata WHERE channel=? ORDER BY platform').all(req.channelId)});
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
 app.get('/api/multichat/emotes/:key',source,async(req,res)=>{try{res.set('Cache-Control','private, max-age=600').json({emotes:await emoteCatalog(req.source.channel)})}catch(e){res.json({emotes:{}})}});
 app.get('/api/multichat/feed/:key',source,(req,res)=>{
  const after=Math.max(0,Number(req.query.after)||0);
  const messages=db.prepare('SELECT id,platform,sender,content,fragments,created FROM multichat_messages WHERE channel=? AND id>? ORDER BY id ASC LIMIT 60').all(req.source.channel,after);
  res.set('Cache-Control','no-store').json({messages,tts_enabled:Boolean(req.source.tts_enabled),tts_rate:req.source.tts_rate,tts_volume:req.source.tts_volume,connections:providerStatus(req.source.channel)});
 });
 function observe(channel,platform,sender,content,metadata={}){
  if(!['twitch','kick','vpzone'].includes(platform))return;
  const msg=String(content||'').trim().slice(0,350);
  if(!msg)return;
  const fragments=Array.isArray(metadata.fragments)?metadata.fragments.slice(0,90).map(f=>({type:String(f.type||'text'),text:String(f.text||'').slice(0,350),id:String(f.emote?.id||f.emote?.emote_id||f.id||'').slice(0,80),url:String(f.url||'').slice(0,300)})):[];
  db.prepare('INSERT INTO multichat_messages(channel,platform,sender,content,fragments) VALUES(?,?,?,?,?)').run(channel,platform,String(sender||'Viewer').slice(0,80),msg,JSON.stringify(fragments));
  db.prepare('DELETE FROM multichat_messages WHERE channel=? AND id<(SELECT COALESCE(MAX(id),0)-500 FROM multichat_messages WHERE channel=?)').run(channel,channel);
 }
 return {observe,setProviderStatus};
}
