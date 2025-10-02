# 상태 머신(초안)

## 룸(Room)
- 상태: `waiting` → `ready` → `playing` → `ended`
- 전이 규칙:
  - waiting: 최소 인원(예: 3) 및 모두 준비하면 `ready`
  - host가 `startMatch` → `playing` (전원 카드 제출 완료 조건)
  - 매치 종료 → `ended`

## 매치(Match)
- 필드: `turn`, `currentPlayerUid`, `phase`(main/reaction/resolve/end), `stack`, `deckCount`, `discardCount`, `logs`, `seed`
- 전이:
  - `main`에서 `playCard` → `reaction` 열림 → 반응 또는 없음 → `resolve` → `main`/`end`
  - 라운드 종료 시 승자 결정 → `finished`

## 유저/플레이어
- 필드: `hp`, `maxKi`, `ki`, `hand`, `shield`, `flags`, `cooldowns`, `reactionUsed`
- 전이: 피해/회복/사망 처리, 탈주 처리(타임아웃 시 AI)
