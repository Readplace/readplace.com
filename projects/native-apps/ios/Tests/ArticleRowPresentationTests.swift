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

	private let received = Date(timeIntervalSince1970: 1_000)

	private func processing(_ estimate: CrawlEstimate?, label: String = "Processing") -> ArticleProcessing {
		ArticleProcessing(label: label, estimate: estimate, refreshHref: "/card?poll=1", refreshAfterSeconds: 3)
	}

	private func presentation(_ estimate: CrawlEstimate?, receivedAt: Date? = nil) -> ArticleRowPresentation {
		ArticleRowPresentation(
			isRead: false, readTimeLabel: "~6 min read", savedLabel: "3d ago", isAvailableOffline: false,
			processing: processing(estimate), processingReceivedAt: receivedAt ?? received
		)
	}

	private func later(_ seconds: TimeInterval) -> Date {
		received.addingTimeInterval(seconds)
	}

	func testARowInProcessingHidesItsMetaAndShowsTheServerLabelVerbatim() {
		let row = ArticleRowPresentation(
			isRead: false, readTimeLabel: "~6 min read", savedLabel: "3d ago", isAvailableOffline: false,
			processing: processing(nil, label: "Preparing your book…")
		)

		XCTAssertNil(row.metaText)
		XCTAssertEqual(row.processingLabel, "Preparing your book…")
	}

	func testARowNotInProcessingHasNoLabelAndNoEstimate() {
		let row = ArticleRowPresentation(isRead: false, readTimeLabel: "~6 min read", savedLabel: nil, isAvailableOffline: false)

		XCTAssertEqual(row.metaText, "~6 min read")
		XCTAssertNil(row.processingLabel)
		XCTAssertNil(row.estimateText(now: received))
	}

	func testAQuietEstimateStaysSilentUntilItsRevealThenCountsFromReceipt() {
		let row = presentation(.quiet(revealInSeconds: 5, seconds: 150))

		XCTAssertNil(row.estimateText(now: later(4.9)))
		XCTAssertEqual(row.estimateText(now: later(5)), "~145 s left")
	}

	func testACountingEstimateSubtractsWholeElapsedSeconds() {
		let row = presentation(.counting(seconds: 121))

		XCTAssertEqual(row.estimateText(now: received), "~121 s left")
		XCTAssertEqual(row.estimateText(now: later(1.9)), "~120 s left")
	}

	func testAClockBehindTheReceiptCountsAsNoElapsedTime() {
		XCTAssertEqual(presentation(.counting(seconds: 10)).estimateText(now: later(-30)), "~10 s left")
	}

	func testACountThatReachesZeroReadsAlmostThere() {
		let row = presentation(.counting(seconds: 3))

		XCTAssertEqual(row.estimateText(now: later(2)), "~1 s left")
		XCTAssertEqual(row.estimateText(now: later(3)), "Almost there…")
		XCTAssertEqual(row.estimateText(now: later(40)), "Almost there…")
	}

	func testTheAlmostThereKindReadsAlmostThereFromTheStart() {
		XCTAssertEqual(presentation(.almostThere).estimateText(now: received), "Almost there…")
	}

	func testNoEstimateOrNoReceiptShowsNothing() {
		let noEstimate = presentation(nil)
		let noReceipt = ArticleRowPresentation(
			isRead: false, readTimeLabel: nil, savedLabel: nil, isAvailableOffline: false,
			processing: processing(.counting(seconds: 10))
		)

		XCTAssertNil(noEstimate.estimateText(now: received))
		XCTAssertNil(noReceipt.estimateText(now: received))
	}

	func testTheNoticeIsCarriedVerbatim() {
		let row = ArticleRowPresentation(
			isRead: false, readTimeLabel: nil, savedLabel: nil, isAvailableOffline: false, notice: "This is taking a while."
		)

		XCTAssertEqual(row.noticeText, "This is taking a while.")
	}
}
