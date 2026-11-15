import test from 'node:test';
import assert from 'node:assert/strict';
import {mailReady,sendStaffNotice} from './staff-notice-preview.mjs';
const request={request_id:'128e32f2-20b7-4f6b-8de4-334da43218fc',
 email_display:'alice@example.com',name_display:'<img src=x onerror=alert(1)>'};
test('missing verified sender configuration does not send mail',async()=>{
  let calls=0;
  const result=await sendStaffNotice(request,{env:{},post:()=>{calls++;throw Error('WRONG')}});
  assert.equal(result.sent,false);
  assert.equal(calls,0);
});
test('approval message goes only to designated manager with escaped HTML and no approval bearer',async()=>{
  let sent;
  const env={JIBUNDEN_STAFF_PUBLIC_ORIGIN:'https://preview.example.com',
    JIBUNDEN_STAFF_MAIL_FROM:'staff-notice@example.com',JIBUNDEN_STAFF_RESEND_API_KEY:'test-key'};
  assert.equal(mailReady(env),true);
  const result=await sendStaffNotice(request,{env,post:async(url,opt)=>{
    sent={url,body:JSON.parse(opt.body)};
    return {ok:true};
  }});
  assert.equal(result.sent,true);
  assert.equal(sent.url,'https://api.resend.com/emails');
  assert.deepEqual(sent.body.to,['azumanakazono@gmail.com']);
  assert.equal(sent.body.html.includes('<img src=x'),false);
  assert.match(sent.body.html,/request=128e32f2/);
  assert.match(sent.body.html,/管理者Googleログイン/);
  assert.equal(sent.body.html.includes('approve?token='),false);
});
test('provider errors are surfaced to caller for recovery',async()=>{
  await assert.rejects(
    sendStaffNotice(request,{env:{JIBUNDEN_STAFF_PUBLIC_ORIGIN:'https://preview.example.com',
      JIBUNDEN_STAFF_MAIL_FROM:'staff@example.com',JIBUNDEN_STAFF_RESEND_API_KEY:'key'},
      post:async()=>({ok:false})}),
    /MAIL_PROVIDER_REJECTED/
  );
});
