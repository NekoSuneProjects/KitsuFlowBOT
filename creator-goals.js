// Channel-scoped, event-driven goals. All incoming activity is already deduplicated by stream-activity.
export function installCreatorGoals({app,db,withUser,csrf,access}){
 db.exec(`CREATE TABLE IF NOT EXISTS creator_goals(
 id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,title TEXT NOT NULL,
 platform TEXT NOT NULL,event_type TEXT NOT NULL,target REAL NOT NULL,
 progress REAL NOT NULL DEFAULT 0,unit TEXT NOT NULL DEFAULT 'events',
 status TEXT NOT NULL DEFAULT 'active',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed TEXT, CHECK(status IN ('active','completed','paused')));
 CREATE INDEX IF NOT EXISTS creator_goals_channel ON creator_goals(channel,status,id);
 CREATE TABLE IF NOT EXISTS creator_goal_progress(
 goal_id INTEGER NOT NULL,activity_id TEXT NOT NULL,PRIMARY KEY(goal_id,activity_id));`);
 const capability={twitch:['follow','subscription','subscription_renewal','subscription_gift','cheer','raid'],kick:['follow','subscription','subscription_renewal','subscription_gift','kicks','raid'],vpzone:['follow','subscription','subscription_renewal','subscription_gift','donation','raid'],streamelements:['donation'],streamlabs:['donation'],tipeeestream:['donation','membership'],kofi:['donation','membership','purchase'],patreon:['membership','membership_update']};
 const validUnits=['events','amount'];
 const list=channel=>db.prepare('SELECT * FROM creator_goals WHERE channel=? ORDER BY CASE status WHEN \'active\' THEN 0 WHEN \'paused\' THEN 1 ELSE 2 END,id DESC').all(channel);
 function onActivity(channel,platform,event,actor,detail,activityId){
  const rows=db.prepare("SELECT * FROM creator_goals WHERE channel=? AND platform=? AND event_type=? AND status='active'").all(channel,platform,event);
  for(const goal of rows){
   if(activityId!=null){const inserted=db.prepare('INSERT OR IGNORE INTO creator_goal_progress(goal_id,activity_id) VALUES(?,?)').run(goal.id,String(activityId)).changes;if(!inserted)continue}
   // Amounts are raw provider units (Bits, Kicks or reported donation currency). Never convert currencies.
   const raw=String(detail||'').replace(/,/g,'');
   const numeric=Number(raw.match(/(?:^|\s)(\d+(?:\.\d+)?)/)?.[1]);
   const amount=goal.unit==='amount'?Number.isFinite(numeric)?numeric:0:1;
   if(amount<=0)continue;
   const progress=Math.min(goal.target,goal.progress+amount);
   db.prepare("UPDATE creator_goals SET progress=?,status=CASE WHEN ?>=target THEN 'completed' ELSE 'active' END,completed=CASE WHEN ?>=target THEN CURRENT_TIMESTAMP ELSE completed END WHERE id=? AND status='active'").run(progress,progress,progress,goal.id);
  }
 }
 app.get('/api/creator-goals',withUser,access.channelOnly('editor'),(req,res)=>{
  const goals=list(req.channelId);
  res.set('Cache-Control','no-store').json({goals,capabilities:capability,summary:{active:goals.filter(g=>g.status==='active').length,completed:goals.filter(g=>g.status==='completed').length}});
 });
 app.post('/api/creator-goals',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const b=req.body||{};
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>90||
   !capability[b.platform]?.includes(b.event_type)||!validUnits.includes(b.unit)||
   !Number.isFinite(b.target)||b.target<=0||b.target>1000000000||
   (b.unit==='amount'&&!['cheer','kicks','donation'].includes(b.event_type)))
   return res.status(400).json({error:'Invalid goal configuration'});
  const id=db.prepare('INSERT INTO creator_goals(channel,title,platform,event_type,target,unit) VALUES(?,?,?,?,?,?)').run(req.channelId,b.title.trim(),b.platform,b.event_type,b.target,b.unit).lastInsertRowid;
  res.json({ok:true,id:Number(id)});
 });
 app.post('/api/creator-goals/:id',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const id=Number(req.params.id),b=req.body||{};
  const goal=Number.isSafeInteger(id)?db.prepare('SELECT * FROM creator_goals WHERE id=? AND channel=?').get(id,req.channelId):null;
  if(!goal)return res.sendStatus(404);
  if(b.action==='delete'){
   db.prepare('DELETE FROM creator_goal_progress WHERE goal_id=?').run(id);
   db.prepare('DELETE FROM creator_goals WHERE id=? AND channel=?').run(id,req.channelId);return res.json({ok:true});
  }
  if(b.action==='pause'||b.action==='resume'||b.action==='complete'||b.action==='reset'){
   const status=b.action==='pause'?'paused':b.action==='complete'?'completed':'active';
   const progress=b.action==='reset'?0:b.action==='complete'?goal.target:goal.progress;
   db.prepare('UPDATE creator_goals SET status=?,progress=?,completed=? WHERE id=? AND channel=?').run(status,progress,status==='completed'?new Date().toISOString():null,id,req.channelId);
   if(b.action==='reset')db.prepare('DELETE FROM creator_goal_progress WHERE goal_id=?').run(id);
   return res.json({ok:true});
  }
  return res.status(400).json({error:'Invalid action'});
 });
 return {onActivity};
}
