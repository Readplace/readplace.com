import XCTest
@testable import Readplace

final class AppSessionTests: XCTestCase {
	private let osVersion = OperatingSystemVersion(majorVersion: 26, minorVersion: 5, patchVersion: 0)

	func testProcessNativeUserAgentNamesTheRunningBinaryAndTheBuildItWasCutFrom() throws {
		let info = try XCTUnwrap(Bundle.main.infoDictionary)
		let product = try XCTUnwrap(info["CFBundleName"] as? String)
		let build = try XCTUnwrap(info["CFBundleVersion"] as? String)

		let userAgent = AppSession.processNativeUserAgent(bundle: .main, osVersion: osVersion)

		XCTAssertEqual(userAgent, "\(product)/build-\(build) iOS/26.5")
	}

	func testProcessNativeUserAgentCarriesTheBuildNumberRatherThanTheMarketingVersion() throws {
		let info = try XCTUnwrap(Bundle.main.infoDictionary)
		let build = try XCTUnwrap(info["CFBundleVersion"] as? String)
		let marketingVersion = try XCTUnwrap(info["CFBundleShortVersionString"] as? String)
		XCTAssertNotEqual(
			build, marketingVersion,
			"the two version keys must differ for this test to be able to tell them apart"
		)

		let userAgent = AppSession.processNativeUserAgent(bundle: .main, osVersion: osVersion)

		XCTAssertTrue(
			userAgent.contains("/build-\(build) "),
			"the access log's whole point is naming the build, which only CFBundleVersion counts"
		)
		XCTAssertFalse(
			userAgent.contains(marketingVersion),
			"CFBundleShortVersionString is the same across every build of a release, so it cannot tell a shipped build from a local one"
		)
	}
}

extension AppSessionTests {
	private var storedList: URL { URL(string: "\(AppConfig.serverBaseURL)/queue?readlist=main")! }

