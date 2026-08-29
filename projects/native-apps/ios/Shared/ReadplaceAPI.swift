import Foundation
import os

enum APIError: LocalizedError {
	case noToken
	case unauthorized
	case server(status: Int, code: String?, message: String?)
	/// The server refused the request with messages for the client to render.
	/// Carries the server-authored messages; the refusal models no action — there
	/// is nothing for the client to invoke, only something for the user to read.
	case refused(messages: [ServerMessage])
	/// The response carried a body in a media type the client doesn't speak (not
	/// the negotiated Siren type). Surfaced honestly rather than blind-decoded — a
	/// proxy login page or a future media type is "I don't understand this," not a
	/// generic "couldn't read the response."
	case unsupportedMediaType(String?)
	case decoding

	var errorDescription: String? {
		switch self {
		case .noToken: return "Not signed in. Open Readplace and sign in first."
		case .unauthorized: return "Your session expired. Please sign in again."
		case .server(let status, let code, let message):
			return message ?? "Server error \(status)\(code.map { " (\($0))" } ?? "")."
		case .refused(let messages): return messages.map(\.plainText).joined(separator: "\n")
		case .unsupportedMediaType: return "The server replied in a format this app doesn't understand."
		case .decoding: return "Could not read the server response."
		}
	}
}

/// One page of the reading-list collection plus the collection-level actions
/// and pagination links the server advertised.
struct ReadlistPage {
	let articles: [Article]
	let nextHref: String?
	/// Every collection-level action and navigable link the server advertised, in
	/// wire order — the complete set, so the share-sheet save journey can still find
	/// its bespoke action by name (`action(named:)`, below). The toolbar does not
	/// render this set verbatim: it derives its own subset client-side
	/// (`toolbarAffordances`) by mapping each affordance's wire token to its
	/// presentation and dropping the ones it can't present as a toolbar control —
	/// a structural navigation link the client follows itself, or a capture-only
	/// save iOS can only reach through the Share Sheet.
	let affordances: [Affordance]
	let warning: SirenWarning?
	/// Server-authored notices the client may surface generically (e.g. the Share
	/// Extension's "don't close this" caption during a save). Only the renderable
	/// ones are kept — a message in a media type this client can't present is
	/// dropped rather than shown as raw text (be liberal in what you accept,
	/// conservative in what you render), so the caller renders whatever survives
	/// without re-checking. Empty when the server offered none.
	let noticeMessages: [ServerMessage]
	let tabs: [ReadlistTab]

	init(collection: SirenCollection) {
		articles = (collection.entities ?? []).compactMap(Article.init(entity:))
		let links = collection.links ?? []
		nextHref = links.first { $0.rel.contains("next") }?.href
		let actionAffordances = (collection.actions ?? []).compactMap(Affordance.init(action:))
		let linkAffordances = links.compactMap(Affordance.init(link:))
		affordances = actionAffordances + linkAffordances
		warning = collection.properties?.warning
		noticeMessages = (collection.properties?.messages ?? []).filter(\.isRenderable)
		tabs = (collection.properties?.tabs ?? []).map(ReadlistTab.init(tab:))
	}

	var currentTabHref: String? { tabs.first(where: \.isCurrent)?.href }

	/// The advertised action with this name, when present and invokable. The
	/// share-sheet save journey needs a specific action to build its bespoke body
	/// (a captured-HTML or URL-only POST), which is the contract's sanctioned
	/// exception for actions with special bodies — distinct from the looped
	/// toolbar rendering, which never selects an affordance by name.
	func action(named name: String) -> SirenAction? {
		for affordance in affordances {
			if let action = affordance.action, action.name == name { return action }
		}
		return nil
	}
}

/// A Siren client for the Readplace reading list, replicating the browser
/// extension's walker: it speaks `application/vnd.siren+json`, presents a
/// Bearer token, refreshes once on `401`, and follows server-declared hrefs
/// rather than constructing them.
final class ReadplaceAPI {
	private static let logger = Logger(subsystem: "com.readplace", category: "ReadplaceAPI")

