// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/PaperGearVouchers.sol";

contract MockGear {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address a, uint256 n) external { balanceOf[a] += n; }
    function approve(address s, uint256 n) external returns (bool) { allowance[msg.sender][s] = n; return true; }
    function transfer(address to, uint256 n) external returns (bool) { balanceOf[msg.sender] -= n; balanceOf[to] += n; return true; }
    function transferFrom(address f, address to, uint256 n) external returns (bool) { allowance[f][msg.sender] -= n; balanceOf[f] -= n; balanceOf[to] += n; return true; }
}

contract VouchersTest is Test {
    MockGear gear; PaperGearVouchers v; address cap = address(0xCA9); address alice = address(0xA11);
    bytes32 s1 = keccak256("one"); bytes32 s2 = keccak256("two");

    function setUp() public {
        gear = new MockGear(); v = new PaperGearVouchers(IERC20(address(gear)), cap);
        gear.mint(cap, 100e6);
        uint256[] memory ids = new uint256[](2); ids[0] = 1; ids[1] = 2;
        bytes32[] memory h = new bytes32[](2); h[0] = keccak256(abi.encodePacked(s1)); h[1] = keccak256(abi.encodePacked(s2));
        uint128[] memory a = new uint128[](2); a[0] = 5e6; a[1] = 10e6;
        vm.startPrank(cap); gear.approve(address(v), 15e6); v.register(ids, h, a); vm.stopPrank();
    }

    function testClaim() public {
        vm.prank(alice); v.claim(1, s1, alice);
        assertEq(gear.balanceOf(alice), 5e6);
        vm.expectRevert(PaperGearVouchers.BadVoucher.selector); v.claim(1, s1, alice);
    }
    function testWrongSecret() public {
        vm.expectRevert(PaperGearVouchers.WrongSecret.selector); v.claim(1, s2, alice);
    }
    function testRevoke() public {
        uint256[] memory ids = new uint256[](2); ids[0] = 1; ids[1] = 2;
        vm.prank(alice); v.claim(1, s1, alice);
        vm.prank(cap); v.revoke(ids);
        assertEq(gear.balanceOf(cap), 95e6);
        vm.expectRevert(PaperGearVouchers.BadVoucher.selector); v.claim(2, s2, alice);
    }
    function testOnlyOwner() public {
        uint256[] memory ids = new uint256[](1);
        vm.expectRevert(PaperGearVouchers.NotOwner.selector); v.revoke(ids);
    }
    function testNoDoubleRegister() public {
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        bytes32[] memory h = new bytes32[](1); uint128[] memory a = new uint128[](1);
        vm.prank(cap); vm.expectRevert(PaperGearVouchers.Exists.selector); v.register(ids, h, a);
    }
}
