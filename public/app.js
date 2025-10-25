// public/app.js
import {
  auth, signInWithGoogle, signOutUser,
  needNickname, claimNickname, db
} from "./js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


// --- DOM Elements ---
const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// --- App State ---
let currentUser = null;

// --- UI: 탭 전환 ---
$$(".bottom-nav__tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    const activeTab = btn.dataset.tab;
    $$(".bottom-nav__tabs button").forEach(b => b.classList.toggle("active", b === btn));
    $$("main section").forEach(s => s.classList.toggle("active", s.id === activeTab));
    window.scrollTo(0, 0);
  });
});

// --- UI: 인증 버튼 ---
$("#btn-google").addEventListener("click", async () => {
  try {
    $("#btn-google").disabled = true;
    $("#btn-google").textContent = "로그인 중...";
    await signInWithGoogle();
  } catch (error) {
    console.error("로그인 실패:", error);
  } finally {
    $("#btn-google").disabled = false;
    $("#btn-google").textContent = "Google 로그인";
  }
});
$("#btn-logout").addEventListener("click", signOutUser);

onAuthStateChanged(auth, user => {
  currentUser = user;
  $("#btn-google").style.display = user ? "none" : "";
  $("#btn-logout").style.display = user ? "" : "none";
  if (user) {
    checkNickname();
  }
});


// --- UI: 닉네임 모달 ---
const nicknameModal = $("#nickname-modal");
const nicknameInput = $("#nickname-input");
const nicknameSaveBtn = $("#nickname-save");
const nicknameError = $("#nickname-error");

async function checkNickname() {
  const s = await needNickname();
  if (s.need) {
    nicknameModal.style.display = "flex";
  }
}

nicknameSaveBtn.addEventListener("click", async () => {
  nicknameError.textContent = "";
  const nick = nicknameInput.value.trim();
  if (nick.length < 2 || nick.length > 12) {
    nicknameError.textContent = "2~12자 사이로 입력해주세요.";
    return;
  }
  try {
    if (!currentUser) throw new Error("로그인이 필요합니다.");
    await claimNickname(currentUser.uid, nick);
    nicknameModal.style.display = "none";
  } catch (e) {
    nicknameError.textContent = e.message || "저장 중 오류가 발생했습니다.";
  }
});


// ====== 생성(Gen) 탭 로직 ======
const genPromptEl = $("#gen-prompt");
const genCountEl = $("#gen-count");
const genPowerEl = $("#gen-power");
const genTempEl = $("#gen-temp");
const genBtn = $("#btn-gen-cards");
const saveSelectedBtn = $("#btn-accept-selected");
const genGridEl = $("#gen-results");
const genStatusEl = $("#gen-status");

let lastGeneratedCards = [];
let selectedCardIds = new Set();

function setGenStatus(text) { genStatusEl.textContent = text; }

// 카드 타일 렌더링 함수
function renderCardTile(card) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.attr = card.attribute;
    el.dataset.cardId = card.id;

    const costHTML = `<div style="font-size: 1.1rem; font-weight: bold;">${card.cost}</div>`;

    el.innerHTML = `
      <div class="card__title">
        <span>${card.name}</span>
        ${costHTML}
      </div>
      <div class="card__body">
        <div class="muted" style="font-size:0.85rem;">${card.attribute} / ${card.rarity} / ${card.type}</div>
        <p>${card.text || "(효과 없음)"}</p>
        <div class="card__meta">
          Keywords: ${card.keywords.join(', ') || 'None'} <br>
          Score: ${card.checks?.validatorScore ?? 0}
        </div>
        <div style="margin-top: 12px;">
            <label><input type="checkbox" class="card-select-cb" data-id="${card.id}"> 선택</label>
            <button class="btn btn-report" style="margin-left:8px; font-size:0.8rem; padding: 4px 8px;">신고</button>
        </div>
      </div>
    `;

    // 이벤트 리스너 바인딩
    el.querySelector('.card-select-cb').addEventListener('change', (e) => {
        if (e.target.checked) selectedCardIds.add(card.id);
        else selectedCardIds.delete(card.id);
    });

    el.querySelector('.btn-report').addEventListener('click', () => openReportModal(card));

    return el;
}


genBtn.addEventListener("click", async () => {
  try {
    setGenStatus("AI가 카드를 생성하는 중...");
    genBtn.disabled = true;
    if (!currentUser) throw new Error("로그인이 필요합니다.");
    const promptText = genPromptEl.value.trim();
    if (promptText.length < 5) {
      setGenStatus("프롬프트를 5자 이상 입력해주세요.");
      return;
    }

    const params = {
      prompt: promptText,
      count: Number(genCountEl.value || 6),
      powerCap: Number(genPowerEl.value || 10),
      temperature: Number(genTempEl.value || 0.8)
    };
    const result = await callGenCards(params);

    console.log("--- AI Raw Response ---");
    console.log(result.rawJson);

    lastGeneratedCards = result.cards || [];
    selectedCardIds.clear();
    
    genGridEl.innerHTML = "";
    lastGeneratedCards.forEach(card => genGridEl.appendChild(renderCardTile(card)));
    
    setGenStatus(`생성 완료: ${lastGeneratedCards.length}장의 유효한 카드를 만들었습니다.`);
  } catch (e) {
    console.error(e);
    setGenStatus("오류: " + (e.details?.raw || e.message || e));
  } finally {
      genBtn.disabled = false;
  }
});

saveSelectedBtn.addEventListener("click", async () => {
    const toSave = lastGeneratedCards.filter(c => selectedCardIds.has(c.id));
    if (toSave.length === 0) {
        alert("저장할 카드를 먼저 선택해주세요.");
        return;
    }
    // userCards 컬렉션에 이미 저장되어 있으므로, 이 버튼은 '내 덱에 추가' 같은 다른 기능으로 변경될 수 있습니다.
    // 지금은 단순히 상태를 'approved'로 바꾸는 예시를 보여줍니다.
    try {
        const batch = []; // 실제로는 Firestore batch write를 사용해야 합니다.
        for (const card of toSave) {
            const ref = doc(db, "userCards", card.id);
            // setDoc(ref, { status: "approved" }, { merge: true }); // 예시
        }
        alert(`${toSave.length}장의 카드를 저장했습니다. (현재는 기능 대기중)`);
    } catch(e) {
        console.error("카드 저장 오류:", e);
        alert("카드 저장에 실패했습니다.");
    }
});

function openReportModal(card) {
    const reason = prompt(`[${card.name}] 카드 신고 사유를 입력해주세요. (예: 너무 강력함, 텍스트와 효과 불일치, 부적절한 내용 등)`);
    if (!reason || !currentUser) return;

    const reportRef = doc(db, `reports/cards/${card.id}/${currentUser.uid}_${Date.now()}`);
    setDoc(reportRef, {
        reporterUid: currentUser.uid,
        cardId: card.id,
        cardName: card.name,
        reason: reason,
        reportedAt: serverTimestamp()
    }).then(() => {
        alert("신고가 접수되었습니다. 감사합니다.");
    }).catch(e => {
        console.error("신고 접수 오류:", e);
        alert("신고 접수에 실패했습니다.");
    });
}
