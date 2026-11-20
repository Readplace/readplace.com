package com.readplace.android.app

import android.app.Activity
import com.google.android.gms.tasks.Task
import com.google.android.play.agesignals.AgeSignalsAccessRequest
import com.google.android.play.agesignals.AgeSignalsManagerFactory
import com.google.android.play.agesignals.AgeSignalsRequest
import com.google.android.play.agesignals.ApplicableAgeFeaturesRequest
import com.google.android.play.agesignals.model.AgeSignalsStatus
import com.google.android.play.agesignals.model.ApplicableAgeFeature
import com.google.android.play.agesignals.model.SignificantChangeStatus
import com.readplace.android.core.AgeRange
import com.readplace.android.core.AgeSignal
import com.readplace.android.core.AgeSignalSource
import com.readplace.android.core.ParentalApproval
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class PlayAgeSignalSource(private val activity: Activity) : AgeSignalSource {
	private val manager = AgeSignalsManagerFactory.create(activity.applicationContext)

	override suspend fun read(): AgeSignal {
		val features = manager.getApplicableAgeFeatures(ApplicableAgeFeaturesRequest.builder().build()).awaitOrNull()
			?: return AgeSignal.NotApplicable
		if (ApplicableAgeFeature.MANDATORY_SHARING !in features.features()) return AgeSignal.NotApplicable
		val access = manager.requestAgeSignalsAccess(AgeSignalsAccessRequest.builder().setActivity(activity).build())
			.awaitOrNull() ?: return AgeSignal.NotApplicable
		return when (access.ageSignalsStatus()) {
			AgeSignalsStatus.VERIFICATION_REQUIRED -> AgeSignal.VerificationRequired
			AgeSignalsStatus.NOT_SHARED -> AgeSignal.Declined
			AgeSignalsStatus.SHARED -> known()
			else -> AgeSignal.NotApplicable
		}
	}

	private suspend fun known(): AgeSignal {
		val result = manager.checkAgeSignals(AgeSignalsRequest.builder().build()).awaitOrNull()
			?: return AgeSignal.NotApplicable
		val approval = when (result.significantChangeStatus()) {
			SignificantChangeStatus.APPROVED -> ParentalApproval.APPROVED
			SignificantChangeStatus.PENDING -> ParentalApproval.PENDING
			SignificantChangeStatus.DECLINED -> ParentalApproval.DENIED
			else -> ParentalApproval.NONE_REPORTED
		}
		return AgeSignal.Known(AgeRange.of(lower = result.ageLower(), upper = result.ageUpper()), approval)
	}
}

private suspend fun <T> Task<T>.awaitOrNull(): T? = suspendCancellableCoroutine { continuation ->
	addOnSuccessListener { continuation.resume(it) }
	addOnFailureListener { continuation.resume(null) }
	addOnCanceledListener { continuation.resume(null) }
}
