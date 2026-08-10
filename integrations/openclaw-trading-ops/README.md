# Roberts Trading Ops for OpenClaw

Read-only OpenClaw tools for the local momentum radar and Alpaca paper bot.

Tools:

- `trading_radar_snapshot`: market-cap coverage, strict setups, and pre-market movers.
- `trading_bot_status`: sanitized health, positions, blockers, and performance evidence.
- `trading_research_report`: conservative combined report and mode assessment.

The plugin intentionally has no order-entry, close-position, reset, mode-change,
filesystem, shell, or broker-credential capability. It accepts only loopback HTTP
URLs and reads the existing local APIs.

## Development

```powershell
npm install
npm run plugin:build
npm run plugin:validate
openclaw plugins install --link .
openclaw plugins inspect roberts-trading-ops --runtime --json
```

The portfolio dev server must be running on `http://127.0.0.1:5173` unless the
plugin `baseUrl` configuration is changed to another loopback address.
