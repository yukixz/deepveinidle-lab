import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readJson,sha256} from './release-common.mjs';

const name='@dvi-lab/work-time';
const source=new URL('../',import.meta.resolve(name));
const target=new URL('../vendor/work-time/',import.meta.url);
const installed=await readJson(new URL('package.json',source));
const project=await readJson(new URL('../package.json',import.meta.url));
const url=project.devDependencies[name];
assert.equal(installed.name,name);
assert.ok(url.endsWith(`/refs/tags/v${installed.version}.tar.gz`),'work-time install must match the pinned release');
const checking=process.argv.includes('--check'),files={};
const modules=['index','effective-engine','adapter','domain','batch-time','boss-feed','gathering-pack'];
const sources=[...modules.map(module=>[`src/${module}.js`,`${module}.js`]),['LICENSE','LICENSE.txt']];
if(!checking)await fs.mkdir(target,{recursive:true});
for(const [input,output]of sources){
 const content=await fs.readFile(new URL(input,source));
 files[output]=sha256(content);
 const outputFile=new URL(output,target);
 if(checking)assert.equal(sha256(await fs.readFile(outputFile)),files[output],`${output}: run pnpm vendor:work-time`);
 else await fs.writeFile(outputFile,content);
}
const metadata={name,version:installed.version,license:installed.license,url,files};
const manifest=new URL('source.json',target);
if(checking)assert.deepEqual(await readJson(manifest),metadata,'work-time metadata differs. Run pnpm vendor:work-time.');
else await fs.writeFile(manifest,JSON.stringify(metadata,null,2)+'\n');
console.log(`work-time ${installed.version}: ${checking?'verified':'synced'} ${sources.length} files`);
