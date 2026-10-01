
const $=id=>document.getElementById(id);
const saved=(()=>{try{return JSON.parse(localStorage.getItem('ginuState')||'{}')}catch(e){return{}}})();
const GAME=Object.assign({
  playerId:localStorage.ginuPlayerId||(localStorage.ginuPlayerId=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2))),
  respect:0,jobs:0,wins:0,streak:0,alias:'Anonymous Capo',history:[],settled:[],activeJobId:null
},saved);

const crew={
  ginu:{name:'Gangster Inu',short:'GINU',role:'The Don',img:'/assets/ginu.webp',ability:'Boss Cut · 1.20× Respect on any winning job.',move:'MAKE THE CALL',moveHelp:'Back your read. A correct call adds another Respect bonus; a miss costs extra.'},
  paulie:{name:'Paper Hand Paulie',short:'Paulie',role:'High Risk',img:'/assets/paulie.webp',ability:'Paper Lottery · 2.50× on a 10%+ move. Misses hurt harder.',move:'PAPER OUT NOW',moveHelp:'End the job immediately at the current market snapshot. Very Paulie.'},
  tony:{name:'Big Tony',short:'Tony',role:'Liquidity',img:'/assets/tony.webp',ability:'Whale Call · 1.70× when liquidity grows 2% or more.',move:'BRING THE BAG',moveHelp:'Commit Tony to a liquidity call. Expansion at settlement earns a bonus.'},
  ricky:{name:'Ricky Bags',short:'Ricky',role:'Momentum',img:'/assets/ricky.webp',ability:'Hot Tip · 1.70× when price moves 5%+ in your favor.',move:'PRESS THE MOVE',moveHelp:'Lean into momentum. A 3%+ finish earns a bonus; a weak move costs Respect.'},
  bruno:{name:'Bruno',short:'Bruno',role:'Defense',img:'/assets/bruno.webp',ability:'Hold the Block · 1.65× if price finishes better than -3%.',move:'LOCK DOWN THE BLOCK',moveHelp:'Bruno limits the damage on a losing job and adds extra on a win.'},
  vinny:{name:'Vinny the Wire',short:'Vinny',role:'Intel',img:'/assets/vinny.webp',ability:'The Wire · 1.65× when 5-minute transaction activity increases.',move:'TAP THE WIRE',moveHelp:'Use Helius activity as your read. Fresh on-chain activity earns a bonus.'}
};

const modes={
  street:{name:'Street Job',help:'Call the direction. If price finishes above the entry snapshot, the job wins.',objective:'Finish above entry price.'},
  wire:{name:'The Wire',help:'Call continued activity. Vinny specializes in rising short-term transaction activity.',objective:'5-minute activity holds or increases.'},
  collections:{name:'Collections',help:'This is a survival job. Bruno specializes in tokens that can hold the block under pressure.',objective:'Finish better than -3%.'},
  bigmoney:{name:'Big Liquidity',help:'Big Tony watches liquidity. The job wins if liquidity expands during the round.',objective:'Liquidity finishes higher.'}
};

let intel=[],mode='street',selected=null,selectedCrew='ginu',pollTimer=null,boardTimer=null;

