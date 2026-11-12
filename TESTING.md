# Testing

| Suite | Command | Tests | Result (Nov 12, 2026, v2.2) |
|---|---|---|---|
| Order book, matching | `forge test --match-contract KumiPerpsBookTest` | 11 | pass |
| Margin | `forge test --match-contract KumiPerpsMarginTest` | 5 | pass |
| Liquidation and insurance | `forge test --match-contract KumiPerpsLiquidationTest` | 4 | pass |
| Funding | `forge test --match-contract KumiPerpsFundingTest` | 3 | pass |
| Attacks on the venue | `forge test --match-contract KumiPerpsAttackTest` | 6 | pass |
| Conservation fuzz (256 runs) | `forge test --match-contract KumiPerpsConservationTest` | 1 | pass |
| Crew vault | `forge test --match-contract KumiCrewTest` | 21 | pass |
| **KumiLobby (v2)**: membership, calls, copies checked against real KumiPerps fills, attacks, fuzz | `forge test --match-contract KumiLobbyTest` | 15 | pass |
| **KumiGasStation (v2.2)**: a drip to a new wallet, only the relayer, signatures from another key / moved to another wallet / for another station / with a changed deadline / malformed / high-s malleated, expired and far deadlines, a second drip after spending it all, a wallet holding AVAX, an address with code, per-requester and daily caps (and the next-day reset), an empty station, owner-only config and relayer rotation, a 256-run fuzz that no other key's signature pays | `forge test --match-contract KumiGasStationTest` | 21 | pass |
| Real Chainlink feeds, Fuji fork | `FORK=1 forge test --match-contract FujiForkTest` | 3 | pass |
| Primit (Orderly vault), Avalanche mainnet fork | `FORK=1 forge test --match-contract PrimitForkTest` | 7 | pass |
| SDK: chat-command parser | `cd sdk && node --test test/*.test.ts` | 7 | pass |
| **SDK (v2): order encoding**, incl. KumiPerps accepting a live-book order and refusing an off-band one in an eth_call on Fuji | same | 8 | pass |
| **SDK (v2): candles**, incl. live Coinbase/Binance candles, Chainlink rounds on Fuji vs the exchange, Kumi fills from the on-chain ring | same | 7 | pass |
| **SDK (v2): chat client**, read live from Fuji: channels, a call and its copies (each copy's order tx is a real KumiPerps tx from the copier), crews and feeds | same | 4 | pass |
| **SDK (v2.1): eERC**, live Fuji: converter at 2 dp with the Kumi auditor set, what the public can and cannot read, every private-tip card in the AVAX pit is a real eERC transfer from the poster to the caller, the Night Owls settle-up; PCT round trip and wrong-key refusal | `cd sdk && node --test test/eerc.test.ts` | 5 | pass |
| **SDK (v2.2): gas request**, live Fuji: the digest the phone signs equals `KumiGasStation.digest` on Fuji and recovers to the wallet; the live station's relayer, drip and caps | `cd sdk && node --test test/gas.test.ts` | 2 | pass |
| **SDK (v2.2): caller board**, live Fuji: FIFO lot math (two lots, a partial close, a flip, a maker fill); leveraged call return; **the fill replay equals every copier's KumiPerps position**; each copy's lot is the fills of its own order tx and its entry is the lobby's stored Chainlink price; ren's closed copy's realised PnL equals its close fills; caller counts, wins and copy PnL add up, ranks 1..n, unscored last, marks are Chainlink | `cd sdk && node --test test/leaderboard.test.ts` | 6 | pass |
| **API (v2.2): gas sponsor**, live Fuji: Setup required without keys; malformed address / signature / deadline; a forged or moved signature (401); expired and far deadlines; a wallet holding AVAX (409); **one real drip to a new wallet** read back from the `Dripped` event, then the same wallet refused; the per-IP limiter's 7th request (429); the station's on-chain room | `cd api && node --test test/gas.test.ts` | 8 | pass |
| **API (v2.2): Kumi AI**, live Fuji: `order_book`, `chainlink_price`, `chat_activity` (lobby and crew), `top_callers` / `caller_record` (equal to `readLeaderboard`), `my_positions` (equal to `positionsOf`) each checked against a direct chain read; `draft_call` (lobby margin, crew leverage cap, crew pitch command); the endpoint refuses a missing key (Setup required), a pass from another key, an expired pass, a non-member and a non-Kumi crew; **one real `claude-haiku-5-5` answer** that called `order_book` and a caller tool | `cd api && node --test test/ask.test.ts` | 8 | pass |
| **Mobile (v2): invite links** (QR / paste) | `cd mobile && npm test` | 4 | pass |
| **eERC end-to-end on Anvil (v2.1)**: Ava Labs' EncryptedERC with production verifiers, Kumi's TestUSDC and real Groth16 proofs; stolen, cross-chain, forged, replayed and tampered proofs, redirected sends and over-spending are refused | `cd contracts && FOUNDRY_PROFILE=eerc forge build && cd ../scripts && pnpm test:eerc` | 40 checks | pass |
| **Total** | | **196** | **196 pass** |

`forge test` runs 87 tests and skips the two fork suites (they need `FORK=1` and public RPCs). The SDK suite is 39
tests and the API suite 16; the order, candle and chat tests that touch a chain read **live Fuji** and the public exchange APIs, with no
mocked RPC. The phone app imports the same SDK code (`@kumi-avax/sdk` is bundled by Metro), so these cover the phone's
order encoding, candle builder and chat client.

**v2.2 end to end.** The native app in Expo Go on the iOS Simulator made a new wallet, got gas from KumiGasStation
through the hosted API and signed its own tUSDC faucet tx; asked Kumi AI in the AVAX pit; and posted a call Kumi AI
drafted (`v22Runs`). `scripts/qa/hosted-v22.mjs` repeats the gas-free start, the Top tab, a join and a Kumi AI
answer on the hosted phone build, and checks the hosted web app at 1440 and 375, with no console errors
(`hostedV22`). `scripts/qa/web-v22.mjs` runs real Kumi AI answers in the web lobby and crew room through the QA
signer.

**End-to-end on Fuji, through the phone app:** `scripts/qa/phone.mjs` drives the Expo web build at 375 px: a new
wallet made in the app, the tUSDC faucet, joining a public chat, copying a call (approve, deposit, IOC order,
`KumiLobby.copy`), a chat message, a BTC limit order, the crew room and the join-code QR. The txs are in
`deployments/fuji.json` (`phoneDemo`, `phoneRuns`) and in the README.

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

**eERC end-to-end** (`scripts/eerc/local-e2e.ts`, Anvil, no mocks, real proofs from the shipped zkeys)
- **Setup:** TestUSDC and the eERC (converter, 2 decimals, production verifiers) deploy; the same wallet
  signature always reopens the same eERC key.
- **Registration attacks:** another account can't submit your registration proof (`InvalidSender`); a proof made for
  Fuji is refused on another chain (`InvalidChainId`); a proof with a swapped public key is refused; registering twice
  is refused. Nothing can be shielded before an auditor is set, and only the owner sets the auditor.
- **Shield:** an unregistered account can't move tUSDC in; the public sees the pool hold 50 tUSDC while only the
  owner's key decrypts 50.00 (another key can't open it); an odd amount keeps whole cents and returns the dust.
