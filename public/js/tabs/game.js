// /public/js/tabs/game.js
import { $, toast } from "../ui.js";

const myState = $("#myState");
const myHand  = $("#myHand");
const logBox  = $("#logBox");
const reactQ  = $("#reactQueue");

// 추후: matches/{matchId} onSnapshot으로 상태 구독
// ANCHOR: match-view
import { httpsCallable, getFunctions } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { state } from "../state.js";
const btnDraw = document.getElementById("btnDraw");
const btnPass = document.getElementById("btnPass");

function canUseMainActions(){
  // 반응 창 여부는 서버 상태로 판단해야 하지만,
  // 클라에서는 임시로 '항상 메인' 가정. (서버 연결 시 교체 예정)
  return true;
}

export function initGameView(){
  myState.textContent = "HP: -, 기력: -, 손패: -";
  myHand.innerHTML = "";
  logBox.textContent = "";
  reactQ.innerHTML = `<span class="hint">(비어있음)</span>`;

  const app = getApp();
  const fns = getFunctions(app);

  btnDraw?.addEventListener("click", async ()=>{
    if (!canUseMainActions()) return toast("지금은 드로우 불가(반응 창).");
    try{
      const call = httpsCallable(fns, "drawCard");
      await call({ roomId: state.roomId });
    }catch(e){ console.error(e); toast("드로우 실패"); }
  });

  btnPass?.addEventListener("click", async ()=>{
    if (!canUseMainActions()) return toast("지금은 패스 불가(반응 창).");
    try{
      const call = httpsCallable(fns, "passTurn");
      await call({ roomId: state.roomId });
    }catch(e){ console.error(e); toast("패스 실패"); }
  });

  toast("인게임 뷰 준비됨. (서버 연결 시 실시간 갱신)", 1200);
}
