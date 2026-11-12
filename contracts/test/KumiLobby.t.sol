// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {KumiLobby} from "../src/KumiLobby.sol";

contract KumiLobbyTest is Base {
    KumiLobby lobby;
    uint256 ch;

    function setUp() public override {
        super.setUp();
        lobby = new KumiLobby(perps);
        _deposit(maker, 500_000e6);
        _ladder(maker, AVAX, 20e8, 1e6, 50e18, 6); // $0.01 steps around $20
        vm.prank(alice);
        ch = lobby.createChannel("AVAX degens", "Perps calls on AVAX", AVAX);
    }

    function _join(address who) internal {
        vm.prank(who);
        lobby.join(ch);
    }

    function _call(address who, bool isLong) internal returns (uint256 i) {
        vm.prank(who);
        i = lobby.call(ch, AVAX, isLong, 3, 50e6, "breakout");
    }

    // ---------------------------------------------------------------- channels and membership
    function test_createJoinsCreatorAndPostsJoin() public view {
        KumiLobby.Channel memory c = lobby.getChannel(ch);
        assertEq(c.name, "AVAX degens");
        assertEq(c.creator, alice);
        assertEq(c.memberCount, 1);
        assertTrue(lobby.isMember(ch, alice));
        assertEq(lobby.messageCount(ch), 1);
        assertEq(uint8(lobby.getMessage(ch, 0).kind), uint8(KumiLobby.Kind.Join));
        assertEq(lobby.channelsOf(alice).length, 1);
    }

    function test_createRejectsBadNameAndUnknownMarket() public {
        vm.expectRevert(KumiLobby.BadName.selector);
        lobby.createChannel("", "", AVAX);
        vm.expectRevert(KumiLobby.BadName.selector);
        lobby.createChannel("a name that is far too long for a channel ok", "", AVAX);
        vm.expectRevert(KumiLobby.UnknownMarket.selector);
        lobby.createChannel("ETH", "", 7);
    }

    function test_joinTwiceReverts() public {
        _join(bob);
        vm.expectRevert(KumiLobby.AlreadyInChannel.selector);
        _join(bob);
        vm.expectRevert(KumiLobby.UnknownChannel.selector);
        vm.prank(bob);
        lobby.join(99);
    }

    function test_leaveRemovesBothWaysAndBlocksPosting() public {
        _join(bob);
        _join(carol);
        vm.prank(alice);
        lobby.leave(ch);
        assertFalse(lobby.isMember(ch, alice));
        assertEq(lobby.getChannel(ch).memberCount, 2);
        address[] memory ms = lobby.membersOf(ch);
        assertEq(ms.length, 2);
        assertTrue(ms[0] == carol || ms[1] == carol);
        assertEq(lobby.channelsOf(alice).length, 0);
        vm.prank(alice);
        vm.expectRevert(KumiLobby.NotInChannel.selector);
        lobby.say(ch, "still here?");
        // rejoin works and lands at the end
        _join(alice);
        assertEq(lobby.membersOf(ch)[2], alice);
    }

    function test_sayNeedsMembershipAndBoundedText() public {
        vm.prank(mallory);
        vm.expectRevert(KumiLobby.NotInChannel.selector);
        lobby.say(ch, "spam");
        vm.prank(alice);
        vm.expectRevert(KumiLobby.BadText.selector);
        lobby.say(ch, "");
        bytes memory big = new bytes(281);
        for (uint256 i = 0; i < big.length; i++) big[i] = "a";
        vm.prank(alice);
        vm.expectRevert(KumiLobby.BadText.selector);
        lobby.say(ch, string(big));
        vm.prank(alice);
        lobby.say(ch, "gm crew");
        KumiLobby.Message memory m = lobby.getMessage(ch, 1);
        assertEq(m.text, "gm crew");
        assertEq(m.who, alice);
        assertEq(m.blockNumber, block.number);
    }

    // ---------------------------------------------------------------- calls
    function test_callRecordsChainlinkPriceAndTerms() public {
        uint256 i = _call(alice, true);
        KumiLobby.Message memory m = lobby.getMessage(ch, i);
        assertEq(uint8(m.kind), uint8(KumiLobby.Kind.Call));
        assertEq(m.price, 20e8);
        assertEq(m.leverage, 3);
        assertEq(m.margin, 50e6);
        assertTrue(m.isLong);
        assertEq(m.text, "breakout");
    }

    function test_callValidatesLeverageMarginMarket() public {
        vm.startPrank(alice);
        vm.expectRevert(KumiLobby.BadLeverage.selector);
        lobby.call(ch, AVAX, true, 0, 50e6, "");
        vm.expectRevert(KumiLobby.BadLeverage.selector);
        lobby.call(ch, AVAX, true, 11, 50e6, "");
        vm.expectRevert(KumiLobby.ZeroMargin.selector);
        lobby.call(ch, AVAX, true, 3, 0, "");
        vm.expectRevert(KumiLobby.UnknownMarket.selector);
        lobby.call(ch, 9, true, 3, 50e6, "");
        vm.stopPrank();
    }

    function test_callOnStaleFeedStoresZeroPrice() public {
        vm.warp(block.timestamp + 2 hours); // AVAX maxAge is 1 h in the test market
        uint256 i = _call(alice, true);
        assertEq(lobby.getMessage(ch, i).price, 0);
    }

    // ---------------------------------------------------------------- copies, checked against the venue
    function test_copyAfterRealFillRecordsVenueEntryAndSize() public {
        uint256 i = _call(alice, true);
        _join(bob);
        _deposit(bob, 50e6);
        _market(bob, AVAX, true, 7.5e18); // 7.5 AVAX ≈ $150 notional = 3x on 50 tUSDC
        (int256 size, uint64 entry) = _pos(bob, AVAX);
        vm.prank(bob);
        lobby.copy(ch, i, keccak256("order tx"));
        KumiLobby.Message memory m = lobby.getMessage(ch, lobby.messageCount(ch) - 1);
        assertEq(uint8(m.kind), uint8(KumiLobby.Kind.Copy));
        assertEq(m.ref, i);
        assertEq(int256(uint256(m.size)), size);
        assertEq(m.price, entry);
        assertEq(m.price, 20.01e8); // best ask from the maker ladder
        assertEq(m.orderTx, keccak256("order tx"));
        assertEq(lobby.copyCount(ch, i), 1);
        assertTrue(lobby.copied(ch, i, bob));
    }

    function test_copyWithoutPositionReverts() public {
        uint256 i = _call(alice, true);
        _join(bob);
        vm.prank(bob);
        vm.expectRevert(KumiLobby.NoMatchingPosition.selector);
        lobby.copy(ch, i, bytes32(0));
    }

    function test_copyWithWrongSideReverts() public {
        uint256 i = _call(alice, true);
        _join(bob);
        _deposit(bob, 50e6);
        _market(bob, AVAX, false, 2e18); // short, but the call is long
        vm.prank(bob);
        vm.expectRevert(KumiLobby.NoMatchingPosition.selector);
        lobby.copy(ch, i, bytes32(0));
    }

    function test_copyTwiceOwnCallAndNonCallRevert() public {
        uint256 i = _call(alice, false);
        _join(bob);
        _deposit(bob, 50e6);
        _market(bob, AVAX, false, 2e18);
        vm.prank(bob);
        lobby.copy(ch, i, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(KumiLobby.AlreadyCopied.selector);
        lobby.copy(ch, i, bytes32(0));
        _deposit(alice, 50e6);
        _market(alice, AVAX, false, 2e18);
        vm.prank(alice);
        vm.expectRevert(KumiLobby.OwnCall.selector);
        lobby.copy(ch, i, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(KumiLobby.NotACall.selector);
        lobby.copy(ch, 0, bytes32(0)); // index 0 is alice's join
        vm.prank(bob);
        vm.expectRevert(KumiLobby.NotACall.selector);
        lobby.copy(ch, 999, bytes32(0));
    }

    function test_outsiderCannotCopy() public {
        uint256 i = _call(alice, true);
        _deposit(mallory, 50e6);
        _market(mallory, AVAX, true, 1e18);
        vm.prank(mallory);
        vm.expectRevert(KumiLobby.NotInChannel.selector);
        lobby.copy(ch, i, bytes32(0));
    }

    function test_messageSliceClipsToEnd() public {
        vm.startPrank(alice);
        lobby.say(ch, "one");
        lobby.say(ch, "two");
        vm.stopPrank();
        KumiLobby.Message[] memory s = lobby.messageSlice(ch, 1, 10);
        assertEq(s.length, 2);
        assertEq(s[1].text, "two");
        assertEq(lobby.messageSlice(ch, 5, 10).length, 0);
    }

    function testFuzz_onlyMembersPost(address who) public {
        vm.assume(who != alice);
        vm.prank(who);
        vm.expectRevert(KumiLobby.NotInChannel.selector);
        lobby.say(ch, "hi");
    }
}
