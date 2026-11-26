package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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

data class KeptVersion(val contentVersion: String, val savedAt: Instant) {
	fun isCurrent(contentVersion: String?, now: Instant): Boolean =
		contentVersion == this.contentVersion && OfflineCopy.isShowable(savedAt = savedAt, now = now)
}

data class DownloadedVersions(val byReaderUrl: Map<String, KeptVersion>) {
	fun isCurrent(readerUrl: String, contentVersion: String?, now: Instant): Boolean =
		byReaderUrl[readerUrl]?.isCurrent(contentVersion, now) == true
}

class ReaderPageResponse(
	val contentType: String,
	val contentSecurityPolicy: String?,
	val contentVersion: String?,
	val body: ByteArray,
)

class StoredReaderPage(
	val savedAt: Instant,
	val articleId: String,
	val contentVersion: String?,
	val contentType: String,
	val contentSecurityPolicy: String?,
	val body: ByteArray,
)

class OfflineReaderPages(
	directory: File,
	private val io: CoroutineDispatcher,
	private val now: () -> Instant,
	private val currentGeneration: () -> Long,
) {
	@Serializable
	private data class Header(
		val savedAt: Long,
		val articleId: String,
		val contentVersion: String?,
		val contentType: String,
		val contentSecurityPolicy: String?,
		val readerUrl: String?,
	) {
		val keptVersion: KeptVersion?
			get() = contentVersion?.let { KeptVersion(contentVersion = it, savedAt = Instant.ofEpochSecond(savedAt)) }
	}

	private val pages = File(directory, "reader-pages")
	private val published = MutableStateFlow(DownloadedVersions(emptyMap()))

	val versions: StateFlow<DownloadedVersions> = published.asStateFlow()

	suspend fun load() {
		val held = withContext(io) {
			pages.listFiles().orEmpty()
				.mapNotNull { file ->
					val header = (if (file.name.endsWith(STAGED_SUFFIX)) null else headerOf(file))?.takeIf(::isShowable)
					header ?: null.also { file.delete() }
				}
				.mapNotNull { header -> header.readerUrl?.let { url -> header.keptVersion?.let { url to it } } }
				.toMap()
		}
		published.value = DownloadedVersions(held)
	}

	suspend fun keep(readerUrl: String, articleId: String, contentVersion: String?, response: ReaderPageResponse, generation: Long): Boolean =
		withContext(io) {
			if (generation != currentGeneration()) return@withContext false
			val header = Header(
				savedAt = now().epochSecond,
				articleId = articleId,
				contentVersion = contentVersion,
				contentType = response.contentType,
				contentSecurityPolicy = response.contentSecurityPolicy,
				readerUrl = readerUrl,
			)
			val file = fileFor(readerUrl)
			try {
				pages.mkdirs()
				val staged = File(pages, file.name + STAGED_SUFFIX)
				staged.outputStream().use { out ->
					out.write(json.encodeToString(Header.serializer(), header).toByteArray(Charsets.UTF_8))
					out.write(SEPARATOR.code)
					out.write(response.body)
				}
				Files.move(staged.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
			} catch (_: IOException) {
				return@withContext false
			}
			if (generation != currentGeneration()) {
				file.delete()
				return@withContext false
			}
			published.update { held ->
				val kept = header.keptVersion
				DownloadedVersions(if (kept == null) held.byReaderUrl - readerUrl else held.byReaderUrl + (readerUrl to kept))
			}
			true
		}

	suspend fun find(readerUrl: String): StoredReaderPage? =
		withContext(io) {
			val bytes = try {
				fileFor(readerUrl).readBytes()
			} catch (_: IOException) {
				return@withContext null
			}
			val end = bytes.indexOf(SEPARATOR.code.toByte())
			if (end < 0) return@withContext null
			val header = decode(String(bytes, 0, end, Charsets.UTF_8)) ?: return@withContext null
			if (!isShowable(header)) return@withContext null
			StoredReaderPage(
				savedAt = Instant.ofEpochSecond(header.savedAt),
				articleId = header.articleId,
				contentVersion = header.contentVersion,
				contentType = header.contentType,
				contentSecurityPolicy = header.contentSecurityPolicy,
				body = bytes.copyOfRange(end + 1, bytes.size),
			)
		}

	suspend fun isCurrent(readerUrl: String, contentVersion: String?): Boolean =
		withContext(io) {
			headerOf(fileFor(readerUrl))?.keptVersion?.isCurrent(contentVersion, now = now()) == true
		}

	private fun headerOf(file: File): Header? {
		val line = try {
			file.bufferedReader(Charsets.UTF_8).use { it.readLine() }
		} catch (_: IOException) {
			return null
		}
		return line?.let(::decode)
	}

	private fun decode(line: String): Header? =
		try {
			json.decodeFromString(Header.serializer(), line)
		} catch (_: SerializationException) {
			null
		}

	private fun isShowable(header: Header): Boolean =
		OfflineCopy.isShowable(savedAt = Instant.ofEpochSecond(header.savedAt), now = now())

	private fun fileFor(readerUrl: String): File {
		val digest = MessageDigest.getInstance("SHA-256").digest(readerUrl.toByteArray(Charsets.UTF_8))
		return File(pages, digest.joinToString("") { "%02x".format(it) })
	}

	private companion object {
		const val SEPARATOR = '\n'
		const val STAGED_SUFFIX = ".tmp"
		val json = Json {
			ignoreUnknownKeys = true
			explicitNulls = false
		}
	}
}
