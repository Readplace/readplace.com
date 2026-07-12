import Foundation
import Security
import XCTest
@testable import Readplace

/// A `TokenStorage` whose reads fail with a chosen Keychain `OSStatus` for the
/// selected keys — the device condition (an unreadable shared Keychain) the
/// Simulator cannot reproduce. Non-failing keys read back from `values`.
struct FailingTokenStorage: TokenStorage {
	var values: [TokenKey: String] = [:]
	var failing: Set<TokenKey>
	var status: OSStatus = errSecMissingEntitlement

	func readValue(for key: TokenKey) -> Result<String?, KeychainError> {
		failing.contains(key) ? .failure(.read(status: status)) : .success(values[key])
	}
	func setValue(_ value: String, for key: TokenKey) {}
	func removeValue(for key: TokenKey) {}
}

enum TestSupport {
	static func ephemeralDefaults() -> UserDefaults {
		let name = "test.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: name)!
		defaults.removePersistentDomain(forName: name)
		return defaults
	}

	static func stubbedConfiguration() -> URLSessionConfiguration {
		let config = URLSessionConfiguration.ephemeral
		config.protocolClasses = [StubURLProtocol.self]
		return config
	}

	/// A session cookie scoped to the server host, for seeding a cookie jar before
	/// asserting sign-out clears it. The name is arbitrary — the client no longer
	/// selects the session cookie by name — so this uses a representative literal.
	static func sessionCookie(value: String, name: String = "hutch_sid") -> HTTPCookie {
		HTTPCookie(properties: [
			.name: name,
			.value: value,
			.domain: URL(string: AppConfig.serverBaseURL)!.host!,
			.path: "/",
		])!
	}

	static func loggedInStore(
		access: String = "access-1",
		refresh: String = "refresh-1"
	) -> TokenStore {
		let store = TokenStore(defaults: ephemeralDefaults())
		store.save(OAuthTokens(accessToken: access, refreshToken: refresh))
		return store
	}

