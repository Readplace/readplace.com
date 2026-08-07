import XCTest
@testable import Readplace

/// The slogan fetch runs on the sign-in screen, before there is a token and
/// often as the app's first network call. Every failure it can meet has to end
/// as an empty list so the caller's compiled-in slogan stands in — never as a
/// throw the sign-in screen would have to explain.
final class SloganSourceTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeSource() -> SloganSource {
		initSloganSource(
			sessionConfiguration: TestSupport.stubbedConfiguration(),
			baseURL: AppConfig.serverBaseURL
		)
	}

	private func stub(status: Int, contentType: String = "application/json", body: String) {
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(
				status: status,
				headers: ["Content-Type": contentType],
				body: Data(body.utf8)
			)
		}
	}

	func testItReadsThePublishedSlogansFromTheServer() async {
		stub(status: 200, body: #"{"slogans":["The #1 Personal Reading List.","Paste a link. Read it clean."]}"#)

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, ["The #1 Personal Reading List.", "Paste a link. Read it clean."])
	}

	func testItAsksTheServerForTheSloganPathWithoutABearerToken() async {
		stub(status: 200, body: #"{"slogans":["The #1 Personal Reading List."]}"#)

		_ = await makeSource().load()

		let record = StubURLProtocol.records(path: AppConfig.slogansPath).first
		XCTAssertNotNil(record, "the fetch must go to the slogan path")
		XCTAssertNil(
			record?.request.value(forHTTPHeaderField: "Authorization"),
			"sign-in has no token, so the request must not claim one"
		)
		XCTAssertEqual(record?.request.value(forHTTPHeaderField: AppConfig.clientHeader), AppConfig.clientIos)
	}

	func testItIgnoresAnErrorStatus() async {
		stub(status: 500, body: #"{"slogans":["Never rendered."]}"#)

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, [], "a 500 body is not a slogan list, whatever it happens to contain")
	}

	func testItIgnoresABodyThatIsNotJSON() async {
		stub(status: 200, contentType: "text/html", body: "<html>captive portal</html>")

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, [], "a portal or proxy page must not be blind-decoded")
	}

	func testItIgnoresAMalformedBody() async {
		stub(status: 200, body: "{not json")

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, [])
	}

	func testItIgnoresABodyMissingTheSloganField() async {
		stub(status: 200, body: #"{"other":[]}"#)

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, [])
	}

	func testItDropsEmptySlogansTheServerPublished() async {
		stub(status: 200, body: #"{"slogans":["The #1 Personal Reading List.",""]}"#)

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, ["The #1 Personal Reading List."], "an empty slogan would render as a blank line")
	}

	func testItIgnoresATransportFailure() async {
		StubURLProtocol.setHandler { _, _ in throw URLError(.notConnectedToInternet) }

		let slogans = await makeSource().load()

		XCTAssertEqual(slogans, [], "offline is the common case on a first launch")
	}

	func testItIgnoresAnUnusableBaseURL() async {
		let source = initSloganSource(
			sessionConfiguration: TestSupport.stubbedConfiguration(),
			baseURL: "not a url"
		)

		let slogans = await source.load()

		XCTAssertEqual(slogans, [])
	}
}
