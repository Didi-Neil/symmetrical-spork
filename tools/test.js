#!/usr/bin/env node
/* tools/test.js — tests unitaires (GDD §13.2) et courte simulation de bots (§13.1), dans Chromium via Playwright.
   Ouvre index.html#debug en file://, lance BE.Debug.tests() puis BE.Debug.simulate() (quelques runs),
   affiche les résultats et sort avec un code ≠ 0 au moindre échec (test rouge, run en erreur, erreur console).
   Usage : NODE_PATH=$(npm root -g) node tools/test.js [--filter texte] [--runs 4] [--policy greedy] [--no-sim] [--verbose] */
"use strict";
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html") + "#debug";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const FILTER = arg("filter", "");
const RUNS = +arg("runs", 4);
const POLICY = arg("policy", "greedy");
const NO_SIM = !!arg("no-sim", false);
const VERBOSE = !!arg("verbose", false);

const C = process.stdout.isTTY ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" } : { g: "", r: "", y: "", d: "", b: "", x: "" };

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  let code = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on("console", (m) => { if (m.type() === "error") errors.push("console : " + m.text()); });
    page.on("pageerror", (e) => errors.push("page : " + (e && e.message)));
    page.on("requestfailed", (r) => errors.push("requête : " + r.url()));
    await page.goto(URL);
    await page.waitForFunction(() => window.BE && BE.Debug && BE.Debug.tests && BE.state && BE.state.scene === "TITLE", null, { timeout: 20000 });
    const enabled = await page.evaluate(() => BE.Debug.enabled);
    if (!enabled) { errors.push("BE.Debug.enabled est faux avec #debug"); }

    // ------------------------------------------------------------ tests unitaires
    const t0 = Date.now();
    const out = await page.evaluate((f) => BE.Debug.tests(f || undefined), FILTER);
    console.log(C.b + "Tests unitaires (§13.2)" + C.x + C.d + " — " + (Date.now() - t0) + " ms" + C.x);
    let group = null;
    for (const r of out.results) {
      if (r.group !== group) { group = r.group; console.log("  " + C.b + group + C.x); }
      const mark = r.ok ? C.g + "✓" + C.x : C.r + "✗" + C.x;
      console.log("    " + mark + " " + r.name + C.d + " (" + r.ms + " ms)" + C.x + (r.ok ? "" : "\n        " + C.r + r.msg + C.x));
    }
    const col = out.failed ? C.r : C.g;
    console.log(col + C.b + "  " + out.passed + "/" + out.total + " réussis" + C.x + "\n");
    if (out.failed || !out.total) code = 1;

    // ------------------------------------------------------------ simulation courte
    if (!NO_SIM && RUNS > 0) {
      const t1 = Date.now();
      const sim = await page.evaluate(async (o) => {
        const r = await BE.Debug.simulate({ runs: o.runs, policy: o.policy, seed: "TEST", log: false });
        return { report: r.report, errors: r.summary.errors, n: r.summary.n, wins: r.summary.wins, runs: r.runs.map((x) => ({ seed: x.seed, won: x.won, cause: x.cause, lune: x.lune, nuit: x.nuit, shots: x.shots, error: x.error })) };
      }, { runs: RUNS, policy: POLICY });
      console.log(C.b + "Simulation (§13.1) : " + sim.n + " runs, bot " + POLICY + C.x + C.d + " — " + ((Date.now() - t1) / 1000).toFixed(1) + " s" + C.x);
      for (const r of sim.runs) {
        const res = r.error ? C.r + "ERREUR " + r.error.split("\n")[0] + C.x : r.won ? C.g + "victoire" + C.x : "défaite (" + r.cause + ") en L" + r.lune + " nuit " + (r.nuit + 1);
        console.log("  " + r.seed + " : " + res + C.d + " · " + r.shots + " tirs" + C.x);
      }
      if (VERBOSE) console.log("\n" + sim.report);
      if (sim.errors) { code = 1; console.log(C.r + "  " + sim.errors + " run(s) en erreur" + C.x); }
      // cohérence minimale : chaque run se termine (victoire, quota ou débordement)
      for (const r of sim.runs) if (!r.error && !r.won && ["quota", "overflow"].indexOf(r.cause) < 0) { code = 1; console.log(C.r + "  fin de run inattendue : " + r.seed + " (" + r.cause + ")" + C.x); }
      console.log("");
    }

    // ------------------------------------------------------------ état réel intact
    const after = await page.evaluate(() => ({ scene: BE.state.scene, run: !!BE.state.run, mute: !!BE.muteEvents, depth: BE.Debug.sandboxDepth() }));
    if (after.scene !== "TITLE" || after.run || after.mute || after.depth) { code = 1; errors.push("état réel modifié par les tests : " + JSON.stringify(after)); }
  } catch (e) {
    code = 1;
    console.error(C.r + "Échec du lanceur : " + (e && e.stack || e) + C.x);
  } finally {
    await browser.close();
  }
  if (errors.length) {
    code = 1;
    console.log(C.r + "Erreurs de la page :" + C.x);
    for (const e of errors) console.log("  " + e);
  }
  console.log(code ? C.r + C.b + "ÉCHEC" + C.x : C.g + C.b + "OK" + C.x);
  process.exit(code);
})();
