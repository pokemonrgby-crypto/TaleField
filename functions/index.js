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
const DAILY_ARTIFACT_LIMIT = 150; // 성물 생성 제한
const DAILY_SHIN_LIMIT = 30;  // 신 생성 제한
// 하위 호환성
const DAILY_CARD_LIMIT = DAILY_ARTIFACT_LIMIT;
const DAILY_CHAR_LIMIT = DAILY_SHIN_LIMIT;

// --- Zod 스키마 정의 (GodField) ---
const ValueOrExpr = z.union([z.number().int(), z.string(), z.object({ expr: z.string() })]);

// GodField DSL Op 정의
const Op = z.lazy(() => z.discriminatedUnion("op", [
  // 기본 Op
  z.object({ 
    op: z.literal("damage"), 
    amount: ValueOrExpr, 
    attribute: z.enum(["無", "火", "水", "木", "土", "光", "暗"]).optional(),
    target: z.string(),
    onHit: z.array(Op).optional()
  }),
  z.object({ op: z.literal("heal"), amount: ValueOrExpr, target_stat: z.enum(["hp", "mp", "gold"]).optional(), target: z.string() }),
  z.object({ op: z.literal("apply_disaster"), disasterName: z.enum(["병", "안개", "섬광", "꿈", "먹구름"]), target: z.string() }),
  z.object({ op: z.literal("remove_disaster"), disasterName: z.string().optional(), target: z.string() }),
  z.object({ op: z.literal("modify_stat"), target_stat: z.enum(["hp", "mp", "gold"]), amount: ValueOrExpr, target: z.string() }),
  z.object({ op: z.literal("draw"), count: ValueOrExpr, target: z.string() }),
  z.object({ op: z.literal("discard"), count: ValueOrExpr, target: z.string() }),
  z.object({ op: z.literal("reflect_damage"), multiplier: z.number().min(0).optional() }),
  z.object({ op: z.literal("absorb_hp"), amount: ValueOrExpr, target: z.string() }),
  z.object({ op: z.literal("if"), cond: z.string(), then: z.array(Op), else: z.array(Op).optional() }),
  z.object({ op: z.literal("random"), chance: z.number().min(0).max(1), then: z.array(Op), else: z.array(Op).optional() }),
  z.object({ op: z.literal("on_user_death"), dsl: z.array(Op) }),
  z.object({ op: z.literal("equip"), slot: z.enum(["weapon", "shield", "accessory"]) }),
  z.object({ op: z.literal("change_attribute"), from: z.string(), to: z.string(), target: z.string() })
]));

const validOps = new Set(Op.schema.options.map(o => o.shape.op.value));

// 성물(Artifact) 스키마
const ArtifactSchema = z.object({
  id: z.string(),
  ownerUid: z.string(),
  name: z.string().min(1),
  cardType: z.enum(["weapon", "armor", "item", "miracle"]),
  attribute: z.enum(["無", "火", "水", "木", "土", "光", "暗"]),
  text: z.string(),
  stats: z.object({
    attack: z.number().int().optional(),
    defense: z.number().int().optional(),
    durability: z.number().int().optional(),
    mpCost: z.number().int().optional(),
    goldValue: z.number().int().optional(),
  }).optional(),
  disasterToApply: z.enum(["병", "안개", "섬광", "꿈", "먹구름"]).optional(),
  dsl: z.array(Op).min(1).max(10),
  checks: z.object({
    banned: z.boolean(),
    version: z.number().int(),
    validatorScore: z.number(),
    errors: z.array(z.string()).default([]),
  }),
  status: z.enum(["pending", "approved", "blocked"]).default("pending"),
  meta: z.object({
    model: z.string().optional(),
    temperature: z.number().optional()
  }).optional(),
  createdAt: z.any(),
});

// 기적 스키마 (신의 고유 기적용)
const MiracleSchema = z.object({
  name: z.string(),
  cardType: z.literal("miracle"),
  attribute: z.enum(["無", "火", "水", "木", "土", "光", "暗"]),
  text: z.string(),
  stats: z.object({
    mpCost: z.number().int()
  }),
  dsl: z.array(Op)
});

// 신(Shin) 스키마
const ShinSchema = z.object({
  id: z.string(),
  ownerUid: z.string(),
  name: z.string(),
  description: z.string(),
  uniqueMiracles: z.array(MiracleSchema).min(1).max(2),
  status: z.enum(["pending", "approved", "blocked"]).default("pending"),
  meta: z.object({
    model: z.string().optional(),
    temperature: z.number().optional()
  }).optional(),
  createdAt: z.any(),
});

