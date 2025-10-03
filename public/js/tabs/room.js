// public/js/tabs/room.js
import { onSnapshot, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, callLeaveRoom, callStartGame } from "../firebase.js";
import { state, setRoom } from "../state.js";

const $ = (q) => document.querySelector(q);
const roomTitleEl = $("#room-title");
const playerListEl = $("#player-list");
const leaveRoomBtn = $("#btn-leave-room");
const startGameBtn = $("#btn-start-game");

let currentRoomId = null;
let unsubscribeRoom = null;

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
    
    // 방장만 시작 버튼 표시
    const amIHost = roomData.hostUid === auth.currentUser?.uid;
    startGameBtn.style.display = amIHost ? 'block' : 'none';
}


async function handleLeaveRoom() {
    if (!currentRoomId) return;
    await callLeaveRoom({ roomId: currentRoomId });
    window.location.hash = '#lobby';
}

async function handleStartGame() {
    if (!currentRoomId) return;
    try {
        await callStartGame({ roomId: currentRoomId });
        // 게임 시작 성공 시, 게임 화면으로 전환하는 로직 (나중에 추가)
    } catch(e) {
        alert(`게임 시작 실패: ${e.message}`);
    }
}


function watchRoom(roomId) {
    if (unsubscribeRoom) unsubscribeRoom();

    const roomRef = doc(db, "rooms", roomId);
    unsubscribeRoom = onSnapshot(roomRef, (doc) => {
        if (doc.exists()) {
            updateRoomView(doc.data());
        } else {
            // 방이 사라짐 (예: 방장이 나감)
            alert("방이 사라졌습니다. 로비로 돌아갑니다.");
            window.location.hash = '#lobby';
        }
    });
}

export function setRoomId(roomId) {
    if (currentRoomId === roomId) return;

    currentRoomId = roomId;
    setRoom(roomId); // 전역 상태 업데이트

    if (roomId) {
        watchRoom(roomId);
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
}
