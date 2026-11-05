// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CleaningEscrow
/// @notice A dusty solar panel posts a cleaning job and locks its fee in USDC. A cleaner accepts
///         the job. The building's meter (the oracle) releases the fee only when the panel's
///         output is back to at least 90% of its clean level. No human approves the payout:
///         the sun does. If nobody cleans it by the deadline, the society gets its money back.
///         The cleaner can dispute the result (for example, on a cloudy day), and then the
///         committee decides.
/// @dev    Each job records the 0G request ID of the AI decision that flagged the panel and, once
///         the upload finishes, the 0G Storage root of that decision's episode log. A payment can
///         then be traced to the AI decision that caused it and to the meter readings that
///         proved the work.
contract CleaningEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Accepted, Paid, Refunded, Cancelled, Disputed }

    struct Job {
        address payer;        // who locked the fee (the society or its Pi)
        address cleaner;      // set on accept
        uint96 fee;           // USDC, 6 decimals
        uint64 deadline;      // unix seconds
        uint16 outputBefore;  // panel output when posted, % of its clean level
        uint16 outputAfter;   // panel output at release, % of its clean level
        Status status;
        bytes32 proof;        // hash of the signed meter readings that proved the clean panel
        bytes32 ogStorageRoot;  // 0G Storage root of the AI episode that opened the job
        string ogRequestId;   // 0G Compute request ID of the AI decision that opened the job
    }

    uint16 public constant RELEASE_PCT = 90;
    uint64 public constant DISPUTE_WINDOW = 3 days;
    uint256 public constant MAX_REQUEST_ID_BYTES = 128;

    IERC20 public immutable usdc;
    address public oracle;             // the building's meter key on the Pi
    uint256 public nextJobId = 1;
    uint256 public totalLocked;        // sum of the fees of all unfinished jobs
    mapping(uint256 => Job) public jobs;

    event JobOpened(uint256 indexed jobId, address indexed payer, uint256 fee, uint64 deadline, uint16 outputBefore, string ogRequestId);
    event JobAccepted(uint256 indexed jobId, address indexed cleaner);
    event JobPaid(uint256 indexed jobId, address indexed cleaner, uint256 fee, uint16 outputAfter, bytes32 proof);
    event JobRefunded(uint256 indexed jobId, address indexed payer, uint256 fee);
    event JobCancelled(uint256 indexed jobId, address indexed payer, uint256 fee);
    event JobDisputed(uint256 indexed jobId, address indexed cleaner, string reason);
    event DisputeResolved(uint256 indexed jobId, bool paidCleaner, address indexed to, uint256 fee);
    event EpisodeLinked(uint256 indexed jobId, bytes32 ogStorageRoot);
    event OracleChanged(address indexed oracle);

    error ZeroAddress();
    error NotOracle();
    error NotCleaner();
    error NotAllowed();
    error NoJob();
    error BadStatus();
    error BadAmount();
    error BadOutput(uint16 outputPct);
    error NotClean(uint16 outputPct);
    error RequestIdTooLong();
    error TooEarly();
    error TooLate();
    error AlreadyLinked();

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    constructor(address usdc_, address oracle_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    // ---- lifecycle -----------------------------------------------------------------------

    /// @notice Lock `fee` USDC for a cleaning job. Approve this contract on USDC first.
    /// @param outputBefore panel output now, as % of its clean level (0-100)
    /// @param ogRequestId  0G Compute request ID of the AI decision that flagged the panel ("" if none)
    function openJob(uint96 fee, uint64 deadline, uint16 outputBefore, string calldata ogRequestId)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        if (fee == 0) revert BadAmount();
        if (deadline <= block.timestamp) revert TooLate();
        if (outputBefore > 100) revert BadOutput(outputBefore);
        if (bytes(ogRequestId).length > MAX_REQUEST_ID_BYTES) revert RequestIdTooLong();

        jobId = nextJobId++;
        Job storage j = jobs[jobId];
        j.payer = msg.sender;
        j.fee = fee;
        j.deadline = deadline;
        j.outputBefore = outputBefore;
        j.status = Status.Open;
        j.ogRequestId = ogRequestId;
        totalLocked += fee;

        usdc.safeTransferFrom(msg.sender, address(this), fee);
        emit JobOpened(jobId, msg.sender, fee, deadline, outputBefore, ogRequestId);
    }

    /// @notice The first cleaner to accept gets the job. The payer and the oracle cannot take it.
    function accept(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) revert BadStatus();
        if (block.timestamp > j.deadline) revert TooLate();
        if (msg.sender == j.payer || msg.sender == oracle) revert NotAllowed();
        j.cleaner = msg.sender;
        j.status = Status.Accepted;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice The meter saw the panel at RELEASE_PCT or more: pay the cleaner.
    /// @param proof hash of the signed meter readings that show it (also kept on 0G Storage and Arkiv)
    function release(uint256 jobId, uint16 outputAfter, bytes32 proof) external onlyOracle nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != Status.Accepted && j.status != Status.Disputed) revert BadStatus();
        if (block.timestamp > j.deadline) revert TooLate();
        if (outputAfter > 100) revert BadOutput(outputAfter);
        if (outputAfter < RELEASE_PCT) revert NotClean(outputAfter);

        uint256 fee = j.fee;
        address cleaner = j.cleaner;
        j.status = Status.Paid;
        j.outputAfter = outputAfter;
        j.proof = proof;
        totalLocked -= fee;

        usdc.safeTransfer(cleaner, fee);
        emit JobPaid(jobId, cleaner, fee, outputAfter, proof);
    }

    /// @notice Nobody has accepted yet (for example, rain cleaned the panel): the payer or the oracle
    ///         takes the job down and the fee goes back to the payer.
    function cancel(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) revert BadStatus();
        if (msg.sender != j.payer && msg.sender != oracle) revert NotAllowed();

        uint256 fee = j.fee;
        address payer = j.payer;
        j.status = Status.Cancelled;
        totalLocked -= fee;

        usdc.safeTransfer(payer, fee);
        emit JobCancelled(jobId, payer, fee);
    }

    /// @notice The cleaner says the work is done but the meter disagrees (for example, a cloudy day).
    ///         This stops the plain deadline refund. The committee resolves it, the meter can still
    ///         release it before the deadline, or anyone can refund it after the dispute window.
    function dispute(uint256 jobId, string calldata reason) external {
        Job storage j = jobs[jobId];
        if (j.status != Status.Accepted) revert BadStatus();
        if (msg.sender != j.cleaner) revert NotCleaner();
        if (block.timestamp > j.deadline) revert TooLate();
        j.status = Status.Disputed;
        emit JobDisputed(jobId, msg.sender, reason);
    }

    /// @notice The committee settles a dispute: pay the cleaner or refund the payer.
    function resolve(uint256 jobId, bool payCleaner) external onlyOwner nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != Status.Disputed) revert BadStatus();

        uint256 fee = j.fee;
        address to = payCleaner ? j.cleaner : j.payer;
        j.status = payCleaner ? Status.Paid : Status.Refunded;
        totalLocked -= fee;

        usdc.safeTransfer(to, fee);
        emit DisputeResolved(jobId, payCleaner, to, fee);
    }

    /// @notice After the deadline (or the dispute window for a disputed job), anyone can send an
    ///         unpaid fee back to the payer.
    function refund(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status == Status.Open || j.status == Status.Accepted) {
            if (block.timestamp <= j.deadline) revert TooEarly();
        } else if (j.status == Status.Disputed) {
            if (block.timestamp <= uint256(j.deadline) + DISPUTE_WINDOW) revert TooEarly();
        } else {
            revert BadStatus();
        }

        uint256 fee = j.fee;
        address payer = j.payer;
        j.status = Status.Refunded;
        totalLocked -= fee;

        usdc.safeTransfer(payer, fee);
        emit JobRefunded(jobId, payer, fee);
    }

    /// @notice Attach the 0G Storage root of the AI episode that opened the job. The upload
    ///         finishes after the job is opened, so this is a separate call. It can be set only once.
    function linkEpisode(uint256 jobId, bytes32 ogStorageRoot) external onlyOracle {
        Job storage j = jobs[jobId];
        if (j.status == Status.None) revert NoJob();
        if (ogStorageRoot == bytes32(0)) revert BadAmount();
        if (j.ogStorageRoot != bytes32(0)) revert AlreadyLinked();
        j.ogStorageRoot = ogStorageRoot;
        emit EpisodeLinked(jobId, ogStorageRoot);
    }
}
