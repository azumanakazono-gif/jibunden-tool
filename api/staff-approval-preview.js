import {getStaffPool,json,jsonBody,allowOrigin} from '../customer-db-test/staff-runtime-preview.mjs';
import {readCookieHeader,readSession} from '../customer-db-test/staff-session-preview.mjs';
import {findStaff,findRequest,listRequests} from '../customer-db-test/staff-instant-service.mjs';
import {executeStaffCommand} from '../customer-db-test/staff-registry-commands.mjs';
import {createPostgresStaffStore} from '../customer-db-test/staff-postgres-store.mjs';

export default async function handler(req,res) {
  if(!['GET','POST'].includes(req.method))return json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  if(req.method==='POST'&&!allowOrigin(req))return json(res,403,{ok:false,error:'ORIGIN_DENIED'});
  try {
    const sub=readSession(readCookieHeader(req.headers.cookie),
      process.env.JIBUNDEN_STAFF_SESSION_SECRET);
    if(!sub)return json(res,401,{ok:false,error:'AUTH_REQUIRED'});
    const pool=await getStaffPool();
    const admin=await findStaff(pool,sub);
    if(admin?.status!=='approved'||admin?.role!=='admin')
      return json(res,403,{ok:false,error:'ADMIN_REQUIRED'});
    if(req.method==='GET'){
      const id=new URL(req.url,'https://preview.invalid').searchParams.get('request');
      if(id){
        const entry=await findRequest(pool,id);
        return json(res,200,{ok:true,request:entry?{
          requestId:id,name:entry.name_display,email:entry.email_display,status:entry.status}:null});
      }
      return json(res,200,{ok:true,requests:await listRequests(pool)});
    }
    const body=jsonBody(req);
    if(body.action!=='approve'&&body.action!=='reject')
      return json(res,400,{ok:false,error:'INVALID_ACTION'});
    const target=await findRequest(pool,body.requestId);
    if(!target)return json(res,404,{ok:false,error:'REQUEST_NOT_FOUND'});
    if(target.status!=='pending')
      return json(res,409,{ok:false,error:'ALREADY_PROCESSED'});
    if(target.google_sub===sub)
      return json(res,403,{ok:false,error:'SELF_MANAGEMENT_FORBIDDEN'});
    const result=await executeStaffCommand({
      actor:{verified:true,email_verified:true,sub},
      command:{action:body.action,googleSub:target.google_sub},
      store:createPostgresStaffStore(pool)
    });
    return json(res,200,{ok:true,status:result.status,version:result.version});
  }catch(e){
    console.error('[staff-approval-preview]',e.message);
    if(['INVALID_REQUEST','CONTENT_TYPE_REQUIRED'].includes(e.message))
      return json(res,400,{ok:false,error:'INVALID_REQUEST'});
    if(['STAFF_NOT_FOUND','INVALID_STATUS_TRANSITION','STAFF_CONCURRENT_UPDATE'].includes(e.message))
      return json(res,409,{ok:false,error:'CONFLICT'});
    return json(res,503,{ok:false,error:'PREVIEW_UNAVAILABLE'});
  }
}