const GenArtifactReqSchema = z.object({
  prompt: z.string().min(5).max(150),
  powerCap: z.number().int().min(1).max(20).default(10),
  temperature: z.number().min(0).max(1).default(0.8)
});

const GenShinReqSchema = z.object({
  prompt: z.string().min(5).max(150),
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

// ANCHOR: functions/index.js (normalizeDslOps for GodField)
function normalizeDslOps(dsl) {
  if (!Array.isArray(dsl)) return [];

  const opCorrections = {
    'dealDamage': 'damage',
    'restoreHealth': 'heal',
    'drawCard': 'draw',
    'discardCard': 'discard',
    'applyDisaster': 'apply_disaster',
    'removeDisaster': 'remove_disaster',
    'modifyStat': 'modify_stat',
    'reflectDamage': 'reflect_damage',
    'absorbHp': 'absorb_hp',
    'conditional': 'if',
    'onUserDeath': 'on_user_death',
    'changeAttribute': 'change_attribute'
  };
  
  // 'target'이 필수인 op 목록
  const opsRequiringTarget = new Set(['damage', 'heal', 'apply_disaster', 'remove_disaster', 'modify_stat', 'draw', 'discard', 'absorb_hp', 'change_attribute']);

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
    
    // 4. target이 없는 경우 기본값 부여
    if (opsRequiringTarget.has(op.op) && !op.target) {
        // 피해를 주는 효과는 'enemy', 이로운 효과는 'caster'를 기본값으로 설정
        if (op.op === 'damage' || op.op === 'absorb_hp' || op.op === 'apply_disaster') {
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
    if (op.dsl) op.dsl = normalizeDslOps(op.dsl);
    
    return op;
  }).filter(Boolean); // null 값을 제거하여 최종 배열 생성

  return normalized;
}

function normalizeAttribute(obj) {
  // GodField 속성 정규화
  const map = { 
    "무": "無", "무속성": "無", "neutral": "無",
    "불": "火", "fire": "火", "화": "火",
    "물": "水", "water": "水", "수": "水",
    "나무": "木", "wood": "木", "목": "木",
    "흙": "土", "earth": "土", "토": "土",
    "빛": "光", "light": "光", "광": "光",
    "어둠": "暗", "dark": "暗", "암": "暗"
  };
  if (typeof obj.attribute === 'string' && map[obj.attribute]) {
    obj.attribute = map[obj.attribute];
  }
}

function sanitizeArtifact(artifact) {
  normalizeAttribute(artifact);
  if (!artifact.stats) artifact.stats = {};
  artifact.dsl = normalizeDslOps(artifact.dsl);
  return artifact;
}

function sanitizeShin(shin) {
  for (const miracle of shin.uniqueMiracles || []) {
    normalizeAttribute(miracle);
    miracle.dsl = normalizeDslOps(miracle.dsl);
  }
  return shin;
}



// --- 신(Shin) 생성 함수 ---
export const genShin = functions
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
            if (d.lastShinCreationDate === today) count = d.shinCreationCount || 0;
        }
        if (count >= DAILY_CHAR_LIMIT) {
            throw new HttpsError("resource-exhausted", `오늘 신 생성 제한(${DAILY_CHAR_LIMIT}개)을 모두 사용했습니다.`);
        }
        tx.set(profileRef, { lastShinCreationDate: today, shinCreationCount: count + 1 }, { merge: true });
    });

    const { prompt, temperature } = GenShinReqSchema.parse(data);
    const apiKey = GEMINI_API_KEY.value();
    
