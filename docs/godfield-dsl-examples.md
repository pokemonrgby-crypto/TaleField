# GodField DSL Examples

This document provides examples of DSL (Domain Specific Language) operations for GodField artifacts and miracles.

## Basic Operations

### Damage

```json
{
  "op": "damage",
  "amount": 5,
  "attribute": "火",
  "target": "enemy"
}
```

**Attributes:**
- `amount`: Damage value
- `attribute`: 無/火/水/木/土/光/暗 (optional, defaults to 無)
- `target`: "enemy", "caster", "all_enemies", "all_players", etc.

### Healing

```json
{
  "op": "heal",
  "amount": 10,
  "target_stat": "hp",
  "target": "caster"
}
```

**Heal MP:**
```json
{
  "op": "heal",
  "amount": 5,
  "target_stat": "mp",
  "target": "caster"
}
```

### Stat Modification

```json
{
  "op": "modify_stat",
  "target_stat": "gold",
  "amount": 10,
  "target": "caster"
}
```

Use negative amounts to reduce:
```json
{
  "op": "modify_stat",
  "target_stat": "mp",
  "amount": -5,
  "target": "caster"
}
```

## Disasters (재앙)

### Apply Disaster

```json
{
  "op": "apply_disaster",
  "disasterName": "병",
  "target": "enemy"
}
```

**Available disasters:**
- "병" (Disease)
- "안개" (Fog)
- "섬광" (Flash)
- "꿈" (Dream)
- "먹구름" (Dark Clouds)

### Remove Disaster

Remove all disasters:
```json
{
  "op": "remove_disaster",
  "target": "caster"
}
```

Remove specific disaster:
```json
{
  "op": "remove_disaster",
  "disasterName": "병",
  "target": "caster"
}
```

## Card Manipulation

### Draw Cards

```json
{
  "op": "draw",
  "count": 2,
  "target": "caster"
}
```

### Discard Cards

```json
{
  "op": "discard",
  "count": 1,
  "target": "enemy"
}
```

## Advanced Operations

### Lifesteal (흡혈)

```json
{
  "op": "absorb_hp",
  "amount": 5,
  "target": "enemy"
}
```

Deals 5 damage and heals caster for 5 HP.

### Reflect Damage

```json
{
  "op": "reflect_damage",
  "multiplier": 1.0
}
```

Reflects incoming damage back to attacker. Use `multiplier` to adjust (e.g., 0.5 reflects 50%).

### Conditional Effects

```json
{
  "op": "if",
  "cond": "enemy.hp < 10",
  "then": [
    { "op": "damage", "amount": 10, "target": "enemy" }
  ],
  "else": [
    { "op": "damage", "amount": 5, "target": "enemy" }
  ]
}
```

### Random Effects

```json
{
  "op": "random",
  "chance": 0.5,
  "then": [
    { "op": "damage", "amount": 10, "target": "enemy" }
  ],
  "else": [
    { "op": "damage", "amount": 5, "target": "enemy" }
  ]
}
```

50% chance to deal 10 damage, otherwise deals 5 damage.

### Death Trigger

```json
{
  "op": "on_user_death",
  "dsl": [
    { "op": "damage", "amount": 20, "target": "all_others" }
  ]
}
```

When the user dies, deals 20 damage to all other players.

### Equipment

```json
{
  "op": "equip",
  "slot": "weapon"
}
```

**Available slots:**
- "weapon"
- "shield"
- "accessory"

### Attribute Change

```json
{
  "op": "change_attribute",
  "from": "光",
  "to": "無",
  "target": "caster"
}
```

Changes an attack from Light (undefendable) to Neutral (defendable).

## Complete Artifact Examples

### Example 1: Simple Weapon

```json
{
  "name": "철검",
  "cardType": "weapon",
  "attribute": "無",
  "text": "적에게 5의 피해를 준다.",
  "stats": { "attack": 5 },
  "dsl": [
    { "op": "damage", "amount": 5, "target": "enemy" }
  ]
}
```

### Example 2: Fire Weapon with Burn

```json
{
  "name": "화염검",
  "cardType": "weapon",
  "attribute": "火",
  "text": "적에게 7의 화속성 피해를 주고 '열병' 재앙을 부여한다.",
  "stats": { "attack": 7 },
  "dsl": [
    { "op": "damage", "amount": 7, "attribute": "火", "target": "enemy" },
    { "op": "apply_disaster", "disasterName": "병", "target": "enemy" }
  ]
}
```

### Example 3: Healing Item

```json
{
  "name": "회복 물약",
  "cardType": "item",
  "attribute": "無",
  "text": "HP 15를 회복한다.",
  "stats": {},
  "dsl": [
    { "op": "heal", "amount": 15, "target_stat": "hp", "target": "caster" }
  ]
}
```

### Example 4: MP Restoration

```json
{
  "name": "마력 결정",
  "cardType": "item",
  "attribute": "無",
  "text": "MP 10을 회복한다.",
  "stats": { "goldValue": 15 },
  "dsl": [
    { "op": "heal", "amount": 10, "target_stat": "mp", "target": "caster" }
  ]
}
```

### Example 5: Armor with Healing

```json
{
  "name": "재생의 갑옷",
  "cardType": "armor",
  "attribute": "木",
  "text": "방어력 8을 제공하고 사용 시 HP 5를 회복한다.",
  "stats": { "defense": 8 },
  "dsl": [
    { "op": "heal", "amount": 5, "target_stat": "hp", "target": "caster" }
  ]
}
```

