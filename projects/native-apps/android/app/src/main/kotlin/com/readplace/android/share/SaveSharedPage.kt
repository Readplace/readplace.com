package com.readplace.android.share

import com.readplace.android.core.ApiError
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.MultipartForm
import com.readplace.android.core.Readlist
import com.readplace.android.core.ReadlistPage
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.ShareTarget
import com.readplace.android.core.SharedArticlesDrop
import com.readplace.android.core.TokenStore
import com.readplace.android.core.UnseenSave
import com.readplace.android.core.UploadJob
import com.readplace.android.core.UploadJobStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Clock
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Presents the "where do shared articles drop?" chooser and awaits the reader's
 * answer — the set of extra readlists they ticked (mainline is implied). A seam so
 * the save journey is tested with a canned answer; production shows the sheet.
 * Cancellation (the share dismissed mid-choice) throws, and is never delivered as
 * an empty answer.
 */
fun interface ReadlistChooser {
	suspend fun choose(drops: List<SharedArticlesDrop>): Set<Readlist>
}

/**
 * The share-sheet save journey, lifted out of the share activity so the full
 * decision tree runs against the real API and token types under test — only the
 * Android shell and the WebView are left behind in the share target.
 */
class SaveSharedPage(
	private val store: TokenStore,
	private val api: ReadplaceApi,
	private val captor: HtmlCapturing,
	/** Null when this build has no shared file store to stage a body in, which
	 * costs the enrichment upload and nothing else. */
	private val jobs: UploadJobStore?,
	/** Null for the same no-store reason as [jobs], which costs only the app's
	 * automatic list refresh on return. */
	private val unseenSave: UnseenSave?,
	private val shareTarget: ShareTarget,
	private val readlistChooser: ReadlistChooser,
	private val clock: Clock,
	private val stillSavingAfter: Duration = 4.seconds,
) {
	/**
	 * [sharedPdf] lazily loads the bytes of a PDF the share sheet delivered as a
	 * file (null when the payload carried none) — a closure rather than the bytes
	 * so a share that fails the guards above never pays for the load. [onNotice]
	 * receives any server-authored save notice (the readlist collection's
	 * `noticeMessages`) as soon as the list loads. [onSaved] fires the moment the
	 * link is on the server — carrying the server's confirmation. All default to
	 * no-ops so the outcome-only callers stay untouched.
	 */
	suspend fun run(
		url: String?,
		fallbackTitle: String?,
		sharedPdf: (suspend () -> ByteArray?)?,
		onNotice: (List<ServerMessage>) -> Unit = {},
		onSaved: (List<ServerMessage>) -> Unit = {},
		onStillSaving: () -> Unit = {},
	): SaveSharedOutcome {
		val tokens = store.loadTokens().getOrElse { return SaveSharedOutcome.StorageUnavailable(it.javaClass.simpleName) }
		if (tokens == null) return SaveSharedOutcome.NotLoggedIn
		if (url == null) return SaveSharedOutcome.NoLink

		return coroutineScope {
			// Started before the list round trip rather than after it, so the render —
			// the slowest leg by far — overlaps the network instead of following it.
			val content = async { resolveContent(url = url, fallbackTitle = fallbackTitle, sharedPdf = sharedPdf) }
			try {
				journey(
					url = url,
					fallbackTitle = fallbackTitle,
					content = content,
					onNotice = onNotice,
					onSaved = onSaved,
					onStillSaving = onStillSaving,
				)
			} catch (refused: ApiError.Refused) {
				SaveSharedOutcome.Refused(refused.messages)
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (error: Exception) {
				SaveSharedOutcome.Failed(error.message ?: "Save failed.")
			} finally {
				content.cancel()
			}
		}
	}

	private suspend fun CoroutineScope.journey(
		url: String,
		fallbackTitle: String?,
		content: Deferred<ResolvedContent>,
		onNotice: (List<ServerMessage>) -> Unit,
		onSaved: (List<ServerMessage>) -> Unit,
		onStillSaving: () -> Unit,
	): SaveSharedOutcome {
		var page = api.loadReadlist()
		// Snapshot the destination choice once — asking the reader if they have never
		// answered and there is somewhere other than mainline to drop — before the save
		// so the save carries the same array the reader confirmed.
		val queues = tickedReadlists(page)
		onNotice(page.noticeMessages)
		val action = page.action(named = "save-article") ?: return SaveSharedOutcome.NoSaveAction
		val confirmation = try {
			api.saveArticle(action, url, queues)
		} catch (cancelled: CancellationException) {
			throw cancelled
		} catch (error: Exception) {
			if (ApiError.isRefusalOrAuthFailure(error)) throw error
			page = api.rediscoverReadlist()
			val moved = page.action(named = "save-article") ?: return SaveSharedOutcome.NoSaveAction
			api.saveArticle(moved, url, queues)
		}
		unseenSave?.record()
		val admitted = admit(page = page, url = url, title = fallbackTitle)
		onSaved(confirmation.messages)
		if (jobs == null || admitted == null) return SaveSharedOutcome.Saved(confirmation.messages)

		val stillSaving = launch {
			delay(stillSavingAfter)
			onStillSaving()
		}
		try {
			persist(content.await(), job = admitted, jobs = jobs)
		} finally {
			stillSaving.cancel()
		}
		return SaveSharedOutcome.SavedAwaitingUpload(confirmation.messages)
	}

	/**
	 * The extra readlist hrefs this save should file into, snapshotted once. Asks the
	 * reader — once, ever — only when they have not answered and the collection
	 * advertises somewhere other than mainline to drop; a Done answer (even ticking
	 * nothing) is persisted before the save so it survives even if the save then
	 * fails. Only-mainline or no-readlist collections save without asking or
	 * recording an answer. The mainline root is subtracted so it is never sent as a
	 * queue — every save drops there implicitly; a stale stored href the collection
	 * no longer advertises is still sent, and the server filters it to owned
	 * readlists.
	 */
	private suspend fun tickedReadlists(page: ReadlistPage): Set<String> {
		val drops = SharedArticlesDrop.firstAsk(readlists = page.readlists, mainlineHref = page.rootHref)
		if (!shareTarget.isDecided && drops.any { it.choice != null }) {
			shareTarget.record(readlistChooser.choose(drops).map { it.href }.toSet())
		}
		return shareTarget.hrefs - setOfNotNull(page.rootHref)
	}

	private suspend fun admit(page: ReadlistPage, url: String, title: String?): UploadJob? {
		if (jobs == null || page.action(named = "save-content") == null) return null
		val now = clock.instant()
		val job = UploadJob(
			id = UUID.randomUUID().toString(),
			url = url,
			title = title,
			state = UploadJob.State.CapturePending(detectedMediaType = null),
			attempts = 0,
			nextAttemptAt = now,
			createdAt = now,
		)
		try {
			jobs.admit(job)
		} catch (_: IOException) {
		}
		return job
	}

	private suspend fun persist(content: ResolvedContent, job: UploadJob, jobs: UploadJobStore) {
		try {
			when (content) {
				is ResolvedContent.Form -> jobs.stageReady(job, content.form)
				ResolvedContent.PdfDetected -> jobs.update(job.detecting(mediaType = PDF_MEDIA_TYPE))
				ResolvedContent.None -> Unit
			}
		} catch (_: IOException) {
		}
	}

	private sealed interface ResolvedContent {
		class Form(val form: MultipartForm) : ResolvedContent

		data object PdfDetected : ResolvedContent

		data object None : ResolvedContent
	}

	/**
	 * A PDF the share sheet already delivered as a file is used as-is — no
	 * render, no refetch a bot-defended origin could block. The bytes must carry
	 * the `%PDF-` magic header, so a payload that is not a PDF yields nothing
	 * rather than uploading junk. HTML uses the bytes the captor already
	 * rendered.
	 */
	private suspend fun resolveContent(
		url: String,
		fallbackTitle: String?,
		sharedPdf: (suspend () -> ByteArray?)?,
	): ResolvedContent {
		val delivered = sharedPdf?.invoke()
		if (delivered != null && delivered.startsWith(PDF_MAGIC)) {
			return ResolvedContent.Form(
				saveContentForm(url = url, bytes = delivered, mediaType = PDF_MEDIA_TYPE, title = fallbackTitle),
			)
		}
		return when (val captured = captor.capture(url)) {
			is CapturedPage.Html -> rendered(url = url, captured = captured, fallbackTitle = fallbackTitle)
			CapturedPage.PdfDetected -> ResolvedContent.PdfDetected
			CapturedPage.Empty -> ResolvedContent.None
		}
	}

	private fun rendered(url: String, captured: CapturedPage.Html, fallbackTitle: String?): ResolvedContent {
		if (captured.html.isEmpty()) return ResolvedContent.None
		val title = captured.title?.takeIf { it.isNotEmpty() } ?: fallbackTitle
		return ResolvedContent.Form(
			saveContentForm(
				url = url,
				bytes = captured.html.toByteArray(Charsets.UTF_8),
				mediaType = HTML_MEDIA_TYPE,
				title = title,
			),
		)
	}

	private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
		size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

	private companion object {
		val PDF_MAGIC: ByteArray = "%PDF-".toByteArray(Charsets.UTF_8)
		const val PDF_MEDIA_TYPE = "application/pdf"
		const val HTML_MEDIA_TYPE = "text/html"
	}
}

/**
 * The `save-content` fields in wire order, boundary included, so the body that is
 * staged and the `Content-Type` the request declares can never disagree.
 */
fun saveContentForm(url: String, bytes: ByteArray, mediaType: String, title: String?): MultipartForm {
	val textParts = mutableListOf(
		MultipartForm.TextPart(name = "url", value = url),
		MultipartForm.TextPart(name = "mediaType", value = mediaType),
	)
	if (!title.isNullOrEmpty()) textParts += MultipartForm.TextPart(name = "title", value = title)
	return MultipartForm(
		boundary = UUID.randomUUID().toString(),
		textParts = textParts,
		filePart = MultipartForm.FilePart(name = "content", filename = "content", bytes = bytes),
	)
}

/**
 * One-shot gate so exactly one racer resumes the continuation. Shared with the
 * share sheet, which races the reader's dismissal against the journey settling.
 */
class FirstClaim {
	private val taken = AtomicBoolean(false)

	fun take(): Boolean = taken.compareAndSet(false, true)
}
