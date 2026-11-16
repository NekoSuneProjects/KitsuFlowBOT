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
 // Interaction commands: !name @user (or no target for a self/chat version)
 pat:{level:'everyone',perUser:true,description:'Headpat someone: !pat @user'},
 boop:{level:'everyone',perUser:true,description:'Boop someone on the nose: !boop @user'},
 bonk:{level:'everyone',perUser:true,description:'Bonk someone: !bonk @user'},
 slap:{level:'everyone',perUser:true,description:'Slap someone with a random object: !slap @user'},
 highfive:{level:'everyone',perUser:true,description:'High five someone: !highfive @user'},
 cuddle:{level:'everyone',perUser:true,description:'Cuddle someone: !cuddle @user'},
 poke:{level:'everyone',perUser:true,description:'Poke someone: !poke @user'},
 wave:{level:'everyone',perUser:true,description:'Wave at someone or chat: !wave @user'},
 cookie:{level:'everyone',perUser:true,description:'Give someone a cookie (counted): !cookie @user'},
 fight:{level:'everyone',perUser:true,description:'Fight someone, random winner (no points): !fight @user'},
 // Rating / random fun
 ship:{level:'everyone',perUser:true,description:'Ship two people: !ship @a @b'},
 rate:{level:'everyone',perUser:true,description:'Rate anything out of 10: !rate pineapple pizza'},
 vibecheck:{level:'everyone',perUser:true,description:'Vibe check yourself or someone'},
 iq:{level:'everyone',perUser:true,description:'Totally scientific IQ test'},
 howcute:{level:'everyone',perUser:true,description:'How cute is someone? !howcute @user'},
 rizz:{level:'everyone',perUser:true,description:'Check your rizz level'},
 choose:{level:'everyone',perUser:true,description:'Let the bot choose: !choose pizza | burger | sushi'},
 fortune:{level:'everyone',perUser:true,description:'Get a fortune cookie message'},
 joke:{level:'everyone',perUser:true,description:'Tell a random clean joke'},
 compliment:{level:'everyone',perUser:true,description:'Compliment someone: !compliment @user'},
 wyr:{level:'everyone',perUser:true,description:'Random "would you rather" question'},
 hydrate:{level:'everyone',description:'Remind the streamer to drink water'},
 hypetrain:{level:'everyone',perUser:true,description:'Hop on the chat hype train'},
 // Leaderboards and games
 topwatch:{level:'everyone',description:'Top 5 viewers by estimated watch time'},
 topcookies:{level:'everyone',description:'Top 5 cookie collectors'},
 trivia:{level:'everyone',description:'Start a trivia question; first correct answer in chat wins points'},
 heist:{level:'everyone',perUser:true,defaultOff:true,description:'Start or join a heist: !heist 100 (60s to join, survivors double their bet)'},
 permit:{level:'moderator',description:'Allow a viewer to post one link within 60 seconds: !permit @user'},
 randomviewer:{level:'moderator',description:'Pick a random recently active chatter'}
};

