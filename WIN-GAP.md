# Kumi on Avalanche: where it stands against the rubric (ship round)

Honest self-score after v2.2 and the ship round (Nov 12, 2026), against the Avalanche Speedrun weights. Target is 9/10.

| Criterion (weight) | v1 | v2 | v2.1 | v2.2 | Ship | Why |
|---|---|---|---|---|---|---|
| Does it work (30%) | 8 | 8.5 | 8.7 | 9 | 9.2 | Ship round: a standalone Release build for the iOS Simulator is a download on the landing (its own icon and splash, keychain wallet fixed by ad-hoc signing, checked on the simulator), and every hosted screen was re-audited at 1440 and 375 (docs/SCREEN-AUDIT.md). The faucet gap is closed: a new wallet gets its first gas from KumiGasStation and is funded and ready in one step, shown live on the **native** app in the iOS Simulator and on the hosted phone build (real drips on Fuji). Kumi AI answers on the hosted phone app, in Expo Go and on the web, from live Fuji reads. The hosted QA run had no console errors. Not higher: still no physical phone. |
| Idea and originality (25%) | 8 | 8.5 | 8.5 | 8.7 | 8.7 | The chat now has an agent that knows the book, the calls and who has been right, and drafts calls you sign, and every caller carries an on-chain track record into every chat. AI-in-chat on its own is common; tied to venue-checked copies and replayed fills it is Kumi's. |
| Technical depth (20%) | 8 | 8.5 | 9 | 9.2 | 9.2 | A gas station whose limits live on-chain (signature-gated, once per wallet, daily and per-requester caps, relayer-only), 21 Forge tests on it. A caller board that replays every KumiPerps fill first in first out and is tested equal to every venue position. A tool-using Claude agent behind a signed wallet pass and on-chain membership, every tool tested against a direct chain read. |
| Avalanche fit (15%) | 6 | 6.5 | 8 | 8.2 | 8.2 | Gas sponsorship works because C-Chain gas is cheap (a new user costs Kumi 0.0002 AVAX). eERC for private tips, Chainlink Fuji for every mark. Still no own L1 and no ICM/ICTT. |
| Demo and communication (10%) | 8 | 8.5 | 8.5 | 8.5 | 8.8 | Ship round: the landing says who it's for and what they get in one screen, with one action (Get the app), live private-vs-proven counts and the contracts on Snowtrace; new clay art and an OG card. Native screenshots of each new feature (`v2.2/ios-*.png`), hosted and web shots at 1440 and 375, README sections for each feature. The 3-minute film is still not cut. |
| **Weighted** | **7.7** | **8.2** | **8.6** | **8.8** | **8.9** | |

## What is left for 9/10, in order of value

1. **The film.** Lead with the phone: Create my wallet (funded in one step), join the AVAX pit, `/ask who is the
   best caller here?`, the Top tab, copy the #1 caller, tip them privately, then the crew vote on the web.
2. **Expo Go and a physical phone.** After `npx expo login` (Nick), `mobile/scripts/publish-expo.sh` publishes the
   update and puts its Expo Go QR on the landing; until then the slot says Setup required. No APK: skipped for disk
   (~10 GB free with another Xcode build queued); `eas.json` has an `apk` profile for EAS Build.
3. **ICTT deposits.** Bridging test USDC from an ICM-enabled testnet L1 into Fuji, then into a crew. **Not built in
   v2.2 and not claimed**: it needs a second chain's Teleporter/ICTT contracts verified and funded on both sides,
   and could not be made real in this window without risking the rest.
4. **A longer record for the board.** Win rates are scored to Chainlink now with a handful of calls per caller.
   More real calls over the next day make it mean more; a fixed horizon (24 h) would be fairer for older calls.
5. **Private positions.** eERC can't hide a KumiPerps position: the book is public. Not built; the README says so.

## Things that are real and easy to miss

- The gas station's limits are on-chain, not in the server: a second instance, a restart or a leaked relayer key
  can't pay a wallet twice, pay a funded wallet, or pass 20 drips a day. The requester cap uses an HMAC of the IP,
  so no IP is ever on chain.
- Kumi AI's key is only a Vercel env var. The app sends a signed one-hour pass; the API checks the signature and that
  the wallet is in that chat on-chain before it spends a token.
- The board's PnL for a copy is the copy's own order: its fills are found by the `orderTx` that `KumiLobby.copy`
  stored, so two copies in the same market don't blur together.

- A private-tip card can't be faked: both apps load the transaction by hash and require a successful eERC `transfer`
  from the person who posted the card, with a `PrivateTransfer` event.
- The amount is not in the calldata. The Anvil test checks the bytes; anyone can check Snowtrace.
- The receiver reads the amount from the transfer's receiver ciphertext, the sender from its own copy in the Kumi
  memo, and Kumi's auditor from eERC's auditor ciphertext. Nobody else can.
- The candles are Coinbase Exchange (or Binance) public candles, labelled with their source. Chainlink's Fuji mark is
  the dashed line. The triangles are Kumi's own fills from the venue's on-chain ring buffer.
- A "copied" message can't be faked either: `KumiLobby.copy` reverts unless the copier holds that side on KumiPerps.
- Test accounts are labelled as such in both apps and in the README.
