package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant

class OfflineReaderCopy(directory: File, private val io: CoroutineDispatcher, private val now: () -> Instant) {
	private val records = File(directory, "reader-copies")

	suspend fun record(readerUrl: String): Unit =
		withContext(io) {
			records.mkdirs()
			try {
				recordOf(readerUrl).writeText(now().epochSecond.toString())
			} catch (_: IOException) {
			}
		}

	suspend fun isShowable(readerUrl: String): Boolean =
		withContext(io) {
			val text = try {
				recordOf(readerUrl).readText()
			} catch (_: IOException) {
				return@withContext false
			}
			val seconds = text.trim().toLongOrNull() ?: return@withContext false
			OfflineCopy.isShowable(savedAt = Instant.ofEpochSecond(seconds), now = now())
		}

	private fun recordOf(readerUrl: String): File =
		File(records, MessageDigest.getInstance("SHA-256").digest(readerUrl.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) })
}
