// Receive-only TikTok LIVE bridge. Public LIVE chat only; never attempts TikTok chat posting.
import {TikTokLiveConnection,WebcastEvent,ControlEvent} from 'tiktok-live-connector';
export function installTikTokInbound({app,db,withUser,csrf,access,relay,log}){
 db.exec("CREATE TABLE IF NOT EXISTS tiktok_inbound(channel TEXT PRIMARY KEY,username TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0)");
 const connections=new Map(),states=new Map(),timers=new Map();
 const validUsername=s=>/^[a-zA-Z0-9._]{2,32}$/.test(s);
 const stop=channel=>{
  if(timers.has(channel)){clearTimeout(timers.get(channel));timers.delete(channel)}
  const item=connections.get(channel);
  if(item){connections.delete(channel);void item.disconnect().catch(()=>{})}
  states.set(channel,{status:'stopped'});
 };
 const restart=(channel,delay=15000)=>{
  if(timers.has(channel))clearTimeout(timers.get(channel));
  const handle=setTimeout(()=>{timers.delete(channel);void start(channel)},delay);
  handle.unref?.();timers.set(channel,handle);
 };
 async function start(channel){
  stop(channel);
  const cfg=db.prepare('SELECT username,enabled FROM tiktok_inbound WHERE channel=?').get(channel);
  if(!cfg?.enabled)return;
  const connection=new TikTokLiveConnection(cfg.username);
  connections.set(channel,connection);
  states.set(channel,{status:'connecting',username:cfg.username});
  connection.on(WebcastEvent.CHAT,event=>{
   if(connections.get(channel)!==connection)return;
   const username=String(event.user?.displayId||'viewer').slice(0,40);
   const content=String(event.content||'').trim().slice(0,350);
   if(!content)return;
   void relay.relay(channel,'tiktok',username,content).catch(err=>log(channel,'tiktok-relay-error',err.message));
  });
  connection.on(ControlEvent.ERROR,info=>{
   const message=String(info?.exception?.message||info?.info||'TikTok connection error').slice(0,200);
   states.set(channel,{status:'error',username:cfg.username,detail:message});
   log(channel,'tiktok-error',message);
  });
  connection.on(ControlEvent.DISCONNECTED,()=>{
   if(connections.get(channel)!==connection)return;
   connections.delete(channel);
   states.set(channel,{status:'disconnected',username:cfg.username});
   restart(channel,20000);
  });
  try{
   await connection.connect();
   if(connections.get(channel)===connection)states.set(channel,{status:'connected',username:cfg.username});
  }catch(err){
   if(connections.get(channel)!==connection)return;
   connections.delete(channel);
   states.set(channel,{status:'retrying',username:cfg.username,detail:String(err.message||err).slice(0,200)});
   log(channel,'tiktok-connect-error',String(err.message||err));
   restart(channel,30000);
  }
 }
 app.get('/api/tiktok-inbound',withUser,access.channelOnly('owner'),(req,res)=>{
  const config=db.prepare('SELECT username,enabled FROM tiktok_inbound WHERE channel=?').get(req.channelId);
  res.set('Cache-Control','no-store').json({username:config?.username||'',enabled:Boolean(config?.enabled),status:states.get(req.channelId)||{status:'stopped'},receive_only:true});
 });
 app.post('/api/tiktok-inbound',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const username=String(req.body?.username||'').trim().replace(/^@/,'');
  const enabled=req.body?.enabled;
  if(typeof enabled!=='boolean'||(enabled&&!validUsername(username))||(username&&!validUsername(username)))return res.status(400).json({error:'Enter a valid TikTok username'});
  db.prepare('INSERT INTO tiktok_inbound(channel,username,enabled) VALUES(?,?,?) ON CONFLICT(channel) DO UPDATE SET username=excluded.username,enabled=excluded.enabled')
   .run(req.channelId,username,enabled?1:0);
  void start(req.channelId);
  res.json({ok:true,receive_only:true});
 });
 for(const row of db.prepare('SELECT channel FROM tiktok_inbound WHERE enabled=1').all())void start(row.channel);
 return {stop};
}
