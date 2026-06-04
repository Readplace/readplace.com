import XCTest
@testable import Readplace

final class URLDetectionTests: XCTestCase {
	func testFindsHTTPSURL() {
		XCTAssertEqual(
			URLDetection.firstWebURL(in: "check https://example.com/post out")?.absoluteString,
			"https://example.com/post"
		)
	}

	func testFindsHTTPURL() {
		XCTAssertEqual(
			URLDetection.firstWebURL(in: "http://example.com")?.absoluteString,
			"http://example.com"
		)
	}

	func testIgnoresMailto() {
		XCTAssertNil(URLDetection.firstWebURL(in: "email me at someone@example.com"))
	}

	func testIgnoresTel() {
		XCTAssertNil(URLDetection.firstWebURL(in: "call +1 (555) 123-4567 now"))
	}

	func testReturnsNilWhenNoLink() {
		XCTAssertNil(URLDetection.firstWebURL(in: "just some plain text"))
		XCTAssertNil(URLDetection.firstWebURL(in: ""))
	}

	func testSkipsNonWebSchemeAndPicksWebURL() {
		XCTAssertEqual(
			URLDetection.firstWebURL(in: "mail me@example.com or read https://example.com/a")?.absoluteString,
			"https://example.com/a"
		)
	}
}
