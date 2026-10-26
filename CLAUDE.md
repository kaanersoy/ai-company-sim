# sim-company

AI company simulation: manager + employee agents build a product, one customer agent pays by product value.

## Rules
- Node.js + TypeScript (ESM, run with `tsx`). Windows/PowerShell compatible: use `path` module, no shell-specific commands in scripts.
- Simulation engine is independent of any visuals. Engine writes events (SQLite `events` table); UI only reads/replays them.
- EVERY LLM call goes through `costGuard` (worst-case check BEFORE the call). Never call an LLM client directly.
- Money/budget/hire/fire/salary/payment are changed only by the engine (`rules.ts`), never by agent output.
- Development and tests run in `--mock` mode: $0, deterministic. Real API only in explicit final validation (Phase 4+).
- Hard cap `maxSpendUsd` (config.json, default $0.20). Prices live in config.json, not code.
- API key only via `ANTHROPIC_API_KEY` env / `.env` (gitignored).

## Commands
- `npm run sim -- --mock --days 5` run simulation (add `--fresh` to reset the DB)
- `npm test` / `npm run typecheck`
- `npm run ui:mock` UI in forced mock mode ($0; use this for ALL development/UI checks). The Reset button asks `confirm()`.
- Product idea: each world gets a random `seed` (`game.seed` in config fixes it for tests) that picks an inspiration from `src/engine/ideas.ts`; the day-1 CEO prompt carries it, so every Reset starts differently. The CEO hires only what the product needs and reviews/fires staff daily (board shows each salary); the mock team size and firing follow the idea.

## Phases
Follow PLAN: do one phase at a time, wait for approval between phases. Current: Phase 4 code done (hire/fire/spend rules judged by the engine in rules.ts applyAction; real client src/llm/client.ts via forced tool use, key from env or .env; CLI prints a cost report). Web UI (src/server.ts + web/: WebSocket + pixel canvas office): `npm run ui` -> http://localhost:3000; it starts in real mode when a key exists, Start then spends real money. Real run via CLI: `npm run sim -- --days 30` (spends real money up to maxSpendUsd).

## Language
All UI, server and agent-facing wording is English (the user chats in Turkish, but the product is English).

## Customers
- `config.json` `customers[]`: `{id,name,business,need,payCap,everyDays,firstDay}`. Several small-business customers (cafe, bakery, gym, clinic, freelancer) review the product on their own schedule (`visitors()` in src/agents/customer.ts); each sees only the product file and the daily price. Hidden `need` is revealed only if the team messages "customer".
- Revenue is a DAILY SUBSCRIPTION. The CEO (finance role) sets the price with a `set_price` action (judged in `applyAction`, range `game.minPrice..maxPrice`, start `game.startPrice`). After each review the engine decides (`decideSubscription` in rules.ts): not subscribed -> subscribe if avg score >= `subscribeAvg` and price <= value; subscribed -> cancel if avg < `cancelAvg` or price > value (they can re-subscribe on a later visit). Value = `customerPayment(payCap, scores)` = payCap*(avg/10)^1.5 (payCap = what the product is worth per day to that customer; thresholds are deliberately gentle: subscribeAvg 5, cancelAvg 3, startPrice 15). Every day each subscriber pays the price (`subscription_payment` event, engine-only); `subscription` events carry the action; the CEO board shows price + subscribers. The UI shows the visitor's decision and counts subscription payments as income per customer.

## UI
- `npm run ui` → http://localhost:3000. Top-down pixel office on a 400x224 canvas (`web/app.js`), HTML bubbles over it. Characters from Kenney RPG Urban Pack (CC0, `web/assets/`); the office itself is drawn in code.
- Right panel (Product notebook): no chat log; after each day the engine makes one small `kind:"summary"` call (src/agents/summary.ts, `day_summary` event) and the UI shows the product description + one card per day (customer lines appended). Day 1: the company starts with NO employees (`startingEmployees: []`); the CEO alone decides the product and proposes the hires (engine judges them in `applyAction`); hires work from day 2. Messages: sender walks next to the receiver and shows a bubble; manager decisions (reply/hire/fire/spend) are bubbles too.
- No mode checkbox: Start always uses real Claude (Haiku) when a key exists (spends real money, capped by `maxSpendUsd`); mock only without a key. The cost card shows spent / cap.
- Each day card carries the finance report together with the daily summary (customer income; salaries, office rent `game.officeRentPerDay`, hire fees, severance, spends; net; cash), derived in `web/app.js` from events. When bankrupt (`sim_stopped` reason `bankrupt`) a big "BANKRUPT!" text shows over the screen (text only; Reset restarts). Starting budget 2000; the CEO sees daily costs/runway on the board and may fire to save cash.
- "Real money spent" card has a "+ $0.20 limit" button: each click raises the in-memory Claude cap by $0.20 for the current server session only (`addBudget` WS command; config.json untouched; resets on server restart). A budget-stopped world resumes on Start. The UI carries no explanatory sub-notes or mode pill.
- Buttons: Start (resumes, never wipes), Stop (stops at the next day boundary; resumable), Reset (deletes the current mode's DB, back to day 0; disabled while running). No daily panel: the right-hand "Product notebook" shows the day-1 product decision, day cards with the product summary, finance report and customer feedback.
- Time of day: the engine has only whole days, so `web/app.js` derives a clock from event progress (retro 06:30 → reply 07:30 → work → messages → salary 15:36 → customers 16:12/16:48 → `day_end` 17:30; next day restarts at dawn). Windows show sky/sun/moon/stars; the room is tinted at night/dusk. At the `salary` event (17:30) every employee and the CEO walk out through the door and the office stays empty overnight; the first event of the next day brings them back in through the door (`away` flag in `apply`).
- HUD (top-left) is cards: Time, Company cash (game money), Real money spent (only in real mode), Controls (day count / Start / Stop / Reset).
