// /public/js/tabs/game.js
import { $, toast } from "../ui.js";

const myState = $("#myState");
const myHand  = $("#myHand");
const logBox  = $("#logBox");
const reactQ  = $("#reactQueue");

// 추후: matches/{matchId} onSnapshot으로 상태 구독
// ANCHOR: match-view
export function initGameView(){
  myState.textContent = "HP: -, 기력: -, 손패: -";
  myHand.innerHTML = "";
  logBox.textContent = "";
  reactQ.innerHTML = `<span class="hint">(비어있음)</span>`;
  // 여기까지는 자리만. B(Functions) 붙이면서 실제 데이터 반영.
  toast("인게임 뷰 준비됨. (서버 붙이면 실시간 갱신 시작!)", 1200);
}
