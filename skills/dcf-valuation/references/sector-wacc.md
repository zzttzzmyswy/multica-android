# Sector WACC Reference

Use the company's `sector` from `get_company_facts` to look up the base WACC range below, then adjust for company-specific factors.

## WACC by Sector

| Sector | Typical WACC Range | Notes |
|--------|-------------------|-------|
| Communication Services | 8-10% | Mix of stable telecom and growth media |
| Consumer Discretionary | 8-10% | Cyclical exposure |
| Consumer Staples | 7-8% | Defensive, stable demand |
| Energy | 9-11% | Commodity price exposure |
| Financials | 8-10% | Leverage already in business model |
| Health Care | 8-10% | Regulatory and pipeline risk |
| Industrials | 8-9% | Moderate cyclicality |
| Information Technology | 8-12% | Higher end for high-growth; lower for mature |
| Materials | 8-10% | Cyclical, commodity exposure |
| Real Estate | 7-9% | Interest rate sensitivity |
| Utilities | 6-7% | Regulated, stable cash flows |

## Adjustment Factors

**Add to base WACC:**
- High debt (D/E > 1.5): +1-2%
- Small cap (< $2B market cap): +1-2%
- Emerging markets exposure: +1-3%
- Concentrated customer base: +0.5-1%
- Regulatory uncertainty: +0.5-1.5%

**Subtract from base WACC:**
- Market leader with moat: -0.5-1%
- Recurring revenue model: -0.5-1%
- Investment grade credit: -0.5%

## Sanity Checks

- WACC should typically be 2-4% below ROIC for value-creating companies
- If WACC > ROIC, the company may be destroying value
- Typical range for US large-cap: 7-12%
- Anything below 6% or above 14% warrants extra scrutiny
