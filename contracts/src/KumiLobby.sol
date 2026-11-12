// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KumiPerps} from "./KumiPerps.sol";

/// @title KumiLobby: public Kumi group chats that anyone can join.
/// @notice Crew vaults (KumiCrew) are invite-only and trade by vote. The lobby is the open side of Kumi: public
///         channels where people chat and post trade calls ("Long AVAX 3x, 50 tUSDC"). Anyone in the channel can
///         copy a call by placing their own order on KumiPerps from their own account. They then post a Copy, and
///         the lobby checks it against the venue: the copier must hold that side of that market right now. The size
///         and entry price written into the chat come from KumiPerps, not from the copier.
contract KumiLobby {
    enum Kind {
        Chat,
        Call,
        Copy,
        Join,
        Leave
    }

    struct Channel {
        string name;
        string topic;
        address creator;
        uint8 market; // the market the channel talks about (its default for calls)
        uint40 createdAt;
        uint32 memberCount;
    }

    struct Message {
        Kind kind;
        address who;
        uint40 ts;
        uint64 blockNumber;
        uint32 ref; // Copy: index of the call it copies
        uint8 market;
        bool isLong;
        uint8 leverage;
        uint64 price; // Call: Chainlink price when called (0 if the feed was stale). Copy: the copier's entry.
        uint128 size; // Copy: the copier's position size on the venue (1e18)
        uint128 margin; // Call: suggested margin in tUSDC (1e6)
        bytes32 orderTx; // Copy: the copier's order transaction, for the explorer link (informational)
        string text;
    }

    uint256 public constant MAX_TEXT = 280;
    uint256 public constant MAX_NAME = 32;
    uint256 public constant MAX_TOPIC = 140;
    uint8 public constant MAX_LEVERAGE = 10;

    KumiPerps public immutable perps;

    Channel[] internal channels;
    mapping(uint256 => Message[]) internal messages;
    mapping(uint256 => address[]) internal memberList;
    mapping(uint256 => mapping(address => uint256)) internal memberSlot; // index + 1, 0 = not a member
    mapping(address => uint256[]) internal joined;
    mapping(address => mapping(uint256 => uint256)) internal joinedSlot; // index + 1
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public copied; // channel => call => who
    mapping(uint256 => mapping(uint256 => uint32)) public copyCount; // channel => call => copies

    event ChannelCreated(uint256 indexed channel, string name, address indexed creator, uint8 market);
    event Posted(uint256 indexed channel, uint256 indexed index, Kind indexed kind, address who, uint32 ref);

    error UnknownChannel();
    error NotInChannel();
    error AlreadyInChannel();
    error BadText();
    error BadName();
    error UnknownMarket();
    error BadLeverage();
    error ZeroMargin();
    error NotACall();
    error OwnCall();
    error AlreadyCopied();
    error NoMatchingPosition();

    constructor(KumiPerps perps_) {
        perps = perps_;
    }

    // ================================================================ channels
    function createChannel(string calldata name, string calldata topic, uint8 market) external returns (uint256 id) {
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME) revert BadName();
        if (bytes(topic).length > MAX_TOPIC) revert BadText();
        if (market >= perps.marketCount()) revert UnknownMarket();
        id = channels.length;
        channels.push(Channel({name: name, topic: topic, creator: msg.sender, market: market, createdAt: uint40(block.timestamp), memberCount: 0}));
        emit ChannelCreated(id, name, msg.sender, market);
        _join(id, msg.sender);
    }

    function join(uint256 id) external {
        if (id >= channels.length) revert UnknownChannel();
        if (memberSlot[id][msg.sender] != 0) revert AlreadyInChannel();
        _join(id, msg.sender);
    }

    function leave(uint256 id) external onlyIn(id) {
        // swap-and-pop in both directions
        uint256 i = memberSlot[id][msg.sender] - 1;
        address[] storage ms = memberList[id];
        address last = ms[ms.length - 1];
        ms[i] = last;
        memberSlot[id][last] = i + 1;
        ms.pop();
        memberSlot[id][msg.sender] = 0;

        uint256 j = joinedSlot[msg.sender][id] - 1;
        uint256[] storage js = joined[msg.sender];
        uint256 lastId = js[js.length - 1];
        js[j] = lastId;
        joinedSlot[msg.sender][lastId] = j + 1;
        js.pop();
        joinedSlot[msg.sender][id] = 0;

        channels[id].memberCount--;
        Message storage m = _post(id, Kind.Leave, 0, "");
        m.market = channels[id].market;
    }

    // ================================================================ messages
    function say(uint256 id, string calldata text) external onlyIn(id) {
        if (bytes(text).length == 0 || bytes(text).length > MAX_TEXT) revert BadText();
        Message storage m = _post(id, Kind.Chat, 0, text);
        m.market = channels[id].market;
    }

    /// @notice A trade call: "Long AVAX 3x with 50 tUSDC". It moves no money; it is a card others can copy.
    function call(uint256 id, uint8 market, bool isLong, uint8 leverage, uint128 margin, string calldata note)
        external
        onlyIn(id)
        returns (uint256 index)
    {
        if (market >= perps.marketCount()) revert UnknownMarket();
        if (leverage == 0 || leverage > MAX_LEVERAGE) revert BadLeverage();
        if (margin == 0) revert ZeroMargin();
        if (bytes(note).length > MAX_TEXT) revert BadText();
        index = messages[id].length;
        Message storage m = _post(id, Kind.Call, 0, note);
        m.market = market;
        m.isLong = isLong;
        m.leverage = leverage;
        m.margin = margin;
        try perps.oraclePrice(market) returns (uint256 p, uint256) {
            m.price = uint64(p);
        } catch {
            m.price = 0; // stale or bad feed: the card says "no Chainlink price"
        }
    }

    /// @notice Records that the caller copied call `callIndex`. The caller must already hold that side of that market
    ///         on KumiPerps; the size and entry price stored here are read from the venue.
    function copy(uint256 id, uint256 callIndex, bytes32 orderTx) external onlyIn(id) {
        Message[] storage list = messages[id];
        if (callIndex >= list.length || list[callIndex].kind != Kind.Call) revert NotACall();
        Message storage c = list[callIndex];
        if (c.who == msg.sender) revert OwnCall();
        if (copied[id][callIndex][msg.sender]) revert AlreadyCopied();
        (int128 size, uint64 entry,) = perps.positions(msg.sender, c.market);
        if (size == 0 || (size > 0) != c.isLong) revert NoMatchingPosition();
        copied[id][callIndex][msg.sender] = true;
        copyCount[id][callIndex]++;
        uint8 market = c.market;
        bool isLong = c.isLong;
        uint8 leverage = c.leverage;
        Message storage m = _post(id, Kind.Copy, uint32(callIndex), "");
        m.market = market;
        m.isLong = isLong;
        m.leverage = leverage;
        m.price = entry;
        m.size = uint128(size > 0 ? size : -size);
        m.orderTx = orderTx;
    }

    // ================================================================ views
    function channelCount() external view returns (uint256) { return channels.length; }

    function getChannel(uint256 id) external view returns (Channel memory) {
        if (id >= channels.length) revert UnknownChannel();
        return channels[id];
    }

    function allChannels() external view returns (Channel[] memory) { return channels; }

    function isMember(uint256 id, address who) external view returns (bool) { return memberSlot[id][who] != 0; }

    function membersOf(uint256 id) external view returns (address[] memory) { return memberList[id]; }

    function channelsOf(address who) external view returns (uint256[] memory) { return joined[who]; }

    function messageCount(uint256 id) external view returns (uint256) { return messages[id].length; }

    function getMessage(uint256 id, uint256 index) external view returns (Message memory) { return messages[id][index]; }

    /// @notice Messages [from, from + count), clipped to the end.
    function messageSlice(uint256 id, uint256 from, uint256 count) external view returns (Message[] memory out) {
        Message[] storage list = messages[id];
        if (from >= list.length) return new Message[](0);
        uint256 end = from + count > list.length ? list.length : from + count;
        out = new Message[](end - from);
        for (uint256 i = from; i < end; i++) out[i - from] = list[i];
    }

    // ================================================================ internals
    modifier onlyIn(uint256 id) {
        if (id >= channels.length) revert UnknownChannel();
        if (memberSlot[id][msg.sender] == 0) revert NotInChannel();
        _;
    }

    function _join(uint256 id, address who) internal {
        memberList[id].push(who);
        memberSlot[id][who] = memberList[id].length;
        joined[who].push(id);
        joinedSlot[who][id] = joined[who].length;
        channels[id].memberCount++;
        Message storage m = _post(id, Kind.Join, 0, "");
        m.market = channels[id].market;
    }

    function _post(uint256 id, Kind kind, uint32 ref, string memory text) internal returns (Message storage m) {
        uint256 index = messages[id].length;
        m = messages[id].push();
        m.kind = kind;
        m.who = msg.sender;
        m.ts = uint40(block.timestamp);
        m.blockNumber = uint64(block.number);
        m.ref = ref;
        if (bytes(text).length != 0) m.text = text;
        emit Posted(id, index, kind, msg.sender, ref);
    }
}
