// public/js/app.js
import {
  auth, signInWithGoogle, signOutUser,
  needNickname, claimNickname, db
} from "./js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
// state import 추가 (로그아웃 시 리다이렉션 로직에 필요)
import { state } from "./js/state.js";
// 필요한 탭 초기화 함수들을 import 해야 합니다. (예시)
import { initMyCardsTab, loadMyArtifacts } from "./js/tabs/my-cards.js";
import { initCharacterGenTab } from "./js/tabs/character-gen.js";
import { initMyCharactersTab } from "./js/tabs/my-characters.js";
import { initLobbyTab } from "./js/tabs/lobby.js";
import { initRoomTab, leaveRoom, setRoomId } from "./js/tabs/room.js";
import { initMatchTab, setMatchId } from "./js/tabs/match.js";
// callGenArtifact import 추가
import { callGenArtifact } from "./js/firebase.js";


// --- DOM Elements ---
const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// 로그인/앱 뷰 및 버튼 요소 추가
const loginView = $("#login-view"); // 로그인 안내 카드
const appView = $("#app");         // 메인 콘텐츠 영역
const btnGoogle = $("#btn-google"); // 구글 로그인 버튼 (로그인 카드 안에 있음)
const btnLogout = $("#btn-logout"); // 로그아웃 버튼 (로그인 카드 안에 있음)
const bottomNav = $(".bottom-nav"); // 하단 네비게이션 바 추가

// --- App State ---
let currentUser = null;
let isLeaving = false; // Flag to prevent double leave (라우팅 로직에서 사용)

// --- UI: 탭 전환 (하단 네비게이션) ---
$$(".bottom-nav__tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabId = btn.dataset.tab;
    // 방에 있거나 매치 중일 때 다른 탭으로 이동 시 확인
    if ((state.roomId || state.matchId) && tabId !== 'view-room' && tabId !== 'view-match') {
       if (confirm('현재 게임에서 나가시겠습니까?')) {
        window.location.hash = '#lobby'; // 로비 해시로 변경하여 handleRouteChange 호출
      }
    } else {
       // 해시 변경으로 라우팅 트리거
       history.pushState(null, '', `#${tabId.replace('view-', '')}`);
       handleRouteChange(); // 해시 변경 후 라우팅 함수 호출
    }
  });
});

// --- UI: 생성 허브 내의 네비게이션 ---
// 이 부분은 생성 관련 탭이 활성화될 때만 보이므로 그대로 둡니다.
const btnGoToGenChar = $('#btn-goto-gen-char');
const btnGoToGenCard = $('#btn-goto-gen-card');
const btnBackButtons = $$('.btn-back');

if (btnGoToGenChar) {
    btnGoToGenChar.addEventListener('click', () => setActiveSection('view-gen-char'));
}
if (btnGoToGenCard) {
    btnGoToGenCard.addEventListener('click', () => setActiveSection('view-gen'));
}
btnBackButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetSection = btn.dataset.target;
        setActiveSection(targetSection);
        // 생성 허브로 돌아갈 때 해시 업데이트 (선택 사항)
        if (targetSection === 'view-gen-hub') {
            history.pushState(null, '', '#gen-hub');
        }
    });
});


