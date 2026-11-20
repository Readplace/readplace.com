package com.readplace.android.app

import com.readplace.android.core.AgeDecision
import com.readplace.android.core.AgeRange
import com.readplace.android.core.AgeRefusal
import com.readplace.android.core.AgeReport
import com.readplace.android.core.AgeSignalSource
import com.readplace.android.core.ParentalApproval
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface AgeGateState {
	data object Checking : AgeGateState

	data object Clear : AgeGateState

	data object VerificationPrompt : AgeGateState

	data class Refused(val refusal: AgeRefusal, val serverMessage: String?) : AgeGateState
}

class AgeGate(
	private val source: AgeSignalSource,
	private val isLoggedIn: () -> Boolean,
	private val report: suspend (range: AgeRange, approval: ParentalApproval) -> AgeReport,
	private val forceLogout: () -> Unit,
	private val scope: CoroutineScope,
) {
	private val _state = MutableStateFlow<AgeGateState>(AgeGateState.Checking)
	val state: StateFlow<AgeGateState> = _state.asStateFlow()

	private var started = false
	private var unreported: AgeDecision.Refused? = null
	private var reporting = false

	fun start() {
		if (started) return
		started = true
		scope.launch {
			when (val decision = AgeDecision.of(source.read())) {
				AgeDecision.Allowed -> _state.value = AgeGateState.Clear
				AgeDecision.PromptVerification -> _state.value = AgeGateState.VerificationPrompt
				is AgeDecision.Refused -> {
					_state.value = AgeGateState.Refused(decision.refusal, serverMessage = null)
					if (isLoggedIn()) {
						unreported = decision
						reportRefusal()
					}
				}
			}
		}
	}

	fun dismissVerification() {
		if (_state.value == AgeGateState.VerificationPrompt) _state.value = AgeGateState.Clear
	}

	fun onForeground() {
		if (unreported == null || reporting) return
		scope.launch { reportRefusal() }
	}

	suspend fun awaitAllowsSignIn(): Boolean =
		_state.first { it != AgeGateState.Checking } !is AgeGateState.Refused

	private suspend fun reportRefusal() {
		val decision = unreported ?: return
		reporting = true
		val outcome = report(decision.known.range, decision.known.approval)
		reporting = false
		if (outcome is AgeReport.Unknown) return
		unreported = null
		if (outcome is AgeReport.Refused) {
			_state.value = AgeGateState.Refused(decision.refusal, outcome.message)
			forceLogout()
		}
	}
}

fun ageRefusalText(refusal: AgeRefusal, serverMessage: String?): String =
	serverMessage ?: when (refusal) {
		AgeRefusal.UNDER_13 -> "Readplace is for people 13 and over."
		AgeRefusal.PARENTAL_APPROVAL_MISSING ->
			"A parent or guardian needs to approve Readplace in the app store before you can use it."
	}
