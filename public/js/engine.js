// public/js/engine.js - The Mini Scripting Engine & Card Renderer

/**
 * 간단한 시드 기반 랜덤 함수 생성기
 * @param {string} seedStr - 시드 문자열
 * @returns {() => number} - 0과 1 사이의 값을 반환하는 함수
 */
export function seedRandom(seedStr = "seed") {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^ (h >>> 16)) >>> 0;
    return (t + 0.5) / 2 ** 32;
  };
}


// ANCHOR: render-card-tile-update
/**
 * 카드 데이터를 기반으로 HTML 엘리먼트를 생성합니다.
 * @param {object} card - 카드 데이터
 * @param {object} options - 옵션 { selectable, selected, onToggle }
 * @returns {HTMLElement} - 생성된 카드 엘리먼트
 */
export function renderCardTile(card, { selectable = false, selected = false, onToggle } = {}) {
  const el = document.createElement("div");
  // 카드 타입에 따라 클래스 추가 (skill, spell, attachment 등)
  el.className = `card card--${card.type || 'skill'}`;
  el.dataset.attr = card.attribute;

  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = `[${card.cost}] ${card.name}`;

  const body = document.createElement("div");
  body.style.padding = "8px 10px";

  const typeInfo = document.createElement("div");
  typeInfo.className = "muted";
  typeInfo.style.fontSize = "0.8rem";
  typeInfo.textContent = `${card.attribute} / ${card.rarity}`;

  const txt = document.createElement("div");
  txt.style.margin = "8px 0";
  txt.textContent = card.text || "(효과 없음)";

  const meta = document.createElement("div");
  meta.className = "muted";
  meta.textContent = `score ${card.checks?.validatorScore ?? 0}`;

  body.appendChild(typeInfo);
  body.appendChild(txt);
  body.appendChild(meta);
  el.appendChild(title);
  el.appendChild(body);

  if (selectable) {
    const lab = document.createElement("label");
    lab.style.display = "block";
    lab.style.padding = "8px 10px";
    lab.style.borderTop = "1px solid #eee";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected;
    cb.addEventListener("change", () => onToggle?.(cb.checked));
    lab.appendChild(cb);
    lab.append(" 선택");
    el.appendChild(lab);
  }
  return el;
}


// ANCHOR: game-simulator
// ---- DSL 스크립트 실행을 위한 미니 게임 시뮬레이터 ----
class GameSimulator {
  constructor(seed = "default-seed") {
    this.rng = seedRandom(seed);
    this.log = [];
    this.state = {
      players: {
        p1: { id: "p1", hp: 20, maxHp: 20, ki: 5, hand: [], discardPile: [] },
        p2: { id: "p2", hp: 20, maxHp: 20, ki: 5, hand: [], discardPile: [] },
      },
      vars: {}, // 카드 효과 내에서 사용될 변수 저장소
    };
  }

  // 표현식(동적 값)을 실제 값으로 계산합니다.
  evaluate(expr, context) {
    if (typeof expr !== 'object' || !expr.expr) return expr;

    // 간단한 표현식 해석기. 실제 게임에선 더 정교한 파서 필요.
    const code = expr.expr;
    const { caster, target, vars } = context;
    if (code.includes("roll(")) {
        const sides = parseInt(code.match(/roll\((\d+)\)/)[1], 10);
        return Math.floor(this.rng() * sides) + 1;
    }
    if (code === 'caster.hp') return this.state.players[caster.id].hp;
    if (code === 'target.hp') return this.state.players[target.id].hp;
    if (code.startsWith('vars.')) return this.state.vars[code.split('.')[1]];

    return 0; // 해석 실패 시
  }

  // DSL 스크립트의 한 단계(Op)를 실행합니다.
  executeOp(op, context) {
    this.log.push(`[EXEC] ${op.op} | Caster:${context.caster.id}, Target:${context.target?.id || 'N/A'}`);

    switch (op.op) {
      case "damage": {
        const amount = this.evaluate(op.amount, context);
        this.state.players[context.target.id].hp -= amount;
        this.log.push(`  - ${context.target.id}에게 피해 ${amount} (남은 HP: ${this.state.players[context.target.id].hp})`);
        break;
      }
      case "heal": {
        const amount = this.evaluate(op.amount, context);
        const p = this.state.players[context.target.id];
        p.hp = Math.min(p.maxHp, p.hp + amount);
        this.log.push(`  - ${context.target.id} 회복 ${amount} (현재 HP: ${p.hp})`);
        break;
      }
      case "setVar": {
        this.state.vars[op.var] = this.evaluate(op.value, context);
        this.log.push(`  - 변수 ${op.var}에 값 ${this.state.vars[op.var]} 할당`);
        break;
      }
      case "if": {
        // 간단한 조건 해석 (실제로는 더 복잡한 파싱 필요)
        const [left, comp, right] = op.cond.split(" ");
        const lVal = this.evaluate({expr: left}, context);
        const rVal = parseInt(right, 10);
        let result = false;
        if (comp === '>') result = lVal > rVal;
        if (comp === '<') result = lVal < rVal;
        if (comp === '==') result = lVal == rVal;

        this.log.push(`  - 조건문 (${op.cond}) 판별 결과: ${result}`);
        const toExecute = result ? op.then : op.else;
        if (toExecute) {
            for(const nextOp of toExecute) this.executeOp(nextOp, context);
        }
        break;
      }
       // forEach, addTrigger 등 다른 op들도 여기에 구현...
      default:
        this.log.push(`  - (미구현 Op: ${op.op})`);
    }
  }

  // 카드 실행 시뮬레이션
  run(card, casterId, targetId) {
    this.log = [`== 시뮬레이션 시작: [${card.name}] ==`];
    this.state.vars = {}; // 변수 초기화

    const context = {
        caster: this.state.players[casterId],
        target: this.state.players[targetId],
        vars: this.state.vars
    };

    for(const op of card.dsl) {
        this.executeOp(op, context);
    }
    this.log.push('== 시뮬레이션 종료 ==');
    return this.log;
  }
}

/**
 * 카드 시뮬레이션을 실행하고 로그를 반환합니다. (기존 simulateApply 대체)
 * @param {object} card - 카드 데이터
 * @param {object} options - 시뮬레이션 옵션
 * @returns {string[]} - 실행 로그
 */
export function simulateApply(card, { seed } = {}) {
  const sim = new GameSimulator(seed || Date.now().toString());
  // p1이 p2에게 카드를 사용한다고 가정
  return sim.run(card, "p1", "p2");
}
