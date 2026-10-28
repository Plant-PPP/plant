// Renders the made-up exchange logs in this folder to wide PNG captures, the
// way a user screenshots them. Every figure, date and id is invented. Run
// from the repo root after changing a log:
//
//   pnpm --filter @plant/web exec node src/lib/ai/evals/fixtures/render.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

const page = (title, columns, rows) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #0f1115; color: #d7dae0; font: 12px ui-monospace, monospace; }
  h1 { font: 600 20px system-ui, sans-serif; margin: 24px 24px 12px; }
  table { border-collapse: collapse; margin: 0 24px 24px; width: calc(100% - 48px); }
  th { color: #7c8290; font-weight: 400; text-align: left; padding: 10px 12px; border-bottom: 1px solid #23262d; }
  td { padding: 12px; border-bottom: 1px solid #1a1d23; white-space: nowrap; }
  .ok { color: #3fb97a; }
</style></head><body>
<h1>${title}</h1>
<table><tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr>
${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}<td class="ok">Completed</td></tr>`).join("\n")}
</table></body></html>`;

const LOGS = {
  "funding-log": page(
    "Funding Account / History Log",
    [
      "Date &amp; Time",
      "Currency",
      "Type",
      "Network",
      "Fee",
      "Amount",
      "From",
      "To",
      "Tx ID",
      "Status",
    ],
    [
      [
        "2026-09-18 11:02:40",
        "BTC",
        "Collateral Top-Up",
        "Off-chain",
        "0.00000000 BTC",
        "-0.00300000 BTC<br>≈ -264 USD",
        "Funding",
        "Loan",
        "a81c…0f3e",
      ],
      [
        "2026-09-18 10:15:07",
        "BTC",
        "Withdrawal",
        "Bitcoin",
        "0.00004000 BTC<br>≈ 3.5 USD",
        "-0.05000000 BTC<br>≈ -4.4K USD",
        "Funding",
        "3Kq7…Wx2a",
        "c4d2…71b9",
      ],
      [
        "2026-09-18 10:01:55",
        "BTC",
        "Collateral Partially Released",
        "Off-chain",
        "0.00000000 BTC",
        "0.05200000 BTC<br>≈ 4.6K USD",
        "Loan",
        "Funding",
        "e19f…aa07",
      ],
      [
        "2026-09-18 09:58:21",
        "USDT",
        "Loan Repayment",
        "Off-chain",
        "—",
        "-2,100.00 USDT",
        "Funding",
        "Loan",
        "77b0…5c1d",
      ],
      [
        "2026-09-18 09:57:46",
        "USDT",
        "Transfer In",
        "Internal",
        "—",
        "2,100.00 USDT",
        "Unified Trading",
        "Funding",
        "d0e8…3f42",
      ],
      [
        "2026-09-12 16:40:10",
        "USDT",
        "Transfer Out",
        "Internal",
        "—",
        "-2,500.00 USDT",
        "Funding",
        "Unified Trading",
        "9a3c…b810",
      ],
      [
        "2026-09-12 16:38:02",
        "USDT",
        "Initial Loan Disbursement",
        "Off-chain",
        "—",
        "2,500.00 USDT",
        "Loan",
        "Funding",
        "41fe…02cd",
      ],
      [
        "2026-09-12 16:38:02",
        "BTC",
        "Collateral Locked",
        "Off-chain",
        "0.00000000 BTC",
        "-0.06000000 BTC<br>≈ -5.3K USD",
        "Funding",
        "Loan",
        "6b2a…e5f0",
      ],
      [
        "2026-09-12 16:20:33",
        "BTC",
        "Deposit",
        "Bitcoin",
        "0.00000000 BTC",
        "0.08000000 BTC<br>≈ 7.0K USD",
        "bc1q…7rka",
        "Funding",
        "f02d…9c61",
      ],
    ],
  ),
  "credit-line-log": page(
    "BTC Loans / History Log",
    ["Date &amp; Time", "Type", "Amount", "Impact", "Loan"],
    [
      [
        "Sep 19, 2026 18:00",
        "Interest Accrued",
        "0.010000 USDT",
        "Interest accrued",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 18, 2026 11:02",
        "Collateral Added",
        "0.00300000 BTC",
        "Added to collateral",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 18, 2026 10:01",
        "Collateral Released",
        "0.05200000 BTC",
        "Credited to Funding",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 18, 2026 09:58",
        "Repayment",
        "2,100.000000 USDT",
        "Debt reduced",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 15, 2026 18:00",
        "Interest Accrued",
        "0.497000 USDT",
        "Interest accrued",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 14, 2026 18:00",
        "Interest Accrued",
        "0.497000 USDT",
        "Interest accrued",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 12, 2026 16:38",
        "Loan Opened",
        "2,500.000 USDT",
        "Loan originated",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
      [
        "Sep 12, 2026 16:38",
        "Collateral Added",
        "0.06000000 BTC",
        "Locked as collateral",
        "5c0e1d2a-77f1-4c3b-9a10-1b2c3d4e5f60",
      ],
    ],
  ),
  "trading-log": page(
    "Unified Trading Account / Transaction Log",
    [
      "Date &amp; Time",
      "Type",
      "Symbol",
      "Maker/Taker",
      "Side",
      "Amount",
      "Price",
      "Total Value",
      "Fee",
      "Order ID",
    ],
    [
      [
        "2026-09-18 09:57",
        "Withdrawal",
        "USDT",
        "—",
        "Debit",
        "-2,100.00 USDT",
        "—",
        "2,100.00 USDT",
        "—",
        "—",
      ],
      [
        "2026-09-18 09:56",
        "Order Fill",
        "USDT",
        "Taker",
        "Sell/Short",
        "2,100.00 USDT",
        "210.0000 USDT",
        "2,100.00 USDT",
        "0 USDT",
        "01b7…3e9a",
      ],
      [
        "2026-09-18 09:56",
        "Order Fill",
        "MSFT",
        "Taker",
        "Sell/Short",
        "-10.0000 MSFT",
        "210.0000 USDT",
        "2,100.00 USDT",
        "0 USDT",
        "01b7…3e9a",
      ],
      [
        "2026-09-12 16:41",
        "Order Fill",
        "BTC",
        "Taker",
        "Buy/Long",
        "-0.02840909 BTC<br>≈ -2.5K USD",
        "0.00284091 BTC<br>≈ 250 USD",
        "0.02840909 BTC<br>≈ 2.5K USD",
        "0.00000000 BTC",
        "01a9…77c2",
      ],
      [
        "2026-09-12 16:41",
        "Order Fill",
        "MSFT",
        "Taker",
        "Buy/Long",
        "10.0000 MSFT",
        "0.00284091 BTC<br>≈ 250 USD",
        "0.02840909 BTC<br>≈ 2.5K USD",
        "0.00000000 BTC",
        "01a9…77c2",
      ],
      [
        "2026-09-12 16:40",
        "Order Fill",
        "BTC",
        "Taker",
        "Sell/Short",
        "0.02840909 BTC<br>≈ 2.5K USD",
        "0.00001136 BTC<br>≈ 1.00 USD",
        "0.02840909 BTC<br>≈ 2.5K USD",
        "0.00000000 BTC",
        "01a8…41d0",
      ],
      [
        "2026-09-12 16:40",
        "Order Fill",
        "USDT",
        "Taker",
        "Sell/Short",
        "-2,500.00 USDT",
        "0.00001136 BTC<br>≈ 1.00 USD",
        "0.02840909 BTC<br>≈ 2.5K USD",
        "0.00000000 BTC",
        "01a8…41d0",
      ],
      [
        "2026-09-12 16:40",
        "Deposit",
        "USDT",
        "—",
        "Credit",
        "2,500.00 USDT",
        "—",
        "2,500.00 USDT",
        "—",
        "—",
      ],
    ],
  ),
};

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 2000, height: 520 } });
for (const [name, html] of Object.entries(LOGS)) {
  await tab.setContent(html);
  await tab.screenshot({ path: join(here, `${name}.png`), fullPage: true });
}
await browser.close();
