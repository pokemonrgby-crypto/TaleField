// public/js/app.js
import {
  auth,
  needNickname, claimNickname,
  signInWithGoogle, signOutUser
} from "./firebase.js";
import { callGenCard, callCreateRoom, callJoinRoom } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initMyCardsTab, loadMyCards } from "./tabs/my-cards.js";
import { initCharacterGenTab } from "./tabs/character-gen.js";
import { initMyCharactersTab, loadMyCharacters } from "./tabs/my-characters.js";
import { initLobbyTab } from "./tabs/lobby.js";
import { initRoomTab, leaveRoom, setRoomId } from "./tabs/room.js";
import { state, setRoom } from "./state.js";

// --- DOM Elements ---
const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

let currentUser = null;
let isLeaving = false; // Flag to prevent double leave

// --- UI: 탭 전환 ---
function setActiveSection(sectionId) {
  $$("main section").forEach(s => s.classList.toggle("active", s.id === sectionId));
  window.scrollTo(0, 0);
}

function setActiveTab(tabId) {
  $$(".bottom-nav__tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  setActiveSection(tabId);
}

$$(".bottom-nav__tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.dataset.tab;
    if (state.roomId && tabId !== 'view-room') {
       if (confirm('방을 나가시겠습니까?')) {
        window.location.hash = '#lobby';
      }
    } else {
       history.pushState(null, '', `#${tabId.replace('view-', '')}`);
       handleRouteChange();
    }
  });
});

// 생성 허브 내의 네비게이션
$('#btn-goto-gen-char').addEventListener('click', () => setActiveSection('view-gen-char'));
$('#btn-goto-gen-card').addEventListener('click', () => setActiveSection('view-gen'));
$$('.btn-back').forEach(btn => {
  btn.addEventListener('click', () => setActiveSection(btn.dataset.target));
});


// --- 라우팅 ---
async function handleRouteChange() {
  const hash = window.location.hash;
  if (hash.startsWith('#room/')) {
    const roomId = hash.substring(6);
    setRoomId(roomId);
    setActiveSection('view-room');
    $$(".bottom-nav__tabs button").forEach(b => b.classList.remove('active'));
  } else {
    if (state.roomId && !isLeaving) {
        isLeaving = true;
        await leaveRoom();
        isLeaving = false;
    }
    setRoomId(null);
    const targetTab = hash.substring(1) || 'lobby';
    setActiveTab(`view-${targetTab}`);
  }
}

window.addEventListener('hashchange', handleRouteChange);
window.addEventListener('load', handleRouteChange);


// --- UI: 인증 ---
$("#btn-google").addEventListener("click", signInWithGoogle);
$("#btn-logout").addEventListener("click", signOutUser);

onAuthStateChanged(auth, user => {
  currentUser = user;
  const loggedIn = !!user;
  $("#btn-google").style.display = loggedIn ? "none" : "block";
  $("#btn-logout").style.display = loggedIn ? "block" : "none";
  
  if (loggedIn) {
    checkNickname();
    handleRouteChange();
  } else {
    if (state.roomId) {
        window.location.hash = '#lobby';
    }
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

// ====== 카드 생성(Gen) 탭 로직 ======
const genPromptEl = $("#gen-prompt");
const genTempEl = $("#gen-temp");
const genBtn = $("#btn-gen-cards");
const genGridEl = $("#gen-results");
const genStatusEl = $("#gen-status");

function setGenStatus(text, isError = false) {
  genStatusEl.textContent = text;
  genStatusEl.style.color = isError ? 'var(--danger)' : 'var(--ink-dim)';
}

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
  if (genBtn.disabled) return; 

  setGenStatus("AI가 카드를 생성하는 중...");
  genBtn.disabled = true;

  try {
    if (!currentUser) throw new Error("로그인이 필요합니다.");

    const promptText = genPromptEl.value.trim();
    if (promptText.length < 5) {
      throw new Error("프롬프트를 5자 이상 입력해주세요.");
    }

    const params = {
      prompt: promptText,
      powerCap: 20,
      temperature: Number(genTempEl.value || 0.8)
    };

    const result = await callGenCard(params);

    if (result.ok && result.card) {
      const cardElement = renderGenResultCardTile(result.card);
      genGridEl.prepend(cardElement);
      setGenStatus(`'${result.card.name}' 카드를 생성했습니다! '내 카드' 탭에서도 확인 가능합니다.`);
      loadMyCards();
    } else {
        throw new Error(result.error || "AI가 유효한 카드를 반환하지 않았습니다.");
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
    initCharacterGenTab();
    initMyCharactersTab();
    initLobbyTab();
    initRoomTab();
}
initApp();
