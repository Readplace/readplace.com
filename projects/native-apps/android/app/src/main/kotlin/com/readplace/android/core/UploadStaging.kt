package com.readplace.android.core

import java.io.File

/**
 * Where a save's captured content waits for the background upload that carries
 * it. The body must live on disk, in the app's cache: the upload runs long after
 * the share target is gone, and only a file is readable from there.
 */
class UploadStaging(cacheRoot: File) {
	private val directory = File(cacheRoot, "share-uploads")

	/**
	 * Deletes one staged body by the name the upload task carries, so the delete
	 * resolves through the directory this process owns rather than a path baked
	 * into a task that may outlive its process.
	 */
	fun remove(name: String) {
		File(directory, name).delete()
	}
}
