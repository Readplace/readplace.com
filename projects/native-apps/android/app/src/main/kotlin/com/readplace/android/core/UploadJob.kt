package com.readplace.android.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

@Serializable
data class UploadJob(
	val id: String,
	val url: String,
	val title: String?,
	val state: State,
	val attempts: Int,
	@Serializable(with = RecordInstant::class) val nextAttemptAt: Instant,
	@Serializable(with = RecordInstant::class) val createdAt: Instant,
) {
	@Serializable
	sealed interface State {
		@Serializable
		@SerialName("capturePending")
		data class CapturePending(val detectedMediaType: String?) : State

		@Serializable
		@SerialName("ready")
		data class Ready(val contentType: String) : State
	}

	fun isDue(now: Instant): Boolean = nextAttemptAt <= now

	fun retried(now: Instant): UploadJob? {
		if (attempts + 1 >= MAX_ATTEMPTS) return null
		return copy(
			attempts = attempts + 1,
			nextAttemptAt = now.plus(RETRY_DELAYS[minOf(attempts, RETRY_DELAYS.size - 1)]),
		)
	}

	fun staged(contentType: String): UploadJob = copy(state = State.Ready(contentType))

	fun detecting(mediaType: String): UploadJob = copy(state = State.CapturePending(mediaType))

	fun toRecord(): String = recordJson.encodeToString(UploadJob.serializer(), this)

	companion object {
		private val RETRY_DELAYS = listOf(60L, 300L, 900L, 3600L, 10800L, 21600L).map { Duration.ofSeconds(it) }
		const val MAX_ATTEMPTS = 8

		private val recordJson = Json {
			classDiscriminator = "kind"
			explicitNulls = false
			// A record written by a later build may carry a field this one does not
			// know; the job is still a job, exactly as the iOS decoder treated it.
			ignoreUnknownKeys = true
		}

		fun fromRecord(record: String): UploadJob =
			recordJson.decodeFromString(UploadJob.serializer(), record)
	}
}

private object RecordInstant : KSerializer<Instant> {
	override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("java.time.Instant", PrimitiveKind.STRING)

	override fun serialize(encoder: Encoder, value: Instant) {
		encoder.encodeString(value.toString())
	}

	override fun deserialize(decoder: Decoder): Instant {
		val text = decoder.decodeString()
		return try {
			Instant.parse(text)
		} catch (error: DateTimeParseException) {
			throw SerializationException("Not an ISO-8601 instant: $text", error)
		}
	}
}
