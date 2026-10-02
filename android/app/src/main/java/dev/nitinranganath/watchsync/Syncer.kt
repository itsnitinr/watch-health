package dev.nitinranganath.watchsync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** A problem only the user can fix (settings, permissions), so retrying is pointless. */
class ConfigException(message: String) : Exception(message)

object Syncer {
    /** Re-read this much before the last sync, to pick up data the watch delivered late. */
    private val OVERLAP = Duration.ofDays(2)

    /** Data is read and uploaded one window at a time, and progress is saved after each. */
    private const val WINDOW_DAYS = 14L

    /** The manual sync and the hourly worker must not run at the same time. */
    private val lock = Mutex()

    /**
     * Reads Health Connect from where the last sync got to, up to now, and uploads it.
     * Progress is checkpointed after each window, so an interrupted sync resumes rather than
     * starting over. Returns a short summary; throws on failure.
     */
    suspend fun run(context: Context, onProgress: suspend (String) -> Unit = {}): String = lock.withLock {
        val settings = Settings(context)
        if (!settings.isConfigured) throw ConfigException("Set the server URL and token first.")

        val reader = HealthReader(HealthConnectClient.getOrCreate(context))
        val granted = reader.grantedPermissions()
        if (granted.isEmpty()) throw ConfigException("No Health Connect permissions granted yet.")

        val zone = ZoneId.systemDefault()
        val now = Instant.now()
        val from = if (settings.lastSyncMs == 0L) {
            // First sync: go back as far as Health Connect allows us.
            val days = if (HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY in granted) 365L else 30L
            now.minus(Duration.ofDays(days))
        } else {
            Instant.ofEpochMilli(settings.lastSyncMs).minus(OVERLAP)
        }

        // Align windows to local midnight so daily totals always cover whole days.
        val windows = buildList {
            var start = from.atZone(zone).toLocalDate().atStartOfDay(zone)
            while (start.toInstant() < now) {
                val end = start.plusDays(WINDOW_DAYS)
                add(start.toInstant() to minOf(end.toInstant(), now))
                start = end
            }
        }

        val uploader = Uploader(settings.serverUrl, settings.token)
        val totals = mutableMapOf("samples" to 0, "daily" to 0, "sleep" to 0, "exercise" to 0)
        val day = DateTimeFormatter.ofPattern("d MMM yyyy").withZone(zone)

        windows.forEachIndexed { i, (start, end) ->
            val label = "${day.format(start)} – ${day.format(end)} (${i + 1}/${windows.size})"
            onProgress("Syncing $label")
            reader.readWindow(start, end, granted) { what, payload ->
                onProgress("Syncing $label: $what")
                val counts = uploader.send(payload).getJSONObject("counts")
                for (k in totals.keys) totals[k] = totals.getValue(k) + counts.optInt(k)
            }
            settings.lastSyncMs = end.toEpochMilli()
        }

        val time = DateTimeFormatter.ofPattern("d MMM HH:mm").withZone(zone)
        val summary = "Synced ${time.format(now)}: ${totals["samples"]} samples, ${totals["daily"]} daily totals, " +
            "${totals["sleep"]} sleep sessions, ${totals["exercise"]} workouts"
        settings.lastResult = summary
        summary
    }
}
