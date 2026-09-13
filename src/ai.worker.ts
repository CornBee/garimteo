import { chooseOrders } from './ai.ts';
self.onmessage=(event)=>{
  try {const {state,player,style,token}=event.data;self.postMessage({token,orders:chooseOrders(state,player,style)});}
  catch(error) {self.postMessage({token:event.data.token,error:error instanceof Error?error.message:'상대 명령 계산 실패'});}
};
