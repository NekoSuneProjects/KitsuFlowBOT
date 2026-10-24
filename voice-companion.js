import crypto from 'node:crypto';
// Device key is separate from Twitch/streamer OAuth credentials; never sent to the microphone client.
export function installVoiceCompanion({app,db,withUser,csrf,access,api,clip,log}){
 db.exec(`CREATE TABLE IF NOT EXISTS voice_companion_devices(
 id TEXT PRIMARY KEY,channel TEXT NOT NULL,label TEXT NOT NULL,secret_hash TEXT NOT NULL UNIQUE,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen TEXT,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS voice_companion_settings(
 channel TEXT PRIMARY KEY,phrase TEXT NOT NULL DEFAULT 'clip it',routing TEXT NOT NULL DEFAULT 'all',
 platforms TEXT NOT NULL DEFAULT '["twitch","kick","vpzone"]',cooldown INTEGER NOT NULL DEFAULT 45,last_trigger INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS voice_companion_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,device TEXT NOT NULL,
 platform TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',
 clip_id TEXT,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS companion_events_channel ON voice_companion_events(channel,id DESC);`);
 const h=value=>crypto.createHash('sha256').update(value).digest('hex');
 const settings=channel=>db.prepare('SELECT * FROM voice_companion_settings WHERE channel=?').get(channel)||{phrase:'clip it',routing:'all',platforms:'["twitch","kick","vpzone"]',cooldown:45,last_trigger:0};
 const view=channel=>({settings:(()=>{const s=settings(channel);return {phrase:s.phrase,routing:s.routing,platforms:JSON.parse(s.platforms),cooldown:s.cooldown}})(),
 devices:db.prepare('SELECT id,label,created,last_seen FROM voice_companion_devices WHERE channel=? AND revoked=0').all(channel),
 history:db.prepare('SELECT platform,status,detail,clip_id,created FROM voice_companion_events WHERE channel=? ORDER BY id DESC LIMIT 80').all(channel)});
 app.get('/api/voice-companion',withUser,access.channelOnly('owner'),(req,res)=>res.set('Cache-Control','no-store').json(view(req.channelId)));
 app.post('/api/voice-companion/settings',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const {phrase,routing,platforms,cooldown}=req.body||{};
  if(typeof phrase!=='string'||!/^[-a-z0-9 ]{3,50}$/.test(phrase.trim().toLowerCase())||!['all','first'].includes(routing)||
    !Array.isArray(platforms)||platforms.length<1||platforms.length>3||
    new Set(platforms).size!==platforms.length||platforms.some(p=>!['twitch','kick','vpzone'].includes(p))||
    !Number.isInteger(cooldown)||cooldown<20||cooldown>600)return res.status(400).json({error:'Invalid companion settings'});
  db.prepare('INSERT INTO voice_companion_settings(channel,phrase,routing,platforms,cooldown) VALUES(?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET phrase=excluded.phrase,routing=excluded.routing,platforms=excluded.platforms,cooldown=excluded.cooldown')
   .run(req.channelId,phrase.trim().toLowerCase(),routing,JSON.stringify(platforms),cooldown);
  res.json({ok:true});
 });
 app.post('/api/voice-companion/devices',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const label=String(req.body?.label||'My PC').trim().slice(0,60),id=crypto.randomUUID(),key='kfv_'+crypto.randomBytes(36).toString('base64url');
  if(!label)return res.status(400).json({error:'Device name required'});
  db.prepare('INSERT INTO voice_companion_devices(id,channel,label,secret_hash) VALUES(?,?,?,?)').run(id,req.channelId,label,h(key));
  res.set('Cache-Control','no-store').json({id,key,notice:'Save this key in your local PC companion. It is displayed only once.'});
 });
 app.post('/api/voice-companion/devices/:id/revoke',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  db.prepare('UPDATE voice_companion_devices SET revoked=1 WHERE id=? AND channel=?').run(req.params.id,req.channelId);
  res.json({ok:true});
 });
 const device=(req,res,next)=>{
  const header=req.get('Authorization')||'',key=header.startsWith('Bearer ')?header.slice(7):'';
  if(!/^kfv_[A-Za-z0-9_-]{48}$/.test(key))return res.status(401).json({error:'Device key required'});
  const record=db.prepare('SELECT id,channel FROM voice_companion_devices WHERE secret_hash=? AND revoked=0').get(h(key));
  if(!record)return res.status(401).json({error:'Unknown or revoked device'});
  req.companion=record;db.prepare('UPDATE voice_companion_devices SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(record.id);next();
 };
 app.get('/api/voice-companion/device/config',device,(req,res)=>{
  const s=settings(req.companion.channel);
  res.set('Cache-Control','no-store').json({phrase:s.phrase,routing:s.routing,platforms:JSON.parse(s.platforms),cooldown:s.cooldown});
 });
 app.post('/api/voice-companion/device/trigger',device,async(req,res)=>{
  const {channel,id}=req.companion;
  const s=settings(channel),phrase=String(req.body?.phrase||'').trim().toLowerCase();
  if(phrase!==s.phrase)return res.status(400).json({error:'Phrase does not match active configuration'});
  const now=Date.now();
  const up=db.prepare('UPDATE voice_companion_settings SET last_trigger=? WHERE channel=? AND last_trigger<=?').run(now,channel,now-s.cooldown*1000);
  if(!up.changes){
   if(!db.prepare('SELECT 1 FROM voice_companion_settings WHERE channel=?').get(channel))
    db.prepare('INSERT INTO voice_companion_settings(channel,last_trigger) VALUES(?,?)').run(channel,now);
   else return res.status(429).json({error:'Clip cooldown active'});
  }
  const results=[],selected=JSON.parse(s.platforms);
  const linked=platform=>platform==='twitch'||Boolean(db.prepare('SELECT 1 FROM platform_oauth WHERE channel=? AND platform=?').get(channel,platform));
  const record=(platform,status,detail,clipId=null)=>{
   db.prepare('INSERT INTO voice_companion_events(channel,device,platform,status,detail,clip_id) VALUES(?,?,?,?,?,?)').run(channel,id,platform,status,detail,clipId);
   results.push({platform,status,detail,clip_id:clipId});
  };
  for(const platform of selected){
   if(!linked(platform)){record(platform,'not_linked','Connect '+platform+' in your creator profile');continue}
   if(platform!=='twitch'){record(platform,'unsupported','No verified native create-clip API for '+platform);continue}
   try{
    const state=await api(channel,'streams?user_id='+encodeURIComponent(channel));
    if(!state.data?.length){record('twitch','offline','Twitch is not currently live');continue}
    const created=await clip(channel);
    record('twitch','created','Clip request accepted by Twitch',String(created.id||''));
    log(channel,'companion-clip',String(created.id||''));
   }catch(err){record('twitch','failed',String(err.message||err).slice(0,180))}
   if(s.routing==='first'&&results.some(x=>x.status==='created'))break;
  }
  res.set('Cache-Control','no-store').json({ok:true,results});
 });
}
