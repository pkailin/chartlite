/**
 * The ODD axes, and the bands each is counted in.
 *
 * The values are LABELLED in each scenario's `metadata.json`, not derived from
 * an outside feed. These lists only fix the ORDER of the bands and add the
 * ones no scenario has yet. An empty band is the useful output ("we have
 * nothing at sea state 6"), and a panel that only lists values it has seen
 * can never show one.
 *
 * Numeric scales use their full standard range: Beaufort 0–12, WMO sea state
 * 0–9. `visibility_scale` has no coding defined yet (data card: TBD), so 0–9
 * stands in for it. A value found in the data but missing from a list is
 * still counted. It is appended after the listed values, never dropped.
 *
 * Override any of this with `oddAxes` in chartlite.config.json.
 */

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

export const DEFAULT_AXES = [
  { key: 'waterway_type', label: 'Waterway type', values: ['open_sea', 'coastal_waters', 'port_approach_fairway'] },
  { key: 'operating_phase', label: 'Operating phase', values: ['harbour_out', 'coastal_transit', 'ocean_transit'] },
  { key: 'time_of_day', label: 'Time of day', values: ['sunrise', 'day', 'dusk_twilight', 'night_lit', 'night_unlit'] },
  { key: 'visibility_scale', label: 'Visibility scale', values: range(0, 9) },
  { key: 'visibility_reduction_cause', label: 'Visibility reduction', values: ['clear', 'haze', 'mist', 'fog'] },
  { key: 'backlighting_severity', label: 'Backlighting', values: ['none', 'moderate', 'severe'] },
  { key: 'precipitation_type', label: 'Precipitation', values: ['none', 'light_rain', 'moderate_rain', 'heavy_rain'] },
  { key: 'beaufort_scale', label: 'Beaufort scale', values: range(0, 12) },
  { key: 'sea_state_code', label: 'Sea state code', values: range(0, 9) },
];

/** A metadata value as a band id, or null when the scenario does not label it. */
export function bandValue(v) {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/**
 * The final band list for each axis: the configured values first, then every
 * value seen in the data that the config did not list. Numeric values sort as
 * numbers and everything else sorts alphabetically.
 */
export function resolveAxes(axes, scenarios) {
  return axes.map((a) => {
    const listed = new Set(a.values);
    const extra = new Set();
    for (const s of scenarios) {
      const v = s.odd[a.key];
      if (v !== null && v !== undefined && !listed.has(v)) extra.add(v);
    }
    const sorted = [...extra].sort((x, y) => {
      const nx = Number(x), ny = Number(y);
      return Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    });
    return { key: a.key, label: a.label, values: [...a.values, ...sorted] };
  });
}
