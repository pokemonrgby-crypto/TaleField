// functions/src/actions.js
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v1/https";
import { z } from "zod";

/**
 * 카드 사용 요청 처리 (메인 페이즈)
 */
export async function playCard(data, context) {
    const db = getFirestore();
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

        if (matchData.currentPlayerUid !== uid) throw new HttpsError("failed-precondition", "당신의 턴이 아닙니다.");
        if (matchData.phase !== 'main') throw new HttpsError("failed-precondition", "지금은 카드를 낼 수 없습니다.");
        
        const cardInHandIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardInHandIndex === -1) throw new HttpsError("not-found", "해당 카드가 손에 없습니다.");
        
        const card = player.hand[cardInHandIndex];
        if (player.ki < card.cost) throw new HttpsError("failed-precondition", "기력이 부족합니다.");

        player.ki -= card.cost;
        player.hand.splice(cardInHandIndex, 1);
        matchData.discardPile.push(card);

        const newOps = card.dsl.map(op => ({
            ...op,
            casterUid: uid,
            targetUid: targetUid || uid, // 타겟이 없으면 자기 자신
            cardName: card.name,
        }));
        
        const newStack = [...matchData.stack, ...newOps];

        tx.update(matchRef, {
            [`players.${uid}`]: player,
            discardPile: matchData.discardPile,
            stack: newStack,
            phase: 'reaction',
            reactionEndsAt: FieldValue.serverTimestamp() 
        });

        return { ok: true, message: "카드를 냈습니다." };
    });
}

/**
 * 반응 카드 사용 요청 처리 (리액션 페이즈)
 */
export async function react(data, context) {
    const db = getFirestore();
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

        if (matchData.phase !== 'reaction') throw new HttpsError("failed-precondition", "지금은 반응 카드를 낼 수 없습니다.");
        
        const cardInHandIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardInHandIndex === -1) throw new HttpsError("not-found", "해당 카드가 손에 없습니다.");
        
        const card = player.hand[cardInHandIndex];
        if (card.type !== 'reaction') throw new HttpsError("failed-precondition", "반응 타입의 카드가 아닙니다.");
        if (player.ki < card.cost) throw new HttpsError("failed-precondition", "기력이 부족합니다.");
        if ((player.reactionUsedThisTurn || 0) >= 2) throw new HttpsError("failed-precondition", "이번 턴에 반응 카드를 더 이상 낼 수 없습니다.");

        player.ki -= card.cost;
        player.reactionUsedThisTurn = (player.reactionUsedThisTurn || 0) + 1;
        player.hand.splice(cardInHandIndex, 1);
        matchData.discardPile.push(card);

        const newOps = card.dsl.map(op => ({
            ...op,
            casterUid: uid,
            targetUid: targetUid,
            cardName: card.name,
        }));
        
        const newStack = [...newOps, ...matchData.stack];

        tx.update(matchRef, {
            [`players.${uid}`]: player,
            discardPile: matchData.discardPile,
            stack: newStack,
        });

        return { ok: true, message: "반응했습니다." };
    });
}

/**
 * 턴 종료 요청 처리
 */
export async function endTurn(data, context) {
    const db = getFirestore();
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

        const playerUids = Object.keys(matchData.players);
        const currentIndex = playerUids.indexOf(uid);
        const nextPlayerUid = playerUids[(currentIndex + 1) % playerUids.length];
        
        // ▼▼▼▼▼ 수정된 부분 ▼▼▼▼▼
        const nextPlayer = matchData.players[nextPlayerUid];
        const kiRegen = nextPlayer.kiRegen || 2; // 기본값 설정
        nextPlayer.ki = Math.min(nextPlayer.maxKi, nextPlayer.ki + kiRegen);
        
        // 덱에 카드가 있으면 한 장 드로우
        if (matchData.commonDeck && matchData.commonDeck.length > 0) {
            nextPlayer.hand.push(matchData.commonDeck.pop());
        }
        nextPlayer.reactionUsedThisTurn = 0;

        tx.update(matchRef, {
            currentPlayerUid: nextPlayerUid,
            turn: matchData.turn + 1,
            phase: 'main',
            [`players.${nextPlayerUid}`]: nextPlayer,
            commonDeck: matchData.commonDeck
        });
        // ▲▲▲▲▲ 수정된 부분 ▲▲▲▲▲

        return { ok: true };
    });
}
