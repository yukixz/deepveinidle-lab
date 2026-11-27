import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {routes,json,inputs,packageFiles,filesIn,checkDocs,tapSummary,runLogged,freshDirectory,markdownAnchors} from '../scripts/release-common.mjs';
import {check,buildPackage,verify} from '../scripts/release.mjs';
import {verifyHttp,verifyUsageRoute,normalizeHostedHtml} from '../scripts/release-http.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dvi-release-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const dir of ['src','vendor','tests','scripts','docs','reports','functions/api','migrations','.github/workflows','.test-artifacts/evidence'])await fs.mkdir(path.join(root,dir),{recursive:true});
 for(const [name,text]of Object.entries({'index.html':'<!doctype html><html><body><div id="app">Loading</div><script type="module" src="/src/app.js"></script></body></html>','_redirects':[...routes.slice(1).map(r=>`${r} / 200`),'/ / 200','/index.html /index.html 200','/src/* /src/:splat 200','/vendor/* /vendor/:splat 200','/* /combat 302'].join('\n'),'src/app.js':'console.log("app");','vendor/game-original.js':'// source','package.json':JSON.stringify({version:'9.0.0',devDependencies:{}}),'pnpm-lock.yaml':'lock','.gitattributes':'vendor/game-original.js whitespace=-blank-at-eol','.gitignore':'.test-artifacts/','README.md':'# Readme\n\n[Docs](docs/topic.md#内容)','DESIGN.md':'# Design','AGENTS.md':'# Agents','docs/topic.md':'# 内容'}))await fs.writeFile(path.join(root,name),text);
 await json(path.join(root,'_routes.json'),{version:1,include:['/api/usage','/api/usage-stats'],exclude:[]});
 await fs.writeFile(path.join(root,'functions/api/usage.js'),'// server handler');
 await fs.writeFile(path.join(root,'migrations/0001_usage_sessions.sql'),'-- migration');
 const evidence=path.join(root,'.test-artifacts/evidence'),receipt={status:'passed',version:'9.0.0',inputs:await inputs(root),steps:['static','tests','native','extraction','local'].map(name=>({name,status:'passed'}))};await json(path.join(evidence,'check.json'),receipt);
 return {root,evidence,receipt};
}
test('release TAP summary rejects failures, skipped/cancelled tests and incomplete output',()=>{
 const valid='# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';assert.equal(tapSummary(valid).tests,2);
 for(const key of ['fail','cancelled','skipped','todo'])assert.throws(()=>tapSummary(valid.replace('# '+key+' 0','# '+key+' 1')));
 assert.throws(()=>tapSummary(valid.replace('# tests 2','# tests 0')));assert.throws(()=>tapSummary('ok 1 - incomplete'));
});
test('logged checks preserve complete output, nonzero exit and bounded timeout',async t=>{
 const {root}=await fixture(t),log=path.join(root,'process.log');
 const failed=await runLogged(process.execPath,['-e','console.log("before");console.error("failure detail");process.exit(7)'],{cwd:root,log});assert.equal(failed.exitCode,7);assert.match(await fs.readFile(log,'utf8'),/before\nfailure detail/);
 const timed=await runLogged(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,log,timeout:100});assert.equal(timed.timedOut,true);assert.notEqual(timed.exitCode,0);
});
test('documentation checks resolve Chinese/duplicate anchors and reject broken links',async t=>{
 const {root}=await fixture(t);assert.deepEqual(await checkDocs(root),{documents:4,links:1});
 assert.ok(markdownAnchors('# 内容\n# 内容\n<a id="legacy"></a>').has('内容-1'));
 await fs.writeFile(path.join(root,'README.md'),'[missing](docs/topic.md#不存在)');await assert.rejects(checkDocs(root),/Missing document anchor/);
 await fs.writeFile(path.join(root,'README.md'),'[missing](missing.md)');await assert.rejects(checkDocs(root),/ENOENT/);
});
test('package contains only application files, keeps manifest outside and refuses existing output',async t=>{
 const {root,evidence}=await fixture(t);await fs.writeFile(path.join(root,'.test-artifacts','private.txt'),'do not publish');
 const out=path.join(root,'.test-artifacts/package');const result=await buildPackage(root,evidence,out);
 assert.deepEqual(await filesIn(out),['_redirects','_routes.json','index.html','src/app.js','vendor/game-original.js']);assert.equal(result.files.length,5);assert.equal(result.version,'9.0.0');
 await assert.rejects(buildPackage(root,evidence,out),/EEXIST/);assert.equal(await fs.readFile(path.join(out,'src/app.js'),'utf8'),'console.log("app");');
 await assert.rejects(freshDirectory(root,root),/Output must|Repository output/);await assert.rejects(freshDirectory(root,path.join(root,'src/out')),/Repository output/);
});
test('package evidence is invalidated by app/test/docs/lock changes and rejects incomplete receipts',async t=>{
 const {root,evidence,receipt}=await fixture(t);
 for(const file of ['src/app.js','tests/changed.test.mjs','docs/topic.md','pnpm-lock.yaml','.gitattributes','.github/workflows/ci.yml','_routes.json','functions/api/usage.js','migrations/0001_usage_sessions.sql']){
  const original=await fs.readFile(path.join(root,file)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});await fs.writeFile(path.join(root,file),'changed');
  await assert.rejects(buildPackage(root,evidence,path.join(root,'.test-artifacts/output')),/inputs\/environment changed/);
  if(original===null)await fs.unlink(path.join(root,file));else await fs.writeFile(path.join(root,file),original);
 }
 await json(path.join(evidence,'check.json'),{...receipt,steps:receipt.steps.slice(1)});await assert.rejects(buildPackage(root,evidence,path.join(root,'.test-artifacts/output')),/Incomplete check receipt/);
});
test('extra package files cannot pass verification',async t=>{
 const {root,evidence}=await fixture(t),out=path.join(root,'.test-artifacts/package');await buildPackage(root,evidence,out);
 await fs.writeFile(path.join(out,'secret.txt'),'secret');await assert.rejects(verify(root,evidence,out,'http://127.0.0.1:1',path.join(root,'.test-artifacts/verify')),/Unexpected package files/);
});
test('linked application entries cannot be packaged',async t=>{
 const {root}=await fixture(t),entry=path.join(root,'src/linked.js');
 try{await fs.symlink(path.join(root,'README.md'),entry,'file');}
 catch(error){
  if(process.platform!=='win32'||error.code!=='EPERM')throw error;
  t.diagnostic('Windows denied symlink creation; simulating the linked directory entry.');
  const readdir=fs.readdir;
  t.mock.method(fs,'readdir',async (directory,options)=>{
   const entries=await readdir(directory,options);
   if(directory===path.dirname(entry))entries.push({name:path.basename(entry),isSymbolicLink:()=>true});
   return entries;
  });
 }
 await assert.rejects(packageFiles(root),/Symbolic link/);
});
test('HTTP checks verify all routes, content and asset hashes and reject route/version-page substitution',async t=>{
 const {root}=await fixture(t);let mode='valid';
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/usage'){res.writeHead(mode==='valid'?405:302,{Allow:'POST',Location:'/combat'});res.end();return;}
  if(req.url.startsWith('/release-unknown-page')){res.writeHead(mode==='unknown-fallback'?200:302,{Location:'/combat'+new URL(req.url,'http://localhost').search});res.end();return;}
  if(mode==='redirect'&&req.url==='/combat'){res.writeHead(302,{Location:'/'});res.end();return;}
  const file=routes.includes(req.url)?'index.html':req.url.slice(1);let body=await fs.readFile(path.join(root,file));
  if(mode==='corrupt'&&file==='src/app.js')body=Buffer.from('wrong');if(mode==='html'&&file==='index.html')body=Buffer.from('<html>wrong</html>');
  res.writeHead(200,{'Content-Type':file==='index.html'?'text/html':'text/javascript'});res.end(body);
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,manifest=await packageFiles(root);
 const result=await verifyHttp(base,root,manifest);assert.equal(result.routes,routes.length);assert.equal(result.assets,2);
 assert.equal(await verifyUsageRoute(base),405);
 for(const [value,error]of [['redirect',/route path changed/],['unknown-fallback',/expected unknown-path redirect/],['corrupt',/byte length mismatch|SHA-256 mismatch/],['html',/unexpected HTML content/]]){mode=value;await assert.rejects(verifyHttp(base,root,manifest),error);}
 await assert.rejects(verifyUsageRoute(base),/must be served by the Pages Function/);
});
test('only known analytics injection and inter-tag whitespace are normalized',()=>{
 const base='<html><body>Content</body></html>';const injected='<html>\n<body>Content<script defer src="https://static.cloudflareinsights.com/beacon.min.js/v123" data-cf-beacon="{}"></script></body></html>';
 assert.equal(normalizeHostedHtml(injected),normalizeHostedHtml(base));assert.equal(normalizeHostedHtml(injected.replace('<script','<!-- Cloudflare Pages Analytics --><script').replace('</script>','</script><!-- Cloudflare Pages Analytics -->')),normalizeHostedHtml(base));assert.notEqual(normalizeHostedHtml(base.replace('</body>','<!-- Unknown hosting change --></body>')),normalizeHostedHtml(base));assert.notEqual(normalizeHostedHtml(base.replace('Content','Different')),normalizeHostedHtml(base));assert.notEqual(normalizeHostedHtml(base.replace('</body>','<script src="https://other.example/evil.js"></script></body>')),normalizeHostedHtml(base));
});

