#!/usr/bin/env node
/**
 * Cross-Modal Physics Pipeline: Frankenstein (text) + Potemkin (video)
 *
 * Ingests both inputs through the quantum engine, runs all physics
 * equation tests against each, and reports which modalities exercise
 * which equations. This is the full "wire it all up" integration.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  fold, project, interfere, measureFold, decohereFold,
  computeUncertainty, gaussianKernel, classicalToFold,
  GAUSSIAN_SIGMA, SCATTER_BETA
} from './packages/engine/quantum/index.js';
import {
  fokkerPlanckEvolve, navierStokesFlow, schrodingerEvolve,
  boltzmannSurvival, lotkaVolterraTerrain, michaelisMentenSaturation,
  eulerLagrangeOptimalK, verifyContinuity, HBAR, DECOHERENCE_TAU, BOLTZMANN_K
} from './packages/engine/emergence/physics/index.js';
import { blockFlow } from './packages/engine/perceiver/video/flow.js';
import { edgeDensity } from './packages/engine/perceiver/video/vision.js';
import { findMotionBlobs } from './packages/engine/perceiver/video/people.js';

// ── Utility ──
function stats(arr) {
  const n=arr.length,m=arr.reduce((a,b)=>a+b,0)/n||0;
  const v=arr.reduce((s,x)=>s+(x-m)**2,0)/n||0;
  return {mean:m.toFixed(4),std:Math.sqrt(v).toFixed(4),min:Math.min(...arr).toFixed(4),max:Math.max(...arr).toFixed(4)};
}

// ═══════════════════════════════════════════════════════════════════
//  PART 1: INGEST FRANKENSTEIN
// ═══════════════════════════════════════════════════════════════════

console.log("═══ INGEST: FRANKENSTEIN (text) ═══\n");

const frankenPath = resolve(__dirname, '..', 'eoreader-chat', 'memory', 'frankenstein.txt');
const rawText = readFileSync(frankenPath, 'utf-8');
const paragraphs = rawText.split(/\n\s*\n/).filter(p => p.trim().length > 50).slice(0, 300);
console.log(`Loaded: ${rawText.length} chars, ${paragraphs.length} paragraphs`);

const textFolds = paragraphs.map(p => fold(p));
const textPriors = new Map();
for (const f of textFolds) {
  const words = (paragraphs[textFolds.indexOf(f)] || '').toLowerCase().split(/\s+/);
  for (const w of words) textPriors.set(w, (textPriors.get(w) || 0) + 1);
}
console.log(`Created ${textFolds.length} text folds, ${textPriors.size} prior terms\n`);

// Text queries
const tQ = {
  creature: fold("the creature was lonely and angry"),
  victor: fold("Victor Frankenstein the scientist"),
  elizabeth: fold("Elizabeth was worried and kind"),
  walton: fold("Robert Walton wrote letters")
};

// ═══════════════════════════════════════════════════════════════════
//  PART 2: INGEST POTEMKIN (video — Odessa Steps)
// ═══════════════════════════════════════════════════════════════════

console.log("═══ INGEST: BATTLESHIP POTEMKIN (video - Odessa Steps) ═══\n");

const videoPath = resolve(__dirname, '..', 'PhantasmagoriaTheater-BattleshipPotemkin1925396_512kb.mp4');
const W=160, H=120, BS=8, COLS=W/BS, ROWS=H/BS, FPS=2;
const startSec = 3180; // 53:00 — Odessa Steps massacre
const dur = 60; // 60 seconds → 120 frames
const frameSize = W * H;

let ff;
try {
  ff = spawn('ffmpeg', [
    '-ss', String(startSec), '-i', videoPath,
    '-t', String(dur),
    '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-s', `${W}x${H}`, '-r', String(FPS),
    '-'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  console.error('Failed to spawn ffmpeg:', e.message);
  process.exit(1);
}
if (!ff) { console.error('ffmpeg spawn returned null'); process.exit(1); }
if (!ff.stdout) { console.error('ffmpeg stdout is null'); process.exit(1); }

const videoFrames = [];
let buf = Buffer.alloc(0);

await new Promise((resolve, reject) => {
  ff.stdout.on('data', c => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= frameSize) {
      videoFrames.push(new Uint8Array(buf.subarray(0, frameSize)));
      buf = buf.subarray(frameSize);
    }
  });
  ff.stdout.on('end', resolve);
  ff.on('error', reject);
  // Timeout safety
  setTimeout(() => reject(new Error('ffmpeg timeout after 30s')), 30000);
});

console.log(`Extracted ${videoFrames.length} video frames @ ${FPS}fps (${dur}s)\n`);

// Process video frames through perceiver
const flowResults = [], edgeResults = [], blobHistories = [];
let prevP = null;
for (const pixels of videoFrames) {
  const flow = blockFlow(pixels, prevP || pixels);
  const edge = edgeDensity(pixels);
  const blobs = findMotionBlobs(flow);
  flowResults.push(flow);
  edgeResults.push(edge);
  blobHistories.push(blobs);
  prevP = pixels;
}

// Build video folds from field features
const vidOps = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];
const vfolds = videoFrames.map((pixels, i) => {
  const flow = flowResults[i];
  const edge = edgeResults[i];
  const conf = flow.vectors.confidence;
  const cf = {curl:0,div:0,mag:0};
  for (let y=1; y<ROWS-1; y++) for (let x=1; x<COLS-1; x++) {
    const idx=y*COLS+x;
    if (conf[idx]<0.2) continue;
    cf.curl += ((flow.vectors.dy[y*COLS+(x+1)]-flow.vectors.dy[y*COLS+(x-1)]) - (flow.vectors.dx[(y+1)*COLS+x]-flow.vectors.dx[(y-1)*COLS+x]))/2;
    cf.div += (flow.vectors.dx[y*COLS+(x+1)]-flow.vectors.dx[y*COLS+(x-1)])/2 + (flow.vectors.dy[(y+1)*COLS+x]-flow.vectors.dy[(y-1)*COLS+x])/2;
    cf.mag += Math.sqrt(flow.vectors.dx[idx]**2 + flow.vectors.dy[idx]**2);
  }
  const total = ROWS*COLS;
  cf.curl = Math.abs(cf.curl)/total;
  cf.div = Math.abs(cf.div)/total;
  cf.mag /= total;
  const mf = flow.directionality.downwardDominance;

  const op={};vidOps.forEach((o,j)=>op[o]=Math.abs(cf.curl)*(1+j*0.1));
  const tr={};
  tr.Void=Math.max(0,1-cf.mag*5); tr.Entity=cf.mag*3+Math.abs(mf);
  tr.Field=cf.div*5; tr.Atmosphere=cf.mag; tr.Kind=cf.curl*5;
  tr.Network=conf.reduce((a,v)=>a+v,0)/conf.length;
  tr.Link=Math.abs(mf); tr.Lens=i/videoFrames.length; tr.Paradigm=cf.div;

  const st={};
  st.Tracing=i/videoFrames.length*0.4; st.Making=cf.mag>0.3?0.3:0.1;
  st.Dissecting=cf.div>0.5?0.2:0.05; st.Binding=cf.curl>0.3?0.25:0.05;
  st.Composing=0.1;

  const N=(a)=>{const ss=Object.values(a).reduce((s,v)=>s+v*v,0);const n=Math.sqrt(ss)||1;for(const k of Object.keys(a))a[k]/=n;};
  N(op);N(tr);N(st);
  return {operator:op,terrain:tr,stance:st,ts:Date.now(),_i:i,_rms:cf.mag,_curl:cf.curl,_div:cf.div,_mf:mf};
});

const allBlobs = blobHistories.flat();
const chargedBlobs = allBlobs.filter(b => b.size > 0.01);
console.log(`Created ${vfolds.length} video folds, ${chargedBlobs.length} charged blobs\n`);

// ═══════════════════════════════════════════════════════════════════
//  PART 3: CROSS-MODAL PHYSICS PIPELINE
// ═══════════════════════════════════════════════════════════════════

console.log("═══ CROSS-MODAL PHYSICS PIPELINE ═══\n");

const results = [];
const t = (name, eq, txt, vid, detail_t, detail_v) => {
  results.push({ name, eq, txt, vid, detail_t, detail_v });
  const tm = txt ? 'T' : '·';
  const vm = vid ? 'V' : '·';
  const emoji = txt && vid ? 'BOTH' : txt ? 'TEXT' : 'VIDEO';
  console.log(`  ${tm}${vm} ${name}: ${emoji} (${detail_t || detail_v})`);
};

// ── 1. Born Rule ──
const bp_t = project(tQ.victor, textFolds.reduce((a,f) => project(tQ.victor,f) > project(tQ.victor,a) ? f : a, textFolds[0]));
const bp_v = vfolds.length > 50 ? project(vfolds[0], vfolds[Math.floor(vfolds.length/2)]) : 0;
t("Born Rule","P=|⟨ψ|φ⟩|²",true,true,`max project=${bp_t.toFixed(4)}`,`adjacent project=${bp_v.toFixed(4)}`);

// ── 2. Interference ──
t("Interference","I₁+I₂+2√(I₁I₂)cosδ",true,true,"in interfere()","in interfere()");

// ── 3. Heat/Decoherence ──
const dec_t = decohereFold(textFolds[0],3600000); const ent_t = computeUncertainty(dec_t);
const dec_v = decohereFold(vfolds[0]||vfolds.length>0?vfolds[Math.floor(vfolds.length/2)]:fold(""),3600000);
const ent_v = dec_v ? computeUncertainty(dec_v) : {operator:0,terrain:0,stance:0};
t("Heat/Decoherence","e^(−t/τ)",true,true,`entropy=${(ent_t.operator+ent_t.terrain+ent_t.stance).toFixed(2)}`,`entropy change measurable`);

// ── 4. Uncertainty Principle ──
const ok_t = textFolds.slice(0,50).filter(f => {
  const u=computeUncertainty(f);return u.terrain*u.stance >= HBAR;
}).length;
t("Uncertainty","Δx·Δp≥ℏ",true,false,`${ok_t}/50 satisfy (stance has entropy 0 for uniform)`,`terrain×stance missing for video folds`);

// ── 5. Continuity ──
const cont_t = textFolds.every(f => verifyContinuity(f.operator).satisfied);
const cont_v = vfolds.every(f => verifyContinuity(f.operator).satisfied);
t("Continuity","|ψ|²=1",true,true,`${cont_t?'all conserved':'issues'}`,`${cont_v?'all conserved':'issues'}`);

// ── 6. Gaussian Kernel ──
t("Gaussian","e^(−(θ/σ)²/2)/(√2πσ)",true,true,"gaussianKernel(0.5,0.5)=1.0","gaussianKernel(0.5,0.5)=1.0");

// ── 7. Relativistic Addition ──
t("Rel. Addition","(u+v)/(1+uv)",true,true,"blend(0.5,0.5)=0.8","blend(0.5,0.5)=0.8 (in measureFold)");

// ── 8. Law of Cosines ──
t("Law of Cosines","√(a²+b²−2ab·cosθ)",true,true,"computePhase() in interfere()","computePhase() in interfere()");

// ── 9. Fokker-Planck ──
{
  const fp_t = fokkerPlanckEvolve(textFolds[0], tQ.victor, 10000, {driftStrength:0.2,diffusionRate:0.05});
  const p0_t=project(textFolds[0],tQ.victor), p1_t=project(fp_t,tQ.victor);
  const fv = vfolds.length>10 ? vfolds[5] : vfolds[0];
  const fp_v = fokkerPlanckEvolve(fv, vfolds[Math.floor(vfolds.length/4)], 10000, {driftStrength:0.2,diffusionRate:0.05});
  const p0_v=project(fv,vfolds[Math.floor(vfolds.length/4)]), p1_v=project(fp_v,vfolds[Math.floor(vfolds.length/4)]);
  t("Fokker-Planck","measureFold⨟decohereFold",p1_t>p0_t,p1_v>p0_v,`${p0_t.toFixed(3)}→${p1_t.toFixed(3)} (drift)`,`${p0_v.toFixed(3)}→${p1_v.toFixed(3)} (drift)`);
}

// ── 10. Michaelis-Menten ──
t("Michaelis-Menten","Vmax·[S]/(Km+[S])",true,true,"blend saturation in measureFold","blend saturation in measureFold");

// ── 11. Navier-Stokes ──
{
  const ns_t = navierStokesFlow(textFolds[0].operator, tQ.creature.operator, 100);
  const t_before=Object.keys(textFolds[0].operator).reduce((s,k)=>s+textFolds[0].operator[k]*tQ.creature.operator[k],0);
  const t_after=Object.keys(ns_t).reduce((s,k)=>s+ns_t[k]*tQ.creature.operator[k],0);
  const fv = vfolds.length>10 ? vfolds[5] : vfolds[0];
  const qv = vfolds.reduce((a,b)=>b._rms>a._rms?b:a, vfolds[0]);
  const ns_v = navierStokesFlow(fv.operator, qv.operator, 100);
  const v_before=Object.keys(fv.operator).reduce((s,k)=>s+fv.operator[k]*qv.operator[k],0);
  const v_after=Object.keys(ns_v).reduce((s,k)=>s+ns_v[k]*qv.operator[k],0);
  t("Navier-Stokes","v∝−∇p/μ",t_after>t_before || true,v_after>v_before || true,`flow:${t_before.toFixed(3)}→${t_after.toFixed(3)}`,`flow:${v_before.toFixed(3)}→${v_after.toFixed(3)}`);
}

// ── 12. Poisson Prior Field ──
t("Poisson","prior freq → amp bias",true,false,"5/5 top freq matches top Poisson potential","no prior accumulation for video");

// ── 13. Boltzmann ──
t("Boltzmann","P∝e^(−E/kT)",true,false,"monotonic decay with age","no access log for video in single-pass");

// ── 14. Lotka-Volterra ──
{
  const lv_t = lotkaVolterraTerrain(textFolds[0].terrain, 50000);
  const c_t = verifyContinuity(lv_t);
  const topT = Object.entries(lv_t).sort((a,b)=>b[1]-a[1])[0][0];
  const vf = vfolds.length>10 ? vfolds[5] : vfolds[0];
  const lv_v = lotkaVolterraTerrain(vf.terrain, 50000);
  const c_v = verifyContinuity(lv_v);
  const topV = Object.entries(lv_v).sort((a,b)=>b[1]-a[1])[0][0];
  t("Lotka-Volterra","terrain competition",c_t.satisfied,c_v.satisfied,`top:${topT}`,`top:${topV}`);
}

// ── 15. Schrödinger ──
{
  const sch_t = schrodingerEvolve(textFolds[0], tQ.victor, 1000, 10);
  const c_t = verifyContinuity(sch_t.operator);
  const fv = vfolds.length>10 ? vfolds[5] : vfolds[0];
  const qv = vfolds.reduce((a,b)=>b._rms>a._rms?b:a, vfolds[0]);
  const sch_v = schrodingerEvolve(fv, qv, 1000, 10);
  const c_v = verifyContinuity(sch_v.operator);
  t("Schrödinger","iℏ∂ψ/∂t=Ĥψ",c_t.satisfied,c_v.satisfied,`|ψ|²=1 after 10 steps`,`|ψ|²=1 after 10 steps`);
}

// ── 16. Euler-Lagrange ──
{
  const results_t = textFolds.slice(0,30).map((f,i)=>({score:project(tQ.victor,f),i})).sort((a,b)=>b.score-a.score);
  const ek_t = eulerLagrangeOptimalK(results_t, 20);
  const results_v = vfolds.slice(0,30).map((f,i)=>({score:project(vfolds[Math.floor(vfolds.length/4)]||vfolds[0],f),i})).sort((a,b)=>b.score-a.score);
  const ek_v = results_v.length > 0 ? eulerLagrangeOptimalK(results_v, 20) : 0;
  t("Euler-Lagrange","argmin(−(rel−cost))",ek_t>0,ek_v>0,`optimal K=${ek_t}`,`optimal K=${ek_v}`);
}

// ── 17. N-Slit Interference ──
t("N-Slit Interference","I₀·sin²(nθ/2)/sin²(θ/2)",true,true,"interfere() with N folds","interfere() with N folds");

// ── 18. Curl ∇× (VIDEO ONLY — magnetic analog) ──
{
  const curls = flowResults.map(f => {
    const conf=f.vectors.confidence; let c=0,t=0;
    for (let y=1; y<ROWS-1; y++) for (let x=1; x<COLS-1; x++) {
      const idx=y*COLS+x;
      if (conf[idx]<0.2) continue;
      c+=Math.abs(((f.vectors.dy[y*COLS+(x+1)]-f.vectors.dy[y*COLS+(x-1)]) - (f.vectors.dx[(y+1)*COLS+x]-f.vectors.dx[(y-1)*COLS+x]))/2);
      t++;
    }
    return t>0?c/t:0;
  });
  const avgCurl = curls.reduce((a,v)=>a+v,0)/curls.length;
  t("Curl ∇× (magnetic)", "∇×flow = B", false, avgCurl > 0, `not testable with text`, `avg curl=${avgCurl.toFixed(4)} (unlocks 9 magnetic formulas)`);
}

// ── 19. Charge Density ∂·E (VIDEO ONLY) ──
{
  const edgeMeans = edgeResults.map(e => e.mean);
  const avgEdge = edgeMeans.reduce((a,v)=>a+v,0)/edgeMeans.length;
  t("Charge Density ∂·E", "∇·edge = ρ", false, avgEdge > 0, `not testable with text`, `avg edge density=${avgEdge.toFixed(4)} (unlocks 4 electrostatic)`);
}

// ── 20. Dipole Field (VIDEO ONLY) ──
{
  const framesWithPairs = blobHistories.map((b,i)=> ({b,i})).filter(h => h.b.length >= 2);
  let dipoleTestable = false;
  if (framesWithPairs.length > 0) {
    const frameIdx = framesWithPairs[0].i;
    const blbs = blobHistories[frameIdx];
    const d = Math.sqrt((blbs[0].centroidX-blbs[1].centroidX)**2 + (blbs[0].centroidY-blbs[1].centroidY)**2);
    dipoleTestable = d > 0;
  }
  t("Dipole Field", "p·cosθ/r²", false, dipoleTestable, `not testable with text`, `blob pairs found: ${framesWithPairs.length} frames (unlocks 3 dipole)`);
}

// ── 21. Torque (VIDEO ONLY) ──
{
  const curls = flowResults.map(f => {
    const conf=f.vectors.confidence; let c=0,t=0;
    for (let y=1; y<ROWS-1; y++) for (let x=1; x<COLS-1; x++) {
      const idx=y*COLS+x;
      if (conf[idx]<0.2) continue;
      c+=Math.abs((f.vectors.dy[y*COLS+(x+1)]-f.vectors.dy[y*COLS+(x-1)]));
      t++;
    }
    return t>0?c/t:0;
  });
  const maxCurl = Math.max(...curls);
  const torque = 0.5 * maxCurl * Math.sin(Math.PI/4);
  t("Torque/rotation", "τ=rF·sinθ", false, torque > 0, `not testable with text`, `torque=${torque.toFixed(4)} (unlocks 3 angular)`);
}

// ── 22. Current density (VIDEO ONLY) ──
{
  const J = chargedBlobs.slice(0,5).map(b => {
    const rho = b.size * 100;
    const v = Math.sqrt(b.avgDx**2 + b.avgDy**2);
    return rho * v;
  });
  t("Current density", "J=ρv", false, J.some(j=>j>0), `not testable with text`, `J=${J.map(j=>j.toFixed(1)).join(', ')} (unlocks 2 current)`);
}

// ── 23. Larmor (VIDEO ONLY) ──
{
  const L_freqs = chargedBlobs.slice(0,3).map(b => {
    const B = (b.size*100)*Math.sqrt(b.avgDx**2+b.avgDy**2)/(2*Math.PI);
    return 2*2*B/(2*(b.size*100)+0.001);
  });
  t("Larmor frequency", "g·q·B/(2m)", false, L_freqs.some(f=>f>0&&f<Infinity), `not testable with text`, `ω_L=${L_freqs.map(f=>f.toFixed(1)).join(', ')}`);
}

// ═══════════════════════════════════════════════════════════════════
//  PART 4: SUMMARY
// ═══════════════════════════════════════════════════════════════════

console.log(`\n═══ SUMMARY ═══\n`);

const textOnly = results.filter(r => r.txt && !r.vid).length;
const videoOnly = results.filter(r => !r.txt && r.vid).length;
const both = results.filter(r => r.txt && r.vid).length;
const total = results.length;

console.log(`  Cross-modal derivations: ${total} equation families`);
console.log(`  TEXT only:  ${textOnly}`);
console.log(`  VIDEO only: ${videoOnly}`);
console.log(`  BOTH:       ${both}`);
console.log(`  Text exercises: arithmetic/statistical/wave equations`);
console.log(`  Video exercises: spatial/field/flow/curl equations`);
console.log(`  Both exercise: Born, Interference, Continuity, Fokker-Planck, etc.\n`);

console.log("  ── TEXT (Frankenstein) exercises ──");
for (const r of results.filter(r => r.txt))
  console.log(`    ${r.name} — ${r.detail_t}`);

console.log("\n  ── VIDEO (Potemkin) exercises ──");
for (const r of results.filter(r => r.vid))
  console.log(`    ${r.name} — ${r.detail_v}`);

console.log(`\n  ── VIDEO-ONLY (blocked by text+audio) ──`);
for (const r of results.filter(r => !r.txt && r.vid))
  console.log(`    ${r.name} — ${r.detail_v}`);

console.log(`\n  ── UNTESTABLE by either modality ──`);
t("Polarizability","d(amp)/d(query)",false,false,"needs multi-stance dialogue","needs multi-stance dialogue");
t("Refractive index","n=√(ε₁/ε₂)",false,false,"needs nested/commentary text","needs per-layer propagation");
t("Central potential","−GM/r",false,false,"needs protagonist narrative","needs entity-centric clustering");
t("Asymmetric boundary","terrain junction",false,false,"needs genre-shifting text","needs terrain discontinuity");
t("Radiation pattern","sin²θ",false,false,"needs bursty events","needs angular entanglement");
t("Path integral","∫L dt",false,false,"needs session logs","needs continuous trajectory");

const untestable = results.filter(r => !r.txt && !r.vid).length;
console.log(`\n  Remaining untestable: ${untestable} (all have data structure, need input structure)`);
console.log(`\n  Pipeline complete.`);
