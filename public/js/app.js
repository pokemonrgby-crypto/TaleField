// /public/js/app.js
import { auth } from "./firebase.js";
import { setActiveTab, $, toast } from "./ui.js";
import { state, setUser, setRoom } from "./state.js";
import { createRoom, watchRooms } from "./tabs/home.js";
import { loadMyCards, submitSelectedCards } from "./tabs/cards.js";
import { initGameView } from "./tabs/game.js";

// 탭 전환
document.querySelectorAll(".tabs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    setActiveTab(btn.dataset.tab);
    if (btn.dataset.tab === "cards") {
      loadMyCards().catch(console.error);
    }
    if (btn.dataset.tab === "game") {
      initGameView();
    }
  });
});

// 사용자 상태 반영
auth.onAuthStateChanged(u=>{
  setUser(u || null);
});

// 홈 탭: 방 생성/실시간
$("#btnCreateRoom").addEventListener("click", ()=> createRoom().catch(console.error));
const stopRooms = watchRooms();

// 카드 탭 동작
$("#btnRefreshCards").addEventListener("click", ()=> loadMyCards().catch(console.error));
$("#btnSubmitCards").addEventListener("click", ()=> submitSelectedCards().catch(console.error));

// 현재 방 표시 업데이트
state.roomId && ($("#currentRoomId").textContent = state.roomId);

// 언로드 시 정리
window.addEventListener("beforeunload", ()=> { try{ stopRooms && stopRooms(); }catch{} });
