// functions/index.js
import fetch from "cross-fetch";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { z } from "zod";

try { admin.initializeApp(); } catch (_) {}

import { defineSecret } from "firebase-functions/params";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ANCHOR: expression-schema
// 값 또는 동적 표현식을 위한 Zod 스키마
const ValueOrExpr = z.union([
  z.number().int(),
  z.string(),
  z.object({ expr: z.string() })
]);

// ---- Zod Schema: A Mini Programming Language for Card Effects ----
// ANCHOR: dsl-overhaul
const Op = z.lazy(() => z.union([
  // 기본 액션
  z.object({ op:z.literal("damage"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("heal"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("shield"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("draw"), count:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("discard"), count:ValueOrExpr, from:z.string(), target:z.string() }),
  z.object({ op:z.literal("addMarker"), name:z.string(), turns:ValueOrExpr, target:z.string() }),

  // 변수 및 제어 흐름
  z.object({ op:z.literal("setVar"), var:z.string(), value:ValueOrExpr }),
  z.object({ op:z.literal("if"), cond:z.string(), then:z.array(Op), else:z.array(Op).optional() }),
  z.object({ op:z.literal("forEach"), target:z.string(), loopVar:z.string(), actions:z.array(Op) }),

  // 대상 지정
  z.object({ op:z.literal("find"), type:z.string(), filters:z.array(z.string()), var:z.string() }),

  // 영구/지속 효과
  z.object({
    op: z.literal("addTrigger"),
    event: z.string(), // "onTurnStart", "onDamageTaken"
    actions: z.array(Op),
    target: z.string()
  }),
]));

const CardSchema = z.object({
  id: z.string().regex(/^card_auto_[a-z0-9-]+$/),
  ownerUid: z.string(),
  name: z.string().min(1),
  type: z.enum(["skill", "spell", "attachment"]), // type 확장
  rarity: z.enum(["normal","rare","epic","legend"]),
  attribute: z.enum(["fire","water","wind","earth","light","dark","neutral"]),
  keywords: z.array(z.string()).max(4),
  cost: z.number().int().min(0),
  cooldownTurns: z.number().int().min(0),
  dsl: z.array(Op).min(1).max(10), // dsl 최대 길이 증가
  text: z.string(),
  checks: z.object({
    banned: z.boolean(),
    version: z.number().int(),
    validatorScore: z.number(),
    errors: z.array(z.string()).default([]),
    expectedText: z.string().optional()
  }),
  status: z.enum(["pending","approved","blocked"]).default("pending"),
  meta: z.object({
    seed: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().optional()
  }).optional()
});

const ReqSchema = z.object({
  prompt: z.string().min(5).max(150),
  count: z.number().int().min(1).max(12).default(6),
  powerCap: z.number().int().min(1).max(20).default(10),
  seed: z.string().optional(),
  temperature: z.number().min(0).max(1).default(0.8)
});


// ---- helper: DSL Script → 한국어 규칙문 생성 (간소화된 버전) ----
// ANCHOR: dsl-text-simplification
// 복잡한 스크립트를 완벽히 번역하기는 어려우므로, 핵심 의도를 요약하는 방식으로 변경
function rulesTextFromDSL(dsl, depth = 0) {
  if (depth > 2) return "[복잡한 효과]";
  const seg = [];
  for (const step of dsl) {
    if (step.op === "damage") seg.push(`대상에게 ${JSON.stringify(step.amount)} 피해`);
    else if (step.op === "heal") seg.push(`대상에게 ${JSON.stringify(step.amount)} 회복`);
    else if (step.op === "shield") seg.push(`대상에게 ${JSON.stringify(step.amount)} 보호막`);
    else if (step.op === "draw") seg.push(`대상이 ${JSON.stringify(step.count)}장 드로우`);
    else if (step.op === "if") seg.push(`조건(${step.cond})이 맞으면...`);
    else if (step.op === "forEach") seg.push(`${step.target} 모두에게...`);
    else if (step.op === "addTrigger") seg.push(`'${step.event}' 발생 시...`);
    else seg.push(`${step.op} 효과`);
  }
  return seg.join(", ").substring(0, 100); // 텍스트 길이 제한
}


// ---- 간단 파워 점수 (스크립트 복잡도 반영) ----
// ANCHOR: score-card-complexity
function scoreCard(card) {
  let s = 0;
  function scoreOps(ops, multiplier = 1) {
    let currentScore = 0;
    for (const step of ops) {
      let opScore = 0;
      if (step.op === "damage") opScore = (typeof step.amount === 'number' ? step.amount : 3) * 0.5;
      else if (step.op === "heal") opScore = (typeof step.amount === 'number' ? step.amount : 3) * 0.45;
      else if (step.op === "shield") opScore = (typeof step.amount === 'number' ? step.amount : 3) * 0.4;
      else if (step.op === "draw") opScore = (typeof step.count === 'number' ? step.count : 1) * 2.0;
      else if (step.op === "if") opScore = 1.5 + scoreOps(step.then, 0.8) + scoreOps(step.else || [], 0.5);
      else if (step.op === "forEach") opScore = 1.2 * scoreOps(step.actions, 1.5); // 광역기는 점수 가중
      else if (step.op === "addTrigger") opScore = 5 + scoreOps(step.actions, 1.2); // 지속효과는 고비용
      else opScore = 1.0; // 기타
      currentScore += opScore;
    }
    return currentScore * multiplier;
  }
  s = scoreOps(card.dsl);
  s = s / (1 + card.cost * 0.5 + card.cooldownTurns * 0.3);
  return Math.round(s * 10) / 10;
}


// ---- Gemini 호출 ----
async function callGemini(system, user, temperature = 0.8, apiKey){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role:"user", parts:[{ text:`[SYSTEM]\n${system}\n\n[USER]\n${user}` }] }],
    generationConfig: { temperature, responseMimeType: "application/json" }
  };
  const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if(!res.ok){ throw new Error(`Gemini error: ${res.status} ${await res.text()}`); }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}