	let baseURL: String
	private let store: TokenStore
	private let oauth: OAuthService
	private let session: URLSession
	// Fetches third-party content (e.g. a PDF the user shared) with no delegate
	// and never via `send()`, so neither the bearer nor the redirect-preserving
	// re-attachment can leak the Readplace `Authorization` header to that origin.
	private let externalSession: URLSession
	/// Conservative ceiling on bytes pulled into the extension for an external
	/// content fetch. Well under the server's `MAX_PDF_BYTES` OCR ceiling: that is
	/// an origin-side limit, whereas the share extension holds the fetched bytes in a
	/// tight memory budget. `fetchExternalContent` streams the body and stops the
	/// moment the running total crosses this ceiling (refusing outright when the
	/// response announces an oversize length), so an oversize resource degrades to a
	/// URL-only save without ever being buffered whole.
	private let maxExternalContentBytes: Int

	static let defaultMaxExternalContentBytes = 25 * 1024 * 1024

	// Defaults to an ephemeral configuration so the session's cookie jar is its
	// own isolated, in-memory store rather than process-wide `HTTPCookieStorage.shared`:
	// the session cookie minted by `bootstrapSession` must not linger in the shared
	// jar where it would outlive the session and leak across sign-outs.
	init(
		baseURL: String,
		store: TokenStore,
		sessionConfiguration: URLSessionConfiguration = .ephemeral,
		maxExternalContentBytes: Int = ReadplaceAPI.defaultMaxExternalContentBytes
	) {
		self.baseURL = baseURL
		self.store = store
		self.oauth = OAuthService(baseURL: baseURL, store: store, sessionConfiguration: sessionConfiguration)
		// URLSession retains its delegate until invalidated, so the redirect
		// handler stays alive for the session's lifetime.
		self.session = URLSession(
			configuration: sessionConfiguration,
			delegate: RedirectHeaderPreservingDelegate(),
			delegateQueue: nil
		)
		self.externalSession = URLSession(configuration: sessionConfiguration)
		self.maxExternalContentBytes = maxExternalContentBytes
	}

	// MARK: - Reading list

	/// Loads a collection page. With no `path`, starts at the entry point — the
	/// one URL the client knows — and follows wherever the server redirects;
	/// otherwise it follows a link href the server already handed back (e.g. the
	/// `next` link).
	func loadReadlist(path: String? = nil) async throws -> ReadlistPage {
		let url: URL
		if let path {
			url = try absoluteURL(path)
		} else {
			guard let entry = URL(string: "\(baseURL)/") else { throw APIError.decoding }
			url = entry
		}
		var request = URLRequest(url: url)
		request.httpMethod = "GET"
		let (data, http) = try await send(request)
		guard http.statusCode == 200 else { throw apiError(from: data, status: http.statusCode) }
		return ReadlistPage(collection: try decodeSiren(SirenCollection.self, data: data, response: http))
	}

	/// Invokes a simple entity action via its own server-declared href, method and
	/// type — the single generic path for actions whose body is a flat field set
	/// (e.g. `update-status`), so a newly-advertised entity action is
	/// invokable with no new per-operation code. The caller supplies values only
	/// for the field names whose semantics the protocol fixes (`status`); the
	/// action's own declared field defaults fill the rest, and a field the caller
	/// neither supplies nor the server defaults is simply omitted. A successful
	/// follow (a 2xx/3xx, after the redirect-preserving delegate re-attaches auth
	/// across any redirect) confirms the invoke; anything else surfaces as a server
	/// error. Returns the followed response's collection when the server drove the
	/// client back to one — the post-action truth the caller adopts, carrying
	/// whatever changed elsewhere (e.g. an item marked unread on the website) — or
	/// nil when the response is no collection: the server directed no re-list.
	func invoke(action: SirenAction, values: [String: String] = [:]) async throws -> ReadlistPage? {
		var fields = values
		for declared in action.fields ?? [] where fields[declared.name] == nil {
			if let value = declared.value { fields[declared.name] = value }
		}
		let request = try invocationRequest(for: action, fields: fields)
		let (data, http) = try await send(request)
		guard (200...399).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
		return postActionCollection(data: data, response: http)
	}

	/// The collection the server drove a successful action back to, or nil when
	/// the response is not one. Decoded leniently on purpose: an action may land
	/// on any representation (an entity, an empty body, a non-Siren page), and
	/// none of those is an error — it just means the server issued no re-list
	/// direction. The `collection` class is the discriminator because every
	/// `SirenCollection` field is optional, so any JSON object would otherwise
	/// pass the decode.
	private func postActionCollection(data: Data, response: HTTPURLResponse) -> ReadlistPage? {
		guard isSirenMediaType(response.value(forHTTPHeaderField: "Content-Type")),
			let collection = try? JSONDecoder().decode(SirenCollection.self, from: data),
			(collection.`class` ?? []).contains("collection")
		else { return nil }
		return ReadlistPage(collection: collection)
	}

