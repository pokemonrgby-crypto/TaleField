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

// 1) index.html에서 먼저 넣어준 window.__FBCONFIG__ 읽기
const cfg = window.__FBCONFIG__;
if (!cfg || !cfg.projectId) {
  throw new Error("Firebase 설정이 비어 있어. index.html에서 js/firebase-config.js가 먼저 로드되는지 확인해줘.");
}
console.log("firebase projectId:", cfg.projectId);

// 2) 앱/DB
const app = initializeApp(cfg);
setLogLevel('debug');

export const auth = getAuth(app);
auth.languageCode = "ko";
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// 첫 사용자 상태 약속
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => resolve(u), () => resolve(null));
});

// Firestore
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  experimentalLongPollingOptions: { timeoutSeconds: 30 },
  localCache: memoryLocalCache()
});
export const ts = serverTimestamp;

// 로그인/로그아웃
export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    return signInWithRedirect(auth, provider);
  }
}
export function signOutUser() { return signOut(auth); }

// ---------- 닉네임 API ----------
const nicknameKey = (raw) => raw.trim().toLowerCase();
const profileRef = (uid) => doc(db, "profiles", uid);
const nickRef    = (nick)=> doc(db, "profiles_nicknames", nicknameKey(nick));

export async function fetchProfile(uid) {
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? snap.data() : null;
}
export async function claimNickname(uid, nickname) {
  const nk = nicknameKey(nickname);
  await runTransaction(db, async (tx) => {
    const nDoc = await tx.get(nickRef(nk));
    if (nDoc.exists()) throw new Error("이미 사용 중인 닉네임이야.");
    tx.set(nickRef(nk), { uid, createdAt: ts() });
    tx.set(profileRef(uid), {
      nickname: nickname.trim(),
      updatedAt: ts(),
      createdAt: ts()
    }, { merge: true });
  });
}
export async function needNickname() {
  const u = await authReady;
  if (!u) return { need: false, uid: null, nickname: null };
  const p = await fetchProfile(u.uid);
  const nick = p?.nickname;
  return { need: !nick, uid: u.uid, nickname: nick || null };
}

// ---------- Functions ----------
export const fx = getFunctions(app, "us-central1");

// 1. 함수 이름을 callGenCard (단수)로 변경
export async function callGenCard(params){
  // 2. 호출할 백엔드 함수 이름도 genCard (단수)로 변경
  const fn = httpsCallable(fx, "genCard"); 
  const res = await fn(params);
  return res.data; // {ok, card}
}
