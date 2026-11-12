# Kumi on Avalanche v2.1: where it stands against the rubric

Honest self-score after v2.1 (Nov 12, 2026), against the Avalanche Speedrun weights. Target was 9/10.

| Criterion (weight) | v1 | v2 | v2.1 | Why |
|---|---|---|---|---|
| Does it work (30%) | 8 | 8.5 | 8.7 | Everything is live on Fuji: the venue, four crew vaults, KumiLobby, the maker bot, seven Kumi test accounts, and now Ava Labs' eERC with 44 seed txs. The **native** app signed real Fuji txs in Expo Go on the iOS Simulator, including all three eERC proofs made on the device (`iosPrivate`). The phone web build and the web app ran the private flow end to end too (`phonePrivate`, `webPrivate`). Not 9: still no physical phone, and a new wallet needs Fuji AVAX from a captcha faucet. |
| Idea and originality (25%) | 8 | 8.5 | 8.5 | A group chat that is a fund, public chats with venue-checked copies, and now private tips for callers and private settle-ups. The privacy is real but narrow: it covers payments around copy trading, not the trades. |
| Technical depth (20%) | 8 | 8.5 | 9 | On-chain order book perps, the vote-to-trade vault, the chat contract, and eERC wired in honestly: wallet-signature keys, Groth16 proofs on the phone through a hidden WebView (Hermes has no WebAssembly), chat cards checked against the chain, a memo that lets the sender read its own amount back, and a 40-check Anvil test with real proofs that refuses stolen, cross-chain, forged, replayed and tampered proofs. |
| Avalanche fit (15%) | 6 | 6.5 | 8 | Fast, cheap C-Chain blocks are why on-chain chat and an on-chain book work (gas was 160 wei). Chainlink Fuji feeds mark everything. **eERC (a named bonus) is used for a real job**, unmodified, with the auditor set on-chain. Still no own L1 and no ICM/ICTT. |
| Demo and communication (10%) | 8 | 8.5 | 8.5 | Phone screens from the iOS Simulator (`ios-*.png`) and the web build, web at 1440 and 375, new art in both apps, and a README table of what eERC hides and what it doesn't. The 3-minute film is not cut yet. |
| **Weighted** | **7.7** | **8.2** | **8.6** | |

## What is left for 9/10, in order of value

1. **The film.** Lead with the phone: copy a call, tip the caller privately, show the Snowtrace page with no amount on
   it, then show the receiver's phone with the amount. Then the crew vote on the web.
2. **A physical phone.** Nick can run it in Expo Go on his phone in a minute (`cd mobile && npx expo start`). An APK
   needs an EAS account or ~8 GB of free disk for a local Gradle build.
3. **Gas onboarding.** A new wallet needs a little Fuji AVAX. A relayer, or a fee-sponsored Avalanche L1, would
   remove the faucet step.
4. **ICTT deposits.** Bridging test USDC from an ICM-enabled testnet L1 into Fuji, then into a crew. Not built; not
   claimed.
5. **Private positions.** eERC can't hide a KumiPerps position: the book is public. Hiding a captain's size from
   copy bots would need a different venue design (for example a private crew account that only settles net PnL). Not
   built; the README says so.

## Things that are real and easy to miss

- A private-tip card can't be faked: both apps load the transaction by hash and require a successful eERC `transfer`
  from the person who posted the card, with a `PrivateTransfer` event.
- The amount is not in the calldata. The Anvil test checks the bytes; anyone can check Snowtrace.
- The receiver reads the amount from the transfer's receiver ciphertext, the sender from its own copy in the Kumi
  memo, and Kumi's auditor from eERC's auditor ciphertext. Nobody else can.
- The candles are Coinbase Exchange (or Binance) public candles, labelled with their source. Chainlink's Fuji mark is
  the dashed line. The triangles are Kumi's own fills from the venue's on-chain ring buffer.
- A "copied" message can't be faked either: `KumiLobby.copy` reverts unless the copier holds that side on KumiPerps.
- Test accounts are labelled as such in both apps and in the README.
