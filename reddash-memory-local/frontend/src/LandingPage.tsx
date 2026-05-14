import { useEffect } from "react";

type LandingPageProps = {
  onOpenDemo: () => void;
};

const proofPills = ["Redis-native", "Schema-guided", "MCP-ready", "Beyond RAG"];

const proofStatements = [
  {
    title: "More precision than document-only retrieval",
    body: "Agents can filter records, traverse typed relationships, and combine structured lookups with semantic search in one pass.",
  },
  {
    title: "More control than direct database access",
    body: "Schema, permissions, and policy shape what the agent can ask for before the model starts improvising.",
  },
  {
    title: "More reuse across products and teams",
    body: "Define the business surface once, then let multiple agents and applications share the same generated tool layer.",
  },
];

const comparisonColumns = [
  {
    label: "Document-only stack",
    title: "Good for reading",
    points: [
      "Text snippets without typed operations",
      "Prompt glue to explain schema and joins",
      "Custom wrappers rebuilt for each workflow",
      "Weak governance when the surface changes",
    ],
  },
  {
    label: "Context Surface",
    title: "Built for operating",
    points: [
      "Typed entities, fields, and relationships",
      "Filters, ranges, traversal, and semantic search",
      "Reusable MCP tools generated from the model",
      "Clear boundaries for access and policy",
    ],
  },
];

const workflowSteps = [
  {
    number: "01",
    title: "Model the domain once",
    body: "Describe entities, indexed fields, and relationships with ContextModel classes instead of embedding all of that knowledge in prompts.",
  },
  {
    number: "02",
    title: "Generate the tool surface",
    body: "Redis Context Surfaces turns that schema into typed MCP tools that agents can query, filter, and traverse safely.",
  },
  {
    number: "03",
    title: "Connect any agent runtime",
    body: "Expose the surface over MCP so ChatGPT, Claude, LangChain, or your own orchestration layer can call the same interface.",
  },
  {
    number: "04",
    title: "Operate with guardrails",
    body: "Structured retrieval, document search, relationships, and memory stay aligned with schema, permissions, and policy.",
  },
];

const capabilities = [
  {
    label: "Retrieve",
    body: "Pull structured records with exact matches, ranges, and filters.",
    tool: "filter_order_by_status",
  },
  {
    label: "Traverse",
    body: "Move across customers, orders, tickets, and events without the model inventing joins.",
    tool: "get_customer_by_id -> get_orders_for_customer",
  },
  {
    label: "Search",
    body: "Use semantic retrieval where it helps, especially for policies, docs, and embedded text.",
    tool: "search_policy_by_text",
  },
  {
    label: "Recall",
    body: "Bring relevant memory back into the loop when the agent needs continuity across sessions.",
    tool: "memory_lookup",
  },
];

const toolTokens = [
  "get_customer_by_id",
  "filter_order_by_status",
  "search_policy_by_text",
  "get_refund_by_id",
  "memory_lookup",
];

const sourceItems = ["Structured records", "Policies and docs", "Typed relationships", "Session memory"];
const outcomeItems = ["Typed MCP tools", "Agent-safe queries", "Reusable reasoning paths", "Lower prompt entropy"];