const rand=n=>crypto.randomInt(n);
// Twitch display name (e.g. NekoSuneVR); fall back to login for localised names so @mentions still work.
export const displayName=e=>/^[A-Za-z0-9_]{1,25}$/.test(e.chatter_user_name||'')?e.chatter_user_name:(e.chatter_user_login||'viewer');
const pick=list=>list[rand(list.length)];
const EIGHTBALL=['It is certain.','Without a doubt.','Yes, definitely.','You may rely on it.','Most likely.','Outlook good.','Signs point to yes.','Reply hazy, try again.','Ask again later.','Cannot predict now.','Concentrate and ask again.','Don\'t count on it.','My reply is no.','My sources say no.','Outlook not so good.','Very doubtful.'];
const SLAP_ITEMS=['a large trout 🐟','a rubber chicken 🐔','a wet noodle 🍜','a pillow ☁️','a fluffy tail 🦊','a baguette 🥖','a keyboard ⌨️','a VR controller 🎮'];
const FORTUNES=['A surprise clip is in your future.','Your next game will be a win.','Someone in chat is thinking of you right now.','Today is a good day to hydrate.','You will find a rare drop soon.','Good things come to those who lurk.','A new friend will join your party.','Your patience will be rewarded with loot.','The RNG gods smile upon you today.','Take a break, stretch, then conquer.'];
const JOKES=['Why did the gamer bring a ladder? To reach the next level.','I would tell you a UDP joke, but you might not get it.','Why do programmers prefer dark mode? Because light attracts bugs.','What do you call a fox that streams? A Twitch-y tail.','Why was the computer cold? It left its Windows open.','How does a VRChat avatar say goodbye? "See you in another world!"','Why did the controller go to therapy? Too many issues with its buttons.','What\'s a skeleton\'s least favourite room? The living room.','Why did the scarecrow win an award? He was outstanding in his field.','I told my PC I needed a break, and it said "No problem, I\'ll go to sleep."'];
const COMPLIMENTS=['you light up this chat ✨','your vibes are immaculate','you have excellent taste in streams','you make the community better just by being here','your aim is probably cracked','you are a certified legend','you deserve a cookie and a nap','your energy is contagious'];
const WYR=['Would you rather only play one game forever or never replay a game?','Would you rather have infinite lag or 1 FPS?','Would you rather be able to fly or be invisible?','Would you rather fight 100 duck-sized horses or 1 horse-sized duck?','Would you rather lose all your saves or your favourite headset?','Would you rather always speak in rhymes or always sing instead of talk?','Would you rather live in VRChat or Minecraft?','Would you rather have a pet dragon or a pet fox?'];
const VIBES=['immaculate ✨','chaotic but fun 🌀','cosy and warm ☕','suspiciously sleepy 😴','pure gamer energy 🎮','certified wholesome 💖','unhinged (affectionate) 🤪','main character energy 🌟'];
// {user} and {channel} are filled in. Keep these friendly and short.
const LURK=[
 '{user} is now lurking in the shadows. Enjoy the stream! 👀',
 '{user} grabbed a snack and a blanket — lurk mode activated 🍿',
 '{user} has gone into stealth mode. We still love you! 💜',
 '{user} is lurking. Thanks for keeping the stream company! 🦊',
 '{user} turned invisible... but the view count remembers 👻',
 '{user} is lurking like a pro. Enjoy, and come say hi anytime! 👋',
 '{user} curled up in the corner of the stream. Comfy lurk! 🛋️',
 '{user} is off to lurk-land. Every lurk helps {channel}, thank you! 🙏',
 '{user} slipped behind the curtain. Lurk responsibly and stay hydrated 💧',
 '{user} has entered the lurk zone. Have fun, wherever you are! 🌙',
 '{user} is now a professional lurker. Pay is in good vibes ✨',
 '{user} put on their lurking ears. Listening quietly 🎧',
 '{user} has become one with the background. Peaceful lurking! 🍃',
 '{user} is lurking! Tail wags from {channel} 🦊💜'
];
const UNLURK=[
 'Welcome back from the shadows, {user}! 👋',
 '{user} has returned from the lurk dimension! 🌀',
 'Look who it is! {user} is back 🎉',
 '{user} came out of hiding — hi hi! 💜',
 'The lurker awakens! Welcome back, {user} ✨',
 '{user} is back in chat. We missed you! 🦊',
 '{user} re-entered the chat. Lurk complete! ✅'
];
// [question, accepted answers]. Answers are matched case-insensitively, ignoring punctuation.
const TRIVIA=[
 ['How many sides does a hexagon have?',['6','six']],
 ['What is the largest planet in our solar system?',['jupiter']],
 ['What colour do you get by mixing blue and yellow?',['green']],
 ['How many legs does a spider have?',['8','eight']],
 ['What is the chemical symbol for gold?',['au']],
 ['What is the capital of Japan?',['tokyo']],
 ['Which planet is known as the Red Planet?',['mars']],
 ['How many minutes are in an hour?',['60','sixty']],
 ['What is the freezing point of water in Celsius?',['0','zero']],
 ['What is the fastest land animal?',['cheetah']],
 ['How many continents are there?',['7','seven']],
 ['What gas do plants absorb from the air?',['carbon dioxide','co2']],
 ['What is the largest ocean on Earth?',['pacific','pacific ocean']],
 ['In Minecraft, which mob explodes when it gets close to you?',['creeper','a creeper']],
 ['What company makes the Quest VR headsets?',['meta','oculus']],
 ['What is the name of Mario\'s brother?',['luigi']],
 ['In Pac-Man, what do you eat to make the ghosts turn blue?',['power pellet','power pellets','pellet']],
 ['What colour is Sonic the Hedgehog?',['blue']],
 ['Which game features the Battle Bus?',['fortnite']],
 ['What is the main currency in Fortnite called?',['vbucks','v bucks','v-bucks']],
 ['How many players are on a football (soccer) team on the pitch?',['11','eleven']],
 ['What do bees make?',['honey']],
 ['What is the hardest natural substance?',['diamond','diamonds']],
 ['How many hours are in a day?',['24','twenty four']],
 ['What is the boiling point of water in Celsius?',['100','one hundred']],
 ['What is the tallest animal in the world?',['giraffe']],
 ['Which animal is known as the king of the jungle?',['lion']],
 ['What is 7 x 8?',['56','fifty six']],
 ['What is 12 x 12?',['144']],
 ['What is the square root of 81?',['9','nine']],
 ['Which ocean lies between Europe and North America?',['atlantic','atlantic ocean']],
 ['What is the capital of France?',['paris']],
 ['What is the capital of Australia?',['canberra']],
 ['How many strings does a standard guitar have?',['6','six']],
 ['What is the closest star to Earth?',['sun','the sun']],
 ['What fruit is famous for keeping the doctor away?',['apple','an apple']],
 ['In The Legend of Zelda, what is the name of the hero you play?',['link']],
 ['In Tetris, how many blocks make up each piece?',['4','four']],
 ['What does "GG" stand for in gaming?',['good game']],
 ['What does "AFK" stand for?',['away from keyboard']]
];
const norm=t=>String(t).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const fill=(line,who,channel)=>line.replaceAll('{user}',who).replaceAll('{channel}',channel);
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
 const duels=new Map();
 db.exec('CREATE TABLE IF NOT EXISTS fun_cookies(channel TEXT NOT NULL,user_id TEXT NOT NULL,login TEXT NOT NULL,cookies INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(channel,user_id))');
 const hype=new Map();
 const trivias=new Map(); // channel -> {q,answers,expires,timer}
 const triviaCooldown=new Map();
 const heists=new Map(); // channel -> {crew:Map(user->{login,amount}),timer}
 const heistCooldown=new Map();
 const TRIVIA_REWARD=50,TRIVIA_SECONDS=30,HEIST_JOIN=60000,HEIST_COOLDOWN=300000;
 const lurkers=new Map(); // channel:user -> lurk start (in memory; resets on restart) // channel -> {riders:Set,expires}
 // Stable pseudo-random % for a pair/name, so !ship a b gives the same answer each time.
 const seeded=(...keys)=>crypto.createHash('sha256').update(keys.map(k=>String(k).toLowerCase()).sort().join('|')).digest().readUInt32BE(0);
 const ACTIONS={
  pat:[t=>'gives '+t+' gentle headpats 🫳',()=>'pats everyone in chat 🫳'],
  boop:[t=>'boops '+t+' on the nose! 👉👃',()=>'boops the air... it boops back 👉'],
  bonk:[t=>'bonks '+t+'! 🔨 Go to nap time.',()=>'bonks themselves. Ouch 🔨'],
  highfive:[t=>'high fives '+t+'! ✋',()=>'high fives chat! ✋'],
  cuddle:[t=>'cuddles up with '+t+' 🫂',()=>'wraps chat in a big cuddle 🫂'],
  poke:[t=>'pokes '+t+' 👉',()=>'pokes the streamer 👉'],
  wave:[t=>'waves at '+t+' 👋',()=>'waves at everyone in chat 👋']
 }; // channel:targetId -> {from,fromLogin,amount,expires}

 async function bet(ch,e,raw,name){
  const who=displayName(e),have=balance(ch.id,e.chatter_user_id),amount=parseBet(raw,have);
  if(amount===null||amount<1){await say(ch.id,'@'+who+' usage: !'+name+' amount | all | 50% (you have '+have+' points)');return null}
  if(amount>have||!debit.run(amount,ch.id,e.chatter_user_id,amount).changes){await say(ch.id,'@'+who+' you only have '+have+' points.');return null}
  return amount;
 }
 const pay=(ch,e,amount)=>adjust.run(ch.id,e.chatter_user_id,e.chatter_user_login,amount);

 async function finishHeist(ch,h){
  heists.delete(ch.id);heistCooldown.set(ch.id,Date.now()+HEIST_COOLDOWN);
  const crew=[...h.crew.entries()],n=crew.length;
  // Bigger crews are a bit safer, capped so it stays a gamble.
  const survive=Math.min(0.65,0.40+0.05*(n-1));
  const winners=[],lost=[];
  db.transaction(()=>{for(const [id,m] of crew){if(crypto.randomInt(10000)<survive*10000){adjust.run(ch.id,id,m.login,m.amount*2);winners.push(m.login+' (+'+m.amount+')')}else lost.push(m.login)}})();
  const story=winners.length===n?'🎉 Flawless heist! The whole crew escaped with the loot!':winners.length?'🚓 The alarms went off, but some of the crew got away!':'🚨 The cops caught everyone. The loot is gone!';
  let msg=story+(winners.length?' Escaped: '+winners.join(', '):'');
  if(msg.length>470)msg=msg.slice(0,467)+'...';
  await say(ch.id,msg);
 }
 // Called for every non-command chat message (trivia answers).
 async function onChat(ch,e,text){
  const round=trivias.get(ch.id);if(!round||!text||text.startsWith('!'))return false;
  if(!round.answers.includes(norm(text)))return false;
  trivias.delete(ch.id);clearTimeout(round.timer);triviaCooldown.set(ch.id,Date.now()+60000);
  const who=displayName(e);
  adjust.run(ch.id,e.chatter_user_id,e.chatter_user_login,TRIVIA_REWARD);
  await say(ch.id,'✅ '+who+' got it! The answer was "'+round.answer+'" — +'+TRIVIA_REWARD+' points!');
  return true;
 }
 const run=async function run(name,{ch,e,parts}){
  const who=displayName(e),target=(parts[1]||'').replace(/^@/,'');
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
   case 'lurk':{
    lurkers.set(ch.id+':'+e.chatter_user_id,Date.now());
    if(lurkers.size>5000)for(const [k,t] of lurkers)if(t<Date.now()-86400000)lurkers.delete(k);
    return say(ch.id,fill(pick(LURK),who,ch.login));
   }
   case 'unlurk':{
    const key=ch.id+':'+e.chatter_user_id,since=lurkers.get(key);lurkers.delete(key);
    const mins=since?Math.floor((Date.now()-since)/60000):0;
    const away=!since?'':mins<1?' (that was a quick lurk!)':mins<60?' (lurked for '+mins+' min)':' (lurked for '+Math.floor(mins/60)+'h '+(mins%60)+'m)';
    return say(ch.id,fill(pick(UNLURK),who,ch.login)+away);
   }
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
   case 'pat':case 'boop':case 'bonk':case 'highfive':case 'cuddle':case 'poke':case 'wave':{
    const [withTarget,alone]=ACTIONS[name];
    return say(ch.id,who+' '+(target&&target.toLowerCase()!==who.toLowerCase()?withTarget(target):alone()));
   }
   case 'slap':return say(ch.id,target?who+' slaps '+target+' around a bit with '+pick(SLAP_ITEMS)+'!':who+' slaps the air with '+pick(SLAP_ITEMS)+'. Nobody is impressed.');
   case 'cookie':{
    if(!target)return say(ch.id,'@'+who+' usage: !cookie @user');
    const user=await resolveViewer(target);if(!user)return say(ch.id,'Viewer not found.');
    if(user.id===e.chatter_user_id)return say(ch.id,'@'+who+' no eating your own cookies! 🍪');
    db.prepare('INSERT INTO fun_cookies(channel,user_id,login,cookies) VALUES(?,?,?,1) ON CONFLICT(channel,user_id) DO UPDATE SET login=excluded.login,cookies=fun_cookies.cookies+1').run(ch.id,user.id,user.login);
    const n=db.prepare('SELECT cookies FROM fun_cookies WHERE channel=? AND user_id=?').get(ch.id,user.id).cookies;
    return say(ch.id,who+' gave '+user.login+' a cookie 🍪 They now have '+n+' cookie'+(n===1?'':'s')+'!');
   }
   case 'fight':{
    if(!target||target.toLowerCase()===who.toLowerCase())return say(ch.id,'@'+who+' usage: !fight @user');
    const moves=['a flying kick','a pillow barrage','a critical hit','a sneaky backstab','the ultimate tail whip','a perfectly timed parry'];
    const [winner,loser]=rand(2)?[who,target]:[target,who];
    return say(ch.id,'🥊 '+winner+' defeats '+loser+' with '+pick(moves)+'!');
   }
   case 'ship':{
    const a=(parts[1]||'').replace(/^@/,''),b=(parts[2]||'').replace(/^@/,'')||who;
    if(!a||a.toLowerCase()===b.toLowerCase())return say(ch.id,'@'+who+' usage: !ship @user1 @user2');
    const pct=seeded('ship',a,b)%101,name=a.slice(0,Math.ceil(a.length/2))+b.slice(Math.floor(b.length/2));
    return say(ch.id,'💘 '+a+' + '+b+' = '+name+' — '+pct+'% compatible'+(pct>=90?' 💍':pct>=60?' 💕':pct>=30?' 🙂':' 💔'));
   }
   case 'rate':{
    const thing=parts.slice(1).join(' ').trim().slice(0,80);if(!thing)return say(ch.id,'@'+who+' usage: !rate something');
    return say(ch.id,'@'+who+' I rate '+thing+' a '+(seeded('rate',thing)%11)+'/10');
   }
   case 'vibecheck':return say(ch.id,'✅ Vibe check on '+(target||who)+': '+pick(VIBES));
   case 'iq':return say(ch.id,'🧠 '+(target||who)+' has an IQ of '+(seeded('iq',target||who,new Date().toDateString())%200+1)+' today.');
   case 'howcute':return say(ch.id,'🥰 '+(target||who)+' is '+(seeded('cute',target||who,new Date().toDateString())%101)+'% cute today.');
   case 'rizz':return say(ch.id,'😎 '+(target||who)+' has '+(seeded('rizz',target||who,new Date().toDateString())%101)+'% rizz today.');
   case 'choose':{
    const options=parts.slice(1).join(' ').split(/\s*(?:\||,|\bor\b)\s*/i).map(x=>x.trim()).filter(Boolean).slice(0,20);
    if(options.length<2)return say(ch.id,'@'+who+' usage: !choose pizza | burger | sushi');
    return say(ch.id,'🤔 @'+who+' I choose: '+pick(options).slice(0,80));
   }
   case 'fortune':return say(ch.id,'🥠 @'+who+' '+pick(FORTUNES));
   case 'joke':return say(ch.id,'😂 '+pick(JOKES));
   case 'compliment':return say(ch.id,'💖 '+(target||who)+', '+pick(COMPLIMENTS));
   case 'wyr':return say(ch.id,'🤷 '+pick(WYR));
   case 'hydrate':return say(ch.id,'💧 '+who+' reminds '+ch.login+' to drink some water! Stay hydrated, chat 💦');
   case 'hypetrain':{
    let h=hype.get(ch.id);const now=Date.now();
    if(!h||h.expires<now){h={riders:new Set(),expires:0};hype.set(ch.id,h)}
    if(h.riders.has(e.chatter_user_id))return;
    h.riders.add(e.chatter_user_id);h.expires=now+120000;
    const n=h.riders.size;
    return say(ch.id,n===1?'🚂 '+who+' started a chat hype train! Type !hypetrain to hop on (2 min)':'🚂 '+who+' hopped on! The hype train has '+n+' riders'+(n%5===0?' 🔥🔥🔥':'')+'!');
   }
   case 'topwatch':{
    const rows=db.prepare('SELECT username,watch_minutes FROM loyalty WHERE channel=? AND watch_minutes>0 ORDER BY watch_minutes DESC LIMIT 5').all(ch.id);
    const fmt=m=>m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m';
    return say(ch.id,rows.length?'⏱️ Top watch time: '+rows.map((r,i)=>(i+1)+'. '+r.username+' ('+fmt(r.watch_minutes)+')').join(' · '):'No watch time tracked yet. Turn on loyalty points to start tracking.');
   }
   case 'topcookies':{
    const rows=db.prepare('SELECT login,cookies FROM fun_cookies WHERE channel=? ORDER BY cookies DESC LIMIT 5').all(ch.id);
    return say(ch.id,rows.length?'🍪 Top cookie collectors: '+rows.map((r,i)=>(i+1)+'. '+r.login+' ('+r.cookies+')').join(' · '):'No cookies given yet. Try !cookie @user');
   }
   case 'trivia':{
    const now=Date.now(),open=trivias.get(ch.id);
    if(open)return say(ch.id,'❓ Trivia in progress: '+open.q);
    if((triviaCooldown.get(ch.id)||0)>now)return say(ch.id,'@'+who+' next trivia in '+Math.ceil((triviaCooldown.get(ch.id)-now)/1000)+'s.');
    const [q,answers]=pick(TRIVIA);
    const round={q,answer:answers[0],answers:answers.map(norm)};
    round.timer=setTimeout(()=>{if(trivias.get(ch.id)!==round)return;trivias.delete(ch.id);triviaCooldown.set(ch.id,Date.now()+60000);void say(ch.id,'⌛ Time\'s up! The answer was: '+answers[0]).catch(()=>{})},TRIVIA_SECONDS*1000);
    round.timer.unref?.();
    trivias.set(ch.id,round);
    return say(ch.id,'❓ TRIVIA ('+TRIVIA_SECONDS+'s, '+TRIVIA_REWARD+' points): '+q+' — type your answer in chat!');
   }
   case 'heist':{
    const now=Date.now();let h=heists.get(ch.id);
    if(!h&&(heistCooldown.get(ch.id)||0)>now)return say(ch.id,'@'+who+' the crew is laying low. Next heist in '+Math.ceil((heistCooldown.get(ch.id)-now)/60000)+' min.');
    if(h?.crew.has(e.chatter_user_id))return say(ch.id,'@'+who+' you\'re already in the crew!');
    const amount=await bet(ch,e,parts[1],'heist');if(amount===null)return;
    if(!h){
     h={crew:new Map()};heists.set(ch.id,h);
     h.timer=setTimeout(()=>{void finishHeist(ch,h).catch(err=>log(ch.id,'heist-error',err.message))},HEIST_JOIN);h.timer.unref?.();
     h.crew.set(e.chatter_user_id,{login:who,amount});
     return say(ch.id,'💰 '+who+' is planning a heist on the KitsuFlow Bank! Type !heist <points> in the next 60 seconds to join the crew.');
    }
    h.crew.set(e.chatter_user_id,{login:who,amount});
    return say(ch.id,'💰 '+who+' joined the heist with '+amount+' points. Crew size: '+h.crew.size);
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
 return Object.assign(run,{onChat});
}
