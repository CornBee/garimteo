export type Player = 0 | 1;
export type MapId = 'basin' | 'lesson';
export interface Place { id: string; name: string; x: number; y: number; note: string }
export interface Board { id: MapId; name: string; places: Place[]; edges: [string, string][]; homes: [string, string]; limit: number }
export interface Region { owner: Player | null; level: number; troops: number }
export interface State { version: 1; map: MapId; turn: number; cash: [number, number]; regions: Record<string, Region>; finished: boolean; winner: Player | null }
export interface Move { from: string; to: string; count: number }
export interface Orders { develop: string[]; recruit: Record<string, number>; moves: Move[] }
export interface GameEvent { kind: 'develop' | 'recruit' | 'battle' | 'capture'; text: string; location: string; lost?: number }
export interface Turn { number: number; before: State; orders: [Orders, Orders]; events: GameEvent[]; after: State }
export interface RecordFile { format: 'garimteo'; version: 1; mode: 'solo' | 'hotseat'; side: Player; opponent: 'balanced' | 'bold' | 'builder'; initial: State; turns: Turn[]; state: State; created: string }
export const NAMES = ['미라', '로안'] as const;
export const FACTIONS = ['서쪽 연맹', '동쪽 연맹'] as const;
export const BOARDS: Record<MapId, Board> = {
  basin: {
    id: 'basin', name: '갈림분지', limit: 12, homes: ['A', 'B'],
    places: [
      {id:'AW',name:'서쪽 안골',x:85,y:300,note:'입구가 하나인 후방. 도시를 안전하게 키울 수 있지만 전선은 멉니다.'},
      {id:'A',name:'서원',x:230,y:300,note:'미라의 시작 도시. 북쪽과 남쪽 들머리로 나아갈 수 있습니다.'},
      {id:'AN',name:'서북 들머리',x:365,y:155,note:'고개와 중앙을 잇는 전방. 여기에 도시를 지으면 병력을 가까이서 모집합니다.'},
      {id:'AS',name:'서남 들머리',x:365,y:445,note:'여울과 중앙으로 이어지는 길. 전방 개발에는 탈취의 위험이 따릅니다.'},
      {id:'N',name:'북쪽 고개',x:510,y:85,note:'중앙을 통하지 않고 상대의 북쪽으로 접근하는 길입니다.'},
      {id:'C',name:'갈림터',x:510,y:300,note:'네 방향으로 열린 교차지. 많은 곳에 대응할 수 있지만 사방에 노출됩니다.'},
      {id:'S',name:'남쪽 여울',x:510,y:515,note:'중앙을 잃어도 이 길을 통해 상대의 남쪽으로 접근할 수 있습니다.'},
      {id:'BN',name:'동북 들머리',x:655,y:155,note:'고개와 중앙을 연결합니다. 점유권만으로 적의 이동을 막지는 못합니다.'},
      {id:'BS',name:'동남 들머리',x:655,y:445,note:'여울과 중앙을 연결합니다. 집중한 병력의 반대편을 살펴보세요.'},
      {id:'B',name:'동원',x:790,y:300,note:'로안의 시작 도시. 도시가 함락되어도 다른 땅이 있으면 계속 싸울 수 있습니다.'},
      {id:'BE',name:'동쪽 안골',x:935,y:300,note:'입구가 하나인 후방. 생산한 병력이 전선에 도달하려면 시간이 필요합니다.'},
    ],
    edges: [['AW','A'],['A','AN'],['A','AS'],['AN','N'],['N','BN'],['BN','B'],['B','BE'],['B','BS'],['BS','S'],['S','AS'],['AN','C'],['AS','C'],['BN','C'],['BS','C']],
  },
  lesson: {
    id:'lesson',name:'첫 원정',limit:6,homes:['A','B'],
    places:[
      {id:'A',name:'서원',x:190,y:300,note:'도시에서는 매 턴 병력을 모집할 수 있습니다.'},
      {id:'N',name:'고개',x:510,y:135,note:'병력을 나눠 이쪽 길로 우회할 수 있습니다.'},
      {id:'C',name:'갈림터',x:510,y:300,note:'직접 연결된 중앙 지역입니다.'},
      {id:'S',name:'여울',x:510,y:465,note:'다른 쪽에 병력을 집중하면 이 길이 열릴 수 있습니다.'},
      {id:'B',name:'동원',x:830,y:300,note:'상대 도시와 병력은 공개되어 있고 이번 턴의 명령만 숨겨져 있습니다.'},
    ], edges:[['A','N'],['N','B'],['A','C'],['C','B'],['A','S'],['S','B']],
  },
};
export const clone = <T>(value: T): T => structuredClone(value);
export const emptyOrders = (): Orders => ({develop:[],recruit:{},moves:[]});
export const boardOf = (state: State) => BOARDS[state.map];
export const adjacent = (state: State, id: string) => boardOf(state).edges.flatMap(([a,b]) => a===id ? [b] : b===id ? [a] : []);
export const income = (state: State, player: Player) => 4 + Object.values(state.regions).filter(r=>r.owner===player).reduce((a,r)=>a+r.level,0);
export const owned = (state: State, player: Player) => Object.keys(state.regions).filter(id=>state.regions[id].owner===player);
export const army = (state: State, player: Player) => owned(state,player).reduce((a,id)=>a+state.regions[id].troops,0);
export const development = (state: State, player: Player) => owned(state,player).reduce((a,id)=>a+state.regions[id].level,0);
export function newState(map: MapId = 'basin'): State {
  const state: State={version:1,map,turn:1,cash:[5,5],regions:{},finished:false,winner:null};
  for(const p of BOARDS[map].places) state.regions[p.id]={owner:null,level:0,troops:0};
  BOARDS[map].homes.forEach((id,p)=>state.regions[id]={owner:p as Player,level:1,troops:6});
  return state;
}
export function price(state: State, orders: Orders): number {
  return orders.develop.reduce((sum,id)=>sum+(state.regions[id]?.level===0?4:6),0)+Object.values(orders.recruit).reduce((sum,n)=>sum+2*n,0);
}
export const available = (state: State, orders: Orders, id: string) => state.regions[id].troops+(orders.recruit[id]??0)-orders.moves.filter(m=>m.from===id).reduce((sum,m)=>sum+m.count,0);
export function validateOrders(state: State, player: Player, raw: unknown): asserts raw is Orders {
  if(state.finished) throw new Error('이미 끝난 원정입니다.');
  if(!raw || typeof raw!=='object') throw new Error('명령 형식이 올바르지 않습니다.');
  const o=raw as Orders;
  if(!Array.isArray(o.develop)||!Array.isArray(o.moves)||!o.recruit||typeof o.recruit!=='object'||Array.isArray(o.recruit)) throw new Error('명령 형식이 올바르지 않습니다.');
  if(o.develop.length>11||o.moves.length>100||Object.keys(o.recruit).length>11) throw new Error('명령 수가 너무 많습니다.');
  if(new Set(o.develop).size!==o.develop.length) throw new Error('한 지역은 한 턴에 한 번만 개발합니다.');
  for(const id of o.develop) {
    const r=state.regions[id];
    if(!r||r.owner!==player||r.level>=2) throw new Error('개발할 수 없는 지역입니다.');
  }
  for(const [id,count] of Object.entries(o.recruit)) {
    const r=state.regions[id];
    if(!r||r.owner!==player||!Number.isSafeInteger(count)||count<0||count>r.level) throw new Error('도시의 모집 한도를 확인해주세요.');
  }
  const keys=new Set<string>();
  for(const m of o.moves) {
    if(!m||typeof m!=='object'||!state.regions[m.from]||state.regions[m.from].owner!==player||!adjacent(state,m.from).includes(m.to)||!Number.isSafeInteger(m.count)||m.count<1) throw new Error('이동할 수 없는 명령입니다.');
    const key=m.from+'>'+m.to;
    if(keys.has(key)) throw new Error('같은 길의 이동은 하나로 합쳐주세요.');
    keys.add(key);
  }
  for(const id of owned(state,player)) if(available(state,o,id)<0) throw new Error('보유 병력보다 많이 이동할 수 없습니다.');
  if(price(state,o)>state.cash[player]) throw new Error('자원이 부족합니다.');
}
export function resolve(state: State, orders: [Orders,Orders]): Turn {
  validateOrders(state,0,orders[0]); validateOrders(state,1,orders[1]);
  const before=clone(state), next=clone(state), events:GameEvent[]=[];
  const stationed:Record<string,[number,number]>={};
  const flows:Record<string,[number,number]>={};
  const names=Object.fromEntries(boardOf(state).places.map(p=>[p.id,p.name]));
  for(const id of Object.keys(state.regions)) {
    const r=state.regions[id]; stationed[id]=[0,0];
    if(r.owner!==null) stationed[id][r.owner]=r.troops;
  }
  for(const p of [0,1] as Player[]) {
    const o=orders[p]; next.cash[p]-=price(state,o);
    for(const id of o.develop) { next.regions[id].level++; events.push({kind:'develop',location:id,text:`${NAMES[p]} · ${names[id]} ${next.regions[id].level===1?'도시 건설':'도시 성장'}`}); }
    for(const [id,n] of Object.entries(o.recruit)) { stationed[id][p]+=n; if(n) events.push({kind:'recruit',location:id,text:`${NAMES[p]} · ${names[id]} 병력 ${n} 모집`}); }
    for(const m of o.moves) { stationed[m.from][p]-=m.count; (flows[m.from+'>'+m.to]??=[0,0])[p]+=m.count; }
  }
  for(const [a,b] of boardOf(state).edges) {
    const ab=flows[a+'>'+b]??[0,0], ba=flows[b+'>'+a]??[0,0];
    for(const p of [0,1] as Player[]) {
      const q=(1-p) as Player, loss=Math.min(ab[p],ba[q]);
      if(loss) { ab[p]-=loss; ba[q]-=loss; events.push({kind:'battle',location:a,lost:loss*2,text:`${names[a]} ↔ ${names[b]} 길 위 충돌 · 양측 ${loss} 소모`}); }
    }
    stationed[b][0]+=ab[0]; stationed[b][1]+=ab[1]; stationed[a][0]+=ba[0]; stationed[a][1]+=ba[1];
  }
  for(const id of Object.keys(state.regions)) {
    const [a,b]=stationed[id], loss=Math.min(a,b), r=next.regions[id];
    if(loss) events.push({kind:'battle',location:id,lost:loss*2,text:`${names[id]} ${a} 대 ${b} · ${a===b?'양군 소모, 점유 유지':`${NAMES[a>b?0:1]} 병력 ${Math.abs(a-b)} 생존`}`});
    if(a!==b) {
      const owner=(a>b?0:1) as Player;
      if(r.owner!==owner) events.push({kind:'capture',location:id,text:`${NAMES[owner]} · ${names[id]} ${r.owner===null?'확보':'점령'}`});
      r.owner=owner;
    }
    r.troops=Math.abs(a-b);
  }
  const counts=[owned(next,0).length,owned(next,1).length];
  if(!counts[0]||!counts[1]||state.turn>=boardOf(state).limit) {
    next.finished=true; next.winner=counts[0]===counts[1]?null:counts[0]>counts[1]?0:1;
  } else { next.turn++; next.cash[0]+=income(next,0); next.cash[1]+=income(next,1); }
  return {number:state.turn,before,orders:clone(orders),events,after:next};
}
export function makeRecord(map: MapId, mode:RecordFile['mode'],side:Player,opponent:RecordFile['opponent']):RecordFile {
  const initial=newState(map);
  return {format:'garimteo',version:1,mode,side,opponent,initial,turns:[],state:clone(initial),created:new Date().toISOString()};
}
export function readRecord(raw:unknown):RecordFile {
  if(!raw||typeof raw!=='object') throw new Error('원정 기록 파일이 아닙니다.');
  const f=raw as RecordFile;
  if(f.format!=='garimteo'||f.version!==1||!['basin','lesson'].includes(f.initial?.map)||!Array.isArray(f.turns)||f.turns.length>12||!['solo','hotseat'].includes(f.mode)||![0,1].includes(f.side)||!['balanced','bold','builder'].includes(f.opponent)||typeof f.created!=='string'||f.created.length>60) throw new Error('지원하지 않는 기록 형식입니다.');
  const initial=newState(f.initial.map);
  if(JSON.stringify(f.initial)!==JSON.stringify(initial)) throw new Error('초기 상태가 규칙과 다릅니다.');
  let state=initial;
  const turns:Turn[]=[];
  for(const entry of f.turns) {
    if(!Array.isArray(entry.orders)||entry.orders.length!==2) throw new Error('턴 명령을 읽을 수 없습니다.');
    const turn=resolve(state,entry.orders); turns.push(turn); state=turn.after;
  }
  if(JSON.stringify(state)!==JSON.stringify(f.state)) throw new Error('기록의 명령과 최종 상태가 일치하지 않습니다.');
  return {format:'garimteo',version:1,mode:f.mode,side:f.side,opponent:f.opponent,initial,turns,state,created:f.created};
}
