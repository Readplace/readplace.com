import XCTest
@testable import Readplace

final class BackgroundUploadTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func saveContentAction(href: String? = "/queue/save-content", method: String = "POST") -> SirenAction {
		SirenAction(name: "save-content", href: href, method: method, title: nil, type: "multipart/form-data", fields: nil)
	}

	private func makeRequest(action: SirenAction) -> URLRequest? {
		BackgroundUpload.request(
			action: action,
			baseURL: AppConfig.serverBaseURL,
			contentType: "multipart/form-data; boundary=abc",
			accessToken: "access-1"
		)
	}

	// MARK: - The request

	func testFollowsTheServerDeclaredHrefAndMethod() throws {
		let request = try XCTUnwrap(makeRequest(action: saveContentAction(href: "/somewhere/else", method: "PUT")))

		XCTAssertEqual(request.url?.absoluteString, "\(AppConfig.serverBaseURL)/somewhere/else")
		XCTAssertEqual(request.httpMethod, "PUT")
	}

	func testCarriesTheBearerTheClientHeaderAndTheContinuityMarker() throws {
		let request = try XCTUnwrap(makeRequest(action: saveContentAction()))

		XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "multipart/form-data; boundary=abc")
		XCTAssertEqual(
			request.value(forHTTPHeaderField: "Accept"), AppConfig.sirenMediaType,
			"the server answers save-content with 406 unless the request accepts Siren, and this path has no send() to add it"
		)
		XCTAssertEqual(request.value(forHTTPHeaderField: "X-Readplace-Client"), "ios")
		XCTAssertEqual(request.value(forHTTPHeaderField: AppConfig.saveContinuityHeader), "background")
	}

	func testContinuityHeaderMatchesTheOneTheServerReads() {
		// The server drops its "don't close this" notice on exactly this header and
		// value; a rename on either side must fault here rather than in production.
		XCTAssertEqual(AppConfig.saveContinuityHeader, "X-Readplace-Save-Continuity")
		XCTAssertEqual(AppConfig.saveContinuityBackground, "background")
	}

	func testBuildsNoRequestForAnHrefTheClientDoesNotFollow() {
		XCTAssertNil(makeRequest(action: saveContentAction(href: "mailto:someone@example.com")))
		XCTAssertNil(makeRequest(action: saveContentAction(href: nil)))
	}

	// MARK: - The session

	func testFreshIdentifiersAreOursAndNeverRepeat() {
		let first = BackgroundUpload.freshSessionIdentifier()
		let second = BackgroundUpload.freshSessionIdentifier()

		XCTAssertNotEqual(first, second, "one process may own a background session identifier, so each run mints its own")
		XCTAssertTrue(BackgroundUpload.isUploadSession(first))
		XCTAssertTrue(first.hasPrefix("com.readplace.ShareExtension.upload."))
	}

	func testForeignSessionIdentifiersAreNotOurs() {
		XCTAssertFalse(BackgroundUpload.isUploadSession("com.apple.something.else"))
	}

	func testConfiguresTheSessionToOutliveTheExtension() {
		let identifier = BackgroundUpload.freshSessionIdentifier()

		let configuration = BackgroundUpload.sessionConfiguration(identifier: identifier, appGroupId: "group.com.readplace")

		XCTAssertEqual(configuration.identifier, identifier)
		XCTAssertEqual(
			configuration.sharedContainerIdentifier, "group.com.readplace",
			"the daemon reads the staged body out of the shared container, so it must be named"
		)
	}

	// MARK: - The scheduler

	func testRegistersNoSessionUntilThereIsSomethingToUpload() {
		var sessionsBuilt = 0

		_ = BackgroundUploadScheduler(makeSession: {
			sessionsBuilt += 1
			return URLSession(configuration: TestSupport.stubbedConfiguration())
		})

		XCTAssertEqual(sessionsBuilt, 0, "a share that never reaches an upload must leave no session with the system")
	}

	func testStartsAnUploadOfTheStagedFileNamedByItsTaskDescription() async throws {
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let form = TestSupport.multipartForm(content: Data("<html>hi</html>".utf8))
		let file = try await staging.stage(form)
		let request = try XCTUnwrap(makeRequest(action: saveContentAction()))
		let arrived = expectation(description: "the upload reaches the server")
		StubURLProtocol.setHandler { _, _ in
			arrived.fulfill()
			return .json(201, Fixtures.article(id: "enriched"))
		}

		BackgroundUploadScheduler(makeSession: { URLSession(configuration: TestSupport.stubbedConfiguration()) })
			.upload(request, fromFile: file)

		await fulfillment(of: [arrived], timeout: 5)
		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		XCTAssertEqual(record.request.httpMethod, "POST")
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(
			TestSupport.multipartParts(contentType: form.contentType, body: record.body).first { $0.name == "content" }?.text,
			"<html>hi</html>",
			"the staged file is what goes on the wire"
		)
	}

	// MARK: - The app's half

	func testDrainsTheSystemHandlerForASessionThatIsNoneOfOurs() {
		var drained = false

		SharedContainerUploads().resume(sessionIdentifier: "com.apple.something.else", whenDrained: { drained = true })

		XCTAssertTrue(drained, "the system waits on this handler for every session, ours or not")
	}

	func testHoldsTheSystemHandlerUntilOurSessionHasDrained() {
		var drained = false

		SharedContainerUploads().resume(sessionIdentifier: BackgroundUpload.freshSessionIdentifier(), whenDrained: { drained = true })

		XCTAssertFalse(drained, "our own session is re-attached to first; the handler runs once its events are delivered")
	}

}
