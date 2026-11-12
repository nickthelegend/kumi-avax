# Kumi on Avalanche: your group chat is a fund, now trading perps

Friends pitch a trade in the crew chat: `/long AVAX 3x 20%`. Members vote with their shares. When yes passes the
threshold, the crew's vault opens the position on an **on-chain order book perps market on Avalanche Fuji**. PnL
updates live in the room, marked to Chainlink. Any member can **ragequit with their exact share**, even while a
position is open.

> **Prior work, disclosed.** Kumi was first built for NEAR (`grokbot/projects/kumi`): crew rooms, `/buy SOL 10%`
> chat commands, Sputnik DAO votes, captain limits, ragequit, and the coral and plum clay art with its mascots and
> 3D objects. This repo reuses that UX, the stylesheet (`web/src/styles.css`, unchanged) and the art in
> `web/public/art`. Everything else is new for Avalanche: the Solidity order book perps venue (`KumiPerps`), the
> crew vault that trades perps by vote (`KumiCrew`), on-chain chat, the markets page, the maker bot, the Primit
> research and adapter, and this web app's perps screens.

## Live on Fuji (chainId 43113)

| Contract | Address |
|---|---|
| KumiPerps (order book venue) | [`0x6b0b…` see deployments/fuji.json](deployments/fuji.json) |
| KumiCrewFactory | see below |
| Night Owls crew vault | see below |
| TestUSDC (tUSDC, 6 dp, faucet) | see below |

<!-- ADDRESSES -->

Price feeds are Chainlink's own Fuji feeds, with addresses taken from Chainlink's feed directory:

