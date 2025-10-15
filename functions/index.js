// functions/index.js
import { initializeApp } from "firebase-admin/app";
initializeApp(); // 앱을 가장 먼저 초기화합니다.

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { HttpsError } from "firebase-functions/v1/https";
import { z } from "zod";
import fetch from "cross-fetch";

import { playCard, react, endTurn } from "./src/actions.js";
import { processStack } from "./src/engine.js";

const db = getFirestore();

const GEMINI_API_KEY = functions.params.defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-1.5-flash";
const DAILY_CARD_LIMIT = 150; // 테스트를 위해 제한을 150으로 상향 조정
const DAILY_CHAR_LIMIT = 30;  // 캐릭터 제한도 함께 상향

// --- Zod 스키마 정의 ---
const ValueOrExpr = z.union([z.number().int(), z.string(), z.object({ expr: z.string() })]);

// 새로운 전투 기믹(Op)들을 대거 추가했습니다.
const Op = z.lazy(() => z.discriminatedUnion("op", [
  // 기본 Op
  z.object({ op:z.literal("damage"), amount:ValueOrExpr.refine(v => (typeof v !== 'number' || v <= 20), {message: "Damage cannot exceed 20."}), target:z.string(),
    onHit: z.array(Op).optional() // 피격 시 발동 효과
  }),
  z.object({ op:z.literal("shield"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("heal"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("draw"), count:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("discard"), count:ValueOrExpr, from:z.string(), target:z.string() }),
  z.object({ op:z.literal("addMarker"), name:z.string(), turns:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("if"), cond:z.string(), then:z.array(Op), else:z.array(Op).optional() }),
  z.object({ op:z.literal("random"), chance:z.number().min(0).max(1), then:z.array(Op), else:z.array(Op).optional() }), // 확률 기반 효과

  // 신규 추가된 특수 기믹 Op
  z.object({ op:z.literal("lifesteal"), amount:ValueOrExpr.refine(v => (typeof v !== 'number' || v <= 20)), target:z.string() }), // 흡혈
  z.object({ op:z.literal("reflect"), chance:z.number().min(0).max(1), multiplier: z.number().min(0) }), // 피해 반사
  z.object({ op:z.literal("addModifier"), type:z.enum(["damage_boost"]), value:ValueOrExpr, turns:z.number().int() }), // 피해 증폭 등
  z.object({ op:z.literal("execute"), target:z.string(), condition: z.string() }), // 즉사
  z.object({ op:z.literal("onDeath"), actions:z.array(Op) }) // 동귀어진 등
]));
// z.lazy()로 감싸진 스키마의 내부 옵션에 접근하기 위해 .schema를 추가합니다.
const validOps = new Set(Op.schema.options.map(o => o.shape.op.value));


const SkillSchema = z.object({
    name: z.string(),
    cost: z.number().int().min(0).max(10),
    text: z.string(),
    dsl: z.array(Op)
});

// 새로운 스탯 시스템을 Zod 스키마에 반영했습니다.
const CharacterSchema = z.object({
    id: z.string(),
    ownerUid: z.string(),
    name: z.string(),
    attribute: z.enum(["fire", "water", "wind", "earth", "light", "dark", "neutral"]),
    hp: z.number().int().min(20).max(70),
    maxKi: z.number().int().min(5).max(15),
    kiRegen: z.number().int().refine(v => v === 2 || v === 3), // 코스트 회복량
    skills: z.array(SkillSchema).length(3),
    status: z.enum(["pending", "approved", "blocked"]).default("pending"),
    meta: z.any(),
    createdAt: z.any(),
}).refine(data => (data.hp) + (data.maxKi * 4) + (data.kiRegen === 3 ? 20 : 0) === 100, {
    message: "Stat points must sum up to 100.",
    path: ["hp", "maxKi", "kiRegen"],
});

const CardSchema = z.object({
  id: z.string(),
  ownerUid: z.string(),
  name: z.string().min(1),
  type: z.enum(["skill", "spell", "attachment", "reaction"]),
  rarity: z.enum(["normal","rare","epic","legend"]),
  attribute: z.enum(["fire","water","wind","earth","light","dark","neutral"]),
  keywords: z.array(z.string()).max(4),
  cost: z.number().int().min(0),
  cooldownTurns: z.number().int().min(0).default(0), // AI가 자주 누락하여 기본값 추가
  dsl: z.array(Op).min(1).max(10),
  text: z.string(),
  checks: z.object({
    banned: z.boolean(),
    version: z.number().int(),
    validatorScore: z.number(),
    errors: z.array(z.string()).default([]),
  }),
  status: z.enum(["pending","approved","blocked"]).default("pending"),
  meta: z.object({
    model: z.string().optional(),
    temperature: z.number().optional()
  }).optional(),
  createdAt: z.any(),
});

const GenCardReqSchema = z.object({
  prompt: z.string().min(5).max(150),
  powerCap: z.number().int().min(1).max(20).default(10),
  temperature: z.number().min(0).max(1).default(0.8)
});


// --- Gemini API 호출 헬퍼 ---
async function callGemini(system, user, temperature, apiKey){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role:"user", parts:[{ text:`[SYSTEM]\n${system}\n\n[USER]\n${user}` }] }],
    generationConfig: { temperature, responseMimeType: "application/json" }
  };
  const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if(!res.ok){ throw new Error(`Gemini error: ${res.status} ${await res.text()}`); }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
