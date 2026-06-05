package com.readplace.poc.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.readplace.poc.core.ApiError
import com.readplace.poc.core.ApiException
import com.readplace.poc.core.Article
import com.readplace.poc.core.QueuePage
import com.readplace.poc.core.ReadplaceApi
import com.readplace.poc.core.SirenAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Holds reading-list state for the Compose UI — the analogue of the iOS POC's
 * `ReadingListViewModel`. Network calls run on [Dispatchers.IO]; the synchronous core
 * stays off the main thread. State is exposed as Compose snapshot state so screens
 * recompose on change.
 */
class ReadingListViewModel(
	private val api: ReadplaceApi,
	private val onSessionExpired: () -> Unit,
) {
	var articles by mutableStateOf<List<Article>>(emptyList())
		private set
	var isLoading by mutableStateOf(false)
		private set
	var isSaving by mutableStateOf(false)
		private set
	var errorText by mutableStateOf<String?>(null)
	var warningText by mutableStateOf<String?>(null)

	private var nextHref: String? = null
	private var saveArticleAction: SirenAction? = null

	val hasMore: Boolean get() = nextHref != null

	suspend fun loadIfNeeded() {
		if (articles.isEmpty()) fetchFirstPage()
	}

	suspend fun refresh() = fetchFirstPage()

	private suspend fun fetchFirstPage() {
		isLoading = true
		errorText = null
		runCatching { withContext(Dispatchers.IO) { api.loadQueue() } }
			.onSuccess { applyPage(it, replacing = true) }
			.onFailure { handle(it) }
		isLoading = false
	}

	suspend fun loadMore() {
		val next = nextHref ?: return
		runCatching { withContext(Dispatchers.IO) { api.loadQueue(next) } }
			.onSuccess { applyPage(it, replacing = false) }
			.onFailure { handle(it) }
	}

	suspend fun saveUrl(rawUrl: String) {
		val trimmed = rawUrl.trim()
		val action = saveArticleAction
		if (trimmed.isEmpty() || action == null) return
		isSaving = true
		errorText = null
		runCatching { withContext(Dispatchers.IO) { api.saveArticle(action, trimmed) } }
			.onSuccess { fetchFirstPage() }
			.onFailure { handle(it) }
		isSaving = false
	}

	suspend fun delete(article: Article) {
		val href = article.deleteHref ?: return
		val snapshot = articles
		articles = articles.filterNot { it.id == article.id }
		runCatching { withContext(Dispatchers.IO) { api.delete(href) } }
			.onSuccess { applyPage(it, replacing = true) }
			.onFailure { error ->
				val alreadyGone = error is ApiException && error.error is ApiError.NotFound
				if (!alreadyGone) {
					articles = snapshot
					handle(error)
				}
			}
	}

	private fun applyPage(page: QueuePage, replacing: Boolean) {
		articles = if (replacing) {
			page.articles
		} else {
			val existing = articles.mapTo(HashSet()) { it.id }
			articles + page.articles.filter { it.id !in existing }
		}
		nextHref = page.nextHref
		page.saveArticleAction?.let { saveArticleAction = it }
		warningText = page.warning?.message
	}

	private fun handle(error: Throwable) {
		val apiError = (error as? ApiException)?.error
		if (apiError is ApiError.Unauthorized || apiError is ApiError.NoToken) {
			onSessionExpired()
		} else {
			errorText = apiError?.message ?: error.message ?: "Something went wrong."
		}
	}
}
