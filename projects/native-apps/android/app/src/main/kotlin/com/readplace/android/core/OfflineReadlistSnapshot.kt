package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant

class OfflineReadlistSnapshot(directory: File, private val io: CoroutineDispatcher, private val now: () -> Instant) {
	@Serializable
	private data class Stored(val href: String, val savedAt: Long, val body: String)

	private val pages = File(directory, "readlist-pages")

	suspend fun keepFirstPage(page: ReadlistPage, href: String?) {
		val body = page.sirenBody ?: return
		val key = href ?: ENTRY_POINT
		write(key = key, body = body)
		val tab = page.currentTabHref
		if (tab != null && tab != key) write(key = tab, body = body)
	}

	suspend fun keepNextPage(page: ReadlistPage, href: String): Unit =
		write(key = href, body = page.sirenBody ?: return)

	suspend fun firstPage(href: String?): ReadlistPage? {
		val key = href ?: ENTRY_POINT
		val asked = read(key) ?: return null
		val tab = asked.currentTabHref
		if (tab == null || tab == key) return asked
		return read(tab) ?: asked
	}

	suspend fun nextPage(href: String): ReadlistPage? = read(href)

	private suspend fun write(key: String, body: ByteArray): Unit =
		withContext(io) {
			val record = recordJson.encodeToString(
				Stored.serializer(),
				Stored(href = key, savedAt = now().epochSecond, body = String(body, Charsets.UTF_8)),
			)
			pages.mkdirs()
			try {
				fileFor(key).writeText(record)
			} catch (_: IOException) {
			}
		}

	private suspend fun read(key: String): ReadlistPage? {
		val text = withContext(io) {
			try {
				fileFor(key).readText()
			} catch (_: IOException) {
				null
			}
		} ?: return null
		val stored = try {
			recordJson.decodeFromString(Stored.serializer(), text)
		} catch (_: SerializationException) {
			return null
		}
		if (!OfflineCopy.isShowable(savedAt = Instant.ofEpochSecond(stored.savedAt), now = now())) return null
		return ReadlistPage.stored(stored.body.toByteArray(Charsets.UTF_8), href = key)
	}

	private fun fileFor(key: String): File {
		val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
		return File(pages, digest.joinToString("") { "%02x".format(it) } + ".json")
	}

	private companion object {
		const val ENTRY_POINT = "/"
		val recordJson = Json { ignoreUnknownKeys = true }
	}
}