const text = parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("");
return text;

}


// --- 모델 출력 가드/정규화 헬퍼 ---
function extractFirstJsonObject(text) {
  // 1) 코드블록 틀어막기: ```json, ``` 제거
  const t = String(text || "").replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
  // 2) 가장 바깥 { ... } 잡아오기 (대충이지만 실전에서 잘 동작)
  const start = t.indexOf('{');
  if (start === -1) throw new Error('No JSON object found.');
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
      return t.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced JSON braces.');
}

// ANCHOR: functions/index.js (normalizeDslOps with target fix)
function normalizeDslOps(dsl) {
  if (!Array.isArray(dsl)) return [];

  const opCorrections = {
    'damageEnemy': 'damage',
    'dealDamage': 'damage',
    'addShield': 'shield',
    'restoreHealth': 'heal',
    'drawCard': 'draw',
    'discardCard': 'discard',
    'applyMarker': 'addMarker',
    'addStatus': 'addMarker',
    'conditional': 'if',
  };
  
  // 'target'이 필수인 op 목록
  const opsRequiringTarget = new Set(['damage', 'shield', 'heal', 'draw', 'discard', 'addMarker', 'lifesteal', 'execute']);

  const normalized = dsl.map(op => {
    if (!op || typeof op !== 'object' || !op.op) return null;

    // 1. 잘못된 op 이름 교정
    if (opCorrections[op.op]) {
      op.op = opCorrections[op.op];
    }
    
    // 2. 유효하지 않은 op는 필터링
    if (!validOps.has(op.op)) {
        console.warn(`Filtering out invalid op: ${op.op}`);
        return null;
    }

    // 3. 필드 이름 및 값 교정
    if (op.op === 'draw' && 'amount' in op) {
      op.count = op.amount;
      delete op.amount;
    }
    if (op.op === 'addMarker') {
      if ('duration' in op) {
        op.turns = op.duration;
        delete op.duration;
      }
      if (!('turns' in op)) op.turns = 1;
    }
    
    // 4. target이 없는 경우 기본값 부여 (핵심 수정)
    if (opsRequiringTarget.has(op.op) && !op.target) {
        // 피해를 주는 효과는 'enemy', 이로운 효과는 'caster'를 기본값으로 설정
        if (op.op === 'damage' || op.op === 'lifesteal' || op.op === 'execute') {
            op.target = 'enemy';
        } else {
            op.target = 'caster';
        }
        console.warn(`Missing target for op '${op.op}', defaulting to '${op.target}'`);
    }


    // 5. 재귀적으로 내부 DSL 처리
    if (op.onHit) op.onHit = normalizeDslOps(op.onHit);
    if (op.then) op.then = normalizeDslOps(op.then);
    if (op.else) op.else = normalizeDslOps(op.else);
    if (op.actions) op.actions = normalizeDslOps(op.actions);
    
    return op;
  }).filter(Boolean); // null 값을 제거하여 최종 배열 생성

  return normalized;
}


function normalizeAttribute(obj) {
  // 혹시 모델이 한글 속성으로 낼 때 대비(실전에서 종종 생김)
  const map = { 불:"fire", 물:"water", 바람:"wind", 흙:"earth", 빛:"light", 어둠:"dark", 무:"neutral", 무속성:"neutral" };
  if (typeof obj.attribute === 'string' && map[obj.attribute]) obj.attribute = map[obj.attribute];
}

function sanitizeCard(card) {
  // 기본값 강제: cooldownTurns 없으면 0
  if (typeof card.cooldownTurns !== 'number') card.cooldownTurns = 0;
  // keywords가 문자열 하나로 올 때 배열화
  if (typeof card.keywords === 'string') card.keywords = [card.keywords];
  normalizeAttribute(card);
  card.dsl = normalizeDslOps(card.dsl);
  return card;
}

function sanitizeCharacter(ch) {
  normalizeAttribute(ch);
  for (const s of ch.skills || []) {
    s.dsl = normalizeDslOps(s.dsl);
  }
  return ch;
}



