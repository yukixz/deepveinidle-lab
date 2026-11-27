import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createScenario} from '../src/simulation.js';
import {game,slots,defaults,normalize,calculate,preset,chooseLanguage,sortEnemies} from '../src/model.js';
test('empty character: hand-calculated baseline',()=>{const r=calculate(defaults());assert.deepEqual(r.stats,{hit:1,accuracy:11,evasion:11,style:'melee',strength:0,armour:0,hp:10,seconds:3});assert.equal(r.rows.length,20);assert.equal(r.rows.find(x=>x.id===1).chance,.5);});
test('rarity rounds first, enhancement rounds second',()=>{const s=defaults();s.levels.melee=30;s.gear.weapon={id:110,tier:2,plus:5};const r=calculate(s);assert.equal(r.stats.accuracy,53);assert.equal(r.stats.strength,10);assert.equal(r.stats.hit,6);assert.equal(r.stats.seconds,2.4);});
test('class weapon divisors: shortbow 8, longbow 5, staff 4.5, greatsword 6',()=>{for(const [predicate,divisor]of [[g=>g.ranged&&g.speed===3,8],[g=>g.ranged&&g.speed===5,5],[g=>g.magic,4.5],[g=>g.twoHanded,6]]){const g=game.equipment.find(x=>x.slot==='weapon'&&x.levelReq===1&&predicate(x));assert.ok(g);const s=defaults();s.levels={melee:40,ranged:40,magic:40,defence:40,hitpoints:40};s.gear.weapon={id:g.itemId,tier:0,plus:0};assert.equal(calculate(s).stats.hit,1+Math.floor((40+g.strength)/divisor));}});
test('magic halves defence before the flat 10',()=>{const s=preset('magic'),r=calculate(s),m=r.rows.find(x=>x.name==='Ice wight');assert.equal(m.chance,r.stats.accuracy/(r.stats.accuracy+10+106/2));});
test('food + warrior are additive, home and mastery multiplicative',()=>{const s=defaults();s.levels.melee=79;s.fed=true;s.brews.warrior=0;s.house.post=10;s.masteries.maxhit=10;const r=calculate(s);assert.equal(r.stats.hit,Math.ceil(10*1.35*1.05*1.05));assert.equal(r.stats.accuracy,99);});
test('underlevel weapon and armour contribute stats and enter simulation with warnings',()=>{
 const s=defaults();s.gear.weapon={id:114,tier:2,plus:5};
 const armour=game.equipment.find(g=>g.slot==='body'&&g.needs==='melee'&&g.levelReq>1&&g.style==='melee');
 assert.ok(armour);s.gear.body={id:armour.itemId,tier:0,plus:0};
 const r=calculate(s),weaponId=game.encode(game.withRarity(114,2),5),weapon=game.gear(weaponId);
 assert.equal(r.player.equipment.weapon,weaponId);assert.equal(r.player.equipment.body,armour.itemId);
 assert.equal(r.stats.accuracy,11+weapon.accuracy+armour.accuracy);
 assert.equal(r.stats.strength,weapon.strength+armour.strength);assert.equal(r.stats.armour,weapon.defence+armour.defence);
 assert.deepEqual(r.issues.filter(i=>i.kind==='level'),[{kind:'level',slot:'weapon',skill:'melee',level:weapon.levelReq},{kind:'level',slot:'body',skill:armour.needs,level:armour.levelReq}]);
 const simulation=createScenario(s).player;assert.equal(simulation.equipment.weapon,weaponId);assert.equal(simulation.equipment.body,armour.itemId);
 s.levels.melee=weapon.levelReq;s.levels[armour.needs]=Math.max(s.levels[armour.needs],armour.levelReq);
 assert.ok(!calculate(s).issues.some(i=>i.kind==='level'));
});
test('two-handed excludes off-hand even when the weapon is underlevel',()=>{
 const s=defaults();s.gear.weapon={id:394,tier:0,plus:0};s.gear.shield={id:115,tier:0,plus:0};
 const r=calculate(s);assert.ok(r.issues.some(i=>i.kind==='level'&&i.slot==='weapon'));assert.ok(r.issues.some(i=>i.kind==='twoHanded'));
 assert.equal(r.player.equipment.weapon,394);assert.equal(r.player.equipment.shield,null);
 assert.equal(createScenario(s).player.equipment.shield,null);
});
test('wrong-style armour and off-hand are excluded but retained in the saved build',()=>{
 const state=defaults();state.gear.weapon={id:140,tier:0,plus:0};
 const bare=calculate(state);
 state.gear.helmet={id:120,tier:0,plus:0};state.gear.shield={id:115,tier:0,plus:0};
 const mixed=calculate(state);
 assert.deepEqual(mixed.stats,bare.stats);
 assert.deepEqual(mixed.issues,[{kind:'style',slot:'shield'},{kind:'style',slot:'helmet'}]);
 assert.equal(mixed.state.gear.helmet.id,120);
 assert.equal(mixed.state.gear.shield.id,115);
});
test('rare crops have both food buffs, healing includes additive bonuses',()=>{const s=defaults();s.food={id:170,tier:1};s.brews.nourish=0;s.meals=10;const r=calculate(s);assert.equal(r.food.healing,6);assert.equal(r.food.fedSeconds,120);assert.equal(r.food.rootSeconds,120);});
test('all normal targets share max hit; incoming protection reduces max',()=>{const s=preset('ranged');s.rooted=true;const r=calculate(s);assert.ok(r.rows.every(x=>x.max===r.stats.hit));assert.equal(r.rows.find(x=>x.name==='Ice wight').enemyMax,27);});
test('saved configuration normalization, upper bounds and defaults',()=>{const s=normalize({levels:{melee:9999,magic:-2},gear:{weapon:{id:999,tier:9,plus:-1}},brews:{warrior:'oops'}});assert.equal(s.levels.melee,game.maxLevel);assert.equal(s.levels.magic,1);assert.equal(s.levels.hitpoints,10);assert.equal(s.gear.weapon.id,0);assert.equal(s.brews.warrior,-1);assert.deepEqual(normalize(JSON.parse(JSON.stringify(preset('magic')))),preset('magic'));});
test('presets are valid for all styles',()=>{for(const style of ['melee','ranged','magic']){const r=calculate(preset(style));assert.equal(r.stats.style,style);assert.equal(r.issues.length,0);}});
test('language follows saved choice, then browser language list',()=>{assert.equal(chooseLanguage('en',['zh-CN']),'en');assert.equal(chooseLanguage(null,['en-US','zh-TW']),'zh');assert.equal(chooseLanguage(null,['fr']),'en');});
test('snapshot hash and every extracted original declaration match manifest',()=>{const source=fs.readFileSync('vendor/game-original.js','utf8'),generated=fs.readFileSync('src/upstream.js','utf8'),manifest=JSON.parse(fs.readFileSync('vendor/manifest.json','utf8'));const hash=x=>crypto.createHash('sha256').update(x).digest('hex');assert.equal(hash(source),manifest.sha256);for(const d of manifest.declarations){const text=source.slice(d.start,d.end);assert.ok(generated.includes(text),d.name);const candidates=[text,...['const','let','var'].map(k=>k+' '+text+';')];assert.ok(candidates.some(x=>hash(x)===d.sha256),d.name);}});

