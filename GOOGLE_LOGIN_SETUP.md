# Google 로그인 설정 가이드

## 최신 변경사항 (2024년 10월)

이 프로젝트의 Google 로그인 기능이 최신 브라우저 환경에 맞춰 개선되었습니다.

### 주요 개선사항

1. **더 나은 팝업 처리**: 팝업이 차단되면 자동으로 리다이렉트 방식으로 전환
2. **향상된 오류 처리**: 사용자 친화적인 오류 메시지
3. **OAuth 스코프 최적화**: 프로필과 이메일 정보 접근
4. **사용자 경험 개선**: 계정 선택 화면 표시 (`prompt: 'select_account'`)

### Firebase Console 설정 필수 단계

Google 로그인이 작동하려면 Firebase Console에서 다음 설정이 필요합니다:

#### 1. 인증 도메인 추가
[Firebase Console](https://console.firebase.google.com/) → 프로젝트 선택 → Authentication → Settings → Authorized domains

다음 도메인들을 추가해야 합니다:
- `localhost` (로컬 개발용)
- `peaceful-doodad-471301-s2.web.app` (Firebase 호스팅 기본 도메인)
- `peaceful-doodad-471301-s2.firebaseapp.com` (Firebase 앱 도메인)
- 커스텀 도메인이 있다면 추가

#### 2. Google 로그인 활성화
Firebase Console → Authentication → Sign-in method → Google
- 상태를 "사용 설정됨"으로 변경
- 프로젝트 지원 이메일 설정

#### 3. (선택사항) 커스텀 도메인 사용 시
커스텀 도메인을 사용하는 경우, `firebase-config.js`의 `authDomain`을 커스텀 도메인으로 변경:

```javascript
window.__FBCONFIG__ = {
  apiKey: "...",
  authDomain: "your-custom-domain.com",  // 여기를 변경
  // ... 나머지 설정
};
```

### 브라우저별 주의사항

#### Chrome
- 서드파티 쿠키 차단 설정이 기본값입니다
- 팝업 차단 시 자동으로 리다이렉트로 전환됩니다

#### Safari
- 추적 방지 기능이 강력합니다
- 팝업보다 리다이렉트 방식이 더 안정적입니다

#### Firefox
- 엄격한 추적 방지 모드에서 문제가 발생할 수 있습니다
- Container 기능 사용 시 별도 설정이 필요할 수 있습니다

### 문제 해결

#### "팝업이 차단되었습니다" 오류
- 브라우저에서 팝업 허용 설정
- 또는 페이지 새로고침 후 다시 시도 (자동으로 리다이렉트 방식 사용)

#### "인증되지 않은 도메인" 오류
- Firebase Console에서 현재 도메인을 Authorized domains에 추가

#### "네트워크 연결 오류"
- 인터넷 연결 확인
- CSP (Content Security Policy) 설정 확인

### 코드 변경사항

주요 파일:
- `public/js/firebase.js`: Google 로그인 로직 개선
- `public/app.js`: UI 피드백 추가
- `public/js/tabs/home.js`: 기존 로그인 버튼 처리

### 참고 자료

- [Firebase 리다이렉트 Best Practices](https://firebase.google.com/docs/auth/web/redirect-best-practices)
- [Google Cloud Identity Platform](https://cloud.google.com/identity-platform/docs/web/redirect-best-practices)
- [Firebase Auth 문서](https://firebase.google.com/docs/auth/web/google-signin)

### 개발자 노트

2024년 현재, 대부분의 브라우저가 서드파티 쿠키를 차단하므로:
1. 팝업 방식을 먼저 시도
2. 실패 시 자동으로 리다이렉트로 전환
3. 사용자에게 명확한 피드백 제공

이 방식이 가장 안정적이고 사용자 친화적입니다.
