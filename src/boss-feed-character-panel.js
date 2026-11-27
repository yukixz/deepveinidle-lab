import {
  characterEquipmentOptions, characterLimits, createCharacterContext, decodeEquipment, encodeEquipment,
  equipmentCanEnhance, equipmentEnhancementLimit, isGatheringSkill, masteryKeys, normalizeCharacter, potionKinds, roomsFor, sharedEquipmentSlots,
  toolSlots, validEquipmentTiers,
} from './boss-feed-character.js';
import * as game from './upstream.js';
import {bossText, escape} from './boss-feed-copy.js';
import {translatedName} from './i18n.js';
import {bonusPercent} from './number-format.js';
import {outfitPiece,packmasterEffectsNote,workOutfitNote} from './work-config-effects.js';
import {potionEffectNote} from './potion-effects.js';
import {masteryRank,masteryValue} from './model.js';

const slotNames = {
  shield:['副手','Off-hand'], mount:['坐骑','Mount'], helmet:['头部','Head'], body:['胸部','Body'], legs:['护腿','Legs'],
  earring:['耳环','Earring'],
};
const masteryNames = {
  xp:['经验获取','Experience gain'], move:['移动速度','Movement speed'],
  gather:['采集速度','Gathering speed'], craft:['制造速度','Crafting speed'],
};
const {bossFeedRules,houseBonus,item,potions} = game;
const potionOptions = potionKinds.filter(kind => kind !== 'bosskeeper').map(kind =>
  [kind,item(potions.find(potion => potion.kind === kind).itemId).name]);

