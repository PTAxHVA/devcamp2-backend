/** Of two completion dates for the same section, keep the EARLIEST non-null one so a
 *  deduped shared-topic section lands in a deterministic day bucket regardless of
 *  query order (mirrors isEarlierCompletion in the backfill service). Shared by the
 *  activity series and the dashboard weekly-progress dedupe. */
export const keepEarlierCompletion = (
  candidate: Date | null,
  current: Date | null,
): Date | null => {
  if (candidate === null) return current
  if (current === null) return candidate
  return candidate.getTime() < current.getTime() ? candidate : current
}
