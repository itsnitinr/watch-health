package dev.nitinranganath.watchsync

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.ExerciseRoute
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsCadenceRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.reflect.KClass

/**
 * A one-off look at what Health Connect actually holds for your latest run: the GPS route, laps,
 * and how finely distance, speed, cadence and elevation were recorded during it. Nothing is
 * uploaded; the report is only shown on screen, so we can decide what's worth syncing.
 */
object RunCheck {
    data class Result(val report: String, val sessionId: String?, val routeNeedsConsent: Boolean)

    private val RUN_TYPES = setOf(ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL)
    private val time = DateTimeFormatter.ofPattern("d MMM HH:mm").withZone(ZoneId.systemDefault())

    suspend fun latestRun(client: HealthConnectClient): Result {
        val granted = client.permissionController.getGrantedPermissions()
        fun can(type: KClass<out Record>) = HealthPermission.getReadPermission(type) in granted
        if (!can(ExerciseSessionRecord::class)) return Result("Exercise access isn't allowed. Tap Grant access first.", null, false)

        val now = Instant.now()
        val sessions = readAll(client, ExerciseSessionRecord::class, TimeRangeFilter.between(now.minus(Duration.ofDays(30)), now))
        val run = sessions.filter { it.exerciseType in RUN_TYPES }.maxByOrNull { it.startTime }
            ?: return Result("No runs in the last 30 days (${sessions.size} other workouts found).", null, false)

        val range = TimeRangeFilter.between(run.startTime, run.endTime)
        val minutes = Duration.between(run.startTime, run.endTime).toMinutes()
        val lines = mutableListOf(
            "Run: ${time.format(run.startTime)}, $minutes min" + (run.title?.let { " \"$it\"" } ?: ""),
            "Written by: ${run.metadata.dataOrigin.packageName}, device: ${run.metadata.device?.model ?: "unknown"}",
        )

        val route = run.exerciseRouteResult
        lines += "GPS route: " + when (route) {
            is ExerciseRouteResult.Data -> describeRoute(route.exerciseRoute)
            is ExerciseRouteResult.ConsentRequired -> "exists, but needs your permission to read (tap below)"
            is ExerciseRouteResult.NoData -> "none recorded"
            else -> "unknown (${route::class.simpleName})"
        }
        lines += "Laps: ${run.laps.size}" + run.laps.take(3).joinToString("") { lap ->
            "\n  ${Duration.between(lap.startTime, lap.endTime).seconds}s" + (lap.length?.let { ", ${it.inMeters.toInt()} m" } ?: "")
        }
        lines += "Segments: ${run.segments.size}"

        // Records written during the run, and how finely: one total for the whole run is no use
        // for splits, while records every few seconds are.
        if (can(DistanceRecord::class)) {
            val rs = readAll(client, DistanceRecord::class, range)
            lines += "Distance: ${rs.size} records, ${"%.2f".format(rs.sumOf { it.distance.inMeters } / 1000)} km" +
                intervals(rs.map { Duration.between(it.startTime, it.endTime) }) + origins(rs)
        } else lines += "Distance: not allowed"
        lines += if (can(SpeedRecord::class)) {
            val rs = readAll(client, SpeedRecord::class, range)
            "Speed: ${rs.size} records, ${rs.sumOf { it.samples.size }} samples" + spacing(rs.flatMap { r -> r.samples.map { it.time } }) + origins(rs)
        } else "Speed: not allowed (tap Grant access)"
        lines += if (can(StepsCadenceRecord::class)) {
            val rs = readAll(client, StepsCadenceRecord::class, range)
            "Cadence: ${rs.size} records, ${rs.sumOf { it.samples.size }} samples" + spacing(rs.flatMap { r -> r.samples.map { it.time } }) + origins(rs)
        } else "Cadence: not allowed (tap Grant access)"
        lines += if (can(ElevationGainedRecord::class)) {
            val rs = readAll(client, ElevationGainedRecord::class, range)
            "Elevation gained: ${rs.size} records, ${rs.sumOf { it.elevation.inMeters }.toInt()} m" +
                intervals(rs.map { Duration.between(it.startTime, it.endTime) }) + origins(rs)
        } else "Elevation: not allowed (tap Grant access)"
        if (can(HeartRateRecord::class)) {
            val rs = readAll(client, HeartRateRecord::class, range)
            lines += "Heart rate: ${rs.sumOf { it.samples.size }} samples" + spacing(rs.flatMap { r -> r.samples.map { it.time } })
        }

        return Result(lines.joinToString("\n"), run.metadata.id, route is ExerciseRouteResult.ConsentRequired)
    }

    fun describeRoute(route: ExerciseRoute?): String {
        val pts = route?.route.orEmpty()
        if (pts.isEmpty()) return "none returned"
        val secs = Duration.between(pts.first().time, pts.last().time).seconds
        return "${pts.size} points over ${secs / 60} min" +
            (if (pts.size > 1) ", about every ${secs / (pts.size - 1)}s" else "") +
            (if (pts.any { it.altitude != null }) ", with altitude" else "")
    }

    private fun intervals(ds: List<Duration>) =
        if (ds.isEmpty()) "" else ", each ${ds.minOf { it.seconds }}-${ds.maxOf { it.seconds }}s long"

    private fun spacing(ts: List<Instant>): String {
        if (ts.size < 2) return ""
        val sorted = ts.sorted()
        val gaps = sorted.zipWithNext { a, b -> Duration.between(a, b).seconds }.sorted()
        return ", typically ${gaps[gaps.size / 2]}s apart"
    }

    private fun origins(rs: List<Record>) =
        rs.map { it.metadata.dataOrigin.packageName }.distinct().takeIf { it.isNotEmpty() }?.joinToString(prefix = " [", postfix = "]").orEmpty()

    private suspend fun <T : Record> readAll(client: HealthConnectClient, type: KClass<T>, range: TimeRangeFilter): List<T> {
        val out = mutableListOf<T>()
        var token: String? = null
        do {
            val resp = client.readRecords(ReadRecordsRequest(type, range, pageSize = 1000, pageToken = token))
            out += resp.records
            token = resp.pageToken
        } while (token != null)
        return out
    }
}
