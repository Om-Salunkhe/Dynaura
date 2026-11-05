// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ShopTrade
/// @notice A nearby shop or office prepays USDC for the building's spare noon solar. After the
///         solar window, the building's meter (the oracle) reports how many Wh were actually
///         delivered. In one transaction, the society is paid for exactly that and the shop gets
///         the rest back. If the meter never settles, the shop takes its deposit back after the
///         deadline.
contract ShopTrade is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Settled, Refunded }

    struct Order {
        address shop;
        uint96 deposit;       // USDC (6 decimals) paid up front = costOf(wantWh), rounded up
        uint32 wantWh;        // energy asked for
        uint32 deliveredWh;   // set on settle
        uint64 pricePerKwh;   // USDC (6 decimals) per kWh, fixed when the order is placed
        uint64 deadline;      // unix seconds; the shop may refund after this
        Status status;
        string day;           // YYYY-MM-DD, matches the offer on Arkiv
    }

    uint64 public constant MAX_PRICE_PER_KWH = 10_000_000; // 10 USDC
    uint256 public constant MAX_DAY_BYTES = 10;

    IERC20 public immutable usdc;
    address public oracle;      // the building's meter key on the Pi
    address public treasury;    // society wallet that receives the sales
    uint64 public pricePerKwh;  // current price, USDC 6 decimals (80000 = 0.08 USDC)
    uint256 public nextOrderId = 1;
    uint256 public totalLocked; // sum of the deposits of open orders
    mapping(uint256 => Order) public orders;

    event PriceSet(uint64 pricePerKwh);
    event OracleChanged(address indexed oracle);
    event TreasuryChanged(address indexed treasury);
    event OrderPlaced(uint256 indexed orderId, address indexed shop, string day, uint32 wantWh, uint256 deposit, uint64 pricePerKwh);
    event OrderSettled(uint256 indexed orderId, address indexed shop, uint32 deliveredWh, uint256 paid, uint256 refunded);
    event OrderRefunded(uint256 indexed orderId, address indexed shop, uint256 refunded);

    error ZeroAddress();
    error NotOracle();
    error NotAllowed();
    error NotShop();
    error BadStatus();
    error BadAmount();
    error BadPrice();
    error TooEarly();

    constructor(address usdc_, address oracle_, address treasury_, uint64 pricePerKwh_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || oracle_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (pricePerKwh_ == 0 || pricePerKwh_ > MAX_PRICE_PER_KWH) revert BadPrice();
        usdc = IERC20(usdc_);
        oracle = oracle_;
        treasury = treasury_;
        pricePerKwh = pricePerKwh_;
        emit OracleChanged(oracle_);
        emit TreasuryChanged(treasury_);
        emit PriceSet(pricePerKwh_);
    }

    // ---- admin -----------------------------------------------------------------------------

    /// @notice New price for new orders. Open orders keep the price they were placed at.
    function setPrice(uint64 pricePerKwh_) external {
        if (msg.sender != owner() && msg.sender != oracle) revert NotAllowed();
        if (pricePerKwh_ == 0 || pricePerKwh_ > MAX_PRICE_PER_KWH) revert BadPrice();
        pricePerKwh = pricePerKwh_;
        emit PriceSet(pricePerKwh_);
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    // ---- orders ----------------------------------------------------------------------------

    /// @notice What `wh` costs at the current price, rounded up to the next micro-USDC.
    function costOf(uint32 wh) public view returns (uint256) {
        return (uint256(wh) * pricePerKwh + 999) / 1000;
    }

    /// @notice Prepay for `wantWh` of today's spare solar. Approve USDC for costOf(wantWh) first.
    function placeOrder(string calldata day, uint32 wantWh, uint64 deadline) external nonReentrant returns (uint256 orderId) {
        if (wantWh == 0 || deadline <= block.timestamp) revert BadAmount();
        uint256 len = bytes(day).length;
        if (len == 0 || len > MAX_DAY_BYTES) revert BadAmount();

        uint256 deposit = costOf(wantWh); // < 2^32 * 1e7 / 1000, fits in uint96
        orderId = nextOrderId++;
        orders[orderId] = Order(msg.sender, uint96(deposit), wantWh, 0, pricePerKwh, deadline, Status.Open, day);
        totalLocked += deposit;

        usdc.safeTransferFrom(msg.sender, address(this), deposit);
        emit OrderPlaced(orderId, msg.sender, day, wantWh, deposit, pricePerKwh);
    }

    /// @notice The meter reports what was delivered: the society is paid for that and the shop
    ///         gets the rest back, in the same transaction.
    function settle(uint256 orderId, uint32 deliveredWh) external nonReentrant {
        if (msg.sender != oracle) revert NotOracle();
        Order storage o = orders[orderId];
        if (o.status != Status.Open) revert BadStatus();
        if (deliveredWh > o.wantWh) deliveredWh = o.wantWh;

        uint256 deposit = o.deposit;
        uint256 paid = (uint256(deliveredWh) * o.pricePerKwh) / 1000; // rounded down: the shop never overpays
        if (paid > deposit) paid = deposit;
        uint256 back = deposit - paid;
        address shop = o.shop;
        o.status = Status.Settled;
        o.deliveredWh = deliveredWh;
        totalLocked -= deposit;

        if (paid > 0) usdc.safeTransfer(treasury, paid);
        if (back > 0) usdc.safeTransfer(shop, back);
        emit OrderSettled(orderId, shop, deliveredWh, paid, back);
    }

    /// @notice The meter never settled: the shop takes its whole deposit back after the deadline.
    function refund(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (msg.sender != o.shop) revert NotShop();
        if (o.status != Status.Open) revert BadStatus();
        if (block.timestamp <= o.deadline) revert TooEarly();

        uint256 deposit = o.deposit;
        o.status = Status.Refunded;
        totalLocked -= deposit;

        usdc.safeTransfer(msg.sender, deposit);
        emit OrderRefunded(orderId, msg.sender, deposit);
    }
}
