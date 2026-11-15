import pg from 'pg';
import {validSessionSecret} from './staff-session-preview.mjs';

let pool;
export function previewConfigurationReady(env=process.env) {
  return validSessionSecret(env.JIBUNDEN_STAFF_SESSION_SECRET) &&
    typeof env.JIBUNDEN_STAFF_DB_DATABASE_URL==='string' &&
    env.JIBUNDEN_STAFF_DB_DATABASE_URL.startsWith('postgresql://') &&
    /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(env.JIBUNDEN_STAFF_GOOGLE_CLIENT_ID||'');
}
export async function getStaffPool() {
  if(!previewConfigurationReady()) throw Error('PREVIEW_NOT_CONFIGURED');
  if (!pool) pool=new pg.Pool({
    connectionString:process.env.JIBUNDEN_STAFF_DB_DATABASE_URL,
    ssl:{rejectUnauthorized:true},
    max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000
  });
  // Reject owner/admin-level DB roles before running any request handling.
  const check=await pool.query("SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls,pg_has_role(current_user,'neon_superuser','member') AS neon_admin FROM pg_roles r WHERE r.rolname=current_user");
  const r=check.rows[0];
  if(!r || r.rolsuper||r.rolcreaterole||r.rolcreatedb||r.rolbypassrls||r.neon_admin)
    throw Error('PREVIEW_DB_ROLE_TOO_PRIVILEGED');
  return pool;
}

export function json(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
}
export function allowOrigin(req){
  try{
    const origin=new URL(req.headers.origin);
    const host=req.headers['x-forwarded-host']||req.headers.host;
    return origin.protocol==='https:' && origin.host===host && !origin.username && !origin.password;
  }catch{return false;}
}
export function jsonBody(req){
  if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
    throw Error('CONTENT_TYPE_REQUIRED');
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('INVALID_REQUEST');
  return body;
}
