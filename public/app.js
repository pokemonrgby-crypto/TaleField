// TaleField — Hosting A (MVP client)
// 이 파일은 "앵커"를 기준으로 순차 패치를 받을 거야.
// 새로고침만으로 Firestore 실시간 방/카드 선택 흐름을 확인할 수 있어.

// 탭 전환
const tabs = document.querySelectorAll("nav.tabs button");
const views = {
  home: document.getElementById("tab-home"),
  cards: document.getElementById("tab-cards"),
  game: document.getElementById("tab-game"),
};
tabs.forEach(btn=>btn.addEventListener("click", ()=>{
  tabs.forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  Object.values(views).forEach(v=>v.classList.remove("active"));
  views[btn.dataset.tab].classList.add("active");
}));

// Firebase 모듈 불러오기
// ANCHOR: initFirebase
import {
  getFirestore, collection, addDoc, onSnapshot, orderBy, query, serverTimestamp,
  doc, setDoc, getDocs, where, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

const app = getApp();
const db = getFirestore(app);
const auth = getAuth(app);

let me = null;
onAuthStateChanged(auth, (u)=>{ me = u; });

// UI 엘리먼트
const roomTitleEl = document.getElementById("roomTitle");
const roomMaxEl   = document.getElementById("roomMax");
const btnCreate   = document.getElementById("btnCreateRoom");
const roomList    = document.getElementById("roomList");
const currentRoomIdEl = document.getElementById("currentRoomId");

const btnRefreshCards = document.getElementById("btnRefreshCards");
const myCardsList = document.getElementById("myCards");
const selectedCountEl = document.getElementById("selectedCount");
const btnSubmitCards = document.getElementById("btnSubmitCards");

let currentRoomId = null;
let selectedCardIds = new Set();

// 방 생성/참여
// ANCHOR: join-create-actions
btnCreate.addEventListener("click", async ()=>{
  if (!me) return alert("로그인 대기 중...");
  const title = String(roomTitleEl.value || "").trim() || "무제 방";
  const max = Math.max(2, Math.min(8, Number(roomMaxEl.value || 8)));
  const rules = { minPlayers: 3, handStart: 3, handMax: 5, kiStart: 0, kiRegen: 2, kiMax: 10, reactionLimitPerTurn: 2 };
  const docRef = await addDoc(collection(db, "rooms"), {
    title, maxPlayers: max, hostUid: me.uid, status: "waiting", rules, createdAt: serverTimestamp(), poolSeed: Math.floor(Math.random()*1e9)
  });
  currentRoomId = docRef.id;
  currentRoomIdEl.textContent = currentRoomId;
  alert("방 생성 완료!");
});

function renderRooms(list){
  roomList.innerHTML = "";
  for (const r of list){
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${r.title}</strong><br><small>${r.id} • 상태:${r.status}</small></div>`;
    const joinBtn = document.createElement("button");
    joinBtn.textContent = "참여";
    joinBtn.addEventListener("click", async ()=>{
      if (!me) return alert("로그인 대기 중...");
      currentRoomId = r.id;
      currentRoomIdEl.textContent = currentRoomId;
      // rooms/{roomId}/players/{uid}
      await setDoc(doc(db, "rooms", r.id, "players", me.uid), {
        uid: me.uid, nickname: `게스트-${me.uid.slice(0,5)}`, characterId: "god_hakuren", selectedCardIds: [], ready: false
      }, { merge: true });
      alert("참여 완료! 카드 선택 탭으로 가서 5~10장 선택해줘.");
      document.querySelector('button[data-tab="cards"]').click();
    });
    li.appendChild(joinBtn);
    roomList.appendChild(li);
  }
}

// 방 목록 실시간
// ANCHOR: rooms-listeners
const qRooms = query(collection(db, "rooms"), orderBy("createdAt", "desc"));
onSnapshot(qRooms, (snap)=>{
  const arr = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  renderRooms(arr);
});

// 카드 목록 로드(내 카드: userCards where ownerUid==me.uid && status=='approved')
async function loadMyCards(){
  if (!me) return;
  const q = query(collection(db, "userCards"), where("ownerUid","==", me.uid), where("status","==", "approved"));
  const snap = await getDocs(q);
  const cards = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  myCardsList.innerHTML = "";
  for (const c of cards){
    const li = document.createElement("li");
    li.className = "cardbox";
    const checked = selectedCardIds.has(c.id) ? "checked" : "";
    li.innerHTML = `
      <label style="display:flex; gap:8px; align-items:center;">
        <input type="checkbox" data-id="${c.id}" ${checked}>
        <div>
          <div><strong>${c.name}</strong> <small>(${c.type}/${c.rarity}, 코스트 ${c.cost})</small></div>
          <div class="hint">${c.text || ""}</div>
        </div>
      </label>`;
    myCardsList.appendChild(li);
  }
  // 체크 핸들러
  myCardsList.querySelectorAll('input[type="checkbox"]').forEach(ch=>{
    ch.addEventListener("change", ()=>{
      const cid = ch.getAttribute("data-id");
      if (ch.checked) selectedCardIds.add(cid); else selectedCardIds.delete(cid);
      selectedCountEl.textContent = String(selectedCardIds.size);
    });
  });
  selectedCountEl.textContent = String(selectedCardIds.size);
}

btnRefreshCards.addEventListener("click", loadMyCards);

// 선택 카드 제출
// ANCHOR: submit-cards
btnSubmitCards.addEventListener("click", async ()=>{
  if (!me) return alert("로그인 대기 중...");
  if (!currentRoomId) return alert("먼저 방에 참여하거나 만들어줘.");
  const arr = Array.from(selectedCardIds);
  if (arr.length < 5 || arr.length > 10) return alert("카드는 5~10장만 제출 가능해.");
  await updateDoc(doc(db, "rooms", currentRoomId, "players", me.uid), {
    selectedCardIds: arr, ready: true
  });
  alert("제출 완료! (호스트가 시작하면 공용 덱으로 섞여.)");
});

// 인게임 뷰: 일단 자리만
// ANCHOR: match-view
// 추후 /functions/startMatch 이후 matches/{matchId} onSnapshot으로 상태 구독 예정.