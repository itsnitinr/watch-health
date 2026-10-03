import { listThreads } from "@/lib/chats";

export async function GET() {
  return Response.json({ threads: listThreads() }, { headers: { "cache-control": "no-store" } });
}
