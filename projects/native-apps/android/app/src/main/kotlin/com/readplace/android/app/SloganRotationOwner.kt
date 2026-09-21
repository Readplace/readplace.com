package com.readplace.android.app

import androidx.lifecycle.ViewModel

/**
 * Holds the sign-in [SloganRotation] in an Activity-scoped ViewModel so its storm
 * clock and seed are created once at the composition root and survive the sign-in
 * screen coming and going — a configuration change, or signing out back to it —
 * without a second storm starting where the first left off.
 */
class SloganRotationOwner(val rotation: SloganRotation) : ViewModel()
