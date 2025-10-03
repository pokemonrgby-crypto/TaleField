// public/js/app.js
import {
  auth, authReady, signInWithGoogle, signOutUser,
  needNickname, claimNickname, callGenCards, db
} from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
// '내 카드' 탭 초기화 함수 임포트
import { initMyCardsTab, loadMyCards } from "./tabs/my-cards.js";


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
$("#btn-google").addEventListener("click", signInWithGoogle);
$("#btn-logout").addEventListener("click", signOutUser);

onAuthStateChanged(auth, user => {
  currentUser = user;
  $("#btn-google").style.display = user ? "none" : "";
  $("#btn-logout").style.display = user ? "" : "none";
  if (user) {
    checkNickname();
    // 로그인 시 '내 카드' 탭의 내용을 한 번 불러와 줍니다.
    loadMyCards(); 
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
const genGridEl = $("#gen-results");
const genStatusEl = $("#gen-status");

function setGenStatus(text) { genStatusEl.textContent = text; }

// 카드 타일 렌더링 함수 (생성 결과용)
function renderGenResultCardTile(card) {
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
        <div class="card__meta">Score: ${card.checks?.validatorScore ?? 0}</div>
      </div>
    `;
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
    
    genGridEl.innerHTML = "";
    result.cards.forEach(card => genGridEl.appendChild(renderGenResultCardTile(card)));
    
    setGenStatus(`생성 완료: ${result.cards.length}장의 카드가 '내 카드' 탭에 추가되었습니다.`);
    // 생성 완료 후, '내 카드' 탭 데이터도 갱신
    loadMyCards(); 
  } catch (e) {
    console.error(e);
    setGenStatus("오류: " + (e.details?.raw || e.message || e));
  } finally {
      genBtn.disabled = false;
  }
});

// --- 앱 초기화 ---
function initApp() {
    // '내 카드' 탭 기능 초기화
    initMyCardsTab();
}

initApp();
