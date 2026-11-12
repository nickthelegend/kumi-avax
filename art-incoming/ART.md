# Kumi art set: phone app and web (incoming)

28 images generated with ChatGPT on 2026-11-12, one image per message in a single fresh chat. They are not wired
into code yet; the Kumi build agent places them.

The style follows the approved Kumi kit. Clay crew, scenes and stickers use the matte polymer-clay look of
`web/public/art/kumi3-*` (bear, fox, frog and owl in knit scarves). Objects (icon, wallet, bell, order-book card)
use the soft-touch candy plastic from `projects/kumi/docs/ART-3D.md`. Palette: coral `#FF6F59`, plum `#3B1F4A`,
cream `#FFF4E6`, butter `#FFD166`, mint `#3DDC97` and pink `#FF8FC7`, with pink only on the cheeks and in loss
accents. Face: closed happy upward eye arcs, a small open smile and pink blush cheeks. Sleeping art uses closed
downward arcs. The loss and offline art use worried round dot eyes with a wobbly mouth. There are no pill eyes, no
eyebrows, no silver or chrome, no brands or logos, no real people and no text.

Formats: opaque scenes are JPEG q85. Transparent art is PNG with real alpha, 768 px, squeezed with pngquant. The
icon is a 1024 px opaque PNG. Every file is under 400 KB.

## Phone app shell

| File | Size | What it shows |
|---|---|---|
| `kumi-app-icon.png` | 1024×1024, opaque | Coral chat bubble with Kumi's happy face, two small cream bubbles peeking behind it, on a full-bleed plum tile with a soft butter glow. It still reads at 32 px. The white rounded corners from generation were flood-filled with plum, so the OS mask can round it. |
| `kumi-splash.jpg` | 1024×1536, opaque | Splash screen: bear, fox, frog and owl hugging a big coral face-bubble in the lower half, with coins and sparkles. The top 40% is empty plum for the logo. |
| `kumi-og.jpg` | 1200×800, opaque | OG/social card for the phone app: the crew (bear, fox, frog, bunny) cheering around a plum clay phone. The phone shows chat bubbles with dots and a rising bar card, with no text. The left half is empty plum for the headline. |

## Onboarding (opaque, 1024×1024)

| File | What it shows |
|---|---|
| `kumi-onboard-1.jpg` | "Start a crew": a cat, a bunny and a bear each pop out of a coral, cream or mint chat bubble and wave, with hearts and sparkles, on a cream/pink sweep. |
| `kumi-onboard-2.jpg` | "Vote on trades together": a fox and a frog raise thumbs-up signs beside a cream card with rising bars and a mint arrow, on a mint sweep. |
| `kumi-onboard-3.jpg` | "Leave anytime with your share": a bunny walks out of a coral arched door hugging a small jar of coins, next to the big crew coin jar, on a butter sweep. |

## Crew avatar mascots (transparent PNG, 768 px, circle-crop safe)

They are new crew members alongside the existing owl, fox, bear and frog. Each one sits facing front and waves.

| File | Mascot |
|---|---|
| `kumi-av-cat.png` | Cream-and-coral calico cat, butter scarf |
| `kumi-av-bunny.png` | Cream bunny, pink ears, mint scarf |
| `kumi-av-panda.png` | Cream/plum panda, coral beanie with butter pom-pom, butter scarf |
| `kumi-av-penguin.png` | Plum penguin, cream belly, butter beak and feet, coral scarf |
| `kumi-av-raccoon.png` | Plum-grey raccoon, plum mask band, striped tail, butter scarf |
| `kumi-av-duck.png` | Butter duckling, coral beak and feet, mint bandana |
| `kumi-av-hamster.png` | Coral-peach hamster holding a butter coin, mint scarf (standing) |
| `kumi-av-koala.png` | Lilac-grey koala, cream ears, plum nose, coral scarf |
| `kumi-av-tiger.png` | Coral tiger cub, plum stripes, mint scarf |
| `kumi-av-axolotl.png` | Pink axolotl, coral gills, butter scarf |

## Empty states and system illustrations (transparent PNG, 768 px)

| File | What it shows | Suggested use |
|---|---|---|
| `kumi-empty-chat.png` | Calico cat asleep on a coral chat bubble with three cream dots; sleep bubbles | Crew chat with no messages yet |
| `kumi-join-crew.png` | Frog and fox lean out of a glowing coral bubble-doorway and hand a butter scarf to a skipping bunny | "Join a crew" / invite screen |
| `kumi-empty-market.png` | Candy-plastic cream card with a near-empty price ladder (pink asks above, mint bids below), a sleepy coral bubble dozing on top | Order book / market with no orders |
| `kumi-wallet.png` | Candy-plastic coral wallet with a happy face and a plum clasp; butter coins drop in; mint plus badge | Wallet / deposit screen |
| `kumi-notify.png` | Candy-plastic coral bell with a happy face, ringing, with a cream chat bubble and plum dots | Notifications permission / inbox |
| `kumi-offline.png` | Plum penguin in a coral scarf holding two unplugged ends of a coral cable, worried face | Offline / connection lost / RPC error |

## Chat stickers and trade reactions (transparent PNG, 768 px, no sticker outline)

| File | What it shows | Suggested use |
|---|---|---|
| `kumi-win-fox.png` | Fox jumping for joy with a fat mint up-arrow, coins and confetti | Trade closed in profit |
| `kumi-win-frog.png` | Frog in a coral cap riding a coral rocket, cheering | Big win / position up |
| `kumi-loss-bear.png` | Bear in a butter beanie, sheepish worried face and sweat drop, holding a bending pink down-arrow | Trade closed at a loss |
| `kumi-loss-owl.png` | Owl with butter glasses hugging itself under a small plum rain cloud with pink drops | Loss / liquidation-adjacent |
| `kumi-st-hold.png` | Panda in a coral beanie squeezing a big butter coin, eyes scrunched, two coral hearts | "Holding" / diamond-hands reaction |
| `kumi-st-party.png` | Bunny jumping with arms up in a shower of round confetti dots and sparkles | Crew hit its target / season win |

## Not used (kept out of this folder)
- First hamster and first join-a-crew: the checkerboard was baked into the pixels (RGB, no alpha). Regenerated.
- First offline penguin and the first two party bunnies: a "?" mark, or a streamer shaped like one. Regenerated
  without symbols.

Art generated with ChatGPT.
