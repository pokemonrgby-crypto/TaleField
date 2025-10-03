// functions/index.js
import fetch from "cross-fetch";
// import * as admin from "firebase-admin"; // 이 줄을 주석 처리하거나 삭제합니다.
import { initializeApp, applicationDefault } from "firebase-admin/app"; // 수정된 부분
import { getFirestore } from "firebase-admin/firestore"; // 추가된 부분
import * as functions from "firebase-functions";
import { z } from "zod";


// try { admin.initializeApp(); } catch (_) {} // 이 줄을 아래와 같이 바꿉니다.
try { initializeApp(); } catch (_) {} // 수정된 부분
// functions/index.js
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { HttpsError } from "firebase-functions/v1/https";
import { z } from "zod";
import fetch from "cross-fetch";
import { defineSecret } from "firebase-functions/params";

try { initializeApp(); } catch (_) {}
const db = getFirestore();

// --- 비밀 값 정의 ---
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL   = "gemini-2.5-flash"; // 사용자 요청에 따라 모델 고정

// --- Zod 스키마 정의 (카드 생성 및 요청) ---
const ValueOrExpr = z.union([z.number().int(), z.string(), z.object({ expr: z.string() })]);

const Op = z.lazy(() => z.union([
  z.object({ op:z.literal("damage"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("heal"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("shield"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("draw"), count:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("discard"), count:ValueOrExpr, from:z.string(), target:z.string() }),
  z.object({ op:z.literal("addMarker"), name:z.string(), turns:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("setVar"), var:z.string(), value:ValueOrExpr }),
  z.object({ op:z.literal("if"), cond:z.string(), then:z.array(Op), else:z.array(Op).optional() }),
  z.object({ op:z.literal("forEach"), target:z.string(), loopVar:z.string(), actions:z.array(Op) }),
  z.object({ op:z.literal("find"), type:z.string(), filters:z.array(z.string()), var:z.string() }),
  z.object({ op:z.literal("addTrigger"), event:z.string(), actions:z.array(Op), target:z.string() }),
]));

const CardSchema = z.object({
  id: z.string().regex(/^card_auto_[a-z0-9-]+$/),
  ownerUid: z.string(),
  name: z.string().min(1),
  type: z.enum(["skill", "spell", "attachment"]),
  rarity: z.enum(["normal","rare","epic","legend"]),
  attribute: z.enum(["fire","water","wind","earth","light","dark","neutral"]),
  keywords: z.array(z.string()).max(4),
  cost: z.number().int().min(0),
  cooldownTurns: z.number().int().min(0),
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
    seed: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().optional()
  }).optional()
});

const GenCardsReqSchema = z.object({
  prompt: z.string().min(5).max(150),
  count: z.number().int().min(1).max(12).default(6),
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
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}


// --- Callable Functions ---

/**
 * AI를 호출하여 카드를 생성합니다.
 */
export const genCards = functions
  .region("us-central1")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const apiKey = GEMINI_API_KEY.value();

    const params = GenCardsReqSchema.parse(data);

    // AI에게 전달할 시스템 프롬프트 (DSL 명세 강화)
    const system =
`당신은 천재 카드 게임 디자이너입니다. 사용자의 프롬프트를 해석하여, 아래에 정의된 '카드 효과 스크립트' 언어를 사용해 복잡하고 창의적인 카드 로직을 설계합니다.
결과는 반드시 **JSON 배열** 형식으로만 출력해야 하며, 스키마를 완벽하게 준수해야 합니다.

[출력 JSON 스키마] - 모든 필드는 필수이며, 순서를 지켜야 합니다.
1.  id: "card_auto_" + 영어 소문자/숫자/하이픈으로 된 slug. (예: "card_auto_flame-burst-golem")
2.  ownerUid: "${context.auth.uid}" (고정)
3.  name: "카드 이름" (한글)
4.  type: "skill" | "spell" | "attachment"
5.  rarity: "normal" | "rare" | "epic" | "legend"
6.  attribute: "fire" | "water" | "wind" | "earth" | "light" | "dark" | "neutral"
7.  keywords: 문자열 배열. (예: ["pierce", "fast"])
8.  cost: 0~10 사이의 정수.
9.  cooldownTurns: 0~5 사이의 정수.
10. dsl: 아래 명세에 따른 Op 객체 배열. 1~10개.
11. text: dsl 스크립트의 동작을 자연스러운 한국어 문장으로 설명. dsl과 완벽히 일치해야 함.
12. checks: { "banned": false, "version": 1, "validatorScore": 0, "errors": [] } (고정)
13. status: "pending" (고정)
14. meta: {} (빈 객체)

[카드 효과 스크립트(DSL) 명세]
- **Op 종류**: damage, heal, shield, draw, discard, addMarker, setVar, if, forEach, find, addTrigger
- **addMarker**: {"op":"addMarker", "name":"표식 이름", "turns": 턴 수, "target":"대상"}
- **대상(target)**: "caster", "target", "allPlayers", "opponentPlayers", "find.변수명", "loop.변수명" 등을 사용.
- **절대로 JSON 형식 외의 다른 텍스트(주석, 설명 등)를 포함하지 마십시오.**`;

    const user = `{ "prompt": "${params.prompt}", "count": ${params.count}, "powerCap": ${params.powerCap} }`;

    let rawJson = await callGemini(system, user, params.temperature, apiKey);

    // 모델이 Markdown 코드 블록(` ```json ... ``` `)을 포함하는 경우 대비
    const jsonMatch = rawJson.match(/\[.*\]/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    let arr;
    try {
      arr = JSON.parse(rawJson);
    } catch(e) {
      console.error("Model response is not valid JSON:", rawJson);
      throw new HttpsError("internal", "AI 모델이 유효한 JSON을 생성하지 못했습니다.", { raw: rawJson });
    }

    const out = [];
    for(const c of arr) {
      try {
        const parsed = CardSchema.parse(c);
        // 간단한 밸런스 점수 계산 (예시)
        const score = parsed.dsl.length * 2 + parsed.cost * 1.5;
        const doc = {
          ...parsed,
          ownerUid: context.auth.uid, // 보안을 위해 서버에서 UID 재설정
          checks: { ...parsed.checks, validatorScore: score },
          meta: { model: GEMINI_MODEL, temperature: params.temperature },
          createdAt: FieldValue.serverTimestamp() // 생성 시간 기록
        };
        out.push(doc);
      } catch(e) {
        console.warn("Skipping invalid card from model:", c, e.issues);
      }
    }

    if (out.length === 0) {
      throw new HttpsError("internal", "AI 모델이 유효한 카드를 생성하지 못했습니다. 프롬프트를 수정하거나 다시 시도해주세요.");
    }

    // Firestore에 카드 저장
    const batch = db.batch();
    for(const c of out) {
      batch.set(db.collection("userCards").doc(c.id), c);
    }
    await batch.commit();

    return { ok: true, count: out.length, cards: out, rawJson };
});


/**
 * 게임을 시작합니다 (호스트 전용).
 */
export const startMatch = functions.region("us-central1").https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const { roomId } = z.object({ roomId: z.string() }).parse(data);

    const roomRef = db.doc(`rooms/${roomId}`);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new HttpsError("not-found", "방을 찾을 수 없습니다.");
    
    const room = roomSnap.data();
    if (room.hostUid !== context.auth.uid) throw new HttpsError("permission-denied", "호스트만 게임을 시작할 수 있습니다.");
    if (room.status !== 'ready') throw new HttpsError("failed-precondition", "모든 플레이어가 준비되지 않았습니다.");
    
    // TODO: 게임 시작 로직 구현
    // 1. rooms/{roomId}/players 에서 플레이어 목록 가져오기
    // 2. 모든 플레이어의 selectedCardIds를 합쳐 공용 덱 생성
    // 3. matches 컬렉션에 새 매치 문서 생성 (초기 상태 설정)
    // 4. Room 상태를 'playing'으로 변경

    // 임시 응답
    await roomRef.update({ status: 'playing' });
    return { ok: true, matchId: `match_${roomId}` };
});


