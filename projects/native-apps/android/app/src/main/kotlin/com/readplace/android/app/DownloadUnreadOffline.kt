package com.readplace.android.app

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
	private val readerCopy: OfflineReaderCopy,
) {
	suspend fun run(request: OfflineDownloadRequest, report: (OfflineDownloadProgress) -> Unit): Unit =
		coroutineScope {
			val generation = snapshot.generation
			val tally = Tally(report)
			val session = Session(api, request.sessionAction)
			val queue = Channel<String>(Channel.UNLIMITED)
			repeat(CONCURRENT_ARTICLES) {
				launch {
					for (url in queue) {
						if (prefetcher.prefetch(url, session.cookies())) readerCopy.record(url)
						tally.stored()
					}
				}
			}
			try {
				walk(startHref = request.startHref, generation = generation, queue = queue, tally = tally)
			} finally {
				queue.close()
			}
		}

	private suspend fun walk(startHref: String, generation: Long, queue: SendChannel<String>, tally: Tally) {
		var page = api.loadReadlist(startHref)
		snapshot.keepFirstPage(page, href = startHref, generation = generation)
		while (true) {
			enqueue(page, queue, tally)
			val next = page.nextHref ?: return
			page = if (page.nextIsOfflinePrefetch) api.loadReadlistAsPrefetch(next) else api.loadReadlist(next)
			snapshot.keepNextPage(page, href = next, generation = generation)
		}
	}

	private suspend fun enqueue(page: ReadlistPage, queue: SendChannel<String>, tally: Tally) {
		val urls = page.articles
			.filter { !it.isRead }
			.mapNotNull { article -> article.readHref?.let { ReaderRequest.url(it, api.baseUrl) } }
		if (urls.isEmpty()) return
		tally.queued(urls.size)
		for (url in urls) queue.send(url)
	}

	private class Tally(private val report: (OfflineDownloadProgress) -> Unit) {
		private val lock = Mutex()
		private var completed = 0
		private var total = 0

		suspend fun queued(count: Int) =
			lock.withLock {
				total += count
				report(OfflineDownloadProgress(completed = completed, total = total))
			}

		suspend fun stored() =
			lock.withLock {
				completed += 1
				report(OfflineDownloadProgress(completed = completed, total = total))
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
