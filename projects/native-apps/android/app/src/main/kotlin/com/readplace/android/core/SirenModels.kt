package com.readplace.android.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.time.Instant
import java.time.format.DateTimeParseException

// region Wire format (Siren)

/**
 * A hypermedia link. `href` is nullable: a link advertised without one is kept but
 * unactionable — the client follows only the hrefs it is given — so a partial or
 * evolving link never fails the surrounding decode. `title` is the server's human
 * label, used verbatim as the control's label and accessibility text.
 */
data class SirenLink(
	val rel: List<String>,
	val href: String?,
	val title: String?,
)

/**
 * One field of an action. `value` is the server's pre-filled default when present;
 * the field `name` is part of the protocol vocabulary the client keys on (e.g.
 * `status`). The value is always carried as a string because the generic invoker
 * posts it form-/JSON-encoded, but the server may declare it as a JSON number
 * (e.g. a numeric `page`); such a value is coerced to its string form on decode so
 * it isn't dropped.
 */
data class SirenField(
	val name: String,
	val type: String?,
	val value: String?,
)

/**
 * A Siren action: the server declares its href, method, type and fields and the
 * client follows them rather than constructing a request. `href` is nullable so an
 * action advertised without one decodes and is simply treated as unactionable.
 * A method-less action defaults to `GET` (the Siren default) rather than failing
 * the decode.
 */
data class SirenAction(
	val name: String,
	val href: String?,
	val method: String,
	val title: String?,
	val type: String?,
	val fields: List<SirenField>?,
)

/**
 * The properties of an article entity. Everything except `id`/`url` is optional so
 * a single malformed or evolving entity never fails the decode of the whole
 * collection.
 */
data class ArticleProperties(
	val id: String,
	val url: String,
	val title: String?,
	val siteName: String?,
	val excerpt: String?,
	val wordCount: Int?,
	val imageUrl: String?,
	val estimatedReadTimeMinutes: Int?,
	val status: String?,
	val savedAt: String?,
	val readAt: String?,
	/** The server's explicit presentational read-state. Nullable so an older server
	 * that doesn't emit it still decodes; the client falls back to deriving read
	 * state from `status`/`readAt` only then. */
	val isRead: Boolean?,
	val messages: List<ServerMessage>?,
)

data class SirenEntity(
	val classes: List<String>?,
	val rel: List<String>?,
	val properties: ArticleProperties?,
	val links: List<SirenLink>?,
	val actions: List<SirenAction>?,
)

/** A non-fatal reason the server attaches to a collection (e.g. a URL that
 * couldn't be saved). `code` is nullable: the client renders only `message`, so a
 * warning whose classifier the client doesn't read still surfaces its text. */
data class SirenWarning(
	val code: String?,
	val message: String,
)

data class CollectionProperties(
	val warning: SirenWarning?,
	val messages: List<ServerMessage>?,
)

data class SirenCollection(
	val classes: List<String>?,
	val properties: CollectionProperties?,
	val entities: List<SirenEntity>?,
	val links: List<SirenLink>?,
	val actions: List<SirenAction>?,
)

/** The properties block on a Siren error body. A `code` + `message` describes a
 * conventional error; `messages` carries server-authored content the client
 * renders generically. All nullable so either shape decodes. */
data class SirenErrorProperties(
	val code: String?,
	val message: String?,
	val messages: List<ServerMessage>?,
)

data class SirenErrorBody(
	val properties: SirenErrorProperties,
)

/**
 * A server-authored message a client renders generically — it carries no
 * feature-specific code or action. `type` selects presentation (mapped to [kind]);
 * `content` is a small HTML fragment. A stable contract shared across the clients.
 */