// --- 캐릭터 생성 함수 ---
export const genCharacter = functions
  .region("asia-northeast3")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const uid = context.auth.uid;

    const profileRef = db.doc(`profiles/${uid}`);
    await db.runTransaction(async (tx) => {
        const profileSnap = await tx.get(profileRef);
        const today = new Date().toISOString().slice(0, 10);
        let count = 0;
        if (profileSnap.exists) {
            const d = profileSnap.data();
            if (d.lastCharCreationDate === today) count = d.charCreationCount || 0;
        }
        if (count >= DAILY_CHAR_LIMIT) {
            throw new HttpsError("resource-exhausted", `오늘 캐릭터 생성 제한(${DAILY_CHAR_LIMIT}개)을 모두 사용했습니다.`);
        }
        tx.set(profileRef, { lastCharCreationDate: today, charCreationCount: count + 1 }, { merge: true });
    });

    const { prompt, temperature } = z.object({ prompt: z.string().min(5).max(150), temperature: z.number().min(0).max(1) }).parse(data);
    const apiKey = GEMINI_API_KEY.value();
    
const system =
`당신은 천재적인 TCG 카드 게임 디자이너입니다. 사용자의 아이디어를 받아, 게임의 룰과 밸런스를 완벽하게 이해하고 창의적인 캐릭터를 JSON 형식으로 디자인해야 합니다.

[게임 기본 규칙]
- 이 게임은 2~8명이 함께하는 갓필드 스타일의 다자간 배틀입니다.
- 모든 플레이어가 제출한 카드를 섞어 만든 '공용 덱'을 사용합니다.
- 모든 플레이어는 HP 20으로 시작하며, 마지막까지 생존하는 것이 목표입니다.
- '기력(ki)'은 카드를 사용하는 자원이며, 매 턴 2 또는 3씩 회복됩니다. (kiRegen)
- 손패는 기본 3장으로 시작하며, 매 턴 1장씩 뽑습니다.
- 상대의 행동에 '반응(reaction)' 타입 카드로 대응할 수 있습니다.

[당신의 임무]
1.  **사용자 프롬프트 해석**: 사용자의 아이디어를 핵심 컨셉으로 삼아 캐릭터를 구체화합니다.
2.  **밸런스 설계**: 'CP(캐릭터 포인트) 규칙'을 반드시 준수하여 스탯을 분배합니다. HP가 높으면 다른 능력이 낮아져야 합니다.
3.  **스킬 디자인**: 3개의 고유 스킬을 만듭니다. 각 스킬은 이름, 기력 비용(cost), 효과 설명(text), 그리고 실제 게임 엔진이 이해할 수 있는 DSL 코드로 구성됩니다. 다자간 전투(FFA) 환경을 고려하여, 여러 명의 적 또는 아군에게 영향을 주는 창의적인 효과를 디자인할 수 있습니다.
4.  **엄격한 JSON 출력**: 어떤 상황에서도 설명, 주석, 코드 블록 라벨 없이 오직 순수한 JSON 객체 하나만 출력해야 합니다.

[출력 계약: JSON 형식]
- **최상위**: 단 하나의 JSON 객체.
- **필수 키**: 
  - \`name\`: (string) 캐릭터 이름.
  - \`attribute\`: (string) "fire", "water", "wind", "earth", "light", "dark", "neutral" 중 하나.
  - \`hp\`: (int) 20~70 사이.
  - \`maxKi\`: (int) 5~15 사이.
  - \`kiRegen\`: (int) 2 또는 3만 가능.
  - \`skills\`: (배열) 정확히 3개의 스킬 객체를 포함.
    - 각 스킬: \`{name, cost, text, dsl}\` 형식을 따름.
- **CP 규칙 (절대 준수)**: \`(hp) + (maxKi * 4) + (kiRegen === 3 ? 20 : 0) === 100\`
- **DSL 규칙 (스킬 효과 정의)**:
  - \`op\`: "damage", "shield", "heal", "draw", "discard", "addMarker", "if", "random", "lifesteal" 등 유효한 op 코드.
  - \`target\`: "caster"(시전자), "enemy"(선택한 적 1명)을 기본으로 사용. 향후 "all_enemies"(모든 적), "all_players"(모든 플레이어), "random_enemy"(무작위 적) 등 광역 타겟도 구상 가능합니다.
  - \`damage\`, \`lifesteal\`의 \`amount\`는 **최대 20**을 넘을 수 없습니다.
  - \`random\`: \`{ op:"random", chance: 0.5, then: [...], else: [...] }\` 형식으로 50% 확률 효과를 구현.
  - \`addMarker\`: 부여할 수 있는 상태 이상. \`name\`은 "취약", "강화", "독", "재생", "침묵", "도발", "빙결", "속박", "출혈", "실명" 중에서만 선택.

[나쁜 예시 (절대 금지)]
- JSON 앞뒤에 설명 붙이기: \`// 생성된 캐릭터입니다.\n{...}\`
- 코드 블록 사용: \`\`\`json\n{...}\n\`\`\`
- CP 규칙 위반: \`"hp": 70, "maxKi": 15, "kiRegen": 3\` -> 70 + 60 + 20 = 150 (규칙 위반)
- 잘못된 DSL: \`{ op: "makeStrong", amount: 999 }\` -> 'makeStrong'은 유효하지 않은 op.

[좋은 예시]
{
  "name": "서리방패 아이기스",
  "attribute": "water",
  "hp": 60,
  "maxKi": 10,
  "kiRegen": 2,
  "skills": [
    {
      "name": "혹한의 일격",
      "cost": 3,
      "text": "적 하나에게 6의 피해를 주고 1턴간 '빙결' 표식을 부여합니다.",
      "dsl": [
        { "op": "damage", "target": "enemy", "amount": 6 },
        { "op": "addMarker", "target": "enemy", "name": "빙결", "turns": 1 }
      ]
    },
    {
      "name": "빙하의 보루",
      "cost": 2,
      "text": "자신에게 8의 보호막을 부여합니다.",
      "dsl": [ { "op": "shield", "target": "caster", "amount": 8 } ]
    },
    {
      "name": "겨울의 송곳니",
      "cost": 4,
      "text": "적 하나에게 5의 흡혈 피해를 줍니다. 대상이 '빙결' 상태라면, 추가로 2의 피해를 줍니다.",
      "dsl": [
        { "op": "lifesteal", "target": "enemy", "amount": 5 },
        { "op": "if", "cond": "enemy.has('빙결')", "then":[{ "op": "damage", "target": "enemy", "amount": 2 }] }
      ]
    }
  ]
}`;

    const user = `{ "prompt": "${prompt}", "power": 20 }`;
    let rawJson = await callGemini(system, user, temperature, apiKey);