	// MARK: - Reader session

	/// Mints a browser session from the current bearer token and returns the cookies
	/// this mint added to or changed in the session jar — the freshly-set session id,
	/// not the cookies an earlier request already left there (`sessionCookies` has the
	/// exact rule). The in-app reader injects them so the cookie-authenticated reader
	/// page (and its in-reader XHRs) load without bouncing to a sign-in page. Follows
	/// the server-declared `action`'s href and method when the collection advertised one
	/// (`create-session`), so the endpoint can move without an app release; falls back to
	/// a fixed path only for a server that hasn't advertised the action yet (an older
	/// shipped build must keep working). The client never selects a cookie by name — it
	/// forwards whatever this exchange changed. Reuses `send()`, so a stale bearer is
	/// refreshed once before the session is minted; a mint that changes no jar cookie and
	/// sets no `Set-Cookie` header is a failed mint.
	func bootstrapSession(action: SirenAction? = nil) async throws -> [HTTPCookie] {
		let url: URL
		let method: String
		if let action {
			url = try absoluteURL(action.href)
			method = action.method
		} else {
			guard let fallback = URL(string: "\(baseURL)/auth/session") else { throw APIError.decoding }
			url = fallback
			method = "POST"
		}
		var request = URLRequest(url: url)
		request.httpMethod = method
		// Snapshot the jar before the request so `sessionCookies` can tell a cookie
		// this mint sets apart from one an earlier request already left behind.
		let priorCookies = Set(
			(session.configuration.httpCookieStorage?.cookies(for: url) ?? []).map(CookieIdentity.init)
		)
		let (data, http) = try await send(request)
		guard (200...299).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
		let cookies = sessionCookies(from: http, url: url, excluding: priorCookies)
		guard !cookies.isEmpty else { throw APIError.decoding }
		return cookies
	}

	/// Identity of a jar cookie for the before/after comparison in `sessionCookies`.
	/// Re-reading the jar hands back fresh `HTTPCookie` instances for the same
	/// cookie, so object identity can't decide whether a cookie is one this mint
	/// set — name, domain, path, and value can. Value is part of the key so a
	/// re-issued cookie (same name, new value) still reads as freshly set.
	private struct CookieIdentity: Hashable {
		let name: String
		let domain: String
		let path: String
		let value: String
		init(_ cookie: HTTPCookie) {
			name = cookie.name
			domain = cookie.domain
			path = cookie.path
			value = cookie.value
		}
	}

	/// Returns the session jar's `prior`-to-now delta — the cookies this exchange added
	/// or changed, keyed by `CookieIdentity` — read from the session's own cookie jar.
	/// The configuration isolates that jar (an ephemeral store, not
	/// `HTTPCookieStorage.shared`) so the cookies URLSession just parsed never touch the
	/// process-wide jar. Reading the already-parsed cookies back from the store, rather
	/// than re-splitting `allHeaderFields`, sidesteps a spec hazard: repeated `Set-Cookie`
	/// headers must not be folded into one comma-joined value, so header re-splitting is
	/// unsafe once a response sets more than one cookie. Excluding `prior` drops the
	/// cookies an earlier request left in the jar — keeping the caller's
	/// empty-means-failed-mint check honest, and deliberately dropping a signal the server
	/// re-sets on every Siren response (e.g. `hutch_ext_alive`) with an unchanged value:
	/// already in `prior` from the readlist load that precedes a mint, re-set unchanged it
	/// never enters the delta, and injecting it into the reader would fake
	/// extension-installed onboarding from the app. The delta is why this is not literally
	/// "every cookie the response set": a cookie re-set with an unchanged value is
	/// recovered only by the `Set-Cookie` header fallback below, and only when the whole
	/// delta is empty — which is also how environments that don't populate the store (a
	/// stubbed `URLProtocol` under test) are served.
	private func sessionCookies(
		from response: HTTPURLResponse,
		url: URL,
		excluding prior: Set<CookieIdentity>
	) -> [HTTPCookie] {
		if let stored = session.configuration.httpCookieStorage?.cookies(for: url) {
			let fresh = stored.filter { !prior.contains(CookieIdentity($0)) }
			if !fresh.isEmpty { return fresh }
		}
		guard let headers = response.allHeaderFields as? [String: String] else { return [] }
		return HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
	}

