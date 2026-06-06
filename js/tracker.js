class Tracker{
  constructor(){
    if(!DB.g('weights')){
      const ws=[],now=new Date();
      for(let i=29;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i*7);const noise=(Math.random()-.5)*.7;ws.push({date:d.toISOString().slice(0,10),w:+(133.5-17.5*Math.pow((29-i)/29,.82)+noise).toFixed(1)});}
      DB.s('weights',ws);
    }
  }
  addW(w,date){const ws=DB.g('weights',[]);const ei=ws.findIndex(x=>x.date===date);if(ei>=0)ws[ei].w=+w;else ws.push({date,w:+w});ws.sort((a,b)=>a.date.localeCompare(b.date));DB.s('weights',ws);Sync.push().catch(()=>{});}
  getW(n=14){return DB.g('weights',[]).slice(-n);}
  lastW(){const ws=DB.g('weights',[]);return ws.length?ws[ws.length-1]:null;}
  addSession(type){const ss=DB.g('sessions',[]);ss.push({date:new Date().toISOString().slice(0,10),type});DB.s('sessions',ss.slice(-60));Sync.push().catch(()=>{});}
  getSessions(n=8){return DB.g('sessions',[]).slice(-n).reverse();}
  addSteps(s,date){const all=DB.g('steps',{});all[date]=+s;DB.s('steps',all);Sync.push().catch(()=>{});}
  getSteps7(){const all=DB.g('steps',{});return Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return{l:DAYS_S[d.getDay()].slice(0,1),v:all[d.toISOString().slice(0,10)]||0};});}
}
