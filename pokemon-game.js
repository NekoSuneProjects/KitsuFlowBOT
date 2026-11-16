// KitsuFlow Pokémon chat game (PokemonCommunityGame-style).
// - Wild spawns while a channel is live; viewers !pokecatch with balls from their bag.
// - !pokeshop / !pokebuy spend the channel's loyalty points.
// - Pokédex + bag are global per Twitch user, so collections follow viewers between channels.
// - Raids: channel raids (mods) and Global Raids across every live channel with the game on.
import crypto from 'node:crypto';

// Gen 1. Tier: c common, u uncommon, r rare, e epic, L legendary (raid-only).
const DEX_RAW='Bulbasaur:u,Ivysaur:r,Venusaur:e,Charmander:u,Charmeleon:r,Charizard:e,Squirtle:u,Wartortle:r,Blastoise:e,Caterpie:c,Metapod:c,Butterfree:u,Weedle:c,Kakuna:c,Beedrill:u,Pidgey:c,Pidgeotto:u,Pidgeot:r,Rattata:c,Raticate:u,Spearow:c,Fearow:u,Ekans:c,Arbok:u,Pikachu:u,Raichu:r,Sandshrew:c,Sandslash:u,Nidoran♀:c,Nidorina:u,Nidoqueen:r,Nidoran♂:c,Nidorino:u,Nidoking:r,Clefairy:u,Clefable:r,Vulpix:u,Ninetales:r,Jigglypuff:c,Wigglytuff:u,Zubat:c,Golbat:u,Oddish:c,Gloom:u,Vileplume:r,Paras:c,Parasect:u,Venonat:c,Venomoth:u,Diglett:c,Dugtrio:u,Meowth:c,Persian:u,Psyduck:c,Golduck:u,Mankey:c,Primeape:u,Growlithe:u,Arcanine:r,Poliwag:c,Poliwhirl:u,Poliwrath:r,Abra:u,Kadabra:r,Alakazam:e,Machop:c,Machoke:u,Machamp:r,Bellsprout:c,Weepinbell:u,Victreebel:r,Tentacool:c,Tentacruel:u,Geodude:c,Graveler:u,Golem:r,Ponyta:c,Rapidash:u,Slowpoke:c,Slowbro:u,Magnemite:c,Magneton:u,Farfetch\'d:u,Doduo:c,Dodrio:u,Seel:c,Dewgong:u,Grimer:c,Muk:u,Shellder:c,Cloyster:u,Gastly:u,Haunter:r,Gengar:e,Onix:u,Drowzee:c,Hypno:u,Krabby:c,Kingler:u,Voltorb:c,Electrode:u,Exeggcute:c,Exeggutor:u,Cubone:c,Marowak:u,Hitmonlee:r,Hitmonchan:r,Lickitung:u,Koffing:c,Weezing:u,Rhyhorn:c,Rhydon:u,Chansey:r,Tangela:u,Kangaskhan:r,Horsea:c,Seadra:u,Goldeen:c,Seaking:u,Staryu:c,Starmie:u,Mr. Mime:r,Scyther:r,Jynx:u,Electabuzz:r,Magmar:r,Pinsir:r,Tauros:r,Magikarp:c,Gyarados:e,Lapras:e,Ditto:r,Eevee:u,Vaporeon:r,Jolteon:r,Flareon:r,Porygon:r,Omanyte:u,Omastar:r,Kabuto:u,Kabutops:r,Aerodactyl:e,Snorlax:e,Articuno:L,Zapdos:L,Moltres:L,Dratini:r,Dragonair:e,Dragonite:e,Mewtwo:L,Mew:L';
export const DEX=DEX_RAW.split(',').map((x,i)=>{const at=x.lastIndexOf(':');return {dex:i+1,name:x.slice(0,at),tier:x.slice(at+1)}});
const TIERS={
 c:{label:'Common',weight:55,catch:0.75,power:1},
 u:{label:'Uncommon',weight:28,catch:0.55,power:1.2},
 r:{label:'Rare',weight:13,catch:0.38,power:1.5},
 e:{label:'Epic',weight:4,catch:0.22,power:2},
 L:{label:'Legendary',weight:0,catch:0.12,power:3}
};
const BALLS={
 pokeball:{name:'Poké Ball',mult:1,price:100},
 greatball:{name:'Great Ball',mult:1.5,price:300},
 ultraball:{name:'Ultra Ball',mult:2,price:600},
 masterball:{name:'Master Ball',mult:Infinity,price:15000}
};
const ITEMS={
 ...Object.fromEntries(Object.entries(BALLS).map(([k,v])=>[k,{name:v.name,price:v.price,desc:'x'+(v.mult===Infinity?'∞ (never fails)':v.mult)+' catch rate'}])),
 rarecandy:{name:'Rare Candy',price:250,desc:'+1 level: !pokecandy <pokemon>'},
 lure:{name:'Lure',price:800,desc:'Spawns a wild Pokémon now: !pokelure'}
};
const ALIASES={poke:'pokeball',pokeball:'pokeball',ball:'pokeball',great:'greatball',greatball:'greatball',ultra:'ultraball',ultraball:'ultraball',master:'masterball',masterball:'masterball',candy:'rarecandy',rarecandy:'rarecandy',lure:'lure'};
const RAID_BOSSES=['Articuno','Zapdos','Moltres','Mewtwo','Mew','Dragonite','Snorlax','Gyarados','Charizard','Lapras','Gengar','Aerodactyl'];
const STARTER_BALLS=5,CATCH_WINDOW=90000,RAID_MINUTES=10,SHINY_ODDS=256;
const rand=n=>crypto.randomInt(n);
const pick=a=>a[rand(a.length)];
const chance=p=>crypto.randomInt(1000000)<p*1000000;
const byName=n=>{const k=String(n||'').toLowerCase().replace(/[^a-z0-9♀♂]/g,'');return DEX.find(p=>p.name.toLowerCase().replace(/[^a-z0-9♀♂]/g,'')===k)};
const displayName=e=>/^[A-Za-z0-9_]{1,25}$/.test(e.chatter_user_name||'')?e.chatter_user_name:(e.chatter_user_login||'viewer');

