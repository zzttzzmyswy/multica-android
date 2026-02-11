---
name: Finance Research
description: Conduct financial research and analysis including stock analysis, company fundamentals, SEC filings review, and market data retrieval. Use when the user asks about stocks, financial statements, company performance, market data, or investment analysis.
version: 1.0.0
metadata:
  emoji: "\U0001F4CA"
  requires:
    env:
      - FINANCIAL_DATASETS_API_KEY
  tags:
    - finance
    - research
    - stocks
    - data
userInvocable: true
disableModelInvocation: false
---

## Instructions

You are conducting financial research using real market data. Use the `data` tool with `domain="finance"` and the appropriate action.

### Available Data Actions

#### Price Data
- `get_price_snapshot` — Current stock price. Params: `{ ticker }`
- `get_prices` — Historical OHLCV prices. Params: `{ ticker, start_date, end_date, interval?, interval_multiplier? }`
  - interval: "day" (default), "week", "month", "year"
- `get_crypto_price_snapshot` — Current crypto price. Params: `{ ticker }` (e.g. "BTC-USD")
- `get_crypto_prices` — Historical crypto prices. Same params as get_prices.
- `get_available_crypto_tickers` — List available crypto tickers. Params: `{}`

#### Financial Statements
All share params: `{ ticker, period, limit?, report_period_gt?, report_period_gte?, report_period_lt?, report_period_lte? }`
- period: "annual", "quarterly", or "ttm"
- Dates in YYYY-MM-DD format

Actions:
- `get_income_statements` — Revenue, expenses, net income, EPS
- `get_balance_sheets` — Assets, liabilities, equity, debt, cash
- `get_cash_flow_statements` — Operating, investing, financing cash flows, FCF
- `get_all_financial_statements` — All three at once (more efficient when you need multiple)

#### Metrics & Estimates
- `get_financial_metrics_snapshot` — Current key ratios (P/E, market cap, margins, etc.). Params: `{ ticker }`
- `get_financial_metrics` — Historical metrics. Params: `{ ticker, period?, limit?, report_period*? }`
- `get_analyst_estimates` — EPS and revenue estimates. Params: `{ ticker, period? }`

#### Company Info
- `get_company_facts` — Sector, industry, employees, exchange, website. Params: `{ ticker }`
- `get_news` — Recent news articles. Params: `{ ticker, start_date?, end_date?, limit? }`
- `get_insider_trades` — Insider buying/selling (SEC Form 4). Params: `{ ticker, limit?, filing_date*? }`
- `get_segmented_revenues` — Revenue by segment/geography. Params: `{ ticker, period, limit? }`

#### SEC Filings
- `get_filings` — List filings metadata. Params: `{ ticker, filing_type?, limit? }`
  - filing_type: "10-K", "10-Q", "8-K"
- `get_filing_items` — Read specific filing sections. Params: `{ ticker, filing_type, accession_number?, item? }`
  - item: array of section names (e.g. ["Item-1A", "Item-7"] for 10-K)

### Research Workflow

1. **Understand** what financial data is needed
2. **Get context** — start with `get_price_snapshot` and `get_company_facts` for orientation
3. **Gather data** — use the appropriate actions for the analysis
4. **Analyze** — interpret data with proper financial reasoning
5. **Present** — clear findings with data tables and key takeaways

### Best Practices

- Use `get_all_financial_statements` when you need multiple statement types (saves API calls)
- Use annual data for trend analysis, quarterly for recent performance, TTM for current state
- Cross-reference metrics: revenue growth vs cash flow growth, margins vs peers
- Always note the time period and currency when presenting financial data
- For SEC filing analysis: first `get_filings` to find relevant filings, then `get_filing_items` to read specific sections
- Common 10-K items: Item-1 (Business), Item-1A (Risk Factors), Item-7 (MD&A), Item-8 (Financial Statements)
- Common 10-Q items: Part-1,Item-1 (Financial Statements), Part-1,Item-2 (MD&A)

### Example: Company Analysis

For "Analyze Apple's financial health":

```
1. data(domain="finance", action="get_price_snapshot", params={ticker: "AAPL"})
2. data(domain="finance", action="get_company_facts", params={ticker: "AAPL"})
3. data(domain="finance", action="get_all_financial_statements", params={ticker: "AAPL", period: "annual", limit: 3})
4. data(domain="finance", action="get_financial_metrics_snapshot", params={ticker: "AAPL"})
5. data(domain="finance", action="get_analyst_estimates", params={ticker: "AAPL"})
```

Then analyze trends, margins, growth rates, and present findings.
