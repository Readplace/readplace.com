import WebKit
import XCTest
@testable import Readplace

final class ReaderNavigationTests: XCTestCase {
	private let current = URL(string: "https://readplace.com/queue/a1/view?platform=ios")!

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

	func testCloseDeepLinkMatchesCaseInsensitivelyOnSchemeAndHost() {
		let url = URL(string: "READPLACE://READER/close")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.close
		)
	}

	/// The account page reaches this link through htmx's `HX-Redirect`, which
	/// assigns `location.href` — a `.other` navigation, not a tap — so the deep-link
	/// match has to run ahead of the `.linkActivated` branch and independently of it.
	func testLogoutDeepLinkSignsOutViaAnHTMXRedirect() {
		let url = URL(string: "readplace://account/logout")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .other, currentURL: current),
			.logout
		)
	}

	func testLogoutDeepLinkSignsOutViaLinkActivation() {
		let url = URL(string: "readplace://account/logout")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.logout
		)
	}

	func testLogoutDeepLinkMatchesCaseInsensitivelyOnSchemeAndHost() {
		let url = URL(string: "READPLACE://ACCOUNT/logout")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .other, currentURL: current),
			.logout
		)
	}

	/// An unknown `readplace://` host is not a control this build understands, so it
	/// falls through to the ordinary rules rather than being silently swallowed.
	func testUnknownReadplaceDeepLinkFallsThroughToTheOrdinaryRules() {
		let url = URL(string: "readplace://account/unknown")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.openExternally(url)
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

	func testTappedNonHTTPSchemeLinkOpensExternally() {
		let url = URL(string: "mailto:hello@readplace.com")!
		XCTAssertEqual(
			ReaderNavigation.decide(url: url, navigationType: .linkActivated, currentURL: current),
			.openExternally(url)
		)
	}

	func testSameDocumentFragmentTapStaysInTheWebView() {
		let url = URL(string: "https://readplace.com/queue/a1/view?platform=ios#footnote")!
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