const system =
`당신은 차기 지구신 후보를 후원하는 상급신입니다. 사용자의 아이디어를 받아, 예언자에게 강력한 가호를 내려줄 '신'과 그의 '고유 기적'을 JSON으로 디자인하십시오.

[창조 규칙]
- '신'은 스탯을 갖지 않습니다. 오직 이름, 설명, 그리고 1~2개의 '고유 기적'으로만 정의됩니다.
- '고유 기적'은 MP를 소모하며, 게임의 판도를 뒤집을 만큼 강력하고 독특해야 합니다.
- 속성은 無(무), 火(화), 水(수), 木(목), 土(토), 光(광), 暗(암) 중 하나를 선택합니다.

[JSON 출력 형식]
{
  "name": "명왕신 하데스",
  "description": "죽음과 암흑을 다스리는 과묵한 신.",
  "uniqueMiracles": [
    {
      "name": "<어둠>",
      "cardType": "miracle",
      "attribute": "暗",
      "text": "단일 대상에게 5의 암속성 피해를 준다.",
      "stats": { "mpCost": 5 },
      "dsl": [{ "op": "damage", "amount": 5, "attribute": "暗", "target": "enemy" }]
    }
  ]
}

[사용 가능한 DSL op 코드]
- damage: 피해 입히기 (amount, attribute, target)
- heal: 회복 (amount, target_stat: "hp"|"mp"|"gold", target)
- apply_disaster: 재앙 부여 (disasterName: "병"|"안개"|"섬광"|"꿈"|"먹구름", target)
- remove_disaster: 재앙 제거 (target)
- modify_stat: 스탯 변경 (target_stat, amount, target)
- draw: 카드 뽑기 (count, target)
- discard: 카드 버리기 (count, target)
- reflect_damage: 피해 반사
- absorb_hp: 흡혈 (amount, target)
- if: 조건부 (cond, then, else)
- random: 확률 (chance, then, else)

[특수 속성 규칙]
- 光(광): 방어 불가 속성
- 暗(암): 1 이상의 피해를 입으면 즉시 승천(즉사)

[나쁜 예시 (절대 금지)]
- JSON 앞뒤에 설명 붙이기
- 코드 블록 사용: \`\`\`json\n{...}\n\`\`\`
- 유효하지 않은 속성 사용
- 유효하지 않은 op 코드 사용

출력은 오직 순수한 JSON 객체만 포함해야 합니다.`;

    const user = `{ "prompt": "${prompt}" }`;
    let rawJson = await callGemini(system, user, temperature, apiKey);
    let jsonText = extractFirstJsonObject(rawJson);

    try {
      const shinData = sanitizeShin(JSON.parse(jsonText));
      const newShinRef = db.collection("shin").doc();
      const finalShin = {
        ...shinData,
        id: newShinRef.id,
        ownerUid: uid,
        status: "pending",
        meta: { model: GEMINI_MODEL, temperature: temperature },
        createdAt: FieldValue.serverTimestamp()
      };
      ShinSchema.parse(finalShin);
      await newShinRef.set(finalShin);
      return { ok: true, shin: finalShin };
    } catch (e) {
      console.error("Shin generation error:", e, {rawJson});
      const errorMessage = e.errors?.[0]?.message || "AI가 유효하지 않은 형식의 신을 생성했습니다.";
      throw new HttpsError("internal", errorMessage, { raw: rawJson });
    }
});


// --- 성물(Artifact) 생성 함수 ---
export const genArtifact = functions
  .region("asia-northeast3")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const uid = context.auth.uid;
    const apiKey = GEMINI_API_KEY.value();
    const params = GenArtifactReqSchema.parse(data);

    const profileRef = db.doc(`profiles/${uid}`);
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const today = new Date().toISOString().slice(0, 10);
      let count = 0;
      if (profileSnap.exists) {
        const profileData = profileSnap.data();
        if (profileData.lastArtifactCreationDate === today) {
          count = profileData.artifactCreationCount || 0;
        }
      }
      if (count >= DAILY_CARD_LIMIT) {
        throw new HttpsError("resource-exhausted", `오늘 성물 생성 제한(${DAILY_CARD_LIMIT}장)을 모두 사용했습니다.`);
      }
      tx.set(profileRef, {
        lastArtifactCreationDate: today,
        artifactCreationCount: count + 1
      }, { merge: true });
    });

