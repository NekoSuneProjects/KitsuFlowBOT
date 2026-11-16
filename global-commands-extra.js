// StreamElements-style global commands. Each entry shows up automatically in the
// Studio "Global commands" list where the channel can toggle it on/off.
// level: everyone | moderator | supermod. perUser: cooldown is per viewer, not per channel.
// defaultOff: disabled until the channel enables it (points games, like StreamElements).
import crypto from 'node:crypto';

export const EXTRA_COMMANDS={
 game:{level:'everyone',description:'Show the current stream category'},
 title:{level:'everyone',description:'Show the current stream title'},
 viewers:{level:'everyone',description:'Show the current viewer count'},
 followers:{level:'everyone',description:'Show the channel follower count'},
 subcount:{level:'everyone',description:'Show the channel subscriber count'},
 lurk:{level:'everyone',perUser:true,description:'Let the streamer know you are lurking'},
 unlurk:{level:'everyone',perUser:true,description:'Announce you are back from lurking'},
 hug:{level:'everyone',perUser:true,description:'Hug another viewer: !hug @user'},
 love:{level:'everyone',perUser:true,description:'Love meter between you and someone: !love @user'},
 '8ball':{level:'everyone',perUser:true,description:'Ask the magic 8-ball a question'},
 roll:{level:'everyone',perUser:true,description:'Roll dice: !roll, !roll 20 or !roll 2d6'},
 coinflip:{level:'everyone',perUser:true,description:'Flip a coin'},
 rps:{level:'everyone',perUser:true,description:'Rock paper scissors: !rps rock'},
 givepoints:{level:'everyone',perUser:true,description:'Give some of your points to another viewer: !givepoints @user 100'},
 gamble:{level:'everyone',perUser:true,defaultOff:true,description:'Gamble points: !gamble 100 | all | 50%'},
 roulette:{level:'everyone',perUser:true,defaultOff:true,description:'50/50 double or nothing: !roulette 100'},
 slots:{level:'everyone',perUser:true,defaultOff:true,description:'Spin the slot machine: !slots 50'},
 duel:{level:'everyone',perUser:true,defaultOff:true,description:'Challenge a viewer: !duel @user 100, they reply !accept or !deny'},
 accept:{level:'everyone',perUser:true,defaultOff:true,hidden:true,description:'Accept a pending duel'},
 deny:{level:'everyone',perUser:true,defaultOff:true,hidden:true,description:'Decline a pending duel'},
 permit:{level:'moderator',description:'Allow a viewer to post one link within 60 seconds: !permit @user'},
 randomviewer:{level:'moderator',description:'Pick a random recently active chatter'}
};

const rand=n=>crypto.randomInt(n);
const pick=list=>list[rand(list.length)];
const EIGHTBALL=['It is certain.','Without a doubt.','Yes, definitely.','You may rely on it.','Most likely.','Outlook good.','Signs point to yes.','Reply hazy, try again.','Ask again later.','Cannot predict now.','Concentrate and ask again.','Don\'t count on it.','My reply is no.','My sources say no.','Outlook not so good.','Very doubtful.'];
const SLOTS=['🍒','🍋','🍇','🔔','⭐','💎'];

