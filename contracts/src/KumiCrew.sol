// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KumiPerps} from "./KumiPerps.sol";

interface IERC20Crew {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

/// @title KumiCrew: a group chat that is a fund, trading perps by vote.
/// @notice Members chip tUSDC in for shares at the crew's net asset value. All money sits as margin in one
///         KumiPerps account owned by this contract. A member pitches a trade (`/long AVAX 3x 20%`); members vote
///         with their shares; once yes-shares pass the threshold the vault opens the position on the order book.
///         A captain may trade without a vote inside tighter limits. Any member can ragequit with an exact share,
///         even while positions are open: their slice of every position is closed and they take the equity that
///         slice leaves, so the members who stay keep exactly what they had per share.
///         The chat itself is on-chain: every message, pitch, vote and fill is a feed entry.
contract KumiCrew {
    uint256 internal constant BPS = 1e4;
    uint256 internal constant PX_SIZE = 1e20;
    uint256 public constant SHARE_SCALE = 1e12; // 1 tUSDC (1e6) buys 1e18 shares at the start
    uint256 public constant MAX_TEXT = 280;
    uint256 public constant MAX_MEMBERS = 24;

    enum Kind { Open, Close, SetCaptain, AddMember }
    enum FeedKind { Chat, Pitch, VoteYes, VoteNo, Executed, ExecFailed, Deposit, Ragequit, CaptainTrade, MemberAdded, Expired }

    struct Policy {
        uint16 thresholdBps; // yes shares needed, of all shares (5001 = majority)
        uint32 votingPeriod; // seconds a pitch stays open
        uint8 maxLeverage; // crew-wide cap on total notional / equity
        uint16 maxSlippageBps; // execution limit price vs oracle
        uint8 captainMaxLeverage;
        uint16 captainMaxBps; // max margin per captain trade, of NAV
        uint8 captainTradesPerDay;
    }

    struct Proposal {
        Kind kind;
        address proposer;
        uint8 market;
        bool isLong;
        uint8 leverage;
        uint16 sizeBps; // Open: margin as bps of NAV; Close: bps of the position
        address target; // SetCaptain / AddMember
        uint40 createdAt;
        uint40 deadline;
        bool executed;
        uint32 yesCount;
        uint32 noCount;
        int256 resultPnl; // Close: realised PnL
        uint128 filled;
        uint64 avgPrice;
        string note;
    }

    struct FeedItem {
        FeedKind kind;
        address who;
        uint40 ts;
        uint64 blockNumber;
        uint32 ref; // proposal id where relevant
        int256 amount; // deposit / payout / pnl, tUSDC units
        string text;
    }

    KumiPerps public perps;
    IERC20Crew public usdc;
    address public factory;
    bool public initialized;
    string public name;
    Policy public policy;
    address public captain;
    uint64 public captainDay;
    uint8 public captainTradesToday;

    address[] internal memberList;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    Proposal[] internal proposals;
    mapping(uint256 => address[]) internal voters;
    mapping(uint256 => mapping(address => int8)) public voteOf;
    FeedItem[] internal feed;
    uint256 private locked;

    event Feed(uint256 indexed index, FeedKind indexed kind, address indexed who, uint32 ref, int256 amount);
    event Pitched(uint256 indexed id, Kind kind, address indexed proposer);
    event Voted(uint256 indexed id, address indexed voter, bool support);
    event Executed(uint256 indexed id, uint128 filled, uint64 avgPrice, int256 realized);
    event ExecutionFailed(uint256 indexed id, bytes reason);
    event Deposited(address indexed member, uint256 amount, uint256 sharesMinted);
    event Ragequit(address indexed member, uint256 sharesBurned, uint256 payout);

    error NotMember();
    error Reentrancy();
    error TextTooLong();
    error BadProposal();
    error LeverageAbovePolicy(uint256 leverage, uint256 max);
    error AlreadyVoted();
    error NoShares();
    error VotingClosed();
    error AlreadyExecuted();
    error ThresholdNotMet(uint256 yesShares, uint256 needed);
    error CrewLeverageExceeded(uint256 notional, uint256 cap);
    error NotCaptain();
    error CaptainLimit();
    error ZeroAmount();
    error NothingToClose();
    error ExitCostExceedsShare();
    error OnlySelf();
    error TooManyMembers();

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember();
        _;
    }

