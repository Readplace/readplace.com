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

	func testErrorsAndWarningsKeepTheirFillsUnderWhiteWords() {
		XCTAssertEqual(BannerTone.error.fill, .brandError)
		XCTAssertEqual(BannerTone.error.ink, .white)
		XCTAssertEqual(BannerTone.warning.fill, .brandWarning)
		XCTAssertEqual(BannerTone.warning.ink, .white)
	}

	func testTheOfflineNoticeSitsOnTheListSurfaceBecauseItsTintIsTheUnreadRowFill() {
		let unreadRow = ArticleRowPresentation(isRead: false, readTimeLabel: nil, savedLabel: nil)

		XCTAssertEqual(BannerTone.offline.fill, unreadRow.fill)
		XCTAssertEqual(BannerTone.offline.backdrop, .brandSurface)
	}

	func testErrorsAndWarningsFloatOverTheListWithNoBackdrop() {
		XCTAssertEqual(BannerTone.error.backdrop, .clear)
		XCTAssertEqual(BannerTone.warning.backdrop, .clear)
	}
}
