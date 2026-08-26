package com.readplace.android.core

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant

class UploadJobStore(filesRoot: File, private val io: CoroutineDispatcher) : PurgeableUploadQueue {
	private val directory = File(filesRoot, "upload-queue")

	fun bytesFile(job: UploadJob): File = File(directory, "${job.id}.multipart")

	suspend fun admit(job: UploadJob): Unit =
		withContext(io) {
			Files.createDirectories(directory.toPath())
			decodedRecords().filter { it.url == job.url }.forEach(::remove)
			write(job)
		}

	suspend fun stageReady(job: UploadJob, form: MultipartForm): UploadJob =
		withContext(io) {
			form.writeTo(bytesFile(job))
			val ready = job.staged(form.contentType)
			write(ready)
			ready
		}

	fun update(job: UploadJob) {
		write(job)
	}

	fun loadAll(now: Instant): List<UploadJob> =
		decodedRecords()
			.filter { it.isDue(now) }
			.sortedBy { it.createdAt }

	fun remove(job: UploadJob) {
		recordFile(job).delete()
		bytesFile(job).delete()
	}

	fun removeOrphanedBytes() {
		val recorded = files(extension = "json").map { it.nameWithoutExtension }.toSet()
		files(extension = "multipart")
			.filter { it.nameWithoutExtension !in recorded }
			.forEach { it.delete() }
	}

	override fun purgeAll() {
		directory.deleteRecursively()
	}

	private fun recordFile(job: UploadJob): File = File(directory, "${job.id}.json")

	private fun write(job: UploadJob) {
		val staged = File(directory, "${job.id}.json.tmp")
		staged.writeText(job.toRecord())
		Files.move(
			staged.toPath(),
			recordFile(job).toPath(),
			StandardCopyOption.ATOMIC_MOVE,
			StandardCopyOption.REPLACE_EXISTING,
		)
	}

	private fun decodedRecords(): List<UploadJob> = files(extension = "json").mapNotNull(::decodedRecord)

	private fun decodedRecord(record: File): UploadJob? =
		try {
			UploadJob.fromRecord(record.readText())
		} catch (_: IOException) {
			null
		} catch (_: SerializationException) {
			null
		}

	private fun files(extension: String): List<File> =
		directory.listFiles().orEmpty().filter { it.extension == extension }
}
