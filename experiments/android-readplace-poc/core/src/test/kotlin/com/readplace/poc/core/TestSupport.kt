package com.readplace.poc.core

import com.readplace.poc.core.http.HttpClient
import com.readplace.poc.core.http.HttpRequest
import com.readplace.poc.core.http.HttpResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.URI

/** Fails the test if the receiver is null, otherwise returns it non-null (JUnit's assertNotNull returns void). */
fun <T : Any> T?.orFail(message: String = "expected a non-null value"): T = this ?: throw AssertionError(message)

/** An in-memory [KeyValueStore] for tests (the app uses a SharedPreferences-backed one). */
class InMemoryKeyValueStore : KeyValueStore {
	private val map = mutableMapOf<String, String>()
	override fun getString(key: String): String? = map[key]
	override fun putString(key: String, value: String) { map[key] = value }
	override fun remove(key: String) { map.remove(key) }
}

/**
 * A fake [HttpClient] that serves canned responses and records the requests (and
 * their bodies) the client sent, so the networking layer is tested without a real
 * server — the analogue of the iOS POC's `StubURLProtocol`. It does NOT follow
 * redirects itself; returning a `3xx` with a `Location` header lets the walker's own
 * redirect handling drive the follow-up request.
 */
class FakeHttpClient : HttpClient {
	val records = mutableListOf<HttpRequest>()
	private var handler: (HttpRequest) -> HttpResponse = { json(404, "{}") }

	fun setHandler(handler: (HttpRequest) -> HttpResponse) { this.handler = handler }

	override fun execute(request: HttpRequest): HttpResponse {
		records.add(request)
		return handler(request)
	}

	fun records(path: String): List<HttpRequest> = records.filter { URI(it.url).path == path }

	companion object {
		fun json(
			status: Int,
			body: String,
			headers: Map<String, String> = mapOf("Content-Type" to "application/vnd.siren+json"),
		): HttpResponse = HttpResponse(status, headers, body.toByteArray())

		fun redirect(to: String, status: Int = 303): HttpResponse =
			HttpResponse(status, mapOf("Location" to to), ByteArray(0))
	}
}

object TestSupport {
	/** A token store pre-seeded with a logged-in session. */
	fun loggedInStore(
		baseUrl: String = "https://readplace.com",
		access: String = "access-1",
		refresh: String = "refresh-1",
	): TokenStore {
		val store = TokenStore(InMemoryKeyValueStore())
		store.baseUrl = baseUrl
		store.save(OAuthTokens(access, refresh))
		return store
	}

	/** Parses an `application/x-www-form-urlencoded` body into a map. */
	fun formFields(body: ByteArray?): Map<String, String> {
		val text = body?.decodeToString() ?: return emptyMap()
		return text.split("&").mapNotNull { pair ->
			val parts = pair.split("=", limit = 2)
			if (parts.size == 2) {
				java.net.URLDecoder.decode(parts[0], "UTF-8") to java.net.URLDecoder.decode(parts[1], "UTF-8")
			} else {
				null
			}
		}.toMap()
	}

	/** Parses a JSON object body into a map of primitive string values. */
	fun jsonObject(body: ByteArray?): Map<String, String?> {
		val text = body?.decodeToString() ?: return emptyMap()
		val obj = Json.decodeFromString(JsonObject.serializer(), text)
		return obj.mapValues { (_, value) -> (value as? JsonPrimitive)?.contentOrNull }
	}

	private val JsonPrimitive.contentOrNull: String? get() = if (isString) content else content.takeIf { it != "null" }
}

// MARK: - Siren JSON fixtures

object Fixtures {
	fun article(
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
		readAt: String? = null,
	): String {
		fun field(key: String, value: String?) = value?.let { "\"$key\": \"$it\"" } ?: "\"$key\": null"
		fun numField(key: String, value: Int?) = value?.let { "\"$key\": $it" } ?: "\"$key\": null"
		return """
		{
		  "class": ["article"],
		  "rel": ["item"],
		  "properties": {
		    "id": "$id",
		    "url": "$url",
		    ${field("title", title)},
		    ${field("siteName", siteName)},
		    ${field("excerpt", excerpt)},
		    ${numField("wordCount", wordCount)},
		    ${field("imageUrl", imageUrl)},
		    ${numField("estimatedReadTimeMinutes", readTime)},
		    "status": "$status",
		    "savedAt": "$savedAt",
		    ${field("readAt", readAt)}
		  },
		  "links": [{ "rel": ["read"], "href": "/queue/$id/view" }],
		  "actions": [{ "name": "delete", "href": "/queue/$id/delete", "method": "POST" }]
		}
		""".trimIndent()
	}

	fun collection(entitiesJson: List<String>, extraLinks: String = "", page: Int = 1, total: Int = 1): String =
		"""
		{
		  "class": ["collection", "articles"],
		  "properties": { "total": $total, "page": $page, "pageSize": 20 },
		  "entities": [${entitiesJson.joinToString(",\n")}],
		  "links": [
		    { "rel": ["self"], "href": "/queue?page=$page" },
		    { "rel": ["root"], "href": "/queue" }$extraLinks
		  ],
		  "actions": [
		    { "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] },
		    { "name": "save-html", "href": "/queue/save-html", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }, { "name": "rawHtml", "type": "text" }, { "name": "title", "type": "text" }] },
		    { "name": "search", "href": "/queue", "method": "GET" }
		  ]
		}
		""".trimIndent()

	fun tokenResponse(access: String, refresh: String?): String {
		val refreshLine = refresh?.let { "\"refresh_token\": \"$it\"," } ?: ""
		return """{ "access_token": "$access", $refreshLine "token_type": "Bearer", "expires_in": 3600 }"""
	}

	fun sirenError(code: String, message: String, withSaveArticleFallback: Boolean): String {
		val actions = if (withSaveArticleFallback) {
			""", "actions": [{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }]"""
		} else {
			""
		}
		return """{ "class": ["error"], "properties": { "code": "$code", "message": "$message" }$actions }"""
	}
}
