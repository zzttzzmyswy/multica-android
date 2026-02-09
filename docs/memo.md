# Multica Memo

**Multiplexed Information & Computing Agent**

---

## What is Multica

Multica is an always-on AI agent that pulls real data, runs real computation, and takes real action on behalf of users.

It is not a chatbot. It is not a search engine. It is not an analytics dashboard. It is an **autonomous employee** that works 24/7 — monitoring, analyzing, and acting within user-defined authorization boundaries.

Users interact with Multica through natural conversation. They can ask for immediate analysis, or tell the agent to run recurring tasks in the background. The same interface handles both modes — no separate workflow builder, no configuration forms. You talk to it like you'd talk to a team member.

---

## Core Insight

The value chain of knowledge work is: **Data → Analysis → Decision → Action**.

Existing AI products truncate this chain. ChatGPT and Claude stop at conversation. Perplexity stops at search. BI dashboards stop at visualization. Each one hands the remaining work back to the human.

Multica completes the full chain:

- **Data**: Pulls structured data from multiple sources through a unified `data` tool, backed by Multica's centralized data infrastructure. Users never configure API keys or deal with data providers.
- **Analysis**: Runs actual computation — Python, statistical models, charts — not just text summaries. The agent writes and executes code to derive quantitative insights.
- **Decision**: Applies domain-specific analytical frameworks encoded as Skills to evaluate the data and form actionable conclusions.
- **Action**: Executes real-world actions (trade, send email, update records) within a tiered authorization model that the user controls.

---

## Architecture

### One Tool, Infinite Domains

Multica's extensibility model is designed for horizontal scaling across verticals without agent-side complexity growth.

```
              Finance          Legal            Medical          ...
            ┌──────────┐   ┌──────────┐    ┌──────────┐
Skills      │ Earnings  │   │ Case     │    │ Literature│
(Markdown)  │ Screening │   │ Contract │    │ Drug      │
            │ Macro     │   │ Compliance│   │ Clinical  │
            └─────┬─────┘   └─────┬─────┘   └─────┬────┘
                  │               │                │
            ┌─────┴───────────────┴────────────────┴────┐
Tool        │            data(query, domain)             │
(single)    └─────────────────┬──────────────────────────┘
                              │
            ┌─────────────────┴──────────────────────────┐
Backend     │           Multica Data Service              │
            │     routing / caching / normalization       │
            ├─────────┬───────────┬───────────┬──────────┤
            │ Polygon  │ FRED      │ PubMed    │ Court-   │
            │ SEC      │ NewsAPI   │ OpenFDA   │ listener │
            └─────────┴───────────┴───────────┴──────────┘
```

**One `data` tool** serves all verticals. Adding a new domain means adding backend source adapters and writing Skill markdown files. The agent engine, tool set, and product surface remain unchanged.

**Skills encode domain expertise, not data plumbing.** A Skill is a Markdown file that teaches the agent an analytical workflow: what data to request, how to process it, what to look for, how to present findings. Domain experts can author Skills without writing code.

**Multica proxies all data access.** Users never register for third-party data APIs. Multica's backend handles authentication, rate limiting, caching, and normalization. This simplifies the user experience and creates a natural monetization layer.

### Foreground + Background, One Interface

```
User in conversation:

  "Analyze TSLA"                              → Immediate execution
  "Send me a market briefing every morning"   → Agent schedules cron task
  "Alert me if NVDA drops below 100"          → Agent sets event trigger
  "Cancel the morning briefing"               → Agent removes cron task
```

The agent manages its own background tasks through existing tools (`cron`, `exec`). There is no separate workflow configuration UI. Conversation is the control plane.

Background tasks run persistently, independent of the app being open. Results are delivered through the user's preferred channel (email, Slack, Telegram, push notification, or in-app).

### Tiered Action Authorization

The agent's ability to take action is governed by a user-controlled trust gradient:

| Level | Behavior | Example |
|-------|----------|---------|
| 0 — Read-only | Pull data, analyze, report | Generate earnings analysis |
| 1 — Notify | Detect signal, alert user | "TSLA broke your stop-loss level" |
| 2 — Confirm | Propose action, wait for approval | "Sell 50% TSLA position? [Confirm]" |
| 3 — Autonomous | Execute within preset rules, notify after | Auto-rebalance portfolio within mandate |

Each action type can be independently configured. Users start conservative and escalate trust as they build confidence in the agent. Authorization constraints include per-action limits, daily caps, and scope restrictions.

---

## Product

### Form Factor

**Web-first** for distribution, with desktop and mobile for persistent background operation.

The primary interface is conversational — but output is structured. When the agent produces an analysis, it renders as a formatted report with charts, tables, and data citations, not a chat bubble. Reports are exportable (PDF, Excel).

The secondary interface is **the user's inbox**. Background tasks deliver results via email or messaging. Many users will interact with Multica more through their email than through the app itself.

### User Experience

A new user's first 24 hours:

1. Sign up (web, 30 seconds)
2. Tell the agent which stocks/sectors they follow
3. Next morning: first market briefing arrives in their inbox
4. Open the app, ask a follow-up question about something in the briefing
5. Tell the agent "do this every morning"

**Time to first value: < 24 hours, zero configuration, zero learning curve.**

### Cross-Domain Composition

The most powerful use cases combine multiple domains in a single workflow:

