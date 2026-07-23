import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTransferPlan, writePlan, applyPlan } from "../transfer-eoreader42.mjs";

test("buildTransferPlan classifies legacy files by target repository", async () => {
  const root = await fixtureTree();
  const plan = buildTransferPlan(root);
  const byPath = Object.fromEntries(plan.map((item) => [item.path, item]));

  assert.equal(byPath["core/operators/epoch.js"].repo, "eoreader5");
  assert.equal(byPath["src/core/operators/lift.js"].repo, "eoreader5");
  assert.equal(byPath["src/core/operators.js"].repo, "eoreader5");
  assert.equal(byPath["src/core/resolution-face.js"].repo, "eoreader5");
  assert.equal(byPath["app/routes/legacy.js"].repo, "eoreaderapp");
  assert.equal(byPath["src/app/routes/home.js"].repo, "eoreaderapp");
  assert.equal(byPath["data/cache.json"].repo, "eoreaderapp");
  assert.equal(byPath["priors/centroids.json"].repo, "eoprior");
  assert.equal(byPath["src/priors/basis.json"].repo, "eoprior");
  assert.equal(byPath["src/core/priors.js"].repo, "eoprior");
  assert.equal(byPath["data/priors/centroids.json"].repo, "eoprior");
  assert.equal(byPath["experiments/unknown.txt"].repo, "review");
  assert.match(byPath["core/operators/epoch.js"].sha256, /^[a-f0-9]{64}$/);
});

test("writePlan records counts and applyPlan copies only classified repo files", async () => {
  const root = await fixtureTree();
  const plan = buildTransferPlan(root);
  const targetRoot = await mkdtemp(join(tmpdir(), "eo-transfer-target-"));
  const eoreader5 = join(targetRoot, "eoreader5");
  const eoreaderapp = join(targetRoot, "eoreaderapp");
  const eoprior = join(targetRoot, "eoprior");
  const out = join(targetRoot, "plan.json");

  await writePlan(plan, out);
  const manifest = JSON.parse(await readFile(out, "utf8"));
  assert.deepEqual(manifest.counts, { eoreaderapp: 3, eoreader5: 4, eoprior: 4, review: 1 });

  const copied = await applyPlan(plan, root, { eoreader5, eoreaderapp, eoprior });
  assert.equal(copied.length, 11);
  assert.equal(await readFile(join(eoreader5, "core/operators/epoch.js"), "utf8"), "operators");
  assert.equal(await readFile(join(eoreader5, "src/core/operators/lift.js"), "utf8"), "src operators");
  assert.equal(await readFile(join(eoreader5, "src/core/operators.js"), "utf8"), "flat operators");
  assert.equal(await readFile(join(eoreader5, "src/core/resolution-face.js"), "utf8"), "resolution face");
  assert.equal(await readFile(join(eoreaderapp, "app/routes/legacy.js"), "utf8"), "app");
  assert.equal(await readFile(join(eoreaderapp, "src/app/routes/home.js"), "utf8"), "src app");
  assert.equal(await readFile(join(eoreaderapp, "data/cache.json"), "utf8"), "{}\n");
  assert.equal(await readFile(join(eoprior, "priors/centroids.json"), "utf8"), "{}\n");
  assert.equal(await readFile(join(eoprior, "src/priors/basis.json"), "utf8"), "[]\n");
  assert.equal(await readFile(join(eoprior, "src/core/priors.js"), "utf8"), "priors core");
  assert.equal(await readFile(join(eoprior, "data/priors/centroids.json"), "utf8"), "{}\n");
});

async function fixtureTree() {
  const root = await mkdtemp(join(tmpdir(), "eo-transfer-source-"));
  await write(root, "core/operators/epoch.js", "operators");
  await write(root, "src/core/operators/lift.js", "src operators");
  await write(root, "src/core/operators.js", "flat operators");
  await write(root, "src/core/resolution-face.js", "resolution face");
  await write(root, "app/routes/legacy.js", "app");
  await write(root, "src/app/routes/home.js", "src app");
  await write(root, "data/cache.json", "{}\n");
  await write(root, "priors/centroids.json", "{}\n");
  await write(root, "src/priors/basis.json", "[]\n");
  await write(root, "src/core/priors.js", "priors core");
  await write(root, "data/priors/centroids.json", "{}\n");
  await write(root, "experiments/unknown.txt", "review me");
  await write(root, "node_modules/ignored.js", "ignore");
  return root;
}

async function write(root, path, body) {
  const full = join(root, path);
  await mkdir(full.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(full, body);
}
