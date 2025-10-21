// functions/src/bot-ai.js
// Bot AI logic for solo play in GodField

import { BOT_DECK, BOT_SHIN, BOT_DIFFICULTY } from '../../data/bot-config.js';

/**
 * Bot AI 엔진
 * 봇의 의사결정을 담당합니다.
 */
export class BotAI {
  constructor(difficulty = 'NORMAL') {
    this.difficulty = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.NORMAL;
    this.deck = [...BOT_DECK];
    this.shin = BOT_SHIN;
  }

  /**
   * 봇의 턴 액션을 결정합니다.
   * @param {Object} matchState - 현재 매치 상태
   * @param {string} botUid - 봇 플레이어 UID
   * @returns {Object} 액션 객체 { type, cardId, targetUid }
   */
  async decideTurn(matchState, botUid) {
    // 실제 플레이어처럼 보이기 위한 딜레이
    await this.wait(this.difficulty.thinkDelay);

    const botPlayer = matchState.players[botUid];
    const opponents = Object.entries(matchState.players)
      .filter(([uid, _]) => uid !== botUid)
      .map(([uid, player]) => ({ uid, ...player }));

    // 실수 확률 체크
    if (Math.random() < this.difficulty.errorRate) {
      return this.makeRandomAction(botPlayer, opponents);
    }

    // 전략적 판단
    return this.makeStrategicAction(botPlayer, opponents, matchState);
  }

  /**
   * 전략적 액션을 결정합니다.
   */
  makeStrategicAction(botPlayer, opponents, matchState) {
    const hand = botPlayer.hand || [];
    
    // 1. HP가 낮으면 회복 우선
    if (botPlayer.hp < 20) {
      const healingCard = this.findHealingCard(hand);
      if (healingCard) {
        return {
          type: 'PLAY_CARD',
          cardId: healingCard.instanceId,
          targetUid: matchState.players[Object.keys(matchState.players).find(uid => matchState.players[uid] === botPlayer)]
        };
      }
    }

    // 2. 공격 성향에 따라 공격 판단
    if (Math.random() < this.difficulty.aggression) {
      const weaponCard = this.findWeaponCard(hand);
      if (weaponCard) {
        const target = this.selectAttackTarget(opponents);
        if (target) {
          return {
            type: 'ATTACK',
            cardId: weaponCard.instanceId,
            targetUid: target.uid
          };
        }
      }
    }

    // 3. MP가 충분하면 기적 사용 고려
    const miracleCard = this.findUsableMiracle(botPlayer);
    if (miracleCard) {
      const target = this.selectMiracleTarget(miracleCard, opponents);
      if (target) {
        return {
          type: 'USE_MIRACLE',
          miracleName: miracleCard.name,
          targetUid: target.uid
        };
      }
    }

    // 4. 손패에 무기가 없으면 기도
    const hasWeapon = hand.some(card => card.cardType === 'weapon');
    if (!hasWeapon) {
      return { type: 'PRAY' };
    }

    // 5. 기본: 공격
    const anyWeapon = this.findWeaponCard(hand);
    if (anyWeapon) {
      const target = this.selectAttackTarget(opponents);
      if (target) {
        return {
          type: 'ATTACK',
          cardId: anyWeapon.instanceId,
          targetUid: target.uid
        };
      }
    }

    // 6. 마지막: 턴 종료
    return { type: 'END_TURN' };
  }

  /**
   * 랜덤 액션을 생성합니다 (실수 시)
   */
  makeRandomAction(botPlayer, opponents) {
    const hand = botPlayer.hand || [];
    if (hand.length === 0) {
      return { type: 'PRAY' };
    }

    const randomCard = hand[Math.floor(Math.random() * hand.length)];
    const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];

    return {
      type: 'PLAY_CARD',
      cardId: randomCard.instanceId,
      targetUid: randomOpponent?.uid
    };
  }

  /**
   * 회복 카드를 찾습니다.
   */
  findHealingCard(hand) {
    return hand.find(card => 
      card.cardType === 'item' && 
      card.dsl?.some(op => op.op === 'heal' && op.target_stat === 'hp')
    );
  }

  /**
   * 무기 카드를 찾습니다.
   */
  findWeaponCard(hand) {
    const weapons = hand.filter(card => card.cardType === 'weapon');
    if (weapons.length === 0) return null;
    
    // 가장 강력한 무기 선택
    return weapons.reduce((best, current) => {
      const bestAtk = best.stats?.attack || 0;
      const currentAtk = current.stats?.attack || 0;
      return currentAtk > bestAtk ? current : best;
    });
  }

  /**
   * 사용 가능한 기적을 찾습니다.
   */
  findUsableMiracle(botPlayer) {
    const miracles = botPlayer.miracles || [];
    return miracles.find(miracle => {
      const mpCost = miracle.stats?.mpCost || 0;
      return botPlayer.mp >= mpCost;
    });
  }

  /**
   * 공격 대상을 선택합니다.
   */
  selectAttackTarget(opponents) {
    if (opponents.length === 0) return null;
    
    // HP가 가장 낮은 적을 우선 타겟
    return opponents.reduce((weakest, current) => {
      return current.hp < weakest.hp ? current : weakest;
    });
  }

  /**
   * 기적 대상을 선택합니다.
   */
  selectMiracleTarget(miracle, opponents) {
    // 피해 기적이면 HP 낮은 적
    const isDamage = miracle.dsl?.some(op => op.op === 'damage');
    if (isDamage) {
      return this.selectAttackTarget(opponents);
    }
    
    // 기본: 랜덤 선택
    return opponents[Math.floor(Math.random() * opponents.length)];
  }

  /**
   * 방어 카드를 선택합니다 (방어 시)
   */
  selectDefenseCard(hand, incomingDamage) {
    const armorCards = hand.filter(card => card.cardType === 'armor');
    if (armorCards.length === 0) return null;

    // 충분한 방어력을 가진 카드 선택
    const suitable = armorCards.find(armor => {
      const defense = armor.stats?.defense || 0;
      return defense >= incomingDamage * 0.7; // 70% 이상 막을 수 있으면 사용
    });

    return suitable || armorCards[0]; // 없으면 첫 번째 방어구 사용
  }

  /**
   * 대기 함수
   */
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 봇 플레이어 초기 데이터를 생성합니다.
   */
  static createBotPlayer(botId = 'bot_1') {
    return {
      uid: botId,
      nickname: '천계의 수호자 (BOT)',
      isBot: true,
      isReady: true,
      shinId: 'bot_shin',
      shin: BOT_SHIN,
      selectedArtifactIds: BOT_DECK.map((_, idx) => `bot_artifact_${idx}`)
    };
  }

  /**
   * 봇의 천계 덱을 생성합니다.
   */
  static createBotDeck() {
    return BOT_DECK.map((card, idx) => ({
      ...card,
      instanceId: `bot_card_${idx}_${Date.now()}`,
      artifactId: `bot_artifact_${idx}`,
      ownerUid: 'bot_1'
    }));
  }
}

export default BotAI;
