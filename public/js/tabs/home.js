// /public/js/tabs/home.js
import { auth, db, ts } from "../firebase.js";
import { collection, addDoc, onSnapshot, orderBy, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { state, setRoom } from "../state.js";
import { $, renderRooms, toast } from "../ui.js";

// 엘리먼트
const roomTitleEl = $("#roomTitle");
const roomMaxEl   = $("#roomMax");
const roomList    = $("#roomList");
const userBox     = $("#userBox");

// 사용자 표시
auth.onAuthStateChanged(u=>{
  state.user = u;
  userBox.textContent = u ? `UID: ${u.uid.slice(0,8)}… (익명)` : "로그인 필요";
});

// 방 생성
// ANCHOR: create-room
export async function createRoom(){
  if (!state.user) return toast("로그인 대기 중…");
  const title = String(roomTitleEl.value || "").trim() || "무제 방";
  const max   = Math.max(2, Math.min(8, Number(roomMaxEl.value || 8)));
  const rules = { minPlayers:3, handStart:3, handMax:5, kiStart:0, kiRegen:2, kiMax:10, reactionLimitPerTurn:2 };
  const ref = await addDoc(collection(db, "rooms"), {
    title, maxPlayers:max, hostUid:state.user.uid, status:"waiting", rules, createdAt: ts(), poolSeed: Math.floor(Math.random()*1e9)
  });
  setRoom(ref.id);
  $("#currentRoomId").textContent = ref.id;
  toast("방 생성 완료!");
}

// 방 참여
// ANCHOR: join-room
async function joinRoom(room){
  if (!state.user) return toast("로그인 대기 중…");
  setRoom(room.id);
  $("#currentRoomId").textContent = room.id;
  await setDoc(doc(db, "rooms", room.id, "players", state.user.uid), {
    uid: state.user.uid, nickname: `게스트-${state.user.uid.slice(0,5)}`, characterId: "god_hakuren", selectedCardIds: [], ready: false
  }, { merge:true });
  toast("참여 완료! 카드 탭에서 5~10장 선택해줘.");
}

// 방 목록 실시간
// ANCHOR: rooms-listener
export function watchRooms(){
  const qRooms = query(collection(db, "rooms"), orderBy("createdAt","desc"));
  return onSnapshot(qRooms, (snap)=>{
    const arr = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderRooms(roomList, arr, joinRoom);
  });
}
