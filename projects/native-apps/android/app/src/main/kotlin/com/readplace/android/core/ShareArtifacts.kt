package com.readplace.android.core

interface PurgeableUploadQueue {
	fun purgeAll()
}

class ShareArtifacts(
	private val jobs: PurgeableUploadQueue,
	private val unseenSave: UnseenSave,
	private val discoveryCache: DiscoveryHttpCache,
) {
	fun purge() {
		jobs.purgeAll()
		unseenSave.clear()
		discoveryCache.purge()
	}
}
