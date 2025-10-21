// Bot deck configuration for solo play
// 천계 덱 (Heavenly Deck) for bot players

export const BOT_DECK = [
  // Weapons (무기)
  {
    name: "천계의 검",
    cardType: "weapon",
    attribute: "光",
    text: "빛의 힘이 깃든 신성한 검. 광속성 공격으로 방어를 무시한다.",
    stats: {
      attack: 12,
      durability: 3
    },
    dsl: [
      { op: "damage", amount: 12, attribute: "光", target: "enemy" }
    ]
  },
  {
    name: "화염의 창",
    cardType: "weapon",
    attribute: "火",
    text: "불꽃이 타오르는 창. 강력한 화속성 피해를 입힌다.",
    stats: {
      attack: 10,
      durability: 2
    },
    dsl: [
      { op: "damage", amount: 10, attribute: "火", target: "enemy" }
    ]
  },
  {
    name: "얼음의 단검",
    cardType: "weapon",
    attribute: "水",
    text: "얼음처럼 차가운 단검. 적을 얼려버린다.",
    stats: {
      attack: 8,
      durability: 2
    },
    dsl: [
      { op: "damage", amount: 8, attribute: "水", target: "enemy" }
    ]
  },
  
  // Armor (방어구)
  {
    name: "천계의 방패",
    cardType: "armor",
    attribute: "無",
    text: "신들의 축복이 깃든 방패. 강력한 방어력을 제공한다.",
    stats: {
      defense: 8
    },
    dsl: [
      { op: "modify_stat", target_stat: "hp", amount: 5, target: "caster" }
    ]
  },
  {
    name: "성스러운 갑옷",
    cardType: "armor",
    attribute: "光",
    text: "빛으로 만들어진 갑옷. 피해를 막아준다.",
    stats: {
      defense: 6
    },
    dsl: [
      { op: "heal", amount: 3, target_stat: "hp", target: "caster" }
    ]
  },
  
  // Items (잡화)
  {
    name: "생명의 물약",
    cardType: "item",
    attribute: "無",
    text: "체력을 회복시켜주는 신비한 물약.",
    stats: {},
    dsl: [
      { op: "heal", amount: 15, target_stat: "hp", target: "caster" }
    ]
  },
  {
    name: "마나의 결정",
    cardType: "item",
    attribute: "無",
    text: "마력을 회복시켜주는 푸른 결정.",
    stats: {},
    dsl: [
      { op: "heal", amount: 10, target_stat: "mp", target: "caster" }
    ]
  },
  
  // Miracles (기적)
  {
    name: "천벌",
    cardType: "miracle",
    attribute: "光",
    text: "하늘에서 내려오는 신의 심판. 강력한 광속성 피해를 입힌다.",
    stats: {
      mpCost: 8
    },
    dsl: [
      { op: "damage", amount: 15, attribute: "光", target: "enemy" }
    ]
  },
  {
    name: "치유의 기적",
    cardType: "miracle",
    attribute: "無",
    text: "신의 은총으로 상처를 치유한다.",
    stats: {
      mpCost: 5
    },
    dsl: [
      { op: "heal", amount: 20, target_stat: "hp", target: "caster" }
    ]
  },
  {
    name: "암흑의 저주",
    cardType: "miracle",
    attribute: "暗",
    text: "어둠의 힘으로 적을 저주한다. 암속성 피해는 즉사를 유발한다.",
    stats: {
      mpCost: 10
    },
    dsl: [
      { op: "damage", amount: 5, attribute: "暗", target: "enemy" }
    ]
  }
];

// Bot Shin (신) configuration
export const BOT_SHIN = {
  name: "천계의 수호자",
  description: "천계를 지키는 강력한 신. 빛과 어둠의 균형을 유지한다.",
  uniqueMiracles: [
    {
      name: "신성한 보호막",
      cardType: "miracle",
      attribute: "光",
      text: "신성한 빛으로 자신을 보호하여 체력과 마력을 동시에 회복한다.",
      stats: {
        mpCost: 6
      },
      dsl: [
        { op: "heal", amount: 12, target_stat: "hp", target: "caster" },
        { op: "heal", amount: 5, target_stat: "mp", target: "caster" }
      ]
    },
    {
      name: "심판의 낙뢰",
      cardType: "miracle",
      attribute: "光",
      text: "하늘에서 낙뢰를 떨어뜨려 적에게 강력한 피해를 입힌다.",
      stats: {
        mpCost: 12
      },
      dsl: [
        { op: "damage", amount: 25, attribute: "光", target: "enemy" }
      ]
    }
  ]
};

// Bot AI difficulty levels
export const BOT_DIFFICULTY = {
  EASY: {
    name: "쉬움",
    thinkDelay: 2000, // 2초 대기
    errorRate: 0.3, // 30% 실수 확률
    aggression: 0.3 // 30% 공격 성향
  },
  NORMAL: {
    name: "보통",
    thinkDelay: 1500,
    errorRate: 0.15,
    aggression: 0.5
  },
  HARD: {
    name: "어려움",
    thinkDelay: 1000,
    errorRate: 0.05,
    aggression: 0.7
  }
};
