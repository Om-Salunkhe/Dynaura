// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title ShopTrade
/// @notice Shops prepay for solar; the Pi oracle settles measured delivery and defers any failed refund.
/// @dev Intended token: canonical USDC at 0x3600000000000000000000000000000000000000,
///      with 6 decimals (2_000_000 = 2 USDC), supplied through usdc_. Assumes exact transfers.
///      The contract trusts the Pi's off-chain meter measurement of deliveredWh.
///      totalLocked equals deposits of Open orders plus outstanding pendingRefund amounts.
///      The invariant is usdc.balanceOf(address(this)) >= totalLocked, with equality absent unsolicited transfers.
/// @dev USDC issuer blocklisting of the contract address would freeze funds and cannot be mitigated onchain.
contract ShopTrade is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint64 public constant MAX_PRICE_PER_KWH = 10_000_000;
    uint256 public constant MAX_DAY_BYTES = 10;

    enum Status { None, Open, Settled, Refunded }

    struct Order {
        address shop;
        uint96 deposit;
        uint32 wantWh;
        uint32 deliveredWh;
        uint64 pricePerKwh;
        uint64 deadline;
        Status status;
        string day;
    }

    IERC20 public immutable usdc;
    address public oracle;
    address public treasury;
    uint64 public pricePerKwh;
    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => uint256) public pendingRefund;
    uint256 public totalLocked;

    /// @notice Records the current USDC micro-units per kWh used for new orders.
    event PriceSet(uint64 pricePerKwh);
    /// @notice Records a deposit and its immutable order price.
    event OrderPlaced(uint256 indexed orderId, address indexed shop, string day, uint32 wantWh, uint256 deposit, uint64 pricePerKwh);
    /// @notice Records measured delivery, treasury payment and the shop refund delivered now.
    event OrderSettled(uint256 indexed orderId, address indexed shop, uint32 deliveredWh, uint256 paid, uint256 refunded);
    /// @notice Records a failed shop refund retained for a later claim.
    event RefundDeferred(uint256 indexed orderId, address indexed shop, uint256 amount);
    /// @notice Records a deferred refund paid to its shop.
    event RefundClaimed(uint256 indexed orderId, address indexed shop, uint256 amount);
    /// @notice Records the shop's full refund of an expired open order.
    event OrderRefunded(uint256 indexed orderId, address indexed shop, uint256 refunded);
    /// @notice Records the authorized Pi oracle address.
    event OracleChanged(address oracle);
    /// @notice Records the treasury used for subsequent settlements.
    event TreasuryChanged(address treasury);

    error ZeroAddress();
    error NotOracle();
    error NotAllowed();
    error NotShop();
    error NothingPending();
    error BadStatus();
    error TooEarly();
    error BadAmount();
    error BadPrice();

    /// @notice Initializes USDC, Pi oracle, treasury, bounded price and explicit committee owner.
    constructor(address usdc_, address oracle_, address treasury_, uint64 pricePerKwh_, address owner_)
        Ownable(owner_)
    {
        if (usdc_ == address(0) || oracle_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        _checkPrice(pricePerKwh_);
        usdc = IERC20(usdc_);
        oracle = oracle_;
        treasury = treasury_;
        pricePerKwh = pricePerKwh_;
        emit OracleChanged(oracle_);
        emit TreasuryChanged(treasury_);
        emit PriceSet(pricePerKwh_);
    }

    /// @notice Owner or oracle sets a price of 1–10_000_000 micro-USDC per kWh for new orders.
    function setPrice(uint64 pricePerKwh_) external {
        if (msg.sender != owner() && msg.sender != oracle) revert NotAllowed();
        _checkPrice(pricePerKwh_);
        pricePerKwh = pricePerKwh_;
        emit PriceSet(pricePerKwh_);
    }

    /// @notice Committee changes the nonzero Pi oracle address.
    /// @dev Immediate rotation is deliberate so a compromised Pi key can be replaced without delay.
    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    /// @notice Committee changes the nonzero treasury for subsequent settlements.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    /// @notice Starts committee ownership transfer to a nonzero address, which must accept.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice Disabled to retain an explicit nonzero committee owner.
    function renounceOwnership() public override onlyOwner {
        revert ZeroAddress();
    }

    /// @notice Returns the current-price deposit in micro-USDC, rounded up to the next unit.
    function costOf(uint32 wh) public view returns (uint256) {
        return (uint256(wh) * pricePerKwh + 999) / 1000;
    }

    /// @notice Prepays for positive Wh at the current fixed price; approve costOf(wantWh) first.
    /// @dev SafeCast checks the uint96 deposit; the uint32 Wh and bounded price also keep it far below that limit.
    function placeOrder(string calldata day, uint32 wantWh, uint64 deadline)
        external nonReentrant returns (uint256 orderId)
    {
        if (wantWh == 0 || deadline <= block.timestamp) revert BadAmount();
        if (bytes(day).length == 0 || bytes(day).length > MAX_DAY_BYTES) revert BadAmount();
        uint96 deposit = costOf(wantWh).toUint96();
        orderId = nextOrderId++;
        orders[orderId] = Order(msg.sender, deposit, wantWh, 0, pricePerKwh, deadline, Status.Open, day);
        totalLocked += deposit;
        emit OrderPlaced(orderId, msg.sender, day, wantWh, deposit, pricePerKwh);
        usdc.safeTransferFrom(msg.sender, address(this), deposit);
    }

    /// @notice Oracle caps delivered Wh to the order, pays the treasury rounded down and attempts the refund.
    /// @dev Settlement remains available after the deadline until the shop claims its refund, as in the draft.
    ///      At settlement, paid + refunded + deferred always equals deposit; refunded is delivered now,
    ///      and deferred is retained in pendingRefund if the shop transfer fails.
    /// @dev OrderSettled follows the transfer attempt to report the actually delivered refund; settlement is nonReentrant.
    function settle(uint256 orderId, uint32 deliveredWh) external nonReentrant {
        if (msg.sender != oracle) revert NotOracle();
        Order storage o = orders[orderId];
        if (o.status != Status.Open) revert BadStatus();
        if (deliveredWh > o.wantWh) deliveredWh = o.wantWh;
        uint256 paid = (uint256(deliveredWh) * o.pricePerKwh) / 1000;
        uint256 back = uint256(o.deposit) - paid;
        o.status = Status.Settled;
        o.deliveredWh = deliveredWh;
        address recipient = treasury;
        totalLocked -= paid;
        if (paid > 0) usdc.safeTransfer(recipient, paid);
        uint256 refunded;
        if (back > 0) {
            if (usdc.trySafeTransfer(o.shop, back)) {
                totalLocked -= back;
                refunded = back;
            } else {
                pendingRefund[orderId] = back;
                emit RefundDeferred(orderId, o.shop, back);
            }
        }
        emit OrderSettled(orderId, o.shop, deliveredWh, paid, refunded);
    }

    /// @notice Only the original shop can claim its deferred refund, paid to that shop.
    function claimRefund(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (msg.sender != o.shop) revert NotShop();
        uint256 amount = pendingRefund[orderId];
        if (amount == 0) revert NothingPending();
        pendingRefund[orderId] = 0;
        totalLocked -= amount;
        emit RefundClaimed(orderId, o.shop, amount);
        usdc.safeTransfer(o.shop, amount);
    }

    /// @notice Only the shop can reclaim an unsettled order's full deposit after its deadline.
    function refund(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (o.status != Status.Open) revert BadStatus();
        if (msg.sender != o.shop) revert NotShop();
        if (block.timestamp <= o.deadline) revert TooEarly();
        o.status = Status.Refunded;
        totalLocked -= o.deposit;
        emit OrderRefunded(orderId, o.shop, o.deposit);
        usdc.safeTransfer(o.shop, o.deposit);
    }

    function _checkPrice(uint64 price) private pure {
        if (price == 0 || price > MAX_PRICE_PER_KWH) revert BadPrice();
    }
}
