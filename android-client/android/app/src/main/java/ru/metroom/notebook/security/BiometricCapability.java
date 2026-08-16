package ru.metroom.notebook.security;

import android.content.Context;
import androidx.biometric.BiometricManager;

/** Capability probe for a future BiometricPrompt-based vault key unwrap flow. */
public final class BiometricCapability {
    private BiometricCapability() {}
    public static boolean isAvailable(Context context) {
        int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        return BiometricManager.from(context).canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS;
    }
}