// --- Trigger Functions ---

/**
 * 방에 플레이어가 한 명도 없으면 해당 방을 자동으로 삭제합니다.
 */
export const cleanupEmptyRoom = functions
  .region("us-central1")
  .firestore.document("rooms/{roomId}/players/{playerId}")
  .onDelete(async (snap, context) => {
    const { roomId } = context.params;
    const roomRef = db.doc(`rooms/${roomId}`);
    const playersRef = roomRef.collection("players");

    const playersSnap = await playersRef.limit(1).get();

    if (playersSnap.empty) {
      console.log(`Deleting empty room: ${roomId}`);
      // 하위 컬렉션(chat 등)도 삭제해야 할 경우 추가 로직 필요
      return roomRef.delete();
    }
    return null;
  });
import { defineSecret } from "firebase-functions/params";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ValueOrExpr = z.union([
  z.number().int(),
  z.string(),
  z.object({ expr: z.string() })
]);

const Op = z.lazy(() => z.union([
  z.object({ op:z.literal("damage"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("heal"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("shield"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("draw"), count:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("discard"), count:ValueOrExpr, from:z.string(), target:z.string() }),
  z.object({ op:z.literal("addMarker"), name:z.string(), turns:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("setVar"), var:z.string(), value:ValueOrExpr }),
  z.object({ op:z.literal("if"), cond:z.string(), then:z.array(Op), else:z.array(Op).optional() }),
  z.object({ op:z.literal("forEach"), target:z.string(), loopVar:z.string(), actions:z.array(Op) }),
  z.object({ op:z.literal("find"), type:z.string(), filters:z.array(z.string()), var:z.string() }),
  z.object({
    op: z.literal("addTrigger"),
    event: z.string(),
    actions: z.array(Op),
    target: z.string()
  }),
]));

const CardSchema = z.object({
  id: z.string().regex(/^card_auto_[a-z0-9-]+$/),
  ownerUid: z.string(),
  name: z.string().min(1),
  type: z.enum(["skill", "spell", "attachment"]),
  rarity: z.enum(["normal","rare","epic","legend"]),
  attribute: z.enum(["fire","water","wind","earth","light","dark","neutral"]),
  keywords: z.array(z.string()).max(4),
  cost: z.number().int().min(0),
  cooldownTurns: z.number().int().min(0),
  dsl: z.array(Op).min(1).max(10),
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
  return seg.join(", ").substring(0, 100);
}

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
      else if (step.op === "forEach") opScore = 1.2 * scoreOps(step.actions, 1.5);
      else if (step.op === "addTrigger") opScore = 5 + scoreOps(step.actions, 1.2);
      else opScore = 1.0;
      currentScore += opScore;
    }
    return currentScore * multiplier;
  }
  s = scoreOps(card.dsl);
  s = s / (1 + card.cost * 0.5 + card.cooldownTurns * 0.3);
  return Math.round(s * 10) / 10;
}

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

export const genCards = functions
  .region("us-central1")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "로그인이 필요해.");
    const apiKey = GEMINI_API_KEY.value();
    if(!apiKey) throw new functions.https.HttpsError("failed-precondition","GEMINI_API_KEY가 설정되지 않았어.");

  const params = ReqSchema.parse(data);

  const system =
