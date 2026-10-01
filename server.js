const http=require('http');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'public');
const port=process.env.PORT||3000;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const headers={accept:'application/json','user-agent':'GangsterInu/3.0'};
const HELIUS_KEY=process.env.HELIUS_API_KEY||'';
let cache={time:0,data:null};
const n=v=>Number(v||0);

function normalize(p){return{symbol:p.baseToken?.symbol||'?',name:p.baseToken?.name||'Unknown',address:p.baseToken?.address||'',pairAddress:p.pairAddress||'',quote:p.quoteToken?.symbol||'',priceUsd:n(p.priceUsd),change5m:n(p.priceChange?.m5),change1h:n(p.priceChange?.h1),change6h:n(p.priceChange?.h6),change24h:n(p.priceChange?.h24),liquidityUsd:n(p.liquidity?.usd),volume5m:n(p.volume?.m5),volume1h:n(p.volume?.h1),volume24h:n(p.volume?.h24),buys5m:n(p.txns?.m5?.buys),sells5m:n(p.txns?.m5?.sells),buys1h:n(p.txns?.h1?.buys),sells1h:n(p.txns?.h1?.sells),fdv:n(p.fdv),marketCap:n(p.marketCap),pairCreatedAt:p.pairCreatedAt||null,dexId:p.dexId||'',url:p.url||'',heliusVerified:false}}

async function dex(url){const r=await fetch(url,{headers});if(!r.ok)throw new Error('DexScreener '+r.status);return r.json()}
async function heliusRpc(method,params){
  if(!HELIUS_KEY)throw new Error('Helius not configured');
  const r=await fetch('https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(HELIUS_KEY),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'ginu',method,params})});
  if(!r.ok)throw new Error('Helius '+r.status);
  const j=await r.json();if(j.error)throw new Error(j.error.message||'Helius RPC error');return j.result
}
async function verifyBatch(items){
  if(!HELIUS_KEY||!items.length)return items;
  try{
    const assets=await heliusRpc('getAssetBatch',{ids:items.map(x=>x.address)});
    const valid=new Set((assets||[]).filter(Boolean).map(x=>x.id));
    return items.map(x=>({...x,heliusVerified:valid.has(x.address)}));
  }catch(e){return items}
}
async function onchainFor(pairAddress,mint){
  if(!HELIUS_KEY)return{configured:false,verified:false};
  try{
    const [asset,sigs]=await Promise.all([
      heliusRpc('getAsset',{id:mint}).catch(()=>null),
      pairAddress?heliusRpc('getSignaturesForAddress',[pairAddress,{limit:25}]).catch(()=>[]):Promise.resolve([])
    ]);
    const now=Math.floor(Date.now()/1000);
    const recent=(sigs||[]).filter(x=>x.blockTime);
    return{
      configured:true,
      verified:!!asset,
      assetName:asset?.content?.metadata?.name||null,
      assetSymbol:asset?.content?.metadata?.symbol||null,
      signatures2m:recent.filter(x=>now-x.blockTime<=120).length,
      signatures5m:recent.filter(x=>now-x.blockTime<=300).length,
      latestBlockTime:recent[0]?.blockTime||null
    };
  }catch(e){return{configured:true,verified:false,error:'helius lookup failed'}}
}
async function intel(){
  if(cache.data&&Date.now()-cache.time<30000)return cache.data;
  let j=await dex('https://api.dexscreener.com/latest/dex/search?q=pump.fun');
  let pairs=(j.pairs||[]).filter(p=>p.chainId==='solana');
  if(pairs.length<8){j=await dex('https://api.dexscreener.com/latest/dex/search?q=solana');pairs.push(...(j.pairs||[]).filter(p=>p.chainId==='solana'))}
  const seen=new Set(),out=[];
  for(const p of pairs){const a=p.baseToken?.address;if(!a||seen.has(a)||!n(p.priceUsd))continue;seen.add(a);out.push(normalize(p))}
  out.sort((a,b)=>(b.volume5m+b.volume1h*.15)-(a.volume5m+a.volume1h*.15));
  const top=await verifyBatch(out.slice(0,24));
  cache={time:Date.now(),data:{source:'DexScreener + Helius',heliusConfigured:!!HELIUS_KEY,updatedAt:Date.now(),pairs:top}};
  return cache.data
}
async function token(address){
  const j=await dex('https://api.dexscreener.com/token-pairs/v1/solana/'+encodeURIComponent(address));
  const pairs=(Array.isArray(j)?j:[]).filter(p=>p.chainId==='solana'&&n(p.priceUsd));
  if(!pairs.length)return null;
  pairs.sort((a,b)=>n(b.liquidity?.usd)-n(a.liquidity?.usd));
  const data=normalize(pairs[0]);
  data.onchain=await onchainFor(data.pairAddress,address);
  data.heliusVerified=!!data.onchain?.verified;
  return data
}
function json(res,status,obj,cacheControl='no-store'){res.writeHead(status,{'content-type':'application/json','cache-control':cacheControl,'access-control-allow-origin':'*'});res.end(JSON.stringify(obj))}
function injectHtml(d){let s=d.toString('utf8');if(!s.includes('/ux-fixes.css'))s=s.replace('</head>','<link rel="stylesheet" href="/ux-fixes.css?v=2"></head>');if(!s.includes('/ux-fixes.js'))s=s.replace('</body>','<script src="/ux-fixes.js?v=2"><\/script></body>');return s}

const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));
  if(u.pathname==='/health')return json(res,200,{ok:true,app:'gangster-inu',heliusConfigured:!!HELIUS_KEY});
  if(u.pathname==='/api/intel'){try{return json(res,200,await intel(),'public,max-age=20')}catch(e){return json(res,502,{error:'intel unavailable',pairs:[],heliusConfigured:!!HELIUS_KEY})}}
  if(u.pathname==='/api/token'){
    const address=(u.searchParams.get('address')||'').trim();
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return json(res,400,{error:'invalid Solana token address'});
    try{const data=await token(address);if(!data)return json(res,404,{error:'token pair not found'});return json(res,200,{source:'DexScreener + Helius',updatedAt:Date.now(),token:data})}catch(e){return json(res,502,{error:'token lookup unavailable'})}
  }
  let rel=decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if(!rel||rel.endsWith('/'))rel+='index.html';
  const file=path.normalize(path.join(root,rel));
  if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){
      const fb=path.join(root,'index.html');
      return fs.readFile(fb,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(injectHtml(d))})
    }
    fs.readFile(file,(e,d)=>{if(e){res.writeHead(500);return res.end('Error')}const ext=path.extname(file).toLowerCase();res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public,max-age=31536000,immutable'});res.end(ext==='.html'?injectHtml(d):d)})
  })
}catch(e){res.writeHead(500);res.end('Server error')}});

server.listen(port,'0.0.0.0',()=>console.log('Gangster Inu listening on '+port+' | Helius '+(HELIUS_KEY?'configured':'not configured')));