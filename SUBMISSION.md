# Submission: Team1 India "Build Anything on Avalanche"

**Name:** Kumi on Avalanche

**One-liner:** Your group chat is a fund, now on your phone. Join a chat, copy a friend's trade call with one tap,
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
- **Chainlink price feeds on Fuji**: AVAX/USD, BTC/USD
- **Avalanche C-Chain mainnet** (simulation only): Orderly vault adapter for Primit, tested on a mainnet fork
- Solidity 0.8.28 and Foundry (unit, fuzz, and Fuji and mainnet fork tests)
- TypeScript, viem, React 19, Vite 7
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
- **Phone app (Expo web build):** https://kumi-avax-app.vercel.app
- **Web app:** https://kumi-avax-web.vercel.app
- **Phone on a device:** `cd mobile && npm install && npx expo start`, scan with Expo Go (SDK 58)

## Demo video

Not recorded yet: Nick records the ≤3 min walkthrough. The flow to film, with every tx already on Fuji, is in the
README's "The live demo" section.

## Slides

[docs/SLIDES.md](docs/SLIDES.md)

## AI tools used

- **Claude Code** (Anthropic) wrote the contracts, tests, scripts, web app, phone app and docs, and drove the live
  demos (web and phone).
- The **Primit research** was done by a Claude Code subagent from public pages and read-only RPC calls.
- **ChatGPT images** made the clay art and 3D objects reused from Kumi's NEAR build. No new art was generated for
  this build. The phone app uses the same art.
- Codex was not used.
