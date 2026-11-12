// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {KumiPerps} from "../src/KumiPerps.sol";

contract KumiPerpsBookTest is Base {
    function setUp() public override {
        super.setUp();
        _deposit(maker, 200_000e6);
        _deposit(maker2, 200_000e6);
        _deposit(alice, 10_000e6);
        _deposit(bob, 10_000e6);
    }

    function test_restingOrdersSetBestPricesAndDepth() public {
        _limit(maker, AVAX, true, 19_90e6, 10e18);
        _limit(maker, AVAX, true, 19_95e6, 5e18);
        _limit(maker, AVAX, false, 20_10e6, 7e18);
        _limit(maker, AVAX, false, 20_05e6, 3e18);
        KumiPerps.Market memory m = perps.getMarket(AVAX);
        assertEq(m.bestBid, 19_95e6);
        assertEq(m.bestAsk, 20_05e6);
        (uint64[] memory p, uint128[] memory s, uint32[] memory c) = perps.depth(AVAX, true, 10);
        assertEq(p.length, 2);
        assertEq(p[0], 19_95e6);
        assertEq(p[1], 19_90e6);
        assertEq(s[1], 10e18);
        assertEq(c[0], 1);
        (p,,) = perps.depth(AVAX, false, 10);
        assertEq(p[0], 20_05e6);
        assertEq(p[1], 20_10e6);
    }

    function test_priceTimePriority_oldestOrderFillsFirst() public {
        uint64 first = _limit(maker, AVAX, false, 20_05e6, 4e18);
        uint64 second = _limit(maker2, AVAX, false, 20_05e6, 4e18);
        _market(alice, AVAX, true, 5e18);
        (,,,,, uint128 s1,,,) = perps.orders(first);
        (,,,,, uint128 s2,,,) = perps.orders(second);
        assertEq(s1, 0, "oldest fully filled");
        assertEq(s2, 3e18, "second partially filled");
        (int256 mk,) = _pos(maker, AVAX);
        (int256 mk2,) = _pos(maker2, AVAX);
        assertEq(mk, -4e18);
        assertEq(mk2, -1e18);
    }

    function test_marketOrderWalksLevels_averagePrice() public {
        _limit(maker, AVAX, false, 20_01e6, 1e18);
        _limit(maker, AVAX, false, 20_03e6, 1e18);
        KumiPerps.Fill memory f = _market(alice, AVAX, true, 2e18);
        assertEq(f.filled, 2e18);
        (int256 s, uint64 entry) = _pos(alice, AVAX);
        assertEq(s, 2e18);
        assertEq(entry, 20_02e6, "average of the two levels");
        assertEq(perps.getMarket(AVAX).bestAsk, 0, "book emptied");
        KumiPerps.Trade[] memory t = perps.recentTrades(AVAX, 10);
        assertEq(t.length, 2);
        assertEq(t[0].price, 20_03e6, "newest first");
        assertTrue(t[0].takerBuy);
    }

    function test_crossingLimitFillsThenRestsRemainder() public {
        _limit(maker, AVAX, false, 20_00e6, 1e18);
        vm.prank(alice);
        (uint64 id, KumiPerps.Fill memory f) = perps.placeOrder(AVAX, true, 20_02e6, 3e18, 0);
        assertEq(f.filled, 1e18);
        assertGt(id, 0);
        KumiPerps.Market memory m = perps.getMarket(AVAX);
        assertEq(m.bestBid, 20_02e6);
        assertEq(m.bestAsk, 0);
        assertGt(perps.reservedIm(alice), 0);
    }

    function test_iocNeverRests() public {
        vm.prank(alice);
        (uint64 id,) = perps.placeOrder(AVAX, true, 19_99e6, 1e18, IOC_F);
        assertEq(id, 0);
        assertEq(perps.getMarket(AVAX).bidLevels, 0);
    }

    function test_cancel_onlyOwner_releasesMargin() public {
        uint64 id = _limit(alice, AVAX, true, 19_00e6, 10e18);
        assertGt(perps.reservedIm(alice), 0);
        vm.prank(bob);
        vm.expectRevert(KumiPerps.NotOrderOwner.selector);
        perps.cancelOrder(id);
        vm.prank(alice);
        perps.cancelOrder(id);
        assertEq(perps.reservedIm(alice), 0);
        assertEq(perps.getMarket(AVAX).bidLevels, 0);
        vm.prank(alice);
        vm.expectRevert(KumiPerps.NoSuchOrder.selector);
        perps.cancelOrder(id);
    }

    function test_selfTrade_cancelsOwnRestingOrder() public {
        uint64 own = _limit(alice, AVAX, false, 20_01e6, 1e18);
        _limit(maker, AVAX, false, 20_02e6, 1e18);
        _market(alice, AVAX, true, 1e18);
        (,,,,, uint128 s,,,) = perps.orders(own);
        assertEq(s, 0, "own order cancelled, not filled");
        (int256 pos, uint64 entry) = _pos(alice, AVAX);
        assertEq(pos, 1e18);
        assertEq(entry, 20_02e6);
    }

    function test_postOnly_revertsWhenItWouldCross() public {
        _limit(maker, AVAX, false, 20_01e6, 1e18);
        vm.prank(alice);
        vm.expectRevert(KumiPerps.WouldCross.selector);
        perps.placeOrder(AVAX, true, 20_01e6, 1e18, PO_F);
    }

    function test_tickAndLotAreEnforced() public {
        vm.startPrank(alice);
        vm.expectRevert(KumiPerps.BadTick.selector);
        perps.placeOrder(AVAX, true, 20_00e6 + 1, 1e18, 0);
        vm.expectRevert(KumiPerps.BadLot.selector);
        perps.placeOrder(AVAX, true, 20_00e6, 1e18 + 1, 0);
        vm.expectRevert(KumiPerps.BadLot.selector);
        perps.placeOrder(AVAX, true, 20_00e6, 0, 0);
        vm.expectRevert(KumiPerps.BadTick.selector); // a market order must be IOC
        perps.placeOrder(AVAX, true, 0, 1e18, 0);
        vm.stopPrank();
    }

    function test_reduceOnly_capsAndRefusesFlips() public {
        _limit(maker, AVAX, false, 20_01e6, 5e18);
        _limit(maker, AVAX, true, 19_99e6, 5e18);
        _market(alice, AVAX, true, 2e18);
        vm.prank(alice);
        vm.expectRevert(KumiPerps.ReduceOnlyViolated.selector);
        perps.placeOrder(AVAX, true, 0, 1e18, IOC_F | RO_F);
        vm.prank(alice);
        (, KumiPerps.Fill memory f) = perps.placeOrder(AVAX, false, 0, 4e18, IOC_F | RO_F);
        assertEq(f.filled, 2e18, "capped at the position");
        (int256 s,) = _pos(alice, AVAX);
        assertEq(s, 0);
    }

    function test_realisedPnl_onClose() public {
        _limit(maker, AVAX, false, 20_00e6, 10e18);
        _market(alice, AVAX, true, 10e18);
        avaxFeed.set(21e8);
        _limit(maker, AVAX, true, 21_00e6, 10e18);
        int256 before = perps.collateral(alice);
        KumiPerps.Fill memory f = _market(alice, AVAX, false, 10e18);
        assertEq(f.realized, 10e6, "+$1 x 10 AVAX");
        assertEq(perps.collateral(alice) - before, 10e6);
        (int256 makerPos,) = _pos(maker, AVAX);
        assertEq(makerPos, 0);
    }
}

