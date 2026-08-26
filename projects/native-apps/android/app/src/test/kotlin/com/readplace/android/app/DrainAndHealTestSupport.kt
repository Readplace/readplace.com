package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.core.AccessToken
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.EphemeralCookieJar
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.MultipartForm
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthTokens
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.RefreshToken
import com.readplace.android.core.TokenKey
import com.readplace.android.core.TokenStorage
import com.readplace.android.core.TokenStore
import kotlinx.coroutines.CoroutineDispatcher
import okhttp3.OkHttpClient
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object DrainAndHealTestSupport {
	const val USER_AGENT = "Readplace/1 Android/16"

	/** A test double for [HtmlCapturing] that returns a canned [CapturedPage] and
	 * records the URLs it was asked to capture — no real WebView involved. */
	class RecordingHtmlCaptor(
		private val page: CapturedPage,
		private val onCapture: () -> Unit = {},
	) : HtmlCapturing {
		private val captured = mutableListOf<String>()

		val capturedUrls: List<String> get() = captured.toList()

		override suspend fun capture(url: String): CapturedPage {
			captured.add(url)
			onCapture()
			return page
		}
	}

	class ConcurrentTokenStorage : TokenStorage {
		private val stored = ConcurrentHashMap<TokenKey, String>()

		override fun readValue(key: TokenKey): Result<String?> = Result.success(stored[key])

		override fun setValue(key: TokenKey, value: String) {
			stored[key] = value
		}

		override fun removeValue(key: TokenKey) {
			stored.remove(key)
		}
	}

	fun loggedInStore(access: String = "access-1", refresh: String = "refresh-1"): TokenStore {
		val store = TokenStore(ConcurrentTokenStorage())
		store.save(OAuthTokens(AccessToken(access), RefreshToken(refresh)))
		return store
	}

	/** Builds the client the way the composition root does: one OkHttp client with
	 * its own jar, refreshing through the same server. */
	fun api(
		server: RecordingServer,
		store: TokenStore,
		ioDispatcher: CoroutineDispatcher,
		baseUrl: String = server.baseUrl,
	): ReadplaceApi {
		val client = OkHttpClient.Builder().cookieJar(EphemeralCookieJar()).followRedirects(false).build()
		val oauth = OAuth(baseUrl = server.baseUrl, store = store, http = OkHttpClient())
		return ReadplaceApi(baseUrl, client, store, oauth, USER_AGENT, ioDispatcher)
	}

	fun multipartForm(
		url: String = "https://example.com/post",
		mediaType: String = "text/html",
		content: ByteArray = "<html><body>hi</body></html>".toByteArray(Charsets.UTF_8),
	): MultipartForm =
		MultipartForm(
			boundary = UUID.randomUUID().toString(),
			textParts = listOf(
				MultipartForm.TextPart(name = "url", value = url),
				MultipartForm.TextPart(name = "mediaType", value = mediaType),
			),
			filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = content),
		)

	class MultipartPart(
		val name: String?,
		val filename: String?,
		val contentType: String?,
		val body: ByteArray,
	) {
		val text: String get() = String(body, Charsets.UTF_8)
	}

	/** Parses a `multipart/form-data` body into its parts — a port of the server's
	 * `extractAllParts`, so a test asserts the exact wire bytes the server will
	 * parse rather than a client-side re-serialisation. */
	fun multipartParts(contentType: String?, body: ByteArray): List<MultipartPart> {
		val boundary = contentType?.let(::multipartBoundary) ?: return emptyList()
		val dash = "--$boundary".toByteArray(Charsets.UTF_8)
		val headerSeparator = "\r\n\r\n".toByteArray(Charsets.UTF_8)
		val parts = mutableListOf<MultipartPart>()
		var cursor = indexOf(dash, body, from = 0) ?: return parts
		while (cursor < body.size) {
			cursor += dash.size
			// Either "--" (end of message) or CRLF (another part follows).
			if (cursor + 1 < body.size && body[cursor] == DASH && body[cursor + 1] == DASH) return parts
			if (cursor + 1 >= body.size || body[cursor] != CR || body[cursor + 1] != LF) return parts
			cursor += 2
			val headerEnd = indexOf(headerSeparator, body, from = cursor) ?: return parts
			val headers = String(body, cursor, headerEnd - cursor, Charsets.UTF_8)
			val bodyStart = headerEnd + headerSeparator.size
			val nextBoundary = indexOf(dash, body, from = bodyStart) ?: return parts
			// Strip the CRLF that precedes the boundary line.
			val bodyEnd = nextBoundary - 2
			parts.add(
				MultipartPart(
					name = headerValue(Regex("name=\"([^\"]*)\""), headers),
					filename = headerValue(Regex("filename=\"([^\"]*)\""), headers),
					contentType = headerValue(Regex("(?i)content-type:\\s*([^\\r\\n]+)"), headers),
					body = body.copyOfRange(bodyStart, bodyEnd),
				),
			)
			cursor = nextBoundary
		}
		return parts
	}

	private const val DASH: Byte = 0x2d
	private const val CR: Byte = 0x0d
	private const val LF: Byte = 0x0a

	private fun multipartBoundary(contentType: String): String? {
		val marker = "boundary="
		val start = contentType.indexOf(marker)
		if (start < 0) return null
		var value = contentType.substring(start + marker.length)
		val semicolon = value.indexOf(';')
		if (semicolon >= 0) value = value.substring(0, semicolon)
		value = value.trim().trim('"')
		return value.ifEmpty { null }
	}

	private fun indexOf(needle: ByteArray, haystack: ByteArray, from: Int): Int? {
		if (needle.isEmpty() || haystack.size < needle.size) return null
		var i = from
		while (i <= haystack.size - needle.size) {
			if (needle.indices.all { haystack[i + it] == needle[it] }) return i
			i += 1
		}
		return null
	}

	private fun headerValue(pattern: Regex, headers: String): String? =
		pattern.find(headers)?.groupValues?.get(1)

	object Fixtures {
		fun article(id: String = "a1"): String =
			"""
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": {
						"id": "$id",
						"url": "https://example.com/post",
						"title": "A Title",
						"siteName": "Example",
						"excerpt": "An excerpt.",
						"imageUrl": "https://example.com/img.png",
						"estimatedReadTimeMinutes": 6,
						"readTime": { "value": "6", "label": "~6 min read" },
						"status": "unread",
						"savedAt": "2026-05-30T10:00:00.000Z",
						"readAt": null
					},
					"links": [{ "rel": ["read"], "href": "/queue/$id/view" }],
					"actions": [
						{ "name": "delete", "href": "/queue/$id/delete", "method": "POST" },
						{ "name": "update-status", "href": "/queue/$id/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text", "value": "read" }] }
					]
				}
			"""

		/** The collection-level actions a healthy `/queue` advertises (URL-only save,
		 * HTML save, file save, search), each carrying the server's `title` label. */
		const val COLLECTION_ACTIONS = """
			{ "name": "save-article", "title": "Save a link", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] },
			{ "name": "save-content", "title": "Save a file", "href": "/queue/save-content", "method": "POST", "type": "multipart/form-data", "fields": [{ "name": "url", "type": "url" }, { "name": "content", "type": "file" }, { "name": "mediaType", "type": "text" }, { "name": "title", "type": "text" }] },
			{ "name": "search", "title": "Search", "href": "/queue", "method": "GET", "fields": [{ "name": "status", "type": "text" }, { "name": "order", "type": "text" }, { "name": "page", "type": "number" }, { "name": "url", "type": "url" }] }
		"""

		/** A server that offers only the URL-only save — no home for captured content. */
		const val SAVE_ARTICLE_ONLY = """
			{ "name": "save-article", "href": "/queue", "method": "POST", "type": "application/json", "fields": [{ "name": "url", "type": "url" }] }
		"""

		fun collection(entitiesJson: List<String> = emptyList(), actionsJson: String = COLLECTION_ACTIONS): String =
			"""
				{
					"class": ["collection", "articles"],
					"properties": { "total": 1, "page": 1, "pageSize": 20 },
					"entities": [${entitiesJson.joinToString(",\n")}],
					"links": [
						{ "rel": ["self"], "href": "/queue?page=1" },
						{ "rel": ["root"], "href": "/queue" }
					],
					"actions": [$actionsJson]
				}
			"""

		fun sirenError(code: String, message: String): String =
			"""{ "class": ["error"], "properties": { "code": "$code", "message": "$message" } }"""

		/** The refusal the server returns on a write it won't allow (e.g. a locked
		 * account): server-authored messages for the client to render, and
		 * deliberately no code and no action. Single-quoted HTML keeps the fixture
		 * valid JSON. */
		fun accountLockedError(): String =
			"""{ "class": ["error"], "properties": { "messages": [{ "type": "warning", "content": { "type": "text/html", "body": "Your account is locked because your email was never verified. Email <a href='mailto:readplace+verification@readplace.com'>readplace+verification@readplace.com</a> to restore access." } }] } }"""
	}
}
