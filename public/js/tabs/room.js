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
let selectedCharacterId = null;
let selectedSkillNames = new Set();
let selectedCardIds = new Set();
let amIReady = false;


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

    // 모든 플레이어가 준비되었는지 확인 (방장 제외)
    const allReady = roomData.players.every(p => p.ready || p.isHost);
    startGameBtn.disabled = !allReady || roomData.players.length < 2; // 최소 2명 이상
}


async function handleLeaveRoom() {
    if (!currentRoomId) return;
    await callLeaveRoom({ roomId: currentRoomId });
    window.location.hash = '#lobby';
}

async function handleStartGame() {
    if (!currentRoomId || startGameBtn.disabled) return;
    try {
        await callStartGame({ roomId: currentRoomId });
        // 게임이 시작되면 게임 뷰로 이동하는 로직이 필요 (추후 구현)
    } catch(e) {
        alert(`게임 시작 실패: ${e.message}`);
    }
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

function renderCardSelection() {
    myCardsContainer.innerHTML = "";
    myCards.forEach(card => {
        const el = document.createElement("div");
        el.className = "card";
        el.dataset.cardId = card.id;
        // 속성(attribute) 표시 추가 및 스타일링을 위한 data-attr 추가
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

function toggleCard(cardId) {
    if (amIReady) return;
    if (selectedCardIds.has(cardId)) {
        selectedCardIds.delete(cardId);
    } else {
        selectedCardIds.add(cardId);
    }
    renderCardSelection();

    // ▼▼▼▼▼ 수정된 부분 ▼▼▼▼▼
    const count = selectedCardIds.size;
    selectedCardCountEl.textContent = count;
    // 유효 범위에 따라 색상 변경
    if (count >= 5 && count <= 10) {
        selectedCardCountEl.parentElement.classList.remove('danger');
    } else {
        selectedCardCountEl.parentElement.classList.add('danger');
    }
    // ▲▲▲▲▲ 수정된 부분 ▲▲▲▲▲
}

async function handleReady() {
    // 이미 준비된 상태면 '준비 취소' 로직 실행
    if (amIReady) {
        readyBtn.disabled = true;
        try {
            await callSetPlayerReady({ roomId: currentRoomId, ready: false });
        } catch (e) {
            alert(`오류: ${e.message}`);
        } finally {
            readyBtn.disabled = false;
        }
        return;
    }

    // '준비 완료' 로직
    if (!selectedCharacterId) return alert("캐릭터를 선택해주세요.");
    if (selectedSkillNames.size !== 2) return alert("스킬을 2개 선택해주세요.");
    if (selectedCardIds.size < 5 || selectedCardIds.size > 10) return alert("카드는 5~10장 선택해야 합니다.");

    readyBtn.disabled = true;
    try {
        await callSetPlayerReady({
            roomId: currentRoomId,
            characterId: selectedCharacterId,
            selectedSkills: Array.from(selectedSkillNames),
            selectedCardIds: Array.from(selectedCardIds),
            ready: true
        });
    } catch (e) {
        alert(`오류: ${e.message}`);
    } finally {
        readyBtn.disabled = false;
    }
}


// public/js/tabs/room.js

async function loadMyData() {
    const user = auth.currentUser;
    if (!user) {
        console.warn("loadMyData: 현재 로그인된 사용자가 없어 데이터 로드를 건너뜁니다.");
        return;
    }

    // 캐릭터 로드
    try {
        const charQ = query(collection(db, "userCharacters"), where("ownerUid", "==", user.uid), where("status", "==", "approved"));
        const charSnap = await getDocs(charQ);
        myCharacters = charSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`[Room] ${myCharacters.length}개의 캐릭터를 불러왔습니다.`);
        renderCharacterSelection();
    } catch (error) {
        console.error("[Room] 내 캐릭터를 불러오는 중 오류 발생:", error);
        alert("내 캐릭터 정보를 불러오는 데 실패했습니다. 콘솔(F12)을 확인해주세요.");
    }

    // 카드 로드
    try {
        const cardQ = query(collection(db, "userCards"), where("ownerUid", "==", user.uid), where("status", "!=", "blocked"));
        const cardSnap = await getDocs(cardQ);
        myCards = cardSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`[Room] ${myCards.length}개의 카드를 불러왔습니다.`);
        renderCardSelection();
    } catch(error) {
        console.error("[Room] 내 카드를 불러오는 중 오류 발생:", error);
        alert("내 카드 정보를 불러오는 데 실패했습니다. 콘솔(F12)을 확인해주세요.");
    }
}


function watchRoom(roomId) {
    if (unsubscribeRoom) unsubscribeRoom();

    const roomRef = doc(db, "rooms", roomId);
    unsubscribeRoom = onSnapshot(roomRef, (doc) => {
        if (doc.exists()) {
            updateRoomView({ id: doc.id, ...doc.data() });
        } else {
            alert("방이 사라졌습니다. 로비로 돌아갑니다.");
            window.location.hash = '#lobby';
        }
    });
}

export function setRoomId(roomId) {
    if (currentRoomId === roomId) return;
    currentRoomId = roomId;
    setRoom(roomId); 

    if (roomId) {
        watchRoom(roomId);
        loadMyData();
    } else {
        if (unsubscribeRoom) unsubscribeRoom();
        updateRoomView(null);
    }
}

export function leaveRoom() {
    if (currentRoomId) {
        callLeaveRoom({ roomId: currentRoomId });
    }
    setRoomId(null);
}

export function initRoomTab() {
    leaveRoomBtn.addEventListener('click', handleLeaveRoom);
    startGameBtn.addEventListener('click', handleStartGame);
    readyBtn.addEventListener('click', handleReady);
}
