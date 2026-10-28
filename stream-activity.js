// Stream activity is separate from internal operational logs.
export function installStreamActivity({app,db,withUser,access}){
 db.exec(`CREATE TABLE IF NOT EXISTS stream_activity(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 channel TEXT NOT NULL,
 platform TEXT NOT NULL,
 event_type TEXT NOT NULL,
 actor TEXT NOT NULL DEFAULT '',
 detail TEXT NOT NULL DEFAULT '',
 event_key TEXT UNIQUE,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE INDEX IF NOT EXISTS stream_activity_channel_idx ON stream_activity(channel,id DESC);`);
 db.exec(`CREATE TABLE IF NOT EXISTS stream_announcement_settings(
 channel TEXT NOT NULL,platform TEXT NOT NULL,event_type TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,
 template TEXT NOT NULL DEFAULT '',PRIMARY KEY(channel,platform,event_type));`);
 const defaults={follow:'Thanks for following, {user}!',subscription:'Thanks for subscribing, {user}!',subscription_gift:'Thanks for gifting subscriptions, {user}!',cheer:'Thanks for the Bits, {user}!',kicks:'Thanks for the Kicks, {user}!',raid:'Welcome raiders from {user}!'};
 const platforms=['twitch','kick','vpzone'];
 const allowed={twitch:['follow','subscription','subscription_gift','cheer','raid'],kick:['follow','subscription','subscription_gift','kicks'],vpzone:['follow','subscription','raid']};
 const senders=new Map();
 let activityListener=null;
 const setOnEvent=fn=>{activityListener=typeof fn==='function'?fn:null};
 const setSender=(platform,fn)=>{if(platforms.includes(platform)&&typeof fn==='function')senders.set(platform,fn)};
 const rows=channel=>platforms.flatMap(platform=>allowed[platform].map(event_type=>{
  const row=db.prepare('SELECT enabled,template FROM stream_announcement_settings WHERE channel=? AND platform=? AND event_type=?').get(channel,platform,event_type);
  return {platform,event_type,enabled:Boolean(row?.enabled),template:row?.template||defaults[event_type]};
 }));
 app.get('/api/stream-announcements',withUser,access.channelOnly('editor'),(req,res)=>res.set('Cache-Control','no-store').json({settings:rows(req.channelId),capabilities:allowed}));
 app.post('/api/stream-announcements',withUser,access.channelOnly('owner'),(req,res)=>{
  // Enforce origin-based CSRF for session-authenticated writes; no generic cross-site toggle endpoint.
  const origin=req.get('origin'),host=req.get('host');
  if(!origin||new URL(origin).host!==host)return res.status(403).json({error:'Origin mismatch'});
  const {platform,event_type,enabled,template}=req.body||{};
  if(!allowed[platform]?.includes(event_type)||typeof enabled!=='boolean'||typeof template!=='string'||template.length>350||!template.trim())
   return res.status(400).json({error:'Invalid announcement settings'});
  db.prepare('INSERT INTO stream_announcement_settings(channel,platform,event_type,enabled,template) VALUES(?,?,?,?,?) ON CONFLICT(channel,platform,event_type) DO UPDATE SET enabled=excluded.enabled,template=excluded.template').run(req.channelId,platform,event_type,enabled?1:0,template);
  res.json({ok:true});
 });
 const types=new Set(['follow','subscription','subscription_gift','subscription_renewal','raid','cheer','kicks','donation','reward']);
 const normalize=(platform,event)=> {
  const v=String(event||'').toLowerCase();
  const mapping={
   twitch:{'channel.follow':'follow','channel.subscribe':'subscription','channel.subscription.message':'subscription_renewal','channel.subscription.gift':'subscription_gift','channel.raid':'raid','channel.cheer':'cheer','channel.channel_points_custom_reward_redemption.add':'reward'},
   kick:{'channel.followed':'follow','channel.subscription.new':'subscription','channel.subscription.renewal':'subscription_renewal','channel.subscription.gifts':'subscription_gift','channel.raid':'raid','kicks.gifted':'kicks'},
   vpzone:{'follow':'follow','follower':'follow','subscription':'subscription','subscribe':'subscription','resub':'subscription_renewal','subscription.renewal':'subscription_renewal','subscription_gift':'subscription_gift','subscription.gift':'subscription_gift','gift_subscription':'subscription_gift','raid':'raid','kicks':'kicks','donation':'donation'}
  };
  return mapping[platform]?.[v]|| (types.has(v)?v:null);
 };
 function emit(channel,platform,event,actor='',detail='',key=null){
  const kind=normalize(platform,event);if(!kind)return false;
  const id=String(channel||'');if(!id)return false;
  const outcome=db.prepare('INSERT OR IGNORE INTO stream_activity(channel,platform,event_type,actor,detail,event_key) VALUES(?,?,?,?,?,?)')
   .run(id,platform,kind,String(actor||'').slice(0,100),String(detail||'').slice(0,300),key?platform+':'+String(key).slice(0,200):null);
  if(outcome.changes&&activityListener){try{activityListener(id,platform,kind,actor,detail)}catch(err){console.error('Subathon activity hook failed:',err.message)}}
  const announceKind=kind==='subscription_renewal'?'subscription':kind;
  if(outcome.changes&&allowed[platform]?.includes(announceKind)){
   const row=db.prepare('SELECT enabled,template FROM stream_announcement_settings WHERE channel=? AND platform=? AND event_type=?').get(id,platform,announceKind);
   const sender=senders.get(platform);
   if(row?.enabled&&sender){
    const cleanUser=String(actor||'viewer').replace(/[\\r\\n]/g,' ').slice(0,80);
    const cleanDetail=String(detail||'').replace(/[\\r\\n]/g,' ').slice(0,90);
    const content=(row.template||defaults[announceKind]).replaceAll('{user}',cleanUser).replaceAll('{detail}',cleanDetail).slice(0,450);
    Promise.resolve().then(()=>sender(id,content)).catch(err=>console.error('Local '+platform+' announcement failed:',String(err.message||err)));
   }
  }
  return true;
 }
 app.get('/api/stream-activity',withUser,access.channelOnly('editor'),(req,res)=>{
  res.set('Cache-Control','no-store').json(db.prepare('SELECT platform,event_type,actor,detail,created FROM stream_activity WHERE channel=? ORDER BY id DESC LIMIT 100').all(req.channelId));
 });
 return {emit,setSender,setOnEvent};
}
