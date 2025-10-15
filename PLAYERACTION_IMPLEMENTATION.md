# PlayerAction Implementation Guide

## Overview

This document describes the implementation of the core GodField gameplay actions: ATTACK, DEFEND, and PRAY.

## Architecture

### Backend (functions/index.js)

The `playerAction` Cloud Function handles all player actions through a unified interface:

```javascript
playerAction(matchId, actionType, payload)
```

#### Supported Action Types

1. **ATTACK** - Use a weapon card to attack another player
2. **DEFEND** - Use armor cards to defend against an attack
3. **PRAY** - Discard a card, draw 2 cards, and end turn (only when no weapons in hand)

### Action Flow

#### 1. ATTACK Action

**Flow:**
1. Player selects a weapon card from hand
2. Player selects a target opponent
3. Clicks "⚔️ 공격" button
4. Backend validates:
   - Current player's turn
   - Phase is 'main'
   - Weapon card exists in hand
   - Target exists
5. Weapon is equipped to player's weapon slot
6. Phase changes to 'threat'
7. ThreatInfo is recorded with attack details

**Validation:**
- Must be player's turn
- Must be in 'main' phase
- Card must be in hand and be a weapon type
- Target must be a valid player

**ThreatInfo Structure:**
```javascript
{
  attackerUid: string,
  attackerName: string,
  targetUid: string,
  targetName: string,
  weaponCard: Card,
  attackPower: number,
  attribute: string  // 無, 火, 水, 木, 土, 光, 暗
}
```

#### 2. DEFEND Action

**Flow:**
1. After an attack, the defender selects armor card(s)
2. Clicks "🛡️ 방어" button
3. Backend calculates final damage based on:
   - Base attack power
   - Total defense from armor cards
   - Attribute advantages/disadvantages
   - Special rules (Light unblockable, Dark instant death)
4. HP is reduced
5. Phase returns to 'main'
6. ThreatInfo is cleared

**Damage Calculation:**

```javascript
// Special Attributes
if (attackAttribute === '光') {
  // Light: Unblockable - defense is ignored
  finalDamage = attackPower;
}
else if (attackAttribute === '暗' && attackPower >= 1) {
  // Dark: Instant death if any damage >= 1
  // Unless fully blocked with dark-attribute armor
  if (totalDefense >= attackPower && defenseHasDark) {
    finalDamage = 0;
  } else {
    finalDamage = currentHP; // Instant death
  }
}
else {
  // Normal: Apply defense
  finalDamage = max(0, attackPower - totalDefense);
  
  // Attribute Advantages
  // Fire ↔ Water, Wood ↔ Earth
  if (defenderHasCounterAttribute) {
    finalDamage *= 0.5;  // 50% reduction
  }
  else if (attackerHasAdvantage) {
    finalDamage *= 1.5;  // 50% increase
  }
}

// Apply damage
player.hp = max(0, player.hp - finalDamage);
```

**Attribute Matchups:**
- Fire (火) weak to Water (水)
- Water (水) weak to Fire (火)
- Wood (木) weak to Earth (土)
- Earth (土) weak to Wood (木)
- Light (光) cannot be blocked (defense ignored)
- Dark (暗) causes instant death if 1+ damage lands

**Validation:**
- Phase must be 'threat'
- Player must be the target of the attack
- Selected cards must be armor type

#### 3. PRAY Action

**Flow:**
1. Player has no weapons in hand
2. Clicks "🙏 기도" button
3. Backend:
   - Discards 1 card from hand
   - Draws 2 cards from commonDeck
   - Ends the turn (moves to next player)
4. Next player draws 1 card

**Validation:**
- Must be player's turn
- Must be in 'main' phase
- No weapon cards in hand
- At least 1 card to discard

## Frontend (public/js/tabs/match.js)

### UI Components

1. **Action Buttons**
   - `#btn-attack` - Attack with weapon
   - `#btn-defend` - Defend with armor
   - `#btn-pray` - Pray for cards

2. **Button State Management**
   - Buttons are enabled/disabled based on game state
   - `isActionInProgress` flag prevents double-clicks
   - All buttons disabled during API calls

3. **Visual Feedback**
   - Selected cards are highlighted
   - Selected targets are highlighted
   - Threat phase shows warning banner
   - Action panel shows current phase

### Button Enable Conditions

```javascript
// ATTACK Button
enabled = myTurn && phase === 'main' && selectedCard.cardType === 'weapon' && targetSelected

// DEFEND Button  
enabled = phase === 'threat' && amTargeted && selectedCard.cardType === 'armor'

// PRAY Button
enabled = myTurn && phase === 'main' && !hasWeaponInHand
```

## UI Styling (Garfield-Inspired)

The interface uses a card game aesthetic inspired by Garfield:

- **Gradient backgrounds** on action buttons
- **Hover effects** with elevation and glow
- **Color coding:**
  - Red: Attack actions
  - Blue: Defend actions  
  - Purple: Pray actions
- **Disabled state** shows grayed out buttons
- **Threat phase** pulses with red glow animation
- **Card selection** shows blue glow border

## Game Phase System

```
main -> threat -> main
  |                 ^
  +---(PRAY)--------+
```

- **main**: Player can attack or pray
- **threat**: Defender must defend
- After defense or pray, returns to main (possibly next player's turn)

## Duplicate Click Prevention

Multiple mechanisms prevent duplicate actions:

1. **`isActionInProgress` flag** - Set at function start
2. **Button disabled check** - First line of handlers
3. **`disableAllActionButtons()`** - Called before async operations
4. **Button re-enabled** - Only in finally block after completion

```javascript
async function handleAttack() {
  if (isActionInProgress || attackBtn.disabled) return;
  isActionInProgress = true;
  disableAllActionButtons();
  try {
    await callPlayerAction(...);
  } finally {
    isActionInProgress = false;
    updateActionPanel(); // Re-enables based on state
  }
}
```

## Testing Checklist

- [ ] Attack action with various weapon attributes
- [ ] Defend with matching/mismatched attributes
- [ ] Dark attribute instant death
- [ ] Light attribute unblockable
- [ ] Fire/Water advantage
- [ ] Wood/Earth advantage
- [ ] Pray with no weapons
- [ ] Pray rejected when weapons exist
- [ ] Turn changes after pray
- [ ] Button states update correctly
- [ ] No double-click issues
- [ ] Threat phase visual feedback
- [ ] HP updates correctly
- [ ] Cards move between hand/equipment correctly

## Error Handling

All actions include try-catch blocks with user-friendly alerts:

```javascript
try {
  const result = await callPlayerAction(...);
  alert(result.message);
} catch (e) {
  alert(`액션 실패: ${e.message}`);
}
```

Backend throws HttpsError with appropriate codes:
- `unauthenticated` - User not logged in
- `not-found` - Resource not found
- `failed-precondition` - Invalid game state
- `invalid-argument` - Invalid parameters

## Next Steps

Future enhancements to consider:
1. USE_ARTIFACT action for miracles and items
2. TRADE action for player-to-player trading
3. DISCARD action for discarding unwanted cards
4. Multiple armor selection for DEFEND
5. Animation effects for attacks/damage
6. Sound effects
7. Card hover previews
8. Game history/replay
