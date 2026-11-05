// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ShopTrade
/// @notice A nearby shop or office prepays USDC for the building's spare noon solar.
///         After the solar window, the building's meter (the oracle) reports how many Wh were
///         actually delivered. The society is paid for exactly that, and the shop gets the rest
///         back in the same transaction. If the meter never settles, the shop can take its
///         money back after the deadline.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ShopTrade {
    enum Status { None, Open, Settled, Refunded }

    struct Order {
        address shop;
        uint96 deposit;       // USDC (6 decimals) paid up front
        uint32 wantWh;        // energy asked for
        uint32 deliveredWh;   // set on settle
        uint64 pricePerKwh;   // USDC (6 decimals) per kWh, fixed when the order is placed
        uint64 deadline;      // unix seconds; shop may refund after this
        Status status;
        string day;           // YYYY-MM-DD, matches the offer on Arkiv
    }

    IERC20 public immutable usdc;
    address public owner;
    address public oracle;    // the building's device key on the Pi
    address public treasury;  // society wallet that receives sales
    uint64 public pricePerKwh; // current price, USDC 6 decimals (80000 = 0.08 USDC)
    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;

    event PriceSet(uint64 pricePerKwh);
    event OrderPlaced(uint256 indexed orderId, address indexed shop, string day, uint32 wantWh, uint256 deposit, uint64 pricePerKwh);
    event OrderSettled(uint256 indexed orderId, address indexed shop, uint32 deliveredWh, uint256 paid, uint256 refunded);
    event OrderRefunded(uint256 indexed orderId, address indexed shop, uint256 refunded);

    error NotOwner();
    error NotOracle();
    error NotShop();
    error BadStatus();
    error TooEarly();
    error BadAmount();
    error TransferFailed();

    constructor(address usdc_, address oracle_, address treasury_, uint64 pricePerKwh_) {
        usdc = IERC20(usdc_);
        owner = msg.sender;
        oracle = oracle_;
        treasury = treasury_;
        pricePerKwh = pricePerKwh_;
    }

    function setPrice(uint64 pricePerKwh_) external {
        if (msg.sender != owner && msg.sender != oracle) revert NotOwner();
        pricePerKwh = pricePerKwh_;
        emit PriceSet(pricePerKwh_);
    }

    function setOracle(address oracle_) external {
        if (msg.sender != owner) revert NotOwner();
        oracle = oracle_;
    }

    function costOf(uint32 wh) public view returns (uint256) {
        return (uint256(wh) * pricePerKwh + 999) / 1000; // round up to the next micro-USDC
    }

    /// @notice Prepay for `wantWh` of today's spare solar. Approve USDC for costOf(wantWh) first.
    function placeOrder(string calldata day, uint32 wantWh, uint64 deadline) external returns (uint256 orderId) {
        if (wantWh == 0 || deadline <= block.timestamp) revert BadAmount();
        uint256 deposit = costOf(wantWh);
        orderId = nextOrderId++;
        orders[orderId] = Order(msg.sender, uint96(deposit), wantWh, 0, pricePerKwh, deadline, Status.Open, day);
        if (!usdc.transferFrom(msg.sender, address(this), deposit)) revert TransferFailed();
        emit OrderPlaced(orderId, msg.sender, day, wantWh, deposit, pricePerKwh);
    }

    /// @notice Meter reports what was delivered: pay the society for that, refund the rest.
    function settle(uint256 orderId, uint32 deliveredWh) external {
        if (msg.sender != oracle) revert NotOracle();
        Order storage o = orders[orderId];
        if (o.status != Status.Open) revert BadStatus();
        if (deliveredWh > o.wantWh) deliveredWh = o.wantWh;
        uint256 paid = (uint256(deliveredWh) * o.pricePerKwh) / 1000;
        if (paid > o.deposit) paid = o.deposit;
        uint256 back = o.deposit - paid;
        o.status = Status.Settled;
        o.deliveredWh = deliveredWh;
        if (paid > 0 && !usdc.transfer(treasury, paid)) revert TransferFailed();
        if (back > 0 && !usdc.transfer(o.shop, back)) revert TransferFailed();
        emit OrderSettled(orderId, o.shop, deliveredWh, paid, back);
    }

    /// @notice Meter never settled: the shop takes its deposit back after the deadline.
    function refund(uint256 orderId) external {
        Order storage o = orders[orderId];
        if (msg.sender != o.shop) revert NotShop();
        if (o.status != Status.Open) revert BadStatus();
        if (block.timestamp <= o.deadline) revert TooEarly();
        o.status = Status.Refunded;
        if (!usdc.transfer(o.shop, o.deposit)) revert TransferFailed();
        emit OrderRefunded(orderId, o.shop, o.deposit);
    }
}
