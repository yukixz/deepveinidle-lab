import * as game from './upstream.js';
import {bonusPercent} from './number-format.js';

const outfitSlots = ['helmet','body','legs'];

export function configuredWorkEquipment(gear) {
  return Object.fromEntries(['shield','earring',...outfitSlots].map(slot => {
    const {id,tier,plus} = gear[slot] ?? {};
    return [slot,id ? game.encode(game.withRarity(id,tier),plus) : null];
  }));
}

export function outfitPiece(equipment, slot) {
  return {helmet:null,body:null,legs:null,[slot]:equipment[slot]};
}

export function workOutfitNote(equipment, skill, language, slot) {
  const label = slot ? ['本件经验','Piece XP'] : ['套装经验合计','Outfit XP total'];
  const worn = slot ? outfitPiece(equipment,slot) : equipment;
  return label[language === 'zh' ? 0 : 1] + ' ' + bonusPercent(game.outfitXpBonus(worn,skill),language);
}

export function workStrideSpeed(player) {
  const base = game.mountSpeed(player) + Math.round(game.packmasterMoveBonus(player.equipment) * 1000);
  return Math.round(base * (1 + game.bossFeedRules.swiftSpeedBonus * game.brewScale(player,'swift')) *
    game.masteryMultiplier(player.masteries,'move'));
}

export function packmasterEffectsNote(equipment, language) {
  const movement = bonusPercent(game.packmasterMoveBonus(equipment), language);
  const slots = game.packmasterSlotBonus(equipment);
  return language === 'zh' ? `移动速度 ${movement} · 背包格子 +${slots}` : `Movement speed ${movement} · Backpack slots +${slots}`;
}
