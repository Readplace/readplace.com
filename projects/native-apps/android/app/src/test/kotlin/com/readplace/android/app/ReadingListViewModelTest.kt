package com.readplace.android.app

import com.readplace.android.RecordingServer
import com.readplace.android.RecordingServer.Record
import com.readplace.android.RecordingServer.Stub
import com.readplace.android.core.AccessToken
import com.readplace.android.core.ApiError
import com.readplace.android.core.AppConfig
import com.readplace.android.core.Article
import com.readplace.android.core.EphemeralCookieJar
import com.readplace.android.core.OAuth
import com.readplace.android.core.OAuthTokens
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.RefreshToken
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink
import com.readplace.android.core.TokenKey
import com.readplace.android.core.TokenStorage
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UnseenSave
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class ReadingListViewModelTest {
	@get:Rule
	val server = RecordingServer()

	@get:Rule
	val folder = TemporaryFolder()

	private class RecordingTokenStorage : TokenStorage {
		val stored = mutableMapOf<TokenKey, String>()

		override fun readValue(key: TokenKey): Result<String?> = Result.success(stored[key])

		override fun setValue(key: TokenKey, value: String) {
			stored[key] = value
		}

		override fun removeValue(key: TokenKey) {
			stored.remove(key)
		}
	}

	private fun loggedInStore(): TokenStore {
		val store = TokenStore(RecordingTokenStorage())
		store.save(OAuthTokens(AccessToken("access-1"), RefreshToken("refresh-1")))
		return store
	}

	private fun TestScope.api(store: TokenStore): ReadplaceApi {
		val client = OkHttpClient.Builder().cookieJar(EphemeralCookieJar()).followRedirects(false).build()
		val oauth = OAuth(baseUrl = server.baseUrl, store = store, http = OkHttpClient())
		return ReadplaceApi(server.baseUrl, client, store, oauth, "Readplace/1 Android/16", StandardTestDispatcher(testScheduler))
	}

	/** A heal or a drain no test asked for is a wrong turn, not a silent no-op:
	 * `Error` is outside the view model's `Exception` catch, so it fails the test. */
	private fun TestScope.viewModel(
		store: TokenStore = loggedInStore(),
		unseenSave: UnseenSave = UnseenSave(folder.newFolder()),
		healBlockedArticle: suspend (String) -> HealBlockedOutcome = { throw AssertionError("no heal expected for $it") },
		drainUploadJobs: suspend () -> Unit = { throw AssertionError("no drain expected") },
		onSessionExpired: () -> Unit = {},
	): ReadingListViewModel =
		ReadingListViewModel(
			api = api(store),
			unseenSave = unseenSave,
			healBlockedArticle = healBlockedArticle,
			drainUploadJobs = drainUploadJobs,
			onSessionExpired = onSessionExpired,
		)

	private val ReadingListViewModel.articleIds: List<String> get() = state.value.articles.map { it.id }

	private val ReadingListViewModel.toolbarTokens: List<String> get() = state.value.collectionAffordances.map { it.token }

	private val Record.page: String? get() = request.url.queryParameter("page")

	private fun firstPageReads(): Int = server.records("/queue").count { it.request.url.query == null }

	private fun formFields(body: ByteArray): Map<String, String> =
		String(body, Charsets.UTF_8).split("&")
			.filter { it.isNotEmpty() }
			.associate { pair ->
				val (name, value) = pair.split("=", limit = 2)
				URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
			}

	/** The action the server advertised on a row, looked up by iterating its
	 * affordances — the same path the view does — so the test invokes the action
	 * the loop would render rather than a hand-built one. */
	private fun advertisedAction(article: Article, token: String): SirenAction =
		checkNotNull(article.affordances.first { it.token == token }.action)

	private fun article(readHref: String?, id: String = "a1"): Article =
		Article(
			id = id, url = "https://example.com/x", title = "X", siteName = null, excerpt = null,
			imageUrl = null, readTimeLabel = null, isRead = false, savedAt = null,
			actions = emptyList(), links = emptyList(), readHref = readHref,
		)

	private val purgeAction = SirenAction(
		name = "purge-all", href = "/queue/purge", method = "POST", title = "Purge", type = null, fields = null,
	)

	/** A locked account: the readlist loads, but invoking a collection action is refused
	 * with a server-authored message. */
	private fun lockedAccountHandler(): (Record) -> Stub = { record ->
		when (record.path) {
			"/" -> Stub.redirect(to = "/queue")
			"/queue/purge" -> Stub.json(403, Fixtures.accountLockedError())
			"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
			else -> Stub.json(404, "{}")
		}
	}

	/** A two-item readlist whose `/queue/{id}/status` POST behaves per `statusStub`.
	 * The first collection GET serves the two rows; when `laterReadlist` is given,
	 * every subsequent collection GET serves it instead — the post-action truth a
	 * followed redirect (or a convergence load) returns. */
	private fun markReadHandler(laterReadlist: String? = null, statusStub: (String) -> Stub): (Record) -> Stub {
		val readlistGets = AtomicInteger()
		return { record ->
			when {
				record.path.endsWith("/status") -> statusStub(record.path)
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" && readlistGets.incrementAndGet() > 1 && laterReadlist != null -> Stub.json(200, laterReadlist)
				record.path == "/queue" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), total = 2))
				else -> Stub.json(404, "{}")
			}
		}
	}

	/** A two-page readlist; `firstPage` answers every first-page read. */
	private fun twoPageHandler(firstPage: (Record) -> Stub): (Record) -> Stub = { record ->
		when {
			record.path == "/" -> Stub.redirect(to = "/queue")
			record.path == "/queue" && record.page == "2" ->
				Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a3"), Fixtures.article("a4")), page = 2))
			record.path == "/queue" -> firstPage(record)
			else -> Stub.json(404, "{}")
		}
	}

	private fun twoPageHandler(): (Record) -> Stub =
		twoPageHandler {
			Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
		}

	/** A three-page readlist. */
	private fun threePageHandler(): (Record) -> Stub = { record ->
		when {
			record.path == "/" -> Stub.redirect(to = "/queue")
			record.path == "/queue" && record.page == "3" ->
				Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a5"), Fixtures.article("a6")), page = 3))
			record.path == "/queue" && record.page == "2" ->
				Stub.json(
					200,
					Fixtures.collection(
						listOf(Fixtures.article("a3"), Fixtures.article("a4")),
						extraLinks = """, { "rel": ["next"], "href": "/queue?page=3" }""",
						page = 2,
					),
				)
			record.path == "/queue" ->
				Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
			else -> Stub.json(404, "{}")
		}
	}

	/** A two-page readlist behind a flippable "account deleted" switch: once flipped,
	 * the server behaves as `POST /account/delete` leaves it — every authenticated
	 * call 401s and the token refresh is rejected (all sessions destroyed, all
	 * OAuth tokens revoked). */
	private fun deletableAccountHandler(accountDeleted: AtomicBoolean): (Record) -> Stub {
		val live = twoPageHandler()
		return { record ->
			when {
				accountDeleted.get() -> if (record.path == "/oauth/token") Stub.json(400, "{}") else Stub.json(401, "{}")
				else -> live(record)
			}
		}
	}

	/** A one-item readlist; from the second collection GET on, `laterReadlist` (when
	 * given) is served instead — the truth a landed heal reconciles with. */
	private fun blockedCaptureHandler(laterReadlist: String? = null): (Record) -> Stub {
		val readlistGets = AtomicInteger()
		return { record ->
			when {
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" && readlistGets.incrementAndGet() > 1 && laterReadlist != null -> Stub.json(200, laterReadlist)
				record.path == "/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
	}

	// region Add-links help (client-side)

	@Test
	fun `the add-links help URL is the client-held help path with the app-shell marker`() = runTest {
		// The + control opens the help page at a path the client holds, resolved
		// against the API base — not a link discovered from the server — so it is
		// available before (and regardless of) any readlist load. It carries the
		// app-shell marker so the server serves it chromeless, with the deep-link
		// back to the native list this sheet intercepts.
		val viewModel = viewModel()

		assertEquals("${server.baseUrl}/help/add-links?shell=app", viewModel.addLinksHelpUrl)
	}

	// endregion

	// region Locked account

	@Test
	fun `a refused collection invoke surfaces the server's messages`() = runTest {
		server.handle(lockedAccountHandler())
		val viewModel = viewModel()

		viewModel.refresh()
		viewModel.invokeCollection(purgeAction)

		assertEquals(
			"the refusal message names the address to email",
			listOf(ServerMessage("warning", ServerMessage.Content("text/html", Fixtures.LOCKED_MESSAGE))),
			viewModel.state.value.messages,
		)
	}

	@Test
	fun `a successful refresh clears a stale refusal banner`() = runTest {
		server.handle(lockedAccountHandler())
		val viewModel = viewModel()

		viewModel.refresh()
		viewModel.invokeCollection(purgeAction)
		assertEquals("precondition: a refused invoke shows the banner", 1, viewModel.state.value.messages.size)

		viewModel.refresh()

		assertEquals(
			"a locked account's reads still succeed, so a fresh load reconciles the stale banner",
			emptyList<ServerMessage>(),
			viewModel.state.value.messages,
		)
	}

	// endregion

	// region Save affordance gating

	@Test
	fun `the toolbar surfaces only the client add control for a default collection`() = runTest {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		assertEquals(
			"the client-side + control is present before any response advertises affordances",
			listOf("add-links-help"),
			viewModel.toolbarTokens,
		)

		viewModel.refresh()

		assertEquals(
			"the server's collection actions — save-article, the capture-only save-content, and the " +
				"field-requiring search — are all dropped client-side, leaving only the client + control",
			listOf("add-links-help"),
			viewModel.toolbarTokens,
		)
	}

	@Test
	fun `the toolbar keeps exactly one add control when the server also advertises add-links-help`() = runTest {
		// The + is client-owned and always injected. Should the server ever
		// re-advertise add-links-help (a rollback of the server change, or another
		// surface re-adding it), the client drops the server's same-token affordance so
		// the toolbar renders exactly one + — the client's canonical one — never a
		// duplicate. The server's advertised href differs so the survivor is identifiable.
		val serverAddLinksHelp = """, { "rel": ["add-links-help"], "href": "/help/legacy-add-links", "title": "Old help" }"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), extraLinks = serverAddLinksHelp))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()

		viewModel.refresh()

		val addControls = viewModel.state.value.collectionAffordances.filter { it.token == "add-links-help" }
		assertEquals(
			"a server-advertised add-links-help is de-duped against the client-injected + — exactly one renders",
			1,
			addControls.size,
		)
		assertEquals(
			"the surviving + is the client's canonical control (its own help path), not the server's advertised href",
			AppConfig.ADD_LINKS_HELP_PATH,
			addControls.single().link?.href,
		)
	}

	@Test
	fun `the toolbar drops search because it is not invokable by a bare control`() = runTest {
		// The real server advertises `search` with fields the user must fill and no
		// pre-filled value; the app has no query UI for it, so the client must not
		// surface a control it cannot actually invoke (it would just open /queue in a
		// webview).
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()

		viewModel.refresh()

		assertEquals(
			"a field-requiring action with no server value is not surfaced as a toolbar control",
			listOf("add-links-help"),
			viewModel.toolbarTokens,
		)
	}

	@Test
	fun `the toolbar excludes capture-only saves and structural links`() = runTest {
		// A collection carrying a navigable `save` link, structural `prev`/`next`
		// pagination links, and the capture-only saves: only the controls the client
		// can present as toolbar buttons survive. The structural rels the client
		// follows itself for pagination/identity never become user controls.
		val extraLinks = """
			, { "rel": ["save"], "href": "/save", "title": "Save a link" }
			, { "rel": ["prev"], "href": "/queue?page=0" }
			, { "rel": ["next"], "href": "/queue?page=2" }
		"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), extraLinks = extraLinks))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()

		viewModel.refresh()

		assertEquals(
			"save-article, capture-only saves, the field-requiring search, and structural rels (self/root/prev/next) " +
				"never render; a navigable save link does, and the client + control is always appended",
			listOf("save", "add-links-help"),
			viewModel.toolbarTokens,
		)
	}

	@Test
	fun `the toolbar renders whatever actions the server offers`() = runTest {
		// A server advertising only a single bare-invokable action still drives a
		// control — the loop never gates on whether a known save action is present.
		val futureOnly = """{ "name": "purge-all", "title": "Purge", "href": "/queue/purge", "method": "POST" }"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), actionsJson = futureOnly))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()

		viewModel.refresh()

		assertEquals(
			"a server offering an unknown bare-invokable action still renders its advertised controls",
			listOf("purge-all"),
			viewModel.state.value.collectionAffordances.mapNotNull { it.action?.name },
		)
	}

	@Test
	fun `the toolbar tracks the current response's affordances`() = runTest {
		val futureOnly = """{ "name": "purge-all", "title": "Purge", "href": "/queue/purge", "method": "POST" }"""
		val readlistGets = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" ->
					if (readlistGets.incrementAndGet() == 1) {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), actionsJson = futureOnly))
					}
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()

		viewModel.refresh()
		assertEquals(
			"precondition: the first collection advertises no toolbar-presentable server action, so only the client + control shows",
			listOf("add-links-help"),
			viewModel.toolbarTokens,
		)

		viewModel.refresh()

		assertEquals(
			"the toolbar reflects the current response: a later collection's bare-invokable action renders alongside the client + control",
			listOf("purge-all", "add-links-help"),
			viewModel.toolbarTokens,
		)
	}

	@Test
	fun `loadMore retains the first-page toolbar when a paginated page advertises no actions`() = runTest {
		// A paginated (load-more) page only appends rows. When it advertises no
		// collection actions, the toolbar must neither clear nor flap to a page-scoped
		// set: the first page owns the toolbar for the whole scroll, so the controls
		// it discovered survive the load-more.
		server.handle { record ->
			when {
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" && record.page == "2" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a2")), page = 2, actionsJson = ""))
				record.path == "/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1")), extraLinks = NEXT_LINK))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()

		viewModel.refresh()
		assertEquals("precondition: the first-page load owns a toolbar (the client + control)", listOf("add-links-help"), viewModel.toolbarTokens)
		assertTrue("precondition: the first page advertises a next page", viewModel.state.value.hasMore)

		viewModel.loadMore()

		assertEquals("the second page's rows are appended", listOf("a1", "a2"), viewModel.articleIds)
		assertFalse("the last page advertises no next page", viewModel.state.value.hasMore)
		assertEquals(
			"an actionless paginated page leaves the first-page toolbar in place — it does not clear it",
			listOf("add-links-help"),
			viewModel.toolbarTokens,
		)
	}

	@Test
	fun `loadMore on a list with no next page issues no request`() = runTest {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		assertFalse("precondition: the only page advertises no next page", viewModel.state.value.hasMore)

		viewModel.loadMore()

		assertEquals("there is no href to follow, so nothing is fetched", 1, server.records("/queue").size)
		assertEquals(listOf("a1"), viewModel.articleIds)
	}

	@Test
	fun `two loadMore calls racing one another fetch the next page once`() = runTest {
		// The list's end-of-content trigger can fire repeatedly while a page is on
		// the wire; a page load already under way owns the href, so the second call
		// steps aside instead of appending the same rows twice.
		server.handle(twoPageHandler())
		val viewModel = viewModel()
		viewModel.refresh()

		val first = launch { viewModel.loadMore() }
		val second = launch { viewModel.loadMore() }
		first.join()
		second.join()

		assertEquals("one fetch of the next page", 1, server.records("/queue").count { it.page == "2" })
		assertEquals(listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)
	}

	@Test
	fun `loadMore surfaces a failed page load and leaves the list in place`() = runTest {
		val nextPageDown = AtomicBoolean(true)
		server.handle { record ->
			when {
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" && record.page == "2" && nextPageDown.get() ->
					Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope"))
				record.path == "/queue" && record.page == "2" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a3"), Fixtures.article("a4")), page = 2))
				record.path == "/queue" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()

		viewModel.loadMore()

		assertEquals("nope", viewModel.state.value.errorText)
		assertEquals("a failed page load leaves the rows already on screen in place", listOf("a1", "a2"), viewModel.articleIds)
		assertTrue("the failed read did not consume the next href — the page is still owed", viewModel.state.value.hasMore)

		nextPageDown.set(false)
		viewModel.loadMore()

		assertEquals(
			"the failure released the in-flight guard, so the same page is retried on the next end-of-content trigger",
			listOf("a1", "a2", "a3", "a4"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `loadMore skips rows the list already holds and appends the rest in order`() = runTest {
		server.handle { record ->
			when {
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" && record.page == "2" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a2"), Fixtures.article("a3")), page = 2))
				record.path == "/queue" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals("precondition: the first page is loaded", listOf("a1", "a2"), viewModel.articleIds)

		viewModel.loadMore()

		assertEquals(
			"a page boundary shifted by a save between the two reads repeats the row that closed page 1: " +
				"the rows on screen keep their order, the repeat is skipped, and only the new row is appended",
			listOf("a1", "a2", "a3"),
			viewModel.articleIds,
		)
		assertFalse("the last page advertises no next page", viewModel.state.value.hasMore)
	}

	@Test
	fun `invokeCollection submits the action and reloads from the server`() = runTest {
		val readlistGets = AtomicInteger()
		server.handle { record ->
			when {
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue/purge" && record.method == "POST" -> Stub.redirect(to = "/queue")
				record.path == "/queue" ->
					if (readlistGets.incrementAndGet() == 1) {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
					} else {
						Stub.json(200, Fixtures.collection(emptyList()))
					}
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1"), viewModel.articleIds)

		viewModel.invokeCollection(purgeAction)

		assertEquals("POST", server.records("/queue/purge").first().method)
		assertEquals("the reload reflects the server's post-invoke state", emptyList<String>(), viewModel.articleIds)
		assertNull("an action is invoked, never opened in the web view", viewModel.state.value.readerPresentation)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `invokeCollection surfaces a server error and leaves the list in place`() = runTest {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue/purge" -> Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope"))
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()

		viewModel.invokeCollection(purgeAction)

		assertEquals("a failed collection invoke leaves the current list", listOf("a1"), viewModel.articleIds)
		assertEquals("nope", viewModel.state.value.errorText)
	}

	@Test
	fun `invokeCollection falls back to a fresh load when the response is no collection`() = runTest {
		// A collection action whose 2xx response is not a Siren collection (a 204, or
		// a redirect to an HTML confirmation) carries no collection to adopt, so the
		// view model re-lists from the entry point to reflect the new server state.
		val readlistGets = AtomicInteger()
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue/purge" -> Stub(204)
				"/queue" ->
					if (readlistGets.incrementAndGet() == 1) {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
					} else {
						Stub.json(200, Fixtures.collection(emptyList()))
					}
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1"), viewModel.articleIds)

		viewModel.invokeCollection(purgeAction)

		assertEquals("with no collection to adopt, the invoke falls back to a fresh first-page load", 2, readlistGets.get())
		assertEquals("the fallback reload reflects the server's post-invoke state", emptyList<String>(), viewModel.articleIds)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `open(link) publishes a web sheet with no row attached`() = runTest {
		val viewModel = viewModel()

		viewModel.open(SirenLink(rel = listOf("save"), href = "/save", title = "Save a link"))

		val presentation = checkNotNull(viewModel.state.value.readerPresentation)
		assertEquals("${server.baseUrl}/save?shell=app", presentation.readerUrl)
		assertNull("a navigable collection link is not tied to a row", presentation.articleId)
		assertEquals("a row-less sheet is keyed by its URL", "${server.baseUrl}/save?shell=app", presentation.id)
	}

	/** The server publishes the account href already carrying `?platform=ios`; the
	 * app adds its own capability marker on top, so the page comes back chromeless
	 * with a deep link the sheet can execute. Both markers must survive. */
	@Test
	fun `open(link) keeps the server's own query and adds the app-shell marker`() = runTest {
		val viewModel = viewModel()

		viewModel.open(SirenLink(rel = listOf("account"), href = "/account?platform=ios", title = "Account"))

		assertEquals("${server.baseUrl}/account?platform=ios&shell=app", viewModel.state.value.readerPresentation?.readerUrl)
	}

	@Test
	fun `open(link) is a no-op for a foreign-scheme href`() = runTest {
		val viewModel = viewModel()

		viewModel.open(SirenLink(rel = listOf("save"), href = "mailto:hi@example.com", title = null))

		assertNull("an href the client can't resolve never opens a blank sheet", viewModel.state.value.readerPresentation)
	}

	@Test
	fun `open(link) is a no-op for a link advertised without an href`() = runTest {
		val viewModel = viewModel()

		viewModel.open(SirenLink(rel = listOf("save"), href = null, title = "Save a link"))

		assertNull("an unactionable link never opens a blank sheet", viewModel.state.value.readerPresentation)
	}

	// endregion

	// region Mark as read

	@Test
	fun `invoking update-status adopts the server's post-action collection`() = runTest {
		// The status POST redirects back to the collection; that followed body is
		// the post-action truth and replaces the list — the marked row is gone and
		// an item marked unread on the website (w1) appears without a refresh.
		val postAction = Fixtures.collection(listOf(Fixtures.article("a2"), Fixtures.article("w1")), total = 2)
		server.handle(markReadHandler(laterReadlist = postAction) { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1", "a2"), viewModel.articleIds)

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "update-status"), target)

		assertEquals(
			"the followed collection is adopted: the marked row is gone and a website-side unread item appears",
			listOf("a2", "w1"),
			viewModel.articleIds,
		)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `invoking on a deep-scrolled list drops the row locally and holds position`() = runTest {
		// Acting on a row after paginating must neither collapse the list to page 1
		// (yanking the reader to the top) nor splice a fresh server head above the
		// viewport (shifting it). A deep-scrolled list stays exactly where it is: only
		// the acted row is dropped, and the server's post-action collection — served
		// here as a sentinel [zzz] the client must NOT adopt — is ignored until the
		// next pull-to-refresh.
		val page1Gets = AtomicInteger()
		server.handle { record ->
			when {
				record.path.endsWith("/status") -> Stub.redirect(to = "/queue")
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" && record.page == "2" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a3"), Fixtures.article("a4")), page = 2))
				record.path == "/queue" ->
					if (page1Gets.incrementAndGet() == 1) {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("zzz"))))
					}
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		val target = viewModel.state.value.articles[2]
		viewModel.invoke(advertisedAction(target, "update-status"), target)

		assertEquals(
			"only the acted row is dropped; the list holds position and does not adopt the server's [zzz] collection while deep-scrolled",
			listOf("a1", "a2", "a4"),
			viewModel.articleIds,
		)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `handleForeground on a deep-scrolled list holds position without reloading`() = runTest {
		// Returning to the foreground while deep-scrolled must not re-read the list —
		// that would collapse it to page 1 and lose the user's position. With no
		// share-sheet save recorded, the convergence no-ops (no extra GET), leaving
		// the paginated list intact.
		server.handle(twoPageHandler())
		val viewModel = viewModel()
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		viewModel.handleForeground()

		assertEquals("a deep-scrolled foreground with no recorded save does not re-read the first page", 1, firstPageReads())
		assertEquals(
			"the paginated list is held in place — reconciliation waits for a pull-to-refresh or a recorded save",
			listOf("a1", "a2", "a3", "a4"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `invoking update-status keeps the row when it toggles back to unread`() = runTest {
		// A read item's update-status toggles to "unread", which stays in the
		// unread-only list — and the adopted post-action collection still carries
		// the row, so it stays in place.
		val readArticle = """
			{ "class": ["article"], "rel": ["item"],
				"properties": { "id": "a1", "url": "https://example.com/x", "status": "read" },
				"links": [{ "rel": ["read"], "href": "/queue/a1/view" }],
				"actions": [
					{ "name": "update-status", "href": "/queue/a1/status", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "status", "type": "text", "value": "unread" }] }
				] }
		"""
		server.handle { record ->
			when {
				record.path.endsWith("/status") -> Stub.redirect(to = "/queue")
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" -> Stub.json(200, Fixtures.collection(listOf(readArticle)))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1"), viewModel.articleIds)

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "update-status"), target)

		assertEquals("a toggle back to unread leaves the row in the unread-only list", listOf("a1"), viewModel.articleIds)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `invoking sends the status field for update-status`() = runTest {
		server.handle(markReadHandler { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "update-status"), target)

		val record = server.records("/queue/a1/status").first()
		assertEquals(
			"update-status carries the protocol-fixed status field, set to read",
			mapOf("status" to "read"),
			formFields(record.body),
		)
	}

	@Test
	fun `invoking leaves the list in place on a server error`() = runTest {
		server.handle(markReadHandler { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) })
		val viewModel = viewModel()
		viewModel.refresh()

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "update-status"), target)

		assertEquals(
			"a failed invocation leaves the current list in place — nothing was dropped ahead of the server",
			listOf("a1", "a2"),
			viewModel.articleIds,
		)
		assertEquals("nope", viewModel.state.value.errorText)
	}

	@Test
	fun `invoking an action advertised without an href surfaces the failure and leaves the list`() = runTest {
		// An href-less action builds no control and can't be followed: the generic
		// invoker refuses it as a decode failure, and — like any other failed invoke —
		// nothing is dropped ahead of the server.
		server.handle(markReadHandler { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()
		val target = viewModel.state.value.articles[0]
		val hrefless = SirenAction(name = "delete", href = null, method = "POST", title = null, type = null, fields = null)

		viewModel.invoke(hrefless, target)

		assertEquals(listOf("a1", "a2"), viewModel.articleIds)
		assertEquals("Could not read the server response.", viewModel.state.value.errorText)
	}

	@Test
	fun `invoking delete adopts the server's post-action collection`() = runTest {
		val readlistGets = AtomicInteger()
		server.handle { record ->
			when {
				record.path.endsWith("/delete") -> Stub.redirect(to = "/queue")
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" ->
					if (readlistGets.incrementAndGet() == 1) {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), total = 2))
					} else {
						Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a2"))))
					}
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "delete"), target)

		assertEquals("the deleted item is gone from the adopted post-action collection", listOf("a2"), viewModel.articleIds)
	}

	@Test
	fun `invoking drops the acted row when the response is no collection`() = runTest {
		// A removing action (delete) whose 2xx response is not a Siren collection —
		// a 204, or a redirect to an HTML page — carries no re-list direction, so
		// api.invoke returns null. The acted row must still drop locally, honouring
		// the removal the server already confirmed with its 2xx.
		server.handle { record ->
			when {
				record.path.endsWith("/delete") ->
					Stub(200, headers = mapOf("Content-Type" to "text/html"), body = "<!doctype html>".toByteArray())
				record.path == "/" -> Stub.redirect(to = "/queue")
				record.path == "/queue" ->
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), total = 2))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "delete"), target)

		assertEquals(
			"the confirmed removal is applied locally even when the response carries no collection to adopt",
			listOf("a2"),
			viewModel.articleIds,
		)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `invoking a non-removing action leaves the list untouched`() = runTest {
		// A response that is no collection carries no re-list direction, so the
		// list stays as it is for the next load to reconcile.
		val articleWithView = """
			{ "class": ["article"], "properties": { "id": "a1", "url": "https://example.com/x" },
				"actions": [{ "name": "view-original", "title": "Open original", "href": "/queue/a1/original", "method": "GET" }] }
		"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(articleWithView)))
				"/queue/a1/original" -> Stub(200, headers = mapOf("Content-Type" to "text/html"), body = "<!doctype html>".toByteArray())
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1"), viewModel.articleIds)

		val target = viewModel.state.value.articles[0]
		viewModel.invoke(advertisedAction(target, "view-original"), target)

		assertEquals("a non-removing action whose response is no collection leaves the row in place", listOf("a1"), viewModel.articleIds)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `readerStatusChanged converges with the server without inferring direction`() = runTest {
		// The reader's own POST already happened inside the webview, but the client
		// can't see which direction the toggle went, so it does not infer "read" and
		// drop a row — it re-reads the collection and adopts the server's truth, which
		// no longer lists the read item (a1) and brings in an item marked unread on
		// the website (w1).
		val postAction = Fixtures.collection(listOf(Fixtures.article("a2"), Fixtures.article("w1")), total = 2)
		server.handle(markReadHandler(laterReadlist = postAction) { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()

		viewModel.readerStatusChanged()

		assertEquals(
			"the server's re-read collection is adopted as truth; no row is dropped by inference",
			listOf("a2", "w1"),
			viewModel.articleIds,
		)
		assertEquals(
			"the reader already posted inside the webview; the app itself issues no POST — only the convergence GET",
			emptyList<String>(),
			server.records.mapNotNull { it.method }.filter { it == "POST" },
		)
	}

	@Test
	fun `readerStatusChanged steps aside for an in-flight foreground re-read`() = runTest {
		server.handle(markReadHandler { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()

		val foreground = launch { viewModel.handleForeground() }
		val readerReport = launch { viewModel.readerStatusChanged() }
		foreground.join()
		readerReport.join()

		assertEquals("setup's read plus the foreground re-read — the reader's report did not add a third", 2, firstPageReads())
		assertEquals(listOf("a1", "a2"), viewModel.articleIds)
		assertFalse(viewModel.state.value.isLoading)
	}

	// endregion

	// region Foreground refresh

	@Test
	fun `handleForeground converges the loaded list with the server`() = runTest {
		val postForeground = Fixtures.collection(
			listOf(Fixtures.article("a1"), Fixtures.article("a2"), Fixtures.article("w1")),
			total = 3,
		)
		server.handle(markReadHandler(laterReadlist = postForeground) { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1", "a2"), viewModel.articleIds)

		viewModel.handleForeground()

		assertEquals(
			"returning to the foreground re-reads the list, so a website-side change appears without pull-to-refresh",
			listOf("a1", "a2", "w1"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `handleForeground before the first load is a no-op`() = runTest {
		server.handle(markReadHandler { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()

		viewModel.handleForeground()

		assertEquals(
			"at launch the initial load owns the fetch — the foreground hook does not race it with a second one",
			0,
			server.records.size,
		)
		assertEquals(emptyList<String>(), viewModel.articleIds)
	}

	@Test
	fun `a shallow foreground re-read steps aside for an in-flight refresh`() = runTest {
		// The same in-flight guard on the shallow path: a pull-to-refresh already on
		// the wire owns the first-page read, so the foreground adds no second one.
		server.handle(markReadHandler { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()

		val pull = launch { viewModel.refresh() }
		val foreground = launch { viewModel.handleForeground() }
		pull.join()
		foreground.join()

		assertEquals("setup's read plus the pull-to-refresh — the foreground did not add a third", 2, firstPageReads())
		assertEquals(listOf("a1", "a2"), viewModel.articleIds)
	}

	@Test
	fun `handleForeground on a deep-scrolled list reloads when a share-sheet save is pending`() = runTest {
		// A share-sheet save recorded while the app was away is the one change worth
		// the same first-page reset a pull-to-refresh performs: the deep-scrolled
		// hold gives way, the list converges to the server's new first page — where
		// the fresh link is — and the marker is consumed so the next return holds
		// position again.
		val saved = AtomicBoolean(false)
		server.handle(
			twoPageHandler {
				val entities = if (saved.get()) {
					listOf(Fixtures.article("shared"), Fixtures.article("a1"), Fixtures.article("a2"))
				} else {
					listOf(Fixtures.article("a1"), Fixtures.article("a2"))
				}
				Stub.json(200, Fixtures.collection(entities, extraLinks = NEXT_LINK))
			},
		)
		val unseenSave = UnseenSave(folder.newFolder())
		val viewModel = viewModel(unseenSave = unseenSave)
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		saved.set(true)
		unseenSave.record()
		viewModel.handleForeground()

		assertEquals(
			"a recorded share-sheet save resets the deep-scrolled list to the first page, where the new link is",
			listOf("shared", "a1", "a2"),
			viewModel.articleIds,
		)
		assertFalse("the reload consumed the marker — the next return holds position again", unseenSave.exists)
	}

	@Test
	fun `handleForeground on a deep-scrolled list re-reads only when a save is pending`() = runTest {
		server.handle(twoPageHandler())
		val unseenSave = UnseenSave(folder.newFolder())
		val viewModel = viewModel(unseenSave = unseenSave)
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)
		val requestsBeforeReturn = server.records.size

		viewModel.handleForeground()

		assertEquals("with no save recorded, a deep-scrolled return issues no request at all", requestsBeforeReturn, server.records.size)
		assertEquals(listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		unseenSave.record()
		viewModel.handleForeground()

		assertEquals("a recorded save is what lets the return re-read the first page", 2, firstPageReads())
		assertEquals("the re-read resets the list to the first page", listOf("a1", "a2"), viewModel.articleIds)
		assertTrue("the reset list can paginate again from its first page", viewModel.state.value.hasMore)
		assertFalse("the re-read consumed the marker", unseenSave.exists)
	}

	@Test
	fun `handleForeground with a pending save steps aside for an in-flight page load`() = runTest {
		// A pending-save reset that ran while `loadMore` had a page in flight would
		// let the stale append land on top of the fresh first page — a gap where
		// the boundary row was and a cursor pointing past rows never shown. The
		// reset waits for the next return instead, and the marker survives for it.
		server.handle(threePageHandler())
		val unseenSave = UnseenSave(folder.newFolder())
		val viewModel = viewModel(unseenSave = unseenSave)
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)
		unseenSave.record()

		// `loadMore` marks itself in flight before its first suspension, so the
		// foreground that follows finds it under way.
		val pageLoad = launch { viewModel.loadMore() }
		val foreground = launch { viewModel.handleForeground() }
		pageLoad.join()
		foreground.join()

		assertEquals("the setup read is the only first-page read; the foreground stepped aside", 1, firstPageReads())
		assertTrue("the marker survives, so the next return performs the reset", unseenSave.exists)
		assertEquals(
			"the list is exactly what the page loads composed — no reset landed under the append",
			listOf("a1", "a2", "a3", "a4", "a5", "a6"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `handleForeground with a pending save steps aside for an in-flight first-page load`() = runTest {
		// The same rule against the other in-flight load: a pull-to-refresh already
		// on the wire owns the first-page read, and its response consumes the marker.
		server.handle(threePageHandler())
		val unseenSave = UnseenSave(folder.newFolder())
		val viewModel = viewModel(unseenSave = unseenSave)
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)
		unseenSave.record()

		val pull = launch { viewModel.refresh() }
		val foreground = launch { viewModel.handleForeground() }
		pull.join()
		foreground.join()

		assertEquals("setup's read plus the pull-to-refresh — the foreground did not add a third", 2, firstPageReads())
		assertFalse("the pull-to-refresh showed first-page truth and consumed the marker", unseenSave.exists)
	}

	@Test
	fun `a failed foreground reset keeps the pending save marker for the next return`() = runTest {
		// If the reset's first-page read fails, nothing new was shown, so the marker
		// must remain — otherwise a transient error would silently forfeit the
		// automatic refresh for that save.
		val serverDown = AtomicBoolean(false)
		server.handle(
			twoPageHandler {
				if (serverDown.get()) {
					Stub.json(500, "{}")
				} else {
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
				}
			},
		)
		val unseenSave = UnseenSave(folder.newFolder())
		val viewModel = viewModel(unseenSave = unseenSave)
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		unseenSave.record()
		serverDown.set(true)
		viewModel.handleForeground()

		assertEquals("the failed read is surfaced like any other failed refresh", "Server error 500.", viewModel.state.value.errorText)
		assertTrue("nothing new was shown, so the save is still owed a refresh", unseenSave.exists)
	}

	@Test
	fun `a paginated append leaves the pending save marker alone`() = runTest {
		// Loading a deeper page shows more of the same list, never a fresh first
		// page, so it must not consume the marker: the save is still unseen.
		server.handle(twoPageHandler())
		val unseenSave = UnseenSave(folder.newFolder())
		val viewModel = viewModel(unseenSave = unseenSave)
		viewModel.refresh()
		unseenSave.record()

		viewModel.loadMore()

		assertEquals(listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)
		assertTrue("an append is not first-page truth — the save is still owed a refresh", unseenSave.exists)
	}

	@Test
	fun `the first-page load clears a pending save marker`() = runTest {
		// A save recorded while the app was dead is surfaced by the launch load
		// itself, so the marker must not survive it — otherwise the first paginated
		// return after launch would reset the list with nothing new to show.
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
		val unseenSave = UnseenSave(folder.newFolder())
		unseenSave.record()
		val viewModel = viewModel(unseenSave = unseenSave)

		viewModel.loadIfNeeded()

		assertEquals("the launch load itself surfaces the save", listOf("a1"), viewModel.articleIds)
		assertFalse(
			"first-page truth consumes the marker, so a later paginated return will not reset an already-current list",
			unseenSave.exists,
		)
	}

	@Test
	fun `loadIfNeeded issues no second read once the list is loaded`() = runTest {
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"))))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.loadIfNeeded()

		viewModel.loadIfNeeded()

		assertEquals("a loaded list is not re-read by the launch-time hook", 1, firstPageReads())
		assertFalse(viewModel.state.value.isLoading)
	}

	// endregion

	// region Web sheet dismissal

	@Test
	fun `a web sheet dismissal on a deleted account funnels into onSessionExpired`() = runTest {
		// The user confirmed the account deletion inside the web sheet. Closing the
		// sheet must discover the dead session immediately — even deep-scrolled,
		// where the foreground converge is zero-network — and funnel into the
		// existing onSessionExpired sign-out, rather than leaving the deleted
		// account's cached list looking signed-in for the rest of the process.
		val accountDeleted = AtomicBoolean(false)
		server.handle(deletableAccountHandler(accountDeleted))
		var sessionExpired = false
		val viewModel = viewModel(onSessionExpired = { sessionExpired = true })
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		accountDeleted.set(true)
		viewModel.handleWebSheetDismissal()

		assertTrue(
			"the dismissal probe 401s against the deleted account, the refresh is rejected, and the failure reuses the existing onSessionExpired path",
			sessionExpired,
		)
		assertEquals(
			"the probe went through the normal 401 plumbing: one refresh attempt, rejected because deletion revoked the tokens",
			1,
			server.records("/oauth/token").size,
		)
	}

	@Test
	fun `a web sheet dismissal on a deep-scrolled list probes the server and holds position`() = runTest {
		// Unlike the foreground converge — zero-network once the list has paginated —
		// the dismissal re-read must actually reach the server: it exists to discover
		// a session the sheet's own page just killed. A live session's deep-scrolled
		// list still holds its position: the fetched page (a sentinel [zzz] the
		// client must not adopt) is discarded, so the probe never yanks the viewport.
		val page1Gets = AtomicInteger()
		server.handle(
			twoPageHandler {
				if (page1Gets.incrementAndGet() == 1) {
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("a2")), extraLinks = NEXT_LINK))
				} else {
					Stub.json(200, Fixtures.collection(listOf(Fixtures.article("zzz"))))
				}
			},
		)
		val viewModel = viewModel()
		viewModel.refresh()
		viewModel.loadMore()
		assertEquals("precondition: two pages are loaded", listOf("a1", "a2", "a3", "a4"), viewModel.articleIds)

		viewModel.handleWebSheetDismissal()

		assertEquals("the dismissal probe hits the network even when deep-scrolled", 2, page1Gets.get())
		assertEquals(
			"a live session's paginated list holds its position — the probe's body is discarded, not adopted",
			listOf("a1", "a2", "a3", "a4"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `a web sheet dismissal on a shallow list converges with the server`() = runTest {
		// Closing the web sheet near the top adopts the fresh first page, so a
		// change the sheet's own page made (an item saved via the /save page, s1)
		// appears immediately — the probe doubles as the foreground reconciliation.
		val postDismissal = Fixtures.collection(
			listOf(Fixtures.article("a1"), Fixtures.article("a2"), Fixtures.article("s1")),
			total = 3,
		)
		server.handle(markReadHandler(laterReadlist = postDismissal) { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals(listOf("a1", "a2"), viewModel.articleIds)

		viewModel.handleWebSheetDismissal()

		assertEquals(
			"a shallow list adopts the post-dismissal server truth, so a change made inside the sheet shows without pull-to-refresh",
			listOf("a1", "a2", "s1"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `a web sheet dismissal racing a foreground re-read probes once`() = runTest {
		server.handle(markReadHandler { Stub.redirect(to = "/queue") })
		val viewModel = viewModel()
		viewModel.refresh()

		val foreground = launch { viewModel.handleForeground() }
		val dismissal = launch { viewModel.handleWebSheetDismissal() }
		foreground.join()
		dismissal.join()

		assertEquals("setup's read plus the foreground re-read — the dismissal did not add a third", 2, firstPageReads())
		assertEquals(listOf("a1", "a2"), viewModel.articleIds)
		assertFalse(viewModel.state.value.isLoading)
	}

	// endregion

	// region Reader

	@Test
	fun `openReader publishes a presentation with the resolved URL and platform param`() = runTest {
		val viewModel = viewModel()

		viewModel.openReader(article(readHref = "/queue/a1/view"))

		val presentation = checkNotNull(viewModel.state.value.readerPresentation)
		assertEquals("a1", presentation.articleId)
		assertEquals(
			"the app appends ?platform=android so the server renders the reader chromeless in the webview",
			"${server.baseUrl}/queue/a1/view?platform=android",
			presentation.readerUrl,
		)
		assertEquals("a reader opened from a row is keyed by that row", "a1", presentation.id)
	}

	@Test
	fun `openReader is a no-op when the article has no read href`() = runTest {
		val viewModel = viewModel()

		viewModel.openReader(article(readHref = null))

		assertNull("a row with no read link is read-only", viewModel.state.value.readerPresentation)
	}

	@Test
	fun `openReader is a no-op for a foreign-scheme read href`() = runTest {
		val viewModel = viewModel()

		viewModel.openReader(article(readHref = "mailto:hi@example.com"))

		assertNull("an href the client can't act on is treated as absent", viewModel.state.value.readerPresentation)
	}

	@Test
	fun `closeReader takes the presentation down`() = runTest {
		val viewModel = viewModel()
		viewModel.openReader(article(readHref = "/queue/a1/view"))

		viewModel.closeReader()

		assertNull(viewModel.state.value.readerPresentation)
	}

	@Test
	fun `mintReaderSession returns the cookie on success`() = runTest {
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=sess-xyz; Path=/; HttpOnly")) }
		val viewModel = viewModel()

		val mint = viewModel.mintReaderSession()

		assertEquals(
			"a successful bootstrap concludes Minted with the session cookie",
			listOf("sess-xyz"),
			(mint as? ReaderSessionMint.Minted)?.cookies?.map { it.value },
		)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `mintReaderSession concludes Failed and surfaces the error on failure`() = runTest {
		server.handle { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) }
		val viewModel = viewModel()

		val mint = viewModel.mintReaderSession()

		assertEquals("a failed bootstrap concludes Failed, so the sheet shows its unavailable view", ReaderSessionMint.Failed, mint)
		assertEquals("nope", viewModel.state.value.errorText)
	}

	@Test
	fun `mintReaderSession concludes Superseded when the open was cancelled`() = runTest {
		server.handle { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) }
		val viewModel = viewModel()

		// Switching articles cancels the superseded open's mint; the mint only
		// runs once cancellation is already observed, so whatever the bootstrap throws
		// belongs to an open nobody is watching.
		var mint: ReaderSessionMint? = null
		val supersededMint = launch(start = CoroutineStart.UNDISPATCHED) {
			try {
				awaitCancellation()
			} catch (_: CancellationException) {
			}
			mint = viewModel.mintReaderSession()
		}
		supersededMint.cancel()
		supersededMint.join()

		assertEquals("a cancelled mint belongs to an open the user already left", ReaderSessionMint.Superseded, mint)
		assertNull("a superseded open is not a failure to surface", viewModel.state.value.errorText)
	}

	@Test
	fun `rapidly switching articles leaves the second article openable`() = runTest {
		server.handle { Stub(204, headers = mapOf("Set-Cookie" to "hutch_sid=sess-b; Path=/; HttpOnly")) }
		val viewModel = viewModel()

		viewModel.openReader(article(readHref = "/queue/a1/view", id = "a1"))
		var firstOpen: ReaderSessionMint? = null
		val supersededMint = launch(start = CoroutineStart.UNDISPATCHED) {
			try {
				awaitCancellation()
			} catch (_: CancellationException) {
			}
			firstOpen = viewModel.mintReaderSession()
		}
		supersededMint.cancel()
		supersededMint.join()

		viewModel.openReader(article(readHref = "/queue/b1/view", id = "b1"))
		val secondOpen = viewModel.mintReaderSession()

		assertEquals(
			"the superseded first open stays retryable — it must not brand the reader \"Couldn't open the reader\"",
			ReaderBootstrap.Loading,
			ReaderBootstrap.after(checkNotNull(firstOpen)),
		)
		assertEquals(
			"the second open is authenticated by its own fresh session",
			listOf("sess-b"),
			(secondOpen as? ReaderSessionMint.Minted)?.cookies?.map { it.value },
		)
		assertEquals("b1", viewModel.state.value.readerPresentation?.articleId)
		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `capturing the open blocked article heals it and reconciles the list`() = runTest {
		val postHeal = Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("h1")), total = 2)
		server.handle(blockedCaptureHandler(laterReadlist = postHeal))
		val healed = mutableListOf<String>()
		val viewModel = viewModel(healBlockedArticle = { url -> healed += url; HealBlockedOutcome.HEALED })
		viewModel.refresh()
		viewModel.openReader(viewModel.state.value.articles.first())

		viewModel.captureBlockedArticle()

		assertEquals(
			"the capture is keyed on the open row's own url, never the reader url hosting it",
			listOf("https://example.com/post"),
			healed,
		)
		assertEquals("a landed heal reconciles the list with the server's new truth", listOf("a1", "h1"), viewModel.articleIds)
	}

	@Test
	fun `capturing is a no-op without an open reader`() = runTest {
		server.handle(blockedCaptureHandler())
		val healed = mutableListOf<String>()
		val viewModel = viewModel(healBlockedArticle = { url -> healed += url; HealBlockedOutcome.HEALED })
		viewModel.refresh()

		viewModel.captureBlockedArticle()

		assertEquals("nothing is rendered for an article the user is not reading", emptyList<String>(), healed)
		assertEquals(listOf("a1"), viewModel.articleIds)
	}

	@Test
	fun `capturing is a no-op when the open reader's row is no longer listed`() = runTest {
		server.handle(blockedCaptureHandler())
		val healed = mutableListOf<String>()
		val viewModel = viewModel(healBlockedArticle = { url -> healed += url; HealBlockedOutcome.HEALED })
		viewModel.refresh()
		viewModel.openReader(article(readHref = "/queue/gone/view", id = "gone"))

		viewModel.captureBlockedArticle()

		assertEquals("a row the list no longer holds has no url to capture", emptyList<String>(), healed)
	}

	@Test
	fun `an empty capture tells the user and leaves the list alone`() = runTest {
		val postHeal = Fixtures.collection(listOf(Fixtures.article("a1"), Fixtures.article("h1")), total = 2)
		server.handle(blockedCaptureHandler(laterReadlist = postHeal))
		val viewModel = viewModel(healBlockedArticle = { HealBlockedOutcome.CAPTURE_WAS_EMPTY })
		viewModel.refresh()
		viewModel.openReader(viewModel.state.value.articles.first())

		viewModel.captureBlockedArticle()

		assertEquals(
			"an origin hostile to automated fetches can refuse the on-device render too; the user is told, not left with a silent reload",
			"This device couldn't capture that page either — the site returned nothing to save.",
			viewModel.state.value.errorText,
		)
		assertEquals(
			"with nothing uploaded there is no new server truth to adopt — any re-read here would take the post-heal collection this stub serves from the second GET on",
			listOf("a1"),
			viewModel.articleIds,
		)
	}

	@Test
	fun `a capture the server has no way to save tells the user`() = runTest {
		server.handle(blockedCaptureHandler())
		val viewModel = viewModel(healBlockedArticle = { HealBlockedOutcome.NO_SAVE_CONTENT_ACTION })
		viewModel.refresh()
		viewModel.openReader(viewModel.state.value.articles.first())

		viewModel.captureBlockedArticle()

		assertEquals("The server offered no way to save the captured page.", viewModel.state.value.errorText)
		assertEquals(listOf("a1"), viewModel.articleIds)
	}

	@Test
	fun `a capture surfaces the server's refusal to the list`() = runTest {
		server.handle(blockedCaptureHandler())
		val refusal = listOf(ServerMessage("warning", ServerMessage.Content("text/html", Fixtures.LOCKED_MESSAGE)))
		val viewModel = viewModel(healBlockedArticle = { throw ApiError.Refused(refusal) })
		viewModel.refresh()
		viewModel.openReader(viewModel.state.value.articles.first())

		viewModel.captureBlockedArticle()

		assertEquals(
			"a refused capture reuses the same server-authored message channel every other refused write does",
			refusal,
			viewModel.state.value.messages,
		)
	}

	@Test
	fun `a capture that fails without a message still names the failure`() = runTest {
		// A transport failure can carry no message at all; the banner then shows the
		// failure's own description rather than nothing.
		server.handle(blockedCaptureHandler())
		val viewModel = viewModel(healBlockedArticle = { throw IOException() })
		viewModel.refresh()
		viewModel.openReader(viewModel.state.value.articles.first())

		viewModel.captureBlockedArticle()

		assertEquals("java.io.IOException", viewModel.state.value.errorText)
	}

	// endregion

	// region Draining what the share target staged

	@Test
	fun `two foregrounds racing one another drain the staged readlist once`() = runTest {
		var drains = 0
		val viewModel = viewModel(
			drainUploadJobs = {
				drains += 1
				delay(200)
			},
		)

		val first = launch { viewModel.drainStagedUploads() }
		val second = launch { viewModel.drainStagedUploads() }
		first.join()
		second.join()

		assertEquals("a sweep already under way owns the readlist; the second one steps aside", 1, drains)
	}

	@Test
	fun `a later foreground drains again once the earlier sweep has finished`() = runTest {
		var drains = 0
		val viewModel = viewModel(drainUploadJobs = { drains += 1 })

		viewModel.drainStagedUploads()
		viewModel.drainStagedUploads()

		assertEquals("the in-flight guard is released when the sweep ends", 2, drains)
	}

	// endregion

	// region Session expiry & warnings

	@Test
	fun `an unauthorized load logs out without an error banner`() = runTest {
		var expired = false
		val viewModel = viewModel(onSessionExpired = { expired = true })
		// 401 everywhere: the entry-point load 401s, the single refresh 401s, and
		// the load surfaces Unauthorized.
		server.handle { Stub.json(401, "{}") }

		viewModel.refresh()

		assertTrue("a 401 whose refresh also fails logs the user out", expired)
		assertNull("a session-expiry logout is not shown as an error banner", viewModel.state.value.errorText)
	}

	@Test
	fun `a load with no stored token logs out without an error banner`() = runTest {
		var expired = false
		val viewModel = viewModel(store = TokenStore(RecordingTokenStorage()), onSessionExpired = { expired = true })
		server.handle { Stub.json(200, "{}") }

		viewModel.refresh()

		assertTrue("a missing token is the same dead session a rejected refresh is", expired)
		assertNull(viewModel.state.value.errorText)
		assertEquals("no request is made without a token", 0, server.records.size)
	}

	@Test
	fun `a collection warning populates the warning text`() = runTest {
		val warnedReadlist = """
			{
				"class": ["collection", "articles"],
				"properties": { "total": 1, "page": 1, "pageSize": 20, "warning": { "code": "not-saveable", "message": "Cannot save that link." } },
				"entities": [${Fixtures.article("a1")}],
				"links": [{ "rel": ["self"], "href": "/queue" }, { "rel": ["root"], "href": "/queue" }],
				"actions": []
			}
		"""
		server.handle { record -> if (record.path == "/") Stub.redirect(to = "/queue") else Stub.json(200, warnedReadlist) }
		val viewModel = viewModel()

		viewModel.refresh()

		assertEquals("Cannot save that link.", viewModel.state.value.warningText)
	}

	@Test
	fun `mintReaderSession follows the server's create-session action`() = runTest {
		val readlistWithSession = """
			{
				"class": ["collection", "articles"],
				"properties": { "total": 1, "page": 1, "pageSize": 20 },
				"entities": [${Fixtures.article("a1")}],
				"links": [{ "rel": ["self"], "href": "/queue" }, { "rel": ["root"], "href": "/queue" }],
				"actions": [{ "name": "create-session", "href": "/custom/session", "method": "POST" }]
			}
		"""
		server.handle { record ->
			when (record.path) {
				"/" -> Stub.redirect(to = "/queue")
				"/queue" -> Stub.json(200, readlistWithSession)
				"/custom/session" -> Stub(204, headers = mapOf("Set-Cookie" to "sess=v; Path=/"))
				else -> Stub.json(404, "{}")
			}
		}
		val viewModel = viewModel()
		viewModel.refresh()

		val mint = viewModel.mintReaderSession()

		assertEquals(
			"the discovered create-session action mints a session",
			listOf("v"),
			(mint as? ReaderSessionMint.Minted)?.cookies?.map { it.value },
		)
		assertEquals(
			"the reader session mint follows the discovered create-session action, not a hard-coded route",
			1,
			server.records("/custom/session").size,
		)
	}

	// endregion

	// region Banner dismissal

	@Test
	fun `dismissing the error banner clears it`() = runTest {
		server.handle { Stub.json(500, Fixtures.sirenError(code = "boom", message = "nope")) }
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals("precondition: the failed load shows its error", "nope", viewModel.state.value.errorText)

		viewModel.dismissError()

		assertNull(viewModel.state.value.errorText)
	}

	@Test
	fun `dismissing the warning banner clears it`() = runTest {
		val warnedReadlist = """
			{
				"class": ["collection", "articles"],
				"properties": { "total": 1, "page": 1, "pageSize": 20, "warning": { "code": "not-saveable", "message": "Cannot save that link." } },
				"entities": [${Fixtures.article("a1")}],
				"links": [{ "rel": ["self"], "href": "/queue" }, { "rel": ["root"], "href": "/queue" }],
				"actions": []
			}
		"""
		server.handle { record -> if (record.path == "/") Stub.redirect(to = "/queue") else Stub.json(200, warnedReadlist) }
		val viewModel = viewModel()
		viewModel.refresh()
		assertEquals("precondition: the load shows its warning", "Cannot save that link.", viewModel.state.value.warningText)

		viewModel.dismissWarning()

		assertNull(viewModel.state.value.warningText)
	}

	@Test
	fun `dismissing the messages banner clears it`() = runTest {
		server.handle(lockedAccountHandler())
		val viewModel = viewModel()
		viewModel.refresh()
		viewModel.invokeCollection(purgeAction)
		assertEquals("precondition: a refused invoke shows the banner", 1, viewModel.state.value.messages.size)

		viewModel.dismissMessages()

		assertEquals(emptyList<ServerMessage>(), viewModel.state.value.messages)
	}

	// endregion

	private object Fixtures {
		const val LOCKED_MESSAGE = "Your account is locked because your email was never verified. " +
			"Email <a href='mailto:readplace+verification@readplace.com'>readplace+verification@readplace.com</a> to restore access."

		fun article(id: String = "a1", url: String = "https://example.com/post"): String =
			"""
				{
					"class": ["article"],
					"rel": ["item"],
					"properties": {
						"id": "$id",
						"url": "$url",
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

		fun collection(
			entitiesJson: List<String>,
			extraLinks: String = "",
			page: Int = 1,
			total: Int = 1,
			actionsJson: String = COLLECTION_ACTIONS,
		): String =
			"""
				{
					"class": ["collection", "articles"],
					"properties": { "total": $total, "page": $page, "pageSize": 20 },
					"entities": [${entitiesJson.joinToString(",\n")}],
					"links": [
						{ "rel": ["self"], "href": "/queue?page=$page" },
						{ "rel": ["root"], "href": "/queue" }$extraLinks
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
			"""{ "class": ["error"], "properties": { "messages": [{ "type": "warning", "content": { "type": "text/html", "body": "$LOCKED_MESSAGE" } }] } }"""
	}

	private companion object {
		const val NEXT_LINK = """, { "rel": ["next"], "href": "/queue?page=2" }"""
	}
}
