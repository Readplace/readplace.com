package com.readplace.android.app

import com.readplace.android.core.ApiError
import com.readplace.android.core.CapturedPage
import com.readplace.android.core.HtmlCapturing
import com.readplace.android.core.MultipartForm
import com.readplace.android.core.ReadplaceApi
import com.readplace.android.core.SirenAction
import com.readplace.android.core.UploadJob
import com.readplace.android.core.UploadJobStore
import com.readplace.android.share.saveContentForm
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import java.io.IOException
import java.time.Instant

class DrainUploadJobs(
	private val api: ReadplaceApi,
	private val captor: HtmlCapturing,
	private val jobs: UploadJobStore,
	private val now: () -> Instant,
) {
	private data class Readied(val job: UploadJob, val contentType: String)

	suspend fun run() {
		jobs.removeOrphanedBytes()
		val due = jobs.loadAll(now())
		if (due.isEmpty()) return
		val page = try {
			api.loadQueue()
		} catch (_: ApiError) {
			return
		} catch (_: IOException) {
			return
		}
		val action = page.action(named = "save-content")
		if (action == null) {
			for (job in due) jobs.remove(job)
			return
		}
		for (job in due) {
			if (!currentCoroutineContext().isActive) return
			if (!upload(job, through = action)) return
		}
	}

	private suspend fun upload(job: UploadJob, through: SirenAction): Boolean {
		var current = job
		try {
			val readied = readied(job)
			if (readied == null) {
				jobs.remove(job)
				return true
			}
			current = readied.job
			val body = jobs.bytesFile(readied.job).readBytes()
			api.saveContent(through, readied.contentType, body)
			jobs.remove(readied.job)
		} catch (_: ApiError.Unauthorized) {
			return false
		} catch (_: ApiError.NoToken) {
			return false
		} catch (_: ApiError.Refused) {
			jobs.remove(current)
		} catch (error: ApiError.Server) {
			if (error.status in 400..499) jobs.remove(current) else reschedule(current)
		} catch (_: ApiError) {
			reschedule(current)
		} catch (_: IOException) {
			reschedule(current)
		}
		return true
	}

	private suspend fun readied(job: UploadJob): Readied? =
		when (val state = job.state) {
			is UploadJob.State.Ready -> Readied(job, state.contentType)
			is UploadJob.State.CapturePending -> {
				val form = content(job, detectedMediaType = state.detectedMediaType) ?: return null
				Readied(jobs.stageReady(job, form), form.contentType)
			}
		}

	private suspend fun content(job: UploadJob, detectedMediaType: String?): MultipartForm? {
		if (detectedMediaType == PDF_MEDIA_TYPE) {
			val bytes = api.fetchExternalContent(job.url) ?: return null
			if (!isPdf(bytes)) return null
			return saveContentForm(url = job.url, bytes = bytes, mediaType = PDF_MEDIA_TYPE, title = job.title)
		}
		val captured = captor.capture(job.url)
		if (captured !is CapturedPage.Html || captured.html.isEmpty()) return null
		val title = captured.title?.takeIf { it.isNotEmpty() } ?: job.title
		return saveContentForm(
			url = job.url,
			bytes = captured.html.toByteArray(Charsets.UTF_8),
			mediaType = "text/html",
			title = title,
		)
	}

	private fun reschedule(job: UploadJob) {
		val retried = job.retried(now())
		if (retried == null) {
			jobs.remove(job)
			return
		}
		try {
			jobs.update(retried)
		} catch (_: IOException) {
		}
	}

	private fun isPdf(bytes: ByteArray): Boolean =
		bytes.size >= PDF_MAGIC.size && PDF_MAGIC.indices.all { bytes[it] == PDF_MAGIC[it] }

	private companion object {
		const val PDF_MEDIA_TYPE = "application/pdf"
		val PDF_MAGIC: ByteArray = "%PDF-".toByteArray(Charsets.UTF_8)
	}
}
