# API 명세 (Firebase Functions 기준 예시)

모든 요청은 `roomId` 또는 `matchId`를 포함. 서버가 **권위**를 가진다(클라 검증은 보조).

## `createRoom`
- req: `{ title, maxPlayers, rules? }`
- res: `{ roomId }`

## `joinRoom`
- req: `{ roomId, nickname, characterId }`
- res: `{ ok: true }`

## `submitCards`
- req: `{ roomId, cards: Card[] }`  // 5~10장, 승인된 카드만 허용
- res: `{ accepted: n, rejected: m, reasons?: [...] }`

## `startMatch`
- req: `{ roomId }` (host 전용)
- res: `{ matchId }`

## `playCard`
- req: `{ matchId, cardInstanceId, targets, options? }`
- 동작: 코스트 계산→지불→스택 올림→반응창 신호
- res: `{ ok: true }`

## `react`
- req: `{ matchId, cardInstanceId, reactTo? }`
- 제한: 플레이어당 한 턴 2회
- res: `{ ok: true }`

## `endTurn`
- req: `{ matchId }`
- res: `{ ok: true }`

## `surrender`
- req: `{ matchId }`
- res: `{ ok: true }`

## `validateUserCard` (사전 검증기)
- req: `{ cardDraft }`
- res: `{ ok: boolean, cost, fixes?: [...], errors?: [...] }`
