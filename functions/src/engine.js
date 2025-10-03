// functions/src/engine.js

// 시드 기반 난수 생성기 (결과 재현을 위해)
function createRNG(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = s * 16807 % 2147483647;
        return (s - 1) / 2147483646;
    };
}

/**
 * 스택을 처리하여 게임 상태를 변경하고 로그를 생성합니다.
 * @param {object} matchState - 현재 매치 데이터
 * @returns {{newState: object, logs: string[]}} - 변경된 상태와 실행 로그
 */
export function processStack(matchState) {
    const logs = [];
    let state = JSON.parse(JSON.stringify(matchState)); // 깊은 복사로 원본 불변성 유지
    const rng = createRNG(state.seed);
    const stack = [...state.stack].reverse(); // LIFO 처리를 위해 복사 후 뒤집기

    while (stack.length > 0) {
        const op = stack.pop(); // 스택의 맨 위(이제 배열의 끝)에서 Op를 꺼냄
        const caster = state.players[op.casterUid];
        const target = op.targetUid ? state.players[op.targetUid] : null;

        logs.push(`[${caster.nickname}]님의 [${op.cardName || op.op}] 효과 발동!`);

        switch (op.op) {
            case 'damage':
                if (!target) break;
                const damageAmount = op.amount - (target.shield || 0);
                if (damageAmount > 0) {
                    target.hp -= damageAmount;
                    target.shield = 0;
                    logs.push(` -> ${target.nickname}님에게 ${damageAmount}의 피해! (남은 HP: ${target.hp})`);
                } else {
                    target.shield -= op.amount;
                    logs.push(` -> ${target.nickname}님의 보호막이 피해를 흡수했습니다. (남은 보호막: ${target.shield})`);
                }
                break;

            case 'shield':
                if (!target) break;
                target.shield = (target.shield || 0) + op.amount;
                logs.push(` -> ${target.nickname}님이 보호막 ${op.amount}을 얻었습니다.`);
                break;
            
            case 'heal':
                 if (!target) break;
                 target.hp = Math.min(target.maxHp, target.hp + op.amount);
                 logs.push(` -> ${target.nickname}님이 HP를 ${op.amount} 회복했습니다.`);
                 break;

            case 'random':
                const roll = rng();
                logs.push(` -> 확률 ${op.chance * 100}% 판정... (결과: ${roll.toFixed(3)})`);
                if (roll < op.chance) {
                    logs.push(` -> 성공!`);
                    // 성공 효과들을 스택의 맨 위에 추가 (역순으로 넣어야 순서대로 실행됨)
                    if(op.then) stack.push(...[...op.then].reverse());
                } else {
                    logs.push(` -> 실패.`);
                    if(op.else) stack.push(...[...op.else].reverse());
                }
                break;
            
            // ... 다른 op 핸들러들 ...
        }
    }
    
    state.stack = []; // 처리 후 스택 비우기
    return { newState: state, logs };
}