let jsonText = extractFirstJsonObject(rawJson);

try {
  const charData = sanitizeCharacter(JSON.parse(jsonText));
  const newCharRef = db.collection("userCharacters").doc();
  const finalCharacter = {
    ...charData,
    id: newCharRef.id,
    ownerUid: uid,
    status: "pending",
    meta: { model: GEMINI_MODEL, temperature: temperature },
    createdAt: FieldValue.serverTimestamp()
  };
  CharacterSchema.parse(finalCharacter);
  await newCharRef.set(finalCharacter);
  return { ok: true, character: finalCharacter };
} catch (e) {
  console.error("Character generation error:", e, {rawJson});
  const errorMessage = e.errors?.[0]?.message || "AI가 유효하지 않은 형식의 캐릭터를 생성했습니다.";
  throw new HttpsError("internal", errorMessage, { raw: rawJson });
}

});


// --- 카드 생성 함수 ---
export const genCard = functions
  .region("asia-northeast3")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const uid = context.auth.uid;
    const apiKey = GEMINI_API_KEY.value();
    const params = GenCardReqSchema.parse(data);

    const profileRef = db.doc(`profiles/${uid}`);
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const today = new Date().toISOString().slice(0, 10);
      let count = 0;
      if (profileSnap.exists) {
        const profileData = profileSnap.data();
        if (profileData.lastCardCreationDate === today) {
          count = profileData.cardCreationCount || 0;
        }
      }
      if (count >= DAILY_CARD_LIMIT) {
        throw new HttpsError("resource-exhausted", `오늘 카드 생성 제한(${DAILY_CARD_LIMIT}장)을 모두 사용했습니다.`);
      }
      tx.set(profileRef, {
        lastCardCreationDate: today,
        cardCreationCount: count + 1
      }, { merge: true });
    });

