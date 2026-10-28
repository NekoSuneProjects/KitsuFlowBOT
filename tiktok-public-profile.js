// Extract a bio only from TikTok's structured profile data, never arbitrary page text.
// Public profile scraping is unofficial and may fail due to anti-bot restrictions.
const scalar=v=>typeof v==='string'?v:'';
const same=(a,b)=>scalar(a).replace(/^@/,'').toLowerCase()===b;
function locateProfile(node,username,depth=0){
 if(!node||typeof node!=='object'||depth>18)return null;
 if(!Array.isArray(node)){
  const user=node.user||node.userInfo?.user;
  if(user&&same(user.uniqueId,username)&&typeof user.signature==='string')
   return user.signature;
  if(same(node.uniqueId,username)&&typeof node.signature==='string')
   return node.signature;
 }
 for(const value of Object.values(node)){
  if(value&&typeof value==='object'){
   const found=locateProfile(value,username,depth+1);
   if(found!==null)return found;
  }
 }
 return null;
}
export async function getPublicTikTokBio(username){
 if(!/^[a-z0-9._]{2,32}$/.test(username))throw Error('Invalid TikTok username');
 const url='https://www.tiktok.com/@'+encodeURIComponent(username);
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(9000),headers:{
  'User-Agent':'Mozilla/5.0 (compatible; KitsuFlowBOT verification)',
  'Accept':'text/html'
 }});
 if(!response.ok)throw Error('TikTok profile unavailable (HTTP '+response.status+')');
 const html=(await response.text()).slice(0,3_000_000);
 // Inspect only TikTok-hydrated JSON that includes an exact matching uniqueId.
 for(const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__','SIGI_STATE']){
  const pattern=new RegExp('<script[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>','i');
  const match=pattern.exec(html);
  if(!match)continue;
  try{
   const data=JSON.parse(match[1]);
   const bio=locateProfile(data,username);
   if(bio!==null)return bio;
  }catch{}
 }
 throw Error('Could not verify the TikTok public profile bio. TikTok may block automated profile reads; try again later.');
}
