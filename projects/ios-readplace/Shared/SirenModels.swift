import Foundation

// MARK: - Lenient decoding

/// Decodes a single value, capturing `nil` instead of throwing when the value is
/// malformed. Used to decode arrays element-by-element so one bad element is
/// dropped rather than failing the whole array.
private struct FailableDecodable<Wrapped: Decodable>: Decodable {
	let wrapped: Wrapped?

	init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		wrapped = try? container.decode(Wrapped.self)
	}
}

private extension KeyedDecodingContainer {
	/// Decodes the array under `key` leniently: a missing, null, or non-array value
	/// yields `nil`, and each element is decoded independently so a single malformed
	/// element is dropped rather than failing the whole array. The Siren contract
	/// requires one malformed link/action/entity to degrade to unactionable, never
	/// blank the whole response.
	func decodeLossyArrayIfPresent<Element: Decodable>(
		_ type: Element.Type,
		forKey key: Key
	) throws -> [Element]? {
		guard var unkeyed = try? nestedUnkeyedContainer(forKey: key) else { return nil }
		var elements: [Element] = []
		while !unkeyed.isAtEnd {
			let element = try unkeyed.decode(FailableDecodable<Element>.self)
			if let value = element.wrapped { elements.append(value) }
		}
		return elements
	}
}

// MARK: - Wire format (Siren)

/// A hypermedia link. `href` is optional: a link advertised without one is kept
/// but unactionable — the client follows only the hrefs it is given — so a
/// partial or evolving link never fails the surrounding decode. `title` is the
/// server's human label for the link, which the client uses verbatim as the
/// control's label and accessibility text.
struct SirenLink: Decodable {
	let rel: [String]
	let href: String?
	let title: String?
}

/// One field of an action. `value` is the server's pre-filled default, when
/// present; the field `name` is part of the protocol vocabulary the client keys
/// on (e.g. `status`). The value is always carried as a string because the generic
/// invoker posts it form-/JSON-encoded, but the server may declare it as a JSON
/// number (e.g. a numeric `page` or `limit`); such a value is coerced to its string
/// form on decode so it isn't dropped.
struct SirenField: Decodable {
	let name: String
	let type: String?
	let value: String?

	init(name: String, type: String?, value: String?) {
		self.name = name
		self.type = type
		self.value = value
	}

	private enum CodingKeys: String, CodingKey { case name, type, value }

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		name = try container.decode(String.self, forKey: .name)
		type = try container.decodeIfPresent(String.self, forKey: .type)
		if let string = try? container.decodeIfPresent(String.self, forKey: .value) {
			value = string
		} else if let number = try? container.decodeIfPresent(Double.self, forKey: .value) {
			// A whole number decodes as a Double, so render it without a trailing
			// ".0" — the server's "page": 2 must post as "2", not "2.0".
			value = number == number.rounded() ? String(Int(number)) : String(number)
		} else {
			value = nil
		}
	}
}

/// A Siren action: the server declares its href, method, type and fields and the
/// client follows them rather than constructing a request. `href` is optional so
/// an action advertised without one decodes and is simply treated as
/// unactionable. `method` is optional on the wire — a method-less action defaults
/// to `GET` (the Siren default) rather than failing the decode. `title` is the
/// server's human label, which the client uses verbatim as the control's label
/// and accessibility text.
struct SirenAction: Decodable {
	let name: String
	let href: String?
	let method: String
	let title: String?
	let type: String?
	let fields: [SirenField]?
}

extension SirenAction {
	private enum CodingKeys: String, CodingKey {
		case name, href, method, title, type, fields
	}

	/// Decoded leniently so an evolving action degrades rather than blanking the
	/// surrounding collection: `method` defaults to `GET` (the Siren default) when
	/// omitted, and a malformed field is dropped rather than failing the action.
	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		name = try container.decode(String.self, forKey: .name)
		href = try container.decodeIfPresent(String.self, forKey: .href)
		method = try container.decodeIfPresent(String.self, forKey: .method) ?? "GET"
		title = try container.decodeIfPresent(String.self, forKey: .title)
		type = try container.decodeIfPresent(String.self, forKey: .type)
		fields = try container.decodeLossyArrayIfPresent(SirenField.self, forKey: .fields)
	}
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

extension SirenEntity {
	private enum CodingKeys: String, CodingKey {
		case `class`, rel, properties, links, actions
	}

	/// Decodes the control arrays leniently so one malformed link or action drops
	/// to unactionable instead of failing the whole entity (and, in turn, the
	/// collection that contains it).
	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		`class` = try container.decodeIfPresent([String].self, forKey: .class)
		rel = try container.decodeIfPresent([String].self, forKey: .rel)
		properties = try container.decodeIfPresent(ArticleProperties.self, forKey: .properties)
		links = try container.decodeLossyArrayIfPresent(SirenLink.self, forKey: .links)
		actions = try container.decodeLossyArrayIfPresent(SirenAction.self, forKey: .actions)
	}
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

