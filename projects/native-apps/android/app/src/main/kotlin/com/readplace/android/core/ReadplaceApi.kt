package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.Headers.Companion.toHeaders
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.ProtocolException

sealed class ApiError(message: String) : Exception(message) {
	class NoToken : ApiError("Not signed in. Open Readplace and sign in first.")

	class Unauthorized : ApiError("Your session expired. Please sign in again.")

	class Server(val status: Int, val code: String?, val serverMessage: String?) :
		ApiError(serverMessage ?: "Server error $status${code?.let { " ($it)" } ?: ""}.")

	/** The server refused the request with messages for the client to render.
	 * Carries the server-authored messages; the refusal models no action — there
	 * is nothing for the client to invoke, only something for the user to read. */
	class Refused(val messages: List<ServerMessage>) :
		ApiError(messages.joinToString("\n") { it.plainText })

	/** The response carried a body in a media type the client doesn't speak (not
	 * the negotiated Siren type). Surfaced honestly rather than blind-decoded — a
	 * proxy login page or a future media type is "I don't understand this," not a
	 * generic "couldn't read the response." */
	class UnsupportedMediaType(val mediaType: String?) :
		ApiError("The server replied in a format this app doesn't understand.")

	class Decoding : ApiError("Could not read the server response.")
}

/**
 * One page of the reading-list collection plus the collection-level actions
 * and pagination links the server advertised.
 */
class QueuePage(collection: SirenCollection) {
	val articles: List<Article>
	val nextHref: String?

	/** Every collection-level action and navigable link the server advertised, in
	 * wire order — the complete set, so the share-sheet save journey can still find
	 * its bespoke action by name ([action], below). The toolbar does not render this
	 * set verbatim: it derives its own subset client-side by mapping each
	 * affordance's wire token to its presentation and dropping the ones it can't
	 * present as a toolbar control — a structural navigation link the client
	 * follows itself, or a capture-only save Android can only reach through the
	 * share sheet. */
	val affordances: List<Affordance>
	val warning: SirenWarning?

	/** Server-authored notices the client may surface generically (e.g. the share
	 * target's "don't close this" caption during a save). Only the renderable ones
	 * are kept — a message in a media type this client can't present is dropped
	 * rather than shown as raw text (be liberal in what you accept, conservative in
	 * what you render), so the caller renders whatever survives without
	 * re-checking. Empty when the server offered none. */
	val noticeMessages: List<ServerMessage>

	init {
		articles = collection.entities.orEmpty().mapNotNull { Article.of(it) }
		val links = collection.links.orEmpty()
		nextHref = links.firstOrNull { it.rel.contains("next") }?.href
		val actionAffordances = collection.actions.orEmpty().mapNotNull { Affordance.of(it) }
		val linkAffordances = links.mapNotNull { Affordance.of(it) }
		affordances = actionAffordances + linkAffordances
		warning = collection.properties?.warning
		noticeMessages = collection.properties?.messages.orEmpty().filter { it.isRenderable }
	}

	/** The advertised action with this name, when present and invokable. The
	 * share-sheet save journey needs a specific action to build its bespoke body
	 * (a captured-HTML or URL-only POST), which is the contract's sanctioned
	 * exception for actions with special bodies — distinct from the looped
	 * toolbar rendering, which never selects an affordance by name. */
	fun action(named: String): SirenAction? =
		affordances.firstNotNullOfOrNull { affordance -> affordance.action?.takeIf { it.name == named } }
}

/**
 * The session's own isolated, in-memory cookie jar — never a process-wide store:
 * the session cookie minted by [ReadplaceApi.bootstrapSession] must not linger
 * where it would outlive the session and leak across sign-outs. A cookie is keyed
 * by name, domain and path, so a re-issued cookie replaces the one it supersedes.
 */
class EphemeralCookieJar : CookieJar {
	private val held = mutableListOf<Cookie>()

	@Synchronized
	override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
		for (cookie in cookies) {
			held.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
			held.add(cookie)
		}
	}

	@Synchronized
	override fun loadForRequest(url: HttpUrl): List<Cookie> = held.filter { it.matches(url) }
}