const system =
`당신은 태양신에게 성물을 납품하는 천계의 장인입니다. 사용자의 아이디어를 받아, 예언자들이 사용할 '성물'을 JSON으로 디자인하십시오.

[제작 규칙]
1. **카드 타입 선택**: weapon, armor, item, miracle 중 하나를 선택합니다.
2. **수치 자율성**: attack, defense, mpCost, goldValue 등의 수치는 컨셉에 맞게 **자유롭게 설정**하십시오.
3. **효과 조합 자율성**: 아래의 op 코드를 **자유롭게 조합**하여 독특한 효과를 만드십시오.
4. **고정 규칙 준수**: disasterToApply 필드에는 **미리 정의된 재앙 이름**('병', '안개', '섬광', '꿈', '먹구름')만 사용해야 합니다.

[사용 가능한 DSL op 코드]
- damage: 피해 입히기 (amount, attribute, target)
- heal: 회복 (amount, target_stat: "hp"|"mp"|"gold", target)
- apply_disaster: 재앙 부여 (disasterName: "병"|"안개"|"섬광"|"꿈"|"먹구름", target)
- remove_disaster: 재앙 제거 (target)
- modify_stat: 스탯 변경 (target_stat: "hp"|"mp"|"gold", amount, target)
- draw: 카드 뽑기 (count, target)
- discard: 카드 버리기 (count, target)
- reflect_damage: 피해 반사
- absorb_hp: 흡혈 (amount, target)
- if: 조건부 (cond, then, else)
- random: 확률 (chance, then, else)
- on_user_death: 사용자 사망 시 (dsl)
- equip: 장비 장착 (slot: "weapon"|"shield"|"accessory")
- change_attribute: 속성 변경 (from, to, target)

[속성 시스템]
- 7대 속성: 無(무), 火(화), 水(수), 木(목), 土(토), 光(광), 暗(암)
- 상성: 火↔水, 木↔土
- 光: 방어 불가
- 暗: 1 이상의 피해 = 즉시 승천

[JSON 출력 예시]
{
  "name": "승천궁",
  "cardType": "weapon",
  "attribute": "光",
  "text": "25% 확률로 1의 광역 피해. 사용자가 승천 시, 75% 확률로 30의 피해를 주는 물귀신 작전을 펼친다.",
  "stats": { "attack": 1 },
  "dsl": [
    { "op": "damage", "amount": 1, "attribute": "光", "target": "all_others" },
    { "op": "random", "chance": 0.25, "then": [{ "op": "damage", "amount": 1, "attribute": "光", "target": "all_others" }] },
    { "op": "on_user_death", "dsl": [{ "op": "random", "chance": 0.75, "then": [{ "op": "damage", "amount": 30, "target": "all_others" }] }] }
  ]
}

[나쁜 예시 (절대 금지)]
- JSON 앞뒤에 설명 붙이기
- 코드 블록 사용: \`\`\`json\n{...}\n\`\`\`
- 유효하지 않은 disasterName
- 유효하지 않은 op 코드

출력은 오직 순수한 JSON 객체만 포함해야 합니다.`;

    const user = `{ "prompt": "${params.prompt}", "powerCap": ${params.powerCap} }`;

    let rawJson = await callGemini(system, user, params.temperature, apiKey);
    let jsonText = extractFirstJsonObject(rawJson);

    let artifactData;
    try {
      artifactData = sanitizeArtifact(JSON.parse(jsonText));
    } catch (e) {
      console.error("Model response is not valid JSON:", rawJson);
      throw new HttpsError("internal", "AI 모델이 유효한 JSON을 생성하지 못했습니다.", {raw: rawJson});
    }

    try {
      const newArtifactRef = db.collection("artifacts").doc();
      const newArtifactId = newArtifactRef.id;
      const score = (artifactData.dsl?.length || 1) * 2 + (artifactData.stats?.attack || 0) + (artifactData.stats?.defense || 0);
      
      const finalArtifact = {
        ...artifactData,
        id: newArtifactId,
        ownerUid: uid,
        checks: { banned: false, version: 1, validatorScore: score, errors: [] },
        status: "pending",
        meta: { model: GEMINI_MODEL, temperature: params.temperature },
        createdAt: FieldValue.serverTimestamp()
      };
      
      ArtifactSchema.parse(finalArtifact);
      await newArtifactRef.set(finalArtifact);
      return { ok: true, artifact: finalArtifact };

    } catch (e) {
      console.warn("Skipping invalid artifact from model:", artifactData, e.issues);
      const errorMessage = e.errors?.[0]?.message ? `${e.errors[0].path.join('.')} - ${e.errors[0].message}` : "AI가 유효하지 않은 형식의 성물을 생성했습니다.";
      throw new HttpsError("internal", errorMessage, { raw: rawJson });
    }
});


// ===================================
// ===== 전투 액션 함수들 (HTTPS) =====
// ===================================
export const apiPlayCard = functions.region("asia-northeast3").https.onCall(playCard);
export const apiReact = functions.region("asia-northeast3").https.onCall(react);
export const apiEndTurn = functions.region("asia-northeast3").https.onCall(endTurn);

/**
 * GodField 핵심 게임 플레이 액션 처리 함수
 * ATTACK, DEFEND, PRAY 등의 행동을 처리합니다.
 */
