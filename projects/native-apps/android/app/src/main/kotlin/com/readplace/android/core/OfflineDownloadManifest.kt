package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

@Serializable
data class OfflineDownloadRun(val total: Int, val completed: Int) {
	val isIncomplete: Boolean get() = completed < total
}

class OfflineDownloadManifest(private val directory: File, private val io: CoroutineDispatcher) {
	private val file = File(directory, "download-manifest.json")
	private val lock = Mutex()

	suspend fun incompleteRun(): OfflineDownloadRun? =
		lock.withLock { withContext(io) { read() }.run?.takeIf { it.isIncomplete } }

	suspend fun recordRun(run: OfflineDownloadRun) = replaceRun(run)

	suspend fun forgetRun() = replaceRun(null)

	private suspend fun replaceRun(run: OfflineDownloadRun?) {
		lock.withLock {
			withContext(io) { write(read().copy(run = run)) }
		}
	}

	private fun read(): Stored =
		try {
			json.decodeFromString(Stored.serializer(), file.readText())
		} catch (_: IOException) {
			Stored()
		} catch (_: SerializationException) {
			Stored()
		}

	private fun write(stored: Stored) {
		try {
			directory.mkdirs()
			val staged = File(directory, "download-manifest.json.tmp")
			staged.writeText(json.encodeToString(Stored.serializer(), stored))
			Files.move(
				staged.toPath(),
				file.toPath(),
				StandardCopyOption.ATOMIC_MOVE,
				StandardCopyOption.REPLACE_EXISTING,
			)
		} catch (_: IOException) {
		}
	}

	@Serializable
	private data class Stored(val run: OfflineDownloadRun? = null)

	private companion object {
		val json = Json {
			ignoreUnknownKeys = true
			encodeDefaults = true
		}
	}
}
