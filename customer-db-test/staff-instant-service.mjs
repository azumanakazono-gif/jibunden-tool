/**
 * Preview-only staff enrollment, request metadata and read models.
 * Never trust an email address or a client-provided role as authorization.
 */
import {randomUUID} from 'node:crypto';

const subOK = (s) => typeof s === 'string' && s.length > 0 && s.length <= 255 && !/\s/.test(s);
const identityOK = (i) => i?.verified === true && i?.email_verified === true && subOK(i.sub) &&
  typeof i.email === 'string' && i.email.length <= 320 && i.email.includes('@');
const nameFor = (i) => String(i.displayName || i.email).trim().slice(0,120);

export async function registerStaffSelf(pool, identity) {
  if (!identityOK(identity)) throw new Error('IDENTITY_NOT_VERIFIED');
  if (!pool || typeof pool.connect !== 'function') throw new Error('STORE_NOT_CONFIGURED');
  const client = await pool.connect();
  let inTx = false;
  try {
    await client.query('BEGIN'); inTx = true;
    const now = new Date().toISOString();
    const inserted = await client.query(
      'INSERT INTO public.staff_registry (google_sub,status,role,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (google_sub) DO NOTHING RETURNING google_sub',
      [identity.sub,'pending','staff',1,now]
    );
    if (inserted.rowCount === 1) {
      await client.query(
        'INSERT INTO public.staff_audit_log (at,actor_sub,target_sub,action,from_status,to_status,record_version) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [now,identity.sub,identity.sub,'register',null,'pending',1]
      );
    }
    const found = await client.query(
      'SELECT google_sub,status,role,version FROM public.staff_registry WHERE google_sub=$1 FOR UPDATE',
      [identity.sub]
    );
    const staff = found.rows[0];
    if (!staff) throw new Error('REGISTRATION_FAILED');
    if (staff.status === 'pending') {
      await client.query(
        'INSERT INTO public.staff_registration_requests (google_sub,request_id,email_display,name_display,requested_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (google_sub) DO UPDATE SET email_display=EXCLUDED.email_display,name_display=EXCLUDED.name_display,updated_at=EXCLUDED.updated_at',
        [identity.sub,randomUUID(),identity.email,nameFor(identity),now]
      );
    }
    await client.query('COMMIT'); inTx = false;
    return Object.freeze({status:staff.status,role:staff.role,version:Number(staff.version),newRegistration:inserted.rowCount===1});
  } catch (e) {
    if (inTx) try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {client.release();}
}

export async function findStaff(pool, sub) {
  if (!subOK(sub)) return null;
  const result = await pool.query(
    'SELECT google_sub,status,role,version FROM public.staff_registry WHERE google_sub=$1',
    [sub]
  );
  return result.rows[0] || null;
}

export async function listRequests(pool) {
  const result = await pool.query(
    "SELECT r.request_id,r.email_display,r.name_display,r.requested_at,r.last_notice_sent_at FROM public.staff_registration_requests r JOIN public.staff_registry s ON s.google_sub=r.google_sub WHERE s.status='pending' ORDER BY r.requested_at ASC LIMIT 100"
  );
  return result.rows.map(r=>({requestId:r.request_id,email:r.email_display,name:r.name_display,
    requestedAt:r.requested_at,noticeSentAt:r.last_notice_sent_at}));
}

export async function findRequest(pool, requestId) {
  if (typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return null;
  const result=await pool.query(
    'SELECT r.google_sub,r.email_display,r.name_display,s.status FROM public.staff_registration_requests r JOIN public.staff_registry s ON s.google_sub=r.google_sub WHERE r.request_id=$1',
    [requestId]
  );
  return result.rows[0]||null;
}

export async function claimNotification(pool, sub) {
  if (!subOK(sub)) return null;
  const result=await pool.query(
    "UPDATE public.staff_registration_requests r SET last_notice_attempt_at=NOW() FROM public.staff_registry s WHERE r.google_sub=$1 AND s.google_sub=r.google_sub AND s.status='pending' AND (r.last_notice_attempt_at IS NULL OR r.last_notice_attempt_at<NOW()-INTERVAL '10 minutes') RETURNING r.request_id,r.email_display,r.name_display",
    [sub]
  );
  return result.rows[0]||null;
}

export async function markNotificationSent(pool, sub) {
  if (!subOK(sub)) return;
  await pool.query('UPDATE public.staff_registration_requests SET last_notice_sent_at=NOW() WHERE google_sub=$1',[sub]);
}