function save(){localStorage.setItem('ginuState',JSON.stringify(GAME));renderProgress()}
function rank(r){if(r>=7000)return'Don';if(r>=3500)return'Underboss';if(r>=1500)return'Capo';if(r>=500)return'Soldier';return'Associate'}
function money(n){n=Number(n||0);if(n>=1e9)return'$'+(n/1e9).toFixed(1)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+n.toFixed(0)}
function price(n){n=Number(n||0);if(!n)return'n/a';let d=n>=1?4:n>=.01?5:n>=.001?6:n>=.0001?6:n>=.00001?7:8;return'$'+n.toFixed(d).replace(/0+$/,'').replace(/\.$/,'')}
function age(ts){if(!ts)return'unknown';const m=Math.max(0,Math.floor((Date.now()-Number(ts))/60000));if(m<60)return m+'m';const h=Math.floor(m/60);if(h<48)return h+'h';return Math.floor(h/24)+'d'}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function flash(s){$('toast').textContent=s;$('toast').classList.add('on');setTimeout(()=>$('toast').classList.remove('on'),1900)}
function goWars(){document.querySelector('#wars').scrollIntoView();setTimeout(()=>{if(!GAME.activeJobId)$('jobs').scrollIntoView({block:'center'})},450)}
function copyCA(){navigator.clipboard?.writeText($('ca').textContent);flash('CA copied')}
function validMint(v){return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v||'').trim())}
function buyGINU(){const mint=$('ca').textContent.trim();if(!validMint(mint)){flash('$GINU CA has not been published yet.');return}window.open('https://pump.fun/coin/'+encodeURIComponent(mint),'_blank','noopener')}
function shareText(text){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text+' '+location.origin),'_blank','noopener')}
function shareCard(){shareText('I am '+rank(GAME.respect)+' '+GAME.alias+' in the Gangster Inu Family. '+Math.round(GAME.respect)+' Respect · '+GAME.wins+' wins · '+GAME.jobs+' jobs. #GangsterInu #GINU')}
async function shareJob(id){try{const r=await fetch('/api/job?id='+encodeURIComponent(id));const j=await r.json();const o=j.result||{};shareText((o.success?'Family job complete. ':'Family job went sideways. ')+'I sent '+(crew[j.crew]?.name||j.crew)+' after $'+j.symbol+' in Gangster Inu Family Wars. '+(o.points>=0?'+':'')+(o.points||0)+' Respect. #GangsterInu #GINU')}catch(e){shareText('I just finished a Family Wars job in Gangster Inu. #GangsterInu #GINU')}}

function renderMode(){
  $('modeHelp').innerHTML='<b style="color:var(--gold)">'+modes[mode].name+':</b> '+modes[mode].help+' <span style="color:#716957">Objective: '+modes[mode].objective+'</span>';
}

function bindModeTabs(){
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    mode=b.dataset.mode;selected=null;renderMode();renderJobs();renderDesk();
  });
  $('refreshBtn').onclick=()=>loadJobs(true);
}

async function loadJobs(force=false){
  $('feedStatus').textContent='CALLING STREET';
  try{
    const r=await fetch('/api/intel'+(force?'?t='+Date.now():''));
    const d=await r.json();
    intel=(d.pairs||[]).filter(x=>x.priceUsd).slice(0,10);
    $('feedStatus').textContent=intel.length?'LIVE':'QUIET';
    $('feedNote').textContent='Updated '+new Date(d.updatedAt||Date.now()).toLocaleTimeString()+' · DexScreener market data'+(d.heliusConfigured?' · Helius verification active':'');
    renderJobs();
  }catch(e){
    $('feedStatus').textContent='OFFLINE';
    $('jobs').innerHTML='<div class="empty">The street feed missed. Try Refresh Board.</div>';
  }
}

function modeSort(a,b){
  if(mode==='bigmoney')return b.liquidityUsd-a.liquidityUsd;
  if(mode==='wire')return (b.buys5m+b.sells5m)-(a.buys5m+a.sells5m);
  if(mode==='collections')return Math.abs(a.change5m)-Math.abs(b.change5m);
  return b.change5m-a.change5m;
}

function renderJobs(){
  if(!intel.length){$('jobs').innerHTML='<div class="empty">No live jobs returned yet. Try Refresh Board.</div>';return}
  const rows=[...intel].sort(modeSort).slice(0,8);
  $('jobs').innerHTML=rows.map(x=>
    '<article class="job-card '+(selected&&selected.address===x.address?'selected':'')+'" data-address="'+esc(x.address)+'">'+
      '<div class="job-top"><div class="job-token"><strong>$'+esc(x.symbol)+'</strong><small>'+esc(x.name)+'</small></div><span class="heat">HEAT '+Math.min(99,Math.round(25+Math.abs(x.change5m)*2+(x.buys5m+x.sells5m)/8))+'</span></div>'+
      '<div class="job-metrics"><div class="jm"><b class="'+(x.change5m>=0?'up':'down')+'">'+Number(x.change5m).toFixed(1)+'%</b><small>5m move</small></div><div class="jm"><b>'+money(x.volume5m)+'</b><small>5m volume</small></div><div class="jm"><b>'+money(x.liquidityUsd)+'</b><small>liquidity</small></div></div>'+
      '<div class="badges">'+(x.heliusVerified?'<span class="badge ok">Helius verified</span>':'')+'<span class="badge">'+esc(x.dexId)+'</span><span class="badge">'+age(x.pairCreatedAt)+' old</span></div>'+
      '<div class="select-cue"><span>'+(selected&&selected.address===x.address?'JOB SELECTED':'SELECT THIS JOB')+'</span><span>→</span></div>'+
    '</article>'
  ).join('');
  document.querySelectorAll('.job-card').forEach(c=>c.onclick=()=>{
    selected=intel.find(x=>x.address===c.dataset.address);
    renderJobs();renderDesk();
    if(innerWidth<1050)$('deskTitle').scrollIntoView({behavior:'smooth',block:'center'});
  });
}