	// MARK: - Saving

	/// Fetches third-party content the user shared (e.g. a PDF) so the bytes can
	/// be uploaded via `save-content`. Uses `externalSession` — never `send()` —
	/// so the Readplace bearer is never attached. Streams the body and aborts the
	/// moment the running total exceeds `maxExternalContentBytes` (and refuses a
	/// response whose announced length already exceeds it), so an oversize resource
	/// — a large scanned PDF, say — never lands in the extension's memory budget
	/// whole; returns nil on any non-2xx, oversize, or transport failure so the
	/// caller degrades to a URL-only save.
	func fetchExternalContent(_ url: URL) async -> Data? {
		var request = URLRequest(url: url)
		request.httpMethod = "GET"
		guard let (stream, response) = try? await externalSession.bytes(for: request),
			let http = response as? HTTPURLResponse,
			(200...299).contains(http.statusCode),
			http.expectedContentLength <= Int64(maxExternalContentBytes)
		else { return nil }
		var data = Data()
		if http.expectedContentLength > 0 { data.reserveCapacity(Int(http.expectedContentLength)) }
		do {
			for try await byte in stream {
				data.append(byte)
				if data.count > maxExternalContentBytes { return nil }
			}
		} catch {
			return nil
		}
		return data
	}

	/// Saves a URL only (no captured HTML) via the `save-article` action.
	/// What the server said about an accepted save: the article it created or
	/// bumped, and the confirmation it wants the reader told — empty on a server
	/// that predates the channel, in which case the sheet keeps its own copy.
	struct SaveConfirmation {
		let article: Article
		let messages: [ServerMessage]
	}

	func saveArticle(action: SirenAction, url: String) async throws -> SaveConfirmation {
		var request = jsonRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/json", body: ["url": url])
		request.setValue("return=representation", forHTTPHeaderField: "Prefer")
		let (data, http) = try await send(request)
		guard http.statusCode == 201 || http.statusCode == 200 else {
			throw apiError(from: data, status: http.statusCode)
		}
		let entity = try decodeSiren(SirenEntity.self, data: data, response: http)
		guard let article = Article(entity: entity) else { throw APIError.decoding }
		let messages = (entity.properties?.messages ?? []).filter(\.isRenderable)
		return SaveConfirmation(article: article, messages: messages)
	}

	func saveContent(action: SirenAction, form: MultipartForm) async throws {
		try await saveContent(action: action, contentType: form.contentType, body: form.body)
	}

	func saveContent(action: SirenAction, contentType: String, body: Data) async throws {
		var request = URLRequest(url: try absoluteURL(action.href))
		request.httpMethod = action.method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		request.httpBody = body
		let (data, http) = try await send(request)
		guard (200...299).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
	}

	// MARK: - Transport

	private func send(_ request: URLRequest, retryOn401: Bool = true) async throws -> (Data, HTTPURLResponse) {
		guard let token = store.tokens?.accessToken else { throw APIError.noToken }
		var authed = request
		authed.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
		authed.setValue(AppConfig.sirenMediaType, forHTTPHeaderField: "Accept")
		// Identifies this request as coming from the iOS app so the server records
		// onboarding completion per-user (Safari on the same phone can't see the
		// app's cookies, so it can't rely on the extension's cookie signals).
		authed.setValue(AppConfig.clientIos, forHTTPHeaderField: AppConfig.clientHeader)
		authed.setValue(AppConfig.saveContinuityBackground, forHTTPHeaderField: AppConfig.saveContinuityHeader)
		let (data, response) = try await session.data(for: authed)
		guard let http = response as? HTTPURLResponse else { throw APIError.decoding }
		if http.statusCode == 401 && retryOn401 {
			guard (try? await oauth.refresh()) != nil else { throw APIError.unauthorized }
			return try await send(request, retryOn401: false)
		}
		return (data, http)
	}

