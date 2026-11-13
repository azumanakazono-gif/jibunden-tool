/**
 * Preview-only staff authorization policy.
 *
 * This is a pure decision helper, NOT a registration endpoint, session issuer,
 * database adapter, or proof of authorization. The active preview login API
 * deliberately continues to deny access until a server-owned registry and
 * session enforcement are separately implemented and reviewed.
 *
 * Staff keys MUST be immutable Google subject IDs ("sub"), never email.
 */
export const STAFF_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected'
});

export const STAFF_ROLES = Object.freeze({
  STAFF: 'staff',
  ADMIN: 'admin'
});

const VALID_STATUSES = new Set(Object.values(STAFF_STATUSES));
const VALID_ROLES = new Set(Object.values(STAFF_ROLES));

/**
 * Resolve a Google-verified identity against a *trusted server-side* record.
 * Caller MUST ensure both verifiedIdentity and staffRecord are obtained on the
 * server; never trust staff role/status/subject from the browser.
 *
 * Returns an explicit deny by default. In particular, a missing record does
 * not automatically register or approve a user.
 */
export function evaluateStaffApproval(verifiedIdentity, staffRecord) {
  const deny = (reason) => Object.freeze({approved:false,role:null,reason});
  if (!verifiedIdentity || verifiedIdentity.verified !== true ||
      typeof verifiedIdentity.sub !== 'string' || !verifiedIdentity.sub.trim() ||
      verifiedIdentity.email_verified !== true) {
    return deny('IDENTITY_NOT_VERIFIED');
  }
  if (!staffRecord) return deny('STAFF_NOT_REGISTERED');
  if (typeof staffRecord !== 'object' || Array.isArray(staffRecord) ||
      typeof staffRecord.googleSub !== 'string' ||
      staffRecord.googleSub !== verifiedIdentity.sub) {
    return deny('STAFF_RECORD_INVALID');
  }
  if (!VALID_STATUSES.has(staffRecord.status) ||
      !VALID_ROLES.has(staffRecord.role)) {
    return deny('STAFF_RECORD_INVALID');
  }
  if (staffRecord.status !== STAFF_STATUSES.APPROVED) {
    return deny(staffRecord.status === STAFF_STATUSES.PENDING
      ? 'STAFF_APPROVAL_PENDING'
      : 'STAFF_ACCESS_DENIED');
  }
  // Decision result only. No session token, cookie, or DB access is issued here.
  return Object.freeze({approved:true,role:staffRecord.role,reason:'APPROVED'});
}