contract KumiPerpsMarginTest is Base {
    function setUp() public override {
        super.setUp();
        _deposit(maker, 500_000e6);
        _ladder(maker, AVAX, 20e8, 1e6, 500e18, 10);
    }

    function test_overLeverage_reverts() public {
        _deposit(alice, 1_000e6);
        // 10% initial margin = 10x max. 520 AVAX at ~$20 = ~$10,400 > $10,000.
        vm.prank(alice);
        vm.expectRevert();
        perps.placeOrder(AVAX, true, 0, 520e18, IOC_F);
        // 9x is fine.
        _market(alice, AVAX, true, 450e18);
        (int256 s,) = _pos(alice, AVAX);
        assertEq(s, 450e18);
    }

    function test_restingOrderNeedsMargin() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert();
        perps.placeOrder(AVAX, true, 19_00e6, 100e18, 0); // $1,900 notional needs $190 margin
    }

    function test_withdraw_blockedBelowInitialMargin() public {
        _deposit(alice, 1_000e6);
        _market(alice, AVAX, true, 300e18); // ~$6,000 notional, IM $600
        vm.prank(alice);
        vm.expectRevert();
        perps.withdraw(500e6);
        vm.prank(alice);
        perps.withdraw(300e6);
    }

    function test_withdraw_cannotTakeMoreThanCollateral() public {
        _deposit(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(KumiPerps.InsufficientCollateral.selector);
        perps.withdraw(101e6);
        uint256 b = usdc.balanceOf(alice);
        vm.prank(alice);
        perps.withdraw(100e6);
        assertEq(usdc.balanceOf(alice) - b, 100e6);
    }

    function test_makerWithoutMargin_isSkippedNotFilled() public {
        _deposit(bob, 300e6);
        // Bob rests an ask with enough margin, then the price runs against him so a fill would breach IM.
        uint64 id = _limit(bob, AVAX, false, 20_00e6, 140e18); // $2,800 notional, $280 reserved
        // Remove the main maker's asks so Bob's ask is best.
        vm.startPrank(maker);
        perps.cancelOrders(perps.openOrders(maker, AVAX, 50));
        vm.stopPrank();
        avaxFeed.set(20_80e6); // Bob's ask at $20.00 is now $0.80 under the oracle: a fill costs him $112
        _deposit(alice, 5_000e6);
        vm.prank(alice);
        perps.placeOrder(AVAX, true, 20_00e6, 140e18, IOC_F); // filling all 140 would cost Bob $112 and breach IM
        (,,,,, uint128 left,,,) = perps.orders(id);
        assertEq(left, 0, "cancelled for margin");
        (int256 bobPos,) = _pos(bob, AVAX);
        assertEq(bobPos, 0, "never filled");
        assertEq(perps.reservedIm(bob), 0);
    }
}

