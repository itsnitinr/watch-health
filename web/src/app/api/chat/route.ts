import Anthropic from "@anthropic-ai/sdk";
import { runAgent, type ChatTurn } from "@/lib/agent";

export const maxDuration = 300;

function errorMessage(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return "No valid Anthropic API key. Set ANTHROPIC_API_KEY in web/.env.local and restart.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again in a moment.";
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`;
  if (e instanceof Error && e.message.includes("authentication method")) {
    return "No Anthropic API key found. Add ANTHROPIC_API_KEY to web/.env.local and restart the server.";
  }
  return e instanceof Error ? e.message : String(e);
}

/** Streams agent events as newline-delimited JSON. */
export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: ChatTurn[] };
  if (!Array.isArray(messages) || messages.length === 0 || messages.at(-1)?.role !== "user") {
    return Response.json({ error: "messages must end with a user turn" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        for await (const event of runAgent(messages)) {
          if (req.signal.aborted) break;
          send(event);
        }
      } catch (e) {
        send({ type: "error", message: errorMessage(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
