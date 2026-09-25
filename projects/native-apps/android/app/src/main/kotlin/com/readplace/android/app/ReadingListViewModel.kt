package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.ApiError
import com.readplace.android.core.AppConfig
import com.readplace.android.core.Article
import com.readplace.android.core.Href
import com.readplace.android.core.ReadlistPage
import com.readplace.android.core.ReadlistTab
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink
import com.readplace.android.core.UnseenSave
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive

/**
 * Everything the reading list renders, published as one value through
 * [ReadingListViewModel.state].
 */
data class ReadingListState(
	val articles: List<Article> = emptyList(),
	val isLoading: Boolean = false,
	val hasMore: Boolean = false,
	val errorText: String? = null,
	val warningText: String? = null,
	/** Server-authored messages surfaced to the UI (e.g. a locked-account refusal),
	 * rendered generically — the client owns no per-feature knowledge of them. */
	val messages: List<ServerMessage> = emptyList(),
	/** Set when a readable row is tapped, or when a navigable collection link is
	 * invoked; drives the reader/web sheet. The session cookie is minted inside
	 * the sheet, so the sheet opens without waiting. */
	val readerPresentation: ReaderPresentation? = null,
	val appearance: String? = null,
	/** The collection-level controls the toolbar renders. The server's own collection
	 * affordances are looped (each presentable one becomes a control), and the
	 * client-side add (+) control that opens the Share help is always present — it is
	 * injected by the client and kept canonical, so any add-links-help the server
	 * also advertises is deduped rather than rendered as a second +. */
	val collectionAffordances: List<Affordance>,
	val tabs: List<ReadlistTab> = emptyList(),
	val selectedTabHref: String? = null,
)

/**
 * What the in-app web sheet needs to present a server URL: the resolved URL and,
 * for a reader opened from a row, that row's id. A navigable collection link
 * (e.g. `save`) carries no row, so `articleId` is null. [id] keys the sheet; it
 * falls back to the URL so a row-less sheet is still uniquely presentable.
 */
data class ReaderPresentation(
	val readerUrl: String,
	val articleId: String?,
) {
	val id: String get() = articleId ?: readerUrl
}

/**
 * Main-thread confined by contract, the way its iOS twin is by `@MainActor`:
 * every method is called from the UI, so the in-flight guards and the read
 * sequence below are check-then-act safe without a lock.
 */
