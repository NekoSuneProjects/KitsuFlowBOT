// Per-channel creator payment integrations and verified webhook events.
// Never log API tokens, webhook secrets, or private supporter contact details.
import crypto from 'node:crypto';
import WebSocket from 'ws';
import {io} from 'socket.io-client';
export function installCreatorPayments({app,db,withUser,csrf,access,enc,dec,streamActivity,log,base}){
 db.exec(`CREATE TABLE IF NOT EXISTS payment_connections(
 channel TEXT NOT NULL,provider TEXT NOT NULL,secret TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(channel,provider));
 CREATE TABLE IF NOT EXISTS payment_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,provider TEXT NOT NULL,
 external_id TEXT NOT NULL,type TEXT NOT NULL,actor TEXT NOT NULL DEFAULT '',
 amount REAL NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT '',
 tier TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(channel,provider,external_id));
 CREATE INDEX IF NOT EXISTS payment_events_channel_idx ON payment_events(channel,id DESC);`);
 const supported=['streamelements','streamlabs','tipeeestream','kofi','patreon'];
 const states=new Map(),sockets=new Map(),retries=new Map();
 const key=(channel,provider)=>channel+':'+provider;
 const clean=s=>String(s||'').slice(0,120);
 const conn=(channel,provider)=>db.prepare('SELECT * FROM payment_connections WHERE channel=? AND provider=? AND enabled=1').get(channel,provider);
 function publish(channel,provider,id,type,actor,amount=0,currency='',tier=''){
  if(!id)return false;
  const change=db.prepare('INSERT OR IGNORE INTO payment_events(channel,provider,external_id,type,actor,amount,currency,tier) VALUES(?,?,?,?,?,?,?,?)')
   .run(channel,provider,String(id).slice(0,160),type,clean(actor),Number(amount)||0,clean(currency).slice(0,8),clean(tier)).changes;
  if(change)streamActivity.emit(channel,provider,type,clean(actor),String(Number(amount)||0),provider+':'+channel+':'+id);
  return Boolean(change);
 }
 function close(channel,provider){
  const k=key(channel,provider);
  const timer=retries.get(k);if(timer){clearTimeout(timer);retries.delete(k)}
  const ws=sockets.get(k);sockets.delete(k);
  if(ws){try{if(provider==='streamelements')ws.close();else ws.disconnect()}catch{}}
  states.set(k,'disconnected');
 }
 function retry(channel,provider){const k=key(channel,provider);if(retries.has(k)||!conn(channel,provider))return;
  const t=setTimeout(()=>{retries.delete(k);connect(channel,provider)},30000);t.unref?.();retries.set(k,t);
 }
 function connect(channel,provider){
  close(channel,provider);
  const c=conn(channel,provider);if(!c||!['streamelements','streamlabs','tipeeestream'].includes(provider))return;
  const k=key(channel,provider);let token;
  try{token=dec(c.secret)}catch{states.set(k,'invalid_credentials');return}
  states.set(k,'connecting');
  if(provider==='streamelements'){
   const ws=new WebSocket('wss://astro.streamelements.com/');sockets.set(k,ws);
   ws.on('open',()=>{
    for(const topic of ['channel.tips']){
     ws.send(JSON.stringify({type:'subscribe',nonce:crypto.randomUUID(),data:{topic,token,token_type:'jwt'}}));
    }
    states.set(k,'connected');
   });
   ws.on('message',raw=>{try{
    const m=JSON.parse(String(raw));if(m.type!=='message'&&m.type!=='event'&&m.type!=='publish')return;
    if(m.data?.topic!=='channel.tips'&&m.topic!=='channel.tips')return;
    const d=m.data?.data||m.data||{},tip=d.donation||d;
    const id=tip._id||d._id||tip.id;
    if(!id||!(Number(tip.amount)>0))return;
    publish(channel,provider,id,'donation',tip.user?.username||tip.user?.name||tip.username||'Supporter',tip.amount,tip.currency);
   }catch(err){log(channel,'payment-event-error',provider+': '+err.message)}});
   ws.on('error',()=>states.set(k,'error'));
   ws.on('close',()=>{if(sockets.get(k)===ws){sockets.delete(k);states.set(k,'disconnected');retry(channel,provider)}});
   return;
  }
  if(provider==='streamlabs'){
   const socket=io('https://sockets.streamlabs.com',{transports:['websocket'],query:{token},reconnection:true});sockets.set(k,socket);
   socket.on('connect',()=>states.set(k,'connected'));
   socket.on('event',data=>{
    if(data?.type!=='donation')return;
    for(const item of Array.isArray(data.message)?data.message:[]){
     if(item.id&&Number(item.amount)>0)publish(channel,provider,item.id,'donation',item.name||'Supporter',item.amount,item.currency||'');
    }
   });
   socket.on('connect_error',()=>states.set(k,'error'));return;
  }
  // TipeeeStream's Socket.IO protocol requires joining a room with API key + username.
  const socket=io('https://sso-cf.tipeeestream.com:443',{transports:['websocket'],query:{access_token:token},reconnection:true});sockets.set(k,socket);
  socket.on('connect',()=>{states.set(k,'connected');socket.emit('join-room',{room:token,username:c.username})});
  socket.on('new-event',data=>{
   const ev=data?.event;if(!ev?.id||!['donation','subscription'].includes(ev.type))return;
   const p=ev.parameters||{};
   publish(channel,provider,ev.id,ev.type==='subscription'?'membership':'donation',p.username||ev.user?.username||'Supporter',p.amount||0,p.currency||'',p.tier||'');
  });
  socket.on('connect_error',()=>states.set(k,'error'));
 }
 function status(channel,provider){
  return {provider,connected:Boolean(conn(channel,provider)),status:states.get(key(channel,provider))||'not_connected',webhook_url:base+'/webhooks/payments/'+provider+'/'+encodeURIComponent(channel)};
 }
 app.get('/api/payment-integrations',withUser,access.channelOnly('owner'),(req,res)=>{
  res.set('Cache-Control','no-store').json({providers:supported.map(p=>({...status(req.channelId,p),username:conn(req.channelId,p)?.username||''})),
   history:db.prepare('SELECT provider,type,actor,amount,currency,tier,created FROM payment_events WHERE channel=? ORDER BY id DESC LIMIT 35').all(req.channelId)});
 });
 app.post('/api/payment-integrations/:provider',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const provider=req.params.provider;if(!supported.includes(provider))return res.sendStatus(404);
  const secret=String(req.body?.secret||'').trim(),username=String(req.body?.username||'').trim();
  if(secret.length<12||secret.length>4096)return res.status(400).json({error:'Supply a valid provider token or webhook secret'});
  if(provider==='tipeeestream'&&!/^[a-z0-9_-]{2,45}$/i.test(username))return res.status(400).json({error:'TipeeeStream username required'});
  db.prepare('INSERT INTO payment_connections(channel,provider,secret,username,enabled) VALUES(?,?,?,?,1) ON CONFLICT(channel,provider) DO UPDATE SET secret=excluded.secret,username=excluded.username,enabled=1')
   .run(req.channelId,provider,enc(secret),username);
  connect(req.channelId,provider);log(req.channelId,'payment-config',provider+' configured');
  res.json({ok:true,...status(req.channelId,provider)});
 });
 app.post('/api/payment-integrations/:provider/disconnect',withUser,access.channelOnly('owner'),csrf,(req,res)=>{
  const provider=req.params.provider;if(!supported.includes(provider))return res.sendStatus(404);
  close(req.channelId,provider);db.prepare('DELETE FROM payment_connections WHERE channel=? AND provider=?').run(req.channelId,provider);res.json({ok:true});
 });
 // Ko-fi sends application/x-www-form-urlencoded with a JSON-encoded 'data' field.
 app.post('/webhooks/payments/kofi/:channel',(req,res)=>{
  const channel=String(req.params.channel||''),c=conn(channel,'kofi');
  if(!c)return res.sendStatus(404);
  let data=req.body?.data||req.body;
  try{if(typeof data==='string')data=JSON.parse(data)}catch{return res.sendStatus(400)}
  if(!data||typeof data!=='object')return res.sendStatus(400);
  const received=Buffer.from(String(data.verification_token||'')),expected=Buffer.from(dec(c.secret));
  if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected))return res.sendStatus(401);
  const id=data.message_id||data.kofi_transaction_id;if(!id)return res.sendStatus(400);
  const kind=data.type==='Subscription'?'membership':data.type==='Shop Order'?'purchase':'donation';
  publish(channel,'kofi',id,kind,data.from_name||'Supporter',data.amount,data.currency,data.tier_name||'');
  res.sendStatus(200);
 });
 app.post('/webhooks/payments/patreon/:channel',(req,res)=>{
  const channel=String(req.params.channel||''),c=conn(channel,'patreon');
  if(!c)return res.sendStatus(404);
  const body=req.rawBody;if(!Buffer.isBuffer(body))return res.sendStatus(400);
  const given=String(req.get('x-patreon-signature')||'');
  const expected=crypto.createHmac('md5',dec(c.secret)).update(body).digest('hex');
  if(!/^[a-f0-9]{32}$/i.test(given)||!crypto.timingSafeEqual(Buffer.from(given.toLowerCase()),Buffer.from(expected)))return res.sendStatus(401);
  const event=String(req.get('x-patreon-event')||'');
  const payload=req.body||{},member=payload.data||{},a=member.attributes||{};
  const id=String(member.id||'')+':'+event+':'+String(a.last_charge_date||a.pledge_relationship_start||a.updated_at||'');
  if(!member.id)return res.sendStatus(400);
  const type=event==='members:pledge:create'?'membership':event==='members:pledge:update'?'membership_update':event==='members:pledge:delete'?'membership_end':event==='members:create'?'membership':event==='members:delete'?'membership_end':'';
  if(!type)return res.sendStatus(200);
  // Changes to pledges are informational. Only verified paid patron charges should count as donations.
  const amount=Number(a.currently_entitled_amount_cents||0)/100;
  const tier=payload.included?.filter(x=>x.type==='tier').map(x=>x.attributes?.title||x.id).join(', ')||'';
  publish(channel,'patreon',id,type,a.full_name||'Patron',amount,'',tier);
  res.sendStatus(200);
 });
 for(const c of db.prepare("SELECT channel,provider FROM payment_connections WHERE enabled=1 AND provider IN ('streamelements','streamlabs','tipeeestream')").all())connect(c.channel,c.provider);
 return {publish};
}
