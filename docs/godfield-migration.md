# GodField Migration Guide

This guide explains the changes from the old system to the new GodField system.

## Overview

The game has been redesigned from a Ki-based TCG to a **GodField survival TCG** with the following major changes:

### Old System vs New System

| Aspect | Old System | New System (GodField) |
|--------|-----------|------------------------|
| **Player Identity** | Characters with HP/Ki | Prophets with HP/MP/Gold |
| **Starting HP** | 20 | 40 |
| **Resources** | Ki (기력) | MP (마력), Gold (자금) |
| **Cards** | Character Skills + User Cards | Shin (신) + Artifacts (성물) |
| **Initial Hand** | 3 cards | 9 cards |
| **Max Hand** | 5 cards | 18 cards |
| **Deck Source** | 5-10 cards per player | 7 artifacts per player |
| **Attributes** | fire/water/wind/earth/light/dark/neutral | 無/火/水/木/土/光/暗 |

## API Changes

### Character Creation → Shin (God) Creation

**Old:**
```javascript
const result = await callFunction('genCharacter', {
  prompt: "서리방패 아이기스",
  temperature: 0.8
});
```

**New:**
```javascript
const result = await callFunction('genShin', {
  prompt: "명왕신 하데스",
  temperature: 0.8
});

// Returns:
{
  ok: true,
  shin: {
    id: "...",
    name: "명왕신 하데스",
    description: "죽음과 암흑을 다스리는 과묵한 신",
    uniqueMiracles: [
      {
        name: "<어둠>",
        cardType: "miracle",
        attribute: "暗",
        text: "단일 대상에게 5의 암속성 피해를 준다.",
        stats: { mpCost: 5 },
        dsl: [...]
      }
    ]
  }
}
```

### Card Creation → Artifact Creation

**Old:**
```javascript
const result = await callFunction('genCard', {
  prompt: "재빠른 반격",
  powerCap: 10,
  temperature: 0.8
});
```

**New:**
```javascript
const result = await callFunction('genArtifact', {
  prompt: "승천궁",
  powerCap: 10,
  temperature: 0.8
});

// Returns:
{
  ok: true,
  artifact: {
    id: "...",
    name: "승천궁",
    cardType: "weapon",
    attribute: "光",
    text: "...",
    stats: { attack: 1 },
    dsl: [...]
  }
}
```

### Player Ready

**Old:**
```javascript
await callFunction('setPlayerReady', {
  roomId: "...",
  characterId: "char_123",
  selectedCardIds: ["card_1", "card_2", ...], // 5-10 cards
  selectedSkills: ["skill1", "skill2"],
  ready: true
});
```

**New:**
```javascript
await callFunction('setPlayerReady', {
  roomId: "...",
  shinId: "shin_123",
  selectedArtifactIds: ["art_1", "art_2", ...], // exactly 7 artifacts
  ready: true
});
```

## Game Mechanics Changes

### Stats System

**Old:**
- HP: 20-70 (varies by character)
- Ki: 5-15 (varies by character)
- Ki Regen: 2 or 3 per turn

**New (Fixed for all players):**
- HP: 40 (starts) / 99 (max)
- MP: 10 (starts) / 99 (max)
- Gold: 20 (starts) / 99 (max)

### Card Types

**Old:**
- skill, spell, attachment, reaction

**New:**
- weapon (무기): Physical attacks
- armor (방어구): Physical defense
- item (잡화): Various effects
- miracle (기적): MP-consuming magic

### New DSL Operations

GodField introduces new DSL operations:

