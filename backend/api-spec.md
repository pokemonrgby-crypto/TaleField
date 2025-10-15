# API 명세 (GodField - Firebase Functions)

모든 요청은 `roomId` 또는 `matchId`를 포함. 서버가 **권위**를 가진다(클라이언트 검증은 보조).

## AI 생성 함수

### `genShin`
AI가 신(God)을 생성합니다.
- req: `{ prompt: string, temperature?: number }`
- res: `{ ok: true, shin: Shin }`
- Shin 구조:
  ```json
  {
    "name": "명왕신 하데스",
    "description": "죽음과 암흑을 다스리는 과묵한 신",
    "uniqueMiracles": [
      {
        "name": "<어둠>",
        "cardType": "miracle",
        "attribute": "暗",
        "text": "단일 대상에게 5의 암속성 피해를 준다.",
        "stats": { "mpCost": 5 },
        "dsl": [...]
      }
    ]
  }
  ```

### `genArtifact`
AI가 성물(Artifact)을 생성합니다.
- req: `{ prompt: string, powerCap?: number, temperature?: number }`
- res: `{ ok: true, artifact: Artifact }`
- Artifact 구조:
  ```json
  {
    "name": "승천궁",
    "cardType": "weapon",
    "attribute": "光",
    "text": "...",
    "stats": { "attack": 1 },
    "disasterToApply": null,
    "dsl": [...]
  }
  ```

## 방 관리 함수

### `createRoom`
새로운 게임 방을 생성합니다.
- req: `{ title: string, maxPlayers: number }`
- res: `{ ok: true, roomId: string }`

### `joinRoom`
방에 참가합니다.
- req: `{ roomId: string }`
- res: `{ ok: true }`

### `leaveRoom`
방에서 나갑니다.
- req: `{ roomId: string }`
- res: `{ ok: true }`

### `setPlayerReady`
플레이어 준비 상태 및 선택 사항을 업데이트합니다.
- req: `{ roomId: string, shinId?: string, selectedArtifactIds?: string[], ready: boolean }`
- res: `{ ok: true }`
- 플레이어는 자신의 신 1개와 성물 7개를 선택해야 합니다.

## 게임 시작 함수

### `startGame`
게임을 시작합니다. (방장 전용)
- req: `{ roomId: string }`
- res: `{ ok: true, matchId: string }`
- 동작:
  1. 각 플레이어의 신을 읽어 고유 기적을 플레이어의 기적 목록에 추가
  2. 각 플레이어가 제출한 성물(7장)을 모아 공용 덱 생성 및 셔플
  3. 플레이어별 초기 스탯 설정: `hp: 40, mp: 10, gold: 20`
  4. 플레이어별 손패 9장 분배
  5. `/matches/{matchId}` 문서 생성

## 게임 액션 함수

### `playerAction`
플레이어의 게임 내 행동을 처리하는 핵심 함수입니다.
- req: `{ matchId: string, action: Action }`
- res: `{ ok: true }`

#### Action 타입

##### ATTACK (공격)
```json
{
  "type": "ATTACK",
  "payload": {
    "weaponCardId": "string",
    "targetUid": "string"
  }
}
```
- 무기 카드를 사용하여 공격
- phase를 'threat'로 변경
- threatInfo에 공격 정보 저장

##### DEFEND (방어)
```json
{
  "type": "DEFEND",
  "payload": {
    "armorCardIds": ["string"]
  }
}
```
- 방어구 카드를 사용하여 방어
- threatInfo와 방어 카드를 기반으로 최종 피해 계산
- **암속성 즉사 판정 로직 포함**
- 피해 적용 후 phase를 'main'으로 변경

##### USE_ARTIFACT (성물 사용)
```json
{
  "type": "USE_ARTIFACT",
  "payload": {
    "artifactId": "string",
    "targets": ["string"]
  }
}
```
- 기적, 아이템, 장비 등 사용
- DSL을 해석하여 상태 변경
- MP, Gold 등 자원 소모 처리

##### PRAY (기도)
```json
{
  "type": "PRAY"
}
```
- 조건: 손패에 무기가 없을 때만 가능
- 효과: 턴을 넘기고 성물 1장 받기

##### TRADE (거래)
```json
{
  "type": "TRADE",
  "payload": {
    "targetUid": "string",
    "offerCardIds": ["string"],
    "requestGold": number
  }
}
```
- 다른 플레이어와 거래 시작
- phase를 'trade'로 변경하고 상대에게 알림

##### DISCARD (버리기)
```json
{
  "type": "DISCARD",
  "payload": {
    "cardIds": ["string"]
  }
}
```
- 필요 없는 성물을 버림
- 새 성물을 받지 않음

### `endTurn`
현재 턴을 종료하고 다음 플레이어에게 턴을 넘깁니다.
- req: `{ matchId: string }`
- res: `{ ok: true }`

### `surrender`
게임을 포기합니다.
- req: `{ matchId: string }`
- res: `{ ok: true }`

## 카드 관리 함수

### `deleteCard`
자신이 생성한 카드를 삭제합니다.
- req: `{ cardId: string }`
- res: `{ ok: true }`
