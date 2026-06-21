# Scoop Backend

Scoop is a social prediction market application where users can trade on event outcomes by replying to market posts or placing orders through the web app. A market asks a yes/no question, users choose `YES` or `NO` with an amount, and the system tracks the order until the market expires, resolves, and pays out winners.

This backend is the API and automation layer for the project. It creates and serves markets, manages X OAuth sessions, processes social comments as orders, creates custodial Sui testnet wallets for users, checks dUSDC balances, executes DeepBook Predict orders, resolves markets, pays winning positions, posts market/result updates to social platforms, and records operational activity for debugging and monitoring.

The backend stores markets, users, orders, processed social comments, and bot activity in PostgreSQL through Prisma. It integrates with X, XP Social, Reddit mock posting, Sui testnet wallets, and DeepBook Predict execution.

## Tech Stack

- Node.js with Express 5
- PostgreSQL with Prisma ORM
- Sui TypeScript SDK
- `node-cron` workers
- X OAuth and social bot adapters
- XP Social API adapter

## Directory Structure

```text
backend/
  prisma/
    schema.prisma          Database schema
    migrations/            Prisma migration history
  src/
    adapters/              X, Reddit, and XP Social integrations
    config/                DeepBook Predict defaults
    crypto/sui/            Sui wallet, balance, gas, and transfer services
    scripts/               Utility scripts
    services/              Market, order, payout, bot, and system services
    utils/                 Post generation and parsing helpers
    workers/               Polling and settlement workers
    server.js              Express API entrypoint
```

## Prerequisites

- Node.js 18 or newer
- npm
- Docker, if using the local PostgreSQL compose file
- Sui testnet credentials for wallet funding and settlement features

## Setup

Install dependencies:

```bash
npm install
```

Start local PostgreSQL:

```bash
docker compose up
```

Create a local `.env` file. Do not commit it.

```env
DATABASE_URL="postgresql://Scoop:Scoop@localhost:5432/Scoop"
PORT=5050
FRONTEND_URL="http://localhost:5173"
SUI_NETWORK="testnet"
ORDER_EXECUTION_MODE="DEEPBOOK_PREDICT"
```

Apply migrations:

```bash
npx prisma migrate dev
```

Start the API:

```bash
npm run dev
```

The server listens on `http://localhost:5050` by default.

## Scripts

```bash
npm run dev              Start Express with nodemon
npm run system:status    Print automation pause/resume state
npm run system:pause     Pause automation workers
npm run system:resume    Resume automation workers
npm test                 Placeholder test script
```

## Important Environment Variables

Core:

- `DATABASE_URL`: PostgreSQL connection string used by Prisma.
- `PORT`: API port. Defaults to `5050`.
- `FRONTEND_URL`: Allowed CORS origin and OAuth redirect target.
- `NODE_ENV`: Enables secure cookie behavior in production.
- `SYSTEM_CONTROL_API_KEY`: Required for pause/resume API calls in production.
- `SYSTEM_PAUSED`: Starts automation in paused mode when set to `true`.

Execution mode:

- `ORDER_EXECUTION_MODE`: Defaults to `DEEPBOOK_PREDICT`. Any other value starts legacy market expiry, resolution, and auto BTC workers.
- `LEGACY_MARKET_WORKERS_ENABLED`: Enables legacy expiry and resolution workers.
- `LEGACY_AUTO_BTC_MARKETS_ENABLED`: Enables the legacy auto BTC market worker.

Sui and DeepBook Predict:

- `SUI_NETWORK` or `SUI_RPC_URL`: Sui client network or fullnode URL.
- `SUI_BOT_PRIVATE_KEY`: Bot key used for SUI gas funding.
- `SUI_ESCROW_ADDRESS`: Escrow address used for legacy transfers and payouts.
- `SUI_ESCROW_PRIVATE_KEY`: Escrow key used for payouts.
- `PREDICT_SERVER_URL`: DeepBook Predict server URL.
- `PREDICT_PACKAGE_ID`, `PREDICT_OBJECT_ID`, `PREDICT_REGISTRY_ID`: DeepBook Predict object configuration.
- `DUSDC_COIN_TYPE`, `PLP_COIN_TYPE`: Coin type overrides.
- `PREDICT_SERVER_TIMEOUT_MS`: DeepBook Predict API timeout.
- `DEEPBOOK_PREDICT_AUTODISCOVERY_ENABLED`: Enables DeepBook market discovery.
- `DEEPBOOK_PREDICT_SETTLEMENT_ENABLED`: Enables DeepBook settlement.

Social integrations:

