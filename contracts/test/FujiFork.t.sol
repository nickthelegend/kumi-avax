// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KumiPerps} from "../src/KumiPerps.sol";
import {KumiCrew, KumiCrewFactory} from "../src/KumiCrew.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice Runs the venue and a crew against the REAL Chainlink AVAX/USD and BTC/USD feeds on a Fuji fork.
///         Opt-in (it needs the public Fuji RPC): FORK=1 forge test --match-contract FujiForkTest
///         Feed addresses: Chainlink's Avalanche Fuji data feed directory
///         (https://reference-data-directory.vercel.app/feeds-avalanche-fuji-testnet.json, as listed on
///         https://docs.chain.link/data-feeds/price-feeds/addresses?network=avalanche).
contract FujiForkTest is Test {
    address constant AVAX_USD = 0x5498BB86BC934c8D34FDA08E81D444153d0D06aD; // heartbeat 600 s, 1% deviation
    address constant BTC_USD = 0x31CF013A08c6Ac228C94551d535d5BAfE19c602a; // heartbeat 86400 s, 1% deviation

    TestUSDC usdc;
    KumiPerps perps;
    KumiCrew crew;
    address maker = makeAddr("maker");
    address a = makeAddr("a");
    address b = makeAddr("b");

    function setUp() public {
        if (!vm.envOr("FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("fuji");
        usdc = new TestUSDC();
        perps = new KumiPerps(address(usdc));
        perps.listMarket("AVAX-USD", AVAX_USD, 1800, 1000, 500, 500, 100, 1e5, 1e16);
        perps.listMarket("BTC-USD", BTC_USD, 90000, 1000, 500, 500, 100, 1e8, 1e13);
        KumiCrewFactory f = new KumiCrewFactory(perps, address(new KumiCrew()));
        address[] memory ms = new address[](2);
        ms[0] = a;
        ms[1] = b;
        KumiCrew.Policy memory p = KumiCrew.Policy(5001, 1 days, 5, 100, 2, 1000, 2);
        vm.prank(a);
        crew = KumiCrew(f.createCrew("Fork crew", ms, a, p));
        address[3] memory who = [maker, a, b];
        for (uint256 i = 0; i < 3; i++) {
            usdc.mint(who[i], 1_000_000e6);
            vm.startPrank(who[i]);
            usdc.approve(address(perps), type(uint256).max);
            usdc.approve(address(crew), type(uint256).max);
            vm.stopPrank();
        }
    }

    function test_realFeedsAreLiveAndScaled() public view {
        (uint256 avax, uint256 t1) = perps.oraclePrice(0);
        (uint256 btc,) = perps.oraclePrice(1);
        assertGt(avax, 1e8, "AVAX above $1");
        assertLt(avax, 1_000e8);
        assertGt(btc, 1_000e8, "BTC above $1k");
        assertLe(block.timestamp - t1, 1800);
    }

    function test_crewOpensLongAgainstRealOracle() public {
        (uint256 o,) = perps.oraclePrice(0);
        uint64 mid = uint64(o - o % 1e5);
        vm.startPrank(maker);
        perps.deposit(200_000e6);
        for (uint64 i = 1; i <= 5; i++) {
            perps.placeOrder(0, true, mid - i * 1e5 * 10, 200e18, 0);
            perps.placeOrder(0, false, mid + i * 1e5 * 10, 200e18, 0);
        }
        vm.stopPrank();
        vm.prank(a);
        crew.deposit(400e6); // a alone (40%) cannot pass the vote
        vm.prank(b);
        crew.deposit(600e6);
        vm.prank(a);
        uint256 id = crew.pitch(KumiCrew.Kind.Open, 0, true, 3, 2000, address(0), "/long AVAX 3x 20%");
        vm.prank(b);
        crew.vote(id, true);
        KumiPerps.PositionView[] memory ps = perps.positionsOf(address(crew));
        assertEq(ps.length, 1);
        assertGt(ps[0].size, 0);
        assertApproxEqRel(ps[0].notional, 600e6, 0.02e18, "3x of 20% of $1,000");
        assertEq(ps[0].mark, o, "marked at Chainlink");
    }

    /// The real BTC feed updates on 1% deviation or every 24 h: a crew trade is refused once it is older than maxAge.
    function test_staleRealFeedIsRefused() public {
        vm.warp(block.timestamp + 90001);
        vm.expectRevert();
        perps.oraclePrice(1);
    }
}
