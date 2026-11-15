package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

enum class OfflineReadingFailure {
	WRITE,
	DECODE,
}

fun interface OfflineReadingDiagnostics {
	fun report(failure: OfflineReadingFailure)
}

class OfflineReadlistSnapshot(
	private val directory: File,
	private val io: CoroutineDispatcher,
	private val now: () -> Instant,
	private val diagnostics: OfflineReadingDiagnostics,
) {
	@Serializable
	private data class Stored(val href: String, val savedAt: Long, val body: String)

	private val pages = File(directory, "readlist-pages")

	private val lock = Any()

	private val purges = AtomicLong()

	val generation: Long
		get() = purges.get()

	fun purge(): Unit =
		synchronized(lock) {
			purges.incrementAndGet()
			directory.deleteRecursively()
		}

	suspend fun keepFirstPage(page: ReadlistPage, href: String?, generation: Long) {
		val body = page.sirenBody ?: return
		val key = href ?: ENTRY_POINT
		write(key = key, body = body, generation = generation)
		val tab = page.currentTabHref
		if (tab != null && tab != key) write(key = tab, body = body, generation = generation)
	}

	suspend fun keepNextPage(page: ReadlistPage, href: String, generation: Long): Unit =
		write(key = href, body = page.sirenBody ?: return, generation = generation)

	suspend fun firstPage(href: String?): ReadlistPage? {
		val key = href ?: ENTRY_POINT
		val asked = read(key) ?: return null
		val tab = asked.currentTabHref
		if (tab == null || tab == key) return asked
		return read(tab) ?: asked
	}

	suspend fun nextPage(href: String): ReadlistPage? = read(href)

	private suspend fun write(key: String, body: ByteArray, generation: Long): Unit =
		withContext(io) {
			val record = recordJson.encodeToString(
				Stored.serializer(),
				Stored(href = key, savedAt = now().epochSecond, body = String(body, Charsets.UTF_8)),
			)
			synchronized(lock) {
				if (generation != purges.get()) return@synchronized
				pages.mkdirs()
				val file = fileFor(key)
				val pending = File(pages, file.name + ".pending")
				try {
					pending.writeText(record)
					Files.move(pending.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE)
				} catch (_: IOException) {
					diagnostics.report(OfflineReadingFailure.WRITE)
				}
			}
		}

	private suspend fun read(key: String): ReadlistPage? =
		withContext(io) {
			val file = fileFor(key)
			val text = try {
				file.readText()
			} catch (_: IOException) {
				return@withContext null
			}
			val stored = try {
				recordJson.decodeFromString(Stored.serializer(), text)
			} catch (_: SerializationException) {
				diagnostics.report(OfflineReadingFailure.DECODE)
				return@withContext null
			}
			if (!OfflineCopy.isShowable(savedAt = Instant.ofEpochSecond(stored.savedAt), now = now())) {
				deleteIfUnchanged(file = file, text = text)
				return@withContext null
			}
			ReadlistPage.stored(stored.body.toByteArray(Charsets.UTF_8), href = key)
				?: null.also { diagnostics.report(OfflineReadingFailure.DECODE) }
		}

	private fun deleteIfUnchanged(file: File, text: String) {
		synchronized(lock) {
			val current = try {
				file.readText()
			} catch (_: IOException) {
				return
			}
			if (current == text) file.delete()
		}
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
