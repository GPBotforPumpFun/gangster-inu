(()=>{const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
function steps(){const w=q('#wars .wars-intro');if(!w||q('#wars .play-steps'))return;w.insertAdjacentHTML('afterend','<div class="play-steps"><div class="play-step"><span class="step-num">1</span><b>Pick a live job</b><small>Click any token card on the mission board.</small></div><div class="play-step"><span class="step-num">2</span><b>Choose your crew</b><small>Each Family member has a different ability.</small></div><div class="play-step"><span class="step-num">3</span><b>Take the job</b><small>The live round runs, then Family Respect is settled.</small></div></div>')}
function copy(){const w=q('#wanted .head p');if(w)w.textContent='Every Family Wars disaster leaves a paper trail. Chokes, miracle saves, legendary streaks and brutal misses earn their place on the wall.';const f=q('#family .head p');if(f)f.textContent='Each member of the Family has a different edge. Choose the crew whose specialty best fits the job.';const b=q('.mission-board .board-top strong');if(b)b.textContent='STEP 1 · CLICK A LIVE JOB';const hb=qa('.hero .btn').find(x=>/family wars/i.test(x.textContent));if(hb)hb.textContent='PLAY FAMILY WARS'}
function stamp(){const m=q('#modeExplain');if(!m||q('#feedStamp'))return;const d=document.createElement('div');d.id='feedStamp';d.className='feed-stamp';d.textContent='LIVE SOLANA FEED · CONNECTING';m.insertAdjacentElement('afterend',d)}
function jobs(){qa('.job-card').forEach(c=>{if(q('.select-cue',c))return;const f=q('.job-foot',c);if(!f)return;const x=document.createElement('div');x.className='select-cue';x.textContent=c.classList.contains('selected')?'JOB SELECTED':'SELECT THIS JOB';f.before(x)})}
function desk(){const d=q('#jobDesk'),t=q('#deskTitle');if(!d||!t)return;const e=q('.selection-empty',d);if(e&&/select one|choose/i.test(e.textContent)){t.textContent='Start here.';e.innerHTML='<span class="desk-step">STEP 1 OF 3</span><b style="color:var(--paper);font-size:18px">Pick a job on the left.</b><span class="desk-arrow">←</span>Your selected job opens here, then you choose your crew.'}else if(/choose your crew/i.test(t.textContent)){t.textContent='Step 2 · Choose your crew.';const b=qa('button',d).find(x=>/take the job/i.test(x.textContent));if(b)b.textContent='STEP 3 · TAKE THE JOB'}}
function status(){const s=q('#feedStamp'),l=q('#liveState');if(s&&l&&/live/i.test(l.textContent))s.textContent='LIVE SOLANA FEED · DEXSCREENER MARKET DATA · HELIUS ON-CHAIN CHECKS ACTIVE'}
function chain(){
  try{
    if(typeof intel!=='undefined')qa('.job-card').forEach(c=>{
      if(q('.chain-check',c))return;
      const x=intel.find(v=>v.address===c.dataset.address); if(!x)return;
      const d=document.createElement('div');d.className='chain-check '+(x.heliusVerified?'ok':'');d.innerHTML='<i></i>'+(x.heliusVerified?'HELIUS VERIFIED':'LIVE MARKET');const cue=q('.select-cue',c);if(cue)cue.before(d);
    });
    if(typeof state!=='undefined'&&state.activeJob&&state.activeJob.last&&state.activeJob.last.onchain){
      const box=q('.active-job');if(box&&!q('.onchain-line',box)){
        const o=state.activeJob.last.onchain,d=document.createElement('div');d.className='onchain-line';
        d.innerHTML='<b>'+(o.verified?'HELIUS VERIFIED':'ON-CHAIN CHECK')+'</b> · '+(o.signatures2m||0)+' recent pair signatures / 2m · '+(o.signatures5m||0)+' / 5m';
        const log=q('.pulse-log',box);if(log)log.before(d);else box.appendChild(d)
      }
    }
  }catch(e){}
}
function refresh(){steps();copy();stamp();jobs();desk();status();chain()}
document.addEventListener('DOMContentLoaded',()=>{refresh();const o=new MutationObserver(refresh);['#jobs','#jobDesk','#liveState'].forEach(s=>{const e=q(s);if(e)o.observe(e,{childList:true,subtree:true,characterData:true,attributes:true})})})})();