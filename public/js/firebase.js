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
const provider = new GoogleAuthProvider();

// 리다이렉트 결과 처리 (페이지 로드 시 자동 실행)
getRedirectResult(auth)
  .then((result) => {
    if (result) {
      console.log("Google 로그인 성공:", result.user.email);
    }
  })
  .catch((error) => {
    console.error("Google 로그인 리다이렉트 오류:", error);
    // 사용자에게 오류 표시
    if (error.code === 'auth/popup-blocked') {
      alert('팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.');
    } else if (error.code === 'auth/popup-closed-by-user') {
      // 사용자가 팝업을 닫은 경우는 무시
    } else {
      alert(`로그인 오류: ${error.message}`);
    }
  });

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    console.log("Google 로그인 성공 (팝업):", result.user.email);
    return result;
  } catch (e) {
    console.log("팝업 로그인 실패, 리다이렉트로 전환:", e.code);
    // 팝업이 차단된 경우에만 리다이렉트 사용
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request') {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
export function signOutUser() { return signOut(auth); }

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