export function installPokemon({app,db,withUser,csrf,access,api,say,log,isOperator,botId}){
 db.exec(`CREATE TABLE IF NOT EXISTS poke_settings(channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,spawn_minutes INTEGER NOT NULL DEFAULT 15,last_spawn INTEGER NOT NULL DEFAULT 0,global_raids INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS poke_bag(user_id TEXT NOT NULL,item TEXT NOT NULL,qty INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,item));
 CREATE TABLE IF NOT EXISTS poke_trainers(user_id TEXT PRIMARY KEY,login TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS poke_caught(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,login TEXT NOT NULL,dex INTEGER NOT NULL,level INTEGER NOT NULL,shiny INTEGER NOT NULL DEFAULT 0,channel TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'wild',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS poke_caught_user ON poke_caught(user_id,dex);
 CREATE TABLE IF NOT EXISTS poke_events(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const settings=ch=>db.prepare('SELECT * FROM poke_settings WHERE channel=?').get(ch)||{channel:ch,enabled:0,spawn_minutes:15,last_spawn:0,global_raids:1};
 const event=(ch,kind,detail)=>db.prepare('INSERT INTO poke_events(channel,kind,detail) VALUES(?,?,?)').run(ch,kind,String(detail).slice(0,300));
 const points=(ch,user)=>db.prepare('SELECT points FROM loyalty WHERE channel=? AND user_id=?').get(ch,user)?.points||0;
 const spend=(ch,user,n)=>db.prepare('UPDATE loyalty SET points=points-? WHERE channel=? AND user_id=? AND points>=?').run(n,ch,user,n).changes>0;
 const award=(ch,user,login,n)=>db.prepare(`INSERT INTO loyalty(channel,user_id,username,points,watch_minutes) VALUES(?,?,?,?,0)
  ON CONFLICT(channel,user_id) DO UPDATE SET points=MIN(1000000000,loyalty.points+excluded.points)`).run(ch,user,login,n);
 const qty=(user,item)=>db.prepare('SELECT qty FROM poke_bag WHERE user_id=? AND item=?').get(user,item)?.qty||0;
 const give=(user,item,n)=>db.prepare('INSERT INTO poke_bag(user_id,item,qty) VALUES(?,?,?) ON CONFLICT(user_id,item) DO UPDATE SET qty=MAX(0,poke_bag.qty+excluded.qty)').run(user,item,n);
 const take=(user,item)=>db.prepare('UPDATE poke_bag SET qty=qty-1 WHERE user_id=? AND item=? AND qty>0').run(user,item).changes>0;
 // First time a viewer plays they get starter balls.
 const trainer=e=>{const r=db.prepare('INSERT OR IGNORE INTO poke_trainers(user_id,login) VALUES(?,?)').run(e.chatter_user_id,e.chatter_user_login);if(r.changes)give(e.chatter_user_id,'pokeball',STARTER_BALLS);return r.changes>0};
 const strongest=user=>db.prepare('SELECT dex,level,shiny FROM poke_caught WHERE user_id=? ORDER BY level DESC,id ASC LIMIT 1').get(user);
 const label=(p,shiny,level)=>(shiny?'✨Shiny ':'')+p.name+(level?' (Lv '+level+')':'');

 // ---- wild spawns ----
 const spawns=new Map(); // channel -> {p,shiny,level,expires,caught:Set,tried:Set}
 function rollWild(){const pool=DEX.filter(p=>TIERS[p.tier].weight>0),total=pool.reduce((a,p)=>a+TIERS[p.tier].weight,0);let r=rand(total);for(const p of pool){r-=TIERS[p.tier].weight;if(r<0)return p}return pool[0]}
 async function spawn(ch,login,reason='wild'){
  const p=rollWild(),shiny=rand(SHINY_ODDS)===0,level=1+rand(30);
  const s={p,shiny,level,expires:Date.now()+CATCH_WINDOW,caught:new Set(),tried:new Set()};
  spawns.set(ch,s);
  db.prepare('INSERT INTO poke_settings(channel,last_spawn) VALUES(?,?) ON CONFLICT(channel) DO UPDATE SET last_spawn=excluded.last_spawn').run(ch,Date.now());
  event(ch,'spawn',label(p,shiny,level));
  const t=setTimeout(()=>{if(spawns.get(ch)!==s)return;spawns.delete(ch);void say(ch,'💨 The wild '+label(p,shiny)+' fled!'+(s.caught.size?' Caught by '+s.caught.size+' trainer'+(s.caught.size===1?'':'s')+'.':'')).catch(()=>{})},CATCH_WINDOW);t.unref?.();
  await say(ch,(shiny?'✨✨ A SHINY ':'🌿 A wild ')+p.name+' (Lv '+level+', '+TIERS[p.tier].label+') appeared'+(reason==='lure'?' from a Lure':'')+'! Type !pokecatch [pokeball|greatball|ultraball|masterball] within 90s!');
 }
 async function tick(){
  const rows=db.prepare('SELECT p.*,c.login FROM poke_settings p JOIN channels c ON c.id=p.channel WHERE p.enabled=1 AND c.enabled=1').all();
  for(const r of rows){
   if(spawns.has(r.channel)||Date.now()-r.last_spawn<r.spawn_minutes*60000)continue;
   try{const live=await api(r.channel,'streams?user_id='+encodeURIComponent(r.channel));if(!live.data?.length)continue;await spawn(r.channel,r.login)}
   catch(err){log(r.channel,'pokemon-spawn-error',err.message)}
  }
 }
 setInterval(()=>{void tick().catch(()=>{})},60000).unref?.();

 // ---- raids ----
 // One global raid at a time (shared HP across channels) plus optional local raids per channel.
 let globalRaid=null;const localRaids=new Map();
 const raidFor=ch=>localRaids.get(ch)||(globalRaid&&globalRaid.channels.has(ch)?globalRaid:null);
 async function startRaid({channels,global,starter}){
  const bossName=pick(RAID_BOSSES),boss=byName(bossName),hp=global?6000:1500;
  const raid={boss,level:50+rand(21),hp,maxHp:hp,global,channels:new Set(channels),players:new Map(),ends:Date.now()+RAID_MINUTES*60000,marks:new Set()};
  raid.timer=setTimeout(()=>{void endRaid(raid,false).catch(()=>{})},RAID_MINUTES*60000);raid.timer.unref?.();
  if(global)globalRaid=raid;else localRaids.set(channels[0],raid);
  for(const ch of channels){event(ch,global?'global-raid':'raid','Started '+boss.name+' by '+starter);
   await say(ch,(global?'🌍 GLOBAL RAID! ':'⚔️ RAID! ')+boss.name+' (Lv '+raid.level+', '+hp+' HP) has appeared'+(global?' across '+channels.length+' channel'+(channels.length===1?'':'s'):'')+'! Type !pokeraid to attack. '+RAID_MINUTES+' minutes on the clock!').catch(err=>log(ch,'pokemon-raid-say',err.message))}
  return raid;
 }
 async function endRaid(raid,won){
  clearTimeout(raid.timer);
  if(raid.global){if(globalRaid===raid)globalRaid=null}else for(const ch of raid.channels)if(localRaids.get(ch)===raid)localRaids.delete(ch);
  const players=[...raid.players.entries()].sort((a,b)=>b[1].damage-a[1].damage);
  if(!won){for(const ch of raid.channels)await say(ch,'💨 '+raid.boss.name+' escaped the raid with '+raid.hp+' HP left. Better luck next time!').catch(()=>{});return}
  const caughtBy=[],reward=raid.global?300:150;
  db.transaction(()=>{players.forEach(([id,m],i)=>{
   award(m.channel,id,m.login,reward);
   // Top damage dealer always catches; everyone else gets a raid-ball throw.
   if(i===0||chance(raid.global?0.5:0.35)){const shiny=rand(64)===0;db.prepare("INSERT INTO poke_caught(user_id,login,dex,level,shiny,channel,source) VALUES(?,?,?,?,?,?,'raid')").run(id,m.login,raid.boss.dex,raid.level,shiny?1:0,m.channel);caughtBy.push((shiny?'✨':'')+m.login)}
  })})();
  const mvp=players[0]?players[0][1].login+' ('+players[0][1].damage+' dmg)':'nobody';
  let msg='🏆 '+raid.boss.name+' was defeated by '+players.length+' trainer'+(players.length===1?'':'s')+'! MVP: '+mvp+'. Everyone gets +'+reward+' points. Caught it: '+(caughtBy.join(', ')||'nobody');
  if(msg.length>480)msg=msg.slice(0,477)+'...';
  for(const ch of raid.channels){event(ch,'raid-won',raid.boss.name);await say(ch,msg).catch(()=>{})}
 }
 async function startGlobalRaid(starter){
  if(globalRaid)throw Error('A global raid is already running');
  const rows=db.prepare('SELECT p.channel FROM poke_settings p JOIN channels c ON c.id=p.channel WHERE p.enabled=1 AND p.global_raids=1 AND c.enabled=1').all();
  const live=[];for(const r of rows){try{if((await api(r.channel,'streams?user_id='+encodeURIComponent(r.channel))).data?.length)live.push(r.channel)}catch{}}
  if(!live.length)throw Error('No live channels have the Pokémon game and global raids enabled');
  return startRaid({channels:live,global:true,starter});
 }
 const autoHours=Number(process.env.POKEMON_GLOBAL_RAID_HOURS||0);
 if(autoHours>0){setInterval(()=>{if(!globalRaid)void startGlobalRaid('schedule').catch(()=>{})},autoHours*3600000).unref?.()}
 const attackCooldown=new Map();

 // ---- chat commands ----
 const COMMANDS=new Set(['!pokecatch','!pokeshop','!pokebuy','!pokebag','!pokedex','!poketop','!pokeraid','!pokecandy','!pokelure','!pokespawn','!pokeraidstart','!pokehelp','!pokemon']);
 async function onMessage(ch,e,parts,isMod){
  const cmd=parts[0]?.toLowerCase();
  if(!COMMANDS.has(cmd))return false;
  if(!settings(ch.id).enabled)return false;
  const uid=e.chatter_user_id,who=displayName(e),arg=(parts[1]||'').toLowerCase();
  const isNew=trainer(e);
  if(isNew)await say(ch.id,'🎒 Welcome, Trainer '+who+'! Here are '+STARTER_BALLS+' free Poké Balls. Type !pokehelp for commands.').catch(()=>{});
  switch(cmd){
   case '!pokehelp':case '!pokemon':
    await say(ch.id,'Pokémon: !pokecatch [ball] · !pokeshop · !pokebuy <item> [qty] · !pokebag · !pokedex · !poketop · !pokeraid · !pokecandy <pokemon> · !pokelure · Mods: !pokespawn, !pokeraidstart');return true;
   case '!pokecatch':{
    const s=spawns.get(ch.id);
    if(!s||s.expires<Date.now()){await say(ch.id,'@'+who+' there\'s no wild Pokémon right now. Keep watching!');return true}
    if(s.caught.has(uid)){await say(ch.id,'@'+who+' you already caught this '+s.p.name+'!');return true}
    const ball=ALIASES[arg]||(arg?null:'pokeball');
    if(!ball||!BALLS[ball]){await say(ch.id,'@'+who+' use: !pokecatch pokeball | greatball | ultraball | masterball');return true}
    if(!take(uid,ball)){await say(ch.id,'@'+who+' you have no '+BALLS[ball].name+'s! Buy some with !pokebuy '+ball);return true}
    const p=Math.min(1,TIERS[s.p.tier].catch*BALLS[ball].mult*(s.tried.has(uid)?0.85:1));
    s.tried.add(uid);
    if(chance(p)){
     s.caught.add(uid);
     db.prepare('INSERT INTO poke_caught(user_id,login,dex,level,shiny,channel) VALUES(?,?,?,?,?,?)').run(uid,e.chatter_user_login,s.p.dex,s.level,s.shiny?1:0,ch.id);
     const total=db.prepare('SELECT COUNT(DISTINCT dex) n FROM poke_caught WHERE user_id=?').get(uid).n;
     const first=db.prepare('SELECT COUNT(*) n FROM poke_caught WHERE user_id=? AND dex=?').get(uid,s.p.dex).n===1;
     await say(ch.id,'🎉 '+who+' caught '+label(s.p,s.shiny,s.level)+' with a '+BALLS[ball].name+'!'+(first?' New Pokédex entry ('+total+'/151)!':''));
    }else await say(ch.id,'💥 Oh no! '+s.p.name+' broke free from '+who+'\'s '+BALLS[ball].name+'! ('+qty(uid,ball)+' left)');
    return true;
   }
   case '!pokeshop':
    await say(ch.id,'🛒 PokéShop (loyalty points): '+Object.entries(ITEMS).map(([k,v])=>v.name+' '+v.price).join(' · ')+' — buy with !pokebuy <item> [qty]');return true;
   case '!pokebuy':{
    const item=ALIASES[arg],n=Math.max(1,Math.min(100,Math.floor(Number(parts[2])||1)));
    if(!item){await say(ch.id,'@'+who+' usage: !pokebuy pokeball|greatball|ultraball|masterball|rarecandy|lure [qty]');return true}
    const cost=ITEMS[item].price*n;
    if(!spend(ch.id,uid,cost)){await say(ch.id,'@'+who+' that costs '+cost+' points, you have '+points(ch.id,uid)+'.');return true}
    give(uid,item,n);event(ch.id,'buy',who+' '+n+'x '+item);
    await say(ch.id,'🛍️ '+who+' bought '+n+'x '+ITEMS[item].name+' for '+cost+' points. You now have '+qty(uid,item)+'.');return true;
   }
   case '!pokebag':{
    const rows=db.prepare('SELECT item,qty FROM poke_bag WHERE user_id=? AND qty>0').all(uid);
    await say(ch.id,'🎒 '+who+'\'s bag: '+(rows.map(r=>(ITEMS[r.item]?.name||r.item)+' x'+r.qty).join(' · ')||'empty')+' · '+points(ch.id,uid)+' points here');return true;
   }
   case '!pokedex':{
    const target=(parts[1]||'').replace(/^@/,'').toLowerCase();
    const row=target?db.prepare('SELECT user_id,login FROM poke_trainers WHERE LOWER(login)=?').get(target):{user_id:uid,login:who};
    if(!row){await say(ch.id,'That trainer hasn\'t played yet.');return true}
    const st=db.prepare('SELECT COUNT(DISTINCT dex) uniq,COUNT(*) total,SUM(shiny) shinies FROM poke_caught WHERE user_id=?').get(row.user_id);
    const best=strongest(row.user_id);
    await say(ch.id,'📕 '+(target?row.login:who)+': '+st.uniq+'/151 Pokédex · '+st.total+' caught · '+(st.shinies||0)+' shiny'+(best?' · Strongest: '+label(DEX[best.dex-1],best.shiny,best.level):''));return true;
   }
   case '!poketop':{
    const rows=db.prepare('SELECT t.login,COUNT(DISTINCT c.dex) n FROM poke_caught c JOIN poke_trainers t ON t.user_id=c.user_id GROUP BY c.user_id ORDER BY n DESC LIMIT 5').all();
    await say(ch.id,rows.length?'🏅 Top trainers: '+rows.map((r,i)=>(i+1)+'. '+r.login+' ('+r.n+'/151)').join(' · '):'Nobody has caught anything yet!');return true;
   }
   case '!pokecandy':{
    const p=byName(parts.slice(1).join(' '));
    if(!p){await say(ch.id,'@'+who+' usage: !pokecandy <pokemon name>');return true}
    const mon=db.prepare('SELECT id,level,shiny FROM poke_caught WHERE user_id=? AND dex=? ORDER BY level DESC LIMIT 1').get(uid,p.dex);
    if(!mon){await say(ch.id,'@'+who+' you haven\'t caught a '+p.name+' yet.');return true}
    if(mon.level>=100){await say(ch.id,'@'+who+' your '+p.name+' is already Lv 100!');return true}
    if(!take(uid,'rarecandy')){await say(ch.id,'@'+who+' you have no Rare Candy. !pokebuy rarecandy');return true}
    db.prepare('UPDATE poke_caught SET level=level+1 WHERE id=?').run(mon.id);
    await say(ch.id,'🍬 '+who+'\'s '+label(p,mon.shiny)+' grew to Lv '+(mon.level+1)+'!');return true;
   }
   case '!pokelure':case '!pokespawn':{
    if(cmd==='!pokespawn'&&!isMod)return true;
    if(spawns.has(ch.id)){await say(ch.id,'@'+who+' a wild Pokémon is already here! !pokecatch it');return true}
    if(cmd==='!pokelure'&&!take(uid,'lure')){await say(ch.id,'@'+who+' you have no Lures. !pokebuy lure');return true}
    await spawn(ch.id,ch.login,cmd==='!pokelure'?'lure':'mod');return true;
   }
   case '!pokeraidstart':{
    if(arg==='global'&&isOperator(uid)){try{await startGlobalRaid(who)}catch(err){await say(ch.id,'Global raid: '+err.message)}return true}
    if(!isMod)return true;
    if(raidFor(ch.id)){await say(ch.id,'A raid is already running here! !pokeraid to attack');return true}
    await startRaid({channels:[ch.id],global:false,starter:who});return true;
   }
   case '!pokeraid':{
    const raid=raidFor(ch.id);
    if(!raid){await say(ch.id,'@'+who+' no raid right now. Watch for 🌍 Global Raids!');return true}
    const key=uid+':'+raid.boss.dex+':'+raid.ends,now=Date.now();
    if((attackCooldown.get(key)||0)>now)return true;
    attackCooldown.set(key,now+15000);
    if(attackCooldown.size>5000)for(const [k,t] of attackCooldown)if(t<now)attackCooldown.delete(k);
    const best=strongest(uid);
    const base=best?Math.round((20+best.level*2)*TIERS[DEX[best.dex-1].tier].power):15;
    const crit=chance(0.1),dmg=Math.min(raid.hp,Math.round((base+rand(21))*(crit?2:1)));
    raid.hp-=dmg;
    const p=raid.players.get(uid)||{login:who,channel:ch.id,damage:0};p.damage+=dmg;raid.players.set(uid,p);
    const pct=Math.round(raid.hp/raid.maxHp*100);
    if(raid.hp<=0){await endRaid(raid,true);return true}
    const mark=[75,50,25].find(m=>pct<=m&&!raid.marks.has(m));
    if(mark){raid.marks.add(mark);for(const c of raid.channels)await say(c,'⚔️ '+raid.boss.name+' is down to '+pct+'% HP! ('+raid.players.size+' trainer'+(raid.players.size===1?'':'s')+' attacking)').catch(()=>{})}
    else await say(ch.id,(crit?'💥 CRITICAL! ':'⚔️ ')+who+(best?'\'s '+DEX[best.dex-1].name:'')+' hit '+raid.boss.name+' for '+dmg+' damage! ('+raid.hp+'/'+raid.maxHp+' HP)');
    return true;
   }
  }
  return false;
 }

 // ---- dashboard API ----
 app.get('/api/pokemon',withUser,access.channelOnly('editor'),(req,res)=>{
  const s=settings(req.channelId),raid=raidFor(req.channelId);
  res.set('Cache-Control','no-store').json({settings:{enabled:Boolean(s.enabled),spawn_minutes:s.spawn_minutes,global_raids:Boolean(s.global_raids)},
   spawn:spawns.get(req.channelId)?{name:spawns.get(req.channelId).p.name}:null,
   raid:raid?{boss:raid.boss.name,hp:raid.hp,max:raid.maxHp,global:raid.global,players:raid.players.size}:null,
   events:db.prepare('SELECT kind,detail,created FROM poke_events WHERE channel=? ORDER BY id DESC LIMIT 30').all(req.channelId),
   top:db.prepare('SELECT t.login,COUNT(DISTINCT c.dex) uniq,COUNT(*) total FROM poke_caught c JOIN poke_trainers t ON t.user_id=c.user_id WHERE c.channel=? GROUP BY c.user_id ORDER BY uniq DESC LIMIT 10').all(req.channelId),
   operator:isOperator(req.session.uid),autoGlobalRaidHours:autoHours});
 });
 app.post('/api/pokemon',withUser,access.channelOnly('bot_supervisor'),csrf,(req,res)=>{
  const {enabled,global_raids}=req.body||{},m=Number(req.body?.spawn_minutes);
  if(typeof enabled!=='boolean'||typeof global_raids!=='boolean'||!Number.isInteger(m)||m<3||m>180)return res.status(400).json({error:'Invalid Pokémon settings (spawn every 3–180 minutes)'});
  db.prepare('INSERT INTO poke_settings(channel,enabled,spawn_minutes,global_raids) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,spawn_minutes=excluded.spawn_minutes,global_raids=excluded.global_raids').run(req.channelId,enabled?1:0,m,global_raids?1:0);
  log(req.channelId,'pokemon-config',(enabled?'enabled':'disabled')+' every '+m+'m');res.json({ok:true});
 });
 app.post('/api/pokemon/spawn',withUser,access.channelOnly('bot_supervisor'),csrf,async(req,res)=>{
  if(!settings(req.channelId).enabled)return res.status(409).json({error:'Enable the Pokémon game first'});
  if(spawns.has(req.channelId))return res.status(409).json({error:'A Pokémon is already spawned'});
  const ch=db.prepare('SELECT login FROM channels WHERE id=?').get(req.channelId);
  try{await spawn(req.channelId,ch?.login||'','mod');res.json({ok:true})}catch(err){res.status(400).json({error:err.message})}
 });
 app.post('/api/pokemon/raid',withUser,access.channelOnly('bot_supervisor'),csrf,async(req,res)=>{
  if(!settings(req.channelId).enabled)return res.status(409).json({error:'Enable the Pokémon game first'});
  if(raidFor(req.channelId))return res.status(409).json({error:'A raid is already running'});
  try{await startRaid({channels:[req.channelId],global:false,starter:'dashboard'});res.json({ok:true})}catch(err){res.status(400).json({error:err.message})}
 });
 app.post('/api/admin/pokemon/global-raid',withUser,csrf,async(req,res)=>{
  if(!isOperator(req.session.uid))return res.status(403).json({error:'Operator access required'});
  try{const r=await startGlobalRaid('operator');res.json({ok:true,boss:r.boss.name,channels:r.channels.size})}catch(err){res.status(409).json({error:err.message})}
 });
 return {onMessage,reserved:[...COMMANDS].map(c=>c.slice(1))};
}
