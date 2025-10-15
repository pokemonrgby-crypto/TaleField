// public/js/tabs/character-gen.js
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { callGenShin } from "../firebase.js";
import { loadMyShin } from "./my-characters.js";

const $ = q => document.querySelector(q);

const genPromptEl = $("#gen-char-prompt");
const genTempEl = $("#gen-char-temp");
const genBtn = $("#btn-gen-char");
const genGridEl = $("#gen-char-results");
const genStatusEl = $("#gen-char-status");

function setStatus(text, isError = false) {
    genStatusEl.textContent = text;
    genStatusEl.style.color = isError ? 'var(--danger)' : 'var(--ink-dim)';
}

function renderShinTile(shin) {
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
        <div style="margin-top: 12px; font-weight: 600;">고유 기적:</div>
        ${miraclesHTML}
      </div>
    `;
    return el;
}

async function handleGenerate() {
    // ANCHOR: character-gen-bug-fix-2
    if (genBtn.disabled) return; // 중복 클릭 방지

    const user = getAuth().currentUser;
    if (!user) {
        setStatus("신(Shin)을 생성하려면 로그인이 필요합니다.", true);
        return;
    }
    const prompt = genPromptEl.value.trim();
    if (prompt.length < 5) {
        setStatus("프롬프트를 5자 이상 입력해주세요.", true);
        return;
    }

    setStatus("AI가 당신의 신(Shin)을 구상하는 중...");
    genBtn.disabled = true;

    try {
        const params = {
            prompt: prompt,
            temperature: Number(genTempEl.value || 0.8),
        };
        const result = await callGenShin(params);

        if (result.ok && result.shin) {
            const shinTile = renderShinTile(result.shin);
            genGridEl.prepend(shinTile);
            setStatus(`'${result.shin.name}' 신이 생성되었습니다! '내 캐릭터' 탭에서 확인하세요.`);
            loadMyShin(); // 내 신 목록 자동 갱신
        } else {
            throw new Error(result.error || "AI가 유효한 신을 반환하지 않았습니다.");
        }
    } catch (e) {
        console.error(e);
        setStatus(e.message || "신 생성 중 오류가 발생했습니다.", true);
    } finally {
        genBtn.disabled = false;
    }
}

export function initCharacterGenTab() {
    genBtn.addEventListener("click", handleGenerate);
}
