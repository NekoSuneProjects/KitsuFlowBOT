// Opt-in OBS event alerts using the existing deduplicated activity feed.
import crypto from 'node:crypto';
export function installStreamAlerts({app,db,withUser,csrf,access}){
 db.exec(`CREATE TABLE IF NOT EXISTS stream_alert_settings(
 channel TEXT PRIMARY KEY,public_key TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL DEFAULT 'STREAM ALERTS',accent TEXT NOT NULL DEFAULT '#a879f7',
 background TEXT NOT NULL DEFAULT '#1a1430',text_color TEXT NOT NULL DEFAULT '#ffffff',
 transparent INTEGER NOT NULL DEFAULT 0,duration_ms INTEGER NOT NULL DEFAULT 6500,
 show_amount INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS stream_alert_rules(
 channel TEXT NOT NULL,platform TEXT NOT NULL,event_type TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(channel,platform,event_type));`);
 const types={twitch:['follow','subscription','subscription_renewal','subscription_gift','cheer','raid'],
 kick:['follow','subscription','subscription_renewal','subscription_gift','kicks','raid'],
 vpzone:['follow','subscription','subscription_renewal','subscription_gift','donation','raid'],
 streamelements:['donation'],streamlabs:['donation'],tipeeestream:['donation','membership'],
 kofi:['donation','membership','purchase'],patreon:['membership','membership_update','membership_end']};
 const ensure=channel=>db.prepare('INSERT OR IGNORE INTO stream_alert_settings(channel,public_key) VALUES(?,?)').run(channel,crypto.randomBytes(24).toString('hex'));
 const get=channel=>{ensure(channel);return db.prepare('SELECT * FROM stream_alert_settings WHERE channel=?').get(channel)};
 function settings(channel,privateData=false){const s=get(channel);
  return {title:s.title,accent:s.accent,background:s.background,text_color:s.text_color,transparent:Boolean(s.transparent),duration_ms:s.duration_ms,show_amount:Boolean(s.show_amount),...(privateData?{public_key:s.public_key,capabilities:types,rules:db.prepare('SELECT platform,event_type,enabled FROM stream_alert_rules WHERE channel=?').all(channel)}:{})};
 }
 app.get('/api/stream-alerts',withUser,access.channelOnly('editor'),(req,res)=>res.set('Cache-Control','no-store').json(settings(req.channelId,true)));
 app.post('/api/stream-alerts/settings',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const b=req.body||{};
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>70||![b.accent,b.background,b.text_color].every(v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v))||
   typeof b.transparent!=='boolean'||typeof b.show_amount!=='boolean'||!Number.isInteger(b.duration_ms)||b.duration_ms<1500||b.duration_ms>30000)return res.status(400).json({error:'Invalid alert settings'});
  ensure(req.channelId);db.prepare('UPDATE stream_alert_settings SET title=?,accent=?,background=?,text_color=?,transparent=?,duration_ms=?,show_amount=? WHERE channel=?')
   .run(b.title.trim(),b.accent,b.background,b.text_color,b.transparent?1:0,b.duration_ms,b.show_amount?1:0,req.channelId);
  res.json(settings(req.channelId,true));
 });
 app.post('/api/stream-alerts/rule',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const {platform,event_type,enabled}=req.body||{};
  if(!types[platform]?.includes(event_type)||typeof enabled!=='boolean')return res.status(400).json({error:'Invalid alert rule'});
  db.prepare('INSERT INTO stream_alert_rules(channel,platform,event_type,enabled) VALUES(?,?,?,?) ON CONFLICT(channel,platform,event_type) DO UPDATE SET enabled=excluded.enabled').run(req.channelId,platform,event_type,enabled?1:0);
  res.json({ok:true});
 });
 app.get('/api/stream-alerts/public/:key',(req,res)=>{
  const s=db.prepare('SELECT channel FROM stream_alert_settings WHERE public_key=?').get(String(req.params.key||''));
  if(!s)return res.sendStatus(404);
  const after=Math.max(0,Number.parseInt(String(req.query.after||'0'),10)||0);
  const latest=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM stream_activity WHERE channel=?').get(s.channel)?.id||0;
  const rows=db.prepare(`SELECT a.id,a.platform,a.event_type,a.actor,a.detail,a.created FROM stream_activity a
   JOIN stream_alert_rules r ON r.channel=a.channel AND r.platform=a.platform AND r.event_type=a.event_type AND r.enabled=1
   WHERE a.channel=? AND a.id>? ORDER BY a.id ASC LIMIT 30`).all(s.channel,after);
  res.set('Cache-Control','no-store').json({...settings(s.channel),latest,events:rows});
 });
 app.get('/stream-alerts/overlay/:key',(req,res)=>{
  if(!db.prepare('SELECT 1 FROM stream_alert_settings WHERE public_key=?').get(String(req.params.key||'')))return res.sendStatus(404);
  res.set('Cache-Control','no-store').sendFile('stream-alerts-overlay.html',{root:process.cwd()+'/public'});
 });
}