const system =
`당신은 천재적인 TCG 카드 게임 디자이너입니다. 사용자의 아이디어를 받아, 게임의 룰과 밸런스를 완벽하게 이해하고 창의적인 카드를 JSON 형식으로 디자인해야 합니다.

[게임 기본 규칙]
- 이 게임은 2~8명이 함께하는 갓필드 스타일의 다자간 배틀입니다.
- 모든 플레이어가 제출한 카드를 섞어 만든 '공용 덱'을 사용합니다.
- 모든 플레이어는 HP 20으로 시작하며, 마지막까지 생존하는 것이 목표입니다.
- '기력(ki)'은 카드를 사용하는 자원이며, 매 턴 2 또는 3씩 회복됩니다.
- 손패는 기본 3장으로 시작하며, 매 턴 1장씩 뽑습니다.
- 상대의 행동에 '반응(reaction)' 타입 카드로 대응할 수 있습니다.

[당신의 임무]
1.  **사용자 프롬프트 해석**: 사용자의 아이디어를 핵심 컨셉으로 삼아 카드를 구체화합니다.
2.  **밸런스 설계**: 카드의 비용(cost), 희귀도(rarity), 효과(dsl)를 종합적으로 고려하여 균형을 맞춥니다. 비용이 높을수록 강력한 효과를 가져야 합니다. 공용 덱 환경을 고려하여 특정 카드나 속성에 과도하게 의존하지 않는 범용적으로 유용한 카드를 디자인하세요.
3.  **카드 타입 결정**: 효과에 가장 적합한 타입을 지정합니다. 다자간 전투(FFA) 환경을 고려하여, 여러 명의 적 또는 아군에게 영향을 주는 창의적인 효과를 디자인할 수 있습니다.
    - \`skill\`, \`spell\`: 일반적인 행동 카드.
    - \`attachment\`: 특정 대상에게 지속 효과를 부여하는 카드.
    - \`reaction\`: 상대 턴에 특정 조건 하에 발동하는 방어/대응 카드.
4.  **엄격한 JSON 출력**: 어떤 상황에서도 설명, 주석, 코드 블록 라벨 없이 오직 순수한 JSON 객체 하나만 출력해야 합니다.

[출력 계약: JSON 형식]
- **최상위**: 단 하나의 JSON 객체.
- **필수 키**:
  - \`name\`: (string) 카드 이름.
  - \`type\`: (string) "skill", "spell", "attachment", "reaction" 중 하나.
  - \`rarity\`: (string) "normal", "rare", "epic", "legend" 중 하나.
  - \`attribute\`: (string) "fire", "water", "wind", "earth", "light", "dark", "neutral" 중 하나.
  - \`keywords\`: (string 배열) 카드의 특징을 나타내는 키워드 (예: "광역", "조건부", "드로우"). 최대 4개.
  - \`cost\`: (int) 0 이상의 정수.
  - \`cooldownTurns\`: (int) 0 이상의 정수.
  - \`text\`: (string) 카드 효과를 자연어로 설명. DSL과 내용이 일치해야 함.
  - \`dsl\`: (배열) 게임 엔진이 이해하는 효과 코드. 1~10개의 op 객체를 포함.
- **DSL 규칙**:
  - \`op\`: "damage", "shield", "heal", "draw", "discard", "addMarker", "if", "random", "lifesteal" 등 유효한 op 코드.
  - \`target\`: "caster"(시전자), "enemy"(선택한 적 1명)을 기본으로 사용. 향후 "all_enemies"(모든 적), "all_players"(모든 플레이어), "random_enemy"(무작위 적) 등 광역 타겟도 구상 가능합니다.
  - \`damage\`, \`lifesteal\`의 \`amount\`는 **최대 20**을 넘을 수 없습니다.
  - \`random\`: \`{ op:"random", chance: 0.5, then: [...], else: [...] }\` 형식으로 50% 확률 효과를 구현.
  - \`addMarker\`: 부여할 수 있는 상태 이상. \`name\`은 "취약", "강화", "독", "재생", "침묵", "도발", "빙결", "속박", "출혈", "실명" 중에서만 선택.

[좋은 예시]
{
  "name": "재빠른 반격",
  "type": "reaction",
  "rarity": "rare",
  "attribute": "neutral",
  "keywords": ["반응", "드로우"],
  "cost": 1,
  "cooldownTurns": 2,
  "text": "내가 피해를 받을 때, 그 피해를 2 감소시키고 카드 1장을 뽑습니다.",
  "dsl": [
    { "op": "shield", "target": "caster", "amount": 2 },
    { "op": "draw", "target": "caster", "count": 1 }
  ]
}`;


    const user = `{ "prompt": "${params.prompt}", "powerCap": ${params.powerCap} }`;

    let rawJson = await callGemini(system, user, params.temperature, apiKey);
let jsonText = extractFirstJsonObject(rawJson);

