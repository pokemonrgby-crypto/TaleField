// functions/index.js
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { HttpsError } from "firebase-functions/v1/https";
import { z } from "zod";
import fetch from "cross-fetch";

try { initializeApp(); } catch (_) {}
const db = getFirestore();

const GEMINI_API_KEY = functions.params.defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-2.5-flash";
const DAILY_CARD_LIMIT = 15;
const DAILY_CHAR_LIMIT = 3;

// --- Zod 스키마 정의 ---
const ValueOrExpr = z.union([z.number().int(), z.string(), z.object({ expr: z.string() })]);

// 새로운 전투 기믹(Op)들을 대거 추가했습니다.
const Op = z.lazy(() => z.union([
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
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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
`당신은 정교한 룰을 따르는 게임 캐릭터 디자이너입니다. 사용자의 프롬프트를 해석하여, 아래 정의된 **'캐릭터 포인트(CP)'** 규칙을 반드시 준수하는 캐릭터 1명을 생성합니다.

[캐릭터 포인트(CP) 규칙]
- 모든 캐릭터는 **총 100 CP**를 가집니다.
- **HP**: 1 CP = 1 HP. (최소 20, 최대 70)
- **maxKi (최대 코스트)**: 4 CP = 1 maxKi. (최소 5, 최대 15)
- **kiRegen (코스트 회복량)**: 기본 2. **20 CP**를 소모하여 3으로 영구 강화 가능.
- **계산식**: \`(HP) + (maxKi * 4) + (kiRegen이 3이면 20, 아니면 0) = 100\` 이 공식을 반드시 만족해야 합니다.
- **예시**: (HP:80, maxKi:5, kiRegen:2) -> 80 + 20 + 0 = 100 (정상)
- **예시**: (HP:40, maxKi:10, kiRegen:3) -> 40 + 40 + 20 = 100 (정상)

[출력 JSON 스키마]
- name, attribute, hp, maxKi, kiRegen
- skills: 스킬 객체 3개의 배열 (name, cost, text, dsl)

[DSL 명세]
- Op 종류: damage(최대 30, onHit 가능), shield, heal, draw, addMarker, if, lifesteal, reflect, addModifier, execute, onDeath
- 'addMarker'의 'name'은 다음 중 하나여야 합니다: ${JSON.stringify(validMarkers)}

[요구사항]
- **CP 규칙 준수**가 가장 중요합니다. 프롬프트에 맞춰 스탯을 창의적으로 분배하십시오.
- **새로운 기믹(lifesteal, onHit, execute 등)을 적극적으로 활용**하여 흥미로운 스킬을 설계하십시오.
- **단 1명의 캐릭터** 정보만 완벽한 JSON 객체 형식으로 출력하십시오.
- **절대로 JSON 형식 외의 다른 텍스트(주석, 설명 등)를 포함하지 마십시오.**`;

    const user = `{ "prompt": "${prompt}", "power": 20 }`;
    let rawJson = await callGemini(system, user, temperature, apiKey);
    const jsonMatch = rawJson.match(/\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    try {
        const charData = JSON.parse(rawJson);
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

    const validMarkers = ["취약", "강화", "독", "재생", "침묵", "도발", "빙결", "속박", "출혈", "실명"];
    const system =
`당신은 천재 카드 게임 디자이너입니다. 사용자의 프롬프트를 해석하여, 아래 스키마에 맞는 카드 1장을 설계합니다.
결과는 반드시 **JSON 객체** 형식으로만 출력해야 합니다.

[출력 JSON 스키마]
- id: (이 필드는 생성하지 않습니다)
- ownerUid: "${uid}" (고정)
- name, type, rarity, attribute, keywords, cost, cooldownTurns, dsl, text

[DSL 명세]
- Op 종류: damage(최대 30, onHit 가능), shield, heal, draw, discard, addMarker, if, lifesteal, reflect, addModifier, execute, onDeath
- **새로운 기믹(lifesteal, reflect, onHit, execute 등)을 적극적으로 활용**하여 흥미로운 카드를 설계하십시오.
- 'addMarker'의 'name'은 다음 중 하나여야 합니다: ${JSON.stringify(validMarkers)}

[요구사항]
- **단 1개의 카드**만 생성하고, 완벽한 JSON 객체 형식으로 출력하십시오.
- **절대로 JSON 형식 외의 다른 텍스트(주석, 설명 등)를 포함하지 마십시오.**`;

    const user = `{ "prompt": "${params.prompt}", "powerCap": ${params.powerCap} }`;

    let rawJson = await callGemini(system, user, params.temperature, apiKey);
    
    const jsonMatch = rawJson.match(/\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    let cardData;
    try {
      cardData = JSON.parse(rawJson);
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
      throw new HttpsError("internal", "AI가 유효하지 않은 형식의 카드를 생성했습니다.");
    }
});