```javascript
// Disaster system
{ op: "apply_disaster", disasterName: "병", target: "enemy" }
{ op: "remove_disaster", target: "caster" }

// Resource management
{ op: "modify_stat", target_stat: "mp", amount: 5, target: "caster" }
{ op: "modify_stat", target_stat: "gold", amount: -10, target: "caster" }

// Healing with stat selection
{ op: "heal", amount: 5, target_stat: "hp", target: "caster" }
{ op: "heal", amount: 3, target_stat: "mp", target: "caster" }

// Lifesteal
{ op: "absorb_hp", amount: 5, target: "enemy" }

// Death trigger
{ op: "on_user_death", dsl: [...] }

// Equipment
{ op: "equip", slot: "weapon" }

// Attribute change
{ op: "change_attribute", from: "光", to: "無", target: "caster" }
```

### Attribute System

**Old attributes (English):**
- fire, water, wind, earth, light, dark, neutral

**New attributes (Korean Hanja):**
- 無 (mu/neutral), 火 (fire), 水 (water), 木 (wood), 土 (earth), 光 (light), 暗 (dark)

**Special Attribute Rules:**
- **光 (Light)**: Cannot be defended (except by converting to 無 first)
- **暗 (Dark)**: Any damage ≥1 causes instant death (승천)

## Turn Actions

**Old:**
- Play a card (costs Ki)
- Use skill (costs Ki)
- React (on opponent's turn)
- End turn

**New:**
- Use artifact (weapon attack, item use, miracle cast)
- Pray (기도): Skip turn to draw 1 card (only if no weapons in hand)
- Trade (거래): Initiate trade with another player
- Discard (버리기): Discard unwanted cards

## Disaster System (New)

Players can be afflicted with disasters (재앙):

- **병 (Disease)**: Progresses through stages: 감기 → 열병 → 지옥병 → 천국병
- **안개 (Fog)**: Vision obstruction
- **섬광 (Flash)**: Blinding
- **꿈 (Dream)**: Hallucination
- **먹구름 (Dark Clouds)**: Depression

## Backward Compatibility

The system supports both modes:

- **GodField Mode**: When players select shin + artifacts
- **Legacy Mode**: When players select character + cards

The `startGame` function automatically detects which mode to use based on player selections.

### Using Legacy Functions

For backward compatibility, the old functions are aliased:
```javascript
export const genCard = genArtifact;
export const genCharacter = genShin;
```

## Migration Checklist

To migrate your code:

1. [ ] Replace `genCharacter` calls with `genShin`
2. [ ] Replace `genCard` calls with `genArtifact`
3. [ ] Update `setPlayerReady` to use `shinId` and `selectedArtifactIds`
4. [ ] Update UI to show HP/MP/Gold instead of HP/Ki
5. [ ] Update attribute display from English to Korean Hanja
6. [ ] Implement new turn actions (PRAY, TRADE, DISCARD)
7. [ ] Add disaster (재앙) display
8. [ ] Add miracle list display (separate from hand)
9. [ ] Update card type icons (weapon/armor/item/miracle)
10. [ ] Implement equipment slots UI (weapon/shield/accessory)

## Testing

To test the new system:

1. Create a shin with `genShin`
2. Create 7 artifacts with `genArtifact`
3. Create a room
4. Set player ready with shin and artifacts
5. Start the game
6. Verify initial stats: HP=40, MP=10, Gold=20
7. Verify initial hand: 9 cards
8. Verify miracles list contains shin's unique miracles

## Example Usage

```javascript
// Create a god
const { shin } = await callFunction('genShin', {
  prompt: "태양신 아폴론, 빛과 예언의 신",
  temperature: 0.9
});

// Create artifacts
const artifacts = [];
for (let i = 0; i < 7; i++) {
  const { artifact } = await callFunction('genArtifact', {
    prompt: `태양신의 성물 ${i+1}`,
    powerCap: 10,
    temperature: 0.8
  });
  artifacts.push(artifact);
}

// Join room and set ready
await callFunction('joinRoom', { roomId: "room_123" });
await callFunction('setPlayerReady', {
  roomId: "room_123",
  shinId: shin.id,
  selectedArtifactIds: artifacts.map(a => a.id),
  ready: true
});

// Start game (as host)
const { matchId } = await callFunction('startGame', { roomId: "room_123" });
```