contract KumiPerpsLiquidationTest is Base {
    function setUp() public override {
        super.setUp();
        _deposit(maker, 500_000e6);
        _ladder(maker, AVAX, 20e8, 1e6, 500e18, 10);
        _deposit(alice, 1_000e6);
        _market(alice, AVAX, true, 400e18); // ~$8,004 notional on $1,000: ~8x
    }

    function test_healthyAccount_cannotBeLiquidated() public {
        vm.prank(keeper);
        vm.expectRevert();
        perps.liquidate(alice, AVAX, new uint64[](0));
    }

    function test_liquidation_afterPriceDrop_paysKeeper() public {
        // Equity = 1000 + 400*(P-20.0x); maintenance = 400*P*5%. Below at about P = 18.5.
        avaxFeed.set(18_40e6);
        vm.startPrank(maker);
        perps.cancelOrders(perps.openOrders(maker, AVAX, 50));
        vm.stopPrank();
        _ladder(maker, AVAX, 18_40e6, 1e6, 500e18, 5);
        (int256 eq,, uint256 mm) = perps.health(alice);
        assertLt(eq, int256(mm), "under maintenance");
        int256 keeperBefore = perps.collateral(keeper);
        vm.prank(keeper);
        uint128 closed = perps.liquidate(alice, AVAX, new uint64[](0));
        assertEq(closed, 400e18);
        (int256 s,) = _pos(alice, AVAX);
        assertEq(s, 0);
        assertGt(perps.collateral(keeper), keeperBefore, "keeper paid");
        assertGe(perps.collateral(alice), 0);
    }

    function test_badDebt_isCoveredByInsurance() public {
        perps.fundInsurance(5_000e6);
        avaxFeed.set(17e8); // a gap far below the liquidation price
        vm.startPrank(maker);
        perps.cancelOrders(perps.openOrders(maker, AVAX, 50));
        vm.stopPrank();
        _ladder(maker, AVAX, 17e8, 1e6, 500e18, 5);
        vm.prank(keeper);
        perps.liquidate(alice, AVAX, new uint64[](0));
        assertEq(perps.collateral(alice), 0, "deficit written off");
        assertLt(perps.insuranceFund(), 5_000e6, "insurance paid it");
        assertEq(perps.badDebt(), 0);
    }

    function test_positionsOf_reportsLiquidationPrice() public view {
        KumiPerps.PositionView[] memory ps = perps.positionsOf(alice);
        assertEq(ps.length, 1);
        assertGt(ps[0].liqPrice, 18_00e6);
        assertLt(ps[0].liqPrice, 19_00e6);
    }
}

