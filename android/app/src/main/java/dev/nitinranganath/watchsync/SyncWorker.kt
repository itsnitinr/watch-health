package dev.nitinranganath.watchsync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/**
 * Runs a sync outside the UI, so it survives leaving the screen, rotation, or the app being
 * closed. Used both for "Sync now" (one-off) and hourly auto-sync (periodic).
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val settings = Settings(applicationContext)
        return try {
            Syncer.run(applicationContext) { setProgress(workDataOf(KEY_STATUS to it)) }
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ConfigException) {
            settings.lastResult = "Sync failed: ${e.message}"
            Result.failure()
        } catch (e: Uploader.AuthException) {
            settings.lastResult = "Sync failed: ${e.message}"
            Result.failure()
        } catch (e: SecurityException) {
            settings.lastResult = "Sync failed: Health Connect denied access (${e.message}). Tap Grant access."
            Result.failure()
        } catch (e: Exception) {
            // Network down, computer asleep, Health Connect rate limit, …: progress so far is
            // saved, so retrying later continues from where this attempt stopped.
            settings.lastResult = "Sync paused, will retry: ${e.message ?: e.javaClass.simpleName}"
            Result.retry()
        }
    }

    companion object {
        const val KEY_STATUS = "status"
        const val NOW = "health-sync-now"
        private const val PERIODIC = "health-sync"

        private val wifi = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(wifi).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
        }

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS).setConstraints(wifi).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }
    }
}
