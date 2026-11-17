package com.readplace.android.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import java.time.Instant
import java.util.UUID

@Serializable
data class NativeAuthEvent(
	val event_id: String, val event: AuthEvent, val occurred_at: String,
	val client: String, val surface: AuthSurface, val context_id: String, val client_version: String,
	val operation_id: String? = null, val attempt_id: String? = null,
	val http_status: Int? = null, val outcome: AuthOutcome? = null, val reason: AuthReason? = null,
	val dropped_events: Int? = null,
)

@Serializable
data class NativeAuthJournalEntry(val event: NativeAuthEvent, val identity: String, val permit: String?)

data class NativeProofInput(val url: String, val body: ByteArray, val operation: String, val nonce: String?, val installation: String)
fun interface NativeProof { fun sign(input: NativeProofInput): String }

class NativeRefreshRecovery(
	private val endpoints: ServerEndpoints, private val records: NativeAuthRecords,
	http: OkHttpClient, private val proof: NativeProof,
	private val version: String, private val surface: AuthSurface,
) {
	private val http = http.newBuilder().followRedirects(false).followSslRedirects(false)
		.callTimeout(10, java.util.concurrent.TimeUnit.SECONDS).build()
	private val context = UUID.randomUUID().toString()
	private var supported: Boolean? = null
	private val json = Json { ignoreUnknownKeys = true }
	private val uploading = java.util.concurrent.atomic.AtomicBoolean(false)

	fun requestHeaders(): Map<String, String> = mapOf(
		"X-Readplace-Auth-Attempt-Id" to UUID.randomUUID().toString(), "X-Readplace-Auth-Context-Id" to context,
		"X-Readplace-Client-Version" to version, "X-Readplace-Installation-Id" to records.read().installationId,
	)

	fun record(event: AuthEvent, outcome: AuthOutcome? = null, reason: AuthReason? = null,
		operation: String? = null, attempt: String? = null, status: Int? = null, owner: NativeRefreshOperation? = null,
		surface: AuthSurface? = null) {
		val entry = NativeAuthEvent(UUID.randomUUID().toString(), event, Instant.now().toString(), "android", surface ?: this.surface,
			context, version, operation, attempt, status, outcome, reason)
		runCatching { records.update { state ->
			val earliest = Instant.now().minusSeconds(7 * 86400).toString()
			val identity = owner?.diagnosticIdentity ?: state.diagnosticIdentity
			val permit = if (identity == state.diagnosticIdentity) state.diagnosticsPermit else owner?.diagnosticsPermit
			var dropped = state.diagnostics.lastOrNull { it.identity == identity && it.event.event == AuthEvent.JOURNAL_HEALTH }?.event?.dropped_events ?: 0
			val previous = state.diagnostics.filterNot { it.identity == identity && it.event.event == AuthEvent.JOURNAL_HEALTH }
			var events = previous.filter { it.event.occurred_at >= earliest }
			dropped += previous.size - events.size
			events = events + NativeAuthJournalEntry(entry, identity, permit)
			val healthId = UUID.randomUUID().toString()
			fun checkpoint() = if (dropped == 0) emptyList() else listOf(NativeAuthJournalEntry(
				entry.copy(event_id = healthId, event = AuthEvent.JOURNAL_HEALTH, operation_id = null, attempt_id = null,
					http_status = null, outcome = AuthOutcome.SUCCESS, reason = AuthReason.JOURNAL_OVERFLOW, dropped_events = dropped), identity, permit))
			while (events.size + checkpoint().size > 512 || Json.encodeToString(events + checkpoint()).toByteArray().size > 256 * 1024) {
				events = events.drop(1); dropped++
			}
			state.diagnostics = events + checkpoint()
		} }
	}

	suspend fun refresh(failed: OAuthTokens): OAuthTokens? = withContext(Dispatchers.IO) {
		val current = records.read()
		if (current.tokens != failed) return@withContext current.tokens ?: throw OAuthError.NoRefreshToken()
		if (!current.bound && current.pending == null && !isSupported()) return@withContext null
		val operation = records.prepare(failed)
		record(AuthEvent.REFRESH_PREPARED, operation = operation.id, owner = operation)
		val answer = exchange(operation)
		if (answer.second <= Instant.now()) exchange(records.prepare(answer.first)).first else answer.first
	}

	private fun isSupported(): Boolean {
		supported?.let { return it }
		http.newCall(Request.Builder().url(endpoints.authorizationServerMetadata).build()).execute().use { response ->
			if (response.code != 200) throw OAuthError.RefreshFailed()
			val metadata = json.parseToJsonElement(response.body.string()).jsonObject
			val enabled = metadata["readplace_refresh_protocols_supported"]?.jsonArray?.any { it.jsonPrimitive.intOrNull == 1 } == true &&
				metadata["readplace_refresh_enrollment_enabled"]?.jsonPrimitive?.booleanOrNull == true
			supported = enabled
			return enabled
		}
	}

	private fun exchange(operation: NativeRefreshOperation): Pair<OAuthTokens, Instant> {
		val form = FormBody.Builder().add("grant_type", "refresh_token").add("refresh_token", operation.refresh)
			.add("client_id", AppConfig.CLIENT_ID).add("readplace_refresh_protocol", "1")
			.add("readplace_refresh_operation_id", operation.id).build()
		val body = Buffer().also { form.writeTo(it) }.readByteArray()
		val answer = send(body, url = endpoints.token, contentType = "application/x-www-form-urlencoded", owner = operation)
		val parsed = runCatching { json.parseToJsonElement(answer.body).jsonObject }.getOrNull()
		if (answer.status != 200) {
			val reason = parsed?.get("readplace_reason")?.jsonPrimitive?.contentOrNull
			if (parsed?.get("error")?.jsonPrimitive?.contentOrNull == "invalid_grant" && reason in listOf("expired", "revoked", "superseded")) {
				val now = records.read()
				if (now.tokens?.refreshToken?.raw != operation.refresh && now.tokens != null) return now.tokens!! to Instant.MAX
				records.update { state ->
					if (state.generation != operation.generation || state.pending != operation) throw OAuthError.SessionChanged()
					state.generation++; state.access = null; state.refresh = null; state.pending = null
				}
				record(AuthEvent.CREDENTIALS_CLEARED, AuthOutcome.FAILURE, json.decodeFromJsonElement(AuthReason.serializer(), JsonPrimitive(reason)), operation.id, owner = operation)
				throw OAuthError.NoRefreshToken()
			}
			record(AuthEvent.REFRESH_FAILED, AuthOutcome.PRESERVED, AuthReason.HTTP_ERROR, operation.id, owner = operation)
			throw OAuthError.RefreshFailed()
		}
		val receipt = parsed?.get("readplace")?.jsonObject ?: throw OAuthError.MalformedResponse()
		if (receipt["protocol"]?.jsonPrimitive?.intOrNull != 1 || receipt["operation_id"]?.jsonPrimitive?.contentOrNull != operation.id) throw OAuthError.MalformedResponse()
		val access = parsed["access_token"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() } ?: throw OAuthError.MalformedResponse()
		val refresh = parsed["refresh_token"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() } ?: throw OAuthError.MalformedResponse()
		val expiry = runCatching { Instant.parse(receipt["access_expires_at"]?.jsonPrimitive?.content) }.getOrNull() ?: throw OAuthError.MalformedResponse()
		val tokens = OAuthTokens(AccessToken(access), RefreshToken(refresh))
		record(AuthEvent.REFRESH_PARSED, AuthOutcome.SUCCESS, operation = operation.id, owner = operation)
		record(AuthEvent.STORAGE_STARTED, operation = operation.id, owner = operation)
		try { records.commit(tokens, operation, receipt["diagnostics_permit"]?.jsonPrimitive?.contentOrNull) }
		catch (changed: OAuthError.SessionChanged) { return (records.read().tokens ?: throw changed) to Instant.MAX }
		catch (error: Exception) {
			record(AuthEvent.STORAGE_FAILED, AuthOutcome.PRESERVED, AuthReason.STORAGE_WRITE_FAILED, operation.id, owner = operation)
			throw error
		}
		record(AuthEvent.STORAGE_COMPLETED, AuthOutcome.SUCCESS, operation = operation.id, owner = operation)
		record(if (receipt["recovered"]?.jsonPrimitive?.booleanOrNull == true) AuthEvent.REFRESH_RECOVERED else AuthEvent.REFRESH_COMPLETED, AuthOutcome.SUCCESS, operation = operation.id, owner = operation)
		return tokens to expiry
	}

	suspend fun revoke(previous: NativeAuthRecord) = withContext(Dispatchers.IO) {
		val token = previous.refresh ?: return@withContext
		val operation = UUID.randomUUID().toString()
		val body = buildJsonObject {
			put("token", token); put("client_id", AppConfig.CLIENT_ID)
			put("readplace_refresh_protocol", 1); put("readplace_refresh_operation_id", operation)
		}.toString().toByteArray(Charsets.UTF_8)
		send(body, url = endpoints.revoke, contentType = "application/json", owner = NativeRefreshOperation(operation, previous.generation,
			previous.access ?: "", token, previous.diagnosticIdentity, previous.diagnosticsPermit))
		Unit
	}

	private data class Answer(val status: Int, val body: String)
	private fun send(body: ByteArray, url: String, contentType: String, owner: NativeRefreshOperation): Answer {
		val operation = owner.id
		var nonce: String? = null
		var challenge = 0
		while (true) {
			val state = records.read()
			if (url == endpoints.token && state.pending?.id != operation) throw OAuthError.SessionChanged()
			val attempt = UUID.randomUUID().toString()
			val request = Request.Builder().url(url).post(body.toRequestBody(contentType.toMediaType()))
				.header("DPoP", proof.sign(NativeProofInput(url, body, operation, nonce, state.installationId)))
				.header("X-Readplace-Auth-Attempt-Id", attempt).header("X-Readplace-Auth-Context-Id", context)
				.header("X-Readplace-Client-Version", version).header("X-Readplace-Installation-Id", state.installationId).build()
			record(AuthEvent.REFRESH_REQUEST_STARTED, operation = operation, attempt = attempt, owner = owner)
			try {
				http.newCall(request).execute().use { response ->
					val text = response.body.string()
					record(AuthEvent.REFRESH_RESPONSE_RECEIVED, operation = operation, attempt = attempt, status = response.code, owner = owner)
					val error = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
					val next = response.header("DPoP-Nonce")
					if (challenge < 2 && next != null && (error?.get("error")?.jsonPrimitive?.contentOrNull == "use_dpop_nonce" || error?.get("readplace_reason")?.jsonPrimitive?.contentOrNull == "proof_replayed")) {
						nonce = next
						challenge++
					} else return Answer(response.code, text)
				}
			} catch (error: java.io.IOException) {
				record(AuthEvent.REFRESH_FAILED, AuthOutcome.PRESERVED, AuthReason.NETWORK_ERROR, operation, attempt, owner = owner)
				throw error
			}
		}
	}

	suspend fun flush() = withContext(Dispatchers.IO) {
		if (!uploading.compareAndSet(false, true)) return@withContext
		try { runCatching {
			val state = records.read()
			val permit = state.diagnostics.firstNotNullOfOrNull { it.permit } ?: return@runCatching
			if (state.diagnostics.isEmpty()) return@runCatching
			var events = state.diagnostics.filter { it.permit == permit }.take(64).map { it.event }
			fun body() = buildJsonObject { put("schema_version", 1); put("events", Json.encodeToJsonElement(events)) }.toString().toByteArray()
			while (events.size > 1 && body().size > 32 * 1024) events = events.dropLast(1)
			val request = Request.Builder().url(endpoints.authDiagnostics).post(body().toRequestBody("application/json".toMediaType()))
				.header("Authorization", "Bearer $permit").build()
			http.newCall(request).execute().use { response ->
				if (response.code != 202) return@use
				val ids = json.parseToJsonElement(response.body.string()).jsonObject["accepted_event_ids"]?.jsonArray?.map { it.jsonPrimitive.content }?.toSet() ?: return@use
				records.update { it.diagnostics = it.diagnostics.filterNot { event -> event.event.event_id in ids } }
			}
		} } finally { uploading.set(false) }
		Unit
	}
}