    /// @dev The implementation is locked; crews are EIP-1167 clones initialised by the factory.
    constructor() { initialized = true; }

    function initialize(KumiPerps perps_, string calldata name_, address[] calldata members_, address captain_, Policy calldata policy_)
        external
    {
        require(!initialized, "initialized");
        initialized = true;
        locked = 1;
        require(members_.length > 0 && members_.length <= MAX_MEMBERS, "members");
        require(policy_.thresholdBps > 0 && policy_.thresholdBps <= BPS, "threshold");
        require(policy_.maxLeverage >= 1 && policy_.captainMaxLeverage <= policy_.maxLeverage, "leverage");
        require(policy_.votingPeriod >= 60 && policy_.maxSlippageBps > 0 && policy_.maxSlippageBps < 1000, "policy");
        perps = perps_;
        usdc = IERC20Crew(address(perps_.collateralToken()));
        factory = msg.sender;
        name = name_;
        policy = policy_;
        for (uint256 i = 0; i < members_.length; i++) {
            if (!isMember[members_[i]]) {
                isMember[members_[i]] = true;
                memberList.push(members_[i]);
            }
        }
        if (captain_ != address(0)) {
            require(isMember[captain_], "captain");
            captain = captain_;
        }
        usdc.approve(address(perps_), type(uint256).max);
    }

    // ================================================================ chat
    function say(string calldata text) external onlyMember {
        if (bytes(text).length == 0) revert BadProposal();
        _feed(FeedKind.Chat, msg.sender, 0, 0, text);
    }

