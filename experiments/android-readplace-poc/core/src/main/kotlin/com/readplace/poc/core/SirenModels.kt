package com.readplace.poc.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.format.DateTimeParseException

/** Shared JSON reader: tolerant of unknown/evolving keys so one new field never breaks a decode. */
internal val SirenJson = Json {
	ignoreUnknownKeys = true
	isLenient = true
}

// MARK: - Wire format (Siren)

/** A Siren link, e.g. `{ "rel": ["self"], "href": "/queue?page=2" }`. */
@Serializable
data class SirenLink(val rel: List<String>, val href: String)

/** A declared form field on a Siren action, e.g. `{ "name": "url", "type": "url" }`. */
@Serializable
data class SirenField(val name: String, val type: String? = null)

/**
 * A Siren action — the server tells us the href/method/fields; we never hard-code
 * them. e.g. `save-html` → `POST /queue/save-html`.
 */
@Serializable
data class SirenAction(
	val name: String,
	val href: String,
	val method: String,
	val type: String? = null,
	val fields: List<SirenField>? = null,
)

/**
 * The properties of an article entity. Everything except `id`/`url` is optional so
 * a single malformed or evolving entity never fails the decode of the whole collection.
 */
@Serializable
data class ArticleProperties(
	val id: String,
	val url: String,
	val title: String? = null,
	val siteName: String? = null,
	val excerpt: String? = null,
	val wordCount: Int? = null,
	val imageUrl: String? = null,
	val estimatedReadTimeMinutes: Int? = null,
	val status: String? = null,
	val savedAt: String? = null,
	val readAt: String? = null,
)

/** A sub-entity inside a collection (one saved article). */
@Serializable
data class SirenEntity(
	@SerialName("class") val classes: List<String>? = null,
	val rel: List<String>? = null,
	val properties: ArticleProperties? = null,
	val links: List<SirenLink>? = null,
	val actions: List<SirenAction>? = null,
)

/** A non-fatal reason the server attaches to a collection (e.g. a URL that couldn't be saved). */
@Serializable
data class SirenWarning(val code: String, val message: String)

/** Collection-level properties (`/queue`). */
@Serializable
data class CollectionProperties(
	val total: Int? = null,
	val page: Int? = null,
	val pageSize: Int? = null,
	val warning: SirenWarning? = null,
)

/** A Siren collection response (the queue). */
@Serializable
data class SirenCollection(
	@SerialName("class") val classes: List<String>? = null,
	val properties: CollectionProperties? = null,
	val entities: List<SirenEntity>? = null,
	val links: List<SirenLink>? = null,
	val actions: List<SirenAction>? = null,
)

/** The properties block on a Siren error body. */
@Serializable
data class SirenErrorProperties(val code: String, val message: String)

/**
 * A Siren error response. May carry a fallback `action` (e.g. the URL-only
 * `save-article` path when an HTML payload is too large).
 */
@Serializable
data class SirenError(val properties: SirenErrorProperties, val actions: List<SirenAction>? = null)

// MARK: - Domain model for the UI

/** A saved article, flattened from a Siren entity for display and actions. */
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
	/** Server-declared action href for deleting this item (`/queue/{id}/delete`). */
	val deleteHref: String?,
	/** Server-declared link for reading this item (`/queue/{id}/view`). */
	val readHref: String?,
) {
	companion object {
		/** Builds a display model from a Siren entity, or returns null when the entity has no usable properties. */
		fun from(entity: SirenEntity): Article? {
			val props = entity.properties ?: return null
			return Article(
				id = props.id,
				url = props.url,
				title = props.title?.takeIf { it.isNotEmpty() } ?: props.url,
				siteName = props.siteName,
				excerpt = props.excerpt,
				imageUrl = props.imageUrl,
				readTimeMinutes = props.estimatedReadTimeMinutes,
				isRead = props.status == "read" || props.readAt != null,
				savedAt = props.savedAt?.let(SirenDate::parse),
				deleteHref = entity.actions?.firstOrNull { it.name == "delete" }?.href,
				readHref = entity.links?.firstOrNull { "read" in it.rel }?.href,
			)
		}
	}
}

/** Parses the server's ISO-8601 timestamps (with or without fractional seconds). */
object SirenDate {
	fun parse(value: String): Instant? =
		try {
			Instant.parse(value)
		} catch (_: DateTimeParseException) {
			null
		}
}