test('combat random samples include the upstream integer mixing step',()=>{
 // Fixed vectors independently checked using unbounded integer multiplication
 // modulo 2^32. Raw values are the pre-mix samples used by the old snapshot.
 const vectors=[
  [0,1,1000001,3621179820,3230848567],
  [0,1,1000002,4202739916,2202290078],
  [0,1,1000003,1264039605,1173829368],
  [123,42,987654,2253720909,2557656668],
  [0,0,0,2932326263,493009611],
 ];
 for(const [seed,id,tick,mixed,raw]of vectors){
  const actual=game.randomFloat(seed,id,tick);
  assert.equal(actual,mixed/2**32);
  assert.notEqual(actual,raw/2**32);
 }
});


test('style change keeps shared stats and removes incompatible gear',async()=>{const {selectStyle,gearForStyle}=await import('../src/model.js');const s=selectStyle(preset('ranged'),'magic');assert.equal(s.style,'magic');assert.equal(s.levels.ranged,85);assert.ok(game.gear(s.gear.weapon.id).magic);for(const slot of slots)assert.ok(!s.gear[slot].id||gearForStyle(slot,'magic').some(g=>g.itemId===s.gear[slot].id));});
test('all ordinary battle potions survive normalization',()=>{const s=defaults();for(const p of game.potions)if(p.kind!=='bosskeeper')s.brews[p.kind]=4;assert.deepEqual(normalize(s).brews,s.brews);assert.ok(!Object.hasOwn(s.brews,'bosskeeper'));});