`너는 천재 카드 게임 디자이너다. 사용자의 프롬프트를 해석하여, 아래에 정의된 '카드 효과 스크립트' 언어를 사용해 복잡하고 창의적인 카드 로직을 설계한다.
결과는 반드시 **JSON 배열** 형식으로만 출력해야 한다. 스키마를 완벽하게 준수하는 것이 가장 중요하다.

[출력 JSON 스키마] - 모든 필드는 필수이며, 순서를 지켜라.
1.  id: "card_auto_" + 영어 소문자/숫자/하이픈으로 된 slug. (예: "card_auto_flame-burst-golem")
2.  ownerUid: "system" (고정)
3.  name: "카드 이름" (한글)
4.  type: "skill" | "spell" | "attachment"
5.  rarity: "normal" | "rare" | "epic" | "legend"
6.  attribute: "fire" | "water" | "wind" | "earth" | "light" | "dark" | "neutral"
7.  keywords: 문자열 배열. (예: ["pierce", "fast"])
8.  cost: 0~10 사이의 정수.
9.  cooldownTurns: 0~5 사이의 정수.
10. dsl: 아래 명세에 따른 Op 객체 배열. 1~10개.
11. text: dsl 스크립트의 동작을 자연스러운 한국어 문장으로 설명. dsl과 완벽히 일치해야 함.
12. checks: { "banned": false, "version": 1, "validatorScore": 0, "errors": [] } (고정)
13. status: "pending" (고정)
14. meta: {} (빈 객체)

[카드 효과 스크립트(DSL) 명세]
- **Op 종류**:
  - damage, heal, shield, draw, discard
  - **addMarker**: {"op":"addMarker", "name":"표식 이름", "turns": 턴 수, "target":"대상"}  <- 'marker'나 'count'가 아님!
  - find, setVar, if, forEach, addTrigger
- **값 또는 표현식(ValueOrExpr)**: amount, count, turns 필드에는 숫자(5)나 표현식({"expr": "caster.hp / 2"})을 사용.
- **대상(target)**: "caster", "target", "find.변수명", "loop.변수명" 등을 사용.

[제한 및 요구사항]
- **가장 중요한 규칙**: 위의 14개 필드를 모두 포함하는 완벽한 JSON 객체들의 배열을 생성해야 한다.
- powerCap을 넘지 않도록 코스트, 수치, 효과의 복잡도를 조절하라.
- **절대로 JSON 형식 외의 다른 텍스트(주석, 설명 등)를 포함하지 마라.**`;

  const user =
