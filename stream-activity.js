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
 const types=new Set(['follow','subscription','subscription_gift','raid','cheer','kicks','donation','reward']);
 const normalize=(platform,event)=> {
  const v=String(event||'').toLowerCase();
  const mapping={
   twitch:{'channel.follow':'follow','channel.subscribe':'subscription','channel.subscription.message':'subscription','channel.subscription.gift':'subscription_gift','channel.raid':'raid','channel.cheer':'cheer','channel.channel_points_custom_reward_redemption.add':'reward'},
   kick:{'channel.followed':'follow','channel.subscription.new':'subscription','channel.subscription.renewal':'subscription','channel.subscription.gifts':'subscription_gift','channel.raid':'raid','kicks.gifted':'kicks'},
   vpzone:{'follow':'follow','follower':'follow','subscription':'subscription','subscribe':'subscription','raid':'raid','kicks':'kicks','donation':'donation'}
  };
  return mapping[platform]?.[v]|| (types.has(v)?v:null);
 };
 function emit(channel,platform,event,actor='',detail='',key=null){
  const kind=normalize(platform,event);if(!kind)return false;
  const id=String(channel||'');if(!id)return false;
  db.prepare('INSERT OR IGNORE INTO stream_activity(channel,platform,event_type,actor,detail,event_key) VALUES(?,?,?,?,?,?)')
   .run(id,platform,kind,String(actor||'').slice(0,100),String(detail||'').slice(0,300),key?platform+':'+String(key).slice(0,200):null);
  return true;
 }
 app.get('/api/stream-activity',withUser,access.channelOnly('editor'),(req,res)=>{
  res.set('Cache-Control','no-store').json(db.prepare('SELECT platform,event_type,actor,detail,created FROM stream_activity WHERE channel=? ORDER BY id DESC LIMIT 100').all(req.channelId));
 });
 return {emit};
}