### Example 6: Complex Miracle

```json
{
  "name": "<천벌>",
  "cardType": "miracle",
  "attribute": "光",
  "text": "50% 확률로 모든 적에게 10의 광속성 피해를 준다. 실패 시 자신의 MP 5를 회복한다.",
  "stats": { "mpCost": 8 },
  "dsl": [
    {
      "op": "random",
      "chance": 0.5,
      "then": [
        { "op": "damage", "amount": 10, "attribute": "光", "target": "all_enemies" }
      ],
      "else": [
        { "op": "heal", "amount": 5, "target_stat": "mp", "target": "caster" }
      ]
    }
  ]
}
```

### Example 7: Death Bomb (승천궁)

```json
{
  "name": "승천궁",
  "cardType": "weapon",
  "attribute": "光",
  "text": "적에게 1의 광속성 피해를 준다. 사용자가 승천 시, 75% 확률로 모든 플레이어에게 30의 피해를 준다.",
  "stats": { "attack": 1 },
  "dsl": [
    { "op": "damage", "amount": 1, "attribute": "光", "target": "enemy" },
    {
      "op": "on_user_death",
      "dsl": [
        {
          "op": "random",
          "chance": 0.75,
          "then": [
            { "op": "damage", "amount": 30, "target": "all_others" }
          ]
        }
      ]
    }
  ]
}
```

### Example 8: Vampire Weapon

```json
{
  "name": "흡혈검",
  "cardType": "weapon",
  "attribute": "暗",
  "text": "적에게 8의 암속성 피해를 주고 그만큼 HP를 회복한다.",
  "stats": { "attack": 8 },
  "dsl": [
    { "op": "absorb_hp", "amount": 8, "target": "enemy" }
  ]
}
```

### Example 9: Conditional Finisher

```json
{
  "name": "처형검",
  "cardType": "weapon",
  "attribute": "無",
  "text": "적에게 5의 피해를 준다. 대상의 HP가 10 이하라면 추가로 15의 피해를 준다.",
  "stats": { "attack": 5 },
  "dsl": [
    { "op": "damage", "amount": 5, "target": "enemy" },
    {
      "op": "if",
      "cond": "target.hp <= 10",
      "then": [
        { "op": "damage", "amount": 15, "target": "enemy" }
      ]
    }
  ]
}
```

### Example 10: Rainbow Curtain (Attribute Defense)

```json
{
  "name": "레인보우 커튼",
  "cardType": "item",
  "attribute": "無",
  "text": "다음 공격의 속성을 無로 변경하여 방어 가능하게 만든다.",
  "stats": { "goldValue": 20 },
  "dsl": [
    { "op": "change_attribute", "from": "光", "to": "無", "target": "incoming_attack" }
  ]
}
```

### Example 11: Full Support Item

```json
{
  "name": "만능 영약",
  "cardType": "item",
  "attribute": "無",
  "text": "HP 20, MP 10을 회복하고 모든 재앙을 제거한다.",
  "stats": { "goldValue": 30 },
  "dsl": [
    { "op": "heal", "amount": 20, "target_stat": "hp", "target": "caster" },
    { "op": "heal", "amount": 10, "target_stat": "mp", "target": "caster" },
    { "op": "remove_disaster", "target": "caster" }
  ]
}
```

## Shin (God) Miracle Examples

### Example 1: Simple Attack Miracle

```json
{
  "name": "<어둠>",
  "cardType": "miracle",
  "attribute": "暗",
  "text": "단일 대상에게 5의 암속성 피해를 준다.",
  "stats": { "mpCost": 5 },
  "dsl": [
    { "op": "damage", "amount": 5, "attribute": "暗", "target": "enemy" }
  ]
}
```

### Example 2: AOE Miracle

```json
{
  "name": "<대지진>",
  "cardType": "miracle",
  "attribute": "土",
  "text": "모든 적에게 8의 토속성 피해를 준다.",
  "stats": { "mpCost": 12 },
  "dsl": [
    { "op": "damage", "amount": 8, "attribute": "土", "target": "all_enemies" }
  ]
}
```

### Example 3: Support Miracle

```json
{
  "name": "<천상의 은총>",
  "cardType": "miracle",
  "attribute": "光",
  "text": "HP 30을 회복하고 2장을 뽑는다.",
  "stats": { "mpCost": 15 },
  "dsl": [
    { "op": "heal", "amount": 30, "target_stat": "hp", "target": "caster" },
    { "op": "draw", "count": 2, "target": "caster" }
  ]
}
```

## Target Options

Common target values:
- `"caster"`: The player who used the card
- `"enemy"`: Single enemy (player selects)
- `"all_enemies"`: All other players
- `"all_players"`: All players including caster
- `"all_others"`: All players except caster
- `"random_enemy"`: Random enemy player
- `"incoming_attack"`: The incoming attack (for defensive cards)

## Best Practices

1. **Balance**: Keep damage/healing values reasonable (5-20 range)
2. **MP Costs**: Higher costs for more powerful effects (5-20 range)
3. **Attributes**: Use appropriate attributes for theme
4. **Dark Attribute**: Remember 암 causes instant death with any damage ≥1
5. **Light Attribute**: Remember 光 cannot be defended normally
6. **Combos**: Combine multiple ops for interesting effects
7. **Conditions**: Use `if` and `random` for dynamic gameplay
8. **Clarity**: Write clear text descriptions matching DSL
