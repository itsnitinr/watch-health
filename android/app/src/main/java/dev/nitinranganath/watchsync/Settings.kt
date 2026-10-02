package dev.nitinranganath.watchsync

import android.content.Context

/** Connection settings and sync bookkeeping, stored in app-private SharedPreferences. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("watch_sync", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(v) = prefs.edit().putString("server_url", v.trim().trimEnd('/')).apply()

    var token: String
        get() = prefs.getString("token", "") ?: ""
        set(v) = prefs.edit().putString("token", v.trim()).apply()

    /** Epoch millis of the last fully successful sync; 0 if never synced. */
    var lastSyncMs: Long
        get() = prefs.getLong("last_sync_ms", 0)
        set(v) = prefs.edit().putLong("last_sync_ms", v).apply()

    var lastResult: String
        get() = prefs.getString("last_result", "") ?: ""
        set(v) = prefs.edit().putString("last_result", v).apply()

    var autoSync: Boolean
        get() = prefs.getBoolean("auto_sync", false)
        set(v) = prefs.edit().putBoolean("auto_sync", v).apply()

    val isConfigured get() = serverUrl.isNotBlank() && token.isNotBlank()
}
