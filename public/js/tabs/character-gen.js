// public/js/tabs/character-gen.js
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { callGenCharacter } from "../firebase.js";
import { loadMyCharacters } from "./my-characters.js";

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

function renderCharacterTile(char) {
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
        <div class="muted" style="font-size:0.85rem;">속성: ${char.attribute}</div>
        ${skillsHTML}
      </div>
    `;
    return el;
}

async function handleGenerate() {
    const user = getAuth().currentUser;
    if (!user) {
        setStatus("캐릭터를 생성하려면 로그인이 필요합니다.", true);
        return;
    }
    const prompt = genPromptEl.value.trim();
    if (prompt.length < 5) {
        setStatus("프롬프트를 5자 이상 입력해주세요.", true);
        return;
    }

    try {
        setStatus("AI가 당신의 캐릭터를 구상하는 중...");
        genBtn.disabled = true;

        const params = {
            prompt: prompt,
            temperature: Number(genTempEl.value || 0.8),
        };
        const result = await callGenCharacter(params);

        if (result.ok && result.character) {
            const charTile = renderCharacterTile(result.character);
            genGridEl.prepend(charTile);
            setStatus(`'${result.character.name}' 캐릭터가 생성되었습니다! '내 캐릭터' 탭에서 확인하세요.`);
            loadMyCharacters(); // 내 캐릭터 목록 자동 갱신
        } else {
            throw new Error("AI가 유효한 캐릭터를 반환하지 않았습니다.");
        }
    } catch (e) {
        console.error(e);
        setStatus(e.message || "캐릭터 생성 중 오류가 발생했습니다.", true);
    } finally {
        genBtn.disabled = false;
    }
}

export function initCharacterGenTab() {
    genBtn.addEventListener("click", handleGenerate);
}
