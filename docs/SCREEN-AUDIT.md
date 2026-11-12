# Screen audit (ship round, Nov 12 2026)

Every hosted screen at 1440 and 375, the phone build (Expo web export, 375) and the native standalone app on the iOS
Simulator (iPhone 17 Pro). Scores are out of 10, before and after this round's fixes. The approved Kumi look was
kept: fixes are copy, layout, states and bugs, and new parts reuse the existing cards, colours, fonts and clay art.

Screenshots: `grokbot/orchestration/shots/avax-kumi/ship/before/`, `.../ship/after/` (hosted, read-only script
`scripts/qa/ship-shots.mjs`) and `.../ship/native/` (the standalone Release build on the simulator).
Every hosted screen in the after run: no sideways overflow and no console errors.

## Web (kumi-avax-web.vercel.app)

| Screen | Before | What was wrong | Fix | After |
|---|---|---|---|---|
| Landing `/` | 7 | Said nothing about the phone app or how to get it; "Why Avalanche" icons overlapped their text at 1440; a section lead about the NEAR version; relative `og:image`; generic favicon | Repositioned: who it's for in the kicker, one headline, one sub-line, one primary action (Get the app), why Avalanche in one line; How it works (3 steps, live data); Private vs Proven with live counts from Fuji; Get the app (iOS Simulator download with size, install line and SHA-256, Expo Go slot, browser builds); Check it yourself (contracts on Snowtrace, newest fills walked back up to 24 h). New clay art, OG card, app-icon favicon | 9 |
| Crew room `/room` | 8.5 | "each step is a Fuji transaction" filler in the checklist; every private-send card repeated a long explainer | Checklist says "0 of 5 done"; private cards say "Amount hidden on-chain." | 9 |
| Public chat `/room?chat=l-0` | 9 | – | – | 9 |
| Markets `/markets/AVAX`, `/markets/BTC` | 8.5 | The Chainlink price tag sat on top of a grid label (8.400 under 8.362); fill markers on the first candle were cut by the chart edge; legend said "0 fills" while loading | Grid labels the tag would cover are hidden; markers clamped inside the plot; the count waits for data | 9 |
| Crew fund `/crew/<vault>` | 8 (375) | At 375 the pitch table squeezed the trade into four lines and cut the result chip; "1 trades voted" | # and By columns hide under 560 px and cells stay on one line; "1 trade" | 9 |
| 404 | 6 | A bare card | Offline penguin art, the path, and Back to Kumi | 9 |

## Phone app (kumi-avax-app.vercel.app at 375, and the native build)

| Screen | Before | What was wrong | Fix | After |
|---|---|---|---|---|
| Onboarding (signed out) | 8.5 | Long sub-line and key note | "Chat with your crew, call a trade, copy it with one tap. It fills on Avalanche." / "Only this phone holds the key." | 9 |
| Onboarding, gas-free start (mid-transaction, done, capped) | 9 | – (the per-network cap shows a clear notice and Try again) | – | 9 |
| Chats (empty, loading, list) | 8 | "Every message, call and vote is a Fuji transaction signed on this phone." under the title; long empty-state copy | Line removed; "Join a public chat below and copy calls with one tap." | 9 |
| Market | 8.5 | Same chart label and edge issues as the web | Same fixes in the native chart | 9 |
| Top callers | 9 | – | – | 9 |
| Wallet (no gas, funded) | 8.5 | Three long notes (web preview key storage, faucet internals, eERC mechanics) | Each cut to one short line | 9 |
| Chat (public, crew, read-only and joined) | 9 | – | – | 9 |
| Join `/join/<chat>` | 9 | – | – | 9 |
| Invite `/invite` with no chat | 5 | Blank "Invite to" title and a QR for `kumi://join/` that opens nothing | Empty state: "Pick a chat to share" with Go to chats | 9 |
| Backup | 9 | – | – | 9 |
| Native standalone app (first launch) | 4 | Unsigned simulator build: Create my wallet failed with "A required entitlement isn't present" (keychain) | Ad-hoc signed Release build (`mobile/scripts/build-ios-sim.sh`); wallet creation, the gas notice, tabs and chats all checked on the simulator | 9 |

## Below 9 after this round, and why

- **Expo Go row on the landing** shows "Setup required" until Nick logs in to Expo and runs
  `mobile/scripts/publish-expo.sh`; a QR is never faked.
- **Gas cap notice** names "the Fuji faucet" without a link on the onboarding screen (the Wallet tab has the faucet
  button). 8.5; left as is to keep the onboarding card short.