	static func formFields(_ data: Data) -> [String: String] {
		guard let string = String(data: data, encoding: .utf8) else { return [:] }
		var result: [String: String] = [:]
		for pair in string.split(separator: "&") {
			let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
			guard parts.count == 2 else { continue }
			result[parts[0].removingPercentEncoding ?? parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
		}
		return result
	}

	static func jsonObject(_ data: Data) -> [String: Any] {
		(try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
	}

	/// Parses a `multipart/form-data` body into its parts — a Swift port of the
	/// server's `extractAllParts`, so a test asserts the exact wire bytes the
	/// server will parse rather than a client-side re-serialisation.
	static func multipartParts(contentType: String?, body: Data) -> [MultipartPart] {
		guard let contentType, let boundary = multipartBoundary(contentType) else { return [] }
		let bytes = [UInt8](body)
		let dash = [UInt8]("--\(boundary)".utf8)
		let headerSep = [UInt8]("\r\n\r\n".utf8)
		var parts: [MultipartPart] = []
		guard var cursor = findBytes(dash, in: bytes, from: 0) else { return parts }
		while cursor < bytes.count {
			cursor += dash.count
			// Either "--" (end of message) or CRLF (another part follows).
			if cursor + 1 < bytes.count, bytes[cursor] == 0x2d, bytes[cursor + 1] == 0x2d { return parts }
			guard cursor + 1 < bytes.count, bytes[cursor] == 0x0d, bytes[cursor + 1] == 0x0a else { return parts }
			cursor += 2
			guard let headerEnd = findBytes(headerSep, in: bytes, from: cursor) else { return parts }
			let headers = String(decoding: bytes[cursor..<headerEnd], as: UTF8.self)
			let bodyStart = headerEnd + headerSep.count
			guard let nextBoundary = findBytes(dash, in: bytes, from: bodyStart) else { return parts }
			let bodyEnd = nextBoundary - 2 // strip the CRLF that precedes the boundary line
			parts.append(MultipartPart(
				name: multipartHeaderValue(#"name="([^"]*)""#, in: headers),
				filename: multipartHeaderValue(#"filename="([^"]*)""#, in: headers),
				contentType: multipartHeaderValue(#"(?i)content-type:\s*([^\r\n]+)"#, in: headers),
				body: Data(bytes[bodyStart..<bodyEnd])
			))
			cursor = nextBoundary
		}
		return parts
	}

	private static func multipartBoundary(_ contentType: String) -> String? {
		guard let range = contentType.range(of: "boundary=") else { return nil }
		var value = String(contentType[range.upperBound...])
		if let semicolon = value.firstIndex(of: ";") { value = String(value[..<semicolon]) }
		value = value.trimmingCharacters(in: .whitespaces)
			.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
		return value.isEmpty ? nil : value
	}

	private static func findBytes(_ needle: [UInt8], in haystack: [UInt8], from start: Int) -> Int? {
		guard !needle.isEmpty, haystack.count >= needle.count else { return nil }
		var i = start
		while i <= haystack.count - needle.count {
			if Array(haystack[i..<(i + needle.count)]) == needle { return i }
			i += 1
		}
		return nil
	}

	private static func multipartHeaderValue(_ pattern: String, in headers: String) -> String? {
		guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
		let range = NSRange(headers.startIndex..., in: headers)
		guard let match = regex.firstMatch(in: headers, range: range),
			match.numberOfRanges > 1,
			let captureRange = Range(match.range(at: 1), in: headers)
		else { return nil }
		return String(headers[captureRange])
	}
}

struct MultipartPart {
	let name: String?
	let filename: String?
	let contentType: String?
	let body: Data
	var text: String? { String(data: body, encoding: .utf8) }
}

// MARK: - Siren JSON fixtures

enum Fixtures {
	static func article(
		id: String = "a1",
		url: String = "https://example.com/post",
		title: String? = "A Title",
		siteName: String? = "Example",
		excerpt: String? = "An excerpt.",
		imageUrl: String? = "https://example.com/img.png",
		wordCount: Int? = 1200,
		readTime: Int? = 6,
		status: String = "unread",
		savedAt: String = "2026-05-30T10:00:00.000Z",
		readAt: String? = nil,
		isRead: Bool? = nil
	) -> String {
		func field(_ key: String, _ value: String?) -> String {
			value.map { "\"\(key)\": \"\($0)\"" } ?? "\"\(key)\": null"
		}
		func numField(_ key: String, _ value: Int?) -> String {
			value.map { "\"\(key)\": \($0)" } ?? "\"\(key)\": null"
		}
		// Emitted only when set, so a fixture without it models an older server that
		// doesn't advertise the explicit read-state.
		func boolField(_ key: String, _ value: Bool?) -> String {
			value.map { ", \"\(key)\": \($0)" } ?? ""
		}
		return """
		{
		  "class": ["article"],
		  "rel": ["item"],
		  "properties": {
		    "id": "\(id)",
		    "url": "\(url)",
		    \(field("title", title)),
		    \(field("siteName", siteName)),
		    \(field("excerpt", excerpt)),
		    \(numField("wordCount", wordCount)),
		    \(field("imageUrl", imageUrl)),
		    \(numField("estimatedReadTimeMinutes", readTime)),
		    "status": "\(status)",
		    "savedAt": "\(savedAt)",
		    \(field("readAt", readAt))\(boolField("isRead", isRead))
		  },
		  "links": [{ "rel": ["read"], "href": "/queue/\(id)/view" }],
		  "actions": [
		    { "name": "delete", "href": "/queue/\(id)/delete", "method": "POST" },
		    { "name": "update-status", "href": "/queue/\(id)/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text", "value": "read" }] }
		  ]
		}
		"""
	}

	/// The collection-level actions a healthy `/queue` advertises (URL-only save,
	/// HTML save, file save, search), each carrying the server's `title` label.
	/// Overridable so a test can model a
	/// server that offers a different action set.
	static let collectionActions = """
		{ "name": "save-article", "title": "Save a link", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] },
		{ "name": "save-html", "title": "Save a page", "href": "/queue/save-html", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }, { "name": "rawHtml", "type": "text" }, { "name": "title", "type": "text" }] },
		{ "name": "save-content", "title": "Save a file", "href": "/queue/save-content", "method": "POST", "type": "multipart/form-data", "fields": [{ "name": "url", "type": "url" }, { "name": "content", "type": "file" }, { "name": "mediaType", "type": "text" }, { "name": "title", "type": "text" }] },
		{ "name": "search", "title": "Search", "href": "/queue", "method": "GET", "fields": [{ "name": "status", "type": "text" }, { "name": "order", "type": "text" }, { "name": "page", "type": "number" }, { "name": "pageSize", "type": "number" }, { "name": "url", "type": "url" }] }
		"""

	static func collection(
		entitiesJSON: [String],
		extraLinks: String = "",
		page: Int = 1,
		total: Int = 1,
		actionsJSON: String = collectionActions
	) -> String {
		"""
		{
		  "class": ["collection", "articles"],
		  "properties": { "total": \(total), "page": \(page), "pageSize": 20 },
		  "entities": [\(entitiesJSON.joined(separator: ",\n"))],
		  "links": [
		    { "rel": ["self"], "href": "/queue?page=\(page)" },
		    { "rel": ["root"], "href": "/queue" }\(extraLinks)
		  ],
		  "actions": [\(actionsJSON)]
		}
		"""
	}

	static func tokenResponse(access: String, refresh: String?) -> String {
		let refreshLine = refresh.map { "\"refresh_token\": \"\($0)\"," } ?? ""
		return """
		{ "access_token": "\(access)", \(refreshLine) "token_type": "Bearer", "expires_in": 3600 }
		"""
	}

	static func sirenError(code: String, message: String, withSaveArticleFallback: Bool) -> String {
		let actions = withSaveArticleFallback
			? """
			, "actions": [{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }]
			"""
			: ""
		return """
		{ "class": ["error"], "properties": { "code": "\(code)", "message": "\(message)" }\(actions) }
		"""
	}

	/// The refusal the server returns on a write it won't allow (e.g. a locked
	/// account): server-authored messages for the client to render, and
	/// deliberately no code and no action. Single-quoted HTML keeps the fixture
	/// valid JSON.
	static func accountLockedError(
		message: String = "Your account is locked because your email was never verified. Email <a href='mailto:readplace+verification@readplace.com'>readplace+verification@readplace.com</a> to restore access."
	) -> String {
		"""
		{ "class": ["error"], "properties": { "messages": [{ "type": "warning", "content": { "type": "text/html", "body": "\(message)" } }] } }
		"""
	}

	/// A message-only refusal carrying arbitrary messages — lets a test model a
	/// media type the client doesn't understand. Each tuple is (type, mediaType, body).
	static func messageRefusal(_ messages: [(type: String, mediaType: String, body: String)]) -> String {
		let items = messages.map { m in
			"{ \"type\": \"\(m.type)\", \"content\": { \"type\": \"\(m.mediaType)\", \"body\": \"\(m.body)\" } }"
		}.joined(separator: ", ")
		return """
		{ "class": ["error"], "properties": { "messages": [\(items)] } }
		"""
	}
}
