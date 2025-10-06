// functions/src/engine.js

/**
 * 시드 기반의 예측 가능한 난수 생성기 (RNG)
 * @param {number} seed - 재현 가능한 결과를 위한 시드 숫자
 * @returns {() => number} - 0과 1 사이의 부동소수점 숫자를 반환하는 함수
 */
function createRNG(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

/**
 * 동적 표현식(expr)을 현재 게임 상태를 기반으로 실제 값으로 변환합니다.
 * @param {object | number} valueOrExpr - 숫자 또는 표현식 객체
 * @param {object} state - 현재 매치 상태
 * @param {string} casterUid - 시전자 UID
 * @returns {number} - 계산된 실제 값
 */
function evaluate(valueOrExpr, state, casterUid) {
    if (typeof valueOrExpr !== 'object' || !valueOrExpr.expr) {
        return valueOrExpr; // 이미 숫자 값인 경우 그대로 반환
    }

    const expr = valueOrExpr.expr;
    const caster = state.players[casterUid];

    // 예시: "caster.discardPile.count" -> 버린 카드 수
    if (expr === "caster.discardPile.count") {
        return state.discardPile.length;
    }
    // 추가적인 동적 값 표현식을 여기에 구현할 수 있습니다.
    // 예: caster.hp, target.markers.length 등

    return 0; // 해석 실패 시 기본값
}


/**
 * Firestore에 기록된 스택을 처리하여 게임 상태를 변경하고 로그를 생성합니다.
 * 이 함수가 전투 시스템의 핵심 두뇌 역할을 합니다.
 * @param {object} matchState - 현재 매치 데이터
 * @returns {{newState: object, logs: object[]}} - 변경된 상태와 실행 로그
 */
export function processStack(matchState) {
    const logs = [];
    let state = JSON.parse(JSON.stringify(matchState)); // 원본 불변성 유지를 위한 깊은 복사
    const rng = createRNG(state.seed);
    const stack = [...state.stack].reverse(); // LIFO 처리를 위해 복사 후 뒤집기

    while (stack.length > 0) {
        const op = stack.pop(); // 스택의 맨 위에서 Op를 하나씩 꺼냄
        const caster = state.players[op.casterUid];
        
        // 이미 패배한 플레이어는 행동 불가
        if (caster.isDefeated) continue;

        const target = op.targetUid ? state.players[op.targetUid] : caster; // 타겟이 없으면 자기 자신
        
        // 이미 패배한 플레이어는 대상이 될 수 없음 (일부 효과 제외)
        if (target.isDefeated) continue;


        const logEntry = {
            type: 'op_start',
            caster: caster.nickname,
            cardName: op.cardName,
            op: op.op,
            timestamp: Date.now()
        };
        // logs.push(logEntry); // 시작 로그는 너무 많으므로 주석 처리

        switch (op.op) {
            case 'damage': {
                const amount = evaluate(op.amount, state, op.casterUid);
                target.hp -= amount;
                logs.push({ ...logEntry, type:'damage', target: target.nickname, amount });
                break;
            }
            case 'heal': {
                const amount = evaluate(op.amount, state, op.casterUid);
                target.hp = Math.min(target.maxHp, target.hp + amount);
                logs.push({ ...logEntry, type:'heal', target: target.nickname, amount });
                break;
            }
            case 'draw': {
                const count = evaluate(op.count, state, op.casterUid);
                for (let i = 0; i < count && state.commonDeck.length > 0; i++) {
                    target.hand.push(state.commonDeck.pop());
                }
                logs.push({ ...logEntry, type:'draw', target: target.nickname, count });
                break;
            }
            case 'addMarker': {
                if (!target.markers) target.markers = [];
                target.markers.push({ name: op.name, remainingTurns: op.turns });
                logs.push({ ...logEntry, type:'add_marker', target: target.nickname, marker: op.name, turns: op.turns });
                break;
            }
            case 'if': {
                const [left, comp, right] = op.cond.split(" ");
                // 간단한 조건 해석기 (실제로는 더 정교한 파서 필요)
                const lVal = (left === "caster.hp") ? caster.hp : 0;
                const rVal = parseInt(right, 10);
                
                let result = false;
                if (comp === '<') result = lVal < rVal;
                if (comp === '>') result = lVal > rVal;
                if (comp === '==') result = lVal === rVal;

                logs.push({ ...logEntry, type:'condition', cond: op.cond, result });
                const toExecute = result ? op.then : op.else;
                if (toExecute) {
                    // 실행할 Op들을 스택의 맨 위에 추가 (역순으로 넣어야 순서대로 실행됨)
                    stack.push(...[...toExecute].reverse().map(nextOp => ({...nextOp, casterUid: op.casterUid, cardName: op.cardName})));
                }
                break;
            }
            case 'random': {
                const roll = rng();
                const success = roll < op.chance;
                logs.push({ ...logEntry, type:'random', chance: op.chance, roll, success });

                const toExecute = success ? op.then : op.else;
                if (toExecute) {
                    stack.push(...[...toExecute].reverse().map(nextOp => ({...nextOp, casterUid: op.casterUid, cardName: op.cardName})));
                }
                break;
            }
        }
    }
    
    // 처리 후 스택 비우기
    state.stack = [];

    // 플레이어 사망 처리
    for (const uid in state.players) {
        if (state.players[uid].hp <= 0 && !state.players[uid].isDefeated) {
            state.players[uid].isDefeated = true;
            state.players[uid].hp = 0; // 음수 체력 방지
            logs.push({
                type: 'system',
                message: `** ${state.players[uid].nickname} 선수가 쓰러졌습니다! **`,
                timestamp: Date.now()
            });
        }
    }

    // 게임 종료 조건 확인
    const activePlayers = Object.values(state.players).filter(p => !p.isDefeated);
    if (activePlayers.length <= 1 && state.status !== 'finished') {
        state.status = 'finished';
        const winner = activePlayers[0];
        logs.push({
            type: 'system',
            message: `** 게임 종료! 최종 승자는 ${winner ? winner.nickname : '없습니다'}! **`,
            timestamp: Date.now()
        });
    }

    return { newState: state, logs };
}
