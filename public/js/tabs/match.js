// public/js/tabs/match.js
import { onSnapshot, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, callPlayCard, callEndTurn, callPlayerAction } from "../firebase.js";
import { state, on } from "../state.js";

const $ = (q) => document.querySelector(q);

const playerListEl = $("#match-player-list");
const logEl = $("#match-log");
const myHandEl = $("#my-hand");
const myStateEl = $("#my-player-state");
const selectedCardDetailsEl = $("#selected-card-details");

// GodField UI elements
const myHpEl = $("#my-hp");
const myMpEl = $("#my-mp");
const myGoldEl = $("#my-gold");
const myMiraclesEl = $("#my-miracles");
const myDisastersEl = $("#my-disasters");
const equipmentWeaponEl = $("#equipment-weapon");
const equipmentShieldEl = $("#equipment-shield");
const equipmentAccessoryEl = $("#equipment-accessory");

// Action Panel Elements
const playCardBtn = $("#btn-play-card");
const endTurnBtn = $("#btn-end-turn");
const selectedCardNameEl = $("#selected-card-name");
const selectedTargetNameEl = $("#selected-target-name");

// GodField Action Buttons
const godFieldActionsEl = $("#godfield-actions");
const attackBtn = $("#btn-attack");
const defendBtn = $("#btn-defend");
const prayBtn = $("#btn-pray");

let currentMatchId = null;
let unsubscribeMatch = null;

let selectedCardId = null;
let selectedTargetUid = null;

// Prevent duplicate calls
let isActionInProgress = false;

function renderCardDetails(card) {
    if (!card) {
        selectedCardDetailsEl.innerHTML = `<p class="muted">카드를 선택하면 정보가 표시됩니다.</p>`;
        return;
    }
    
    const isGodFieldMode = state.match?.isGodFieldMode;
    
    if (isGodFieldMode) {
        const typeIcon = {
            weapon: "⚔️",
            armor: "🛡️",
            item: "📦",
            miracle: "✨"
        };
        
        const statsHTML = card.stats ? Object.entries(card.stats)
            .map(([key, val]) => `<div>${key}: ${val}</div>`)
            .join('') : '';
        
        selectedCardDetailsEl.innerHTML = `
            <h4>${typeIcon[card.cardType] || ''} ${card.name}</h4>
            <p class="muted" style="font-size:0.85rem;">타입: ${card.cardType} | 속성: ${card.attribute}</p>
            ${statsHTML ? `<div style="margin: 8px 0; padding: 8px; background: var(--bg-input); border-radius: 4px;">${statsHTML}</div>` : ''}
            <p>${card.text}</p>
        `;
    } else {
        selectedCardDetailsEl.innerHTML = `
            <h4>[${card.cost}] ${card.name}</h4>
            <p class="muted" style="font-size:0.85rem;">${card.attribute} / ${card.rarity} / ${card.type}</p>
            <p>${card.text}</p>
        `;
    }
}

function updateActionPanel() {
    const myTurn = state.match?.currentPlayerUid === auth.currentUser?.uid;
    const isGodFieldMode = state.match?.isGodFieldMode;
    const phase = state.match?.phase;
    const myData = state.match?.players[auth.currentUser?.uid];
    
    endTurnBtn.disabled = !myTurn || isActionInProgress;
    
    const card = myData?.hand.find(c => (c.id || c.instanceId) === selectedCardId);
    selectedCardNameEl.textContent = card?.name || "없음";
    
    const target = state.match?.players[selectedTargetUid];
    selectedTargetNameEl.textContent = target?.nickname || "없음";

    playCardBtn.disabled = !myTurn || !card || !target || isActionInProgress;
    
    // GodField 액션 패널 표시/숨김
    if (isGodFieldMode && godFieldActionsEl) {
        godFieldActionsEl.style.display = 'block';
        
        // ATTACK 버튼: 내 턴, 메인 페이즈, 무기 카드 선택, 대상 선택
        const isWeapon = card?.cardType === 'weapon';
        attackBtn.disabled = !myTurn || phase !== 'main' || !isWeapon || !selectedTargetUid || isActionInProgress;
        
        // DEFEND 버튼: threat 페이즈, 내가 공격 대상, 방어구 카드 선택
        const isArmor = card?.cardType === 'armor';
        const amUnderAttack = phase === 'threat' && state.match?.threatInfo?.targetUid === auth.currentUser?.uid;
        defendBtn.disabled = !amUnderAttack || !isArmor || isActionInProgress;
        
        // PRAY 버튼: 내 턴, 메인 페이즈, 손패에 무기 없음
        const hasWeaponInHand = myData?.hand.some(c => c.cardType === 'weapon');
        prayBtn.disabled = !myTurn || phase !== 'main' || hasWeaponInHand || isActionInProgress;
    } else if (godFieldActionsEl) {
        godFieldActionsEl.style.display = 'none';
    }
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

    // GodField 모드 확인
    const isGodFieldMode = state.match?.isGodFieldMode;
    
    if (isGodFieldMode) {
        el.innerHTML = `
            <strong>${player.nickname} ${isCurrentTurn ? '⏳' : ''}</strong>
            <div>HP: ${player.hp}/99 | MP: ${player.mp}/99</div>
            <div>Gold: ${player.gold}/99 | Hand: ${player.hand?.length || 0}</div>
        `;
    } else {
        el.innerHTML = `
            <strong>${player.nickname} ${isCurrentTurn ? '⏳' : ''}</strong>
            <div>HP: ${player.hp}/${player.maxHp || 99} | KI: ${player.ki}/${player.maxKi || 99}</div>
            <div>Hand: ${player.hand?.length || 0}</div>
        `;
    }
    
    el.addEventListener('click', () => selectTarget(player.uid));
    return el;
}

