import {displayName} from './global-commands-extra.js';
// Chat !clip command. Mirrors the voice clip flow (voice.js): per-channel settings,
// atomic cooldown claim, live check, Twitch clip, history row, link posted to chat.
const LEVELS=['everyone','subscriber','vip','moderator'];
const DEFAULTS={enabled:1,level:'everyone',cooldown:60,last_clip:0};

export function installChatClip({app,db,withUser,csrf,access,api,clip,log,say}){
 db.exec(`CREATE TABLE IF NOT EXISTS chat_clip_settings(channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,level TEXT NOT NULL DEFAULT 'everyone',cooldown INTEGER NOT NULL DEFAULT 60,last_clip INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS chat_clip_events(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,user_login TEXT NOT NULL,status TEXT NOT NULL,clip_id TEXT,detail TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS chat_clip_events_channel ON chat_clip_events(channel,id DESC);`);
 const find=channel=>db.prepare('SELECT * FROM chat_clip_settings WHERE channel=?').get(channel)||{channel,...DEFAULTS};
 const record=(channel,user,status,clipId=null,detail='')=>db.prepare('INSERT INTO chat_clip_events(channel,user_login,status,clip_id,detail) VALUES(?,?,?,?,?)').run(channel,user,status,clipId,String(detail).slice(0,250));
 const badge=(e,...sets)=>Boolean(e.badges?.some(b=>sets.includes(b.set_id)));
 const permitted=(level,e)=>{
  if(badge(e,'broadcaster','moderator'))return true;
  if(level==='everyone')return true;
  if(level==='vip')return badge(e,'vip');
  if(level==='subscriber')return badge(e,'subscriber','founder','vip');
  return false;
 };
 // Claim the cooldown slot atomically so two viewers typing !clip together only create one clip.
 const claim=(channel,cfg,now)=>{
  db.prepare('INSERT OR IGNORE INTO chat_clip_settings(channel,enabled,level,cooldown,last_clip) VALUES(?,?,?,?,0)').run(channel,cfg.enabled,cfg.level,cfg.cooldown);
  return db.prepare('UPDATE chat_clip_settings SET last_clip=? WHERE channel=? AND last_clip<=?').run(now,channel,now-cfg.cooldown*1000).changes>0;
 };
 const notices=new Map();
 const release=(channel,now)=>db.prepare('UPDATE chat_clip_settings SET last_clip=0 WHERE channel=? AND last_clip=?').run(channel,now);

 async function onCommand(ch,e){
  const cfg=find(ch.id),who=displayName(e);
  if(!cfg.enabled)return;
  if(!permitted(cfg.level,e))return;
  const now=Date.now();
  if(!claim(ch.id,cfg,now)){
   const left=Math.ceil((cfg.last_clip+cfg.cooldown*1000-now)/1000);
   if(left>0&&(notices.get(ch.id)||0)<now-10000){notices.set(ch.id,now);await say(ch.id,'@'+who+' a clip was just made — try again in '+left+'s.').catch(()=>{})}
   return;
  }
  try{
   const info=await api(ch.id,'streams?user_id='+encodeURIComponent(ch.id));
   if(!info.data?.length){release(ch.id,now);record(ch.id,who,'offline');await say(ch.id,'@'+who+' can\'t clip — the stream is offline.');return}
   const result=await clip(ch.id);
   const id=String(result.id||'');
   record(ch.id,who,'created',id);
   log(ch.id,'chat-clip',who+' '+id);
   try{await say(ch.id,'🎬 '+who+' clipped it! https://clips.twitch.tv/'+id)}catch(err){log(ch.id,'chat-clip-chat-error',err.message)}
  }catch(err){
   release(ch.id,now);
   record(ch.id,who,'failed',null,err.message);
   log(ch.id,'clip-error',err.message);
   await say(ch.id,'Clip failed. Make sure clipping is enabled on the channel and the shared bot has clips:edit.').catch(()=>{});
  }
 }

 app.get('/api/clip/settings',withUser,access.channelOnly('editor'),(req,res)=>{
  const s=find(req.channelId);
  res.set('Cache-Control','no-store').json({settings:{enabled:Boolean(s.enabled),level:s.level,cooldown:s.cooldown},levels:LEVELS,
   events:db.prepare('SELECT user_login,status,clip_id,detail,created FROM chat_clip_events WHERE channel=? ORDER BY id DESC LIMIT 30').all(req.channelId)});
 });
 app.post('/api/clip/settings',withUser,access.channelOnly('bot_supervisor'),csrf,(req,res)=>{
  const {enabled,level}=req.body||{},cooldown=Number(req.body?.cooldown);
  if(typeof enabled!=='boolean'||!LEVELS.includes(level)||!Number.isInteger(cooldown)||cooldown<10||cooldown>600)return res.status(400).json({error:'Invalid clip settings (cooldown 10–600 seconds)'});
  db.prepare('INSERT INTO chat_clip_settings(channel,enabled,level,cooldown) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,level=excluded.level,cooldown=excluded.cooldown').run(req.channelId,enabled?1:0,level,cooldown);
  log(req.channelId,'chat-clip-config',(enabled?'enabled ':'disabled ')+level+' '+cooldown+'s');
  res.json({ok:true});
 });
 return {onCommand};
}