/**
 * A Siren client for the Readplace reading list, replicating the browser
 * extension's walker: it speaks `application/vnd.siren+json`, presents a
 * Bearer token, refreshes once on `401`, and follows server-declared hrefs
 * rather than constructing them.
 *
 * Both HTTP clients derive from the one the caller built (its cookie jar, pool
 * and timeouts), the way the iOS app derives two sessions from one
 * configuration: [http] walks redirects by hand ([followingRedirects]) so the
 * headers the client sets survive every hop, and [externalHttp] lets OkHttp follow
 * them itself because nothing on an external fetch is worth preserving.
 */
class ReadplaceApi(
	val baseUrl: String,
	client: OkHttpClient,
	private val store: TokenStore,
	private val oauth: OAuth,
	private val nativeUserAgent: String,
	private val ioDispatcher: CoroutineDispatcher,
	/** Conservative ceiling on bytes pulled into the share target for an external
	 * content fetch. Well under the server's `MAX_PDF_BYTES` OCR ceiling: that is an
	 * origin-side limit, whereas the share target holds the fetched bytes in a tight
	 * memory budget. [fetchExternalContent] streams the body and stops the moment the
	 * running total crosses this ceiling (refusing outright when the response
	 * announces an oversize length), so an oversize resource degrades to a URL-only
	 * save without ever being buffered whole. */
	private val maxExternalContentBytes: Long = DEFAULT_MAX_EXTERNAL_CONTENT_BYTES,
) {
	private val http: OkHttpClient = client.newBuilder()
		.followRedirects(false)
		.followSslRedirects(false)
		.build()

	// Fetches third-party content (e.g. a PDF the user shared) with no header
	// re-attachment and never via `send()`, so neither the bearer nor the
	// redirect-preserving re-attachment can leak the Readplace `Authorization`
	// header to that origin.
	private val externalHttp: OkHttpClient = client.newBuilder()
		.followRedirects(true)
		.followSslRedirects(true)
		.build()

	/** What the server said about an accepted save: the article it created or
	 * bumped, and the confirmation it wants the reader told — empty on a server
	 * that predates the channel, in which case the sheet keeps its own copy. */
	data class SaveConfirmation(val article: Article, val messages: List<ServerMessage>)

	// region Reading list

	/** Loads a collection page. With no `path`, starts at the entry point — the
	 * one URL the client knows — and follows wherever the server redirects;
	 * otherwise it follows a link href the server already handed back (e.g. the
	 * `next` link). */
	suspend fun loadQueue(path: String? = null): QueuePage {
		val url = if (path != null) absoluteUrl(path) else entryPoint("/")
		val answer = send(Request.Builder().url(url).get().build())
		if (answer.status != 200) throw apiError(answer)
		return QueuePage(decodeSiren(answer, SirenDecoding::collection))
	}

	/**
	 * Invokes a simple entity action via its own server-declared href, method and
	 * type — the single generic path for actions whose body is a flat field set
	 * (e.g. `update-status`), so a newly-advertised entity action is invokable with
	 * no new per-operation code. The caller supplies values only for the field
	 * names whose semantics the protocol fixes (`status`); the action's own declared
	 * field defaults fill the rest, and a field the caller neither supplies nor the
	 * server defaults is simply omitted. A successful follow (a 2xx/3xx, after the
	 * redirect walk re-attaches auth across any redirect) confirms the invoke;
	 * anything else surfaces as a server error. Returns the followed response's
	 * collection when the server drove the client back to one — the post-action
	 * truth the caller adopts, carrying whatever changed elsewhere (e.g. an item
	 * marked unread on the website) — or null when the response is no collection:
	 * the server directed no re-list.
	 */
	suspend fun invoke(action: SirenAction, values: Map<String, String> = emptyMap()): QueuePage? {
		val fields = LinkedHashMap(values)
		for (declared in action.fields.orEmpty()) {
			if (declared.name in fields) continue
			val value = declared.value ?: continue
			fields[declared.name] = value
		}
		val answer = send(invocationRequest(action, fields))
		if (answer.status !in 200..399) throw apiError(answer)
		return postActionCollection(answer)
	}

	/** The collection the server drove a successful action back to, or null when
	 * the response is not one. Decoded leniently on purpose: an action may land on
	 * any representation (an entity, an empty body, a non-Siren page), and none of
	 * those is an error — it just means the server issued no re-list direction. The
	 * `collection` class is the discriminator because every [SirenCollection] field
	 * is optional, so any JSON object would otherwise pass the decode. */
	private fun postActionCollection(answer: Answer): QueuePage? {
		if (!isSirenMediaType(answer.contentType)) return null
		val collection = jsonElementOf(answer.body)?.let { SirenDecoding.collection(it) } ?: return null
		if (!collection.classes.orEmpty().contains("collection")) return null
		return QueuePage(collection)
	}

	// endregion

	// region Reader session

	/**
	 * Mints a browser session from the current bearer token and returns the cookies
	 * this mint added to or changed in the session jar — the freshly-set session id,
	 * not the cookies an earlier request already left there ([sessionCookies] has the
	 * exact rule). The in-app reader injects them so the cookie-authenticated reader
	 * page (and its in-reader XHRs) load without bouncing to a sign-in page. Follows
	 * the server-declared `action`'s href and method when the collection advertised
	 * one (`create-session`), so the endpoint can move without an app release; falls
	 * back to a fixed path only for a server that hasn't advertised the action yet
	 * (an older shipped build must keep working). The client never selects a cookie
	 * by name — it forwards whatever this exchange changed. Reuses [send], so a stale
	 * bearer is refreshed once before the session is minted; a mint that changes no
	 * jar cookie and sets no `Set-Cookie` header is a failed mint.
	 */
	suspend fun bootstrapSession(action: SirenAction? = null): List<Cookie> {
		val url: HttpUrl
		val method: String
		if (action != null) {
			url = absoluteUrl(action.href)
			method = action.method
		} else {
			url = entryPoint("/auth/session")
			method = "POST"
		}
		val request = Request.Builder().url(url).method(method, emptyBodyFor(method)).build()
		// Snapshot the jar before the request so `sessionCookies` can tell a cookie
		// this mint sets apart from one an earlier request already left behind.
		val priorCookies = http.cookieJar.loadForRequest(url).map { CookieIdentity(it) }.toSet()
		val answer = send(request)
		if (answer.status !in 200..299) throw apiError(answer)
		val cookies = sessionCookies(answer, url, priorCookies)
		if (cookies.isEmpty()) throw ApiError.Decoding()
		return cookies
	}

	/** Identity of a jar cookie for the before/after comparison in [sessionCookies].
	 * Re-reading the jar hands back the cookie instances it holds, so object
	 * identity can't decide whether a cookie is one this mint set — name, domain,
	 * path, and value can. Value is part of the key so a re-issued cookie (same
	 * name, new value) still reads as freshly set. */
	private data class CookieIdentity(
		val name: String,
		val domain: String,
		val path: String,
		val value: String,
	) {
		constructor(cookie: Cookie) : this(cookie.name, cookie.domain, cookie.path, cookie.value)
	}

	/**
	 * Returns the session jar's `prior`-to-now delta — the cookies this exchange
	 * added or changed, keyed by [CookieIdentity] — read from the session's own
	 * cookie jar. The jar is the instance's own (an [EphemeralCookieJar], not a
	 * process-wide store) so the cookies OkHttp just parsed never touch anything
	 * shared. Reading the already-parsed cookies back from the jar, rather than
	 * re-splitting the response headers, sidesteps a spec hazard: repeated
	 * `Set-Cookie` headers must not be folded into one comma-joined value, so header
	 * re-splitting is unsafe once a response sets more than one cookie. Excluding
	 * `prior` drops the cookies an earlier request left in the jar — keeping the
	 * caller's empty-means-failed-mint check honest, and deliberately dropping a
	 * signal the server re-sets on every Siren response (e.g. `hutch_ext_alive`)
	 * with an unchanged value: already in `prior` from the queue load that precedes
	 * a mint, re-set unchanged it never enters the delta, and injecting it into the
	 * reader would fake extension-installed onboarding from the app. The delta is
	 * why this is not literally "every cookie the response set": a cookie re-set
	 * with an unchanged value is recovered only by the `Set-Cookie` header fallback
	 * below, and only when the whole delta is empty — which is also how a jar that
	 * keeps nothing is served.
	 */
	private fun sessionCookies(answer: Answer, url: HttpUrl, prior: Set<CookieIdentity>): List<Cookie> {
		val fresh = http.cookieJar.loadForRequest(url).filter { CookieIdentity(it) !in prior }
		if (fresh.isNotEmpty()) return fresh
		return Cookie.parseAll(url, answer.headers)
	}

	// endregion

	// region Saving

	/**
	 * Fetches third-party content the user shared (e.g. a PDF) so the bytes can be
	 * uploaded via `save-content`. Uses [externalHttp] — never [send] — so the
	 * Readplace bearer is never attached. Streams the body and aborts the moment the
	 * running total exceeds [maxExternalContentBytes] (and refuses a response whose
	 * announced length already exceeds it), so an oversize resource — a large
	 * scanned PDF, say — never lands in the share target's memory budget whole;
	 * returns null on any non-2xx, oversize, or transport failure so the caller
	 * degrades to a URL-only save.
	 */
	suspend fun fetchExternalContent(url: String): ByteArray? {
		val target = url.toHttpUrlOrNull() ?: return null
		val request = Request.Builder().url(target).get().header("User-Agent", nativeUserAgent).build()
		return withContext(ioDispatcher) {
			try {
				externalHttp.newCall(request).execute().use { boundedBody(it) }
			} catch (_: IOException) {
				null
			}
		}
	}

	private fun boundedBody(response: Response): ByteArray? {
		if (response.code !in 200..299) return null
		val announced = response.body.contentLength()
		if (announced > maxExternalContentBytes) return null
		val collected = ByteArrayOutputStream(maxOf(announced, 0L).toInt())
		val source = response.body.source()
		val chunk = ByteArray(READ_CHUNK_BYTES)
		var total = 0L
		var read = source.read(chunk)
		while (read != -1) {
			total += read
			if (total > maxExternalContentBytes) return null
			collected.write(chunk, 0, read)
			read = source.read(chunk)
		}
		return collected.toByteArray()
	}

	/** Saves a URL only (no captured HTML) via the `save-article` action. */
	suspend fun saveArticle(action: SirenAction, url: String): SaveConfirmation {
		val request = jsonRequest(
			absoluteUrl(action.href),
			method = action.method,
			contentType = action.type ?: "application/json",
			body = mapOf("url" to url),
		).newBuilder().header("Prefer", "return=representation").build()
		val answer = send(request)
		if (answer.status != 201 && answer.status != 200) throw apiError(answer)
		val entity = decodeSiren(answer, SirenDecoding::entity)
		val article = Article.of(entity) ?: throw ApiError.Decoding()
		val messages = entity.properties?.messages.orEmpty().filter { it.isRenderable }
		return SaveConfirmation(article, messages)
	}

	suspend fun saveContent(action: SirenAction, form: MultipartForm): Unit =
		saveContent(action, form.contentType, form.body())

	suspend fun saveContent(action: SirenAction, contentType: String, body: ByteArray): Unit =
		upload(action, contentType, body.toRequestBody(contentType.toMediaTypeOrNull()))

	/** Streams a body the share target staged on disk, so the upload never holds a
	 * second copy of the content in memory. */
	suspend fun saveContent(action: SirenAction, contentType: String, body: File): Unit =
		upload(action, contentType, body.asRequestBody(contentType.toMediaTypeOrNull()))

	private suspend fun upload(action: SirenAction, contentType: String, body: RequestBody) {
		val request = Request.Builder()
			.url(absoluteUrl(action.href))
			.method(action.method, body)
			.header("Content-Type", contentType)
			.build()
		val answer = send(request)
		if (answer.status !in 200..299) throw apiError(answer)
	}

	// endregion

	// region Transport

	private class Answer(val status: Int, val headers: Headers, val body: ByteArray) {
		val contentType: String? get() = headers["Content-Type"]
	}

	private suspend fun send(request: Request, retryOn401: Boolean = true): Answer {
		val token = store.tokens?.accessToken ?: throw ApiError.NoToken()
		val authed = request.newBuilder()
			.header("Authorization", "Bearer ${token.raw}")
			.header("Accept", AppConfig.SIREN_MEDIA_TYPE)
			// Identifies this request as coming from the Android app so the server
			// records onboarding completion per-user (a browser on the same phone can't
			// see the app's cookies, so it can't rely on the extension's cookie signals).
			.header(AppConfig.CLIENT_HEADER, AppConfig.CLIENT_ANDROID)
			.header(AppConfig.SAVE_CONTINUITY_HEADER, AppConfig.SAVE_CONTINUITY_BACKGROUND)
			.header("User-Agent", nativeUserAgent)
			.build()
		val answer = withContext(ioDispatcher) { followingRedirects(authed) }
		if (answer.status == 401 && retryOn401) {
			refreshOrThrowUnauthorized()
			return send(request, retryOn401 = false)
		}
		return answer
	}

	private suspend fun refreshOrThrowUnauthorized() {
		try {
			oauth.refresh()
		} catch (_: OAuthError) {
			throw ApiError.Unauthorized()
		} catch (_: IOException) {
			throw ApiError.Unauthorized()
		}
	}

	/**
	 * Walks redirects by hand. OkHttp's own following drops `Authorization` on a
	 * cross-host hop, and the server redirects the entry point to the collection —
	 * so each hop is built from the response's own `Location` (never from a path the
	 * client constructs) with the headers the client set re-attached
	 * ([RedirectHeaders]). A 307/308 replays the method and body; every other
	 * redirect is followed with a GET, as browsers do. The hop cap is OkHttp's own.
	 */
	private fun followingRedirects(first: Request): Answer {
		var current = first
		var hops = 0
		while (true) {
			val response = http.newCall(current).execute()
			try {
				val next = redirectOf(response, first)
					?: return Answer(response.code, response.headers, response.body.bytes())
				hops += 1
				if (hops > MAX_REDIRECT_HOPS) throw ProtocolException("Too many redirects: $hops")
				current = next
			} finally {
				response.close()
			}
		}
	}

	/** The request for a redirect's target, or null when the response is no
	 * redirect the client can follow — a non-3xx, or a 3xx naming no resolvable
	 * `Location` — in which case it is the final response. */
	private fun redirectOf(response: Response, first: Request): Request? {
		if (!response.isRedirect) return null
		val target = response.header("Location")?.let { response.request.url.resolve(it) } ?: return null
		val replays = response.code == 307 || response.code == 308
		val sent = response.request
		val headers = RedirectHeaders.preserving(
			from = first.headers.toMap(),
			onto = if (replays) sent.headers.toMap() else emptyMap(),
		)
		return Request.Builder()
			.url(target)
			.method(if (replays) sent.method else "GET", if (replays) sent.body else null)
			.headers(headers.toHeaders())
			.build()
	}

	private fun jsonRequest(
		url: HttpUrl,
		method: String,
		contentType: String,
		body: Map<String, String>,
	): Request {
		val payload = JsonObject(body.mapValues { JsonPrimitive(it.value) }).toString()
		return Request.Builder()
			.url(url)
			.method(method, payload.toByteArray(Charsets.UTF_8).toRequestBody(contentType.toMediaTypeOrNull()))
			.header("Content-Type", contentType)
			.build()
	}

	private fun formRequest(
		url: HttpUrl,
		method: String,
		contentType: String,
		fields: Map<String, String>,
	): Request {
		// A GET carries no body — the field values are the query string, so encode
		// them onto the URL and send no Content-Type. POST/other methods form-encode
		// the same values into the body per the action's declared `type`.
		if (method.uppercase() == "GET") {
			val queried = url.newBuilder().query(null)
			for ((name, value) in fields) queried.addQueryParameter(name, value)
			return Request.Builder().url(queried.build()).get().build()
		}
		val form = FormBody.Builder()
		for ((name, value) in fields) form.add(name, value)
		return Request.Builder()
			.url(url)
			.method(method, form.build())
			.header("Content-Type", contentType)
			.build()
	}

	/** Builds the request for a generic action invocation, keeping the body in step
	 * with the action's declared `type`: a GET carries the fields as query items
	 * (no body); an `application/json` action sends a JSON body; any other type
	 * form-encodes the body. The contract ties the encoding to the declared `type`,
	 * so a JSON action must not ship a form-encoded body under a JSON
	 * `Content-Type` header. */
	private fun invocationRequest(action: SirenAction, fields: Map<String, String>): Request {
		val url = absoluteUrl(action.href)
		val type = action.type ?: "application/x-www-form-urlencoded"
		if (action.method.uppercase() != "GET" && MediaType.matches(type, "application/json")) {
			return jsonRequest(url, action.method, type, fields)
		}
		return formRequest(url, action.method, type, fields)
	}

	/** OkHttp refuses to send a POST with no body at all, so a body-less action
	 * carries an empty one (`Content-Length: 0`, no `Content-Type`); a GET or HEAD,
	 * which OkHttp forbids a body on, carries none. */
	private fun emptyBodyFor(method: String): RequestBody? =
		if (method.uppercase() == "GET" || method.uppercase() == "HEAD") null else EMPTY_BODY

	/** The one URL the client knows by itself, composed from the base URL. */
	private fun entryPoint(path: String): HttpUrl =
		"$baseUrl$path".toHttpUrlOrNull() ?: throw ApiError.Decoding()

	/** Resolves a server-declared href to an absolute URL, throwing when the href
	 * is missing or names a scheme the client doesn't act on — an action the client
	 * can't follow is a decode-level failure, not a silent no-op. */
	private fun absoluteUrl(href: String?): HttpUrl {
		val resolved = href?.let { Href.resolve(it, baseUrl) } ?: throw ApiError.Decoding()
		return resolved.toHttpUrlOrNull() ?: throw ApiError.Decoding()
	}

	/** Decodes a body the client negotiated as Siren, verifying the response's
	 * media type first. A 200/201 carrying anything but the negotiated Siren type
	 * (a proxy HTML page, a future media type) is surfaced as
	 * [ApiError.UnsupportedMediaType] rather than blind-decoded into a decode
	 * failure. The surfaced decode error stays the opaque [ApiError.Decoding]:
	 * which key or type mismatched is never handed to the caller. */
	private fun <T : Any> decodeSiren(answer: Answer, decode: (JsonElement) -> T?): T {
		if (!isSirenMediaType(answer.contentType)) throw ApiError.UnsupportedMediaType(answer.contentType)
		return jsonElementOf(answer.body)?.let(decode) ?: throw ApiError.Decoding()
	}

	/** Whether a `Content-Type` header is the negotiated Siren media type, ignoring
	 * any `;charset=…` parameters and surrounding case. */
	private fun isSirenMediaType(header: String?): Boolean =
		MediaType.matches(header, AppConfig.SIREN_MEDIA_TYPE)

	private fun jsonElementOf(body: ByteArray): JsonElement? =
		try {
			Json.parseToJsonElement(String(body, Charsets.UTF_8))
		} catch (_: SerializationException) {
			null
		}

	private fun apiError(answer: Answer): ApiError {
		if (answer.status == 401) return ApiError.Unauthorized()
		val sirenError = jsonElementOf(answer.body)?.let { SirenDecoding.errorBody(it) }
		refusalError(sirenError)?.let { return it }
		if (sirenError != null) {
			return ApiError.Server(answer.status, sirenError.properties.code, sirenError.properties.message)
		}
		return ApiError.Server(answer.status, code = null, serverMessage = null)
	}

	/** The message-only refusal (e.g. a locked account) an error body carries, or
	 * null when it isn't one. Detected before the generic server error (and before
	 * the save-content fallback) so the refusal surfaces as [ApiError.Refused]
	 * rather than a generic save failure. The refusal carries no action — nothing
	 * to follow.
	 *
	 * Messages whose media type the client can't render are dropped (be liberal in
	 * what you accept, conservative in what you render); a refusal left with no
	 * renderable message is treated as not-a-refusal so it never shows blank. */
	private fun refusalError(sirenError: SirenErrorBody?): ApiError? {
		val messages = sirenError?.properties?.messages ?: return null
		val renderable = messages.filter { it.isRenderable }
		if (renderable.isEmpty()) return null
		return ApiError.Refused(renderable)
	}

	// endregion

	companion object {
		const val DEFAULT_MAX_EXTERNAL_CONTENT_BYTES: Long = 25L * 1024 * 1024
		private const val MAX_REDIRECT_HOPS = 20
		private const val READ_CHUNK_BYTES = 8 * 1024
		private val EMPTY_BODY: RequestBody = ByteArray(0).toRequestBody(null)
	}
}
