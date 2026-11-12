// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CrewBase} from "./Base.t.sol";
import {KumiPerps} from "../src/KumiPerps.sol";
import {KumiCrew} from "../src/KumiCrew.sol";

contract KumiCrewTest is CrewBase {
    function setUp() public override {
        super.setUp();
        _chipIn(alice, 500e6);
        _chipIn(bob, 300e6);
        _chipIn(carol, 200e6);
    }

    // ------------------------------------------------------------ money in
    function test_depositsMintSharesAtNav() public view {
        assertEq(crew.shares(alice), 500e18);
        assertEq(crew.totalShares(), 1_000e18);
        assertEq(crew.nav(), 1_000e6);
        assertEq(perps.collateral(address(crew)), 1_000e6, "money sits as perps margin");
    }

    function test_depositWhilePositionOpen_pricedAtMarkedNav() public {
        uint256 id = _pitchLong(alice, AVAX, 3, 5000); // alice alone is 50%: needs one more
        _vote(bob, id, true);
        avaxFeed.set(21e8);
        int256 navBefore = crew.nav();
        uint256 tsBefore = crew.totalShares();
        _chipIn(carol, 100e6);
        uint256 minted = crew.shares(carol) - 200e18;
        assertEq(minted, 100e6 * tsBefore / uint256(navBefore));
    }

    function test_nonMembers_cannotChipInPitchVoteOrChat() public {
        usdc.mint(mallory, 1e9);
        vm.startPrank(mallory);
        usdc.approve(address(crew), type(uint256).max);
        vm.expectRevert(KumiCrew.NotMember.selector);
        crew.deposit(1e6);
        vm.expectRevert(KumiCrew.NotMember.selector);
        crew.pitch(KumiCrew.Kind.Open, AVAX, true, 2, 1000, address(0), "");
        vm.expectRevert(KumiCrew.NotMember.selector);
        crew.vote(0, true);
        vm.expectRevert(KumiCrew.NotMember.selector);
        crew.say("gm");
        vm.stopPrank();
    }

    // ------------------------------------------------------------ pitch, vote, open
    function test_pitchVoteOpensLong3xOnTheBook() public {
        // "/long AVAX 3x 20%": margin 20% of NAV ($200) x 3 = $600 of AVAX at ~$20 = 30 AVAX.
        uint256 id = _pitchLong(alice, AVAX, 3, 2000);
        (uint256 yes,, uint256 needed) = crew.tally(id);
        assertEq(yes, 500e18, "pitching is a yes vote");
        assertEq(needed, 500.1e18);
        (int256 s,) = _pos(address(crew), AVAX);
        assertEq(s, 0, "not executed below threshold");
        _vote(carol, id, true); // 700/1000
        (s,) = _pos(address(crew), AVAX);
        assertEq(s, 30e18);
        KumiCrew.Proposal memory p = crew.getProposal(id);
        assertTrue(p.executed);
        assertEq(p.filled, 30e18);
        assertEq(p.avgPrice, 20_01e6, "filled at the maker's best ask");
        vm.prank(bob);
        vm.expectRevert(KumiCrew.AlreadyExecuted.selector);
        crew.vote(id, true);
    }

    function test_decidingVote_withTooLittleGas_revertsInsteadOfSilentlyFailing() public {
        uint256 id = _pitchLong(alice, AVAX, 3, 2000);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KumiCrew.NeedMoreGas.selector, 2_500_000));
        crew.vote{gas: 1_000_000}(id, true);
        assertFalse(crew.getProposal(id).executed);
        _vote(bob, id, true);
        assertTrue(crew.getProposal(id).executed);
    }

    function test_noVotesBlock_andExecuteNeedsThreshold() public {
        uint256 id = _pitchLong(bob, AVAX, 2, 1000); // 300 yes
        _vote(carol, id, false);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KumiCrew.ThresholdNotMet.selector, 300e18, 500.1e18));
        crew.execute(id);
        (, uint256 no,) = crew.tally(id);
        assertEq(no, 200e18);
    }

    function test_doubleVoteAndLateVoteRevert() public {
        uint256 id = _pitchLong(carol, AVAX, 2, 1000);
        vm.prank(carol);
        vm.expectRevert(KumiCrew.AlreadyVoted.selector);
        crew.vote(id, true);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(bob);
        vm.expectRevert(KumiCrew.VotingClosed.selector);
        crew.vote(id, true);
        vm.prank(bob);
        vm.expectRevert(KumiCrew.VotingClosed.selector);
        crew.execute(id);
    }

    function test_leverageAbovePolicy_isRefusedAtPitch() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KumiCrew.LeverageAbovePolicy.selector, 6, 5));
        crew.pitch(KumiCrew.Kind.Open, AVAX, true, 6, 1000, address(0), "");
    }

    function test_crewWideLeverageCap_failsTheSecondTrade_voteStands() public {
        uint256 a = _pitchLong(alice, AVAX, 5, 6000); // 3x of equity
        _vote(bob, a, true);
        uint256 b = _pitchLong(alice, BTC, 5, 6000); // would bring the crew to 6x > 5x
        _vote(bob, b, true);
        KumiCrew.Proposal memory pb = crew.getProposal(b);
        assertFalse(pb.executed, "venue call reverted, vote kept");
        (int256 s,) = _pos(address(crew), BTC);
        assertEq(s, 0);
        vm.prank(bob);
        vm.expectRevert();
        crew.execute(b);
    }

    function test_executionFailure_keepsVote_andRetrySucceeds() public {
        // Empty the AVAX asks: the vote passes but there is nothing to buy.
        vm.startPrank(maker);
        perps.cancelOrders(perps.openOrders(maker, AVAX, 50));
        vm.stopPrank();
        uint256 id = _pitchLong(alice, AVAX, 2, 2000);
        _vote(bob, id, true);
        assertFalse(crew.getProposal(id).executed);
        uint256 n = crew.feedLength();
        KumiCrew.FeedItem[] memory last = crew.feedSlice(n - 1, 1);
        assertEq(uint256(last[0].kind), uint256(KumiCrew.FeedKind.ExecFailed));
        _ladder(maker, AVAX, 20e8, 1e6, 50e18, 3);
        vm.prank(carol);
        crew.execute(id);
        assertTrue(crew.getProposal(id).executed);
    }

    // ------------------------------------------------------------ close with PnL
    function test_closeAfterPriceMove_realisesPnl() public {
        uint256 id = _pitchLong(alice, AVAX, 3, 2000);
        _vote(bob, id, true); // 30 AVAX @ 20.01
        avaxFeed.set(21e8);
        _ladder(maker, AVAX, 21e8, 1e6, 50e18, 3); // the maker requotes around the new price
        vm.prank(bob);
        uint256 c = crew.pitch(KumiCrew.Kind.Close, AVAX, false, 0, 10_000, address(0), "/close AVAX");
        _vote(alice, c, true);
        KumiCrew.Proposal memory p = crew.getProposal(c);
        assertTrue(p.executed);
        // sold 30 at the best bid 20.99: (20.99 - 20.01) * 30 = $29.40
        assertEq(p.resultPnl, 29.4e6);
        assertEq(crew.nav(), 1_029.4e6);
        (int256 s,) = _pos(address(crew), AVAX);
        assertEq(s, 0);
    }

    // ------------------------------------------------------------ ragequit
    function test_ragequit_flat_paysExactShare() public {
        uint256 b = usdc.balanceOf(carol);
        vm.prank(carol);
        uint256 payout = crew.ragequit(200e18);
        assertEq(payout, 200e6);
        assertEq(usdc.balanceOf(carol) - b, 200e6);
        assertFalse(crew.isMember(carol), "full exit ends membership");
        assertEq(crew.nav(), 800e6);
    }

    function test_ragequit_whilePositionOpen_staysFairToTheRest() public {
        uint256 id = _pitchLong(alice, AVAX, 3, 5000); // 75 AVAX
        _vote(bob, id, true);
        avaxFeed.set(20_50e6);
        _ladder(maker, AVAX, 20_50e6, 1e6, 50e18, 3); // book follows the oracle (old crossing quotes self-cancel)
        int256 eqBefore = crew.nav();
        uint256 tsBefore = crew.totalShares();
        int256 ppsBefore = eqBefore * 1e18 / int256(tsBefore);
        (int256 sBefore,) = _pos(address(crew), AVAX);

        vm.prank(bob);
        uint256 payout = crew.ragequit(300e18); // 30%

        (int256 sAfter,) = _pos(address(crew), AVAX);
        assertEq(sAfter, sBefore - sBefore * 3 / 10, "30% of the position closed");
        int256 ppsAfter = crew.nav() * 1e18 / int256(crew.totalShares());
        // Members who stay keep their per-share equity (only lot rounding moves it).
        assertApproxEqAbs(ppsAfter, ppsBefore, 1e3, "remaining members unaffected");
        // Bob pays the spread of closing his slice: a bit less than 30% of marked equity.
        assertLt(payout, uint256(eqBefore) * 3 / 10);
        assertGt(payout, uint256(eqBefore) * 29 / 100);
    }

    function test_ragequit_intoStaleBook_leaverPaysTheGap() public {
        uint256 id = _pitchLong(alice, AVAX, 3, 5000);
        _vote(bob, id, true);
        avaxFeed.set(20_50e6); // the book still bids ~$19.99: selling there costs $0.51 per AVAX
        int256 ppsBefore = crew.nav() * 1e18 / int256(crew.totalShares());
        vm.prank(bob);
        crew.ragequit(300e18);
        int256 ppsAfter = crew.nav() * 1e18 / int256(crew.totalShares());
        assertApproxEqAbs(ppsAfter, ppsBefore, 1e3, "the gap is Bob's, not the crew's");
    }

    function test_ragequitter_voteNoLongerCounts() public {
        uint256 id = _pitchLong(bob, AVAX, 2, 1000); // bob 300 yes
        _vote(carol, id, true); // 500 yes of 1000: not past 50.01%
        vm.prank(bob);
        crew.ragequit(300e18);
        (uint256 yes,, uint256 needed) = crew.tally(id);
        assertEq(yes, 200e18, "bob's shares are gone");
        assertEq(needed, 350.07e18);
        vm.prank(carol);
        vm.expectRevert();
        crew.execute(id);
    }

    function test_lastMember_ragequitClosesEverything() public {
        uint256 id = _pitchLong(alice, AVAX, 2, 5000);
        _vote(bob, id, true);
        vm.prank(bob);
        crew.ragequit(300e18);
        vm.prank(carol);
        crew.ragequit(200e18);
        vm.prank(alice);
        crew.ragequit(500e18);
        (int256 s,) = _pos(address(crew), AVAX);
        assertEq(s, 0);
        assertEq(crew.totalShares(), 0);
        assertEq(perps.collateral(address(crew)), 0, "nothing left behind");
    }

    function test_ragequit_moreThanOwned_reverts() public {
        vm.prank(carol);
        vm.expectRevert(KumiCrew.NoShares.selector);
        crew.ragequit(201e18);
    }

    // ------------------------------------------------------------ captain
    function test_captain_tradesWithinLimitsOnly() public {
        vm.prank(bob);
        vm.expectRevert(KumiCrew.NotCaptain.selector);
        crew.captainOpen(AVAX, true, 2, 1000, "");
        vm.startPrank(alice);
        vm.expectRevert(KumiCrew.CaptainLimit.selector);
        crew.captainOpen(AVAX, true, 3, 1000, "over captain leverage");
        vm.expectRevert(KumiCrew.CaptainLimit.selector);
        crew.captainOpen(AVAX, true, 2, 1001, "over captain size");
        crew.captainOpen(AVAX, true, 2, 1000, "scalp");
        crew.captainClose(AVAX, "done");
        vm.expectRevert(KumiCrew.CaptainLimit.selector);
        crew.captainOpen(AVAX, true, 1, 500, "third trade today");
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        avaxFeed.set(20e8);
        vm.prank(alice);
        crew.captainOpen(AVAX, false, 1, 500, "new day");
    }

    function test_voteCanReplaceCaptain_andAddMember() public {
        vm.prank(bob);
        uint256 id = crew.pitch(KumiCrew.Kind.SetCaptain, 0, false, 0, 0, bob, "bob captains");
        _vote(carol, id, false);
        _vote(alice, id, true);
        assertEq(crew.captain(), bob);
        vm.prank(alice);
        uint256 add = crew.pitch(KumiCrew.Kind.AddMember, 0, false, 0, 0, mallory, "");
        _vote(bob, add, true);
        assertTrue(crew.isMember(mallory));
        assertEq(crew.members().length, 4);
    }

    // ------------------------------------------------------------ chat feed
    function test_chatFeed_recordsEverything() public {
        vm.prank(alice);
        crew.say("gm crew");
        uint256 id = _pitchLong(alice, AVAX, 3, 2000);
        _vote(bob, id, true);
        KumiCrew.FeedItem[] memory f = crew.feedSlice(0, 50);
        // 3 deposits, chat, pitch, alice's yes, bob's yes, executed
        assertEq(f.length, 8);
        assertEq(uint256(f[3].kind), uint256(KumiCrew.FeedKind.Chat));
        assertEq(f[3].text, "gm crew");
        assertEq(uint256(f[4].kind), uint256(KumiCrew.FeedKind.Pitch));
        assertEq(uint256(f[7].kind), uint256(KumiCrew.FeedKind.Executed));
        assertEq(f[7].blockNumber, block.number);
    }

    function test_implementationIsLocked_andCloneCannotBeReinitialised() public {
        KumiCrew impl = KumiCrew(factory.implementation());
        vm.expectRevert(bytes("initialized"));
        impl.initialize(perps, "x", new address[](1), address(0), _policy());
        vm.expectRevert(bytes("initialized"));
        crew.initialize(perps, "x", new address[](1), address(0), _policy());
    }
}
