import XCTest
@testable import Readplace

final class HrefTests: XCTestCase {
	func testAppendingAddsQueryItemToAQueryLessURL() throws {
		let url = try XCTUnwrap(URL(string: "https://readplace.com/queue/a1/view"))

		let result = Href.appending(URLQueryItem(name: "platform", value: "ios"), to: url)

		XCTAssertEqual(result?.absoluteString, "https://readplace.com/queue/a1/view?platform=ios")
	}

	func testAppendingPreservesAnExistingQuery() throws {
		let url = try XCTUnwrap(URL(string: "https://readplace.com/queue/a1/view?poll=2"))

		let result = Href.appending(URLQueryItem(name: "platform", value: "ios"), to: url)

		XCTAssertEqual(
			result?.absoluteString,
			"https://readplace.com/queue/a1/view?poll=2&platform=ios",
			"appending the client parameter keeps whatever query the server link already carried"
		)
	}

	func testAnAdvertisedHrefMatchesTheAbsoluteURLARedirectLandedOn() {
		XCTAssertTrue(
			Href.matches(
				"/queue?readlist=work",
				anyOf: ["https://readplace.com/queue?queue=work", "https://readplace.com/queue?readlist=work"],
				baseURL: "https://readplace.com"
			),
			"a relative advertised href and the absolute URL a redirect reached name the same readlist once both are resolved"
		)
	}

	func testAnAdvertisedHrefMatchesNothingOutsideTheChain() {
		XCTAssertFalse(
			Href.matches("/queue?readlist=work", anyOf: ["/queue?queue=work", "/queue"], baseURL: "https://readplace.com")
		)
		XCTAssertFalse(Href.matches("/queue", anyOf: [], baseURL: "https://readplace.com"))
	}

	func testAnAdvertisedHrefTheClientCannotResolveMatchesNothing() {
		XCTAssertFalse(
			Href.matches("ftp://readplace.com/queue", anyOf: ["ftp://readplace.com/queue"], baseURL: "https://readplace.com"),
			"an href in a scheme the client does not act on is absent, so not even an identical string matches it"
		)
	}
}
