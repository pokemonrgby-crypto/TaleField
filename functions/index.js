// functions/index.js
import fetch from "cross-fetch";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { z } from "zod";

try { admin.initializeApp(); } catch (_) {}

import { defineSecret } from "firebase-functions/params";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-1.5-flash";


// ---- Zod schema (cards) ----
// ANCHOR: zod-op-expansion
const Op = z.union([
  z.object({ op:z.literal("damage"), amount:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("heal"), amount:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("shield"), amount:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("stun"), turns:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("draw"), count:z.number().int().min(1), target:z.string() }),
  z.object({ op:z.literal("discard"), count:z.number().int().min(1), from:z.string(), target:z.string() }),
  z.object({ op:z.literal("addMarker"), name:z.string(), turns:z.number().int().min(1), target:z.string() }),
  // 조건부
  z.object({
    op: z.literal("if"),
    cond: z.string(), // "myHP < 10", "hand.length > 5" 등
    then: z.array(z.any()),
    else: z.array(z.any()).optional(),
  }),
  // 지연/페이즈 트리거
  z.object({
    op: z.literal("delay"),
    turns: z.number().int().min(0),
    phase: z.enum(["main","reaction","resolve"]),
    effects: z.array(z.any())
  }),
  // 랜덤 요소
  z.object({
    op: z.literal("roll"),
    sides: z.number().int().min(2),
    add: z.number().int().optional(),
    var: z.string()
  })
]);


