// public/js/tabs/my-cards.js
import { db, callDeleteCard } from "../firebase.js"; // callDeleteCard 임포트
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (q) => document.querySelector(q);

const myCardsGridEl = $("#my-cards-grid");
const myCardsStatusEl = $("#my-cards-status");
const refreshBtn = $("#btn-refresh-my-cards");

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
      <div class="card__actions">
        <button class="btn-delete-card" data-card-id="${card.id}">삭제</button>
      </div>
    `;

    // 삭제 버튼 이벤트 리스너
    el.querySelector('.btn-delete-card').addEventListener('click', async (e) => {
        e.stopPropagation(); // 카드 전체 클릭 이벤트 방지
        const cardId = e.target.dataset.cardId;
        if (confirm(`'${card.name}' 카드를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
            try {
                await callDeleteCard({ cardId });
                el.remove(); // UI에서 즉시 제거
                alert("카드가 삭제되었습니다.");
            } catch (error) {
                console.error("Card deletion failed:", error);
                alert(`카드 삭제 실패: ${error.message}`);
            }
        }
    });

    return el;
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

export function initMyCardsTab() {
    refreshBtn.addEventListener("click", loadMyCards);
    
    const myCardsTabBtn = document.querySelector('button[data-tab="view-my-cards"]');
    myCardsTabBtn.addEventListener('click', () => {
        if (myCardsGridEl.children.length === 0) {
            loadMyCards();
        }
    });
}
