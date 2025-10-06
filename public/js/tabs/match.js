// public/js/tabs/match.js
import { onSnapshot, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db } from "../firebase.js";
import { state, on } from "../state.js";

const $ = (q) => document.querySelector(q);

const matchContainer = $("#view-match");
const playerListEl = $("#match-player-list");
const logEl = $("#match-log");
const myHandEl = $("#my-hand");
const myStateEl = $("#my-player-state");

let currentMatchId = null;
let unsubscribeMatch = null;

function renderPlayerState(player) {
    const el = document.createElement('div');
    el.className = 'player-status';
    const isMe = player.uid === auth.currentUser?.uid;
    const isCurrentTurn = state.match?.currentPlayerUid === player.uid;

    el.innerHTML = `
        <strong>${player.nickname} ${isMe ? '(나)' : ''} ${isCurrentTurn ? '⏳' : ''}</strong>
        <div>HP: ${player.hp}/${player.maxHp} | KI: ${player.ki}/${player.maxKi}</div>
        <div>Hand: ${player.hand?.length || 0}</div>
    `;
    return el;
}

function renderMyHand(hand = []) {
    myHandEl.innerHTML = "";
    hand.forEach(card => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.cardId = card.id;
        el.dataset.attr = card.attribute;
        el.innerHTML = `
            <div class="card__title"><span>[${card.cost}] ${card.name}</span></div>
            <div class="card__body" style="font-size:0.8rem; padding: 8px;">${card.text}</div>
        `;
        myHandEl.appendChild(el);
    });
}

function updateMatchView(matchData) {
    if (!matchData) {
        // 데이터가 없는 경우 UI 초기화
        playerListEl.innerHTML = "";
        logEl.innerHTML = "매치 정보를 불러오는 중...";
        myHandEl.innerHTML = "";
        myStateEl.innerHTML = "";
        return;
    }
    
    state.match = matchData; // 전역 상태에 매치 데이터 저장

    // 플레이어 목록 렌더링
    playerListEl.innerHTML = "";
    Object.values(matchData.players).forEach(p => {
        playerListEl.appendChild(renderPlayerState(p));
    });

    // 내 정보 및 손패 렌더링
    const myData = matchData.players[auth.currentUser?.uid];
    if (myData) {
        myStateEl.innerHTML = `HP: ${myData.hp}/${myData.maxHp} | KI: ${myData.ki}/${myData.maxKi}`;
        renderMyHand(myData.hand);
    }

    // 로그 렌더링
    logEl.innerHTML = (matchData.logs || []).map(l => `<div>${l.caster}: ${l.cardName} (${l.type})</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
}

function watchMatch(matchId) {
    if (unsubscribeMatch) unsubscribeMatch();

    const matchRef = doc(db, "matches", matchId);
    unsubscribeMatch = onSnapshot(matchRef, (doc) => {
        if (doc.exists()) {
            updateMatchView({ id: doc.id, ...doc.data() });
        } else {
            alert("진행 중인 게임을 찾을 수 없습니다. 로비로 돌아갑니다.");
            window.location.hash = '#lobby';
        }
    });
}

export function setMatchId(matchId) {
    if (currentMatchId === matchId) return;

    if (unsubscribeMatch) {
        unsubscribeMatch();
        unsubscribeMatch = null;
    }
    
    currentMatchId = matchId;
    state.matchId = matchId;

    if (matchId) {
        watchMatch(matchId);
    } else {
        updateMatchView(null);
    }
}

export function initMatchTab() {
    // 여기에 게임 내 액션 버튼(카드 사용, 턴 종료 등) 이벤트 리스너 추가
}