export const playerAction = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        const { uid } = context.auth;
        
        const { matchId, actionType, payload } = z.object({
            matchId: z.string(),
            actionType: z.enum(["ATTACK", "DEFEND", "PRAY", "USE_ARTIFACT", "TRADE", "DISCARD"]),
            payload: z.any().optional()
        }).parse(data);

        const matchRef = db.doc(`matches/${matchId}`);

        return await db.runTransaction(async (tx) => {
            const matchSnap = await tx.get(matchRef);
            if (!matchSnap.exists) throw new HttpsError("not-found", "매치를 찾을 수 없습니다.");

            const matchData = matchSnap.data();
            const player = matchData.players[uid];
            if (!player) throw new HttpsError("not-found", "플레이어를 찾을 수 없습니다.");

            // GodField 모드 확인
            if (!matchData.isGodFieldMode) {
                throw new HttpsError("failed-precondition", "이 액션은 GodField 모드에서만 사용 가능합니다.");
            }

            // 액션 타입별 처리
            switch (actionType) {
                case "ATTACK":
                    return handleAttack(tx, matchRef, matchData, uid, payload);
                case "DEFEND":
                    return handleDefend(tx, matchRef, matchData, uid, payload);
                case "PRAY":
                    return handlePray(tx, matchRef, matchData, uid, payload);
                default:
                    throw new HttpsError("unimplemented", `${actionType} 액션은 아직 구현되지 않았습니다.`);
            }
        });
    });

/**
 * ATTACK 액션 처리: 무기로 공격
 */
function handleAttack(tx, matchRef, matchData, uid, payload) {
    const { weaponCardId, targetUid } = z.object({
        weaponCardId: z.string(),
        targetUid: z.string()
    }).parse(payload);

    const player = matchData.players[uid];
    const target = matchData.players[targetUid];

    // 검증: 현재 플레이어의 턴인지 확인
    if (matchData.currentPlayerUid !== uid) {
        throw new HttpsError("failed-precondition", "당신의 턴이 아닙니다.");
    }

    // 검증: 메인 페이즈인지 확인
    if (matchData.phase !== 'main') {
        throw new HttpsError("failed-precondition", "메인 페이즈에서만 공격할 수 있습니다.");
    }

    // 검증: 타겟이 존재하는지 확인
    if (!target) {
        throw new HttpsError("not-found", "공격 대상을 찾을 수 없습니다.");
    }

    // 검증: 무기 카드가 손패에 있는지 확인
    const weaponIndex = player.hand.findIndex(c => (c.id || c.instanceId) === weaponCardId);
    if (weaponIndex === -1) {
        throw new HttpsError("not-found", "무기 카드가 손에 없습니다.");
    }

    const weaponCard = player.hand[weaponIndex];
    
    // 검증: 카드 타입이 무기인지 확인
    if (weaponCard.cardType !== 'weapon') {
        throw new HttpsError("invalid-argument", "무기 카드만 공격에 사용할 수 있습니다.");
    }

    // 장비 슬롯에 무기 장착
    player.equipment = player.equipment || { weapon: null, shield: null, accessory: null };
    player.equipment.weapon = weaponCard;
    
    // 손패에서 제거
    player.hand.splice(weaponIndex, 1);

    // 공격력 확인
    const attackPower = weaponCard.stats?.attack || 0;

    // phase를 'threat'로 변경하고 threatInfo 설정
    const updateData = {
        phase: 'threat',
        threatInfo: {
            attackerUid: uid,
            attackerName: player.nickname,
            targetUid: targetUid,
            targetName: target.nickname,
            weaponCard: weaponCard,
            attackPower: attackPower,
            attribute: weaponCard.attribute
        },
        [`players.${uid}`]: player
    };

    tx.update(matchRef, updateData);

    return { 
        ok: true, 
        message: `${player.nickname}이(가) ${weaponCard.name}(으)로 ${target.nickname}을(를) 공격합니다!` 
    };
}

/**
 * DEFEND 액션 처리: 방어구로 방어
 */
