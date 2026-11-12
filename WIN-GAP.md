# Kumi on Avalanche v2: where it stands against the rubric

Honest self-score after v2 (Nov 12, 2026), against the Avalanche Speedrun weights. Target was 9/10.

| Criterion (weight) | v1 | v2 | Why |
|---|---|---|---|
| Does it work (30%) | 8 | 8.5 | Everything is live on Fuji: the venue, four crew vaults, the new KumiLobby, a maker bot, and seven Kumi test accounts with real chats, votes, calls and copies. The phone app ran end to end on Fuji (new wallet, faucet, join, copy a call, chat, a limit order), and every tx it signed is in `deployments/fuji.json` under `phoneDemo`. Not 9: the phone flow was driven through the Expo **web** build in headless Chrome, not on a physical phone, and new users still need Fuji AVAX for gas from a faucet with a captcha. |
| Idea and originality (25%) | 8 | 8.5 | A group chat that is a fund, now with public chats where a trade call is a card anyone can copy with their own order, and the copy is checked on-chain against the copier's venue position. |
| Technical depth (20%) | 8 | 8.5 | Fully on-chain order book perps (matching, funding, liquidation), the vote-to-trade vault, and now a chat contract whose "copied" claims are verified against KumiPerps. One SDK (orders, candles, chat client) shared by the web and the phone, tested against live Fuji reads. |
| Avalanche fit (15%) | 6 | 6.5 | Fast, almost free C-Chain blocks are why on-chain chat and an on-chain book work at all (gas was 160 wei). Chainlink Fuji feeds mark everything. **No bonus features yet**: no own L1, no ICM/ICTT, no eERC. |
| Demo and communication (10%) | 8 | 8.5 | A phone app in the approved Kumi look, plus the web; screenshots of every phone screen and web route. The 3-minute film is not cut yet. |
| **Weighted** | **7.7** | **8.2** | |

## What is left for 9/10, in order of value

1. **eERC private copy-trading (Avalanche fit +2 to +3 on that row).** Ava Labs' encrypted ERC would let a captain's
   position size stay private while followers mirror it. Not built: it needs the eERC registrar, the zk circuits
   and the converter flow wired into KumiCrew, and there was no time to do it honestly before the deadline. Nothing
   in the app or README claims it.
2. **ICTT deposits.** Bridging test USDC from an ICM-enabled testnet L1 into Fuji through ICTT is a real, scoped
   feature (deposit on L1, mint on C-Chain, chip in). Not built; not claimed.
3. **A real phone run.** The Expo app has not been run on a physical phone or in the iOS Simulator with Expo Go in
   this session (see README "Phone app"). Nick can run it in Expo Go in a minute; an APK build needs an EAS account
   or ~8 GB free disk for a local Gradle build.
4. **Gas onboarding.** A brand-new phone wallet needs a little Fuji AVAX. A gas relayer (or Avalanche's own
   fee-sponsored L1) would remove the faucet step.
5. **The film.** Lead with the phone: join a chat, copy a call, watch the fill land on the book and the candle
   marker appear, then the crew vote on the web.

## Things that are real and easy to miss

- The candles are Coinbase Exchange (or Binance as a fallback) public candles, labelled with their source on the
  chart. Chainlink's Fuji mark is the dashed line. The triangles are Kumi's own KumiPerps fills, from the venue's
  on-chain trade ring buffer. Nothing is generated.
- A "copied" message in a public chat can't be faked: `KumiLobby.copy` reverts unless the copier holds that side of
  that market on KumiPerps right now, and the size and entry it writes come from the venue.
- Test accounts are labelled as such in the app ("test acct") and in the README.
