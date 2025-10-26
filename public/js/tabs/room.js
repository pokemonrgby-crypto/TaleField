// public/js/tabs/room.js
import { onSnapshot, doc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, callLeaveRoom, callStartGame, callSetPlayerReady } from "../firebase.js";
import { state, setRoom } from "../state.js";

const $ = (q) => document.querySelector(q);
const roomContainer = $("#view-room");
const roomTitleEl = $("#room-title");
const playerListEl = $("#player-list");
const leaveRoomBtn = $("#btn-leave-room");
const startGameBtn = $("#btn-start-game");
const readyBtn = $("#btn-ready");

const myCharsContainer = $("#room-my-characters");
const myCardsContainer = $("#room-my-cards");
const skillSelectionArea = $("#skill-selection-area");
const skillSelectionTitle = $("#skill-selection-title");
const mySkillsContainer = $("#room-my-skills");
const selectedCardCountEl = $("#room-selected-card-count");


let currentRoomId = null;
let unsubscribeRoom = null;
let myCharacters = [];
let myCards = [];
let myShin = [];
let myArtifacts = [];
let selectedCharacterId = null;
let selectedSkillNames = new Set();
let selectedCardIds = new Set();
let selectedShinId = null;
let selectedArtifactIds = new Set();
let amIReady = false;
let useGodFieldMode = true; // 기본적으로 GodField 모드 사용


function renderPlayer(player) {
    const li = document.createElement("li");
    const isMe = player.uid === auth.currentUser?.uid;
    const isHost = player.isHost;
    li.innerHTML = `
        <span>${player.nickname} ${isMe ? '(나)' : ''} ${isHost ? '👑' : ''}</span>
        <span class="${player.ready ? 'ready' : ''}">${player.ready ? '준비완료' : '대기중'}</span>
    `;
    return li;
}

function updateRoomView(roomData) {
    if (!roomData) {
        roomTitleEl.textContent = "방 정보를 불러오는 중...";
        playerListEl.innerHTML = "";
        return;
    }
    roomTitleEl.textContent = roomData.title;
    playerListEl.innerHTML = "";
    roomData.players?.forEach(p => playerListEl.appendChild(renderPlayer(p)));
    
    const myPlayerState = roomData.players.find(p => p.uid === auth.currentUser?.uid);
    amIReady = myPlayerState?.ready || false;

    // 준비 상태에 따라 UI 잠금/해제
    roomContainer.classList.toggle('is-ready', amIReady);
    readyBtn.textContent = amIReady ? '준비 취소' : '준비 완료';

    const amIHost = roomData.hostUid === auth.currentUser?.uid;
    startGameBtn.style.display = amIHost ? 'block' : 'none';

    // 모든 플레이어가 준비되었는지 확인
    const allReady = roomData.players.every(p => p.ready);
    startGameBtn.disabled = !allReady || roomData.players.length < 2; // 최소 2명 이상
}


async function handleLeaveRoom() {
    if (!currentRoomId) return;
    // Directly change hash, letting the router handle the leave logic
    window.location.hash = '#lobby';
}

async function handleStartGame() {
    if (!currentRoomId || startGameBtn.disabled) return;
    startGameBtn.disabled = true;
    try {
        await callStartGame({ roomId: currentRoomId });
        // The game start will be handled by the onSnapshot listener in watchRoom
        // which will navigate to the match view.
    } catch(e) {
        alert(`게임 시작 실패: ${e.message}`);
        startGameBtn.disabled = false;
    }
}


function renderShinSelection() {
    myCharsContainer.innerHTML = "";
    if (myShin.length === 0) {
        myCharsContainer.innerHTML = '<p class="muted">신이 없습니다. "캐릭터 생성" 탭에서 만들어주세요.</p>';
        return;
    }
    myShin.forEach(shin => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.shinId = shin.id;
        el.innerHTML = `
            <div class="card__title"><span>${shin.name}</span><span class="muted">신(Shin)</span></div>
            <div class="card__body" style="padding: 8px;">
                <p style="font-size:0.85rem; color: var(--ink-dim);">${shin.description}</p>
            </div>
        `;
        if (shin.id === selectedShinId) {
            el.classList.add("selected");
        }
        el.addEventListener("click", () => selectShin(shin.id));
        myCharsContainer.appendChild(el);
    });
}

function renderCharacterSelection() {
    myCharsContainer.innerHTML = "";
    myCharacters.forEach(char => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.charId = char.id;
        el.innerHTML = `<div class="card__title"><span>${char.name}</span><span>HP:${char.hp}</span></div>`;
        if (char.id === selectedCharacterId) {
            el.classList.add("selected");
        }
        el.addEventListener("click", () => selectCharacter(char.id));
        myCharsContainer.appendChild(el);
    });
}

