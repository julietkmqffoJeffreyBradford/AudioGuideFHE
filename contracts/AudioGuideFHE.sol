// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AudioGuideFHE is SepoliaConfig {
    struct VisitorBehavior {
        uint256 visitorId;
        address museumApp;
        euint32[] exhibitIds;
        euint32[] dwellTimes;
        uint256 timestamp;
    }

    struct AudioContent {
        uint256 contentId;
        euint32 exhibitId;
        euint32 contentWeight;
        uint256 timestamp;
    }

    struct Recommendation {
        uint256 recommendationId;
        uint256 visitorId;
        euint32[] recommendedContent;
        uint256 timestamp;
    }

    uint256 public visitorCount;
    uint256 public contentCount;
    uint256 public recommendationCount;
    mapping(uint256 => VisitorBehavior) public visitorBehaviors;
    mapping(uint256 => AudioContent) public audioContents;
    mapping(uint256 => Recommendation) public recommendations;
    mapping(address => uint256[]) public appVisitors;
    mapping(address => bool) public authorizedApps;

    event BehaviorRecorded(uint256 indexed visitorId, address indexed app, uint256 timestamp);
    event ContentAdded(uint256 indexed contentId, uint256 timestamp);
    event RecommendationGenerated(uint256 indexed recommendationId, uint256 indexed visitorId, uint256 timestamp);

    modifier onlyAuthorized() {
        require(authorizedApps[msg.sender], "Unauthorized app");
        _;
    }

    constructor() {
        authorizedApps[msg.sender] = true;
    }

    function authorizeApp(address app) external onlyAuthorized {
        authorizedApps[app] = true;
    }

    function recordVisitorBehavior(
        euint32[] memory encryptedExhibitIds,
        euint32[] memory encryptedDwellTimes
    ) external onlyAuthorized {
        visitorCount++;
        uint256 newId = visitorCount;

        visitorBehaviors[newId] = VisitorBehavior({
            visitorId: newId,
            museumApp: msg.sender,
            exhibitIds: encryptedExhibitIds,
            dwellTimes: encryptedDwellTimes,
            timestamp: block.timestamp
        });

        appVisitors[msg.sender].push(newId);
        emit BehaviorRecorded(newId, msg.sender, block.timestamp);
    }

    function addAudioContent(
        euint32 encryptedExhibitId,
        euint32 encryptedWeight
    ) external onlyAuthorized {
        contentCount++;
        uint256 newId = contentCount;

        audioContents[newId] = AudioContent({
            contentId: newId,
            exhibitId: encryptedExhibitId,
            contentWeight: encryptedWeight,
            timestamp: block.timestamp
        });

        emit ContentAdded(newId, block.timestamp);
    }

    function generateRecommendation(uint256 visitorId) external onlyAuthorized {
        require(visitorBehaviors[visitorId].museumApp == msg.sender, "Not visitor's app");

        recommendationCount++;
        uint256 newId = recommendationCount;

        VisitorBehavior storage behavior = visitorBehaviors[visitorId];
        bytes32[] memory ciphertexts = new bytes32[](behavior.exhibitIds.length + behavior.dwellTimes.length);
        
        uint256 index = 0;
        for (uint256 i = 0; i < behavior.exhibitIds.length; i++) {
            ciphertexts[index++] = FHE.toBytes32(behavior.exhibitIds[i]);
        }
        for (uint256 i = 0; i < behavior.dwellTimes.length; i++) {
            ciphertexts[index++] = FHE.toBytes32(behavior.dwellTimes[i]);
        }

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateRecommendation.selector);
        emit RecommendationGenerated(newId, visitorId, block.timestamp);
    }

    function calculateRecommendation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) external {
        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint256 visitorId = requestId;
        VisitorBehavior storage behavior = visitorBehaviors[visitorId];

        euint32[] memory recommendedContent = new euint32[](behavior.exhibitIds.length);
        for (uint256 i = 0; i < behavior.exhibitIds.length; i++) {
            recommendedContent[i] = FHE.add(behavior.exhibitIds[i], FHE.asEuint32(1000)); // Simplified recommendation logic
        }

        recommendations[requestId] = Recommendation({
            recommendationId: requestId,
            visitorId: visitorId,
            recommendedContent: recommendedContent,
            timestamp: block.timestamp
        });

        emit RecommendationGenerated(requestId, visitorId, block.timestamp);
    }

    function getVisitorBehavior(uint256 visitorId) external view onlyAuthorized returns (
        euint32[] memory, euint32[] memory
    ) {
        VisitorBehavior storage behavior = visitorBehaviors[visitorId];
        return (behavior.exhibitIds, behavior.dwellTimes);
    }

    function getAudioContent(uint256 contentId) external view onlyAuthorized returns (
        euint32, euint32
    ) {
        AudioContent storage content = audioContents[contentId];
        return (content.exhibitId, content.contentWeight);
    }

    function getRecommendation(uint256 recommendationId) external view onlyAuthorized returns (
        euint32[] memory
    ) {
        Recommendation storage rec = recommendations[recommendationId];
        return rec.recommendedContent;
    }

    function getAppVisitors(address app) external view onlyAuthorized returns (
        uint256[] memory
    ) {
        return appVisitors[app];
    }
}