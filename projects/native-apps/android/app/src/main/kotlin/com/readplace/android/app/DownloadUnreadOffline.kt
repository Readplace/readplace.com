package com.readplace.android.app

import com.readplace.android.core.OfflineDownloadManifest
import com.readplace.android.core.OfflineDownloadRun
import com.readplace.android.core.OfflineReaderCopy
import com.readplace.android.core.OfflineReadlistSnapshot
import com.readplace.android.core.ReaderPrefetching
import com.readplace.android.core.ReadlistPage
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.SirenAction
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Cookie

class DownloadUnreadOffline(
	private val api: ReadplaceApi,
	private val snapshot: OfflineReadlistSnapshot,
	private val prefetcher: ReaderPrefetching,
	private val manifest: OfflineDownloadManifest,
	private val readerCopy: OfflineReaderCopy,
) {
	suspend fun run(request: OfflineDownloadRequest, report: (OfflineDownloadProgress) -> Unit): OfflineDownloadOutcome {
		val tally = Tally(report, manifest)
		coroutineScope {
			val generation = snapshot.generation
			val session = Session(api, request.sessionAction)
			val queue = Channel<QueuedArticle>(Channel.UNLIMITED)
			manifest.load()
			repeat(CONCURRENT_ARTICLES) {
				launch {
					for (queued in queue) {
						if (isStored(queued) || store(queued, session)) tally.stored() else tally.refused()
					}
				}
			}
			try {
				walk(startHref = request.startHref, generation = generation, queue = queue, tally = tally)
			} finally {
				queue.close()
			}
		}
		manifest.forgetRun()
		return tally.outcome()
	}

	private suspend fun isStored(queued: QueuedArticle): Boolean =
		manifest.versions.value.isCurrent(articleId = queued.id, contentVersion = queued.contentVersion) &&
			readerCopy.isShowable(queued.readerUrl)

	private suspend fun store(queued: QueuedArticle, session: Session): Boolean {
		if (!prefetcher.prefetch(queued.readerUrl, session.cookies())) return false
		readerCopy.record(queued.readerUrl)
		queued.contentVersion?.let { manifest.recordDownloaded(articleId = queued.id, contentVersion = it) }
		return true
	}

	private suspend fun walk(startHref: String, generation: Long, queue: SendChannel<QueuedArticle>, tally: Tally) {
		var page = api.loadReadlist(startHref)
		snapshot.keepFirstPage(page, href = startHref, generation = generation)
		while (true) {
			enqueue(page, queue, tally)
			val next = page.nextHref ?: return
			page = if (page.nextIsOfflinePrefetch) api.loadReadlistAsPrefetch(next) else api.loadReadlist(next)
			snapshot.keepNextPage(page, href = next, generation = generation)
		}
	}

	private suspend fun enqueue(page: ReadlistPage, queue: SendChannel<QueuedArticle>, tally: Tally) {
		val articles = page.articles
			.filter { !it.isRead }
			.mapNotNull { article ->
				article.readHref
					?.let { ReaderRequest.url(it, api.baseUrl) }
					?.let { QueuedArticle(id = article.id, contentVersion = article.contentVersion, readerUrl = it) }
			}
		if (articles.isEmpty()) return
		tally.queued(articles.size)
		for (queued in articles) queue.send(queued)
	}

	private data class QueuedArticle(val id: String, val contentVersion: String?, val readerUrl: String)

	private class Tally(
		private val report: (OfflineDownloadProgress) -> Unit,
		private val manifest: OfflineDownloadManifest,
	) {
		private val lock = Mutex()
		private var completed = 0
		private var total = 0
		private var failed = 0

		suspend fun queued(count: Int) = change { total += count }

		suspend fun stored() = change { completed += 1 }

		suspend fun refused() =
			change {
				completed += 1
				failed += 1
			}

		fun outcome(): OfflineDownloadOutcome = OfflineDownloadOutcome.of(failed = failed, total = total)

		private suspend fun change(update: () -> Unit) =
			lock.withLock {
				update()
				report(OfflineDownloadProgress(completed = completed, total = total))
				manifest.recordRun(OfflineDownloadRun(total = total, completed = completed))
			}
	}

	private class Session(private val api: ReadplaceApi, private val action: SirenAction?) {
		private val lock = Mutex()
		private var minted: List<Cookie>? = null

		suspend fun cookies(): List<Cookie> =
			lock.withLock { minted ?: api.bootstrapSession(action).also { minted = it } }
	}

	companion object {
		const val CONCURRENT_ARTICLES = 4
	}
}
