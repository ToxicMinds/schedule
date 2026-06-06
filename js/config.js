const APP_VERSION = 6;
const SB_URL = 'https://todakddcgsktsvkmvhzk.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZGFrZGRjZ3NrdHN2a212aHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1Mzg1NjQsImV4cCI6MjA5NjExNDU2NH0.Tz1KC4esxj-XXB5X-0PvU4EC8IMUBVQA3hi8bdDvrCI';
const VAPID_PUBLIC_KEY = 'BGgnMiGqXgTviD_GfYqurXImIPplO7mBT-A8l7mGW4bN_HVReCVYsjRGsB79UNI7cECkiWpGPlWj_a0iobHKZIk';

let sb = null;
try {
  if (window.supabase) {
    const { createClient } = window.supabase;
    sb = createClient(SB_URL, SB_KEY);
  } else {
    console.warn('[RecompOS] Supabase CDN not loaded — running local-only');
  }
} catch(e) {
  console.warn('[RecompOS] Supabase init failed:', e.message);
}

const DEFAULT_ALARMS = [
  {id:"d1",title:"🏸 Badminton Tonight",msg:"Get ready — doubles at 6:15 PM",time:"17:45",days:[3,6],on:true},
  {id:"d2",title:"🏋️ Gym Session",msg:"45 min — don't skip",time:"17:30",days:[1,4],on:true},
  {id:"d3",title:"🚶 Evening Walk",msg:"10–15 min post-dinner walk",time:"19:25",days:[0,1,2,3,4,5,6],on:true},
  {id:"d4",title:"📵 Screen Off",msg:"Switch to night mode — protect your sleep",time:"20:30",days:[0,1,2,3,4,5,6],on:true},
  {id:"d5",title:"😴 Wind Down",msg:"Bedtime in 15 min — 10 PM target",time:"21:45",days:[0,1,2,3,4,5,6],on:true},
];
const DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_D = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const DB = {
  g(k,d=null){try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d}catch{return d}},
  s(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},
  d(k){try{localStorage.removeItem(k)}catch{}},
};
