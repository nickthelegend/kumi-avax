# Submission: Team1 India "Build Anything on Avalanche"

**Name:** Kumi on Avalanche

**One-liner:** Your group chat is a fund: get the Kumi app. Join a chat, copy a friend's trade call with one tap,
or vote your crew's vault into a perp: every message and order is signed on the phone and fills on an on-chain
order book on Avalanche.

## Description

Friends already talk trades in group chats. Pooling the money usually means one person holds it and a spreadsheet
tracks who owns what. Kumi turns the chat itself into the fund.

1. **Chip in.** Each member chips test dollars into the crew's vault and gets shares at the fund's marked value.
2. **Pitch.** Anyone types `/long AVAX 3x 20%` or `/short BTC 2x 10%`. The app shows a trade card: the margin
   (20% of the fund), the 3x position, and the size at the Chainlink price.
3. **Vote.** Members vote with their shares. The vote that crosses the threshold also executes the trade, in the same
   transaction. The vault sends an order to KumiPerps, a small but complete perpetuals market whose order book lives
   in the contract: limit and market orders, price-time priority, cross margin, funding on the book's premium over
   Chainlink, liquidations through the book, and an insurance fund.
4. **Watch PnL.** Positions show live PnL in the room, both at the Chainlink mark and what closing now would realise
   on the book. `/close AVAX` goes to a vote the same way and realises the PnL.
5. **Leave.** Any member can ragequit at any time. If positions are open, the leaver's slice of each one closes on
   the book first and the leaver pays that spread. The members who stay keep exactly what they had per share.

**On the phone (v2).** Kumi is an Expo app with its own Fuji wallet. Public chats (KumiLobby) sit next to the
crews: anyone joins, posts a call like "Long AVAX 3x, 50 tUSDC", and others tap **Copy**. The phone deposits margin,
sends its own IOC order to the book and records the copy; the contract refuses a copy unless the copier really holds
that side on KumiPerps, and writes the venue's size and entry into the chat. The Market tab has the live on-chain
book, real candles (Coinbase public candles, Chainlink's Fuji mark, Kumi's own fills as markers) and a ticket that
signs `placeOrder`. The web app shows the same chats, because there is no chat server: it is all on Fuji.

**Private tips and settle-ups (v2.1, eERC).** Paying a caller a cut for a good call, or paying a crewmate back,
normally tells the whole chain how much a caller earns and how big their followers trade. Kumi moves those payments
into Ava Labs' official EncryptedERC (unmodified, converter mode over tUSDC). A copier taps **Tip privately** on a
call they copied; a crew member taps 🔒 to settle up. The proof is made on the phone (a hidden WebView runs snarkjs
on iOS and Android, since Hermes has no WebAssembly) or in the browser, and the chat gets a card anyone can verify on
Snowtrace. Only the sender, the receiver and Kumi's auditor key can read the amount. Moving money in and out of the
private balance is public, and positions on the order book stay public; the README says exactly what is hidden.

**Gas-free start, Kumi AI and a caller board (v2.2).** "Create my wallet" now ends funded: the new wallet signs a
request and KumiGasStation on Fuji pays it 0.0002 AVAX, with the per-wallet, per-day and per-requester limits
enforced on-chain, then the phone signs its own test-USDC faucet tx. In any chat, `/ask` (or ✨) brings in Kumi AI,
a Claude agent (Haiku 5.5) whose read-only tools read the on-chain book, Chainlink, the chat's calls and copies,
caller records and your positions; it shows the tools it used and can draft a call that you review and sign. The
Top tab ranks callers from on-chain data only: each call's leveraged move from the Chainlink price stored at the
call, and copiers' PnL from replaying every KumiPerps fill (each copy's own order is its lot). Rank badges sit on
names in every chat.

Guard rails:
- A crew-wide leverage cap.
- A slippage limit against Chainlink.
- A captain who can trade without a vote, but only inside tighter limits.
- Invite-only membership that changes by vote.
- Stale or broken price feeds pause trading instead of mispricing it.
- The chat, the votes and the fills are all on-chain on Fuji.

