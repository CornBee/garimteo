import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, army, available, clone, emptyOrders, income, makeRecord, newState, owned, price, readRecord, resolve, validateOrders } from '../src/game.ts';
import { candidateOrders, chooseOrders } from '../src/ai.ts';

const pair=()=>[emptyOrders(),emptyOrders()];
const move=(from,to,count)=>({from,to,count});
const position=()=>{const s=newState();for(const r of Object.values(s.regions)){r.owner=null;r.level=0;r.troops=0;}s.regions.A={owner:0,level:1,troops:0};s.regions.B={owner:1,level:1,troops:0};return s;};
const mirror={AW:'BE',A:'B',AN:'BN',AS:'BS',N:'N',C:'C',S:'S',BN:'AN',BS:'AS',B:'A',BE:'AW'};
const swapState=s=>{const out=clone(s);out.cash=[s.cash[1],s.cash[0]];for(const [id,r] of Object.entries(s.regions))out.regions[mirror[id]]={...r,owner:r.owner===null?null:1-r.owner};out.winner=s.winner===null?null:1-s.winner;return out;};
const swapOrder=o=>({develop:o.develop.map(id=>mirror[id]),recruit:Object.fromEntries(Object.entries(o.recruit).map(([id,n])=>[mirror[id],n])),moves:o.moves.map(m=>({from:mirror[m.from],to:mirror[m.to],count:m.count}))});

