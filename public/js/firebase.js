// public/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
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

export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    return signInWithRedirect(auth, provider);
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

// 기존 함수들
export async function callGenCard(params) {
  const fn = httpsCallable(fx, "genCard");
  const res = await fn(params);
  return res.data;
}

export async function callGenCharacter(params) {
  const fn = httpsCallable(fx, "genCharacter");
  const res = await fn(params);
  return res.data;
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

export async function callDeleteCard(params) {
    const fn = httpsCallable(fx, "deleteCard");
    const res = await fn(params);
    return res.data;
}

export async function callPlayCard(params) {
    const fn = httpsCallable(fx, "playCard");
    const res = await fn(params);
    return res.data;
}

export async function callReact(params) {
    const fn = httpsCallable(fx, "react");
    const res = await fn(params);
    return res.data;
}

export async function callEndTurn(params) {
    const fn = httpsCallable(fx, "endTurn");
    const res = await fn(params);
    return res.data;
}