function selectShin(shinId) {
    if (amIReady) return;
    selectedShinId = shinId;
    renderShinSelection();
    
    // 신을 선택하면 스킬 선택 영역을 숨김 (신은 스킬이 아닌 고유 기적을 가짐)
    skillSelectionArea.style.display = "none";
}

function selectCharacter(charId) {
    if (amIReady) return; // 준비 상태면 선택 불가
    selectedCharacterId = charId;
    selectedSkillNames.clear();
    renderCharacterSelection();

    const character = myCharacters.find(c => c.id === charId);
    if (character) {
        skillSelectionTitle.textContent = `'${character.name}' 스킬 선택 (2개)`;
        mySkillsContainer.innerHTML = "";
        character.skills.forEach(skill => {
            const el = document.createElement("div");
            el.className = "skill";
            el.dataset.skillName = skill.name;
            el.innerHTML = `<strong>${skill.name} (코스트:${skill.cost})</strong><p>${skill.text}</p>`;
            el.addEventListener("click", () => toggleSkill(skill.name));
            mySkillsContainer.appendChild(el);
        });
        skillSelectionArea.style.display = "block";
    }
}

function toggleSkill(skillName) {
    if (amIReady) return;
    if (selectedSkillNames.has(skillName)) {
        selectedSkillNames.delete(skillName);
    } else {
        if (selectedSkillNames.size < 2) {
            selectedSkillNames.add(skillName);
        }
    }
    // UI 업데이트
    document.querySelectorAll("#room-my-skills .skill").forEach(el => {
        el.classList.toggle("selected", selectedSkillNames.has(el.dataset.skillName));
    });
}

function renderArtifactSelection() {
    myCardsContainer.innerHTML = "";
    if (myArtifacts.length === 0) {
        myCardsContainer.innerHTML = '<p class="muted">성물이 없습니다. "생성" 탭에서 만들어주세요.</p>';
        selectedCardCountEl.textContent = "0";
        return;
    }
    
    const typeIcon = {
        weapon: "⚔️",
        armor: "🛡️",
        item: "📦",
        miracle: "✨"
    };
    
    myArtifacts.forEach(artifact => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.artifactId = artifact.id;
        el.dataset.attr = artifact.attribute;
        el.innerHTML = `
            <div class="card__title">
                <span>${typeIcon[artifact.cardType] || ''} ${artifact.name}</span>
                <span class="muted" style="font-size:0.75rem;">${artifact.cardType}</span>
            </div>
            <div class="card__body" style="padding: 8px;">
                <p class="muted" style="font-size:0.8rem; margin-bottom:4px;">속성: ${artifact.attribute}</p>
                <p style="font-size:0.8rem;">${artifact.text}</p>
            </div>`;
        if (selectedArtifactIds.has(artifact.id)) {
            el.classList.add("selected");
        }
        el.addEventListener("click", () => toggleArtifact(artifact.id));
        myCardsContainer.appendChild(el);
    });
    selectedCardCountEl.textContent = selectedArtifactIds.size;
}

function renderCardSelection() {
    myCardsContainer.innerHTML = "";
    myCards.forEach(card => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.cardId = card.id;
        el.dataset.attr = card.attribute;
        el.innerHTML = `
            <div class="card__title"><span>[${card.cost}] ${card.name}</span></div>
            <div class="card__body" style="padding: 8px;">
                <p class="muted" style="font-size:0.8rem; margin-bottom:4px;">${card.attribute}</p>
                <p style="font-size:0.8rem;">${card.text}</p>
            </div>`;
        if (selectedCardIds.has(card.id)) {
            el.classList.add("selected");
        }
        el.addEventListener("click", () => toggleCard(card.id));
        myCardsContainer.appendChild(el);
    });
    selectedCardCountEl.textContent = selectedCardIds.size;
}

function toggleArtifact(artifactId) {
    if (amIReady) return;
    if (selectedArtifactIds.has(artifactId)) {
        selectedArtifactIds.delete(artifactId);
    } else {
        selectedArtifactIds.add(artifactId);
    }
    renderArtifactSelection();

    const count = selectedArtifactIds.size;
    selectedCardCountEl.textContent = count;
    if (count === 7) {
        selectedCardCountEl.parentElement.classList.remove('danger');
    } else {
        selectedCardCountEl.parentElement.classList.add('danger');
    }
}

function toggleCard(cardId) {
    if (amIReady) return;
    if (selectedCardIds.has(cardId)) {
        selectedCardIds.delete(cardId);
    } else {
        selectedCardIds.add(cardId);
    }
    renderCardSelection();

    const count = selectedCardIds.size;
    selectedCardCountEl.textContent = count;
    if (count >= 5 && count <= 15) {
        selectedCardCountEl.parentElement.classList.remove('danger');
    } else {
        selectedCardCountEl.parentElement.classList.add('danger');
    }
}