function handleDefend(tx, matchRef, matchData, uid, payload) {
    const { armorCardIds } = z.object({
        armorCardIds: z.array(z.string())
    }).parse(payload);

    const player = matchData.players[uid];

    // 검증: 현재 phase가 'threat'인지 확인
    if (matchData.phase !== 'threat') {
        throw new HttpsError("failed-precondition", "위협 페이즈에서만 방어할 수 있습니다.");
    }

    // 검증: 요청자가 공격 대상인지 확인
    if (matchData.threatInfo?.targetUid !== uid) {
        throw new HttpsError("failed-precondition", "당신이 공격 대상이 아닙니다.");
    }

    // 방어구 카드들 확인 및 수집
    const armorCards = [];
    let totalDefense = 0;
    const defenseAttributes = new Set();

    for (const cardId of armorCardIds) {
        const cardIndex = player.hand.findIndex(c => (c.id || c.instanceId) === cardId);
        if (cardIndex === -1) {
            throw new HttpsError("not-found", `방어구 카드 ${cardId}가 손에 없습니다.`);
        }

        const card = player.hand[cardIndex];
        if (card.cardType !== 'armor') {
            throw new HttpsError("invalid-argument", "방어구 카드만 방어에 사용할 수 있습니다.");
        }

        armorCards.push({ card, index: cardIndex });
        totalDefense += card.stats?.defense || 0;
        defenseAttributes.add(card.attribute);
    }

    // 공격 정보 가져오기
    const { attackPower, attribute: attackAttribute, weaponCard } = matchData.threatInfo;

    // 속성 상성 계산
    let finalDamage = attackPower;
    
    // 광속성: 방어 불가 (방어력 무시)
    if (attackAttribute === '光') {
        finalDamage = attackPower;
    } 
    // 암속성: 1 이상의 피해 = 즉사
    else if (attackAttribute === '暗' && attackPower >= 1) {
        // 방어 성공 여부 확인 (완전 방어 가능한 경우에만 생존)
        if (totalDefense >= attackPower && defenseAttributes.has('暗')) {
            finalDamage = 0; // 암속성 방어구로 완전 방어
        } else {
            // 즉사
            finalDamage = player.hp; // 현재 HP만큼 피해 = 즉사
        }
    }
    // 일반 속성: 방어력 적용 + 상성 체크
    else {
        finalDamage = Math.max(0, attackPower - totalDefense);
        
        // 상성: 火↔水, 木↔土
        const weaknesses = {
            '火': '水',
            '水': '火',
            '木': '土',
            '土': '木'
        };
        
        // 방어자가 공격자의 약점 속성을 가지고 있으면 피해 감소
        if (weaknesses[attackAttribute] && defenseAttributes.has(weaknesses[attackAttribute])) {
            finalDamage = Math.floor(finalDamage * 0.5); // 50% 감소
        }
        // 공격자가 방어자의 약점을 찌르면 피해 증가
        else if (Object.entries(weaknesses).some(([weak, strong]) => 
            attackAttribute === strong && defenseAttributes.has(weak)
        )) {
            finalDamage = Math.ceil(finalDamage * 1.5); // 50% 증가
        }
    }

    // HP 차감
    player.hp = Math.max(0, player.hp - finalDamage);

    // 방어에 사용한 카드들을 손패에서 제거 (역순으로 제거)
    armorCards.sort((a, b) => b.index - a.index);
    for (const { index, card } of armorCards) {
        player.hand.splice(index, 1);
        // 방어구를 장비 슬롯에 장착할 수도 있음 (첫 번째 방어구만)
        if (!player.equipment.shield && card === armorCards[0].card) {
            player.equipment.shield = card;
        }
    }

    // phase를 다시 'main'으로 되돌리고 threatInfo 초기화
    const updateData = {
        phase: 'main',
        threatInfo: null,
        [`players.${uid}`]: player
    };

    tx.update(matchRef, updateData);

    return { 
        ok: true, 
        message: `${player.nickname}이(가) ${finalDamage}의 피해를 받았습니다. (남은 HP: ${player.hp})` 
    };
}

/**
 * PRAY 액션 처리: 기도 (손패에 무기가 없을 때만 가능)
 */
function handlePray(tx, matchRef, matchData, uid, payload) {
    const player = matchData.players[uid];

    // 검증: 현재 플레이어의 턴인지 확인
    if (matchData.currentPlayerUid !== uid) {
        throw new HttpsError("failed-precondition", "당신의 턴이 아닙니다.");
    }

    // 검증: 메인 페이즈인지 확인
    if (matchData.phase !== 'main') {
        throw new HttpsError("failed-precondition", "메인 페이즈에서만 기도할 수 있습니다.");
    }

    // 검증: 손패에 무기가 없는지 확인
    const hasWeapon = player.hand.some(c => c.cardType === 'weapon');
    if (hasWeapon) {
        throw new HttpsError("failed-precondition", "손패에 무기가 있을 때는 기도할 수 없습니다.");
    }

    // 검증: 손패가 최소 1장 이상 있는지 확인
    if (player.hand.length < 1) {
        throw new HttpsError("failed-precondition", "버릴 카드가 없습니다.");
    }

    // 손패 1장 버리기 (첫 번째 카드)
    const discardedCard = player.hand.shift();
    
    // 공용 덱에서 2장 뽑기
    const drawnCards = [];
    if (matchData.commonDeck && matchData.commonDeck.length > 0) {
        drawnCards.push(matchData.commonDeck.pop());
    }
    if (matchData.commonDeck && matchData.commonDeck.length > 0) {
        drawnCards.push(matchData.commonDeck.pop());
    }
    
    player.hand.push(...drawnCards);

    // 턴 종료: 다음 플레이어로 넘기기
    const playerUids = Object.keys(matchData.players);
    const currentIndex = playerUids.indexOf(uid);
    const nextPlayerUid = playerUids[(currentIndex + 1) % playerUids.length];
    const nextPlayer = matchData.players[nextPlayerUid];

    // 다음 플레이어 드로우 (commonDeck에서 1장)
    if (matchData.commonDeck && matchData.commonDeck.length > 0) {
        nextPlayer.hand.push(matchData.commonDeck.pop());
    }
    nextPlayer.reactionUsedThisTurn = 0;

    const updateData = {
        currentPlayerUid: nextPlayerUid,
        turn: matchData.turn + 1,
        phase: 'main',
        [`players.${uid}`]: player,
        [`players.${nextPlayerUid}`]: nextPlayer,
        commonDeck: matchData.commonDeck
    };

    tx.update(matchRef, updateData);

    return { 
        ok: true, 
        message: `${player.nickname}이(가) 기도하여 ${drawnCards.length}장의 카드를 얻었습니다.` 
    };
}

