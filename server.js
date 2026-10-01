const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.join(__dirname,'public');
const port=process.env.PORT||3000;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const headers={accept:'application/json','user-agent':'GangsterInu/4.0'};
const HELIUS_KEY=process.env.HELIUS_API_KEY||'';
const JOB_MS=90000;
let intelCache={time:0,data:null};
const liveJobs=new Map();
const completed=[];

const n=v=>Number(v||0);
function json(res,status,obj,cache='no-store'){res.writeHead(status,{'content-type':'application/json','cache-control':cache,'access-control-allow-origin':'*'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>100000)req.destroy()});req.on('end',()=>{try{resolve(d?JSON.parse(d):{})}catch(e){reject(e)}});req.on('error',reject)})}
function normalize(p){return{symbol:p.baseToken?.symbol||'?',name:p.baseToken?.name||'Unknown',address:p.baseToken?.address||'',pairAddress:p.pairAddress||'',quote:p.quoteToken?.symbol||'',priceUsd:n(p.priceUsd),change5m:n(p.priceChange?.m5),change1h:n(p.priceChange?.h1),liquidityUsd:n(p.liquidity?.usd),volume5m:n(p.volume?.m5),volume1h:n(p.volume?.h1),buys5m:n(p.txns?.m5?.buys),sells5m:n(p.txns?.m5?.sells),buys1h:n(p.txns?.h1?.buys),sells1h:n(p.txns?.h1?.sells),pairCreatedAt:p.pairCreatedAt||null,dexId:p.dexId||'',url:p.url||'',heliusVerified:false}}
async function dex(url){const r=await fetch(url,{headers});if(!r.ok)throw new Error('DexScreener '+r.status);return r.json()}
async function helius(method,params){if(!HELIUS_KEY)throw new Error('not configured');const r=await fetch('https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(HELIUS_KEY),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'ginu',method,params})});if(!r.ok)throw new Error('Helius '+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||'Helius error');return j.result}
async function verify(items){if(!HELIUS_KEY||!items.length)return items;try{const a=await helius('getAssetBatch',{ids:items.map(x=>x.address)});const valid=new Set((a||[]).filter(Boolean).map(x=>x.id));return items.map(x=>({...x,heliusVerified:valid.has(x.address)}))}catch(e){return items}}
async function intel(){
  if(intelCache.data&&Date.now()-intelCache.time<20000)return intelCache.data;
  const addresses=[];
  try{
    const [profiles,boosts]=await Promise.all([
      dex('https://api.dexscreener.com/token-profiles/latest/v1').catch(()=>[]),
      dex('https://api.dexscreener.com/token-boosts/latest/v1').catch(()=>[])
    ]);
    for(const x of [...(Array.isArray(profiles)?profiles:[]),...(Array.isArray(boosts)?boosts:[])]){
      if(x.chainId==='solana'&&x.tokenAddress&&!addresses.includes(x.tokenAddress))addresses.push(x.tokenAddress);
      if(addresses.length>=28)break;
    }
  }catch(e){}
  let pairs=[];
  const batches=addresses.slice(0,24);
  if(batches.length){
    const found=await Promise.all(batches.map(a=>dex('https://api.dexscreener.com/token-pairs/v1/solana/'+encodeURIComponent(a)).catch(()=>[])));
    for(const arr of found)if(Array.isArray(arr))pairs.push(...arr);
  }
  if(pairs.length<8){
    const searches=await Promise.all(['pump','pumpfun','solana meme'].map(q=>dex('https://api.dexscreener.com/latest/dex/search?q='+encodeURIComponent(q)).catch(()=>({pairs:[]}))));
    for(const j of searches)pairs.push(...(j.pairs||[]));
  }
  const seen=new Set(),out=[];
  for(const p of pairs){
    if(p.chainId!=='solana')continue;
    const a=p.baseToken?.address;
    if(!a||seen.has(a)||!n(p.priceUsd)||n(p.liquidity?.usd)<1000)continue;
    seen.add(a);
    const x=normalize(p);
    x.pumpOrigin=/pump/i.test(p.dexId||'')||/pump$/i.test(a)||/pump/i.test(p.url||'');
    out.push(x);
  }
  out.sort((a,b)=>(Number(b.pumpOrigin)-Number(a.pumpOrigin))+((b.volume5m+b.volume1h*.12)-(a.volume5m+a.volume1h*.12))/1000000);
  const top=await verify(out.slice(0,24));
  intelCache={time:Date.now(),data:{source:'DexScreener + Helius',heliusConfigured:!!HELIUS_KEY,updatedAt:Date.now(),pairs:top}};
  return intelCache.data
}
async function token(address){const j=await dex('https://api.dexscreener.com/token-pairs/v1/solana/'+encodeURIComponent(address));const pairs=(Array.isArray(j)?j:[]).filter(p=>p.chainId==='solana'&&n(p.priceUsd));if(!pairs.length)return null;pairs.sort((a,b)=>n(b.liquidity?.usd)-n(a.liquidity?.usd));const x=normalize(pairs[0]);if(HELIUS_KEY){try{const a=await helius('getAsset',{id:address});x.heliusVerified=!!a}catch(e){}}return x}
function outcome(j,x){const e=j.entry,pct=e.priceUsd?((x.priceUsd-e.priceUsd)/e.priceUsd*100):0,liq=e.liquidityUsd?((x.liquidityUsd-e.liquidityUsd)/e.liquidityUsd*100):0,act0=(e.buys5m||0)+(e.sells5m||0),act1=(x.buys5m||0)+(x.sells5m||0),act=act1-act0;let success=false,base=0;if(j.mode==='street'){success=pct>0;base=70+pct*12}if(j.mode==='wire'){success=act>=0&&x.priceUsd>0;base=70+Math.max(0,act)*4+Math.max(-20,pct*3)}if(j.mode==='collections'){success=pct>-3;base=85+(pct+3)*7}if(j.mode==='bigmoney'){success=liq>0;base=80+liq*8}let mult=1;if(j.crew==='ginu'&&success)mult=1.2;if(j.crew==='ricky'&&pct>=5)mult=1.7;if(j.crew==='tony'&&liq>=2)mult=1.7;if(j.crew==='bruno'&&pct>-3)mult=1.65;if(j.crew==='vinny'&&act>0)mult=1.65;if(j.crew==='paulie')mult=pct>=10?2.5:(success?1.05:.55);const points=Math.round(Math.max(success?25:-120,success?base*mult:-55-Math.min(65,Math.abs(pct)*4)));return{success,points,pct,liq,act,mult}}
function publicJob(j){return{id:j.id,playerId:j.playerId,alias:j.alias,symbol:j.symbol,name:j.name,address:j.address,crew:j.crew,mode:j.mode,start:j.start,end:j.end,status:j.status,entry:j.entry,last:j.last,result:j.result||null}}
async function pulseJobs(){for(const j of liveJobs.values()){if(j.status!=='active')continue;try{const x=await token(j.address);if(x)j.last=x}catch(e){}if(Date.now()>=j.end){j.result=outcome(j,j.last||j.entry);j.status='complete';j.completedAt=Date.now();completed.unshift(publicJob(j));if(completed.length>50)completed.length=50;liveJobs.delete(j.id)}}}
setInterval(pulseJobs,10000).unref();

const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));
 if(u.pathname==='/health')return json(res,200,{ok:true,app:'gangster-inu',heliusConfigured:!!HELIUS_KEY,activeJobs:liveJobs.size});
 if(u.pathname==='/api/intel'&&req.method==='GET'){try{return json(res,200,await intel(),'public,max-age=15')}catch(e){return json(res,502,{error:'intel unavailable',pairs:[],heliusConfigured:!!HELIUS_KEY})}}
 if(u.pathname==='/api/live-jobs'&&req.method==='GET'){return json(res,200,{now:Date.now(),active:[...liveJobs.values()].map(publicJob).sort((a,b)=>a.end-b.end),completed:completed.slice(0,12)})}
 if(u.pathname==='/api/job'&&req.method==='GET'){const id=u.searchParams.get('id')||'';const j=liveJobs.get(id)||completed.find(x=>x.id===id);return j?json(res,200,j):json(res,404,{error:'job not found'})}
 if(u.pathname==='/api/job'&&req.method==='POST'){const b=await body(req);const address=String(b.address||'').trim();if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return json(res,400,{error:'invalid token'});const entry=await token(address);if(!entry)return json(res,404,{error:'token not found'});const id=crypto.randomBytes(6).toString('hex');const j={id,playerId:String(b.playerId||'anon').slice(0,64),alias:String(b.alias||'Anonymous Capo').slice(0,24),symbol:entry.symbol,name:entry.name,address,crew:String(b.crew||'ginu'),mode:String(b.mode||'street'),start:Date.now(),end:Date.now()+JOB_MS,status:'active',entry,last:entry};liveJobs.set(id,j);return json(res,201,publicJob(j))}
 if(u.pathname==='/api/token'&&req.method==='GET'){const address=(u.searchParams.get('address')||'').trim();if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return json(res,400,{error:'invalid token'});const data=await token(address);return data?json(res,200,{token:data}):json(res,404,{error:'token not found'})}
 let rel=decodeURIComponent(u.pathname).replace(/^\/+/,'');if(!rel||rel.endsWith('/'))rel+='index.html';const file=path.normalize(path.join(root,rel));if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}fs.stat(file,(err,stat)=>{if(err||!stat.isFile()){const fb=path.join(root,'index.html');return fs.readFile(fb,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(d)})}fs.readFile(file,(e,d)=>{if(e){res.writeHead(500);return res.end('Error')}const ext=path.extname(file).toLowerCase();res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public,max-age=31536000,immutable'});res.end(d)})})
}catch(e){json(res,500,{error:'server error'})}});
server.listen(port,'0.0.0.0',()=>console.log('Gangster Inu listening on '+port+' | Helius '+(HELIUS_KEY?'configured':'not configured')));