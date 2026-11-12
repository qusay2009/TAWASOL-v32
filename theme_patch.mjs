import { readFileSync, writeFileSync } from 'node:fs';

let c = readFileSync('index.html', 'utf8');

// NEW DARK THEME: Deep Ocean Blue / Midnight Indigo
// Replace the CSS theme variables section
const oldTheme = `:root{--bg:#170f1b;--card:#241a28;--ink:#f5eef3;--muted:#b5a4b4;--line:#ffffff0e;--blue:#d3ef8a;--soft:#d3ef8a12;--shadow:0 12px 50px #08040928;--coral:#ff9f8f;--plum:#38233e}
body:not(.dark){--bg:#f6f3ec;--card:#fffdf8;--ink:#35243a;--muted:#88798b;--line:#36203910;--blue:#5d741f;--soft:#d3ef8a27;--shadow:0 12px 50px #37243c06;--plum:#eadfec}`;

const newTheme = `:root{--bg:#070d1a;--card:#0e1829;--ink:#e8f0ff;--muted:#8899bb;--line:#1e3060;--blue:#60a8ff;--soft:#60a8ff15;--shadow:0 12px 50px #00040d40;--coral:#ff7eb3;--plum:#0a1535;--accent:#a78bfa}
body:not(.dark){--bg:#f0f4ff;--card:#ffffff;--ink:#0a1535;--muted:#5570a0;--line:#c8d8f8;--blue:#2563eb;--soft:#2563eb12;--shadow:0 12px 50px #2563eb08;--plum:#e8f0ff;--accent:#7c3aed}`;

if(c.includes(oldTheme)){
  c = c.replace(oldTheme, newTheme);
  console.log('theme replaced OK');
} else {
  // try partial
  const part1 = `--bg:#170f1b;--card:#241a28;`;
  console.log('part1 found:', c.includes(part1));
}

// Update background gradient ambient
const oldAmbient = `body:before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(ellipse at 3% 45%,#ff9f8f09,transparent 40%),radial-gradient(ellipse at 90% 0%,#c6e6830a,transparent 42%);background-size:130% 130%;animation:ambient 20s ease-in-out infinite alternate}`;
const newAmbient = `body:before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(ellipse at 15% 50%,#1e40af12,transparent 50%),radial-gradient(ellipse at 85% 10%,#7c3aed10,transparent 45%),radial-gradient(ellipse at 50% 90%,#0369a110,transparent 50%);background-size:150% 150%;animation:ambient 25s ease-in-out infinite alternate}`;
if(c.includes(oldAmbient)){
  c = c.replace(oldAmbient, newAmbient);
  console.log('ambient replaced OK');
}

// Update cursor glow color
const oldGlow = `background:radial-gradient(circle,#d3ef8a08,transparent 65%)`;
const newGlow = `background:radial-gradient(circle,#60a8ff0a,transparent 65%)`;
c = c.replace(oldGlow, newGlow);

// Update primary button to blue
const oldPrimary = `.primary{background:#d3ef8a;color:#281b2e;font-weight:700;border-radius:12px;padding:10px 20px}.primary:hover{background:#e0f5b2;box-shadow:0 5px 22px #d3ef8a15}`;
const newPrimary = `.primary{background:var(--blue);color:#fff;font-weight:700;border-radius:12px;padding:10px 20px}.primary:hover{background:#3b82f6;box-shadow:0 5px 22px #60a8ff30}`;
if(c.includes(oldPrimary)){
  c = c.replace(oldPrimary, newPrimary);
  console.log('primary btn replaced OK');
}

// Update brand icon background
const oldBrand = `.brand-logo-icon{width:44px;height:44px;border-radius:14px;background:var(--plum);border:1px solid var(--line);display:grid;place-items:center;box-shadow:0 4px 18px -4px rgba(0,0,0,0.35);transition:transform .35s cubic-bezier(.3,1.6,.5,1),border-color .3s;flex-shrink:0}`;
const newBrand = `.brand-logo-icon{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#1e3a8a,#312e81);border:1px solid var(--line);display:grid;place-items:center;box-shadow:0 4px 18px -4px rgba(96,168,255,0.3);transition:transform .35s cubic-bezier(.3,1.6,.5,1),border-color .3s;flex-shrink:0}`;
if(c.includes(oldBrand)){
  c = c.replace(oldBrand, newBrand);
  console.log('brand icon replaced OK');
}

