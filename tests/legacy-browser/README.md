# Archived fictional-money browser journeys

These seven Playwright specs target the retired `CowboyApp` practice interface: fictional wallets, invented markets, cash-out, rewards, and prediction contracts. The root page now serves `LiveWorkspace`, a real-data, no-money free-pick app. They were moved intact from `tests/browser` rather than deleted or weakened to pass against a different product.

The active browser suite remains in `tests/browser` and exercises source-backed games, account and ticket flows, cancellation, history filters, network failure recovery, and responsive navigation. Unit tests for the legacy practice engine still run under `npm test`; those tests do not establish features available in the main app.

Do not include this directory in the current live-product acceptance result. Restore these journeys only with an explicitly separate practice route and accurate fictional-data disclosure. This archive is not evidence of live trading, wagering, wallets, or casino functionality.