const CardSchema = z.object({
  id: z.string().regex(/^card_auto_[a-z0-9-]+$/),
  ownerUid: z.string(),
  name: z.string().min(1),
  type: z.enum(["character","skill"]),
  rarity: z.enum(["normal","rare","epic","legend"]),
  attribute: z.enum(["fire","water","wind","earth","light","dark","neutral"]),
  numbers: z.record(z.number()).optional(),
  keywords: z.array(z.string()).max(4),
  cost: z.number().int().min(0),
  cooldownTurns: z.number().int().min(0),
  dsl: z.array(Op).min(1).max(6),
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

// ANCHOR: req-schema-prompt
const ReqSchema = z.object({
  prompt: z.string().min(5).max(150),
  count: z.number().int().min(1).max(12).default(6),
  powerCap: z.number().int().min(1).max(20).default(10),
  seed: z.string().optional(),
  temperature: z.number().min(0).max(1).default(0.8)
});

// ---- helper: DSL → 한국어 규칙문 생성 ----
// ANCHOR: dsl-text-update
function rulesTextFromDSL(dsl){
  const seg = [];
  for(const step of dsl){
    if(step.op==="damage") seg.push(`대상에게 ${step.amount} 피해를 줍니다.`);
    if(step.op==="heal") seg.push(`대상 아군에게 ${step.amount} 회복합니다.`);
    if(step.op==="shield") seg.push(`대상에게 ${step.amount} 보호막을 부여합니다.`);
    if(step.op==="stun") seg.push(`대상을 ${step.turns}턴 동안 기절시킵니다.`);
    if(step.op==="draw") seg.push(`대상이 카드를 ${step.count}장 뽑습니다.`);
    if(step.op==="discard") seg.push(`대상의 ${step.from}에서 카드를 ${step.count}장 버립니다.`);
    if(step.op==="addMarker") seg.push(`대상에게 '${step.name}' 표식을 ${step.turns}턴 동안 부여합니다.`);
    if(step.op==="roll") seg.push(`무작위(${step.sides}) 굴림 결과를 변수 ${step.var}에 저장합니다.`);
    if(step.op==="delay") seg.push(`${step.turns}턴 후 ${step.phase} 페이즈에 다음 효과 발동: ${step.effects.length}개`);
    if(step.op==="if") seg.push(`조건(${step.cond})을 만족하면 효과 A, 아니면 효과 B를 발동합니다.`);
  }
  return seg.join(" ");
}

// 간단 파워 점수 (데모용)
// ANCHOR: score-card-update
function scoreCard(card){
  let s = 0;
  for(const step of card.dsl){
    if(step.op==="damage") s += step.amount * 0.5;
    if(step.op==="heal") s += step.amount * 0.45;
    if(step.op==="shield") s += step.amount * 0.4;
    if(step.op==="stun") s += step.turns * 2.5;
    if(step.op==="draw") s += step.count * 1.8;
    if(step.op==="discard") s += step.count * 1.2;
    if(step.op==="addMarker") s += 1.5;
    if(step.op==="if") s += 1; // 조건부는 복잡하므로 일단 고정 점수
    if(step.op==="roll") s += 0.5;
    if(step.op==="delay") s += Math.max(0, 2 - step.turns*0.3); // 지연은 효율 낮춤
  }
  // 코스트/쿨다운 보정
  s = s / (1 + card.cost*0.4 + card.cooldownTurns*0.3);
  return Math.round(s*10)/10;
}


// ---- Gemini 호출 ----
async function callGemini(system, user, temperature = 0.8, apiKey){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role:"user", parts:[{ text:`[SYSTEM]\n${system}\n\n[USER]\n${user}` }] }],
    generationConfig: { temperature }
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
  .runWith({ secrets: [GEMINI_API_KEY] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "로그인이 필요해.");
    const apiKey = GEMINI_API_KEY.value();
    if(!apiKey) throw new functions.https.HttpsError("failed-precondition","GEMINI_API_KEY가 설정되지 않았어.");

  // ANCHOR: gen-cards-logic-update
  const params = ReqSchema.parse(data);
  const system =
`너는 카드 게임 디자이너야. 사용자의 자유로운 프롬프트를 해석해서, 그에 맞는 창의적이고 균형 잡힌 카드 **JSON 배열만** 출력해.
스키마(모두 엄격 준수):
- id: "card_auto_" + 소문자-하이픈 슬러그
- ownerUid: "system"
- type: "skill" (캐릭터 제외)
- rarity: "normal" | "rare" | "epic" | "legend"
- attribute: "fire"|"water"|"wind"|"earth"|"light"|"dark"|"neutral"
- keywords: 0~4개 (예:"fast","pierce")
- cost: 0~5, cooldownTurns: 0~3
- dsl: 아래 연산으로 1~6스텝. 사용자의 아이디어를 최대한 dsl로 구현해줘.
  * {"op":"damage","amount":정수,"target":"enemy|allEnemies|randomEnemy|self|ally"}
  * {"op":"heal","amount":정수,"target":"self|ally"}
  * {"op":"shield","amount":정수,"target":"self|ally"}
  * {"op":"stun","turns":정수,"target":"enemy"}
  * {"op":"draw","count":정수,"target":"self|ally"}
  * {"op":"discard","count":정수,"from":"hand|deck","target":"enemy|self"}
  * {"op":"addMarker","name":"표식 이름(예: '약점 노출')","turns":정수,"target":"enemy|self|ally"}
  * {"op":"if","cond":"조건(예: '내HP<10')","then":[...],"else":[...]}
  * {"op":"roll","sides":정수>=2,"add"?:정수,"var":"변수명"}
  * {"op":"delay","turns":정수>=0,"phase":"main|reaction|resolve","effects":[...]}
- text: dsl과 **정확히 같은 의미의 한국어 규칙문 (수치/턴/대상 일치)**
- checks: { banned:false, version:1, validatorScore:0, errors:[], expectedText:"" }
- status: "pending"
제한:
- 총 위력은 powerCap 이하가 되도록 조정. 과하면 효과/수치/코스트를 낮춰.
- 서사/속성 아이덴티티를 반영하되 외설/저작권/정치/혐오 금지.
- **JSON 이외의 출력(마크다운/주석/설명) 금지.**`;

  const user =
`prompt="${params.prompt}"
count=${params.count}
powerCap=${params.powerCap}
seed=${params.seed ?? ""}

요구:
- 사용자의 prompt를 창의적으로 해석해서 dsl로 구현해줘.
- dsl은 1~3스텝 위주, if/delay/roll/addMarker를 적절히 섞되 과하지 않게.
- JSON 배열만 출력.`;

  const raw = await callGemini(system, user, params.temperature, apiKey);

  let arr;
  try{
    const start = raw.indexOf("[");
    const end   = raw.lastIndexOf("]");
    arr = JSON.parse(raw.slice(start, end+1));
  }catch(e){
    throw new functions.https.HttpsError("invalid-argument", "모델 응답 JSON 파싱 실패", raw);
  }

  const out = [];
  for(const c of arr){
    const parsed = CardSchema.parse(c);
    const expected = rulesTextFromDSL(parsed.dsl);
    const errors = [];
    if((parsed.text||"").trim() !== expected.trim()){
      errors.push("TEXT_DSL_MISMATCH");
    }
    const score = scoreCard(parsed);
    const doc = {
      ...parsed,
      checks: {
        ...parsed.checks,
        expectedText: expected,
        validatorScore: score,
        errors
      },
      meta: { ...(parsed.meta||{}), seed: params.seed || "", model: GEMINI_MODEL, temperature: params.temperature }
    };
    out.push(doc);
  }

  const db = admin.firestore();
  const batch = db.batch();
  for(const c of out){
    batch.set(db.collection("cards").doc(c.id), c, { merge: true });
  }
  await batch.commit();

  return { ok:true, count: out.length, cards: out };
});