    // ================================================================ money in / out
    /// @notice Chip in tUSDC. Shares are minted at the current NAV (perps equity marked at Chainlink).
    function deposit(uint256 amount) external onlyMember nonReentrant returns (uint256 minted) {
        if (amount == 0) revert ZeroAmount();
        int256 navNow = perps.equityOf(address(this));
        minted = totalShares == 0 || navNow <= 0 ? amount * SHARE_SCALE : amount * totalShares / uint256(navNow);
        require(minted > 0, "dust");
        require(usdc.transferFrom(msg.sender, address(this), amount), "transfer");
        perps.deposit(amount);
        shares[msg.sender] += minted;
        totalShares += minted;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount, minted);
        _feed(FeedKind.Deposit, msg.sender, 0, int256(amount), "");
    }

    /// @notice Leave with an exact share. While positions are open, `sharesToBurn / totalShares` of every
    ///         position is closed on the book first; the leaver pays that closing cost, so the members who stay
    ///         keep exactly (1 - s) of the equity they had. Leaving with every share ends your membership and vote.
    function ragequit(uint256 sharesToBurn) external nonReentrant returns (uint256 payout) {
        uint256 mine = shares[msg.sender];
        if (sharesToBurn == 0 || sharesToBurn > mine) revert NoShares();
        uint256 T = totalShares;
        int256 eqBefore = perps.equityOf(address(this));
        uint256 n = perps.marketCount();
        for (uint8 i = 0; i < n; i++) {
            (int128 size,,) = perps.positions(address(this), i);
            if (size == 0) continue;
            uint256 abs = size > 0 ? uint256(int256(size)) : uint256(-int256(size));
            uint256 slice = sharesToBurn == T ? abs : abs * sharesToBurn / T;
            uint128 lot = perps.getMarket(i).lot;
            slice -= slice % lot;
            if (slice == 0) continue;
            perps.placeOrder(i, size < 0, 0, uint128(slice), perps.IOC() | perps.REDUCE_ONLY());
        }
        int256 eqAfter = perps.equityOf(address(this));
        int256 keep = eqBefore * int256(T - sharesToBurn) / int256(T);
        int256 p = eqAfter - keep;
        if (p < 0) revert ExitCostExceedsShare();
        payout = uint256(p);
        shares[msg.sender] = mine - sharesToBurn;
        totalShares = T - sharesToBurn;
        if (payout > 0) {
            perps.withdraw(payout);
            require(usdc.transfer(msg.sender, payout), "transfer");
        }
        totalWithdrawn += payout;
        if (shares[msg.sender] == 0) _removeMember(msg.sender);
        emit Ragequit(msg.sender, sharesToBurn, payout);
        _feed(FeedKind.Ragequit, msg.sender, 0, int256(payout), "");
    }

    // ================================================================ pitch + vote
    /// @notice `/long AVAX 3x 20%` = pitch(Open, market 0, true, 3, 2000, 0x0, note).
    ///         `/close AVAX` = pitch(Close, 0, false, 0, 10000, 0x0, note).
    function pitch(Kind kind, uint8 market, bool isLong, uint8 leverage, uint16 sizeBps, address target, string calldata note)
        external
        onlyMember
        returns (uint256 id)
    {
        if (bytes(note).length > MAX_TEXT) revert TextTooLong();
        if (kind == Kind.Open) {
            if (market >= perps.marketCount() || sizeBps == 0 || sizeBps > BPS || leverage == 0) revert BadProposal();
            if (leverage > policy.maxLeverage) revert LeverageAbovePolicy(leverage, policy.maxLeverage);
        } else if (kind == Kind.Close) {
            if (market >= perps.marketCount() || sizeBps == 0 || sizeBps > BPS) revert BadProposal();
        } else if (kind == Kind.SetCaptain) {
            if (target != address(0) && !isMember[target]) revert BadProposal();
        } else {
            if (target == address(0) || isMember[target]) revert BadProposal();
        }
        id = proposals.length;
        Proposal storage p = proposals.push();
        p.kind = kind;
        p.proposer = msg.sender;
        p.market = market;
        p.isLong = isLong;
        p.leverage = leverage;
        p.sizeBps = sizeBps;
        p.target = target;
        p.createdAt = uint40(block.timestamp);
        p.deadline = uint40(block.timestamp + policy.votingPeriod);
        p.note = note;
        emit Pitched(id, kind, msg.sender);
        _feed(FeedKind.Pitch, msg.sender, uint32(id), 0, note);
        if (shares[msg.sender] > 0) _vote(id, true); // pitching is a yes vote
    }

    /// @notice Vote with your shares. When yes-shares pass the threshold, the trade executes in the same
    ///         transaction; if the venue refuses it (no liquidity, margin) the vote stands and anyone may retry.
    function vote(uint256 id, bool support) external onlyMember {
        if (shares[msg.sender] == 0) revert NoShares();
        _vote(id, support);
    }

    /// @notice Executes a pitch whose yes-shares (recounted now, from current shareholders) pass the threshold.
    function execute(uint256 id) external onlyMember nonReentrant {
        _execute(id);
    }

    /// @dev Called by this contract (try/catch) so a failed execution doesn't undo the vote.
    function executeFromVote(uint256 id) external nonReentrant {
        if (msg.sender != address(this)) revert OnlySelf();
        _execute(id);
    }

    // ================================================================ captain lane
    function captainOpen(uint8 market, bool isLong, uint8 leverage, uint16 sizeBps, string calldata note) external nonReentrant {
        if (msg.sender != captain) revert NotCaptain();
        if (bytes(note).length > MAX_TEXT) revert TextTooLong();
        _captainBudget();
        if (leverage == 0 || leverage > policy.captainMaxLeverage || sizeBps == 0 || sizeBps > policy.captainMaxBps) revert CaptainLimit();
        KumiPerps.Fill memory f = _open(market, isLong, leverage, sizeBps);
        _feed(FeedKind.CaptainTrade, msg.sender, type(uint32).max, int256(uint256(f.filled)), note);
    }

    function captainClose(uint8 market, string calldata note) external nonReentrant {
        if (msg.sender != captain) revert NotCaptain();
        _captainBudget();
        KumiPerps.Fill memory f = _close(market, uint16(BPS));
        _feed(FeedKind.CaptainTrade, msg.sender, type(uint32).max, f.realized, note);
    }

    // ================================================================ views
    function members() external view returns (address[] memory) { return memberList; }

    function proposalCount() external view returns (uint256) { return proposals.length; }

    function getProposal(uint256 id) external view returns (Proposal memory) { return proposals[id]; }

    function votersOf(uint256 id) external view returns (address[] memory) { return voters[id]; }

    /// @notice Yes-shares counted from current shareholders, and the shares needed now.
    function tally(uint256 id) public view returns (uint256 yesShares, uint256 noShares, uint256 needed) {
        address[] storage vs = voters[id];
        for (uint256 i = 0; i < vs.length; i++) {
            int8 v = voteOf[id][vs[i]];
            if (v > 0) yesShares += shares[vs[i]];
            else if (v < 0) noShares += shares[vs[i]];
        }
        needed = (totalShares * policy.thresholdBps + BPS - 1) / BPS;
    }

    function feedLength() external view returns (uint256) { return feed.length; }

    function feedSlice(uint256 from, uint256 count) external view returns (FeedItem[] memory out) {
        uint256 len = feed.length;
        if (from >= len) return new FeedItem[](0);
        uint256 n = len - from < count ? len - from : count;
        out = new FeedItem[](n);
        for (uint256 i = 0; i < n; i++) out[i] = feed[from + i];
    }

    function nav() external view returns (int256) { return perps.equityOf(address(this)); }

    // ================================================================ internals
    function _vote(uint256 id, bool support) internal {
        if (id >= proposals.length) revert BadProposal();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp > p.deadline) revert VotingClosed();
        if (voteOf[id][msg.sender] != 0) revert AlreadyVoted();
        voteOf[id][msg.sender] = support ? int8(1) : int8(-1);
        voters[id].push(msg.sender);
        if (support) p.yesCount++;
        else p.noCount++;
        emit Voted(id, msg.sender, support);
        _feed(support ? FeedKind.VoteYes : FeedKind.VoteNo, msg.sender, uint32(id), int256(shares[msg.sender]), "");
        if (support) {
            (uint256 yes,, uint256 needed) = tally(id);
            if (yes >= needed && yes > 0) {
                try this.executeFromVote(id) {}
                catch (bytes memory reason) {
                    emit ExecutionFailed(id, reason);
                    _feed(FeedKind.ExecFailed, msg.sender, uint32(id), 0, "");
                }
            }
        }
    }

    function _execute(uint256 id) internal {
        if (id >= proposals.length) revert BadProposal();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp > p.deadline) revert VotingClosed();
        (uint256 yes,, uint256 needed) = tally(id);
        if (yes < needed || yes == 0) revert ThresholdNotMet(yes, needed);
        p.executed = true;
        KumiPerps.Fill memory f;
        if (p.kind == Kind.Open) {
            if (p.leverage > policy.maxLeverage) revert LeverageAbovePolicy(p.leverage, policy.maxLeverage);
            f = _open(p.market, p.isLong, p.leverage, p.sizeBps);
        } else if (p.kind == Kind.Close) {
            f = _close(p.market, p.sizeBps);
        } else if (p.kind == Kind.SetCaptain) {
            captain = p.target;
        } else {
            if (memberList.length >= MAX_MEMBERS) revert TooManyMembers();
            if (!isMember[p.target]) {
                isMember[p.target] = true;
                memberList.push(p.target);
            }
            _feed(FeedKind.MemberAdded, p.target, uint32(id), 0, "");
        }
        p.filled = f.filled;
        p.avgPrice = f.filled > 0 ? uint64(f.notional * PX_SIZE / f.filled) : 0;
        p.resultPnl = f.realized;
        emit Executed(id, f.filled, p.avgPrice, f.realized);
        _feed(FeedKind.Executed, p.proposer, uint32(id), p.kind == Kind.Close ? f.realized : int256(uint256(f.filled)), "");
    }

    function _open(uint8 market, bool isLong, uint8 leverage, uint16 sizeBps) internal returns (KumiPerps.Fill memory f) {
        int256 eq = perps.equityOf(address(this));
        if (eq <= 0) revert ZeroAmount();
        (uint256 o,) = perps.oraclePrice(market);
        uint256 margin = uint256(eq) * sizeBps / BPS;
        uint256 notional = margin * leverage;
        uint128 lot = perps.getMarket(market).lot;
        uint256 size = notional * PX_SIZE / o;
        size -= size % lot;
        if (size == 0) revert ZeroAmount();
        uint64 limit = _limit(market, isLong, o);
        (, f) = perps.placeOrder(market, isLong, limit, uint128(size), perps.IOC());
        if (f.filled == 0) revert NothingToClose();
        _checkCrewLeverage(eq);
    }

    function _close(uint8 market, uint16 bps) internal returns (KumiPerps.Fill memory f) {
        (int128 size,,) = perps.positions(address(this), market);
        if (size == 0) revert NothingToClose();
        uint256 abs = size > 0 ? uint256(int256(size)) : uint256(-int256(size));
        uint256 q = bps >= BPS ? abs : abs * bps / BPS;
        q -= q % perps.getMarket(market).lot;
        if (q == 0) revert NothingToClose();
        (uint256 o,) = perps.oraclePrice(market);
        (, f) = perps.placeOrder(market, size < 0, _limit(market, size < 0, o), uint128(q), perps.IOC() | perps.REDUCE_ONLY());
        if (f.filled == 0) revert NothingToClose();
    }

    /// @dev Limit price = oracle +- maxSlippage, on the market's tick, inside the venue's band.
    function _limit(uint8 market, bool isBuy, uint256 o) internal view returns (uint64) {
        KumiPerps.Market memory m = perps.getMarket(market);
        uint256 slip = policy.maxSlippageBps < m.bandBps ? policy.maxSlippageBps : m.bandBps;
        uint256 l = isBuy ? o * (BPS + slip) / BPS : o * (BPS - slip) / BPS;
        if (isBuy) l -= l % m.tick;
        else l += (m.tick - l % m.tick) % m.tick;
        return uint64(l);
    }

    /// @dev Crew-wide max-leverage policy: total notional of all positions <= equity x maxLeverage.
    ///      `eqBefore` is the equity before the trade, so the spread paid on entry doesn't count against it.
    function _checkCrewLeverage(int256 eqBefore) internal view {
        KumiPerps.PositionView[] memory ps = perps.positionsOf(address(this));
        uint256 total;
        for (uint256 i = 0; i < ps.length; i++) total += ps[i].notional;
        uint256 cap = eqBefore > 0 ? uint256(eqBefore) * policy.maxLeverage : 0;
        if (total > cap) revert CrewLeverageExceeded(total, cap);
    }

    function _captainBudget() internal {
        uint64 day = uint64(block.timestamp / 1 days);
        if (day != captainDay) {
            captainDay = day;
            captainTradesToday = 0;
        }
        if (captainTradesToday >= policy.captainTradesPerDay) revert CaptainLimit();
        captainTradesToday++;
    }

    function _removeMember(address who) internal {
        isMember[who] = false;
        for (uint256 i = 0; i < memberList.length; i++) {
            if (memberList[i] == who) {
                memberList[i] = memberList[memberList.length - 1];
                memberList.pop();
                break;
            }
        }
        if (captain == who) captain = address(0);
    }

    function _feed(FeedKind kind, address who, uint32 ref, int256 amount, string memory text) internal {
        if (bytes(text).length > MAX_TEXT) revert TextTooLong();
        uint256 index = feed.length;
        feed.push(FeedItem(kind, who, uint40(block.timestamp), uint64(block.number), ref, amount, text));
        emit Feed(index, kind, who, ref, amount);
    }
}

