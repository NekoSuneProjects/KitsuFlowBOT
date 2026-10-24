import crypto from 'node:crypto';
export function installVoice({app,db,withUser,csrf,access,api,clip,log,say}) {
  db.exec(`CREATE TABLE IF NOT EXISTS voice_settings(channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,phrase TEXT NOT NULL DEFAULT 'clip it',cooldown INTEGER NOT NULL DEFAULT 45,last_clip INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS voice_events(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,phrase TEXT NOT NULL,clip_id TEXT,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  db.exec("CREATE TABLE IF NOT EXISTS voice_platform_settings(channel TEXT NOT NULL,platform TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,phrase TEXT NOT NULL DEFAULT 'clip it',cooldown INTEGER NOT NULL DEFAULT 60,last_trigger INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(channel,platform))");
  db.exec("CREATE TABLE IF NOT EXISTS voice_platform_triggers(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,platform TEXT NOT NULL,phrase TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const platformRow=(channel,platform)=>db.prepare('SELECT * FROM voice_platform_settings WHERE channel=? AND platform=?').get(channel,platform)||{channel,platform,enabled:0,phrase:'clip it',cooldown:60};
  app.get('/api/voice/platforms',withUser,access.channelOnly('editor'),(req,res)=>{
   res.json({settings:['kick','vpzone'].map(p=>platformRow(req.channelId,p)),history:db.prepare('SELECT platform,phrase,result,created FROM voice_platform_triggers WHERE channel=? ORDER BY id DESC LIMIT 30').all(req.channelId)});
  });
  app.post('/api/voice/platforms/:platform',withUser,access.channelOnly('bot_supervisor'),csrf,(req,res)=>{
   const p=req.params.platform,phrase=String(req.body.phrase||'').trim().toLowerCase(),cooldown=Number(req.body.cooldown);
   if(!['kick','vpzone'].includes(p))return res.sendStatus(404);
   if(!/^[a-z0-9 ]{3,60}$/.test(phrase)||!Number.isInteger(cooldown)||cooldown<20||cooldown>600)return res.status(400).json({error:'Invalid phrase or cooldown'});
   if(req.body.enabled===true&&!db.prepare('SELECT 1 FROM platform_oauth WHERE channel=? AND platform=?').get(req.channelId,p))return res.status(409).json({error:'Link '+p+' first'});
   if(req.body.enabled===true&&(!process.env.VOICE_WORKER_SECRET||process.env.VOICE_WORKER_SECRET.length<24))return res.status(409).json({error:'Voice worker is not configured'});
   db.prepare('INSERT INTO voice_platform_settings(channel,platform,enabled,phrase,cooldown) VALUES(?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET enabled=excluded.enabled,phrase=excluded.phrase,cooldown=excluded.cooldown').run(req.channelId,p,req.body.enabled===true?1:0,phrase,cooldown);
   res.json({ok:true});
  });
  const find=id=>db.prepare('SELECT * FROM voice_settings WHERE channel=?').get(id)||{channel:id,enabled:0,phrase:'clip it',cooldown:45,last_clip:0};
  const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y)};
  app.get('/api/voice',withUser,access.channelOnly('editor'),(req,res)=>{
    res.json({settings:find(req.channelId),events:db.prepare('SELECT phrase,clip_id,created FROM voice_events WHERE channel=? ORDER BY id DESC LIMIT 30').all(req.channelId),workerConfigured:Boolean(process.env.VOICE_WORKER_SECRET&&process.env.VOICE_WORKER_SECRET.length>=24)});
  });
  app.post('/api/voice',withUser,access.channelOnly('bot_supervisor'),csrf,(req,res)=>{
    const phrase=String(req.body.phrase||'').trim().toLowerCase();
    const cooldown=Number(req.body.cooldown);
    if(!/^[a-z0-9 ]{3,60}$/.test(phrase)||!Number.isInteger(cooldown)||cooldown<20||cooldown>600)return res.status(400).json({error:'Invalid phrase or cooldown (20–600 seconds)'});
    if(req.body.enabled===true&&!process.env.VOICE_WORKER_SECRET)return res.status(409).json({error:'Voice worker not configured'});
    db.prepare('INSERT INTO voice_settings(channel,enabled,phrase,cooldown) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,phrase=excluded.phrase,cooldown=excluded.cooldown').run(req.channelId,req.body.enabled===true?1:0,phrase,cooldown);
    log(req.channelId,'voice-config',req.body.enabled?'enabled':'disabled');res.json({ok:true});
  });
  const worker=(req,res,next)=>{if(!process.env.VOICE_WORKER_SECRET||!same(req.get('x-voice-worker-key'),process.env.VOICE_WORKER_SECRET))return res.sendStatus(401);next()};
  app.get('/internal/voice/channels',worker,async(req,res)=>{
    const candidates=db.prepare('SELECT c.id,c.login,v.phrase,v.cooldown FROM channels c JOIN voice_settings v ON v.channel=c.id WHERE c.enabled=1 AND v.enabled=1').all();
    const live=[];for(const c of candidates){try{const status=await api(c.id,'streams?user_id='+encodeURIComponent(c.id));if(status.data?.length)live.push({channel:c.id,login:c.login,phrase:c.phrase})}catch(err){log(c.id,'voice-check-error',err.message)}}
    for(const p of ['kick','vpzone']){
     const rows=db.prepare('SELECT p.channel,p.platform,p.phrase,a.display_name FROM voice_platform_settings p JOIN platform_oauth a ON a.channel=p.channel AND a.platform=p.platform WHERE p.enabled=1').all().filter(x=>x.platform===p);
     for(const row of rows){const slug=String(row.display_name||'');if(!/^[a-zA-Z0-9_-]{2,32}$/.test(slug))continue;
      // Do not claim a channel is live without a supported provider status check. Streamlink will
      // terminate immediately for unavailable live playback; no private source URLs are exposed.
      live.push({channel:row.channel,platform:p,login:slug,phrase:row.phrase,url:p==='kick'?'https://kick.com/'+slug:'https://vpzone.tv/'+slug});
     }
    }
    res.set('Cache-Control','no-store').json({channels:live});
  });
  app.post('/internal/voice/detected',worker,async(req,res)=>{
    const channel=String(req.body.channel||''),transcript=String(req.body.transcript||'').toLowerCase().trim().slice(0,250);
    const cfg=db.prepare('SELECT v.*,c.enabled AS channel_enabled FROM voice_settings v JOIN channels c ON c.id=v.channel WHERE v.channel=?').get(channel);
    if(!cfg||!cfg.enabled||!cfg.channel_enabled)return res.status(409).json({error:'Detection disabled'});
    const phrase=cfg.phrase.toLowerCase(),normalized=transcript.replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    if(!normalized.split(' ').join(' ').includes(phrase))return res.status(400).json({error:'Phrase not matched'});
    const now=Date.now();const updated=db.prepare('UPDATE voice_settings SET last_clip=? WHERE channel=? AND enabled=1 AND last_clip<=?').run(now,channel,now-cfg.cooldown*1000);
    if(!updated.changes)return res.status(429).json({error:'Clip cooldown'});
    try {
      const info=await api(channel,'streams?user_id='+encodeURIComponent(channel));
      if(!info.data?.length)return res.status(409).json({error:'Channel offline'});
      const result=await clip(channel);
      db.prepare('INSERT INTO voice_events(channel,phrase,clip_id) VALUES(?,?,?)').run(channel,phrase,result.id);
      log(channel,'voice-clip',result.id);
      try{await say(channel,'Voice clip created: https://clips.twitch.tv/'+result.id)}catch(err){log(channel,'voice-chat-error',err.message)}
      return res.json({ok:true,clip_id:result.id});
    }catch(err){log(channel,'voice-clip-error',err.message);return res.status(502).json({error:'Twitch clip creation failed'})}
  });  app.post('/internal/voice/platform/detected',worker,async(req,res)=>{
   const channel=String(req.body.channel||''),platform=String(req.body.platform||''),transcript=String(req.body.transcript||'').toLowerCase().slice(0,250);
   if(!['kick','vpzone'].includes(platform))return res.sendStatus(404);
   const cfg=db.prepare('SELECT * FROM voice_platform_settings WHERE channel=? AND platform=? AND enabled=1').get(channel,platform);
   if(!cfg||!db.prepare('SELECT 1 FROM platform_oauth WHERE channel=? AND platform=?').get(channel,platform))return res.status(409).json({error:'Voice detection not enabled for linked platform'});
   const normalized=transcript.replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
   if(!normalized.includes(cfg.phrase))return res.status(400).json({error:'Phrase does not match'});
   const now=Date.now(),updated=db.prepare('UPDATE voice_platform_settings SET last_trigger=? WHERE channel=? AND platform=? AND enabled=1 AND last_trigger<=?').run(now,channel,platform,now-cfg.cooldown*1000);
   if(!updated.changes)return res.status(429).json({error:'Cooldown'});
   // Neither official API currently documents a supported clip CREATE endpoint.
   const result='trigger_detected_native_clips_api_unavailable';
   db.prepare('INSERT INTO voice_platform_triggers(channel,platform,phrase,result) VALUES(?,?,?,?)').run(channel,platform,cfg.phrase,result);
   log(channel,platform+'-voice-trigger',cfg.phrase);
   res.json({ok:true,status:result});
  });

}
