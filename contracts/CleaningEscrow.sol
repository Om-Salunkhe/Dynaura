// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CleaningEscrow
/// @notice A dusty panel posts a cleaning job. The fee is locked in USDC. A cleaner accepts it.
///         The building's meter (the oracle) releases the fee only when panel output is back
///         above 90% of its clean level. If nobody fixes it before the deadline, the society
///         gets its money back. No human approves the payout: the sun does.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CleaningEscrow {
    enum Status { None, Open, Accepted, Paid, Refunded }

    struct Job {
        address payer;        // society wallet that locked the fee
        address cleaner;      // set on accept
        uint96 fee;           // USDC, 6 decimals
        uint64 deadline;      // unix seconds; refund allowed after this
        uint16 outputBefore;  // panel output when posted, % of clean level
        uint16 outputAfter;   // panel output at release, % of clean level
        Status status;
        bytes32 proof;        // hash of the signed meter readings that proved the clean
    }

    uint16 public constant RELEASE_PCT = 90;

    IERC20 public immutable usdc;
    address public owner;
    address public oracle; // the building's device key on the Pi
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) public jobs;

    event JobOpened(uint256 indexed jobId, address indexed payer, uint256 fee, uint64 deadline, uint16 outputBefore);
    event JobAccepted(uint256 indexed jobId, address indexed cleaner);
    event JobPaid(uint256 indexed jobId, address indexed cleaner, uint256 fee, uint16 outputAfter, bytes32 proof);
    event JobRefunded(uint256 indexed jobId, address indexed payer, uint256 fee);
    event OracleChanged(address oracle);

    error NotOwner();
    error NotOracle();
    error BadStatus();
    error TooEarly();
    error TooLate();
    error NotClean(uint16 outputPct);
    error TransferFailed();

    constructor(address usdc_, address oracle_) {
        usdc = IERC20(usdc_);
        owner = msg.sender;
        oracle = oracle_;
    }

    function setOracle(address oracle_) external {
        if (msg.sender != owner) revert NotOwner();
        oracle = oracle_;
        emit OracleChanged(oracle_);
    }

    /// @notice Lock `fee` USDC for a cleaning job. Approve this contract on USDC first.
    function openJob(uint96 fee, uint64 deadline, uint16 outputBefore) external returns (uint256 jobId) {
        if (deadline <= block.timestamp) revert TooLate();
        jobId = nextJobId++;
        jobs[jobId] = Job(msg.sender, address(0), fee, deadline, outputBefore, 0, Status.Open, bytes32(0));
        if (!usdc.transferFrom(msg.sender, address(this), fee)) revert TransferFailed();
        emit JobOpened(jobId, msg.sender, fee, deadline, outputBefore);
    }

    /// @notice First cleaner to accept gets the job.
    function accept(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) revert BadStatus();
        if (block.timestamp > j.deadline) revert TooLate();
        j.cleaner = msg.sender;
        j.status = Status.Accepted;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice The meter saw the panel back above 90%: pay the cleaner.
    /// @param proof hash of the signed 1-minute readings that show it (also stored on 0G / Arkiv)
    function release(uint256 jobId, uint16 outputAfter, bytes32 proof) external {
        if (msg.sender != oracle) revert NotOracle();
        Job storage j = jobs[jobId];
        if (j.status != Status.Accepted) revert BadStatus();
        if (block.timestamp > j.deadline) revert TooLate();
        if (outputAfter < RELEASE_PCT) revert NotClean(outputAfter);
        j.status = Status.Paid;
        j.outputAfter = outputAfter;
        j.proof = proof;
        if (!usdc.transfer(j.cleaner, j.fee)) revert TransferFailed();
        emit JobPaid(jobId, j.cleaner, j.fee, outputAfter, proof);
    }

    /// @notice After the deadline, anyone can send an unpaid fee back to the society.
    function refund(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open && j.status != Status.Accepted) revert BadStatus();
        if (block.timestamp <= j.deadline) revert TooEarly();
        j.status = Status.Refunded;
        if (!usdc.transfer(j.payer, j.fee)) revert TransferFailed();
        emit JobRefunded(jobId, j.payer, j.fee);
    }
}
