-- =============================================================================
--  PakiShip — Prescriptive Logistics Command Dashboard
--  SQL Views, Audit Table & RPC Function
--
--  PURPOSE
--  ───────
--  Powers the PakiShip Admin Dashboard North Star Metric:
--    "Hub Utilization Rate (Target: 75%)"
--  and autonomously orchestrates driver incentives and hub rebalancing
--  to prevent Bypass Lane deadlocks.
--
--  HOW TO APPLY
--  ────────────
--  Paste into Supabase → SQL Editor and run.
--  All objects are idempotent (CREATE OR REPLACE / IF NOT EXISTS).
--
--  SCHEMAS USED (existing — DO NOT alter)
--  ───────────────────────────────────────
--    parcel.parcel_drafts            — shipment records
--    parcel.parcel_draft_items       — per-item timestamps
--    routing.operator_hubs           — hub / drop-off locations (capacity, address)
--    driver.driver_sessions          — driver online state
--    public.*                        — actuation_logs (shared with PakiPark)
-- =============================================================================


-- =============================================================================
-- SHARED AUDIT TABLE  (shared with PakiPark — safe to re-run)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.actuation_logs (
  id              SERIAL        PRIMARY KEY,
  triggered_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  platform        VARCHAR(20)   NOT NULL DEFAULT 'pakiship',  -- 'pakiship' | 'pakipark'
  location_id     TEXT,                                        -- hub_id (routing) or location_id (park)
  threat_detected TEXT,
  action_taken    TEXT
);

