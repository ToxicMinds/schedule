class Alarms{
  constructor(){this.list=DB.g('alarms',DEFAULT_ALARMS);this._t=[];}
  save(){DB.s('alarms',this.list);}
  add(a){a.id='a'+Date.now();a.on=true;this.list.push(a);this.save();this.schedule();Sync.push().catch(()=>{});Sync.pushAlarms().catch(()=>{});}
  toggle(id){const a=this.list.find(x=>x.id===id);if(a){a.on=!a.on;this.save();this.schedule();Sync.push().catch(()=>{});Sync.pushAlarms().catch(()=>{});}}
  remove(id){this.list=this.list.filter(x=>x.id!==id);this.save();this.schedule();Sync.push().catch(()=>{});Sync.pushAlarms().catch(()=>{});}
  schedule(){
    this._t.forEach(t=>clearTimeout(t));this._t=[];
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    const now=new Date(),tod=now.getDay();
    this.list.filter(a=>a.on&&a.days.includes(tod)).forEach(alarm=>{
      const[h,m]=alarm.time.split(':').map(Number);const at=new Date(now);at.setHours(h,m,0,0);
      const delay=at-now;if(delay>0&&delay<86400000)this._t.push(setTimeout(()=>this.fire(alarm),delay));
    });
    if('serviceWorker' in navigator){navigator.serviceWorker.ready.then(reg=>{if(!reg.active)return;const tod=new Date().getDay(),now=new Date();const toPost=this.list.filter(a=>a.on&&a.days.includes(tod)).map(a=>{const[h,m]=a.time.split(':').map(Number),at=new Date(now);at.setHours(h,m,0,0);return at>now?{...a,fireAt:at.getTime()}:null;}).filter(Boolean);reg.active.postMessage({type:'SCHEDULE_ALARMS',alarms:toPost});}).catch(()=>{});}
  }
  async fire(alarm){
    playBeep(800, 400, 0.15);
    if(Notification.permission!=='granted')return;
    try{
      const reg=await navigator.serviceWorker.ready;
      await reg.showNotification(alarm.title,{body:alarm.msg,icon:'./icon.svg',badge:'./icon.svg',vibrate:[300,100,300],tag:alarm.id,requireInteraction:true});
    }catch{
      try{new Notification(alarm.title,{body:alarm.msg});}catch{}
    }
  }
  today(){return this.list.filter(a=>a.on&&a.days.includes(new Date().getDay())).sort((a,b)=>a.time.localeCompare(b.time));}
}
