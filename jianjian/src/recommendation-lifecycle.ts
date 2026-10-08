// A pass is an internal result, never an early release of the waiting person's slot.
// Mutual stays occupied through the video pipeline; no fabricated feedback endpoint.
export const ACTIVE_RECOMMENDATION_SQL = `(
  r.status = 'mutual' OR (
    r.status IN ('pending', 'passed')
    AND r.created_at > now() - interval '24 hours'
  )
)`;

export function isRecommendationExpired(status: string, timeExpired: boolean): boolean {
  return status === 'expired' || (status !== 'mutual' && timeExpired);
}