// Update logo SVG stroke colors to blue
const oldLogoA = `.a-b{stroke:var(--blue);stroke-width:3.5;`;
// Keep as is since --blue is now blue

// Update editorial card
const oldEditorial = `.editorial{position:relative;height:184px;background:var(--plum);overflow:hidden;border-radius:22px;margin-bottom:24px;padding:28px}`;
const newEditorial = `.editorial{position:relative;height:184px;background:linear-gradient(135deg,#0f1e45,#1e1052);overflow:hidden;border-radius:22px;margin-bottom:24px;padding:28px;border:1px solid var(--line)}`;
if(c.includes(oldEditorial)){
  c = c.replace(oldEditorial, newEditorial);
  console.log('editorial replaced OK');
}

// Update orbital ring color
const oldOrbital = `.editorial .orbital{position:absolute;left:35px;top:28px;width:132px;height:132px;border-radius:50%;border:26px solid #d3ef8a;transform:rotate(-28deg);box-shadow:20px 10px 0 #141b4250}`;
const newOrbital = `.editorial .orbital{position:absolute;left:35px;top:28px;width:132px;height:132px;border-radius:50%;border:26px solid #60a8ff;transform:rotate(-28deg);box-shadow:20px 10px 0 #00051d80,0 0 40px #60a8ff20}`;
if(c.includes(oldOrbital)){
  c = c.replace(oldOrbital, newOrbital);
  console.log('orbital replaced OK');
}

// Update coral post likes
const oldCoral = `.post-actions .liked{color:var(--coral)!important}`;
const newCoral = `.post-actions .liked{color:#f472b6!important}`;
if(c.includes(oldCoral)){
  c = c.replace(oldCoral, newCoral);
  console.log('liked color replaced OK');
}

// Update cover gradient
const oldCover = `.cover{background:linear-gradient(130deg,#453047,#af706e);height:180px}`;
const newCover = `.cover{background:linear-gradient(135deg,#1e3a8a,#312e81,#0f766e);height:180px}`;
if(c.includes(oldCover)){
  c = c.replace(oldCover, newCover);
  console.log('cover replaced OK');
}

// Update bubble colors (mine)
const oldMine = `.mine .bubble{background:#d3ef8a;color:#302034;border-radius:18px 18px 18px 4px}`;
const newMine = `.mine .bubble{background:var(--blue);color:#fff;border-radius:18px 18px 18px 4px}`;
if(c.includes(oldMine)){
  c = c.replace(oldMine, newMine);
  console.log('mine bubble replaced OK');
}

// Update story rings
const oldStoryRing = `.story-avatar{position:relative;width:54px;height:54px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,var(--blue),var(--coral));display:grid;place-items:center;box-shadow:0 4px 12px -2px rgba(0,0,0,0.25)}`;
const newStoryRing = `.story-avatar{position:relative;width:54px;height:54px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,#60a8ff,#a78bfa);display:grid;place-items:center;box-shadow:0 4px 12px -2px rgba(96,168,255,0.35)}`;
if(c.includes(oldStoryRing)){
  c = c.replace(oldStoryRing, newStoryRing);
  console.log('story ring replaced OK');
}

// Update dark mode override
const oldDark = `body.dark{--bg:#1c1120;--card:#2a1c2e;--ink:#f5eef3;--muted:#baa8b9;--line:#ffffff0e;--blue:#d3ef8a;--soft:#d3ef8a12;--shadow:0 12px 50px #08040928;--coral:#ff9f8f;--plum:#402747}`;
const newDark = `body.dark{--bg:#070d1a;--card:#0e1829;--ink:#e8f0ff;--muted:#8899bb;--line:#1e3060;--blue:#60a8ff;--soft:#60a8ff15;--shadow:0 12px 50px #00040d40;--coral:#ff7eb3;--plum:#0a1535;--accent:#a78bfa}`;
if(c.includes(oldDark)){
  c = c.replace(oldDark, newDark);
  console.log('dark mode replaced OK');
}

// Update mobile FAB
const oldFab = `.mobile-fab{display:grid!important;place-items:center;position:fixed;bottom:76px;left:18px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#b2d665);color:#24142a;`;
const newFab = `.mobile-fab{display:grid!important;place-items:center;position:fixed;bottom:76px;left:18px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#7c3aed);color:#fff;`;
if(c.includes(oldFab)){
  c = c.replace(oldFab, newFab);
  console.log('fab replaced OK');
}

