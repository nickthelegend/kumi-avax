# Kumi on Avalanche: your group chat is a fund

**Get the app.** Kumi is a phone app for friends who trade together: pitch a trade in the chat, the crew votes, and
the crew fund trades it on an order book on Avalanche. Leave anytime with your exact share.

| Get Kumi | How |
|---|---|
| **iOS Simulator** (standalone build, its own icon and splash) | [Kumi-iOS-Simulator.zip](https://kumi-avax-web.vercel.app/download/Kumi-iOS-Simulator.zip) (22.3 MB, SHA-256 `5158d1e3b25dbcaa174a93a0def462b78306216ed9fe93db3813a0e30f213377`). Unzip, open a simulator, then `xcrun simctl install booted Kumi.app && xcrun simctl launch booted xyz.kumi.avax`. Release build for Apple-silicon Macs. |
| **Expo Go** | Setup required: the Expo account login is Nick's step; then `mobile/scripts/publish-expo.sh` publishes and puts the QR on the landing. Until then: `cd mobile && npm install && npx expo start`. |
| **In the browser** | Phone build: https://kumi-avax-app.vercel.app · Web app: https://kumi-avax-web.vercel.app |


Friends pitch a trade in the crew chat: `/long AVAX 3x 20%`. Members vote with their shares. When yes passes the
threshold, the crew's vault opens the position on an **on-chain order book perps market on Avalanche Fuji**. PnL
updates live in the room, marked to Chainlink. Any member can **ragequit with their exact share**, even while a
position is open.

**New in v2: Kumi is a phone app.** The Expo app (`mobile/`) has its own Fuji wallet on the phone, crew group
chats and public chats you can join, trade calls you copy with one tap (your own order on the on-chain book, signed
on the phone), a live order book, real price candles and a trade ticket. The web app shows the same chats, because
every message is on Fuji: a message sent from the phone is on the web a few seconds later.

**New in v2.1: private tips and settle-ups, on Ava Labs' eERC.** A copier can tip the caller for a good call, and
crewmates can pay each other back, without the amount ever appearing on Fuji. It runs on Ava Labs' official
EncryptedERC (unmodified), with the zk proofs made on the phone itself (iOS, Android and web) and in the browser.
The chat shows a card that anyone can check on Snowtrace; only the sender, the receiver and Kumi's auditor key can
read the number. [What is hidden and what is not](#private-tips-and-settle-ups-eerc-v21).

**New in v2.2: no faucet, an AI in the chat, and a caller board.** A new phone wallet gets its first gas from
Kumi's own on-chain gas station (KumiGasStation, with its limits on Fuji), so "Create my wallet" ends funded and
ready. Type `/ask` (or tap ✨) in any chat and **Kumi AI**, a Claude agent, answers from live Fuji data and shows
which tools it read; it can draft a call that you review and sign yourself. The **Top** tab ranks callers from
on-chain data only, and their rank shows next to their name in every chat. [How each one works](#v22-gas-free-start-kumi-ai-top-callers).

| Live | Link |
|---|---|
| Phone app (Expo web build, open at phone width) | https://kumi-avax-app.vercel.app |
| Web app | https://kumi-avax-web.vercel.app |
| A public chat on the web | https://kumi-avax-web.vercel.app/room?chat=l-0 |
| Markets with candles and the book | https://kumi-avax-web.vercel.app/markets/AVAX |
| Kumi API (gas sponsor, Kumi AI; v2.2) | https://kumi-avax-api.vercel.app/api/health |

> **Prior work, disclosed.** Kumi was first built for NEAR (`grokbot/projects/kumi`): crew rooms, `/buy SOL 10%`
> chat commands, Sputnik DAO votes, captain limits, ragequit, and the coral and plum clay art with its mascots and
> 3D objects. This repo reuses that UX, the stylesheet (`web/src/styles.css`, unchanged) and the art in
> `web/public/art`. Everything else is new for Avalanche: the Solidity order book perps venue (`KumiPerps`), the
> crew vault that trades perps by vote (`KumiCrew`), on-chain chat, the markets page, the maker bot, the Primit
> research and adapter, and this web app's perps screens.
>
> **Art v2.1** (app icon, splash, nine new crew mascots, onboarding scenes, empty states and chat stickers) was
> generated with ChatGPT in the Kumi clay style; see `art-incoming/ART.md`. The lilac koala was off-palette and is
> not used.
>
> **The eERC crypto core in `sdk/src/eerc.ts`** (ElGamal, Poseidon ciphertexts, proof inputs) is the same code
> written for Juno on Avalanche (`grokbot/avax/juno-avax`), against the same pinned Ava Labs circuits.
>
> **The phone app reuses Nakama's mobile skeleton** (`grokbot/projects/nakama/packages/mobile`, Nick's earlier Sui
> crew wallet): Expo Router navigation, the on-device wallet in expo-secure-store, deposit QR, QR/photo/paste join,
> notifications and the font mapping. The Sui layer was replaced with viem on Avalanche Fuji, and every screen was
> redrawn in Kumi's approved look (cream, plum and coral, Baloo 2 / Urbanist / Space Mono, the Kumi clay mascots and
> 3D objects). KumiLobby, the chat client, candles and order encoding are new in v2.

## Live on Fuji (chainId 43113)

| Contract | Address | Deploy tx |
|---|---|---|
| KumiPerps (order book venue) | [`0x6a6c0d74862edb85f2f0534381857347d5ae09a3`](https://testnet.snowtrace.io/address/0x6a6c0d74862edb85f2f0534381857347d5ae09a3) | [0x69140d86…](https://testnet.snowtrace.io/tx/0x69140d86347ea5e44e9916a1ffbef9b87b3013e9f62a46c043ebe9c44fae0c17) |
| KumiCrewFactory | [`0x7be7c269acf2e0d0b7074e9a0bdc7dfb730b778c`](https://testnet.snowtrace.io/address/0x7be7c269acf2e0d0b7074e9a0bdc7dfb730b778c) | [0x5177a484…](https://testnet.snowtrace.io/tx/0x5177a48405f2a8519d505a2cb632fb779b80d7ae7cd1d27e6a31ce23c6f11a13) |
| KumiCrew implementation | [`0x39d12adf89cb16756a4d5e775efbc0e97f68a2ef`](https://testnet.snowtrace.io/address/0x39d12adf89cb16756a4d5e775efbc0e97f68a2ef) | [0xaf19b760…](https://testnet.snowtrace.io/tx/0xaf19b7602ffae6db231e84bce357048f05c2deab346f3864f441190486ed3b74) |
| Night Owls crew vault (clone) | [`0x1c11A95bfBfaA989afC1222d614A8FbD24f75677`](https://testnet.snowtrace.io/address/0x1c11A95bfBfaA989afC1222d614A8FbD24f75677) | [0x82cf5d3c…](https://testnet.snowtrace.io/tx/0x82cf5d3c08bf69f366c89d7c0ff14510364c9f7de70760de6a78871f18f628f1) |
| KumiLobby (public chats, calls, checked copies) | [`0x86c916ab60f186a43ab6b31603d91641dc228e7a`](https://testnet.snowtrace.io/address/0x86c916ab60f186a43ab6b31603d91641dc228e7a) | [0x9ffb5d5e…](https://testnet.snowtrace.io/tx/0x9ffb5d5eef13a6076f326566fc504c0c840c8a19024b414d152c6f22567fc238) |
| Sunrise Scalpers crew vault (v2) | [`0x16E639793291E35dB63fC411fFe97dA76F35eb2b`](https://testnet.snowtrace.io/address/0x16E639793291E35dB63fC411fFe97dA76F35eb2b) | [0x0dccbb2f…](https://testnet.snowtrace.io/tx/0x0dccbb2f0c5aff156a504cd73a6638eeb4cff71b7c6ba8dd4f29aba7ff7eabb6) |
| Slow BTC Club crew vault (v2) | [`0x4d598Fe9Dfb41Aa95F2F320f11A95d93ACb26c22`](https://testnet.snowtrace.io/address/0x4d598Fe9Dfb41Aa95F2F320f11A95d93ACb26c22) | [0x731a7621…](https://testnet.snowtrace.io/tx/0x731a76216eddb0d8e672a8e6d21d53199de22307c55065b2e53712ff91d4d334) |
| Frog Pond crew vault (v2) | [`0x84949AEab9a9BfC2e05d5bB43583d00805598Bb7`](https://testnet.snowtrace.io/address/0x84949AEab9a9BfC2e05d5bB43583d00805598Bb7) | [0x010bf165…](https://testnet.snowtrace.io/tx/0x010bf16578d824ebef0a58908ac0276d3bf53a34f196bd9a5b6401d92f799986) |
| **EncryptedERC** (Ava Labs eERC, converter over tUSDC, 2 dp; v2.1) | [`0xf8d4eeb6a0a5aff971c16f2baf9f0aee0fdb4c23`](https://testnet.snowtrace.io/address/0xf8d4eeb6a0a5aff971c16f2baf9f0aee0fdb4c23) | [0xba88c3ae…](https://testnet.snowtrace.io/tx/0xba88c3aecdcd42ff65c92ae7d986d7b774f122904ee7acc53ee3ec311709fae9) |
| eERC Registrar (users' public keys) | [`0x4de185b2d8ee6a73d78e90c3e024f230799b561c`](https://testnet.snowtrace.io/address/0x4de185b2d8ee6a73d78e90c3e024f230799b561c) | [0x64c3a457…](https://testnet.snowtrace.io/tx/0x64c3a457995a044e49bf4cd5070d766251ee034cf17cb75b33816bfa09f091cd) |
| eERC production verifiers: registration / transfer / withdraw | [`0xd94a10ff9bf7b863835b816485e878cc2b8bb1aa`](https://testnet.snowtrace.io/address/0xd94a10ff9bf7b863835b816485e878cc2b8bb1aa) / [`0xec3713a47f62d60f7f5f1f614cb30df9c6b5cfe7`](https://testnet.snowtrace.io/address/0xec3713a47f62d60f7f5f1f614cb30df9c6b5cfe7) / [`0xb1398d2a09c78f686018dbe8818b32155f7eea02`](https://testnet.snowtrace.io/address/0xb1398d2a09c78f686018dbe8818b32155f7eea02) | [0x0694f283…](https://testnet.snowtrace.io/tx/0x0694f283f8eb9ed025aaf23292874f788da852fe37079ff4a49f80b61c269c23) · [0x6e2264cc…](https://testnet.snowtrace.io/tx/0x6e2264ccb304fdb84c352117a15206eb315ef4c14c3f0c73b4f8d1e198cbfb09) · [0x7526dc0f…](https://testnet.snowtrace.io/tx/0x7526dc0f15610f6573bb88c83f82f7f3178b4c0fa82293f4878d140a7d20d191) |
| Kumi auditor (a Kumi test account), set by the owner | [`0xB5fa31C707E9eC71edE4DE060386B0Be54AB99f3`](https://testnet.snowtrace.io/address/0xB5fa31C707E9eC71edE4DE060386B0Be54AB99f3) | [0x4975b463…](https://testnet.snowtrace.io/tx/0x4975b463c9ca8606e75cbac2b7800c62a26ff67dff95a917c2946c1b8b8aca43) |
| TestUSDC (tUSDC, 6 dp, faucet) | [`0xd3fb99ea91a049f9dfde5f9ea17ea1355a1799bd`](https://testnet.snowtrace.io/address/0xd3fb99ea91a049f9dfde5f9ea17ea1355a1799bd) | [0x2c641336…](https://testnet.snowtrace.io/tx/0x2c641336d5e16c0a44bbbc2b532c62d8a6599f043cf14835e3a09718a14a54bc) |
| **KumiGasStation** (first gas for new wallets, limits on-chain; v2.2) | [`0xf47d3dbcb7180f6c95680e120df34a50097af44d`](https://testnet.snowtrace.io/address/0xf47d3dbcb7180f6c95680e120df34a50097af44d) | [0x7a3d4f98…](https://testnet.snowtrace.io/tx/0x7a3d4f9827d684fc5b75cbe02ea55a55e13966e60a7d9ebb536a90c3cd321c7e) |
| Kumi gas relayer (a Kumi account; its key is only on the API) | [`0x45Ad72e3C2083050d2D3B562eE2d7971fF4667C2`](https://testnet.snowtrace.io/address/0x45Ad72e3C2083050d2D3B562eE2d7971fF4667C2) | [funded 0x798ba67a…](https://testnet.snowtrace.io/tx/0x798ba67a996b5963f0e057e3841b346f49d9a640628a85c2a73e9773e8f9cd4e) |

Markets were listed in [AVAX-USD](https://testnet.snowtrace.io/tx/0xd6be4f137a7d0252127fb440e1ba6a6ac9c35a1d94ab7775da93d008e96bafd5) and
[BTC-USD](https://testnet.snowtrace.io/tx/0x8c87a9dc0180642bb7074804697e14ed9f740376883ae5430ec2f830611223ca), and the insurance fund was
seeded with 5,000 tUSDC in [this tx](https://testnet.snowtrace.io/tx/0x1e429a9158fe9767b1792a5f3d288af5bedf96bea9493a7ad187102ad308f264).

**A first crew implementation was replaced before anyone deposited.** It lacked the deciding-vote gas floor
described below; it is recorded under `superseded` in the deployment file.

Price feeds are Chainlink's own Fuji feeds, with addresses taken from Chainlink's feed directory:

| Feed | Address | Heartbeat |
|---|---|---|
| AVAX/USD | [`0x5498BB86BC934c8D34FDA08E81D444153d0D06aD`](https://testnet.snowtrace.io/address/0x5498BB86BC934c8D34FDA08E81D444153d0D06aD) | 10 min |
| BTC/USD | [`0x31CF013A08c6Ac228C94551d535d5BAfE19c602a`](https://testnet.snowtrace.io/address/0x31CF013A08c6Ac228C94551d535d5BAfE19c602a) | 24 h |

**Source-verified on Snowtrace (Routescan), Nov 13:** KumiPerps, KumiLobby, the KumiCrew implementation, KumiCrewFactory,
KumiGasStation and TestUSDC (`forge verify-contract` against the Routescan Fuji API, solc 0.8.28, via-ir, 200 runs). Their
events (`Voted`, `Executed`, `Filled`, `Dripped`…) decode on Snowtrace instead of showing as hex; Ava Labs' eERC
`PrivateTransfer` decodes too.

Both feeds also update on a 1% move. Every deployment and seeding tx, every maker quote, and every demo step is
recorded with its hash, block and gas in [`deployments/fuji.json`](deployments/fuji.json).

## The live demo

This demo ran through the web app on Fuji, Nov 12 2026, with three test members signing through the QA signer
(`scripts/qa/demo.mjs`). The screenshots for each step are in [`docs/screenshots/`](docs/screenshots).

| Step | What happened | Tx |
|---|---|---|
| 1 | mika, bo and ren chip in 400 / 350 / 250 tUSDC (approve, then deposit, from the chip-in sheet) | [mika](https://testnet.snowtrace.io/tx/0x9949011f71093cb4ac2f61dafe84a91f7e6558d263460e1e80935708151fbd0a), [bo](https://testnet.snowtrace.io/tx/0x7e83a97e7b71c0b27577a04681497784e471f66e766e9de00a2374c90ff58c5c), [ren](https://testnet.snowtrace.io/tx/0x14d9ef8ae8a5696310a322a35e49b1b62a7f5552d72f7770dc92616a90d81613) |
| 2 | mika chats, then types `/long AVAX 3x`. That is 20% of the fund by default, and her 40% counts as yes | [chat](https://testnet.snowtrace.io/tx/0x1a57cc0c615d8ff779250b5c5bcd7bda8d7fa5f3d38a1076384efbf854d8d74e), [pitch](https://testnet.snowtrace.io/tx/0x193bfc6f0ad05e3d4e8b2428a45d1657c335faa06e5ff4a12b035ab2876d5526) |
| 3 | bo votes yes (75%), and the vault buys **69.41 AVAX at $8.698** on the book in the same tx | [vote + open](https://testnet.snowtrace.io/tx/0xd0bb3fc4e25a5c44656baf564ee72eeb4f456f9008b941c9283b0630767a2c84) |
| 4 | The maker leans its AVAX quotes +1.2%. These are its own real orders: it cancels, then re-quotes | [cancel](https://testnet.snowtrace.io/tx/0xc9f41128ad77a08335559d113e9aabe576d46bfeeb99271ec6a561779adff1ed), [new best ask](https://testnet.snowtrace.io/tx/0x401724afae3b767bef5fd1b8efef2ddfcbf638713841f071f71307bc8df2ae65) |
| 5 | ren pitches `/close AVAX`. mika votes yes (65%), and the vault sells 69.41 AVAX at $8.742: **+3.05 tUSDC realised** | [pitch](https://testnet.snowtrace.io/tx/0x63db0e9b6e5b510fc0a80be004b9bc446b38172015b73d39be72591e9840917a), [vote + close](https://testnet.snowtrace.io/tx/0x80f1f7c0e878e0a0c536c5623be06dac391e66653ad394317eb506e8832ec821) |
| 6 | ren ragequits with everything: **250.76 tUSDC** for 250 shares | [ragequit](https://testnet.snowtrace.io/tx/0xd442eb5f5052a920e8fd899b9e906926071aeb51e42ad9cde9358915c963e7dc) |
| 7 (bonus) | mika (now 53%) pitches `/short BTC 2x 10%`. It passes on her own vote and opens 0.00204 BTC short at $73,631 | [pitch + open](https://testnet.snowtrace.io/tx/0xa31c64bca530feed749e1861104da7743cbc9b64f888702e9b90a3f188e03c39) |
| 8 (bonus) | bo ragequits **while the BTC short is open**. The vault buys back his slice (0.00054 BTC) and pays him 200.57 tUSDC | [ragequit](https://testnet.snowtrace.io/tx/0x38e9477e9cc10f5a825421432b3f892ec50d1ecc19c1a733717365a9b9a168c1) |

**How the price moved, plainly.** During the demo, Chainlink's AVAX price fell from about $8.69 to $8.64, so marked
at Chainlink the long was slightly down. The +3.05 tUSDC came from the maker bot leaning its bids up 1.2%, which is
the "move the price via the maker" option. The close sold into those real bids. The room shows both numbers: PnL at
Chainlink, and "Close now" at the book.

**The mid-position ragequit was fair on-chain.** The crew's share price was 1.0029402 tUSDC in the block before
bo's exit (752.205160 NAV / 750 shares) and 1.0029402 in the block of it (551.617117 / 550). bo paid the 2-cent spread
of closing his slice.

**A UI bug the demo caught.** bo meant to leave with 50% of his shares, but burned 200 of his 350. Right after the QA
signer switched from mika to bo, the ragequit sheet was still showing mika's share count. The contract did exactly
what was signed. The room now refuses to show or act on a stake until it has re-read the new signer
(`meFresh` in `Room.tsx`).

There are 108 recorded Fuji txs in all: 22 setup, 71 maker quotes and 15 demo steps. Gas is almost free on Fuji
(160 wei while we built). The five test accounts were funded with 0.02 AVAX in total, and all of the txs together
burned under 0.00001 AVAX of it.

## The phone app on Fuji (v2)

The app ran end to end on Fuji through its Expo web build at 375 px (headless Chrome, `scripts/qa/phone.mjs`). It
made a **new wallet inside the app**; the only step outside the app was 0.0002 AVAX of gas from Kumi's maker test
account, because the public Fuji faucet needs a captcha. Everything below was signed by the app's own key:

| Step | Tx |
|---|---|
| Test USDC from the faucet (`TestUSDC.faucet`) | [0x37da94ae…](https://testnet.snowtrace.io/tx/0x37da94aef2e448f9140e0d6de925e7997529f4bf27b62b9a9467b57cd429648f) |
| Join the AVAX pit (`KumiLobby.join`) | [0x3fe2f6c9…](https://testnet.snowtrace.io/tx/0x3fe2f6c9d91ae122d5bba11ddec184d42e07a1f55ca497f4ba819263632d77ec) |
| Copy mika's "Long AVAX 3x, 50 tUSDC": approve | [0x4b8e95d6…](https://testnet.snowtrace.io/tx/0x4b8e95d6b537dc2bc071604e88532272702b9323c691a2711911ccdf3e677b91) |
| deposit 50 tUSDC margin into KumiPerps | [0x27454690…](https://testnet.snowtrace.io/tx/0x2745469001d233a5c691c30d6f81508d3f7b91eb11872a49483c55b7ab3ca9d8) |
| IOC buy: **17.79 AVAX at $8.430** on the on-chain book | [0x1d351d7e…](https://testnet.snowtrace.io/tx/0x1d351d7ee13d874a04d958869bd338c838dfb4a62fd930e2ec86295077c6f8fb) |
| `KumiLobby.copy`: the lobby read the position from KumiPerps and posted it | [0x7b80d5b2…](https://testnet.snowtrace.io/tx/0x7b80d5b2a0377e88788f0c0badfde041c3a00bb0ba254ce6b19be074aeab0ecd) |
| A chat message | [0x439124cf…](https://testnet.snowtrace.io/tx/0x439124cf3c2826f94c37f025e4844fdfbe7329356ea129ae0b465d47a8813d31) |
| Second run, another new wallet: the same flow, plus a **BTC limit buy at $72,200** that rests on the book as the phone's open order | [0x5201918c…](https://testnet.snowtrace.io/tx/0x5201918c9f065c86bf0588d5654b59ff42665da6496f5b401db862f21eb87932) |

The same run, and any later run, is recorded in `deployments/fuji.json` (`phoneDemo`, `phoneRuns`). Screenshots of
every phone screen: `orchestration/shots/avax-kumi/v2/phone-*.png` (web build) and `ios-*.png` (the native app in
Expo Go on the iOS Simulator).

**What the phone app does**

| Tab / screen | What is real |
|---|---|
| Onboarding | Creates (or imports) a Fuji key on the phone, in the iOS Keychain / Android Keystore via expo-secure-store, then (v2.2) gets its first gas from KumiGasStation and 1,000 tUSDC, both shown with Snowtrace links. Backup screen reveals the key only after a tap. The web preview keeps it in the browser's storage and says so. |
| Chats | Your crews and joined public chats with the last message and unread badges; the public lobby with one-tap **Join** (`KumiLobby.join`); crews you are not in, read-only. Join by QR (camera or a photo) or by pasting `kumi://join/...`. |
| Chat room | Crew rooms read the vault's on-chain feed (chat, pitches with live share-weighted vote bars, fills, chip-ins, ragequits); members vote and pitch `/long AVAX 3x 20%` from the phone. Public chats show call cards; **Copy** deposits margin, sends an IOC order to KumiPerps and records the copy, which the contract checks against the venue. |
| Market | The on-chain book (cumulative depth bars, spread, Chainlink in the middle, last-fill pulse, levels flash on change); candles 1m / 5m / 15m / 1h; a ticket (market or limit, margin, leverage) that signs and sends `placeOrder`; your position with PnL and liquidation price; open orders with cancel. |
| Top (v2.2) | The caller board from Fuji: all chats or one, a #1 card, win rate, average move, copies and copiers' PnL; tap a caller for their calls. Caller badges show in every chat. |
| Kumi AI (v2.2) | ✨ or `/ask` in any chat: answers from live Fuji reads with the tools it used shown, and drafts calls you sign yourself. |
| Wallet | AVAX, tUSDC and venue margin; deposit QR; **Get 1,000 test USDC**; **Get gas from Kumi** when the wallet has no AVAX (v2.2); the Fuji faucet link; positions; crew vault shares; every tx this phone signed, with Snowtrace links. |

**Candles are real data only.** Coinbase Exchange public candles for AVAX-USD / BTC-USD (Binance as a fallback),
labelled with their source on the chart; Chainlink's Fuji price as the dashed line; Kumi's own KumiPerps fills as
triangles on the candle they landed in. Same code (`sdk/src/candles.ts`) on the phone and the web.

**Kumi test accounts.** mika, bo and ren (v1) and jun, sora, tae and lia (v2) are Kumi's own test wallets, seeded by
`scripts/fuji/seed-v2.ts` (keys in the gitignored `.env`). They chat, call, copy and vote for real on Fuji, and the
app tags them "test acct". The v2 seed is 91 recorded txs under `seedV2`.

**Run it on a phone.** `cd mobile && npm install && npx expo start`, then scan the QR with Expo Go (SDK 58). It talks
to Fuji directly; there is no Kumi server. A new wallet needs a little Fuji AVAX for gas (Wallet tab, faucet link).

## Private tips and settle-ups (eERC, v2.1)

Copy trading leaks money. When followers pay a caller a cut, anyone reading the chain can add it up: how much a
caller earns, and from that, how big their following trades. Settling up inside a crew has the same problem. Kumi
v2.1 moves those payments into **Ava Labs' EncryptedERC** (`contracts/lib/EncryptedERC`, pinned at `8dc98cd`,
unmodified, built by its own Foundry profile) in converter mode over Kumi's tUSDC.

**In the app:** the Wallet tab has a *Private balance* (open it, move tUSDC in, move it out). A call you copied
gets a *Tip privately* button. A crew room has a 🔒 button to send a crewmate tUSDC privately. Each send posts a card
in the chat (`kumi:private:<tx>`), and both apps check that card against Fuji: it must be a successful eERC
`transfer` from the person who posted it. The receiver's app decrypts the amount from the transfer, the sender's
app decrypts its own copy from the Kumi memo, and everyone else sees "amount hidden".

| On Fuji, for anyone to see | Hidden (ciphertext only) |
|---|---|
| Who opened a private balance (eERC registration) | Each member's private balance (ElGamal on BabyJubJub) |
| How much tUSDC moved **in** or **out**, and by whom (it is an ERC-20 transfer) | **How much each tip or settle-up was** |
| That A sent B something through Kumi's eERC, and which chat and call the card belongs to (the Kumi memo) | |
| The eERC's total tUSDC | |
| Everything on KumiPerps: positions, orders, fills, and the crew vaults' shares and NAV | |

So this is private **payments around** copy trading, not private positions. KumiPerps is a public order book, and
a copy is still recorded on KumiLobby with the venue's size. Kumi's auditor key (a Kumi test account set with
`setAuditorPublicKey`) can read every transfer amount, as eERC requires.

**How it works.** A member's eERC key is derived from one wallet signature over a fixed message (`keyMessage` in
`sdk/src/eerc.ts`), so it is never stored. Proofs are Groth16 with Ava Labs' production circuits and zkeys (note the
upstream names: registration and withdraw ship `circuit_final.zkey`, transfer ships `transfer.zkey`), copied into
`web/public/eerc` and `mobile/public/eerc` by `scripts/copy-eerc-assets.mjs`. On the web and the Expo web build,
snarkjs runs in the page. On iOS and Android, React Native's Hermes has no WebAssembly, so a hidden WebView on the
phone runs the same snarkjs build (`mobile/lib/prover.tsx`); it downloads the public circuit files from the hosted
app once, and the witness and proof never leave the phone. Proof times: registration ~4 s, transfer ~10 s with
both txs, withdraw ~5 s (Expo web build, headless Chrome).

**Evidence on Fuji** (all in `deployments/fuji.json`):

- Seed (`eerc`): seven Kumi test accounts open private balances and move tUSDC in; sora and ren tip mika for her
  AVAX call [#7](https://testnet.snowtrace.io/tx/0x81b6aacd61f188ed6561c50fe5eda4ba2d7fe02f11aec449a8583e611bdfb831), bo tips lia for her BTC call
  [#5](https://testnet.snowtrace.io/tx/0x91bc20607cf98266614577e7481401fad8b3c9178db95e7abad4b88e8a6d8228), and bo settles up with mika inside Night Owls
  [(send)](https://testnet.snowtrace.io/tx/0xa8696358c0ddd7d03a4eed4a1f93a86d2938106cfb7af50016d94edd7ac77087). 44 txs.
- **iOS Simulator, native app in Expo Go** (`iosPrivate`): a new in-app wallet opens its private balance
  ([registration proof made on the phone](https://testnet.snowtrace.io/tx/0x7c640ba13022fb89e1db81d6b74fb6d934be7bb8adbafb60082744157d96af5b)), moves 20.00 in,
  moves 5.00 out ([withdraw proof on the phone](https://testnet.snowtrace.io/tx/0xf9a7d471a07bddb3cd700d41a39467e53c02817f1c57fb79483f18e8d13f4453)), copies mika's call and
  tips her 1.00 ([transfer proof on the phone](https://testnet.snowtrace.io/tx/0xe5deb19f810a15dda490c538a4b3d90abd8159220b6dfd2d63a73e39c514ae73)). Screens: `shots/avax-kumi/v2.1/ios-*.png`.
- Phone app, Expo web build (`phonePrivate`, `scripts/qa/phone-private.mjs`): a new wallet, faucet, open, move in,
  copy, a 1.50 tip ([0x539cde50…](https://testnet.snowtrace.io/tx/0x539cde50a7c43e98ac50ca09b6a203c1256d50f5e58f748a6a4aaa0c0af03597)), move out. 12 txs signed in the app.
- Web app, QA signer (`webPrivate`, `scripts/qa/web-private.mjs`): bo decrypts his Night Owls settle-up and sends
  mika 2.00 ([0xc72554dd…](https://testnet.snowtrace.io/tx/0xc72554dd054e153c2c1bac16fd53a30ecaac4e8efa25a217a57cf507a08e4fd0)); ren tips mika 0.75 in the AVAX pit
  ([0xe7da2295…](https://testnet.snowtrace.io/tx/0xe7da2295070147c42823a74aefa93775be55f4a6c0fd6f7cf8ea97aa9ccd019c)).

Open any of those on Snowtrace: the input is a proof and ciphertexts, and the amount is not in it (the Anvil test
checks that too).

## v2.2: gas-free start, Kumi AI, Top callers

### Gas-free start

A brand-new wallet can't send its first transaction without AVAX, and the public Fuji faucet has a captcha. Now the
phone signs a small request with its new key and Kumi's API relays it to **KumiGasStation**, which pays the wallet
0.0002 AVAX (about a billion gas at Fuji's 160 wei). The phone then signs `TestUSDC.faucet()` itself. Both txs
show in onboarding with their Snowtrace links.

The station checks everything on-chain, so the limits hold no matter which server instance relays:

| Rule | Where |
|---|---|
| Only a wallet that signed this exact request (station, chain, wallet, deadline ≤ 1 h) is paid | `KumiGasStation.drip` (EIP-191, low-s) |
| Once per wallet, only a wallet with no AVAX, never a contract | on-chain flags and checks |
| 20 drips per UTC day in total, 3 per requester per day | on-chain counters; the requester tag is an HMAC of the IP made on the API, so no IP is on chain |
| Only Kumi's relayer key can call `drip` (so a requester can't choose its own tag); the owner can rotate it | `relayer`, `setRelayer` |
| Empty or misconfigured sponsor | the app shows **Setup required** and the Fuji faucet link |

It was funded with 0.006 AVAX from Kumi's mika and bo test accounts (30 drips). The relayer pays its own gas.
Live drips: [the iOS Simulator's new wallet](https://testnet.snowtrace.io/tx/0x41b018b49971b96450ee574c0a3d0960c7cb258190ec56b0b27d17ed3166fbf2)
(then [1,000 tUSDC signed by that wallet](https://testnet.snowtrace.io/tx/0xfdfbd462bb2cebf457737f90a80a71a6b82c2e34a5515d768efb31ce7a70b733)),
[the hosted phone app's new wallet](https://testnet.snowtrace.io/tx/0xb875e155dcaee02ff9f89437a2191560a7680160ea5a7eb08253439ee13b3507)
(then [tUSDC](https://testnet.snowtrace.io/tx/0x5a348943cbcbc61fab9a73301c4603921882d682ee78cb32360f9c528441b92a) and
[joining the AVAX pit](https://testnet.snowtrace.io/tx/0x3fa71c29c8197f6db24779892f51af82dea48628bf0a6b16e5ed5ab6b89d70b5)),
and [the API's live test](https://testnet.snowtrace.io/tx/0x4e52c67b2538cfca7819b8c0b55c43a8688e72f19669209be6cff8bab1e84352).
An ERC-2771 forwarder for KumiLobby and KumiPerps was the other route; it would have meant redeploying the venue
under the seeded state, so it was not taken.

### Kumi AI in the chat

`/ask who is the best caller here?` or the ✨ button, in a public chat or a crew room, on the phone and the web.
Kumi AI is a Claude agent (`claude-haiku-5-5`) on Kumi's API; the Anthropic key is a server env var and never
reaches an app. Its tools are read-only views of live Fuji: the KumiPerps book and recent fills, Chainlink's Fuji
feeds, this chat's calls and copies with their PnL, a caller's record, the caller board and the asker's own
positions. The answer shows which tools it called as chips. When you ask for a trade, it uses `draft_call`: the app
shows a draft card, **Review and post** opens the call sheet filled in (in a crew, **Pitch it** fills
`/long BTC 2x 5%` into the composer), and you sign it yourself. It never signs or sends anything.

- Access: the wallet signs a one-hour pass (`Kumi AI / wallet / expires`); the API checks it and that the wallet is
  a member of that chat on-chain. Rate limits per wallet, per IP and per instance.
- Answers are labelled Kumi AI and stay on the asker's device ("Only you see this"); nothing is posted on chain.
- [A call Kumi AI drafted on the iOS Simulator and the ios-sim wallet signed](https://testnet.snowtrace.io/tx/0x06996f58ae578449e1daedd549be8f3ec11b19c4504641a2ebb3a27b4d3b0802) (AVAX pit #39).

### Top callers and reputation

The **Top** tab (phone) and the **Top callers** panel (web) rank everyone who has posted a call in the public chats,
from on-chain data only (`sdk/src/leaderboard.ts`):

- **A call's move:** Chainlink price stored by KumiLobby at the call → Chainlink now, signed by side and times the
  call's leverage. A call wins when that is above zero; a call with no move yet is not scored.
- **Copiers' PnL:** every KumiPerps `Filled` event since the venue was deployed, replayed per account and market
  first in first out. The fills of a copy's own order tx (`orderTx`, stored by `KumiLobby.copy`) are its lot: later
  closes are its realised PnL, the open rest is marked to Chainlink. Before funding.
- **Rank:** win rate smoothed toward 50% (one lucky call doesn't top the board), then average move; callers with no
  scored call go last. Per chat and across all chats.
- **Badges:** rank and win rate next to a caller's name in every chat and on their call cards; a crown for a top-3
  caller who wins at least half the time.

The test replays every fill and checks the result equals each account's KumiPerps position on Fuji, and each copy
against the fills in its own order tx. Seeded with six more real calls, five copies and one closed copy from Kumi's
test accounts (`seedV22` in `deployments/fuji.json`).

## How it works

| Piece | What it does |
|---|---|
| `contracts/src/KumiPerps.sol` | **The order book** is fully on-chain, with limit, IOC (market), post-only and reduce-only orders. Price levels are a sorted linked list, and orders queue FIFO within a level (price-time priority). Self-trades cancel the resting order. A maker that would breach its margin is skipped and cancelled, so its orders can't jam the book. **Prices and margin:** orders must sit within ±5% of Chainlink. Cross margin in tUSDC, with 10% initial and 5% maintenance. Equity and margin are marked to Chainlink, while fills happen at book prices. **Funding** is the book mid's premium over Chainlink, capped at ±1% and paid over 8 h, accrued every second and settled whenever a position is touched. **Liquidation:** anyone can close an under-maintenance account through the book for a 1% fee, and bad debt is drawn from an insurance fund. **Stale feeds:** if a Chainlink answer is non-positive or older than `maxAge`, trading, withdrawals and liquidations revert, but cancels still work. Views: `depth`, `recentTrades` (an on-chain ring buffer), `positionsOf` (with liquidation price), `health`, `fundingInfo`. |
| `contracts/src/KumiCrew.sol` | **The crew vault**, one EIP-1167 clone per crew. **Joining:** it is invite-only, and new members are added by vote. Shares are minted at the marked NAV, and all the money sits as margin in one KumiPerps account. **Pitches and votes:** `pitch` is the on-chain form of `/long AVAX 3x 20%`, and the pitcher's own yes vote counts. Votes are weighted by **current** shares, so a member who has ragequit no longer counts. The deciding vote executes in the same transaction, through `try/catch` so a venue refusal keeps the vote. The deciding vote needs at least 2.5M gas, so gas estimation can't settle on the caught out-of-gas path. **Execution:** the trade is an IOC order at most `maxSlippageBps` from Chainlink. **Policy:** a vote threshold, the voting period, max leverage per pitch, and a **crew-wide leverage cap** (total notional ≤ NAV × maxLeverage, checked after every open). **Captain lane:** the captain can trade without a vote within limits on leverage, size as a share of NAV, and trades per day. **Ragequit** closes `shares / total` of every open position on the book. The leaver takes `equityAfter − (1 − s) × equityBefore`, so the members who stay keep exactly what they had per share, and the leaver pays the spread. A full exit ends membership. **Chat** (`say`) and every pitch, vote, fill, deposit and exit are kept as on-chain feed entries. |
| `contracts/src/venues/PrimitOrderlyAccount.sol` | **The mainnet Primit route.** It deposits USDC into Orderly's Avalanche vault and sets a delegate signer. See [docs/PRIMIT.md](docs/PRIMIT.md): Primit matches orders off-chain on Orderly, so a contract cannot place its orders. |
| `scripts/fuji/*.ts` | **Fuji tooling:** test keys in a gitignored `.env`, funding, deployment, and the maker bot. The bot quotes 6 levels on each side, 0.05% from Chainlink, and `--skew-bps` leans the book. Every tx is recorded. |
| `contracts/src/KumiLobby.sol` | **Public chats.** Anyone joins a channel; members chat and post calls (market, side, leverage, suggested margin; the Chainlink price is stored with the call). `copy` reverts unless the copier holds that side on KumiPerps right now, and it writes the venue's size and entry, not the copier's claim. 15 tests. |
| `contracts/lib/EncryptedERC` | **Ava Labs' eERC**, unmodified (submodule at `8dc98cd`), built with `FOUNDRY_PROFILE=eerc` exactly as upstream (solc 0.8.27, no via-ir). Kumi adds no contract around it. |
| `sdk/src/eerc.ts` | Keys from a wallet signature, BabyJubJub ElGamal and Poseidon ciphertexts, proof inputs for registration, transfer and withdraw, the Kumi memo, and reading a private send back by hash as sender, receiver or auditor. |
| `contracts/src/KumiGasStation.sol` | **Gas for new wallets (v2.2).** Pays 0.0002 AVAX once to a wallet that signed the request and holds no AVAX, with a daily cap and a per-requester cap on-chain; only Kumi's relayer calls it. 21 tests incl. forged, moved, cross-station, malleated and expired signatures. |
| `api/` | **Kumi's API (v2.2, Vercel):** `POST /api/gas` (relays a gas request after off-chain checks), `POST /api/ask` (Kumi AI: Claude with read-only Fuji tools), `GET /api/health`. Bundled with esbuild; keys are Vercel env vars. 16 live tests. |
| `mobile/` | The Expo app (SDK 58, Expo Router, viem). See "The phone app" above. |
| `sdk/` | Order encoding (tick, lot, IOC limit inside the oracle band), candles (exchange + Chainlink + fills), the on-chain chat client for crews and lobby channels, ABIs, the chat-command parser (`/long`, `/short`, `/close`, `/captain …`, `/invite`) with its tests, and formatting helpers. |
| `web/` | The Vite + React app. **Pages:** `/room` (the crew list, the chat with trade cards and share-weighted vote bars, and the fund pane with live positions, Chainlink and close-now PnL, liquidation price, members and rules), `/markets/:sym` (laid out like Hyperliquid: a stats strip, depth chart, recent fills, the on-chain order book and fills linked to Snowtrace), `/crew` (the fund page with every pitch and its result) and `/` (the landing). **Signing:** a browser wallet (Core or MetaMask) switched to Fuji. QA builds (`VITE_QA=1`) can also use a **QA signer** that the Playwright harness injects. It is not in production builds, and no key ships in any bundle. |

### Avalanche, and why

- **Fast, cheap blocks.** The whole loop is on-chain: chat, votes, matching, funding and liquidation. That only
  works if blocks land in about 2 seconds and gas is almost free. Fuji gave us both: gas was 160 wei while we built.
- **Chainlink on Fuji.** The AVAX/USD and BTC/USD feeds mark every position and gate every trade.
- **C-Chain mainnet route.** Primit, an on-chain perps front end on Avalanche, was researched. Its adapter was
  simulated on a C-Chain **mainnet fork**, with no mainnet transaction.
- **eERC (Avalanche bonus), used for a real job:** tips to callers and crew settle-ups move as encrypted balances
  on Ava Labs' EncryptedERC, with proofs made on the phone. See the section above for exactly what is hidden.
- **Gas sponsorship on C-Chain (v2.2):** a new wallet's first gas comes from an on-chain station with on-chain
  limits, and costs Kumi 0.0002 AVAX, because Fuji gas is that cheap.
- **Not used:** no custom L1 and no ICM/ICTT. Kumi doesn't need a second chain, so it doesn't claim them.

## Try it

Node 22+ and pnpm 10.

```bash
pnpm install
cd contracts && forge test                               # 87 unit, attack and fuzz tests (forks skipped)
FORK=1 forge test --match-contract FujiForkTest          # real Chainlink feeds on a Fuji fork
FORK=1 forge test --match-contract PrimitForkTest        # Orderly's vault on an Avalanche mainnet fork (simulation only)
cd ../sdk && node --test test/*.test.ts                  # parser, orders, candles, chat, eERC, gas digest, caller board (live Fuji)
cd ../api && node --test test/*.test.ts                  # gas sponsor (one real drip) and Kumi AI (one real model run); keys read by name
cd ../contracts && FOUNDRY_PROFILE=eerc forge build && cd ../scripts && pnpm test:eerc   # eERC on Anvil with real proofs (40 checks)
cd ../mobile && npm install && npm test                  # invite-link parsing; npx expo start for the app
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

- **Native, but on the simulator.** v2.1 signed real Fuji transactions from the native app in Expo Go on the iOS
  Simulator (iPhone 17 Pro), including all three eERC proofs made on the device (`iosPrivate`). The ship round adds a
  standalone Release build for the simulator (downloadable above; arm64, so Apple-silicon Macs). It has not been run
  on a physical phone, and there is no APK or TestFlight build: the APK was skipped because the Mac had ~10 GB free
  with another app's Xcode build queued behind this one. Expo Go publishing waits on the Expo account login.
- **The gas station is small on purpose.** 0.006 AVAX funds 30 new wallets; past the daily cap or when it runs dry,
  the app says so and links the Fuji faucet. The per-requester cap keys on IP, which a determined farmer can rotate.
- **Kumi AI is an assistant, not an oracle.** Its numbers come from its tool reads, but its sentences are a model's;
  the in-memory rate limits reset when a server instance restarts (the hard money limits are the gas station's,
  on-chain). It only drafts; you sign.
- **The caller board is young.** With a handful of calls per caller, win rates are noisy; calls are scored to
  Chainlink now, not at a fixed horizon, and PnL is before funding.
- **eERC hides payment amounts, not trading.** Positions, orders, copies and crew shares stay public on KumiPerps
  and KumiCrew. Moving tUSDC in or out of the eERC is public. Kumi's auditor key can read every private amount.
- **The phone downloads ~30 MB of circuit files** (Ava Labs' zkeys) the first time it proves, from the hosted app.
- **No ICM/ICTT or own L1.** Not built; nothing claims them (WIN-GAP.md).

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
