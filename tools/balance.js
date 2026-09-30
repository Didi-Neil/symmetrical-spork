#!/usr/bin/env node
/* tools/balance.js — équilibrage (GDD §13.3) : N runs simulés par les bots headless (BE.Debug.simulate),
   répartis sur plusieurs pages Chromium en parallèle, puis tableau des mesures §13.3 (+ détail par nuit).
   Usage : NODE_PATH=$(npm root -g) node tools/balance.js [--runs 100] [--policy greedy|random|safe|noisy]
           [--gardien veilleuse] [--eclipse 0] [--shop default|random|none] [--seed BAL] [--workers 4]
           [--all] [--rooms serre,cartes] [--relics R14,R27] [--csv fichier.csv] [--json fichier.json]
   Le code de sortie vaut 1 si un run a planté (les cibles d'équilibrage ne font jamais échouer l'outil). */
"use strict";
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html") + "#debug";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
if (arg("help", false)) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 7).join("\n"));
  process.exit(0);
}
const opts = {
  runs: Math.max(1, +arg("runs", 100)),
  policy: String(arg("policy", "greedy")),
  gardien: String(arg("gardien", "veilleuse")),
  eclipse: +arg("eclipse", 0),
  shop: String(arg("shop", "default")),
  seed: String(arg("seed", "BAL")),
  all: !!arg("all", false),
  rooms: arg("rooms", "") ? String(arg("rooms", "")).split(",").filter(Boolean) : undefined,
  relics: arg("relics", "") ? String(arg("relics", "")).split(",").filter(Boolean) : undefined, // reliques imposées dès le départ
};
const WORKERS = Math.max(1, Math.min(+arg("workers", Math.min(4, os.cpus().length)), opts.runs));
const CSV = arg("csv", "");
const JSON_OUT = arg("json", "");

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  const errors = [];
  let done = 0;
  const pages = [];
  try {
    for (let w = 0; w < WORKERS; w++) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push("page : " + (e && e.message)));
      page.on("console", (m) => { if (m.type() === "error") errors.push("console : " + m.text()); });
      await page.exposeFunction("__beProgress", () => {
        done++;
        const el = (Date.now() - t0) / 1000;
        const eta = done ? (el / done) * (opts.runs - done) : 0;
        const line = "  " + done + "/" + opts.runs + " runs · " + el.toFixed(0) + " s écoulées · reste ≈ " + eta.toFixed(0) + " s";
        if (process.stdout.isTTY) process.stdout.write("\r" + line + "   ");
        else if (done === opts.runs || done % Math.max(1, Math.round(opts.runs / 10)) === 0) console.log(line);
      });
      await page.goto(URL);
      await page.waitForFunction(() => window.BE && BE.Debug && BE.Debug.simulate && BE.state && BE.state.scene === "TITLE", null, { timeout: 20000 });
      pages.push(page);
    }
    console.log("Équilibrage : " + opts.runs + " runs · bot " + opts.policy + " · boutique " + opts.shop + " · " + opts.gardien +
      " · Éclipse " + opts.eclipse + (opts.all ? " · tout débloqué" : "") + (opts.relics ? " · reliques " + opts.relics.join(",") : "") + " · " + WORKERS + " page(s)");
    // répartition : le run i a toujours la graine seed-i, quel que soit le nombre de pages
    const per = Math.ceil(opts.runs / WORKERS);
    const jobs = pages.map((page, w) => {
      const offset = w * per, n = Math.max(0, Math.min(per, opts.runs - offset));
      if (!n) return Promise.resolve([]);
      return page.evaluate(async (o) => {
        const r = await BE.Debug.simulate(Object.assign({}, o, { onProgress: () => window.__beProgress(), log: false }));
        return r.runs;
      }, Object.assign({}, opts, { runs: n, offset }));
    });
    const recs = [].concat(...(await Promise.all(jobs)));
    process.stdout.write(process.stdout.isTTY ? "\n\n" : "\n");
    const wall = Date.now() - t0;
    const out = await pages[0].evaluate(([recs, o, wall]) => {
      const S = BE.Debug.summarize(recs, o);
      S.wallMs = wall;
      S.speed = recs.reduce((a, r) => a + (r.estTime || 0), 0) / (wall / 1000);
      return { report: BE.Debug.report(S), csv: BE.Debug.csv(recs), summary: S };
    }, [recs, opts, wall]);
    console.log(out.report);
    if (CSV) { fs.writeFileSync(CSV, out.csv + "\n"); console.log("\nCSV écrit : " + CSV); }
    if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ opts, summary: out.summary, runs: recs }, null, 1)); console.log("JSON écrit : " + JSON_OUT); }
    const ok = out.summary.targets.filter((t) => t.ok).length;
    const na = out.summary.targets.filter((t) => t.na && !t.ok).length;
    console.log("\nCibles §13.3 atteintes : " + ok + "/" + (out.summary.targets.length - na) + (na ? " (+" + na + " N/A : géométrie du bocal)" : "") + (opts.policy !== "greedy" || opts.eclipse ? " (les cibles valent pour Éclipse 0, bot greedy)" : ""));
    if (out.summary.errors) errors.push(out.summary.errors + " run(s) en erreur (voir " + (JSON_OUT || "--json") + ")");
  } catch (e) {
    errors.push("lanceur : " + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.log("\nErreurs :");
    for (const e of errors.slice(0, 20)) console.log("  " + e);
    process.exit(1);
  }
  process.exit(0);
})();