test('check orchestration persists passed and failed receipts with full step logs',async t=>{
 const {root}=await fixture(t);
 // Deliberately emit no stdout: durable result files, not console output, are the contract.
 for(const [name,result]of Object.entries({'release-static.mjs':{syntaxFiles:1},'native-audit.mjs':{predictions:1},'release-extraction.mjs':{unknownHashRejected:true},'release-local.mjs':{browser:{cases:28}}})){
  const destination=name==='release-local.mjs'?'process.argv[2]+"/local.json"':'process.argv[2]';
  await fs.writeFile(path.join(root,'scripts',name),`import fs from "node:fs";fs.writeFileSync(${destination},${JSON.stringify(JSON.stringify(result))});`);
 }
 await fs.writeFile(path.join(root,'tests','sample.test.mjs'),'import test from "node:test";import assert from "node:assert/strict";test("release fixture",()=>assert.equal(2+2,4));');
 const good=path.join(root,'.test-artifacts/good');const receipt=await check(root,good);assert.equal(receipt.status,'passed');assert.equal(receipt.steps.length,5);assert.equal(receipt.steps[1].summary.tests,1);assert.equal(await fs.readFile(path.join(good,'static.log'),'utf8'),'');assert.match(await fs.readFile(path.join(good,'tests.log'),'utf8'),/release fixture/);
 await fs.writeFile(path.join(root,'scripts','native-audit.mjs'),'console.error("native difference sentinel");process.exit(3);');
 const bad=path.join(root,'.test-artifacts/bad');await assert.rejects(check(root,bad),/native difference sentinel/);const failure=JSON.parse(await fs.readFile(path.join(bad,'check.json')));assert.equal(failure.status,'failed');assert.equal(failure.steps.at(-1).name,'native');assert.equal(failure.steps.at(-1).exitCode,3);assert.equal(failure.steps.length,3);
 await fs.writeFile(path.join(root,'scripts','native-audit.mjs'),'// exit successfully but omit the required result file');
 const missing=path.join(root,'.test-artifacts/missing');await assert.rejects(check(root,missing),/ENOENT/);const incomplete=JSON.parse(await fs.readFile(path.join(missing,'check.json')));assert.equal(incomplete.status,'failed');assert.equal(incomplete.steps.at(-1).status,'failed');
});
test('verification refuses modified package bytes before contacting its target',async t=>{
 const {root,evidence}=await fixture(t),out=path.join(root,'.test-artifacts/package');await buildPackage(root,evidence,out);await fs.writeFile(path.join(out,'src/app.js'),'changed bytes');
 await assert.rejects(verify(root,evidence,out,'http://127.0.0.1:1',path.join(root,'.test-artifacts/verify')),/Package file list or content changed/);
});

