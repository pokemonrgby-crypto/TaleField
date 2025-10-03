// functions/src/actions.js
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v1/https";
import { z } from "zod";

const db = getFirestore();

/**
 * 카드 사용 요청 처리 (메인 페이즈)
 */
export async function playCard(data, context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const { uid } = context.auth;
    const { matchId, cardId, targetUid } = z.object({
        matchId: z.string(),
        cardId: z.string(),
        targetUid: z.string().optional(),
    }).parse(data);

    const matchRef = db.doc(`matches/${matchId}`);
    
    return await db.runTransaction(async (tx) => {
        const matchSnap = await tx.get(matchRef);
        if (!matchSnap.exists) throw new HttpsError("not-found", "매치를 찾을 수 없습니다.");
        
        const matchData = matchSnap.data();
        const player = matchData.players[uid];

        // 1. 유효성 검사
        if (matchData.currentPlayerUid !== uid) throw new HttpsError("failed-precondition", "당신의 턴이 아닙니다.");
        if (matchData.phase !== 'main') throw new HttpsError("failed-precondition", "지금은 카드를 낼 수 없습니다.");
        
        const cardInHandIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardInHandIndex === -1) throw new HttpsError("not-found", "해당 카드가 손에 없습니다.");
        
        const card = player.hand[cardInHandIndex];
        if (player.ki < card.cost) throw new HttpsError("failed-precondition", "기력이 부족합니다.");

        // 2. 비용 지불 및 카드 이동 (손 -> 버린 덱)
        player.ki -= card.cost;
        player.hand.splice(cardInHandIndex, 1);
        matchData.discardPile.push(card);

        // 3. 스택에 카드 효과(DSL)를 Op 단위로 추가
        const newOps = card.dsl.map(op => ({
            ...op,
            casterUid: uid,
            targetUid: targetUid,
            cardName: card.name,
        }));
        
        const newStack = [...matchData.stack, ...newOps];

        // 4. Firestore 업데이트: phase를 'reaction'으로 변경하여 반응 창 열기
        tx.update(matchRef, {
            [`players.${uid}`]: player,
            discardPile: matchData.discardPile,
            stack: newStack,
            phase: 'reaction',
            // 7초 뒤에 resolve phase로 넘어가는 트리거를 위한 시간 설정
            reactionEndsAt: FieldValue.serverTimestamp() 
        });

        return { ok: true, message: "카드를 냈습니다. 상대방의 반응을 기다립니다." };
    });
}

/**
 * 반응 카드 사용 요청 처리 (리액션 페이즈)
 */
export async function react(data, context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const { uid } = context.auth;
    const { matchId, cardId, targetUid } = z.object({
        matchId: z.string(),
        cardId: z.string(),
        targetUid: z.string().optional(),
    }).parse(data);

    const matchRef = db.doc(`matches/${matchId}`);
    
    // playCard와 유사하지만, phase가 'reaction'일 때만 동작하도록 검사
    return await db.runTransaction(async (tx) => {
        const matchSnap = await tx.get(matchRef);
        if (!matchSnap.exists) throw new HttpsError("not-found", "매치를 찾을 수 없습니다.");
        
        const matchData = matchSnap.data();
        if (matchData.phase !== 'reaction') throw new HttpsError("failed-precondition", "지금은 반응 카드를 낼 수 없습니다.");

        // ... playCard와 동일한 로직 (유효성 검사, 비용 지불, 스택 추가) ...
        // 단, phase를 변경하지는 않음.
        
        return { ok: true, message: "반응했습니다." };
    });
}

/**
 * 턴 종료 요청 처리
 */
export async function endTurn(data, context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    const { uid } = context.auth;
    const { matchId } = z.object({ matchId: z.string() }).parse(data);

    const matchRef = db.doc(`matches/${matchId}`);

    return await db.runTransaction(async (tx) => {
        const matchSnap = await tx.get(matchRef);
        if (!matchSnap.exists) throw new HttpsError("not-found", "매치를 찾을 수 없습니다.");

        const matchData = matchSnap.data();
        if (matchData.currentPlayerUid !== uid) throw new HttpsError("failed-precondition", "당신의 턴이 아닙니다.");
        if (matchData.phase !== 'main' && matchData.phase !== 'end') throw new HttpsError("failed-precondition", "진행 중인 효과가 있어 턴을 마칠 수 없습니다.");

        // 다음 플레이어 결정 로직 (간단한 예시)
        const playerUids = Object.keys(matchData.players);
        const currentIndex = playerUids.indexOf(uid);
        const nextPlayerUid = playerUids[(currentIndex + 1) % playerUids.length];

        tx.update(matchRef, {
            // 턴 종료 시 처리할 내용 (마커 턴 감소 등)
            // ...
            currentPlayerUid: nextPlayerUid,
            turn: matchData.turn + 1,
            phase: 'main'
        });

        return { ok: true };
    });
}
