import './style.css';
import { BOARDS, FACTIONS, NAMES, adjacent, army, available, boardOf, clone, development, emptyOrders, income, makeRecord, owned, price, readRecord, resolve, validateOrders } from './game.ts';
import type { MapId, Orders, Player, RecordFile, State, Turn } from './game.ts';
import { exportRecord, importRecord, list, save } from './storage.ts';

const app=document.querySelector<HTMLDivElement>('#app')!;
let record=makeRecord('basin','solo',0,'balanced');
let draft=emptyOrders(), selected='A', target:string|null=null;
let active:Player=0, sealed:Orders|null=null, curtain=false, busy=false, preview=false;
let replay:number|null=null, autoplay:ReturnType<typeof setInterval>|null=null;
let quiet=false, message='', persistence='저장 준비 중', generation=0;
let worker:Worker|null=null;
let modal:HTMLDialogElement|null=null;
let currentExport:RecordFile|null=null;
let activeRecordId='';
let focusAfterRender:string|null=null;
const base=import.meta.env.BASE_URL;
const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icon=(name:string)=>({coin:'◈',army:'⚑',land:'⬡',city:'▥',arrow:'→'}[name]??'');
const player=()=>record.mode==='hotseat'?active:record.side;
const readOnly=()=>record.state.finished||replay!==null||busy||curtain;
const label=(id:string)=>boardOf(record.state).places.find(p=>p.id===id)?.name??id;
const stageName=(n:number)=>['미개발','도시','성장한 도시'][n];
const lastTurn=()=>record.turns.at(-1);
function status(text:string) {message=text;render();}
function persist() {
  const snapshot=clone(record);
  void save(snapshot).then(()=>{if(record.created===snapshot.created){persistence='이 기기에 저장됨';updateSaveStatus();}}).catch(()=>{persistence='자동 저장 불가 · 기록을 내보내세요';updateSaveStatus();});
}
function updateSaveStatus(){const el=document.querySelector('[data-save-state]');if(el)el.textContent=persistence;}
function stopPlay(){if(autoplay){clearInterval(autoplay);autoplay=null;}}
function restart(map:MapId, mode:RecordFile['mode'], side:Player, opponent:RecordFile['opponent']) {
  generation++;worker?.terminate();worker=null;stopPlay();
  record=makeRecord(map,mode,side,opponent);draft=emptyOrders();active=0;sealed=null;curtain=mode==='hotseat';busy=false;preview=false;replay=null;quiet=false;target=null;
  selected=BOARDS[map].homes[side];message='';activeRecordId='';persist();render();
}
function displayed():State {
  if(replay!==null) return replay===0?record.initial:record.turns[replay-1].after;
  if(preview&&!record.state.finished) return resolve(record.state,player()===0?[draft,emptyOrders()]:[emptyOrders(),draft]).after;
  return record.state;
}
function mapMarkup(state:State):string {
  const board=boardOf(state), byId=Object.fromEntries(board.places.map(p=>[p.id,p]));
  const paths=board.edges.map(([a,b])=>{
    const pa=byId[a],pb=byId[b],ra=state.regions[a],rb=state.regions[b];
    const allied=ra.owner!==null&&ra.owner===rb.owner;
    const reachable=(a===selected||b===selected)&&record.state.regions[selected]?.owner===player()&&!readOnly();
    return `<g class="road ${reachable?'reachable':''}" data-road="${a},${b}"><line class="road-hit" x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}"/><line class="road-under" x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}"/><line class="road-line ${allied?'p'+ra.owner:''}" x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}"/></g>`;
  }).join('');
  const shownOrders=replay!==null&&replay>0?record.turns[replay-1].orders:!curtain?[player()===0?draft:emptyOrders(),player()===1?draft:emptyOrders()]:[];
  const moves=shownOrders.flatMap((o,p)=>o.moves.map(m=>{
    const a=byId[m.from],b=byId[m.to],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
    const x1=a.x+dx/len*40+nx*7,y1=a.y+dy/len*40+ny*7,x2=b.x-dx/len*45+nx*7,y2=b.y-dy/len*45+ny*7;
    return `<g class="march p${p}"><path d="M ${x1},${y1} L ${x2},${y2}" marker-end="url(#arrow${p})"/><rect x="${(x1+x2)/2-13}" y="${(y1+y2)/2-13}" width="26" height="26" rx="8"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2+6}">${m.count}</text></g>`;
  })).join('');
  const nodes=board.places.map(p=>{
    const r=state.regions[p.id],mine=r.owner===player(),isSelected=p.id===selected;
    const planned=draft.develop.includes(p.id)&&replay===null&&!curtain&&!preview;
    const training=record.state.map==='lesson'&&record.state.turn===1&&p.id==='A';
    const changes=replay===null&&!preview&&!curtain&&record.state.regions[p.id].owner===player()?available(record.state,draft,p.id):r.troops;
    return `<g class="place ${r.owner===null?'neutral':'p'+r.owner} ${isSelected?'selected':''} ${target===p.id?'target':''} ${training?'training':''}" data-node="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} · ${r.owner===null?'중립':NAMES[r.owner]} · 병력 ${r.troops} · ${stageName(r.level)}" transform="translate(${p.x} ${p.y})"><title>${esc(p.note)}</title><circle class="place-halo" r="45"/><circle class="place-outline" r="35"/><circle class="place-core" r="29"/><text class="troop-count" y="8">${r.troops}</text><g class="level" transform="translate(-9 -23)">${[0,1].map(i=>`<rect x="${i*11}" width="7" height="5" rx="1" class="${r.level>i?'built':planned&&r.level===i?'planned':''}"/>`).join('')}</g><rect class="name-back" x="-65" y="43" width="130" height="25" rx="5"/><text class="place-name" y="61">${p.name}</text>${mine&&changes!==r.troops?`<g class="remaining"><rect x="18" y="15" width="40" height="24" rx="12"/><text x="38" y="32">→${changes}</text></g>`:''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 1020 600" class="map-svg" aria-label="${board.name} 전략 지도"><defs>${[0,1].map(p=>`<marker id="arrow${p}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${p===0?'#067767':'#b9533d'}"/></marker>`).join('')}</defs><g>${paths}</g>${moves}<g>${nodes}</g></svg>`;
}
function scoreMarkup(state:State,p:Player):string {
  return `<section class="faction p${p} ${player()===p?'yours':''}"><div class="faction-top"><span class="faction-dot"></span><strong>${NAMES[p]}</strong><span>${player()===p?'내 연맹':record.mode==='solo'?'컴퓨터':'상대 연맹'}</span></div><div class="faction-numbers"><span><b>${owned(state,p).length}</b> 지역</span><span><b>${army(state,p)}</b> 병력</span><span><b>${state.cash[p]}</b> 자원</span></div><div class="faction-income">${FACTIONS[p]} · 매 턴 +${income(state,p)} 자원</div></section>`;
}
function journalMarkup():string {
  const items=[...draft.develop.map(id=>({text:`${label(id)} · ${record.state.regions[id].level?'도시 성장':'도시 건설'}`,cost:`−${record.state.regions[id].level?6:4}`,type:'develop',id})),...Object.entries(draft.recruit).filter(([,n])=>n>0).map(([id,n])=>({text:`${label(id)} · 병력 ${n} 모집`,cost:`−${n*2}`,type:'recruit',id})),...draft.moves.map((m,i)=>({text:`${label(m.from)} → ${label(m.to)}`,cost:`병력 ${m.count}`,type:'move',id:String(i)}))];
  return `<div class="journal-heading"><span class="eyebrow">이번 턴</span><h2>명령 수첩 <span>${items.length}</span></h2></div>${items.length?`<ul class="orders">${items.map(i=>`<li><div><span>${esc(i.text)}</span><small>${i.cost}</small></div><button class="remove" data-remove="${i.type}:${i.id}" aria-label="${esc(i.text)} 취소" ${readOnly()?'disabled':''}>×</button></li>`).join('')}</ul>`:`<div class="empty-journal"><span>↗</span><p>어디에 힘을 쓸까요?</p><small>지도에서 내 지역을 선택해<br>도시를 키우거나 병력을 보내세요.</small></div>`}<div class="budget"><span>사용 예정</span><strong>${price(record.state,draft)} <small>/ ${record.state.cash[player()]}</small></strong></div><div class="budget-bar"><i style="width:${Math.min(100,price(record.state,draft)/Math.max(1,record.state.cash[player()])*100)}%"></i></div><div class="budget-note">남는 ${record.state.cash[player()]-price(record.state,draft)} 자원은 다음 턴으로</div><button class="text-button" data-action="clear" ${readOnly()||!items.length?'disabled':''}>이번 명령 모두 취소</button>`;
}
function detailMarkup(state:State):string {
  const r=state.regions[selected],place=boardOf(state).places.find(p=>p.id===selected)!;
  const actual=record.state.regions[selected],mine=actual.owner===player(),editable=mine&&!readOnly()&&!preview;
  const cost=actual.level===0?4:6,planned=draft.develop.includes(selected),recruits=draft.recruit[selected]??0;
  const left=record.state.cash[player()]-price(record.state,draft);
  const outgoing=draft.moves.filter(m=>m.from===selected).reduce((s,m)=>s+m.count,0);
  return `<div class="place-detail"><div class="detail-kicker"><span class="ownership ${r.owner===null?'neutral':'p'+r.owner}">${r.owner===null?'중립 지역':FACTIONS[r.owner]}</span><span>${stageName(r.level)}</span></div><h2>${place.name}</h2><p class="place-description">${place.note}</p><div class="detail-stats"><div><b>${r.troops}</b><span>주둔 병력</span></div><div><b>+${r.level}</b><span>턴 수입</span></div><div><b>${r.level}</b><span>모집 한도</span></div></div>
  ${mine&&replay===null&&!record.state.finished?`<div class="detail-actions"><button class="develop-button ${planned?'staged':''}" data-action="develop" ${!editable||actual.level>=2||(!planned&&left<cost)?'disabled':''}><span>${planned?'✓ 개발 명령 취소':actual.level===0?'도시 건설':actual.level===1?'도시 성장':'개발 완료'}</span><span>${actual.level<2?`${cost} 자원`:''}</span></button><p class="micro">${actual.level>=2?'최고 단계의 도시입니다.':record.state.turn===boardOf(state).limit?'마지막 턴에는 개발 수입을 받지 못합니다.':'개발 효과는 다음 턴부터 적용됩니다.'}</p><div class="recruit-row"><div><strong>병력 모집</strong><small>1명당 2 자원 · 이번 턴 이동 가능</small></div><div class="stepper"><button data-action="recruit-less" aria-label="모집 한 명 줄이기" ${!editable||recruits===0||actual.troops+recruits-1<outgoing?'disabled':''}>−</button><span>${recruits}</span><button data-action="recruit-more" aria-label="모집 한 명 늘리기" ${!editable||recruits>=actual.level||left<2?'disabled':''}>+</button></div></div>${actual.level===0?'<p class="micro">도시를 건설하면 다음 턴부터 모집할 수 있습니다.</p>':''}<div class="movement"><h3>병력 보내기 <span>${available(record.state,draft,selected)}명 대기</span></h3><div class="destinations">${adjacent(state,selected).map(id=>`<button class="${id===target?'chosen':''}" data-destination="${id}" ${!editable?'disabled':''}>${label(id)} <span>↗</span></button>`).join('')}</div>${target?moveEditor():''}</div></div>`:`<div class="observe-note">${readOnly()?'지도와 기록을 살펴볼 수 있습니다.':'이 지역의 병력과 개발 상태는 공개되어 있습니다. 내 지역을 선택해 명령을 내려보세요.'}</div>`}</div>`;
}
function moveEditor():string {
  const existing=draft.moves.find(m=>m.from===selected&&m.to===target)?.count??0;
  const max=available(record.state,draft,selected)+existing;
  const value=existing||Math.min(1,max);
  return `<div class="move-editor"><label for="move-count">${label(selected)} → ${label(target!)}<span>최대 ${max}명</span></label><div class="move-controls"><input id="move-count" type="number" min="0" max="${max}" value="${value}" aria-label="보낼 병력 수"/><button data-action="all-troops" ${!max?'disabled':''}>전부</button><button class="primary" data-action="stage-move" ${!max&&!existing?'disabled':''}>명령 넣기</button></div><p class="micro">0명을 입력하면 이 길의 명령이 취소됩니다.</p></div>`;
}
function timelineMarkup():string {
  const index=replay??record.turns.length;
  return `<div class="timeline"><button data-action="replay-prev" aria-label="이전 턴 보기" ${!record.turns.length||index===0?'disabled':''}>‹</button><button data-action="replay-play" aria-label="리플레이 재생 또는 정지" ${!record.turns.length?'disabled':''}>${autoplay?'Ⅱ':'▷'}</button><div class="timeline-track">${Array.from({length:boardOf(record.state).limit+1},(_,i)=>`<button data-replay="${i}" class="${index===i?'current':''} ${i<=record.turns.length?'recorded':''}" ${i>record.turns.length?'disabled':''} aria-label="${i===0?'시작 상태':i+'턴 결과'}">${i===0?'시작':i}</button>`).join('')}</div><button data-action="replay-next" aria-label="다음 턴 보기" ${index>=record.turns.length?'disabled':''}>›</button>${replay!==null?'<button class="return-live" data-action="live">현재로</button>':''}</div>`;
}
function render() {
  const focused=document.activeElement instanceof HTMLElement?document.activeElement.id:null;
  const state=displayed(),board=boardOf(state);
  if(!state.regions[selected])selected=board.homes[player()];
  const shownTurn=replay!==null&&replay>0?record.turns[replay-1]:lastTurn();
  app.className=`${quiet?'quiet':''} ${curtain?'veiled':''}`;
  app.innerHTML=`<header class="topbar"><a class="brand" href="#" aria-label="갈림터"><span class="brand-mark">岐</span><span>갈림터<small>GARIMTEO</small></span></a><div class="chapter"><span class="chapter-line"></span><span>${board.name}</span><small>${record.state.map==='lesson'?'연습 원정':'열두 계절의 원정'}</small></div><nav aria-label="게임 메뉴"><button data-action="help">규칙</button><button data-action="archive">원정 기록</button><button data-action="new" class="new-game">새 원정 ↗</button></nav></header>
  <div class="campaign-strip">${scoreMarkup(state,0)}<div class="turn-center"><span class="eyebrow">${replay!==null?'원정 기록':preview?'가정 미리보기':record.state.finished?'원정 종료':'명령을 내릴 시간'}</span><strong>${replay!==null?`${replay}<small> / ${record.turns.length}</small>`:`${record.state.turn}<small> / ${board.limit}</small>`}</strong><span>${replay!==null?replay===0?'원정의 시작':`${replay}턴 해결 후`:preview?'상대가 아무 행동도 하지 않을 때':record.state.finished?resultTitle():`${NAMES[player()]}의 ${['봄','여름','가을','겨울'][(record.state.turn-1)%4]}`}</span></div>${scoreMarkup(state,1)}</div>
  <main class="game-layout"><aside class="command-panel">${journalMarkup()}<div class="commander"><div class="seal p${player()}">${player()===0?'M':'R'}</div><div><strong>${NAMES[player()]}</strong><p>${commanderLine()}</p></div></div></aside><section class="map-panel" aria-label="전략 지도"><div class="map-topline"><span><i class="live-dot"></i>${preview?'상대 정지 가정':replay!==null?'기록 재생':'현재 상태 공개 · 명령 비공개'}</span><div><button data-action="preview" class="${preview?'active':''}" ${readOnly()?'disabled':''}>${preview?'현재 지도 보기':'계획 미리보기'}</button><button data-action="quiet" aria-label="관전 화면 전환">${quiet?'조작 화면':'관전 화면'}</button></div></div><div class="map-stage" style="background-image:url('${base}basin.png')">${mapMarkup(state)}<div class="map-caption"><span>갈림분지</span><small>G A R I M T E O</small></div><div class="map-legend"><span><i class="legend-dot p0"></i>미라</span><span><i class="legend-dot p1"></i>로안</span><span><i class="legend-dot neutral"></i>중립</span><span>▰ 도시 단계</span></div></div>${timelineMarkup()}<div class="event-strip"><span>${shownTurn?`${shownTurn.number}턴 기록`:'첫 명령'}</span><p>${shownTurn?esc(shownTurn.events.filter(e=>e.kind==='capture'||e.kind==='battle').map(e=>e.text).slice(0,3).join(' · ')||'도시를 키우고 다음 움직임을 준비했습니다.'):'지역을 선택하고, 키울 도시와 움직일 병력을 정하세요.'}</p>${shownTurn?'<button data-action="turn-log">전체 보기</button>':''}</div></section><aside class="detail-panel">${detailMarkup(state)}</aside></main>
  <footer class="action-bar"><div class="action-hint"><span class="status-message" role="status">${esc(message|| (record.state.map==='lesson'?lessonHint():replay!==null?'지난 명령의 화살표와 결과를 함께 볼 수 있습니다.':'명령은 모두 함께 해결됩니다. 확정 전까지 자유롭게 바꿀 수 있습니다.'))}</span><small data-save-state>${persistence}</small></div><div class="action-buttons"><button data-action="export" class="secondary">기록 내보내기</button>${record.state.finished?'<button class="primary commit" data-action="result">원정 결과 보기 ↗</button>':replay!==null?'<button class="primary commit" data-action="live">원정으로 돌아가기 →</button>':`<button class="primary commit" data-action="commit" ${busy||curtain||preview?'disabled':''}>${busy?'상대가 계획을 세우는 중…':record.mode==='hotseat'?`${NAMES[player()]} 명령 봉인 →`:'명령 확정 →'}</button>`}</div></footer>
  ${curtain?`<div class="handoff" role="dialog" aria-modal="true" aria-label="기기 전달"><span class="eyebrow">비공개 명령</span><div class="handoff-seal">${NAMES[active]}</div><h1>${NAMES[active]}에게 기기를 넘겨주세요.</h1><p>이전 플레이어의 명령은 봉인했습니다.<br>준비되면 혼자 화면을 보고 계획을 세우세요.</p><button class="primary" data-action="unveil">${NAMES[active]}의 차례 시작 →</button></div>`:''}`;
  if(curtain) {
    for(const el of app.querySelectorAll<HTMLElement>('.topbar,.campaign-strip,.game-layout,.action-bar'))el.inert=true;
    app.querySelector<HTMLButtonElement>('[data-action="unveil"]')?.focus();
  } else if(focusAfterRender||focused) {document.getElementById(focusAfterRender||focused!)?.focus();focusAfterRender=null;}
}
function commanderLine():string {
  const t=lastTurn();
  if(t?.events.some(e=>e.kind==='capture'&&e.text.startsWith(NAMES[player()])))return player()===0?'새로 얻은 터에도 지킬 이유가 생겼군요.':'길이 열렸습니다. 다음 움직임을 생각합시다.';
  if(t?.events.some(e=>e.kind==='battle'))return '남은 병력으로 어디까지 지킬 수 있을까요.';
  return player()===0?'오래 남을 도시를, 지킬 수 있는 곳에.':'길이 갈라지는 곳에서 다음 수가 시작됩니다.';
}
function lessonHint():string {
  return record.state.turn===1?'① 서원을 선택해 병력 1을 모집하고, 인접 지역으로 보내세요.':record.state.turn===2?'② 새로 차지한 지역을 도시로 개발해보세요. 다음 턴부터 수입과 모집이 늘어납니다.':record.state.turn===3?'③ 같은 수로 싸우면 양쪽 병력이 소모됩니다. 적이 비울 길도 살펴보세요.':'④ 마지막 턴에 더 많은 지역을 차지하면 승리합니다. 기록으로 선택을 복기해보세요.';
}
function resultTitle(){return record.state.winner===null?'무승부':`${NAMES[record.state.winner]}의 승리`;}
function changeDraft(edit:(o:Orders)=>void) {
  if(readOnly()||preview)return;
  const next=clone(draft);edit(next);
  try {validateOrders(record.state,player(),next);draft=next;message='';render();}catch(e){status((e as Error).message);}
}
async function computerOrders():Promise<Orders> {
  worker??=new Worker(new URL('./ai.worker.ts',import.meta.url),{type:'module'});
  const w=worker,token=generation;
  return await new Promise((done,fail)=>{
    const timeout=setTimeout(()=>{cleanup();fail(new Error('계산이 지연되었습니다. 다시 확정해주세요.'));w.terminate();if(worker===w)worker=null;},15000);
    const listener=(e:MessageEvent)=>{if(e.data.token!==token)return;cleanup();e.data.error?fail(new Error(e.data.error)):done(e.data.orders);};
    const error=()=>{cleanup();w.terminate();if(worker===w)worker=null;fail(new Error('상대 계획을 불러오지 못했습니다. 다시 시도해주세요.'));};
    function cleanup(){clearTimeout(timeout);w.removeEventListener('message',listener);w.removeEventListener('error',error);}
    w.addEventListener('message',listener);w.addEventListener('error',error);
    w.postMessage({token,state:clone(record.state),player:1-record.side,style:record.opponent});
  });
}
async function commit() {
  if(readOnly()||preview)return;
  if(!draft.develop.length&&!Object.values(draft.recruit).some(Boolean)&&!draft.moves.length){showDialog('이번 턴은 기다릴까요?',`<p>자원은 이월되고 병력은 현재 자리에 남습니다.</p><button class="primary" data-modal-action="wait">명령 없이 확정</button>`);return;}
  await performCommit();
}
async function performCommit() {
  if(readOnly()||preview)return;
  if(record.mode==='hotseat'&&active===0) {sealed=clone(draft);draft=emptyOrders();active=1;curtain=true;selected=boardOf(record.state).homes[1];target=null;message='';render();return;}
  const token=generation;
  busy=true;render();
  try {
    const both:[Orders,Orders]=record.mode==='hotseat'?[sealed!,draft]:record.side===0?[draft,await computerOrders()]:[await computerOrders(),draft];
    if(token!==generation)return;
    const turn=resolve(record.state,both);record.turns.push(turn);record.state=turn.after;
    draft=emptyOrders();sealed=null;active=0;target=null;preview=false;message='';busy=false;
    curtain=record.mode==='hotseat'&&!record.state.finished;
    selected=owned(record.state,player())[0]??boardOf(record.state).homes[player()];
    persist();render();if(record.state.finished)showResult();
  } catch(e) {if(token!==generation)return;busy=false;status((e as Error).message);}
}
function showDialog(title:string,body:string) {
  closeDialog();modal=document.createElement('dialog');modal.className='game-dialog';
  modal.innerHTML=`<div class="dialog-heading"><h2>${esc(title)}</h2><button data-modal-action="close" aria-label="닫기">×</button></div><div class="dialog-body">${body}</div>`;
  const dialog=modal;
  document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>{dialog.remove();if(modal===dialog)modal=null;});
}
function closeDialog(){if(modal){const old=modal;modal=null;old.close();old.remove();}}
function showNew() {showDialog('새 원정',`<p>어느 도시를 키우고, 어느 길을 지킬 것인가.</p><form id="new-game-form"><label>원정<select name="map"><option value="basin">갈림분지 · 11개 지역 / 12턴</option><option value="lesson">첫 원정 · 5개 지역 / 6턴 연습</option></select></label><label>대결 방식<select name="mode"><option value="solo">컴퓨터와 대결</option><option value="hotseat">한 기기로 둘이서</option></select></label><label>내 인물<select name="side"><option value="0">미라 · 서쪽 연맹</option><option value="1">로안 · 동쪽 연맹</option></select></label><label>컴퓨터 성향<select name="opponent"><option value="balanced">균형 · 입지와 전력</option><option value="bold">진격 · 전방 압박</option><option value="builder">개발 · 도시 성장</option></select></label><p class="micro">진행 중인 원정의 자동 저장은 새 원정으로 바뀝니다. 보존하려면 먼저 기록을 내보내세요. 인물 간 능력 차이는 없습니다.</p><button class="primary" type="submit">원정 시작 →</button></form>`);}
function showHelp(){showDialog('갈림터의 규칙',`<p class="dialog-intro">유리한 자리를 만들고, 그곳을 키워 다음 수를 준비하세요.</p><ol class="rules-list"><li><strong>현재는 공개, 명령은 비공개.</strong> 양쪽의 명령을 모두 확정하면 함께 해결합니다.</li><li><strong>도시에 투자하세요.</strong> 매 턴 기본 4 + 도시 단계 합만큼 자원을 받습니다. 개발비는 4 / 6, 효과는 다음 턴부터입니다.</li><li><strong>병력을 모집하세요.</strong> 한 명당 2 자원. 각 도시에서 턴 시작 개발 단계만큼 모집하며 바로 이동할 수 있습니다.</li><li><strong>연결된 길로 이동하세요.</strong> 병력은 나눌 수 있고 한 턴에 한 길만 이동합니다. 길에서 마주 오면 먼저 싸웁니다.</li><li><strong>큰 수에서 작은 수를 뺍니다.</strong> 6 대 4라면 2만 생존. 동률은 양군 소모, 점유권은 유지합니다.</li><li><strong>남은 병력이 땅을 차지합니다.</strong> 도시도 함께 넘어오며 다음 턴부터 이용합니다.</li><li><strong>마지막에 땅이 많은 쪽이 승리.</strong> 본게임은 12턴, 연습은 6턴입니다. 지역 수가 같으면 무승부입니다.</li></ol><p>계획 미리보기는 <b>상대가 아무 행동도 하지 않는 가정</b>입니다. 실제 결과는 상대 명령에 따라 달라집니다.</p><p class="micro">병력이 없는 땅도 점유는 유지됩니다. 고립된 도시도 수입과 모집을 유지합니다. 보급·정찰·지형 전투 보너스는 없습니다.</p><button class="primary" data-modal-action="lesson">짧은 연습 원정 시작 →</button>`);}
async function showArchive(){
  showDialog('원정 기록',`<div id="saved-list"><p>이 기기의 기록을 불러오는 중…</p></div><label class="file-label">기록 파일 불러오기<input id="import-file" type="file" accept=".json,application/json"/></label><p class="micro">기록은 이 브라우저에 저장됩니다. 중요한 원정은 파일로 내보내 보관하세요.</p>`);
  try {const saved=await list();const el=document.querySelector('#saved-list');if(!el)return;
    const unique=saved.filter(s=>s.id!=='current'||!s.record.state.finished).sort((a,b)=>b.updated.localeCompare(a.updated));
    el.innerHTML=unique.length?unique.map(s=>`<button class="saved-record" data-saved="${esc(s.id)}"><span><strong>${BOARDS[s.record.state.map].name}</strong><small>${s.record.turns.length}턴 기록 · ${s.record.state.finished?s.record.state.winner===null?'무승부':NAMES[s.record.state.winner]+' 승리':'진행 중'}</small></span><span>열기 ↗</span></button>`).join(''):'<p>아직 저장된 원정이 없습니다.</p>';
  }catch {const el=document.querySelector('#saved-list');if(el)el.innerHTML='<p>이 브라우저에서 저장소를 사용할 수 없습니다. 기록 파일로 이어서 플레이할 수 있습니다.</p>';}
}
function showResult(){
  const captures=record.turns.flatMap(t=>t.events.filter(e=>e.kind==='capture'));
  const battles=record.turns.flatMap(t=>t.events.filter(e=>e.kind==='battle'));
  showDialog(resultTitle(),`<div class="result-score"><span class="p0">${NAMES[0]}<b>${owned(record.state,0).length}</b></span><small>점유 지역</small><span class="p1">${NAMES[1]}<b>${owned(record.state,1).length}</b></span></div><p>${record.turns.length}번의 선택이 이 지도에 남았습니다.</p><div class="result-facts"><span>지역 확보·점령 <b>${captures.length}</b>회</span><span>전투 <b>${battles.length}</b>회</span><span>남은 도시 단계 <b>${development(record.state,0)+development(record.state,1)}</b></span></div><div class="dialog-buttons"><button class="primary" data-modal-action="replay">처음부터 복기하기</button><button data-modal-action="export">기록 내보내기</button><button data-modal-action="rematch">같은 조건으로 재대결</button></div>`);
}
function loadRecord(next:RecordFile,id='') {
  generation++;worker?.terminate();worker=null;stopPlay();record=readRecord(next);draft=emptyOrders();selected=boardOf(record.state).homes[record.side];active=0;sealed=null;busy=false;preview=false;target=null;replay=record.state.finished?record.turns.length:null;quiet=false;curtain=record.mode==='hotseat'&&!record.state.finished;message='기록을 불러왔습니다.';activeRecordId=id;closeDialog();render();
}
function replayAt(index:number){stopPlay();replay=Math.min(record.turns.length,Math.max(0,index));preview=false;target=null;render();}

app.addEventListener('click',event=>{
  const el=(event.target as Element).closest<HTMLElement>('button,[data-node],[data-road],a');if(!el)return;
  if(el instanceof HTMLButtonElement&&el.disabled)return;
  if(el.matches('a.brand')){event.preventDefault();return;}
  if(el.dataset.node){selected=el.dataset.node;target=null;render();return;}
  if(el.dataset.road&&!readOnly()&&!preview){const [a,b]=el.dataset.road.split(',');if(record.state.regions[selected].owner===player()&&(selected===a||selected===b)){target=selected===a?b:a;render();}return;}
  if(el.dataset.destination){target=el.dataset.destination;render();return;}
  if(el.dataset.replay!==undefined){replayAt(Number(el.dataset.replay));return;}
  if(el.dataset.remove){const [kind,id]=el.dataset.remove.split(':');changeDraft(o=>{if(kind==='develop')o.develop=o.develop.filter(n=>n!==id);if(kind==='move')o.moves.splice(Number(id),1);if(kind==='recruit')delete o.recruit[id];});return;}
  switch(el.dataset.action){
    case 'develop':changeDraft(o=>{o.develop.includes(selected)?o.develop=o.develop.filter(id=>id!==selected):o.develop.push(selected);});break;
    case 'recruit-more':changeDraft(o=>{o.recruit[selected]=(o.recruit[selected]??0)+1;});break;
    case 'recruit-less':changeDraft(o=>{o.recruit[selected]=(o.recruit[selected]??0)-1;});break;
    case 'all-troops':{const input=document.querySelector<HTMLInputElement>('#move-count');if(input)input.value=input.max;break;}
    case 'stage-move':{const input=document.querySelector<HTMLInputElement>('#move-count');const count=Number(input?.value);if(!target||!Number.isSafeInteger(count)||count<0){status('병력 수는 0 이상의 정수로 입력해주세요.');break;}changeDraft(o=>{o.moves=o.moves.filter(m=>!(m.from===selected&&m.to===target));if(count)o.moves.push({from:selected,to:target!,count});});break;}
    case 'clear':changeDraft(o=>{o.develop=[];o.recruit={};o.moves=[];});break;
    case 'commit':void commit();break;
    case 'unveil':curtain=false;render();break;
    case 'preview':preview=!preview;render();break;
    case 'quiet':quiet=!quiet;render();break;
    case 'export':exportRecord(record);break;
    case 'new':showNew();break;
    case 'help':showHelp();break;
    case 'archive':void showArchive();break;
    case 'result':showResult();break;
    case 'replay-prev':replayAt((replay??record.turns.length)-1);break;
    case 'replay-next':replayAt((replay??record.turns.length)+1);break;
    case 'live':stopPlay();replay=null;preview=false;render();break;
    case 'replay-play':if(autoplay){stopPlay();render();}else{replay=replay===null||replay>=record.turns.length?0:replay;autoplay=setInterval(()=>{replay=(replay??0)+1;if(replay>=record.turns.length)stopPlay();render();},1800);render();}break;
    case 'turn-log':{const turn=replay!==null&&replay>0?record.turns[replay-1]:lastTurn();if(turn)showDialog(`${turn.number}턴의 기록`,`<ul class="event-list">${turn.events.map(e=>`<li class="${e.kind}">${esc(e.text)}</li>`).join('')||'<li>명령 없이 지나간 턴입니다.</li>'}</ul>`);break;}
  }
});
app.addEventListener('keydown',event=>{const el=(event.target as Element).closest<HTMLElement>('[data-node]');if(el&&(event.key==='Enter'||event.key===' ')){event.preventDefault();selected=el.dataset.node!;target=null;render();}});
document.addEventListener('click',async event=>{
  const el=(event.target as Element).closest<HTMLElement>('[data-modal-action],[data-saved]');if(!el)return;
  if(el.dataset.saved){try {const saved=await list();const item=saved.find(s=>s.id===el.dataset.saved);if(item)loadRecord(item.record,item.id);}catch(e){showDialog('기록 오류',`<p>${esc((e as Error).message)}</p>`);}return;}
  switch(el.dataset.modalAction){
    case 'close':closeDialog();break;
    case 'wait':closeDialog();void performCommit();break;
    case 'lesson':closeDialog();restart('lesson','solo',0,'balanced');break;
    case 'export':exportRecord(currentExport??record);break;
    case 'replay':closeDialog();replayAt(0);break;
    case 'rematch':closeDialog();restart(record.state.map,record.mode,record.side,record.opponent);break;
    case 'resume':{try{const saved=await list();const current=saved.find(s=>s.id==='current');if(current)loadRecord(current.record);}catch{closeDialog();status('저장 기록을 불러오지 못했습니다.');}break;}
    case 'fresh':closeDialog();persist();break;
  }
});
document.addEventListener('submit',event=>{
  const form=event.target as HTMLFormElement;if(form.id!=='new-game-form')return;event.preventDefault();const data=new FormData(form);closeDialog();
  restart(data.get('map') as MapId,data.get('mode') as RecordFile['mode'],Number(data.get('side')) as Player,data.get('opponent') as RecordFile['opponent']);
});
document.addEventListener('change',async event=>{
  const input=event.target as HTMLInputElement;if(input.id!=='import-file'||!input.files?.[0])return;
  try{const next=await importRecord(input.files[0]);loadRecord(next);persist();}catch(e){showDialog('기록을 불러올 수 없습니다',`<p>${esc((e as Error).message)}</p><p>원본 기록은 변경하지 않았습니다.</p>`);}
});

render();
void list().then(saved=>{
  const current=saved.find(s=>s.id==='current');
  if(current&&generation===0&&record.turns.length===0&&!draft.moves.length&&!draft.develop.length&&!Object.values(draft.recruit).some(Boolean)){
    persistence='이전에 저장한 원정이 있습니다';updateSaveStatus();showDialog('이전 원정을 이어갈까요?',`<p>${BOARDS[current.record.state.map].name} · ${current.record.turns.length}턴의 기록이 남아 있습니다.</p><div class="dialog-buttons"><button class="primary" data-modal-action="resume">이어서 열기</button><button data-modal-action="fresh">새 원정으로 시작</button></div>`);
  } else if(!current)persist();
}).catch(()=>{persistence='자동 저장 불가 · 기록 내보내기 사용';updateSaveStatus();});

// Optional WebMCP: same staged command validator as the visible interface.
const modelContext=(document as unknown as {modelContext?:{registerTool:(tool:unknown,options?:unknown)=>unknown}}).modelContext;
if(modelContext?.registerTool){
  const lifetime=new AbortController();
  const register=(tool:unknown)=>{try{void Promise.resolve(modelContext.registerTool(tool,{signal:lifetime.signal})).catch(()=>{});}catch{/* unsupported experimental API */}};
  register({name:'read_garimteo_position',description:'Read the public live board and this player’s unsealed draft. Does not reveal sealed hotseat commands.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({state:clone(record.state),player:player(),draft:curtain?null:clone(draft),curtain})});
  register({name:'stage_garimteo_orders',description:'Replace the current player’s draft without committing the turn.',inputSchema:{type:'object',properties:{develop:{type:'array',items:{type:'string'}},recruit:{type:'object',additionalProperties:{type:'integer',minimum:0}},moves:{type:'array',items:{type:'object',properties:{from:{type:'string'},to:{type:'string'},count:{type:'integer',minimum:1}},required:['from','to','count'],additionalProperties:false}}},required:['develop','recruit','moves'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:unknown)=>{if(readOnly()||preview)throw new Error('현재 명령을 편집할 수 없습니다.');validateOrders(record.state,player(),input);draft=clone(input);render();return {staged:true,cost:price(record.state,draft)};}});
  window.addEventListener('pagehide',()=>lifetime.abort(),{once:true});
}
