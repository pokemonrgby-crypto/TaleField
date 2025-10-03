// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  experimentalLongPollingOptions: { timeoutSeconds: 30 },
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