let cardData;
try {
  cardData = sanitizeCard(JSON.parse(jsonText));
} catch (e) {
  console.error("Model response is not valid JSON:", rawJson);
  throw new HttpsError("internal", "AI 모델이 유효한 JSON을 생성하지 못했습니다.", {raw: rawJson});
}

    try {
      const newCardRef = db.collection("userCards").doc();
      const newCardId = newCardRef.id;
      const score = (cardData.dsl?.length || 1) * 2 + (cardData.cost || 0) * 1.5;
      
      const finalCard = {
        ...cardData,
        id: newCardId,
        ownerUid: uid,
        checks: { banned: false, version: 1, validatorScore: score, errors: [] },
        status: "pending",
        meta: { model: GEMINI_MODEL, temperature: params.temperature },
        createdAt: FieldValue.serverTimestamp()
      };
      
      CardSchema.parse(finalCard);
      await newCardRef.set(finalCard);
      return { ok: true, card: finalCard };

    } catch (e) {
      console.warn("Skipping invalid card from model:", cardData, e.issues);
      const errorMessage = e.errors?.[0]?.message ? `${e.errors[0].path.join('.')} - ${e.errors[0].message}` : "AI가 유효하지 않은 형식의 카드를 생성했습니다.";
      throw new HttpsError("internal", errorMessage, { raw: rawJson });
    }
});


// ===================================
// ===== 전투 액션 함수들 (HTTPS) =====
// ===================================
export const apiPlayCard = functions.region("asia-northeast3").https.onCall(playCard);
export const apiReact = functions.region("asia-northeast3").https.onCall(react);
export const apiEndTurn = functions.region("asia-northeast3").https.onCall(endTurn);


// ============================================
// ===== 핵심 엔진 트리거 (Firestore Trigger) =====
// ============================================
/**
 * reaction phase가 끝난 후, resolve phase가 되면 자동으로 스택을 처리하는 트리거
 */
export const onResolvePhase = functions.firestore
    .document('matches/{matchId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        // phase가 'resolve'로 변경되었을 때만 실행
        if (before.phase !== 'resolve' && after.phase === 'resolve') {
            console.log(`[${context.params.matchId}] 스택 처리 시작...`);
            
            const { newState, logs } = processStack(after);

// logs가 없을 때 arrayUnion 호출 회피
const updateLogs = (logs && logs.length > 0)
  ? { logs: FieldValue.arrayUnion(...logs) }
  : {};

await change.after.ref.update({
  ...newState,
  ...updateLogs,
  phase: 'end'
});
        }
    });


/**
 * reaction phase가 시작되면 7초 후에 resolve로 변경하는 스케줄링 함수 (간단한 버전)
 * 실제 프로덕션에서는 Cloud Tasks 등을 사용하는 것이 더 안정적입니다.
 */
export const scheduleResolve = functions.firestore
    .document('matches/{matchId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        if (before.phase !== 'reaction' && after.phase === 'reaction') {
            const matchId = context.params.matchId;
            // 7초 대기
            await new Promise(resolve => setTimeout(resolve, 7000));
            
            const matchRef = db.doc(`matches/${matchId}`);
            // 7초 후에도 여전히 reaction phase인지 확인하고 resolve로 변경
            const currentDoc = await matchRef.get();
            if (currentDoc.exists && currentDoc.data().phase === 'reaction') {
                await matchRef.update({ phase: 'resolve' });
            }
        }
    });




// ===========================================
// ===== 새로운 방/게임 관리 함수들 =====
// ===========================================

const RoomSchema = z.object({
    title: z.string().min(2).max(20),
    maxPlayers: z.number().int().min(2).max(8),
});

/**
 * 방 생성 함수
 */
export const createRoom = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const { uid } = context.auth;
        const { title, maxPlayers } = RoomSchema.parse(data);

        const profileSnap = await db.doc(`profiles/${uid}`).get();
        const nickname = profileSnap.data()?.nickname;
        if (!nickname) throw new HttpsError("failed-precondition", "닉네임이 설정되지 않았습니다.");

        // 현재 다른 방에 참여중인지 확인
        const existingRooms = await db.collection('rooms').where('playerUids', 'array-contains', uid).get();
        if (!existingRooms.empty) {
            throw new HttpsError('already-exists', '이미 다른 방에 참여중입니다. 해당 방을 먼저 나와주세요.');
        }

        const roomRef = db.collection('rooms').doc();
        const newRoom = {
            title,
            maxPlayers,
            hostUid: uid,
            hostNickname: nickname,
            status: "waiting",
            playerCount: 1,
            playerUids: [uid], // 플레이어 uid 목록 추가
            players: [{ 
                uid, 
                nickname, 
                isHost: true, 
                ready: false,
                characterId: null,
                selectedCardIds: [],
                selectedSkills: [],
            }],
            createdAt: FieldValue.serverTimestamp(),
        };

        await roomRef.set(newRoom);
        return { ok: true, roomId: roomRef.id };
    });

/**
 * 플레이어 준비 및 선택 사항 업데이트 함수
 */
const SetPlayerReadySchema = z.object({
    roomId: z.string(),
    characterId: z.string().optional(),
    selectedCardIds: z.array(z.string()).min(5).max(10).optional(),
    selectedSkills: z.array(z.string()).length(2).optional(),
    ready: z.boolean(),
});

