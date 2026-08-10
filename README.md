# AI Operations Lab

A React and TypeScript operations dashboard for market research, paper-trading experiments, execution guardrails, and repeatable strategy review.

This repository is a public, credential-free snapshot of a larger private research workspace. It is designed to demonstrate product engineering, stateful automation, deterministic testing, API integration, and safety-focused decision logic. It is not financial advice and does not claim profitable performance.

## What it demonstrates

- A responsive React dashboard for stocks and crypto research.
- Live-data adapters for Alpaca, Binance and FRED.
- Multi-observation signal confirmation instead of one-tick decisions.
- Spread, quote freshness, halt, slippage, fee and portfolio-risk gates.
- Server-side paper-bot state that continues when the browser tab is closed.
- Append-only trade review and decision telemetry for later analysis.
- Explicit acknowledgements and conservative limits around any live mode.
- Automated checks for deterministic trading and risk rules.

## Verification

The current test suite covers confirmation timing, stale and missing quotes, execution spread, cross-venue divergence, cost-adjusted targets, position sizing, daily risk rules, cooldowns, macro-event windows, stop management and other deterministic gates.

```bash
npm ci
npm test
npm run lint
npm run build
```

## Run locally

```bash
npm ci
cp .env.example .env.local
npm run dev:forever
```

Open `http://localhost:5173/#/radar`.

The application works as a research dashboard without real credentials. Broker and webhook integrations require values in `.env.local`, which is ignored by Git. Never commit API keys or webhook URLs.

## Main technologies

- TypeScript, React and Vite
- Lightweight Charts and Recharts
- Node-based local API and supervisor scripts
- Alpaca, Binance and FRED integrations
- Deterministic TypeScript verification tests
- ESLint and GitHub Actions

## Safety notes

- Paper results are treated as engineering telemetry, not proof of future returns.
- The cost model includes spread, slippage and configurable fees.
- Stale, missing, unusually wide or materially divergent quotes are rejected.
- Live mode is disabled unless an explicit acknowledgement is configured.
- Runtime journals, credentials and local environment files are excluded from this repository.

## Related product work

The portfolio interface also links to my closed-source products [Listio](https://listio.lv/) and [Listio Drive](https://drive.listio.lv/). Their production source code remains private.

