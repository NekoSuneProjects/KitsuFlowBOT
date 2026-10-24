// User-controlled cross-platform chat relay. Only enabled routes are posted.
export function installRelay({app,db,withUser,csrf,access,isOperator,log,observe}) {
 db.exec(`CREATE TABLE IF NOT EXISTS chat_relay_settings(channel TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(channel,source,target));
 CREATE TABLE IF NOT EXISTS chat_relay_events(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,sender TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const supported=new Set(['twitch','kick','vpzone']), senders=new Map(),recent=new Map();
 const register=(platform,fn)=>senders.set(platform,fn);
 const identityPrefix='[KitsuFlow relay ';
 async function relay(channel,source,username,content,{isBot=false}={}){
  if(!supported.has(source)||isBot)return;
  const clean=String(content||'').trim().slice(0,350),sender=String(username||'unknown').replace(/[^a-z0-9_-]/gi,'').slice(0,28);
  if(!clean||clean.startsWith(identityPrefix))return;
  if(observe)observe(channel,source,username,clean);
  const now=Date.now(),key=channel+':'+source+':'+sender+':'+clean;
  if((recent.get(key)||0)>now-12000)return;
  recent.set(key,now);if(recent.size>1000)for(const [k,v] of recent)if(v<now-60000)recent.delete(k);
  const routes=db.prepare('SELECT target FROM chat_relay_settings WHERE channel=? AND source=? AND enabled=1').all(channel,source);
  for(const {target} of routes){
   if(target===source||!senders.has(target))continue;
   const text=identityPrefix+source+'/'+sender+'] '+clean;
   try{await senders.get(target)(channel,text);db.prepare('INSERT INTO chat_relay_events(channel,source,target,sender,content,status) VALUES(?,?,?,?,?,?)').run(channel,source,target,sender,clean,'sent')}
   catch(err){log(channel,'relay-error',source+'->'+target+': '+err.message);db.prepare('INSERT INTO chat_relay_events(channel,source,target,sender,content,status) VALUES(?,?,?,?,?,?)').run(channel,source,target,sender,clean,'failed')}
  }
 }
 app.get('/api/relay',withUser,access.channelOnly('owner'),(req,res)=>{
  res.json({routes:db.prepare('SELECT source,target,enabled FROM chat_relay_settings WHERE channel=?').all(req.channelId),history:db.prepare('SELECT source,target,sender,content,status,created FROM chat_relay_events WHERE channel=? ORDER BY id DESC LIMIT 50').all(req.channelId)});
 });
 app.post('/api/relay',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const {source,target,enabled}=req.body||{};
  if(!supported.has(source)||!supported.has(target)||source===target||typeof enabled!=='boolean')return res.status(400).json({error:'Invalid relay route'});
  if(source!=='twitch'&&!db.prepare('SELECT 1 FROM platform_oauth WHERE channel=? AND platform=?').get(req.channelId,source))return res.status(409).json({error:'Source platform not linked'});
  if(target!=='twitch'&&!db.prepare('SELECT 1 FROM platform_oauth WHERE channel=? AND platform=?').get(req.channelId,target))return res.status(409).json({error:'Target platform not linked'});
  db.prepare('INSERT INTO chat_relay_settings(channel,source,target,enabled) VALUES(?,?,?,?) ON CONFLICT(channel,source,target) DO UPDATE SET enabled=excluded.enabled').run(req.channelId,source,target,enabled?1:0);
  log(req.channelId,'relay-config',source+' -> '+target+': '+enabled);res.json({ok:true});
 });
 return {register,relay};
}