export function renderBossAttributes(host, config, boss, language) {
  const {text:t,skill,number} = bossText(language);
  const ctx = createCharacterContext(config);
  const percentBonus = value => `${number((value - 1) * 100)}%`;
  const bonus = value => '+' + percentBonus(value);
  const gatherSpeedLabel = t('采集速度加成','Gather speed bonus');
  const craftSpeedLabel = t('制造速度加成','Craft speed bonus');
  const stat = (label,value,primary = false) => `<div class="stat${primary ? ' primary' : ''}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
  host.innerHTML = boss.skills.map(key => {
    const values = ctx.summarize(key);
    const skillLabel = skill(key);
    const items = boss.classes.filter(category => category.skill === key).flatMap(category => category.items);
    const raw = items.some(id => bossFeedRules.feedRecipe(id)?.inputs?.length === 0);
    const processed = items.some(id => bossFeedRules.feedRecipe(id)?.inputs?.length > 0);
    const mixed = raw && processed && values.rawXpMultiplier !== values.processedXpMultiplier;
    const xpLabel = t('经验加成','XP bonus');
    const xp = mixed
      ? `<div class="stat"><span>${xpLabel}</span>
          <strong>${escape(bonus(values.rawXpMultiplier))} <small>${t('采集品','Raw items')}</small></strong>
          <strong>${escape(bonus(values.processedXpMultiplier))} <small>${t('加工品','Processed items')}</small></strong>
        </div>`
      : stat(xpLabel,bonus(raw ? values.rawXpMultiplier : values.processedXpMultiplier));
    return `<div class="stats" role="group" aria-label="${escape(skillLabel)}">
      ${stat(t(`${skillLabel}等级`,`${skillLabel} level`),number(values.level),true)}
      ${stat(isGatheringSkill(key) ? gatherSpeedLabel : craftSpeedLabel,percentBonus(values.speedMultiplier))}
      ${values.productionSpeed !== values.speedMultiplier ? stat(craftSpeedLabel,percentBonus(values.productionSpeed)) : ''}
      ${xp}
      ${stat(t('移动速度','Movement speed'),`${number(values.strideSpeed / 1000)}×`)}
      ${stat(t('背包格数','Backpack slots'),number(values.capacity))}
    </div>`;
  }).join('');
}

export function renderCharacterPanel(host, {config, boss, language, onChange}) {
  const {text:t,skill,rarity} = bossText(language);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let state = config;
  const open = new Map([...host.querySelectorAll('details')].map(node => [node.id,node.open]));
  const fields = document.createDocumentFragment();
  const notes = [];
  const percent = value => bonusPercent(value,language);
  const current = value => t('当前','current') + ' ' + percent(value);
  const progression = (perLevel,bonus) => t('每级','per level') + ' ' + percent(perLevel) + ' · ' + current(bonus);

  function refreshNotes() {
    const context = createCharacterContext(state);
    for (const [note,describe] of notes) note.textContent = describe(context);
  }

  function edit(mutate) {
    const next = structuredClone(state);
    mutate(next);
    next.source = 'manual';
    next.capturedAt = null;
    next.measuredSkills = [];
    state = normalizeCharacter(next);
    refreshNotes();
    onChange(state);
  }

  function effectNote(describe, className = 'micro', tag = 'p') {
    const note = element(tag,'',className);
    note.id = 'boss-feed-config-note-' + notes.length;
    notes.push([note,describe]);
    return note;
  }

  function withNote(control, describe) {
    const wrapper = element('div','','boss-config-field');
    const note = effectNote(describe);
    control.querySelector('input,select').setAttribute('aria-describedby',note.id);
    wrapper.append(control,note);
    return wrapper;
  }

  function labeled(name, input, className = 'number-field') {
    const wrapper = element('label', '', className);
    wrapper.append(element('span',name), input);
    return wrapper;
  }

  function numberInput(current, max, update, {min = 0, step = 1} = {}) {
    const input = element('input');
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = current;
    input.addEventListener('change', () => {
      if (!input.validity.valid || input.value === '') {
        input.value = current;
        return;
      }
      current = input.valueAsNumber;
      update(current);
    });
    return input;
  }

  function numeric(name, current, max, update, options) {
    return labeled(name,numberInput(current,max,update,options));
  }

  function checkbox(name, value, update) {
    const input = element('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => update(input.checked));
    const label = element('label','','check');
    label.append(input,element('span',name));
    return label;
  }

  function selectInput(values, current, update) {
    const input = element('select');
    for (const [value,label] of values) {
      const option = element('option',label);
      option.value = value;
      input.append(option);
    }
    input.value = current;
    input.addEventListener('change', () => update(Number(input.value)));
    return input;
  }

  function select(name, values, current, update, className) {
    return labeled(name,selectInput(values,current,update),className);
  }

  function gearField(slot, title, toolSkill) {
    const fieldset = element('div','','gear-row');
    const options = [[0,t('无','None')], ...characterEquipmentOptions(slot)
      .map(item => [item.id,translatedName(item.name,language)])];
    const note = effectNote(context => {
      const actor = context.actorFor(toolSkill ?? boss.skills[0]);
      if (toolSkill) return t('工具速度','Tool speed') + ' ' + percent(bossFeedRules.workSpeed(actor,toolSkill).tool - 1);
      if (slot === 'mount') return t('移动速度','Movement speed') + ' ' + percent(bossFeedRules.mountStride(actor) / 1000 - 1);
      if (slot === 'earring') return t('投喂点数','Feeding points') + ' ' + percent(game.worldEarringBonus(actor.equipment,'bosskeeper'));
      if (slot === 'body' && game.baseItemId(actor.equipment.body ?? 0) === game.packmasterCoatId) return packmasterEffectsNote(actor.equipment,language);
      if (slot === 'shield') {
        return t('技能速度','Skill speed') + ' · ' + boss.skills.map(key =>
          skill(key) + ' ' + percent(bossFeedRules.sideSkillBonus(actor.equipment,key))).join(' · ');
      }
      const contribution = bossFeedRules.outfitContribution(outfitPiece(actor.equipment,slot),boss.key);
      return workOutfitNote(actor.equipment,boss.skills[0],language,slot) +
        ' · ' + t('本件投喂贡献','Piece feeding contribution') + ' ' + percent(contribution);
    },'gear-stats','small');
    function draw() {
      const {base,tier,plus} = decodeEquipment(state.equipment[slot]);
      const update = (id,quality,plus) => edit(next => next.equipment[slot] = encodeEquipment(id,quality,plus));
      const item = selectInput(options,base,value => {
        update(value,0,0);
        draw();
        fieldset.querySelector('select').focus();
      });
      const choices = validEquipmentTiers(base);
      const quality = selectInput(choices.map(tier => [tier,rarity(tier)]),tier,
        value => update(base,value,decodeEquipment(state.equipment[slot]).plus));
      quality.disabled = choices.length < 2;
      const enhance = numberInput(plus,equipmentEnhancementLimit(base),value => update(base,Number(quality.value),value));
      enhance.disabled = !equipmentCanEnhance(base);
      item.setAttribute('aria-label',title);
      quality.setAttribute('aria-label',title + ' ' + t('稀有度','Rarity'));
      enhance.setAttribute('aria-label',title + ' ' + t('强化','Enhance'));
      for (const field of [item,quality,enhance]) field.setAttribute('aria-describedby',note.id);
      const mods = element('div','','gear-mods');
      mods.append(quality,labeled('+',enhance,'enhance'));
      fieldset.replaceChildren(labeled(title,item,'gear-name'),mods,note);
    }
    draw();
    return fieldset;
  }

  function section(id, title, controls, grid = false) {
    const detail = element('details','','config-detail');
    detail.id = `boss-feed-character-${id}`;
    detail.open = open.get(detail.id) ?? id === 'skills';
    const group = element('div','',grid ? 'skill-grid' : '');
    group.append(...controls);
    detail.append(element('summary',title),group);
    fields.append(detail);
  }

  section('skills', t('技能','Skills'), boss.skills.map(key => numeric(
    skill(key),state.levels[key],characterLimits.level,value => edit(next => next.levels[key] = value),{min:1})),true);
  section('equipment',t('工具与装备','Tools & equipment'),[
    ...boss.skills.map(key => gearField(toolSlots[key],t(`${skill(key)}工具`,`${skill(key)} tool`),key)),
    ...sharedEquipmentSlots.map(slot => gearField(slot,t(...slotNames[slot]))),
    effectNote(() => workOutfitNote(state.equipment,boss.skills[0],language) +
      ' · ' + t('套装投喂贡献合计','Outfit feeding contribution total') + ' ' +
      percent(bossFeedRules.outfitContribution(state.equipment,boss.key)),'micro work-outfit-total'),
  ]);
  section('potions',t('药水','Potions'),[...potionOptions.map(([kind,name]) =>
    withNote(select(translatedName(name,language),[[-1,t('未启用','Inactive')],...[0,1,2,3,4].map(tier => [tier,rarity(tier)])],
      state.brews[kind],value => edit(next => next.brews[kind] = value),'potion'),
    () => potionEffectNote(kind,state.brews[kind],language) + (kind === 'gatherer'
      ? t(' · 适用于采集品投喂',' · Applies to feeding gathered items') : ''))),
    checkbox(translatedName(item(game.bosskeeperTonicId).name,language),state.brews.bosskeeper === 0,
      enabled => edit(next => next.brews.bosskeeper = enabled ? 0 : -1)),
    element('p',t('补剂每瓶持续一小时，按投喂时长计入采购成本。','Each tonic lasts one hour. The purchase cost covers the feeding duration.'),'micro'),
  ]);
  section('home',t('家园','Home'),roomsFor(boss.skills).map(room => withNote(numeric(translatedName(room.name,language),
    state.house[room.id],room.maxLevel ?? characterLimits.house,value => edit(next => next.house[room.id] = value)),
  () => t(`${skill(room.bonus.skill)}速度`,`${skill(room.bonus.skill)} speed`) + ' · ' +
    progression(houseBonus(room,1),houseBonus(room,state.house[room.id])))),true);
  section('masteries',t('精通','Masteries'),boss.skills.map(key => {
    const group = element('fieldset','','boss-fieldset');
    group.append(element('legend',skill(key)),...masteryKeys(key).map(stat => numeric(t(...masteryNames[stat]) + ' (%)',
      masteryValue(stat,state.masteries[key][stat]),masteryValue(stat,characterLimits.mastery),
      value => edit(next => next.masteries[key][stat] = masteryRank(stat,value)),{step:masteryValue(stat,1)})));
    return group;
  }));
  section('perks',t('特权','Perks'),[['pockets',t('大口袋','Big Pockets')],['quick',t('快手','Quick Hands')]].map(([key,label]) => {
    const perk = bossFeedRules.perkList.find(entry => entry.id === key);
    return withNote(numeric(label,state.perks[key],characterLimits[key],value => edit(next => next.perks[key] = value)),
      () => translatedName(perk.each,language));
  }));
  section('other',t('其它','Other'),[
    numeric(t('公会经验 (%)','Guild XP (%)'),state.guildXp * 100,1e7,
      value => edit(next => next.guildXp = value / 100),{step:'any'}),
    withNote(numeric(t('世界增益经验 (%)','World buff XP (%)'),state.worldXp * 100,1e7,
      value => edit(next => next.worldXp = value / 100),{step:'any'}),
    () => t('导入捕获时生效的世界增益，整个模拟周期保持生效。',
      'Imports world buffs active at capture; they remain active throughout the simulation.')),
    checkbox(t('矿脉祝福','Vein Blessing'),state.blessing,value => edit(next => next.blessing = value)),
    checkbox(t('当前首领印记','Current boss mark'),state.bossMarks.includes(boss.id),value => edit(next => {
      next.bossMarks = next.bossMarks.filter(id => id !== boss.id);
      if (value) next.bossMarks.push(boss.id);
    })),
  ]);
  refreshNotes();
  host.replaceChildren(fields);
}
