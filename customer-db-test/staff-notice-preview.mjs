/**
 * Immediate application-email notification through a verified Resend sender.
 * No vendor tokens, account IDs or customer data are sent to the browser.
 */
const TO='azumanakazono@gmail.com';
const escapeHtml=(value)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mailReady(env=process.env){
  try{
    const u=new URL(env.JIBUNDEN_STAFF_PUBLIC_ORIGIN);
    return u.protocol==='https:' && !!u.hostname && !!env.JIBUNDEN_STAFF_RESEND_API_KEY &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.JIBUNDEN_STAFF_MAIL_FROM||'');
  }catch{return false;}
}
export async function sendStaffNotice(request,{env=process.env,post=fetch}={}){
  if(!mailReady(env))return {sent:false,reason:'MAIL_NOT_CONFIGURED'};
  if(!request || typeof request.request_id!=='string') throw Error('INVALID_REQUEST');
  const base=new URL(env.JIBUNDEN_STAFF_PUBLIC_ORIGIN);
  const link=new URL('/staff-approval-preview.html',base);
  link.searchParams.set('request',request.request_id);
  const name=String(request.name_display||'未設定');
  const email=String(request.email_display||'未設定');
  const safeLink=escapeHtml(link.toString());
  const html='<h2>じぶん電気 スタッフ利用申請</h2>'+
    '<p>承認待ちの申請が届きました。本人を確認のうえ、管理者Googleログイン後に承認してください。</p>'+
    '<p>申請者: '+escapeHtml(name)+'<br>Googleアカウント: '+escapeHtml(email)+'</p>'+
    '<p><a href="'+safeLink+'">申請内容を確認・承認する</a></p>'+
    '<p>このメールのリンクだけでは承認できません。管理者本人のGoogle認証とDB上の承認権限が必要です。</p>';
  const body={
    from:env.JIBUNDEN_STAFF_MAIL_FROM,
    to:[TO],
    subject:'【要承認】じぶん電気 スタッフ利用申請',
    html,
    text:'じぶん電気 スタッフ利用申請\n申請者: '+name+'\nGoogleアカウント: '+email+
      '\n承認ページ: '+link.toString()+'\n管理者Googleログイン後に承認してください。'
  };
  const response=await post('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer '+env.JIBUNDEN_STAFF_RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)throw Error('MAIL_PROVIDER_REJECTED');
  return {sent:true};
}
