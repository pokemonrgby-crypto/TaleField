// public/js/tabs/my-characters.js
import { db } from "../firebase.js";
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (q) => document.querySelector(q);

const myCharsGridEl = $("#my-chars-grid");
const myCharsStatusEl = $("#my-chars-status");
const refreshBtn = $("#btn-refresh-my-chars");

function renderMyShinTile(shin) {
    const el = document.createElement("div");
    el.className = "card";
    
    const miraclesHTML = shin.uniqueMiracles.map(m => `
        <div style="border-top: 1px solid var(--line-main); padding-top: 8px; margin-top: 8px;">
            <strong>${m.name} (MP: ${m.stats.mpCost})</strong>
            <p style="margin: 4px 0 0; font-size: 0.9rem; color: var(--ink-dim);">${m.text}</p>
            <div class="muted" style="font-size:0.85rem;">속성: ${m.attribute}</div>
        </div>
    `).join('');

    el.innerHTML = `
      <div class="card__title">
        <span>${shin.name}</span>
        <span class="muted">신(Shin)</span>
      </div>
      <div class="card__body">
        <p style="margin: 4px 0; font-size: 0.9rem; color: var(--ink-dim);">${shin.description}</p>
        <div class="muted" style="font-size:0.85rem; margin-top: 4px;">Status: ${shin.status}</div>
        <div style="margin-top: 12px; font-weight: 600;">고유 기적:</div>
        ${miraclesHTML}
      </div>
    `;
    return el;
}

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

export async function loadMyShin() {
    const user = getAuth().currentUser;
    if (!user) {
        myCharsStatusEl.textContent = "신(Shin)을 보려면 로그인이 필요합니다.";
        myCharsGridEl.innerHTML = "";
        return;
    }

    try {
        myCharsStatusEl.textContent = "내 신(Shin)을 불러오는 중...";
        const q = query(
            collection(db, "shin"), 
            where("ownerUid", "==", user.uid),
            orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            myCharsStatusEl.textContent = "아직 생성한 신이 없습니다. '캐릭터 생성' 탭에서 만들어보세요!";
            myCharsGridEl.innerHTML = "";
            return;
        }

        const shins = snap.docs.map(d => d.data());
        myCharsGridEl.innerHTML = "";
        shins.forEach(shin => myCharsGridEl.appendChild(renderMyShinTile(shin)));
        myCharsStatusEl.textContent = `총 ${shins.length}명의 신을 보유하고 있습니다.`;

    } catch (e) {
        console.error("Error loading my shin:", e);
        myCharsStatusEl.textContent = "신을 불러오는 중 오류가 발생했습니다.";
    }
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
    refreshBtn.addEventListener("click", loadMyShin);
    
    const myCharsTabBtn = document.querySelector('button[data-tab="view-my-characters"]');
    myCharsTabBtn.addEventListener('click', () => {
        if (myCharsGridEl.children.length === 0) {
            loadMyShin();
        }
    });
}
