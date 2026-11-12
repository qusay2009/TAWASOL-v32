import { readFileSync, writeFileSync } from 'node:fs';

let c = readFileSync('index.html', 'utf8');

// 1. Replace person function
const oldPersonMarker = `function person(u){const following=me().following.includes(u.id);return '<div class="row person">`;
const idx = c.indexOf(oldPersonMarker);
if(idx === -1){ console.log('person NOT found'); process.exit(1); }
// find end of this single-line function
const lineEnd = c.indexOf('\n', idx);
const oldPerson = c.slice(idx, lineEnd);

const newPerson = `function person(u){
  const following=me().following.includes(u.id);
  const pending=(me().pendingFollows||[]).includes(u.id);
  const isMutual=mutual(u);
  const theyRequested=hasRequestedMe(u);
  let followBtn='';
  if(isMutual){followBtn='<button class="follow" onclick="follow(\\''+u.id+'\\')">صديقان ✓</button>';}
  else if(pending){followBtn='<span class="muted" style="font-size:12px;padding:6px">بانتظار القبول…</span>';}
  else if(theyRequested){followBtn='<button class="primary" style="padding:6px 12px;font-size:12px" onclick="acceptFollow(\\''+u.id+'\\')">قبول</button><button class="quiet" style="padding:6px 10px;font-size:12px;border:1px solid var(--line);margin-right:4px" onclick="rejectFollow(\\''+u.id+'\\')">رفض</button>';}
  else{followBtn='<button class="follow" onclick="follow(\\''+u.id+'\\')">+ متابعة</button>';}
  return '<div class="row person"><button style="padding:0" onclick="go(\\'profile\\',\\''+u.id+'\\')">'+avatar(u)+'</button><div class="grow"><b>'+esc(u.name)+'</b><div class="muted">'+(isMutual?'صديق ✦':pending?'بانتظار القبول':theyRequested?'أرسل لك طلب متابعة':'')+' </div></div><div class="row" style="gap:5px">'+followBtn+'</div></div>';
}`;

c = c.slice(0, idx) + newPerson + c.slice(lineEnd);
console.log('person replaced OK');

// 2. Replace notifications function to add accept/reject buttons for follow requests
const oldNotifMarker = `function notifications(){`;
const nIdx = c.indexOf(oldNotifMarker);
// find closing brace - it's a multi-line function ending with \n}
const nLineEnd = c.indexOf('\n}\n', nIdx);
const oldNotif = c.slice(nIdx, nLineEnd + 3);

const newNotif = `function notifications(){
  const ns=db.notifications.filter(n=>n.to===current).slice().reverse();
  const hasUnread=ns.some(n=>!n.read);
  return heading('الإشعارات','كل جديد من أصدقائك وعالمك')+
    '<div class="card">'+
    (ns.length?'<div class="row between" style="margin-bottom:14px"><span class="muted">'+ns.length+' إشعار</span>'+(hasUnread?'<button class="quiet" onclick="act(\\'readNotifications\\',{}).then(()=>{db.notifications.filter(n=>n.to===current).forEach(n=>n.read=true);render()})">✓ تحديد الكل كمقروء</button>':'')+' </div>':'')+
    (ns.length?ns.map(n=>{
      const isFollowReq=n.type==='followRequest';
      const isFollowAcc=n.type==='followAccepted';
      const isMsg=n.text&&n.text.includes('رسالة جديدة');
      const iconBadge=isFollowReq?'👤':(isFollowAcc?'✓':(isMsg?'💬':'✦'));
      let actions='';
      if(isFollowReq&&n.fromId){
        actions='<div class="row" style="gap:6px;margin-top:10px">'+
          '<button class="primary" style="padding:7px 16px;font-size:12px" onclick="acceptFollow(\\''+n.fromId+'\\')">قبول الطلب</button>'+
          '<button class="quiet" style="padding:7px 14px;font-size:12px;border:1px solid var(--line)" onclick="rejectFollow(\\''+n.fromId+'\\')">رفض</button>'+
          '</div>';
      } else if(isFollowAcc){
        actions='<button class="quiet" style="padding:6px 14px;font-size:12px;border:1px solid var(--line);margin-top:8px" onclick="go(\\'friends\\')">عرض الأصدقاء</button>';
      } else if(isMsg){
        actions='<button class="quiet" style="padding:6px 14px;font-size:12px;border:1px solid var(--line);margin-top:8px" onclick="go(\\'messages\\')">فتح المحادثة</button>';
      }
      return '<div class="card" style="margin-bottom:12px;padding:14px;border-color:'+(n.read?'var(--line)':'var(--blue)')+';background:'+(n.read?'var(--card)':'var(--soft)')+'">'+
        '<div class="row" style="gap:12px;align-items:flex-start">'+
        '<span style="font-size:22px;width:38px;height:38px;display:grid;place-items:center;background:var(--plum);border-radius:50%;flex-shrink:0">'+iconBadge+'</span>'+
        '<div class="grow"><b style="font-size:13px">'+esc(n.text)+'</b>'+(n.time?'<div class="muted" style="font-size:11px;margin-top:3px">'+new Date(n.time).toLocaleTimeString('ar-JO',{hour:'2-digit',minute:'2-digit'})+'</div>':'')+actions+'</div>'+
        '</div></div>';
    }).join(''):
    '<div class="empty"><div class="empty-symbol">🔔</div>أنت على اطلاع بكل شيء ✨<br><small class="muted">ستصلك هنا إشعارات الطلبات والرسائل فور حدوثها</small></div>')+
    '</div>';
}
`;