function renderDesk(){
  if(GAME.activeJobId){renderActive();return}
  if(!selected){
    $('deskTitle').textContent='Start here.';
    $('deskBody').innerHTML='<div class="empty"><b>Pick a job on the left.</b><span class="arrow">←</span>You can click different tokens until you find the job you want.</div>';
    return;
  }
  $('deskTitle').textContent='Step 2 · Choose your crew';
  $('deskBody').innerHTML=
    '<div class="target"><strong>$'+esc(selected.symbol)+' · '+modes[mode].name+'</strong><small>'+esc(selected.name)+' · '+modes[mode].objective+'</small></div>'+
    '<div class="crew-picker">'+Object.entries(crew).map(([k,c])=>'<button class="crew-pick '+(selectedCrew===k?'selected':'')+'" data-crew="'+k+'"><img src="'+c.img+'" alt=""><b>'+c.short+'</b><small>'+c.role+'</small></button>').join('')+'</div>'+
    '<div class="ability" id="ability">'+crew[selectedCrew].ability+'</div>'+
    '<div class="alias"><label>Your street name</label><input id="aliasInput" maxlength="24" value="'+esc(GAME.alias)+'"></div>'+
    '<button class="btn" id="takeBtn">Step 3 · Take the Job</button>';
  document.querySelectorAll('.crew-pick').forEach(b=>b.onclick=()=>{
    selectedCrew=b.dataset.crew;
    document.querySelectorAll('.crew-pick').forEach(x=>x.classList.toggle('selected',x.dataset.crew===selectedCrew));
    $('ability').textContent=crew[selectedCrew].ability;
  });
  $('takeBtn').onclick=takeJob;
}

async function takeJob(){
  const alias=($('aliasInput').value||'Anonymous Capo').trim().slice(0,24);
  GAME.alias=alias;save();
  $('takeBtn').disabled=true;$('takeBtn').textContent='LOCKING JOB...';
  try{
    const r=await fetch('/api/job',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:GAME.playerId,alias,address:selected.address,crew:selectedCrew,mode})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'Could not start job');
    GAME.activeJobId=j.id;save();selected=null;renderDesk();startPolling();loadWarBoard();
    flash('Job locked. The street is live.');
  }catch(e){flash(e.message);renderDesk()}
}

async function fetchMyJob(){
  if(!GAME.activeJobId)return null;
  try{
    const r=await fetch('/api/job?id='+encodeURIComponent(GAME.activeJobId)+'&t='+Date.now());
    if(!r.ok)return null;
    return await r.json();
  }catch(e){return null}
}

