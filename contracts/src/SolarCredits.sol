// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title SolarCredits
/// @notice Distributes each period's solar revenue in proportion to each flat's unused share.
/// @dev Intended token: canonical USDC at 0x3600000000000000000000000000000000000000,
///      with 6 decimals, supplied through usdc_. Assumes exact transfers, not fee-on-transfer tokens.
///      Trusts the oracle's measurements; readingsHash identifies evidence, not on-chain verification.
///      The contract cannot force a buyer flat to call payIn; only received revenue is distributed.
///      Each cumulative entitlement is rounded down, leaving under one micro-USDC per flat per
///      period as rounding dust after all entitlements are claimed. Dust stays here; there is no sweep.
///      For each period, totalClaimed <= totalIn because the sum of floored shares cannot exceed totalIn.
///      USDC issuer blocklisting of this contract would freeze funds and cannot be mitigated on-chain.
contract SolarCredits is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_WH = 1e12;
    uint256 public constant MAX_RATE = 1_000_000;
    uint256 public constant MAX_FLATS = 16;
    uint256 public constant MAX_LABEL_BYTES = 16;

    struct Flat {
        bool inPeriod;
        uint256 unusedWh;
        uint256 overWh;
        bool paidIn;
        uint256 claimed;
    }

    struct Period {
        bool posted;
        uint256 neighborRate;
        bytes32 readingsHash;
        uint256 totalUnusedWh;
        uint256 totalIn;
        uint256 totalClaimed;
        string[] flats;
        mapping(bytes32 => Flat) data;
    }

    IERC20 public immutable usdc;
    address public oracle;
    mapping(bytes32 => Period) private _periods;
    mapping(bytes32 => address) private _wallets;

    /// @notice Records immutable ordered measurements, micro-USDC per Wh rate and evidence hash.
    event PeriodPosted(bytes32 indexed periodId, string[] flats, uint256[] unusedWh, uint256[] overWh, uint256 neighborRate, bytes32 readingsHash);
    /// @notice Records the wallet that will receive a flat's subsequent claims.
    event FlatRegistered(string flat, address indexed wallet);
    /// @notice Records external revenue added to a period's pool.
    event PeriodFunded(bytes32 indexed periodId, address indexed from, uint256 amount);
    /// @notice Records a buyer flat's one-time payment, including zero-rate payments.
    event NeighborPaid(bytes32 indexed periodId, string flat, address indexed payer, uint256 overWh, uint256 amount);
    /// @notice Records credits paid to a flat's currently registered wallet.
    event CreditClaimed(bytes32 indexed periodId, string flat, address indexed wallet, uint256 amount);
    /// @notice Records the authorized Pi oracle address.
    event OracleChanged(address oracle);

    error ZeroAddress();
    error NotOracle();
    error BadPeriodId();
    error AlreadyPosted();
    error NoPeriod();
    error BadFlatCount();
    error LengthMismatch();
    error DuplicateFlat();
    error BadLabel();
    error BadWh();
    error BadRate();
    error BadAmount();
    error NoUnusedWh();
    error NotBuyer();
    error AlreadyPaid();
    error NothingToClaim();

    /// @notice Initializes USDC, the Pi oracle and the explicit committee owner.
    /// @param usdc_ Six-decimal USDC, canonically 0x3600000000000000000000000000000000000000.
    /// @param oracle_ Nonzero Pi address authorized to post periods.
    /// @param owner_ Nonzero committee address, validated directly by Ownable.
    constructor(address usdc_, address oracle_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    /// @notice Committee changes the nonzero Pi oracle address.
    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleChanged(oracle_);
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

    /// @notice Committee registers or replaces the wallet for an exact, case-sensitive flat label.
    /// @dev Wallet changes apply to all subsequent claims, including previously posted periods.
    function register(string calldata flat, address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        _checkLabel(flat);
        _wallets[keccak256(bytes(flat))] = wallet;
        emit FlatRegistered(flat, wallet);
    }

    /// @notice Oracle posts a period once, retaining flat order, bounded Wh and its evidence hash.
    /// @dev neighborRate is micro-USDC per Wh (13 means 0.013 USDC per kWh); zero is allowed.
    ///      Zero-total-unused periods may be posted but cannot accept fund or payIn payments.
    function postPeriod(
        bytes32 periodId,
        string[] calldata flats,
        uint256[] calldata unusedWh,
        uint256[] calldata overWh,
        uint256 neighborRate,
        bytes32 readingsHash
    ) external {
        if (msg.sender != oracle) revert NotOracle();
        if (periodId == bytes32(0)) revert BadPeriodId();
        Period storage p = _periods[periodId];
        if (p.posted) revert AlreadyPosted();
        if (flats.length == 0 || flats.length > MAX_FLATS) revert BadFlatCount();
        if (flats.length != unusedWh.length || flats.length != overWh.length) revert LengthMismatch();
        if (neighborRate > MAX_RATE) revert BadRate();
        p.posted = true;
        p.neighborRate = neighborRate;
        p.readingsHash = readingsHash;
        for (uint256 i = 0; i < flats.length; i++) {
            _storeFlat(p, flats[i], unusedWh[i], overWh[i]);
        }
        _emitPeriodPosted(periodId, unusedWh, overWh);
    }

    /// @notice Anyone adds positive shop, grid or other revenue to a posted period with sellers.
    /// @dev Approve this contract for amount first; accounting updates before the USDC pull.
    function fund(bytes32 periodId, uint256 amount) external nonReentrant {
        Period storage p = _periods[periodId];
        if (!p.posted) revert NoPeriod();
        if (amount == 0) revert BadAmount();
        if (p.totalUnusedWh == 0) revert NoUnusedWh();
        p.totalIn += amount;
        emit PeriodFunded(periodId, msg.sender, amount);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Anyone pays a buyer flat's exact overWh times neighborRate once for the period.
    /// @dev Requires sellers; a zero rate marks the flat paid and emits without a token transfer.
    function payIn(bytes32 periodId, string calldata flat) external nonReentrant {
        Period storage p = _periods[periodId];
        if (!p.posted) revert NoPeriod();
        if (p.totalUnusedWh == 0) revert NoUnusedWh();
        Flat storage f = p.data[keccak256(bytes(flat))];
        if (!f.inPeriod || f.overWh == 0) revert NotBuyer();
        if (f.paidIn) revert AlreadyPaid();
        uint256 amount = f.overWh * p.neighborRate;
        f.paidIn = true;
        p.totalIn += amount;
        emit NeighborPaid(periodId, flat, msg.sender, f.overWh, amount);
        if (amount > 0) usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Anyone triggers payment of a flat's outstanding share to its registered wallet.
    /// @dev Pays floor(totalIn * unusedWh / totalUnusedWh) minus previous claims, so later
    ///      funding creates only incremental credit. Accounting updates before the transfer.
    ///      If USDC blocklists the recipient, this flat's claim reverts without consuming credit;
    ///      the committee can register another wallet and retry. No deferred payout is created.
    function claim(bytes32 periodId, string calldata flat) external nonReentrant {
        Period storage p = _periods[periodId];
        bytes32 key = keccak256(bytes(flat));
        Flat storage f = p.data[key];
        uint256 amount = _claimable(p, f);
        if (amount == 0) revert NothingToClaim();
        address wallet = _wallets[key];
        if (wallet == address(0)) revert ZeroAddress();
        f.claimed += amount;
        p.totalClaimed += amount;
        emit CreditClaimed(periodId, flat, wallet, amount);
        usdc.safeTransfer(wallet, amount);
    }

    /// @notice Returns outstanding rounded-down credit, or zero for unknown periods or flats.
    function claimable(bytes32 periodId, string calldata flat) external view returns (uint256) {
        Period storage p = _periods[periodId];
        return _claimable(p, p.data[keccak256(bytes(flat))]);
    }

    /// @notice Returns the currently registered wallet, or zero if the flat is unregistered.
    function walletOf(string calldata flat) external view returns (address) {
        return _wallets[keccak256(bytes(flat))];
    }

    /// @notice Returns period metadata and cumulative received and claimed micro-USDC.
    function periodInfo(bytes32 periodId) external view returns (
        bool posted,
        uint256 neighborRate,
        bytes32 readingsHash,
        uint256 totalUnusedWh,
        uint256 totalIn,
        uint256 totalClaimed
    ) {
        Period storage p = _periods[periodId];
        return (p.posted, p.neighborRate, p.readingsHash, p.totalUnusedWh, p.totalIn, p.totalClaimed);
    }

    /// @notice Returns membership, immutable Wh, buyer-payment status and cumulative claimed credit.
    function flatInfo(bytes32 periodId, string calldata flat) external view returns (
        bool inPeriod,
        uint256 unusedWh,
        uint256 overWh,
        bool paidIn,
        uint256 claimed
    ) {
        Flat storage f = _periods[periodId].data[keccak256(bytes(flat))];
        return (f.inPeriod, f.unusedWh, f.overWh, f.paidIn, f.claimed);
    }

    /// @notice Returns the flat labels in their original posted order, or an empty list if unknown.
    function flatsOf(bytes32 periodId) external view returns (string[] memory) {
        return _periods[periodId].flats;
    }

    function _checkLabel(string calldata flat) private pure {
        if (bytes(flat).length == 0 || bytes(flat).length > MAX_LABEL_BYTES) revert BadLabel();
    }

    function _storeFlat(Period storage p, string calldata flat, uint256 unusedWh, uint256 overWh) private {
        _checkLabel(flat);
        if (unusedWh > MAX_WH || overWh > MAX_WH || (unusedWh > 0 && overWh > 0)) revert BadWh();
        Flat storage f = p.data[keccak256(bytes(flat))];
        if (f.inPeriod) revert DuplicateFlat();
        f.inPeriod = true;
        f.unusedWh = unusedWh;
        f.overWh = overWh;
        p.totalUnusedWh += unusedWh;
        p.flats.push(flat);
    }

    function _claimable(Period storage p, Flat storage f) private view returns (uint256) {
        if (!p.posted || !f.inPeriod || p.totalUnusedWh == 0 || f.unusedWh == 0) return 0;
        return Math.mulDiv(p.totalIn, f.unusedWh, p.totalUnusedWh) - f.claimed;
    }

    function _emitPeriodPosted(bytes32 periodId, uint256[] calldata unusedWh, uint256[] calldata overWh) private {
        Period storage p = _periods[periodId];
        emit PeriodPosted(periodId, p.flats, unusedWh, overWh, p.neighborRate, p.readingsHash);
    }
}
