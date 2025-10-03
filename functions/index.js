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
const DAILY_CARD_LIMIT = 15; // 하루 생성 제한량

// --- Zod 스키마 정의 (카드 생성 및 요청) ---
// ... (이전과 동일한 Op, CardSchema 등)
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
]));

const CardSchema = z.object({
  id: z.string(), // ID는 서버에서 생성 후 삽입하므로, regex 제거
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
  }).optional()
});

const GenCardsReqSchema = z.object({
  prompt: z.string().min(5).max(150),
  powerCap: z.number().int().min(1).max(20).default(10),
  temperature: z.number().min(0).max(1).default(0.8)
});


// --- Gemini API 호출 헬퍼 (이전과 동일) ---
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


/**
 * AI를 호출하여 카드 1장을 생성합니다.
 */
export const genCard = functions
  .region("us-central1")
  .runWith({ secrets: [GEMINI_API_KEY], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    
    const uid = context.auth.uid;
    const apiKey = GEMINI_API_KEY.value();
    const params = GenCardsReqSchema.parse(data);

    // --- 하루 생성 제한량 체크 (트랜잭션) ---
    const profileRef = db.doc(`profiles/${uid}`);
    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
      
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

      // 제한을 통과하면 카운트 업데이트 예약
      tx.set(profileRef, {
        lastCardCreationDate: today,
        cardCreationCount: count + 1
      }, { merge: true });
    });

    // --- AI 프롬프트 강화 ---
    const validMarkers = ["취약", "강화", "독", "재생", "침묵", "도발", "빙결"];
    const system =
`당신은 천재 카드 게임 디자이너입니다. 사용자의 프롬프트를 해석하여, 아래 스키마에 맞는 카드 1장을 설계합니다.
결과는 반드시 **JSON 객체** 형식으로만 출력해야 합니다.

[출력 JSON 스키마]
- id: (이 필드는 생성하지 않습니다)
- ownerUid: "${uid}" (고정)
- name: "카드 이름" (한글)
- type: "skill" | "spell" | "attachment"
- rarity: "normal" | "rare" | "epic"
- attribute: "fire" | "water" | "wind" | "earth" | "light" | "dark" | "neutral"
- keywords: 문자열 배열 (최대 2개)
- cost: 0~10 사이의 정수.
- cooldownTurns: 0~5 사이의 정수.
- dsl: DSL Op 객체 배열.
- text: dsl 동작을 설명하는 자연스러운 한국어 문장.
- checks, status, meta: 기본값으로 고정된 객체.

[DSL 명세]
- Op 종류: damage, heal, shield, draw, discard, addMarker, setVar, if
- **중요**: 'addMarker' Op의 'name' 필드는 반드시 다음 목록 중 하나여야 합니다: ${JSON.stringify(validMarkers)}
- 존재하지 않는 효과를 만들지 마십시오.

[요구사항]
- **단 1개의 카드**만 생성하고, 완벽한 JSON 객체 형식으로 출력하십시오.
- **절대로 JSON 형식 외의 다른 텍스트(주석, 설명 등)를 포함하지 마십시오.**`;

    const user = `{ "prompt": "${params.prompt}", "powerCap": ${params.powerCap} }`;

    let rawJson = await callGemini(system, user, params.temperature, apiKey);
    
    // 모델이 Markdown 코드 블록을 포함하는 경우 대비
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
      // --- ID 생성 및 데이터 저장 ---
      const newCardRef = db.collection("userCards").doc(); // Firestore가 고유 ID 생성
      const newCardId = newCardRef.id;

      const score = (cardData.dsl?.length || 1) * 2 + (cardData.cost || 0) * 1.5;
      
      const finalCard = {
        ...cardData,
        id: newCardId, // 생성된 고유 ID 삽입
        ownerUid: uid,
        checks: { banned: false, version: 1, validatorScore: score, errors: [] },
        status: "pending",
        meta: { model: GEMINI_MODEL, temperature: params.temperature },
        createdAt: FieldValue.serverTimestamp()
      };
      
      CardSchema.parse(finalCard); // 최종 데이터 유효성 검사
      
      await newCardRef.set(finalCard);
      
      return { ok: true, card: finalCard };

    } catch (e) {
      console.warn("Skipping invalid card from model:", cardData, e.issues);
      throw new HttpsError("internal", "AI가 유효하지 않은 형식의 카드를 생성했습니다.");
    }
});
