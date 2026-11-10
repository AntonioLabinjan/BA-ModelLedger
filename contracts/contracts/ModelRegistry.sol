// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ModelRegistry
/// @notice Append-only registry of ML model versions with hash references to off-chain artifacts.
contract ModelRegistry {
    struct Model {
        bytes32 id;
        string name;
        address owner;
        uint64 createdAt;
        uint32 versionCount;
    }

    struct Version {
        uint32 number;        // 1-based, sequential
        uint32 parent;        // predecessor version number (0 for the first version)
        string label;         // human version identifier, e.g. "1.0.0"
        bytes32 artifactHash; // SHA-256 of the model artifact
        bytes32 metadataHash; // SHA-256 of the canonical manifest JSON
        string cid;           // IPFS CID of the manifest
        address publisher;
        uint64 timestamp;
    }

    mapping(bytes32 => Model) private _models;
    mapping(bytes32 => Version[]) private _versions;
    mapping(bytes32 => mapping(bytes32 => bool)) private _labelUsed;
    bytes32[] private _modelIds;

    event ModelRegistered(bytes32 indexed modelId, address indexed owner, string name, uint32 versionNumber);
    event VersionRegistered(
        bytes32 indexed modelId,
        uint32 indexed versionNumber,
        uint32 parentVersion,
        string label,
        bytes32 artifactHash,
        bytes32 metadataHash,
        string cid
    );

    error EmptyField();
    error ModelAlreadyExists(bytes32 modelId);
    error UnknownModel(bytes32 modelId);
    error NotOwner(address caller, address owner);
    error WrongParent(uint32 expected, uint32 given);
    error DuplicateLabel(string label);
    error UnknownVersion(bytes32 modelId, uint32 versionNumber);

    modifier modelExists(bytes32 modelId) {
        if (_models[modelId].owner == address(0)) revert UnknownModel(modelId);
        _;
    }

    /// @notice Deterministic ID: keccak256(owner, name). Unique per owner+name.
    function computeModelId(address owner, string calldata name) public pure returns (bytes32) {
        return keccak256(abi.encode(owner, name));
    }

    function registerModel(
        string calldata name,
        string calldata label,
        bytes32 artifactHash,
        bytes32 metadataHash,
        string calldata cid
    ) external returns (bytes32 modelId) {
        if (bytes(name).length == 0) revert EmptyField();
        modelId = computeModelId(msg.sender, name);
        if (_models[modelId].owner != address(0)) revert ModelAlreadyExists(modelId);

        _models[modelId] = Model(modelId, name, msg.sender, uint64(block.timestamp), 0);
        _modelIds.push(modelId);
        emit ModelRegistered(modelId, msg.sender, name, 1);
        _addVersion(modelId, 0, label, artifactHash, metadataHash, cid);
    }

    /// @param parentVersion must equal the current latest version number (explicit predecessor reference).
    function registerVersion(
        bytes32 modelId,
        uint32 parentVersion,
        string calldata label,
        bytes32 artifactHash,
        bytes32 metadataHash,
        string calldata cid
    ) external modelExists(modelId) {
        Model storage m = _models[modelId];
        if (m.owner != msg.sender) revert NotOwner(msg.sender, m.owner);
        if (parentVersion != m.versionCount) revert WrongParent(m.versionCount, parentVersion);
        _addVersion(modelId, parentVersion, label, artifactHash, metadataHash, cid);
    }

    function _addVersion(
        bytes32 modelId,
        uint32 parent,
        string calldata label,
        bytes32 artifactHash,
        bytes32 metadataHash,
        string calldata cid
    ) private {
        if (bytes(label).length == 0 || bytes(cid).length == 0 || artifactHash == 0 || metadataHash == 0) revert EmptyField();
        bytes32 labelKey = keccak256(bytes(label));
        if (_labelUsed[modelId][labelKey]) revert DuplicateLabel(label);
        _labelUsed[modelId][labelKey] = true;

        Model storage m = _models[modelId];
        m.versionCount += 1;
        _versions[modelId].push(
            Version(m.versionCount, parent, label, artifactHash, metadataHash, cid, msg.sender, uint64(block.timestamp))
        );
        emit VersionRegistered(modelId, m.versionCount, parent, label, artifactHash, metadataHash, cid);
    }

    function getModel(bytes32 modelId) external view modelExists(modelId) returns (Model memory) {
        return _models[modelId];
    }

    function getVersion(bytes32 modelId, uint32 versionNumber) public view modelExists(modelId) returns (Version memory) {
        if (versionNumber == 0 || versionNumber > _versions[modelId].length) revert UnknownVersion(modelId, versionNumber);
        return _versions[modelId][versionNumber - 1];
    }

    function getVersionHistory(bytes32 modelId) external view modelExists(modelId) returns (Version[] memory) {
        return _versions[modelId];
    }

    /// @notice Hash references for integrity verification. versionNumber 0 = latest.
    function verifyModel(bytes32 modelId, uint32 versionNumber)
        external
        view
        modelExists(modelId)
        returns (bytes32 artifactHash, bytes32 metadataHash, string memory cid, address owner, uint32 resolvedVersion)
    {
        Model storage m = _models[modelId];
        resolvedVersion = versionNumber == 0 ? m.versionCount : versionNumber;
        Version memory v = getVersion(modelId, resolvedVersion);
        return (v.artifactHash, v.metadataHash, v.cid, m.owner, resolvedVersion);
    }

    function modelCount() external view returns (uint256) {
        return _modelIds.length;
    }

    /// @notice Paginated model IDs in registration order.
    function listModelIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory ids) {
        uint256 total = _modelIds.length;
        if (offset >= total) return new bytes32[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        ids = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) ids[i - offset] = _modelIds[i];
    }
}
