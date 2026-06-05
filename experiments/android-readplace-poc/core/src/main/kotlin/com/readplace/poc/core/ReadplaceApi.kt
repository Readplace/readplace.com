package com.readplace.poc.core

import com.readplace.poc.core.http.HttpClient
import com.readplace.poc.core.http.HttpRequest
import com.readplace.poc.core.http.HttpResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Why an API call failed, with a user-facing message. */
sealed class ApiError(val message: String) {
	data object NoToken : ApiError("Not signed in. Open Readplace and sign in first.")
	data object Unauthorized : ApiError("Your session expired. Please sign in again.")
	data object NotFound : ApiError("That item no longer exists.")
	data class Server(val status: Int, val code: String?, val serverMessage: String?) :
		ApiError(serverMessage ?: "Server error $status${code?.let { " ($it)" } ?: ""}.")

	data object Decoding : ApiError("Could not read the server response.")
}

class ApiException(val error: ApiError) : Exception(error.message)

/**
 * One page of the reading-list collection plus the collection-level actions and
 * pagination links the server advertised.
 */
class QueuePage(collection: SirenCollection) {
	val articles: List<Article> = collection.entities.orEmpty().mapNotNull(Article::from)
	val selfHref: String? = collection.links?.firstOrNull { "self" in it.rel }?.href
	val nextHref: String? = collection.links?.firstOrNull { "next" in it.rel }?.href
	val prevHref: String? = collection.links?.firstOrNull { "prev" in it.rel }?.href
	val total: Int? = collection.properties?.total
	val saveArticleAction: SirenAction? = collection.actions?.firstOrNull { it.name == "save-article" }
	val saveHtmlAction: SirenAction? = collection.actions?.firstOrNull { it.name == "save-html" }
	val warning: SirenWarning? = collection.properties?.warning
}

/**
 * A Siren client for the Readplace reading list, replicating the browser extension's
 * walker: it speaks `application/vnd.siren+json`, presents a Bearer token, refreshes
 * once on `401`, and follows server-declared hrefs rather than constructing them.
 */
