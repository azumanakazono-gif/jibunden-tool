import {getStaffPool,json} from '../customer-db-test/staff-runtime-preview.mjs';
import {readCookieHeader,readSession} from '../customer-db-test/staff-session-preview.mjs';
import {findStaff} from '../customer-db-test/staff-instant-service.mjs';

export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  try{
    const sub=readSession(readCookieHeader(req.headers.cookie),
      process.env.JIBUNDEN_STAFF_SESSION_SECRET);
    if(!sub)return json(res,401,{ok:false,error:'AUTH_REQUIRED'});
    const pool=await getStaffPool();
    const staff=await findStaff(pool,sub);
    if(!staff)return json(res,403,{ok:false,error:'STAFF_NOT_REGISTERED'});
    return json(res,200,{ok:true,status:staff.status,role:staff.status==='approved'?staff.role:null,
      accessGranted:staff.status==='approved',loanAccessGranted:false});
  }catch(e){
    console.error('[staff-status-preview]',e.message);
    return json(res,503,{ok:false,error:'PREVIEW_UNAVAILABLE'});
  }
}
