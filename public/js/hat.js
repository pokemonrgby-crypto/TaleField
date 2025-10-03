// /public/js/chat.js
import { db } from "./firebase.js";
import { collection, addDoc, onSnapshot, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { state } from "./state.js";
import { $, escapeHTML, emojiLite, timeHHMM, toast } from "./ui.js";

const chatLog = $("#chatLog");
const input   = $("#chatInput");
const btnSend = $("#btnSendChat");

let lastSendTimes = []; // rate limit: 5초에 5회

function rateOK(){
  const now = Date.now();
  lastSendTimes = lastSendTimes.filter(t => now - t < 5000);
  if (lastSendTimes.length >= 5) return false;
  lastSendTimes.push(now);
  return true;
}

function appendLine(msg){
  const t = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();
  const time = timeHHMM(t);
  const safe = emojiLite(escapeHTML(msg.text||""));
  const line = document.createElement("div");
  line.innerHTML = `<span class="hint">[${time}]</span> <strong>${escapeHTML(msg.nick||"익명")}</strong>: ${safe}`;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

export function watchChat(){
  if (!state.roomId) return ()=>{};
  const qChat = query(collection(db, "rooms", state.roomId, "chat"), orderBy("createdAt","asc"));
  return onSnapshot(qChat, snap=>{
    chatLog.innerHTML = "";
    snap.forEach(d => appendLine(d.data()));
  });
}

export async function sendChat(){
  if (!state.roomId) return toast("방이 없어.");
  if (!rateOK())    return toast("잠깐만! 너무 빨라.");
  const text = String(input.value||"").trim();
  if (!text) return;
  await addDoc(collection(db, "rooms", state.roomId, "chat"), {
    uid: state.user?.uid || null,
    nick: `게스트-${(state.user?.uid||"").slice(0,5)}`,
    text, createdAt: serverTimestamp(), type: "user"
  });
  input.value = "";
}

if (btnSend) btnSend.addEventListener("click", ()=> sendChat().catch(console.error));
if (input)   input.addEventListener("keydown", e=>{ if(e.key==="Enter") btnSend.click(); });