extension SirenCollection {
	private enum CodingKeys: String, CodingKey {
		case `class`, properties, entities, links, actions
	}

	/// Decodes the entity and control arrays leniently so a single malformed
	/// entity, link, or action is dropped rather than blanking the whole page —
	/// the page now loops every advertised control, so atomic decoding would let
	/// one bad element take down the entire collection.
	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		`class` = try container.decodeIfPresent([String].self, forKey: .class)
		properties = try container.decodeIfPresent(CollectionProperties.self, forKey: .properties)
		entities = try container.decodeLossyArrayIfPresent(SirenEntity.self, forKey: .entities)
		links = try container.decodeLossyArrayIfPresent(SirenLink.self, forKey: .links)
		actions = try container.decodeLossyArrayIfPresent(SirenAction.self, forKey: .actions)
	}
}

/// A server-authored message a client renders generically — it carries no
/// feature-specific code or action. `type` selects presentation (mapped to
/// `kind`); `content` is a small HTML fragment. This is a stable contract shared
	/// across the clients.
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
	/// references (`&#39;`, `&#x27;`) are resolved separately.
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
	/// Every action the server advertised on this item (e.g. `update-status`,
	/// `delete`), in the order the server listed them. The row renders one control
	/// per actionable entry by iterating this — it never cherry-picks an action by
	/// name — so a newly-advertised item action renders with no client change.
	let actions: [SirenAction]
	/// The href of the server-declared link for reading this item, followed when
	/// the row is tapped. Absent ⇒ the row is not openable. This follows the
	/// navigable `read` link (the row's primary tap target), distinct from the
	/// action controls iterated above.
	let readHref: String?

	static func == (lhs: Article, rhs: Article) -> Bool { lhs.id == rhs.id }
	func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

extension Article {
	/// The item's action controls, one per advertised action the client can
	/// invoke (an action with a usable href). Built by iterating — not by matching
	/// a known name — so the loop renders whatever the server offered.
	var affordances: [Affordance] { actions.compactMap(Affordance.init(action:)) }

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
		actions = entity.actions ?? []
		readHref = entity.links?.first { $0.rel.contains("read") }?.href
	}
}

/// One advertised control the client renders — either a Siren action it invokes
/// (via the action's own href/method/fields) or a navigable link it opens. The
/// client renders one of these per advertised affordance by iterating the
/// response; it never gates a control behind a per-capability boolean. The label
/// is the server's `title`; presentation (icon, tint, role) is derived entirely
/// client-side from the action `name` / link `rel`, so an unknown affordance
/// still renders with a default presentation rather than vanishing.
struct Affordance: Identifiable {
	/// How the client invokes the affordance: a Siren action it submits, or a
	/// navigable link it opens.
	enum Invocation {
		case action(SirenAction)
		case link(SirenLink)
	}

	let invocation: Invocation
	/// The wire vocabulary the client maps to its own presentation — an action
	/// `name` or a link's first `rel`. Never used as a style string verbatim.
	let token: String
	/// The server's human label, used verbatim as the control's text and
	/// accessibility label. Falls back to a humanized token when the server sent no
	/// `title`, so a label-less affordance still renders a readable control instead
	/// of a raw wire slug.
	let label: String
	/// Stable across re-renders so SwiftUI can diff a list of controls.
	let id: String

	/// Builds a control from an action, or nil when the action has no usable href
	/// (an unactionable action produces no control — no phantom affordance).
	init?(action: SirenAction) {
		guard action.href != nil else { return nil }
		invocation = .action(action)
		token = action.name
		label = action.title ?? Affordance.humanize(action.name)
		id = "action:\(action.name)"
	}

	/// Builds a control from a navigable link, or nil when the link has no href or
	/// no rel the client can key its presentation on.
	init?(link: SirenLink) {
		guard link.href != nil, let rel = link.rel.first else { return nil }
		invocation = .link(link)
		token = rel
		label = link.title ?? Affordance.humanize(rel)
		id = "link:\(rel)"
	}

	/// Turns a wire token (`mark-read`, `archive_now`) into a human label when the
	/// server advertised no `title`: split on `-`/`_`, drop empty segments, then
	/// Title-Case each word so an unlabelled affordance renders a readable control
	/// instead of a raw slug. The same token must read identically across clients.
	static func humanize(_ token: String) -> String {
		token
			.split(whereSeparator: { $0 == "-" || $0 == "_" })
			.map { $0.prefix(1).uppercased() + String($0.dropFirst()) }
			.joined(separator: " ")
	}

	var action: SirenAction? {
		guard case let .action(action) = invocation else { return nil }
		return action
	}

	var link: SirenLink? {
		guard case let .link(link) = invocation else { return nil }
		return link
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
