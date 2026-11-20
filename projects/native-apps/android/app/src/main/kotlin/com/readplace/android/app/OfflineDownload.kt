package com.readplace.android.app

import com.readplace.android.core.OfflineDownloadRun
import com.readplace.android.core.SirenAction

data class OfflineDownloadProgress(val completed: Int, val total: Int) {
	val label: String
		get() = if (total == 0) "Finding unread articles…" else "Downloading $completed of $total for offline reading"

	val fraction: Float
		get() = if (total == 0) 0f else completed.toFloat() / total
}

data class OfflineDownloadRequest(val startHref: String, val sessionAction: SirenAction?)

const val OFFLINE_DOWNLOAD_BUTTON_LABEL = "Download unread for offline reading"

const val OFFLINE_DOWNLOAD_CANCEL_LABEL = "Cancel download"

const val OFFLINE_DOWNLOAD_CONTINUE_LABEL = "Continue"

const val OFFLINE_DOWNLOAD_DISMISS_LABEL = "Dismiss download"

sealed interface OfflineDownloadStatus {
	val label: String
	val fraction: Float
	val dismissLabel: String
	val offersContinue: Boolean

	data class Running(val progress: OfflineDownloadProgress) : OfflineDownloadStatus {
		override val label: String get() = progress.label
		override val fraction: Float get() = progress.fraction
		override val dismissLabel: String get() = OFFLINE_DOWNLOAD_CANCEL_LABEL
		override val offersContinue: Boolean get() = false
	}

	data class Resumable(val run: OfflineDownloadRun) : OfflineDownloadStatus {
		override val label: String get() = "${run.completed} of ${run.total} downloaded for offline reading"
		override val fraction: Float get() = OfflineDownloadProgress(completed = run.completed, total = run.total).fraction
		override val dismissLabel: String get() = OFFLINE_DOWNLOAD_DISMISS_LABEL
		override val offersContinue: Boolean get() = true
	}
}

sealed interface OfflineDownloadOutcome {
	data object Downloaded : OfflineDownloadOutcome

	data class PartiallyDownloaded(val failed: Int, val total: Int) : OfflineDownloadOutcome

	val failureText: String?
		get() = when (this) {
			Downloaded -> null
			is PartiallyDownloaded -> "$failed of $total articles couldn't be downloaded for offline reading"
		}

	companion object {
		fun of(failed: Int, total: Int): OfflineDownloadOutcome =
			if (failed == 0) Downloaded else PartiallyDownloaded(failed = failed, total = total)
	}
}