- `X_BOT_ENABLED`: Enables X polling and posting.
- `X_OAUTH_CLIENT_ID`, `X_OAUTH_CLIENT_SECRET`, `X_OAUTH_CALLBACK_URL`, `X_OAUTH_SCOPES`: X OAuth configuration.
- `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `X_BEARER_TOKEN`: X API credentials.
- `X_BOT_USERNAME`, `X_BOT_USER_ID`: Bot identity for X comment handling.
- `X_COMMENT_POLL_INTERVAL_SECONDS`: X comment polling interval.
- `XP_SOCIAL_API_URL`, `XP_SOCIAL_BOT_API_KEY`: XP Social API configuration.

## API Overview

Health and control:

- `GET /`: API health message.
- `GET /system/status`: Current automation state.
- `POST /system/pause`: Pause automation workers.
- `POST /system/resume`: Resume automation workers.

Auth:

- `GET /auth/x/login`: Start X OAuth login.
- `GET /auth/x/callback`: Complete X OAuth login and set session cookie.
- `GET /auth/me`: Return the current session user and balances.
- `POST /auth/logout`: Clear the current session.

Markets:

- `POST /markets`: Create a market.
- `GET /markets`: List markets.
- `GET /markets/:id`: Get market details and order stats.
- `POST /markets/:id/orders`: Place an authenticated web order through the same social comment flow.
- `POST /markets/:id/resolve`: Resolve a market, pay winners, and post results.
- `POST /markets/:id/expire`: Mark an open market as expired.
- `POST /markets/:id/social-post`: Post a market to configured social platforms.
- `POST /markets/:id/social-post/:platform`: Post a market to one platform.

Users and orders:

- `GET /users/:platform/:username`: Get a user and their orders.
- `POST /users/:platform/:username/faucet`: Add demo dUSDC balance.
- `GET /users/:platform/:username/crypto-balances`: Get SUI and dUSDC balances.
- `GET /orders`: List all orders.
- `GET /orders/:id`: Get one order.

Social and diagnostics:

- `POST /simulate-comment`: Process a mock social comment.
- `POST /social/reply`: Reply to a social comment through the selected adapter.
- `GET /prices/btc`: Return current BTC price data.
- `GET /bot-activity`: Return the latest bot activity entries.

## Workers

`src/server.js` starts comment workers for XP Social and X. It then starts either DeepBook Predict workers or legacy workers based on `ORDER_EXECUTION_MODE`.

DeepBook Predict mode:

- `deepbookMarketDiscoveryWorker`: discovers eligible DeepBook Predict markets and posts them.
- `deepbookSettlementWorker`: settles and redeems eligible DeepBook Predict positions.

Legacy mode:

- `marketExpiryWorker`: expires markets after their expiry time.
- `marketResolutionWorker`: resolves expired markets.
- `autoBtcMarketWorker`: creates scheduled BTC markets when explicitly enabled.

Always considered:

- `xpSocialCommentWorker`: polls XP Social comments.
- `xCommentWorker`: polls X comments when `X_BOT_ENABLED=true`.

Workers check the system pause state before doing scheduled work.

## UML Sequence Diagram

The main order lifecycle uses the same service path for social comments and web orders.

```mermaid
sequenceDiagram
    autonumber
    actor Trader
    participant Social as X or XP Social
    participant Worker as Comment Worker
    participant API as Express API
    participant Handler as handleSocialComment
    participant DB as PostgreSQL via Prisma
    participant Sui as Sui and DeepBook Predict
    participant Bot as Social Bot Service

    Trader->>Social: Reply "YES 10 USDC" to market post
    Worker->>Social: Poll open market comments
    Social-->>Worker: New comment payload
    Worker->>DB: Claim ProcessedSocialComment
    Worker->>Handler: Process platform, post, comment, text
    Handler->>DB: Log COMMENT_DETECTED
    Handler->>Handler: Parse order command
    Handler->>DB: Find open market by platform post id
    Handler->>DB: Find or create user
    Handler->>Sui: Create wallet and fund gas when needed
    Handler->>Sui: Check dUSDC and execute order
    Sui-->>Handler: Transaction or execution result
    Handler->>DB: Create Order and update execution fields
    Handler-->>Worker: Reply text and status
    Worker->>Bot: Post reply to comment
    Worker->>DB: Mark comment processed

    Note over API,Handler: Web orders call POST /markets/:id/orders and reuse handleSocialComment with a synthetic comment id.

    API->>Handler: Resolve market request
    Handler->>DB: Mark winning and losing orders
    Handler->>Sui: Pay winning orders when configured
    Handler->>Bot: Post result replies to social platforms
```

## Database Models

Core Prisma models:

- `User`: platform identity, custodial Sui wallet fields, demo balance, and orders.
- `Market`: prediction market metadata, social post ids, resolution data, DeepBook Predict fields, and orders.
- `Order`: side, amount, payout, source comment, escrow, payout, and DeepBook execution fields.
- `ProcessedSocialComment`: idempotency record for polled comments.
- `BotActivity`: operational event log used by the UI and system control restore.

Enums:

- `MarketStatus`: `OPEN`, `EXPIRED`, `RESOLVED`, `CANCELLED`.
- `Outcome`: `YES`, `NO`.
- `Platform`: `X`, `REDDIT`, `XP_SOCIAL`.
- `OrderStatus`: `PLACED`, `WON`, `LOST`, `REFUNDED`.

## Development Notes

- Keep backend code CommonJS to match the existing package style.
- Run Prisma commands from this directory.
- Use `POST /simulate-comment` for local social-order smoke tests.
- Use `GET /bot-activity` to inspect worker and adapter behavior.
- Review migrations before applying them to shared databases.
- Never commit `.env`, private keys, or API credentials.
