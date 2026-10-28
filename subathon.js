// Persistent per-channel subathon. Events are accepted only from the deduplicated activity feed.
import crypto from 'node:crypto';
export function installSubathon({app,db,withUser,csrf,access,log}){
 db.exec(`CREATE TABLE IF NOT EXISTS subathon_state(
 channel TEXT PRIMARY KEY,public_key TEXT NOT NULL UNIQUE,running INTEGER NOT NULL DEFAULT 0,
 remaining_ms INTEGER NOT NULL DEFAULT 0,updated_ms INTEGER NOT NULL DEFAULT 0,
 max_ms INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT 'SUBATHON',
 accent TEXT NOT NULL DEFAULT '#b975f7',text_color TEXT NOT NULL DEFAULT '#ffffff',
 background TEXT NOT NULL DEFAULT '#1e1430',transparent INTEGER NOT NULL DEFAULT 0,
 font TEXT NOT NULL DEFAULT 'Inter',show_events INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS subathon_rules(
 channel TEXT NOT NULL,platform TEXT NOT NULL,event_type TEXT NOT NULL,
 seconds INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 0,
 per_unit INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(channel,platform,event_type));
 CREATE TABLE IF NOT EXISTS subathon_history(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,
 platform TEXT NOT NULL,event_type TEXT NOT NULL,actor TEXT NOT NULL DEFAULT '',
 seconds INTEGER NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const definitions={twitch:['follow','subscription','subscription_renewal','subscription_gift','cheer','raid'],kick:['follow','subscription','subscription_renewal','subscription_gift','kicks'],vpzone:['follow','subscription','subscription_gift','donation','raid']};
 const defaults={subscription:60,subscription_renewal:60,subscription_gift:60,cheer:60,kicks:60};
 const get=channel=>db.prepare('SELECT * FROM subathon_state WHERE channel=?').get(channel);
 function ensure(channel){
  if(!get(channel))db.prepare('INSERT OR IGNORE INTO subathon_state(channel,public_key,updated_ms) VALUES(?,?,?)').run(channel,crypto.randomBytes(24).toString('hex'),Date.now());
 }
 function remainder(s){
  if(!s)return 0;
  return Math.max(0,s.remaining_ms-(s.running?Math.max(0,Date.now()-s.updated_ms):0));
 }
 function snapshot(channel,includePrivate=false){
  ensure(channel);const s=get(channel),remaining_ms=remainder(s);
  return {running:Boolean(s.running&&remaining_ms>0),remaining_ms,max_ms:s.max_ms,title:s.title,accent:s.accent,text_color:s.text_color,background:s.background,transparent:Boolean(s.transparent),font:s.font,show_events:Boolean(s.show_events),...(includePrivate?{public_key:s.public_key,history:db.prepare('SELECT platform,event_type,actor,seconds,created FROM subathon_history WHERE channel=? ORDER BY id DESC LIMIT 25').all(channel)}:{})};
 }
 function commitTime(channel,delta=0,mode=null){
  ensure(channel);const s=get(channel),now=Date.now(),base=remainder(s);
  const max=s.max_ms>0?s.max_ms:365*24*3600000;
  const next=Math.min(max,Math.max(0,base+delta));
  const running=mode===null?Boolean(s.running&&next>0):Boolean(mode&&next>0);
  db.prepare('UPDATE subathon_state SET remaining_ms=?,updated_ms=?,running=? WHERE channel=?').run(next,now,running?1:0,channel);
  return snapshot(channel,true);
 }
 function amount(platform,event,detail){
  const raw=String(detail||'');
  const value=Number(raw.replace(/,/g,'').match(/(?:^|\b)(\d{1,8})(?:\b|$)/)?.[1]||1);
  if(event==='cheer'||event==='kicks')return Math.max(1,Math.min(100000,value));
  if(event==='subscription_gift')return Math.max(1,Math.min(1000,value));
  return 1;
 }
 function onActivity(channel,platform,event,actor,detail){
  if(!definitions[platform]?.includes(event))return;
  const row=db.prepare('SELECT seconds,enabled,per_unit FROM subathon_rules WHERE channel=? AND platform=? AND event_type=?').get(channel,platform,event);
  if(!row?.enabled||!row.seconds)return;
  ensure(channel);
  const unit=row.per_unit?amount(platform,event,detail):1;
  const seconds=Math.min(86400,unit*row.seconds);
  if(seconds<=0)return;
  commitTime(channel,seconds*1000);
  db.prepare('INSERT INTO subathon_history(channel,platform,event_type,actor,seconds) VALUES(?,?,?,?,?)').run(channel,platform,event,String(actor||'').slice(0,80),seconds);
  log(channel,'subathon-event',platform+'/'+event+' +'+seconds+'s');
 }
 app.get('/api/subathon',withUser,access.channelOnly('editor'),(req,res)=>{
  res.set('Cache-Control','no-store').json({...snapshot(req.channelId,true),rules:db.prepare('SELECT platform,event_type,seconds,enabled,per_unit FROM subathon_rules WHERE channel=?').all(req.channelId),capabilities:definitions});
 });
 app.post('/api/subathon/control',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const {action,seconds}=req.body||{};
  if(!['start','pause','reset','add','remove','set'].includes(action))return res.status(400).json({error:'Invalid action'});
  if(['add','remove','set','reset'].includes(action)&&(!Number.isSafeInteger(seconds)||seconds<0||seconds>31536000))return res.status(400).json({error:'Seconds must be between 0 and 31536000'});
  const base=action==='add'?seconds*1000:action==='remove'?-seconds*1000:action==='set'||action==='reset'?-remainder(get(req.channelId))+(action==='set'?seconds*1000:seconds*1000):0;
  const result=commitTime(req.channelId,base,action==='start'?true:action==='pause'?false:null);
  log(req.channelId,'subathon-control',action+' '+(seconds||0));res.json(result);
 });
 app.post('/api/subathon/settings',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const b=req.body||{},s=String(b.title||'').trim();
  if(!s||s.length>75||!['Inter','Arial','Verdana','Georgia','monospace'].includes(b.font)||!Number.isSafeInteger(b.max_hours)||b.max_hours<0||b.max_hours>8760||
   ![b.accent,b.text_color,b.background].every(v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v))||typeof b.transparent!=='boolean'||typeof b.show_events!=='boolean')
    return res.status(400).json({error:'Invalid overlay settings'});
  ensure(req.channelId);
  db.prepare('UPDATE subathon_state SET title=?,accent=?,text_color=?,background=?,transparent=?,show_events=?,font=?,max_ms=? WHERE channel=?')
    .run(s,b.accent,b.text_color,b.background,b.transparent?1:0,b.show_events?1:0,b.font,b.max_hours*3600000,req.channelId);
  res.json(snapshot(req.channelId,true));
 });
 app.post('/api/subathon/rule',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const {platform,event_type,enabled,seconds,per_unit}=req.body||{};
  if(!definitions[platform]?.includes(event_type)||typeof enabled!=='boolean'||typeof per_unit!=='boolean'||!Number.isSafeInteger(seconds)||seconds<0||seconds>86400)
   return res.status(400).json({error:'Invalid time reward'});
  db.prepare('INSERT INTO subathon_rules(channel,platform,event_type,seconds,enabled,per_unit) VALUES(?,?,?,?,?,?) ON CONFLICT(channel,platform,event_type) DO UPDATE SET seconds=excluded.seconds,enabled=excluded.enabled,per_unit=excluded.per_unit')
    .run(req.channelId,platform,event_type,seconds,enabled?1:0,per_unit?1:0);res.json({ok:true});
 });
 app.get('/api/subathon/public/:key',(req,res)=>{
  const row=db.prepare('SELECT channel FROM subathon_state WHERE public_key=?').get(String(req.params.key||''));
  if(!row)return res.sendStatus(404);
  res.set('Cache-Control','no-store').json(snapshot(row.channel));
 });
 app.get('/subathon/overlay/:key',(req,res)=>{
  const row=db.prepare('SELECT 1 FROM subathon_state WHERE public_key=?').get(String(req.params.key||''));
  if(!row)return res.sendStatus(404);
  res.set('Cache-Control','no-store').sendFile('subathon-overlay.html',{root:process.cwd()+'/public'});
 });
 return {onActivity};
}