// Update story-add button
const oldStoryAdd = `.story-add{position:absolute;bottom:-1px;right:-1px;width:18px;height:18px;background:var(--blue);color:#24142a;`;
const newStoryAdd = `.story-add{position:absolute;bottom:-1px;right:-1px;width:18px;height:18px;background:var(--blue);color:#fff;`;
if(c.includes(oldStoryAdd)){
  c = c.replace(oldStoryAdd, newStoryAdd);
  console.log('story-add replaced OK');
}

// Update auth card background
const oldAuthCard = `background:rgba(40,18,50,.75);`;
const newAuthCard = `background:rgba(7,13,26,.85);`;
if(c.includes(oldAuthCard)){
  c = c.replace(oldAuthCard, newAuthCard);
  console.log('auth card replaced OK');
}

// Update auth card gradient border
const oldAuthBorder = `background:linear-gradient(140deg,var(--blue),transparent 35%,transparent 65%,var(--coral));`;
const newAuthBorder = `background:linear-gradient(140deg,var(--blue),transparent 35%,transparent 65%,#a78bfa);`;
if(c.includes(oldAuthBorder)){
  c = c.replace(oldAuthBorder, newAuthBorder);
  console.log('auth border replaced OK');
}

// Update auth backdrop
const oldAuthBg = `background:radial-gradient(900px 600px at var(--lx,70%) var(--ly,40%),rgba(211,239,138,.2),transparent 60%),radial-gradient(1200px 800px at 15% 110%,#2d1337,transparent 65%),var(--bg)`;
const newAuthBg = `background:radial-gradient(900px 600px at var(--lx,70%) var(--ly,40%),rgba(96,168,255,.15),transparent 60%),radial-gradient(1200px 800px at 15% 110%,#030818,transparent 65%),var(--bg)`;
if(c.includes(oldAuthBg)){
  c = c.replace(oldAuthBg, newAuthBg);
  console.log('auth bg replaced OK');
}

// Update loader background
const oldLoaderBg = `background:radial-gradient(760px 540px at var(--lx,50%) var(--ly,45%),rgba(211,239,138,.25),transparent 62%),radial-gradient(1100px 700px at 50% 120%,#2d1337,transparent 65%),var(--bg);`;
const newLoaderBg = `background:radial-gradient(760px 540px at var(--lx,50%) var(--ly,45%),rgba(96,168,255,.18),transparent 62%),radial-gradient(1100px 700px at 50% 120%,#020814,transparent 65%),var(--bg);`;
if(c.includes(oldLoaderBg)){
  c = c.replace(oldLoaderBg, newLoaderBg);
  console.log('loader bg replaced OK');
}

// Update rec-dot color
const oldRecDot = `.rec-dot{width:10px;height:10px;border-radius:50%;background:var(--coral);animation:pulse 1s infinite}`;
const newRecDot = `.rec-dot{width:10px;height:10px;border-radius:50%;background:#f472b6;animation:pulse 1s infinite}`;
if(c.includes(oldRecDot)){
  c = c.replace(oldRecDot, newRecDot);
  console.log('rec-dot replaced OK');
}

// Update admin-head-btn
const oldAdminBtn = `.admin-head-btn{background:var(--soft);color:var(--blue);border:1px solid var(--line);border-radius:12px;padding:8px 14px;font-size:12px;display:inline-flex;align-items:center;gap:6px;font-weight:700}
.admin-head-btn:hover{background:#ff9f8f2e;color:var(--coral);border-color:var(--coral)}
.admin-head-btn.active{background:var(--coral);color:#281a30;border-color:var(--coral)}`;
const newAdminBtn = `.admin-head-btn{background:var(--soft);color:var(--blue);border:1px solid var(--line);border-radius:12px;padding:8px 14px;font-size:12px;display:inline-flex;align-items:center;gap:6px;font-weight:700}
.admin-head-btn:hover{background:#a78bfa20;color:#a78bfa;border-color:#a78bfa}
.admin-head-btn.active{background:#a78bfa;color:#fff;border-color:#a78bfa}`;
if(c.includes(oldAdminBtn)){
  c = c.replace(oldAdminBtn, newAdminBtn);
  console.log('admin btn replaced OK');
}

// Also update inline coral references in the loader spinner
c = c.replace(/filter:drop-shadow\(0 0 10px var\(--coral\)\)/g, 'filter:drop-shadow(0 0 10px #ff7eb3)');

writeFileSync('index.html', c, 'utf8');
console.log('\nTheme patch complete!');