CREATE INDEX IF NOT EXISTS idx_actuation_logs_platform
  ON public.actuation_logs (platform, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_actuation_logs_location
  ON public.actuation_logs (location_id, triggered_at DESC);


-- =============================================================================
-- VIEW 1 — DESCRIPTIVE (Analytics Engine)
--   vw_pakiship_descriptive
--
--   Calculates per-hub:
--     • Current Hub Utilization  (stored shipments vs. hub capacity)
--     • SLA compliance           (on-time vs. SLA-breached parcel ratio)
--     • Relay vs. Direct split   (relay = via operator hub, direct = door-to-door)
--     • Network-wide average utilization (window aggregation)
-- =============================================================================

CREATE OR REPLACE VIEW public.vw_pakiship_descriptive AS
WITH hub_base AS (
  -- One row per hub with raw counts
  SELECT
    oh.id                                                        AS hub_id,
    oh.name                                                      AS hub_name,
    COALESCE(oh.storage_capacity, 100)                           AS capacity,

    -- Parcels currently stored at this hub (submitted / in-transit, not yet delivered)
    COUNT(pd.id) FILTER (
      WHERE pd.status IN ('submitted', 'SUBMITTED', 'in_transit', 'IN_TRANSIT', 'draft', 'DRAFT')
    )                                                            AS current_stored,

    -- SLA breach proxy: parcels older than 48 h still not delivered
    COUNT(pd.id) FILTER (
      WHERE pd.status NOT IN ('delivered', 'DELIVERED', 'cancelled', 'CANCELLED')
        AND pd.created_at < NOW() - INTERVAL '48 hours'
    )                                                            AS sla_breach_count,

    COUNT(pd.id)                                                 AS total_parcels,

    -- Relay = routed through a drop-off hub  (has a hub reference)
    COUNT(pd.id) FILTER (
      WHERE pd.drop_off_point_id IS NOT NULL
    )                                                            AS relay_count,

    -- Direct = door-to-door (no hub)
    COUNT(pd.id) FILTER (
      WHERE pd.drop_off_point_id IS NULL
    )                                                            AS direct_count

  FROM routing.operator_hubs oh
  LEFT JOIN parcel.parcel_drafts pd
    ON pd.drop_off_point_id = oh.id
  WHERE oh.is_active = TRUE
  GROUP BY oh.id, oh.name, oh.storage_capacity
),
hub_with_pct AS (
  SELECT
    hub_id,
    hub_name,
    capacity,
    current_stored,
    sla_breach_count,
    total_parcels,
    relay_count,
    direct_count,

    -- Utilization %
    ROUND(
      100.0 * current_stored / NULLIF(capacity, 0), 2
    )                                                              AS util_pct,

    -- Relay / Direct split %
    ROUND(
      100.0 * relay_count  / NULLIF(relay_count + direct_count, 0), 2
    )                                                              AS relay_pct,
    ROUND(
      100.0 * direct_count / NULLIF(relay_count + direct_count, 0), 2
    )                                                              AS direct_pct,

    -- SLA OK %
    ROUND(
      100.0 * (COUNT(*) OVER () - sla_breach_count) / NULLIF(COUNT(*) OVER (), 0), 2
    )                                                              AS sla_ok_pct

  FROM hub_base
)
SELECT
  hub_id,
  hub_name,
  capacity,
  current_stored,
  sla_breach_count,
  total_parcels,
  relay_count,
  direct_count,
  COALESCE(util_pct, 0)    AS util_pct,
  COALESCE(relay_pct, 0)   AS relay_pct,
  COALESCE(direct_pct, 0)  AS direct_pct,
  COALESCE(sla_ok_pct, 0)  AS sla_ok_pct,

  -- Network-wide average utilization (window aggregation across all hubs)
  ROUND(
    AVG(COALESCE(util_pct, 0)) OVER (), 2
  )                          AS avg_network_util_pct

FROM hub_with_pct;


-- =============================================================================
-- VIEW 2 — PREDICTIVE (Machine Learning & Modeling Layer)
--   vw_pakiship_predictive
--
--   Builds the Real-Time Bypass Lane forecast:
--     • 4h deadlock forecast   — extrapolates current throughput 4 h forward
--     • 24h overflow forecast  — extrapolates 24 h forward
--   Uses a 7-day moving average of incoming parcel volume as the growth rate.
-- =============================================================================

CREATE OR REPLACE VIEW public.vw_pakiship_predictive AS
WITH hub_current AS (
  -- Current stored count per hub
  SELECT
    oh.id                                    AS hub_id,
    oh.name                                  AS hub_name,
    COALESCE(oh.storage_capacity, 100)       AS capacity,
    COUNT(pd.id) FILTER (
      WHERE pd.status IN ('submitted', 'SUBMITTED', 'in_transit', 'IN_TRANSIT', 'draft', 'DRAFT')
    )                                        AS current_stored
  FROM routing.operator_hubs oh
  LEFT JOIN parcel.parcel_drafts pd
    ON pd.drop_off_point_id = oh.id
  WHERE oh.is_active = TRUE
  GROUP BY oh.id, oh.name, oh.storage_capacity
),
hub_recent_rate AS (
  -- 7-day moving average incoming per hub per hour
  SELECT
    oh.id                                    AS hub_id,
    COUNT(pd.id)::FLOAT
      / NULLIF(7 * 24, 0)                    AS hourly_rate  -- avg parcels/hour over last 7 days
  FROM routing.operator_hubs oh
  LEFT JOIN parcel.parcel_drafts pd
    ON pd.drop_off_point_id = oh.id
    AND pd.created_at >= NOW() - INTERVAL '7 days'
  WHERE oh.is_active = TRUE
  GROUP BY oh.id
)
SELECT
  c.hub_id,
  c.hub_name,
  c.capacity,
  c.current_stored,

  -- Forecasted absolute counts
  ROUND((c.current_stored + COALESCE(r.hourly_rate, 0) * 4)::NUMERIC,  0) AS forecast_4h,
  ROUND((c.current_stored + COALESCE(r.hourly_rate, 0) * 24)::NUMERIC, 0) AS forecast_24h,

  -- Forecasted % of capacity
  ROUND(
    100.0 * (c.current_stored + COALESCE(r.hourly_rate, 0) * 4)
    / NULLIF(c.capacity, 0), 2
  )                                                                         AS forecast_4h_pct,

  ROUND(
    100.0 * (c.current_stored + COALESCE(r.hourly_rate, 0) * 24)
    / NULLIF(c.capacity, 0), 2
  )                                                                         AS forecast_24h_pct

FROM hub_current c
LEFT JOIN hub_recent_rate r ON r.hub_id = c.hub_id;


-- =============================================================================
-- VIEW 3 — PRESCRIPTIVE (Action Matrix)
--   vw_pakiship_prescriptive
--
--   Joins descriptive + predictive → outputs:
--     prescriptive_action  — human-readable action string
--     severity             — 'CRITICAL' | 'WARNING' | 'STABLE'
--
--   Rules (from pakishipprompt.md):
--     • 4h forecast > 90% capacity → CRITICAL: +₱50 ALERT BONUS to Relay Drivers
--     • Hub utilization < 40% OR > 85% → WARNING: Hub Rebalance
--     • Else → STABLE: Near 75% Target
-- =============================================================================

CREATE OR REPLACE VIEW public.vw_pakiship_prescriptive AS
SELECT
  d.hub_id,
  d.hub_name,
  d.capacity,
  d.current_stored,
  d.util_pct,
  d.sla_ok_pct,
  d.relay_pct,
  d.direct_pct,
  d.sla_breach_count,
  p.forecast_4h,
  p.forecast_24h,
  p.forecast_4h_pct,
  p.forecast_24h_pct,
  d.avg_network_util_pct,

  -- Prescriptive action text
  CASE
    WHEN p.forecast_4h_pct > 90
      THEN 'CRITICAL: Trigger +₱50 ALERT BONUS to Relay Drivers via Bypass Lane.'
    WHEN d.util_pct < 40 OR d.util_pct > 85
      THEN 'WARNING: Generate Hub Rebalance Recommendation.'
    ELSE
      'Stable (Near 75% Target).'
  END AS prescriptive_action,

  -- Severity flag for UI colour-coding
  CASE
    WHEN p.forecast_4h_pct > 90      THEN 'CRITICAL'
    WHEN d.util_pct < 40
       OR d.util_pct > 85            THEN 'WARNING'
    ELSE                                   'STABLE'
  END AS severity

FROM public.vw_pakiship_descriptive d
JOIN public.vw_pakiship_predictive  p USING (hub_id);


-- =============================================================================
-- RPC FUNCTION — fn_execute_surge_action
--   Called by the "Execute" button in the Prescriptive Actuations panel.
--   Logs to actuation_logs and returns the new log row id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_execute_surge_action(
  p_location_id TEXT,
  p_threat      TEXT,
  p_action      TEXT,
  p_platform    TEXT DEFAULT 'pakiship'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id INTEGER;
BEGIN
  INSERT INTO public.actuation_logs (platform, location_id, threat_detected, action_taken)
  VALUES (p_platform, p_location_id, p_threat, p_action)
  RETURNING id INTO v_id;

  RETURN v_id::TEXT;
END;
$$;

-- Grant execute permission to the authenticated and anon roles (Supabase RLS)
GRANT EXECUTE ON FUNCTION public.fn_execute_surge_action(TEXT, TEXT, TEXT, TEXT)
  TO authenticated, anon;

-- Grant SELECT on views to authenticated and anon roles
GRANT SELECT ON public.vw_pakiship_descriptive  TO authenticated, anon;
GRANT SELECT ON public.vw_pakiship_predictive   TO authenticated, anon;
GRANT SELECT ON public.vw_pakiship_prescriptive TO authenticated, anon;
GRANT SELECT, INSERT ON public.actuation_logs   TO authenticated, anon;

-- =============================================================================
-- END OF SCRIPT
-- =============================================================================
