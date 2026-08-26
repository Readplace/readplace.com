import Foundation

// MARK: - Lenient decoding


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

	/// Decodes a single value under `key` leniently: a missing, null, or malformed
	/// value yields `nil` instead of failing the surrounding decode. Used for a
	/// property whose absence or evolution must degrade the one thing it feeds, not
	/// blank the whole response.
	func decodeLossyIfPresent<Value: Decodable>(
		_ type: Value.Type,
		forKey key: Key
	) throws -> Value? {
		(try decodeIfPresent(FailableDecodable<Value>.self, forKey: key))?.wrapped
	}
}

// MARK: - Wire format (Siren)

/// A hypermedia link. `href` is optional: a link advertised without one is kept
/// but unactionable — the client follows only the hrefs it is given — so a
/// partial or evolving link never fails the surrounding decode. `title` is the
/// server's human label for the link, which the client uses verbatim as the
/// control's label and accessibility text.
struct SirenLink: Decodable, Hashable {
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
struct SirenField: Decodable, Hashable {
	let name: String
	let type: String?
	let value: String?
}

extension SirenField {
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
struct SirenAction: Decodable, Hashable {
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

struct ReadTimeProperty: Decodable {
	let value: String
	let label: String
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
	let readTime: ReadTimeProperty?
	let status: String?
	let savedAt: String?
	let readAt: String?
	/// The server's explicit presentational read-state. Optional so an older server
	/// that doesn't emit it still decodes; the client falls back to deriving read
	/// state from `status`/`readAt` only then.
	let isRead: Bool?
	/// What the server asked the client to tell the reader about this response
	/// (e.g. a save confirmation). Optional so an older server still decodes.
	let messages: [ServerMessage]?
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
	let warning: SirenWarning?
	/// Server-authored notices the client may render generically (e.g. the iOS
	/// Share Extension's "don't close this" caption). Optional because it is a
	/// forward-added channel: an older server never emits it, and iOS is a shipped
	/// client, so its absence must decode cleanly rather than fail the collection.
	let messages: [ServerMessage]?
}

extension CollectionProperties {
	private enum CodingKeys: String, CodingKey { case warning, messages }

	/// Decodes the warning and messages leniently so an evolving or malformed value
	/// degrades to no banner rather than failing the whole collection decode: both
	/// are non-fatal channels, so a change to either must never be the one thing that
	/// blanks the page. A single malformed message is dropped, not page-blanking.
	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		warning = try container.decodeLossyIfPresent(SirenWarning.self, forKey: .warning)
		messages = try container.decodeLossyArrayIfPresent(ServerMessage.self, forKey: .messages)
	}
}

/// A non-fatal reason the server attaches to a collection (e.g. a URL that
/// couldn't be saved). `code` is optional: the client renders only `message`, so a
/// warning whose classifier the client doesn't read still surfaces its text.
struct SirenWarning: Decodable {
	let code: String?
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
	/// any unrecognized value as `.warning` (the neutral default), so a value a
	/// newer server adds never hard-fails.
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

/// A Siren error response. The client reads only what it renders: an error body
/// may also advertise actions, but every save it can refuse is one the client has
/// already completed or has no way to retry, so there is nothing to follow.
struct SirenError: Decodable {
	let properties: SirenErrorProperties
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
	let readTimeLabel: String?
	let isRead: Bool
	let savedAt: Date?
	/// Every action the server advertised on this item (e.g. `update-status`),
	/// in the order the server listed them. The row renders one control
	/// per actionable entry by iterating this — it never cherry-picks an action by
	/// name — so a newly-advertised item action renders with no client change.
	let actions: [SirenAction]
	/// Every navigable link the server advertised on this item, in wire order. The
	/// `read` link (the row's primary tap target) is surfaced through `readHref`;
	/// every other non-structural semantic link becomes a discrete control, so a
	/// future item link (e.g. `share`) renders instead of being discarded.
	let links: [SirenLink]
	/// The href of the server-declared link for reading this item, followed when
	/// the row is tapped. Absent ⇒ the row is not openable. This follows the
	/// navigable `read` link (the row's primary tap target), distinct from the
	/// action controls iterated above.
	let readHref: String?
}

extension Article {
	/// The item's action controls, one per advertised action the client can
	/// invoke (an action with a usable href). Built by iterating — not by matching
	/// a known name — so the loop renders whatever the server offered. The row also
	/// surfaces the item's semantic links (see `rowControls`), which is derived in
	/// the presentation layer because a link's control-worthiness is a client
	/// presentation concern.
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
		readTimeLabel = props.readTime?.label
		// Prefer the server's explicit read-state; fall back to deriving it from the
		// status vocabulary only for an older server that doesn't emit `isRead`.
		isRead = props.isRead ?? (props.status == "read" || props.readAt != nil)
		savedAt = props.savedAt.flatMap(SirenDate.parse)
		actions = entity.actions ?? []
		links = entity.links ?? []
		readHref = links.first { $0.rel.contains("read") }?.href
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

	/// Appends a query item to an already-resolved URL, preserving any query the
	/// URL already carries, or nil when the URL can't be decomposed/recomposed.
	/// Kept beside `resolve` so appending a client parameter (e.g. the reader's
	/// `platform=ios`) shares one URL-building rule and is unit-testable.
	static func appending(_ item: URLQueryItem, to url: URL) -> URL? {
		guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
		components.queryItems = (components.queryItems ?? []) + [item]
		return components.url
	}
}

/// Reads a `Content-Type` header. One parser keeps every caller — the Siren-type
/// check, the JSON-body routing, and the slogan fetch — comparing the same
/// essence, so a `;charset=…` parameter or odd casing can never make two callers
/// disagree about what a response is.
enum MediaType {
	/// The lowercased media type without parameters — `application/json; charset=utf-8`
	/// → `application/json` — or nil when the header is absent.
	static func essence(of header: String?) -> String? {
		guard let header else { return nil }
		return header.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
	}

	static func matches(_ header: String?, _ mediaType: String) -> Bool {
		essence(of: header) == mediaType
	}
}
