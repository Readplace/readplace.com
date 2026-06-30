import WebKit
import XCTest
@testable import Readplace

final class ReaderNavigationTests: XCTestCase {
	private let current = URL(string: "https://readplace.com/queue/a1/app")!

	func testCloseDeepLinkClosesViaLinkActivation() {
		let url = URL(string: "readplace://reader/close")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.close
		)
	}

	func testCloseDeepLinkClosesEvenViaNonLinkNavigation() {
		let url = URL(string: "readplace://reader/close")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .other, currentURL: current),
			.close
		)
	}

	func testTappedExternalHTTPSLinkOpensExternallyWithRawTarget() {
		let url = URL(string: "https://example.com/post")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.openExternally(url)
		)
	}

	func testTappedReadplaceLinkAlsoOpensExternally() {
		let url = URL(string: "https://readplace.com/about")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.openExternally(url)
		)
	}

	func testSameDocumentFragmentTapStaysInTheWebView() {
		let url = URL(string: "https://readplace.com/queue/a1/app#footnote")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.allow
		)
	}

	func testInitialOtherLoadIsAllowed() {
		XCTAssertEqual(
			ReaderNavigation.decide(url: current, navigationType: .other, currentURL: nil),
			.allow
		)
	}

	func testBackForwardSwipeIsAllowed() {
		let url = URL(string: "https://example.com/post")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .backForward, currentURL: current),
			.allow
		)
	}
}
