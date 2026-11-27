import * as game from './upstream.js';
// Missing upstream terms only: game translations always take precedence.
export const fallbackTranslations={
"Off-hand":"副手","Head":"头部","Body":"胸部","Earring":"耳环",
"Upgrades":"升级","Flasks":"烧瓶",
"Pure coal":"纯净煤矿",
"Pickaxe":"镐","Fishing rod":"鱼竿","Axe":"斧",
"Pan":"平底锅","Hammer":"锤","Knife":"刀","Mortar":"研钵","Needle":"针"};
export const dictionary={...fallbackTranslations,...game.uiTranslations,...game.worldTranslations,...game.translations,...game.homeTranslations};
for(const item of game.items){
 if(item.id!==game.baseItemId(item.id))continue;
 const unfinished=game.unfinishedGear(item.id);
 if(!unfinished||dictionary[item.name])continue;
 const finishedName=dictionary[game.item(unfinished.of).name];
 if(finishedName)dictionary[item.name]=`未完成的${finishedName}`;
}
export const translatedName=(text,language)=>language==='zh'?(dictionary[text]??text):text;
// Rarity is displayed separately; translate the original base item name.
export const translatedItemName=(id,language)=>translatedName(game.item(game.baseItemId(id)).name,language);
