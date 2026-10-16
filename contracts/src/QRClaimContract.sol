// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}
/// GearVault: approved operator pays any recipient (<= maxDispense, <= dailyCap)
interface IGearVault { function dispense(address recipient, uint256 amount) external; }
/// CAPHVault: approved game pays any recipient with a unique ref
interface ICaphVault { function payout(address to, uint256 amount, bytes32 ref) external; }

/// @title QRClaimContract - refillable multi-token QR claim slots for Cap
/// @notice Owner (Cap's Ledger) sets every rule. The signer key can only authorize claims (EIP-712).
///         Funds arrive by direct transfer or by pulling from Ledger-approved vaults. Only the owner withdraws.
contract QRClaimContract {
    enum VaultKind { None, GearVault, CaphVault }
    struct Vault { address token; VaultKind kind; }
    struct Slot { address token; uint128 balance; uint64 epoch; bool retired; }

    address public owner;
    address public signer;
    address public refiller;
    bool public paused;

    mapping(address => bool) public allowedToken;
    mapping(address => Vault) public vaults;
    mapping(address => uint256) public assigned; // token => sum of slot balances
    mapping(bytes32 => Slot) public slots;       // slotKey = keccak256(randomId)
    mapping(uint256 => bool) public nonceUsed;
    uint256 private pullNonce;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(bytes32 slot,address token,address to,uint256 amount,uint64 epoch,uint256 nonce,uint256 deadline)"
    );

    event OwnerChanged(address owner);
    event SignerChanged(address signer);
    event RefillerChanged(address refiller);
    event TokenAllowed(address token, bool allowed);
    event VaultSet(address vault, address token, VaultKind kind);
    event Pulled(address vault, address token, uint256 amount);
    event Refilled(bytes32 indexed slot, address token, uint256 amount, uint64 epoch);
    event Retired(bytes32 indexed slot, uint256 returned);
    event Claimed(bytes32 indexed slot, address indexed to, address token, uint256 amount, uint64 epoch, uint256 nonce);
    event Paused(bool paused);
    event Withdrawn(address token, address to, uint256 amount);

    error NotOwner(); error NotRefiller(); error IsPaused(); error TokenNotAllowed(); error BadVault();
    error Insufficient(); error BadSig(); error Expired(); error NonceUsed(); error WrongEpoch();
    error SlotRetired(); error TokenMismatch(); error Length(); error TransferFailed(); error Zero(); error AllowedToken();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyRefiller() { if (msg.sender != owner && msg.sender != refiller) revert NotRefiller(); _; }

    constructor(address _owner, address _signer, address[] memory tokens) {
        if (_owner == address(0) || _signer == address(0)) revert Zero();
        owner = _owner; signer = _signer;
        for (uint256 i; i < tokens.length; ++i) { allowedToken[tokens[i]] = true; emit TokenAllowed(tokens[i], true); }
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("QRClaimContract"), keccak256("1"), block.chainid, address(this)));
    }

    // ---------------- owner rules ----------------
    function setOwner(address o) external onlyOwner { if (o == address(0)) revert Zero(); owner = o; emit OwnerChanged(o); }
    function setSigner(address s) external onlyOwner { if (s == address(0)) revert Zero(); signer = s; emit SignerChanged(s); }
    function setRefiller(address r) external onlyOwner { refiller = r; emit RefillerChanged(r); }
    function setPaused(bool p) external onlyOwner { paused = p; emit Paused(p); }
    function setTokenAllowed(address t, bool a) external onlyOwner { allowedToken[t] = a; emit TokenAllowed(t, a); }
    function setVault(address v, address token, VaultKind kind) external onlyOwner {
        if (kind != VaultKind.None && !allowedToken[token]) revert TokenNotAllowed();
        vaults[v] = Vault(token, kind); emit VaultSet(v, token, kind);
    }

    // ---------------- funding ----------------
    /// Unassigned float of a token = balance held - balances assigned to slots.
    function float(address token) public view returns (uint256) { return IERC20(token).balanceOf(address(this)) - assigned[token]; }

    /// Pull from an approved vault into this contract (vault limits apply).
    function pullFromVault(address v, uint256 amount) external onlyRefiller {
        Vault memory vt = vaults[v];
        if (vt.kind == VaultKind.GearVault) IGearVault(v).dispense(address(this), amount);
        else if (vt.kind == VaultKind.CaphVault) ICaphVault(v).payout(address(this), amount, keccak256(abi.encode(address(this), ++pullNonce)));
        else revert BadVault();
        emit Pulled(v, vt.token, amount);
    }

    /// Assign float to slots and start a new epoch for each (old signed auths die).
    function refill(bytes32[] calldata keys, address token, uint128[] calldata amounts) external onlyRefiller {
        if (keys.length != amounts.length) revert Length();
        if (!allowedToken[token]) revert TokenNotAllowed();
        uint256 total;
        for (uint256 i; i < keys.length; ++i) total += amounts[i];
        if (float(token) < total) revert Insufficient();
        for (uint256 i; i < keys.length; ++i) {
            Slot storage s = slots[keys[i]];
            if (s.retired) revert SlotRetired();
            if (s.token != address(0) && s.token != token && s.balance > 0) revert TokenMismatch();
            s.token = token; s.balance += amounts[i]; s.epoch += 1;
            emit Refilled(keys[i], token, s.balance, s.epoch);
        }
        assigned[token] += total;
    }

    /// Retire a slot; its balance returns to the float.
    function retire(bytes32 key) external onlyOwner {
        Slot storage s = slots[key];
        uint256 b = s.balance;
        assigned[s.token] -= b; s.balance = 0; s.retired = true; s.epoch += 1;
        emit Retired(key, b);
    }

    // ---------------- claim ----------------
    function claim(bytes32 key, address token, address to, uint256 amount, uint64 epoch, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        if (paused) revert IsPaused();
        if (block.timestamp > deadline) revert Expired();
        if (nonceUsed[nonce]) revert NonceUsed();
        Slot storage s = slots[key];
        if (s.retired) revert SlotRetired();
        if (s.token != token || !allowedToken[token]) revert TokenMismatch();
        if (s.epoch != epoch) revert WrongEpoch();
        if (s.balance < amount) revert Insufficient();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(CLAIM_TYPEHASH, key, token, to, amount, epoch, nonce, deadline))));
        if (_recover(digest, sig) != signer) revert BadSig();
        nonceUsed[nonce] = true;
        s.balance -= uint128(amount);
        assigned[token] -= amount;
        emit Claimed(key, to, token, amount, epoch, nonce);
        _send(token, to, amount);
    }

    // ---------------- owner withdraw / rescue ----------------
    /// Withdraw unassigned float only (slot balances must be retired first).
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (amount > float(token)) revert Insufficient();
        emit Withdrawn(token, to, amount); _send(token, to, amount);
    }
    /// Recover tokens that are NOT allowlisted (sent by mistake).
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (allowedToken[token]) revert AllowedToken();
        emit Withdrawn(token, to, amount); _send(token, to, amount);
    }

    function _send(address token, address to, uint256 amount) private {
        (bool ok, bytes memory d) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (d.length != 0 && !abi.decode(d, (bool)))) revert TransferFailed();
    }

    function _recover(bytes32 h, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset, 32)) v := byte(0, calldataload(add(sig.offset, 64))) }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(h, v, r, s);
    }
}