export const joinRoom = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const { uid } = context.auth;
        const { roomId } = z.object({ roomId: z.string() }).parse(data);

        const profileSnap = await db.doc(`profiles/${uid}`).get();
        const nickname = profileSnap.data()?.nickname;
        if (!nickname) throw new HttpsError("failed-precondition", "닉네임이 설정되지 않았습니다.");

        const roomRef = db.doc(`rooms/${roomId}`);

        return await db.runTransaction(async (tx) => {
            const roomSnap = await tx.get(roomRef);
            if (!roomSnap.exists) throw new HttpsError("not-found", "존재하지 않는 방입니다.");
            
            const roomData = roomSnap.data();
            if (roomData.status !== 'waiting') throw new HttpsError("failed-precondition", "이미 시작되었거나 종료된 방입니다.");
            if (roomData.playerUids.includes(uid)) {
                console.log(`Player ${uid} is already in room ${roomId}. Proceeding.`);
                return { ok: true, message: "이미 참여한 방입니다." };
            }
            if (roomData.playerCount >= roomData.maxPlayers) throw new HttpsError("resource-exhausted", "방이 가득 찼습니다.");

            const newPlayer = {
                uid,
                nickname,
                isHost: false,
                ready: false,
                characterId: null,
                selectedCardIds: [],
                selectedSkills: [],
            };

            tx.update(roomRef, {
                players: FieldValue.arrayUnion(newPlayer),
                playerUids: FieldValue.arrayUnion(uid),
                playerCount: FieldValue.increment(1),
            });

            return { ok: true };
        });
    });



export const setPlayerReady = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const { uid } = context.auth;
        const { roomId, characterId, selectedCardIds, selectedSkills, ready } = SetPlayerReadySchema.parse(data);

        const roomRef = db.doc(`rooms/${roomId}`);

        return await db.runTransaction(async (tx) => {
            const roomSnap = await tx.get(roomRef);
            if (!roomSnap.exists) throw new HttpsError("not-found", "방을 찾을 수 없습니다.");
            
            const roomData = roomSnap.data();
            const playerIndex = roomData.players.findIndex(p => p.uid === uid);
            if (playerIndex === -1) throw new HttpsError("not-found", "플레이어를 찾을 수 없습니다.");

            const player = roomData.players[playerIndex];
            player.ready = ready;
            if (ready) {
                if (!characterId || !selectedCardIds || !selectedSkills) {
                    throw new HttpsError("invalid-argument", "준비 상태를 완료하려면 캐릭터, 카드, 스킬을 모두 선택해야 합니다.");
                }
                player.characterId = characterId;
                player.selectedCardIds = selectedCardIds;
                player.selectedSkills = selectedSkills;
            }

            tx.update(roomRef, { players: roomData.players });
            return { ok: true };
        });
    });


/**
 * 게임 시작 함수
 */
