import {OAuth2Client} from 'google-auth-library';
import {verifyStaffGoogleIdentity} from '../customer-db-test/google-identity-verifier.mjs';
import {getStaffPool,previewConfigurationReady,json,allowOrigin,jsonBody} from '../customer-db-test/staff-runtime-preview.mjs';
import {registerStaffSelf,claimNotification,markNotificationSent} from '../customer-db-test/staff-instant-service.mjs';
import {issueSession,setSessionCookie} from '../customer-db-test/staff-session-preview.mjs';
import {mailReady,sendStaffNotice} from '../customer-db-test/staff-notice-preview.mjs';

// Preview only: do not issue access to any customer DB or loan endpoint.
// Approval status is informative until all resources are actually guarded.
export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))
    return json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  const clientId=process.env.JIBUNDEN_STAFF_GOOGLE_CLIENT_ID;
  const googleConfigured=/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId||'');
  if(req.method==='GET')return json(res,200,{ok:true,configured:googleConfigured,
    clientId:googleConfigured?clientId:null,registrationEnabled:previewConfigurationReady(),
    notificationEnabled:mailReady(),customerDbConnected:false,loanAccessGranted:false});
  if(!allowOrigin(req))return json(res,403,{ok:false,error:'ORIGIN_DENIED'});
  if(!previewConfigurationReady())
    return json(res,503,{ok:false,error:'PREVIEW_NOT_CONFIGURED'});
  let body;
  try{body=jsonBody(req);}
  catch{return json(res,400,{ok:false,error:'INVALID_REQUEST'});}
  if(typeof body.credential!=='string' || body.credential.length<20 || body.credential.length>8192)
    return json(res,400,{ok:false,error:'INVALID_REQUEST'});
  let identity;
  try{
    identity=await verifyStaffGoogleIdentity({
      idToken:body.credential,clientId,oauthClient:new OAuth2Client()
    });
  }catch{return json(res,401,{ok:false,error:'GOOGLE_IDENTITY_VERIFICATION_FAILED'});}
  try{
    const pool=await getStaffPool();
    const staff=await registerStaffSelf(pool,identity);
    const token=issueSession(identity.sub,process.env.JIBUNDEN_STAFF_SESSION_SECRET);
    setSessionCookie(res,token);
    let notification='not_needed';
    if(staff.status==='pending'){
      notification='queued';
      // Mail delivery failure must not erase a persisted pending request.
      try{
        if(!mailReady()) notification='mail_not_configured';
        else {
          const claim=await claimNotification(pool,identity.sub);
          if(claim){
            await sendStaffNotice(claim);
            await markNotificationSent(pool,identity.sub);
            notification='sent';
          }
        }
      }catch(e){
        notification='delivery_pending';
        console.error('[staff-preview-notify]',e.message);
      }
    }
    return json(res,200,{ok:true,status:staff.status,role:staff.status==='approved'?staff.role:null,
      notification,accessGranted:staff.status==='approved',loanAccessGranted:false});
  }catch(e){
    console.error('[staff-auth-preview]',e.message);
    return json(res,503,{ok:false,error:'PREVIEW_UNAVAILABLE'});
  }
}
