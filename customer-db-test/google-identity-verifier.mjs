/**
 * Google ID token -> verified identity adapter (server-only).
 * oauthClient MUST be an actual OAuth2Client from google-auth-library
 * in production. Never accept an arbitrary client object from a browser.
 *
 * This module is not an HTTP endpoint and grants no access on its own.
 */
export async function verifyStaffGoogleIdentity({idToken,clientId,oauthClient}) {
  if (typeof idToken !== 'string' || !idToken.trim() ||
      idToken.length > 8192 || typeof clientId !== 'string' ||
      !clientId.trim() || !oauthClient ||
      typeof oauthClient.verifyIdToken !== 'function') {
    throw new Error('IDENTITY_VERIFICATION_UNAVAILABLE');
  }
  let ticket;
  try {
    ticket = await oauthClient.verifyIdToken({idToken,audience:clientId});
  } catch {
    throw new Error('INVALID_GOOGLE_ID_TOKEN');
  }
  const payload=ticket?.getPayload?.();
  if (!payload || !['accounts.google.com','https://accounts.google.com'].includes(payload.iss) ||
      payload.aud!==clientId || typeof payload.sub!=='string' ||
      !payload.sub.trim() || payload.email_verified!==true ||
      !Number.isFinite(Number(payload.exp)) ||
      Number(payload.exp)<=Math.floor(Date.now()/1000)) {
    throw new Error('INVALID_GOOGLE_ID_TOKEN');
  }
  return Object.freeze({
    verified:true,
    sub:payload.sub,
    email_verified:true,
    // email is informative only; it must never be used for authorization
    email:typeof payload.email==='string'?payload.email:'',
    hostedDomain:typeof payload.hd==='string'?payload.hd:null
  });
}
