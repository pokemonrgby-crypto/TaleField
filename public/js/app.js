// app.js
import {
  auth, authReady, signInWithGoogle, signOutUser,
  needNickname, claimNickname, callGenCards, db, ts
} from "./firebase.js";
import {
  renderCardTile, seedRandom, simulateApply // from engine.js
} from "./engine.js";
import {
  doc, setDoc, serverTimestamp as _ts
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ----- 헤더 버튼 -----
const $ = (q)=>document.querySelector(q);
$("#btn-google").addEventListener("click", signInWithGoogle);
$("#btn-logout").addEventListener("click", signOutUser);

// ----- 탭 전환 -----
document.querySelectorAll("header .tabs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.dataset.tab;
    document.querySelectorAll("section").forEach(s=>s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  });
});

// ----- 닉네임 모달 -----
const modal   = $("#nickname-modal");
const inNick  = $("#nickname-input");
const btnSave = $("#nickname-save");
const elErr   = $("#nickname-error");

btnSave.addEventListener("click", async ()=>{
  elErr.textContent = "";
  const nick = inNick.value.trim();
  if(nick.length < 2 || nick.length > 12){ elErr.textContent="2~12자로 해줘."; return; }
  try{
    const u = await authReady;
    if(!u) throw new Error("로그인이 필요해.");
    await claimNickname(u.uid, nick);
    modal.style.display = "none";
  }catch(e){ elErr.textContent = e.message || "저장 실패"; }
});

(async ()=>{
  const s = await needNickname();
  if(s.need){ modal.style.display = "block"; }
})();

// ====== 생성(Gen) 탭 ======
const elPrompt = $("#gen-prompt");
const elCount = $("#gen-count");
const elPower = $("#gen-power");
const elTemp  = $("#gen-temp");
const btnGen  = $("#btn-gen-cards");
const btnSaveSel = $("#btn-accept-selected");
const elGrid  = $("#gen-results");
const elStatus= $("#gen-status");

let lastGenCards = [];
let selectedIds = new Set();

function setStatus(t){ elStatus.textContent = t; }

btnGen.addEventListener("click", async ()=>{
  try{
    setStatus("생성 중…");
    const u = await authReady; if(!u) throw new Error("로그인이 필요해.");
    const promptText = elPrompt.value.trim();
    if (promptText.length < 5) {
      setStatus("프롬프트를 5자 이상 입력해주세요.");
      return;
    }

    const params = {
      prompt: promptText,
      count: Number(elCount.value||6),
      powerCap: Number(elPower.value||10),
      temperature: Number(elTemp.value||0.8)
    };
    const out = await callGenCards(params);

    // ANCHOR: log-raw-response
    console.log("--- AI Raw Response ---");
    console.log(out.rawJson);
    try {
      // JSON 문자열을 객체로 파싱하여 더 보기 좋게 출력
      console.log("--- Parsed AI Response ---");
      console.table(JSON.parse(out.rawJson));
    } catch(e) {
      console.error("Failed to parse raw JSON response:", e);
    }
    console.log("-----------------------");


    lastGenCards = out.cards || [];
    selectedIds.clear();
    renderGenResults();
    setStatus(`생성 완료: ${lastGenCards.length}장 (유효하지 않은 ${params.count - lastGenCards.length}장은 제외)`);
  }catch(e){
    console.error(e);
    setStatus("실패: " + (e.message||e));
  }
});

function renderGenResults(){
  elGrid.innerHTML = "";
  for(const card of lastGenCards){
    const node = renderCardTile(card, {
      selectable:true,
      selected:selectedIds.has(card.id),
      onToggle: (on)=>{ if(on) selectedIds.add(card.id); else selectedIds.delete(card.id); }
    });
    // 신고 버튼
    const btnReport = document.createElement("button");
    btnReport.className="btn";
    btnReport.textContent="신고";
    btnReport.addEventListener("click", ()=> openReport(card));
    node.appendChild(btnReport);

    // 미니 시뮬레이션 버튼(랜덤/지연효과 데모)
    const bSim = document.createElement("button");
    bSim.className="btn";
    bSim.textContent="미니 시뮬";
    bSim.addEventListener("click", ()=>{
      const log = simulateApply(card, {seed: Date.now().toString()});
      alert("시뮬 결과:\n" + log.join("\n"));
    });
    node.appendChild(bSim);

    elGrid.appendChild(node);
  }
}

async function openReport(card){
  const reason = prompt(`카드 신고 사유 입력(강함/불일치/부적절/버그 등)\n[${card.name}]`);
  if(!reason) return;
  const u = await authReady; if(!u) { alert("로그인이 필요해."); return; }
  const rid = "r_" + Date.now().toString(36);
  await setDoc(doc(db, "reports", "cards", card.id, rid), {
    uid: u.uid, reason, cardVersion: card.checks?.version || 1,
    createdAt: _ts()
  });
  alert("신고 접수 완료!");
}

btnSaveSel.addEventListener("click", async ()=>{
  const pick = lastGenCards.filter(c=>selectedIds.has(c.id));
  if(pick.length===0){ alert("선택된 카드가 없어!"); return; }
  // 서버에서 이미 저장했지만, 로컬 프로젝트에서는 다시 merge 가능
  for(const c of pick){
    await setDoc(doc(db, "cards", c.id), { ...c, savedAt: _ts() }, { merge:true });
  }
  alert(`저장 완료 (${pick.length}장)`);
});
