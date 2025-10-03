// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged, // 필요하면 씀
  signInAnonymously   // 필요하면 씀
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  serverTimestamp,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// 1) index.html에서 먼저 넣어준 window.__FBCONFIG__ 읽기
const cfg = window.__FBCONFIG__;
if (!cfg || !cfg.projectId) {
  throw new Error("Firebase 설정이 비어 있어. index.html에서 js/firebase-config.js가 먼저 로드되는지 확인해줘.");
}
console.log("firebase projectId:", cfg.projectId);

// 2) 앱/DB 만들고, 꼭 'export' 붙여서 내보내기
const app = initializeApp(cfg);
export const auth = getAuth(app);
// 첫 사용자 상태가 파악되면 끝나는 약속 객체
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => resolve(u), () => resolve(null));
});


// Firestore 타임스탬프 함수도 밖에서 쓰게 내보내기
export const ts = serverTimestamp;

// 구글 로그인 / 로그아웃(홈 탭에서 쓰는 함수 이름과 맞춤)
const provider = new GoogleAuthProvider();
export async function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}
export function signOutUser() {
  return signOut(auth);
}

export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  experimentalLongPollingOptions: { timeoutSeconds: 30 },
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
