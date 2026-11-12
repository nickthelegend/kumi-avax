# Testing

| Suite | Command | Tests | Result (Nov 12, 2026) |
|---|---|---|---|
| Order book, matching | `forge test --match-contract KumiPerpsBookTest` | 11 | pass |
| Margin | `forge test --match-contract KumiPerpsMarginTest` | 5 | pass |
| Liquidation and insurance | `forge test --match-contract KumiPerpsLiquidationTest` | 4 | pass |
| Funding | `forge test --match-contract KumiPerpsFundingTest` | 3 | pass |
| Attacks on the venue | `forge test --match-contract KumiPerpsAttackTest` | 6 | pass |
| Conservation fuzz (256 runs) | `forge test --match-contract KumiPerpsConservationTest` | 1 | pass |
| Crew vault | `forge test --match-contract KumiCrewTest` | 21 | pass |
| Real Chainlink feeds, Fuji fork | `FORK=1 forge test --match-contract FujiForkTest` | 3 | pass |
| Primit (Orderly vault), Avalanche mainnet fork | `FORK=1 forge test --match-contract PrimitForkTest` | 7 | pass |
| Chat-command parser | `cd sdk && node --test test/*.test.ts` | 7 | pass |
| **Total** | | **68** | **68 pass** |

The plain `forge test` runs 51 tests and skips the two fork suites. Those need `FORK=1` and the public RPCs.

## What the tests cover

**Order book** (`test/KumiPerps.t.sol`)
- **Book shape:** best bid and ask, and depth ordering.
- **Matching:** price-time priority (the oldest order at a level fills first), market orders walking levels with
  the average entry, crossing limits that fill then rest, and IOC orders that never rest.
- **Order controls:** cancel is owner-only and releases reserved margin. Self-trades cancel the resting order, and
  post-only refuses a cross.
- **Rules:** tick and lot are enforced, and reduce-only caps at the position and refuses flips.
- **PnL:** realised PnL on close equals size × (exit − entry).

**Margin**
- More than 10x (over initial margin) reverts.
- Resting orders need margin.
- A withdrawal is blocked below initial margin and can never exceed collateral.
- A maker that can no longer afford a fill is skipped and cancelled, never filled.

**Liquidation**
- A healthy account can't be liquidated.
- After a price drop, the keeper closes the position through the book and is paid.
- A gap below zero is written off from the insurance fund.
- `positionsOf` reports the liquidation price.

**Funding**
- With the book 0.5% above the oracle, the long pays the short exactly $10 on $2,000 over 8 h.
- The premium is capped at 1%.
- With a one-sided book there is no funding.

**Attacks**
- **Oracle staleness:** placing orders and liquidating revert with `StaleOracle`, and cancels still work. A zero or
  negative oracle answer reverts.
- **Off-oracle prices:** orders outside the ±5% band are refused, and a market order can't fill outside the band.
- **Market listing** is owner-only.
- **Cross margin:** an unrealised loss in one market blocks over-leverage in another.

**Conservation fuzz**
- Over random fills and price moves, the sum of every account's equity equals the deposits. No money is created.

**Crew vault** (`test/KumiCrew.t.sol`)
- **Shares:** shares are minted at NAV, including mid-position at the marked NAV, and all money sits as perps
  margin.
- **Non-members** can't chip in, pitch, vote or chat.
- **The `/long AVAX 3x 20%` flow:** the pitcher's yes counts, the deciding vote opens 30 AVAX at the maker's best
  ask, and voting after execution reverts.
- **Vote outcomes:** no votes block. `execute` needs the threshold. Double votes and late votes revert, and an
  expired pitch can't execute.
- **Over-leverage attack:** a 6x pitch is refused against a 5x policy. Two trades that each pass but together exceed
  the crew-wide 5x cap are also refused: the second venue call reverts and its vote is kept.
- **Venue refusal:** when the venue refuses (an empty book), the vote is kept, the feed shows `ExecFailed`, and a
  retry succeeds once the maker quotes again.
- **Gas floor:** a deciding vote with too little gas reverts with `NeedMoreGas`. It does not fail silently inside
  `try/catch`.
- **Close:** after a price move, `/close AVAX` realises exactly +$29.40, and NAV is $1,029.40.
- **Ragequit while a position is open (attack):**
  - A 30% exit closes 30% of the position, and the per-share equity of the members who stay is unchanged.
  - The leaver pays the spread.
  - Exiting into a stale book costs the leaver, not the crew.
- **Ragequit, other cases:**
  - A flat exit pays the exact share.
  - The leaver's earlier vote stops counting.
  - When the last member leaves, everything is closed and nothing is left behind.
  - Burning more shares than you own reverts.
- **Captain lane:** leverage, size and trades-per-day limits, and a reset the next day.
- **Votes on the crew itself:** a vote replaces the captain and adds a member.
- **On-chain chat feed:** the entries, their order and their block numbers.
- **Clones:** the implementation and clones can't be re-initialised.

**Forks**
- **`FujiForkTest`** runs against the real Chainlink AVAX/USD and BTC/USD feeds. Their prices are live and scaled,
  a crew opens a 3x long marked exactly at Chainlink, and a stale BTC feed is refused after 26 h.
- **`PrimitForkTest`** runs against Orderly's live Avalanche vault:
  - The AVAX deposit fee is read.
  - A 20 USDC deposit reaches the vault under the adapter's own `primit` account id.
  - A deposit without the fee is refused, and so is a wrong account id.
  - The delegate signer is registered, and the delegate must be an EOA.
  - Only the owner controls the account.
  - This is simulation only. Nothing is broadcast.

## A note on mocks

**The unit tests use a local price feed contract (`LocalFeed`) so they can move the price and make it stale.** The
same contracts are also tested against the real Chainlink feeds on a Fuji fork (`FujiForkTest`), and on Fuji itself
in the live demo. No test stubs an RPC.

## Web QA

**The build:**
- `pnpm --filter @kumi-avax/web build` and `build:qa` pass type-checking and build.
- A grep of `web/dist` finds no `__KUMI_QA__`. The QA signer exists only in `dist-qa`.

**Screenshots:**
- `node scripts/qa/shots.mjs` captures every route at 1440 and 375 into
  `grokbot/orchestration/shots/avax-kumi/`.
- It runs headless Chrome under the shared Chrome lock.
- A route fails on an empty root, a page error, a console error, or horizontal overflow.

**The live demo:**
- `node scripts/qa/demo.mjs` drives the real UI with the three QA signers on Fuji.
- Each transaction is captured from the app and logged to `deployments/fuji.json` under `demo`.
- Step screenshots go to `docs/screenshots/`.