export default function LandingPage({ onOpenDemo }: LandingPageProps) {
  useEffect(() => {
    document.body.dataset.page = "landing";
    document.title = "Redis Context Surfaces";
    return () => {
      delete document.body.dataset.page;
    };
  }, []);

  return (
    <div className="landing-page" id="top">
      <header className="landing-nav">
        <div className="landing-brand">
          <span className="landing-brand-mark" aria-hidden="true">
            <span />
          </span>
          <div className="landing-brand-copy">
            <div className="landing-brand-eyebrow">Redis</div>
            <div className="landing-brand-name">Context Surfaces</div>
          </div>
        </div>

        <nav className="landing-nav-links" aria-label="Landing page sections">
          <a href="#why">Why It Wins</a>
          <a href="#architecture">Architecture</a>
          <a href="#capabilities">Capabilities</a>
        </nav>

        <div className="landing-nav-actions">
          <button className="button button-muted" type="button" onClick={onOpenDemo}>
            Open Demo
          </button>
        </div>
      </header>

      <main className="landing-main">
        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow-pill">Redis-native agent control layer</div>
            <h1 className="hero-title-marketing">
              Turn business data into MCP tools your agents can actually use.
            </h1>
            <p className="hero-body-marketing">
              Define a semantic schema once. Redis Context Surfaces lets agents retrieve, traverse,
              search, and remember through a governed interface instead of brittle prompt glue.
            </p>

            <div className="hero-actions-marketing">
              <button className="button button-primary" type="button" onClick={onOpenDemo}>
                Launch Interactive Demo
              </button>
              <a className="button button-muted" href="#why">
                See Why It Beats Plain RAG
              </a>
            </div>

            <div className="hero-pill-row" aria-label="Product attributes">
              {proofPills.map((pill) => (
                <span className="stat-pill" key={pill}>
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <div className="surface-visual" aria-label="Context surface architecture diagram">
            <div className="surface-column">
              <div className="visual-label">Input Context</div>
              <div className="visual-stack">
                {sourceItems.map((item) => (
                  <div className="visual-chip" key={item}>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="flow-rail" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            <div className="surface-core">
              <div className="surface-core-card">
                <div className="visual-label">Context Surface</div>
                <h2>Schema, permissions, relationships, and memory in one runtime layer.</h2>
                <p>
                  Agents do not have to guess the storage model. They get a reusable business
                  interface with typed operations instead.
                </p>
              </div>

              <div className="tool-token-row" aria-label="Example generated tools">
                {toolTokens.map((token) => (
                  <span className="tool-token" key={token}>
                    {token}
                  </span>
                ))}
              </div>
            </div>

            <div className="flow-rail" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            <div className="surface-column surface-column-outcomes">
              <div className="visual-label">Agent Outcome</div>
              <div className="visual-stack">
                {outcomeItems.map((item) => (
                  <div className="visual-chip visual-chip-strong" key={item}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="proof-band">
          <div className="section-heading">
            <div className="section-kicker">Why teams buy in</div>
            <h2>One governed surface for records, documents, relationships, and memory.</h2>
          </div>

          <div className="proof-grid">
            {proofStatements.map((item) => (
              <article className="proof-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="comparison-section" id="why">
          <div className="section-heading section-heading-wide">
            <div className="section-kicker">Beyond RAG</div>
            <h2>RAG helps agents read. Context Surfaces help them operate.</h2>
            <p>
              Document retrieval still matters, but production agents also need structured lookup,
              safe traversal, reusable tools, and memory that survives past a single prompt.
            </p>
          </div>

          <div className="comparison-panel">
            {comparisonColumns.map((column, index) => (
              <article className={`comparison-side ${index === 1 ? "is-highlight" : ""}`} key={column.label}>
                <div className="visual-label">{column.label}</div>
                <h3>{column.title}</h3>
                <ul>
                  {column.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="architecture-section" id="architecture">
          <div className="section-heading section-heading-wide">
            <div className="section-kicker">How it works</div>
            <h2>Model once, generate once, reuse everywhere.</h2>
            <p>
              The value is not another prompt template. It is a repeatable runtime surface that
              turns business context into agent-usable tools.
            </p>
          </div>

          <div className="sequence-board">
            {workflowSteps.map((step) => (
              <article className="sequence-step" key={step.number}>
                <div className="sequence-step-number">{step.number}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="capabilities-section" id="capabilities">
          <div className="section-heading section-heading-wide">
            <div className="section-kicker">Four core moves</div>
            <h2>Retrieve, traverse, search, and recall through one interface.</h2>
          </div>

          <div className="capability-rail">
            {capabilities.map((capability) => (
              <article className="capability-strip" key={capability.label}>
                <div>
                  <div className="visual-label">{capability.label}</div>
                  <h3>{capability.label}</h3>
                </div>
                <p>{capability.body}</p>
                <div className="capability-tool">{capability.tool}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="cta-section">
          <div className="cta-panel">
            <div className="cta-copy">
              <div className="section-kicker">Reusable across agents</div>
              <h2>Stop teaching every new agent your schema from scratch.</h2>
              <p>
                Put a governed surface between raw data and runtime reasoning, then let every new
                agent inherit that structure.
              </p>
            </div>

            <div className="cta-actions">
              <button className="button button-accent" type="button" onClick={onOpenDemo}>
                Open The Demo Surface
              </button>
              <a className="button button-muted" href="#top">
                Back To Top
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
