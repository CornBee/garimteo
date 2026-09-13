import { adjacent, army, boardOf, clone, development, emptyOrders, owned, price, resolve, validateOrders } from './game.ts';
import type { Orders, Player, RecordFile, State } from './game.ts';

function distance(state:State, start:string, targets:string[]):number {
  const seen=new Set([start]), q:[string,number][]=[[start,0]];
  for(let i=0;i<q.length;i++) { const [id,d]=q[i]; if(targets.includes(id)) return d; for(const n of adjacent(state,id)) if(!seen.has(n)) {seen.add(n);q.push([n,d+1]);} }
  return 12;
}
const jitter=(id:string,variant:number,turn:number)=>((id.split('').reduce((s,c)=>s+c.charCodeAt(0),0)*17+variant*31+turn*11)%29)/29;

export function candidateOrders(state:State,p:Player,variant:number,style:RecordFile['opponent']='balanced'):Orders {
  const o=emptyOrders(), foe=(1-p) as Player, ids=owned(state,p);
  const enemy=owned(state,foe), unowned=Object.keys(state.regions).filter(id=>state.regions[id].owner!==p);
  let cash=state.cash[p];
  const remain=boardOf(state).limit-state.turn;
  const developChance=style==='builder'?4:style==='bold'?1:3;
  if(variant%5<developChance&&remain>=3) {
    const sites=ids.filter(id=>state.regions[id].level<2).sort((a,b)=> {
      const value=(id:string)=>{
        const r=state.regions[id],d=distance(state,id,enemy);
        const exposure=adjacent(state,id).filter(n=>state.regions[n].owner===foe).reduce((s,n)=>s+state.regions[n].troops,0);
        return (r.level===0?6:1)+adjacent(state,id).length+Math.min(d,3)-Math.max(0,exposure-r.troops)*.7+jitter(id,variant,state.turn)*4;
      }; return value(b)-value(a);
    });
    for(const id of sites.slice(0,variant%3===0?2:1)) {
      const cost=state.regions[id].level===0?4:6;
      if(cash>=cost+(variant%2?2:0)&&remain>=(state.regions[id].level===0?3:5)) {o.develop.push(id);cash-=cost;}
    }
  }
  const cities=ids.filter(id=>state.regions[id].level).sort((a,b)=>distance(state,a,unowned)-distance(state,b,unowned)||jitter(b,variant,state.turn)-jitter(a,variant,state.turn));
  for(const id of cities) { const count=Math.min(state.regions[id].level,Math.floor(cash/2)); if(count) {o.recruit[id]=count;cash-=2*count;} }
  if(variant===15) return o;
  const incoming:Record<string,number>={};
  const add=(from:string,to:string,count:number)=>{
    if(!count) return; const previous=o.moves.find(m=>m.from===from&&m.to===to);
    if(previous) previous.count+=count; else o.moves.push({from,to,count});
    incoming[to]=(incoming[to]??0)+count;
  };
  const order=ids.sort((a,b)=>jitter(a,variant,state.turn)-jitter(b,variant,state.turn));
  for(const id of order) {
    const r=state.regions[id], neighbors=adjacent(state,id);
    let n=r.troops+(o.recruit[id]??0);
    const threats=neighbors.filter(t=>state.regions[t].owner===foe);
    const threat=threats.reduce((max,t)=>Math.max(max,state.regions[t].troops+state.regions[t].level),0);
    const defensive=variant%4===0;
    const reserve=defensive?Math.min(n,threat+(threat?1:0)):threat>0?Math.min(n,Math.floor(n*(r.level>0?.4:.2))):0;
    n-=reserve;
    const neutrals=neighbors.filter(t=>state.regions[t].owner===null).sort((a,b)=>jitter(a,variant,state.turn)-jitter(b,variant,state.turn));
    for(const t of neutrals) if(n>0 && !(incoming[t]>0)) {add(id,t,1);n--;}
    if(n<=0) continue;
    const targets=neighbors.map(t=>{
      const dest=state.regions[t];
      let value=0;
      if(dest.owner===foe) value=(n+(incoming[t]??0)>dest.troops?13:2)+dest.level*2-(Math.max(0,dest.troops-n))*.7;
      else if(dest.owner===null) value=7+neighbors.length*.2;
      else {
        const d=distance(state,t,unowned), current=distance(state,id,unowned);
        value=d<current?8:d===current?1:-5;
        if(adjacent(state,t).some(k=>state.regions[k].owner===foe)) value+=3;
      }
      return {id:t,value:value+jitter(t,variant,state.turn)*5+(variant%3===1&&t==='C'?2:0)};
    }).sort((a,b)=>b.value-a.value);
    if(targets[0]?.value>0) add(id,targets[0].id,n);
  }
  validateOrders(state,p,o);
  return o;
}
export function evaluate(state:State,p:Player):number {
  const foe=(1-p) as Player;
  if(state.finished) return state.winner===null?0:state.winner===p?10000:-10000;
  const remaining=boardOf(state).limit-state.turn;
  const value=(who:Player)=>{
    const ids=owned(state,who), targets=Object.keys(state.regions).filter(id=>state.regions[id].owner!==who);
    return ids.length*(24+(12-remaining)*2)+army(state,who)*3+development(state,who)*(7+remaining*.7)+state.cash[who]*.7
      -ids.reduce((s,id)=>s+Math.max(0,distance(state,id,targets)-1)*state.regions[id].troops*.55,0);
  };
  return value(p)-value(foe);
}
export function chooseOrders(state:State,p:Player,style:RecordFile['opponent']='balanced'):Orders {
  if(state.finished) return emptyOrders();
  const own=Array.from({length:16},(_,i)=>candidateOrders(state,p,i,style));
  const responses=[0,2,4,7,9,12,15].map(i=>candidateOrders(state,(1-p) as Player,i,'balanced'));
  let best=own[0], bestValue=-Infinity;
  for(const o of own) {
    const scores=responses.map(response=>evaluate(resolve(state,p===0?[o,response]:[response,o]).after,p));
    const mean=scores.reduce((s,n)=>s+n,0)/scores.length;
    const score=Math.min(...scores)*.6+mean*.4-price(state,o)*.015;
    if(score>bestValue) {bestValue=score;best=o;}
  }
  return clone(best);
}
