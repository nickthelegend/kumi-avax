// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev The parts of Orderly Network's Vault (github.com/OrderlyNetwork/contract-evm, src/vaultSide/Vault.sol) that
///      a contract account uses. On Avalanche C-Chain the Vault proxy is 0x816f722424b49cf1275cc86da9840fbd5a6167e9
///      (from Orderly's public /v1/public/chain_info?broker_id=primit). Primit (app.primit.io) is the Orderly broker
///      "primit": it has no order book contract of its own.
interface IOrderlyVault {
    struct VaultDepositFE {
        bytes32 accountId;
        bytes32 brokerHash;
        bytes32 tokenHash;
        uint128 tokenAmount;
    }

    struct VaultDelegate {
        bytes32 brokerHash;
        address delegateSigner;
    }

    function deposit(VaultDepositFE calldata data) external payable;
    function getDepositFee(address receiver, VaultDepositFE calldata data) external view returns (uint256);
    function delegateSigner(VaultDelegate calldata data) external;
    function depositFeeEnabled() external view returns (bool);
}

interface IERC20P {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title PrimitOrderlyAccount: the on-chain half of a crew's route to Primit perps on Avalanche mainnet.
/// @notice What is possible on-chain: hold the crew's USDC, deposit it into Orderly's Vault for this contract's own
///         Orderly account (broker "primit"), and name one EOA as its delegate signer. What is NOT possible on-chain:
///         placing, cancelling or closing orders. Orderly matches off-chain; orders go to its REST API signed with an
///         ed25519 key that the delegate EOA registers for this contract's account. Withdrawals can only return to
///         this contract (Orderly's Ledger enforces receiver == the contract), and `sweep` sends them to the owner.
///         So a crew vote can control the money in and out, but trading on Primit needs an off-chain agent the crew
///         trusts with that key. Kumi's product venue is therefore its own on-chain book on Fuji.
contract PrimitOrderlyAccount {
    IOrderlyVault public immutable vault;
    IERC20P public immutable usdc;
    bytes32 public constant BROKER_HASH = keccak256("primit");
    bytes32 public constant TOKEN_HASH = keccak256("USDC");
    address public owner; // the crew (or whoever deployed it, until handed over)
    address public delegate;

    event Funded(uint256 amount, uint256 feePaid, bytes32 accountId);
    event DelegateSet(address indexed signer);
    event Swept(address indexed to, uint256 amount);
    event OwnerChanged(address indexed owner);

    error NotOwner();

    constructor(IOrderlyVault vault_, IERC20P usdc_, address owner_) {
        vault = vault_;
        usdc = usdc_;
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice This contract's Orderly account id: keccak256(abi.encode(address, brokerHash)), as Orderly validates.
    function accountId() public view returns (bytes32) { return keccak256(abi.encode(address(this), BROKER_HASH)); }

    function depositData(uint128 amount) public view returns (IOrderlyVault.VaultDepositFE memory) {
        return IOrderlyVault.VaultDepositFE(accountId(), BROKER_HASH, TOKEN_HASH, amount);
    }

    /// @notice The LayerZero fee (in AVAX) Orderly charges for a deposit of `amount`.
    function depositFee(uint128 amount) external view returns (uint256) { return vault.getDepositFee(address(this), depositData(amount)); }

    /// @notice Pulls `amount` USDC from the owner and deposits it into Orderly for this contract's account.
    ///         msg.value pays Orderly's cross-chain fee; Orderly refunds any excess to this contract.
    function fund(uint128 amount) external payable onlyOwner {
        require(usdc.transferFrom(msg.sender, address(this), amount), "transfer");
        usdc.approve(address(vault), amount);
        vault.deposit{value: msg.value}(depositData(amount));
        emit Funded(amount, msg.value, accountId());
    }

    /// @notice Names the EOA that may register an Orderly trading key for this contract's account (step 1 of
    ///         Orderly's delegate-signer flow; steps 2-3 are signed REST calls by that EOA).
    function setDelegate(address signer) external onlyOwner {
        vault.delegateSigner(IOrderlyVault.VaultDelegate(BROKER_HASH, signer));
        delegate = signer;
        emit DelegateSet(signer);
    }

    /// @notice Returns USDC that Orderly withdrew back to this contract.
    function sweep() external onlyOwner {
        uint256 b = usdc.balanceOf(address(this));
        require(usdc.transfer(owner, b), "transfer");
        emit Swept(owner, b);
    }

    function setOwner(address o) external onlyOwner {
        owner = o;
        emit OwnerChanged(o);
    }

    receive() external payable {} // LayerZero fee refunds
}