test('complete home and mastery configuration round trips',()=>{const s=defaults();assert.deepEqual(Object.keys(s.house),game.rooms.map(x=>x.id));assert.deepEqual(Object.keys(s.masteries),game.masteries.map(x=>x.id));for(const r of game.rooms)s.house[r.id]=50;for(const m of game.masteries)s.masteries[m.id]=123;const restored=normalize(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored.house,s.house);assert.deepEqual(restored.masteries,s.masteries);});
test('home damage follows the level 50 station cap',()=>{const s=preset('ranged'),base=calculate(s).stats.hit;s.house.target=100;assert.equal(calculate(s).stats.hit,Math.ceil(base*1.25));s.house.target=150;assert.equal(calculate(s).stats.hit,Math.ceil(base*1.25));});
test('non-combat options do not invent combat effects',()=>{const s=preset('magic'),base=calculate(s).stats;for(const r of game.rooms)if(r.bonus.kind!=='dmg')s.house[r.id]=100;for(const m of game.masteries)if(!['hp','accuracy','maxhit'].includes(m.id))s.masteries[m.id]=100;assert.deepEqual(calculate(s).stats,base);});
test('all potion home and mastery labels have Chinese translations',async()=>{const {translatedName}=await import('../src/i18n.js');for(const label of [...game.potions.map(p=>game.item(p.itemId).name),...game.rooms.map(r=>r.name),...game.masteries.flatMap(m=>[m.name,m.blurb])]){assert.notEqual(translatedName(label,'zh'),label);assert.equal(translatedName(label,'en'),label);}});

test('mount upgrades use their own multipliers without changing combat stats',()=>{
 const base=calculate(defaults());
 for(const [tier,speed]of [[0,1120],[1,1180],[2,1270],[3,1420],[4,1600]]){
  const s=defaults();s.gear.mount={id:328,tier,plus:0};const r=calculate(s);
  assert.equal(game.mountSpeed(r.player),speed);assert.deepEqual(r.stats,base.stats);assert.deepEqual(r.issues,[]);
 }
 const s=defaults();s.gear.mount={id:328,tier:2,plus:5};assert.equal(game.mountSpeed(calculate(s).player),1473);
 s.gear.mount={id:328,tier:4,plus:100};assert.equal(game.mountSpeed(calculate(s).player),3400);
});
test('mount survives storage and style changes, old configurations stay unmounted',async()=>{
 const {selectStyle}=await import('../src/model.js');const s=defaults();s.gear.mount={id:328,tier:3,plus:7};
 assert.deepEqual(normalize(JSON.parse(JSON.stringify(s))).gear.mount,s.gear.mount);
 for(const style of ['melee','magic','ranged'])assert.deepEqual(selectStyle(s,style).gear.mount,s.gear.mount);
 delete s.gear.mount;assert.deepEqual(normalize(s).gear.mount,{id:0,tier:0,plus:0});
 s.gear.mount={id:110,tier:4,plus:100};assert.equal(normalize(s).gear.mount.id,0);
 for(const style of ['melee','magic','ranged'])assert.equal(preset(style).gear.mount.id,0);
});

test('all numeric enemy columns sort both ways, keeping missing values last',()=>{
 const keys=['level','hp','max','chance','enemyMax','enemyChance','homeBank','kills','xp','coins','normal','rare','food'];
 for(const key of keys){
  const rows=[{id:'missing',[key]:null},{id:'high',[key]:12.04},{id:'zero',[key]:0},{id:'low',[key]:12.01},{id:'absent'},{id:'invalid',[key]:NaN}];
  const before=rows.map(r=>r.id);
  assert.deepEqual(sortEnemies(rows,key,'asc').map(r=>r.id),['zero','low','high','missing','absent','invalid'],key);
  assert.deepEqual(sortEnemies(rows,key,'desc').map(r=>r.id),['high','low','zero','missing','absent','invalid'],key);
  assert.deepEqual(rows.map(r=>r.id),before);
 }
});
test('reward sorting uses raw simulation values, preserving ties and pending results',()=>{
 const rows=[{key:'pending'},{key:'a'},{key:'b'},{key:'c'}];
 const rewards=new Map([['a',{xp:100.004}],['b',{xp:100.001}],['c',{xp:100.004}]]);
 const value=row=>rewards.get(row.key)?.xp;
 assert.deepEqual(sortEnemies(rows,'xp','asc',value).map(r=>r.key),['b','a','c','pending']);
 assert.deepEqual(sortEnemies(rows,'xp','desc',value).map(r=>r.key),['a','c','b','pending']);
});
