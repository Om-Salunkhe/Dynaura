// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title SolarBilling
/// @notice Pi-meter bills split solar and grid charges, paid atomically to their respective recipients.
/// @dev Intended token: canonical USDC at 0x3600000000000000000000000000000000000000,
///      with 6 decimals (2_000_000 = 2 USDC), supplied through usdc_. Assumes exact transfers.
///      Readings hashes identify the oracle's off-chain evidence; measurements are not verified on-chain.
contract SolarBilling is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant MAX_LABEL_BYTES = 16;

    struct Bill {
        string flat;
        string month;
        address resident;
        uint96 amount;
        uint32 solarWh;
        uint32 gridWh;
        bytes32 readingsHash;
        bool paid;
        address paidBy;
        uint96 solarAmount;
        uint96 gridAmount;
    }

    IERC20 public immutable usdc;
    address public oracle;
    address public treasury;
    uint256 public nextBillId = 1;
    mapping(uint256 => Bill) public bills;
    mapping(bytes32 => uint256) public billOf;
    address public gridPayee;

    /// @notice Records a unique flat/month bill and the hash of its signed meter readings.
    event BillPosted(uint256 indexed billId, string flat, string month, address resident, uint256 amount, uint32 solarWh, uint32 gridWh, bytes32 readingsHash);
    /// @notice Records the payer, total paid and the solar/grid payment split.
    event BillPaid(uint256 indexed billId, address indexed payer, uint256 amount, uint96 solarAmount, uint96 gridAmount);
    /// @notice Records the authorized Pi oracle address.
    event OracleChanged(address oracle);
    /// @notice Records the treasury used for solar legs of subsequent payments.
    event TreasuryChanged(address treasury);
    /// @notice Records the recipient used for grid legs of subsequent payments.
    event GridPayeeChanged(address gridPayee);

    error ZeroAddress();
    error NotOracle();
    error AlreadyPosted();
    error AlreadyPaid();
    error NoBill();
    error NotResident();
    error BadAmount();
    error BadLabel();

    /// @notice Initializes the token, Pi oracle, solar treasury, grid payee and committee owner.
    constructor(address usdc_, address oracle_, address treasury_, address gridPayee_, address owner_)
        Ownable(owner_)
    {
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

    /// @notice Committee changes the nonzero Pi oracle address.
    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    /// @notice Committee changes the nonzero treasury for subsequent solar payments.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    /// @notice Committee changes the nonzero recipient for subsequent grid payments.
    function setGridPayee(address gridPayee_) external onlyOwner {
        if (gridPayee_ == address(0)) revert ZeroAddress();
        gridPayee = gridPayee_;
        emit GridPayeeChanged(gridPayee_);
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

    /// @notice Computes the collision-safe key used by billOf for an exact flat/month string pair.
    function key(string memory flat, string memory month) public pure returns (bytes32) {
        return keccak256(abi.encode(flat, month));
    }

    /// @notice Oracle posts one bill per flat/month, including zero totals, with each label 1–16 bytes.
    /// @dev A zero resident permits anyone to pay; the sum must fit uint96 or SafeCast reverts.
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
        uint96 amount = (uint256(solarAmount) + uint256(gridAmount)).toUint96();
        billId = nextBillId++;
        billOf[k] = billId;
        Bill storage b = bills[billId];
        b.flat = flat;
        b.month = month;
        b.resident = resident;
        b.amount = amount;
        b.solarWh = solarWh;
        b.gridWh = gridWh;
        b.readingsHash = readingsHash;
        b.solarAmount = solarAmount;
        b.gridAmount = gridAmount;
        _emitBillPosted(billId);
    }

    /// @notice Pays an existing unpaid bill once; approve the total USDC amount first.
    /// @dev Uses recipients current at entry; both nonzero legs succeed or the entire payment reverts.
    function pay(uint256 billId) external nonReentrant {
        if (billId == 0 || billId >= nextBillId) revert NoBill();
        Bill storage b = bills[billId];
        if (b.paid) revert AlreadyPaid();
        if (b.resident != address(0) && b.resident != msg.sender) revert NotResident();
        address solarRecipient = treasury;
        address gridRecipient = gridPayee;
        b.paid = true;
        b.paidBy = msg.sender;
        emit BillPaid(billId, msg.sender, b.amount, b.solarAmount, b.gridAmount);
        if (b.solarAmount > 0) usdc.safeTransferFrom(msg.sender, solarRecipient, b.solarAmount);
        if (b.gridAmount > 0) usdc.safeTransferFrom(msg.sender, gridRecipient, b.gridAmount);
    }

    function _emitBillPosted(uint256 billId) private {
        Bill storage b = bills[billId];
        emit BillPosted(billId, b.flat, b.month, b.resident, b.amount, b.solarWh, b.gridWh, b.readingsHash);
    }
}
