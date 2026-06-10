import XCTest
@testable import Readplace

final class ReadplaceAPITests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeAPI(store: TokenStore) -> ReadplaceAPI {
		ReadplaceAPI(baseURL: store.baseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	private func saveHtmlAction() -> SirenAction {
		SirenAction(name: "save-html", title: nil, href: "/queue/save-html", method: "POST", type: "application/json", fields: nil)
	}

	private func saveArticleAction() -> SirenAction {
		SirenAction(name: "save-article", title: nil, href: "/queue", method: "POST", type: "application/json", fields: nil)
	}

	// MARK: - Listing

	func testLoadQueueFollowsEntryPointRedirectAndPreservesAuthHeader() async throws {
		let store = TestSupport.loggedInStore(access: "access-1")
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], total: 2))
			default:
				return .json(404, "{}")
			}
		}

		let page = try await makeAPI(store: store).loadQueue()

		XCTAssertEqual(page.articles.map(\.id), ["a1", "a2"])
		let queueRequest = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first?.request)
		XCTAssertEqual(queueRequest.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(queueRequest.value(forHTTPHeaderField: "Accept"), "application/vnd.siren+json")
	}

	func testLoadQueueRefreshesOnceAndRetriesOn401() async throws {
		let store = TestSupport.loggedInStore(access: "stale", refresh: "r1")
		var entryAttempts = 0
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				entryAttempts += 1
				if entryAttempts == 1 {
					return .json(401, Fixtures.sirenError(code: "invalid-token", message: "expired", withSaveArticleFallback: false))
				}
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "fresh")]))
			case "/oauth/token":
				return .json(200, Fixtures.tokenResponse(access: "fresh-access", refresh: "r2"))
			default:
				return .json(404, "{}")
			}
		}

		let page = try await makeAPI(store: store).loadQueue()

		XCTAssertEqual(page.articles.map(\.id), ["fresh"])
		XCTAssertEqual(entryAttempts, 2, "should retry exactly once after a refresh")
		XCTAssertEqual(StubURLProtocol.records(path: "/oauth/token").count, 1, "refresh should happen exactly once")
		XCTAssertEqual(store.tokens?.accessToken, "fresh-access")
		// The retry must carry the refreshed token.
		let retried = StubURLProtocol.records(path: "/").last?.request
		XCTAssertEqual(retried?.value(forHTTPHeaderField: "Authorization"), "Bearer fresh-access")
	}

	func testLoadQueueThrowsUnauthorizedWhenRefreshFailsAndDoesNotLoop() async {
		let store = TestSupport.loggedInStore(access: "stale")
		var entryAttempts = 0
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				entryAttempts += 1
				return .json(401, "{}")
			case "/oauth/token":
				return .json(400, "{}")
			default:
				return .json(404, "{}")
			}
		}

		do {
			_ = try await makeAPI(store: store).loadQueue()
			XCTFail("Expected unauthorized")
		} catch let error as APIError {
			guard case .unauthorized = error else {
				return XCTFail("Expected .unauthorized, got \(error)")
			}
		} catch {
			XCTFail("Expected APIError.unauthorized, got \(error)")
		}
		XCTAssertEqual(entryAttempts, 1, "must not retry the entry point when refresh fails")
		XCTAssertEqual(StubURLProtocol.records(path: "/oauth/token").count, 1)
	}

	func testNoTokenThrowsNoTokenError() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		store.baseURL = "https://readplace.com"
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		do {
			_ = try await makeAPI(store: store).loadQueue()
			XCTFail("Expected noToken")
		} catch let error as APIError {
			guard case .noToken = error else { return XCTFail("Expected .noToken, got \(error)") }
		} catch {
			XCTFail("Expected APIError.noToken, got \(error)")
		}
	}

	// MARK: - Saving HTML

	func testSaveHTMLSuccessSendsFullBody() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/queue/save-html")
			XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
			return .json(201, Fixtures.article(id: "saved", url: "https://example.com/x"))
		}

		let article = try await makeAPI(store: store).saveHTML(
			action: saveHtmlAction(),
			url: "https://example.com/x",
			rawHtml: "<html><body>hi</body></html>",
			title: "Captured"
		)

		XCTAssertEqual(article.id, "saved")
		let body = TestSupport.jsonObject(StubURLProtocol.records(path: "/queue/save-html").first!.body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/x")
		XCTAssertEqual(body["rawHtml"] as? String, "<html><body>hi</body></html>")
		XCTAssertEqual(body["title"] as? String, "Captured")
	}

	func testSaveHTMLOmitsTitleWhenNil() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(201, Fixtures.article(id: "saved")) }

		_ = try await makeAPI(store: store).saveHTML(
			action: saveHtmlAction(), url: "https://example.com/x", rawHtml: "<html></html>", title: nil
		)

		let body = TestSupport.jsonObject(StubURLProtocol.records(path: "/queue/save-html").first!.body)
		XCTAssertNil(body["title"])
	}

	func testSaveHTMLFallsBackToURLOnlyWhenServerOffersFallbackAction() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/save-html":
				return .json(500, Fixtures.sirenError(code: "html-too-large", message: "Too big", withSaveArticleFallback: true))
			case "/queue":
				return .json(201, Fixtures.article(id: "fallback-saved"))
			default:
				return .json(404, "{}")
			}
		}

		let article = try await makeAPI(store: store).saveHTML(
			action: saveHtmlAction(), url: "https://example.com/x", rawHtml: "<huge/>", title: "T"
		)

		XCTAssertEqual(article.id, "fallback-saved")
		let fallbackBody = TestSupport.jsonObject(StubURLProtocol.records(path: "/queue").first!.body)
		XCTAssertEqual(fallbackBody["url"] as? String, "https://example.com/x")
		XCTAssertEqual(fallbackBody["title"] as? String, "T")
		XCTAssertNil(fallbackBody["rawHtml"], "fallback must drop the rawHtml payload")
	}

	func testSaveHTMLThrowsWhenErrorHasNoFallbackAction() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			.json(422, Fixtures.sirenError(code: "invalid-save-html", message: "Invalid", withSaveArticleFallback: false))
		}
		do {
			_ = try await makeAPI(store: store).saveHTML(
				action: saveHtmlAction(), url: "https://example.com/x", rawHtml: "<html></html>", title: nil
			)
			XCTFail("Expected a server error")
		} catch let error as APIError {
			guard case .server(let status, let code, _) = error else {
				return XCTFail("Expected .server, got \(error)")
			}
			XCTAssertEqual(status, 422)
			XCTAssertEqual(code, "invalid-save-html")
		} catch {
			XCTFail("Expected APIError.server, got \(error)")
		}
	}

	// MARK: - Saving URL only

	func testSaveArticleSuccess() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.value(forHTTPHeaderField: "Prefer"), "return=representation")
			return .json(201, Fixtures.article(id: "url-saved"))
		}

		let article = try await makeAPI(store: store).saveArticle(action: saveArticleAction(), url: "https://example.com/x")

		XCTAssertEqual(article.id, "url-saved")
		let body = TestSupport.jsonObject(StubURLProtocol.records(path: "/queue").first!.body)
		XCTAssertEqual(body["url"] as? String, "https://example.com/x")
	}

	// MARK: - Account lockout

	func testSaveArticleSurfacesAccountLocked() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(403, Fixtures.accountLockedError()) }
		do {
			_ = try await makeAPI(store: store).saveArticle(action: saveArticleAction(), url: "https://example.com/x")
			XCTFail("Expected an account-locked refusal")
		} catch let APIError.accountLocked(message, action) {
			XCTAssertTrue(message.contains("readplace+verification@readplace.com"))
			XCTAssertEqual(action.href, "mailto:readplace+verification@readplace.com")
			XCTAssertEqual(action.title, "Email support to unlock")
		} catch {
			XCTFail("Expected APIError.accountLocked, got \(error)")
		}
	}

	func testSaveHTMLSurfacesAccountLockedWithoutFollowingUnlockAction() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/save-html":
				return .json(403, Fixtures.accountLockedError())
			default:
				// Following the unlock action as a save fallback would be a bug.
				return .json(201, Fixtures.article(id: "should-not-happen"))
			}
		}
		do {
			_ = try await makeAPI(store: store).saveHTML(
				action: saveHtmlAction(), url: "https://example.com/x", rawHtml: "<html></html>", title: nil
			)
			XCTFail("Expected an account-locked refusal")
		} catch let APIError.accountLocked(_, action) {
			XCTAssertEqual(action.href, "mailto:readplace+verification@readplace.com")
		} catch {
			XCTFail("Expected APIError.accountLocked, got \(error)")
		}
		// The unlock action must never be followed as a URL-only fallback save.
		XCTAssertEqual(StubURLProtocol.records(path: "/queue").count, 0, "must not follow the unlock action as a fallback")
	}

	// MARK: - Deleting

	func testDeleteReturnsRefreshedCollectionAndSendsPreferHeader() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/a1/delete":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "remaining")]))
			default:
				return .json(404, "{}")
			}
		}

		let page = try await makeAPI(store: store).delete(href: "/queue/a1/delete")

		XCTAssertEqual(page.articles.map(\.id), ["remaining"])
		let deleteRequest = try XCTUnwrap(StubURLProtocol.records(path: "/queue/a1/delete").first?.request)
		XCTAssertEqual(deleteRequest.httpMethod, "POST")
		XCTAssertEqual(deleteRequest.value(forHTTPHeaderField: "Prefer"), "return=representation")
	}

	func testDelete404ThrowsNotFound() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(404, "{}") }
		do {
			_ = try await makeAPI(store: store).delete(href: "/queue/gone/delete")
			XCTFail("Expected notFound")
		} catch let error as APIError {
			guard case .notFound = error else { return XCTFail("Expected .notFound, got \(error)") }
		} catch {
			XCTFail("Expected APIError.notFound, got \(error)")
		}
	}
}
