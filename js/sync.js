const Sync = {
  ready:false, uid:null, _dot:null,
  _status(s){
    if(!this._dot) this._dot=document.getElementById('sync-dot');
    this._dot.className='';
    if(s==='synced'){this._dot.classList.add('synced');this._dot.title='Synced ✓';}
    if(s==='syncing'){this._dot.classList.add('syncing');this._dot.title='Syncing…';}
    if(s==='error'){this._dot.classList.add('error');this._dot.title='Offline';}
  },
  async init(){
    if(!sb){this._status('error');console.warn('[Sync] No Supabase client — local-only mode');return;}
    try{
      this._status('syncing');
      let{data:{session}}=await sb.auth.getSession();
      if(!session){const{data,error}=await sb.auth.signInAnonymously();if(error)throw error;session=data.session;}
      this.uid=session.user.id;this.ready=true;
      await this.pull();
      App.alarms.list = DB.g('alarms', DEFAULT_ALARMS);
      App.meals = new Meals();
      this._status('synced');
      setInterval(()=>this.push().catch(()=>{}),90000);
    }catch(e){console.warn('[Sync]',e.message);this._status('error');}
  },
  async pull(){
    if(!this.ready||!sb)return;
    const{data:wts}=await sb.from('weights').select('date,weight').order('date');
    if(wts?.length){const local=DB.g('weights',[]),map={};wts.forEach(w=>{map[w.date]={date:w.date,w:w.weight};});local.forEach(w=>{map[w.date]=w;});DB.s('weights',Object.values(map).sort((a,b)=>a.date.localeCompare(b.date)));}
    const{data:alarms}=await sb.from('alarms').select('*');
    if(alarms?.length)DB.s('alarms',alarms.map(a=>({id:a.id,title:a.title,msg:a.message||a.title,time:a.time,days:a.days,on:a.enabled})));
    const{data:sessions}=await sb.from('sessions').select('date,type').order('date');
    if(sessions?.length)DB.s('sessions',sessions);
    const{data:steps}=await sb.from('steps').select('date,count');
    if(steps?.length){const local=DB.g('steps',{});steps.forEach(s=>{if(!local[s.date])local[s.date]=s.count;});DB.s('steps',local);}
    const{data:plans}=await sb.from('meal_plans').select('plan,week_start').order('week_start',{ascending:false}).limit(1);
    if(plans?.[0]&&!DB.g('mealPlan'))DB.s('mealPlan',plans[0].plan);
    const{data:logs}=await sb.from('daily_logs').select('*');
    if(logs?.length){const kcal=DB.g('dailyKcal',{}),water=DB.g('water',{});logs.forEach(l=>{if(l.kcal&&!kcal[l.date])kcal[l.date]=l.kcal;if(l.water_glasses&&!water[l.date])water[l.date]=l.water_glasses;});DB.s('dailyKcal',kcal);DB.s('water',water);}
  },
  async push(){
    if(!this.ready||!sb)return;this._status('syncing');
    try{
      const wts=DB.g('weights',[]);
      if(wts.length)await sb.from('weights').upsert(wts.map(w=>({user_id:this.uid,date:w.date,weight:w.w})),{onConflict:'user_id,date'});
      const alarms=DB.g('alarms',[]);
      if(alarms.length){await sb.from('alarms').delete().eq('user_id',this.uid);await sb.from('alarms').insert(alarms.map(a=>({id:a.id,user_id:this.uid,title:a.title,message:a.msg,time:a.time,days:a.days,enabled:a.on})));}
      const sessions=DB.g('sessions',[]);
      if(sessions.length)await sb.from('sessions').upsert(sessions.map(s=>({user_id:this.uid,date:s.date,type:s.type})),{onConflict:'user_id,date,type',ignoreDuplicates:true});
      const steps=DB.g('steps',{});const stepRows=Object.entries(steps).map(([date,count])=>({user_id:this.uid,date,count}));
      if(stepRows.length)await sb.from('steps').upsert(stepRows,{onConflict:'user_id,date'});
      const plan=DB.g('mealPlan');
      if(plan)await sb.from('meal_plans').upsert({user_id:this.uid,week_start:plan.wk,plan},{onConflict:'user_id,week_start'});
      const kcal=DB.g('dailyKcal',{}),water=DB.g('water',{});
      const dates=new Set([...Object.keys(kcal),...Object.keys(water)]);
      const logRows=[...dates].map(date=>({user_id:this.uid,date,kcal:kcal[date]||null,water_glasses:water[date]||null}));
      if(logRows.length)await sb.from('daily_logs').upsert(logRows,{onConflict:'user_id,date'});
      this._status('synced');
    }catch(e){console.warn('[Sync push]',e.message);this._status('error');}
  },
  async subscribeWebPush(){
    if(!this.ready||!sb||!('PushManager' in window))return false;
    try{
      const reg=await navigator.serviceWorker.ready;
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:_b64ToUint8(VAPID_PUBLIC_KEY)});
      await sb.from('push_subscriptions').upsert({user_id:this.uid,subscription:sub.toJSON(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
      return true;
    }catch(e){console.warn('[Sync push sub]',e.message);return false;}
  }
};