	@MainActor
	private func sessionHoldingAStoredList(
		store: TokenStore,
		forgetOfflineCopies: @escaping () -> Void = {}
	) -> (AppSession, URLSessionConfiguration) {
		let configuration = TestSupport.stubbedConfiguration(
			storing: Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]), at: storedList
		)
		let session = AppSession(store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: configuration, wipeReaderWebStore: {},
			purgeShareArtifacts: {}, forgetReaderChoices: {}, forgetOfflineCopies: forgetOfflineCopies)
		XCTAssertEqual(
			configuration.urlCache?.cachedResponse(for: URLRequest(url: storedList))?.data,
			Data(Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]).utf8),
			"precondition: the session holds a stored list"
		)
		return (session, configuration)
	}

	@MainActor
	func testSigningOutDropsTheStoredList() async {
		StubURLProtocol.reset()
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		let (session, configuration) = sessionHoldingAStoredList(store: TestSupport.loggedInStore())

		await session.logout()

		XCTAssertNil(
			configuration.urlCache?.cachedResponse(for: URLRequest(url: storedList)),
			"the signed-out account's reading list must not stay on the device"
		)
	}

	@MainActor
	func testAnExpiredSessionDropsTheStoredList() async {
		let (session, configuration) = sessionHoldingAStoredList(store: TestSupport.loggedInStore())

		let readerWipe = session.forceLogout()

		XCTAssertNil(
			configuration.urlCache?.cachedResponse(for: URLRequest(url: storedList)),
			"a session invalidated behind the reader's back leaves no list behind either"
		)
		await readerWipe.value
	}

	@MainActor
	func testReconcilingASignedOutSessionDropsTheStoredList() {
		let (session, configuration) = sessionHoldingAStoredList(store: TokenStore(defaults: TestSupport.ephemeralDefaults()))

		session.reconcileSession()

		XCTAssertNil(
			configuration.urlCache?.cachedResponse(for: URLRequest(url: storedList)),
			"a sign-out noticed on reconcile clears the stored list like any other"
		)
	}

	@MainActor
	func testEverySignOutPathForgetsTheOfflineCopies() async {
		StubURLProtocol.reset()
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		var forgotten = 0
		let (signingOut, _) = sessionHoldingAStoredList(store: TestSupport.loggedInStore()) { forgotten += 1 }
		await signingOut.logout()
		XCTAssertEqual(forgotten, 1, "the downloaded list and its manifest belong to the account that signed out")

		let (expiring, _) = sessionHoldingAStoredList(store: TestSupport.loggedInStore()) { forgotten += 1 }
		let readerWipe = expiring.forceLogout()
		XCTAssertEqual(forgotten, 2, "an expired session leaves no offline copies behind either")
		await readerWipe.value

		let (reconciled, _) = sessionHoldingAStoredList(store: TokenStore(defaults: TestSupport.ephemeralDefaults())) {
			forgotten += 1
		}
		reconciled.reconcileSession()
		XCTAssertEqual(forgotten, 3, "nor does a sign-out noticed on reconcile")
	}

	@MainActor
	func testTheRealSignOutRemovesTheOfflineCopiesFromTheAppGroup() async throws {
		StubURLProtocol.reset()
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		let container = try XCTUnwrap(AppGroupContainer.entitled(appGroupId: TokenStore.resolvedAppGroupId))
		OfflineDownloadManifest(container: container).record(run: OfflineDownloadRun(total: 2, completed: 1))
		let session = AppSession(store: TestSupport.loggedInStore(), nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), wipeReaderWebStore: {},
			purgeShareArtifacts: {}, forgetReaderChoices: {})

		await session.logout()

		XCTAssertNil(OfflineDownloadManifest(container: container).run)
		XCTAssertFalse(FileManager.default.fileExists(atPath: OfflineReadingFiles.directory(in: container).path))
	}

	@MainActor
	func testForegroundReadingAndUploadDrainingShareOneRefresh() async throws {
		StubURLProtocol.reset()
		let store = TestSupport.loggedInStore(access: "old", refresh: "old-r")
		let session = AppSession(store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), wipeReaderWebStore: {},
			purgeShareArtifacts: {}, forgetReaderChoices: {})
		let refreshStarted = expectation(description: "refresh started")
		let originalRequests = expectation(description: "both requests sent the expired bearer")
		originalRequests.expectedFulfillmentCount = 2
		let gate = DispatchSemaphore(value: 0)
		defer { gate.signal() }
		StubURLProtocol.setHandler { request, _ in
			if request.url?.path == "/oauth/token" {
				refreshStarted.fulfill()
				return .json(200, Fixtures.tokenResponse(access: "fresh", refresh: "fresh-r")).held(until: gate)
			}
			if request.value(forHTTPHeaderField: "Authorization") == "Bearer old" {
				originalRequests.fulfill()
				return .json(401, "{}")
			}
			if request.url?.path == "/queue/save-content" { return .json(201, "{}") }
			return .json(200, Fixtures.collection(entitiesJSON: []))
		}
		let now = Date()
		let jobs = UploadJobStore(containerURL: TestSupport.temporaryContainer())
		let job = UploadJob(id: "pending", url: "https://example.com/article", title: nil,
			state: .capturePending(detectedMediaType: nil), attempts: 0, nextAttemptAt: now, createdAt: now)
		try await jobs.admit(job)
		let form = TestSupport.multipartForm()
		_ = try await jobs.stageReady(job, form: form)
		let firstAPI = session.makeAPI()
		let drain = DrainUploadJobs(api: session.makeAPI(),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: nil, title: nil, mediaType: nil)),
			jobs: jobs, now: { now })
		let first = Task { try await firstAPI.loadReadlist() }
		await fulfillment(of: [refreshStarted], timeout: 2)
		let second = Task { await drain.run() }
		await fulfillment(of: [originalRequests], timeout: 2)
		gate.signal()
		_ = try await first.value
		await second.value
		XCTAssertEqual(StubURLProtocol.records(path: "/oauth/token").count, 1)
		XCTAssertEqual(store.tokens?.accessToken, "fresh")
		let upload = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		XCTAssertEqual(upload.request.value(forHTTPHeaderField: "Authorization"), "Bearer fresh")
		XCTAssertEqual(upload.body, form.body)
		XCTAssertEqual(jobs.loadAll(now: now), [])
		session.reconcileSession()
		XCTAssertEqual(session.isLoggedIn, true)
	}

	@MainActor
	func testOldSessionFailureCannotLogOutANewerLogin() async throws {
		StubURLProtocol.reset()
		let store = TestSupport.loggedInStore(access: "old", refresh: "old-r")
		var purges = 0
		let session = AppSession(store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), wipeReaderWebStore: {},
			purgeShareArtifacts: { purges += 1 }, forgetReaderChoices: {})
		let refreshStarted = expectation(description: "old refresh started")
		let gate = DispatchSemaphore(value: 0)
		defer { gate.signal() }
		StubURLProtocol.setHandler { request, body in
			guard request.url?.path == "/oauth/token" else { return .json(401, "{}") }
			if TestSupport.formFields(body)["grant_type"] == "authorization_code" {
				return .json(200, Fixtures.tokenResponse(access: "new-login", refresh: "new-refresh"))
			}
			refreshStarted.fulfill()
			return .json(400, "{\"error\":\"invalid_grant\"}").held(until: gate)
		}
		let failed = Task { try await session.makeAPI().loadReadlist() }
		await fulfillment(of: [refreshStarted], timeout: 2)
		try await session.completeSignIn(
			callbackURL: URL(string: "readplace://oauth-callback?code=new&state=state")!,
			verifier: "verifier", expectedState: "state", redirectURI: AppConfig.nativeCallbackURL
		).get()
		gate.signal()
		do { _ = try await failed.value; XCTFail("the old request belongs to the replaced session") }
		catch {
			XCTAssertEqual((error as? OAuthError)?.errorDescription, OAuthError.sessionChanged.errorDescription)
		}
		session.reconcileSession()
		XCTAssertEqual(session.isLoggedIn, true)
		XCTAssertEqual(store.tokens?.accessToken, "new-login")
		XCTAssertEqual(purges, 0)
	}
}
