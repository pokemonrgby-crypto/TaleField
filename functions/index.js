// functions/index.js
import fetch from "cross-fetch";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { z } from "zod";

try { admin.initializeApp(); } catch (_) {}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || functions.params.defineString("GEMINI_API_KEY")?.value();
const GEMINI_MODEL   = process.env.GEMINI_MODEL   || "gemini-1.5-flash";

// ---- Zod schema (cards) ----
const Op = z.union([
  z.object({ op:z.literal("damage"), amount:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("heal"), amount:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("shield"), amount:z.number().int().nonnegative(), target:z.string() }),
  z.object({ op:z.literal("stun"), turns:z.number().int().nonnegative(), target:z.string() }),
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

const ReqSchema = z.object({
  count: z.number().int().min(1).max(12),
  theme: z.string().default(""),
  attribute: z.enum(["fire","water","wind","earth","light","dark","neutral"]).optional(),
  role: z.enum(["attacker","tank","support","control"]).optional(),
  playStyle: z.enum(["burst","sustain","tempo","combo"]).optional(),
  rarityTarget: z.enum(["normal","rare","epic","legend"]).optional(),
  powerCap: z.number().int().min(1).max(20).default(10),
  seed: z.string().optional(),
  temperature: z.number().min(0).max(1).default(0.8)
});

// ---- helper: DSL → 한국어 규칙문 생성 ----
function rulesTextFromDSL(dsl){
  const seg = [];
  for(const step of dsl){
    if(step.op==="damage") seg.push(`대상에게 ${step.amount} 피해를 줍니다.`);
    if(step.op==="heal") seg.push(`대상 아군에게 ${step.amount} 회복합니다.`);
    if(step.op==="shield") seg.push(`대상에게 ${step.amount} 보호막을 부여합니다.`);
    if(step.op==="stun") seg.push(`대상을 ${step.turns}턴 동안 기절시킵니다.`);
    if(step.op==="roll") seg.push(`무작위(${step.sides}) 굴림 결과를 변수 ${step.var}에 저장합니다.`);
    if(step.op==="delay") seg.push(`${step.turns}턴 후 ${step.phase} 페이즈에 다음 효과 발동: ${step.effects.length}개`);
  }
  return seg.join(" ");
}

// 간단 파워 점수 (데모용)
function scoreCard(card){
  let s = 0;
  for(const step of card.dsl){
    if(step.op==="damage") s += step.amount * 0.5;
    if(step.op==="heal") s += step.amount * 0.45;
    if(step.op==="shield") s += step.amount * 0.4;
    if(step.op==="stun") s += step.turns * 2.5;
    if(step.op==="roll") s += 0.5;
    if(step.op==="delay") s += Math.max(0, 2 - step.turns*0.3); // 지연은 효율 낮춤
  }
  // 코스트/쿨다운 보정
  s = s / (1 + card.cost*0.4 + card.cooldownTurns*0.3);
  return Math.round(s*10)/10;
}

// ---- Gemini 호출 ----
async function callGemini(system, user, temperature=0.8){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
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
export const genCards = functions.region("us-central1").https.onCall(async (data, context) => {
  if(!context.auth) throw new functions.https.HttpsError("unauthenticated", "로그인이 필요해.");
  if(!GEMINI_API_KEY) throw new functions.https.HttpsError("failed-precondition","GEMINI_API_KEY가 설정되지 않았어.");

  const params = ReqSchema.parse(data);
  const system =
`너는 카드 게임 디자이너야. 아래 스키마를 준수하는 **JSON 배열만** 출력해.
스키마(모두 엄격 준수):
- id: "card_auto_" + 소문자-하이픈 슬러그
- ownerUid: "system"
- type: "character" | "skill"
- rarity: "normal" | "rare" | "epic" | "legend"
- attribute: "fire"|"water"|"wind"|"earth"|"light"|"dark"|"neutral"
- numbers: 선택(부가수치)
- keywords: 0~4개 (예:"fast","pierce")
- cost: 0~5, cooldownTurns: 0~3
- dsl: 아래 연산으로 1~6스텝
  * {"op":"damage","amount":정수,"target":"enemy|allEnemies|randomEnemy|self|ally"}
  * {"op":"heal","amount":정수,"target":"self|ally"}
  * {"op":"shield","amount":정수,"target":"self|ally"}
  * {"op":"stun","turns":정수,"target":"enemy"}
  * {"op":"roll","sides":정수>=2,"add"?:정수,"var":"변수명"}    // 랜덤
  * {"op":"delay","turns":정수>=0,"phase":"main|reaction|resolve","effects":[...]} // n턴 뒤 특정 페이즈 발동
- text: dsl과 **정확히 같은 의미의 한국어 규칙문 (수치/턴/대상 일치)**
- checks: { banned:false, version:1, validatorScore:0, errors:[], expectedText:"" }
- status: "pending"
제한:
- 총 위력은 powerCap 이하가 되도록 조정. 과하면 효과/수치/코스트를 낮춰.
- 서사/속성 아이덴티티를 반영하되 외설/저작권/정치/혐오 금지.
- **JSON 이외의 출력(마크다운/주석/설명) 금지.**`;

  const user =
`count=${params.count}
theme=${params.theme}
attribute=${params.attribute ?? "any"}
role=${params.role ?? "any"}
playStyle=${params.playStyle ?? "any"}
rarityTarget=${params.rarityTarget ?? "mixed"}
powerCap=${params.powerCap}
seed=${params.seed ?? ""}

요구:
- 캐릭터/스킬 적절 혼합(예: 2:4)
- dsl은 1~3스텝 위주, delay/roll을 적절히 섞되 과하지 않게
- JSON 배열만 출력`;

  const raw = await callGemini(system, user, params.temperature);

  // JSON 파싱 안전화
  let arr;
  try{
    const start = raw.indexOf("[");
    const end   = raw.lastIndexOf("]");
    arr = JSON.parse(raw.slice(start, end+1));
  }catch(e){
    throw new functions.https.HttpsError("invalid-argument", "모델 응답 JSON 파싱 실패", raw);
  }

  // 스키마/일치성 검사 + expectedText/score 세팅
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

  // Firestore 저장 (status:"pending")
  const db = admin.firestore();
  const batch = db.batch();
  for(const c of out){
    batch.set(db.collection("cards").doc(c.id), c, { merge: true });
  }
  await batch.commit();

  return { ok:true, count: out.length, cards: out };
});
