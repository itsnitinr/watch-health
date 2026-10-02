import { timingSafeEqual } from "node:crypto";
import { ingest, type IngestPayload } from "@/lib/ingest";
import { getDb } from "@/lib/db";

function authorized(req: Request) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let payload: IngestPayload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const counts = ingest(payload);
    getDb()
      .prepare(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_android_sync', ?)`)
      .run(new Date().toISOString());
    return Response.json({ ok: true, counts });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
