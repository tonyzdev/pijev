import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { checkWorkspacePath, sandboxProfile, shellEnvironment } from "../eval/sandbox.js";

test("evaluation tools reject paths and symlinks outside the workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pijev-sandbox-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  await writeFile(join(root, "outside.txt"), "private fixture");
  const { symlink } = await import("node:fs/promises");
  await symlink(root, join(cwd, "escape"));
  await assert.rejects(checkWorkspacePath(cwd, "../outside.txt"));
  await assert.rejects(checkWorkspacePath(cwd, "escape/outside.txt"));
  await assert.rejects(checkWorkspacePath(cwd, "escape/new/file.txt"));
  await checkWorkspacePath(cwd, "new/deep/file.txt");
});

test("evaluation shell inherits no provider secrets or user startup configuration", () => {
  const env = shellEnvironment("/synthetic/workspace");
  assert.equal(env.HOME, "/synthetic/workspace/.home");
  assert.equal(env.AI_GATEWAY_API_KEY, undefined);
  assert.equal(env.BASH_ENV, undefined);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "TMPDIR"]);
});

test("macOS benchmark sandbox allows workspace work and rejects protected reads/outside writes", { skip: process.platform !== "darwin" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pijev-sandbox-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "workspace");
  const protectedDir = join(root, "private");
  await mkdir(cwd);
  await mkdir(protectedDir);
  await writeFile(join(protectedDir, "secret.txt"), "synthetic private value");
  const { realpath } = await import("node:fs/promises");
  const profile = sandboxProfile(await realpath(cwd), [await realpath(protectedDir)]);
  const execute = (command: string) => promisify(execFile)("/usr/bin/sandbox-exec", ["-p", profile, "/bin/bash", "--noprofile", "--norc", "-c", command], { cwd, env: shellEnvironment(cwd) });
  await execute("echo permitted > proof.txt");
  assert.equal((await readFile(join(cwd, "proof.txt"), "utf8")).trim(), "permitted");
  await assert.rejects(execute("cat ../private/secret.txt"));
  await assert.rejects(execute("echo denied > ../outside.txt"));
});

test("real-repository sandbox can explicitly allow loopback fixture servers", { skip: process.platform !== "darwin" }, async (t) => {
  const { realpath } = await import("node:fs/promises");
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pijev-loopback-test-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const program = `const http=require('node:http'); const server=http.createServer((req,res)=>res.end('fixture')); server.listen(0,'127.0.0.1',async()=>{console.log(await (await fetch('http://127.0.0.1:'+server.address().port)).text());server.closeAllConnections();server.close();});`;
  const run = (allowLoopback: boolean) => promisify(execFile)("/usr/bin/sandbox-exec", ["-p", sandboxProfile(cwd, [], { allowLoopback }), process.execPath, "-e", program], { cwd, env: shellEnvironment(cwd), timeout: 5000 });
  await assert.rejects(run(false));
  assert.equal((await run(true)).stdout.trim(), "fixture");
});

test("candidate shells cannot read sibling candidates or reference trees in temporary directories", { skip: process.platform !== "darwin" }, async(t)=>{
  for (const temporaryRoot of ["/private/tmp", tmpdir()]) {
    const root=await realpath(await mkdtemp(join(temporaryRoot,"pijev-peer-isolation-")));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const cwd=join(root,"candidate"), peer=join(root,"reference");
    await mkdir(cwd);await mkdir(peer);
    await writeFile(join(peer,"answer.txt"),"SYNTHETIC_PEER_ANSWER");
    await writeFile(join(cwd,"source.txt"),"OWN_SOURCE");
    await mkdir(join(cwd,".tmp"));
    await writeFile(join(cwd,".tmp/cache.txt"),"OWN_CACHE");
    await writeFile(join(cwd,"local.test.mjs"),"import test from 'node:test'; test('local runtime',()=>{});\n");
    await symlink(join(peer,"answer.txt"),join(cwd,"peer-link"));
    // The actual CLI builds its profile after TMPDIR has been rewritten.
    const previousTmp=process.env.TMPDIR;
    let profile: string;
    try { process.env.TMPDIR=join(cwd,".tmp"); profile=sandboxProfile(cwd,[]); }
    finally { if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp; }
    const execute=(path:string)=>promisify(execFile)("/usr/bin/sandbox-exec",["-p",profile,"/bin/cat",path],{cwd,env:shellEnvironment(cwd)});
    assert.equal((await execute("source.txt")).stdout,"OWN_SOURCE");
    assert.equal((await execute(".tmp/cache.txt")).stdout,"OWN_CACHE");
    const localTest=await promisify(execFile)("/usr/bin/sandbox-exec",["-p",profile,process.execPath,"--test",join(cwd,"local.test.mjs")],{cwd,env:shellEnvironment(cwd)});
    assert.match(localTest.stdout, /pass 1/);
    await assert.rejects(execute(join(peer,"answer.txt")),"absolute peer path must be denied");
    await assert.rejects(execute("../reference/answer.txt"),"relative peer path must be denied");
    await assert.rejects(execute("peer-link"),"workspace symlink must not allow a peer read");
    if(peer.startsWith("/private/tmp/"))await assert.rejects(execute(join(peer,"answer.txt").replace("/private/tmp/","/tmp/")),"temporary path alias must also be denied");
  }
});
