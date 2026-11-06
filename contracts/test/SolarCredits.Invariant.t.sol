// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SolarCredits} from "../src/SolarCredits.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {SolarCreditsTestBase} from "./SolarCredits.Base.t.sol";
import {SolarCreditsHandler} from "./SolarCredits.Handler.sol";

contract SolarCreditsInvariantTest is SolarCreditsTestBase {
    SolarCreditsHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new SolarCreditsHandler(sc, usdc, owner, oracle);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](7);
        sels[0] = handler.post.selector;
        sels[1] = handler.register.selector;
        sels[2] = handler.fund.selector;
        sels[3] = handler.payIn.selector;
        sels[4] = handler.claim.selector;
        sels[5] = handler.setOracle.selector;
        sels[6] = handler.setBlocked.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_BalanceCoversOutstandingCredit() public view {
        uint256 outstanding;
        for (uint256 k = 0; k < handler.idsLength(); k++) {
            bytes32 id = handler.idAt(k);
            uint256 tin = _totalIn(id);
            uint256 tcl = _totalClaimed(id);
            assertLe(tcl, tin, "totalClaimed > totalIn");
            outstanding += tin - tcl;
        }
        assertGe(usdc.balanceOf(address(sc)), outstanding, "balance < outstanding");
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_BalanceEqualsGhostInMinusOut() public view {
        assertEq(usdc.balanceOf(address(sc)), handler.ghostIn() - handler.ghostOut(), "balance != in - out");
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_PerPeriodAndPerFlatAccounting() public view {
        for (uint256 k = 0; k < handler.idsLength(); k++) {
            bytes32 id = handler.idAt(k);
            _checkPeriod(id);
        }
    }

    function _checkPeriod(bytes32 id) internal view {
        (bool posted,, bytes32 h, uint256 tu, uint256 tin, uint256 tcl) = sc.periodInfo(id);
        assertEq(tin, handler.ghostPeriodIn(id), "totalIn != ghost");
        if (!posted) {
            assertEq(tin, 0);
            return;
        }
        assertEq(tu, handler.ghostPostedUnused(id), "totalUnused mutated");
        assertEq(h, handler.ghostHash(id), "hash mutated");
        string[] memory flats = sc.flatsOf(id);
        uint256 sumClaimed;
        for (uint256 i = 0; i < flats.length; i++) {
            (, uint256 u,,, uint256 c) = sc.flatInfo(id, flats[i]);
            uint256 ent = tu == 0 ? 0 : Math.mulDiv(tin, u, tu);
            assertLe(c, ent, "claimed > entitlement");
            sumClaimed += c;
        }
        assertEq(sumClaimed, tcl, "sum flat claimed != totalClaimed");
    }
}