c = c.slice(0, nIdx) + newNotif + c.slice(nIdx + oldNotif.length);
console.log('notifications replaced OK');

// 3. Add acceptFollow and rejectFollow functions after follow function
const afterFollow = `async function follow(id){try{await act('follow',{id})}catch{}}`;
const extraFuncs = `
async function follow(id){try{await act('follow',{id})}catch{}}
async function acceptFollow(id){try{await act('acceptFollow',{id});toast('تم قبول طلب المتابعة ✓')}catch(e){toast(e.message)}}
async function rejectFollow(id){try{await act('rejectFollow',{id});toast('تم رفض الطلب')}catch(e){toast(e.message)}}`;

c = c.replace(afterFollow, extraFuncs);
console.log('acceptFollow/rejectFollow added');

// 4. Fix messages() - restrict canSend to mutual friends only
c = c.replace(
  `const canSend=selected && selected.id!==current && !isBlocked;`,
  `const canSend=selected && selected.id!==current && !isBlocked && mutual(selected);`
);
console.log('canSend restricted to mutual friends');

// 5. Fix friends() - show incoming requests section
const oldFriends = `function friends(){const fs=db.users.filter(mutual),pending=db.users.filter(u=>u.id!==current&&me().following.includes(u.id)&&!mutual(u));return heading('دائرتك.','المتابعة المتبادلة تصنع صداقة')+'<div class="card">'+(fs.map(person).join('')||'<div class="empty"><div class="empty-symbol">✳</div>تبدأ الصداقة بمتابعة.<br><button class="primary" style="margin-top:15px" onclick="go(\\'search\\')">ابحث عن صديق</button></div>')+'</div>'+(pending.length?'<h2>متابعاتك</h2><div class="card">'+pending.map(person).join('')+'</div>':'')}`;
const newFriends = `function friends(){
  const fs=db.users.filter(mutual);
  const pending=db.users.filter(u=>u.id!==current&&(me().pendingFollows||[]).includes(u.id)&&!mutual(u));
  const incomingReqs=db.notifications.filter(n=>n.type==='followRequest'&&n.to===current);
  const reqUsers=incomingReqs.map(n=>db.users.find(u=>u.id===n.fromId)).filter(Boolean);
  return heading('دائرتك.','المتابعة المتبادلة تصنع صداقة')+
    (reqUsers.length?'<div class="card" style="border-color:var(--blue);background:var(--soft);margin-bottom:16px"><div class="row between" style="margin-bottom:12px"><h2 style="margin:0">طلبات المتابعة 🔔</h2><span class="pill">'+reqUsers.length+'</span></div>'+reqUsers.map(person).join('')+'</div>':'')+
    '<div class="card">'+(fs.map(person).join('')||'<div class="empty"><div class="empty-symbol">✳</div>تبدأ الصداقة بمتابعة.<br><button class="primary" style="margin-top:15px" onclick="go(\\'search\\')">ابحث عن صديق</button></div>')+'</div>'+
    (pending.length?'<h2>بانتظار ردهم</h2><div class="card">'+pending.map(person).join('')+'</div>':'');
}`;

if(c.includes(oldFriends)){
  c = c.replace(oldFriends, newFriends);
  console.log('friends replaced OK');
} else {
  console.log('friends NOT found - searching partial...');
  const part = `function friends(){const fs=db.users.filter(mutual)`;
  console.log('partial found:', c.includes(part));
}

writeFileSync('index.html', c, 'utf8');
console.log('All patches applied. File saved.');
