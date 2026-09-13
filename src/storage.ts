import { readRecord } from './game.ts';
import type { RecordFile } from './game.ts';
export interface Saved { id:string; record:RecordFile; updated:string }
function db():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('garimteo',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function save(record:RecordFile):Promise<void> {
  const connection=await db();
  try {await new Promise<void>((resolve,reject)=>{
    const tx=connection.transaction('records','readwrite');
    tx.objectStore('records').put({id:'current',record,updated:new Date().toISOString()});
    if(record.state.finished) tx.objectStore('records').put({id:record.created,record,updated:new Date().toISOString()});
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });} finally {connection.close();}
}
export async function list():Promise<Saved[]> {
  const connection=await db();
  try {return await new Promise((resolve,reject)=>{
    const request=connection.transaction('records').objectStore('records').getAll();
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });} finally {connection.close();}
}
export function exportRecord(record:RecordFile):void {
  const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`garimteo-${record.state.map}-${record.turns.length}turns.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function importRecord(file:File):Promise<RecordFile> {
  if(file.size>2_000_000) throw new Error('기록 파일은 2MB 이하여야 합니다.');
  return readRecord(JSON.parse(await file.text()));
}
