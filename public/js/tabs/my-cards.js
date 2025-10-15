// public/js/tabs/my-cards.js
import { db, callDeleteArtifact } from "../firebase.js";
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (q) => document.querySelector(q);

const myCardsGridEl = $("#my-cards-grid");
const myCardsStatusEl = $("#my-cards-status");
const refreshBtn = $("#btn-refresh-my-cards");

function renderMyArtifactTile(artifact) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.attr = artifact.attribute;
    el.id = `my-artifact-${artifact.id}`;

    // 성물 타입에 따른 아이콘 또는 정보 표시
    const typeIcon = {
        weapon: "⚔️",
        armor: "🛡️",
        item: "📦",
        miracle: "✨"
    };
    
    const statsHTML = artifact.stats ? Object.entries(artifact.stats)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ') : '';

    el.innerHTML = `
      <div class="card__title">
        <span>${typeIcon[artifact.cardType] || ''} ${artifact.name}</span>
        <span class="muted">${artifact.cardType}</span>
      </div>
      <div class="card__body">
        <div class="muted" style="font-size:0.85rem;">속성: ${artifact.attribute}</div>
        ${statsHTML ? `<div style="font-size:0.9rem; margin: 4px 0;">${statsHTML}</div>` : ''}
        <p style="margin: 8px 0;">${artifact.text || "(효과 없음)"}</p>
        <div class="card__meta">
          Status: ${artifact.status} <br>
          Score: ${artifact.checks?.validatorScore ?? 0}
        </div>
      </div>
      <div class="card__actions">
        <button class="btn-delete-artifact" data-artifact-id="${artifact.id}">삭제</button>
      </div>
    `;

    // 삭제 버튼 이벤트 리스너
    el.querySelector('.btn-delete-artifact').addEventListener('click', async (e) => {
        e.stopPropagation();
        const artifactId = e.target.dataset.artifactId;
        if (confirm(`'${artifact.name}' 성물을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
            try {
                await callDeleteArtifact({ artifactId });
                el.remove();
                alert("성물이 삭제되었습니다.");
            } catch (error) {
                console.error("Artifact deletion failed:", error);
                alert(`성물 삭제 실패: ${error.message}`);
            }
        }
    });

    return el;
}

export async function loadMyArtifacts() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
        myCardsStatusEl.textContent = "성물을 보려면 로그인이 필요합니다.";
        myCardsGridEl.innerHTML = "";
        return;
    }

    try {
        myCardsStatusEl.textContent = "내 성물을 불러오는 중...";
        const q = query(
            collection(db, "artifacts"), 
            where("ownerUid", "==", user.uid),
            orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            myCardsStatusEl.textContent = "아직 생성한 성물이 없습니다. '생성' 탭에서 만들어보세요!";
            myCardsGridEl.innerHTML = "";
            return;
        }

        const artifacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        myCardsGridEl.innerHTML = "";
        artifacts.forEach(artifact => myCardsGridEl.appendChild(renderMyArtifactTile(artifact)));
        myCardsStatusEl.textContent = `총 ${artifacts.length}개의 성물을 보유하고 있습니다.`;

    } catch (e) {
        console.error("Error loading my artifacts:", e);
        myCardsStatusEl.textContent = "성물을 불러오는 중 오류가 발생했습니다.";
    }
}

export async function loadMyCards() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
        myCardsStatusEl.textContent = "카드를 보려면 로그인이 필요합니다.";
        myCardsGridEl.innerHTML = "";
        return;
    }

    try {
        myCardsStatusEl.textContent = "내 카드를 불러오는 중...";
        const q = query(
            collection(db, "userCards"), 
            where("ownerUid", "==", user.uid),
            orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            myCardsStatusEl.textContent = "아직 생성한 카드가 없습니다. '생성' 탭에서 만들어보세요!";
            myCardsGridEl.innerHTML = "";
            return;
        }

        const cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        myCardsGridEl.innerHTML = "";
        cards.forEach(card => myCardsGridEl.appendChild(renderMyCardTile(card)));
        myCardsStatusEl.textContent = `총 ${cards.length}장의 카드를 보유하고 있습니다.`;

    } catch (e) {
        console.error("Error loading my cards:", e);
        myCardsStatusEl.textContent = "카드를 불러오는 중 오류가 발생했습니다.";
    }
}

function renderMyCardTile(card) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.attr = card.attribute;
    el.id = `my-card-${card.id}`;

    const costHTML = `<div style="font-size: 1.1rem; font-weight: bold;">${card.cost}</div>`;

    el.innerHTML = `
      <div class="card__title">
        <span>${card.name}</span>
        ${costHTML}
      </div>
      <div class="card__body">
        <div class="muted" style="font-size:0.85rem;">${card.attribute} / ${card.rarity} / ${card.type}</div>
        <p>${card.text || "(효과 없음)"}</p>
        <div class="card__meta">
          Status: ${card.status} <br>
          Score: ${card.checks?.validatorScore ?? 0}
        </div>
      </div>
    `;

    return el;
}

export function initMyCardsTab() {
    refreshBtn.addEventListener("click", loadMyArtifacts);
    
    const myCardsTabBtn = document.querySelector('button[data-tab="view-my-cards"]');
    myCardsTabBtn.addEventListener('click', () => {
        if (myCardsGridEl.children.length === 0) {
            loadMyArtifacts();
        }
    });
}
