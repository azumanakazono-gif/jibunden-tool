/**
 * Preview-only server-side page access decision.
 * Do not use as an authorization token or to expose customer DB credentials.
 */
export function mayAccessLoanPage(subject, staff) {
  return typeof subject === 'string' && subject.length > 0 &&
    staff != null && staff.google_sub === subject &&
    staff.status === 'approved' &&
    (staff.role === 'staff' || staff.role === 'admin');
}
export function isLoanGateEnabled(env=process.env) {
  return env.VERCEL_ENV === 'preview' && env.JIBUNDEN_STAFF_GATE_MODE === 'enforce';
}
