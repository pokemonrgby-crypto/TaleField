# Quickstart — Firebase(온라인 MVP 최단 루트)

> 코드는 나중에 붙이고, 우선 온라인에서 **실시간 방/로비/매치 상태**를 보려는 최소 셋업이야.

## 0) 준비
- Firebase 콘솔에서 새 프로젝트 생성
- Authentication: **익명 로그인** ON
- Firestore: 네이티브 모드 생성
- Hosting: 사이트 1개 생성(도메인은 나중에)
- Functions: Node 20, 지역 `asia-northeast3`(서울) 추천

## 1) 컬렉션 생성
- 콘솔에서 `rooms`, `matches`, `userCards` 3개를 만들고 예시 문서 1~2개 생성
- `backend/firestore-schema.json` 참고

## 2) 보안 규칙(간단판 예시)
- 초기에는 전체 읽기 허용/쓰기 제한(테스트용)
- 이후: 자신의 하위 도큐먼트만 수정 가능하게 강화

## 3) 프론트 임시 페이지
- Hosting에 아주 간단한 `index.html` 올려서
  - `rooms` 목록 보기
  - 방 만들기/참여 버튼만 동작 (Firestore onSnapshot으로 실시간 반영)

## 4) Functions(서버) — 다음에 붙일 지점
- `backend/api-spec.md`에 있는 이름으로 함수를 만들 예정
- 실제 계산(피해/회복/드로우)은 **서버에서만** 처리
- 클라는 `playCard/ react/ endTurn` 같은 **의도(intent)** 만 보냄

## 5) 다음 단계
- 네 레포가 생기면, 내가 **정밀 패치 지시**로 `createRoom`, `joinRoom`, `submitCards`, `startMatch` 순서대로 붙여줄게.
