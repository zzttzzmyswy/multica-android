---
name: Earnings Analysis
description: >-
  Analyze a company's financial statements (income statement, balance sheet,
  cash flow statement) to assess financial health, earnings quality, and
  competitive advantage. Use when the user asks to read/analyze financial
  statements, check earnings quality, assess financial health, evaluate
  profitability trends, or screen for competitive moats.
version: 1.0.0
metadata:
  emoji: "\U0001F4D1"
  requires:
    env:
      - FINANCIAL_DATASETS_API_KEY
  tags:
    - finance
    - earnings
    - analysis
    - statements
    - buffett
userInvocable: true
disableModelInvocation: false
---

## Instructions

You are performing a structured financial statement analysis. Follow all steps in order and show your work. Output language must match the user's input language.

### Progress Checklist

```
Earnings Analysis Progress:
- [ ] Step 1: Gather financial data
- [ ] Step 2: Income statement analysis
- [ ] Step 3: Balance sheet analysis
- [ ] Step 4: Cash flow statement analysis
- [ ] Step 5: Buffett competitive advantage scoring
- [ ] Step 6: Quality of earnings assessment
- [ ] Step 7: SEC filing qualitative analysis
- [ ] Step 8: Peer comparison (if requested)
- [ ] Step 9: Present findings
```

### Step 1: Gather Financial Data

Use `data` tool with `domain="finance"` for all calls.

1. **Annual financial statements** (5 years):
   ```
   action: "get_all_financial_statements"
   params: { ticker: "[TICKER]", period: "annual", limit: 5 }
   ```
   This returns income statements, balance sheets, and cash flow statements together.

2. **Quarterly financial statements** (last 4 quarters):
   ```
   action: "get_all_financial_statements"
   params: { ticker: "[TICKER]", period: "quarterly", limit: 4 }
   ```

3. **Current financial metrics**:
   ```
   action: "get_financial_metrics_snapshot"
   params: { ticker: "[TICKER]" }
   ```

4. **Company facts**:
   ```
   action: "get_company_facts"
   params: { ticker: "[TICKER]" }
   ```
   Extract: `sector`, `industry` — needed for benchmark comparisons in later steps.

5. **Current stock price**:
   ```
   action: "get_price_snapshot"
   params: { ticker: "[TICKER]" }
   ```

### Step 2: Income Statement Analysis

Analyze the income statement across all 5 annual periods. Calculate and present:

1. **Revenue trend**:
   - Year-over-year growth rate for each year
   - 5-year CAGR: `(Revenue_latest / Revenue_earliest)^(1/years) - 1`
   - Flag any years with revenue decline

2. **Margin analysis** (calculate for each year, show the trend):
   - Gross Margin = Gross Profit / Revenue
   - Operating Margin = Operating Income / Revenue
   - Net Margin = Net Income / Revenue

3. **Margin benchmarks** (from [financial-ratios-benchmarks.md](references/financial-ratios-benchmarks.md)):
   - Compare each margin to sector benchmarks
   - Flag margins that are significantly above or below sector range

4. **EPS analysis**:
   - EPS trend over 5 years
   - EPS growth consistency (note any years of decline)

5. **Expense structure**:
   - Cost of revenue as % of revenue (trend)
   - SG&A as % of revenue (trend)
   - R&D as % of revenue (trend, if applicable)
   - Flag any expense category growing faster than revenue

Present as a table:

| Metric | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 | 5Y CAGR |
|--------|--------|--------|--------|--------|--------|---------|

### Step 3: Balance Sheet Analysis

Analyze the balance sheet across all 5 annual periods:

1. **Liquidity**:
   - Current Ratio = Current Assets / Current Liabilities
   - Quick Ratio = (Current Assets - Inventory) / Current Liabilities
   - Cash and equivalents trend

2. **Leverage**:
   - Cash vs. Total Debt (short-term + long-term debt)
   - Debt-to-Equity = Total Liabilities / Total Shareholders' Equity
   - Interest Coverage = Operating Income / Interest Expense
   - Debt payoff capacity = Total Debt / Net Income (in years)

3. **Asset quality**:
   - Receivables Turnover = Revenue / Accounts Receivable
   - Inventory Turnover = Cost of Revenue / Inventory (if applicable)
   - Goodwill as % of Total Assets (flag if > 30%)