// --- 라우팅 ---
async function handleRouteChange() {
  const hash = window.location.hash;

  // 모든 탭 버튼 비활성화 (CSS 클래스)
  $$(".bottom-nav__tabs button").forEach(b => b.classList.remove('active'));

  if (!currentUser) {
    // 로그아웃 상태면 로그인 뷰만 표시
    setActiveSection('login-view'); // login-view를 섹션처럼 처리 (ID 일치 필요)
    if (bottomNav) bottomNav.style.display = 'none'; // 하단바 숨김
    return;
  }

  // 로그인 상태일 때만 라우팅 처리
  if (bottomNav) bottomNav.style.display = 'flex'; // 하단바 보이기

  if (hash.startsWith('#room/')) {
    const roomId = hash.substring(6);
    // Room 탭 활성화 로직
    if (typeof setRoomId === 'function') setRoomId(roomId);
    if (typeof setMatchId === 'function') setMatchId(null); // 매치 ID 초기화
    setActiveSection('view-room');
    // 하단 탭 상태 업데이트 불필요 (룸/매치는 탭에 없음)
  } else if (hash.startsWith('#match/')) {
    const matchId = hash.substring(7);
    // Match 탭 활성화 로직
    if (typeof setRoomId === 'function') setRoomId(null); // 룸 ID 초기화
    if (typeof setMatchId === 'function') setMatchId(matchId);
    setActiveSection('view-match');
    // 하단 탭 상태 업데이트 불필요
  } else {
    // 일반 탭 이동 (방/매치에서 나가는 로직 포함)
    if ((state.roomId || state.matchId) && !isLeaving) {
        isLeaving = true;
        // leaveRoom 함수는 room.js에 정의되어 있어야 함
        if (typeof leaveRoom === 'function') await leaveRoom();
        isLeaving = false;
    }
    if (typeof setRoomId === 'function') setRoomId(null);
    if (typeof setMatchId === 'function') setMatchId(null);

    const targetTab = hash.substring(1) || 'lobby'; // 기본 탭은 로비
    setActiveTab(`view-${targetTab}`); // setActiveTab 함수 호출
  }
}

// setActiveSection 함수 정의
function setActiveSection(sectionId) {
  // login-view도 섹션처럼 처리
  if (loginView && loginView.id === sectionId) {
      loginView.style.display = 'flex'; // 로그인 뷰 보이기
      if (appView) appView.style.display = 'none'; // 메인 앱 숨기기
  } else {
      if (loginView) loginView.style.display = 'none'; // 로그인 뷰 숨기기
      if (appView) appView.style.display = 'block'; // 메인 앱 보이기
      // 메인 앱 내부 섹션 활성화
      $$("main#app section").forEach(s => s.classList.toggle("active", s.id === sectionId));
  }
  window.scrollTo(0, 0);
}

