import XCTest
@testable import Readplace

final class RedirectHeadersTests: XCTestCase {
	private func request(_ headers: [String: String]) -> URLRequest {
		var request = URLRequest(url: URL(string: "https://example.com/queue")!)
		for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
		return request
	}

	func testCarriesTheHeadersTheClientSetsItselfOntoTheFollowedRequest() {
		let original = request([
			"Authorization": "Bearer access-1",
			"Accept": AppConfig.sirenMediaType,
			"X-Readplace-Client": "ios",
			AppConfig.saveContinuityHeader: AppConfig.saveContinuityBackground,
		])

		let followed = RedirectHeaders.preserving(from: original, onto: request([:]))

		XCTAssertEqual(followed.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(followed.value(forHTTPHeaderField: "Accept"), AppConfig.sirenMediaType)
		XCTAssertEqual(followed.value(forHTTPHeaderField: "X-Readplace-Client"), "ios")
		XCTAssertEqual(followed.value(forHTTPHeaderField: AppConfig.saveContinuityHeader), AppConfig.saveContinuityBackground)
	}

	func testLeavesAHeaderTheOriginalNeverSetUnset() {
		let followed = RedirectHeaders.preserving(
			from: request(["Authorization": "Bearer access-1"]),
			onto: request([:])
		)

		XCTAssertNil(followed.value(forHTTPHeaderField: "X-Readplace-Client"))
	}

	func testKeepsHeadersTheRedirectAlreadyCarriesThatAreNoneOfOurs() {
		let followed = RedirectHeaders.preserving(
			from: request(["Authorization": "Bearer access-1"]),
			onto: request(["Content-Type": "multipart/form-data; boundary=abc"])
		)

		XCTAssertEqual(followed.value(forHTTPHeaderField: "Content-Type"), "multipart/form-data; boundary=abc")
	}

	func testCarriesNothingWhenThereIsNoOriginalRequest() {
		let followed = RedirectHeaders.preserving(from: nil, onto: request(["Accept": "text/html"]))

		XCTAssertEqual(followed.value(forHTTPHeaderField: "Accept"), "text/html", "the followed request is handed back untouched")
	}
}
