// Community-maintained phishing/scam feeds. Local cached sets; never fetch per chat message.
import {domainToASCII} from 'node:url';
export const FEEDS=[
 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt',
 'https://raw.githubusercontent.com/jarelllama/Scam-Blocklist/main/lists/wildcard_domains/scams_light.txt',
 'https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.txt',
 'https://raw.githubusercontent.com/Bocon778/TwitchScamDomains/main/list.json'
];
const normalize=value=>{
 const domain=domainToASCII(String(value||'').trim().toLowerCase().replace(/\.$/,''));
 return /^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)&&!domain.split('.').some(x=>x.startsWith('-')||x.endsWith('-'))?domain:null;
};
export function createScamFilter({log}){
 let domains=new Set(),lastUpdated=0;
 async function refresh(){
  const sets=await Promise.allSettled(FEEDS.map(async url=>{
   const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('HTTP '+response.status);
   const data=await response.text();
   if(data.length>16000000)throw Error('Oversized blocklist');
   const lines=url.endsWith('.json')?JSON.parse(data):data.split(/\r?\n/),entries=new Set();
   if(!Array.isArray(lines))throw Error('Invalid feed format');
   for(const row of lines){const raw=row.trim();if(!raw||raw.startsWith('#')||raw.startsWith('!'))continue;
    const host=normalize(raw);if(host)entries.add(host);
   }
   if(entries.size<(url.endsWith('list.json')?5:100))throw Error('Feed has too few valid entries');
   return entries;
  }));
  const combined=new Set();
  let passed=0;
  for(let i=0;i<sets.length;i++){const item=sets[i];if(item.status==='fulfilled'){passed++;for(const d of item.value)combined.add(d)}
   else log('global','scam-feed-error',FEEDS[i]+': '+String(item.reason).slice(0,160));}
  // Never clear a previously valid feed on a temporary outage.
  if(passed){domains=combined;lastUpdated=Date.now()}
 }
 function match(message){
  if(!domains.size)return null;
  const clean=String(message||'').replace(/\s*(?:\(dot\)|\[dot\]|\{dot\}|\s+dot\s+)\s*/gi,'.').replace(/[．。｡]/g,'.').replace(/\s*\.\s*/g,'.');
  const urls=clean.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?/ig)||[];
  for(const raw of urls){
   let host;
   try{host=normalize(new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw).hostname)}catch{continue}
   if(!host)continue;
   let segment=host;
   while(segment.includes('.')){if(domains.has(segment))return {host,blocked:segment};segment=segment.slice(segment.indexOf('.')+1)}
  }
  return null;
 }
 void refresh().catch(e=>log('global','scam-feed-error',e.message));
 const timer=setInterval(()=>void refresh().catch(e=>log('global','scam-feed-error',e.message)),6*3600000);
 timer.unref?.();
 return {match,status:()=>({domains:domains.size,lastUpdated})};
}