data class ServerMessage(
	val type: String,
	val content: Content,
) {
	data class Content(val type: String, val body: String)

	/** How a client should present a message. The wire `type` stays a String so an
	 * unknown future value still decodes; this maps it for the UI and treats any
	 * unrecognized value as [Kind.WARNING] (the neutral default). */
	enum class Kind { WARNING, ERROR }

	val kind: Kind get() = if (type == "error") Kind.ERROR else Kind.WARNING

	/** Whether this client can render the message. `false` for a media type the
	 * client doesn't understand, in which case the message is dropped rather than
	 * surfaced as text. */
	val isRenderable: Boolean get() = content.type == RENDERABLE_MEDIA_TYPE

	/** The message body as plain text. `content` is a small server-authored HTML
	 * fragment; this app shows it as text — the visible text still names any address
	 * to email. */
	val plainText: String
		get() = decodeHtmlEntities(content.body.replace(TAG, "")).trim()

	companion object {
		/** The one content media type the clients know how to render. A message with
		 * any other `content.type` is ignored — never shown — so the server can adopt
		 * a richer media type without older clients mis-rendering an unknown body. */
		const val RENDERABLE_MEDIA_TYPE = "text/html"

		private val TAG = Regex("<[^>]+>")

		private val NAMED_REFERENCES = mapOf(
			"amp" to '&', "lt" to '<', "gt" to '>', "quot" to '"', "apos" to '\'',
		)

		/**
		 * Decodes HTML character references in a single left-to-right pass, so a
		 * correctly-escaped `&amp;lt;` resolves once to the text `&lt;` rather than
		 * twice to `<`. A chained replace would decode `&amp;` first and then
		 * re-interpret the `&lt;` it just produced. A bare `&`, an unterminated
		 * reference, or an unknown name is left verbatim.
		 */
		fun decodeHtmlEntities(input: String): String {
			if (!input.contains('&')) return input
			val output = StringBuilder(input.length)
			var cursor = 0
			while (cursor < input.length) {
				val character = input[cursor]
				val semicolon = if (character == '&') input.indexOf(';', cursor + 1) else -1
				val decoded =
					if (semicolon > cursor) decodeReference(input.substring(cursor + 1, semicolon)) else null
				if (decoded == null) {
					output.append(character)
					cursor++
				} else {
					output.append(decoded)
					cursor = semicolon + 1
				}
			}
			return output.toString()
		}

		/** Resolves the inside of a single `&…;` reference — a known name (`amp`) or a
		 * `#`-prefixed decimal/hex code point — or null when it is neither. */
		private fun decodeReference(body: String): String? {
			NAMED_REFERENCES[body]?.let { return it.toString() }
			if (!body.startsWith("#")) return null
			val digits = body.drop(1)
			val isHex = digits.startsWith("x") || digits.startsWith("X")
			val value = (if (isHex) digits.drop(1) else digits)
				.toIntOrNull(if (isHex) 16 else 10) ?: return null
			if (value < 0 || value > 0x10FFFF) return null
			return runCatching { String(Character.toChars(value)) }.getOrNull()
		}
	}
}

// endregion

// region Lenient decoding

/**
 * Maps a parsed JSON tree onto the models above.
 *
 * Every array is mapped element-by-element with the failures dropped, so one
 * malformed link, action or entity degrades to unactionable instead of blanking
 * the whole response — the contract requires a page to survive one bad control.
 * `ignoreUnknownKeys` alone cannot express that: it tolerates extra keys but still
 * fails the whole array on one malformed element.
 */
object SirenDecoding {
	fun collection(element: JsonElement): SirenCollection? {
		val obj = element as? JsonObject ?: return null
		return SirenCollection(
			classes = stringList(obj["class"]),
			properties = collectionProperties(obj["properties"]),
			entities = lossyList(obj["entities"], ::entity),
			links = lossyList(obj["links"], ::link),
			actions = lossyList(obj["actions"], ::action),
		)
	}

	fun entity(element: JsonElement): SirenEntity? {
		val obj = element as? JsonObject ?: return null
		return SirenEntity(
			classes = stringList(obj["class"]),
			rel = stringList(obj["rel"]),
			properties = articleProperties(obj["properties"]),
			links = lossyList(obj["links"], ::link),
			actions = lossyList(obj["actions"], ::action),
		)
	}

	fun errorBody(element: JsonElement): SirenErrorBody? {
		val properties = (element as? JsonObject)?.get("properties") as? JsonObject ?: return null
		return SirenErrorBody(
			SirenErrorProperties(
				code = string(properties["code"]),
				message = string(properties["message"]),
				messages = lossyList(properties["messages"], ::serverMessage),
			),
		)
	}

	fun link(element: JsonElement): SirenLink? {
		val obj = element as? JsonObject ?: return null
		val rel = stringList(obj["rel"]) ?: return null
		return SirenLink(rel = rel, href = string(obj["href"]), title = string(obj["title"]))
	}

	fun action(element: JsonElement): SirenAction? {
		val obj = element as? JsonObject ?: return null
		val name = string(obj["name"]) ?: return null
		return SirenAction(
			name = name,
			href = string(obj["href"]),
			method = string(obj["method"]) ?: "GET",
			title = string(obj["title"]),
			type = string(obj["type"]),
			fields = lossyList(obj["fields"], ::field),
		)
	}

	fun field(element: JsonElement): SirenField? {
		val obj = element as? JsonObject ?: return null
		val name = string(obj["name"]) ?: return null
		return SirenField(name = name, type = string(obj["type"]), value = fieldValue(obj["value"]))
	}

	fun serverMessage(element: JsonElement): ServerMessage? {
		val obj = element as? JsonObject ?: return null
		val type = string(obj["type"]) ?: return null
		val content = obj["content"] as? JsonObject ?: return null
		val contentType = string(content["type"]) ?: return null
		val body = string(content["body"]) ?: return null
		return ServerMessage(type, ServerMessage.Content(contentType, body))
	}

