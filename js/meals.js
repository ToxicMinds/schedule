class Meals{
  constructor(){const saved=DB.g('mealPlan');this.plan=(saved&&saved.wk===this._wk())?saved:this._gen();}
  _wk(){const d=new Date(),day=d.getDay()||7;d.setDate(d.getDate()-day+1);return d.toISOString().slice(0,10);}
  _pickTwo(){
    let seen=DB.g('seenRecipes',[]);
    let unseen=RX.filter(r=>!seen.includes(r.id));
    if(unseen.length===0){seen=[];DB.s('seenRecipes',[]);unseen=RX;}
    const shuffled=[...unseen].sort(()=>Math.random()-.5);
    const picks=[shuffled[0],shuffled[1]];
    seen.push(...picks.map(r=>r.id));
    DB.s('seenRecipes',seen);
    return picks;
  }
  _gen(){
    const picks=this._pickTwo();
    const plan={wk:this._wk(),batches:picks};
    DB.s('mealPlan',plan);Sync.push().catch(()=>{});return plan;
  }
  regen(){
    const picks=this._pickTwo();
    this.plan={wk:this._wk(),batches:picks};
    DB.s('mealPlan',this.plan);Sync.push().catch(()=>{});return this.plan;
  }
  poolStatus(){
    const seen=DB.g('seenRecipes',[]);
    const tried=Math.min(seen.length,RX.length);
    const left=RX.length-tried;
    return{tried,total:RX.length,left};
  }
  grocery(){
    const items={};
    this.plan.batches.forEach(r=>{
      r.ing.forEach(ing=>{
        const k=ing.n;
        if(items[k]){items[k].total+=ing.pr;items[k].cnt++;}
        else{items[k]={...ing,total:ing.pr,cnt:1};}
      });
    });
    const checks=DB.g('gChecks',{});
    Object.keys(items).forEach(k=>{items[k].checked=!!checks[k.replace(/\s+/g,'_')];});
    const pantry=[
      {n:'Onions (1kg bag)',cat:'veg',a:'1 bag',total:0.89,cnt:1},{n:'Garlic (1 bulb)',cat:'veg',a:'1 bulb',total:0.49,cnt:1},
      {n:'Fresh ginger root',cat:'veg',a:'100g',total:0.99,cnt:1},{n:'Lemons (3-pack)',cat:'veg',a:'1 pack',total:0.79,cnt:1},
      {n:'Basmati rice 1kg',cat:'dry',a:'1 bag (sides)',total:1.79,cnt:1},{n:'Olive oil 500ml',cat:'dry',a:'1 bottle',total:3.49,cnt:1},
      {n:'Greek yogurt 500g (low-fat)',cat:'dairy',a:'1 tub',total:1.79,cnt:1},
    ];
    pantry.forEach(p=>{if(!items[p.n])items[p.n]={...p,checked:!!checks[p.n.replace(/\s+/g,'_')]};});
    return Object.values(items);
  }
}
