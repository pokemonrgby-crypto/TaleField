// public/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  memoryLocalCache,
  serverTimestamp,
  doc, getDoc, setDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const cfg = window.__FBCONFIG__;
if (!cfg || !cfg.projectId) {
  throw new Error("Firebase 설정이 비어 있습니다.");
}
const app = initializeApp(cfg);

export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export const ts = serverTimestamp;

// GoogleAuthProvider 설정 개선 (2024 최신 권장사항)
const provider = new GoogleAuthProvider();
// 사용자 선택 화면 강제 표시 (계정 전환 용이)
provider.setCustomParameters({
  prompt: 'select_account'
});
// 추가 OAuth 스코프 (선택사항)
provider.addScope('profile');
provider.addScope('email');

// 리다이렉트 결과 처리 (페이지 로드 시 자동 실행)
// 2024 업데이트: 리다이렉트 후 복귀 시 로그인 완료 처리
getRedirectResult(auth)
  .then((result) => {
    if (result) {
      console.log("✅ Google 로그인 성공 (리다이렉트):", result.user.email);
      // 로그인 성공 시 시각적 피드백
      showLoginSuccess(result.user);
    }
  })
  .catch((error) => {
    console.error("❌ Google 로그인 리다이렉트 오류:", error);
    // 더 상세한 오류 처리
    handleAuthError(error);
  });

// 개선된 Google 로그인 함수 (2024 최신 권장사항)
export async function signInWithGoogle() {
  try {
    console.log("🔐 Google 로그인 시도 (팝업 방식)...");
    const result = await signInWithPopup(auth, provider);
    console.log("✅ Google 로그인 성공 (팝업):", result.user.email);
    showLoginSuccess(result.user);
    return result;
  } catch (e) {
    console.warn("⚠️ 팝업 로그인 실패:", e.code, e.message);
    
    // 팝업 차단 또는 사용자가 닫은 경우 리다이렉트로 전환
    if (e.code === 'auth/popup-blocked' || 
        e.code === 'auth/cancelled-popup-request' ||
        e.code === 'auth/popup-closed-by-user') {
      console.log("🔄 리다이렉트 방식으로 전환합니다...");
      // 리다이렉트 전 로딩 표시
      showLoginLoading();
      return signInWithRedirect(auth, provider);
    }
    
    // 기타 오류 처리
    handleAuthError(e);
    throw e;
  }
}
export function signOutUser() { return signOut(auth); }

// 로그인 성공 시 시각적 피드백
function showLoginSuccess(user) {
  const displayName = user.displayName || user.email;
  // 간단한 알림 표시 (실제로는 UI 개선 가능)
  console.log(`👋 환영합니다, ${displayName}님!`);
}

// 로그인 진행 중 표시
function showLoginLoading() {
  console.log("⏳ 로그인 처리 중...");
  // 필요 시 로딩 스피너 표시
}

// 통합 오류 처리 함수
function handleAuthError(error) {
  let userMessage = '로그인 중 오류가 발생했습니다.';
  
  switch(error.code) {
    case 'auth/popup-blocked':
      userMessage = '팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용하거나 페이지를 새로고침 후 다시 시도해주세요.';
      break;
    case 'auth/popup-closed-by-user':
      // 사용자가 의도적으로 닫은 경우 - 조용히 처리
      console.log("ℹ️ 사용자가 로그인 창을 닫았습니다.");
      return;
    case 'auth/cancelled-popup-request':
      // 중복 팝업 요청 취소 - 조용히 처리
      console.log("ℹ️ 이전 로그인 요청이 취소되었습니다.");
      return;
    case 'auth/unauthorized-domain':
      userMessage = '인증되지 않은 도메인입니다. Firebase Console에서 도메인을 추가해주세요.';
      break;
    case 'auth/network-request-failed':
      userMessage = '네트워크 연결을 확인해주세요.';
      break;
    case 'auth/too-many-requests':
      userMessage = '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.';
      break;
    default:
      userMessage = `로그인 오류: ${error.message}`;
  }
  
  console.error('🚨 인증 오류:', error.code, error.message);
  alert(userMessage);
}

