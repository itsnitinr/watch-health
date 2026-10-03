"use client";

import {
  ArrowUp, BedDouble, Brain, ChevronDown, Database, Dumbbell, Gauge, HeartPulse, RotateCcw, Sparkles, Square, TrendingUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_EFFORT, DEFAULT_MODEL, EFFORTS, MODELS, isEffort, isModelId, supportsEffort, type Effort, type ModelId,
} from "@/lib/models";
import { cn } from "@/lib/utils";

type Tool = { name: string; input: unknown };
type Message = { role: "user" | "assistant"; content: string; tools?: Tool[]; error?: string; via?: string };

const SUGGESTIONS = [
  { icon: BedDouble, color: "text-sleep", text: "How has my sleep been this month compared to last month?" },
  { icon: Dumbbell, color: "text-exercise", text: "Do I sleep better on days I work out?" },
  { icon: HeartPulse, color: "text-heart", text: "What's the trend in my resting heart rate and HRV?" },
  { icon: TrendingUp, color: "text-activity", text: "Give me a weekly summary with three things to focus on." },
];

const TOOL_LABELS: Record<string, string> = {
  get_data_coverage: "Checked what data is available",
  get_daily_summary: "Read the daily summary",
  query_sql: "Queried the database",
};

const MODEL_KEY = "chat.model";
const EFFORT_KEY = "chat.effort";

function stored<T>(key: string, valid: (v: unknown) => v is T): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return valid(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function Picker<T extends string>({ icon: Icon, label, title, value, options, onChange, disabled }: {
  icon: typeof Brain;
  label: string;
  title: string;
  value: T;
  options: readonly { id: T; label: string; hint: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button type="button" variant="ghost" size="sm" aria-label={`${title}: ${label}`}
          className="h-7 gap-1 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground">
          <Icon className="size-3.5" />
          {label}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id} className="flex-col items-start gap-0 py-1.5">
              <span>{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Chat({ initialQuestion }: { initialQuestion?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<Effort>(DEFAULT_EFFORT);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Restore the last-used picks after hydration, so server and client render the same markup first.
  useEffect(() => {
    setModel((m) => stored(MODEL_KEY, isModelId) ?? m);
    setEffort((e) => stored(EFFORT_KEY, isEffort) ?? e);
  }, []);

  const modelInfo = MODELS.find((m) => m.id === model)!;
  const effortLabel = EFFORTS.find((e) => e.id === effort)!.label;
  const hasEffort = supportsEffort(model);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history: Message[] = [...messages, { role: "user", content: text.trim() }];
    const via = hasEffort ? `${modelInfo.label} · ${effortLabel} effort` : modelInfo.label;
    setMessages([...history, { role: "assistant", content: "", tools: [], via }]);
    setInput("");
    setBusy(true);

    const update = (fn: (m: Message) => Message) =>
      setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only completed text turns are sent; failed turns are dropped from the history.
        body: JSON.stringify({
          messages: history.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content })),
          model,
          effort,
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") update((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "tool") update((m) => ({ ...m, tools: [...(m.tools ?? []), { name: ev.name, input: ev.input }] }));
          else if (ev.type === "error") update((m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) update((m) => ({ ...m, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  // A question passed in the URL (from the Today page) is asked straight away, once.
  useEffect(() => {
    if (initialQuestion && !started.current) {
      started.current = true;
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className="flex h-[100dvh] flex-col">
      <PageHeader title="Ask" subtitle="Questions answered from your own watch data">
        {messages.length > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setMessages([])}>
            <RotateCcw />New chat
          </Button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.length === 0 && (
            <div className="pt-6 md:pt-14">
              <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="size-5" />
              </span>
              <h2 className="text-2xl font-semibold tracking-tight">What would you like to know?</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                The assistant looks up your sleep, activity, heart and workout data to answer. It can only read your data, never change it.
              </p>
              <div className="mt-8 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} onClick={() => send(s.text)}
                    className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left text-sm transition-colors hover:border-ring/60 hover:bg-muted/40 active:scale-[0.99]">
                    <s.icon className={cn("mt-0.5 size-4 shrink-0", s.color)} />
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {m.content}
                </div>
              ) : (
                <div key={i} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    {!!m.tools?.length && (
                      <details className="group mb-2 text-xs text-muted-foreground">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 hover:text-foreground">
                          <Database className="size-3" />
                          {m.tools.length} data {m.tools.length === 1 ? "lookup" : "lookups"}
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {m.tools.map((t, j) => (
                            <li key={j}>
                              <div className="mb-1 font-medium">{TOOL_LABELS[t.name] ?? t.name}</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border bg-card p-2.5 font-mono text-[11px]">
                                {typeof t.input === "object" && t.input && "sql" in t.input
                                  ? String((t.input as { sql: string }).sql)
                                  : JSON.stringify(t.input)}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="prose-chat">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                    {busy && i === messages.length - 1 && !m.content && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="flex gap-1">
                          {[0, 1, 2].map((d) => (
                            <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" style={{ animationDelay: `${d * 120}ms` }} />
                          ))}
                        </span>
                        Looking at your data
                      </div>
                    )}
                    {m.error && <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">{m.error}</p>}
                    {m.via && !(busy && i === messages.length - 1) && (
                      <p className="mt-2 text-xs text-muted-foreground">{m.via}</p>
                    )}
                  </div>
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>

      <div className="border-t bg-background/85 backdrop-blur">
        <form className="mx-auto w-full max-w-3xl px-4 pt-3 pb-2"
          onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <div className="flex items-end gap-2">
            <label htmlFor="ask" className="sr-only">Your question</label>
            <Textarea id="ask" value={input} onChange={(e) => setInput(e.target.value)} rows={1}
              placeholder="Ask about your sleep, activity, heart rate..."
              className="max-h-40 min-h-11 resize-none rounded-xl bg-card py-3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }} />
            {busy ? (
              <Button type="button" size="icon-lg" variant="outline" className="size-11 rounded-xl" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                <Square className="fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon-lg" className="size-11 rounded-xl" disabled={!input.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </div>
          <div className="mt-1.5 -ml-2.5 flex flex-wrap items-center gap-0.5">
            <Picker icon={Brain} title="Model" label={modelInfo.label} value={model} options={MODELS}
              onChange={(v) => { setModel(v); store(MODEL_KEY, v); }} />
            {hasEffort && (
              <Picker icon={Gauge} title="Effort" label={`${effortLabel} effort`} value={effort} options={EFFORTS}
                onChange={(v) => { setEffort(v); store(EFFORT_KEY, v); }} />
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