	private fun collectionProperties(element: JsonElement?): CollectionProperties? {
		val obj = element as? JsonObject ?: return null
		return CollectionProperties(
			warning = warning(obj["warning"]),
			messages = lossyList(obj["messages"], ::serverMessage),
		)
	}

	private fun warning(element: JsonElement?): SirenWarning? {
		val obj = element as? JsonObject ?: return null
		val message = string(obj["message"]) ?: return null
		return SirenWarning(code = string(obj["code"]), message = message)
	}

	private fun articleProperties(element: JsonElement?): ArticleProperties? {
		val obj = element as? JsonObject ?: return null
		val id = string(obj["id"]) ?: return null
		val url = string(obj["url"]) ?: return null
		return ArticleProperties(
			id = id,
			url = url,
			title = string(obj["title"]),
			siteName = string(obj["siteName"]),
			excerpt = string(obj["excerpt"]),
			wordCount = int(obj["wordCount"]),
			imageUrl = string(obj["imageUrl"]),
			estimatedReadTimeMinutes = int(obj["estimatedReadTimeMinutes"]),
			status = string(obj["status"]),
			savedAt = string(obj["savedAt"]),
			readAt = string(obj["readAt"]),
			isRead = boolean(obj["isRead"]),
			messages = lossyList(obj["messages"], ::serverMessage),
		)
	}

	private fun <T> lossyList(element: JsonElement?, map: (JsonElement) -> T?): List<T>? {
		val array = element as? JsonArray ?: return null
		return array.mapNotNull { runCatching { map(it) }.getOrNull() }
	}

	private fun stringList(element: JsonElement?): List<String>? {
		val array = element as? JsonArray ?: return null
		return array.mapNotNull { string(it) }
	}

	private fun string(element: JsonElement?): String? {
		val primitive = element as? JsonPrimitive ?: return null
		return if (primitive.isString) primitive.content else null
	}

	private fun int(element: JsonElement?): Int? = (element as? JsonPrimitive)?.intOrNull

	private fun boolean(element: JsonElement?): Boolean? = (element as? JsonPrimitive)?.booleanOrNull

	/** A whole number decodes as a double, so render it without a trailing ".0" —
	 * the server's `"page": 2` must post as `"2"`, not `"2.0"`. */
	private fun fieldValue(element: JsonElement?): String? {
		val primitive = element as? JsonPrimitive ?: return null
		if (primitive.isString) return primitive.content
		val number = primitive.doubleOrNull ?: return null
		return if (number == Math.rint(number) && !number.isInfinite()) {
			number.toLong().toString()
		} else {
			number.toString()
		}
	}
}

// endregion

// region Domain model for the UI

/**
 * A saved article, flattened from a Siren entity for display and actions.
 *
 * `actions` and `links` carry everything the server advertised on the item, in
 * wire order: the row renders one control per actionable entry by iterating them
 * and never cherry-picks by name, so a newly-advertised item affordance renders
 * with no client change.
 */
data class Article(
	val id: String,
	val url: String,
	val title: String,
	val siteName: String?,
	val excerpt: String?,
	val imageUrl: String?,
	val readTimeMinutes: Int?,
	val isRead: Boolean,
	val savedAt: Instant?,
	val actions: List<SirenAction>,
	val links: List<SirenLink>,
	/** The href of the server-declared link for reading this item, followed when the
	 * row is tapped. Absent ⇒ the row is not openable. */
	val readHref: String?,
) {
	/** The item's action controls, one per advertised action the client can invoke
	 * (an action with a usable href). Built by iterating — not by matching a known
	 * name — so the loop renders whatever the server offered. */
	val affordances: List<Affordance> get() = actions.mapNotNull { Affordance.of(it) }

	companion object {
		/** Builds a display model from a Siren entity, or null when the entity has no
		 * usable properties. */
		fun of(entity: SirenEntity): Article? {
			val props = entity.properties ?: return null
			val links = entity.links ?: emptyList()
			return Article(
				id = props.id,
				url = props.url,
				title = props.title?.takeIf { it.isNotEmpty() } ?: props.url,
				siteName = props.siteName,
				excerpt = props.excerpt,
				imageUrl = props.imageUrl,
				readTimeMinutes = props.estimatedReadTimeMinutes,
				// Prefer the server's explicit read-state; fall back to deriving it from
				// the status vocabulary only for an older server that doesn't emit it.
				isRead = props.isRead ?: (props.status == "read" || props.readAt != null),
				savedAt = props.savedAt?.let { SirenDate.parse(it) },
				actions = entity.actions ?: emptyList(),
				links = links,
				readHref = links.firstOrNull { it.rel.contains("read") }?.href,
			)
		}
	}
}

