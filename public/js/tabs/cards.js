// /public/js/tabs/cards.js
import { db } from "../firebase.js";
import { collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { state, addSelected, removeSelected } from "../state.js";
import { $, $$, toast } from "../ui.js";

const myCardsList = $("#myCards");
const selectedCountEl = $("#selectedCount");

function renderCardItem(card){
  const li = document.createElement("li");
  li.className = "cardbox";
  const checked = state.selected.has(card.id) ? "checked" : "";
  li.innerHTML = `
    <label style="display:flex; gap:8px; align-items:center;">
      <input type="checkbox" data-id="${card.id}" ${checked}>
      <div>
        <h4>${card.name}</h4>
        <div class="hint">${card.type}/${card.rarity} · 코스트 ${card.cost}</div>
        <div class="hint">${card.text || ""}</div>
      </div>
    </label>`;
  return li;
}

function bindCardChecks(){
  $$('#myCards input[type="checkbox"]').forEach(ch=>{
    ch.addEventListener("change", ()=>{
      const cid = ch.getAttribute("data-id");
      if (ch.checked) addSelected(cid); else removeSelected(cid);
      selectedCountEl.textContent = String(state.selected.size);
    });
  });
}

export async function loadMyCards(){
  if (!state.user) return toast("로그인 대기 중…");
  const q = query(collection(db, "userCards"), where("ownerUid","==", state.user.uid), where("status","==","approved"));
  const snap = await getDocs(q);
  const cards = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  myCardsList.innerHTML = "";
  for (const c of cards) myCardsList.appendChild(renderCardItem(c));
  bindCardChecks();
  selectedCountEl.textContent = String(state.selected.size);
}

// 제출
// ANCHOR: submit-cards
export async function submitSelectedCards(){
  if (!state.user) return toast("로그인 대기 중…");
  if (!state.roomId) return toast("먼저 방에 참여하거나 만들어줘.");
  const arr = Array.from(state.selected);
  if (arr.length < 5 || arr.length > 15) return toast("카드는 5~15장만 제출 가능해.");
  await updateDoc(doc(db, "rooms", state.roomId, "players", state.user.uid), {
    selectedCardIds: arr, ready: true
  });
  toast("제출 완료! (호스트가 시작하면 공용 덱으로 섞여.)");
}
