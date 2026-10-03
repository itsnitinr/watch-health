package dev.nitinranganath.watchsync

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ActivityIntensityRecord
import androidx.health.connect.client.records.BasalBodyTemperatureRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.CyclingPedalingCadenceRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.MindfulnessSessionRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SkinTemperatureRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsCadenceRecord
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
class HealthReader(val client: HealthConnectClient) {

    companion object {
        val RECORD_TYPES: List<KClass<out Record>> = listOf(
            StepsRecord::class, DistanceRecord::class, FloorsClimbedRecord::class,
            ActiveCaloriesBurnedRecord::class, TotalCaloriesBurnedRecord::class, BasalMetabolicRateRecord::class,
            HeartRateRecord::class, RestingHeartRateRecord::class, HeartRateVariabilityRmssdRecord::class,
            OxygenSaturationRecord::class, RespiratoryRateRecord::class, SkinTemperatureRecord::class,
            BloodPressureRecord::class, WeightRecord::class, BodyFatRecord::class, Vo2MaxRecord::class,
            SleepSessionRecord::class, ExerciseSessionRecord::class,
            // Detail recorded during workouts: splits, pace, cadence, climbing, power
            SpeedRecord::class, StepsCadenceRecord::class, ElevationGainedRecord::class, PowerRecord::class,
            CyclingPedalingCadenceRecord::class,
            // Body composition (the watch's BIA sensor) and other measurements
            HeightRecord::class, LeanBodyMassRecord::class, BoneMassRecord::class, BodyWaterMassRecord::class,
            BodyTemperatureRecord::class, BasalBodyTemperatureRecord::class, BloodGlucoseRecord::class,
            // Logged in Samsung Health
            HydrationRecord::class, NutritionRecord::class,
            // Only on newer Health Connect versions; see FEATURE_GATED
            MindfulnessSessionRecord::class, ActivityIntensityRecord::class,
        )

        /** Types Health Connect only supports when a feature is available on the phone. */
        private val FEATURE_GATED: Map<KClass<out Record>, Int> = mapOf(
            SkinTemperatureRecord::class to HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE,
            MindfulnessSessionRecord::class to HealthConnectFeatures.FEATURE_MINDFULNESS_SESSION,
            ActivityIntensityRecord::class to HealthConnectFeatures.FEATURE_ACTIVITY_INTENSITY,
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

    /**
     * Permissions to request: one read permission per type the phone supports, workout GPS routes,
     * and background access where supported.
     */
    fun permissionsToRequest(): Set<String> {
        val perms = RECORD_TYPES
            .filter { type -> FEATURE_GATED[type]?.let(::featureAvailable) ?: true }
            .map { HealthPermission.getReadPermission(it) }.toMutableSet()
        perms += HealthPermission.PERMISSION_READ_EXERCISE_ROUTES
        if (featureAvailable(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)) {
            perms += HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
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

        // Other fine-grained records, also uploaded page by page. Steps and distance come in short
        // intervals through the day (daily totals still come from the aggregates above, which
        // de-duplicate phone and watch); the rest are mostly recorded during workouts.
        stream(StepsRecord::class, "steps", range, ::can, emit) { r ->
            listOf(sample("hc:${r.metadata.id}", "steps", r.startTime, r.endTime, r.count.toDouble(), "steps", r))
        }
        stream(DistanceRecord::class, "distance", range, ::can, emit) { r ->
            listOf(sample("hc:${r.metadata.id}", "distance", r.startTime, r.endTime, r.distance.inMeters, "m", r))
        }
        stream(FloorsClimbedRecord::class, "floors", range, ::can, emit) { r ->
            listOf(sample("hc:${r.metadata.id}", "floors", r.startTime, r.endTime, r.floors, "floors", r))
        }
        stream(ElevationGainedRecord::class, "elevation", range, ::can, emit) { r ->
            listOf(sample("hc:${r.metadata.id}", "elevation_gained", r.startTime, r.endTime, r.elevation.inMeters, "m", r))
        }
        stream(SpeedRecord::class, "speed", range, ::can, emit) { r ->
            r.samples.mapIndexed { i, s -> sample("hc:${r.metadata.id}:$i", "speed", s.time, null, s.speed.inMetersPerSecond, "m/s", r) }
        }
        stream(StepsCadenceRecord::class, "cadence", range, ::can, emit) { r ->
            r.samples.mapIndexed { i, s -> sample("hc:${r.metadata.id}:$i", "steps_cadence", s.time, null, s.rate, "steps/min", r) }
        }
        stream(PowerRecord::class, "power", range, ::can, emit) { r ->
            r.samples.mapIndexed { i, s -> sample("hc:${r.metadata.id}:$i", "power", s.time, null, s.power.inWatts, "W", r) }
        }
        stream(CyclingPedalingCadenceRecord::class, "cycling cadence", range, ::can, emit) { r ->
            r.samples.mapIndexed { i, s -> sample("hc:${r.metadata.id}:$i", "cycling_cadence", s.time, null, s.revolutionsPerMinute, "rpm", r) }
        }
        stream(ActivityIntensityRecord::class, "activity intensity", range, ::can, emit) { r ->
            val vigorous = r.activityIntensityType == ActivityIntensityRecord.ACTIVITY_INTENSITY_TYPE_VIGOROUS
            listOf(sample("hc:${r.metadata.id}", if (vigorous) "intensity_vigorous" else "intensity_moderate", r.startTime, r.endTime,
                minutesBetween(r.startTime, r.endTime), "min", r))
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
        if (can(HeightRecord::class)) forEachPage(HeightRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "height", r.time, null, r.height.inMeters, "m", r))
        }
        if (can(LeanBodyMassRecord::class)) forEachPage(LeanBodyMassRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "lean_body_mass", r.time, null, r.mass.inKilograms, "kg", r))
        }
        if (can(BoneMassRecord::class)) forEachPage(BoneMassRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "bone_mass", r.time, null, r.mass.inKilograms, "kg", r))
        }
        if (can(BodyWaterMassRecord::class)) forEachPage(BodyWaterMassRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "body_water_mass", r.time, null, r.mass.inKilograms, "kg", r))
        }
        if (can(BodyTemperatureRecord::class)) forEachPage(BodyTemperatureRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "body_temperature", r.time, null, r.temperature.inCelsius, "°C", r,
                JSONObject().put("location", r.measurementLocation)))
        }
        if (can(BasalBodyTemperatureRecord::class)) forEachPage(BasalBodyTemperatureRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "basal_body_temperature", r.time, null, r.temperature.inCelsius, "°C", r,
                JSONObject().put("location", r.measurementLocation)))
        }
        if (can(BloodGlucoseRecord::class)) forEachPage(BloodGlucoseRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "blood_glucose", r.time, null, r.level.inMillimolesPerLiter, "mmol/L", r,
                JSONObject().put("meal_type", r.mealType).put("relation_to_meal", r.relationToMeal).put("specimen_source", r.specimenSource)))
        }
        if (can(HydrationRecord::class)) forEachPage(HydrationRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "hydration", r.startTime, r.endTime, r.volume.inMilliliters, "ml", r))
        }
        if (can(NutritionRecord::class)) forEachPage(NutritionRecord::class, range) { page ->
            for (r in page) {
                val meta = JSONObject().put("name", r.name ?: JSONObject.NULL).put("meal_type", r.mealType)
                    .put("protein_g", r.protein?.inGrams ?: JSONObject.NULL)
                    .put("carbs_g", r.totalCarbohydrate?.inGrams ?: JSONObject.NULL)
                    .put("fat_g", r.totalFat?.inGrams ?: JSONObject.NULL)
                    .put("saturated_fat_g", r.saturatedFat?.inGrams ?: JSONObject.NULL)
                    .put("fiber_g", r.dietaryFiber?.inGrams ?: JSONObject.NULL)
                    .put("sugar_g", r.sugar?.inGrams ?: JSONObject.NULL)
                    .put("sodium_mg", r.sodium?.inMilligrams ?: JSONObject.NULL)
                    .put("caffeine_mg", r.caffeine?.inMilligrams ?: JSONObject.NULL)
                simple.put(sample("hc:${r.metadata.id}", "nutrition", r.startTime, r.endTime, r.energy?.inKilocalories ?: 0.0, "kcal", r, meta))
            }
        }
        if (can(MindfulnessSessionRecord::class)) forEachPage(MindfulnessSessionRecord::class, range) { page ->
            for (r in page) simple.put(sample("hc:${r.metadata.id}", "mindfulness", r.startTime, r.endTime, minutesBetween(r.startTime, r.endTime), "min", r,
                JSONObject().put("kind", r.mindfulnessSessionType).put("title", r.title ?: JSONObject.NULL)))
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
            val routes = mutableListOf<JSONObject>()
            forEachPage(ExerciseSessionRecord::class, range) { page ->
                for (r in page) {
                    val stats = sessionStats(r, ::can)
                    // Readable when the routes permission is granted; otherwise ConsentRequired and skipped
                    (r.exerciseRouteResult as? ExerciseRouteResult.Data)?.exerciseRoute?.route?.takeIf { it.isNotEmpty() }?.let { pts ->
                        val points = JSONArray()
                        for (p in pts) points.put(
                            JSONObject().put("t", p.time.toEpochMilli()).put("lat", p.latitude).put("lng", p.longitude)
                                .put("alt_m", p.altitude?.inMeters ?: JSONObject.NULL)
                                .put("accuracy_m", p.horizontalAccuracy?.inMeters ?: JSONObject.NULL),
                        )
                        routes += JSONObject().put("session_uid", "hc:${r.metadata.id}").put("points", points)
                    }
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
                            .put("meta", sessionMeta(r)),
                    )
                }
            }
            if (exercise.length() > 0) emit("workouts", JSONObject().put("exercise", exercise))
            // One payload per route: a long run can have thousands of GPS points
            for (route in routes) emit("routes", JSONObject().put("routes", JSONArray().put(route)))
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

    private fun sample(uid: String, type: String, start: Instant, end: Instant?, value: Double, unit: String, r: Record, meta: JSONObject? = null) =
        JSONObject()
            .put("uid", uid)
            .put("type", type)
            .put("start_ms", start.toEpochMilli())
            .put("end_ms", end?.toEpochMilli() ?: JSONObject.NULL)
            .put("value", value)
            .put("unit", unit)
            .put("source", r.metadata.dataOrigin.packageName)
            .put("meta", meta ?: JSONObject.NULL)

    private fun minutesBetween(a: Instant, b: Instant) = (b.toEpochMilli() - a.toEpochMilli()) / 60000.0

    /** Every record of [type] in [range], converted by [toSamples] and uploaded a page at a time. */
    private suspend fun <T : Record> stream(
        type: KClass<T>, label: String, range: TimeRangeFilter, can: (KClass<out Record>) -> Boolean,
        emit: suspend (String, JSONObject) -> Unit, toSamples: (T) -> List<JSONObject>,
    ) {
        if (!can(type)) return
        forEachPage(type, range) { page ->
            val samples = JSONArray()
            for (r in page) toSamples(r).forEach(samples::put)
            emitChunked(label, samples, emit)
        }
    }

    /** Workout details beyond the summary columns: how it was recorded, laps, segments, notes and effort. */
    private fun sessionMeta(r: ExerciseSessionRecord): JSONObject {
        val laps = JSONArray()
        for (l in r.laps) laps.put(
            JSONObject().put("start_ms", l.startTime.toEpochMilli()).put("end_ms", l.endTime.toEpochMilli())
                .put("length_m", l.length?.inMeters ?: JSONObject.NULL),
        )
        val segments = JSONArray()
        for (sg in r.segments) segments.put(
            JSONObject().put("start_ms", sg.startTime.toEpochMilli()).put("end_ms", sg.endTime.toEpochMilli())
                .put("type", sg.segmentType).put("repetitions", sg.repetitions),
        )
        return JSONObject()
            // 1 = started by the user, 2 = detected automatically, 3 = entered by hand
            .put("recording_method", r.metadata.recordingMethod)
            .put("device", r.metadata.device?.model ?: JSONObject.NULL)
            .put("notes", r.notes ?: JSONObject.NULL)
            .put("perceived_exertion", r.rateOfPerceivedExertion ?: JSONObject.NULL)
            .put("laps", laps)
            .put("segments", segments)
    }

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
