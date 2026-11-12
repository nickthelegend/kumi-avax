# Primit on Avalanche mainnet: research and adapter

Nick asked for a second venue: Primit (https://app.primit.io), which is listed as an on-chain order book perps DEX on
Avalanche. Primit has no public docs, so this file records what was found on Nov 12, 2026, and how. Everything here
comes from public pages, Orderly's public API and read-only RPC calls. There was no login and no wallet connection,
and no transaction was sent.

## What Primit is

**Primit is a front end ("broker") on Orderly Network. Its order book is not on Avalanche.**

- **The app is an Orderly broker.** Its bundle sets `brokerId: "primit"`, `networkId: "mainnet"` and a chain
  filter of 43114. The page preconnects to `api.orderly.org` and `ws-evm.orderly.org`.
- **Orderly's public API names it.** `GET https://api.orderly.org/v1/public/broker/name?broker_id=primit` returns
  "Primit".
- **The Avalanche vault comes from the same API.** `GET https://api.orderly.org/v1/public/chain_info?broker_id=primit`
  lists the Avalanche C-Chain vault as `0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9`.
- **The vault's code matches Orderly's open source.** It is a TransparentUpgradeableProxy whose implementation is
  `0x4f8C0F4F794Dc5b6d4f1C0883E3FAb402867F083`, which is unverified on Routescan. Every selector we use appears in
  its bytecode and matches [`OrderlyNetwork/contract-evm`](https://github.com/OrderlyNetwork/contract-evm)
  `src/vaultSide/Vault.sol`.
- **Matching is off-chain.** Orderly's engine matches orders and settles positions on Orderly's own chain. The
  Avalanche contract only takes deposits, and it pays out withdrawals that Orderly's cross-chain manager relays.
- **Collateral is USDC.** The only allowed token is native USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`
  (6 decimals).
- **Markets are text symbols.** Examples are `PERP_AVAX_USDC` (lot 0.01, tick 0.001, min notional 10 USDC) and
  `PERP_BTC_USDC`.
- **A real deposit confirms the format.** Tx `0x930c0b7d18a5108200964af20728bd7eb547c7878edc0b881db7ee1b7cb02880`
  (Nov 10, 2026) deposited 1 USDC with 0.034 AVAX attached, and its account id matched
  `keccak256(abi.encode(user, keccak256("primit")))`.

## What a crew vault can and cannot do

| Step | On-chain on Avalanche? | How |
|---|---|---|
| Deposit USDC for its own account | Yes | `Vault.deposit((accountId, brokerHash, tokenHash, amount))`, with the LayerZero fee paid in AVAX |
| Name a delegate EOA | Yes | `Vault.delegateSigner((brokerHash, eoa))`. Only a contract can call it, and the delegate must be an EOA |
| Register a trading key | No | The EOA signs EIP-712 and calls `POST /v1/delegate_signer`, then `POST /v1/delegate_orderly_key` |
| Place, cancel or close orders | **No** | `POST /v1/order` and the other REST calls are signed with that ed25519 key |
| Withdraw | Partly | The delegate EOA signs a withdrawal. Orderly's Ledger only pays back to the contract, and `sweep()` sends it to the crew |

**So a vote can control the money going in and out, but not the trades.** Trading on Primit needs an off-chain agent
that the crew trusts with the Orderly key. A trustless, vote-executed Primit trade, like the one Kumi's Fuji venue
does, is not possible with Primit's current contracts.

## What is built

- **The adapter:** [`contracts/src/venues/PrimitOrderlyAccount.sol`](../contracts/src/venues/PrimitOrderlyAccount.sol)
  is the on-chain half. It holds USDC, deposits it into Orderly under its own `primit` account, sets the delegate
  signer, and sweeps withdrawals back to its owner, the crew.
- **The simulation:** [`contracts/test/PrimitFork.t.sol`](../contracts/test/PrimitFork.t.sol) runs 7 tests on an
  Avalanche **mainnet fork**: `FORK=1 forge test --match-contract PrimitForkTest`. It checks the real vault and its
  AVAX deposit fee, a 20 USDC deposit reaching the vault with `AccountDepositTo` keyed to the adapter's account id,
  a deposit refused without the fee, a wrong account id refused by Orderly, the `AccountDelegate` registration, that
  the delegate must be an EOA, and owner-only control. All 7 pass. Nothing was broadcast.

## What is missing for one real Primit trade

1. **The off-chain order agent.** It needs the EIP-712 delegate-signer message, ed25519 key registration, and
   signed `POST /v1/order` with `reduce_only` for closes, plus account leverage. All of these are documented by
   Orderly, but none can be simulated on a fork, because a forked deposit never reaches Orderly's engine.
2. **Real funds.** That means at least 10 USDC per order, about 0.03 AVAX of deposit fee, and a 1 USDC withdrawal fee.
   **Nick sends the one real mainnet trade himself.** Kumi does not send mainnet transactions.
3. **No precedent.** No contract account has ever used Orderly's delegate-signer flow on Avalanche:
   `AccountDelegate` has zero events on this vault since it was deployed.

**Verdict: Kumi's own on-chain order book on Fuji stays the product.** That venue lets a crew vote execute a trade
with no trusted party. Primit can be reached through the adapter above plus an off-chain agent, and that agent is
the trusted part.
