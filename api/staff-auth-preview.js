import {OAuth2Client} from 'google-auth-library';
import {verifyStaffGoogleIdentity} from '../customer-db-test/google-identity-verifier.mjs';

// PR #318 only: authentication boundary test. No customer DB access.
// Until a server-owned staff registry and session issuance are implemented,
// successful Google verification STILL returns access denied.
const json=(res,code,body)=>{
  res.statusCode=code;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
};
export default async function handler(req,res){
  if(req.method!=='GET' && req.method!=='POST'){
    res.setHeader('Allow','GET, POST');
    return json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  }
  const configured=typeof process.env.JIBUNDEN_STAFF_GOOGLE_CLIENT_ID==='string' &&
    /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(process.env.JIBUNDEN_STAFF_GOOGLE_CLIENT_ID);
  if(req.method==='GET')return json(res,200,{
    ok:true,configured,
    clientId:configured?process.env.JIBUNDEN_STAFF_GOOGLE_CLIENT_ID:null,
    registrationEnabled:false,
    customerDbConnected:false
  });
  if(!configured)return json(res,503,{ok:false,error:'GOOGLE_LOGIN_NOT_CONFIGURED'});
  const origin=req.headers.origin;
  const host=req.headers['x-forwarded-host']||req.headers.host;
  // This endpoint will not set session cookies; still require same-origin requests.
  if(typeof origin!=='string'||!host){
    return json(res,403,{ok:false,error:'ORIGIN_REQUIRED'});
  }
  let originURL;
  try{originURL=new URL(origin)}catch{return json(res,403,{ok:false,error:'ORIGIN_INVALID'})}
  if(originURL.protocol!=='https:'||originURL.host!==host)
    return json(res,403,{ok:false,error:'ORIGIN_DENIED'});
  if(!(req.headers['content-type']||'').startsWith('application/json'))
    return json(res,415,{ok:false,error:'CONTENT_TYPE_REQUIRED'});
  let credential;
  try{
    const body=req.body;
    const parsed=typeof body==='string'?JSON.parse(body):body;
    credential=parsed?.credential;
  }catch{return json(res,400,{ok:false,error:'INVALID_REQUEST'})}
  if(typeof credential!=='string'||credential.length>8192||credential.length<20)
    return json(res,400,{ok:false,error:'INVALID_REQUEST'});
  try{
    const client=new OAuth2Client();
    await verifyStaffGoogleIdentity({
      idToken:credential,clientId:process.env.JIBUNDEN_STAFF_GOOGLE_CLIENT_ID,
      oauthClient:client
    });
    // Explicit fail-closed. No user list, customer data or sessions are exposed.
    return json(res,403,{ok:false,error:'STAFF_APPROVAL_NOT_IMPLEMENTED'});
  }catch{
    return json(res,401,{ok:false,error:'GOOGLE_IDENTITY_VERIFICATION_FAILED'});
  }
}
