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
struct QueuePage {
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

	init(collection: SirenCollection) {
		articles = (collection.entities ?? []).compactMap(Article.init(entity:))
		let links = collection.links ?? []
		nextHref = links.first { $0.rel.contains("next") }?.href
		let actionAffordances = (collection.actions ?? []).compactMap(Affordance.init(action:))
		let linkAffordances = links.compactMap(Affordance.init(link:))
		affordances = actionAffordances + linkAffordances
		warning = collection.properties?.warning
	}

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
	/// an origin-side limit, whereas the share extension holds the fetched bytes
	/// plus a duplicated multipart body in a tight memory budget. `fetchExternalContent`
	/// streams the body and stops the moment the running total crosses this ceiling
	/// (refusing outright when the response announces an oversize length), so an
	/// oversize resource degrades to a URL-only save without ever being buffered whole.
	private let maxExternalContentBytes: Int

	static let defaultMaxExternalContentBytes = 25 * 1024 * 1024

	// Defaults to an ephemeral configuration so the session's cookie jar is its
	// own isolated, in-memory store rather than process-wide `HTTPCookieStorage.shared`:
	// the `hutch_sid` cookie minted by `bootstrapSession` must not linger in the
	// shared jar where it would outlive the session and leak across sign-outs.
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
	func loadQueue(path: String? = nil) async throws -> QueuePage {
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
		return QueuePage(collection: try decodeSiren(SirenCollection.self, data: data, response: http))
	}

