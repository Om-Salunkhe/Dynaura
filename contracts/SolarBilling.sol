// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SolarBilling
/// @notice Each month the building's meter posts every flat's bill, split by what that flat's
///         own meter measured (solar vs grid, minus a credit for sharing solar). The resident
///         pays it in USDC; the money goes straight to the society treasury. The bill keeps a
///         hash of the signed readings it was computed from, so anyone can check the split.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract SolarBilling {
    struct Bill {
        string flat;          // "A", "B", "C"
        string month;         // "2026-11"
        address resident;     // wallet allowed to pay (0 = anyone may pay for the flat)
        uint96 amount;        // USDC, 6 decimals
        uint32 solarWh;
        uint32 gridWh;
        bytes32 readingsHash; // hash of the signed readings behind the bill
        bool paid;
        address paidBy;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public oracle;   // the building's device key on the Pi
    address public treasury; // society wallet
    uint256 public nextBillId = 1;
    mapping(uint256 => Bill) public bills;
    mapping(bytes32 => uint256) public billOf; // keccak(flat, month) -> bill id

    event BillPosted(uint256 indexed billId, string flat, string month, address resident, uint256 amount, uint32 solarWh, uint32 gridWh, bytes32 readingsHash);
    event BillPaid(uint256 indexed billId, address indexed payer, uint256 amount);

    error NotOracle();
    error NotOwner();
    error AlreadyPosted();
    error AlreadyPaid();
    error NoBill();
    error NotResident();
    error TransferFailed();

    constructor(address usdc_, address oracle_, address treasury_) {
        usdc = IERC20(usdc_);
        owner = msg.sender;
        oracle = oracle_;
        treasury = treasury_;
    }

    function setOracle(address oracle_) external {
        if (msg.sender != owner) revert NotOwner();
        oracle = oracle_;
    }

    function key(string memory flat, string memory month) public pure returns (bytes32) {
        return keccak256(abi.encode(flat, month));
    }

    function postBill(
        string calldata flat,
        string calldata month,
        address resident,
        uint96 amount,
        uint32 solarWh,
        uint32 gridWh,
        bytes32 readingsHash
    ) external returns (uint256 billId) {
        if (msg.sender != oracle) revert NotOracle();
        bytes32 k = key(flat, month);
        if (billOf[k] != 0) revert AlreadyPosted();
        billId = nextBillId++;
        billOf[k] = billId;
        bills[billId] = Bill(flat, month, resident, amount, solarWh, gridWh, readingsHash, false, address(0));
        emit BillPosted(billId, flat, month, resident, amount, solarWh, gridWh, readingsHash);
    }

    /// @notice Pay a bill. Approve USDC for the bill amount first.
    function pay(uint256 billId) external {
        Bill storage b = bills[billId];
        if (b.amount == 0 && bytes(b.flat).length == 0) revert NoBill();
        if (b.paid) revert AlreadyPaid();
        if (b.resident != address(0) && b.resident != msg.sender) revert NotResident();
        b.paid = true;
        b.paidBy = msg.sender;
        if (b.amount > 0 && !usdc.transferFrom(msg.sender, treasury, b.amount)) revert TransferFailed();
        emit BillPaid(billId, msg.sender, b.amount);
    }
}