function renderMyState(playerData) {
    if (!playerData) return;
    
    const isGodFieldMode = state.match?.isGodFieldMode;
    
    if (isGodFieldMode && myHpEl && myMpEl && myGoldEl) {
        // GodField 모드: 별도 UI 요소에 렌더링
        myHpEl.textContent = `${playerData.hp}/99`;
        myMpEl.textContent = `${playerData.mp}/99`;
        myGoldEl.textContent = `${playerData.gold}/99`;
        
        // 장비 렌더링
        if (equipmentWeaponEl) {
            equipmentWeaponEl.textContent = playerData.equipment?.weapon?.name || "없음";
        }
        if (equipmentShieldEl) {
            equipmentShieldEl.textContent = playerData.equipment?.shield?.name || "없음";
        }
        if (equipmentAccessoryEl) {
            equipmentAccessoryEl.textContent = playerData.equipment?.accessory?.name || "없음";
        }
        
        // 재앙 렌더링
        if (myDisastersEl) {
            if (playerData.disasters && playerData.disasters.length > 0) {
                myDisastersEl.innerHTML = playerData.disasters
                    .map(d => `<span class="disaster-badge">${d}</span>`)
                    .join('');
            } else {
                myDisastersEl.innerHTML = '없음';
            }
        }
        
        // 기적 렌더링
        if (myMiraclesEl && playerData.miracles) {
            myMiraclesEl.innerHTML = "";
            playerData.miracles.forEach(miracle => {
                const el = document.createElement("div");
                el.className = "card";
                el.dataset.attr = miracle.attribute;
                el.innerHTML = `
                    <div class="card__title">
                        <span>✨ ${miracle.name}</span>
                        <span class="muted" style="font-size:0.75rem;">MP:${miracle.stats?.mpCost || 0}</span>
                    </div>
                    <div class="card__body" style="font-size:0.8rem; padding: 8px;">
                        <p class="muted" style="font-size:0.75rem; margin-bottom:4px;">속성: ${miracle.attribute}</p>
                        ${miracle.text}
                    </div>
                `;
                myMiraclesEl.appendChild(el);
            });
        }
    } else {
        // 레거시 모드
        myStateEl.innerHTML = `
            <h4>내 상태</h4>
            <strong>${playerData.nickname} (나)</strong>
            <div>HP: ${playerData.hp}/${playerData.maxHp || 99}</div>
            <div>KI: ${playerData.ki}/${playerData.maxKi || 99}</div>
        `;
    }
}

