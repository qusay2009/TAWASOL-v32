import { readFileSync, writeFileSync } from 'node:fs';

let c = readFileSync('index.html', 'utf8');

// 1. Revert light theme to original plum/warm colors
const newLight = `body:not(.dark){--bg:#f0f4ff;--card:#ffffff;--ink:#0a1535;--muted:#5570a0;--line:#c8d8f8;--blue:#2563eb;--soft:#2563eb12;--shadow:0 12px 50px #2563eb08;--plum:#e8f0ff;--accent:#7c3aed}`;
const oldLight = `body:not(.dark){--bg:#f6f3ec;--card:#fffdf8;--ink:#35243a;--muted:#88798b;--line:#36203910;--blue:#5d741f;--soft:#d3ef8a27;--shadow:0 12px 50px #37243c06;--plum:#eadfec}`;

if(c.includes(newLight)){
  c = c.replace(newLight, oldLight);
  console.log('light theme reverted OK');
} else {
  console.log('light theme target NOT found');
}

// 2. Add about page route
// Add the 'about' function before the settings function
const aboutFn = `function about(){
  return heading('حول تواصل','من نحن وما هي رؤيتنا')+
    '<div class="card" style="text-align:center;padding:35px">'+
      '<div style="margin-bottom:20px">'+
        '<div class="auth-logo-box" style="margin:0 auto;width:64px;height:64px;border-radius:20px">'+
          '<svg class="tawasol-logo-svg" viewBox="0 0 64 64" fill="none" style="width:44px;height:44px">'+
            '<path class="a-b" pathLength="1" d="M32 6A24 24 0 1 1 20.5 51L9 56L13.5 44.8A24 24 0 0 1 32 6Z"/>'+
            '<path class="a-l" pathLength="1" d="M23 27L41 33"/>'+
            '<circle class="a-1" cx="23" cy="27" r="5.5"/><circle class="a-2" cx="41" cy="33" r="5.5"/>'+
            '<circle class="a-t" r="2.2"/>'+
          '</svg>'+
        '</div>'+
      '</div>'+
      '<h1 style="font-size:28px;margin-bottom:6px">تواصل · TAWASOL</h1>'+
      '<p class="muted" style="max-width:420px;margin:0 auto;line-height:2">'+
        'منصة تواصل اجتماعي عربية خاصة، صُنعت لتكون مساحة آمنة تجمع الأصدقاء الحقيقيين.'+
        ' <br>هنا كل شيء يبدأ بطلب صداقة — لأن العلاقات الحقيقية تُبنى على القبول المتبادل.'+
      '</p>'+
    '</div>'+
    '<div class="card">'+
      '<h2>✦ مؤسس المنصة</h2>'+
      '<div class="row" style="gap:16px;padding:12px 0">'+
        '<div class="avatar" style="width:60px;height:60px;font-size:22px;border-radius:50%;background:var(--plum)">Q</div>'+
        '<div>'+
          '<h2 style="margin:0">قصي (Qusay)</h2>'+
          '<p class="muted" style="margin:4px 0">مطوّر ومصمم منصة تواصل</p>'+
          '<span class="pill" style="font-size:11px">qsyashrfalryaty@gmail.com</span>'+
        '</div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<p style="line-height:2.2;font-size:14px">'+
        'أنا قصي، مبرمج شاب شغوف بالتكنولوجيا والتصميم. '+
        'بنيت تواصل من الصفر كمنصة اجتماعية عربية تركّز على الخصوصية والعلاقات الحقيقية. '+
        'رؤيتي أن تكون كل صداقة على تواصل حقيقية — لهذا أضفت نظام طلبات المتابعة بالقبول والرفض. '+
        'أحب البرمجة والتصميم وبناء المنتجات التي تخدم المستخدم العربي.'+
      '</p>'+
    '</div>'+
    '<div class="card">'+
      '<h2>⚡ مميزات المنصة</h2>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">'+
        '<div class="stat" style="background:var(--soft);border-radius:14px;padding:16px;text-align:center">'+
          '<span style="font-size:24px">🔒</span><br><b>صداقة بالقبول</b><br><span class="muted" style="font-size:12px">لا متابعة بدون موافقة</span>'+
        '</div>'+
        '<div class="stat" style="background:var(--soft);border-radius:14px;padding:16px;text-align:center">'+
          '<span style="font-size:24px">💬</span><br><b>مراسلة آمنة</b><br><span class="muted" style="font-size:12px">بين الأصدقاء فقط</span>'+
        '</div>'+
        '<div class="stat" style="background:var(--soft);border-radius:14px;padding:16px;text-align:center">'+
          '<span style="font-size:24px">🎙</span><br><b>رسائل صوتية</b><br><span class="muted" style="font-size:12px">سجّل وأرسل بلمسة</span>'+
        '</div>'+
        '<div class="stat" style="background:var(--soft);border-radius:14px;padding:16px;text-align:center">'+
          '<span style="font-size:24px">🌙</span><br><b>وضع ليلي</b><br><span class="muted" style="font-size:12px">تصميم مريح للعينين</span>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="card" style="text-align:center;background:var(--plum)">'+
      '<p class="muted">صُنع بكل ❤️ لنجتمع</p>'+
      '<p style="font-size:12px;color:var(--muted);direction:ltr">TAWASOL © 2026 · Built by Qusay</p>'+
    '</div>';
}
`;

// Insert the about function before the settings function at the right place
// Find the right settings function (the second one, the redesigned one)
const settingsMarker = `function settings(){return heading('على مزاجك.')`;
const settingsIdx = c.indexOf(settingsMarker);
if(settingsIdx !== -1){
  c = c.slice(0, settingsIdx) + aboutFn + c.slice(settingsIdx);
  console.log('about function added OK');
} else {
  console.log('settings marker NOT found');
}

// 3. Add 'about' to nav and routes
// Add to nav items
const oldNav = `['profile','user','الملف الشخصي',0]];`;
const newNav = `['profile','user','الملف الشخصي',0],['about','heart','حول تواصل',0]];`;
if(c.includes(oldNav)){
  c = c.replace(oldNav, newNav);
  console.log('nav about item added');
} else {
  console.log('nav target not found');
}

// Add about to routes
const oldRoutes = `const routes={home,profile,friends,messages,notifications,groups,watch,search,admin,settings};`;
const newRoutes = `const routes={home,profile,friends,messages,notifications,groups,watch,search,admin,settings,about};`;
if(c.includes(oldRoutes)){
  c = c.replace(oldRoutes, newRoutes);
  console.log('about route added');
} else {
  console.log('routes target not found');
}

// 4. Add about link in footer
const oldFooter = `TAWASOL © 2026</div>`;
const newFooter = `TAWASOL © 2026<br><button style="color:var(--muted);font-size:11px;padding:2px" onclick="go('about')">حول تواصل</button></div>`;
if(c.includes(oldFooter)){
  c = c.replace(oldFooter, newFooter);
  console.log('footer about link added');
} else {
  console.log('footer target not found');
}

writeFileSync('index.html', c, 'utf8');
console.log('\nAll patches applied!');