contract KumiPerpsFundingTest is Base {
    function setUp() public override {
        super.setUp();
        _deposit(maker, 500_000e6);
        _deposit(alice, 10_000e6);
        _deposit(bob, 10_000e6);
    }

    function test_funding_longsPayShortsWhenBookIsAboveOracle() public {
        // Alice long 100, Bob short 100, both at $20.
        _limit(bob, AVAX, false, 20_00e6, 100e18);
        _market(alice, AVAX, true, 100e18);
        // The book now quotes 0.5% above the oracle.
        _limit(maker, AVAX, true, 20_09e6, 1e18);
        _limit(maker, AVAX, false, 20_11e6, 1e18);
        (int256 prem,,,) = perps.fundingInfo(AVAX);
        assertEq(prem, 5e15, "+0.5% premium");
        perps.pokeFunding(AVAX); // start the clock at this premium
        vm.warp(block.timestamp + 8 hours);
        avaxFeed.set(20e8);
        perps.pokeFunding(AVAX);
        int256 a0 = perps.collateral(alice);
        int256 b0 = perps.collateral(bob);
        // Settle both by touching positions with withdrawals of 1 unit.
        vm.prank(alice);
        perps.withdraw(1);
        vm.prank(bob);
        perps.withdraw(1);
        int256 alicePaid = a0 - perps.collateral(alice) - 1;
        int256 bobGot = perps.collateral(bob) - b0 + 1;
        // 0.5% of $2,000 per 8h = $10.
        assertApproxEqAbs(alicePaid, 10e6, 1, "long paid");
        assertApproxEqAbs(bobGot, 10e6, 1, "short received");
    }

    function test_funding_premiumIsCapped() public {
        _limit(maker, AVAX, true, 20_80e6, 1e18); // 4% over, inside the 5% band
        _limit(maker, AVAX, false, 20_90e6, 1e18);
        (int256 prem, int256 hourly,,) = perps.fundingInfo(AVAX);
        assertEq(prem, 1e16, "capped at 1%");
        assertEq(hourly, 1e16 / 8);
    }

    function test_noFundingWithoutTwoSidedBook() public view {
        (int256 prem,,,) = perps.fundingInfo(AVAX);
        assertEq(prem, 0);
    }
}

