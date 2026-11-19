package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

data class DownloadedVersions(val byArticleId: Map<String, String>) {
	fun isCurrent(articleId: String, contentVersion: String?): Boolean =
		contentVersion != null && byArticleId[articleId] == contentVersion
}

class OfflineDownloadManifest(private val directory: File, private val io: CoroutineDispatcher) {
	private val file = File(directory, "download-manifest.json")
	private val lock = Mutex()
	private val published = MutableStateFlow(DownloadedVersions(emptyMap()))

	val versions: StateFlow<DownloadedVersions> = published.asStateFlow()

	suspend fun load() {
		lock.withLock {
			published.value = DownloadedVersions(withContext(io) { read() }.versions)
		}
	}

	suspend fun recordDownloaded(articleId: String, contentVersion: String) {
		lock.withLock {
			val next = withContext(io) {
				val stored = read()
				stored.copy(versions = stored.versions + (articleId to contentVersion)).also(::write)
			}
			published.value = DownloadedVersions(next.versions)
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
	private data class Stored(
		val versions: Map<String, String> = emptyMap(),
		val run: JsonElement? = null,
	)

	private companion object {
		val json = Json {
			ignoreUnknownKeys = true
			encodeDefaults = true
		}
	}
}
