import { z } from "zod";
import { deleteThread, getThread, saveThread, savedMessageSchema, threadIdSchema } from "@/lib/chats";

const bodySchema = z.object({ messages: z.array(savedMessageSchema).min(1).max(500) });

async function threadId(ctx: RouteContext<"/api/threads/[id]">) {
  const parsed = threadIdSchema.safeParse((await ctx.params).id);
  return parsed.success ? parsed.data : undefined;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/threads/[id]">) {
  const id = await threadId(ctx);
  const thread = id && getThread(id);
  if (!thread) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(thread, { headers: { "cache-control": "no-store" } });
}

/** Creates the thread or replaces its messages. */
export async function PUT(req: Request, ctx: RouteContext<"/api/threads/[id]">) {
  const id = await threadId(ctx);
  if (!id) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid messages" }, { status: 400 });
  saveThread(id, body.data.messages);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/threads/[id]">) {
  const id = await threadId(ctx);
  if (!id) return Response.json({ error: "invalid id" }, { status: 400 });
  deleteThread(id);
  return Response.json({ ok: true });
}
