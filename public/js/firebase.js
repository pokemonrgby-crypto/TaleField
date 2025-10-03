// firebase.js
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
  doc,
  getDoc,
  setDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";



// 1) index.html에서 먼저 넣어준 window.__FBCONFIG__ 읽기
const cfg = window.__FBCONFIG__;
if (!cfg || !cfg.projectId) {
  throw new Error("Firebase 설정이 비어 있어. index.html에서 js/firebase-config.js가 먼저 로드되는지 확인해줘.");
}
console.log("firebase projectId:", cfg.projectId);

// 2) 앱/DB 만들고, 꼭 'export' 붙여서 내보내기
const app = initializeApp(cfg);
// Firestore 디버그 로그를 자세히 출력
setLogLevel('debug');

export const auth = getAuth(app);
auth.languageCode = "ko";

// 첫 사용자 상태가 파악되면 끝나는 약속 객체
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => resolve(u), () => resolve(null));
});


// Firestore 타임스탬프 함수도 밖에서 쓰게 내보내기
export const ts = serverTimestamp;

// 구글 로그인 / 로그아웃(홈 탭에서 쓰는 함수 이름과 맞춤)
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업이 막히거나 CSP로 실패하는 경우 리다이렉트로 폴백
    return signInWithRedirect(auth, provider);
  }
}
export function signOutUser() {
  return signOut(auth);
}

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  experimentalLongPollingOptions: { timeoutSeconds: 30 },
  // ✅ 영구 캐시 대신 메모리 캐시 사용
  localCache: memoryLocalCache()
});

// ANCHOR: nickname-api
// 닉네임 키(소문자·공백정리) 생성
const nicknameKey = (raw) => raw.trim().toLowerCase();

// 프로필/닉네임 문서 참조
const profileRef = (uid) => doc(db, "profiles", uid);
const nickRef    = (nick)=> doc(db, "profiles_nicknames", nicknameKey(nick));

// 프로필 읽기
export async function fetchProfile(uid) {
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? snap.data() : null;
}

// 닉네임 고유 예약 + 프로필 저장(트랜잭션)
// - 이미 누가 쓰면 에러 던짐("이미 사용 중인 닉네임이야.")
export async function claimNickname(uid, nickname) {
  const nk = nicknameKey(nickname);
  await runTransaction(db, async (tx) => {
    const nDoc = await tx.get(nickRef(nk));
    if (nDoc.exists()) throw new Error("이미 사용 중인 닉네임이야.");

    tx.set(nickRef(nk), { uid, createdAt: ts() }); // 닉네임 점유
    tx.set(profileRef(uid), {
      nickname: nickname.trim(),
      updatedAt: ts(),
      createdAt: ts()
    }, { merge: true });
  });
}

// 로그인 이후 닉네임이 필요한지 간단 체크
// - return { need, uid, nickname }
export async function needNickname() {
  const u = await authReady;
  if (!u) return { need: false, uid: null, nickname: null };
  const p = await fetchProfile(u.uid);
  const nick = p?.nickname;
  return { need: !nick, uid: u.uid, nickname: nick || null };
}

