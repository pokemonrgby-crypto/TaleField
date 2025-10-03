// engine.js — 간단한 DSL 인터프리터(클라 데모용). 서버 권위 이전 전까지 테스트용.
export function seedRandom(seedStr="seed"){
  // xmur3 / mulberry32 간단 시드
  let h=1779033703^seedStr.length;
  for(let i=0;i<seedStr.length;i++){
    h=Math.imul(h^seedStr.charCodeAt(i),3432918353); h=h<<13|h>>>19;
  }
  return function(){ h=Math.imul(h^h>>>16,2246822507); h=Math.imul(h^h>>>13,3266489909); const t=(h^h>>>16)>>>0; return (t+0.5)/(2**32); };
}

export function renderCardTile(card, {selectable=false, selected=false, onToggle}={}){
  const el = document.createElement("div");
  el.className = `card card--${card.type}`;
  el.dataset.attr = card.attribute;
  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = `${card.name} · ${card.type} · ${card.attribute}`;
  const body = document.createElement("div");
  body.style.padding = "8px 10px";
  const txt = document.createElement("div");
  txt.textContent = card.text || "";
  const meta = document.createElement("div");
  meta.className="muted";
  meta.textContent = `cost ${card.cost}, cd ${card.cooldownTurns}, score ${(card.checks?.validatorScore??0)}`;
  body.appendChild(txt); body.appendChild(meta);
  el.appendChild(title); el.appendChild(body);

  if(selectable){
    const lab = document.createElement("label");
    lab.style.display="block"; lab.style.padding="8px 10px";
    const cb = document.createElement("input");
    cb.type="checkbox"; cb.checked = selected;
    cb.addEventListener("change", ()=> onToggle?.(cb.checked));
    lab.appendChild(cb); lab.append(" 선택");
    el.appendChild(lab);
  }
  return el;
}

// ---- 간단 시뮬: n턴 지연/페이즈/랜덤 roll 지원 ----
export function simulateApply(card, {seed}={}){
  const rng = seedRandom(seed||"s");
  const log = [];
  const queue = []; // {atTurn, phase, effects[]}
  let turn=1, phase="main";
  const ctx = { vars:{} };

  function applyOp(op, target="enemy"){
    if(op.op==="damage"){ log.push(`[${phase}] 대상에게 ${op.amount} 피해`); }
    if(op.op==="heal"){ log.push(`[${phase}] 대상 아군 ${op.amount} 회복`); }
    if(op.op==="shield"){ log.push(`[${phase}] 대상 보호막 ${op.amount}`); }
    if(op.op==="stun"){ log.push(`[${phase}] 대상 ${op.turns}턴 기절`); }
    if(op.op==="roll"){
      const v = (Math.floor(rng()*op.sides)+1) + (op.add||0);
      ctx.vars[op.var]=v; log.push(`[${phase}] roll d${op.sides} => ${v} (→ ${op.var})`);
    }
    if(op.op==="delay"){
      queue.push({ atTurn: turn+op.turns, phase: op.phase, effects: op.effects });
      log.push(`[${phase}] ${op.turns}턴 후 ${op.phase}에 예약 ${op.effects.length}개`);
    }
  }

  // step1: 즉시효과 적용
  for(const st of card.dsl){ applyOp(st); }

  // step2: 3턴 모의 진행
  for(; turn<=3; turn++){
    for(const ph of ["main","reaction","resolve"]){
      phase=ph;
      const pending = queue.filter(q=> q.atTurn===turn && q.phase===ph);
      for(const job of pending){
        for(const st of job.effects){ applyOp(st); }
      }
    }
  }
  return log;
}