	/// Invokes a simple entity action via its own server-declared href, method and
	/// type — the single generic path for actions whose body is a flat field set
	/// (e.g. `update-status`, `delete`), so a newly-advertised entity action is
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
	func invoke(action: SirenAction, values: [String: String] = [:]) async throws -> QueuePage? {
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
	private func postActionCollection(data: Data, response: HTTPURLResponse) -> QueuePage? {
		guard isSirenMediaType(response.value(forHTTPHeaderField: "Content-Type")),
			let collection = try? JSONDecoder().decode(SirenCollection.self, from: data),
			(collection.`class` ?? []).contains("collection")
		else { return nil }
		return QueuePage(collection: collection)
	}

	// MARK: - Reader session

	/// Mints a browser session cookie from the current bearer token via the
	/// session-bootstrap endpoint and returns it. The in-app reader injects the
	/// cookie so the cookie-authenticated reader page (and its in-reader XHRs)
	/// load without bouncing to a sign-in page. Reuses `send()`, so a stale bearer
	/// is refreshed once before the cookie is minted.
	func bootstrapSession() async throws -> HTTPCookie {
		guard let url = URL(string: "\(baseURL)/auth/session") else { throw APIError.decoding }
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		let (data, http) = try await send(request)
		guard (200...299).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
		guard let cookie = sessionCookie(from: http, url: url) else { throw APIError.decoding }
		return cookie
	}

	/// Reads the session cookie by name from the session's own cookie jar, which
	/// the configuration isolates (an ephemeral store, not `HTTPCookieStorage.shared`)
	/// so the cookie URLSession just parsed never touches the process-wide jar.
	/// The cookie spec forbids folding repeated `Set-Cookie` headers into one
	/// comma-joined value, so re-splitting `allHeaderFields` is unsafe once a
	/// response sets more than one cookie; reading the already-parsed cookie back
	/// by name sidesteps that. Falls back to the response's own `Set-Cookie`
	/// header (reliable for a single cookie) for environments that don't populate
	/// the store.
	private func sessionCookie(from response: HTTPURLResponse, url: URL) -> HTTPCookie? {
		if let stored = session.configuration.httpCookieStorage?
			.cookies(for: url)?
			.first(where: { $0.name == AppConfig.sessionCookieName }) {
			return stored
		}
		guard let headers = response.allHeaderFields as? [String: String] else { return nil }
		return HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
			.first { $0.name == AppConfig.sessionCookieName }
	}

	// MARK: - Saving

	/// The article a save produced, plus whether the captured content reached the
	/// server or the request fell back to the URL-only path the server advertised.
	struct SaveResult {
		let article: Article
		let usedFallback: Bool
	}

	/// Saves a page using its captured bytes via the supplied `save-content`
	/// action: a multipart upload carrying the absolute URL, the media type
	/// (`text/html` or `application/pdf`), the optional title and the raw content
	/// as a file part. On an error body that carries a fallback action (the
	/// server's chosen URL-only path, e.g. when the payload exceeds the server's
	/// cap), it follows that action — dropping the content — exactly like the
	/// extension client does. The client never decides itself whether the content
	/// is acceptable; it attempts the save and follows the server's refusal.
	func saveContent(
		action: SirenAction,
		url: String,
		content: Data,
		mediaType: String,
		title: String?
	) async throws -> SaveResult {
		let request = multipartRequest(try absoluteURL(action.href), method: action.method,
			submittedURL: url, content: content, mediaType: mediaType, title: title)
		let (data, http) = try await send(request)
		if http.statusCode == 201 || http.statusCode == 200 {
			return SaveResult(article: try decodeArticle(data, response: http), usedFallback: false)
		}
		// The server may refuse with messages for the client to render (e.g. a
		// locked account). Surface them as .refused before the fallback below, so
		// a message-only refusal is never mistaken for a fallback action.
		if let refusal = refusalError(from: data) { throw refusal }
		if let sirenError = try? JSONDecoder().decode(SirenError.self, from: data),
			let fallback = sirenError.actions?.first {
			var fallbackBody: [String: String] = ["url": url]
			if let title, !title.isEmpty { fallbackBody["title"] = title }
			let fallbackRequest = jsonRequest(try absoluteURL(fallback.href), method: fallback.method,
				contentType: fallback.type ?? "application/json", body: fallbackBody)
			let (fbData, fbHTTP) = try await send(fallbackRequest)
			guard fbHTTP.statusCode == 201 || fbHTTP.statusCode == 200 else {
				throw apiError(from: fbData, status: fbHTTP.statusCode)
			}
			return SaveResult(article: try decodeArticle(fbData, response: fbHTTP), usedFallback: true)
		}
		throw apiError(from: data, status: http.statusCode)
	}

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

	/// Builds a `multipart/form-data` request with a UUID boundary for
	/// `save-content`: the `url`, `mediaType` and (when non-empty) `title` text
	/// parts, then a `content` file part whose `filename` attribute is what the
	/// server keys `isFile` off — its per-part Content-Type is ignored.
	private func multipartRequest(
		_ url: URL,
		method: String,
		submittedURL: String,
		content: Data,
		mediaType: String,
		title: String?
	) -> URLRequest {
		let boundary = UUID().uuidString
		var body = Data()
		body.append("--\(boundary)\r\n")
		body.append("Content-Disposition: form-data; name=\"url\"\r\n\r\n")
		body.append("\(submittedURL)\r\n")
		body.append("--\(boundary)\r\n")
		body.append("Content-Disposition: form-data; name=\"mediaType\"\r\n\r\n")
		body.append("\(mediaType)\r\n")
		if let title, !title.isEmpty {
			body.append("--\(boundary)\r\n")
			body.append("Content-Disposition: form-data; name=\"title\"\r\n\r\n")
			body.append("\(title)\r\n")
		}
		body.append("--\(boundary)\r\n")
		body.append("Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n")
		body.append(content)
		body.append("\r\n")
		body.append("--\(boundary)--\r\n")

		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
		request.httpBody = body
		return request
	}

	/// Saves a URL only (no captured HTML) via the `save-article` action.
	func saveArticle(action: SirenAction, url: String) async throws -> Article {
		var request = jsonRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/json", body: ["url": url])
		request.setValue("return=representation", forHTTPHeaderField: "Prefer")
		let (data, http) = try await send(request)
		guard http.statusCode == 201 || http.statusCode == 200 else {
			throw apiError(from: data, status: http.statusCode)
		}
		return try decodeArticle(data, response: http)
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
		authed.setValue("ios", forHTTPHeaderField: "X-Readplace-Client")
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
		if action.method.uppercased() != "GET", mediaTypeEssence(type) == "application/json" {
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
		mediaTypeEssence(header) == AppConfig.sirenMediaType
	}

	/// The lowercased media type without parameters — `application/json; charset=utf-8`
	/// → `application/json` — or nil when the header is absent. One parser keeps the
	/// Siren-type check and the JSON-body routing comparing the same essence.
	private func mediaTypeEssence(_ header: String?) -> String? {
		guard let header else { return nil }
		return header.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
	}

	private func decodeArticle(_ data: Data, response: HTTPURLResponse) throws -> Article {
		let entity = try decodeSiren(SirenEntity.self, data: data, response: response)
		guard let article = Article(entity: entity) else { throw APIError.decoding }
		return article
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

/// Re-attaches `Authorization`, `Accept` and `X-Readplace-Client` to redirected
/// requests. URLSession strips `Authorization` on cross-origin redirects and may
/// drop custom headers generally; the server bounces the client from the entry
/// point to the collection, so the followed redirect must keep them to stay
/// authenticated and keep negotiating Siren (the client header so onboarding
/// step 1 is recorded on the post-redirect `/queue` load).
private final class RedirectHeaderPreservingDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		var updated = request
		for header in ["Authorization", "Accept", "X-Readplace-Client"] {
			if let value = task.originalRequest?.value(forHTTPHeaderField: header) {
				updated.setValue(value, forHTTPHeaderField: header)
			}
		}
		completionHandler(updated)
	}
}

private extension Data {
	mutating func append(_ string: String) {
		append(Data(string.utf8))
	}
}
