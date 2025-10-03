// public/js/tabs/my-characters.js
import { db } from "../firebase.js";
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (q) => document.querySelector(q);

const myCharsGridEl = $("#my-chars-grid");
const myCharsStatusEl = $("#my-chars-status");
const refreshBtn = $("#btn-refresh-my-chars");

function renderMyCharacterTile(char) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.attr = char.attribute;

    const skillsHTML = char.skills.map(s => `
        <div style="border-top: 1px solid var(--line-main); padding-top: 8px; margin-top: 8px;">
            <strong>${s.name} (코스트: ${s.cost})</strong>
            <p style="margin: 4px 0 0; font-size: 0.9rem;">${s.text}</p>
        </div>
    `).join('');

    el.innerHTML = `
      <div class="card__title">
        <span>${char.name}</span>
        <span>HP:${char.hp} KI:${char.maxKi} Regen:${char.kiRegen}</span>
      </div>
      <div class="card__body">
        <div class="muted" style="font-size:0.85rem;">속성: ${char.attribute} / Status: ${char.status}</div>
        ${skillsHTML}
      </div>
    `;
    return el;
}

export async function loadMyCharacters() {
    const user = getAuth().currentUser;
    if (!user) {
        myCharsStatusEl.textContent = "캐릭터를 보려면 로그인이 필요합니다.";
        myCharsGridEl.innerHTML = "";
        return;
    }

    try {
        myCharsStatusEl.textContent = "내 캐릭터를 불러오는 중...";
        const q = query(
            collection(db, "userCharacters"), 
            where("ownerUid", "==", user.uid),
            orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            myCharsStatusEl.textContent = "아직 생성한 캐릭터가 없습니다. '캐릭터 생성' 탭에서 만들어보세요!";
            myCharsGridEl.innerHTML = "";
            return;
        }

        const chars = snap.docs.map(d => d.data());
        myCharsGridEl.innerHTML = "";
        chars.forEach(char => myCharsGridEl.appendChild(renderMyCharacterTile(char)));
        myCharsStatusEl.textContent = `총 ${chars.length}명의 캐릭터를 보유하고 있습니다.`;

    } catch (e) {
        console.error("Error loading my characters:", e);
        myCharsStatusEl.textContent = "캐릭터를 불러오는 중 오류가 발생했습니다.";
    }
}

export function initMyCharactersTab() {
    refreshBtn.addEventListener("click", loadMyCharacters);
    
    const myCharsTabBtn = document.querySelector('button[data-tab="view-my-characters"]');
    myCharsTabBtn.addEventListener('click', () => {
        if (myCharsGridEl.children.length === 0) {
            loadMyCharacters();
        }
    });
}
