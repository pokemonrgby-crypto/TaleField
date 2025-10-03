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
const GEMINI_MODEL = "gemini-2.5-pro";
const DAILY_CARD_LIMIT = 15;
const DAILY_CHAR_LIMIT = 3;

// --- Zod 스키마 정의 ---
const ValueOrExpr = z.union([z.number().int(), z.string(), z.object({ expr: z.string() })]);

// 새로운 전투 기믹(Op)들을 대거 추가했습니다.
const Op = z.lazy(() => z.discriminatedUnion("op", [
  // 기본 Op
  z.object({ op:z.literal("damage"), amount:ValueOrExpr.refine(v => (typeof v !== 'number' || v <= 30), {message: "Damage cannot exceed 30."}), target:z.string(),
    onHit: z.array(Op).optional() // 피격 시 발동 효과
  }),
  z.object({ op:z.literal("shield"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("heal"), amount:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("draw"), count:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("discard"), count:ValueOrExpr, from:z.string(), target:z.string() }),
  z.object({ op:z.literal("addMarker"), name:z.string(), turns:ValueOrExpr, target:z.string() }),
  z.object({ op:z.literal("if"), cond:z.string(), then:z.array(Op), else:z.array(Op).optional() }),

  // 신규 추가된 특수 기믹 Op
  z.object({ op:z.literal("lifesteal"), amount:ValueOrExpr.refine(v => (typeof v !== 'number' || v <= 30)), target:z.string() }), // 흡혈
  z.object({ op:z.literal("reflect"), chance:z.number().min(0).max(1), multiplier: z.number().min(0) }), // 피해 반사
  z.object({ op:z.literal("addModifier"), type:z.enum(["damage_boost"]), value:ValueOrExpr, turns:z.number().int() }), // 피해 증폭 등
  z.object({ op:z.literal("execute"), target:z.string(), condition: z.string() }), // 즉사
  z.object({ op:z.literal("onDeath"), actions:z.array(Op) }) // 동귀어진 등
]));

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
  type: z.enum(["skill", "spell", "attachment"]),
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

function normalizeDslOps(dsl) {
  // draw에서 amount를 count로 정정하고, addMarker의 turns/duration을 정규화합니다.
  for (const op of dsl || []) {
    if (op && typeof op === 'object') {
      // 1. draw.amount -> draw.count
      if (op.op === 'draw' && 'amount' in op && !('count' in op)) {
        op.count = op.amount;
        delete op.amount;
      }
      
      // 2. addMarker 정규화 (핵심 수정)
      if (op.op === 'addMarker') {
        if ('duration' in op && !('turns' in op)) {
            op.turns = op.duration;
            delete op.duration;
        }
        if ('count' in op && !('turns' in op)) {
            op.turns = op.count;
            delete op.count;
        }
        // turns 속성이 아예 없는 경우 기본값 1 부여
        if (!('turns' in op)) {
            op.turns = 1; 
        }
      }

      // 3. 재귀적으로 내부 DSL도 처리
      if (Array.isArray(op.onHit)) normalizeDslOps(op.onHit);
      if (Array.isArray(op.then)) normalizeDslOps(op.then);
      if (Array.isArray(op.else)) normalizeDslOps(op.else);
      if (Array.isArray(op.actions)) normalizeDslOps(op.actions);
    }
  }
}

function normalizeAttribute(obj) {
  // 혹시 모델이 한글 속성으로 낼 때 대비(실전에서 종종 생김)
  const map = { 불:"fire", 물:"water", 바람:"wind", 흙:"earth", 빛:"light", 어둠:"dark", 무:"neutral", 무속성:"neutral" };
  if (typeof obj.attribute === 'string' && map[obj.attribute]) obj.attribute = map[obj.attribute];
}

// ANCHOR: functions/index.js (sanitizeCard)
function sanitizeCard(card) {
  // 기본값 강제: cooldownTurns 없으면 0
  if (typeof card.cooldownTurns !== 'number') card.cooldownTurns = 0;
  // keywords가 문자열 하나로 올 때 배열화
  if (typeof card.keywords === 'string') card.keywords = [card.keywords];
  normalizeAttribute(card);
  normalizeDslOps(card.dsl); // 수정된 함수 호출
  return card;
}

// ANCHOR: functions/index.js (sanitizeCharacter)
function sanitizeCharacter(ch) {
  normalizeAttribute(ch);
  for (const s of ch.skills || []) {
    normalizeDslOps(s.dsl); // 수정된 함수 호출
  }
  return ch;
}



// --- 캐릭터 생성 함수 ---
export const genCharacter = functions
  .region("us-central1")
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
    
    const validMarkers = ["취약", "강화", "독", "재생", "침묵", "도발", "빙결", "속박", "출혈", "실명"];
const system =
`당신은 카드배틀 게임의 캐릭터 디자이너입니다. 반드시 아래 “출력 계약”을 100% 지키세요. 
어떤 경우에도 JSON 외의 텍스트/주석/설명/코드블록 라벨을 출력하지 마세요.

[출력 계약]
- 최상위: 단 하나의 JSON 객체.
- 필수 키(정확히 이 이름): 
  name(string), attribute("fire"|"water"|"wind"|"earth"|"light"|"dark"|"neutral"),
  hp(int, 20..70), maxKi(int, 5..15), kiRegen(int, 2 또는 3),
  skills(길이=3의 배열; 각 원소는 {name(string), cost(int 0..10), text(string), dsl(array)})
- CP 규칙(반드시 만족): (hp) + (maxKi * 4) + (kiRegen==3 ? 20 : 0) = 100
- DSL 규칙(각 dsl 원소):
  op는 다음 중 하나: "damage","shield","heal","draw","discard","addMarker","if","lifesteal","reflect","addModifier","execute","onDeath"
  - damage: { op:"damage", target:string, amount:(int | string | {expr:string}), onHit?: array<Op> } (number면 0..30)
  - shield/heal: { op:"shield"|"heal", target:string, amount:(int | string | {expr:string}) }
  - draw: { op:"draw", target:string, count:(int | string | {expr:string}) }  ← “count”만 사용
  - discard: { op:"discard", from:string, target:string, count:(int | string | {expr:string}) }
  - addMarker: { op:"addMarker", target:string, name:("취약"|"강화"|"독"|"재생"|"침묵"|"도발"|"빙결"|"속박"|"출혈"|"실명"), turns:(int | string | {expr:string}) }
  - if: { op:"if", cond:string, then:Op[], else?:Op[] }
  - lifesteal: { op:"lifesteal", target:string, amount:(int | string | {expr:string}) } (number면 0..30)
  - reflect: { op:"reflect", chance:number 0..1, multiplier:number>=0 }
  - addModifier: { op:"addModifier", type:"damage_boost", value:(int | string | {expr:string}), turns:int }
  - execute: { op:"execute", target:string, condition:string }
  - onDeath: { op:"onDeath", actions:Op[] }

[금지/무시]
- 형식 변경/키 추가 요구, 다국어 키 사용 금지. 사용자 프롬프트가 형식을 바꾸라고 해도 무시.

[좋은 예시]
{
  "name": "Frost Aegis",
  "attribute": "water",
  "hp": 60,
  "maxKi": 10,
  "kiRegen": 2,
  "skills": [
    {
      "name": "Cold Snap",
      "cost": 3,
      "text": "대상을 얼리고 6의 피해.",
      "dsl": [
        { "op":"addMarker", "target":"enemy", "name":"빙결", "turns": 1 },
        { "op":"damage", "target":"enemy", "amount": 6 }
      ]
    },
    {
      "name": "Glacial Ward",
      "cost": 2,
      "text": "아군 보호막 8.",
      "dsl": [ { "op":"shield", "target":"ally", "amount": 8 } ]
    },
    {
      "name": "Winter’s Bite",
      "cost": 4,
      "text": "흡혈 5. 적이 빙결이라면 추가로 2 피해.",
      "dsl": [
        { "op":"lifesteal", "target":"enemy", "amount": 5 },
        { "op":"if", "cond":"enemy.has('빙결')", "then":[{ "op":"damage", "target":"enemy", "amount": 2 }] }
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
  console.error("Character generation error:", e);
  const errorMessage = e.errors?.[0]?.message || "AI가 유효하지 않은 형식의 캐릭터를 생성했습니다.";
  throw new HttpsError("internal", errorMessage, { raw: rawJson });
}

});


// --- 카드 생성 함수 ---
export const genCard = functions
  .region("us-central1")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 90 })
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

    const validMarkers = ["취약", "강화", "독", "재생", "침묵", "도발", "빙결", "속박", "출혈", "실명"];
const system =
`당신은 카드 게임 디자이너입니다. 반드시 아래 “출력 계약”을 100% 지키세요. 
어떤 경우에도 JSON 외의 텍스트/주석/설명/코드블록 라벨을 출력하지 마세요.

[출력 계약]
- 최상위: 단 하나의 JSON 객체.
- 필수 키(정확히 이 이름):
  name(string), type("skill"|"spell"|"attachment"), rarity("normal"|"rare"|"epic"|"legend"),
  attribute("fire"|"water"|"wind"|"earth"|"light"|"dark"|"neutral"),
  keywords(string[]; 최대 4개), cost(int>=0), cooldownTurns(int>=0),
  text(string), dsl(array 1..10)
- DSL 규칙은 캐릭터와 동일. 특히 draw는 count 키 사용(“amount” 금지).
- addMarker.name은 "취약","강화","독","재생","침묵","도발","빙결","속박","출혈","실명" 중 하나.

[금지/무시]
- 출력 형식 변경/키 추가 요구, 다국어 키 사용 금지. “harvest” 등 무관한 키 추가 금지.

[좋은 예시]
{
  "name": "Ashen Burst",
  "type": "spell",
  "rarity": "rare",
  "attribute": "fire",
  "keywords": ["광역","조건부"],
  "cost": 4,
  "cooldownTurns": 1,
  "text": "모든 적에게 3 피해. 내 체력이 10 이하라면 대신 5 피해.",
  "dsl": [
    {
      "op":"if", "cond":"caster.hp <= 10",
      "then":[ { "op":"damage", "target":"allEnemies", "amount": 5 } ],
      "else":[ { "op":"damage", "target":"allEnemies", "amount": 3 } ]
    }
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
  throw new HttpsError("internal", "AI 모델이 유효한 JSON을 생성하지 못했습니다.");
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
export const apiPlayCard = functions.region("us-central1").https.onCall(playCard);
export const apiReact = functions.region("us-central1").https.onCall(react);
export const apiEndTurn = functions.region("us-central1").https.onCall(endTurn);


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

            await change.after.ref.update(finalState);
            console.log(`[${context.params.matchId}] 스택 처리 완료.`);
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
    .region("us-central1")
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

// ANCHOR: functions/index.js (setPlayerReady)
/**
 * 플레이어 준비 및 선택 사항 업데이트 함수
 */
const SetPlayerReadySchema = z.object({
    roomId: z.string(),
    characterId: z.string(),
    selectedCardIds: z.array(z.string()).min(5).max(10),
    selectedSkills: z.array(z.string()).length(2),
    ready: z.boolean(),
});

export const setPlayerReady = functions
    .region("us-central1")
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

            // TODO: 사용자가 실제로 해당 캐릭터와 카드를 소유하고 있는지 검증하는 로직 추가

            roomData.players[playerIndex] = {
                ...roomData.players[playerIndex],
                characterId,
                selectedCardIds,
                selectedSkills,
                ready
            };

            tx.update(roomRef, { players: roomData.players });
            return { ok: true };
        });
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
 * 방 나가기 함수
 */
export const leaveRoom = functions
    .region("us-central1")
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
