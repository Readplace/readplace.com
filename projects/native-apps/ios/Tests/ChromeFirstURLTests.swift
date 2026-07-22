import XCTest
@testable import Readplace

/// The Chrome-first rule for *content* links the app hands to a browser. Signing
/// in is deliberately not covered here: it runs in an in-app auth session and
/// never reaches this path.
final class ChromeFirstURLTests: XCTestCase {
	func testChromeURLForHTTPSRewritesSchemeToGoogleChrome() throws {
		let https = URL(string: "\(AppConfig.serverBaseURL)/changelog?ref=banner")!
		let chrome = try XCTUnwrap(chromeURLFor(https))

		let components = try XCTUnwrap(URLComponents(url: chrome, resolvingAgainstBaseURL: false))
		XCTAssertEqual(components.scheme, "googlechromes", "https is rewritten to Chrome's https scheme variant")
		XCTAssertEqual(components.host, AppConfig.serverHost)
		XCTAssertEqual(components.path, "/changelog")
		XCTAssertEqual(components.percentEncodedQuery, "ref=banner")
	}

	func testChromeURLForHTTPRewritesSchemeToGoogleChromeInsecureVariant() throws {
		// Chrome's scheme for plain http is `googlechrome`, not `googlechromes`.
		let http = URL(string: "http://\(AppConfig.serverHost)/post?a=1")!
		let chrome = try XCTUnwrap(chromeURLFor(http))

		let components = try XCTUnwrap(URLComponents(url: chrome, resolvingAgainstBaseURL: false))
		XCTAssertEqual(components.scheme, "googlechrome")
		XCTAssertEqual(components.host, AppConfig.serverHost)
		XCTAssertEqual(components.path, "/post")
		XCTAssertEqual(components.percentEncodedQuery, "a=1")
	}

	func testChromeURLForNonWebSchemeHasNoChromeEquivalent() {
		// A mailto:/tel: link inside an article has no Chrome equivalent — stamping
		// `googlechromes` on it would yield a URL nothing can open.
		XCTAssertNil(chromeURLFor(URL(string: "mailto:hi@example.com")!))
		XCTAssertNil(chromeURLFor(URL(string: "tel:+61400000000")!))
	}

	func testChromeURLForLeavesAThirdPartyLinkAlone() {
		// A custom scheme can never be claimed by a Universal Link. Rewriting a
		// third-party article link would therefore stop it handing off to its native
		// app, and would override a default browser the user deliberately chose — for
		// a host where there is no Readplace session to reuse anyway.
		XCTAssertNil(chromeURLFor(URL(string: "https://apps.apple.com/au/app/id123")!))
		XCTAssertNil(chromeURLFor(URL(string: "https://www.youtube.com/watch?v=abc")!))
		XCTAssertNil(chromeURLFor(URL(string: "https://www.nytimes.com/2026/01/01/story.html")!))
	}

	func testOpenURLChromeFirstHandsAThirdPartyLinkStraightToTheSystem() {
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(true)
		})

		openURLChromeFirst(URL(string: "https://www.youtube.com/watch?v=abc")!, browser: browser)

		// The raw https URL, once — so iOS can resolve it as a Universal Link and hand
		// off to the YouTube app, or fall through to the user's own default browser.
		XCTAssertEqual(opened.map(\.absoluteString), ["https://www.youtube.com/watch?v=abc"])
	}

	func testOpenURLChromeFirstOpensChromeAndNeverFallsBackWhenChromeOpens() {
		let https = URL(string: "\(AppConfig.serverBaseURL)/changelog")!
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(true)
		})

		openURLChromeFirst(https, browser: browser)

		// The requirement: when Chrome opens, we must never touch the default
		// browser (Safari), where the user isn't signed in.
		XCTAssertEqual(opened.map(\.scheme), ["googlechromes"])
	}

	func testOpenURLChromeFirstFallsBackToHTTPSOnlyWhenChromeCannotOpen() {
		let https = URL(string: "\(AppConfig.serverBaseURL)/changelog")!
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(url.scheme == "https") // Chrome (googlechromes) can't open; https can
		})

		openURLChromeFirst(https, browser: browser)

		// Only a genuine Chrome-open failure (Chrome not installed) falls through to
		// the default browser with the original https URL.
		XCTAssertEqual(opened.map(\.scheme), ["googlechromes", "https"])
	}

	func testOpenURLChromeFirstHandsANonWebSchemeStraightToTheSystem() {
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(true)
		})

		openURLChromeFirst(URL(string: "mailto:hi@example.com")!, browser: browser)

		// No Chrome attempt at all — the system gets the URL untouched, once.
		XCTAssertEqual(opened.map(\.absoluteString), ["mailto:hi@example.com"])
	}
}
