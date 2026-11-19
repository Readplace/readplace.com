package com.readplace.android.app

import com.readplace.android.core.SirenAction

data class OfflineDownloadProgress(val completed: Int, val total: Int, val failed: Int = 0) {
	val label: String
		get() = if (total == 0) "Finding unread articles…" else "Downloading $completed of $total for offline reading"

	val fraction: Float
		get() = if (total == 0) 0f else completed.toFloat() / total

	val failureText: String?
		get() = if (failed == 0) null else "$failed of $total articles couldn't be downloaded for offline reading"
}

data class OfflineDownloadRequest(val startHref: String, val sessionAction: SirenAction?)

const val OFFLINE_DOWNLOAD_BUTTON_LABEL = "Download unread for offline reading"

const val OFFLINE_DOWNLOAD_CANCEL_LABEL = "Cancel download"
