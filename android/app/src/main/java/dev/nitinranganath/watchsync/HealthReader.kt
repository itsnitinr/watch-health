package dev.nitinranganath.watchsync

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SkinTemperatureRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass

/**
 * Reads Health Connect data for a time window and hands it out as ingest payloads
 * (the JSON shape of web/src/lib/ingest.ts), in chunks small enough to POST.
 */
class HealthReader(private val client: HealthConnectClient) {

    companion object {
        val RECORD_TYPES: List<KClass<out Record>> = listOf(
            StepsRecord::class, DistanceRecord::class, FloorsClimbedRecord::class,
            ActiveCaloriesBurnedRecord::class, TotalCaloriesBurnedRecord::class, BasalMetabolicRateRecord::class,
            HeartRateRecord::class, RestingHeartRateRecord::class, HeartRateVariabilityRmssdRecord::class,
            OxygenSaturationRecord::class, RespiratoryRateRecord::class, SkinTemperatureRecord::class,
            BloodPressureRecord::class, WeightRecord::class, BodyFatRecord::class, Vo2MaxRecord::class,
            SleepSessionRecord::class, ExerciseSessionRecord::class,
        )

        private const val CHUNK = 4000
        private const val PAGE_SIZE = 500

        private val SLEEP_STAGES = mapOf(
            SleepSessionRecord.STAGE_TYPE_AWAKE to "awake",
            SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED to "awake",
            SleepSessionRecord.STAGE_TYPE_OUT_OF_BED to "out_of_bed",
            SleepSessionRecord.STAGE_TYPE_SLEEPING to "sleeping",
            SleepSessionRecord.STAGE_TYPE_LIGHT to "light",
            SleepSessionRecord.STAGE_TYPE_DEEP to "deep",
            SleepSessionRecord.STAGE_TYPE_REM to "rem",
        )
    }

    /** Permissions to request: one read permission per type, plus background/history access where supported. */
    fun permissionsToRequest(): Set<String> {
        val perms = RECORD_TYPES.map { HealthPermission.getReadPermission(it) }.toMutableSet()
        if (featureAvailable(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)) {
            perms += HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
        }
        if (featureAvailable(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)) {
            perms += HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
        }
        if (!featureAvailable(HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE)) {
            perms -= HealthPermission.getReadPermission(SkinTemperatureRecord::class)
        }
        return perms
    }

    private fun featureAvailable(feature: Int) =
        client.features.getFeatureStatus(feature) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    suspend fun grantedPermissions(): Set<String> = client.permissionController.getGrantedPermissions()