/// @title KumiCrewFactory: creates crews on one KumiPerps venue and lists them.
contract KumiCrewFactory {
    KumiPerps public immutable perps;
    address public immutable implementation;
    address[] public crews;
    mapping(address => address[]) internal crewsOf;

    event CrewCreated(address indexed crew, string name, address indexed creator, address[] members);

    constructor(KumiPerps perps_, address implementation_) {
        perps = perps_;
        implementation = implementation_;
    }

    function createCrew(string calldata name, address[] calldata members, address captain, KumiCrew.Policy calldata policy)
        external
        returns (address crew)
    {
        bool creatorIn;
        for (uint256 i = 0; i < members.length; i++) if (members[i] == msg.sender) creatorIn = true;
        require(creatorIn, "creator must be a member");
        crew = _clone(implementation);
        KumiCrew(crew).initialize(perps, name, members, captain, policy);
        crews.push(crew);
        for (uint256 i = 0; i < members.length; i++) crewsOf[members[i]].push(crew);
        emit CrewCreated(crew, name, msg.sender, members);
    }

    function crewCount() external view returns (uint256) { return crews.length; }

    /// @dev EIP-1167 minimal proxy.
    function _clone(address impl) internal returns (address instance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }

    function allCrews() external view returns (address[] memory) { return crews; }

    function crewsFor(address member) external view returns (address[] memory) { return crewsOf[member]; }
}
