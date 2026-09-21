package com.readplace.android.app

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class SloganRotationOwnerTest {
	private fun ownerFactory(onBuild: () -> Unit = {}): ViewModelProvider.Factory =
		viewModelFactory {
			initializer {
				onBuild()
				SloganRotationOwner(
					SloganRotation(
						seed = 42uL,
						intervalMillis = 12_000L,
						startedAt = Instant.ofEpochSecond(1000),
						fallback = "Fallback.",
					),
				)
			}
		}

	@Test
	fun `the owner and its rotation are constructed once and reused across activity recreation`() {
		val store = ViewModelStore()
		var builds = 0

		fun attach(): SloganRotationOwner =
			ViewModelProvider(store, ownerFactory { builds += 1 }).get(SloganRotationOwner::class)

		val first = attach()
		val afterRecreation = attach()

		assertSame("recreation reuses the retained owner", first, afterRecreation)
		assertSame("and the same rotation, so its storm clock and seed survive", first.rotation, afterRecreation.rotation)
		assertEquals("the rotation is built once for the root lifetime", 1, builds)
	}
}
