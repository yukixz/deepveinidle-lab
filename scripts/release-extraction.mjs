import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {json} from './release-common.mjs';
const root=process.cwd(),scratch=path.join(root,'.test-artifacts');
await fs.mkdir(scratch,{recursive:true});
assert.ok(!(await fs.lstat(scratch)).isSymbolicLink(),'Extraction scratch directory must be a regular directory');
// Resolve the installed dependencies from the repository while extracting from isolated copies.
const directory=await fs.mkdtemp(path.join(scratch,'dvi-extraction-'));
try{
 for(const sub of ['scripts','vendor','src'])await fs.mkdir(path.join(directory,sub));
 await fs.copyFile('scripts/extract.mjs',path.join(directory,'scripts/extract.mjs'));
 const snapshot='vendor/game-original.js';
 await fs.copyFile(snapshot,path.join(directory,snapshot));
 const outputs=['src/upstream.js','vendor/manifest.json'];
 const execute=()=>spawnSync(process.execPath,['scripts/extract.mjs'],{cwd:directory,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
 const first=execute();assert.equal(first.status,0,first.error??first.stderr);
 const initial=await Promise.all(outputs.map(p=>fs.readFile(path.join(directory,p))));
 for(let i=0;i<outputs.length;i++)assert.deepEqual(initial[i],await fs.readFile(path.join(root,outputs[i])),`Generated output is stale: ${outputs[i]}`);
 const second=execute();assert.equal(second.status,0,second.error??second.stderr);
 for(let i=0;i<outputs.length;i++)assert.deepEqual(await fs.readFile(path.join(directory,outputs[i])),initial[i],`Repeated extraction differs: ${outputs[i]}`);
 await fs.appendFile(path.join(directory,snapshot),'\n');
 const rejected=execute();assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Unreviewed upstream snapshot/);
 for(let i=0;i<outputs.length;i++)assert.deepEqual(await fs.readFile(path.join(directory,outputs[i])),initial[i],`Rejected input changed output: ${outputs[i]}`);
 const result={repeatExtraction:true,currentOutputs:true,unknownHashRejected:true,rejectedOutputsPreserved:true};if(process.argv[2])await json(process.argv[2],result);console.log(JSON.stringify(result));
}finally{await fs.rm(directory,{recursive:true,force:true});}
