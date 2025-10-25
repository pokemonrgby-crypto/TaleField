# Google 로그인 검증 체크리스트

이 문서는 Google 로그인 구현이 올바르게 작동하는지 확인하기 위한 체크리스트입니다.

## 사전 준비

### Firebase Console 설정 확인

- [ ] **Google 인증 활성화**
  1. [Firebase Console](https://console.firebase.google.com/) 접속
  2. 프로젝트 선택
  3. Authentication → Sign-in method → Google
  4. "사용 설정됨" 상태 확인
  5. 프로젝트 지원 이메일 설정됨 확인

- [ ] **인증 도메인 추가**
  1. Authentication → Settings → Authorized domains
  2. 다음 도메인들이 추가되어 있는지 확인:
     - `localhost`
     - `YOUR_PROJECT_ID.web.app`
     - `YOUR_PROJECT_ID.firebaseapp.com`

## 로컬 테스트 (개발 환경)

### 테스트 서버 실행
```bash
cd /home/runner/work/TaleField/TaleField/public
python3 -m http.server 8000
```

### 테스트 페이지 접속
브라우저에서 `http://localhost:8000/test-login.html` 접속

### 기능 테스트

#### 1. 팝업 로그인 (권장)
- [ ] "Google 로그인" 버튼 클릭
- [ ] Google 계정 선택 팝업 표시
- [ ] 계정 선택 및 권한 승인
- [ ] 로그인 성공 메시지 확인
- [ ] 사용자 정보 표시 확인 (이메일, 이름, 프로필 사진)
- [ ] "로그아웃" 버튼 표시 확인

#### 2. 리다이렉트 로그인 (팝업 차단 시)
- [ ] 브라우저에서 팝업 차단 설정
- [ ] "Google 로그인" 버튼 클릭
- [ ] Google 로그인 페이지로 리다이렉트
- [ ] 로그인 완료 후 앱으로 복귀
- [ ] 로그인 상태 자동 복원 확인

#### 3. 로그아웃
- [ ] "로그아웃" 버튼 클릭
- [ ] 로그아웃 완료 메시지 확인
- [ ] "Google 로그인" 버튼 다시 표시

#### 4. 에러 처리
- [ ] 네트워크 연결 끊고 로그인 시도
  - 예상: "네트워크 연결을 확인해주세요" 메시지
- [ ] 로그인 팝업에서 취소
  - 예상: 조용히 처리 (에러 메시지 없음)

## 메인 앱 테스트

### 메인 페이지 접속
브라우저에서 `http://localhost:8000/index.html` 접속

### 통합 테스트

#### 1. 초기 상태
- [ ] "Google 로그인" 버튼 표시
- [ ] "로그아웃" 버튼 숨김

#### 2. 로그인 프로세스
- [ ] "Google 로그인" 버튼 클릭
- [ ] 버튼 텍스트 "로그인 중..."으로 변경
- [ ] 버튼 비활성화 (중복 클릭 방지)
- [ ] 로그인 완료 후:
  - [ ] "Google 로그인" 버튼 숨김
  - [ ] "로그아웃" 버튼 표시
  - [ ] 닉네임 모달 표시 (신규 사용자인 경우)

#### 3. 닉네임 설정 (신규 사용자)
- [ ] 닉네임 입력 모달 표시
- [ ] 2-12자 닉네임 입력
- [ ] "저장" 버튼 클릭
- [ ] 모달 닫힘

#### 4. 세션 유지
- [ ] 페이지 새로고침
- [ ] 로그인 상태 유지 확인
- [ ] 닉네임 유지 확인

## 프로덕션 테스트 (Firebase Hosting)

### 배포 후 테스트
배포 URL: `https://YOUR_PROJECT_ID.web.app/`

### 테스트 항목
- [ ] 메인 페이지 로그인 테스트
- [ ] 테스트 페이지 접속: `/test-login.html`
- [ ] 모든 기능이 로컬과 동일하게 작동

## 브라우저 호환성 테스트

### Desktop
- [ ] Chrome 최신 버전
  - [ ] 팝업 허용 시
  - [ ] 팝업 차단 시 (리다이렉트)
- [ ] Firefox 최신 버전
  - [ ] 팝업 허용 시
  - [ ] 팝업 차단 시
- [ ] Safari 최신 버전 (Mac)
  - [ ] 팝업 허용 시
  - [ ] 팝업 차단 시
- [ ] Edge 최신 버전
  - [ ] 팝업 허용 시
  - [ ] 팝업 차단 시

### Mobile
- [ ] iOS Safari
  - [ ] 리다이렉트 로그인
- [ ] Android Chrome
  - [ ] 팝업 또는 리다이렉트 로그인

## 성능 테스트

- [ ] 로그인 속도
  - 팝업: 2-3초 이내
  - 리다이렉트: 5-7초 이내
- [ ] 페이지 로드 시간
  - 로그인 전: 변화 없음
  - 로그인 후: 변화 없음
- [ ] 메모리 사용량
  - 추가 메모리 사용 없음

## 보안 검증

- [ ] HTTPS 연결 (프로덕션)
- [ ] CSP 정책 준수
  - 콘솔에 CSP 위반 에러 없음
- [ ] 토큰 보안
  - Firebase SDK가 자동 관리
  - localStorage에 안전하게 저장

## 로그 확인

### 브라우저 콘솔
정상 로그인 시 예상 로그:
```
🔐 Google 로그인 시도 (팝업 방식)...
✅ Google 로그인 성공 (팝업): user@example.com
👋 환영합니다, User님!
```

팝업 차단 시 예상 로그:
```
🔐 Google 로그인 시도 (팝업 방식)...
⚠️ 팝업 로그인 실패: auth/popup-blocked
🔄 리다이렉트 방식으로 전환합니다...
⏳ 로그인 처리 중...
```

리다이렉트 복귀 시 예상 로그:
```
✅ Google 로그인 성공 (리다이렉트): user@example.com
👋 환영합니다, User님!
```

## 문제 발생 시 대응

### "팝업이 차단되었습니다"
1. 브라우저 설정에서 팝업 허용
2. 또는 자동으로 리다이렉트로 전환됨 (정상 동작)

### "인증되지 않은 도메인"
1. Firebase Console → Authentication → Settings → Authorized domains
2. 현재 도메인 추가

### "네트워크 오류"
1. 인터넷 연결 확인
2. 방화벽 설정 확인
3. Firebase 서비스 상태 확인: https://status.firebase.google.com/

### "로그인 후 자동으로 로그아웃됨"
1. 브라우저 쿠키 설정 확인
2. 시크릿 모드에서 테스트
3. 다른 브라우저에서 테스트

## 최종 확인

- [ ] 모든 테스트 항목 통과
- [ ] 에러 로그 없음
- [ ] 사용자 경험 만족스러움
- [ ] 문서화 완료
- [ ] 팀원에게 공유

## 참고 문서

- [GOOGLE_LOGIN_SETUP.md](./GOOGLE_LOGIN_SETUP.md) - 설정 가이드
- [GOOGLE_LOGIN_IMPLEMENTATION.md](./GOOGLE_LOGIN_IMPLEMENTATION.md) - 구현 상세
- [Firebase Auth 문서](https://firebase.google.com/docs/auth/web/google-signin)

## 테스트 완료 후

검증이 완료되면 이 체크리스트를 저장하고, 발견된 이슈가 있다면 GitHub Issues에 등록해주세요.

---
최종 업데이트: 2025-10-25