// ---------- 닉네임 API ----------
const profileRef = (uid) => doc(db, "profiles", uid);
const nickRef = (nick) => doc(db, "profiles_nicknames", nick.trim().toLowerCase());

export async function needNickname() {
  await onAuthStateChanged(auth, u => u); // wait for auth state
  const user = auth.currentUser;
  if (!user) return { need: false };
  const p = (await getDoc(profileRef(user.uid))).data();
  return { need: !p?.nickname, uid: user.uid };
}

export async function getMyNickname() {
    const user = auth.currentUser;
    if (!user) return null;
    const p = (await getDoc(profileRef(user.uid))).data();
    return p?.nickname;
}

export async function claimNickname(uid, nickname) {
  const nk = nickRef(nickname);
  await runTransaction(db, async (tx) => {
    if ((await tx.get(nk)).exists()) throw new Error("이미 사용 중인 닉네임입니다.");
    tx.set(nk, { uid });
    tx.set(profileRef(uid), { nickname: nickname.trim(), updatedAt: ts() }, { merge: true });
  });
}

// ---------- Functions ----------
export const fx = getFunctions(app, "asia-northeast3");

// GodField 함수들
export async function callGenShin(params) {
  const fn = httpsCallable(fx, "genShin");
  const res = await fn(params);
  return res.data;
}

export async function callGenArtifact(params) {
  const fn = httpsCallable(fx, "genArtifact");
  const res = await fn(params);
  return res.data;
}

// 하위 호환성 유지
export async function callGenCard(params) {
  return callGenArtifact(params);
}

export async function callGenCharacter(params) {
  return callGenShin(params);
}

// ANCHOR: public/js/firebase.js (new functions)
// 새로 추가된 함수들
export async function callCreateRoom(params) {
    const fn = httpsCallable(fx, "createRoom");
    const res = await fn(params);
    return res.data;
}

export async function callJoinRoom(params) {
    const fn = httpsCallable(fx, "joinRoom");
    const res = await fn(params);
    return res.data;
}

export async function callCreateBotRoom(params) {
    const fn = httpsCallable(fx, "createBotRoom");
    const res = await fn(params);
    return res.data;
}

export async function callExecuteBotTurn(params) {
    const fn = httpsCallable(fx, "executeBotTurn");
    const res = await fn(params);
    return res.data;
}

export async function callLeaveRoom(params) {
    const fn = httpsCallable(fx, "leaveRoom");
    const res = await fn(params);
    return res.data;
}

export async function callStartGame(params) {
    const fn = httpsCallable(fx, "startGame");
    const res = await fn(params);
    return res.data;
}

export async function callSetPlayerReady(params) {
    const fn = httpsCallable(fx, "setPlayerReady");
    const res = await fn(params);
    return res.data;
}

export async function callDeleteArtifact(params) {
    const fn = httpsCallable(fx, "deleteArtifact");
    const res = await fn(params);
    return res.data;
}

export async function callDeleteShin(params) {
    const fn = httpsCallable(fx, "deleteShin");
    const res = await fn(params);
    return res.data;
}

// 하위 호환성
export async function callDeleteCard(params) {
    return callDeleteArtifact(params);
}

export async function callPlayCard(params) {
    const fn = httpsCallable(fx, "apiPlayCard");
    const res = await fn(params);
    return res.data;
}

export async function callReact(params) {
    const fn = httpsCallable(fx, "apiReact");
    const res = await fn(params);
    return res.data;
}

export async function callEndTurn(params) {
    const fn = httpsCallable(fx, "apiEndTurn");
    const res = await fn(params);
    return res.data;
}

export async function callPlayerAction(params) {
    const fn = httpsCallable(fx, "playerAction");
    const res = await fn(params);
    return res.data;
}