	private func jsonRequest(
		_ url: URL,
		method: String,
		contentType: String,
		body: [String: String]
	) -> URLRequest {
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)
		return request
	}

	private func formRequest(
		_ url: URL,
		method: String,
		contentType: String,
		fields: [String: String]
	) -> URLRequest {
		let queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
		// A GET carries no body — the field values are the query string, so encode
		// them onto the URL and send no Content-Type. POST/other methods form-encode
		// the same values into the body per the action's declared `type`.
		if method.uppercased() == "GET" {
			guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
				preconditionFailure("absoluteURL produced a URL that does not parse as components: \(url)")
			}
			components.queryItems = queryItems
			guard let queried = components.url else {
				preconditionFailure("query items did not produce a valid URL for: \(url)")
			}
			var request = URLRequest(url: queried)
			request.httpMethod = method
			return request
		}
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		var components = URLComponents()
		components.queryItems = queryItems
		request.httpBody = components.percentEncodedQuery.map { Data($0.utf8) }
		return request
	}

	/// Builds the request for a generic action invocation, keeping the body in step
	/// with the action's declared `type`: a GET carries the fields as query items
	/// (no body); an `application/json` action sends a JSON body; any other type
	/// form-encodes the body. The contract ties the encoding to the declared
	/// `type`, so a JSON action must not ship a form-encoded body under a JSON
	/// `Content-Type` header.
	private func invocationRequest(for action: SirenAction, fields: [String: String]) throws -> URLRequest {
		let url = try absoluteURL(action.href)
		let type = action.type ?? "application/x-www-form-urlencoded"
		if action.method.uppercased() != "GET", MediaType.matches(type, "application/json") {
			return jsonRequest(url, method: action.method, contentType: type, body: fields)
		}
		return formRequest(url, method: action.method, contentType: type, fields: fields)
	}

	/// Resolves a server-declared href to an absolute URL, throwing when the href
	/// is missing or names a scheme the client doesn't act on — an action the
	/// client can't follow is a decode-level failure, not a silent no-op.
	private func absoluteURL(_ href: String?) throws -> URL {
		guard let href, let url = Href.resolve(href, baseURL: baseURL) else { throw APIError.decoding }
		return url
	}

	/// Decodes a body the client negotiated as Siren, verifying the response's
	/// media type first. A 200/201 carrying anything but the negotiated Siren type
	/// (a proxy HTML page, a future media type) is surfaced as
	/// `.unsupportedMediaType` rather than blind-decoded into a decode failure.
	private func decodeSiren<T: Decodable>(_ type: T.Type, data: Data, response: HTTPURLResponse) throws -> T {
		let contentType = response.value(forHTTPHeaderField: "Content-Type")
		guard isSirenMediaType(contentType) else { throw APIError.unsupportedMediaType(contentType) }
		do {
			return try JSONDecoder().decode(type, from: data)
		} catch {
			// The surfaced error stays the opaque `.decoding`; the underlying
			// DecodingError (which key/type mismatched) is only ever for the logs.
			// Marked private: a value-mismatch context can quote response bytes.
			Self.logger.error("Siren decode failed: \(String(describing: error), privacy: .private)")
			throw APIError.decoding
		}
	}

	/// Whether a `Content-Type` header is the negotiated Siren media type, ignoring
	/// any `;charset=…` parameters and surrounding case.
	private func isSirenMediaType(_ header: String?) -> Bool {
		MediaType.matches(header, AppConfig.sirenMediaType)
	}


	private func apiError(from data: Data, status: Int) -> APIError {
		if status == 401 { return .unauthorized }
		if let refusal = refusalError(from: data) { return refusal }
		if let sirenError = try? JSONDecoder().decode(SirenError.self, from: data) {
			return .server(status: status, code: sirenError.properties.code, message: sirenError.properties.message)
		}
		return .server(status: status, code: nil, message: nil)
	}

	/// Decodes a message-only refusal (e.g. a locked account), or nil when the
	/// body isn't one. Detected before the generic server error (and before the
	/// save-content fallback) so the refusal surfaces as `.refused` rather than a
	/// generic save failure. The refusal carries no action — nothing to follow.
	///
	/// Messages whose media type the client can't render are dropped (be liberal
	/// in what you accept, conservative in what you render); a refusal left with no
	/// renderable message is treated as not-a-refusal so it never shows blank.
	private func refusalError(from data: Data) -> APIError? {
		guard let sirenError = try? JSONDecoder().decode(SirenError.self, from: data),
			let messages = sirenError.properties.messages
		else { return nil }
		let renderable = messages.filter(\.isRenderable)
		guard !renderable.isEmpty else { return nil }
		return .refused(messages: renderable)
	}
}

private final class RedirectHeaderPreservingDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		completionHandler(RedirectHeaders.preserving(from: task.originalRequest, onto: request))
	}
}