async function handleReady() {
    readyBtn.disabled = true;
    try {
        if (amIReady) {
            await callSetPlayerReady({ roomId: currentRoomId, ready: false });
        } else {
            if (useGodFieldMode) {
                // GodField 모드: 신 1개 + 성물 7개
                if (!selectedShinId) throw new Error("신(Shin)을 선택해주세요.");
                if (selectedArtifactIds.size !== 7) throw new Error("성물을 정확히 7개 선택해야 합니다.");

                await callSetPlayerReady({
                    roomId: currentRoomId,
                    shinId: selectedShinId,
                    selectedArtifactIds: Array.from(selectedArtifactIds),
                    ready: true
                });
            } else {
                // 레거시 모드: 캐릭터 + 스킬 + 카드
                if (!selectedCharacterId) throw new Error("캐릭터를 선택해주세요.");
                if (selectedSkillNames.size !== 2) throw new Error("스킬을 2개 선택해주세요.");
                if (selectedCardIds.size < 5 || selectedCardIds.size > 15) throw new Error("카드는 5~15장 선택해야 합니다.");

                await callSetPlayerReady({
                    roomId: currentRoomId,
                    characterId: selectedCharacterId,
                    selectedSkills: Array.from(selectedSkillNames),
                    selectedCardIds: Array.from(selectedCardIds),
                    ready: true
                });
            }
        }
    } catch (e) {
        alert(`오류: ${e.message}`);
    } finally {
        readyBtn.disabled = false;
    }
}


async function loadMyData() {
    const user = auth.currentUser;
    if (!user) {
        console.warn("loadMyData: 현재 로그인된 사용자가 없어 데이터 로드를 건너뜁니다.");
        return;
    }

    if (useGodFieldMode) {
        // GodField 모드: 신과 성물 로드
        try {
            const shinQ = query(collection(db, "shin"), where("ownerUid", "==", user.uid), where("status", "!=", "blocked"));
            const shinSnap = await getDocs(shinQ);
            myShin = shinSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderShinSelection();
        } catch (error) {
            console.error("[Room] 내 신을 불러오는 중 오류 발생:", error);
        }

        try {
            const artifactQ = query(collection(db, "artifacts"), where("ownerUid", "==", user.uid), where("status", "!=", "blocked"));
            const artifactSnap = await getDocs(artifactQ);
            myArtifacts = artifactSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderArtifactSelection();
        } catch(error) {
            console.error("[Room] 내 성물을 불러오는 중 오류 발생:", error);
        }
    } else {
        // 레거시 모드: 캐릭터와 카드 로드
        try {
            const charQ = query(collection(db, "userCharacters"), where("ownerUid", "==", user.uid), where("status", "!=", "blocked"));
            const charSnap = await getDocs(charQ);
            myCharacters = charSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderCharacterSelection();
        } catch (error) {
            console.error("[Room] 내 캐릭터를 불러오는 중 오류 발생:", error);
        }

        try {
            const cardQ = query(collection(db, "userCards"), where("ownerUid", "==", user.uid), where("status", "!=", "blocked"));
            const cardSnap = await getDocs(cardQ);
            myCards = cardSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderCardSelection();
        } catch(error) {
            console.error("[Room] 내 카드를 불러오는 중 오류 발생:", error);
        }
    }
}


function watchRoom(roomId) {
    if (unsubscribeRoom) unsubscribeRoom();

    const roomRef = doc(db, "rooms", roomId);
    unsubscribeRoom = onSnapshot(roomRef, (doc) => {
        if (doc.exists()) {
            const roomData = { id: doc.id, ...doc.data() };
            if (roomData.status === 'playing' && roomData.matchId) {
                 // 게임 시작! 매치 화면으로 이동
                 if (window.location.hash !== `#match/${roomData.matchId}`) {
                    window.location.hash = `#match/${roomData.matchId}`;
                 }
            }
            updateRoomView(roomData);
        } else {
            alert("방이 사라졌습니다. 로비로 돌아갑니다.");
            if (window.location.hash !== '#lobby') {
                window.location.hash = '#lobby';
            }
        }
    });
}

export function setRoomId(roomId) {
    if (currentRoomId === roomId) return;
    
    if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
    }

    currentRoomId = roomId;
    setRoom(roomId); 

    if (roomId) {
        watchRoom(roomId);
        loadMyData();
    } else {
        updateRoomView(null);
    }
}

export async function leaveRoom() {
    const roomId = currentRoomId;
    if (roomId) {
        setRoomId(null); 
        await callLeaveRoom({ roomId });
    }
}

export function initRoomTab() {
    leaveRoomBtn.addEventListener('click', handleLeaveRoom);
    startGameBtn.addEventListener('click', handleStartGame);
    readyBtn.addEventListener('click', handleReady);
}
