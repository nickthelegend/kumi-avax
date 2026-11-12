// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KumiPerps, AggregatorV3Interface} from "../src/KumiPerps.sol";
import {KumiCrew, KumiCrewFactory} from "../src/KumiCrew.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @dev A local price feed for unit tests only: it lets a test move the price or make it stale.
///      The Fuji fork test (FujiFork.t.sol) runs the same contracts against the real Chainlink feeds.
contract LocalFeed is AggregatorV3Interface {
    int256 public answer;
    uint256 public updatedAt;
    uint80 public round = 1;

    constructor(int256 a) { set(a); }

    function set(int256 a) public {
        answer = a;
        updatedAt = block.timestamp;
        round++;
    }

    function setAt(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
        round++;
    }

    function decimals() external pure returns (uint8) { return 8; }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answer, updatedAt, updatedAt, round);
    }
}

abstract contract Base is Test {
    TestUSDC usdc;
    KumiPerps perps;
    LocalFeed avaxFeed;
    LocalFeed btcFeed;
    uint8 constant IOC_F = 1; // KumiPerps.IOC (a literal, so vm.prank isn't spent on a getter call)
    uint8 constant RO_F = 2;
    uint8 constant PO_F = 4;
    uint8 constant AVAX = 0;
    uint8 constant BTC = 1;
    uint64 constant AVAX_TICK = 1e5; // $0.001
    uint128 constant AVAX_LOT = 1e16; // 0.01 AVAX
    uint64 constant BTC_TICK = 1e8; // $1
    uint128 constant BTC_LOT = 1e13; // 0.00001 BTC

    address maker = makeAddr("maker");
    address maker2 = makeAddr("maker2");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address mallory = makeAddr("mallory");
    address keeper = makeAddr("keeper");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new TestUSDC();
        perps = new KumiPerps(address(usdc));
        avaxFeed = new LocalFeed(20e8); // $20.00
        btcFeed = new LocalFeed(100_000e8); // $100,000
        perps.listMarket("AVAX-USD", address(avaxFeed), 3600, 1000, 500, 500, 100, AVAX_TICK, AVAX_LOT);
        perps.listMarket("BTC-USD", address(btcFeed), 93600, 1000, 500, 500, 100, BTC_TICK, BTC_LOT);
        address[7] memory who = [maker, maker2, alice, bob, carol, mallory, keeper];
        for (uint256 i = 0; i < who.length; i++) {
            usdc.mint(who[i], 1_000_000e6);
            vm.prank(who[i]);
            usdc.approve(address(perps), type(uint256).max);
        }
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(perps), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        perps.deposit(amount);
    }

    function _limit(address who, uint8 m, bool buy, uint64 price, uint128 size) internal returns (uint64 id) {
        vm.prank(who);
        (id,) = perps.placeOrder(m, buy, price, size, 0);
    }

    function _market(address who, uint8 m, bool buy, uint128 size) internal returns (KumiPerps.Fill memory f) {
        vm.prank(who);
        (, f) = perps.placeOrder(m, buy, 0, size, IOC_F);
    }

    /// @dev Maker quotes `n` levels each side around `mid`, `step` ticks apart, `size` per level.
    function _ladder(address who, uint8 m, uint64 mid, uint64 step, uint128 size, uint256 n) internal {
        for (uint256 i = 1; i <= n; i++) {
            _limit(who, m, true, mid - uint64(i) * step, size);
            _limit(who, m, false, mid + uint64(i) * step, size);
        }
    }

    function _size(int128 s) internal pure returns (int256) { return int256(s); }

    function _pos(address who, uint8 m) internal view returns (int256 size, uint64 entry) {
        (int128 s, uint64 e,) = perps.positions(who, m);
        return (int256(s), e);
    }
}

abstract contract CrewBase is Base {
    KumiCrewFactory factory;
    KumiCrew crew;

    function _policy() internal pure returns (KumiCrew.Policy memory p) {
        p.thresholdBps = 5001;
        p.votingPeriod = 1 days;
        p.maxLeverage = 5;
        p.maxSlippageBps = 100;
        p.captainMaxLeverage = 2;
        p.captainMaxBps = 1000;
        p.captainTradesPerDay = 2;
    }

    function setUp() public virtual override {
        super.setUp();
        KumiCrew impl = new KumiCrew();
        factory = new KumiCrewFactory(perps, address(impl));
        address[] memory ms = new address[](3);
        ms[0] = alice;
        ms[1] = bob;
        ms[2] = carol;
        vm.prank(alice);
        crew = KumiCrew(factory.createCrew("Night Owls", ms, alice, _policy()));
        address[3] memory who = [alice, bob, carol];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(who[i]);
            usdc.approve(address(crew), type(uint256).max);
        }
        // Liquidity: a maker with deep two-sided books on both markets.
        _deposit(maker, 500_000e6);
        _ladder(maker, AVAX, 20e8, 1e6, 50e18, 10); // $0.01 steps, 50 AVAX per level
        _ladder(maker, BTC, 100_000e8, 10e8, 1e17, 10); // $10 steps, 0.1 BTC per level
    }

    function _chipIn(address who, uint256 amount) internal {
        vm.prank(who);
        crew.deposit(amount);
    }

    function _pitchLong(address who, uint8 m, uint8 lev, uint16 bps) internal returns (uint256 id) {
        vm.prank(who);
        id = crew.pitch(KumiCrew.Kind.Open, m, true, lev, bps, address(0), "");
    }

    function _vote(address who, uint256 id, bool yes) internal {
        vm.prank(who);
        crew.vote(id, yes);
    }
}
