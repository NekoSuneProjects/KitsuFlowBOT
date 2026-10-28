// Standalone Stream Boss with per-channel health, configurable activity damage and OBS access.
import crypto from 'node:crypto';
export function installStreamBoss({app,db,withUser,csrf,access,log}){
 db.exec(`CREATE TABLE IF NOT EXISTS stream_boss(
 channel TEXT PRIMARY KEY,public_key TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 0,
 name TEXT NOT NULL DEFAULT 'Stream Boss',hp INTEGER NOT NULL DEFAULT 5000,max_hp INTEGER NOT NULL DEFAULT 5000,
 step_hp INTEGER NOT NULL DEFAULT 1000,wins INTEGER NOT NULL DEFAULT 0,
 accent TEXT NOT NULL DEFAULT '#ad73f7',background TEXT NOT NULL DEFAULT '#17151e',
 text_color TEXT NOT NULL DEFAULT '#ffffff',transparent INTEGER NOT NULL DEFAULT 0,
 title TEXT NOT NULL DEFAULT 'STREAM BOSS',show_animation INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS stream_boss_rules(
 channel TEXT NOT NULL,platform TEXT NOT NULL,event_type TEXT NOT NULL,
 damage INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 0,per_unit INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(channel,platform,event_type));
 CREATE TABLE IF NOT EXISTS stream_boss_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,actor TEXT NOT NULL,platform TEXT NOT NULL,
 event_type TEXT NOT NULL,damage INTEGER NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const capabilities={twitch:['subscription','subscription_renewal','subscription_gift','cheer','follow','raid'],kick:['subscription','subscription_renewal','subscription_gift','kicks','follow'],vpzone:['subscription','subscription_renewal','subscription_gift','donation','follow','raid'],streamelements:['donation'],streamlabs:['donation'],tipeeestream:['donation','membership'],kofi:['donation','membership'],patreon:['membership']};
 const defaults={subscription:500,subscription_renewal:500,subscription_gift:500,cheer:1,kicks:1,donation:1};
 const row=channel=>db.prepare('SELECT * FROM stream_boss WHERE channel=?').get(channel);
 const ensure=channel=>{if(!row(channel))db.prepare('INSERT OR IGNORE INTO stream_boss(channel,public_key) VALUES(?,?)').run(channel,crypto.randomBytes(24).toString('hex'))};
 function snapshot(channel,privateData=false){
  ensure(channel);const s=row(channel);
  return {enabled:Boolean(s.enabled),name:s.name,hp:s.hp,max_hp:s.max_hp,step_hp:s.step_hp,wins:s.wins,title:s.title,accent:s.accent,background:s.background,text_color:s.text_color,transparent:Boolean(s.transparent),show_animation:Boolean(s.show_animation),...(privateData?{public_key:s.public_key,capabilities,rules:db.prepare('SELECT platform,event_type,damage,enabled,per_unit FROM stream_boss_rules WHERE channel=?').all(channel),history:db.prepare('SELECT actor,platform,event_type,damage,created FROM stream_boss_history WHERE channel=? ORDER BY id DESC LIMIT 25').all(channel)}:{})};
 }
 function hit(channel,damage,actor,platform,event_type){
  ensure(channel);const s=row(channel);if(!s.enabled)return snapshot(channel);
  let hp=s.hp-damage,wins=s.wins,nextMax=s.max_hp;
  // The person delivering the final hit becomes the new boss.
  if(hp<=0){wins++;nextMax=Math.min(1000000000,s.max_hp+s.step_hp);hp=nextMax;
   db.prepare('UPDATE stream_boss SET name=?,wins=?,max_hp=?,hp=? WHERE channel=?').run(String(actor||'New Boss').slice(0,75),wins,nextMax,hp,channel);
  }else db.prepare('UPDATE stream_boss SET hp=? WHERE channel=?').run(hp,channel);
  db.prepare('INSERT INTO stream_boss_history(channel,actor,platform,event_type,damage) VALUES(?,?,?,?,?)').run(channel,String(actor||'viewer').slice(0,75),platform,event_type,damage);
  return snapshot(channel);
 }
 function unitCount(event,detail){
  if(!['cheer','kicks','subscription_gift','donation'].includes(event))return 1;
  const match=String(detail||'').replace(/,/g,'').match(/(?:^|\D)(\d{1,7})(?:\D|$)/);
  return Math.max(1,Math.min(10000,Number(match?.[1]||1)));
 }
 function onActivity(channel,platform,event,actor,detail){
  if(!capabilities[platform]?.includes(event))return;
  const rule=db.prepare('SELECT enabled,damage,per_unit FROM stream_boss_rules WHERE channel=? AND platform=? AND event_type=?').get(channel,platform,event);
  if(!rule?.enabled||!rule.damage)return;
  const amount=Math.min(1000000000,rule.damage*(rule.per_unit?unitCount(event,detail):1));
  hit(channel,amount,actor,platform,event);log(channel,'stream-boss-damage',platform+'/'+event+' -'+amount+' by '+String(actor).slice(0,50));
 }
 app.get('/api/stream-boss',withUser,access.channelOnly('editor'),(req,res)=>res.set('Cache-Control','no-store').json(snapshot(req.channelId,true)));
 app.post('/api/stream-boss/settings',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const b=req.body||{};ensure(req.channelId);
  if(typeof b.enabled!=='boolean'||typeof b.transparent!=='boolean'||typeof b.show_animation!=='boolean'||
   ![b.accent,b.background,b.text_color].every(v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v))||
   typeof b.name!=='string'||!b.name.trim()||b.name.length>75||typeof b.title!=='string'||!b.title.trim()||b.title.length>75||
   !Number.isSafeInteger(b.max_hp)||b.max_hp<1||b.max_hp>1000000000||!Number.isSafeInteger(b.step_hp)||b.step_hp<0||b.step_hp>100000000)
    return res.status(400).json({error:'Invalid Stream Boss settings'});
  const s=row(req.channelId);
  db.prepare('UPDATE stream_boss SET enabled=?,name=?,title=?,max_hp=?,hp=?,step_hp=?,accent=?,background=?,text_color=?,transparent=?,show_animation=? WHERE channel=?')
   .run(b.enabled?1:0,b.name.trim(),b.title.trim(),b.max_hp,Math.min(s.hp,b.max_hp),b.step_hp,b.accent,b.background,b.text_color,b.transparent?1:0,b.show_animation?1:0,req.channelId);
  res.json(snapshot(req.channelId,true));
 });
 app.post('/api/stream-boss/rule',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const b=req.body||{};
  if(!capabilities[b.platform]?.includes(b.event_type)||typeof b.enabled!=='boolean'||typeof b.per_unit!=='boolean'||
    !Number.isSafeInteger(b.damage)||b.damage<0||b.damage>100000000)return res.status(400).json({error:'Invalid boss damage rule'});
  db.prepare('INSERT INTO stream_boss_rules(channel,platform,event_type,damage,enabled,per_unit) VALUES(?,?,?,?,?,?) ON CONFLICT(channel,platform,event_type) DO UPDATE SET damage=excluded.damage,enabled=excluded.enabled,per_unit=excluded.per_unit')
   .run(req.channelId,b.platform,b.event_type,b.damage,b.enabled?1:0,b.per_unit?1:0);
  res.json({ok:true});
 });
 app.post('/api/stream-boss/control',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const {action,amount}=req.body||{};ensure(req.channelId);const s=row(req.channelId);
  if(!['hit','heal','reset'].includes(action)||!Number.isSafeInteger(amount)||amount<0||amount>100000000)return res.status(400).json({error:'Invalid boss control'});
  if(action==='hit'){const out=hit(req.channelId,amount,'Streamer','manual','hit');log(req.channelId,'stream-boss-manual','hit '+amount);return res.json(out)}
  const hp=action==='reset'?s.max_hp:Math.min(s.max_hp,s.hp+amount);
  db.prepare('UPDATE stream_boss SET hp=? WHERE channel=?').run(hp,req.channelId);
  log(req.channelId,'stream-boss-manual',action+' '+amount);res.json(snapshot(req.channelId,true));
 });
 app.get('/api/stream-boss/public/:key',(req,res)=>{
  const record=db.prepare('SELECT channel FROM stream_boss WHERE public_key=?').get(String(req.params.key||''));
  if(!record)return res.sendStatus(404);
  res.set('Cache-Control','no-store').json(snapshot(record.channel));
 });
 app.get('/stream-boss/overlay/:key',(req,res)=>{
  if(!db.prepare('SELECT 1 FROM stream_boss WHERE public_key=?').get(String(req.params.key||'')))return res.sendStatus(404);
  res.set('Cache-Control','no-store').sendFile('stream-boss-overlay.html',{root:process.cwd()+'/public'});
 });
 return {onActivity};
}
