import Foundation
import XCTest
@testable import Readplace

enum TestSupport {
	/// A throwaway, isolated UserDefaults suite for a single test.
	static func ephemeralDefaults() -> UserDefaults {
		let name = "test.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: name)!
		defaults.removePersistentDomain(forName: name)
		return defaults
	}

	/// A URLSession configuration routed through the stub protocol.
	static func stubbedConfiguration() -> URLSessionConfiguration {
		let config = URLSessionConfiguration.ephemeral
		config.protocolClasses = [StubURLProtocol.self]
		return config
	}

	/// A token store pre-seeded with a logged-in session.
	static func loggedInStore(
		access: String = "access-1",
		refresh: String = "refresh-1"
	) -> TokenStore {
		let store = TokenStore(defaults: ephemeralDefaults())
		store.save(OAuthTokens(accessToken: access, refreshToken: refresh))
		return store
	}

	/// Parses an `application/x-www-form-urlencoded` body into a dictionary.
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

	/// Parses a JSON object body into `[String: Any]`.
	static func jsonObject(_ data: Data) -> [String: Any] {
		(try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
	}
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
		readAt: String? = nil
	) -> String {
		func field(_ key: String, _ value: String?) -> String {
			value.map { "\"\(key)\": \"\($0)\"" } ?? "\"\(key)\": null"
		}
		func numField(_ key: String, _ value: Int?) -> String {
			value.map { "\"\(key)\": \($0)" } ?? "\"\(key)\": null"
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
		    \(field("readAt", readAt))
		  },
		  "links": [{ "rel": ["read"], "href": "/queue/\(id)/view" }],
		  "actions": [
		    { "name": "delete", "href": "/queue/\(id)/delete", "method": "POST" },
		    { "name": "update-status", "href": "/queue/\(id)/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text" }] }
		  ]
		}
		"""
	}

	/// The collection-level actions a healthy `/queue` advertises (URL-only save,
	/// HTML save, search). Overridable so a test can model a server that offers
	/// neither save action.
	static let collectionActions = """
		{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] },
		{ "name": "save-html", "href": "/queue/save-html", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }, { "name": "rawHtml", "type": "text" }, { "name": "title", "type": "text" }] },
		{ "name": "search", "href": "/queue", "method": "GET" }
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
