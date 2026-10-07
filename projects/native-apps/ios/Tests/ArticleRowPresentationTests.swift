import XCTest
import SwiftUI
@testable import Readplace

final class ArticleRowPresentationTests: XCTestCase {
	func testAnUnreadRowLeadsWithTheAmberDotOnTheSecondaryFill() {
		let presentation = ArticleRowPresentation(isRead: false, readTimeLabel: "~6 min read", savedLabel: "3d ago", isAvailableOffline: false)

		XCTAssertEqual(presentation.marker, .unreadDot)
		XCTAssertEqual(presentation.markerColor, .brandPrimaryText)
		XCTAssertEqual(presentation.statusLabel, "Unread")
		XCTAssertEqual(presentation.titleColor, .brandTextPrimary)
		XCTAssertEqual(presentation.fill, .brandSecondary)
	}

	func testAReadRowLeadsWithTheGreenCheckAndDimsTheTitleOnTheCardFill() {
		let presentation = ArticleRowPresentation(isRead: true, readTimeLabel: "~6 min read", savedLabel: "3d ago", isAvailableOffline: false)

		XCTAssertEqual(presentation.marker, .readCheck)
		XCTAssertEqual(presentation.markerColor, .brandSuccessText)
		XCTAssertEqual(presentation.statusLabel, "Read")
		XCTAssertEqual(presentation.titleColor, .brandTextSecondary)
		XCTAssertEqual(presentation.fill, .brandCard)
	}

	func testTheMetaLineJoinsReadTimeAndSavedLabelWithAMiddleDot() {
		let presentation = ArticleRowPresentation(isRead: false, readTimeLabel: "~6 min read", savedLabel: "3d ago", isAvailableOffline: false)

		XCTAssertEqual(presentation.metaText, "~6 min read · 3d ago")
	}

	func testTheMetaLineIsOnlyTheSavedLabelWhenTheReadTimeIsMissingOrEmpty() {
		let missing = ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedLabel: "3d ago", isAvailableOffline: false)
		let empty = ArticleRowPresentation(isRead: false, readTimeLabel: "", savedLabel: "3d ago", isAvailableOffline: false)

		XCTAssertEqual(missing.metaText, "3d ago")
		XCTAssertEqual(empty.metaText, "3d ago")
	}

	func testTheMetaLineIsOnlyTheReadTimeWhenTheSavedLabelIsMissing() {
		let presentation = ArticleRowPresentation(isRead: false, readTimeLabel: "~6 min read", savedLabel: nil, isAvailableOffline: false)

		XCTAssertEqual(presentation.metaText, "~6 min read")
	}

	func testTheMetaLineIsAbsentWhenNeitherReadTimeNorSavedLabelIsKnown() {
		let presentation = ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedLabel: nil, isAvailableOffline: false)

		XCTAssertEqual(presentation.metaText, nil)
	}

	func testTheThumbnailIsFourByThreeAt72PointsWithAnEightPointRadius() {
		XCTAssertEqual(ArticleRowPresentation.thumbnailSize, CGSize(width: 72, height: 54))
		XCTAssertEqual(ArticleRowPresentation.thumbnailCornerRadius, 8)
	}

	func testARowShowsTheOfflineBadgeOnlyWhenItsCurrentVersionIsStored() {
		XCTAssertTrue(
			ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedLabel: nil, isAvailableOffline: true).showsOfflineBadge
		)
		XCTAssertFalse(
			ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedLabel: nil, isAvailableOffline: false).showsOfflineBadge
		)
		XCTAssertEqual(ArticleRowPresentation.offlineBadgeLabel, "Saved offline")
	}
}
