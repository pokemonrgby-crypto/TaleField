// public/js/app.js
import {
  auth, authReady, signInWithGoogle, signOutUser,
  needNickname, claimNickname, db
} from "./firebase.js";
// callGenCards 대신 새로운 함수를 사용하게 되므로 firebase.js 수정 필요
import { callGenCard } from "./firebase.js"; 
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
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
  const loggedIn = !!user;
  $("#btn-google").style.display = loggedIn ? "none" : "";
  $("#btn-logout").style.display = loggedIn ? "" : "none";
  if (loggedIn) {
    checkNickname();
    loadMyCards();
  }
});

// --- UI: 닉네임 모달 (이전과 동일) ---
// ...

// ====== 생성(Gen) 탭 로직 ======
const genPromptEl = $("#gen-prompt");
const genPowerEl = $("#gen-power");
const genTempEl = $("#gen-temp");
const genBtn = $("#btn-gen-cards");
const genGridEl = $("#gen-results");
const genStatusEl = $("#gen-status");

function setGenStatus(text, isError = false) { 
  genStatusEl.textContent = text;
  genStatusEl.style.color = isError ? 'var(--danger)' : 'var(--ink-dim)';
}

// 카드 타일 렌더링 함수
function renderGenResultCardTile(card) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.attr = card.attribute;
    el.innerHTML = `
      <div class="card__title">
        <span>${card.name}</span>
        <div>${card.cost}</div>
      </div>
      <div class="card__body">
        <div class="muted" style="font-size:0.85rem;">${card.attribute} / ${card.rarity}</div>
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
      setGenStatus("프롬프트를 5자 이상 입력해주세요.", true);
      return;
    }

    const params = {
      prompt: promptText,
      powerCap: Number(genPowerEl.value || 10),
      temperature: Number(genTempEl.value || 0.8)
    };
    
    // 변경: 여러 장이 아닌 한 장의 카드 정보를 받음
    const result = await callGenCard(params); 

    if (result.ok && result.card) {
      // 생성된 카드를 결과 그리드의 맨 앞에 추가
      const cardElement = renderGenResultCardTile(result.card);
      genGridEl.prepend(cardElement);
      setGenStatus(`'${result.card.name}' 카드를 생성했습니다! '내 카드' 탭에서도 확인 가능합니다.`);
      loadMyCards(); // 내 카드 목록 갱신
    } else {
        throw new Error("AI가 유효한 카드를 반환하지 않았습니다.");
    }

  } catch (e) {
    console.error(e);
    setGenStatus(e.message || "카드 생성 중 오류가 발생했습니다.", true);
  } finally {
    genBtn.disabled = false;
  }
});


// --- 앱 초기화 ---
function initApp() {
    initMyCardsTab();
}
initApp();
