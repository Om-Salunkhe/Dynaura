// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CleaningEscrow
/// @notice USDC cleaning escrow with Pi-meter verification and committee dispute resolution.
/// @dev Intended token: canonical USDC at 0x3600000000000000000000000000000000000000,
///      with 6 decimals (2_000_000 = 2 USDC), supplied through usdc_. Assumes exact transfers.
///      totalLocked equals fees of Open, Accepted and Disputed jobs plus unclaimed deferred payouts.
///      The invariant is usdc.balanceOf(address(this)) >= totalLocked, with equality absent
///      unsolicited transfers, which cannot be prevented and may add surplus balance.
///      The oracle attests meter measurements; the contract cannot verify off-chain readings.
/// @dev USDC issuer blocklisting of the contract address would freeze funds and cannot be mitigated onchain.
contract CleaningEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Accepted, Paid, Refunded, Cancelled, Disputed }

    struct Job {
        address payer;
        address cleaner;
        uint96 fee;
        uint64 deadline;
        uint16 outputBefore;
        uint16 outputAfter;
        Status status;
        bytes32 proof;
        bytes32 ogStorageRoot;
        string ogRequestId;
    }

    uint16 public constant RELEASE_PCT = 90;
    uint256 public constant DISPUTE_WINDOW = 3 days;
    uint256 public constant MAX_REQUEST_ID_BYTES = 128;
    uint256 public constant MAX_REASON_BYTES = 256;

    IERC20 public immutable usdc;
    address public oracle;
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) public jobs;
    uint256 public totalLocked;
    mapping(uint256 => uint256) public pendingPayout;

    /// @notice Links the funded job to the 0G AI request that flagged the dirty panel.
    event JobOpened(uint256 indexed jobId, address indexed payer, uint256 fee, uint64 deadline, uint16 outputBefore, string ogRequestId);
    /// @notice Records the first eligible cleaner to accept a job.
    event JobAccepted(uint256 indexed jobId, address indexed cleaner);
    /// @notice Records a cleaner payment and its meter proof (zero for committee resolution).
    event JobPaid(uint256 indexed jobId, address indexed cleaner, uint256 fee, uint16 outputAfter, bytes32 proof);
    /// @notice Records a refund following expiry or committee resolution.
    event JobRefunded(uint256 indexed jobId, address indexed payer, uint256 fee);
    /// @notice Records cancellation and return of an unaccepted fee.
    event JobCancelled(uint256 indexed jobId, address indexed payer, uint256 fee);
    /// @notice Records the cleaner's dispute reason.
    event JobDisputed(uint256 indexed jobId, address indexed cleaner, string reason);
    /// @notice Records the committee's decision, the account that receives the fee and the amount.
    event DisputeResolved(uint256 indexed jobId, bool paidCleaner, address indexed recipient, uint256 amount);
    /// @notice Links a job, and thus its payment, to its immutable 0G Storage episode root.
    event EpisodeLinked(uint256 indexed jobId, bytes32 ogStorageRoot);
    /// @notice Records the authorized Pi oracle address.
    event OracleChanged(address oracle);
    event PayoutDeferred(uint256 indexed jobId, address indexed recipient, uint256 amount);
    event PayoutClaimed(uint256 indexed jobId, address indexed recipient, uint256 amount);

    error ZeroAddress();
    error NotOracle();
    error NotAllowed();
    error NotCleaner();
    error NoJob();
    error BadStatus();
    error TooEarly();
    error TooLate();
    error BadAmount();
    error BadOutput(uint16 outputPct);
    error NotClean(uint16 outputPct);
    error RequestIdTooLong();
    error ReasonTooLong();
    error AlreadyLinked();
    error NotRecipient();
    error NothingPending();

    /// @notice Initializes the token, Pi oracle and explicit committee owner.
    constructor(address usdc_, address oracle_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    /// @notice Changes the Pi oracle; only the committee may call.
    /// @dev Immediate rotation is deliberate so a compromised Pi key can be replaced without delay.
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

    /// @notice Disabled: the committee owner must remain nonzero for dispute resolution.
    function renounceOwnership() public override onlyOwner {
        revert ZeroAddress();
    }

    /// @notice Locks a positive fee and stores the AI decision ID; approve USDC first.
    function openJob(uint96 fee, uint64 deadline, uint16 outputBefore, string calldata ogRequestId)
        external nonReentrant returns (uint256 jobId)
    {
        if (fee == 0) revert BadAmount();
        if (deadline <= block.timestamp) revert TooLate();
        if (outputBefore > 100) revert BadOutput(outputBefore);
        if (bytes(ogRequestId).length > MAX_REQUEST_ID_BYTES) revert RequestIdTooLong();
        jobId = nextJobId++;
        jobs[jobId] = Job(msg.sender, address(0), fee, deadline, outputBefore, 0, Status.Open, bytes32(0), bytes32(0), ogRequestId);
        totalLocked += fee;
        emit JobOpened(jobId, msg.sender, fee, deadline, outputBefore, ogRequestId);
        usdc.safeTransferFrom(msg.sender, address(this), fee);
    }

    /// @notice Assigns an open job to its first cleaner by the deadline.
    /// @dev The payer, the oracle and the committee owner cannot accept: none of them may be paid by a decision they control.
    function accept(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) revert BadStatus();
        if (block.timestamp > j.deadline) revert TooLate();
        if (msg.sender == j.payer || msg.sender == oracle || msg.sender == owner()) revert NotAllowed();
        j.cleaner = msg.sender;
        j.status = Status.Accepted;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Oracle pays an accepted or disputed cleaner for output of 90–100% by the deadline.
    /// @param jobId Existing job to pay.
    /// @param outputAfter Percentage of clean-panel output measured by the Pi.
    /// @param proof Hash of signed meter readings; stored alongside the AI decision linkage.
    function release(uint256 jobId, uint16 outputAfter, bytes32 proof) external nonReentrant {
        if (msg.sender != oracle) revert NotOracle();
        Job storage j = jobs[jobId];
        if (j.status != Status.Accepted && j.status != Status.Disputed) revert BadStatus();
        if (block.timestamp > j.deadline) revert TooLate();
        if (outputAfter > 100) revert BadOutput(outputAfter);
        if (outputAfter < RELEASE_PCT) revert NotClean(outputAfter);
        j.status = Status.Paid;
        totalLocked -= j.fee;
        j.outputAfter = outputAfter;
        j.proof = proof;
        emit JobPaid(jobId, j.cleaner, j.fee, outputAfter, proof);
        if (!usdc.trySafeTransfer(j.cleaner, j.fee)) {
            pendingPayout[jobId] = j.fee;
            totalLocked += j.fee;
            emit PayoutDeferred(jobId, j.cleaner, j.fee);
        }
    }

    /// @notice Payer or oracle cancels an open job and returns its full fee.
    function cancel(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) revert BadStatus();
        if (msg.sender != j.payer && msg.sender != oracle) revert NotAllowed();
        j.status = Status.Cancelled;
        totalLocked -= j.fee;
        emit JobCancelled(jobId, j.payer, j.fee);
        if (!usdc.trySafeTransfer(j.payer, j.fee)) {
            pendingPayout[jobId] = j.fee;
            totalLocked += j.fee;
            emit PayoutDeferred(jobId, j.payer, j.fee);
        }
    }

    /// @notice Assigned cleaner disputes an accepted job by its deadline, with at most 256 reason bytes.
    function dispute(uint256 jobId, string calldata reason) external {
        Job storage j = jobs[jobId];
        if (j.status != Status.Accepted) revert BadStatus();
        if (msg.sender != j.cleaner) revert NotCleaner();
        if (block.timestamp > j.deadline) revert TooLate();
        if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLong();
        j.status = Status.Disputed;
        emit JobDisputed(jobId, msg.sender, reason);
    }

    /// @notice Committee resolves a disputed job once, paying the cleaner or refunding the payer.
    function resolve(uint256 jobId, bool payCleaner) external onlyOwner nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != Status.Disputed) revert BadStatus();
        j.status = payCleaner ? Status.Paid : Status.Refunded;
        totalLocked -= j.fee;
        emit DisputeResolved(jobId, payCleaner, payCleaner ? j.cleaner : j.payer, j.fee);
        if (payCleaner) {
            emit JobPaid(jobId, j.cleaner, j.fee, 0, bytes32(0));
            if (!usdc.trySafeTransfer(j.cleaner, j.fee)) {
                pendingPayout[jobId] = j.fee;
                totalLocked += j.fee;
                emit PayoutDeferred(jobId, j.cleaner, j.fee);
            }
        } else {
            emit JobRefunded(jobId, j.payer, j.fee);
            if (!usdc.trySafeTransfer(j.payer, j.fee)) {
                pendingPayout[jobId] = j.fee;
                totalLocked += j.fee;
                emit PayoutDeferred(jobId, j.payer, j.fee);
            }
        }
    }

    /// @notice Anyone refunds expired unfinished jobs; disputes wait until after the additional 3 days.
    function refund(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open && j.status != Status.Accepted && j.status != Status.Disputed) revert BadStatus();
        uint256 refundableAfter = uint256(j.deadline);
        if (j.status == Status.Disputed) refundableAfter += DISPUTE_WINDOW;
        if (block.timestamp <= refundableAfter) revert TooEarly();
        j.status = Status.Refunded;
        totalLocked -= j.fee;
        emit JobRefunded(jobId, j.payer, j.fee);
        if (!usdc.trySafeTransfer(j.payer, j.fee)) {
            pendingPayout[jobId] = j.fee;
            totalLocked += j.fee;
            emit PayoutDeferred(jobId, j.payer, j.fee);
        }
    }

    /// @notice Only the terminal job's recipient can claim its deferred payout, paid to that recipient.
    function claimPayout(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        address recipient;
        if (j.status == Status.Paid) {
            recipient = j.cleaner;
        } else if (j.status == Status.Refunded || j.status == Status.Cancelled) {
            recipient = j.payer;
        }
        if (msg.sender != recipient) revert NotRecipient();
        uint256 amount = pendingPayout[jobId];
        if (amount == 0) revert NothingPending();
        pendingPayout[jobId] = 0;
        totalLocked -= amount;
        emit PayoutClaimed(jobId, recipient, amount);
        usdc.safeTransfer(recipient, amount);
    }

    /// @notice Oracle permanently links any existing job to a nonzero 0G Storage episode root.
    function linkEpisode(uint256 jobId, bytes32 ogStorageRoot) external {
        if (msg.sender != oracle) revert NotOracle();
        Job storage j = jobs[jobId];
        if (j.status == Status.None) revert NoJob();
        if (j.ogStorageRoot != bytes32(0)) revert AlreadyLinked();
        if (ogStorageRoot == bytes32(0)) revert BadAmount();
        j.ogStorageRoot = ogStorageRoot;
        emit EpisodeLinked(jobId, ogStorageRoot);
    }
}