// ===================================
// ===== 하위 호환성 함수 =====
// ===================================
// 기존 genCard와 genCharacter 함수는 하위 호환성을 위해 유지됩니다.
// 새로운 코드에서는 genArtifact와 genShin을 사용하세요.
export const genCard = genArtifact;
export const genCharacter = genShin;


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
 * 플레이어 준비 및 선택 사항 업데이트 함수 (GodField)
 */
const SetPlayerReadySchema = z.object({
    roomId: z.string(),
    shinId: z.string().optional(),
    selectedArtifactIds: z.array(z.string()).min(7).max(7).optional(),
    // 하위 호환성을 위해 유지
    characterId: z.string().optional(),
    selectedCardIds: z.array(z.string()).min(5).max(10).optional(),
    selectedSkills: z.array(z.string()).optional(),
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
        const { roomId, shinId, selectedArtifactIds, characterId, selectedCardIds, selectedSkills, ready } = SetPlayerReadySchema.parse(data);

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
                // GodField 모드: shin + artifacts
                if (shinId && selectedArtifactIds) {
                    if (selectedArtifactIds.length !== 7) {
                        throw new HttpsError("invalid-argument", "정확히 7개의 성물을 선택해야 합니다.");
                    }
                    player.shinId = shinId;
                    player.selectedArtifactIds = selectedArtifactIds;
                }
                // 하위 호환: character + cards
                else if (characterId && selectedCardIds) {
                    player.characterId = characterId;
                    player.selectedCardIds = selectedCardIds;
                    player.selectedSkills = selectedSkills || [];
                }
                else {
                    throw new HttpsError("invalid-argument", "준비 상태를 완료하려면 신과 성물(또는 캐릭터와 카드)을 모두 선택해야 합니다.");
                }
            }

            tx.update(roomRef, { players: roomData.players });
            return { ok: true };
        });
    });


