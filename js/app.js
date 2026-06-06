const App = {
  alarms: new Alarms(),
  meals: new Meals(),
  tracker: new Tracker(),
  _currentWeek: 1,
  _currentSess: 'A',

  async init(){
    this._checkVersion();
    this._applyTheme();
    this._greeting();
    this._renderHome();
    this._renderAlarms();
    this._renderRecipes();
    this._renderTrack();
    this._renderWorkout();
    this._checkNotif();
    this.alarms.schedule();
    document.getElementById('t-date').value=new Date().toISOString().slice(0,10);
    setInterval(()=>this._greeting(),60000);
    this._initSW();
    Sync.init().then(async()=>{
      this.alarms.list = DB.g('alarms', DEFAULT_ALARMS);
      this.meals = new Meals();
      this._renderHome();this._renderAlarms();this._renderTrack();this._renderRecipes();this.alarms.schedule();
      if(Notification.permission==='granted')await Sync.subscribeWebPush();
    }).catch(()=>{});
  },

  _checkVersion(){
    const prev = DB.g('appVersion', 0);
    if (prev !== 0 && prev < APP_VERSION) {
      ['alarms','mealPlan', 'gChecks', 'poolSeen'].forEach(k => { if (DB.g(k) !== null) DB.d(k); });
    }
    DB.s('appVersion', APP_VERSION);
  },

  _initSW(){
    if (!('serviceWorker' in navigator)) return;
    const banner = document.getElementById('update-banner');
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      banner.style.display = 'block';
      setTimeout(() => window.location.reload(), 500);
    });
    navigator.serviceWorker.register('./sw.js').then(reg => {
      if (reg.waiting) {
        banner.textContent = '🔄 New version found — activating…';
        banner.style.display = 'block';
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            banner.textContent = '🔄 Update ready — applying…';
            banner.style.display = 'block';
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {});
  },

  nav(page,btn){
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
    document.getElementById('page-'+page).classList.add('active');
    btn.classList.add('active');
    document.getElementById('topbar-title').textContent={home:'RecompOS',alarms:'Alarms',recipes:'Food',track:'Progress',workout:'Workout',plan:'Body Plan'}[page]||'RecompOS';
    document.getElementById('pages').scrollTop=0;
  },

  _applyTheme(){
    const saved = DB.g('theme', 'dark');
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-btn');
    if(btn) btn.textContent = saved === 'light' ? '🌙' : '☀️';
  },

  toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    DB.s('theme', next);
    document.getElementById('theme-btn').textContent = next === 'light' ? '🌙' : '☀️';
  },

  _greeting(){
    const now=new Date(),h=now.getHours();
    document.getElementById('hgreeting').textContent=h<12?'Good morning ☀️':h<17?'Good afternoon 👋':h<21?'Good evening 🌆':'Good night 🌙';
    document.getElementById('hdate').textContent=now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  },

  _renderHome(){
    const ta=this.alarms.today();const now=new Date();
    const ct=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    document.getElementById('today-alarms').innerHTML=ta.length
      ?ta.map(a=>`<div class="flex ac gap2" style="padding:6px 0;border-bottom:1px solid var(--border);opacity:${a.time<ct?0.45:1}"><span style="font-size:22px;font-weight:800;color:var(--amber);min-width:54px;font-variant-numeric:tabular-nums">${a.time}</span><div><div style="font-size:13px;font-weight:600;color:#fff">${a.title}</div><div style="font-size:11px;color:var(--muted)">${a.msg}</div></div></div>`).join('')
      :`<div style="color:var(--muted);font-size:13px">No alarms for today</div>`;
    const last=this.tracker.lastW();
    if(last){document.getElementById('s-cur').textContent=last.w;document.getElementById('s-lost').textContent=+(133.5-last.w).toFixed(1);}
    const startW = 133.5;
    const ws = this.tracker.getW(14);
    if(ws.length>=2){
      const current = ws[ws.length-1].w;
      const weeks = DB.g('weights',[]).length >= 30 ? 30 : DB.g('weights',[]).length;
      const weeklyRate = (startW - current) / Math.max(weeks, 1);
      const goalW = 97;
      const weeksLeft = weeklyRate > 0 ? Math.ceil((current - goalW) / weeklyRate) : '—';
      document.getElementById('s-wks').textContent = weeksLeft;
    }
    const todayKcal=DB.g('dailyKcal',{})[new Date().toISOString().slice(0,10)];
    if(todayKcal){const pct=Math.min(100,Math.round((todayKcal/2300)*100));document.getElementById('kcal-progress').style.display='block';document.getElementById('kcal-vals').textContent=`${todayKcal} / 2,300 kcal`;document.getElementById('kcal-bar').style.cssText=`width:${pct}%;background:${todayKcal>2300?'#f87171':'#f59e0b'}`;}
    if(ws.length>=2)document.getElementById('mini-chart').innerHTML=lineChart(ws.map(w=>({v:w.w,l:w.date.slice(5)})),{h:80,dots:false});
    this._renderWater();
    this._renderStreaks();
    const batches=this.meals.plan.batches;
    document.getElementById('home-dinner-content').innerHTML=batches?.length
      ?batches.map(r=>`<div class="flex gap2 ac" style="margin-bottom:6px"><span style="font-size:26px;flex-shrink:0">${r.e}</span><div><div style="font-weight:700;color:#fff">${r.name}</div><div style="font-size:12px;color:var(--muted)">Batch of ${r.batch} · ${r.k} kcal/serving · ${r.p}g protein/serving</div></div></div>`).join('')
      :`<div style="color:var(--muted);font-size:13px">Go to Food tab →</div>`;
    const checks=DB.g('eveChecks',{});const today=new Date().toISOString().slice(0,10);
    const items=[{k:'walk',l:'🚶 Post-dinner walk'},{k:'food',l:'📝 Logged today\'s food'},{k:'screen',l:'📵 Screens off by 8:30'},{k:'prep',l:'🎒 Prepped for tomorrow'},{k:'sleep',l:'😴 In bed by 10 PM'}];
    document.getElementById('eve-checks').innerHTML=items.map(it=>{const done=!!checks[today+it.k];return `<div class="cli"><div class="ccirc${done?' on':''}" onclick="App._toggleEve('${today+it.k}',this)">${done?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':''}</div><span style="font-size:13px;${done?'text-decoration:line-through;opacity:.5':''}">${it.l}</span></div>`;}).join('');
  },

  _renderStreaks(){
    const checks=DB.g('eveChecks',{});
    let streak=0;const d=new Date();
    for(let i=0;i<365;i++){
      const key=d.toISOString().slice(0,10);
      const done=['walk','food','screen','prep','sleep'].every(k=>checks[key+k]);
      if(done)streak++;else if(i>0)break;
      d.setDate(d.getDate()-1);
    }
    const water=DB.g('water',{});
    let wStreak=0;const wd=new Date();
    for(let i=0;i<365;i++){
      const key=wd.toISOString().slice(0,10);
      if((water[key]||0)>=8)wStreak++;else if(i>0)break;
      wd.setDate(wd.getDate()-1);
    }
    document.getElementById('streak-cards').innerHTML=`
      <div class="strk-card"><span class="strk-val">${streak}</span><span class="strk-lbl">Day Streak<br>Evening Checklist</span></div>
      <div class="strk-card"><span class="strk-val">${wStreak}</span><span class="strk-lbl">Day Streak<br>Hydration</span></div>
    `;
  },

  _renderWater(){
    const today=new Date().toISOString().slice(0,10);const count=DB.g('water',{})[today]||0;
    document.getElementById('water-count').textContent=`${count} / 10 glasses`;
    document.getElementById('water-drops').innerHTML=Array.from({length:10},(_,i)=>`<div class="drop${i<count?' on':''}" onclick="App._toggleWater(${i})">💧</div>`).join('');
  },

  _toggleWater(i){
    const today=new Date().toISOString().slice(0,10);const water=DB.g('water',{});
    water[today]=water[today]>i?i:i+1;DB.s('water',water);this._renderWater();
    if(water[today]>=10)this.toast('💧 2.5L done!');Sync.push().catch(()=>{});
  },

  _toggleEve(key,el){
    const checks=DB.g('eveChecks',{});checks[key]=!checks[key];DB.s('eveChecks',checks);
    const done=checks[key];el.classList.toggle('on',done);
    el.innerHTML=done?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':'';
    el.nextElementSibling.style.cssText=done?'font-size:13px;text-decoration:line-through;opacity:.5':'font-size:13px;';
    this._renderStreaks();
  },

  quickLog(){
    const w=parseFloat(document.getElementById('ql-weight').value);
    const k=parseInt(document.getElementById('ql-kcal').value);
    const s=parseInt(document.getElementById('ql-steps').value);
    const today=new Date().toISOString().slice(0,10);let logged=0;
    if(w&&w>50&&w<300){this.tracker.addW(w,today);logged++;}
    if(k&&k>0){const dk=DB.g('dailyKcal',{});dk[today]=k;DB.s('dailyKcal',dk);logged++;Sync.push().catch(()=>{});}
    if(s&&s>0){this.tracker.addSteps(s,today);logged++;}
    if(!logged){this.toast('Enter at least one value');return;}
    this._renderHome();this._renderTrack();this.toast('Logged ✓');
    ['ql-weight','ql-kcal','ql-steps'].forEach(id=>document.getElementById(id).value='');
  },

  _renderAlarms(){
    const perm='Notification' in window?Notification.permission:'denied';
    document.getElementById('notif-warn').style.display=perm!=='granted'?'block':'none';
    document.getElementById('notif-ok').style.display=perm==='granted'?'block':'none';
    document.getElementById('alarms-list').innerHTML=this.alarms.list.map(a=>`<div class="acard"><div class="flex jb"><div><div class="atime">${a.time}</div><div class="atitle">${a.title}</div><div class="amsg">${a.msg}</div><div class="dchips">${DAYS_S.map((d,i)=>`<div class="dc${a.days.includes(i)?' on':''}">${d}</div>`).join('')}</div></div><div class="flex gap2" style="flex-direction:column;align-items:flex-end"><div class="tog${a.on?' on':''}" onclick="App._toggleAlarm('${a.id}',this)"></div><button class="btn bd bsm" style="margin-top:4px" onclick="App._delAlarm('${a.id}')">✕</button></div></div></div>`).join('')||'<div style="color:var(--muted);font-size:13px;margin-bottom:12px">No alarms yet.</div>';
  },

  _toggleAlarm(id,el){this.alarms.toggle(id);el.classList.toggle('on');this._renderHome();},
  _delAlarm(id){if(confirm('Delete this alarm?')){this.alarms.remove(id);this._renderAlarms();this._renderHome();}},

  showAddAlarm(){
    document.getElementById('mbody').innerHTML=`<h3 style="color:#fff;font-size:16px;font-weight:700;margin:0 0 16px;text-transform:none;letter-spacing:normal">New Alarm</h3>
    <div style="margin-bottom:10px"><label class="flbl">Title</label><input id="na-title" placeholder="e.g. 🏋️ Gym Session"></div>
    <div style="margin-bottom:10px"><label class="flbl">Message</label><input id="na-msg" placeholder="e.g. 45 min — don't skip"></div>
    <div style="margin-bottom:10px"><label class="flbl">Time</label><input id="na-time" type="time" value="18:00"></div>
    <div style="margin-bottom:16px"><label class="flbl">Repeat on days</label><div class="dsel">${DAYS_S.map((d,i)=>`<button class="dsb" data-i="${i}" onclick="this.classList.toggle('on')">${d}</button>`).join('')}</div></div>
    <button class="btn bp bfl" onclick="App._saveAlarm()">Add Alarm</button>`;
    this.openMod();
  },

  _saveAlarm(){
    const title=document.getElementById('na-title').value.trim();const msg=document.getElementById('na-msg').value.trim();
    const time=document.getElementById('na-time').value;const days=[...document.querySelectorAll('.dsb.on')].map(b=>+b.dataset.i);
    if(!title||!time||!days.length){this.toast('Fill title, time, and pick days');return;}
    this.alarms.add({title,msg:msg||title,time,days});this.closeMod();this._renderAlarms();this._renderHome();this.toast('Alarm added ✓');
  },

  async requestNotifications(){
    if(!('Notification' in window)){this.toast('Notifications not supported');return;}
    if(Notification.permission==='granted'){this._checkNotif();this._renderAlarms();if(Sync.ready)await Sync.subscribeWebPush();this.toast('Notifications already on ✓');return;}
    const r=await Notification.requestPermission();
    if(r==='granted'){document.getElementById('notif-btn').classList.add('on');this._renderAlarms();this.alarms.schedule();if(Sync.ready)await Sync.subscribeWebPush();this.toast('🔔 Notifications + Web Push enabled ✓');}
    else this.toast('Permission denied — check browser settings');
  },

  _checkNotif(){if('Notification' in window&&Notification.permission==='granted')document.getElementById('notif-btn').classList.add('on');},

  _renderRecipes(){
    const plan=this.meals.plan;const wk=new Date(plan.wk);const end=new Date(wk);end.setDate(end.getDate()+6);
    const ps=this.meals.poolStatus();
    document.getElementById('recipe-week-lbl').textContent=`${wk.toLocaleDateString('en-GB',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-GB',{month:'short',day:'numeric'})} · ${ps.left} of ${ps.total} recipes new`;
    document.getElementById('pool-status').textContent=ps.tried===ps.total?`All ${ps.total} tried — pool reset ✓`:`${ps.tried}/${ps.total} tried · ${ps.left} unseen left`;
    document.getElementById('weekly-meals').innerHTML=`
      <div class="alert ai" style="margin-bottom:10px"><b>🍗 Batch Cook Strategy</b>Cook Batch 1 on Sunday (lasts Mon–Thu). Cook Batch 2 on Thursday (lasts Fri–Sun). Each batch = ${plan.batches[0]?.batch||4} servings.</div>
      ${plan.batches.map((r,i)=>`
      <div class="rcard" onclick="App.showRecipe(${r.id})">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">${i===0?'Batch 1 — Cook Sunday':'Batch 2 — Cook Thursday'}</div>
        <div class="flex ac gap2">
          <span style="font-size:34px;flex-shrink:0">${r.e}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:700;color:#fff">${r.name}</div>
            <div style="font-size:12px;color:var(--muted)">Batch of ${r.batch} servings · ${r.t} min cook time</div>
          </div>
        </div>
        <div class="mprow" style="margin-top:10px;margin-bottom:0">
          <div class="mp mpp">${r.p}g<br><span style="font-size:9px;opacity:.7">PROTEIN/serving</span></div>
          <div class="mp mpc">—<br><span style="font-size:9px;opacity:.7">CARBS</span></div>
          <div class="mp mpf">${r.f}g<br><span style="font-size:9px;opacity:.7">FAT/serving</span></div>
          <div class="mp mpk">${r.k}<br><span style="font-size:9px;opacity:.7">KCAL/serving</span></div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">${r.desc} · <span style="color:var(--amber)">Tap for full recipe →</span></div>
      </div>`).join('')}`;

    document.getElementById('all-recipes-list').innerHTML=RX.map(r=>`<div class="rcard" onclick="App.showRecipe(${r.id})"><div class="flex ac gap2"><span style="font-size:26px;flex-shrink:0">${r.e}</span><div style="flex:1"><div style="font-size:14px;font-weight:700;color:#fff">${r.name}</div><div style="font-size:12px;color:var(--muted)">${r.desc}</div></div><div style="text-align:right;flex-shrink:0;font-size:12px"><div style="color:var(--amber);font-weight:700">${r.p}g P/serving</div><div style="color:var(--muted)">×${r.batch} servings · ${r.t}m</div></div></div></div>`).join('');
    this._renderGrocery();
  },

  recipeView(v){
    ['batches','grocery','all'].forEach(n=>{document.getElementById('rv-'+n).style.display=v===n?'block':'none';});
    ['batches','grocery','all'].forEach(n=>{document.getElementById('r-btn-'+n).className='btn bsm '+(v===n?'bp':'bg_');});
  },

  regenerateMeals(){
    this.meals.regen();
    this._renderRecipes();
    this._renderHome();
    const ps=this.meals.poolStatus();
    this.toast(`New pair 🍗 · ${ps.left} unseen left`);
  },

  showRecipe(id){
    const r=RX.find(x=>x.id===id);if(!r)return;
    const hasIP = r.instantPot && r.prep;
    document.getElementById('mbody').innerHTML=`
      <div class="flex gap2 ac" style="margin-bottom:6px">
        <span style="font-size:40px">${r.e}</span>
        <div><div style="font-size:18px;font-weight:700;color:#fff">${r.name}</div><div style="font-size:12px;color:var(--muted)">${r.t} min · Batch of ${r.batch} servings</div></div>
      </div>
      <div class="alert as" style="margin-bottom:14px"><b>Per serving (×${r.batch} total batch)</b>${r.desc}</div>
      <div class="mprow" style="margin-bottom:16px">
        <div class="mp mpp">${r.p}g<br><span style="font-size:9px;opacity:.7">PROTEIN</span></div>
        <div class="mp mpc">${r.c}g<br><span style="font-size:9px;opacity:.7">CARBS</span></div>
        <div class="mp mpf">${r.f}g<br><span style="font-size:9px;opacity:.7">FAT</span></div>
        <div class="mp mpk">${r.k}<br><span style="font-size:9px;opacity:.7">KCAL</span></div>
      </div>
      <h3>Ingredients — Full Batch (${r.batch} servings)</h3>
      <div style="background:var(--bg3);border-radius:9px;overflow:hidden;margin-bottom:16px">
        ${r.ing.map(i=>`<div class="flex jb" style="padding:9px 12px;border-bottom:1px solid var(--border);font-size:13px"><span style="font-weight:500">${i.n}</span><span style="color:var(--amber);font-weight:600">${i.a}</span></div>`).join('')}
      </div>
      ${hasIP?`
      <div class="method-tabs">
        <button class="method-btn on" id="mth-stovetop" onclick="App._showRecipeMethod('stovetop',${r.id})">🔥 Stovetop</button>
        <button class="method-btn" id="mth-instantpot" onclick="App._showRecipeMethod('instantpot',${r.id})">⚡ Instant Pot</button>
      </div>
      <div id="recipe-method-content">
        <h3>Method</h3>
        <div style="counter-reset:step">
          ${r.steps.map((s,i)=>`<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;font-weight:700;color:var(--amber);min-width:22px;padding-top:1px">${i+1}.</span><span style="font-size:13px;line-height:1.55">${s}</span></div>`).join('')}
        </div>
      </div>`:`
      <h3>Method</h3>
      <div style="counter-reset:step">
        ${r.steps.map((s,i)=>`<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;font-weight:700;color:var(--amber);min-width:22px;padding-top:1px">${i+1}.</span><span style="font-size:13px;line-height:1.55">${s}</span></div>`).join('')}
      </div>`}
      <div style="margin-top:16px;padding:12px;background:var(--gb);border-radius:9px;font-size:13px;color:var(--green)">
        <strong>Storage:</strong> Cool completely, portion into ${r.batch} containers, refrigerate up to 5 days. Reheat 90 seconds in microwave or in a pan.
      </div>`;
    this.openMod();
  },

  _showRecipeMethod(method,id){
    const r=RX.find(x=>x.id===id);if(!r)return;
    document.querySelectorAll('.method-btn').forEach(b=>b.classList.remove('on'));
    if(method==='stovetop'){
      document.getElementById('mth-stovetop').classList.add('on');
      document.getElementById('recipe-method-content').innerHTML=`
        <h3>Method</h3>
        <div style="counter-reset:step">
          ${r.steps.map((s,i)=>`<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;font-weight:700;color:var(--amber);min-width:22px;padding-top:1px">${i+1}.</span><span style="font-size:13px;line-height:1.55">${s}</span></div>`).join('')}
        </div>`;
    } else {
      document.getElementById('mth-instantpot').classList.add('on');
      document.getElementById('recipe-method-content').innerHTML=`
        ${r.prep?`
        <h3>Prep</h3>
        <div style="background:var(--bg3);border-radius:9px;margin-bottom:12px">
          ${r.prep.map((s,i)=>`<div style="display:flex;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border)"><span style="font-size:12px;font-weight:700;color:var(--blue);min-width:22px">${i+1}.</span><span style="font-size:13px;line-height:1.55">${s}</span></div>`).join('')}
        </div>`:''}
        <h3>Instant Pot Cooking</h3>
        <div style="counter-reset:step">
          ${r.instantPot.map((s,i)=>`<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;font-weight:700;color:var(--amber);min-width:22px;padding-top:1px">${i+1}.</span><span style="font-size:13px;line-height:1.55">${s}</span></div>`).join('')}
        </div>`;
    }
  },

  _renderGrocery(){
    const items=this.meals.grocery();
    const cats={veg:{l:'🥦 Vegetables',items:[]},protein:{l:'🍗 Chicken & Proteins',items:[]},dairy:{l:'🧀 Dairy',items:[]},dry:{l:'🌾 Dry Goods & Oils',items:[]}};
    items.forEach(it=>(cats[it.cat]||cats.dry).items.push(it));
    let total=0;items.forEach(i=>total+=i.total);
    document.getElementById('gtotal').textContent='€'+total.toFixed(2);
    document.getElementById('grocery-sections').innerHTML=Object.values(cats).filter(c=>c.items.length).map(cat=>`<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;padding:6px 0">${cat.l}</div><div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden">${cat.items.map(it=>{const k=it.n.replace(/\s+/g,'_');const ck=it.checked;return `<div class="gi${ck?' ck':''}" id="gi_${k}"><div class="gchk${ck?' on':''}" onclick="App._toggleGrocery('${k}')">${ck?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':''}</div><div class="gn">${it.n}<br><span style="font-size:11px;color:var(--muted)">${it.a}</span></div><div class="gp">€${it.total.toFixed(2)}</div></div>`;}).join('')}</div></div>`).join('');
  },

  _toggleGrocery(key){
    const checks=DB.g('gChecks',{});checks[key]=!checks[key];DB.s('gChecks',checks);
    const row=document.getElementById('gi_'+key);if(!row)return;
    const btn=row.querySelector('.gchk');const on=checks[key];
    row.classList.toggle('ck',on);btn.classList.toggle('on',on);
    btn.innerHTML=on?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>':'';
  },

  clearGrocery(){DB.d('gChecks');this._renderGrocery();this.toast('Checks cleared');},

  _renderWorkout(){
    this._renderSchedule();
    this._renderExercises();
    this._renderBuilderMuscles();
  },

  _renderSchedule(){
    const wk=this._currentWeek;
    document.getElementById('workout-schedule').innerHTML=WK.schedule.map(d=>`
      <div class="sched-row">
        <span class="sched-day">${d.day.slice(0,3)}</span>
        ${d.sess
          ?`<span class="sched-sess ${d.sess}">Session ${d.sess}</span><span style="font-size:11px;color:var(--muted);margin-left:6px">${d.sess==='A'?'Push+Legs':'Pull+Hinge'}</span>`
          :`<span class="sched-sess rest">${d.note}</span>`}
        ${d.sess&&wk===2?`<span class="badge bg" style="margin-left:auto;font-size:9px">+5kg</span>`:''}
      </div>`).join('');
  },

  _renderExercises(){
    const wk=this._currentWeek;const sess=WK.sessions[this._currentSess];
    document.getElementById('workout-exercises').innerHTML=sess.exercises.map((ex,i)=>`
      <div class="ex-card">
        <div class="flex jb ac">
          <div>
            <div class="ex-name">${i+1}. ${ex.name}</div>
            <div class="ex-muscle">${ex.muscle}</div>
          </div>
        </div>
        <div class="ex-sets-row">
          <div class="ex-set-box${wk===1?'':' w2'}">
            <div class="label">Week ${wk} Sets</div>
            <div class="value">${wk===1?ex.w1:ex.w2}</div>
          </div>
          <div class="ex-set-box" style="max-width:80px">
            <div class="label">Rest</div>
            <div class="value" style="color:var(--blue)">${ex.rest}</div>
          </div>
        </div>
        <div class="ex-tip">💡 ${ex.tip}</div>
        <a class="yt-btn" href="https://www.youtube.com/results?search_query=${encodeURIComponent(ex.yt.replace(/\+/g,' '))}" target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.2 2.8 12 2.8 12 2.8s-4.2 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.3 21.6 12 21.7 12 21.7s4.2 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8 3.6-8 3.5z"/></svg>
          Watch Tutorial
        </a>
      </div>`).join('');
  },

  setWeek(n,btn){
    this._currentWeek=n;
    document.querySelectorAll('.wtab').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    this._renderSchedule();this._renderExercises();
  },

  setSess(s,btn){
    this._currentSess=s;
    document.querySelectorAll('.sess-tab').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    this._renderExercises();
    document.getElementById('log-workout-btn').textContent=`✓ Log Session ${s} as Done`;
  },

  logWorkoutSession(){
    const type=this._currentSess==='A'?'gym-a':'gym-b';
    this.tracker.addSession(type);this._renderTrack();
    this.toast(`🏋️ Session ${this._currentSess} logged ✓`);
  },

  showProgram(){
    document.getElementById('workout-program').style.display='block';
    document.getElementById('workout-builder').style.display='none';
    document.querySelectorAll('.btab').forEach(b=>b.classList.remove('on'));
    document.getElementById('btab-program').classList.add('on');
  },

  showBuilder(){
    document.getElementById('workout-program').style.display='none';
    document.getElementById('workout-builder').style.display='block';
    document.querySelectorAll('.btab').forEach(b=>b.classList.remove('on'));
    document.getElementById('btab-build').classList.add('on');
  },

  _renderBuilderMuscles(){
    document.getElementById('builder-muscles').innerHTML=Object.entries(BUILD).map(([k,v])=>
      `<button class="muscle-btn" onclick="App.selectMuscle('${k}',this)">
        <span class="muscle-icon">${v.icon}</span>
        <span class="muscle-name">${v.name}</span>
        <span class="muscle-count">${v.exercises.length} exercises</span>
      </button>`
    ).join('');
  },

  selectMuscle(group,btn){
    document.querySelectorAll('.muscle-btn').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    const g=BUILD[group];if(!g)return;
    document.getElementById('builder-title').textContent=`${g.icon} ${g.name} — ${g.exercises.length} Exercises`;
    document.getElementById('builder-exercises').innerHTML=g.exercises.map(ex=>
      `<div class="ex-card">
        <div class="flex jb ac">
          <div>
            <div class="ex-name">${ex.name}</div>
            <div class="ex-muscle">${ex.muscle}</div>
          </div>
        </div>
        <div class="ex-sets-row">
          <div class="ex-set-box">
            <div class="label">Sets × Reps</div>
            <div class="value">${ex.sets}</div>
          </div>
          <div class="ex-set-box" style="max-width:80px">
            <div class="label">Rest</div>
            <div class="value" style="color:var(--blue)">${ex.rest}</div>
          </div>
        </div>
        <div class="ex-tip">💡 ${ex.tip}</div>
        ${ex.vid
          ?`<button class="watch-btn" onclick="App.playVideo('${ex.vid}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              Watch Demo
            </button>`
          :''}
      </div>`
    ).join('');
    document.getElementById('builder-view').style.display='block';
  },

  backToMuscles(){
    document.getElementById('builder-view').style.display='none';
    document.querySelectorAll('.muscle-btn').forEach(b=>b.classList.remove('on'));
  },

  playVideo(videoId){
    document.getElementById('video-embed').innerHTML=
      `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    document.getElementById('video-overlay').classList.add('open');
  },

  closeVideo(e){
    if(e && e.target !== document.getElementById('video-overlay')) return;
    document.getElementById('video-embed').innerHTML='';
    document.getElementById('video-overlay').classList.remove('open');
  },

  _renderTrack(){
    const ws=this.tracker.getW(14);
    document.getElementById('wt-chart').innerHTML=ws.length>=2?lineChart(ws.map(w=>({v:w.w,l:w.date.slice(5)})),{h:120,grid:true}):'<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Log your weight below</div>';
    document.getElementById('wt-history').innerHTML=this.tracker.getW(7).reverse().map(w=>`<div class="lrow"><span style="color:var(--muted)">${w.date}</span><strong style="color:var(--amber)">${w.w} kg</strong></div>`).join('')||'<div style="color:var(--muted);font-size:13px">No entries yet</div>';
    document.getElementById('steps-chart').innerHTML=barChart(this.tracker.getSteps7(),{h:80,target:9000});
    const icons={badminton:'🏸 Badminton','gym-a':'🏋️ Gym A (Push+Legs)','gym-b':'🏋️ Gym B (Pull+Hinge)',home:'🏠 Home',walk:'🚶 Walk',rest:'✅ Rest'};
    document.getElementById('session-history').innerHTML=this.tracker.getSessions(6).map(s=>`<div class="lrow"><span style="color:var(--muted)">${s.date}</span><span>${icons[s.type]||s.type}</span></div>`).join('')||'<div style="color:var(--muted);font-size:13px">No sessions yet</div>';
  },

  logWeight(){const w=parseFloat(document.getElementById('t-weight').value);const d=document.getElementById('t-date').value||new Date().toISOString().slice(0,10);if(!w||w<50||w>300){this.toast('Enter a valid weight');return;}this.tracker.addW(w,d);this._renderTrack();this._renderHome();document.getElementById('t-weight').value='';this.toast('Weight logged ✓');},
  logSteps(){const s=parseInt(document.getElementById('t-steps').value);if(!s||s<0){this.toast('Enter valid steps');return;}this.tracker.addSteps(s);this._renderTrack();document.getElementById('t-steps').value='';this.toast(s>=9000?'🎯 Step goal hit!':'Steps logged ✓');},
  logSession(){const t=document.getElementById('t-session').value;this.tracker.addSession(t);this._renderTrack();this.toast('Session logged ✓');},

  openMod(){document.getElementById('moverlay').classList.add('open');document.getElementById('pages').style.overflow='hidden';},
  closeMod(e){if(!e||e.target===document.getElementById('moverlay')){document.getElementById('moverlay').classList.remove('open');document.getElementById('pages').style.overflow='';}},

  toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200);}
};
