// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @dev Chainlink's AggregatorV3Interface (only the parts Kumi reads).
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title KumiPerps: a small, fully on-chain order-book perpetuals market.
/// @notice Every order rests in, and matches against, an order book stored in this contract. Margin is one
///         collateral token (Kumi's Fuji tUSDC). Margin, unrealised PnL and liquidations are marked at the
///         Chainlink price; fills happen at book prices. Cross margin: one account covers all its markets.
///
///         Units: size is base units x 1e18 (1 AVAX = 1e18), price is USD x 1e8 (Chainlink's decimals),
///         money is collateral units (1e6). notional = size * price / 1e20.
///
///         Funding (simple): the premium of the book mid over the oracle, clamped to +-1%, is paid every 8 hours,
///         accrued per second. Longs pay shorts when the book trades above the oracle, and the reverse.
contract KumiPerps {
    // ---------------------------------------------------------------- constants
    uint256 internal constant BPS = 1e4;
    uint256 internal constant PX_SIZE = 1e20;
    int256 internal constant FUND_SCALE = 1e38; // size(1e18) * price(1e8) * premium(1e18) -> money(1e6)
    int256 internal constant PREMIUM_CAP = 1e16; // 1% (1e18 = 100%)
    uint256 public constant FUNDING_PERIOD = 8 hours;
    uint256 public constant MAX_FILLS = 32;
    uint256 public constant MAX_LEVELS = 96;
    uint256 public constant TRADE_RING = 64;
    uint8 public constant IOC = 1;
    uint8 public constant REDUCE_ONLY = 2;
    uint8 public constant POST_ONLY = 4;

    // ---------------------------------------------------------------- types
    struct Market {
        address oracle;
        uint32 maxAge; // oldest acceptable oracle update, seconds
        uint16 imBps; // initial margin (1000 = 10% = 10x max leverage)
        uint16 mmBps; // maintenance margin
        uint16 bandBps; // orders must be within this distance of the oracle
        uint16 liqFeeBps; // paid to the liquidator from the liquidated account
        uint64 tick; // price tick, 1e8 units
        uint128 lot; // size lot, 1e18 units
        int256 cumFunding; // cumulative funding per unit size, price(1e8) x 1e18
        uint64 lastFundingTs;
        uint64 lastPrice; // last fill price
        uint64 bestBid;
        uint64 bestAsk;
        uint32 bidLevels;
        uint32 askLevels;
        uint64 tradeCount;
        uint128 openInterest; // sum of long sizes
        string symbol;
    }

    struct Level {
        uint64 better; // next better price (0 = this is best)
        uint64 worse; // next worse price (0 = this is worst)
        uint64 head; // oldest order id
        uint64 tail; // newest order id
        uint128 total; // resting size
        uint32 count;
    }

    struct Order {
        address owner;
        uint8 market;
        bool isBuy;
        uint64 price;
        uint40 ts;
        uint128 size; // remaining
        uint128 reserved; // initial margin held for the remaining size
        uint64 prev;
        uint64 next;
    }

    struct Position {
        int128 size;
        uint64 entry;
        int256 fundingSnap;
    }

    struct Trade {
        uint64 price;
        uint128 size;
        bool takerBuy;
        uint40 ts;
    }

    struct Fill {
        uint128 filled;
        uint256 notional; // sum(size * price) / 1e20
        int256 realized; // taker's realised PnL
    }

    // ---------------------------------------------------------------- state
    IERC20Min public immutable collateralToken;
    address public owner;
    uint256 public insuranceFund;
    uint256 public badDebt;
    uint64 public nextOrderId = 1;
    uint256 private locked = 1;

    Market[] internal markets;
    mapping(uint8 => mapping(bool => mapping(uint64 => Level))) internal levels; // market => isBid => price
    mapping(uint64 => Order) public orders;
    mapping(uint8 => Trade[TRADE_RING]) internal tradeRing;

    mapping(address => int256) public collateral;
    mapping(address => uint256) public reservedIm;
    mapping(address => mapping(uint8 => Position)) public positions;

    // ---------------------------------------------------------------- events
    event MarketListed(uint8 indexed market, string symbol, address oracle);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event OrderPlaced(uint8 indexed market, uint64 indexed orderId, address indexed owner, bool isBuy, uint64 price, uint128 size);
    event OrderCancelled(uint8 indexed market, uint64 indexed orderId, address indexed owner, uint128 remaining, uint8 reason);
    event Filled(uint8 indexed market, uint64 indexed makerOrderId, address indexed maker, address taker, bool takerBuy, uint64 price, uint128 size);
    event FundingSettled(address indexed account, uint8 indexed market, int256 paid);
    event FundingAccrued(uint8 indexed market, int256 cumFunding, int256 premium1e18);
    event Liquidated(address indexed account, uint8 indexed market, address indexed liquidator, uint128 size, uint256 fee, int256 equityBefore);
    event BadDebt(address indexed account, uint256 covered, uint256 uncovered);
    event InsuranceFunded(address indexed from, uint256 amount);

    // ---------------------------------------------------------------- errors
    error NotOwner();
    error Reentrancy();
    error UnknownMarket();
    error StaleOracle(uint8 market, uint256 updatedAt);
    error BadOraclePrice(uint8 market);
    error BadTick();
    error BadLot();
    error OutsideBand(uint64 price, uint256 oracle);
    error InsufficientMargin(int256 equity, uint256 required);
    error ReduceOnlyViolated();
    error WouldCross();
    error TooManyLevels();
    error NotOrderOwner();
    error NoSuchOrder();
    error NotLiquidatable(int256 equity, uint256 maintenance);
    error NoPosition();
    error InsufficientCollateral();
    error ZeroAmount();
    error TransferFailed();

    // cancel reasons
    uint8 internal constant CANCEL_USER = 0;
    uint8 internal constant CANCEL_SELF_TRADE = 1;
    uint8 internal constant CANCEL_MAKER_MARGIN = 2;
    uint8 internal constant CANCEL_LIQUIDATION = 3;

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address collateral_) {
        collateralToken = IERC20Min(collateral_);
        owner = msg.sender;
    }

    // ================================================================ admin
    /// @notice Lists a market. Parameters are fixed once listed.
    function listMarket(
        string calldata symbol,
        address oracle,
        uint32 maxAge,
        uint16 imBps,
        uint16 mmBps,
        uint16 bandBps,
        uint16 liqFeeBps,
        uint64 tick,
        uint128 lot
    ) external returns (uint8 id) {
        if (msg.sender != owner) revert NotOwner();
        require(markets.length < 8, "max markets");
        require(AggregatorV3Interface(oracle).decimals() == 8, "oracle decimals");
        require(mmBps > 0 && mmBps < imBps && imBps <= BPS && bandBps > 0 && bandBps < BPS && tick > 0 && lot > 0, "params");
        id = uint8(markets.length);
        Market storage m = markets.push();
        m.oracle = oracle;
        m.maxAge = maxAge;
        m.imBps = imBps;
        m.mmBps = mmBps;
        m.bandBps = bandBps;
        m.liqFeeBps = liqFeeBps;
        m.tick = tick;
        m.lot = lot;
        m.lastFundingTs = uint64(block.timestamp);
        m.symbol = symbol;
        emit MarketListed(id, symbol, oracle);
    }

    /// @notice Anyone can add collateral to the insurance fund that covers bad debt.
    function fundInsurance(uint256 amount) external nonReentrant {
        _pull(amount);
        insuranceFund += amount;
        emit InsuranceFunded(msg.sender, amount);
    }

    // ================================================================ margin
    /// @notice Credits the caller's margin account. There is no deposit-for-others, so nobody can inflate
    ///         another account's equity.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pull(amount);
        collateral[msg.sender] += int256(amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraws free collateral. Funding is settled first; afterwards equity must still cover the
    ///         initial margin of open positions and resting orders.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256[] memory px = _priceCache();
        for (uint8 i = 0; i < markets.length; i++) {
            if (positions[msg.sender][i].size != 0) {
                _accrue(i, _px(px, i));
                _settleFunding(msg.sender, i);
            }
        }
        if (collateral[msg.sender] < int256(amount)) revert InsufficientCollateral();
        collateral[msg.sender] -= int256(amount);
        (int256 eq, uint256 im,) = _health(msg.sender, px);
        uint256 req = im + reservedIm[msg.sender];
        if (_hasPosition(msg.sender) || reservedIm[msg.sender] > 0) {
            if (eq < int256(req)) revert InsufficientMargin(eq, req);
        }
        if (!collateralToken.transfer(msg.sender, amount)) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ================================================================ orders
    /// @notice Places an order. `price` 0 with IOC is a market order bounded by the oracle band.
    ///         flags: IOC (1) never rests, REDUCE_ONLY (2) may only shrink the position, POST_ONLY (4) must rest.
    /// @return orderId the resting order (0 if nothing rests), and the taker fill.
    function placeOrder(uint8 market, bool isBuy, uint64 price, uint128 size, uint8 flags)
        external
        nonReentrant
        returns (uint64 orderId, Fill memory fill)
    {
        return _place(msg.sender, market, isBuy, price, size, flags, false);
    }

    function cancelOrder(uint64 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (o.size == 0) revert NoSuchOrder();
        if (o.owner != msg.sender) revert NotOrderOwner();
        _cancel(orderId, CANCEL_USER);
    }

    function cancelOrders(uint64[] calldata ids) external nonReentrant {
        for (uint256 i = 0; i < ids.length; i++) {
            Order storage o = orders[ids[i]];
            if (o.size == 0) continue;
            if (o.owner != msg.sender) revert NotOrderOwner();
            _cancel(ids[i], CANCEL_USER);
        }
    }

    // ================================================================ liquidation
    /// @notice Closes `account`'s position in `market` through the book when its equity is below the
    ///         maintenance margin of all its positions. Resting orders listed in `cancelIds` that belong to the
    ///         account are cancelled first. The liquidator earns liqFeeBps of the closed notional; a negative
    ///         balance left after the last position closes is covered by the insurance fund.
    function liquidate(address account, uint8 market, uint64[] calldata cancelIds) external nonReentrant returns (uint128 closed) {
        if (market >= markets.length) revert UnknownMarket();
        uint256[] memory px = _priceCache();
        (int256 eq,, uint256 mm) = _health(account, px);
        if (eq >= int256(mm)) revert NotLiquidatable(eq, mm);
        int256 s = positions[account][market].size;
        if (s == 0) revert NoPosition();
        for (uint256 i = 0; i < cancelIds.length; i++) {
            Order storage o = orders[cancelIds[i]];
            if (o.size > 0 && o.owner == account) _cancel(cancelIds[i], CANCEL_LIQUIDATION);
        }
        (, Fill memory f) = _place(account, market, s < 0, 0, uint128(_abs(s)), IOC | REDUCE_ONLY, true);
        closed = f.filled;
        uint256 fee = f.notional * markets[market].liqFeeBps / BPS;
        int256 c = collateral[account];
        uint256 paid = c > 0 ? (uint256(c) < fee ? uint256(c) : fee) : 0;
        if (paid > 0) {
            collateral[account] = c - int256(paid);
            collateral[msg.sender] += int256(paid);
        }
        emit Liquidated(account, market, msg.sender, closed, paid, eq);
        if (!_hasPosition(account) && collateral[account] < 0) {
            uint256 deficit = uint256(-collateral[account]);
            uint256 covered = deficit < insuranceFund ? deficit : insuranceFund;
            insuranceFund -= covered;
            badDebt += deficit - covered;
            collateral[account] = 0;
            emit BadDebt(account, covered, deficit - covered);
        }
    }

    /// @notice Accrues funding for a market (anyone can poke it; every trade does it too).
    function pokeFunding(uint8 market) external {
        if (market >= markets.length) revert UnknownMarket();
        _accrue(market, _oracle(market));
    }

    // ================================================================ views
    function marketCount() external view returns (uint256) { return markets.length; }

    function getMarket(uint8 market) external view returns (Market memory) { return markets[market]; }

    /// @notice Chainlink price and its update time; reverts if stale or non-positive.
    function oraclePrice(uint8 market) external view returns (uint256 price, uint256 updatedAt) {
        Market storage m = markets[market];
        (, int256 a,, uint256 t,) = AggregatorV3Interface(m.oracle).latestRoundData();
        if (a <= 0) revert BadOraclePrice(market);
        if (block.timestamp > t + m.maxAge) revert StaleOracle(market, t);
        return (uint256(a), t);
    }

    /// @notice Equity (collateral + unrealised PnL - unsettled funding), initial and maintenance requirement.
    function health(address account) external view returns (int256 equity, uint256 initialReq, uint256 maintenanceReq) {
        return _health(account, _priceCache());
    }

    function equityOf(address account) external view returns (int256 equity) {
        (equity,,) = _health(account, _priceCache());
    }

    struct PositionView {
        uint8 market;
        int128 size;
        uint64 entry;
        uint256 mark;
        int256 unrealized;
        int256 fundingOwed;
        uint256 notional;
        uint256 liqPrice; // approximate, holding other positions fixed (0 = none)
    }

    function positionsOf(address account) external view returns (PositionView[] memory out) {
        uint256[] memory px = _priceCache();
        uint256 n;
        for (uint8 i = 0; i < markets.length; i++) if (positions[account][i].size != 0) n++;
        out = new PositionView[](n);
        (int256 eq,, uint256 mm) = _health(account, px);
        uint256 k;
        for (uint8 i = 0; i < markets.length; i++) {
            Position storage p = positions[account][i];
            if (p.size == 0) continue;
            uint256 o = _px(px, i);
            int256 cum = markets[i].cumFunding + _pendingFunding(i, o);
            PositionView memory v;
            v.market = i;
            v.size = p.size;
            v.entry = p.entry;
            v.mark = o;
            v.unrealized = int256(p.size) * (int256(o) - int256(uint256(p.entry))) / int256(PX_SIZE);
            v.fundingOwed = int256(p.size) * (cum - p.fundingSnap) / FUND_SCALE;
            v.notional = _abs(p.size) * o / PX_SIZE;
            // liquidation when eq + size*(L - o)/1e20 = mm + (|size|*(L-o)/1e20)*mmBps (other legs fixed)
            int256 buffer = eq - int256(mm);
            int256 sz = int256(p.size);
            int256 denom = sz > 0 ? sz * int256(BPS - markets[i].mmBps) : sz * int256(BPS + markets[i].mmBps);
            int256 move = -buffer * int256(PX_SIZE) * int256(BPS) / denom;
            int256 l = int256(o) + move;
            v.liqPrice = l > 0 ? uint256(l) : 0;
            out[k++] = v;
        }
    }

    /// @notice Book depth, best first: price, resting size, order count per level.
    function depth(uint8 market, bool bids, uint256 maxLevels)
        external
        view
        returns (uint64[] memory prices, uint128[] memory sizes, uint32[] memory counts)
    {
        Market storage m = markets[market];
        uint256 n = bids ? m.bidLevels : m.askLevels;
        if (n > maxLevels) n = maxLevels;
        prices = new uint64[](n);
        sizes = new uint128[](n);
        counts = new uint32[](n);
        uint64 p = bids ? m.bestBid : m.bestAsk;
        for (uint256 i = 0; i < n && p != 0; i++) {
            Level storage l = levels[market][bids][p];
            prices[i] = p;
            sizes[i] = l.total;
            counts[i] = l.count;
            p = l.worse;
        }
    }

    /// @notice Up to TRADE_RING most recent fills, newest first.
    function recentTrades(uint8 market, uint256 max) external view returns (Trade[] memory out) {
        uint256 total = markets[market].tradeCount;
        uint256 n = total < TRADE_RING ? total : TRADE_RING;
        if (n > max) n = max;
        out = new Trade[](n);
        for (uint256 i = 0; i < n; i++) out[i] = tradeRing[market][(total - 1 - i) % TRADE_RING];
    }

    /// @notice Current funding: premium (1e18 = 100%) and the per-hour rate in 1e18 units, plus the index.
    function fundingInfo(uint8 market) external view returns (int256 premium1e18, int256 hourlyRate1e18, int256 cumFunding, uint64 lastTs) {
        Market storage m = markets[market];
        premium1e18 = _premium(market, _oracle(market));
        hourlyRate1e18 = premium1e18 * 1 hours / int256(FUNDING_PERIOD);
        cumFunding = m.cumFunding + _pendingFunding(market, _oracle(market));
        lastTs = m.lastFundingTs;
    }

    /// @notice An account's resting orders in a market (scans the book; for UIs and bots).
    function openOrders(address account, uint8 market, uint256 max) external view returns (uint64[] memory ids) {
        uint64[] memory tmp = new uint64[](max);
        uint256 n;
        for (uint256 side = 0; side < 2 && n < max; side++) {
            bool bids = side == 0;
            uint64 p = bids ? markets[market].bestBid : markets[market].bestAsk;
            while (p != 0 && n < max) {
                Level storage l = levels[market][bids][p];
                for (uint64 id = l.head; id != 0 && n < max; id = orders[id].next) if (orders[id].owner == account) tmp[n++] = id;
                p = l.worse;
            }
        }
        ids = new uint64[](n);
        for (uint256 i = 0; i < n; i++) ids[i] = tmp[i];
    }

    // ================================================================ internals: placing + matching
    function _place(address taker, uint8 market, bool isBuy, uint64 price, uint128 size, uint8 flags, bool liquidation)
        internal
        returns (uint64 orderId, Fill memory f)
    {
        if (market >= markets.length) revert UnknownMarket();
        Market storage m = markets[market];
        if (size == 0 || size % m.lot != 0) revert BadLot();
        uint256[] memory px = _priceCache();
        uint256 o = _px(px, market);
        uint256 lo = o * (BPS - m.bandBps) / BPS;
        uint256 hi = o * (BPS + m.bandBps) / BPS;
        uint64 limit;
        if (price == 0) {
            if (flags & IOC == 0) revert BadTick(); // a market order must be IOC
            limit = isBuy ? uint64(hi - hi % m.tick) : uint64(lo + (m.tick - lo % m.tick) % m.tick);
        } else {
            if (price % m.tick != 0) revert BadTick();
            if (price < lo || price > hi) revert OutsideBand(price, o);
            limit = price;
        }
        _accrue(market, o);

        int256 before = positions[taker][market].size;
        if (flags & REDUCE_ONLY != 0) {
            if (before == 0 || (before > 0) == isBuy) revert ReduceOnlyViolated();
            uint256 cap = _abs(before);
            if (size > cap) size = uint128(cap - cap % m.lot);
            if (size == 0) revert ReduceOnlyViolated();
        }
        if (flags & POST_ONLY != 0) {
            uint64 opp = isBuy ? m.bestAsk : m.bestBid;
            if (opp != 0 && (isBuy ? opp <= limit : opp >= limit)) revert WouldCross();
        }

        uint128 remaining = size;
        uint256 fills;
        while (remaining > 0 && fills < MAX_FILLS) {
            uint64 best = isBuy ? m.bestAsk : m.bestBid;
            if (best == 0 || (isBuy ? best > limit : best < limit)) break;
            Level storage lvl = levels[market][!isBuy][best];
            uint64 oid = lvl.head;
            Order storage mk = orders[oid];
            fills++;
            if (mk.owner == taker) { _cancel(oid, CANCEL_SELF_TRADE); continue; }
            uint128 q = remaining < mk.size ? remaining : mk.size;
            uint128 resFree = uint128(uint256(mk.reserved) * q / mk.size);
            if (!_makerOk(mk.owner, market, isBuy ? -int256(uint256(q)) : int256(uint256(q)), best, resFree, px)) {
                _cancel(oid, CANCEL_MAKER_MARGIN);
                continue;
            }
            address maker = mk.owner;
            // maker leg
            reservedIm[maker] -= resFree;
            mk.reserved -= resFree;
            mk.size -= q;
            lvl.total -= q;
            _applyFill(maker, market, isBuy ? -int256(uint256(q)) : int256(uint256(q)), best);
            // taker leg
            f.realized += _applyFill(taker, market, isBuy ? int256(uint256(q)) : -int256(uint256(q)), best);
            f.filled += q;
            f.notional += uint256(q) * best / PX_SIZE;
            remaining -= q;
            _recordTrade(market, best, q, isBuy);
            emit Filled(market, oid, maker, taker, isBuy, best, q);
            if (mk.size == 0) _unlink(oid);
        }

        // An exposure-increasing taker fill must leave the account above initial margin.
        int256 afterSize = positions[taker][market].size;
        if (!liquidation && _abs(afterSize) > _abs(before)) {
            (int256 eq, uint256 im,) = _health(taker, px);
            uint256 req = im + reservedIm[taker];
            if (eq < int256(req)) revert InsufficientMargin(eq, req);
        }

        if (remaining > 0 && flags & IOC == 0 && !liquidation) {
            orderId = _rest(taker, market, isBuy, limit, remaining, px);
        }
    }

    function _rest(address who, uint8 market, bool isBuy, uint64 price, uint128 size, uint256[] memory px) internal returns (uint64 id) {
        Market storage m = markets[market];
        uint256 reserve = (uint256(size) * price / PX_SIZE) * m.imBps / BPS + 1;
        (int256 eq, uint256 im,) = _health(who, px);
        uint256 req = im + reservedIm[who] + reserve;
        if (eq < int256(req)) revert InsufficientMargin(eq, req);
        reservedIm[who] += reserve;

        id = nextOrderId++;
        Order storage o = orders[id];
        o.owner = who;
        o.market = market;
        o.isBuy = isBuy;
        o.price = price;
        o.ts = uint40(block.timestamp);
        o.size = size;
        o.reserved = uint128(reserve);

        Level storage l = levels[market][isBuy][price];
        if (l.count == 0 && l.total == 0 && l.head == 0) _insertLevel(market, isBuy, price);
        if (l.tail == 0) {
            l.head = id;
        } else {
            orders[l.tail].next = id;
            o.prev = l.tail;
        }
        l.tail = id;
        l.total += size;
        l.count += 1;
        emit OrderPlaced(market, id, who, isBuy, price, size);
    }

    function _insertLevel(uint8 market, bool isBid, uint64 price) internal {
        Market storage m = markets[market];
        uint32 count = isBid ? m.bidLevels : m.askLevels;
        if (count >= MAX_LEVELS) revert TooManyLevels();
        uint64 best = isBid ? m.bestBid : m.bestAsk;
        Level storage nl = levels[market][isBid][price];
        if (best == 0) {
            _setBest(m, isBid, price);
        } else if (isBid ? price > best : price < best) {
            nl.worse = best;
            levels[market][isBid][best].better = price;
            _setBest(m, isBid, price);
        } else {
            uint64 cur = best;
            while (true) {
                uint64 w = levels[market][isBid][cur].worse;
                if (w == 0 || (isBid ? price > w : price < w)) {
                    nl.better = cur;
                    nl.worse = w;
                    levels[market][isBid][cur].worse = price;
                    if (w != 0) levels[market][isBid][w].better = price;
                    break;
                }
                cur = w;
            }
        }
        if (isBid) m.bidLevels = count + 1;
        else m.askLevels = count + 1;
    }

    function _setBest(Market storage m, bool isBid, uint64 price) private {
        if (isBid) m.bestBid = price;
        else m.bestAsk = price;
    }

    function _cancel(uint64 id, uint8 reason) internal {
        Order storage o = orders[id];
        uint128 rem = o.size;
        Level storage l = levels[o.market][o.isBuy][o.price];
        l.total -= rem;
        reservedIm[o.owner] -= o.reserved;
        o.reserved = 0;
        o.size = 0;
        emit OrderCancelled(o.market, id, o.owner, rem, reason);
        _unlink(id);
    }

    /// @dev Removes a filled or cancelled order from its level, and the level from the book if it empties.
    function _unlink(uint64 id) internal {
        Order storage o = orders[id];
        uint8 market = o.market;
        bool isBid = o.isBuy;
        uint64 price = o.price;
        Level storage l = levels[market][isBid][price];
        if (o.prev != 0) orders[o.prev].next = o.next;
        else l.head = o.next;
        if (o.next != 0) orders[o.next].prev = o.prev;
        else l.tail = o.prev;
        o.prev = 0;
        o.next = 0;
        l.count -= 1;
        if (l.count == 0) {
            Market storage m = markets[market];
            if (l.better != 0) levels[market][isBid][l.better].worse = l.worse;
            else _setBest(m, isBid, l.worse);
            if (l.worse != 0) levels[market][isBid][l.worse].better = l.better;
            delete levels[market][isBid][price];
            if (isBid) m.bidLevels -= 1;
            else m.askLevels -= 1;
        }
    }

    function _recordTrade(uint8 market, uint64 price, uint128 size, bool takerBuy) internal {
        Market storage m = markets[market];
        tradeRing[market][m.tradeCount % TRADE_RING] = Trade(price, size, takerBuy, uint40(block.timestamp));
        m.tradeCount += 1;
        m.lastPrice = price;
    }

    /// @dev Would the maker still meet initial margin after this fill (if it grows exposure)?
    function _makerOk(address maker, uint8 market, int256 delta, uint64 price, uint128 resFree, uint256[] memory px) internal view returns (bool) {
        Position storage p = positions[maker][market];
        int256 s = p.size;
        int256 ns = s + delta;
        if (_abs(ns) <= _abs(s) && (ns == 0 || (ns > 0) == (s > 0))) return true; // pure reduction
        uint256 o = _px(px, market);
        (int256 eq, uint256 im,) = _health(maker, px);
        eq += delta * (int256(o) - int256(uint256(price))) / int256(PX_SIZE);
        uint256 imBps = markets[market].imBps;
        uint256 req = im - (_abs(s) * o / PX_SIZE) * imBps / BPS + (_abs(ns) * o / PX_SIZE) * imBps / BPS
            + reservedIm[maker] - resFree;
        return eq >= int256(req);
    }

    /// @dev Updates a position with a fill at `price`; returns realised PnL booked into collateral.
    function _applyFill(address who, uint8 market, int256 delta, uint64 price) internal returns (int256 realized) {
        _settleFunding(who, market);
        Position storage p = positions[who][market];
        int256 s = p.size;
        Market storage m = markets[market];
        if (s == 0 || (s > 0) == (delta > 0)) {
            uint256 a = _abs(s);
            uint256 d = _abs(delta);
            p.entry = uint64((a * p.entry + d * price) / (a + d));
            p.size = int128(s + delta);
            if (delta > 0) m.openInterest += uint128(d);
        } else {
            uint256 closeAbs = _abs(s) < _abs(delta) ? _abs(s) : _abs(delta);
            int256 closed = s > 0 ? int256(closeAbs) : -int256(closeAbs);
            realized = closed * (int256(uint256(price)) - int256(uint256(p.entry))) / int256(PX_SIZE);
            collateral[who] += realized;
            int256 ns = s + delta;
            p.size = int128(ns);
            if (ns == 0) p.entry = 0;
            else if ((ns > 0) != (s > 0)) p.entry = price;
            if (s > 0) m.openInterest -= uint128(closeAbs);
            if (ns > 0 && s < 0) m.openInterest += uint128(_abs(ns));
        }
        p.fundingSnap = m.cumFunding;
    }

    // ================================================================ internals: funding, oracle, health
    function _premium(uint8 market, uint256 o) internal view returns (int256 prem) {
        Market storage m = markets[market];
        if (m.bestBid == 0 || m.bestAsk == 0) return 0;
        uint256 mid = (uint256(m.bestBid) + uint256(m.bestAsk)) / 2;
        prem = (int256(mid) - int256(o)) * 1e18 / int256(o);
        if (prem > PREMIUM_CAP) prem = PREMIUM_CAP;
        if (prem < -PREMIUM_CAP) prem = -PREMIUM_CAP;
    }

    function _pendingFunding(uint8 market, uint256 o) internal view returns (int256) {
        Market storage m = markets[market];
        uint256 dt = block.timestamp - m.lastFundingTs;
        if (dt == 0) return 0;
        return int256(o) * _premium(market, o) * int256(dt) / int256(FUNDING_PERIOD);
    }

    function _accrue(uint8 market, uint256 o) internal {
        Market storage m = markets[market];
        if (block.timestamp == m.lastFundingTs) return;
        int256 add = _pendingFunding(market, o);
        m.lastFundingTs = uint64(block.timestamp);
        if (add != 0) {
            m.cumFunding += add;
            emit FundingAccrued(market, m.cumFunding, _premium(market, o));
        }
    }

    function _settleFunding(address who, uint8 market) internal {
        Position storage p = positions[who][market];
        int256 cum = markets[market].cumFunding;
        if (p.size != 0 && cum != p.fundingSnap) {
            int256 paid = int256(p.size) * (cum - p.fundingSnap) / FUND_SCALE;
            collateral[who] -= paid;
            emit FundingSettled(who, market, paid);
        }
        p.fundingSnap = cum;
    }

    function _oracle(uint8 market) internal view returns (uint256) {
        Market storage m = markets[market];
        (, int256 a,, uint256 t,) = AggregatorV3Interface(m.oracle).latestRoundData();
        if (a <= 0) revert BadOraclePrice(market);
        if (block.timestamp > t + m.maxAge) revert StaleOracle(market, t);
        return uint256(a);
    }

    function _priceCache() internal view returns (uint256[] memory) { return new uint256[](markets.length); }

    function _px(uint256[] memory px, uint8 market) internal view returns (uint256) {
        if (px[market] == 0) px[market] = _oracle(market);
        return px[market];
    }

    function _health(address who, uint256[] memory px) internal view returns (int256 eq, uint256 im, uint256 mm) {
        eq = collateral[who];
        for (uint8 i = 0; i < markets.length; i++) {
            Position storage p = positions[who][i];
            if (p.size == 0) continue;
            uint256 o = _px(px, i);
            Market storage m = markets[i];
            int256 cum = m.cumFunding + _pendingFunding(i, o);
            eq += int256(p.size) * (int256(o) - int256(uint256(p.entry))) / int256(PX_SIZE);
            eq -= int256(p.size) * (cum - p.fundingSnap) / FUND_SCALE;
            uint256 n = _abs(p.size) * o / PX_SIZE;
            im += n * m.imBps / BPS;
            mm += n * m.mmBps / BPS;
        }
    }

    function _hasPosition(address who) internal view returns (bool) {
        for (uint8 i = 0; i < markets.length; i++) if (positions[who][i].size != 0) return true;
        return false;
    }

    function _pull(uint256 amount) internal {
        if (!collateralToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    function _abs(int256 x) internal pure returns (uint256) { return x >= 0 ? uint256(x) : uint256(-x); }
}