/**
 * 게임 시작 함수 (GodField)
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

            // GodField 모드 확인: 첫 번째 플레이어가 shinId를 가지고 있는지 확인
            const isGodFieldMode = roomData.players[0].shinId !== undefined;

            let matchPlayers = {};
            let commonDeck = [];

            if (isGodFieldMode) {
                // === GodField 모드 ===
                // 1. 모든 플레이어의 신과 성물 정보 가져오기
                const shinPromises = roomData.players.map(p => db.doc(`shin/${p.shinId}`).get());
                const artifactPromises = roomData.players.map(p => {
                    return db.collection('artifacts').where('ownerUid', '==', p.uid).get();
                });
                
                const shinSnaps = await Promise.all(shinPromises);
                const artifactSnaps = await Promise.all(artifactPromises);

                const shins = shinSnaps.map(snap => snap.data());
                const allArtifacts = artifactSnaps.flatMap(snap => snap.docs.map(d => d.data()));
                
                // 2. 공용 덱 생성 및 셔플 (각 플레이어가 제출한 7장의 성물)
                roomData.players.forEach(p => {
                    const selected = new Set(p.selectedArtifactIds);
                    const playerArtifacts = allArtifacts.filter(a => selected.has(a.id));
                    playerArtifacts.forEach(artifact => {
                        commonDeck.push({
                            instanceId: `${artifact.id}_${Math.random().toString(36).substr(2, 9)}`,
                            artifactId: artifact.id,
                            ownerUid: p.uid,
                            cardType: artifact.cardType,
                            name: artifact.name,
                            attribute: artifact.attribute,
                            text: artifact.text,
                            stats: artifact.stats || {},
                            dsl: artifact.dsl,
                            disasterToApply: artifact.disasterToApply
                        });
                    });
                });
                commonDeck.sort(() => Math.random() - 0.5); // 셔플

                // 3. 매치 플레이어 상태 초기화 (GodField 스탯)
                roomData.players.forEach((p, idx) => {
                    const shin = shins[idx];
                    if (!shin) throw new HttpsError("not-found", `${p.nickname}의 신(${p.shinId})을 찾을 수 없습니다.`);
                    
                    matchPlayers[p.uid] = {
                        uid: p.uid,
                        nickname: p.nickname,
                        hp: 40, // GodField 시작 HP
                        mp: 10, // GodField 시작 MP
                        gold: 20, // GodField 시작 Gold
                        hand: commonDeck.splice(0, 9).map(card => ({...card})), // 시작 손패 9장
                        miracles: shin.uniqueMiracles.map(m => ({...m})), // 신의 고유 기적
                        equipment: {
                            weapon: null,
                            shield: null,
                            accessory: null
                        },
                        disasters: [] // 재앙 목록
                    };
                });
            } else {
                // === 하위 호환: 기존 모드 ===
                const cardPromises = roomData.players.map(p => db.collection('userCards').where('ownerUid', '==', p.uid).get());
                const charPromises = roomData.players.map(p => db.collection('userCharacters').where('ownerUid', '==', p.uid).get());
                
                const cardSnaps = await Promise.all(cardPromises);
                const charSnaps = await Promise.all(charPromises);

                const allCards = cardSnaps.flatMap(snap => snap.docs.map(d => d.data()));
                const allChars = charSnaps.flatMap(snap => snap.docs.map(d => d.data()));
                
                // 공용 덱 생성
                roomData.players.forEach(p => {
                    const selected = new Set(p.selectedCardIds);
                    commonDeck.push(...allCards.filter(c => selected.has(c.id)));
                });
                commonDeck.sort(() => Math.random() - 0.5);

                // 플레이어 상태 초기화
                roomData.players.forEach(p => {
                    const char = allChars.find(c => c.id === p.characterId);
                    if (!char) throw new HttpsError("not-found", `${p.nickname}의 캐릭터(${p.characterId})를 찾을 수 없습니다.`);
                    
                    matchPlayers[p.uid] = {
                        uid: p.uid,
                        nickname: p.nickname,
                        hp: char.hp,
                        maxHp: char.hp,
                        ki: 5,
                        maxKi: char.maxKi,
                        kiRegen: char.kiRegen,
                        hand: commonDeck.splice(0, 3),
                        skills: char.skills.filter(s => p.selectedSkills?.includes(s.name)) || [],
                        markers: [],
                        reactionUsedThisTurn: 0,
                    };
                });
            }

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
                threatInfo: null,
                isGodFieldMode: isGodFieldMode
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
 * 카드 삭제 함수 (하위 호환)
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
 * 성물 삭제 함수
 */
export const deleteArtifact = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const { uid } = context.auth;
        const { artifactId } = z.object({ artifactId: z.string() }).parse(data);

        const artifactRef = db.doc(`artifacts/${artifactId}`);
        const artifactSnap = await artifactRef.get();

        if (!artifactSnap.exists) {
            throw new HttpsError("not-found", "삭제할 성물을 찾을 수 없습니다.");
        }

        const artifactData = artifactSnap.data();
        if (artifactData.ownerUid !== uid) {
            throw new HttpsError("permission-denied", "자신이 생성한 성물만 삭제할 수 있습니다.");
        }
        
        if (artifactData.status !== 'pending' && artifactData.status !== 'approved') {
             throw new HttpsError("failed-precondition", "현재 상태에서는 성물을 삭제할 수 없습니다.");
        }

        await artifactRef.delete();

        return { ok: true };
    });

/**
 * 신 삭제 함수
 */
export const deleteShin = functions
    .region("asia-northeast3")
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const { uid } = context.auth;
        const { shinId } = z.object({ shinId: z.string() }).parse(data);

        const shinRef = db.doc(`shin/${shinId}`);
        const shinSnap = await shinRef.get();

        if (!shinSnap.exists) {
            throw new HttpsError("not-found", "삭제할 신을 찾을 수 없습니다.");
        }

        const shinData = shinSnap.data();
        if (shinData.ownerUid !== uid) {
            throw new HttpsError("permission-denied", "자신이 생성한 신만 삭제할 수 있습니다.");
        }
        
        if (shinData.status !== 'pending' && shinData.status !== 'approved') {
             throw new HttpsError("failed-precondition", "현재 상태에서는 신을 삭제할 수 없습니다.");
        }

        await shinRef.delete();

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
