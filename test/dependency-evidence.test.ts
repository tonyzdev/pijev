import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { dependencyEvidence, formatDependencyEvidence } from "../eval/dependency-evidence.js";

test("dependency evidence reads declared installed code, preserves line references, and excludes bundled or outside data", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pijev-de-"));
  t.after(() => rm(cwd, {recursive:true,force:true}));
  const pkg=join(cwd,"node_modules/session-engine");
  await mkdir(join(pkg,"dist/bundle"),{recursive:true});
  await mkdir(join(pkg,"docs"));
  await writeFile(join(cwd,"package.json"),JSON.stringify({dependencies:{"session-engine":"1"}}));
  await writeFile(join(pkg,"package.json"),JSON.stringify({name:"session-engine",version:"1",description:"Runtime user session lifecycle",main:"dist/index.js"}));
  await writeFile(join(pkg,"dist/index.js"),"export function appendUser() {\n  return 'EXACT_SOURCE';\n}\n");
  await writeFile(join(pkg,"docs/sessions.md"),"# Sessions\nUser messages become persistent entries.\n");
  await writeFile(join(pkg,"dist/bundle/noise.js"),"export function appendUser() { return 'BUNDLE_SENTINEL'; }\n");
  await writeFile(join(pkg,".env"),"PRIVATE_SENTINEL");
  await symlink("/etc/passwd",join(pkg,"dist/outside.js"));
  const result=await dependencyEvidence({cwd,query:"How are user session messages persisted?",mode:"lexical"});
  assert.deepEqual(result.packages,["session-engine@1"]);
  assert.ok(result.candidates.some(c=>c.excerpt.includes("EXACT_SOURCE")));
  assert.ok(result.candidates.every(c=>c.path.startsWith("node_modules/session-engine/")));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SENTINEL"));
  assert.ok(!JSON.stringify(result).includes("BUNDLE_SENTINEL"));
  assert.ok(!result.candidates.some(c=>c.path.includes("outside")));
  assert.equal(result.decisions.length,0);
  for(const c of result.candidates) {
    const lines=(await readFile(join(cwd,c.path),"utf8")).split("\n");
    assert.equal(c.excerpt,lines.slice(c.startLine-1,c.startLine-1+c.excerpt.split("\n").length).join("\n"));
  }
  const rendered=formatDependencyEvidence(result);
  assert.ok(rendered.includes("Untrusted dependency evidence"));
  const payload=JSON.parse(rendered.slice(rendered.indexOf("\n")+1));
  assert.equal(payload.inventoryDigest,result.inventoryDigest);
  assert.deepEqual(payload.excerpts,result.candidates.map(({path,startLine,excerpt})=>({path,startLine,excerpt})));
  assert.ok(!rendered.includes('"decisions"'));
});

test("Jev evidence ranks the same inventory and returns original text; fallback keeps lexical selection", async(t)=>{
  const cwd=await mkdtemp(join(tmpdir(),"pijev-der-"));t.after(()=>rm(cwd,{recursive:true,force:true}));
  const pkg=join(cwd,"node_modules/session-engine");await mkdir(pkg,{recursive:true});
  await writeFile(join(cwd,"package.json"),JSON.stringify({dependencies:{"session-engine":"1"}}));
  await writeFile(join(pkg,"package.json"),JSON.stringify({name:"session-engine",version:"1",description:"user session",main:"index.js"}));
  for(let i=0;i<10;i++) await writeFile(join(pkg,`case${i}.js`),`export function userSession${i}() {\n return 'ORIGINAL_${i}';\n}\n`);
  let calls=0;
  const provider={evaluate:async(state:any,questions:any)=>{calls++; const entries=state.candidates;return {status:"ok" as const,model:"fixture",latencyMs:1,inputTokens:1,outputTokens:0,cached:false,answers:Object.fromEntries(Object.keys(questions).map(id=>[id,{type:"noul" as const,noul:JSON.stringify(entries[id]).includes("case9")?0.99:0.01}]))};}};
  const base=await dependencyEvidence({cwd,query:"user session",mode:"lexical"});
  const ranked=await dependencyEvidence({cwd,query:"user session",mode:"jev",provider});
  assert.ok(calls>0);assert.ok(ranked.candidates[0]?.path.endsWith("case9.js"));
  assert.ok(ranked.candidates[0]?.excerpt.includes("ORIGINAL_9"));
  assert.equal(base.inventoryDigest,ranked.inventoryDigest);
  const fallback=await dependencyEvidence({cwd,query:"user session",mode:"jev",provider:{evaluate:async()=>({status:"fallback",reason:"timeout",latencyMs:2})}});
  assert.deepEqual(fallback.candidates,base.candidates);
  const controller=new AbortController();controller.abort();
  await assert.rejects(dependencyEvidence({cwd,query:"user session",mode:"jev",provider,signal:controller.signal}));
});