| Feed | Address | Heartbeat |
|---|---|---|
| AVAX/USD | [`0x5498BB86BC934c8D34FDA08E81D444153d0D06aD`](https://testnet.snowtrace.io/address/0x5498BB86BC934c8D34FDA08E81D444153d0D06aD) | 10 min |
| BTC/USD | [`0x31CF013A08c6Ac228C94551d535d5BAfE19c602a`](https://testnet.snowtrace.io/address/0x31CF013A08c6Ac228C94551d535d5BAfE19c602a) | 24 h |

Both feeds also update on a 1% move. Every deployment and seeding tx, every maker quote, and every demo step is
recorded with its hash, block and gas in [`deployments/fuji.json`](deployments/fuji.json).

## The live demo

<!-- DEMO -->

## How it works

| Piece | What it does |
|---|---|
| `contracts/src/KumiPerps.sol` | **The order book** is fully on-chain, with limit, IOC (market), post-only and reduce-only orders. Price levels are a sorted linked list, and orders queue FIFO within a level (price-time priority). Self-trades cancel the resting order. A maker that would breach its margin is skipped and cancelled, so its orders can't jam the book. **Prices and margin:** orders must sit within ±5% of Chainlink. Cross margin in tUSDC, with 10% initial and 5% maintenance. Equity and margin are marked to Chainlink, while fills happen at book prices. **Funding** is the book mid's premium over Chainlink, capped at ±1% and paid over 8 h, accrued every second and settled whenever a position is touched. **Liquidation:** anyone can close an under-maintenance account through the book for a 1% fee, and bad debt is drawn from an insurance fund. **Stale feeds:** if a Chainlink answer is non-positive or older than `maxAge`, trading, withdrawals and liquidations revert, but cancels still work. Views: `depth`, `recentTrades` (an on-chain ring buffer), `positionsOf` (with liquidation price), `health`, `fundingInfo`. |
| `contracts/src/KumiCrew.sol` | **The crew vault**, one EIP-1167 clone per crew. **Joining:** it is invite-only, and new members are added by vote. Shares are minted at the marked NAV, and all the money sits as margin in one KumiPerps account. **Pitches and votes:** `pitch` is the on-chain form of `/long AVAX 3x 20%`, and the pitcher's own yes vote counts. Votes are weighted by **current** shares, so a member who has ragequit no longer counts. The deciding vote executes in the same transaction, through `try/catch` so a venue refusal keeps the vote. The deciding vote needs at least 2.5M gas, so gas estimation can't settle on the caught out-of-gas path. **Execution:** the trade is an IOC order at most `maxSlippageBps` from Chainlink. **Policy:** a vote threshold, the voting period, max leverage per pitch, and a **crew-wide leverage cap** (total notional ≤ NAV × maxLeverage, checked after every open). **Captain lane:** the captain can trade without a vote within limits on leverage, size as a share of NAV, and trades per day. **Ragequit** closes `shares / total` of every open position on the book. The leaver takes `equityAfter − (1 − s) × equityBefore`, so the members who stay keep exactly what they had per share, and the leaver pays the spread. A full exit ends membership. **Chat** (`say`) and every pitch, vote, fill, deposit and exit are kept as on-chain feed entries. |
| `contracts/src/venues/PrimitOrderlyAccount.sol` | **The mainnet Primit route.** It deposits USDC into Orderly's Avalanche vault and sets a delegate signer. See [docs/PRIMIT.md](docs/PRIMIT.md): Primit matches orders off-chain on Orderly, so a contract cannot place its orders. |
| `scripts/fuji/*.ts` | **Fuji tooling:** test keys in a gitignored `.env`, funding, deployment, and the maker bot. The bot quotes 6 levels on each side, 0.05% from Chainlink, and `--skew-bps` leans the book. Every tx is recorded. |
| `sdk/` | ABIs, the chat-command parser (`/long`, `/short`, `/close`, `/captain …`, `/invite`) with its tests, and formatting helpers. |
| `web/` | The Vite + React app. **Pages:** `/room` (the crew list, the chat with trade cards and share-weighted vote bars, and the fund pane with live positions, Chainlink and close-now PnL, liquidation price, members and rules), `/markets/:sym` (laid out like Hyperliquid: a stats strip, depth chart, recent fills, the on-chain order book and fills linked to Snowtrace), `/crew` (the fund page with every pitch and its result) and `/` (the landing). **Signing:** a browser wallet (Core or MetaMask) switched to Fuji. QA builds (`VITE_QA=1`) can also use a **QA signer** that the Playwright harness injects. It is not in production builds, and no key ships in any bundle. |

### Avalanche, and why

- **Fast, cheap blocks.** The whole loop is on-chain: chat, votes, matching, funding and liquidation. That only
  works if blocks land in about 2 seconds and gas is almost free. Fuji gave us both: gas was 160 wei while we built.
- **Chainlink on Fuji.** The AVAX/USD and BTC/USD feeds mark every position and gate every trade.
- **C-Chain mainnet route.** Primit, an on-chain perps front end on Avalanche, was researched. Its adapter was
  simulated on a C-Chain **mainnet fork**, with no mainnet transaction.
- **Bonus features we did not use:** no custom L1, no ICM/ICTT, no eERC. Kumi doesn't need a second chain or
  encrypted balances, so it doesn't claim them.

## Try it

Node 22+ and pnpm 10.

```bash
pnpm install
cd contracts && forge test                               # 51 unit and attack tests (forks skipped)
FORK=1 forge test --match-contract FujiForkTest          # real Chainlink feeds on a Fuji fork
FORK=1 forge test --match-contract PrimitForkTest        # Orderly's vault on an Avalanche mainnet fork (simulation only)
cd ../sdk && node --test test/*.test.ts                  # chat-command parser
cd ../web && pnpm build && pnpm preview                  # http://127.0.0.1:5341
```

The app reads live Fuji state with no setup. To trade, connect a wallet on Fuji. The chip-in sheet has a 1,000 tUSDC
a day faucet button. Night Owls is invite-only, so you would need a member to `/invite` you, or you can deploy your
own crew with the factory.

To re-run the operator side, which needs a funded Fuji key:

```bash
cd scripts
node fuji/keys.ts                    # creates test keys in ../.env (never printed)
KUMI_FUNDER_ENV=/path/to/.env KUMI_FUNDER_VAR=PRIVATE_KEY node fuji/fund.ts
node fuji/deploy.ts                  # venue, markets, factory, crew
node fuji/maker.ts                   # seed both books (or --loop 120)
cd ../web && pnpm build:qa && npx vite preview --outDir dist-qa --port 5341 &
cd ../scripts && node qa/demo.mjs http://127.0.0.1:5341    # the live demo through the UI
node qa/shots.mjs http://127.0.0.1:5341                    # screenshots at 1440 and 375
```

## Limits, honestly

- **Test money only.** Margin is Kumi's Fuji test dollar (tUSDC), not Circle USDC.
- **Liquidity comes from Kumi's own maker bot.** The "price moves" step in the demo is the maker leaning its quotes,
  which are real orders on the book, while the Chainlink marks move on their own schedule.
- **Funding is deliberately simple:** premium over Chainlink, capped, over 8 h.
- **Liquidation needs liquidity.** It sells through the book, so with an empty book it can only close what fills.
- **Ragequit while the crew is below initial margin reverts.** The withdrawal margin check refuses it, so members
  must close or chip in first. This is tested and documented.
- **Primit:** the adapter only deposits and sets a delegate. Mainnet trading there needs an off-chain agent
  holding an Orderly key. Nick executes the one real mainnet trade himself, and this repo sends no mainnet
  transactions.
- **The contracts are unaudited hackathon code.**

## License

MIT, Copyright (c) 2026 Nivesh Gajengi.
