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
 * 타겟 식별자를 실제 플레이어 UID 목록으로 변환합니다.
 * @param {string} target - 타겟 식별자 ('enemy', 'caster', 'all_enemies', 'all_players', 'random_enemy', 또는 실제 UID)
 * @param {string} casterUid - 시전자 UID
 * @param {object} players - 플레이어 객체 맵
 * @param {function} rng - 랜덤 함수
 * @returns {string[]} - 타겟 UID 배열
 */
function resolveTargets(target, casterUid, players, rng) {
    if (!target) return [casterUid];
    
    const allUids = Object.keys(players);
    const otherUids = allUids.filter(uid => uid !== casterUid && !players[uid].isDefeated);
    
    switch (target) {
        case 'caster':
            return [casterUid];
        case 'enemy':
            // 기본 단일 대상 (첫 번째 적)
            return otherUids.length > 0 ? [otherUids[0]] : [];
        case 'all_enemies':
            return otherUids;
        case 'all_players':
            return allUids.filter(uid => !players[uid].isDefeated);
        case 'random_enemy':
            if (otherUids.length === 0) return [];
            const randomIndex = Math.floor(rng() * otherUids.length);
            return [otherUids[randomIndex]];
        default:
            // 실제 UID로 간주
            return players[target] ? [target] : [];
    }
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
            case 'apply_disaster': {
                const targets = resolveTargets(op.target, op.casterUid, state.players, rng);
                for (const targetUid of targets) {
                    const targetPlayer = state.players[targetUid];
                    if (!targetPlayer.disasters) targetPlayer.disasters = [];
                    targetPlayer.disasters.push({ name: op.disasterName, level: 1 });
                    logs.push({ ...logEntry, type:'apply_disaster', target: targetPlayer.nickname, disaster: op.disasterName });
                }
                break;
            }
            case 'remove_disaster': {
                const targets = resolveTargets(op.target, op.casterUid, state.players, rng);
                for (const targetUid of targets) {
                    const targetPlayer = state.players[targetUid];
                    if (targetPlayer.disasters) {
                        if (op.disasterName) {
                            // 특정 재앙 제거
                            targetPlayer.disasters = targetPlayer.disasters.filter(d => d.name !== op.disasterName);
                            logs.push({ ...logEntry, type:'remove_disaster', target: targetPlayer.nickname, disaster: op.disasterName });
                        } else {
                            // 모든 재앙 제거
                            targetPlayer.disasters = [];
                            logs.push({ ...logEntry, type:'remove_disaster', target: targetPlayer.nickname, disaster: 'all' });
                        }
                    }
                }
                break;
            }
            case 'modify_stat': {
                const targets = resolveTargets(op.target, op.casterUid, state.players, rng);
                const amount = evaluate(op.amount, state, op.casterUid);
                for (const targetUid of targets) {
                    const targetPlayer = state.players[targetUid];
                    const statName = op.target_stat || 'hp';
                    
                    if (statName === 'hp') {
                        targetPlayer.hp = Math.max(0, Math.min(targetPlayer.maxHp, targetPlayer.hp + amount));
                    } else if (statName === 'mp') {
                        targetPlayer.mp = Math.max(0, Math.min(targetPlayer.maxMp || 99, targetPlayer.mp + amount));
                    } else if (statName === 'gold') {
                        targetPlayer.gold = Math.max(0, Math.min(99, targetPlayer.gold + amount));
                    }
                    logs.push({ ...logEntry, type:'modify_stat', target: targetPlayer.nickname, stat: statName, amount });
                }
                break;
            }
            case 'discard': {
                const targets = resolveTargets(op.target, op.casterUid, state.players, rng);
                const count = evaluate(op.count, state, op.casterUid);
                for (const targetUid of targets) {
                    const targetPlayer = state.players[targetUid];
                    const discarded = targetPlayer.hand.splice(0, Math.min(count, targetPlayer.hand.length));
                    state.discardPile = state.discardPile || [];
                    state.discardPile.push(...discarded);
                    logs.push({ ...logEntry, type:'discard', target: targetPlayer.nickname, count: discarded.length });
                }
                break;
            }
            case 'absorb_hp': {
                const targets = resolveTargets(op.target, op.casterUid, state.players, rng);
                const amount = evaluate(op.amount, state, op.casterUid);
                let totalAbsorbed = 0;
                for (const targetUid of targets) {
                    const targetPlayer = state.players[targetUid];
                    const absorbed = Math.min(amount, targetPlayer.hp);
                    targetPlayer.hp -= absorbed;
                    totalAbsorbed += absorbed;
                    logs.push({ ...logEntry, type:'absorb_hp', target: targetPlayer.nickname, amount: absorbed });
                }
                // 흡수한 HP를 시전자에게 회복
                if (totalAbsorbed > 0) {
                    caster.hp = Math.min(caster.maxHp, caster.hp + totalAbsorbed);
                    logs.push({ ...logEntry, type:'heal', target: caster.nickname, amount: totalAbsorbed, source: 'absorb' });
                }
                break;
            }
            case 'reflect_damage': {
                // 피해 반사는 실제 피해 처리 중에 활성화되어야 하므로 플래그 설정
                const multiplier = op.multiplier || 1.0;
                if (!target.reflectDamage) target.reflectDamage = [];
                target.reflectDamage.push({ multiplier, cardName: op.cardName });
                logs.push({ ...logEntry, type:'reflect_damage', target: target.nickname, multiplier });
                break;
            }
            case 'on_user_death': {
                // 사망 트리거는 플레이어에게 등록
                if (!target.deathTriggers) target.deathTriggers = [];
                target.deathTriggers.push({ dsl: op.dsl, cardName: op.cardName });
                logs.push({ ...logEntry, type:'on_user_death', target: target.nickname });
                break;
            }
            case 'equip': {
                // 장비 슬롯에 카드 장착
                const slot = op.slot || 'weapon';
                if (!caster.equipment) caster.equipment = {};
                // 이미 장착된 장비는 손으로 되돌림
                if (caster.equipment[slot]) {
                    caster.hand.push(caster.equipment[slot]);
                }
                caster.equipment[slot] = { cardName: op.cardName };
                logs.push({ ...logEntry, type:'equip', target: caster.nickname, slot });
                break;
            }
            case 'change_attribute': {
                const targets = resolveTargets(op.target, op.casterUid, state.players, rng);
                for (const targetUid of targets) {
                    const targetPlayer = state.players[targetUid];
                    // 속성 변환은 특정 효과나 버프에 저장
                    if (!targetPlayer.attributeChanges) targetPlayer.attributeChanges = [];
                    targetPlayer.attributeChanges.push({ from: op.from, to: op.to });
                    logs.push({ ...logEntry, type:'change_attribute', target: targetPlayer.nickname, from: op.from, to: op.to });
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
