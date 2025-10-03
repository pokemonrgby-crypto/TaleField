// /public/js/firebase.js
// Firebase 앱/인증/DB 초기화 (Config는 index.html의 ANCHOR에서 window.firebaseConfig로 주입)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

if (!window.__FBCONFIG__) {
  console.warn("⚠️ window.__FBCONFIG__ 가 비어있어. CI에서 public/firebase-config.js가 생성되는지 확인해줘.");
}

export const app  = initializeApp(window.__FBCONFIG__ || {});

export const auth = getAuth(app);
export const db   = getFirestore(app);
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


// 자동 익명 로그인
// ANCHOR: sign-in-anon
onAuthStateChanged(auth, (u) => {
  if (!u) signInAnonymously(auth).catch(console.error);
});
