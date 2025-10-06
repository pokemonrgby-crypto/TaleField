// public/js/tabs/match.js
import { onSnapshot, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, callPlayCard, callEndTurn } from "../firebase.js";
import { state, on } from "../state.js";

const $ = (q) => document.querySelector(q);

const playerListEl = $("#match-player-list");
const logEl = $("#match-log");
const myHandEl = $("#my-hand");
const myStateEl = $("#my-player-state");
const selectedCardDetailsEl = $("#selected-card-details");

// Action Panel Elements
const playCardBtn = $("#btn-play-card");
const endTurnBtn = $("#btn-end-turn");
const selectedCardNameEl = $("#selected-card-name");
const selectedTargetNameEl = $("#selected-target-name");

let currentMatchId = null;
let unsubscribeMatch = null;

let selectedCardId = null;
let selectedTargetUid = null;

function renderCardDetails(card) {
    if (!card) {
        selectedCardDetailsEl.innerHTML = `<p class="muted">카드를 선택하면 정보가 표시됩니다.</p>`;
        return;
    }
    selectedCardDetailsEl.innerHTML = `
        <h4>[${card.cost}] ${card.name}</h4>
        <p class="muted" style="font-size:0.85rem;">${card.attribute} / ${card.rarity} / ${card.type}</p>
        <p>${card.text}</p>
    `;
}

function updateActionPanel() {
    const myTurn = state.match?.currentPlayerUid === auth.currentUser?.uid;
    endTurnBtn.disabled = !myTurn;
    
    const myData = state.match?.players[auth.currentUser?.uid];
    const card = myData?.hand.find(c => c.id === selectedCardId);
    selectedCardNameEl.textContent = card?.name || "없음";
    
    const target = state.match?.players[selectedTargetUid];
    selectedTargetNameEl.textContent = target?.nickname || "없음";

    playCardBtn.disabled = !myTurn || !card || !target;
}

function selectCard(cardId) {
    selectedCardId = cardId;
    document.querySelectorAll('#my-hand .card').forEach(el => {
        el.classList.toggle('selected', el.dataset.cardId === cardId);
    });

    const myData = state.match?.players[auth.currentUser?.uid];
    const card = myData?.hand.find(c => c.id === cardId);
    renderCardDetails(card);

    updateActionPanel();
}

function selectTarget(uid) {
    selectedTargetUid = uid;
    document.querySelectorAll('#match-player-list .player-status').forEach(el => {
        el.classList.toggle('selected', el.dataset.uid === uid);
    });
    updateActionPanel();
}

function renderPlayerState(player) {
    const el = document.createElement('div');
    el.className = 'player-status';
    el.dataset.uid = player.uid;
    const isMe = player.uid === auth.currentUser?.uid;
    const isCurrentTurn = state.match?.currentPlayerUid === player.uid;

    el.innerHTML = `
        <strong>${player.nickname} ${isCurrentTurn ? '⏳' : ''}</strong>
        <div>HP: ${player.hp}/${player.maxHp} | KI: ${player.ki}/${player.maxKi}</div>
        <div>Hand: ${player.hand?.length || 0}</div>
    `;
    el.addEventListener('click', () => selectTarget(player.uid));
    return el;
}

function renderMyState(playerData) {
    if (!playerData) {
        myStateEl.innerHTML = "";
        return;
    }
    myStateEl.innerHTML = `
        <h4>내 상태</h4>
        <strong>${playerData.nickname} (나)</strong>
        <div>HP: ${playerData.hp}/${playerData.maxHp}</div>
        <div>KI: ${playerData.ki}/${playerData.maxKi}</div>
    `;
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
        el.addEventListener('click', () => selectCard(card.id));
        myHandEl.appendChild(el);
    });
}

function updateMatchView(matchData) {
    if (!matchData) {
        playerListEl.innerHTML = "";
        logEl.innerHTML = "매치 정보를 불러오는 중...";
        myHandEl.innerHTML = "";
        return;
    }
    
    state.match = matchData;

    playerListEl.innerHTML = "";
    Object.values(matchData.players).forEach(p => {
        if (p.uid !== auth.currentUser?.uid) { // 나를 제외한 다른 플레이어
            playerListEl.appendChild(renderPlayerState(p));
        }
    });

    const myData = matchData.players[auth.currentUser?.uid];
    if (myData) {
        renderMyState(myData);
        renderMyHand(myData.hand);
    }

    logEl.innerHTML = (matchData.logs || [])
        .slice(-50) // 최근 50개 로그만 표시
        .map(l => `<div>${l.message || `[${l.caster}] ${l.cardName} → ${l.target || ''} (${l.type}) ${l.amount || ''}`}</div>`)
        .join('') || '<div class="muted">게임 로그가 여기에 표시됩니다.</div>';
    logEl.scrollTop = logEl.scrollHeight;

    updateActionPanel();
}

async function handlePlayCard() {
    if (playCardBtn.disabled) return;
    playCardBtn.disabled = true;

    try {
        await callPlayCard({
            matchId: currentMatchId,
            cardId: selectedCardId,
            targetUid: selectedTargetUid,
        });
        selectCard(null);
        selectTarget(null);
    } catch (e) {
        alert(`카드 사용 실패: ${e.message}`);
    } finally {
        playCardBtn.disabled = false;
    }
}

async function handleEndTurn() {
    if (endTurnBtn.disabled) return;
    endTurnBtn.disabled = true;
    try {
        await callEndTurn({ matchId: currentMatchId });
    } catch (e) {
        alert(`턴 종료 실패: ${e.message}`);
    }
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
    if (unsubscribeMatch) unsubscribeMatch();
    
    currentMatchId = matchId;
    state.matchId = matchId;

    if (matchId) {
        watchMatch(matchId);
    } else {
        updateMatchView(null);
    }
}

export function initMatchTab() {
    playCardBtn.addEventListener('click', handlePlayCard);
    endTurnBtn.addEventListener('click', handleEndTurn);
}
