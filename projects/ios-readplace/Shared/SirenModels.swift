import Foundation

// MARK: - Wire format (Siren)

/// A hypermedia link. `href` is optional: a link advertised without one is kept
/// but unactionable — the client follows only the hrefs it is given — so a
/// partial or evolving link never fails the surrounding decode.
struct SirenLink: Decodable {
	let rel: [String]
	let href: String?
}

/// One field of an action. `value` is the server's pre-filled default, when
/// present; the field `name` is part of the protocol vocabulary the client keys
/// on (e.g. `status`).
struct SirenField: Decodable {
	let name: String
	let type: String?
	let value: String?
}

/// A Siren action: the server declares its href, method, type and fields and the
/// client follows them rather than constructing a request. `href` is optional so
/// an action advertised without one decodes and is simply treated as
/// unactionable.
struct SirenAction: Decodable {
	let name: String
	let href: String?
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

struct SirenEntity: Decodable {
	let `class`: [String]?
	let rel: [String]?
	let properties: ArticleProperties?
	let links: [SirenLink]?
	let actions: [SirenAction]?
}

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

struct SirenCollection: Decodable {
	let `class`: [String]?
	let properties: CollectionProperties?
	let entities: [SirenEntity]?
	let links: [SirenLink]?
	let actions: [SirenAction]?
}

/// A server-authored message a client renders generically — it carries no
/// feature-specific code or action. `type` selects presentation (mapped to
/// `kind`); `content` is a small HTML fragment. Mirrors the browser extension's
/// `Message` and the server's `SirenMessage` — a stable contract shared across
/// the clients.
struct ServerMessage: Decodable, Equatable {
	struct Content: Decodable, Equatable {
		let type: String
		let body: String
	}
	let type: String
	let content: Content
}

extension ServerMessage {
	/// How a client should present a message. The wire `type` stays a `String` so
	/// an unknown future value still decodes; `kind` maps it for the UI and treats
	/// any unrecognized value as `.warning` (the neutral default) — mirroring the
	/// server's current `"warning" | "error"` union without hard-failing on a value
	/// a newer server might add.
	enum Kind {
		case warning
		case error
	}

	/// The presentation bucket for this message, derived from the wire `type`.
	var kind: Kind {
		switch type {
		case "error": return .error
		default: return .warning
		}
	}

	/// The one content media type the clients know how to render. A message with
	/// any other `content.type` is ignored — never shown — so the server can adopt
	/// a richer media type without older clients mis-rendering an unknown body.
	static let renderableMediaType = "text/html"

	/// Whether this client can render the message. `false` for a media type the
	/// client doesn't understand, in which case the message is dropped rather than
	/// surfaced as text (see `ReadplaceAPI.refusalError`).
	var isRenderable: Bool { content.type == Self.renderableMediaType }

	/// The message body as plain text. `content` is a small server-authored HTML
	/// fragment (`text/html` — the only media type surfaced; see `isRenderable`);
	/// iOS shows it as text — the visible text still names any address to email.
	/// Stripping the markup here keeps the HTML text importer (and its memory
	/// cost) out of the share extension.
	var plainText: String {
		Self.decodingHTMLEntities(
			content.body.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
		).trimmingCharacters(in: .whitespacesAndNewlines)
	}

	/// The named character references the server's escaped messages use. Numeric
	/// references (`&#39;`, `&#x27;`) are resolved separately in `decodeReference`.
	private static let namedReferences: [Substring: Character] = [
		"amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
	]

	/// Decodes HTML character references in a single left-to-right pass, so a
	/// correctly-escaped `&amp;lt;` resolves once to the text `&lt;` rather than
	/// twice to `<`. A chained `replacingOccurrences` would decode `&amp;` first
	/// and then re-interpret the `&lt;` it just produced. A bare `&`, an
	/// unterminated reference, or an unknown name is left verbatim.
	private static func decodingHTMLEntities(_ input: String) -> String {
		guard input.contains("&") else { return input }
		var output = ""
		output.reserveCapacity(input.count)
		var cursor = input.startIndex
		while cursor < input.endIndex {
			let character = input[cursor]
			guard character == "&",
				let semicolon = input[cursor...].firstIndex(of: ";"),
				let decoded = decodeReference(input[input.index(after: cursor)..<semicolon])
			else {
				output.append(character)
				cursor = input.index(after: cursor)
				continue
			}
			output.append(decoded)
			cursor = input.index(after: semicolon)
		}
		return output
	}

	/// Resolves the inside of a single `&…;` reference — a known name (`amp`) or a
	/// `#`-prefixed decimal/hex code point — or nil when it is neither.
	private static func decodeReference(_ body: Substring) -> Character? {
		if let named = namedReferences[body] { return named }
		guard body.first == "#" else { return nil }
		let digits = body.dropFirst()
		let isHex = digits.first == "x" || digits.first == "X"
		guard let value = UInt32(isHex ? digits.dropFirst() : digits, radix: isHex ? 16 : 10),
			let scalar = Unicode.Scalar(value)
		else { return nil }
		return Character(scalar)
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

/// A reading status the client can set. The raw value is sent as the `status`
/// field of the server-declared status action.
enum ArticleStatus: String {
	case unread
	case read
}

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
	/// The server-declared action for changing this item's reading status, stored
	/// whole so its href/method/fields are followed rather than hand-built. Absent
	/// or href-less ⇒ the item is read-only (see `canMarkRead`).
	let updateStatusAction: SirenAction?
	/// The href of the server-declared link for reading this item. Absent ⇒ the
	/// row is not openable.
	let readHref: String?

	static func == (lhs: Article, rhs: Article) -> Bool { lhs.id == rhs.id }
	func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

extension Article {
	/// Whether the server left a usable status-change action on this item. A
	/// missing action — or one advertised without an href — is unactionable, so
	/// the row offers no mark-read affordance.
	var canMarkRead: Bool { updateStatusAction?.href != nil }

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
		updateStatusAction = entity.actions?.first { $0.name == "update-status" }
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

/// Resolves a server-declared href to an absolute URL the client can act on, or
/// nil when the href is unactionable. The client speaks two schemes — the web
/// origin (`http`/`https`) and its own deep-link scheme — and resolves a
/// scheme-less href against the server origin. A href carrying any other scheme
/// is a protocol the client doesn't understand, so it is treated as absent (the
/// element is read-only). One rule in one place keeps every caller — the API
/// client and the reader — resolving hrefs identically.
enum Href {
	static func resolve(_ href: String, baseURL: String) -> URL? {
		guard let parsed = URL(string: href) else { return nil }
		guard let scheme = parsed.scheme?.lowercased() else {
			let path = href.hasPrefix("/") ? href : "/\(href)"
			return URL(string: "\(baseURL)\(path)")
		}
		switch scheme {
		case "http", "https", AppConfig.callbackURLScheme:
			return parsed
		default:
			return nil
		}
	}
}
