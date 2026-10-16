package com.readplace.android.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

@Serializable
data class NativeRefreshOperation(val id: String, val generation: Long, val access: String, val refresh: String,
	val diagnosticIdentity: String, val diagnosticsPermit: String?)

@Serializable
data class NativeAuthRecord(
	var generation: Long = 0,
	var accountEpoch: String = "",
	val installationId: String = UUID.randomUUID().toString(),
	var access: String? = null,
	var refresh: String? = null,
	var pending: NativeRefreshOperation? = null,
	var bound: Boolean = false,
	var diagnosticsPermit: String? = null,
	var diagnosticIdentity: String = UUID.randomUUID().toString(),
	var diagnostics: List<NativeAuthJournalEntry> = emptyList(),
) {
	val tokens: OAuthTokens? get() = access?.let { a -> refresh?.let { OAuthTokens(AccessToken(a), RefreshToken(it)) } }
}

interface AuthRecordStorage {
	fun read(): String?
	fun write(value: String)
	fun <T> locked(work: () -> T): T
}

class NativeAuthRecords(private val storage: AuthRecordStorage, private val legacy: TokenStorage) {
	fun read(): NativeAuthRecord = storage.locked { load() }
	fun <T> update(work: (NativeAuthRecord) -> T): T = storage.locked {
		val record = load()
		val result = work(record)
		val encoded = Json.encodeToString(record)
		storage.write(encoded)
		check(storage.read() == encoded) { "Authentication record did not persist" }
		legacy.removeValue(TokenKey.ACCESS_TOKEN)
		legacy.removeValue(TokenKey.REFRESH_TOKEN)
		result
	}

	fun replace(tokens: OAuthTokens?) = update { record ->
		record.generation++
		record.access = tokens?.accessToken?.raw
		record.refresh = tokens?.refreshToken?.raw
		record.pending = null
		record.bound = false
	}

	fun prepare(tokens: OAuthTokens): NativeRefreshOperation = update { record ->
		if (record.tokens != tokens) throw OAuthError.SessionChanged()
		record.pending ?: NativeRefreshOperation(UUID.randomUUID().toString(), record.generation,
			tokens.accessToken.raw, tokens.refreshToken.raw, record.diagnosticIdentity, record.diagnosticsPermit).also { record.pending = it }
	}

	fun commit(tokens: OAuthTokens, operation: NativeRefreshOperation, permit: String?) = update { record ->
		if (record.generation != operation.generation || record.pending != operation) throw OAuthError.SessionChanged()
		record.access = tokens.accessToken.raw; record.refresh = tokens.refreshToken.raw
		record.pending = null; record.bound = true; record.generation++
		if (permit != null) {
			record.diagnosticsPermit = permit
			record.diagnostics = record.diagnostics.map { if (it.identity == record.diagnosticIdentity && it.permit == null) it.copy(permit = permit) else it }
		}
	}

	private fun load(): NativeAuthRecord {
		storage.read()?.let { return Json.decodeFromString<NativeAuthRecord>(it) }
		val access = legacy.readValue(TokenKey.ACCESS_TOKEN).getOrThrow()
		val refresh = legacy.readValue(TokenKey.REFRESH_TOKEN).getOrThrow()
		return NativeAuthRecord(access = access, refresh = refresh)
	}
}
