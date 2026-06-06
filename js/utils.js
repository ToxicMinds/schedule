window.onerror = (msg, src, line, col, err) => {
  console.error('[RecompOS crash]', msg, 'at', src, line + ':' + col, err);
};
window.onunhandledrejection = e => {
  console.error('[RecompOS unhandled promise]', e.reason);
};

function _b64ToUint8(b64){
  const pad='='.repeat((4-b64.length%4)%4);
  const b=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(b);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}

function lineChart(pts,{h=100,color='#f59e0b',dots=true,grid=false}={}){
  if(!pts||pts.length<2)return '<div style="color:#6b7a99;font-size:12px;padding:16px;text-align:center">No data yet</div>';
  const W=300,P=18;const vs=pts.map(p=>p.v);
  const lo=Math.min(...vs)-(Math.max(...vs)-Math.min(...vs))*.12;
  const hi=Math.max(...vs)+(Math.max(...vs)-Math.min(...vs))*.12||lo+2;
  const x=i=>P+(i/(pts.length-1))*(W-2*P);
  const y=v=>h-P-((v-lo)/(hi-lo||1))*(h-2*P);
  const pl=pts.map((p,i)=>`${x(i)},${y(p.v)}`).join(' ');
  const ap=`${x(0)},${h} ${pl} ${x(pts.length-1)},${h}`;
  const gid='g'+Math.random().toString(36).slice(2);
  const gl=grid?`<line x1="${P}" y1="${P}" x2="${W-P}" y2="${P}" stroke="#2a3248" stroke-width="1" opacity=".5"/><line x1="${P}" y1="${h/2}" x2="${W-P}" y2="${h/2}" stroke="#2a3248" stroke-width="1" opacity=".3"/>`:'' ;
  const circles=dots?vs.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}"/>`).join(''):'' ;
  const lbls=pts.map((p,i)=>{if(!p.l)return '';if(i>0&&i<pts.length-1&&pts.length>6&&i%Math.ceil(pts.length/5)!==0)return '';return `<text x="${x(i)}" y="${h-2}" fill="#6b7a99" font-size="9" text-anchor="middle" font-family="sans-serif">${p.l}</text>`;}).join('');
  return `<svg viewBox="0 0 ${W} ${h}" xmlns="http://www.w3.org/2000/svg" width="100%"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${gl}<polygon points="${ap}" fill="url(#${gid})"/><polyline points="${pl}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${circles}${lbls}</svg>`;
}

function barChart(pts,{h=80,color='#f59e0b',target=null}={}){
  if(!pts||!pts.length)return '<div style="color:#6b7a99;font-size:12px;padding:12px;text-align:center">No data yet</div>';
  const W=300,P=6;const vs=pts.map(p=>p.v||0);const mx=Math.max(...vs,target||0)*1.15||1;
  const bw=(W-2*P)/pts.length-4;
  const bars=vs.map((v,i)=>{const bh=(v/mx)*(h-P-14);const bx=P+i*((W-2*P)/pts.length)+2;const by=h-14-bh;return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="${target&&v>=target?'#34d399':color}" opacity=".85"/><text x="${bx+bw/2}" y="${h-1}" fill="#6b7a99" font-size="9" text-anchor="middle" font-family="sans-serif">${pts[i].l||''}</text>`;}).join('');
  const tl=target?`<line x1="${P}" y1="${h-14-(target/mx)*(h-P-14)}" x2="${W-P}" y2="${h-14-(target/mx)*(h-P-14)}" stroke="#34d399" stroke-width="1" stroke-dasharray="4,3" opacity=".6"/>`:'' ;
  return `<svg viewBox="0 0 ${W} ${h}" xmlns="http://www.w3.org/2000/svg" width="100%">${bars}${tl}</svg>`;
}

function playBeep(freq=800, duration=300, vol=0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration/1000);
    if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
  } catch(e) {}
}
