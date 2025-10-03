// /public/js/firebase.js
// Firebase 앱/인증/DB 초기화 (Config는 index.html의 ANCHOR에서 window.firebaseConfig로 주입)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

if (!window.firebaseConfig) {
  console.warn("⚠️ firebaseConfig가 비어있어. index.html의 'firebase-config' 앵커에 값을 붙여넣어줘.");
}

export const app  = initializeApp(window.firebaseConfig || {});
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const ts   = serverTimestamp;

// 자동 익명 로그인
// ANCHOR: sign-in-anon
onAuthStateChanged(auth, (u) => {
  if (!u) signInAnonymously(auth).catch(console.error);
});
