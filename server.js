const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const root=path.join(__dirname,'public');
const port=process.env.PORT||3000;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const headers={accept:'application/json','user-agent':'GangsterInu/5.0'};
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
async function pumpLatest(){
  const url='https://frontend-api-v3.pump.fun/coins?offset=0&limit=60&sort=created_timestamp&order=DESC&includeNsfw=false';
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'GangsterInu/5.0'}});
  if(!r.ok)throw new Error('Pump.fun '+r.status);
  const j=await r.json();
  return Array.isArray(j)?j:(Array.isArray(j.coins)?j.coins:(Array.isArray(j.data)?j.data:[]));
}
async function helius(method,params){if(!HELIUS_KEY)throw new Error('not configured');const r=await fetch('https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(HELIUS_KEY),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'ginu',method,params})});if(!r.ok)throw new Error('Helius '+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||'Helius error');return j.result}
async function verify(items){if(!HELIUS_KEY||!items.length)return items;try{const a=await helius('getAssetBatch',{ids:items.map(x=>x.address)});const valid=new Set((a||[]).filter(Boolean).map(x=>x.id));return items.map(x=>({...x,heliusVerified:valid.has(x.address)}))}catch(e){return items}}
async function chainPulse(pairAddress){if(!HELIUS_KEY||!pairAddress)return{configured:!!HELIUS_KEY,sig2m:0,sig5m:0,latest:null};try{const sigs=await helius('getSignaturesForAddress',[pairAddress,{limit:40}]);const now=Math.floor(Date.now()/1000),rows=(sigs||[]).filter(x=>x.blockTime);return{configured:true,sig2m:rows.filter(x=>now-x.blockTime<=120).length,sig5m:rows.filter(x=>now-x.blockTime<=300).length,latest:rows[0]?.blockTime||null}}catch(e){return{configured:true,sig2m:0,sig5m:0,latest:null,error:true}}}

async function intel(){
  if(intelCache.data&&Date.now()-intelCache.time<10000)return intelCache.data;
  let launchRows=[],source='Pump.fun newest launches';
  try{launchRows=await pumpLatest()}catch(e){source='DexScreener fallback'}
  const launchMap=new Map();
  const mints=[];
  for(const c of launchRows){
    const mint=String(c.mint||c.address||'');
    if(!mint||launchMap.has(mint))continue;
    const created=Number(c.created_timestamp||c.createdAt||0);
    launchMap.set(mint,{
      launchCreatedAt:created,
      lastTradeAt:Number(c.last_trade_timestamp||0),
      pumpComplete:!!c.complete,
      pumpMarketCap:n(c.usd_market_cap||c.market_cap||0),
      pumpName:c.name||'',
      pumpSymbol:c.symbol||''
    });
    mints.push(mint);
    if(mints.length>=36)break;
  }

  let pairs=[];
  if(mints.length){
    const found=await Promise.all(mints.map(m=>dex('https://api.dexscreener.com/token-pairs/v1/solana/'+encodeURIComponent(m)).catch(()=>[])));
    for(const arr of found)if(Array.isArray(arr))pairs.push(...arr);
  }

  if(!pairs.length){
    const searches=await Promise.all(['pump','pumpfun'].map(q=>dex('https://api.dexscreener.com/latest/dex/search?q='+encodeURIComponent(q)).catch(()=>({pairs:[]}))));
    for(const j of searches)pairs.push(...(j.pairs||[]));
  }

  const byMint=new Map();
  for(const p of pairs){
    if(p.chainId!=='solana')continue;
    const mint=p.baseToken?.address;
    if(!mint||!n(p.priceUsd))continue;
    const current=byMint.get(mint);
    if(!current||n(p.liquidity?.usd)>n(current.liquidity?.usd))byMint.set(mint,p);
  }

  const out=[];
  for(const [mint,p] of byMint){
    const x=normalize(p);
    const launch=launchMap.get(mint)||{};
    Object.assign(x,launch);
    x.pumpOrigin=launchMap.has(mint)||/pump/i.test(p.dexId||'')||/pump$/i.test(mint)||/pump/i.test(p.url||'');
    if(!x.launchCreatedAt)x.launchCreatedAt=x.pairCreatedAt||0;
    if(n(x.liquidityUsd)<500)continue;
    out.push(x);
  }

  out.sort((a,b)=>(b.launchCreatedAt||0)-(a.launchCreatedAt||0));
  const top=await verify(out.slice(0,30));
  intelCache={time:Date.now(),data:{
    source:source+' + DexScreener + Helius',
    heliusConfigured:!!HELIUS_KEY,
    updatedAt:Date.now(),
    newestLaunchAt:top[0]?.launchCreatedAt||null,
    pairs:top
  }};
  return intelCache.data
}
async function token(address){
  const j=await dex('https://api.dexscreener.com/token-pairs/v1/solana/'+encodeURIComponent(address));
  const pairs=(Array.isArray(j)?j:[]).filter(p=>p.chainId==='solana'&&n(p.priceUsd));
  if(!pairs.length)return null;
  pairs.sort((a,b)=>n(b.liquidity?.usd)-n(a.liquidity?.usd));
  const x=normalize(pairs[0]);
  if(HELIUS_KEY){try{const a=await helius('getAsset',{id:address});x.heliusVerified=!!a}catch(e){}}
  return x
}

function addEvent(j,type,label,detail){
  const now=Date.now();
  const last=j.events[j.events.length-1];
  if(last&&last.type===type&&last.detail===detail&&now-last.time<12000)return;
  j.events.push({time:now,type,label,detail});
  if(j.events.length>20)j.events=j.events.slice(-20);
}

function applyAction(j,result){
  let bonus=0,note='';
  if(!j.action)return{...result,actionBonus:0,actionNote:''};
  if(j.action==='call_shot'){bonus=result.success?Math.round(Math.max(20,result.points*.25)):-15;note=result.success?'The Don called it right.':'The Don missed the call.'}
  if(j.action==='press_move'){bonus=result.pct>=3?40:-20;note=result.pct>=3?'Ricky pressed the move at the right time.':'Ricky pressed too hard.'}
  if(j.action==='bring_bag'){bonus=result.liq>=1?40:-15;note=result.liq>=1?'Big Tony found fresh liquidity.':'Tony brought the bag to a quiet room.'}
  if(j.action==='lock_block'){bonus=result.success?15:Math.max(0,Math.abs(result.points)-25);note=result.success?'Bruno locked down the block.':'Bruno limited the damage.'}
  if(j.action==='tap_wire'){const chain=j.lastChain||{};bonus=(result.act>0||n(chain.sig2m)>0)?35:-10;note=bonus>0?'Vinny caught fresh on-chain activity.':'The wire went quiet.'}
  return{...result,points:Math.round(result.points+bonus),actionBonus:bonus,actionNote:note}
}

function outcome(j,x){
  const e=j.entry,pct=e.priceUsd?((x.priceUsd-e.priceUsd)/e.priceUsd*100):0,liq=e.liquidityUsd?((x.liquidityUsd-e.liquidityUsd)/e.liquidityUsd*100):0,act0=(e.buys5m||0)+(e.sells5m||0),act1=(x.buys5m||0)+(x.sells5m||0),act=act1-act0;
  let success=false,base=0;
  if(j.mode==='street'){success=pct>0;base=70+pct*12}
  if(j.mode==='wire'){success=act>=0&&x.priceUsd>0;base=70+Math.max(0,act)*4+Math.max(-20,pct*3)}
  if(j.mode==='collections'){success=pct>-3;base=85+(pct+3)*7}
  if(j.mode==='bigmoney'){success=liq>0;base=80+liq*8}
  let mult=1;
  if(j.crew==='ginu'&&success)mult=1.2;
  if(j.crew==='ricky'&&pct>=5)mult=1.7;
  if(j.crew==='tony'&&liq>=2)mult=1.7;
  if(j.crew==='bruno'&&pct>-3)mult=1.65;
  if(j.crew==='vinny'&&act>0)mult=1.65;
  if(j.crew==='paulie')mult=pct>=10?2.5:(success?1.05:.55);
  const points=Math.round(Math.max(success?25:-120,success?base*mult:-55-Math.min(65,Math.abs(pct)*4)));
  return applyAction(j,{success,points,pct,liq,act,mult})
}

function publicJob(j){
  return{id:j.id,playerId:j.playerId,alias:j.alias,symbol:j.symbol,name:j.name,address:j.address,crew:j.crew,mode:j.mode,start:j.start,end:j.end,status:j.status,entry:j.entry,last:j.last,entryChain:j.entryChain||null,lastChain:j.lastChain||null,events:j.events||[],action:j.action||null,result:j.result||null}
}

async function updateJob(j){
  if(j.status!=='active')return;
  let x=null,chain=null;
  try{x=await token(j.address);if(x)j.last=x}catch(e){}
  try{chain=await chainPulse((j.last||j.entry).pairAddress);j.lastChain=chain}catch(e){}
  const cur=j.last||j.entry,prev=j.prev||j.entry;
  const pct=j.entry.priceUsd?((cur.priceUsd-j.entry.priceUsd)/j.entry.priceUsd*100):0;
  const stepPct=prev.priceUsd?((cur.priceUsd-prev.priceUsd)/prev.priceUsd*100):0;
  const liqPct=j.entry.liquidityUsd?((cur.liquidityUsd-j.entry.liquidityUsd)/j.entry.liquidityUsd*100):0;
  const buys=n(cur.buys5m),sells=n(cur.sells5m);
  if(Math.abs(stepPct)>=1)addEvent(j,stepPct>0?'price_up':'price_down',stepPct>0?'Price push':'Red candle',(stepPct>0?'+':'')+stepPct.toFixed(2)+'% since last check');
  if(Math.abs(liqPct)>=1)addEvent(j,liqPct>0?'liq_up':'liq_down',liqPct>0?'Liquidity entered':'Liquidity slipped',(liqPct>0?'+':'')+liqPct.toFixed(2)+'% from entry');
  if(buys+sells>=4)addEvent(j,buys>=sells?'buy_pressure':'sell_pressure',buys>=sells?'Buy pressure':'Sell pressure',buys+' buys vs '+sells+' sells in the 5m window');
  if(chain&&chain.sig2m>0)addEvent(j,'chain','Helius street tape',chain.sig2m+' pair-account signatures seen in the last 2m');
  j.prev={...cur};
  if(Date.now()>=j.end)settleJob(j);
}

function settleJob(j){
  if(j.status!=='active')return j;
  j.result=outcome(j,j.last||j.entry);
  j.status='complete';
  j.completedAt=Date.now();
  addEvent(j,j.result.success?'win':'loss',j.result.success?'Job settled: WIN':'Job settled: LOSS',(j.result.points>=0?'+':'')+j.result.points+' Respect');
  const snap=publicJob(j);
  completed.unshift(snap);
  if(completed.length>50)completed.length=50;
  liveJobs.delete(j.id);
  return j
}

async function pulseJobs(){for(const j of [...liveJobs.values()])await updateJob(j)}
setInterval(pulseJobs,8000).unref();

const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));

  if(u.pathname==='/health')return json(res,200,{ok:true,app:'gangster-inu',heliusConfigured:!!HELIUS_KEY,activeJobs:liveJobs.size});

  if(u.pathname==='/api/intel'&&req.method==='GET'){
    try{return json(res,200,await intel(),'public,max-age=15')}
    catch(e){return json(res,502,{error:'intel unavailable',pairs:[],heliusConfigured:!!HELIUS_KEY})}
  }

  if(u.pathname==='/api/live-jobs'&&req.method==='GET'){
    return json(res,200,{now:Date.now(),active:[...liveJobs.values()].map(publicJob).sort((a,b)=>a.end-b.end),completed:completed.slice(0,12)})
  }

  if(u.pathname==='/api/job'&&req.method==='GET'){
    const id=u.searchParams.get('id')||'';
    let j=liveJobs.get(id);
    if(j&&Date.now()>=j.end){await updateJob(j);j=liveJobs.get(id)||completed.find(x=>x.id===id)}
    if(!j)j=completed.find(x=>x.id===id);
    return j?json(res,200,publicJob(j)):json(res,404,{error:'job not found'})
  }

  if(u.pathname==='/api/job'&&req.method==='POST'){
    const b=await body(req),address=String(b.address||'').trim();
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return json(res,400,{error:'invalid token'});
    const entry=await token(address);if(!entry)return json(res,404,{error:'token not found'});
    const id=crypto.randomBytes(6).toString('hex'),entryChain=await chainPulse(entry.pairAddress);
    const j={id,playerId:String(b.playerId||'anon').slice(0,64),alias:String(b.alias||'Anonymous Capo').slice(0,24),symbol:entry.symbol,name:entry.name,address,crew:String(b.crew||'ginu'),mode:String(b.mode||'street'),start:Date.now(),end:Date.now()+JOB_MS,status:'active',entry,last:entry,prev:{...entry},entryChain,lastChain:entryChain,events:[],action:null};
    addEvent(j,'start','Job locked',j.alias+' sent '+j.crew+' after $'+j.symbol);
    if(entryChain.sig2m>0)addEvent(j,'chain','Helius street tape',entryChain.sig2m+' pair-account signatures already active');
    liveJobs.set(id,j);
    return json(res,201,publicJob(j))
  }

  if(u.pathname==='/api/job/action'&&req.method==='POST'){
    const b=await body(req),j=liveJobs.get(String(b.id||''));
    if(!j)return json(res,404,{error:'active job not found'});
    if(j.playerId!==String(b.playerId||''))return json(res,403,{error:'not your job'});
    if(j.action)return json(res,409,{error:'move already used'});
    const allowed={ginu:'call_shot',ricky:'press_move',tony:'bring_bag',bruno:'lock_block',vinny:'tap_wire',paulie:'bail_now'};
    const action=allowed[j.crew];
    if(!action)return json(res,400,{error:'no move available'});
    if(action==='bail_now'){
      try{const x=await token(j.address);if(x)j.last=x}catch(e){}
      j.action='bail_now';
      addEvent(j,'move','Paulie bailed early','Paper Hand Paulie ended the job before the clock.');
      settleJob(j);
      return json(res,200,publicJob(completed.find(x=>x.id===j.id)||j))
    }
    j.action=action;
    const labels={call_shot:'The Don made the call',press_move:'Ricky pressed the move',bring_bag:'Big Tony brought the bag',lock_block:'Bruno locked down the block',tap_wire:'Vinny tapped the wire'};
    addEvent(j,'move',labels[action],'Special move armed for settlement.');
    return json(res,200,publicJob(j))
  }

  if(u.pathname==='/api/token'&&req.method==='GET'){
    const address=(u.searchParams.get('address')||'').trim();
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return json(res,400,{error:'invalid token'});
    const data=await token(address);return data?json(res,200,{token:data}):json(res,404,{error:'token not found'})
  }

  let rel=decodeURIComponent(u.pathname).replace(/^\/+/,'');
  if(!rel||rel.endsWith('/'))rel+='index.html';
  const file=path.normalize(path.join(root,rel));
  if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){const fb=path.join(root,'index.html');return fs.readFile(fb,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(d)})}
    fs.readFile(file,(e,d)=>{if(e){res.writeHead(500);return res.end('Error')}const ext=path.extname(file).toLowerCase();res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public,max-age=31536000,immutable'});res.end(d)})
  })
}catch(e){json(res,500,{error:'server error'})}});

server.listen(port,'0.0.0.0',()=>console.log('Gangster Inu listening on '+port+' | Helius '+(HELIUS_KEY?'configured':'not configured')));