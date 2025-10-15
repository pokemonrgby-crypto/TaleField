# TaleField — 갓필드 스타일 AI 협업 TCG

> AI와 함께 만드는 갓필드 스타일 웹 TCG

이 프로젝트는 **갓필드 스타일의 다자간 전투 + AI 사용자 제작 카드** 온라인 게임입니다.
플레이어들이 AI의 도움을 받아 카드와 캐릭터를 생성하고, 모두의 카드를 섞은 공용 덱으로 배틀을 즐기는 독특한 TCG 경험을 제공합니다.

## 핵심 특징

### 🎴 AI 카드 생성
- Gemini API를 활용한 실시간 카드 생성
- 사용자의 아이디어를 밸런스 있는 TCG 카드로 변환
- DSL(Domain Specific Language) 기반의 카드 효과 시스템

### 🎮 갓필드 스타일 게임플레이
- **공용 덱 시스템**: 모든 플레이어가 제출한 카드를 섞어 하나의 덱으로 플레이
- **다자간 배틀**: 2~8명이 함께하는 FFA(Free-For-All) 전투
- **최후의 1인**: 마지막까지 생존한 플레이어가 승리

### ⚔️ 전략적 전투 시스템
- 기력(Ki) 자원 관리
- 반응(Reaction) 카드를 통한 대응 전략
- 스택 기반 효과 해결 시스템

## 프로젝트 구조
- `functions/` — Firebase Cloud Functions (백엔드 로직)
  - `index.js` — AI 생성, 방/게임 관리 함수
  - `src/actions.js` — 전투 액션 (카드 사용, 턴 종료)
  - `src/engine.js` — 게임 엔진 (스택 처리)
- `public/` — 프론트엔드 (HTML, CSS, JavaScript)
  - `js/tabs/` — 각 화면별 로직 (로비, 방, 매치, 카드 생성 등)
- `docs/` — 게임 규칙 및 설계 문서
  - `rules.md` — 게임 규칙
  - `engine-sketch.md` — 엔진 설계
  - `quickstart-firebase.md` — Firebase 배포 가이드

## 시작하기
1. Firebase 프로젝트 생성 및 설정
2. Gemini API 키 설정
3. `firebase deploy` 명령으로 배포
4. 웹 브라우저에서 접속하여 플레이

자세한 내용은 `docs/quickstart-firebase.md`를 참조하세요.
