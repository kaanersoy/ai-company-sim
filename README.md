# ai-company-sim

**An AI company simulation you can watch.**

- 🧠 A CEO agent picks the product, hires, fires and sets the price
- 💸 Five customers pay a daily subscription only if the product is worth it
- 🏢 A pixel-art office shows everything live: work, messages, day and night
- 🛡️ Hard spend cap and a free mock mode, so experiments stay cheap

<img src="docs/demo-2.gif" alt="Demo: the pixel office" width="100%">

## How a run plays out

- 🚀 **Day 1:** an empty office. The CEO picks a product idea, sets a price and hires the team.
- ⚙️ **Every day:** the team builds, customers review, and each one subscribes or cancels.
- 📉 **The pressure:** salaries and rent are paid daily. The CEO can fire people to save cash.
- 💥 **The end:** if cash hits zero the company goes **BANKRUPT**. If not, it keeps growing.

## Quick start

```bash
git clone git@github.com:kaanersoy/ai-company-sim.git
cd ai-company-sim
npm install
npm run ui:mock      # UI in mock mode: $0, deterministic (use this for development)
```

Open http://localhost:3000 and press **Start**.

For real Claude runs, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`, then:

```bash
npm run ui                          # UI; Start uses real Claude (Haiku) when a key exists
npm run sim -- --days 30            # CLI run, spends real money up to maxSpendUsd
npm run sim -- --mock --days 5      # CLI mock run ($0); add --fresh to reset the DB
npm test                            # unit tests
npm run typecheck
```

Real spend is capped by `maxSpendUsd` in `config.json` (default $0.20). The UI has a "+ $0.20 limit" button that raises the cap for the current server session only.

## How it works

- **Engine** (`src/engine/`): a day loop that writes everything as events into a SQLite `events` table. It knows nothing about visuals.
- **Rules** (`src/engine/rules.ts`): agents only *propose* actions (hire, fire, spend, set price); the engine judges and applies them. Agent output never changes money directly.
- **Cost guard**: every LLM call goes through `CostGuard`, which checks the worst-case cost *before* the call.
- **LLM clients** (`src/llm/`): a deterministic mock and a real Claude client using forced tool use.
- **UI** (`src/server.ts`, `web/`): a WebSocket server streams events to a pixel-canvas office (Kenney RPG Urban Pack sprites, CC0). The UI only reads and replays events.

## Configuration

Everything tunable lives in `config.json`: prices, starting budget, office rent, subscription thresholds (`subscribeAvg`, `cancelAvg`), price range, the customer list, and `maxSpendUsd`.

A customer's daily value is `payCap * (avg / 10)^1.5`. A customer subscribes when its average score is high enough and the price is at most that value, and cancels when the score drops or the price exceeds the value.

## License

Character art: Kenney RPG Urban Pack (CC0).