- **A private tip with a Kumi memo:** you can't send to someone who has no private balance; after the tip each side
  reads its new balance with its own key; no public tUSDC moved; the amount appears nowhere in the calldata; the
  memo links the tip to lobby channel 0, call #7; the receiver, the sender (from the memo copy) and the auditor each
  decrypt 2.50; a stranger, with or without a key, gets nothing; a card posted by someone other than the sender, or a
  transaction on another contract, is rejected; the chat text round-trips to the hash and nothing else.
- **Attacks on private sends:** replaying a transfer proof is refused; another account can't submit it; a proof made
  for kai can't be redirected to someone else; a tampered public signal or curve point is refused; no proof exists for
  sending more than the encrypted balance.
- **Move out:** another account can't submit your withdraw proof; a raised amount is refused; no proof exists for
  more than the balance; replaying a withdraw is refused; the public tUSDC comes back exactly, and an emptied balance
  decrypts to 0.

**eERC on Fuji, through the apps** (txs in `deployments/fuji.json`)
- `scripts/qa/phone-private.mjs` (Expo web build, 375 px, a new in-app wallet): faucet, open (registration proof
  in the page, 4.8 s), move 20.00 in, join and copy a call, tip 1.50 privately (transfer proof + 2 txs, 10.4 s), the
  card shows the amount to the sender, move 5.00 out (withdraw proof, 5.3 s). 12 txs, no console errors.
- `scripts/qa/web-private.mjs` (web, QA signer): bo decrypts his settle-up card and sends mika 2.00 (10.4 s); ren tips
  mika 0.75 for the call he copied (9.4 s). No console errors.
- **iOS Simulator, native app in Expo Go** (driven by hand through the simulator, `iosPrivate`): registration,
  withdraw and transfer proofs all made on the device by the WebView prover; the tip card shows "You → mika, 1.00".

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

**KumiLobby** (`test/KumiLobby.t.sol`, v2)
- Creating a channel joins the creator; bad names and unknown markets revert; joining twice reverts.
- Leaving removes the member both ways (channel list and the member's channel list) and blocks posting; rejoining works.
- Only members post (fuzzed over random addresses); messages are 1 to 280 bytes.
- A call stores the Chainlink price, leverage and margin; a stale feed stores price 0 instead of reverting.
- **A copy is checked against the venue:** after a real IOC fill on KumiPerps, the copy records the venue's size and
  entry (20.01, the best ask). No position, the wrong side, copying twice, copying your own call, copying a
  non-call, or copying from outside the channel all revert.

## Ship round QA (Nov 12, 2026)

- **Every hosted screen, read-only:** `node scripts/qa/ship-shots.mjs after` opens all web routes (landing, crew
  room, a public chat, both markets, a crew fund page, a 404) at 1440 and 375, then the phone build at 375 with a
  brand-new in-page wallet (its real gas-free start) and every tab and sheet. It fails on sideways overflow or any
  console error. Before and after shots: `grokbot/orchestration/shots/avax-kumi/ship/{before,after}/`; the scores
  are in [docs/SCREEN-AUDIT.md](docs/SCREEN-AUDIT.md).
- **Standalone iOS Simulator build:** `mobile/scripts/build-ios-sim.sh` (prebuild, Release `xcodebuild` for arm64
  simulators, ad-hoc signed). Installed on the iPhone 17 Pro simulator and checked by hand: first launch, Create my
  wallet (the keychain write that failed in the unsigned build now works), the gas-free start's per-network cap
  notice, Chats, Market, Top, Wallet and a public chat. Native shots: `.../ship/native/`.
- **The download a judge gets:** the hosted `Kumi-iOS-Simulator.zip` was fetched back from
  kumi-avax-web.vercel.app and its SHA-256 matches `download/manifest.json` and the `.sha256` file; unzipped, the
  app passes `codesign --verify --deep` and has bundle id `xyz.kumi.avax`, version 0.2.0, iOS 16.4+.
- **Builds:** `pnpm --filter @kumi-avax/web build` and `tsc --noEmit` in `mobile/` pass.