> "We're evaluating an acquisition of a gene-editing company. Give me a full due diligence report."
>
> Agent combines:
> - `data(query, "finance")` → Target's financials, valuation comps
> - `data(query, "legal")` → Patent portfolio, regulatory filings
> - `data(query, "medical")` → Clinical pipeline, trial results
> - `exec` → Python analysis, charts, risk scoring
> - Output: Integrated due diligence report spanning finance + IP + science

One `data` tool, three domains, agent orchestrates autonomously.

---

## Go-to-Market

### First Vertical: Finance

Finance is the right starting point because:

- **Data accessibility**: Abundant free and commercial APIs (market data, filings, macro indicators)
- **Willingness to pay**: Finance professionals value time; current tools (Bloomberg terminal: $24k/year) prove the market pays for information advantage
- **Quantitative output**: The agent's ability to compute (not just chat) is most visible in finance — ratios, models, charts, backtests
- **Recurring workflows**: Daily briefings, portfolio monitoring, earnings tracking — these drive retention naturally

### Target User

Individual investors, independent financial advisors, small fund analysts (< $50M AUM). They currently cobble together Yahoo Finance + SEC EDGAR + Excel + maybe Python scripts. A full company analysis takes them half a day.

Multica does it in 2 minutes.

### Distribution

| Channel | Approach |
|---------|----------|
| Twitter/X FinTwit | Real analysis examples as content — the output IS the demo |
| YouTube | "AI analyst built my morning briefing in 2 minutes" |
| Finance newsletters (Substack) | Weekly analysis pieces generated by Multica, attributed |
| Reddit (r/investing, r/SecurityAnalysis) | High-quality analysis posts, organic |
| Finance KOLs | Free Pro accounts, let them showcase their own output |

### Growth Loop

```
Free daily briefing (user signs up, picks stocks)
        ↓
Briefing arrives next morning (immediate value)
        ↓
User shares briefing excerpt on social media
        ↓
Report footer: "Generated with Multica"
        ↓
New user sees it → signs up
```

The output is inherently shareable. Every analysis report is a marketing asset.

### Pricing

| Tier | Price | Includes |
|------|-------|---------|
| Free | $0/mo | 5 analyses/month, 1 daily briefing, delayed data |
| Pro | $29/mo | Unlimited analyses, custom briefings, real-time data, export, action (Level 0-2) |
| Team | $79/user/mo | Shared workspace, collaborative Skills, API access |
| Enterprise | Custom | Private deployment, custom data sources, autonomous actions (Level 3), SLA |

---

## Roadmap

### Phase 0→1: Finance MVP (8 weeks)

| Week | Deliverable |
|------|-------------|
| 1-2 | `data` tool backend + 2 sources (market data, macro) |
| 3-4 | 3 finance Skills (company analysis, screening, macro briefing) |
| 5-6 | Email channel (agent sends results, receives instructions) |
| 7-8 | Web app (conversation + report rendering + task management) |

**Launch artifact**: "Sign up, pick 3 stocks, get your first AI briefing tomorrow morning."

### Phase 1→10: Deepen and Expand (months 3-12)

**Months 3-6 — Deepen finance:**
- More data sources (SEC filings, alternative data, earnings call transcripts)
- More Skills (DCF modeling, options analysis, sector comparison, portfolio review)
- Portfolio binding (user connects brokerage, agent gives personalized analysis)
- Event triggers (price alerts, earnings surprises, insider trading signals)
- Action capability (Level 1-2: trade proposals with confirmation)

**Months 6-12 — Adjacent verticals:**
- Finance + Legal (M&A due diligence, SEC compliance, patent analysis)
- Finance + Macro (policy impact, central bank analysis, geopolitical risk)
- Open Skill authoring (users create and share their own Skills)

### Phase 10→100: Platform (year 2+)

**Skill Ecosystem:**

```
multica.ai/skills/
├── @multica/          Official Skills (free)
├── @analyst-pro/      Community contributor (free/paid)
├── @hedgefund-x/      Enterprise private Skills
└── @lawfirm-y/        Vertical-specific paid Skills
```

- Anyone can publish a Skill (it's a Markdown file)
- Enterprises deploy private Skills for their teams
- Paid Skills: creator sets price, Multica takes platform fee

**Data Marketplace:**
- Third-party data providers plug into Multica's backend
- Premium data sources available to paying users
- Multica becomes the distribution channel for data providers

**Multi-vertical expansion:**
- Each new vertical = backend source adapters + domain Skills
- Agent engine unchanged
- Same authorization model, same product surface

---

## Defensibility

| Layer | Moat |
|-------|------|
| Data infrastructure | Aggregated, normalized, cached — hard to replicate per-source |
| Skill ecosystem | Network effects: more Skills → more users → more Skill creators |
| User data | Portfolio history, preference patterns, analysis history — switching cost |
| Trust calibration | User's authorization levels and constraints are personalized over time |
| Domain compounding | Cross-vertical composition (finance + legal + medical) is uniquely enabled by the unified `data` tool architecture |

---

## Summary

Multica is an always-on AI agent that completes the full knowledge work chain: data → analysis → decision → action.

It starts in finance — where data is accessible, users pay, and quantitative output is the clearest differentiator — with a daily briefing that delivers value in < 24 hours.

It scales horizontally through a unified `data` tool + Skill architecture that adds new verticals without changing the agent engine.

It builds a platform moat through a Skill ecosystem where domain experts encode their workflows as shareable, composable Markdown files.

The product is not a tool you open. It's an employee that works while you sleep.
