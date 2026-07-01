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
}
