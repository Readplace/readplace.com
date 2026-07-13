import XCTest
@testable import Readplace

final class ReadplaceAPITests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeAPI(store: TokenStore) -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	private func saveContentAction() -> SirenAction {
		SirenAction(name: "save-content", href: "/queue/save-content", method: "POST", title: nil, type: "multipart/form-data", fields: nil)
	}

	private func saveArticleAction() -> SirenAction {
		SirenAction(name: "save-article", href: "/queue", method: "POST", title: nil, type: "application/json", fields: nil)
	}

	private func updateStatusAction(id: String = "a1", statusValue: String? = "read") -> SirenAction {
		SirenAction(
			name: "update-status",
			href: "/queue/\(id)/status",
			method: "POST",
			title: nil,
			type: "application/x-www-form-urlencoded",
			fields: [SirenField(name: "status", type: "text", value: statusValue)]
		)
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
		XCTAssertEqual(
			queueRequest.value(forHTTPHeaderField: "X-Readplace-Client"), "ios",
			"the iOS client header must survive the GET / → /queue redirect so the server records onboarding"
		)
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

	func testLoadQueueRejectsANonSirenBody() async {
		// The client negotiated Siren with Accept; a 200 carrying a different media
		// type (e.g. a proxy HTML login page) is surfaced as unsupportedMediaType
		// rather than blind-decoded into a generic decode failure.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			default:
				return StubURLProtocol.Stub(
					status: 200,
					headers: ["Content-Type": "text/html"],
					body: Data("<html><body>Sign in</body></html>".utf8)
				)
			}
		}
		do {
			_ = try await makeAPI(store: store).loadQueue()
			XCTFail("Expected unsupportedMediaType")
		} catch let error as APIError {
			guard case .unsupportedMediaType(let type) = error else {
				return XCTFail("Expected .unsupportedMediaType, got \(error)")
			}
			XCTAssertEqual(type, "text/html")
		} catch {
			XCTFail("Expected APIError.unsupportedMediaType, got \(error)")
		}
	}

	func testLoadQueueAcceptsSirenWithCharsetParameter() async throws {
		// The negotiated type may arrive with a charset parameter; the essence still
		// matches, so the body parses.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			default:
				return StubURLProtocol.Stub(
					status: 200,
					headers: ["Content-Type": "application/vnd.siren+json; charset=utf-8"],
					body: Data(Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]).utf8)
				)
			}
		}

		let page = try await makeAPI(store: store).loadQueue()

		XCTAssertEqual(page.articles.map(\.id), ["a1"])
	}

	func testLoadQueueSurfacesADecodeFailureForAMalformedSirenBody() async {
		// A 200 carrying the negotiated Siren type but a body that fails a root decode
		// (an array where the collection object is expected) is surfaced as the opaque
		// .decoding — the underlying DecodingError is logged, never handed to the caller.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			default:
				return StubURLProtocol.Stub(
					status: 200,
					headers: ["Content-Type": AppConfig.sirenMediaType],
					body: Data("[1,2,3]".utf8)
				)
			}
		}
		do {
			_ = try await makeAPI(store: store).loadQueue()
			XCTFail("Expected decoding")
		} catch let error as APIError {
			guard case .decoding = error else {
				return XCTFail("Expected .decoding, got \(error)")
			}
		} catch {
			XCTFail("Expected APIError.decoding, got \(error)")
		}
	}

	func testNoTokenThrowsNoTokenError() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
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

	// MARK: - Saving content

	func testSaveContentSuccessSendsMultipart() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/queue/save-content")
			return .json(201, Fixtures.article(id: "saved", url: "https://example.com/x"))
		}

		let result = try await makeAPI(store: store).saveContent(
			action: saveContentAction(),
			url: "https://example.com/x",
			content: Data("<html><body>hi</body></html>".utf8),
			mediaType: "text/html",
			title: "Captured"
		)

		XCTAssertEqual(result.article.id, "saved")
		XCTAssertFalse(result.usedFallback, "a clean save-content does not use the fallback")
		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		XCTAssertEqual(record.request.value(forHTTPHeaderField: "X-Readplace-Client"), "ios")
		let contentType = try XCTUnwrap(record.request.value(forHTTPHeaderField: "Content-Type"))
		XCTAssertTrue(
			contentType.hasPrefix("multipart/form-data; boundary="),
			"the request must declare a multipart body with a boundary, got \(contentType)"
		)
		let parts = TestSupport.multipartParts(contentType: contentType, body: record.body)
		XCTAssertEqual(parts.first { $0.name == "url" }?.text, "https://example.com/x")
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "text/html")
		XCTAssertEqual(parts.first { $0.name == "title" }?.text, "Captured")
		let contentPart = try XCTUnwrap(parts.first { $0.name == "content" })
		XCTAssertEqual(contentPart.filename, "content")
		XCTAssertEqual(contentPart.text, "<html><body>hi</body></html>")
	}

	func testSaveContentOmitsTitleWhenNil() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(201, Fixtures.article(id: "saved")) }

		_ = try await makeAPI(store: store).saveContent(
			action: saveContentAction(), url: "https://example.com/x",
			content: Data("<html></html>".utf8), mediaType: "text/html", title: nil
		)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/save-content").first)
		let parts = TestSupport.multipartParts(
			contentType: record.request.value(forHTTPHeaderField: "Content-Type"), body: record.body
		)
		XCTAssertNil(parts.first { $0.name == "title" }, "no title part is emitted when the title is nil")
	}

	func testSaveContentFallsBackToURLOnlyWhenServerOffersFallbackAction() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/save-content":
				return .json(422, Fixtures.sirenError(code: "content-too-large", message: "Too big", withSaveArticleFallback: true))
			case "/queue":
				return .json(201, Fixtures.article(id: "fallback-saved"))
			default:
				return .json(404, "{}")
			}
		}

		let result = try await makeAPI(store: store).saveContent(
			action: saveContentAction(), url: "https://example.com/x",
			content: Data("<huge/>".utf8), mediaType: "text/html", title: "T"
		)

		XCTAssertEqual(result.article.id, "fallback-saved")
		XCTAssertTrue(result.usedFallback, "following the server's fallback action is reported as a fallback")
		let fallbackBody = TestSupport.jsonObject(try XCTUnwrap(StubURLProtocol.records(path: "/queue").first).body)
		XCTAssertEqual(fallbackBody["url"] as? String, "https://example.com/x")
		XCTAssertEqual(fallbackBody["title"] as? String, "T")
		XCTAssertNil(fallbackBody["rawHtml"], "the fallback carries the URL only, never the captured content")
	}

	func testSaveContentThrowsWhenErrorHasNoFallbackAction() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			.json(422, Fixtures.sirenError(code: "invalid-save-content", message: "Invalid", withSaveArticleFallback: false))
		}
		do {
			_ = try await makeAPI(store: store).saveContent(
				action: saveContentAction(), url: "https://example.com/x",
				content: Data("<html></html>".utf8), mediaType: "text/html", title: nil
			)
			XCTFail("Expected a server error")
		} catch let error as APIError {
			guard case .server(let status, let code, _) = error else {
				return XCTFail("Expected .server, got \(error)")
			}
			XCTAssertEqual(status, 422)
			XCTAssertEqual(code, "invalid-save-content")
		} catch {
			XCTFail("Expected APIError.server, got \(error)")
		}
	}

	func testSaveContentSurfacesRefusalAndAttemptsNoFallbackSave() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/save-content":
				return .json(403, Fixtures.accountLockedError())
			default:
				// A message-only refusal must never trigger a fallback save.
				return .json(201, Fixtures.article(id: "should-not-happen"))
			}
		}
		do {
			_ = try await makeAPI(store: store).saveContent(
				action: saveContentAction(), url: "https://example.com/x",
				content: Data("<html></html>".utf8), mediaType: "text/html", title: nil
			)
			XCTFail("Expected a message-only refusal")
		} catch let APIError.refused(messages) {
			XCTAssertTrue(messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false)
		} catch {
			XCTFail("Expected APIError.refused, got \(error)")
		}
		// The refusal carries no action, so no URL-only fallback save fires.
		XCTAssertEqual(StubURLProtocol.records(path: "/queue").count, 0, "must not attempt a fallback save")
	}

	func testSaveContentSurfacesRefusalOnPaymentRequiredStatus() async {
		// An inactive subscription refuses the save with a 402 carrying a server-authored
		// message. The share extension must render that message (a `.refused`), not fall
		// through to the cryptic "Server error 402" — the client reads messages[] on any
		// non-2xx status, so the fix is purely the server attaching the message body.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/save-content":
				return .json(402, Fixtures.messageRefusal([
					(type: "warning", mediaType: "text/html", body: "Couldn't save — your subscription isn't active."),
				]))
			default:
				// A message-only refusal must never trigger a fallback save.
				return .json(201, Fixtures.article(id: "should-not-happen"))
			}
		}
		do {
			_ = try await makeAPI(store: store).saveContent(
				action: saveContentAction(), url: "https://example.com/x",
				content: Data("<html></html>".utf8), mediaType: "text/html", title: nil
			)
			XCTFail("Expected a message-only refusal")
		} catch let APIError.refused(messages) {
			XCTAssertTrue(messages.first?.content.body.contains("subscription isn't active") ?? false)
		} catch {
			XCTFail("Expected APIError.refused, got \(error)")
		}
		XCTAssertEqual(StubURLProtocol.records(path: "/queue").count, 0, "must not attempt a fallback save")
	}

	func testFetchExternalContentSendsNoAuthorization() async throws {
		let store = TestSupport.loggedInStore(access: "secret-access")
		let pdfBytes = Data("%PDF-1.7 body".utf8)
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(status: 200, headers: ["Content-Type": "application/pdf"], body: pdfBytes)
		}

		let fetched = await makeAPI(store: store).fetchExternalContent(URL(string: "https://arxiv.org/pdf/1706.03762")!)

		let bytes = try XCTUnwrap(fetched)
		XCTAssertEqual(bytes, pdfBytes)
		let record = try XCTUnwrap(StubURLProtocol.records.first)
		XCTAssertNil(
			record.request.value(forHTTPHeaderField: "Authorization"),
			"the external fetch must never carry the Readplace bearer token"
		)
		XCTAssertNil(
			record.request.value(forHTTPHeaderField: "X-Readplace-Client"),
			"the external fetch must not advertise the Readplace client to a third-party origin"
		)
	}

	func testFetchExternalContentAbortsWhenStreamedBytesExceedCeiling() async {
		// No Content-Length, so the size is unknown up front: the running total must
		// trip the ceiling mid-stream and degrade to nil rather than buffering the whole
		// oversize body into the share extension's memory budget.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(
				status: 200,
				headers: ["Content-Type": "application/pdf"],
				body: Data(repeating: 0x41, count: 64)
			)
		}
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL, store: store,
			sessionConfiguration: TestSupport.stubbedConfiguration(), maxExternalContentBytes: 16
		)

		let fetched = await api.fetchExternalContent(URL(string: "https://example.com/big.pdf")!)

		XCTAssertNil(fetched, "a body that crosses the ceiling mid-stream must abort to nil")
	}

	func testFetchExternalContentRejectsResponseAnnouncingOversizeLength() async {
		// A response whose declared Content-Length already exceeds the ceiling is refused
		// before the body is read — the cheap early-out that keeps an honestly-sized
		// oversize resource off the wire entirely.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(
				status: 200,
				headers: ["Content-Type": "application/pdf", "Content-Length": "1000000"],
				body: Data("%PDF-".utf8)
			)
		}
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL, store: store,
			sessionConfiguration: TestSupport.stubbedConfiguration(), maxExternalContentBytes: 16
		)

		let fetched = await api.fetchExternalContent(URL(string: "https://example.com/big.pdf")!)

		XCTAssertNil(fetched, "a response announcing an oversize Content-Length must be refused up front")
	}

	func testFetchExternalContentReadsBodyWhenAnnouncedLengthIsWithinCeiling() async throws {
		// An honestly-sized, in-bounds Content-Length passes the announced-length guard
		// and pre-sizes the buffer, then the body is read in full — the known-length
		// happy path the oversize and no-Content-Length tests never reach.
		let store = TestSupport.loggedInStore()
		let body = Data("%PDF-1.7 within ceiling".utf8)
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(
				status: 200,
				headers: ["Content-Type": "application/pdf", "Content-Length": "\(body.count)"],
				body: body
			)
		}

		let fetched = await makeAPI(store: store).fetchExternalContent(URL(string: "https://example.com/small.pdf")!)

		let bytes = try XCTUnwrap(fetched, "an in-bounds announced length is pre-sized and the body read in full")
		XCTAssertEqual(bytes, body)
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

	func testSaveArticleSurfacesRefusalMessages() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(403, Fixtures.accountLockedError()) }
		do {
			_ = try await makeAPI(store: store).saveArticle(action: saveArticleAction(), url: "https://example.com/x")
			XCTFail("Expected a message-only refusal")
		} catch let APIError.refused(messages) {
			XCTAssertEqual(messages.first?.type, "warning")
			XCTAssertEqual(messages.first?.content.type, "text/html")
			XCTAssertTrue(messages.first?.content.body.contains("readplace+verification@readplace.com") ?? false)
		} catch {
			XCTFail("Expected APIError.refused, got \(error)")
		}
	}

	func testSaveIgnoresAMessageWhoseMediaTypeItCannotRender() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			.json(403, Fixtures.messageRefusal([(type: "warning", mediaType: "text/markdown", body: "**locked**")]))
		}
		do {
			_ = try await makeAPI(store: store).saveArticle(action: saveArticleAction(), url: "https://example.com/x")
			XCTFail("Expected an error")
		} catch let APIError.refused(messages) {
			XCTFail("a media type the client can't render must be ignored, not surfaced: \(messages)")
		} catch {
			// A refusal left with no renderable message falls through to a generic
			// server error rather than showing a blank banner — the message is ignored.
		}
	}

	func testSaveKeepsOnlyRenderableMessagesInAMixedRefusal() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			.json(403, Fixtures.messageRefusal([
				(type: "warning", mediaType: "text/markdown", body: "skip me"),
				(type: "warning", mediaType: "text/html", body: "show me"),
			]))
		}
		do {
			_ = try await makeAPI(store: store).saveArticle(action: saveArticleAction(), url: "https://example.com/x")
			XCTFail("Expected a refusal")
		} catch let APIError.refused(messages) {
			XCTAssertEqual(messages.map(\.content.type), ["text/html"], "unknown media types are dropped, text/html kept")
			XCTAssertEqual(messages.first?.content.body, "show me")
		} catch {
			XCTFail("Expected APIError.refused, got \(error)")
		}
	}

	// MARK: - Updating status

	func testInvokePostsTheFieldValueUrlencodedAndFollowsRedirect() async throws {
		// The client supplies no field knowledge: it posts the server-declared
		// field's own `value`, encoded per the action's `type` (urlencoded → form
		// body). A bare invoke(action:) is sufficient — no hardcoded status.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/queue/a1/status":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "remaining")]))
			default:
				return .json(404, "{}")
			}
		}

		let page = try await makeAPI(store: store).invoke(action: updateStatusAction(statusValue: "read"))

		let statusRecord = try XCTUnwrap(StubURLProtocol.records(path: "/queue/a1/status").first)
		XCTAssertEqual(statusRecord.request.httpMethod, "POST")
		XCTAssertEqual(statusRecord.request.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
		XCTAssertEqual(
			TestSupport.formFields(statusRecord.body)["status"], "read",
			"the status comes from the declared field's value, not a client constant"
		)
		XCTAssertNil(
			statusRecord.request.value(forHTTPHeaderField: "Prefer"),
			"the representation rides the followed redirect, so none is requested"
		)
		XCTAssertEqual(StubURLProtocol.records(path: "/queue").count, 1, "the 303 to /queue is followed")
		XCTAssertEqual(
			page?.articles.map(\.id), ["remaining"],
			"the followed collection is returned as the post-action truth for the caller to adopt"
		)
	}

	func testInvokeReturnsNoPageWhenTheResponseIsNotACollection() async throws {
		// An invoke may land on any representation. A Siren body without the
		// `collection` class (here: an article entity) is no re-list direction —
		// and because every SirenCollection field is optional, the class is the
		// only honest discriminator against misreading an entity as a list.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/queue/a1/status"
				? .json(200, Fixtures.article(id: "a1"))
				: .json(404, "{}")
		}

		let page = try await makeAPI(store: store).invoke(action: updateStatusAction(statusValue: "read"))

		XCTAssertNil(page, "a non-collection response carries no post-action list to adopt")
	}

	func testInvokeReturnsNoPageWhenTheResponseIsNotSiren() async throws {
		// A 2xx in a media type the client doesn't speak still confirms the invoke
		// (the protocol-level outcome), but carries no collection to adopt.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/queue/a1/status"
				? StubURLProtocol.Stub(
					status: 200,
					headers: ["Content-Type": "text/html"],
					body: Data("<!doctype html>".utf8)
				)
				: .json(404, "{}")
		}

		let page = try await makeAPI(store: store).invoke(action: updateStatusAction(statusValue: "read"))

		XCTAssertNil(page, "a non-Siren response carries no post-action list to adopt")
	}

	func testInvokeTakesTheStatusFromTheFieldValueNotAClientConstant() async throws {
		// A server that targets a different status drives that exact value into the
		// body — proving the client never hardcodes "read".
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/queue"
				? .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "remaining")]))
				: .redirect(to: "/queue")
		}

		_ = try await makeAPI(store: store).invoke(action: updateStatusAction(statusValue: "archived"))

		XCTAssertEqual(
			TestSupport.formFields(StubURLProtocol.records(path: "/queue/a1/status").first!.body)["status"],
			"archived",
			"whatever status the field value declares is what gets posted"
		)
	}

	func testInvokeEncodesAGetActionsFieldValuesAsQueryItemsWithNoBody() async throws {
		// A GET action (e.g. `search`) carries no body — the field values are the
		// query string. The generic invoker must put the server-declared field value
		// on the URL, not in the httpBody, and send no Content-Type.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/queue"
				? .json(200, Fixtures.collection(entitiesJSON: [Fixtures.article(id: "a1")]))
				: .json(404, "{}")
		}
		let search = SirenAction(
			name: "search", href: "/queue", method: "GET", title: nil, type: nil,
			fields: [SirenField(name: "status", type: "text", value: "unread")]
		)

		_ = try await makeAPI(store: store).invoke(action: search)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first)
		XCTAssertEqual(record.request.httpMethod, "GET")
		let query = try XCTUnwrap(URLComponents(url: try XCTUnwrap(record.request.url), resolvingAgainstBaseURL: false)?.queryItems)
		XCTAssertEqual(
			query.first { $0.name == "status" }?.value, "unread",
			"a GET action's field value rides the URL query, not the body"
		)
		XCTAssertTrue(record.body.isEmpty, "a GET carries no body")
		XCTAssertNil(
			record.request.value(forHTTPHeaderField: "Content-Type"),
			"a GET sets no Content-Type — there is nothing to encode in a body"
		)
	}

	func testInvokeJSONTypedActionSendsAJSONBodyMatchingTheDeclaredType() async throws {
		// An action whose declared type is application/json must post a JSON body —
		// not a form-encoded body under a JSON Content-Type. The body encoding follows
		// the action's own `type`, so a future JSON-bodied flat action invokes correctly.
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/queue/a1/status" ? .json(200, "{}") : .json(404, "{}")
		}
		let action = SirenAction(
			name: "update-status", href: "/queue/a1/status", method: "POST",
			title: nil, type: "application/json",
			fields: [SirenField(name: "status", type: "text", value: "read")]
		)

		_ = try await makeAPI(store: store).invoke(action: action)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/queue/a1/status").first)
		XCTAssertEqual(
			record.request.value(forHTTPHeaderField: "Content-Type"), "application/json",
			"the request is labelled with the action's declared JSON type"
		)
		XCTAssertEqual(
			TestSupport.jsonObject(record.body)["status"] as? String, "read",
			"a JSON-typed action posts a JSON body, not a form-encoded one under a JSON header"
		)
	}

	func testInvokeSurfacesServerErrorOnFailureStatus() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in
			.json(500, Fixtures.sirenError(code: "boom", message: "nope", withSaveArticleFallback: false))
		}
		do {
			_ = try await makeAPI(store: store).invoke(action: updateStatusAction(), values: ["status": "read"])
			XCTFail("Expected a server error")
		} catch let error as APIError {
			// The client verifies the protocol-level outcome only: any non-2xx/3xx
			// is a generic server error, with no special-casing of a status code.
			guard case .server(let status, _, _) = error else {
				return XCTFail("Expected .server, got \(error)")
			}
			XCTAssertEqual(status, 500)
		} catch {
			XCTFail("Expected APIError.server, got \(error)")
		}
	}

	// MARK: - Reader session

	func testBootstrapSessionParsesSessionCookieFromSetCookieHeader() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/auth/session")
			XCTAssertEqual(request.httpMethod, "POST")
			return StubURLProtocol.Stub(
				status: 204,
				headers: ["Set-Cookie": "hutch_sid=sess-abc; Path=/; HttpOnly"]
			)
		}

		let cookies = try await makeAPI(store: store).bootstrapSession()

		XCTAssertEqual(cookies.count, 1)
		XCTAssertEqual(cookies.first?.value, "sess-abc")
	}

	func testBootstrapSessionRefreshesOnceWhenBearerExpired() async throws {
		let store = TestSupport.loggedInStore(access: "stale", refresh: "r1")
		var sessionAttempts = 0
		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/auth/session":
				sessionAttempts += 1
				if sessionAttempts == 1 { return .json(401, "{}") }
				return StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "hutch_sid=fresh-sess; Path=/"])
			case "/oauth/token":
				return .json(200, Fixtures.tokenResponse(access: "fresh-access", refresh: "r2"))
			default:
				return .json(404, "{}")
			}
		}

		let cookies = try await makeAPI(store: store).bootstrapSession()

		XCTAssertEqual(cookies.first?.value, "fresh-sess")
		XCTAssertEqual(sessionAttempts, 2, "should retry once after refreshing the bearer")
		XCTAssertEqual(store.tokens?.accessToken, "fresh-access")
	}

	func testBootstrapSessionKeepsTheCookieOutOfTheSharedJar() async throws {
		let host = try XCTUnwrap(URL(string: AppConfig.serverBaseURL)?.host)
		for stale in HTTPCookieStorage.shared.cookies?.filter({ $0.name == "hutch_sid" }) ?? [] {
			HTTPCookieStorage.shared.deleteCookie(stale)
		}
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "hutch_sid=isolated; Path=/; Domain=\(host)"])
		}

		_ = try await makeAPI(store: TestSupport.loggedInStore()).bootstrapSession()

		XCTAssertNil(
			HTTPCookieStorage.shared.cookies?.first { $0.name == "hutch_sid" },
			"the minted session cookie must never land in the process-wide shared jar"
		)
	}

	func testBootstrapSessionFollowsADiscoveredActionsHrefAndMethod() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/custom/session", "follows the action's href, not a hard-coded path")
			XCTAssertEqual(request.httpMethod, "POST")
			return StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "sess=discovered; Path=/"])
		}
		let action = SirenAction(
			name: "create-session", href: "/custom/session", method: "POST", title: nil, type: nil, fields: nil
		)

		let cookies = try await makeAPI(store: store).bootstrapSession(action: action)

		XCTAssertEqual(cookies.first?.value, "discovered")
	}

	func testBootstrapSessionReturnsOnlyTheCookiesThisResponseSet() async throws {
		let config = TestSupport.stubbedConfiguration()
		// A cookie an earlier request left in the jar must not be handed back as one
		// this mint set — the store holds every cookie for the host, not just the
		// response's.
		config.httpCookieStorage?.setCookie(TestSupport.sessionCookie(value: "old", name: "leftover"))
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "hutch_sid=minted; Path=/"])
		}
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL, store: TestSupport.loggedInStore(),
			sessionConfiguration: config
		)

		let cookies = try await api.bootstrapSession()

		XCTAssertEqual(cookies.map(\.name), ["hutch_sid"], "the stale jar cookie is excluded")
		XCTAssertEqual(cookies.first?.value, "minted")
	}

	func testBootstrapSessionTreatsAResponseThatSetsNoNewCookieAsAFailedMint() async {
		let config = TestSupport.stubbedConfiguration()
		// A stale jar cookie must not disguise a mint that set nothing as a success.
		config.httpCookieStorage?.setCookie(TestSupport.sessionCookie(value: "old"))
		StubURLProtocol.setHandler { _, _ in StubURLProtocol.Stub(status: 204) }
		let api = ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL, store: TestSupport.loggedInStore(),
			sessionConfiguration: config
		)

		do {
			_ = try await api.bootstrapSession()
			XCTFail("a response that sets no new cookie is a failed mint")
		} catch let error as APIError {
			guard case .decoding = error else {
				return XCTFail("Expected .decoding, got \(error)")
			}
		} catch {
			XCTFail("Expected APIError.decoding, got \(error)")
		}
	}
}
