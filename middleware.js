/**
 * Preview-only staff gate for the Vercel-hosted simulation/loan pages.
 * Default mode is OFF. Opt in ONLY after safe Neon role, admin bootstrap,
 * OAuth origins and full preview checks are complete.
 *
 * NOTE: This does not protect copies hosted on GitHub Pages or other hosts.
 */
import {next} from '@vercel/functions';
import {getStaffPool} from './customer-db-test/staff-runtime-preview.mjs';
import {readCookieHeader,readSession} from './customer-db-test/staff-session-preview.mjs';
import {findStaff} from './customer-db-test/staff-instant-service.mjs';
import {isLoanGateEnabled,mayAccessLoanPage} from './customer-db-test/staff-loan-page-policy.mjs';

export const config = {
  runtime:'nodejs',
  matcher:['/','/index.html','/payment-options.html','/loan-presentation.html']
};

export default async function middleware(request) {
  if(!isLoanGateEnabled()) return next();
  const redirectToLogin = () => {
    const url = new URL('/staff-login-preview.html',request.url);
    const requested=new URL(request.url);
    url.searchParams.set('next',requested.pathname+requested.search);
    return new Response(null,{
      status:303,
      headers:{Location:url.toString(),'Cache-Control':'private, no-store'}
    });
  };
  const subject=readSession(
    readCookieHeader(request.headers.get('cookie')),
    process.env.JIBUNDEN_STAFF_SESSION_SECRET
  );
  if(!subject) return redirectToLogin();
  try {
    const pool=await getStaffPool();
    const staff=await findStaff(pool,subject);
    if (!mayAccessLoanPage(subject,staff)) return redirectToLogin();
    return next({headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
  } catch(e) {
    console.error('[staff-loan-gate-preview]',e.message);
    return new Response('スタッフ認証を確認できません。管理者にお問い合わせください。',{
      status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    });
  }
}
