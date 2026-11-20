// 한국포도협회 · 2026년 과일산업대전 — 품종별 선호도 투표 API (Netlify Functions + Netlify Blobs)
// POST /api/vote      {variety, age, device}  → 투표 저장 + 최신 집계
// GET  /api/results                          → 품종별 집계
// GET  /api/export                           → 전체 투표 CSV (시각 · 품종 · 연령대)
// POST /api/reset?key=RESET_KEY              → 전체 삭제 (환경 변수 RESET_KEY를 설정한 경우만)
import { getStore } from "@netlify/blobs";

export const VARIETIES = { glory: "글로리스타", shine: "샤인머스캣", claret: "레드클라렛", coco: "코코볼", hongju: "홍주씨들리스", sunny: "써니돌체" };
export const AGES = { a10: "10대 이하", a20: "20대", a30: "30대", a40: "40대", a50: "50대", a60: "60대 이상", na: "" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function tally(store) {
  const { blobs } = await store.list({ prefix: "v/" });
  const counts = Object.fromEntries(Object.keys(VARIETIES).map((k) => [k, 0]));
  let total = 0;
  for (const b of blobs) {
    const id = b.key.split("/")[1];
    if (id in counts) { counts[id]++; total++; }
  }
  return { counts, total, at: Date.now() };
}

export async function handle(req, store, env = {}) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/results" && req.method === "GET") return json(await tally(store));

  if (path === "/api/vote" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const variety = String(body.variety || "");
    const age = AGES[body.age] !== undefined ? body.age : "na";
    const device = String(body.device || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
    if (!(variety in VARIETIES)) return json({ error: "bad_variety" }, 400);
    if (device.length < 8) return json({ error: "bad_device" }, 400);
    if (await store.get("d/" + device)) return json({ already: true, result: await tally(store) });
    const ts = Date.now();
    await store.setJSON("d/" + device, { variety, ts });
    await store.set(`v/${variety}/${age}/${ts}-${device}`, "1");
    return json({ ok: true, result: await tally(store) });
  }

  if (path === "/api/export" && req.method === "GET") {
    const { blobs } = await store.list({ prefix: "v/" });
    const rows = blobs
      .map((b) => { const [, v, a, rest] = b.key.split("/"); return { ts: Number(rest.split("-")[0]), v, a }; })
      .sort((x, y) => x.ts - y.ts)
      .map((r) => {
        const t = new Date(r.ts + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 19); // 한국 시간
        return `${t},${VARIETIES[r.v] || r.v},${AGES[r.a] || ""}`;
      });
    const csv = "﻿투표 시각(KST),품종,연령대\n" + rows.join("\n") + "\n";
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="grape_vote_2026.csv"', "cache-control": "no-store" } });
  }

  if (path === "/api/reset" && (req.method === "POST" || req.method === "GET")) {
    if (!env.RESET_KEY || url.searchParams.get("key") !== env.RESET_KEY) return json({ error: "forbidden" }, 403);
    const { blobs } = await store.list();
    for (const b of blobs) await store.delete(b.key);
    return json({ ok: true, deleted: blobs.length });
  }

  return json({ error: "not_found" }, 404);
}

export default async (req) => {
  const env = { RESET_KEY: globalThis.Netlify?.env?.get?.("RESET_KEY") ?? process.env.RESET_KEY };
  try {
    return await handle(req, getStore({ name: "grape-vote-2026", consistency: "strong" }), env);
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
};

export const config = { path: ["/api/vote", "/api/results", "/api/export", "/api/reset"] };
