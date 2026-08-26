package com.readplace.android.core

import okhttp3.Cache
import java.io.File

private const val DISK_CAPACITY_BYTES = 10L * 1024 * 1024

class DiscoveryHttpCache(cacheRoot: File) {
	private val directory = File(cacheRoot, "discovery-http-cache")

	val cache: Cache = Cache(directory, DISK_CAPACITY_BYTES)

	fun purge() {
		directory.deleteRecursively()
	}
}
