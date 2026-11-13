/**
 * 顧客DBのアクセス判定（検証用・サーバー側でのみ利用）。
 * identityは署名/iss/aud/expを検証済みのGoogle IDトークン由来であること。
 * このファイル自体はトークン検証を行わない。実際のAPI公開は認証連携後。
 */
export function authorizeCustomerAccess({identity, staffDirectory, record, action}) {
  const deny = reason => ({allow:false, reason});
  if (!identity || identity.verified !== true ||
      typeof identity.sub !== 'string' || !identity.sub.trim() ||
      identity.email_verified !== true) return deny('UNVERIFIED_IDENTITY');
  if (!staffDirectory || !Object.prototype.hasOwnProperty.call(staffDirectory, identity.sub))
    return deny('NOT_REGISTERED_STAFF');
  const staff=staffDirectory[identity.sub];
  if (!staff || staff.active !== true || !['admin','staff'].includes(staff.role))
    return deny('INACTIVE_OR_INVALID_ROLE');
  if (!['read','write'].includes(action)) return deny('UNSUPPORTED_ACTION');
  if (!record || typeof record.id !== 'string' || !record.id.trim() ||
      typeof record.ownerSub !== 'string' || !record.ownerSub.trim()) return deny('INVALID_RECORD');
  if (staff.role==='admin') return {allow:true,reason:'ADMIN'};
  if (record.ownerSub===identity.sub) return {allow:true,reason:'OWNER'};
  const grants=Array.isArray(record.grants)?record.grants:[];
  const grant=grants.find(g=>g && g.sub===identity.sub && ['read','write'].includes(g.level));
  if (grant && (action==='read'||grant.level==='write'))
    return {allow:true,reason:'EXPLICIT_GRANT'};
  return deny('ACCESS_DENIED');
}
