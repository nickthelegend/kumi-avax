// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {PrimitOrderlyAccount, IOrderlyVault, IERC20P} from "../src/venues/PrimitOrderlyAccount.sol";

/// @notice Simulation only, on an Avalanche C-Chain MAINNET fork (no transaction is ever broadcast):
///         FORK=1 forge test --match-contract PrimitForkTest
///         It exercises the real Orderly Vault that Primit deposits into: the account id it validates, the AVAX
///         deposit fee, a USDC deposit and the delegate-signer registration. Orders themselves are off-chain at
///         Orderly and cannot be simulated on a fork.
contract PrimitForkTest is Test {
    IOrderlyVault constant VAULT = IOrderlyVault(0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9);
    IERC20P constant USDC = IERC20P(0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E);
    PrimitOrderlyAccount acct;
    address crew = makeAddr("crew");
    address signer = makeAddr("signer-eoa");

    function setUp() public {
        if (!vm.envOr("FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("avax");
        acct = new PrimitOrderlyAccount(VAULT, USDC, crew);
        deal(address(USDC), crew, 50e6);
        vm.deal(crew, 1 ether);
        vm.prank(crew);
        USDC.approve(address(acct), type(uint256).max);
    }

    function test_vaultIsLiveAndChargesADepositFee() public view {
        assertTrue(address(VAULT).code.length > 0);
        assertTrue(VAULT.depositFeeEnabled());
        uint256 fee = acct.depositFee(20e6);
        assertGt(fee, 0, "LayerZero fee in AVAX");
        assertLt(fee, 1 ether);
    }

    function test_crewFundsItsOrderlyAccount() public {
        uint256 fee = acct.depositFee(20e6);
        uint256 vaultBefore = USDC.balanceOf(address(VAULT));
        vm.recordLogs();
        vm.prank(crew);
        acct.fund{value: fee}(20e6);
        assertEq(USDC.balanceOf(address(VAULT)) - vaultBefore, 20e6, "USDC reached Orderly's vault");
        // AccountDepositTo(bytes32 indexed accountId, bytes32 indexed brokerHash, address indexed userAddress, ...)
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(VAULT) && logs[i].topics.length == 4 && logs[i].topics[1] == acct.accountId()) {
                assertEq(logs[i].topics[2], keccak256("primit"));
                assertEq(address(uint160(uint256(logs[i].topics[3]))), address(acct));
                seen = true;
            }
        }
        assertTrue(seen, "deposit credited to the contract's own primit account");
    }

    function test_depositWithoutFeeIsRefused() public {
        vm.prank(crew);
        vm.expectRevert();
        acct.fund(20e6);
    }

    function test_wrongAccountIdIsRefusedByOrderly() public {
        deal(address(USDC), address(this), 10e6);
        USDC.approve(address(VAULT), 10e6);
        IOrderlyVault.VaultDepositFE memory d = acct.depositData(10e6); // the adapter's id, but sent from this test
        vm.expectRevert();
        VAULT.deposit{value: 0.1 ether}(d);
    }

    function test_crewNamesADelegateSigner() public {
        vm.recordLogs();
        vm.prank(crew);
        acct.setDelegate(signer);
        assertEq(acct.delegate(), signer);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs[0].emitter, address(VAULT), "AccountDelegate from Orderly's vault");
    }

    function test_onlyTheCrewControlsTheAccount() public {
        vm.expectRevert(PrimitOrderlyAccount.NotOwner.selector);
        acct.setDelegate(signer);
        vm.expectRevert(PrimitOrderlyAccount.NotOwner.selector);
        acct.sweep();
    }

    function test_delegateMustBeAnEoa() public {
        vm.prank(crew);
        vm.expectRevert();
        acct.setDelegate(address(USDC));
    }
}