4. **Equity structure**:
   - Retained earnings: year-over-year changes (growing?)
   - Preferred stock: present or absent?
   - Treasury stock: present? growing? (indicates buybacks)

5. **Working capital trend**:
   - Net Working Capital = Current Assets - Current Liabilities
   - Direction of change over 5 years

Compare key ratios to sector benchmarks from [financial-ratios-benchmarks.md](references/financial-ratios-benchmarks.md).

### Step 4: Cash Flow Statement Analysis

Analyze cash flow statements across all 5 annual periods:

1. **Operating cash flow quality**:
   - OCF vs. Net Income ratio for each year
   - Target: OCF/NI > 1.0 (cash earnings exceed accrual earnings)
   - Trend direction

2. **Free cash flow**:
   - FCF = Operating Cash Flow - Capital Expenditure
   - FCF Margin = FCF / Revenue
   - 5-year FCF trend and CAGR

3. **Capital intensity**:
   - CapEx / Revenue ratio
   - CapEx / Net Income ratio (Buffett benchmark: < 25% excellent, < 50% acceptable)
   - Is CapEx growing faster than revenue? (potential red flag)

4. **Cash flow composition**:
   - Net cash from operating activities (should be consistently positive)
   - Net cash from investing activities (negative = investing in growth)
   - Net cash from financing activities (pattern: debt vs. equity funded?)

5. **Shareholder returns**:
   - Dividends paid (from financing activities)
   - Share buybacks / treasury stock repurchase
   - Total payout ratio = (Dividends + Buybacks) / Net Income
   - Is the company returning cash while maintaining growth?

Present a summary table:

| Metric | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|--------|--------|--------|--------|--------|--------|

### Step 5: Buffett Competitive Advantage Scoring

Apply the scoring framework from [buffett-checklist.md](references/buffett-checklist.md).

For each of the 13 criteria across 4 categories:
1. Calculate the metric value from the data gathered in Steps 1-4
2. Determine the score based on the threshold table
3. Note the sector-specific caveats (Financials, Utilities, REITs, Growth-stage)

Present the full scorecard table and the overall rating (Excellent / Good / Average / Weak).

### Step 6: Quality of Earnings Assessment

Assess whether reported earnings are backed by real cash and sustainable operations:

1. **Accrual ratio**:
   - Formula: (Net Income - Operating Cash Flow) / Total Assets
   - Interpretation: Lower is better. High positive values suggest earnings are driven by accruals rather than cash.
   - Red flag threshold: > 10%

2. **Revenue recognition quality**:
   - Compare Accounts Receivable growth rate vs. Revenue growth rate
   - If AR grows significantly faster than revenue → potential aggressive revenue recognition
   - Red flag threshold: AR growth > Revenue growth + 5 percentage points

3. **Inventory quality** (if applicable):
   - Compare Inventory growth rate vs. Cost of Revenue growth rate
   - Rising inventory vs. flat/declining COGS → potential obsolescence risk
   - Red flag threshold: Inventory growth > COGS growth + 10 percentage points

4. **One-time items**:
   - Identify significant non-recurring charges or gains in the income statement
   - Calculate adjusted net income excluding one-time items
   - Compare adjusted vs. reported margins

5. **Deferred revenue trend** (if applicable):
   - Growing deferred revenue is a positive signal (future revenue already contracted)
   - Declining deferred revenue may signal weakening demand pipeline

Summarize quality of earnings as: **High** / **Moderate** / **Low** with supporting evidence.

### Step 7: SEC Filing Qualitative Analysis

Pull and analyze the most recent annual or quarterly filing:

1. **Get filing list**:
   ```
   action: "get_filings"
   params: { ticker: "[TICKER]", filing_type: "10-K", limit: 1 }
   ```
   If 10-K is not recent enough, also pull 10-Q:
   ```
   action: "get_filings"
   params: { ticker: "[TICKER]", filing_type: "10-Q", limit: 1 }
   ```