export function createExtraCommands({db,api,say,resolveViewer,recentChatters,permits,log}){
 const balance=(channel,user)=>db.prepare('SELECT points FROM loyalty WHERE channel=? AND user_id=?').get(channel,user)?.points||0;
 const adjust=db.prepare(`INSERT INTO loyalty(channel,user_id,username,points,watch_minutes) VALUES(?,?,?,?,0)
  ON CONFLICT(channel,user_id) DO UPDATE SET username=excluded.username,points=MAX(0,MIN(1000000000,loyalty.points+excluded.points))`);
 // Debit only if the viewer still has enough (atomic, so double-spending via spam is impossible).
 const debit=db.prepare('UPDATE loyalty SET points=points-? WHERE channel=? AND user_id=? AND points>=?');
 const parseBet=(raw,have)=>{
  const s=String(raw||'').toLowerCase().trim();
  if(s==='all')return have;
  const pct=/^(\d{1,3})%$/.exec(s);if(pct){const p=Number(pct[1]);return p>=1&&p<=100?Math.floor(have*p/100):null}
  const n=Number(s);return Number.isSafeInteger(n)&&n>0?n:null;
 };
 const duels=new Map(); // channel:targetId -> {from,fromLogin,amount,expires}

 async function bet(ch,e,raw,name){
  const who=e.chatter_user_login,have=balance(ch.id,e.chatter_user_id),amount=parseBet(raw,have);
  if(amount===null||amount<1){await say(ch.id,'@'+who+' usage: !'+name+' amount | all | 50% (you have '+have+' points)');return null}
  if(amount>have||!debit.run(amount,ch.id,e.chatter_user_id,amount).changes){await say(ch.id,'@'+who+' you only have '+have+' points.');return null}
  return amount;
 }
 const pay=(ch,e,amount)=>adjust.run(ch.id,e.chatter_user_id,e.chatter_user_login,amount);

 return async function run(name,{ch,e,parts}){
  const who=e.chatter_user_login,target=(parts[1]||'').replace(/^@/,'');
  const stream=async()=>(await api(ch.id,'streams?user_id='+encodeURIComponent(ch.id))).data?.[0]||null;
  const channelInfo=async()=>(await api(ch.id,'channels?broadcaster_id='+encodeURIComponent(ch.id))).data?.[0]||{};
  switch(name){
   case 'game':{const c=await channelInfo();return say(ch.id,c.game_name?ch.login+' is playing '+c.game_name+'.':'No category set.')}
   case 'title':{const c=await channelInfo();return say(ch.id,c.title?'Title: '+c.title:'No stream title set.')}
   case 'viewers':{const s=await stream();return say(ch.id,s?ch.login+' has '+s.viewer_count+' viewers right now.':'The stream is offline.')}
   case 'followers':{
    try{const f=await api(ch.id,'channels/followers?broadcaster_id='+encodeURIComponent(ch.id)+'&first=1');return say(ch.id,ch.login+' has '+Number(f.total||0).toLocaleString('en-GB')+' followers.')}
    catch{return say(ch.id,'Follower count unavailable: the broadcaster must reconnect Twitch with follower permissions.')}
   }
   case 'subcount':{
    try{const s=await api(ch.id,'subscriptions?broadcaster_id='+encodeURIComponent(ch.id)+'&first=1');return say(ch.id,ch.login+' has '+Number(s.total||0).toLocaleString('en-GB')+' subscribers.')}
    catch{return say(ch.id,'Sub count unavailable: needs an affiliate/partner channel and subscription permissions.')}
   }
   case 'lurk':return say(ch.id,who+' is now lurking in the shadows. Enjoy the stream! 👀');
   case 'unlurk':return say(ch.id,'Welcome back from the shadows, '+who+'! 👋');
   case 'hug':return say(ch.id,target?who+' gives '+target+' a big warm hug! 🤗':who+' hugs everyone in chat! 🤗');
   case 'love':{if(!target)return say(ch.id,'@'+who+' usage: !love @user');return say(ch.id,'There\'s '+rand(101)+'% love between '+who+' and '+target+' ❤️')}
   case '8ball':{if(parts.length<2)return say(ch.id,'@'+who+' ask the 8-ball a question: !8ball will I win?');return say(ch.id,'🎱 @'+who+' '+pick(EIGHTBALL))}
   case 'coinflip':return say(ch.id,'🪙 @'+who+' flipped '+(rand(2)?'Heads':'Tails')+'!');
   case 'roll':{
    const dice=/^(\d{1,2})d(\d{1,4})$/i.exec(parts[1]||'');
    if(dice){const count=Math.min(20,Math.max(1,Number(dice[1]))),sides=Math.min(1000,Math.max(2,Number(dice[2])));const rolls=Array.from({length:count},()=>1+rand(sides));return say(ch.id,'🎲 @'+who+' rolled '+rolls.join(', ')+(count>1?' (total '+rolls.reduce((a,b)=>a+b,0)+')':''))}
    const max=Math.min(1000000,Math.max(2,Number(parts[1])||6));return say(ch.id,'🎲 @'+who+' rolled '+(1+rand(max))+' (1-'+max+')');
   }
   case 'rps':{
    const moves=['rock','paper','scissors'],mine=String(parts[1]||'').toLowerCase();
    if(!moves.includes(mine))return say(ch.id,'@'+who+' usage: !rps rock | paper | scissors');
    const bot=pick(moves),res=mine===bot?'It\'s a tie!':(moves.indexOf(mine)+1)%3===moves.indexOf(bot)?'I win!':'You win!';
    return say(ch.id,'@'+who+' you chose '+mine+', I chose '+bot+'. '+res);
   }
   case 'givepoints':{
    const amount=Number(parts[2]);
    if(!target||!Number.isSafeInteger(amount)||amount<1)return say(ch.id,'@'+who+' usage: !givepoints @user amount');
    const user=await resolveViewer(target);if(!user)return say(ch.id,'Viewer not found.');
    if(user.id===e.chatter_user_id)return say(ch.id,'@'+who+' you can\'t give points to yourself.');
    const ok=db.transaction(()=>{if(!debit.run(amount,ch.id,e.chatter_user_id,amount).changes)return false;adjust.run(ch.id,user.id,user.login,amount);return true})();
    return say(ch.id,ok?who+' gave '+amount+' points to '+user.login+'.':'@'+who+' you don\'t have enough points.');
   }
   case 'gamble':{
    const amount=await bet(ch,e,parts[1],'gamble');if(amount===null)return;
    const r=1+rand(100);
    if(r>=99){pay(ch,e,amount*3);return say(ch.id,'🎰 @'+who+' rolled '+r+' — JACKPOT! Won '+amount*2+' points, now '+balance(ch.id,e.chatter_user_id)+'.')}
    if(r>=60){pay(ch,e,amount*2);return say(ch.id,'🎰 @'+who+' rolled '+r+' and won '+amount+' points, now '+balance(ch.id,e.chatter_user_id)+'.')}
    return say(ch.id,'🎰 @'+who+' rolled '+r+' and lost '+amount+' points, now '+balance(ch.id,e.chatter_user_id)+'.');
   }
   case 'roulette':{
    const amount=await bet(ch,e,parts[1],'roulette');if(amount===null)return;
    if(rand(2)){pay(ch,e,amount*2);return say(ch.id,'🎡 @'+who+' won '+amount+' points in roulette! Now '+balance(ch.id,e.chatter_user_id)+'.')}
    return say(ch.id,'🎡 @'+who+' lost '+amount+' points in roulette. Now '+balance(ch.id,e.chatter_user_id)+'.');
   }
   case 'slots':{
    const amount=await bet(ch,e,parts[1],'slots');if(amount===null)return;
    const reels=[pick(SLOTS),pick(SLOTS),pick(SLOTS)],line=reels.join(' | ');
    const mult=reels[0]===reels[1]&&reels[1]===reels[2]?(reels[0]==='💎'?10:5):(reels[0]===reels[1]||reels[1]===reels[2]||reels[0]===reels[2])?2:0;
    if(mult){pay(ch,e,amount*mult);return say(ch.id,'[ '+line+' ] @'+who+' won '+amount*(mult-1)+' points! Now '+balance(ch.id,e.chatter_user_id)+'.')}
    return say(ch.id,'[ '+line+' ] @'+who+' lost '+amount+' points. Now '+balance(ch.id,e.chatter_user_id)+'.');
   }
   case 'duel':{
    const amount=Number(parts[2]);
    if(!target||!Number.isSafeInteger(amount)||amount<1)return say(ch.id,'@'+who+' usage: !duel @user amount');
    const user=await resolveViewer(target);if(!user||user.id===e.chatter_user_id)return say(ch.id,'@'+who+' pick someone else to duel.');
    if(balance(ch.id,e.chatter_user_id)<amount)return say(ch.id,'@'+who+' you don\'t have '+amount+' points.');
    if(balance(ch.id,user.id)<amount)return say(ch.id,user.login+' doesn\'t have '+amount+' points.');
    duels.set(ch.id+':'+user.id,{from:e.chatter_user_id,fromLogin:who,amount,expires:Date.now()+120000});
    return say(ch.id,'⚔️ @'+user.login+', '+who+' challenged you to a duel for '+amount+' points! Type !accept or !deny within 2 minutes.');
   }
   case 'accept':case 'deny':{
    const key=ch.id+':'+e.chatter_user_id,d=duels.get(key);
    if(!d||d.expires<Date.now()){duels.delete(key);return}
    duels.delete(key);
    if(name==='deny')return say(ch.id,who+' declined the duel from '+d.fromLogin+'.');
    const winner=db.transaction(()=>{
     if(!debit.run(d.amount,ch.id,d.from,d.amount).changes)return null;
     if(!debit.run(d.amount,ch.id,e.chatter_user_id,d.amount).changes){adjust.run(ch.id,d.from,d.fromLogin,d.amount);return null}
     const w=rand(2)?{id:d.from,login:d.fromLogin}:{id:e.chatter_user_id,login:who};
     adjust.run(ch.id,w.id,w.login,d.amount*2);return w;
    })();
    return say(ch.id,winner?'⚔️ '+winner.login+' won the duel and takes '+d.amount+' points!':'Duel cancelled: someone no longer has enough points.');
   }
   case 'permit':{
    if(!target)return say(ch.id,'Usage: !permit @user');
    const user=await resolveViewer(target);if(!user)return say(ch.id,'Viewer not found.');
    permits.set(ch.id+':'+user.id,Date.now()+60000);log(ch.id,'permit',who+' -> '+user.login);
    return say(ch.id,'@'+user.login+' you can post one link in the next 60 seconds.');
   }
   case 'randomviewer':{
    const list=[...(recentChatters.get(ch.id)||new Map()).values()].filter(m=>Date.now()-m.last<=600000);
    return say(ch.id,list.length?'🎲 Random chatter: @'+pick(list).login:'No recently active chatters.');
   }
  }
 };
}