**Mainnet research.** We also looked at routing crews to Primit on Avalanche mainnet. Primit turns out to be a
broker on Orderly Network, and its orders match off-chain. We built and fork-tested the on-chain half (deposit and
delegate signer). A vote-executed trade there would need a trusted off-chain agent, which is why Kumi's own Fuji
venue is the product.

**Prior work.** Kumi started as a NEAR project: crew rooms, chat commands, Sputnik DAO votes and the clay art.
This Avalanche build reuses that UX and art. The phone app reuses the mobile skeleton of Nakama, Nick's earlier
Sui crew wallet (navigation, secure-store wallet, QR join, notifications), with viem on Fuji in place of Sui and
Kumi's look on every screen. The Solidity perps venue, the vault, KumiLobby, on-chain chat, the markets page,
candles, the maker bot and the Primit work are new.

## Tech stack (Avalanche parts in bold)

- **Avalanche Fuji C-Chain**:
  - KumiPerps (on-chain order book perps)
  - KumiCrew vaults (EIP-1167 clones from KumiCrewFactory)
  - TestUSDC
  - KumiLobby public chats with venue-checked copies
  - on-chain chat feed
  - KumiGasStation: first gas for new wallets, signature-checked, with on-chain caps (v2.2)
- **Ava Labs eERC (EncryptedERC + Registrar, production Groth16 verifiers)** on Fuji: private tips and crew
  settle-ups, proofs made on the phone and in the browser, Kumi auditor key set on-chain
- **Chainlink price feeds on Fuji**: AVAX/USD, BTC/USD
- **Avalanche C-Chain mainnet** (simulation only): Orderly vault adapter for Primit, tested on a mainnet fork
- Solidity 0.8.28 and Foundry (unit, fuzz, and Fuji and mainnet fork tests)
- TypeScript, viem, React 19, Vite 7
- Anthropic Claude API (`claude-haiku-5-5`, tool use) on a Vercel serverless function for Kumi AI; key server-side only
- Expo SDK 58 (React Native 0.88, Expo Router, expo-secure-store, expo-camera, Reanimated 4) for the phone app
- Playwright (screenshots, and the live demo through the UI with a build-flagged QA signer)

## Live links

