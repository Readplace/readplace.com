import XCTest
@testable import Readplace

/// WKWebView reports a 4xx/5xx through `didFinish`, so the in-app web view must
/// reject an error status itself or it paints the server's error body. The policy
/// is a pure value tested at the 399/400 boundary.
final class WebResponsePolicyTests: XCTestCase {
	func testNoStatusIsAllowed() {
		XCTAssertEqual(WebResponsePolicy.decide(statusCode: nil), .allow)
	}

	func testSuccessAndRedirectAreAllowed() {
		XCTAssertEqual(WebResponsePolicy.decide(statusCode: 200), .allow)
		XCTAssertEqual(WebResponsePolicy.decide(statusCode: 304), .allow)
	}

	func testTheBoundaryIs400() {
		XCTAssertEqual(WebResponsePolicy.decide(statusCode: 399), .allow)
		XCTAssertEqual(WebResponsePolicy.decide(statusCode: 400), .fail)
	}

	func testServerErrorsFail() {
		XCTAssertEqual(WebResponsePolicy.decide(statusCode: 503), .fail)
	}
}
