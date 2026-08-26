package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.ApiError
import com.readplace.android.core.AppConfig
import com.readplace.android.core.Article
import com.readplace.android.core.Href
import com.readplace.android.core.QueuePage
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink
import com.readplace.android.core.UnseenSave
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
	/** The collection-level controls the toolbar renders. The server's own collection
	 * affordances are looped (each presentable one becomes a control), and the
	 * client-side add (+) control that opens the Share help is always present — it is
	 * injected by the client and kept canonical, so any add-links-help the server
	 * also advertises is deduped rather than rendered as a second +. */
	val collectionAffordances: List<Affordance>,
)

/**
 * What the in-app web sheet needs to present a server URL: the resolved URL and,
 * for a reader opened from a row, that row's id (so the row can be dropped if the
 * reader marks it read). A navigable collection link (e.g. `save`) carries no
 * row, so `articleId` is null and nothing is dropped on close. [id] keys the
 * sheet; it falls back to the URL so a row-less sheet is still uniquely
 * presentable.
 */
data class ReaderPresentation(
	val readerUrl: String,
	val articleId: String?,
) {
	val id: String get() = articleId ?: readerUrl
}

/**
 * Main-thread confined by contract, the way its iOS twin is by `@MainActor`:
 * every method is called from the UI, so the in-flight guards below are
 * check-then-act safe without a lock.
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
	 * + control works before (and regardless of) a queue load. It carries the
	 * app-shell marker so the server renders the page chromeless with a "← Back to
	 * queue" deep link, the same way the account page does inside this sheet.
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

	/** The server-advertised `create-session` action from the loaded collection,
	 * followed to mint the reader's browser session. Null against a server that
	 * hasn't advertised it, in which case the API falls back to a fixed path. */
	private var sessionAction: SirenAction? = null
	private var isLoadingMore = false
	private var isDrainingUploads = false

	/** Whether rows beyond the first page are loaded. A post-action adoption
	 * replaces the list outright only while everything on screen came from one
	 * page; once the user has scrolled deeper, adoption merges instead, so the
	 * rows anchoring the scroll position survive (see [adopt]). */
	private var hasPaginated = false

	/** Whether a collection has ever been applied. Gates the foreground refresh so
	 * it never races the launch-time load with a second fetch. */
	private var hasLoadedOnce = false

	suspend fun loadIfNeeded() = if (states.value.articles.isEmpty()) fetchFirstPage() else Unit

	suspend fun refresh() {
		fetchFirstPage()
	}

	private suspend fun fetchFirstPage() {
		// A locked account's reads still succeed, so a fresh load reconciles a
		// stale refusal banner (e.g. after verifying elsewhere): clear it here,
		// then re-surface it only if a later write (e.g. mark-as-read) is refused.
		mutate { it.copy(isLoading = true, errorText = null, messages = emptyList()) }
		try {
			apply(api.loadQueue(), replacing = true)
		} catch (error: Exception) {
			handle(error)
		}
		mutate { it.copy(isLoading = false) }
	}

	suspend fun loadMore() {
		val next = nextHref ?: return
		if (isLoadingMore) return
		isLoadingMore = true
		try {
			apply(api.loadQueue(path = next), replacing = false)
		} catch (error: Exception) {
			handle(error)
		}
		isLoadingMore = false
	}

	/**
	 * Invokes one of an item's advertised actions via the action's own
	 * href/method/fields. The client supplies no field knowledge: every declared
	 * field's server-suggested `value` is posted by the generic invoker, so a bare
	 * (action, item) invocation is sufficient — `update-status` carries its target
	 * status as the field `value`, not a client constant. On success the list
	 * converges to whatever collection the server drove the invoke back to — the
	 * post-action truth, carrying changes made elsewhere (an item marked unread on
	 * the website appears right here). A failure surfaces the error and leaves the
	 * current list in place; there is no optimistic removal to roll back.
	 */
	suspend fun invoke(action: SirenAction, article: Article) {
		val removesItem = Affordance.of(action)?.removesItemFromUnreadList ?: false
		try {
			val page = api.invoke(action)
			adopt(page, droppingId = if (removesItem) article.id else null)
		} catch (error: Exception) {
			handle(error)
		}
	}

	/**
	 * Invokes a collection-level action via its own href/method/type/fields through
	 * the generic invoker — the bare-invokable toolbar control path. The action
	 * carries no row and reshapes the whole list (e.g. a purge), so the server's
	 * post-invoke collection replaces it outright; when the invoke lands on no
	 * collection, a fresh first-page load converges instead. A failure surfaces
	 * the error and leaves the current list in place.
	 */
	suspend fun invokeCollection(action: SirenAction) {
		try {
			val page = api.invoke(action)
			if (page != null) {
				apply(page, replacing = true)
			} else {
				fetchFirstPage()
			}
		} catch (error: Exception) {
			handle(error)
		}
	}

	/**
	 * Reconciles the list after the reader reports a status change from inside the
	 * webview. The reader's own POST answers where no Siren body is available and
	 * the client cannot see which direction the toggle went, so it does not infer
	 * "read" and drop a row — it re-reads the collection and adopts the server's
	 * truth (a shallow list), which also brings in whatever changed elsewhere (e.g.
	 * an item marked unread on the website). A deep-scrolled list holds its position
	 * and reconciles on the next pull-to-refresh ([reloadAndAdopt]).
	 */
	suspend fun readerStatusChanged() = reloadAndAdopt(droppingId = null)

	/**
	 * Re-reads the list when the app returns to the foreground, so changes made
	 * while away — a share-sheet save, an item marked unread on the website —
	 * appear without pull-to-refresh. Gated on a completed first load: at launch
	 * the launch-time load owns the fetch and this is a no-op. A deep-scrolled list
	 * is re-read only when the share target has recorded a save the list has
	 * not shown — the one change worth the same first-page reset (and viewport
	 * yank) a pull-to-refresh performs; every other deep-scrolled return stays
	 * zero-network and holds the reader's position.
	 */
	suspend fun handleForeground() {
		if (!hasLoadedOnce) return
		if (hasPaginated) {
			if (!unseenSave.exists || states.value.isLoading || isLoadingMore) return
			refresh()
		} else {
			reloadAndAdopt(droppingId = null)
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
	 * probe therefore always hits the network (no `!hasPaginated` gate, unlike
	 * the foreground re-read): against a dead session it 401s, the refresh fails
	 * on the revoked token, and the failure funnels into the existing
	 * `onSessionExpired` sign-out — clearing the TokenStore and the cached UI. A
	 * live session pays one shallow re-read, which doubles as the same
	 * reconciliation the foreground performs; a deep-scrolled list still holds
	 * its position ([adopt] discards the page).
	 */
	suspend fun handleWebSheetDismissal() = reloadAndAdopt(droppingId = null)

	/**
	 * Reconciles the visible list with the server's post-action collection.
	 *
	 * While the user is near the top (only the first page loaded) the collection
	 * replaces the list outright — pure server truth, dropping the acted-on row and
	 * surfacing whatever changed elsewhere. Once the user has scrolled deeper,
	 * replacing would collapse the list to one page and yank the scroll, and
	 * splicing a fresh head above the viewport would shift it, so a deep-scrolled
	 * list stays exactly where it is: the only change applied is the confirmed
	 * removal of the acted-on row. The rest reconciles on the next pull-to-refresh
	 * — the user's explicit "re-read now" gesture, which is the one place a jump to
	 * the top is expected. With no collection to adopt (a non-collection response)
	 * the server directed no re-list, so again only the confirmed removal is
	 * applied.
	 */
	private fun adopt(page: QueuePage?, droppingId: String?) {
		if (hasPaginated || page == null) {
			if (droppingId != null) mutate { it.copy(articles = it.articles.filter { row -> row.id != droppingId }) }
			return
		}
		apply(page, replacing = true, droppingId = droppingId)
	}

	/**
	 * Re-reads the first page and reconciles it through [adopt], under an
	 * in-flight guard so overlapping triggers (rapid app switches, a sheet
	 * dismissal racing a foreground re-read) can't interleave. [adopt] still
	 * holds a deep-scrolled viewport, so for the dismissal probe of a paginated
	 * list the request serves as a bare authenticated probe whose body is
	 * discarded.
	 */
	private suspend fun reloadAndAdopt(droppingId: String?) {
		if (states.value.isLoading) return
		mutate { it.copy(isLoading = true) }
		try {
			adopt(api.loadQueue(), droppingId)
		} catch (error: Exception) {
			handle(error)
		} finally {
			mutate { it.copy(isLoading = false) }
		}
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
	 * unactionable link advertised by the server never opens a blank sheet. No
	 * row is associated, so the web sheet drops nothing when it closes.
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
			reloadAndAdopt(droppingId = null)
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
	 * a post-action collection) becomes the whole list, minus the acted-on row when
	 * one is given — so a just-removed row never reappears even if an
	 * eventually-consistent server GET still lists it. A paginated load appends the
	 * rows the list doesn't already hold. `droppingId` matters only for a replacing
	 * load; an append never re-introduces a removed row because its ids are already
	 * present.
	 */
	private fun apply(page: QueuePage, replacing: Boolean, droppingId: String? = null) {
		val current = states.value
		val reconciled: ReadingListState
		if (replacing) {
			reconciled = current.copy(
				articles = page.articles.filter { it.id != droppingId },
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
			)
			hasPaginated = false
			sessionAction = page.action(named = "create-session")
			// The list now holds first-page server truth, so any share-sheet save
			// recorded up to this point has been shown — including one saved before
			// a cold launch, which the launch load itself surfaces.
			unseenSave.clear()
		} else {
			val existing = current.articles.map { it.id }.toSet()
			reconciled = current.copy(articles = current.articles + page.articles.filter { it.id !in existing })
			hasPaginated = true
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
	private fun toolbarOf(page: QueuePage): List<Affordance> {
		val serverControls = page.affordances.filter {
			it.isToolbarControl && !Affordance.isAddLinksHelp(it.token)
		}
		return serverControls + ADD_LINKS_HELP
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