class ReadplaceApi(
	val baseUrl: String,
	private val store: TokenStore,
	private val http: HttpClient,
	private val oauth: OAuthService,
) {
	// MARK: - Reading list

	/**
	 * Loads a collection page. With no [path], starts at the entry point `/` (the
	 * server 303-redirects to `/queue`); otherwise follows a declared link href
	 * (e.g. the `next` link).
	 */
	fun loadQueue(path: String? = null): QueuePage {
		val target = path?.let(::absolute) ?: "$baseUrl/"
		val response = send(HttpRequest(target, "GET"))
		if (response.status != 200) throw ApiException(apiError(response, response.status))
		return QueuePage(decode<SirenCollection>(response.bodyText))
	}

	/**
	 * Deletes an item via its server-declared `delete` href and returns the refreshed
	 * collection the server redirects back to.
	 */
	fun delete(href: String): QueuePage {
		val response = send(HttpRequest(absolute(href), "POST", mapOf("Prefer" to "return=representation")))
		if (response.status == 404) throw ApiException(ApiError.NotFound)
		if (response.status !in 200..299) throw ApiException(apiError(response, response.status))
		return QueuePage(decode<SirenCollection>(response.bodyText))
	}

	// MARK: - Saving

	/**
	 * Saves a page using its pre-rendered HTML via the `save-html` action. On an error
	 * body that carries a fallback action (e.g. the payload is too large), it degrades
	 * to the URL-only path — dropping `rawHtml` — exactly like the extension client does.
	 */
	fun saveHtml(action: SirenAction, url: String, rawHtml: String, title: String?): Article {
		val body = buildJsonObject {
			put("url", url)
			put("rawHtml", rawHtml)
			if (!title.isNullOrEmpty()) put("title", title)
		}
		val response = send(jsonRequest(action, body))
		if (response.status == 201 || response.status == 200) return decodeArticle(response.bodyText)

		val fallback = runCatching { decode<SirenError>(response.bodyText) }.getOrNull()?.actions?.firstOrNull()
		if (fallback != null) {
			val fallbackBody = buildJsonObject {
				put("url", url)
				if (!title.isNullOrEmpty()) put("title", title)
			}
			val fallbackResponse = send(jsonRequest(fallback, fallbackBody))
			if (fallbackResponse.status != 201 && fallbackResponse.status != 200) {
				throw ApiException(apiError(fallbackResponse, fallbackResponse.status))
			}
			return decodeArticle(fallbackResponse.bodyText)
		}
		throw ApiException(apiError(response, response.status))
	}

	/** Saves a URL only (no captured HTML) via the `save-article` action. */
	fun saveArticle(action: SirenAction, url: String): Article {
		val request = jsonRequest(action, buildJsonObject { put("url", url) })
			.withHeaders("Prefer" to "return=representation")
		val response = send(request)
		if (response.status != 201 && response.status != 200) throw ApiException(apiError(response, response.status))
		return decodeArticle(response.bodyText)
	}

	// MARK: - Transport

	/**
	 * Adds the Bearer token + Siren `Accept`, follows redirects with those headers
	 * preserved, and on a `401` refreshes once and retries (never loops).
	 */
	private fun send(request: HttpRequest, retryOn401: Boolean = true): HttpResponse {
		val token = store.tokens?.accessToken ?: throw ApiException(ApiError.NoToken)
		val authed = request.withHeaders(
			"Authorization" to "Bearer $token",
			"Accept" to AppConfig.SIREN_MEDIA_TYPE,
		)
		val response = executeFollowingRedirects(authed)
		if (response.status == 401 && retryOn401) {
			runCatching { oauth.refresh() }.getOrElse { throw ApiException(ApiError.Unauthorized) }
			return send(request, retryOn401 = false)
		}
		return response
	}

	/**
	 * Follows `3xx` redirects manually as GETs, carrying only `Authorization`/`Accept`
	 * forward. URLSession/HttpURLConnection would drop `Authorization` on a cross-origin
	 * redirect; the entry point `GET /` → `303 /queue` and `delete` → `303 /queue` both
	 * need it preserved.
	 */
	private fun executeFollowingRedirects(request: HttpRequest, maxHops: Int = 5): HttpResponse {
		var current = request
		var hops = 0
		while (true) {
			val response = http.execute(current)
			val location = response.header("Location")
			if (response.status in 300..399 && location != null && hops < maxHops) {
				hops++
				current = HttpRequest(
					url = absolute(location),
					method = "GET",
					headers = current.headers.filterKeys { it.equals("Authorization", true) || it.equals("Accept", true) },
				)
			} else {
				return response
			}
		}
	}

	private fun jsonRequest(action: SirenAction, body: JsonObject): HttpRequest =
		HttpRequest(
			url = absolute(action.href),
			method = action.method,
			headers = mapOf("Content-Type" to (action.type ?: "application/json")),
			body = Json.encodeToString(JsonObject.serializer(), body).toByteArray(),
		)

	private fun absolute(href: String): String = when {
		href.startsWith("http") -> href
		href.startsWith("/") -> "$baseUrl$href"
		else -> "$baseUrl/$href"
	}

	private inline fun <reified T> decode(body: String): T =
		runCatching { SirenJson.decodeFromString<T>(body) }.getOrElse { throw ApiException(ApiError.Decoding) }

	private fun decodeArticle(body: String): Article {
		val entity = decode<SirenEntity>(body)
		return Article.from(entity) ?: throw ApiException(ApiError.Decoding)
	}

	private fun apiError(response: HttpResponse, status: Int): ApiError {
		if (status == 401) return ApiError.Unauthorized
		val sirenError = runCatching { SirenJson.decodeFromString<SirenError>(response.bodyText) }.getOrNull()
		return ApiError.Server(status, sirenError?.properties?.code, sirenError?.properties?.message)
	}
}