class ReadingListViewModel(
	private val api: ReadplaceApi,
	private val unseenSave: UnseenSave,
	private val healBlockedArticle: suspend (url: String) -> HealBlockedOutcome,
	private val drainUploadJobs: suspend () -> Unit,
	private val onSessionExpired: () -> Unit,
) {
	private val states = MutableStateFlow(ReadingListState(collectionAffordances = listOf(ADD_LINKS_HELP)))
	val state: StateFlow<ReadingListState> = states.asStateFlow()

	/**
	 * The "add links via Share" help page the reading list's + control opens in a
	 * webview. A client-owned path resolved against the API base — the client holds
	 * it itself rather than reading it from the server's add-links-help link — so the
	 * + control works before (and regardless of) a readlist load. It carries the
	 * app-shell marker so the server renders the page chromeless with a "← Back to
	 * readlist" deep link, the same way the account page does inside this sheet.
	 */
	val addLinksHelpUrl: String =
		// Append the same app-shell marker `open(link)` puts on the account href, so
		// the help page is served chromeless with a deep-link back to the native list.
		Href.appending(
			checkNotNull(Href.resolve(AppConfig.ADD_LINKS_HELP_PATH, api.baseUrl)),
			AppConfig.APP_SHELL_QUERY_NAME,
			AppConfig.APP_SHELL_QUERY_VALUE,
		)

	private var nextHref: String? = null

	private var currentTabHref: String? = null

	private var tabGeneration = 0

	/** The server-advertised `create-session` action from the loaded collection,
	 * followed to mint the reader's browser session. Null against a server that
	 * hasn't advertised it, in which case the API falls back to a fixed path. */
	private var sessionAction: SirenAction? = null
	private var isLoadingMore = false
	private var isDrainingUploads = false

	/** How many stitched pages the list currently holds: 1 for a fresh first page,
	 * one more for each accepted deeper page. A post-action adoption re-follows the
	 * fresh `next` links to this depth, so the whole visible list is replaced with
	 * server truth rather than held stale (see [adoptFirstPage]). */
	private var pagesHeld = 0

	/** The read sequence that orders overlapping replacing reads. Every first-page
	 * read, reload-and-adopt, or action invocation allocates a [beginRead] ticket;
	 * a collected collection is applied only when its ticket beats the last one
	 * applied ([replace]), so a slower older read landing late can't overwrite a
	 * newer one. In-flight replacing reads drive [ReadingListState.isLoading]. */
	private var readsStarted = 0
	private var readApplied = 0
	private var readsInFlight = 0

	/** Whether a collection has ever been applied. Gates the foreground refresh so
	 * it never races the launch-time load with a second fetch. */
	private var hasLoadedOnce = false

	suspend fun loadIfNeeded() = if (states.value.articles.isEmpty()) fetchFirstPage() else Unit

	suspend fun refresh() {
		fetchFirstPage()
	}

	suspend fun selectTab(href: String) {
		if (href == currentTabHref) return
		restart(href)
		mutate { it.copy(selectedTabHref = href) }
		fetchFirstPage()
	}

	private fun restart(href: String) {
		tabGeneration += 1
		currentTabHref = href
		nextHref = null
		pagesHeld = 0
		isLoadingMore = false
		mutate { it.copy(articles = emptyList(), hasMore = false) }
	}

	private fun tabUnchanged(generation: Int): Boolean = generation == tabGeneration

	private suspend fun fetchFirstPage() {
		val generation = tabGeneration
		val read = beginRead()
		// A locked account's reads still succeed, so a fresh load reconciles a
		// stale refusal banner (e.g. after verifying elsewhere): clear it here,
		// then re-surface it only if a later write (e.g. mark-as-read) is refused.
		mutate { it.copy(errorText = null, messages = emptyList()) }
		try {
			val firstPage = api.loadReadlist(path = currentTabHref)
			if (tabUnchanged(generation)) replace(firstPage = firstPage, deeperPages = emptyList(), read = read)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			if (tabUnchanged(generation)) handle(error)
		} finally {
			endRead()
		}
	}

	suspend fun loadMore() {
		val next = nextHref ?: return
		if (isLoadingMore) return
		val generation = tabGeneration
		// The list this append extends: if a replacement lands first, the fetched
		// page belongs to a superseded cursor and is dropped rather than stitched
		// onto the fresh list. A replacement merely pending (not yet applied) does
		// not invalidate it — only one that has actually replaced the collection.
		val listVersion = readApplied
		isLoadingMore = true
		try {
			val page = api.loadReadlist(path = next)
			if (tabUnchanged(generation) && listVersion == readApplied) apply(page, replacing = false)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			if (tabUnchanged(generation)) handle(error)
		} finally {
			if (tabUnchanged(generation)) isLoadingMore = false
		}
	}

	/**
	 * Invokes an advertised action via the action's own href/method/fields through
	 * the generic invoker — both a row control and a collection-level toolbar
	 * control take this one path. The client supplies no field knowledge: every
	 * declared field's server-suggested `value` is posted, so a bare (action)
	 * invocation is sufficient — `update-status` carries its target status as the
	 * field `value`, not a client constant. On success the list converges to
	 * whatever collection the server drove the invoke back to — the post-action
	 * truth, carrying changes made elsewhere (an item marked unread on the website
	 * appears right here) — re-followed to the depth held; a response that is no
	 * collection re-reads the entry point instead. A failure surfaces the error and
	 * leaves the current list in place; there is no optimistic removal to roll back.
	 */
	suspend fun invoke(action: SirenAction) {
		val generation = tabGeneration
		val read = beginRead()
		try {
			val page = api.invoke(action)
			if (tabUnchanged(generation)) adopt(page, read)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			handle(error)
		} finally {
			endRead()
		}
	}

	/**
	 * Reconciles the list after the reader reports a status change from inside the
	 * webview. The reader's own POST answers where no Siren body is available and
	 * the client cannot see which direction the toggle went, so it does not infer
	 * "read" and drop a row — it re-reads the collection and adopts the server's
	 * truth, which also brings in whatever changed elsewhere (e.g. an item marked
	 * unread on the website). A deep-scrolled list re-follows the fresh pages to the
	 * depth held rather than collapsing to the first page.
	 */
	suspend fun readerStatusChanged() = reloadAndAdopt()

	/**
	 * Re-reads the list when the app returns to the foreground, so changes made
	 * while away — a share-sheet save, an item marked unread on the website —
	 * appear without pull-to-refresh. Gated on a completed first load: at launch
	 * the launch-time load owns the fetch and this is a no-op. It also steps aside
	 * while a replacing read is in flight. A deep-scrolled list is re-read only when
	 * the share target has recorded a save the list has not shown — the one change
	 * worth the same first-page reset (and viewport yank) a pull-to-refresh performs;
	 * every other deep-scrolled return stays zero-network and holds the reader's
	 * position.
	 */
	suspend fun handleForeground() {
		// Gated on a completed first load and no replacing read in flight; expressed
		// as positive conditions (not early returns) so the no-op paths fall through
		// this body synchronously rather than only via a tail-call resume.
		if (hasLoadedOnce && !states.value.isLoading) {
			if (pagesHeld > 1) {
				if (unseenSave.exists && !isLoadingMore) refresh()
			} else {
				reloadAndAdopt()
			}
		}
	}

	/**
	 * Probes the server when the in-app web sheet closes, so a session the
	 * sheet's own page just killed is discovered immediately. The sheet can host
	 * the account page, whose delete-account flow destroys every session and
	 * revokes every OAuth token server-side, and nothing else fires promptly
	 * after that: the activity never leaves the resumed state for an in-app sheet,
	 * and the foreground converge is zero-network for a paginated list with no
	 * pending share-sheet save — so without this probe the app would keep showing
	 * the deleted account's cached list until some later call happened to 401. The
	 * probe therefore always hits the network (no depth gate, unlike the foreground
	 * re-read): against a dead session it 401s, the refresh fails on the revoked
	 * token, and the failure funnels into the existing `onSessionExpired` sign-out —
	 * clearing the TokenStore and the cached UI. A live session pays one re-read,
	 * which doubles as the same reconciliation the foreground performs; a
	 * deep-scrolled list re-follows to the depth held.
	 */
	suspend fun handleWebSheetDismissal() = reloadAndAdopt()

	/**
	 * Adopts the server's post-action collection: a first page supplies the fresh
	 * head, and the fresh `next` links are re-followed to the depth held so a
	 * deep-scrolled list is replaced with server truth rather than kept stale. A
	 * response that is no collection (a 204 or an HTML page) carries a fresh
	 * first-page read of its own instead ([reloadAndAdopt]).
	 */
	private suspend fun adopt(page: ReadlistPage?, read: Int) {
		if (page == null) reloadAndAdopt() else adoptFirstPage(firstPage = page, read = read)
	}

	/**
	 * Collects a fresh collection to the depth held and applies it as one
	 * replacement. Starting from [firstPage], each freshly fetched page's own
	 * `next` href is followed — opaque hrefs only, never a reconstructed page
	 * number — while the collected depth is below [pagesHeld], stopping when the
	 * depth is reached, `next` is absent, or a hop fails. The displayed list is held
	 * until the whole collection is in hand, then the pages are applied together
	 * through [replace]'s ordering gate. A failed deeper hop keeps the pages fetched
	 * so far (their last `next` link is retryable through ordinary pagination) and
	 * surfaces the failure — but only if this replacement was the one accepted, so a
	 * superseded older adoption publishes neither its rows nor its hop error.
	 */
	private suspend fun adoptFirstPage(firstPage: ReadlistPage, read: Int) {
		val generation = tabGeneration
		val deeperPages = mutableListOf<ReadlistPage>()
		var hopFailure: Exception? = null
		while (deeperPages.size + 1 < pagesHeld) {
			val next = (deeperPages.lastOrNull() ?: firstPage).nextHref ?: break
			try {
				val page = api.loadReadlist(path = next)
				if (!tabUnchanged(generation)) return
				deeperPages.add(page)
			} catch (cancellation: CancellationException) {
				throw cancellation
			} catch (error: Exception) {
				if (!tabUnchanged(generation)) return
				hopFailure = error
				break
			}
		}
		if (!replace(firstPage, deeperPages, read)) return
		if (hopFailure != null) handle(hopFailure)
	}

	/**
	 * Re-reads the first page and adopts it to the depth held. Always starts its
	 * own read — no in-flight early return — so a required reconciliation (a reader
	 * report, a sheet dismissal) is never dropped behind a busy guard; the read
	 * sequence, not suppression, is what keeps overlapping reads in order.
	 */
	private suspend fun reloadAndAdopt() {
		val generation = tabGeneration
		val read = beginRead()
		try {
			val firstPage = api.loadReadlist(path = currentTabHref)
			if (tabUnchanged(generation)) adoptFirstPage(firstPage = firstPage, read = read)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			if (tabUnchanged(generation)) handle(error)
		} finally {
			endRead()
		}
	}

	/**
	 * Applies a collected collection under the read-ordering gate: an older read
	 * landing after a newer one has already applied is refused, so it cannot repaint
	 * a superseded list. Starting a newer read alone does not invalidate an older
	 * in-flight one — only a newer one that has actually applied. Returns whether
	 * this collection was applied.
	 */
	private fun replace(firstPage: ReadlistPage, deeperPages: List<ReadlistPage>, read: Int): Boolean {
		if (read <= readApplied) return false
		readApplied = read
		apply(firstPage, replacing = true)
		for (page in deeperPages) apply(page, replacing = false)
		return true
	}

	/**
	 * Opens the reader for a tapped row. A row whose server response carries no
	 * usable read link is read-only, so this is a no-op for it — no sheet opens.
	 * The sheet is presented immediately; the session cookie is minted inside it.
	 *
	 * The server `read` link is the same href every client follows; the app appends
	 * `?platform=android` here so the server renders the reader chromeless inside
	 * the WebView, where the native list is the chrome. An href the client can't
	 * resolve is treated as absent (read-only row).
	 */
	fun openReader(article: Article) {
		val href = article.readHref ?: return
		val url = Href.resolve(href, api.baseUrl) ?: return
		val readerUrl = Href.appending(url, AppConfig.PLATFORM_QUERY_NAME, AppConfig.PLATFORM_QUERY_VALUE)
		mutate { it.copy(readerPresentation = ReaderPresentation(readerUrl, article.id)) }
	}

	/**
	 * Follows a navigable collection-level link (e.g. the `account` link) by opening
	 * its resolved href in the same in-app web view the reader uses. A link the
	 * client can't resolve (missing or foreign-scheme href) is a no-op, so an
	 * unactionable link advertised by the server never opens a blank sheet.
	 *
	 * The href is the server's own; the app appends its app-shell marker so the
	 * server knows the page is hosted in the deep-link-intercepting sheet and may
	 * answer with a `readplace://` control.
	 */
	fun open(link: SirenLink) {
		val href = link.href ?: return
		val url = Href.resolve(href, api.baseUrl) ?: return
		val shellUrl = Href.appending(url, AppConfig.APP_SHELL_QUERY_NAME, AppConfig.APP_SHELL_QUERY_VALUE)
		mutate { it.copy(readerPresentation = ReaderPresentation(shellUrl, articleId = null)) }
	}

	fun closeReader() {
		mutate { it.copy(readerPresentation = null) }
	}

	fun dismissError() {
		mutate { it.copy(errorText = null) }
	}

	fun dismissWarning() {
		mutate { it.copy(warningText = null) }
	}

	fun dismissMessages() {
		mutate { it.copy(messages = emptyList()) }
	}

	suspend fun captureBlockedArticle() {
		val articleId = states.value.readerPresentation?.articleId ?: return
		val article = states.value.articles.firstOrNull { it.id == articleId } ?: return
		try {
			val failureText = healBlockedArticle(article.url).failureText
			if (failureText != null) {
				mutate { it.copy(errorText = failureText) }
				return
			}
			reloadAndAdopt()
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (error: Exception) {
			handle(error)
		}
	}

	suspend fun drainStagedUploads() {
		if (isDrainingUploads) return
		isDrainingUploads = true
		try {
			drainUploadJobs()
		} finally {
			isDrainingUploads = false
		}
	}

	/** Mints the cookie session the reader webview needs from the current bearer. */
	suspend fun mintReaderSession(): ReaderSessionMint =
		try {
			ReaderSessionMint.Minted(api.bootstrapSession(sessionAction))
		} catch (error: Exception) {
			if (currentCoroutineContext().isActive) {
				handle(error)
				ReaderSessionMint.Failed
			} else {
				ReaderSessionMint.Superseded
			}
		}

	/**
	 * Applies a loaded page to the list. A replacing load (first page, refresh, or
	 * a post-action collection) becomes the whole list. A paginated load appends the
	 * rows the list doesn't already hold.
	 */
	private fun apply(page: ReadlistPage, replacing: Boolean) {
		val current = states.value
		val reconciled: ReadingListState
		if (replacing) {
			var selectedTabHref = current.selectedTabHref
			page.currentTabHref?.let {
				currentTabHref = it
				selectedTabHref = it
			}
			reconciled = current.copy(
				articles = page.articles,
				// A fresh successful collection reconciles transient banners: a stale
				// write-refusal (e.g. a since-verified locked account) or error is cleared
				// here, re-surfacing only if a later write is refused.
				messages = emptyList(),
				errorText = null,
				// The toolbar is sourced from the current collection (a replacing load). A
				// paginated page only appends rows, so it neither clears the controls when it
				// advertises none nor flaps them to a page-scoped set — the first page owns
				// the toolbar for the whole scroll.
				collectionAffordances = toolbarOf(page),
				appearance = page.appearance,
				tabs = page.tabs,
				selectedTabHref = selectedTabHref,
			)
			pagesHeld = 1
			sessionAction = page.action(named = "create-session")
			// The list now holds first-page server truth, so any share-sheet save
			// recorded up to this point has been shown — including one saved before
			// a cold launch, which the launch load itself surfaces.
			unseenSave.clear()
		} else {
			val existing = current.articles.map { it.id }.toSet()
			reconciled = current.copy(articles = current.articles + page.articles.filter { it.id !in existing })
			pagesHeld += 1
		}
		hasLoadedOnce = true
		nextHref = page.nextHref
		states.value = reconciled.copy(hasMore = page.nextHref != null, warningText = page.warning?.message)
	}

	/**
	 * Derives the toolbar from a page's advertised affordances: a client-derived
	 * subset — each one the client can present as a toolbar control, dropping the
	 * rest by their presentation (a structural navigation link the client follows
	 * itself for pagination/identity, or a capture-only save reachable only via
	 * the Share Sheet) — not by name-gating a known capability. The client-side
	 * add (+) control is always appended so the reading list can reach the Share
	 * help regardless of what the server advertised. Because that + is client-owned,
	 * a same-token server affordance is dropped first (via the single isAddLinksHelp
	 * source), so the injected control stays canonical and a server that re-advertises
	 * add-links-help never renders a duplicate +.
	 */
	private fun toolbarOf(page: ReadlistPage): List<Affordance> {
		val serverControls = page.affordances.filter {
			it.isToolbarControl && !Affordance.isAddLinksHelp(it.token)
		}
		return serverControls + ADD_LINKS_HELP
	}

	/** Allocates the next read ticket and marks a replacing read in flight, which
	 * drives [ReadingListState.isLoading]. Balanced by [endRead] in a `finally`. */
	private fun beginRead(): Int {
		readsStarted += 1
		readsInFlight += 1
		mutate { it.copy(isLoading = readsInFlight > 0) }
		return readsStarted
	}

	/** Releases a read started by [beginRead]; loading clears only once no replacing
	 * read remains, so one completion never hides another still in flight. */
	private fun endRead() {
		readsInFlight -= 1
		mutate { it.copy(isLoading = readsInFlight > 0) }
	}

	private fun handle(error: Exception) {
		when (error) {
			is ApiError.Unauthorized, is ApiError.NoToken -> onSessionExpired()
			is ApiError.Refused -> mutate { it.copy(messages = error.messages) }
			else -> mutate { it.copy(errorText = error.message ?: error.toString()) }
		}
	}

	private fun mutate(transform: (ReadingListState) -> ReadingListState) {
		states.update(transform)
	}

	private companion object {
		/**
		 * The reading list's client-side add (+) control: a navigable `add-links-help`
		 * affordance the client injects itself rather than discovering from the server.
		 * Tapping it opens the native Share-help sheet (`ToolbarRoute.PresentAddLinksHelp`);
		 * the client ignores any add-links-help the server advertises and treats this one
		 * as canonical, so the toolbar's add control is owned entirely by the client.
		 * Built from constant inputs, so it always constructs.
		 */
		val ADD_LINKS_HELP: Affordance = checkNotNull(
			Affordance.of(
				SirenLink(rel = listOf("add-links-help"), href = AppConfig.ADD_LINKS_HELP_PATH, title = "How to add links"),
			),
		)
	}
}
