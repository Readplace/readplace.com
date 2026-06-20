import XCTest
@testable import Readplace

@MainActor
final class ReadingListViewModelTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeViewModel(store: TokenStore) -> ReadingListViewModel {
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL,
			store: store,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
		return ReadingListViewModel(api: api, onSessionExpired: {})
	}

	/// A locked account: the queue loads (so the `save-article` action is
	/// discovered) but every save POST is refused with a server-authored message.
	private func lockedAccountHandler() -> (URLRequest, Data) -> StubURLProtocol.Stub {
		return { request, _ in
			let path = request.url?.path ?? ""
			let method = request.httpMethod ?? "GET"
			switch (path, method) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", "POST"):
				return .json(403, Fixtures.accountLockedError())
			case ("/queue", _):
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
	}

	func testRefusedSaveSurfacesServerMessages() async {
		StubURLProtocol.setHandler(lockedAccountHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.saveURL("https://example.com/x")

		XCTAssertEqual(viewModel.messages.first?.type, "warning")
		XCTAssertEqual(viewModel.messages.first?.content.type, "text/html")
		XCTAssertTrue(
			viewModel.messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false,
			"the refusal message names the address to email"
		)
	}

	func testSuccessfulRefreshClearsStaleRefusalBanner() async {
		StubURLProtocol.setHandler(lockedAccountHandler())
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.saveURL("https://example.com/x")
		XCTAssertFalse(viewModel.messages.isEmpty, "precondition: a refused save shows the banner")

		await viewModel.refresh()

		XCTAssertTrue(
			viewModel.messages.isEmpty,
			"a locked account's reads still succeed, so a fresh load reconciles the stale banner"
		)
	}

	func testSaveResetsMessagesSoASucceedingSaveClearsTheBanner() async {
		var savePOSTs = 0
		StubURLProtocol.setHandler { request, _ in
			let path = request.url?.path ?? ""
			let method = request.httpMethod ?? "GET"
			switch (path, method) {
			case ("/", _):
				return .redirect(to: "/queue")
			case ("/queue", "POST"):
				savePOSTs += 1
				return savePOSTs == 1
					? .json(403, Fixtures.accountLockedError())
					: .json(201, Fixtures.article(id: "saved"))
			case ("/queue", _):
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
			default:
				return .json(404, "{}")
			}
		}
		let viewModel = makeViewModel(store: TestSupport.loggedInStore())

		await viewModel.refresh()
		await viewModel.saveURL("https://example.com/x")
		XCTAssertFalse(viewModel.messages.isEmpty, "precondition: the first save is refused")

		await viewModel.saveURL("https://example.com/y")

		XCTAssertTrue(viewModel.messages.isEmpty, "saveURL resets messages before the next attempt")
	}
}