contract KumiPerpsAttackTest is Base {
    function setUp() public override {
        super.setUp();
        _deposit(maker, 500_000e6);
        _deposit(alice, 10_000e6);
        _ladder(maker, AVAX, 20e8, 1e6, 100e18, 5);
    }

    function test_staleOracle_blocksTradingAndLiquidation_butNotCancels() public {
        uint64 id = _limit(alice, AVAX, true, 19_50e6, 1e18);
        _market(alice, AVAX, true, 1e18);
        vm.warp(block.timestamp + 3601);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KumiPerps.StaleOracle.selector, AVAX, avaxFeed.updatedAt()));
        perps.placeOrder(AVAX, true, 0, 1e18, IOC_F);
        vm.expectRevert(abi.encodeWithSelector(KumiPerps.StaleOracle.selector, AVAX, avaxFeed.updatedAt()));
        perps.liquidate(alice, AVAX, new uint64[](0));
        vm.expectRevert();
        perps.oraclePrice(AVAX);
        vm.prank(alice);
        perps.cancelOrder(id); // still works
    }

    function test_nonPositiveOracle_reverts() public {
        avaxFeed.set(0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KumiPerps.BadOraclePrice.selector, AVAX));
        perps.placeOrder(AVAX, true, 0, 1e18, IOC_F);
        avaxFeed.set(-1);
        vm.expectRevert(abi.encodeWithSelector(KumiPerps.BadOraclePrice.selector, AVAX));
        perps.oraclePrice(AVAX);
    }

    function test_ordersFarFromOracle_areRejected() public {
        // A whale can't rest a $15 bid to farm liquidations, or a $25 ask, when the oracle says $20.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KumiPerps.OutsideBand.selector, uint64(18_99e6), uint256(20e8)));
        perps.placeOrder(AVAX, true, 18_99e6, 1e18, 0);
        vm.prank(alice);
        vm.expectRevert();
        perps.placeOrder(AVAX, false, 21_01e6, 1e18, 0);
    }

    function test_marketOrderCannotFillOutsideBand() public {
        // Only asks above the band remain: a market buy fills nothing.
        vm.startPrank(maker);
        perps.cancelOrders(perps.openOrders(maker, AVAX, 50));
        vm.stopPrank();
        _limit(maker, AVAX, false, 21_00e6, 1e18); // exactly at the +5% band edge
        avaxFeed.set(19_90e6); // band edge drops to $20.895, the ask is now outside it
        KumiPerps.Fill memory f = _market(alice, AVAX, true, 1e18);
        assertEq(f.filled, 0);
    }

    function test_listMarket_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(KumiPerps.NotOwner.selector);
        perps.listMarket("X", address(avaxFeed), 1, 1000, 500, 500, 100, 1, 1);
    }

    function test_crossMargin_lossInOneMarketCountsInAnother() public {
        _ladder(maker, BTC, 100_000e8, 10e8, 1e18, 5);
        _deposit(bob, 2_000e6);
        vm.prank(bob);
        perps.placeOrder(AVAX, true, 0, 400e18, IOC_F); // ~$8k
        avaxFeed.set(19e8); // -$400 unrealised
        // Opening $12k of BTC now needs $1.2k IM on top of $760 for AVAX; equity is ~$1.6k.
        vm.prank(bob);
        vm.expectRevert();
        perps.placeOrder(BTC, true, 0, 12e16, IOC_F);
    }
}

/// @dev Conservation: whatever the sequence of fills, no money is created. Sum of collateral plus
///      unrealised PnL over all accounts equals the deposits (rounding dust aside).
contract KumiPerpsConservationTest is Base {
    function testFuzz_fillsAreZeroSum(uint64 seed) public {
        _deposit(maker, 300_000e6);
        _deposit(alice, 20_000e6);
        _deposit(bob, 20_000e6);
        _ladder(maker, AVAX, 20e8, 1e6, 100e18, 6);
        uint256 x = seed;
        for (uint256 i = 0; i < 12; i++) {
            x = uint256(keccak256(abi.encode(x, i)));
            address who = x % 2 == 0 ? alice : bob;
            bool buy = (x >> 8) % 2 == 0;
            uint128 size = uint128(((x >> 16) % 50 + 1) * 1e17);
            vm.prank(who);
            try perps.placeOrder(AVAX, buy, 0, size, IOC_F) {} catch {}
            if (i % 4 == 3) {
                int256 move = int256((x >> 32) % 60) - 30; // +-$0.30
                avaxFeed.set(20e8 + move * 1e6);
            }
        }
        int256 total = perps.equityOf(maker) + perps.equityOf(alice) + perps.equityOf(bob);
        assertApproxEqAbs(total, 340_000e6, 10, "no money created or lost");
    }
}
