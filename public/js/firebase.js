// /public/js/firebase.js
// Firebase 앱/인증/DB 초기화
// 우선 Hosting이 제공하는 /__/firebase/init.json을 사용하고, 없으면 window.__FBCONFIG__로 폴백해.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  serverTimestamp,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";



// Firebase 자동 설정(JSON) 우선, 실패 시 window.__FBCONFIG__ 허용
let cfg = null;
try {
  const res = await fetch("/__/firebase/init.json", { cache: "no-store" });
  if (res.ok) cfg = await res.json();
} catch (_) { /* no-op */ }

if (!cfg || !cfg.projectId || !cfg.apiKey) {
  // 로컬 개발 등 Hosting 자동설정이 없을 때만 fallback
  cfg = window.__FBCONFIG__ || {};
}

if (!cfg.projectId || !cfg.apiKey) {
  console.error("❌ FIREBASE_CONFIG_MISSING: Hosting init.json도 없고 window.__FBCONFIG__도 비어있어.", cfg);
  throw new Error("FIREBASE_CONFIG_MISSING");
}

console.log("firebase projectId:", cfg?.projectId);

export const app  = initializeApp(cfg);


export const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  experimentalLongPollingOptions: { timeoutSeconds: 30 },
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const ts   = serverTimestamp;

// ANCHOR: google-login
import { GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
export async function signInWithGoogle(){
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}
export async function signOutUser(){
  await signOut(auth);
}


// ANCHOR: sign-in-anon
// 자동 익명 로그인 + 완료 대기 Promise
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => {
    if (u) return resolve(u);
    signInAnonymously(auth).catch(console.error);
  });
});