- Repo: this folder (`grokbot/avax/kumi-avax`). It is not pushed; Nick pushes.
- **KumiPerps venue:** https://testnet.snowtrace.io/address/0x6a6c0d74862edb85f2f0534381857347d5ae09a3
- **Night Owls crew vault:** https://testnet.snowtrace.io/address/0x1c11A95bfBfaA989afC1222d614A8FbD24f75677
- **KumiCrewFactory:** https://testnet.snowtrace.io/address/0x7be7c269acf2e0d0b7074e9a0bdc7dfb730b778c
- **TestUSDC:** https://testnet.snowtrace.io/address/0xd3fb99ea91a049f9dfde5f9ea17ea1355a1799bd
- **Vote that opened the 3x AVAX long:** https://testnet.snowtrace.io/tx/0xd0bb3fc4e25a5c44656baf564ee72eeb4f456f9008b941c9283b0630767a2c84
- **Vote that closed it (+3.05 tUSDC):** https://testnet.snowtrace.io/tx/0x80f1f7c0e878e0a0c536c5623be06dac391e66653ad394317eb506e8832ec821
- **Ragequit while a BTC short was open:** https://testnet.snowtrace.io/tx/0x38e9477e9cc10f5a825421432b3f892ec50d1ecc19c1a733717365a9b9a168c1
- **All txs:** `deployments/fuji.json`
- **KumiLobby:** https://testnet.snowtrace.io/address/0x86c916ab60f186a43ab6b31603d91641dc228e7a
- **A copy signed in the phone app (17.79 AVAX on the book):** https://testnet.snowtrace.io/tx/0x1d351d7ee13d874a04d958869bd338c838dfb4a62fd930e2ec86295077c6f8fb
- **EncryptedERC (eERC):** https://testnet.snowtrace.io/address/0xf8d4eeb6a0a5aff971c16f2baf9f0aee0fdb4c23
- **eERC Registrar:** https://testnet.snowtrace.io/address/0x4de185b2d8ee6a73d78e90c3e024f230799b561c
- **A private tip with its proof made on the iPhone simulator (amount hidden):** https://testnet.snowtrace.io/tx/0xe5deb19f810a15dda490c538a4b3d90abd8159220b6dfd2d63a73e39c514ae73
- **A private tip for mika's AVAX call #7:** https://testnet.snowtrace.io/tx/0x81b6aacd61f188ed6561c50fe5eda4ba2d7fe02f11aec449a8583e611bdfb831
- **KumiGasStation:** https://testnet.snowtrace.io/address/0xf47d3dbcb7180f6c95680e120df34a50097af44d
- **A new wallet's first gas, from the iOS Simulator:** https://testnet.snowtrace.io/tx/0x41b018b49971b96450ee574c0a3d0960c7cb258190ec56b0b27d17ed3166fbf2
- **A call drafted by Kumi AI and signed on the iOS Simulator:** https://testnet.snowtrace.io/tx/0x06996f58ae578449e1daedd549be8f3ec11b19c4504641a2ebb3a27b4d3b0802
- **Kumi API:** https://kumi-avax-api.vercel.app/api/health
- **Get the app (landing):** https://kumi-avax-web.vercel.app/#get-app
- **iOS Simulator download (standalone Release build):** https://kumi-avax-web.vercel.app/download/Kumi-iOS-Simulator.zip (SHA-256 `322007cfad16849f85c410aaff4816399042935b7f4e03fe01b0a9dc6a223b44`; install with `xcrun simctl install booted Kumi.app`)
- **Phone app (Expo web build):** https://kumi-avax-app.vercel.app
- **Web app:** https://kumi-avax-web.vercel.app
- **Phone on a device:** `cd mobile && npm install && npx expo start`, scan with Expo Go (SDK 58)

## Demo video

**Film (2:53):** `grokbot/videos/kumi-avax/kumi-avax-film.mp4` (1080p) · share copy `kumi-avax-film-share.mp4` (720p,
< 10 MB) · upload link: _TBD (Nick uploads)_. All filmed live on Fuji on Nov 13 (04:05-04:16 UTC), on the standalone build
from the landing's download, running on the iOS Simulator. It opens on the crew vote: the phone holds Jun's Kumi test key
(imported off camera through "I have a Fuji key"); Lia's pitch and Sora's vote arrive live from Kumi test accounts
(`scripts/fuji/crew-act.ts`), and Jun's tap is the deciding vote that trades the Frog Pond vault on KumiPerps in the same
transaction (decoded on Snowtrace, since the contracts are now source-verified). Then Kumi AI, a copy and its fill on
Snowtrace, a private eERC send (hidden on Snowtrace, read by the receiver on the web), Top callers, the download and a
brand-new wallet's gas-free start. Hashes: `grokbot/videos/kumi-avax/film/v5/work/judge-v7/onchain.md`.

## Slides

[docs/SLIDES.md](docs/SLIDES.md)

## AI tools used

- **Claude Code** (Anthropic) wrote the contracts, tests, scripts, web app, phone app, the eERC integration and docs,
  and drove the live demos (web, phone web build and the iOS Simulator).
- **Claude Haiku 5.5** (Anthropic API) is inside the product: it powers Kumi AI in the chats (v2.2).
- The **Primit research** was done by a Claude Code subagent from public pages and read-only RPC calls.
- **ChatGPT images** made the clay art and 3D objects reused from Kumi's NEAR build, and the v2.1 set for this
  build: the app icon, splash, nine new crew mascots, onboarding scenes, empty states and chat stickers
  (`art-incoming/ART.md`).
- Codex was not used.
