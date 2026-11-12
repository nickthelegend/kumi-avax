# Kumi on Avalanche: slide outline

1. **Your group chat is a fund. Now it trades perps.**
   Kumi crew art, the room on the right. One line: friends pitch a perp in chat, vote with their shares, and the
   vault opens it on an on-chain order book on Avalanche.

2. **The problem.**
   Group chats already talk trades ("AVAX 3x?"). Pooling money today means one friend holds the keys and a
   spreadsheet. Nobody can check the trade, and nobody can leave cleanly while a position is open.

3. **The room.**
   A screenshot of `/long AVAX 3x` becoming a coral trade card. Below it, a share-weighted vote bar with the
   50.01% line. Every message, pitch and vote is a Fuji transaction.

4. **The vote executes the trade.**
   The last yes vote calls the vault inside the same transaction. The vault sizes margin as 20% of NAV × 3, then
   sends an IOC order to KumiPerps, capped at 1% from Chainlink. It shows the fill price and the Snowtrace link.

5. **A real order book on-chain.**
   The markets page, laid out like Hyperliquid:
   - price-time priority, partial fills and self-trade cancels
   - orders banded to ±5% of Chainlink
   - AVAX-USD and BTC-USD on the real Fuji feeds
   - a maker bot account quoting both sides

6. **Risk rules that are code.**
   - 10% initial and 5% maintenance margin, with liquidations through the book and an insurance fund
   - funding on the book's premium over Chainlink
   - stale feeds pause trading
   - a crew-wide leverage cap and captain limits

7. **Ragequit, exactly.**
   You leave with your slice. Your share of every open position closes on the book first, and you pay that
   spread. The test shows the remaining members' share price doesn't move.

8. **The live Fuji demo.**
   3 members chip in → mika pitches `/long AVAX 3x` → bo votes and it opens → the price moves → `/close AVAX`
   with PnL → ren ragequits. Every tx is in `deployments/fuji.json`.

9. **Mainnet: Primit, honestly.**
   Primit is an Orderly broker, and orders match off-chain. A contract can deposit and name a delegate, but it
   can't place orders. Our adapter passes 7 tests on an Avalanche mainnet fork. A vote-executed trade there needs
   a trusted off-chain agent, so the Fuji venue is the product.

10. **Built, tested, open.**
    - 68 tests: 51 Foundry unit and attack tests, 3 Fuji-fork tests on real Chainlink feeds, 7 mainnet-fork Primit
      tests, and 7 parser tests.
    - MIT licensed.
    - The ask: crews on mainnet once a trustless perps venue on Avalanche exposes on-chain orders.
