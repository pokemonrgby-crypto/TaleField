// public/js/tabs/lobby.js
import { auth, db, callCreateRoom, callJoinRoom, callCreateBotRoom } from "../firebase.js";
import { collection, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (q) => document.querySelector(q);

const createRoomBtn = $("#btn-create-room");
const createBotRoomBtn = $("#btn-create-bot-room");
const botDifficultySelect = $("#bot-difficulty");
const botCountSelect = $("#bot-count");
const roomTitleEl = $("#room-title-input");
const roomListEl = $("#room-list");
const lobbyStatusEl = $("#lobby-status");

let unsubscribeRooms = null;

function renderRoom(room) {
    const li = document.createElement("li");
    li.className = "room-item";
    li.innerHTML = `
        <div class="room-item__title">${room.title} (${room.playerCount || 0}/${room.maxPlayers})</div>
        <div class="room-item__host">방장: ${room.hostNickname || '...'}</div>
        <div class="room-item__status">${room.status}</div>
    `;
    // ▼▼▼▼▼ 수정된 부분 ▼▼▼▼▼
    li.addEventListener('click', async () => {
        if (room.status !== 'waiting') {
            return alert("이미 시작되었거나 종료된 방입니다.");
        }
        try {
            // 서버에 참여 요청을 먼저 보냄
            await callJoinRoom({ roomId: room.id });
            // 성공 시 방으로 화면 전환
            window.location.hash = `#room/${room.id}`;
        } catch (e) {
            console.error("방 참여 실패:", e);
            alert(`방에 참여할 수 없습니다: ${e.message}`);
        }
    });
    // ▲▲▲▲▲ 수정된 부분 ▲▲▲▲▲
    return li;
}


async function handleCreateRoom() {
    if (createRoomBtn.disabled) return;
    const title = roomTitleEl.value.trim();
    if (!title) {
        alert("방 제목을 입력해주세요.");
        return;
    }

    createRoomBtn.disabled = true;
    try {
        const result = await callCreateRoom({ title, maxPlayers: 8 });
        if (result.ok && result.roomId) {
            window.location.hash = `#room/${result.roomId}`;
        } else {
            throw new Error(result.error || "방 생성에 실패했습니다.");
        }
    } catch (e) {
        console.error(e);
        alert(`오류: ${e.message}`);
    } finally {
        createRoomBtn.disabled = false;
    }
}

async function handleCreateBotRoom() {
    if (createBotRoomBtn.disabled) return;
    
    const difficulty = botDifficultySelect.value || 'NORMAL';
    const botCount = parseInt(botCountSelect?.value || '1', 10);
    
    createBotRoomBtn.disabled = true;
    try {
        const result = await callCreateBotRoom({ 
            difficulty, 
            botCount,
            title: '봇 배틀' 
        });
        if (result.ok && result.roomId) {
            window.location.hash = `#room/${result.roomId}`;
        } else {
            throw new Error(result.error || "봇 방 생성에 실패했습니다.");
        }
    } catch (e) {
        console.error(e);
        alert(`오류: ${e.message}`);
    } finally {
        createBotRoomBtn.disabled = false;
    }
}


function watchRooms() {
    if (unsubscribeRooms) unsubscribeRooms();

    const q = query(collection(db, "rooms"), orderBy("createdAt", "desc"));
    unsubscribeRooms = onSnapshot(q, (snapshot) => {
        roomListEl.innerHTML = "";
        if (snapshot.empty) {
            lobbyStatusEl.textContent = "현재 생성된 방이 없습니다. 새 방을 만들어보세요!";
            return;
        }
        snapshot.forEach(doc => {
            roomListEl.appendChild(renderRoom({ id: doc.id, ...doc.data() }));
        });
        lobbyStatusEl.textContent = "";
    }, (error) => {
        console.error("방 목록 실시간 로딩 실패:", error);
        lobbyStatusEl.textContent = "방 목록을 불러오는 데 실패했습니다.";
    });
}


export function initLobbyTab() {
    createRoomBtn.addEventListener("click", handleCreateRoom);
    
    if (createBotRoomBtn) {
        createBotRoomBtn.addEventListener("click", handleCreateBotRoom);
    }

    // 로비 탭이 활성화될 때 방 목록 감시 시작
    const lobbyTabBtn = document.querySelector('button[data-tab="view-lobby"]');
    lobbyTabBtn.addEventListener('click', watchRooms);

    // 로그인 상태 변경 시
    onAuthStateChanged(auth, user => {
        if (user) {
            watchRooms();
        } else {
            if (unsubscribeRooms) unsubscribeRooms();
            roomListEl.innerHTML = "";
            lobbyStatusEl.textContent = "방 목록을 보려면 로그인이 필요합니다.";
        }
    });
}