function renderMyHand(hand = []) {
    myHandEl.innerHTML = "";
    const isGodFieldMode = state.match?.isGodFieldMode;
    
    hand.forEach(card => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.cardId = card.id || card.instanceId;
        el.dataset.attr = card.attribute;
        
        if (isGodFieldMode) {
            // GodField 모드: 성물 렌더링
            const typeIcon = {
                weapon: "⚔️",
                armor: "🛡️",
                item: "📦",
                miracle: "✨"
            };
            
            const statsHTML = card.stats ? Object.entries(card.stats)
                .map(([key, val]) => `${key}:${val}`)
                .join(', ') : '';
            
            el.innerHTML = `
                <div class="card__title">
                    <span>${typeIcon[card.cardType] || ''} ${card.name}</span>
                    <span class="muted" style="font-size:0.7rem;">${card.cardType}</span>
                </div>
                <div class="card__body" style="font-size:0.8rem; padding: 8px;">
                    <p class="muted" style="font-size:0.75rem; margin-bottom:4px;">속성: ${card.attribute}</p>
                    ${statsHTML ? `<p style="font-size:0.75rem; margin-bottom:4px;">${statsHTML}</p>` : ''}
                    <p>${card.text}</p>
                </div>
            `;
        } else {
            // 레거시 모드: 기존 카드 렌더링
            el.innerHTML = `
                <div class="card__title"><span>[${card.cost}] ${card.name}</span></div>
                <div class="card__body" style="font-size:0.8rem; padding: 8px;">${card.text}</div>
            `;
        }
        
        el.addEventListener('click', () => selectCard(card.id || card.instanceId));
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

    // 모든 플레이어 표시 (갓필드 스타일: 나 자신 포함)
    playerListEl.innerHTML = "";
    Object.values(matchData.players).forEach(p => {
        playerListEl.appendChild(renderPlayerState(p));
    });

    const myData = matchData.players[auth.currentUser?.uid];
    if (myData) {
        renderMyState(myData);
        renderMyHand(myData.hand);
    }

    // Threat phase 시각적 표시
    const logPanel = document.getElementById('match-log-panel');
    if (matchData.phase === 'threat' && matchData.threatInfo) {
        const threatMsg = `⚠️ ${matchData.threatInfo.attackerName}이(가) ${matchData.threatInfo.weaponCard.name}(으)로 ${matchData.threatInfo.targetName}을(를) 공격! (위력: ${matchData.threatInfo.attackPower}, 속성: ${matchData.threatInfo.attribute})`;
        logEl.innerHTML = (matchData.logs || [])
            .slice(-50)
            .map(l => `<div>${l.message || `[${l.caster}] ${l.cardName} → ${l.target || ''} (${l.type}) ${l.amount || ''}`}</div>`)
            .join('') + `<div style="color: var(--danger); font-weight: bold; background: rgba(255,82,82,0.1); padding: 8px; border-radius: 4px; margin-top: 8px;">${threatMsg}</div>`;
        if (logPanel) logPanel.setAttribute('data-phase', 'threat');
    } else {
        logEl.innerHTML = (matchData.logs || [])
            .slice(-50) // 최근 50개 로그만 표시
            .map(l => `<div>${l.message || `[${l.caster}] ${l.cardName} → ${l.target || ''} (${l.type}) ${l.amount || ''}`}</div>`)
            .join('') || '<div class="muted">게임 로그가 여기에 표시됩니다.</div>';
        if (logPanel) logPanel.removeAttribute('data-phase');
    }
    logEl.scrollTop = logEl.scrollHeight;

    updateActionPanel();
}

// GodField Action Handlers
async function handleAttack() {
    if (isActionInProgress || attackBtn.disabled) return;
    if (!selectedCardId) {
        alert("공격에 사용할 무기 카드를 선택해주세요.");
        return;
    }
    if (!selectedTargetUid) {
        alert("공격할 대상을 선택해주세요.");
        return;
    }
    
    isActionInProgress = true;
    disableAllActionButtons();
    
    try {
        const result = await callPlayerAction({
            matchId: currentMatchId,
            actionType: "ATTACK",
            payload: {
                weaponCardId: selectedCardId,
                targetUid: selectedTargetUid
            }
        });
        alert(result.message || "공격 성공!");
        selectCard(null);
        selectTarget(null);
    } catch (e) {
        alert(`공격 실패: ${e.message}`);
    } finally {
        isActionInProgress = false;
        updateActionPanel();
    }
}

async function handleDefend() {
    if (isActionInProgress || defendBtn.disabled) return;
    
    // 선택된 카드들 (방어구) 수집
    const armorCardIds = [];
    if (selectedCardId) {
        armorCardIds.push(selectedCardId);
    }
    
    if (armorCardIds.length === 0) {
        alert("방어에 사용할 방어구 카드를 선택해주세요.");
        return;
    }
    
    isActionInProgress = true;
    disableAllActionButtons();
    
    try {
        const result = await callPlayerAction({
            matchId: currentMatchId,
            actionType: "DEFEND",
            payload: {
                armorCardIds: armorCardIds
            }
        });
        alert(result.message || "방어 성공!");
        selectCard(null);
    } catch (e) {
        alert(`방어 실패: ${e.message}`);
    } finally {
        isActionInProgress = false;
        updateActionPanel();
    }
}

async function handlePray() {
    if (isActionInProgress || prayBtn.disabled) return;
    
    if (!confirm("기도를 사용하면 손패 1장을 버리고 2장을 뽑은 후 턴이 종료됩니다. 계속하시겠습니까?")) {
        return;
    }
    
    isActionInProgress = true;
    disableAllActionButtons();
    
    try {
        const result = await callPlayerAction({
            matchId: currentMatchId,
            actionType: "PRAY",
            payload: {}
        });
        alert(result.message || "기도 성공!");
    } catch (e) {
        alert(`기도 실패: ${e.message}`);
    } finally {
        isActionInProgress = false;
        updateActionPanel();
    }
}

function disableAllActionButtons() {
    if (attackBtn) attackBtn.disabled = true;
    if (defendBtn) defendBtn.disabled = true;
    if (prayBtn) prayBtn.disabled = true;
    if (playCardBtn) playCardBtn.disabled = true;
    if (endTurnBtn) endTurnBtn.disabled = true;
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
    
    // GodField action buttons
    if (attackBtn) attackBtn.addEventListener('click', handleAttack);
    if (defendBtn) defendBtn.addEventListener('click', handleDefend);
    if (prayBtn) prayBtn.addEventListener('click', handlePray);
}
