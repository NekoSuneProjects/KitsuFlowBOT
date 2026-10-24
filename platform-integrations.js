import crypto from 'node:crypto';
const providers={
 kick:{auth:'https://id.kick.com/oauth/authorize',token:'https://id.kick.com/oauth/token',client:'KICK_CLIENT_ID',secret:'KICK_CLIENT_SECRET',scope:'user:read channel:read events:subscribe'},
 vpzone:{auth:'https://vpzone.tv/oauth/authorize',token:'https://vpzone.tv/api/oauth/token',client:'VPZONE_CLIENT_ID',secret:'VPZONE_CLIENT_SECRET',scope:'profile:read dashboard:read chat:read'}
};
const clean=s=>String(s??'').slice(0,250);
const pkce=()=>crypto.randomBytes(48).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('base64url');
export function installPlatforms({app,db,withUser,csrf,access,enc,dec,log,base}) {
 db.exec(`CREATE TABLE IF NOT EXISTS platform_oauth(channel TEXT NOT NULL,platform TEXT NOT NULL,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL,scopes TEXT NOT NULL,PRIMARY KEY(channel,platform));
 CREATE TABLE IF NOT EXISTS platform_delivery(platform TEXT NOT NULL,message_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(platform,message_id));`);
 const conf=type=>{const p=providers[type];if(!p)return null;return {...p,clientId:process.env[p.client],clientSecret:process.env[p.secret]}};
 const safe=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error('platform:',e.message);res.status(400).json({error:e.message})});
 const authUser=(req,res,next)=>req.session.uid?next():res.status(401).json({error:'Sign in with Twitch first'});
 const verifyChannel=(req,res,next)=>{const channel=access.channelFor(req);if(!channel||!access.can(req.session.uid,channel,'owner'))return res.status(403).json({error:'Channel owner required'});req.channelId=channel;next()};
 app.get('/api/platforms',withUser,access.channelOnly('editor'),(req,res)=>{
 const rows=db.prepare('SELECT platform,external_id,display_name,expires_at,scopes FROM platform_oauth WHERE channel=?').all(req.channelId);
 res.json({platforms:['twitch','kick','vpzone'].map(platform=>({platform,configured:platform==='twitch'||Boolean(conf(platform)?.clientId&&conf(platform)?.clientSecret),connection:rows.find(r=>r.platform===platform)||null}))});
 });
 app.get('/auth/platform/:platform',authUser,verifyChannel,safe(async(req,res)=>{
 const type=req.params.platform,p=conf(type);if(!p?.clientId||!p.clientSecret)throw Error('Platform OAuth app not configured');
 const state=pkce(),verifier=pkce(),redirect=base+'/auth/platform/callback/'+type;
 req.session.platformOAuth={type,state,verifier,channel:req.channelId,owner:req.session.uid,expires:Date.now()+600000};
 const query=new URLSearchParams({response_type:'code',client_id:p.clientId,redirect_uri:redirect,scope:p.scope,state,code_challenge:hash(verifier),code_challenge_method:'S256'});
 res.redirect(p.auth+'?'+query);
 }));
 app.get('/auth/platform/callback/:platform',authUser,safe(async(req,res)=>{
 const o=req.session.platformOAuth;delete req.session.platformOAuth;
 const type=req.params.platform,p=conf(type);
 if(!o||o.type!==type||o.state!==req.query.state||!req.query.code||o.expires<Date.now()||o.owner!==req.session.uid||!access.can(req.session.uid,o.channel,'owner'))throw Error('Invalid or expired OAuth session');
 const redirect=base+'/auth/platform/callback/'+type;
 const body=new URLSearchParams({grant_type:'authorization_code',client_id:p.clientId,client_secret:p.clientSecret,redirect_uri:redirect,code:String(req.query.code),code_verifier:o.verifier});
 const response=await fetch(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(type+' token exchange returned '+response.status);
 const token=await response.json();if(!token.access_token||!token.refresh_token)throw Error('Provider did not return renewable token');
 let identity;
 if(type==='vpzone'){
 const r=await fetch('https://vpzone.tv/api/v1/me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('VPZone identity failed '+r.status);
 const payload=(await r.json()).data;
 if(!payload?.profile?.id||!payload.channel?.slug)throw Error('VPZone account has no channel slug');
 identity={id:payload.profile.id,display:payload.channel.slug};
 }else{
 const r=await fetch('https://api.kick.com/public/v1/users',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Kick identity failed '+r.status);
 const payload=(await r.json()).data;
 const user=Array.isArray(payload)?payload[0]:payload;
 if(!user?.user_id&&!user?.id)throw Error('Kick identity unavailable');
 identity={id:String(user.user_id||user.id),display:clean(user.name||user.username||user.slug||user.user_id)};
 }
 db.prepare('INSERT INTO platform_oauth(channel,platform,external_id,display_name,access_token,refresh_token,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes').run(o.channel,type,identity.id,identity.display,enc(token.access_token),enc(token.refresh_token),Date.now()+Number(token.expires_in||3600)*1000,String(token.scope||p.scope));
 db.prepare('INSERT OR REPLACE INTO provider_accounts(id,channel,platform,external_id,display_name,status) VALUES(?,?,?,?,?,?)').run(o.channel+':'+type,o.channel,type,identity.id,identity.display,'connected');
 log(o.channel,'provider-linked',type+' '+identity.display);
 res.redirect('/?connected='+encodeURIComponent(type));
 }));
 app.post('/api/platforms/:platform/disconnect',withUser,verifyChannel,csrf,(req,res)=>{
 const type=req.params.platform;if(!providers[type])return res.sendStatus(404);
 db.prepare('DELETE FROM platform_oauth WHERE channel=? AND platform=?').run(req.channelId,type);
 db.prepare('DELETE FROM provider_accounts WHERE channel=? AND platform=?').run(req.channelId,type);
 log(req.channelId,'provider-disconnected',type);res.json({ok:true});
 });
 async function refresh(channel,type){
 const row=db.prepare('SELECT * FROM platform_oauth WHERE channel=? AND platform=?').get(channel,type),p=conf(type);
 if(!row||!p?.clientId)return null;if(row.expires_at>Date.now()+120000)return dec(row.access_token);
 const b=new URLSearchParams({grant_type:'refresh_token',refresh_token:dec(row.refresh_token),client_id:p.clientId,client_secret:p.clientSecret});
 const r=await fetch(p.token,{method:'POST',body:b,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(type+' refresh failed '+r.status);
 const t=await r.json();if(!t.access_token||!t.refresh_token)throw Error('Missing rotated token');
 db.prepare('UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=? WHERE channel=? AND platform=?').run(enc(t.access_token),enc(t.refresh_token),Date.now()+Number(t.expires_in||3600)*1000,channel,type);
 return t.access_token;
 }
 app.get('/api/platforms/:platform/channel',withUser,access.channelOnly('editor'),safe(async(req,res)=>{
 const type=req.params.platform;if(!providers[type])return res.sendStatus(404);
 const row=db.prepare('SELECT * FROM platform_oauth WHERE channel=? AND platform=?').get(req.channelId,type);
 if(!row)return res.status(404).json({error:'Platform not connected'});
 const token=await refresh(req.channelId,type);
 const url=type==='vpzone'?'https://vpzone.tv/api/v1/channels/'+encodeURIComponent(row.display_name):'https://api.kick.com/public/v1/channels?broadcaster_user_id='+encodeURIComponent(row.external_id);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error(type+' channel query failed '+r.status);res.json({platform:type,data:await r.json()});
 }));
 // Kick signs the raw bytes using its rotating RSA public key.
 let kickKey=null,keyTime=0;
 async function currentKickKey(){if(kickKey&&Date.now()-keyTime<3600000)return kickKey;
 const r=await fetch('https://api.kick.com/public/v1/public-key',{signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Kick public key retrieval failed');const j=await r.json();const pem=j.data?.public_key||j.public_key;
 if(!pem)throw Error('Kick public key missing');kickKey=crypto.createPublicKey(pem);keyTime=Date.now();return kickKey}
 app.post('/webhooks/kick',expressRaw(),safe(async(req,res)=>{
 const msg=req.get('Kick-Event-Message-Id'),timestamp=req.get('Kick-Event-Message-Timestamp'),sig=req.get('Kick-Event-Signature'),kind=req.get('Kick-Event-Type');
 if(!msg||!timestamp||!sig||!kind||!Buffer.isBuffer(req.body))return res.sendStatus(400);
 const time=Date.parse(timestamp);if(!Number.isFinite(time)||Math.abs(Date.now()-time)>300000)return res.sendStatus(401);
 const signed=Buffer.concat([Buffer.from(msg+'.'+timestamp+'.'),req.body]);
 const key=await currentKickKey();
 if(!crypto.verify('RSA-SHA256',signed,key,Buffer.from(sig,'base64')))return res.sendStatus(401);
 if(db.prepare('SELECT 1 FROM platform_delivery WHERE platform=? AND message_id=?').get('kick',msg))return res.sendStatus(204);
 const event=JSON.parse(req.body.toString('utf8'));
 const broadcaster=String(event.broadcaster?.user_id||event.broadcaster_user_id||event.broadcaster?.id||'');
 const linked=db.prepare('SELECT channel FROM platform_oauth WHERE platform=? AND external_id=?').get('kick',broadcaster);
 db.prepare('INSERT INTO platform_delivery(platform,message_id,created_at) VALUES(?,?,?)').run('kick',msg,Date.now());
 if(linked){
 const actor=clean(event.follower?.username||event.sender?.username||event.user?.username||event.subscriber?.username||'');
 const detail=clean(kind+' '+actor);
 db.prepare('INSERT INTO platform_events(channel,platform,event_type,actor,detail) VALUES(?,?,?,?,?)').run(linked.channel,'kick',kind,actor,detail);
 db.prepare('INSERT INTO overlay_events(channel,kind,message) VALUES(?,?,?)').run(linked.channel,kind,detail);
 log(linked.channel,'kick-event',detail);
 }
 db.prepare('DELETE FROM platform_delivery WHERE created_at<?').run(Date.now()-86400000);
 res.sendStatus(204);
 }));
}
function expressRaw(){return (req,res,next)=>{let chunks=[],size=0;req.on('data',b=>{size+=b.length;if(size>262144){res.sendStatus(413);req.destroy();return}chunks.push(b)});req.on('end',()=>{req.body=Buffer.concat(chunks);next()});req.on('error',next)}}
