import XCTest
@testable import Readplace

final class BannerToneTests: XCTestCase {
	func testTheOfflineSentenceIsShownAsTheOfflineNotice() {
		XCTAssertEqual(BannerTone(errorText: OfflineReading.bannerText), .offline)
	}

	func testEveryOtherErrorKeepsTheErrorLook() {
		XCTAssertEqual(BannerTone(errorText: "1 of 2 articles couldn't be downloaded for offline reading"), .error)
	}

	func testTheOfflineNoticeIsTheWarningTintUnderTheForegroundInk() {
		XCTAssertEqual(BannerTone.offline.fill, .brandSecondary)
		XCTAssertEqual(BannerTone.offline.ink, .brandTextPrimary)
	}

	func testAWarningIsTheWarningTintUnderTheForegroundInk() {
		XCTAssertEqual(BannerTone.warning.fill, .brandSecondary)
		XCTAssertEqual(BannerTone.warning.ink, .brandTextPrimary)
	}

	func testAnErrorIsAFixedRedFillUnderWhiteWords() {
		XCTAssertEqual(BannerTone.error.fill, .brandErrorFill)
		XCTAssertEqual(BannerTone.error.ink, .white)
	}

	func testTheOfflineNoticeSitsOnTheListSurfaceBecauseItsTintIsTheUnreadRowFill() {
		let unreadRow = ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedAt: nil, now: Date(timeIntervalSince1970: 0), locale: Locale(identifier: "en_US"), isAvailableOffline: false)

		XCTAssertEqual(BannerTone.offline.fill, unreadRow.fill)
		XCTAssertEqual(BannerTone.offline.backdrop, .brandSurface)
	}

	func testAWarningSitsOnTheListSurfaceBecauseItsTintIsTheUnreadRowFill() {
		let unreadRow = ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedAt: nil, now: Date(timeIntervalSince1970: 0), locale: Locale(identifier: "en_US"), isAvailableOffline: false)

		XCTAssertEqual(BannerTone.warning.fill, unreadRow.fill)
		XCTAssertEqual(BannerTone.warning.backdrop, .brandSurface)
	}

	func testAnErrorFloatsOverTheListWithNoBackdrop() {
		XCTAssertEqual(BannerTone.error.backdrop, .clear)
	}
}