`{
  "prompt": "${params.prompt}",
  "count": ${params.count},
  "powerCap": ${params.powerCap},
  "seed": "${params.seed ?? Date.now()}"
}`;

  let rawJson = await callGemini(system, user, params.temperature, apiKey);

  // =======================================================
  // ANCHOR: debug-raw-response
  // 추가된 디버깅 코드 1: 원본 응답을 로그에 출력
  console.log("--- Gemini Raw Response ---");
  console.log(rawJson);
  console.log("---------------------------");

  // 추가된 디버깅 코드 2: 응답에서 JSON 부분만 추출
  // 모델이 Markdown 코드 블록을 포함하는 경우 대비
  const jsonMatch = rawJson.match(/\[.*\]/s);
  if (jsonMatch) {
    rawJson = jsonMatch[0];
    console.log("Extracted JSON from raw response.");
  }
  // =======================================================


  let arr;
  try{
    arr = JSON.parse(rawJson);
  }catch(e){
    console.error("Model response is still not a valid JSON after extraction:", rawJson); // 로그 메시지 수정
    throw new functions.https.HttpsError("invalid-argument", "모델 응답 JSON 파싱 실패", { rawResponse: rawJson }); // 상세 정보 추가
  }

  const out = [];
  for(const c of arr){
    try {
      const parsed = CardSchema.parse(c);
      const score = scoreCard(parsed);
      const doc = {
        ...parsed,
        checks: {
          ...parsed.checks,
          validatorScore: score,
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

  // const db = admin.firestore(); // 이 줄을 아래와 같이 바꿉니다.
  const db = getFirestore(); // 수정된 부분
  const batch = db.batch();
  for(const c of out){
    batch.set(db.collection("cards").doc(c.id), c, { merge: true });
  }
  await batch.commit();
  
  return { ok:true, count: out.length, cards: out, rawJson: rawJson };
});
