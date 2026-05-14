import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type DemoAppProps = {
  onExitDemo?: () => void;
};

type ChatRole = "user" | "assistant";

type ToolEvent = {
  toolName: string;
  toolKind: "internal_function" | "mcp_tool" | "memory";
  status: "call" | "result";
  payload: Record<string, unknown>;
  durationMs?: number;
  ts?: number;
};

type MergedToolEvent = {
  toolName: string;
  toolKind: ToolEvent["toolKind"];
  callPayload?: Record<string, unknown>;
  resultPayload?: Record<string, unknown>;
  durationMs?: number;
  ts?: number;
};

type ThinkingStep = {
  id: string;
  text: string;
  ts: number;
  kind: "plan" | "llm";
  durationMs?: number;
  durationText?: string;
};

type StatusMessage = { text: string; ts: number };

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  statusMessages: StatusMessage[];
  thinkingSteps: ThinkingStep[];
  toolEvents: ToolEvent[];
  totalElapsedMs?: number;
};

type HealthState = {
  ok: boolean;
  domain: string;
  mcp_enabled: boolean;
  memory_enabled?: boolean;
  internal_tools: string[];
} | null;

type MemoryDashboardState = {
  enabled: boolean;
  thread_id?: string | null;
  owner_id?: string;
  short_term: Array<Record<string, unknown>>;
  long_term: Array<Record<string, unknown>>;
  errors?: string[];
} | null;

type AgentMode = "context_surfaces" | "simple_rag";

type PromptCard = { eyebrow: string; title: string; prompt: string };

type DomainConfig = {
  id: string;
  app_name: string;
  subtitle: string;
  hero_title: string;
  placeholder_text: string;
  demo_steps: string[];
  starter_prompts: PromptCard[];
  theme: Record<string, string>;
  logo_src: string;
} | null;

const modeStorageKey = "demo-domain-mode";
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function apiUrl(path: string) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

function toolKindLabel(kind: ToolEvent["toolKind"]) {
  if (kind === "memory") return "Memory";
  return kind === "mcp_tool" ? "Context Retriever" : "Internal";
}

function toolDisplayName(toolName: string) {
  switch (toolName) {
    case "short_term_memory_get":
      return "Short-term memory · GET";
    case "long_term_memory_search":
      return "Long-term memory · SEARCH";
    case "search_customer_memory":
      return "Long-term memory · SEARCH";
    case "remember_customer_detail":
      return "Long-term memory · CREATE";
    case "get_current_user_profile":
      return "Current user profile";
    case "get_current_time":
      return "Current time";
    default:
      return toolName;
  }
}

function formatTotalElapsedMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function memoryEventText(event: Record<string, unknown>) {
  const content = event.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean)
    .join(" ");
}

function mergeToolEvents(events: ToolEvent[]): MergedToolEvent[] {
  const merged: MergedToolEvent[] = [];
  for (const ev of events) {
    const prev = merged[merged.length - 1];
    if (ev.status === "result" && prev && prev.toolName === ev.toolName && prev.toolKind === ev.toolKind && prev.resultPayload === undefined) {
      prev.resultPayload = ev.payload;
      prev.durationMs = ev.durationMs ?? prev.durationMs;
      prev.ts = prev.ts ?? ev.ts;
      continue;
    }
    merged.push({
      toolName: ev.toolName, toolKind: ev.toolKind,
      callPayload: ev.status === "call" ? ev.payload : undefined,
      resultPayload: ev.status === "result" ? ev.payload : undefined,
      durationMs: ev.durationMs,
      ts: ev.ts,
    });
  }
  return merged;
}

type TraceTimelineEntry =
  | { kind: "step"; index: number; ts: number; step: ThinkingStep }
  | { kind: "tool"; index: number; ts: number; tool: MergedToolEvent };

function buildTraceTimeline(steps: ThinkingStep[], tools: MergedToolEvent[]): TraceTimelineEntry[] {
  const stepEntries = steps.map((step, index) => ({
    kind: "step" as const,
    index,
    ts: step.ts ?? 0,
    step,
  }));
  const toolEntries = tools.map((tool, index) => ({
    kind: "tool" as const,
    index,
    ts: tool.ts ?? 0,
    tool,
  }));
  return [...stepEntries, ...toolEntries].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.kind !== b.kind) return a.kind === "step" ? -1 : 1;
    return a.index - b.index;
  });
}

