import Foundation

// MARK: - Wire format (Siren)

/// A Siren link, e.g. `{ "rel": ["self"], "href": "/queue?page=2" }`.
struct SirenLink: Decodable {
	let rel: [String]
	let href: String
}

/// A declared form field on a Siren action, e.g. `{ "name": "url", "type": "url" }`.
struct SirenField: Decodable {
	let name: String
	let type: String?
}

/// A Siren action — the server tells us the href/method/fields; we never
/// hard-code them. e.g. `save-html` → `POST /queue/save-html`.
struct SirenAction: Decodable {
	let name: String
	let href: String
	let method: String
	let type: String?
	let fields: [SirenField]?
}

/// The properties of an article entity. Everything except `id`/`url` is
/// optional so a single malformed or evolving entity never fails the decode
/// of the whole collection.
struct ArticleProperties: Decodable {
	let id: String
	let url: String
	let title: String?
	let siteName: String?
	let excerpt: String?
	let wordCount: Int?
	let imageUrl: String?
	let estimatedReadTimeMinutes: Int?
	let status: String?
	let savedAt: String?
	let readAt: String?
}

/// A sub-entity inside a collection (one saved article).
struct SirenEntity: Decodable {
	let `class`: [String]?
	let rel: [String]?
	let properties: ArticleProperties?
	let links: [SirenLink]?
	let actions: [SirenAction]?
}

/// Collection-level properties (`/queue`).
struct CollectionProperties: Decodable {
	let total: Int?
	let page: Int?
	let pageSize: Int?
	let warning: SirenWarning?
}

/// A non-fatal reason the server attaches to a collection (e.g. a URL that
/// couldn't be saved).
struct SirenWarning: Decodable {
	let code: String
	let message: String
}

/// A Siren collection response (the queue).
struct SirenCollection: Decodable {
	let `class`: [String]?
	let properties: CollectionProperties?
	let entities: [SirenEntity]?
	let links: [SirenLink]?
	let actions: [SirenAction]?
}

/// A server-authored message a client renders generically — it carries no
/// feature-specific code or action. `type` selects presentation; `content` is a
/// small HTML fragment. Mirrors the browser extension's `Message` and the
/// server's `SirenMessage` — a stable contract shared across the clients.
struct ServerMessage: Decodable, Equatable {
	struct Content: Decodable, Equatable {
		let type: String
		let body: String
	}
	let type: String
	let content: Content
}

extension ServerMessage {
	/// The message body as plain text. `content` is a small server-authored HTML
	/// fragment; iOS surfaces it as text — the visible text still names any
	/// address to email. Stripping the markup here keeps the HTML text importer
	/// (and its memory cost) out of the share extension.
	var plainText: String {
		content.body
			.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
			.replacingOccurrences(of: "&amp;", with: "&")
			.replacingOccurrences(of: "&lt;", with: "<")
			.replacingOccurrences(of: "&gt;", with: ">")
			.replacingOccurrences(of: "&#39;", with: "'")
			.replacingOccurrences(of: "&quot;", with: "\"")
			.trimmingCharacters(in: .whitespacesAndNewlines)
	}
}

/// The properties block on a Siren error body. A `code` + `message` describes a
/// conventional error; `messages` carries server-authored content the client
/// renders generically (e.g. a locked-account refusal). All optional so either
/// shape decodes and an evolving field never fails the whole decode.
struct SirenErrorProperties: Decodable {
	let code: String?
	let message: String?
	let messages: [ServerMessage]?
}

/// A Siren error response. May carry a fallback `action` (e.g. the URL-only
/// `save-article` path when an HTML payload is too large).
struct SirenError: Decodable {
	let properties: SirenErrorProperties
	let actions: [SirenAction]?
}

// MARK: - Domain model for the UI

/// A saved article, flattened from a Siren entity for display and actions.
struct Article: Identifiable, Hashable {
	let id: String
	let url: String
	let title: String
	let siteName: String?
	let excerpt: String?
	let imageURL: URL?
	let readTimeMinutes: Int?
	let isRead: Bool
	let savedAt: Date?
	/// Server-declared action href for deleting this item (`/queue/{id}/delete`).
	let deleteHref: String?
	/// Server-declared link for reading this item (`/queue/{id}/view`).
	let readHref: String?

	static func == (lhs: Article, rhs: Article) -> Bool { lhs.id == rhs.id }
	func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

extension Article {
	/// Builds a display model from a Siren entity, or returns nil when the
	/// entity has no usable properties.
	init?(entity: SirenEntity) {
		guard let props = entity.properties else { return nil }
		id = props.id
		url = props.url
		if let provided = props.title, !provided.isEmpty {
			title = provided
		} else {
			title = props.url
		}
		siteName = props.siteName
		excerpt = props.excerpt
		imageURL = props.imageUrl.flatMap(URL.init(string:))
		readTimeMinutes = props.estimatedReadTimeMinutes
		isRead = props.status == "read" || props.readAt != nil
		savedAt = props.savedAt.flatMap(SirenDate.parse)
		deleteHref = entity.actions?.first { $0.name == "delete" }?.href
		readHref = entity.links?.first { $0.rel.contains("read") }?.href
	}
}

/// Parses the server's ISO-8601 timestamps (with or without fractional seconds).
enum SirenDate {
	private static let withFraction: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return f
	}()
	private static let plain = ISO8601DateFormatter()

	static func parse(_ string: String) -> Date? {
		withFraction.date(from: string) ?? plain.date(from: string)
	}
}