/**
 * One advertised control the client renders — either a Siren action it invokes
 * (via the action's own href/method/fields) or a navigable link it opens. The
 * client renders one of these per advertised affordance by iterating the response;
 * it never gates a control behind a per-capability boolean. The label is the
 * server's `title`; presentation (icon, tint, role) is derived entirely
 * client-side from the action `name` / link `rel`, so an unknown affordance still
 * renders with a default presentation rather than vanishing.
 */
data class Affordance(
	val invocation: Invocation,
	/** The wire vocabulary the client maps to its own presentation — an action
	 * `name` or a link's first `rel`. Never used as a style string verbatim. */
	val token: String,
	/** The server's human label, used verbatim as the control's text and
	 * accessibility label. Falls back to a humanized token when the server sent no
	 * `title`, so a label-less affordance still renders a readable control. */
	val label: String,
	val id: String,
) {
	sealed interface Invocation {
		data class OfAction(val action: SirenAction) : Invocation
		data class OfLink(val link: SirenLink) : Invocation
	}

	val action: SirenAction? get() = (invocation as? Invocation.OfAction)?.action
	val link: SirenLink? get() = (invocation as? Invocation.OfLink)?.link

	companion object {
		/** Builds a control from an action, or null when the action has no usable href
		 * (an unactionable action produces no control — no phantom affordance). */
		fun of(action: SirenAction): Affordance? {
			if (action.href == null) return null
			return Affordance(
				invocation = Invocation.OfAction(action),
				token = action.name,
				label = action.title ?: humanize(action.name),
				id = "action:${action.name}",
			)
		}

		/** Builds a control from a navigable link, or null when the link has no href or
		 * no rel the client can key its presentation on. */
		fun of(link: SirenLink): Affordance? {
			if (link.href == null) return null
			val rel = link.rel.firstOrNull() ?: return null
			return Affordance(
				invocation = Invocation.OfLink(link),
				token = rel,
				label = link.title ?: humanize(rel),
				id = "link:$rel",
			)
		}

		/** Turns a wire token (`mark-read`, `archive_now`) into a human label when the
		 * server advertised no `title`: split on `-`/`_`, drop empty segments, then
		 * Title-Case each word. The same token must read identically across clients. */
		fun humanize(token: String): String =
			token.split('-', '_')
				.filter { it.isNotEmpty() }
				.joinToString(" ") { it.take(1).uppercase() + it.drop(1) }
	}
}

// endregion

/** Parses the server's ISO-8601 timestamps (with or without fractional seconds). */
object SirenDate {
	fun parse(value: String): Instant? =
		try {
			Instant.parse(value)
		} catch (_: DateTimeParseException) {
			null
		}
}

/**
 * Resolves a server-declared href to an absolute URL the client can act on, or
 * null when the href is unactionable. The client speaks two schemes — the web
 * origin (`http`/`https`) and its own deep-link scheme — and resolves a
 * scheme-less href against the server origin. A href carrying any other scheme is
 * a protocol the client doesn't understand, so it is treated as absent. One rule
 * in one place keeps every caller resolving hrefs identically.
 */
object Href {
	fun resolve(href: String, baseUrl: String): String? {
		val scheme = runCatching { URI(href).scheme }.getOrNull()?.lowercase()
			?: return "$baseUrl${if (href.startsWith("/")) href else "/$href"}"
		return when (scheme) {
			"http", "https", AppConfig.CALLBACK_SCHEME -> href
			else -> null
		}
	}

	/** Appends a query item to an already-resolved URL, preserving any query the URL
	 * already carries. Kept beside [resolve] so appending a client parameter (e.g.
	 * the reader's `platform=android`) shares one URL-building rule. */
	fun appending(url: String, name: String, value: String): String {
		val encodedName = java.net.URLEncoder.encode(name, "UTF-8")
		val encodedValue = java.net.URLEncoder.encode(value, "UTF-8")
		val separator = when {
			!url.contains('?') -> "?"
			url.endsWith('?') || url.endsWith('&') -> ""
			else -> "&"
		}
		return "$url$separator$encodedName=$encodedValue"
	}
}

/**
 * Reads a `Content-Type` header. One parser keeps every caller — the Siren-type
 * check, the JSON-body routing, and the slogan fetch — comparing the same essence,
 * so a `;charset=…` parameter or odd casing can never make two callers disagree
 * about what a response is.
 */
object MediaType {
	/** The lowercased media type without parameters — `application/json; charset=utf-8`
	 * → `application/json` — or null when the header is absent. */
	fun essenceOf(header: String?): String? =
		header?.substringBefore(';')?.trim()?.lowercase()

	fun matches(header: String?, mediaType: String): Boolean = essenceOf(header) == mediaType
}
