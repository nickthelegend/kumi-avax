# Submission: Team1 India "Build Anything on Avalanche"

**Name:** Kumi on Avalanche

**One-liner:** Your group chat is a fund, now trading perps. Pitch `/long AVAX 3x` in chat, vote with your shares,
and the crew vault opens it on an on-chain order book on Avalanche.

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
This Avalanche build reuses that UX and art. The Solidity perps venue, the vault, on-chain chat, the markets page,
the maker bot and the Primit work are new.

## Tech stack (Avalanche parts in bold)

- **Avalanche Fuji C-Chain**:
  - KumiPerps (on-chain order book perps)
  - KumiCrew vaults (EIP-1167 clones from KumiCrewFactory)
  - TestUSDC
  - on-chain chat feed
- **Chainlink price feeds on Fuji**: AVAX/USD, BTC/USD
- **Avalanche C-Chain mainnet** (simulation only): Orderly vault adapter for Primit, tested on a mainnet fork
- Solidity 0.8.28 and Foundry (unit, fuzz, and Fuji and mainnet fork tests)
- TypeScript, viem, React 19, Vite 7
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
- **Web app:** runs locally (`pnpm --filter @kumi-avax/web build && pnpm --filter @kumi-avax/web preview`). It is not
  hosted yet.

## Demo video

Not recorded yet: Nick records the ≤3 min walkthrough. The flow to film, with every tx already on Fuji, is in the
README's "The live demo" section.

## Slides

[docs/SLIDES.md](docs/SLIDES.md)

## AI tools used

- **Claude Code** (Anthropic) wrote the contracts, tests, scripts, web app and docs, and drove the live demo.
- The **Primit research** was done by a Claude Code subagent from public pages and read-only RPC calls.
- **ChatGPT images** made the clay art and 3D objects reused from Kumi's NEAR build. No new art was generated for
  this build.
- Codex was not used.
