// /public/js/ui.js
export const $  = (sel, el=document) => el.querySelector(sel);
export const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

export function setActiveTab(name){
  $$(".tabs button").forEach(b=>b.classList.toggle("active", b.dataset.tab===name));
  $$(".tab").forEach(v=>v.classList.toggle("active", v.id===`tab-${name}`));
}

let toastTimer = null;
export function toast(msg, ms=1600){
  const box = $("#toast");
  if (!box) return alert(msg);
  box.textContent = msg;
  box.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> box.style.display = "none", ms);
}

export function renderRooms(targetEl, rooms, onJoin){
  targetEl.innerHTML = "";
  for (const r of rooms){
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${r.title ?? "(제목 없음)"}</strong><br>
        <small class="hint">${r.id} • 상태:${r.status}</small>
      </div>`;
    const btn = document.createElement("button");
    btn.textContent = "참여";
    btn.addEventListener("click", ()=> onJoin(r));
    li.appendChild(btn);
    targetEl.appendChild(li);
  }
}