    /**
     * Reads the window [start, end) and calls [emit] with payload chunks as it goes. Records are
     * fetched a page at a time and heart rate is uploaded page by page, so memory use stays flat
     * no matter how much history there is. Only data types the user granted are read.
     */
    suspend fun readWindow(
        start: Instant,
        end: Instant,
        granted: Set<String>,
        emit: suspend (label: String, payload: JSONObject) -> Unit,
    ) {
        fun can(type: KClass<out Record>) = HealthPermission.getReadPermission(type) in granted
        val range = TimeRangeFilter.between(start, end)

        // Additive metrics as per-day totals: Health Connect de-duplicates phone + watch
        // in aggregates, whereas summing raw records would double count.
        emit("daily totals", JSONObject().put("daily", dailyTotals(start, end, ::can)))

        // Heart rate is by far the largest type (one reading every few minutes, every second
        // during workouts), so it is uploaded per page rather than collected for the window.
        if (can(HeartRateRecord::class)) forEachPage(HeartRateRecord::class, range) { page ->
            val samples = JSONArray()
            for (r in page) r.samples.forEachIndexed { i, s ->
                samples.put(sample("hc:${r.metadata.id}:$i", "heart_rate", s.time, null, s.beatsPerMinute.toDouble(), "bpm", r))
            }
            emitChunked("heart rate", samples, emit)
        }

        val simple = JSONArray()
        if (can(RestingHeartRateRecord::class)) forEachPage(RestingHeartRateRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "resting_heart_rate", r.time, null, r.beatsPerMinute.toDouble(), "bpm", r))
        }
        if (can(HeartRateVariabilityRmssdRecord::class)) forEachPage(HeartRateVariabilityRmssdRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "hrv_rmssd", r.time, null, r.heartRateVariabilityMillis, "ms", r))
        }
        if (can(OxygenSaturationRecord::class)) forEachPage(OxygenSaturationRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "spo2", r.time, null, r.percentage.value, "%", r))
        }
        if (can(RespiratoryRateRecord::class)) forEachPage(RespiratoryRateRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "respiratory_rate", r.time, null, r.rate, "breaths/min", r))
        }
        if (can(WeightRecord::class)) forEachPage(WeightRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "weight", r.time, null, r.weight.inKilograms, "kg", r))
        }
        if (can(BodyFatRecord::class)) forEachPage(BodyFatRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "body_fat", r.time, null, r.percentage.value, "%", r))
        }
        if (can(Vo2MaxRecord::class)) forEachPage(Vo2MaxRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "vo2_max", r.time, null, r.vo2MillilitersPerMinuteKilogram, "ml/kg/min", r))
        }
        if (can(BloodPressureRecord::class)) forEachPage(BloodPressureRecord::class, range) { page ->
            for (r in page) {
                simple.put(sample("hc:${r.metadata.id}:sys", "blood_pressure_systolic", r.time, null, r.systolic.inMillimetersOfMercury, "mmHg", r))
                simple.put(sample("hc:${r.metadata.id}:dia", "blood_pressure_diastolic", r.time, null, r.diastolic.inMillimetersOfMercury, "mmHg", r))
            }
        }
        if (can(SkinTemperatureRecord::class)) forEachPage(SkinTemperatureRecord::class, range) { page ->
            // Samsung reports skin temperature as deviations from the user's baseline.
            for (r in page) r.deltas.forEachIndexed { i, d ->
                simple.put(sample("hc:${r.metadata.id}:$i", "skin_temperature_delta", d.time, null, d.delta.inCelsius, "°C", r))
            }
        }
        emitChunked("vitals & body", simple, emit)

        if (can(SleepSessionRecord::class)) {
            val sleep = JSONArray()
            forEachPage(SleepSessionRecord::class, range) { page ->
                for (r in page) {
                    val stages = JSONArray()
                    for (st in r.stages) {
                        val name = SLEEP_STAGES[st.stage] ?: continue
                        stages.put(JSONObject().put("stage", name).put("start_ms", st.startTime.toEpochMilli()).put("end_ms", st.endTime.toEpochMilli()))
                    }
                    sleep.put(
                        JSONObject()
                            .put("uid", "hc:${r.metadata.id}")
                            .put("start_ms", r.startTime.toEpochMilli())
                            .put("end_ms", r.endTime.toEpochMilli())
                            .put("source", r.metadata.dataOrigin.packageName)
                            .put("stages", stages),
                    )
                }
            }
            if (sleep.length() > 0) emit("sleep", JSONObject().put("sleep", sleep))
        }

        if (can(ExerciseSessionRecord::class)) {
            val exercise = JSONArray()
            forEachPage(ExerciseSessionRecord::class, range) { page ->
                for (r in page) {
                    val stats = sessionStats(r, ::can)
                    exercise.put(
                        JSONObject()
                            .put("uid", "hc:${r.metadata.id}")
                            .put("type", exerciseName(r.exerciseType))
                            .put("title", r.title ?: JSONObject.NULL)
                            .put("start_ms", r.startTime.toEpochMilli())
                            .put("end_ms", r.endTime.toEpochMilli())
                            .put("kcal", stats.kcal ?: JSONObject.NULL)
                            .put("distance_m", stats.distanceM ?: JSONObject.NULL)
                            .put("avg_hr", stats.avgHr ?: JSONObject.NULL)
                            .put("max_hr", stats.maxHr ?: JSONObject.NULL)
                            .put("source", r.metadata.dataOrigin.packageName)
                            // 1 = started by the user, 2 = detected automatically, 3 = entered by hand
                            .put("meta", JSONObject().put("recording_method", r.metadata.recordingMethod)),
                    )
                }
            }
            if (exercise.length() > 0) emit("workouts", JSONObject().put("exercise", exercise))
        }
    }

    private suspend fun dailyTotals(start: Instant, end: Instant, can: (KClass<out Record>) -> Boolean): JSONArray {
        val metrics = buildMap<String, AggregateMetric<*>> {
            if (can(StepsRecord::class)) put("steps", StepsRecord.COUNT_TOTAL)
            if (can(DistanceRecord::class)) put("distance_m", DistanceRecord.DISTANCE_TOTAL)
            if (can(ActiveCaloriesBurnedRecord::class)) put("active_kcal", ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
            if (can(TotalCaloriesBurnedRecord::class)) put("total_kcal", TotalCaloriesBurnedRecord.ENERGY_TOTAL)
            if (can(BasalMetabolicRateRecord::class)) put("basal_kcal", BasalMetabolicRateRecord.BASAL_CALORIES_TOTAL)
            if (can(FloorsClimbedRecord::class)) put("floors", FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL)
        }
        val out = JSONArray()
        if (metrics.isEmpty()) return out

        // Windows start at local midnight, so each bucket is a whole local day (except today's,
        // which is re-sent by every sync until the day is over).
        val zone = ZoneId.systemDefault()
        val buckets = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = metrics.values.toSet(),
                timeRangeFilter = TimeRangeFilter.between(LocalDateTime.ofInstant(start, zone), LocalDateTime.ofInstant(end, zone)),
                timeRangeSlicer = Period.ofDays(1),
            ),
        )
        for (b in buckets) {
            val day = b.startTime.toLocalDate().toString()
            val values = metrics.mapNotNull { (name, metric) ->
                val value = when (val v = b.result[metric]) {
                    is Long -> v.toDouble()
                    is Double -> v
                    is androidx.health.connect.client.units.Length -> v.inMeters
                    is androidx.health.connect.client.units.Energy -> v.inKilocalories
                    else -> null
                }
                value?.let { name to it }
            }.toMap()
            for ((name, value) in values) {
                out.put(JSONObject().put("day", day).put("metric", name).put("value", value).put("source", "health_connect"))
            }
            // Samsung Health writes total calories but rarely active ones. Health Connect's total is
            // basal + active, so when active is missing it is the difference, marked as estimated.
            val total = values["total_kcal"]
            val basal = values["basal_kcal"]
            if ("active_kcal" !in values && total != null && basal != null) {
                out.put(JSONObject().put("day", day).put("metric", "active_kcal").put("value", maxOf(0.0, total - basal)).put("source", "estimated"))
            }
        }
        return out
    }

    private data class SessionStats(val kcal: Double?, val distanceM: Double?, val avgHr: Long?, val maxHr: Long?)

    private suspend fun sessionStats(r: ExerciseSessionRecord, can: (KClass<out Record>) -> Boolean): SessionStats {
        val metrics = buildSet<AggregateMetric<*>> {
            if (can(HeartRateRecord::class)) { add(HeartRateRecord.BPM_AVG); add(HeartRateRecord.BPM_MAX) }
            if (can(ActiveCaloriesBurnedRecord::class)) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
            if (can(DistanceRecord::class)) add(DistanceRecord.DISTANCE_TOTAL)
        }
        if (metrics.isEmpty()) return SessionStats(null, null, null, null)
        val res = client.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(r.startTime, r.endTime)))
        return SessionStats(
            kcal = res[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
            distanceM = res[DistanceRecord.DISTANCE_TOTAL]?.inMeters?.takeIf { it > 0 },
            avgHr = res[HeartRateRecord.BPM_AVG],
            maxHr = res[HeartRateRecord.BPM_MAX],
        )
    }

    private suspend fun <T : Record> forEachPage(type: KClass<T>, range: TimeRangeFilter, block: suspend (List<T>) -> Unit) {
        var token: String? = null
        do {
            val resp = client.readRecords(ReadRecordsRequest(type, range, pageSize = PAGE_SIZE, pageToken = token))
            block(resp.records)
            token = resp.pageToken
        } while (token != null)
    }

    private suspend fun emitChunked(label: String, samples: JSONArray, emit: suspend (String, JSONObject) -> Unit) {
        var i = 0
        while (i < samples.length()) {
            val chunk = JSONArray()
            for (j in i until minOf(i + CHUNK, samples.length())) chunk.put(samples.get(j))
            emit(label, JSONObject().put("samples", chunk))
            i += CHUNK
        }
    }

    private fun sample(uid: String, type: String, start: Instant, end: Instant?, value: Double, unit: String, r: Record) =
        JSONObject()
            .put("uid", uid)
            .put("type", type)
            .put("start_ms", start.toEpochMilli())
            .put("end_ms", end?.toEpochMilli() ?: JSONObject.NULL)
            .put("value", value)
            .put("unit", unit)
            .put("source", r.metadata.dataOrigin.packageName)

    private fun exerciseName(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "treadmill"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "stationary_bike"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "hiking"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swimming_pool"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swimming_open_water"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "strength_training"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "weightlifting"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "pilates"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "rowing_machine"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING -> "stair_climbing"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "hiit"
        ExerciseSessionRecord.EXERCISE_TYPE_BADMINTON -> "badminton"
        ExerciseSessionRecord.EXERCISE_TYPE_TENNIS -> "tennis"
        ExerciseSessionRecord.EXERCISE_TYPE_CRICKET -> "cricket"
        ExerciseSessionRecord.EXERCISE_TYPE_SOCCER -> "football"
        ExerciseSessionRecord.EXERCISE_TYPE_BASKETBALL -> "basketball"
        else -> "other_$type"
    }
}