test('hidden and unknown application files are refused',async t=>{
 const {root}=await fixture(t);await fs.writeFile(path.join(root,'src','.env'),'private');await assert.rejects(packageFiles(root),/Not an application file/);await fs.unlink(path.join(root,'src','.env'));
 await fs.writeFile(path.join(root,'src','notes.md'),'not an application');await assert.rejects(packageFiles(root),/Not an application file/);
});
test('symbolic source directories are refused',async t=>{
 const {root}=await fixture(t),source=path.join(root,'src'),target=path.join(root,'.test-artifacts','source');
 await fs.rename(source,target);
 try{await fs.symlink(target,source,process.platform==='win32'?'junction':'dir');}
 catch(error){
  if(process.platform!=='win32'||error.code!=='EPERM')throw error;
  t.diagnostic('Windows denied junction creation; simulating the linked source directory.');
  const lstat=fs.lstat;
  t.mock.method(fs,'lstat',(file,options)=>file===source?{isSymbolicLink:()=>true}:lstat(file,options));
 }
 await assert.rejects(packageFiles(root),/Symbolic directory/);
});

test('local verification reports server startup failure without hanging or claiming success',async t=>{
 const {root,evidence}=await fixture(t),script=path.resolve('scripts/release-local.mjs'),log=path.join(root,'local-failure.log');
 const result=await runLogged(process.execPath,[script,evidence],{cwd:root,log,timeout:5000});assert.equal(result.timedOut,false);assert.notEqual(result.exitCode,0);assert.match(await fs.readFile(log,'utf8'),/Local server exited/);assert.match(await fs.readFile(path.join(evidence,'server.log'),'utf8'),/Cannot find module/);
});