2. **Read MD&A section** (Management's Discussion and Analysis):
   ```
   action: "get_filing_items"
   params: { ticker: "[TICKER]", filing_type: "10-K", item: "7" }
   ```
   For 10-Q, MD&A is item "2":
   ```
   action: "get_filing_items"
   params: { ticker: "[TICKER]", filing_type: "10-Q", item: "2" }
   ```

3. **Read Risk Factors**:
   ```
   action: "get_filing_items"
   params: { ticker: "[TICKER]", filing_type: "10-K", item: "1A" }
   ```

4. **Extract and analyze**:
   - Management's explanation of revenue and margin trends
   - Forward-looking statements and guidance
   - Key risk factors that could impact financial health
   - Any disclosures about accounting policy changes
   - Cross-validate: Does management narrative align with the quantitative data from Steps 2-4?
   - Flag contradictions between management tone and actual numbers

5. **Summarize key insights**:
   - What management says about the business trajectory
   - Material risks not visible in the numbers alone
   - Any changes in risk factors vs. prior filings (if noticeable)

### Step 8: Peer Comparison (Conditional)

**Execute this step only when the user explicitly requests peer comparison or industry benchmarking.**

1. **Identify peers**:
   - Use the `sector` and `industry` from `get_company_facts`
   - Select 2-3 publicly traded competitors in the same industry
   - If the user specifies peers, use those instead

2. **Pull peer data** (for each peer):
   ```
   action: "get_financial_metrics_snapshot"
   params: { ticker: "[PEER_TICKER]" }
   ```
   ```
   action: "get_income_statements"
   params: { ticker: "[PEER_TICKER]", period: "annual", limit: 1 }
   ```
   ```
   action: "get_balance_sheets"
   params: { ticker: "[PEER_TICKER]", period: "annual", limit: 1 }
   ```

3. **Comparative table**:

   | Metric | [TARGET] | [PEER 1] | [PEER 2] | [PEER 3] | Sector Avg |
   |--------|----------|----------|----------|----------|------------|
   | Revenue Growth (YoY) | | | | | |
   | Gross Margin | | | | | |
   | Net Margin | | | | | |
   | ROE | | | | | |
   | D/E Ratio | | | | | |
   | FCF Margin | | | | | |
   | P/E Ratio | | | | | |

4. **Competitive position assessment**:
   - Where does the target company rank among peers on each metric?
   - Identify clear advantages and disadvantages relative to peers
   - Note if the target trades at a premium or discount to peers and whether it's justified

### Step 9: Present Findings

Compile the full analysis into a structured report. Follow this exact structure:

#### 1. Executive Summary
- Company name, ticker, sector, current price
- One-paragraph thesis: Is this a financially healthy company with a durable competitive advantage?
- Financial health rating from Buffett scorecard (Excellent / Good / Average / Weak)
- Earnings quality assessment (High / Moderate / Low)

#### 2. Financial Health Scorecard
- Full Buffett checklist scorecard table from Step 5
- Total score and rating

#### 3. Trend Dashboard
- 5-year key metrics trend table from Steps 2-4:

| Metric | Y1 | Y2 | Y3 | Y4 | Y5 | Trend |
|--------|----|----|----|----|----|----|
| Revenue | | | | | | arrow |
| Gross Margin | | | | | | arrow |
| Net Margin | | | | | | arrow |
| ROE | | | | | | arrow |
| D/E Ratio | | | | | | arrow |
| FCF | | | | | | arrow |
| OCF/NI | | | | | | arrow |
| CapEx/NI | | | | | | arrow |

Use directional indicators in the Trend column.

#### 4. Quality of Earnings
- Summary from Step 6 with key metrics and assessment

#### 5. Key Strengths & Red Flags
- **Strengths**: List 3-5 financial strengths with supporting data
- **Red Flags**: List any warning signs discovered during analysis. If none, state "No material red flags identified."

Common red flags to watch for:
- Revenue growth but declining margins
- Net income growing but OCF declining
- AR growing faster than revenue
- Inventory building up vs. flat COGS
- Rising debt with declining interest coverage
- Retained earnings declining
- Large goodwill relative to total assets
- CapEx consistently > 50% of net income
- Management tone in MD&A contradicts financial data

#### 6. SEC Filing Insights
- Key findings from Step 7
- Management's outlook and material risks

#### 7. Peer Comparison (if Step 8 was executed)
- Comparative table and competitive position assessment

### Guardrails

- Always state the date range of financial data used.
- If any data is missing or unavailable, explicitly note it and adjust the analysis scope.
- Do not present calculated ratios as precise — round to one decimal place.
- Clearly distinguish between facts (from data) and interpretive conclusions.
- The Buffett scorecard is a screening framework, not a buy/sell recommendation. State this in the output.
- For non-US companies or companies not filing with the SEC, skip Step 7 and note the limitation.
- Output language must match the user's input language (Chinese input → Chinese output, English input → English output).
