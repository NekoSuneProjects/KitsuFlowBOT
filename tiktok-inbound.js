// Receive-only TikTok LIVE integration, gated on a live broadcaster ownership challenge.
// Unofficial TikTok public Webcast service: no user cookies or OAuth credentials are accepted.
import crypto from 'node:crypto';
import {TikTokLiveConnection,WebcastEvent,ControlEvent} from 'tiktok-live-connector';
export function installTikTokInbound({app,db,withUser,csrf,access,relay,log}){
 db.exec(`CREATE TABLE IF NOT EXISTS tiktok_inbound(channel TEXT PRIMARY KEY,username TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS tiktok_verification(channel TEXT PRIMARY KEY,username TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 0);`);
 const connections=new Map(),timers=new Map(),states=new Map(),generations=new Map();
 const normalize=s=>String(s||'').trim().replace(/^@/,'').toLowerCase();
 const valid=s=>/^[a-z0-9._]{2,32}$/.test(s);
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const current=(channel,gen)=>generations.get(channel)===gen;
 function stop(channel){
  generations.set(channel,(generations.get(channel)||0)+1);
  if(timers.has(channel)){clearTimeout(timers.get(channel));timers.delete(channel)}
  const existing=connections.get(channel);
  if(existing){connections.delete(channel);void existing.disconnect().catch(()=>{})}
  states.set(channel,{status:'stopped'});
 }
 function schedule(channel,ms){
  if(timers.has(channel))clearTimeout(timers.get(channel));
  const timer=setTimeout(()=>{timers.delete(channel);void start(channel)},ms);timer.unref?.();timers.set(channel,timer);
 }
 function verified(channel,username){
  return Boolean(db.prepare('SELECT 1 FROM tiktok_verification WHERE channel=? AND username=? AND verified=1').get(channel,username));
 }
 async function start(channel){
  stop(channel);
  const gen=generations.get(channel),cfg=db.prepare('SELECT * FROM tiktok_inbound WHERE channel=?').get(channel);
  if(!cfg?.enabled||!verified(channel,cfg.username))return;
  const connection=new TikTokLiveConnection(cfg.username,{processInitialData:false});
  states.set(channel,{status:'checking_live',username:cfg.username});
  try{
   const live=await connection.fetchIsLive();
   if(!current(channel,gen))return;
   if(!live){states.set(channel,{status:'offline',username:cfg.username});schedule(channel,60000);return}
   connections.set(channel,connection);
   connection.on(WebcastEvent.CHAT,event=>{
    if(!current(channel,gen)||connections.get(channel)!==connection)return;
    const username=String(event.user?.uniqueId||event.user?.displayId||'viewer').slice(0,40);
    const message=String(event.comment||event.content||'').trim().slice(0,350);
    if(message)void relay.relay(channel,'tiktok',username,message).catch(err=>log(channel,'tiktok-relay-error',err.message));
   });
   connection.on(ControlEvent.ERROR,info=>{
    if(!current(channel,gen))return;
    const detail=String(info?.exception?.message||info?.info||'TikTok connection error').slice(0,180);
    log(channel,'tiktok-error',detail);states.set(channel,{status:'error',username:cfg.username,detail});
   });
   connection.on(ControlEvent.DISCONNECTED,()=>{
    if(!current(channel,gen)||connections.get(channel)!==connection)return;
    connections.delete(channel);states.set(channel,{status:'disconnected',username:cfg.username});schedule(channel,60000);
   });
   await connection.connect();
   if(current(channel,gen)&&connections.get(channel)===connection)states.set(channel,{status:'connected',username:cfg.username});
   else void connection.disconnect().catch(()=>{});
  }catch(error){
   if(!current(channel,gen))return;
   connections.delete(channel);
   const detail=String(error.message||error).slice(0,180);
   states.set(channel,{status:'retrying',username:cfg.username,detail});
   log(channel,'tiktok-connect-error',detail);schedule(channel,60000);
  }
 }
 app.get('/api/tiktok-inbound',withUser,access.channelOnly('owner'),(req,res)=>{
  const cfg=db.prepare('SELECT username,enabled FROM tiktok_inbound WHERE channel=?').get(req.channelId);
  const v=db.prepare('SELECT username,expires,verified FROM tiktok_verification WHERE channel=?').get(req.channelId);
  res.set('Cache-Control','no-store').json({username:cfg?.username||'',enabled:Boolean(cfg?.enabled),verified:Boolean(v?.verified&&v.username===cfg?.username),verification_expires:v&&!v.verified?v.expires:null,status:states.get(req.channelId)||{status:'stopped'},receive_only:true});
 });
 app.post('/api/tiktok-inbound/verify/start',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const username=normalize(req.body?.username);
  if(!valid(username))return res.status(400).json({error:'Enter a valid TikTok username'});
  const claimed=db.prepare('SELECT channel FROM tiktok_verification WHERE username=? AND verified=1 AND channel<>?').get(username,req.channelId);
  if(claimed)return res.status(409).json({error:'This TikTok account is already verified by another KitsuFlowBOT channel'});
  const code='kitsu-'+crypto.randomBytes(12).toString('hex');
  const expires=Date.now()+10*60*1000;
  stop(req.channelId);
  db.prepare('INSERT INTO tiktok_verification(channel,username,code_hash,expires,verified) VALUES(?,?,?,?,0) ON CONFLICT(channel) DO UPDATE SET username=excluded.username,code_hash=excluded.code_hash,expires=excluded.expires,verified=0')
   .run(req.channelId,username,hash(code),expires);
  db.prepare('INSERT INTO tiktok_inbound(channel,username,enabled) VALUES(?,?,0) ON CONFLICT(channel) DO UPDATE SET username=excluded.username,enabled=0').run(req.channelId,username);
  res.set('Cache-Control','no-store').json({code,expires,step:'Go LIVE on TikTok, then post this exact code using the broadcaster account in your LIVE chat. Click Check verification within 10 minutes.'});
 });
 app.post('/api/tiktok-inbound/verify/check',withUser,access.channelOnly('owner'),csrf,async(req,res)=>{
  const channel=req.channelId;
  const v=db.prepare('SELECT * FROM tiktok_verification WHERE channel=?').get(channel);
  if(!v||v.verified||Date.now()>v.expires)return res.status(409).json({error:'Generate a fresh verification challenge'});
  if(connections.has(channel))return res.status(409).json({error:'Another TikTok operation is active'});
  const c=new TikTokLiveConnection(v.username,{processInitialData:false});
  try{
   const live=await c.fetchIsLive();
   if(!live)return res.status(409).json({error:'TikTok account is not currently live. Start a LIVE stream first.'});
   // Only accept a new LIVE chat comment from the exact claimed account during this short inspection window.
   const validated=await new Promise(async(resolve,reject)=>{
    let finished=false;
    const settle=ok=>{if(finished)return;finished=true;clearTimeout(timer);resolve(ok)};
    const timer=setTimeout(()=>settle(false),20000);
    c.on(WebcastEvent.CHAT,event=>{
     const uid=normalize(event.user?.uniqueId||event.user?.displayId);
     const message=String(event.comment||event.content||'').trim();
     if(uid===v.username&&hash(message)===v.code_hash)settle(true);
    });
    try{await c.connect()}catch(error){if(!finished){clearTimeout(timer);reject(error)}}
   });
   if(!validated)return res.status(408).json({error:'No matching message from the account owner was seen. Send the code in TikTok LIVE chat while checking.'});
   const conflict=db.prepare('SELECT channel FROM tiktok_verification WHERE username=? AND verified=1 AND channel<>?').get(v.username,channel);
   if(conflict)return res.status(409).json({error:'This TikTok username was verified elsewhere'});
   db.prepare('UPDATE tiktok_verification SET verified=1 WHERE channel=? AND username=? AND code_hash=? AND expires>?')
    .run(channel,v.username,v.code_hash,Date.now());
   res.json({verified:true,username:v.username});
  }catch(error){log(channel,'tiktok-verification-error',String(error.message||error));res.status(502).json({error:'TikTok LIVE verification unavailable: '+String(error.message||error).slice(0,110)})}
  finally{void c.disconnect().catch(()=>{})}
 });
 app.post('/api/tiktok-inbound',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const username=normalize(req.body?.username),enabled=req.body?.enabled;
  if(typeof enabled!=='boolean'||!valid(username))return res.status(400).json({error:'Enter a valid TikTok username'});
  if(enabled&&!verified(req.channelId,username))return res.status(403).json({error:'Verify ownership from your TikTok LIVE chat first'});
  db.prepare('INSERT INTO tiktok_inbound(channel,username,enabled) VALUES(?,?,?) ON CONFLICT(channel) DO UPDATE SET username=excluded.username,enabled=excluded.enabled').run(req.channelId,username,enabled?1:0);
  void start(req.channelId);res.json({ok:true,receive_only:true});
 });
 for(const row of db.prepare('SELECT channel FROM tiktok_inbound WHERE enabled=1').all())void start(row.channel);
 return {stop,status:channel=>states.get(channel)||{status:'stopped'}};
}