// ---- API: genCards ----
export const genCards = functions
  .region("us-central1")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "로그인이 필요해.");
    const apiKey = GEMINI_API_KEY.value();
    if(!apiKey) throw new functions.https.HttpsError("failed-precondition","GEMINI_API_KEY가 설정되지 않았어.");

  const params = ReqSchema.parse(data);

  // ANCHOR: system-prompt-overhaul
  const system =
`너는 천재 카드 게임 디자이너다. 사용자의 프롬프트를 해석하여, 아래에 정의된 '카드 효과 스크립트' 언어를 사용해 복잡하고 창의적인 카드 로직을 설계한다.
결과는 반드시 **JSON 배열** 형식으로만 출력해야 한다. 스키마를 완벽하게 준수하라.

[카드 효과 스크립트 언어 명세]
1.  **기본 구조**: 'dsl' 필드는 'Op' 객체들의 배열이다. 각 Op는 하나의 연산을 나타낸다.
2.  **값 또는 표현식(ValueOrExpr)**: amount, count 등의 필드에는 숫자(예: 5)나, 문자열(예: "someMarker"), 또는 동적 표현식 객체(예: {"expr": "caster.hp / 2"})를 사용할 수 있다.
    - 표현식 컨텍스트: caster(시전자), target(현재 대상), my(내 플레이어), enemy(상대 플레이어), vars(스크립트 내 변수)
3.  **Op 종류**:
    - **기본 액션**: damage, heal, shield, draw, discard, addMarker
    - **대상 지정**: {"op":"find", "type":"enemy", "filters":["hp < 10", "hasMarker('fire')"], "var":"weakEnemies"} -> 'weakEnemies' 변수에 결과 저장
    - **변수 할당**: {"op":"setVar", "var":"rollResult", "value":{"expr":"roll(6) + caster.attack"}}
    - **조건 분기**: {"op":"if", "cond":"vars.rollResult > 10", "then":[...], "else":[...]}
    - **반복**: {"op":"forEach", "target":"find.weakEnemies", "loopVar":"e", "actions":[{"op":"damage", "amount":5, "target":"loop.e"}]}
    - **지속 효과 부여**: {"op":"addTrigger", "event":"onTurnStart", "actions":[...], "target":"caster"}

[출력 JSON 스키마]
- id: "card_auto_" + slug
- ownerUid: "system"
- type: "skill" | "spell" | "attachment"
- dsl: 위 명세에 따른 Op 객체 배열. 1~10개.
- text: dsl 스크립트의 동작을 자연스러운 한국어 문장으로 설명. **가장 중요한 필드.**
- 기타 필드는 이전과 동일.

[제한 및 요구사항]
- **가장 중요한 규칙**: dsl 스크립트의 로직과 text 설명은 반드시 일치해야 한다.
- 사용자의 프롬프트를 창의적으로 해석하되, powerCap을 넘지 않도록 코스트, 수치, 효과의 복잡도를 조절하라.
- if, forEach, setVar 등을 조합하여 여러 효과가 연계되는 복잡한 로직을 만들어라.
- **절대로 JSON 형식 외의 다른 텍스트(주석, 설명 등)를 포함하지 마라.**`;

  const user =
`{
  "prompt": "${params.prompt}",
  "count": ${params.count},
  "powerCap": ${params.powerCap},
  "seed": "${params.seed ?? Date.now()}"
}`;

  const rawJson = await callGemini(system, user, params.temperature, apiKey);

  let arr;
  try{
    arr = JSON.parse(rawJson);
  }catch(e){
    console.error("Model response is not a valid JSON:", rawJson);
    throw new functions.https.HttpsError("invalid-argument", "모델 응답 JSON 파싱 실패", rawJson);
  }

  const out = [];
  for(const c of arr){
    try {
      const parsed = CardSchema.parse(c);
      const expected = rulesTextFromDSL(parsed.dsl); // 요약된 텍스트
      const score = scoreCard(parsed);
      const doc = {
        ...parsed,
        checks: {
          ...parsed.checks,
          expectedText: expected,
          validatorScore: score,
          errors: []
        },
        meta: { ...(parsed.meta||{}), seed: params.seed || "", model: GEMINI_MODEL, temperature: params.temperature }
      };
      out.push(doc);
    } catch(e) {
      console.warn("Skipping invalid card from model:", c, e.issues);
    }
  }

  if (out.length === 0) {
    throw new functions.https.HttpsError("internal", "AI 모델이 유효한 카드를 생성하지 못했습니다. 프롬프트를 수정하거나 다시 시도해주세요.");
  }

  const db = admin.firestore();
  const batch = db.batch();
  for(const c of out){
    batch.set(db.collection("cards").doc(c.id), c, { merge: true });
  }
  await batch.commit();

  return { ok:true, count: out.length, cards: out };
});
