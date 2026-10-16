// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/QRClaimContract.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    function mint(address a, uint256 n) external { balanceOf[a] += n; }
    function transfer(address to, uint256 n) external returns (bool) { balanceOf[msg.sender] -= n; balanceOf[to] += n; return true; }
}
contract MockNft { mapping(address => uint256) public balanceOf; function mint(address a) external { balanceOf[a] += 1; } }
contract MockGearVault {
    MockToken t; mapping(address => bool) public isOperator;
    constructor(MockToken _t) { t = _t; }
    function authorizeOperator(address o) external { isOperator[o] = true; }
    function dispense(address r, uint256 a) external { require(isOperator[msg.sender], "op"); require(a <= 50e6, "max"); t.transfer(r, a); }
}
contract MockCaphVault {
    MockToken t; mapping(bytes32 => bool) used;
    constructor(MockToken _t) { t = _t; }
    function payout(address to, uint256 a, bytes32 ref) external { require(!used[ref], "ref"); used[ref] = true; t.transfer(to, a); }
}

contract QRClaimTest is Test {
    QRClaimContract c; MockToken gear; MockToken caph; MockToken junk;
    address ledger = address(0x1ED6E5); uint256 sk = 0xA11CE; address signer; address bob = address(0xB0B);
    bytes32 key = keccak256("randomId1");

    function setUp() public {
        signer = vm.addr(sk);
        gear = new MockToken(); caph = new MockToken(); junk = new MockToken();
        address[] memory toks = new address[](2); toks[0] = address(gear); toks[1] = address(caph);
        c = new QRClaimContract(ledger, signer, toks);
        gear.mint(address(c), 10e6); // direct deposit by any wallet
    }
    function _refill(uint128 amt) internal {
        bytes32[] memory k = new bytes32[](1); k[0] = key; uint128[] memory a = new uint128[](1); a[0] = amt;
        vm.prank(ledger); c.refill(k, address(gear), a);
    }
    function _sig(address to, uint256 amt, uint64 ep, uint256 n, uint256 dl) internal view returns (bytes memory) {
        bytes32 sh = keccak256(abi.encode(c.CLAIM_TYPEHASH(), key, address(gear), to, amt, ep, n, dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sk, keccak256(abi.encodePacked("\x19\x01", c.DOMAIN_SEPARATOR(), sh)));
        return abi.encodePacked(r, s, v);
    }

    function testClaimFlow() public {
        _refill(1e6);
        assertEq(c.float(address(gear)), 9e6);
        uint256 dl = block.timestamp + 600;
        c.claim(key, address(gear), bob, 1e6, 1, 7, dl, _sig(bob, 1e6, 1, 7, dl));
        assertEq(gear.balanceOf(bob), 1e6);
        bytes memory s1 = _sig(bob, 1e6, 1, 7, dl);
        vm.expectRevert(QRClaimContract.NonceUsed.selector); c.claim(key, address(gear), bob, 1e6, 1, 7, dl, s1);
        bytes memory s2 = _sig(bob, 1e6, 1, 8, dl);
        vm.expectRevert(QRClaimContract.Insufficient.selector); c.claim(key, address(gear), bob, 1e6, 1, 8, dl, s2);
    }
    function testEpochKillsOldAuth() public {
        _refill(1e6); uint256 dl = block.timestamp + 600; bytes memory s = _sig(bob, 1e6, 1, 1, dl);
        _refill(1e6);
        vm.expectRevert(QRClaimContract.WrongEpoch.selector); c.claim(key, address(gear), bob, 1e6, 1, 1, dl, s);
    }
    function testBadSigAndRecipientSwap() public {
        _refill(1e6); uint256 dl = block.timestamp + 600; bytes memory s = _sig(bob, 1e6, 1, 1, dl);
        vm.expectRevert(QRClaimContract.BadSig.selector); c.claim(key, address(gear), address(0xBAD), 1e6, 1, 1, dl, s);
    }
    function testExpiredAndPaused() public {
        _refill(1e6); uint256 dl = block.timestamp + 1; bytes memory s = _sig(bob, 1e6, 1, 1, dl);
        vm.prank(ledger); c.setPaused(true);
        vm.expectRevert(QRClaimContract.IsPaused.selector); c.claim(key, address(gear), bob, 1e6, 1, 1, dl, s);
        vm.prank(ledger); c.setPaused(false); vm.warp(dl + 1);
        vm.expectRevert(QRClaimContract.Expired.selector); c.claim(key, address(gear), bob, 1e6, 1, 1, dl, s);
    }
    function testOnlyOwnerRules() public {
        vm.startPrank(bob);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.setSigner(bob);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.setTokenAllowed(address(junk), true);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.withdraw(address(gear), bob, 1);
        vm.expectRevert(QRClaimContract.NotRefiller.selector); c.pullFromVault(address(1), 1);
        vm.stopPrank();
    }
    function testVaultPulls() public {
        MockGearVault gv = new MockGearVault(gear); gear.mint(address(gv), 100e6);
        MockCaphVault cv = new MockCaphVault(caph); caph.mint(address(cv), 100e6);
        vm.startPrank(ledger);
        c.setVault(address(gv), address(gear), QRClaimContract.VaultKind.GearVault);
        c.setVault(address(cv), address(caph), QRClaimContract.VaultKind.CaphVault);
        gv.authorizeOperator(address(c));
        c.setRefiller(bob); vm.stopPrank();
        vm.startPrank(bob);
        c.pullFromVault(address(gv), 50e6); c.pullFromVault(address(cv), 5e6); c.pullFromVault(address(cv), 5e6);
        vm.expectRevert(QRClaimContract.BadVault.selector); c.pullFromVault(address(0xDEAD), 1);
        vm.stopPrank();
        assertEq(gear.balanceOf(address(c)), 60e6); assertEq(caph.balanceOf(address(c)), 10e6);
    }
    function testTeamNftCanRefillRetirePullButNotWithdraw() public {
        MockNft nft = new MockNft(); address mate = address(0x7EA7); nft.mint(mate);
        vm.prank(ledger); c.setTeamNft(address(nft));
        MockGearVault gv = new MockGearVault(gear); gear.mint(address(gv), 100e6);
        vm.startPrank(ledger); c.setVault(address(gv), address(gear), QRClaimContract.VaultKind.GearVault); gv.authorizeOperator(address(c)); vm.stopPrank();
        bytes32[] memory k = new bytes32[](1); k[0] = key; uint128[] memory a = new uint128[](1); a[0] = 11e6;
        vm.startPrank(mate);
        vm.expectRevert(QRClaimContract.Insufficient.selector); c.refill(k, address(gear), a); // > unassigned float (10)
        c.pullFromVault(address(gv), 5e6);
        vm.expectRevert(bytes("max")); c.pullFromVault(address(gv), 51e6); // vault cap still applies
        c.refill(k, address(gear), a);
        assertEq(c.float(address(gear)), 4e6);
        c.retire(key);
        assertEq(c.float(address(gear)), 15e6);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.withdraw(address(gear), mate, 1);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.setPaused(true);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.setTeamNft(address(0));
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.setTokenAllowed(address(junk), true);
        vm.expectRevert(QRClaimContract.NotOwner.selector); c.rescueToken(address(junk), mate, 0);
        vm.stopPrank();
        vm.prank(address(0xBEEF)); vm.expectRevert(QRClaimContract.NotRefiller.selector); c.refill(k, address(gear), a);
    }
    function testWithdrawOnlyFloatAndRescue() public {
        _refill(4e6);
        vm.startPrank(ledger);
        vm.expectRevert(QRClaimContract.Insufficient.selector); c.withdraw(address(gear), ledger, 7e6);
        c.withdraw(address(gear), ledger, 6e6);
        c.retire(key); c.withdraw(address(gear), ledger, 4e6);
        junk.mint(address(c), 3); c.rescueToken(address(junk), ledger, 3);
        vm.expectRevert(QRClaimContract.AllowedToken.selector); c.rescueToken(address(gear), ledger, 1);
        vm.stopPrank();
        assertEq(gear.balanceOf(ledger), 10e6);
    }
}
