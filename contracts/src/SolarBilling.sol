// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SolarBilling
/// @notice Each month the building's meter (the oracle) posts every flat's bill, computed from
///         that flat's own meter: the solar it used and the grid power it used. When the resident
///         pays, one transaction splits the money by where the power came from. The solar part
///         goes to the society treasury, which owns the panel. The grid part goes to the
///         electricity board's account. Each bill keeps the hash of the signed readings it was
///         computed from, so anyone can check the split.
contract SolarBilling is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bill {
        string flat;          // "A", "B", "C"
        string month;         // "2026-11"
        address resident;     // wallet allowed to pay (0 = anyone may pay for the flat)
        uint96 amount;        // total USDC (6 decimals) = solarAmount + gridAmount
        uint32 solarWh;
        uint32 gridWh;
        bytes32 readingsHash; // hash of the signed readings behind the bill
        bool paid;
        address paidBy;
        uint96 solarAmount;   // goes to the treasury
        uint96 gridAmount;    // goes to the grid payee
    }

    uint256 public constant MAX_LABEL_BYTES = 16;

    IERC20 public immutable usdc;
    address public oracle;     // the building's meter key on the Pi
    address public treasury;   // society wallet (owns the panel)
    address public gridPayee;  // electricity board account
    uint256 public nextBillId = 1;
    mapping(uint256 => Bill) public bills;
    mapping(bytes32 => uint256) public billOf; // key(flat, month) -> bill id

    event BillPosted(uint256 indexed billId, string flat, string month, address resident, uint256 amount, uint32 solarWh, uint32 gridWh, bytes32 readingsHash);
    event BillPaid(uint256 indexed billId, address indexed payer, uint256 amount, uint256 solarAmount, uint256 gridAmount);
    event OracleChanged(address indexed oracle);
    event TreasuryChanged(address indexed treasury);
    event GridPayeeChanged(address indexed gridPayee);

    error ZeroAddress();
    error NotOracle();
    error BadLabel();
    error AlreadyPosted();
    error AlreadyPaid();
    error NoBill();
    error NotResident();

    constructor(address usdc_, address oracle_, address treasury_, address gridPayee_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || oracle_ == address(0) || treasury_ == address(0) || gridPayee_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC20(usdc_);
        oracle = oracle_;
        treasury = treasury_;
        gridPayee = gridPayee_;
        emit OracleChanged(oracle_);
        emit TreasuryChanged(treasury_);
        emit GridPayeeChanged(gridPayee_);
    }

    // ---- admin -----------------------------------------------------------------------------

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

    function setGridPayee(address gridPayee_) external onlyOwner {
        if (gridPayee_ == address(0)) revert ZeroAddress();
        gridPayee = gridPayee_;
        emit GridPayeeChanged(gridPayee_);
    }

    // ---- bills -----------------------------------------------------------------------------

    function key(string memory flat, string memory month) public pure returns (bytes32) {
        return keccak256(abi.encode(flat, month));
    }

    /// @notice Post one flat's bill for one month (once).
    function postBill(
        string calldata flat,
        string calldata month,
        address resident,
        uint96 solarAmount,
        uint96 gridAmount,
        uint32 solarWh,
        uint32 gridWh,
        bytes32 readingsHash
    ) external returns (uint256 billId) {
        if (msg.sender != oracle) revert NotOracle();
        if (bytes(flat).length == 0 || bytes(flat).length > MAX_LABEL_BYTES) revert BadLabel();
        if (bytes(month).length == 0 || bytes(month).length > MAX_LABEL_BYTES) revert BadLabel();
        bytes32 k = key(flat, month);
        if (billOf[k] != 0) revert AlreadyPosted();

        uint96 amount = solarAmount + gridAmount; // reverts on overflow
        billId = nextBillId++;
        billOf[k] = billId;
        bills[billId] = Bill(flat, month, resident, amount, solarWh, gridWh, readingsHash, false, address(0), solarAmount, gridAmount);
        emit BillPosted(billId, flat, month, resident, amount, solarWh, gridWh, readingsHash);
    }

    /// @notice Pay a bill. Approve USDC for the bill amount first. The solar part goes to the
    ///         treasury and the grid part to the grid payee.
    function pay(uint256 billId) external nonReentrant {
        Bill storage b = bills[billId];
        if (bytes(b.flat).length == 0) revert NoBill();
        if (b.paid) revert AlreadyPaid();
        if (b.resident != address(0) && b.resident != msg.sender) revert NotResident();

        b.paid = true;
        b.paidBy = msg.sender;
        uint256 solarAmount = b.solarAmount;
        uint256 gridAmount = b.gridAmount;

        if (solarAmount > 0) usdc.safeTransferFrom(msg.sender, treasury, solarAmount);
        if (gridAmount > 0) usdc.safeTransferFrom(msg.sender, gridPayee, gridAmount);
        emit BillPaid(billId, msg.sender, b.amount, solarAmount, gridAmount);
    }
}