async function useCrewMove(){
  if(!GAME.activeJobId)return;
  const btn=$('crewMoveBtn');
  if(btn){btn.disabled=true;btn.textContent='CALLING IT...'}
  try{
    const r=await fetch('/api/job/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:GAME.activeJobId,playerId:GAME.playerId})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'Move failed');
    if(j.status==='complete'){settleLocal(j);return}
    flash('Crew move locked.');
    renderActive();loadWarBoard();
  }catch(e){flash(e.message);renderActive()}
}

async function renderActive(){
  const j=await fetchMyJob();
  if(!j){GAME.activeJobId=null;save();renderDesk();return}
  if(j.status==='complete'){settleLocal(j);return}
  const remain=Math.max(0,Math.ceil((j.end-Date.now())/1000));
  const pct=j.entry.priceUsd?((j.last.priceUsd-j.entry.priceUsd)/j.entry.priceUsd*100):0;
  const done=Math.min(100,Math.max(0,(Date.now()-j.start)/(j.end-j.start)*100));
  const c=crew[j.crew],chain=j.lastChain||{},events=(j.events||[]).slice(-5).reverse();

  $('deskTitle').textContent=remain>0?'Live Solana encounter':'Settling the job';
  if(remain<=0){
    $('deskBody').innerHTML='<div class="settling"><b>THE CLOCK IS DEAD.</b><small>Pulling the final Solana snapshot and settling Respect...</small><div class="dotline"></div></div>';
    return;
  }

  const moveHtml=j.action
    ? '<div class="move-zone used"><b>CREW MOVE USED</b><p>Your decision is locked into the settlement.</p></div>'
    : '<div class="move-zone"><b>YOUR MOVE · '+esc(c.move)+'</b><p>'+esc(c.moveHelp)+'</p><button class="btn" id="crewMoveBtn">'+esc(c.move)+'</button></div>';

  const tapeHtml=events.length
    ? events.map(e=>'<div class="tape-event"><strong>'+esc(e.label)+'</strong><br>'+esc(e.detail)+'</div>').join('')
    : '<div class="tape-event"><strong>Listening...</strong><br>Waiting for the next market or on-chain event.</div>';

  $('deskBody').innerHTML=
    '<div class="active-job">'+
      '<div class="active-header"><div><span class="role">'+esc(modes[j.mode].name)+'</span><h4>$'+esc(j.symbol)+'</h4></div><div class="timer">'+String(Math.floor(remain/60)).padStart(2,'0')+':'+String(remain%60).padStart(2,'0')+'</div></div>'+
      '<div class="watching"><b>THIS IS THE JOB</b><br>The market is live. Watch the Street Tape and decide whether to use the crew move before the clock dies.</div>'+
      '<div class="active-crew"><img src="'+c.img+'" alt=""><div><b>'+esc(c.name)+' is on the job.</b><small>'+esc(c.ability)+'</small></div></div>'+
      '<div class="job-metrics"><div class="jm"><b>'+price(j.entry.priceUsd)+'</b><small>entry</small></div><div class="jm"><b>'+price(j.last.priceUsd)+'</b><small>current</small></div><div class="jm"><b class="'+(pct>=0?'up':'down')+'">'+(pct>=0?'+':'')+pct.toFixed(2)+'%</b><small>live move</small></div></div>'+
      '<div class="chain-stat"><div><b>'+(chain.sig2m||0)+'</b><small>Helius pair sigs · 2m</small></div><div><b>'+(chain.sig5m||0)+'</b><small>Helius pair sigs · 5m</small></div></div>'+
      moveHtml+
      '<div class="progress"><i style="width:'+done+'%"></i></div>'+
      '<div class="street-tape"><div class="street-tape-title"><span>LIVE STREET TAPE</span><span>HELIUS + MARKET</span></div>'+tapeHtml+'</div>'+
      '<button class="ghost" id="watchBoardBtn" style="width:100%;margin-top:12px">Watch the Live Family Board</button>'+
    '</div>';

  const mb=$('crewMoveBtn');if(mb)mb.onclick=useCrewMove;
  const wb=$('watchBoardBtn');if(wb)wb.onclick=()=>document.querySelector('.liveboard').scrollIntoView({behavior:'smooth'});
}

function settleLocal(j){
  if(!GAME.settled.includes(j.id)){
    GAME.settled.push(j.id);GAME.jobs++;GAME.respect=Math.max(0,GAME.respect+j.result.points);
    if(j.result.success){GAME.wins++;GAME.streak++}else GAME.streak=0;
    GAME.history.unshift({symbol:j.symbol,crew:j.crew,mode:j.mode,points:j.result.points,success:j.result.success,time:Date.now()});
    GAME.history=GAME.history.slice(0,10);GAME.activeJobId=null;save();
  }
  const o=j.result;
  $('deskTitle').textContent=o.success?'Job complete.':'Job went sideways.';
  $('deskBody').innerHTML=
    '<div class="result"><span class="role">'+esc(crew[j.crew].name)+' · '+esc(modes[j.mode].name)+'</span>'+
    '<h4>'+(o.success?'THE FAMILY WON THE JOB.':'SOMEBODY OWES AN EXPLANATION.')+'</h4>'+
    '<div class="job-metrics"><div class="jm"><b class="'+(o.pct>=0?'up':'down')+'">'+(o.pct>=0?'+':'')+o.pct.toFixed(2)+'%</b><small>price move</small></div><div class="jm"><b>'+o.liq.toFixed(1)+'%</b><small>liquidity move</small></div><div class="jm"><b>'+o.mult.toFixed(2)+'×</b><small>crew multiplier</small></div></div>'+
    '<div class="respect '+(o.points>=0?'win':'loss')+'">'+(o.points>=0?'+':'')+o.points+' FAMILY RESPECT</div>'+
    (o.actionNote?'<div class="watching"><b>CREW MOVE</b><br>'+esc(o.actionNote)+(o.actionBonus?' · '+(o.actionBonus>0?'+':'')+o.actionBonus+' Respect':'')+'</div>':'')+
    '<button class="btn" id="anotherJobBtn">Take Another Job</button><button class="share-x" id="shareJobBtn">Share This Job to X</button></div>';
  $('anotherJobBtn').onclick=nextJob;
  $('shareJobBtn').onclick=()=>shareJob(j.id);
  loadWarBoard();
}

function nextJob(){GAME.activeJobId=null;selected=null;save();renderJobs();renderDesk();$('jobs').scrollIntoView({behavior:'smooth',block:'center'})}
function startPolling(){clearInterval(pollTimer);renderActive();pollTimer=setInterval(()=>{if(GAME.activeJobId)renderActive();else clearInterval(pollTimer)},2500)}

async function loadWarBoard(){
  try{
    const r=await fetch('/api/live-jobs?t='+Date.now());
    const d=await r.json(),rows=[];
    for(const j of d.active){
      const left=Math.max(0,Math.ceil((j.end-d.now)/1000));
      rows.push({me:j.playerId===GAME.playerId,alias:j.alias,symbol:j.symbol,crew:crew[j.crew]?.short||j.crew,status:'LIVE '+left+'s',klass:'status-live'});
    }
    for(const j of d.completed.slice(0,8)){
      rows.push({me:j.playerId===GAME.playerId,alias:j.alias,symbol:j.symbol,crew:crew[j.crew]?.short||j.crew,status:(j.result.success?'WIN ':'LOSS ')+(j.result.points>=0?'+':'')+j.result.points+'R',klass:j.result.success?'status-win':'status-loss'});
    }
    $('warTable').innerHTML=rows.length
      ? '<div class="war-row headrow"><span>Player</span><span>Target</span><span>Crew</span><span>Status</span><span>Street</span></div>'+rows.map(x=>'<div class="war-row '+(x.me?'me':'')+'"><span><b>'+esc(x.alias)+'</b>'+(x.me?' <small>(YOU)</small>':'')+'</span><span>$'+esc(x.symbol)+'</span><span>'+esc(x.crew)+'</span><span class="'+x.klass+'">'+esc(x.status)+'</span><span>'+(x.me?'YOUR JOB':'FAMILY')+'</span></div>').join('')
      : '<div class="empty"><b>The street is quiet.</b>Your first job will appear here immediately. Anyone else playing on the site joins the same board.</div>';
  }catch(e){}
}

function renderProgress(){
  const thresholds=[0,500,1500,3500,7000],names=['Associate','Soldier','Capo','Underboss','Don'];
  const r=GAME.respect,current=rank(r),idx=names.indexOf(current),nextIdx=Math.min(idx+1,names.length-1),start=thresholds[idx],next=thresholds[nextIdx],pct=idx===names.length-1?100:Math.min(100,Math.max(0,(r-start)/(next-start)*100));
  $('rankTitle').textContent=current;$('aliasCard').textContent=GAME.alias;$('respectCard').textContent=Math.round(r).toLocaleString()+' R';$('cardStats').textContent=GAME.wins+' wins · '+GAME.jobs+' jobs · '+GAME.streak+' streak';
  $('careerBar').style.width=pct+'%';$('careerNext').textContent=idx===names.length-1?'You are the Don.':current+' → '+names[nextIdx];$('careerExplain').textContent=idx===names.length-1?'Top rank reached. Keep stacking wins and Respect.':Math.max(0,next-Math.round(r)).toLocaleString()+' more Respect to reach '+names[nextIdx]+'.';
  document.querySelectorAll('.rank-step').forEach((el,i)=>{el.classList.toggle('done',r>=thresholds[i]&&i<idx);el.classList.toggle('active',i===idx)});
  $('historyRows').innerHTML=GAME.history.slice(0,6).map((x,i)=>'<div class="leader-row"><div class="leader-rank">0'+(i+1)+'</div><div><b>$'+esc(x.symbol)+'</b><small>'+crew[x.crew]?.short+' · '+modes[x.mode]?.name+'</small></div><div class="leader-score '+(x.success?'win':'loss')+'">'+(x.points>=0?'+':'')+x.points+' R</div></div>').join('');
}

bindModeTabs();renderMode();renderProgress();loadJobs();loadWarBoard();
boardTimer=setInterval(loadWarBoard,5000);
if(GAME.activeJobId)startPolling();