// setActiveTab 함수 정의 (하단 네비게이션 버튼 활성화 및 섹션 표시)
function setActiveTab(tabId) {
  $$(".bottom-nav__tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  setActiveSection(tabId); // 해당 ID의 섹션을 활성화
}

// --- 이벤트 리스너 ---
window.addEventListener('hashchange', handleRouteChange);
window.addEventListener('load', () => {
    // Firebase Auth 초기 상태 확인 후 라우팅 시작
    // onAuthStateChanged에서 초기 라우팅을 처리하도록 변경
});


// --- UI: 인증 버튼 및 상태 변경 처리 ---
// btnGoogle은 로그인 카드 안에 있는 버튼을 사용
if (btnGoogle) {
    btnGoogle.addEventListener("click", async () => {
      try {
        btnGoogle.disabled = true;
        btnGoogle.textContent = "로그인 중...";
        await signInWithGoogle();
        // 로그인은 onAuthStateChanged에서 감지하여 처리
      } catch (error) {
        console.error("로그인 실패:", error);
        alert("로그인에 실패했습니다: " + error.message); // 사용자에게 오류 알림
        // 실패 시 버튼 복원
        btnGoogle.disabled = false;
        btnGoogle.textContent = "Google 계정으로 로그인";
      }
      // finally 블록 제거 (성공 시 onAuthStateChanged에서 UI 변경)
    });
}
// btnLogout은 로그인 카드 안에 있는 버튼을 사용
if (btnLogout) {
    btnLogout.addEventListener("click", signOutUser);
}

// *** 중요: 로그인 상태에 따른 UI 변경 로직 ***
onAuthStateChanged(auth, user => {
  currentUser = user;
  const loggedIn = !!user;

  if (loggedIn) {
    // --- 로그인 상태 ---
    loginView.style.display = "none";    // 로그인 안내 카드 숨기기
    appView.style.display = "block";     // 메인 콘텐츠 보이기
    if (bottomNav) bottomNav.style.display = 'flex'; // 하단 네비게이션 보이기
    // 로그아웃 버튼은 로그인 카드 안에 있으므로 여기서는 제어 X

    checkNickname();
    handleRouteChange(); // 로그인 후 현재 해시에 맞는 뷰 로드

  } else {
    // --- 로그아웃 상태 ---
    loginView.style.display = "flex";    // 로그인 안내 카드 보이기
    appView.style.display = "none";      // 메인 콘텐츠 숨기기
    if (bottomNav) bottomNav.style.display = 'none'; // 하단 네비게이션 숨기기
    // 로그인 버튼은 로그인 카드 안에 있으므로 여기서는 제어 X

    // 버튼 텍스트/상태 초기화 (혹시 로그인 실패 후 상태일 수 있으므로)
    if (btnGoogle) {
        btnGoogle.disabled = false;
        btnGoogle.textContent = "Google 계정으로 로그인";
    }

    // 로그아웃 시 로비 해시로 이동 (기존 로직 유지)
    if (window.location.hash !== '' && window.location.hash !== '#') {
        window.location.hash = ''; // 해시 초기화 (로그인 화면으로)
    }
    // handleRouteChange(); // 로그아웃 시 호출하면 로그인 화면 표시
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

// 성물 타일 렌더링 함수 (app.js 내에서만 사용)
function renderGenResultArtifactTile(artifact) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.attr = artifact.attribute;

    const typeIcon = {
        weapon: "⚔️",
        armor: "🛡️",
        item: "📦",
        miracle: "✨"
    };

    const statsHTML = artifact.stats ? Object.entries(artifact.stats)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ') : '';

    el.innerHTML = `
      <div class="card__title">
        <span>${typeIcon[artifact.cardType] || ''} ${artifact.name}</span>
        <span class="muted">${artifact.cardType}</span>
      </div>
      <div class="card__body">
        <div class="muted" style="font-size:0.85rem;">속성: ${artifact.attribute}</div>
        ${statsHTML ? `<div style="font-size:0.9rem; margin: 4px 0;">${statsHTML}</div>` : ''}
        <p>${artifact.text || "(효과 없음)"}</p>
        <div class="card__meta">Score: ${artifact.checks?.validatorScore ?? 0}</div>
      </div>
    `;
    return el;
}

if (genBtn) {
    genBtn.addEventListener("click", async () => {
      if (genBtn.disabled) return;

      setGenStatus("AI가 성물을 생성하는 중...");
      genBtn.disabled = true;

      try {
        if (!currentUser) throw new Error("로그인이 필요합니다.");

        const promptText = genPromptEl.value.trim();
        if (promptText.length < 5) {
          throw new Error("프롬프트를 5자 이상 입력해주세요.");
        }

        const params = {
          prompt: promptText,
          powerCap: 20, // 필요시 HTML에서 입력받도록 수정
          temperature: Number(genTempEl.value || 0.8)
        };

        // callGenArtifact 함수는 firebase.js에서 import 필요
        const result = await callGenArtifact(params);

        if (result.ok && result.artifact) {
          const artifactElement = renderGenResultArtifactTile(result.artifact);
          genGridEl.prepend(artifactElement);
          setGenStatus(`'${result.artifact.name}' 성물을 생성했습니다! '내 성물' 탭에서도 확인 가능합니다.`);
          // '내 성물' 탭 새로고침 함수 호출 (필요시)
          if (typeof loadMyArtifacts === 'function') loadMyArtifacts();
        } else {
            throw new Error(result.error || "AI가 유효한 성물을 반환하지 않았습니다.");
        }

      } catch (e) {
        console.error(e);
        setGenStatus(e.message || "성물 생성 중 오류가 발생했습니다.", true);
      } finally {
        genBtn.disabled = false;
      }
    });
}


// --- 앱 초기화 ---
function initApp() {
    // 각 탭 초기화 함수 호출
    if (typeof initMyCardsTab === 'function') initMyCardsTab();
    if (typeof initCharacterGenTab === 'function') initCharacterGenTab();
    if (typeof initMyCharactersTab === 'function') initMyCharactersTab();
    if (typeof initLobbyTab === 'function') initLobbyTab();
    if (typeof initRoomTab === 'function') initRoomTab();
    if (typeof initMatchTab === 'function') initMatchTab();
    // Auth 상태 변경 감지 리스너가 초기 로딩 시 UI를 설정하므로,
    // load 이벤트 리스너에서 handleRouteChange() 호출 제거
}
initApp(); // 앱 초기화 실행
