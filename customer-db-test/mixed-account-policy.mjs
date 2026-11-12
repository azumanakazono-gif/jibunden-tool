/**
 * Mixed Google-account staff authorization (preview-only).
 * Only call after verifying the Google ID token on the SERVER.
 * accountDirectory and staffDirectory MUST be server-owned, never browser-provided.
 *
 * accountDirectory: { [googleSub]: { staffId, active } }
 * staffDirectory: { [staffId]: { active, role: 'admin'|'staff' } }
 * record: { id, ownerStaffId, grants?: [{staffId, level:'read'|'write'}] }
 *
 * Staff account linking, even for the same email, is a separate admin-approved
 * process. No self-registration or implicit email-domain trust.
 */
export function authorizeMixedAccountAccess({
  identity, accountDirectory, staffDirectory, record, action
}) {
  const deny = reason => ({ allow:false, reason });
  if (!identity || identity.verified !== true ||
      typeof identity.sub !== 'string' || !identity.sub.trim() ||
      identity.email_verified !== true) return deny('UNVERIFIED_IDENTITY');
  if (!['read', 'write'].includes(action)) return deny('UNSUPPORTED_ACTION');
  if (!accountDirectory || !Object.hasOwn(accountDirectory,identity.sub))
    return deny('ACCOUNT_NOT_ENROLLED');
  const link = accountDirectory[identity.sub];
  if (!link || link.active !== true || typeof link.staffId !== 'string' ||
      !link.staffId.trim()) return deny('ACCOUNT_DISABLED');
  if (!staffDirectory || !Object.hasOwn(staffDirectory,link.staffId))
    return deny('STAFF_NOT_FOUND');
  const staff = staffDirectory[link.staffId];
  if (!staff || staff.active !== true ||
      !['admin','staff'].includes(staff.role)) return deny('STAFF_DISABLED');
  if (!record || typeof record.id !== 'string' || !record.id.trim() ||
      typeof record.ownerStaffId !== 'string' || !record.ownerStaffId.trim())
    return deny('INVALID_RECORD');
  if (staff.role === 'admin')
    return {allow:true, reason:'ADMIN',staffId:link.staffId};
  if (record.ownerStaffId === link.staffId)
    return {allow:true, reason:'OWNER',staffId:link.staffId};
  const grants = Array.isArray(record.grants) ? record.grants : [];
  const grant = grants.find(g => g && g.staffId === link.staffId &&
                                      (g.level === 'read' || g.level === 'write'));
  if (grant && (action === 'read' || grant.level === 'write'))
    return {allow:true, reason:'EXPLICIT_GRANT',staffId:link.staffId};
  return deny('ACCESS_DENIED');
}
