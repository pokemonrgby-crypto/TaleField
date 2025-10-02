# Godlike Field — Online MVP Starter (스케치 패키지)

> 날짜: 2025-10-02

이 패키지는 **갓필드 느낌 + AI 사용자 제작 카드** 온라인 게임의 **문서 스케치**를 포함해.
아직 코드를 붙이지 않고도, 규칙·스키마·API·상태머신을 정리하고 바로 다음 단계(레포 생성, 간단 실행)로 갈 수 있도록 만든 초안이야.

## 구성
- `docs/rules.md` — 게임 규칙(라운드/턴/코스트/반응창)
- `docs/engine-sketch.md` — 동사(피해/회복 등) 기반 미니 DSL & 타이밍 창/스택 설계
- `backend/state-machine.md` — 로비/매치/턴/스택 상태 전이 정의
- `backend/api-spec.md` — 서버 함수(API) 명세 (createRoom/joinRoom/…/playCard/react 등)
- `backend/firestore-schema.json` — Firebase Firestore 기준 데이터 스키마(초안)
- `backend/security.md` — 안티치트/밸런스/검증기 규칙
- `data/cards.json` — 예시 카드 6장
- `data/characters.json` — 예시 캐릭터 2명
- `ui/wireframes.md` — 최소 UI 흐름(로비/게임화면)
- `prompts/card-prompt.txt`, `prompts/character-prompt.txt` — AI 생성용 프롬프트 템플릿
- `docs/quickstart-firebase.md` — **온라인 실행**을 가장 빨리 만드는 루트(A안: Firebase)

## 다음 단계(추천 순서)
1) 문서만 읽고 용어/룰을 다듬어 — 특히 `rules.md`, `engine-sketch.md`.
2) 카드 10장 아이디어를 `data/cards.json` 형식을 따라 더 써 넣어.
3) GitHub 레포를 만들고 이 파일들을 올려.
4) `docs/quickstart-firebase.md`를 따라 **온라인 MVP**를 띄워 (Hosting+Firestore+Functions).
5) 그 다음, 너가 최신 레포를 주면 **정밀 패치 지시(앵커→교체/추가)**로 서버/클라 코드를 붙여줄게.