test('initial economy and owned regions follow the agreed rules',()=>{
 const s=newState();assert.deepEqual(s.cash,[5,5]);assert.equal(income(s,0),5);assert.equal(army(s,0),6);assert.equal(owned(s,0).length,1);assert.equal(BOARDS.basin.edges.length,14);
});
test('development is paid now, increased income and recruitment start next turn',()=>{
 const s=newState();s.regions.AW={owner:0,level:0,troops:1};const o=pair();o[0].develop=['AW'];
 const t=resolve(s,o);assert.equal(t.after.regions.AW.level,1);assert.equal(t.after.cash[0],7);assert.equal(t.after.turn,2);assert.equal(s.regions.AW.level,0);
 const invalid=clone(o[0]);invalid.recruit.AW=1;assert.throws(()=>validateOrders(s,0,invalid));
});
test('fresh recruits can move but cannot exceed the old recruitment cap',()=>{
 const s=newState(),o=pair();o[0].recruit.A=1;o[0].moves=[move('A','AN',7)];
 const t=resolve(s,o);assert.equal(t.after.regions.A.troops,0);assert.equal(t.after.regions.AN.troops,7);assert.equal(t.after.regions.AN.owner,0);
 const bad=clone(o[0]);bad.recruit.A=2;assert.throws(()=>validateOrders(s,0,bad));
});
test('same-destination arrivals merge before deterministic combat',()=>{
 const s=position();s.regions.AN={owner:0,level:0,troops:3};s.regions.AS={owner:0,level:0,troops:3};s.regions.BN={owner:1,level:0,troops:4};
 const o=pair();o[0].moves=[move('AN','C',3),move('AS','C',3)];o[1].moves=[move('BN','C',4)];
 const t=resolve(s,o);assert.deepEqual(t.after.regions.C,{owner:0,level:0,troops:2});
});
test('equal combat consumes troops and retains the incumbent or neutrality',()=>{
 for(const owner of [null,0,1]) {
   const s=position();s.regions.C.owner=owner;s.regions.AN={owner:0,level:0,troops:4};s.regions.BN={owner:1,level:0,troops:4};
   const o=pair();o[0].moves=[move('AN','C',4)];o[1].moves=[move('BN','C',4)];
   assert.deepEqual(resolve(s,o).after.regions.C,{owner,level:0,troops:0});
 }
});
test('head-on edge combat precedes destination combat',()=>{
 const s=position();s.regions.AN={owner:0,level:0,troops:6};s.regions.C={owner:1,level:0,troops:7};
 const o=pair();o[0].moves=[move('AN','C',6)];o[1].moves=[move('C','AN',4)];
 const t=resolve(s,o);assert.equal(t.after.regions.C.troops,1);assert.equal(t.after.regions.C.owner,1);assert.equal(t.after.regions.AN.troops,0);assert.equal(t.after.regions.AN.owner,0);
 assert.equal(t.events.filter(e=>e.kind==='battle').length,2);
});
test('development transfers on capture and is not refunded',()=>{
 const s=position();s.regions.AN={owner:0,level:0,troops:1};s.regions.C={owner:1,level:0,troops:4};
 const o=pair();o[0].develop=['AN'];o[1].moves=[move('C','AN',4)];const t=resolve(s,o);
 assert.deepEqual(t.after.regions.AN,{owner:1,level:1,troops:3});assert.equal(t.after.cash[0],6);assert.equal(t.after.cash[1],11);
});
test('vacating preserves ownership and different roads allow simultaneous captures',()=>{
 const s=position();s.regions.AN={owner:0,level:0,troops:2};s.regions.C={owner:1,level:0,troops:2};s.regions.AS={owner:0,level:1,troops:0};
 const o=pair();o[0].moves=[move('AN','C',2)];o[1].moves=[move('C','AS',2)];const t=resolve(s,o);
 assert.equal(t.after.regions.AN.owner,0);assert.equal(t.after.regions.C.owner,0);assert.equal(t.after.regions.AS.owner,1);
});
test('last turn ends without granting an extra income or resolving tie-breaks',()=>{
 const s=newState();s.turn=12;const t=resolve(s,pair());assert.equal(t.after.finished,true);assert.equal(t.after.winner,null);assert.deepEqual(t.after.cash,[5,5]);assert.throws(()=>resolve(t.after,pair()));
});
test('invalid negative, duplicate, over-budget and teleport orders are rejected',()=>{
 const s=newState();
 for(const o of [
  {...emptyOrders(),recruit:{A:-1}}, {...emptyOrders(),recruit:{A:0.5}},
  {...emptyOrders(),develop:['A']}, {...emptyOrders(),develop:['AW']},
  {...emptyOrders(),moves:[move('A','B',1)]}, {...emptyOrders(),moves:[move('A','AN',7)]},
  {...emptyOrders(),moves:[move('A','AN',1),move('A','AN',1)]},
  {...emptyOrders(),moves:[move('B','BN',1)]}, {...emptyOrders(),moves:[move('A','AN',NaN)]},
 ]) assert.throws(()=>validateOrders(s,0,o));
});
test('income is independent of roads and requires investment rather than empty land',()=>{
 const s=newState();s.regions.C={owner:0,level:2,troops:0};s.regions.AW={owner:0,level:0,troops:1};assert.equal(income(s,0),7);
});
test('full simulated games preserve symmetry, losses, budgets and legal board states',()=>{
 for(let game=0;game<28;game++) {
  let s=newState();
  for(let turn=0;turn<12&&!s.finished;turn++) {
   const o=[candidateOrders(s,0,(turn+game)%16,'builder'),candidateOrders(s,1,(turn*3+game)%16,'bold')];
   const beforeTroops=army(s,0)+army(s,1), recruits=Object.values(o[0].recruit).concat(Object.values(o[1].recruit)).reduce((a,n)=>a+n,0);
   const t=resolve(s,o),swapped=resolve(swapState(s),[swapOrder(o[1]),swapOrder(o[0])]);
   assert.deepEqual(swapped.after,swapState(t.after));
   const lost=t.events.reduce((a,e)=>a+(e.lost??0),0);
   assert.equal(army(t.after,0)+army(t.after,1),beforeTroops+recruits-lost);
   for(const r of Object.values(t.after.regions)){assert.ok(r.troops>=0&&Number.isSafeInteger(r.troops));assert.ok(r.level>=0&&r.level<=2);if(r.owner===null)assert.equal(r.troops,0);}
   for(const p of [0,1])assert.equal(t.after.cash[p],s.cash[p]-price(s,o[p])+(t.after.finished?0:income(t.after,p)));
   s=t.after;
  }
  assert.equal(s.finished,true);
 }
});
test('AI makes legal complete-game decisions using only public state',()=>{
 let s=newState('lesson');
 while(!s.finished){const o=[chooseOrders(s,0,'balanced'),chooseOrders(s,1,'bold')];validateOrders(s,0,o[0]);validateOrders(s,1,o[1]);s=resolve(s,o).after;}
 assert.equal(s.finished,true);
});
test('export and import rebuild the game from commands; tampering fails',()=>{
 const f=makeRecord('basin','solo',0,'balanced');
 for(let i=0;i<5;i++){const t=resolve(f.state,[candidateOrders(f.state,0,i),candidateOrders(f.state,1,i+1)]);f.turns.push(t);f.state=t.after;}
 assert.deepEqual(readRecord(JSON.parse(JSON.stringify(f))),f);
 const wrong=clone(f);wrong.state.cash[0]+=1;assert.throws(()=>readRecord(wrong));
 const badStart=clone(f);badStart.initial.regions.A.troops=900;assert.throws(()=>readRecord(badStart));
 const badOrder=clone(f);badOrder.turns[0].orders[0].moves=[move('A','B',6)];assert.throws(()=>readRecord(badOrder));
 const text=clone(f);text.turns[0].events=[{text:'<script>not trusted</script>'}];assert.deepEqual(readRecord(text),f);
});