export const startGame = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const { uid } = context.auth;
        const { roomId } = z.object({ roomId: z.string() }).parse(data);

        const roomRef = db.doc(`rooms/${roomId}`);
        const matchRef = db.collection('matches').doc();

        await db.runTransaction(async (tx) => {
            const roomSnap = await tx.get(roomRef);
            if (!roomSnap.exists) throw new HttpsError("not-found", "방을 찾을 수 없습니다.");
            
            const roomData = roomSnap.data();
            if (roomData.hostUid !== uid) throw new HttpsError("permission-denied", "방장만 게임을 시작할 수 있습니다.");
            if (roomData.status !== 'waiting') throw new HttpsError("failed-precondition", "게임이 이미 시작되었거나 종료되었습니다.");
            if (roomData.players.length < 2) throw new HttpsError("failed-precondition", "최소 2명 이상의 플레이어가 필요합니다.");
            if (!roomData.players.every(p => p.ready)) throw new HttpsError("failed-precondition", "모든 플레이어가 준비되지 않았습니다.");

            // 1. 모든 플레이어의 카드와 캐릭터 정보 가져오기
            const playerUids = roomData.players.map(p => p.uid);

            const cardPromises = roomData.players.map(p => db.collection('userCards').where('ownerUid', '==', p.uid).get());
            const charPromises = roomData.players.map(p => db.collection('userCharacters').where('ownerUid', '==', p.uid).get());
            
            const cardSnaps = await Promise.all(cardPromises);
            const charSnaps = await Promise.all(charPromises);

            const allCards = cardSnaps.flatMap(snap => snap.docs.map(d => d.data()));
            const allChars = charSnaps.flatMap(snap => snap.docs.map(d => d.data()));
            
            // 2. 공용 덱 생성 및 셔플
            let commonDeck = [];
            roomData.players.forEach(p => {
                const selected = new Set(p.selectedCardIds);
                commonDeck.push(...allCards.filter(c => selected.has(c.id)));
            });
            commonDeck.sort(() => Math.random() - 0.5); // 셔플

            // 3. 매치 플레이어 상태 초기화
            const matchPlayers = {};
            roomData.players.forEach(p => {
                const char = allChars.find(c => c.id === p.characterId);
                if (!char) throw new HttpsError("not-found", `${p.nickname}의 캐릭터(${p.characterId})를 찾을 수 없습니다.`);
                
                matchPlayers[p.uid] = {
                    uid: p.uid,
                    nickname: p.nickname,
                    hp: char.hp,
                    maxHp: char.hp,
                    ki: 5, // 시작 기력
                    maxKi: char.maxKi,
                    kiRegen: char.kiRegen,
                    hand: commonDeck.splice(0, 3), // 시작 손패 3장
                    skills: char.skills.filter(s => p.selectedSkills.includes(s.name)),
                    markers: [],
                    reactionUsedThisTurn: 0,
                };
            });

            // 4. 새로운 매치 문서 생성
            const newMatch = {
                roomId,
                status: "playing",
                turn: 1,
                currentPlayerUid: roomData.hostUid,
                phase: "main",
                stack: [],
                discardPile: [],
                logs: [],
                seed: Math.floor(Math.random() * 1e9),
                createdAt: FieldValue.serverTimestamp(),
                players: matchPlayers,
                commonDeck,
            };
            tx.set(matchRef, newMatch);

            // 5. 룸 상태 업데이트
            tx.update(roomRef, { status: "playing", matchId: matchRef.id });
        });
        
        return { ok: true, matchId: matchRef.id };
    });



/**
 * 빈 방 자동 삭제 (스케줄링)
 * 매 1시간마다 실행
 */
export const cleanupEmptyRooms = functions.pubsub.schedule('every 60 minutes').onRun(async (context) => {
    const roomsRef = db.collection('rooms');
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // 1시간이 지났고, 플레이어가 없는 방 조회
    const snapshot = await roomsRef.where('createdAt', '<=', oneHourAgo).where('playerCount', '==', 0).get();

    if (snapshot.empty) {
        console.log("삭제할 빈 방이 없습니다.");
        return null;
    }

    const batch = db.batch();
    snapshot.forEach(doc => {
        console.log(`삭제될 방: ${doc.id}`);
        batch.delete(doc.ref);
    });

    await batch.commit();
    return null;
});



/**
 * 카드 삭제 함수
 */
export const deleteCard = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const { uid } = context.auth;
        const { cardId } = z.object({ cardId: z.string() }).parse(data);

        const cardRef = db.doc(`userCards/${cardId}`);
        const cardSnap = await cardRef.get();

        if (!cardSnap.exists) {
            throw new HttpsError("not-found", "삭제할 카드를 찾을 수 없습니다.");
        }

        const cardData = cardSnap.data();
        if (cardData.ownerUid !== uid) {
            throw new HttpsError("permission-denied", "자신이 생성한 카드만 삭제할 수 있습니다.");
        }
        
        // 카드 상태가 'pending' 또는 'approved'일 때만 삭제 가능 (게임 중인 카드 등 보호)
        if (cardData.status !== 'pending' && cardData.status !== 'approved') {
             throw new HttpsError("failed-precondition", "현재 상태에서는 카드를 삭제할 수 없습니다.");
        }

        await cardRef.delete();

        return { ok: true };
    });


/**
 * 방 나가기 함수
 */
export const leaveRoom = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const { uid } = context.auth;
        const { roomId } = z.object({ roomId: z.string() }).parse(data);

        const roomRef = db.doc(`rooms/${roomId}`);

        await db.runTransaction(async (tx) => {
            const roomSnap = await tx.get(roomRef);
            if (!roomSnap.exists) return;

            const roomData = roomSnap.data();
            const players = roomData.players.filter(p => p.uid !== uid);

            if (players.length === 0) {
                // 마지막 플레이어가 나가면 방 삭제
                tx.delete(roomRef);
            } else {
                const updateData = {
                    players,
                    playerUids: FieldValue.arrayRemove(uid),
                    playerCount: FieldValue.increment(-1),
                };
                // 방장이 나갔을 경우, 다음 사람에게 방장 위임
                if (roomData.hostUid === uid) {
                    updateData.hostUid = players[0].uid;
                    updateData.hostNickname = players[0].nickname;
                    players[0].isHost = true;
                }
                tx.update(roomRef, updateData);
            }
        });

        return { ok: true };
    });
