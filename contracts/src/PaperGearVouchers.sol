// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title PaperGearVouchers - printable GEAR claim cards
/// @notice Owner registers keccak256(secret) per card id and funds the amount in the same tx.
///         Whoever submits the matching secret first gets the GEAR. Owner can revoke unused cards.
contract PaperGearVouchers {
    enum Status { None, Active, Claimed, Revoked }
    struct Voucher { bytes32 hash; uint128 amount; Status status; }

    IERC20 public immutable token;
    address public owner;
    mapping(uint256 => Voucher) public vouchers;

    event Registered(uint256 indexed id, uint256 amount);
    event Claimed(uint256 indexed id, address indexed to, uint256 amount);
    event Revoked(uint256 indexed id, uint256 amount);
    event OwnerChanged(address owner);

    error NotOwner(); error BadVoucher(); error WrongSecret(); error Exists(); error Length(); error TransferFailed();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(IERC20 _token, address _owner) { token = _token; owner = _owner; }

    function setOwner(address o) external onlyOwner { owner = o; emit OwnerChanged(o); }

    /// @dev Pulls sum(amounts) of GEAR from owner (approve first).
    function register(uint256[] calldata ids, bytes32[] calldata hashes, uint128[] calldata amounts) external onlyOwner {
        if (ids.length != hashes.length || ids.length != amounts.length) revert Length();
        uint256 total;
        for (uint256 i; i < ids.length; ++i) {
            if (vouchers[ids[i]].status != Status.None) revert Exists();
            vouchers[ids[i]] = Voucher(hashes[i], amounts[i], Status.Active);
            total += amounts[i];
            emit Registered(ids[i], amounts[i]);
        }
        if (!token.transferFrom(msg.sender, address(this), total)) revert TransferFailed();
    }

    function claim(uint256 id, bytes32 secret, address to) external {
        Voucher storage v = vouchers[id];
        if (v.status != Status.Active) revert BadVoucher();
        if (keccak256(abi.encodePacked(secret)) != v.hash) revert WrongSecret();
        v.status = Status.Claimed;
        emit Claimed(id, to, v.amount);
        if (!token.transfer(to, v.amount)) revert TransferFailed();
    }

    /// @notice Pull back GEAR from lost / unused cards.
    function revoke(uint256[] calldata ids) external onlyOwner {
        uint256 total;
        for (uint256 i; i < ids.length; ++i) {
            Voucher storage v = vouchers[ids[i]];
            if (v.status != Status.Active) continue;
            v.status = Status.Revoked;
            total += v.amount;
            emit Revoked(ids[i], v.amount);
        }
        if (total > 0 && !token.transfer(owner, total)) revert TransferFailed();
    }
}