function BrandLogo({ src, className = "brand-logo" }: { src?: string; className?: string }) {
  if (!src) {
    return <div className={className} />;
  }
  return (
    <span className={className} aria-hidden="true">
      <img src={src} alt="" />
    </span>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function App({ onExitDemo }: DemoAppProps) {
  const [health, setHealth] = useState<HealthState>(null);
  const [domain, setDomain] = useState<DomainConfig>(null);
  const [mode, setMode] = useState<AgentMode>(() => (localStorage.getItem(modeStorageKey) as AgentMode) || "context_surfaces");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [sampleDemoOpen, setSampleDemoOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryData, setMemoryData] = useState<MemoryDashboardState>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    document.body.dataset.page = "demo";
    return () => {
      delete document.body.dataset.page;
    };
  }, []);

  useEffect(() => {
    void fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then((p: HealthState) => setHealth(p))
      .catch(() => setHealth({ ok: false, domain: "unknown", mcp_enabled: false, internal_tools: [] }));
  }, []);

  useEffect(() => {
    void fetch(apiUrl("/api/domain-config"))
      .then((r) => r.json())
      .then((p: DomainConfig) => setDomain(p))
      .catch(() => setDomain(null));
  }, []);

  useEffect(() => { localStorage.setItem(modeStorageKey, mode); }, [mode]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  useEffect(() => {
    if (!domain) return;
    Object.entries(domain.theme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key.replaceAll("_", "-")}`, value);
    });
  }, [domain]);

  useEffect(() => {
    document.title = domain?.app_name ?? "Domain Demo";
  }, [domain]);

  async function loadMemoryDashboard() {
    setMemoryLoading(true);
    try {
      const response = await fetch(`${apiUrl("/api/memory/dashboard")}?thread_id=${encodeURIComponent(threadId)}`);
      const payload = await response.json();
      setMemoryData(payload);
    } catch {
      setMemoryData({
        enabled: false,
        short_term: [],
        long_term: [],
        errors: ["Unable to load memory dashboard."],
      });
    }
    setMemoryLoading(false);
  }

  async function submitPrompt(prompt: string, event?: FormEvent) {
    event?.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    const emptyMsg = (): ChatMessage => ({ id: "", role: "assistant", content: "", statusMessages: [], thinkingSteps: [], toolEvents: [] });
    const userMsg: ChatMessage = { ...emptyMsg(), id: `user-${Date.now()}`, role: "user" , content: trimmed };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = { ...emptyMsg(), id: assistantId };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, assistantMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(apiUrl("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          mode,
          thread_id: threadId,
        }),
      });

      if (!response.body) { setIsLoading(false); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const ev = JSON.parse(part.slice(6));
          setMessages((cur) =>
            cur.map((m) => {
              if (m.id !== assistantId) return m;
              switch (ev.type) {
                case "status":
                  return { ...m, statusMessages: [...m.statusMessages, { text: ev.text, ts: ev.ts ?? 0 }] };
                case "thinking-step":
                  return {
                    ...m,
                    thinkingSteps: [...m.thinkingSteps, {
                      id: ev.stepId ?? `step-${m.thinkingSteps.length}-${ev.ts ?? 0}`,
                      text: ev.step,
                      ts: ev.ts ?? 0,
                      kind: ev.stepKind === "llm" ? "llm" : "plan",
                    }],
                  };
                case "thinking-step-finish":
                  return {
                    ...m,
                    thinkingSteps: m.thinkingSteps.map((step) =>
                      step.id === ev.stepId
                        ? {
                            ...step,
                            durationMs: ev.durationMs,
                            durationText: ev.durationText,
                          }
                        : step,
                    ),
                  };
                case "tool-call":
                case "tool-result":
                  return { ...m, toolEvents: [...m.toolEvents, {
                    toolName: ev.toolName, toolKind: ev.toolKind ?? "internal_function",
                    status: ev.type === "tool-call" ? "call" : "result",
                    payload: ev.payload ?? {}, durationMs: ev.durationMs, ts: ev.ts ?? 0,
                  }] };
                case "text-delta":
                  return { ...m, content: m.content + (ev.delta ?? "") };
                case "done":
                  return { ...m, totalElapsedMs: ev.totalElapsedMs };
                default:
                  return m;
              }
            }),
          );
        }
      }
    } catch (err) {
      setMessages((cur) =>
        cur.map((m) => m.id === assistantId ? { ...m, content: m.content || "Connection error. Please try again." } : m),
      );
    }
    setIsLoading(false);
  }

  async function handleSubmit(event?: FormEvent) { await submitPrompt(input, event); }
  function handleQuickStart(prompt: string) { setInput(prompt); void submitPrompt(prompt); }
  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void handleSubmit();
  }

  function handleDemoStep(step: string) {
    if (step === "Click Memory") {
      setMemoryOpen(true);
      void loadMemoryDashboard();
      return;
    }
    handleQuickStart(step);
  }

  const allQuickStarts = domain?.starter_prompts ?? [];

  return (
    <div className="shell">
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            {onExitDemo && (
              <button className="demo-return" onClick={onExitDemo} type="button">
                Landing Page
              </button>
            )}
            <div className="brand">
              <BrandLogo src={domain?.logo_src} className="brand-logo" />
              <div className="brand-copy">
                <div className="brand-name">{domain?.app_name ?? "Demo"}</div>
                <div className="brand-subtitle">{domain?.subtitle ?? "Context Surfaces"}</div>
              </div>
            </div>
          </div>
          <div className="mode-toggle">
            {health?.memory_enabled && (
              <button
                className={`mode-btn memory-btn ${memoryOpen ? "active" : ""}`}
                onClick={() => {
                  const next = !memoryOpen;
                  setMemoryOpen(next);
                  if (next) void loadMemoryDashboard();
                }}
                type="button"
              >
                Memory
              </button>
            )}
            <button className={`mode-btn ${mode === "context_surfaces" ? "active" : ""}`} onClick={() => { setMode("context_surfaces"); setMessages([]); setThreadId(crypto.randomUUID()); }} type="button">Context Surfaces</button>
            <button className={`mode-btn ${mode === "simple_rag" ? "active" : ""}`} onClick={() => { setMode("simple_rag"); setMessages([]); setThreadId(crypto.randomUUID()); }} type="button">Simple RAG</button>
          </div>
        </header>

        {memoryOpen && (
          <section className="memory-dashboard">
            <div className="memory-dashboard-header">
              <div>
                <div className="trace-title">Memory Dashboard</div>
                <div className="memory-dashboard-subtitle">Short-term memory for this thread and long-term memory for the signed-in customer.</div>
              </div>
              <button className="send-button memory-refresh" type="button" onClick={() => void loadMemoryDashboard()}>
                {memoryLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="memory-grid">
              <section className="memory-card">
                <div className="memory-card-title">Short-term memory</div>
                <div className="memory-card-body">
                  {memoryLoading && !memoryData ? (
                    <div className="memory-empty">Loading short-term memory…</div>
                  ) : memoryData?.short_term?.length ? (
                    memoryData.short_term.map((event, index) => (
                      <div key={`short-${index}`} className="memory-item">
                        <div className="memory-item-meta">{String(event.role ?? "EVENT")}</div>
                        <div className="memory-item-text">{memoryEventText(event)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="memory-empty">No short-term memory events yet for this thread.</div>
                  )}
                </div>
              </section>
              <section className="memory-card">
                <div className="memory-card-title">Long-term memory</div>
                <div className="memory-card-body">
                  {memoryLoading && !memoryData ? (
                    <div className="memory-empty">Loading long-term memory…</div>
                  ) : memoryData?.long_term?.length ? (
                    memoryData.long_term.map((memory, index) => (
                      <div key={`long-${index}`} className="memory-item">
                        <div className="memory-item-meta">{String(memory.memoryType ?? "memory")}</div>
                        <div className="memory-item-text">{String(memory.text ?? "")}</div>
                      </div>
                    ))
                  ) : (
                    <div className="memory-empty">No long-term memories found for this customer yet.</div>
                  )}
                </div>
              </section>
            </div>
            {memoryData?.errors?.length ? (
              <div className="memory-errors">{memoryData.errors.join(" ")}</div>
            ) : null}
          </section>
        )}

        <section className={`workspace ${hasMessages ? "has-messages" : "is-empty"}`}>
          <div className={`conversation ${hasMessages ? "has-messages" : "is-empty"}`}>
            {!hasMessages && (
              <div className="hero-panel">
                <div className="hero-mark"><BrandLogo src={domain?.logo_src} className="hero-logo" /></div>
                <h1 className="hero-title">{domain?.hero_title ?? "How can we help?"}</h1>
              </div>
            )}

            {messages.map((message) => {
              const toolRows = mergeToolEvents(message.toolEvents);
              const traceTimeline = buildTraceTimeline(message.thinkingSteps, toolRows);
              const isAssistant = message.role === "assistant";
              const lastStatus = isAssistant && message.statusMessages.length > 0 ? message.statusMessages[message.statusMessages.length - 1] : null;
              const showStatus = isAssistant && !message.content && lastStatus;
              return (
                <article key={message.id} className={`message-block ${message.role}`}>
                  {showStatus && (
                    <div className="status-line">⏳ {lastStatus.text}</div>
                  )}
                  {isAssistant && (message.thinkingSteps.length > 0 || toolRows.length > 0) && (
                    <details className="trace-panel" open>
                      <summary className="trace-panel-summary">
                        <span className="trace-title">Agent Trace</span>
                        <span className="trace-counts">
                          {message.thinkingSteps.length > 0 && <span>{message.thinkingSteps.length} steps</span>}
                          {toolRows.length > 0 && <span>{toolRows.length} tool{toolRows.length > 1 ? "s" : ""}</span>}
                        </span>
                      </summary>
                      <div className="trace-panel-body">
                        {traceTimeline.map((entry) => (
                          entry.kind === "step" ? (
                            <div key={`${message.id}-step-${entry.step.id}`} className="trace-line">
                              <span className="trace-pill">{entry.step.kind}</span>
                              <span className="trace-line-text">{entry.step.text}</span>
                              {entry.step.durationText && <span className="trace-latency">{entry.step.durationText}</span>}
                            </div>
                          ) : (
                          <details key={`${message.id}-tool-${entry.index}`} className="tool-item">
                            <summary className="tool-summary">
                              <div className="tool-header">
                                <span className={`tool-source ${entry.tool.toolKind}`}>{toolKindLabel(entry.tool.toolKind)}</span>
                                <span className="tool-name">{toolDisplayName(entry.tool.toolName)}</span>
                              </div>
                              {entry.tool.durationMs !== undefined && <span className="trace-latency">{entry.tool.durationMs}ms</span>}
                            </summary>
                            {entry.tool.callPayload && (
                              <div className="tool-detail-section">
                                <div className="tool-detail-label">Call</div>
                                <pre>{JSON.stringify(entry.tool.callPayload, null, 2)}</pre>
                              </div>
                            )}
                            {entry.tool.resultPayload && (
                              <div className="tool-detail-section">
                                <div className="tool-detail-label">Result</div>
                                <pre>{JSON.stringify(entry.tool.resultPayload, null, 2)}</pre>
                              </div>
                            )}
                          </details>
                          )
                        ))}
                      </div>
                    </details>
                  )}
                  {message.content && (
                    <div className="message-bubble">
                      {message.role === "assistant" ? (
                        <MarkdownMessage content={message.content} />
                      ) : (
                        <div className="plain-text-message">{message.content}</div>
                      )}
                    </div>
                  )}
                  {isAssistant && message.totalElapsedMs !== undefined && (
                    <div className="message-meta">Completed in {formatTotalElapsedMs(message.totalElapsedMs)}</div>
                  )}
                </article>
              );
            })}
            <div ref={scrollRef} />
          </div>

          <form className={`composer ${hasMessages ? "thread" : "hero"}`} onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={domain?.placeholder_text ?? "Ask a question..."}
            />
            <div className="composer-footer">
              <div className="composer-hint">Press Enter to send</div>
              <button className="send-button" type="submit" disabled={isLoading}>Send</button>
            </div>
          </form>

          <div className={`quick-starts ${hasMessages ? "thread" : "empty"}`}>
            <button
              className={`demo-flow-button ${sampleDemoOpen ? "open" : ""}`}
              onClick={() => setSampleDemoOpen((current) => !current)}
              type="button"
            >
              <span>Sample demo flow</span>
              <span className="demo-flow-chevron">{sampleDemoOpen ? "−" : "+"}</span>
            </button>
            {sampleDemoOpen && (
              <div className="demo-steps">
                {(domain?.demo_steps ?? []).map((step, index) => (
                  <button
                    key={`${index}-${step}`}
                    className={`demo-step ${step === "Click Memory" ? "memory" : ""}`}
                    onClick={() => handleDemoStep(step)}
                    type="button"
                  >
                    <span className="demo-step-index">{index + 1}</span>
                    <span className="demo-step-text">{step}</span>
                  </button>
                ))}
              </div>
            )}
            {!hasMessages && (
              <>
                <div className="quick-starts-label">Starter questions</div>
                <div className="quick-starts-row">
                  {allQuickStarts.map((p) => (
                    <button key={p.title} className="quick-start-chip" onClick={() => handleQuickStart(p.prompt)} type="button">{p.title}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
