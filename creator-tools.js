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
 for(const [column,definition] of [['tts_rate','REAL NOT NULL DEFAULT 1.08'],['tts_volume','REAL NOT NULL DEFAULT 1'],['tts_provider','TEXT NOT NULL DEFAULT \'browser\''],['tts_voice','TEXT NOT NULL DEFAULT \'\''],['tts_lang','TEXT NOT NULL DEFAULT \'en-GB\''],['tts_pitch','REAL NOT NULL DEFAULT 1'],['tts_max_length','INTEGER NOT NULL DEFAULT 300'],['tts_cooldown','INTEGER NOT NULL DEFAULT 15'],['tts_template','TEXT NOT NULL DEFAULT \'{username} says {message}\''],['tts_platforms','TEXT NOT NULL DEFAULT \'["twitch","kick","vpzone"]\'']]){
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
 // Bound upstream latency so a slow AI model cannot hold OBS/Studio requests open until the reverse proxy times out.
 app.post('/api/creator-ai/suggest',...owner,async(req,res)=>{
  res.set('Cache-Control','no-store');
  const active=envAi();
  if(!active.endpoint||!active.model)return res.status(409).json({error:'Configure AI_TITLE_API_URL and AI_TITLE_MODEL on the server'});
  const game=String(req.body?.game||'').trim().slice(0,90),context=String(req.body?.context||'').trim().slice(0,200);
  if(!game)return res.status(400).json({error:'Enter the game/category first'});
  const configured=Number(process.env.AI_TITLE_TIMEOUT_MS);
  const timeoutMs=Number.isFinite(configured)&&configured>0?Math.max(2000,Math.min(20000,configured)):12000;
  const controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(),timeoutMs);
  const started=Date.now();
  try{
   const url=new URL(active.endpoint);
   if(!['http:','https:'].includes(url.protocol))return res.status(500).json({error:'Invalid AI_TITLE_API_URL: expected an HTTP(S) chat completions endpoint'});
   const response=await fetch(url,{method:'POST',redirect:'error',headers:{...(active.key?{Authorization:'Bearer '+active.key}:{}),'Content-Type':'application/json'},body:JSON.stringify({model:active.model,temperature:0.7,max_tokens:120,messages:[{role:'system',content:'Return only one catchy, discoverable live stream title, plain text, at most 110 characters. Mention the supplied game, avoid misleading claims, giveaways, hashtag spam, profanity and platform-policy violations. No quotation marks.'},{role:'user',content:'Game: '+game+'\\nExtra context: '+context}]}),signal:controller.signal});
   if(!response.ok){
    console.warn('[AI title] provider returned HTTP',response.status,'in',Date.now()-started,'ms');
    return res.status(502).json({error:'AI provider returned HTTP '+response.status+'. Check its endpoint, model, and credentials.'});
   }
   const payload=await response.json();
   const title=String(payload.choices?.[0]?.message?.content||'').trim().replace(/^[\\"']|[\\"']$/g,'').replace(/[\\r\\n]+/g,' ').slice(0,110);
   if(!title)return res.status(502).json({error:'AI provider returned no title. Check its OpenAI-compatible response format.'});
   return res.json({title});
  }catch(error){
   const timedOut=controller.signal.aborted||error.name==='TimeoutError'||error.name==='AbortError';
   console.warn('[AI title]',timedOut?'upstream timed out':'upstream request failed','after',Date.now()-started,'ms:',error.message);
   if(!res.headersSent)return res.status(timedOut?504:502).json({error:timedOut?'The AI title service took too long. Try a smaller/faster model, or check the AI server logs.':'Could not reach the AI title service. Check AI_TITLE_API_URL, networking and AI server logs.'});
  }finally{clearTimeout(deadline)}
 });
 app.get('/api/multichat/settings',withUser,access.channelOnly('owner'),(req,res)=>{
  const r=db.prepare('SELECT tts_enabled,tts_rate,tts_volume,tts_provider,tts_voice,tts_lang,tts_pitch,tts_max_length,tts_cooldown,tts_template,tts_platforms FROM multichat_sources WHERE channel=?').get(req.channelId);
  res.set('Cache-Control','no-store').json({configured:Boolean(r),tts_enabled:Boolean(r?.tts_enabled),tts_rate:r?.tts_rate??1.08,tts_volume:r?.tts_volume??1,tts_provider:r?.tts_provider||'browser',tts_voice:r?.tts_voice||'',tts_lang:r?.tts_lang||'en-GB',tts_pitch:r?.tts_pitch??1,tts_max_length:r?.tts_max_length??300,tts_cooldown:r?.tts_cooldown??15,tts_template:r?.tts_template||'{username} says {message}',tts_platforms:JSON.parse(r?.tts_platforms||'["twitch","kick","vpzone"]')});
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
  const provider=String(req.body.tts_provider||'browser');
  if(!['browser','kokoro'].includes(provider))return res.status(400).json({error:'Unsupported TTS provider'});
  if(provider==='kokoro'&&!process.env.KOKORO_TTS_URL)return res.status(409).json({error:'Configure KOKORO_TTS_URL first'});
  const pitch=Number(req.body.tts_pitch??1),maxLength=Number(req.body.tts_max_length??300),cooldown=Number(req.body.tts_cooldown??15);
  const voice=String(req.body.tts_voice||'').slice(0,160),lang=String(req.body.tts_lang||'en-GB').slice(0,30);
  const template=String(req.body.tts_template||'{username} says {message}').slice(0,220);
  const platforms=req.body.tts_platforms??['twitch','kick','vpzone'];
  if(!Number.isFinite(pitch)||pitch<0||pitch>2||!Number.isInteger(maxLength)||maxLength<20||maxLength>500||
     !Number.isInteger(cooldown)||cooldown<0||cooldown>600||!Array.isArray(platforms)||platforms.length>3||
     platforms.some(p=>!['twitch','kick','vpzone'].includes(p))||new Set(platforms).size!==platforms.length||
     !/^[a-zA-Z]{2,4}(?:-[a-zA-Z0-9]{2,8})*$/.test(lang))
   return res.status(400).json({error:'Invalid TTS voice, language or spam settings'});
  db.prepare('UPDATE multichat_sources SET tts_enabled=?,tts_rate=?,tts_volume=?,tts_provider=?,tts_voice=?,tts_lang=?,tts_pitch=?,tts_max_length=?,tts_cooldown=?,tts_template=?,tts_platforms=? WHERE channel=?')
   .run(req.body.tts_enabled?1:0,rate,volume,provider,voice,lang,pitch,maxLength,cooldown,template,JSON.stringify(platforms),req.channelId);
  res.json({ok:true});
 });
 const source=(req,res,next)=>{
  const key=String(req.params.key||'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(key))return res.sendStatus(404);
  const row=db.prepare('SELECT channel,tts_enabled,tts_rate,tts_volume,tts_voice,tts_lang,tts_pitch,tts_max_length,tts_cooldown,tts_template,tts_platforms FROM multichat_sources WHERE secret_hash=?').get(hash(key));
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
 const speechRateLimit=new Map();
 app.post('/api/multichat/tts/:key',source,async(req,res)=>{
  if(!req.source.tts_enabled||req.source.tts_provider!=='kokoro')return res.sendStatus(403);
  const configured=String(process.env.KOKORO_TTS_URL||'').trim();
  if(!configured)return res.status(503).json({error:'Kokoro TTS not configured'});
  const text=String(req.body?.text||'').trim().slice(0,500);
  if(!text)return res.sendStatus(400);
  const now=Date.now(),key=req.source.channel;
  const prior=speechRateLimit.get(key)||[];
  const recent=prior.filter(t=>now-t<60000);
  if(recent.length>=18)return res.status(429).json({error:'TTS rate limit exceeded'});
  recent.push(now);speechRateLimit.set(key,recent);
  if(speechRateLimit.size>1000)for(const [k,v] of speechRateLimit)if(v.every(t=>now-t>60000))speechRateLimit.delete(k);
  try{
   const url=new URL(configured);
   if(!['http:','https:'].includes(url.protocol))throw Error('Invalid configured Kokoro URL');
   const controller=AbortSignal.timeout(15000);
   const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({model:'kokoro',input:text,voice:req.source.tts_voice||'bf_emma',response_format:'mp3',speed:req.source.tts_rate}),signal:controller});
   if(!response.ok)return res.status(502).json({error:'TTS service returned HTTP '+response.status});
   const audio=Buffer.from(await response.arrayBuffer());
   if(audio.byteLength>3_000_000)return res.status(502).json({error:'TTS audio exceeded limit'});
   res.set({'Cache-Control':'no-store','Content-Type':'audio/mpeg','X-Content-Type-Options':'nosniff'}).send(audio);
  }catch(err){console.warn('[KitsuFlow TTS]',err.message);if(!res.headersSent)res.status(502).json({error:'Kokoro TTS unavailable'})}
 });
 app.get('/api/multichat/emotes/:key',source,async(req,res)=>{try{res.set('Cache-Control','private, max-age=600').json({emotes:await emoteCatalog(req.source.channel)})}catch(e){res.json({emotes:{}})}});
 app.get('/api/multichat/feed/:key',source,(req,res)=>{
  const after=Math.max(0,Number(req.query.after)||0);
  const messages=db.prepare('SELECT id,platform,sender,content,fragments,created FROM multichat_messages WHERE channel=? AND id>? ORDER BY id ASC LIMIT 60').all(req.source.channel,after);
  res.set('Cache-Control','no-store').json({messages,tts_enabled:Boolean(req.source.tts_enabled),tts_rate:req.source.tts_rate,tts_volume:req.source.tts_volume,tts_provider:req.source.tts_provider,tts_voice:req.source.tts_voice,tts_lang:req.source.tts_lang,tts_pitch:req.source.tts_pitch,tts_max_length:req.source.tts_max_length,tts_cooldown:req.source.tts_cooldown,tts_template:req.source.tts_template,tts_platforms:JSON.parse(req.source.tts_platforms||'[]'),connections:providerStatus(req.source.channel)});
 });
 function observe(channel,platform,sender,content,metadata={}){
  if(!['twitch','kick','vpzone','tiktok'].includes(platform))return;
  const msg=String(content||'').trim().slice(0,350);
  if(!msg)return;
  const fragments=Array.isArray(metadata.fragments)?metadata.fragments.slice(0,90).map(f=>({type:String(f.type||'text'),text:String(f.text||'').slice(0,350),id:String(f.emote?.id||f.emote?.emote_id||f.id||'').slice(0,80),url:String(f.url||'').slice(0,300)})):[];
  db.prepare('INSERT INTO multichat_messages(channel,platform,sender,content,fragments) VALUES(?,?,?,?,?)').run(channel,platform,String(sender||'Viewer').slice(0,80),msg,JSON.stringify(fragments));
  db.prepare('DELETE FROM multichat_messages WHERE channel=? AND id<(SELECT COALESCE(MAX(id),0)-500 FROM multichat_messages WHERE channel=?)').run(channel,channel);
 }
 return {observe,setProviderStatus};
}
