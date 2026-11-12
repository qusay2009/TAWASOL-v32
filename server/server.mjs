import http from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ─── PostgreSQL via postgres.js (bundled in server/node_modules/postgres) ───
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv needed)
try {
  const envText = readFileSync(resolve(__dirname, '../.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* .env optional */ }

// Dynamic import of postgres (supports npm install on Render or local fallback)
let postgres;
try {
  const mod = await import('postgres');
  postgres = mod.default || mod;
} catch {
  const postgresUrl = new URL('./node_modules/postgres/src/index.js', import.meta.url);
  const mod = await import(postgresUrl.href);
  postgres = mod.default || mod;
}

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL ||
  'postgresql://postgres.qdcchkjmcfhofabriokh:Qusai2009200@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

const sql = postgres(DB_URL, {
  ssl: 'require',
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

// ─── Bootstrap schema (idempotent) ───────────────────────────────────────────
await sql`
  CREATE TABLE IF NOT EXISTS accounts (
    id      TEXT PRIMARY KEY,
    email   TEXT UNIQUE NOT NULL,
    hash    TEXT NOT NULL,
    salt    TEXT NOT NULL,
    profile JSONB NOT NULL
  )`;
await sql`
  CREATE TABLE IF NOT EXISTS sessions (
    token   TEXT PRIMARY KEY,
    uid     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    csrf    TEXT NOT NULL,
    expires BIGINT NOT NULL
  )`;
await sql`
  CREATE TABLE IF NOT EXISTS state (
    id   INTEGER PRIMARY KEY CHECK(id=1),
    json JSONB NOT NULL
  )`;
await sql`
  CREATE TABLE IF NOT EXISTS media (
    id       TEXT PRIMARY KEY,
    owner    TEXT NOT NULL,
    kind     TEXT NOT NULL,
    mime     TEXT NOT NULL,
    bytes    BYTEA NOT NULL,
    duration REAL NOT NULL
  )`;
await sql`
  CREATE TABLE IF NOT EXISTS audit (
    id    BIGSERIAL PRIMARY KEY,
    actor TEXT,
    action TEXT,
    time  BIGINT
  )`;
await sql`
  CREATE TABLE IF NOT EXISTS limits (
    key   TEXT PRIMARY KEY,
    count INTEGER,
    until BIGINT
  )`;
// Add new columns to notifications if not exist
try { await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'general'`; } catch {}
try { await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_id TEXT`; } catch {}
// Add pendingFollows to accounts profile
try { await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pending_follows JSONB DEFAULT '[]'`; } catch {}

// Seed initial state row if missing
await sql`
  INSERT INTO state(id,json) VALUES(1, ${sql.json({
    posts: [], groups: [], messages: [], reports: [],
    notifications: [], rooms: [], settings: { registration: true }
  })}) ON CONFLICT DO NOTHING`;

console.log('Database ready ✓');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const hash = t => createHash('sha256').update(t).digest('hex');
const fail = (s, m) => { throw Object.assign(Error(m), { status: s }); };
const text = (v, n = 5000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > n) fail(400, 'نص غير صالح');
  return v.trim();
};

const getAccounts = async () => {
  const rows = await sql`SELECT profile FROM accounts`;
  return rows.map(r => r.profile);
};

const storeUser = async u => {
  await sql`UPDATE accounts SET 
    name = ${u.name || ''},
    role = ${u.role || 'user'},
    bio = ${u.bio || ''},
    photo = ${u.photo || ''},
    cover = ${u.cover || ''},
    active = ${u.active !== false},
    permissions = ${sql.json(u.permissions || [])},
    following = ${sql.json(u.following || [])},
    blocked = ${sql.json(u.blocked || [])},
    profile = ${sql.json(u)}
  WHERE id = ${u.id}`;
};

const getState = async () => {
  const [row] = await sql`SELECT json FROM state WHERE id=1`;
  return row.json;
};

const saveState = async data => {
  await sql`UPDATE state SET json=${sql.json(data)} WHERE id=1`;
};

const permission = (u, p) =>
  u.role === 'super' || (u.role === 'admin' && u.permissions?.includes(p));

const rate = async (key, max = 60) => {
  const now = Date.now();
  const [r] = await sql`SELECT * FROM limits WHERE key=${key}`;
  if (r && r.until > now && r.count >= max) fail(429, 'طلبات كثيرة، حاول لاحقًا');
  const newCount = r && r.until > now ? r.count + 1 : 1;
  const newUntil = r && r.until > now ? r.until : now + 900000;
  await sql`INSERT INTO limits(key,count,until) VALUES(${key},${newCount},${newUntil})
    ON CONFLICT(key) DO UPDATE SET count=${newCount}, until=${newUntil}`;
};

const blocked = (a, b) =>
  (a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id);
const friends = (a, b) =>
  a && b && a.active && b.active && !blocked(a, b) &&
  a.following.includes(b.id) && b.following.includes(a.id);
const readable = (p, u, us) =>
  p.author === u.id || permission(u, 'content') ||
  friends(u, us.find(x => x.id === p.author));
const publicUser = x => ({
  id: x.id, name: x.name, photo: x.photo || '', bio: x.bio || '',
  following: [], active: true, email: '', role: 'user', pendingFollows: []
});

function view(db, u, us) {
  return {
    ...db,
    posts: db.posts.filter(p => readable(p, u, us)),
    users: us.filter(x => x.active).map(x =>
      x.id === u.id || permission(u, 'users') ? x : {
        ...publicUser(x),
        following: x.following.includes(u.id) ? [u.id] : [],
        pendingFollows: (x.pendingFollows || []).includes(u.id) ? [u.id] : [],
        typing: x.typing?.to === u.id && x.typing.until > Date.now()
      }
    ),
    messages: db.messages.filter(m => m.from === u.id || m.to === u.id),
    notifications: db.notifications.filter(n => n.to === u.id),
    reports: permission(u, 'reports') ? db.reports : [],
    rooms: db.rooms.map(r =>
      r.members.includes(u.id) ? r :
        { id: r.id, name: r.name, members: r.members, host: r.host, chat: [], video: '' }
    )
  };
}

const attachedMedia = async (id, u, kind) => {
  if (!id) return null;
  const [m] = await sql`SELECT id,owner,kind,duration FROM media WHERE id=${id}`;
  if (!m || m.owner !== u.id || m.kind !== kind) fail(400, 'ملف غير صالح');
  return { id: m.id, duration: m.duration };
};

function wav(bytes, max) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.toString('ascii', 12, 16) !== 'fmt ' ||
    bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16 ||
    bytes.toString('ascii', 36, 40) !== 'data') fail(400, 'الصوت يجب أن يكون WAV PCM أحادي القناة');
  const sr = bytes.readUInt32LE(24), size = bytes.readUInt32LE(40);
  if (sr < 8000 || sr > 48000 || bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt32LE(28) !== sr * 2 || size !== bytes.length - 44 ||
    size % 2 || bytes.readUInt32LE(4) !== bytes.length - 8) fail(400, 'بنية الصوت غير صالحة');
  const duration = size / (sr * 2);
  if (duration <= 0 || duration > max + 0.1) fail(400, 'مدة الصوت تتجاوز الحد');
  return duration;
}

async function action(db, u, a, us) {
  const id = u.id;
  if (!us) us = await getAccounts();
  const find = (xs, k) => xs.find(x => x.id === k) || fail(404, 'غير موجود');
  const own = (owner, p) => { if (owner !== id && !permission(u, p)) fail(403, 'ليست لديك صلاحية'); };
  const postAccess = p => { if (!readable(p, u, us)) fail(403, 'منشورات الأصدقاء فقط'); };
  const image = v => {
    if (!v) return '';
    if (typeof v !== 'string' || v.length > 2000000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) fail(400, 'صورة غير صالحة');
    return v;
  };

  switch (a.type) {
    case 'post': {
      const content = typeof a.text === 'string' ? a.text.trim() : '';
      if (content.length > 5000 || (!content && !a.image) || (a.music && !a.image)) fail(400, 'منشور غير صالح');
      const music = a.music ? { ...await attachedMedia(a.music, u, 'music'), name: text(a.musicName || 'موسيقى', 80) } : null;
      const pid = randomUUID();
      const now = Date.now();
      db.posts.unshift({ id: pid, author: id, text: content, image: image(a.image), music, likes: [], comments: [], time: now });
      await sql`INSERT INTO posts(id, author, text, image, music, time)
        VALUES(${pid}, ${id}, ${content}, ${image(a.image)}, ${sql.json(music)}, ${now}) ON CONFLICT DO NOTHING`;
      break;
    }
    case 'like': {
      const p = find(db.posts, a.id);
      postAccess(p);
      if (p.likes.includes(id)) {
        p.likes = p.likes.filter(x => x !== id);
        await sql`DELETE FROM post_likes WHERE post_id=${p.id} AND user_id=${id}`;
      } else {
        p.likes = [...p.likes, id];
        await sql`INSERT INTO post_likes(post_id, user_id) VALUES(${p.id}, ${id}) ON CONFLICT DO NOTHING`;
      }
      break;
    }
    case 'comment': {
      const p = find(db.posts, a.id);
      postAccess(p);
      const cid = randomUUID();
      const ctext = text(a.text, 1000);
      const now = Date.now();
      p.comments.push({ id: cid, author: id, text: ctext });
      await sql`INSERT INTO comments(id, post_id, author, text, time)
        VALUES(${cid}, ${p.id}, ${id}, ${ctext}, ${now}) ON CONFLICT DO NOTHING`;
      break;
    }
    case 'deleteComment': {
      const p = find(db.posts, a.id);
      const c = p.comments[a.index];
      postAccess(p);
      if (!c) fail(404, 'غير موجود');
      own(c.author, 'content');
      p.comments.splice(a.index, 1);
      if (c.id) {
        await sql`DELETE FROM comments WHERE id=${c.id}`;
      } else {
        await sql`DELETE FROM comments WHERE post_id=${p.id} AND author=${c.author} AND text=${c.text}`;
      }
      break;
    }
    case 'deletePost': {
      own(find(db.posts, a.id).author, 'content');
      db.posts = db.posts.filter(p => p.id !== a.id);
      await sql`DELETE FROM posts WHERE id=${a.id}`;
      break;
    }
    case 'profile':
      u.name = text(a.name, 60);
      u.bio = String(a.bio || '').slice(0, 250);
      if (a.photo) u.photo = image(a.photo);
      if (a.cover) u.cover = image(a.cover);
      await storeUser(u);
      break;
    case 'follow': {
      const target = us.find(x => x.id === a.id && x.active && !blocked(u, x));
      if (!target || a.id === id) fail(400, 'حساب غير صالح');
      if (u.following.includes(a.id)) {
        // Unfollow — also remove reverse if they haven't accepted
        u.following = u.following.filter(x => x !== a.id);
        await sql`DELETE FROM follows WHERE follower_id=${id} AND following_id=${a.id}`;
        // Remove any pending follow request notification
        db.notifications = db.notifications.filter(n =>
          !(n.to === a.id && n.type === 'followRequest' && n.fromId === id));
        await sql`DELETE FROM notifications WHERE recipient=${a.id} AND type='followRequest' AND from_id=${id}`;
      } else {
        // Send follow request — don't add to following yet
        const notifId = randomUUID();
        const notifText = 'أرسل لك ' + u.name + ' طلب متابعة ✦';
        db.notifications.push({ id: notifId, to: a.id, fromId: id, text: notifText, type: 'followRequest', read: false, time: Date.now() });
        await sql`INSERT INTO notifications(id, recipient, text, read, type, from_id)
          VALUES(${notifId}, ${a.id}, ${notifText}, false, 'followRequest', ${id}) ON CONFLICT DO NOTHING`;
        // Mark as pending so sender knows
        if (!u.pendingFollows) u.pendingFollows = [];
        if (!u.pendingFollows.includes(a.id)) u.pendingFollows.push(a.id);
        await storeUser(u);
      }
      const meInUs = us.find(x => x.id === id);
      if (meInUs) { meInUs.following = u.following; meInUs.pendingFollows = u.pendingFollows; }
      break;
    }
    case 'acceptFollow': {
      // Current user accepts a follow request from a.id
      const requester = us.find(x => x.id === a.id && x.active);
      if (!requester) fail(404, 'غير موجود');
      // Add requester to my followers (they follow me)
      if (!requester.following) requester.following = [];
      if (!requester.following.includes(id)) {
        requester.following = [...requester.following, id];
        await sql`INSERT INTO follows(follower_id, following_id) VALUES(${a.id}, ${id}) ON CONFLICT DO NOTHING`;
        await storeUser(requester);
      }
      // Remove pending from requester
      if (requester.pendingFollows) {
        requester.pendingFollows = requester.pendingFollows.filter(x => x !== id);
        await storeUser(requester);
      }
      // Remove the follow request notification
      db.notifications = db.notifications.filter(n =>
        !(n.to === id && n.type === 'followRequest' && n.fromId === a.id));
      await sql`DELETE FROM notifications WHERE recipient=${id} AND type='followRequest' AND from_id=${a.id}`;
      // Notify the requester they were accepted
      const acceptNotifId = randomUUID();
      const isMutualNow = (u.following || []).includes(a.id);
      const acceptText = isMutualNow ? ('أصبحتم أصدقاء الآن أنت و' + u.name + ' ✨') : (u.name + ' قبل طلب متابعتك ✓');
      db.notifications.push({ id: acceptNotifId, to: a.id, text: acceptText, type: 'followAccepted', read: false, time: Date.now() });
      await sql`INSERT INTO notifications(id, recipient, text, read, type)
        VALUES(${acceptNotifId}, ${a.id}, ${acceptText}, false, 'followAccepted') ON CONFLICT DO NOTHING`;
      break;
    }
    case 'rejectFollow': {
      // Current user rejects a follow request from a.id
      const requester = us.find(x => x.id === a.id);
      if (requester?.pendingFollows) {
        requester.pendingFollows = requester.pendingFollows.filter(x => x !== id);
        await storeUser(requester);
      }
      db.notifications = db.notifications.filter(n =>
        !(n.to === id && n.type === 'followRequest' && n.fromId === a.id));
      await sql`DELETE FROM notifications WHERE recipient=${id} AND type='followRequest' AND from_id=${a.id}`;
      break;
    }
    case 'block': {
      const target = find(us, a.id);
      if (target.id === id) fail(400, 'غير صالح');
      u.blocked = u.blocked || [];
      if (u.blocked.includes(a.id)) {
        u.blocked = u.blocked.filter(x => x !== a.id);
        await sql`DELETE FROM blocks WHERE blocker_id=${id} AND blocked_id=${a.id}`;
      } else {
        u.blocked.push(a.id);
        u.following = u.following.filter(x => x !== a.id);
        target.following = target.following.filter(x => x !== id);
        await sql`INSERT INTO blocks(blocker_id, blocked_id) VALUES(${id}, ${a.id}) ON CONFLICT DO NOTHING`;
        await sql`DELETE FROM follows WHERE (follower_id=${id} AND following_id=${a.id}) OR (follower_id=${a.id} AND following_id=${id})`;
        await storeUser(target);
      }
      await storeUser(u);
      break;
    }
    case 'ackMessages':
      db.messages.filter(m => m.to === id && !m.deliveredAt).forEach(m => m.deliveredAt = Date.now());
      await sql`UPDATE messages SET delivered_at=${Date.now()} WHERE receiver=${id} AND delivered_at IS NULL`;
      break;
    case 'readMessages':
      db.messages.filter(m => m.to === id && m.from === a.from).forEach(m => m.readAt = m.readAt || Date.now());
      await sql`UPDATE messages SET read_at=${Date.now()} WHERE receiver=${id} AND sender=${a.from} AND read_at IS NULL`;
      break;
    case 'typing': {
      const target = find(us, a.to);
      if (!target || !target.active || blocked(u, target)) fail(403, 'غير متاح');
      u.typing = { to: a.to, until: Date.now() + 7000 };
      await storeUser(u);
      break;
    }
    case 'message': {
      const target = find(us, a.to);
      if (!target || !target.active || blocked(u, target)) fail(403, 'لا يمكن إرسال الرسالة');
      if (!friends(u, target)) fail(403, 'يجب أن تكونا أصدقاء (متابعة متبادلة) للمراسلة');
      const audio = a.audio ? await attachedMedia(a.audio, u, 'voice') : null;
      const msgId = randomUUID();
      const notifId = randomUUID();
      const now = Date.now();
      const msgText = a.audio ? '' : text(a.text, 2000);
      db.messages.push({ id: msgId, from: id, to: a.to, text: msgText, audio, time: now, readAt: null });
      await sql`INSERT INTO messages(id, sender, receiver, text, audio, time)
        VALUES(${msgId}, ${id}, ${a.to}, ${msgText}, ${sql.json(audio)}, ${now}) ON CONFLICT DO NOTHING`;
      db.notifications.push({ id: notifId, to: a.to, text: 'رسالة جديدة من ' + u.name, read: false });
      await sql`INSERT INTO notifications(id, recipient, text, read)
        VALUES(${notifId}, ${a.to}, ${'رسالة جديدة من ' + u.name}, false) ON CONFLICT DO NOTHING`;
      break;
    }
    case 'readNotifications':
      db.notifications.filter(n => n.to === id).forEach(n => n.read = true);
      await sql`UPDATE notifications SET read=true WHERE recipient=${id}`;
      break;
    case 'group': {
      const gid = randomUUID();
      const gname = text(a.name, 70);
      const gdesc = text(a.desc, 180);
      db.groups.push({ id: gid, name: gname, desc: gdesc, icon: '✦', members: [id] });
      await sql`INSERT INTO groups(id, name, desc_text, icon) VALUES(${gid}, ${gname}, ${gdesc}, '✦') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO group_members(group_id, user_id) VALUES(${gid}, ${id}) ON CONFLICT DO NOTHING`;
      break;
    }
    case 'joinGroup': {
      const g = find(db.groups, a.id);
      if (g.members.includes(id)) {
        g.members = g.members.filter(x => x !== id);
        await sql`DELETE FROM group_members WHERE group_id=${g.id} AND user_id=${id}`;
      } else {
        g.members = [...g.members, id];
        await sql`INSERT INTO group_members(group_id, user_id) VALUES(${g.id}, ${id}) ON CONFLICT DO NOTHING`;
      }
      break;
    }
    case 'deleteGroup':
      if (u.role !== 'super') fail(403, 'غير مسموح');
      db.groups = db.groups.filter(g => g.id !== a.id);
      await sql`DELETE FROM groups WHERE id=${a.id}`;
      break;
    case 'report': {
      postAccess(find(db.posts, a.id));
      const repId = randomUUID();
      const reason = text(a.reason, 200);
      db.reports.push({ id: repId, post: a.id, by: id, reason, status: 'pending' });
      await sql`INSERT INTO reports(id, post_id, by_user, reason, status)
        VALUES(${repId}, ${a.id}, ${id}, ${reason}, 'pending') ON CONFLICT DO NOTHING`;
      break;
    }
    case 'resolveReport': {
      if (!permission(u, 'reports')) fail(403, 'غير مسموح');
      const r = find(db.reports, a.id);
      if (a.remove) {
        if (!permission(u, 'content')) fail(403, 'غير مسموح');
        db.posts = db.posts.filter(p => p.id !== r.post);
        await sql`DELETE FROM posts WHERE id=${r.post}`;
      }
      r.status = 'resolved';
      await sql`UPDATE reports SET status='resolved' WHERE id=${a.id}`;
      break;
    }
    case 'toggleUser': {
      const target = find(us, a.id);
      if (!permission(u, 'users') || id === target.id || (u.role !== 'super' && target.role !== 'user')) fail(403, 'غير مسموح');
      target.active = !target.active;
      await storeUser(target);
      await sql`DELETE FROM sessions WHERE uid=${target.id}`;
      break;
    }
    case 'user': {
      if (u.role !== 'super') fail(403, 'غير مسموح');
      const target = find(us, a.id);
      if (target.role === 'super' || !['user', 'admin'].includes(a.role)) fail(403, 'غير مسموح');
      target.name = text(a.name, 60);
      target.role = a.role;
      target.permissions = (a.permissions || []).filter(p => ['users', 'content', 'reports'].includes(p));
      await storeUser(target);
      break;
    }
    case 'claimAdmin':
      if (u.email !== 'qsyashrfalryaty@gmail.com') fail(403, 'غير مسموح');
      u.role = 'super';
      u.permissions = ['users', 'content', 'reports'];
      await storeUser(u);
      break;
    case 'registration':
      if (u.role !== 'super') fail(403, 'غير مسموح');
      db.settings.registration = !!a.value;
      break;
    case 'room': {
      const r = { id: randomUUID(), host: id, name: text(a.name, 60), members: [id], chat: [], video: '' };
      db.rooms.push(r);
      return r.id;
    }
    case 'enterRoom': {
      const r = find(db.rooms, a.id);
      if (!r.members.includes(id)) {
        if (r.members.length >= 5) fail(409, 'الغرفة مكتملة');
        r.members.push(id);
      }
      break;
    }
    case 'leaveRoom': {
      const r = find(db.rooms, a.id);
      r.members = r.members.filter(x => x !== id);
      if (!r.members.length) db.rooms = db.rooms.filter(x => x.id !== r.id);
      else if (r.host === id) r.host = r.members[0];
      break;
    }
    case 'video': {
      const r = find(db.rooms, a.id);
      if (r.host !== id) fail(403, 'المضيف فقط');
      if (!/^[\w-]{11}$/.test(a.video)) fail(400, 'فيديو غير صالح');
      r.video = a.video;
      break;
    }
    case 'roomMessage': {
      const r = find(db.rooms, a.id);
      if (!r.members.includes(id)) fail(403, 'انضم أولًا');
      r.chat.push({ by: id, text: text(a.text, 1000) });
      break;
    }
    default:
      fail(400, 'عملية غير مدعومة');
  }
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const prod = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 8000);

const secHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://www.youtube-nocookie.com; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'"
};

http.createServer(async (req, res) => {
  const reply = (s, data, h = {}) => {
    res.writeHead(s, { ...secHeaders, 'Content-Type': 'application/json; charset=utf-8', ...h });
    res.end(JSON.stringify(data));
  };

  try {
    const path = new URL(req.url, 'http://localhost').pathname;

    // Serve index.html
    if (!path.startsWith('/api/')) {
      if (path !== '/' && path !== '/index.html') return reply(404, { error: 'غير موجود' });
      res.writeHead(200, { ...secHeaders, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(resolve(__dirname, '../index.html')));
    }

    // Parse POST body
    let body = {};
    if (req.method === 'POST') {
      const allowedOrigin = process.env.PUBLIC_ORIGIN;
      if (allowedOrigin && req.headers.origin && req.headers.origin !== allowedOrigin) fail(403, 'مصدر الطلب غير مسموح');
      if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON مطلوب');
      let raw = '';
      for await (const part of req) {
        raw += part;
        if (Buffer.byteLength(raw) > 17000000) fail(413, 'الطلب كبير');
      }
      try { body = JSON.parse(raw); } catch { fail(400, 'JSON غير صالح'); }
    }

    // ── Auth endpoints (login / register) ──
    if (req.method === 'POST' && ['/api/login', '/api/register'].includes(path)) {
      await rate('auth:' + req.socket.remoteAddress, 20);
      const email = text(body.email, 254).toLowerCase();
      const password = text(body.password, 256);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'بريد غير صالح');
      let account;

      if (path === '/api/register') {
        const [stateRow] = await sql`SELECT json FROM state WHERE id=1`;
        if (!stateRow.json.settings.registration) fail(403, 'التسجيل مغلق');
        if (password.length < 12) fail(400, 'كلمة المرور 12 حرفًا على الأقل');
        const salt = randomBytes(16).toString('hex');
        const uid = randomUUID();
        const [{ c }] = await sql`SELECT count(*)::int AS c FROM accounts`;
        const isFirst = c === 0;
        const u = {
          id: uid, email, name: text(body.name, 60),
          role: isFirst ? 'super' : 'user',
          permissions: isFirst ? ['users', 'content', 'reports'] : [],
          following: [], active: true, bio: ''
        };
        try {
          await sql`INSERT INTO accounts(id,email,hash,salt,name,role,bio,photo,cover,active,permissions,following,blocked,profile) VALUES(
            ${uid},${email},
            ${scryptSync(password, salt, 64).toString('hex')},
            ${salt},
            ${u.name},
            ${u.role},
            ${u.bio},
            '',
            '',
            true,
            ${sql.json(u.permissions)},
            ${sql.json([])},
            ${sql.json([])},
            ${sql.json(u)})`;
        } catch { fail(409, 'تعذر إنشاء الحساب بهذا البريد'); }
        const [row] = await sql`SELECT * FROM accounts WHERE id=${uid}`;
        account = row;
      } else {
        const [row] = await sql`SELECT * FROM accounts WHERE email=${email}`;
        const derived = scryptSync(password, row?.salt || 'dummy-salt', 64);
        if (!row || !timingSafeEqual(derived, Buffer.from(row.hash, 'hex')) || !row.profile.active)
          fail(401, 'بيانات الدخول غير صحيحة');
        account = row;
      }

      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(32).toString('hex');
      const maxAgeMs = 90 * 24 * 60 * 60 * 1000; // 90 days persistent session
      const maxAgeSec = 90 * 24 * 60 * 60;
      await sql`DELETE FROM sessions WHERE expires<${Date.now()}`;
      await sql`INSERT INTO sessions(token,uid,csrf,expires) VALUES(
        ${hash(token)},${account.id},${csrf},${Date.now() + maxAgeMs})`;
      
      const isHttps = prod || req.headers['x-forwarded-proto'] === 'https' || req.headers.origin?.startsWith('https');
      const cookieStr = `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${isHttps ? '; Secure' : ''}`;
      return reply(200, { user: account.profile, csrf }, { 'Set-Cookie': cookieStr });
    }

    // ── Authenticate all other routes ──
    const tokenMatch = req.headers.cookie?.match(/(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/);
    const token = tokenMatch?.[1];
    const [session] = token
      ? await sql`SELECT * FROM sessions WHERE token=${hash(token)} AND expires>${Date.now()}`
      : [];
    if (!session) fail(401, 'سجّل الدخول');
    const [userRow] = await sql`SELECT * FROM accounts WHERE id=${session.uid}`;
    const u = userRow?.profile;
    if (!u?.active) fail(401, 'الحساب غير متاح');

    // ── Search ──
    if (req.method === 'GET' && path === '/api/search') {
      const q = new URL(req.url, 'http://localhost').searchParams.get('q')?.trim().toLocaleLowerCase() || '';
      if (q.length < 2 || q.length > 60) fail(400, 'اكتب حرفين على الأقل');
      const us = await getAccounts();
      return reply(200, {
        users: us.filter(x => x.active && x.id !== u.id && !blocked(u, x) &&
          x.name.toLocaleLowerCase().includes(q)).slice(0, 20).map(publicUser)
      });
    }

    // ── Media streaming ──
    if (req.method === 'GET' && path.startsWith('/api/media/')) {
      const mid = path.slice('/api/media/'.length);
      const [m] = await sql`SELECT * FROM media WHERE id=${mid}`;
      if (!m) fail(404, 'غير موجود');
      const db = await getState();
      const us = await getAccounts();
      const allowed = db.posts.some(p => p.music?.id === mid && readable(p, u, us)) ||
        db.messages.some(x => x.audio?.id === mid && (x.from === u.id || x.to === u.id));
      if (!allowed) fail(403, 'غير مسموح');
      res.writeHead(200, { ...secHeaders, 'Content-Type': 'audio/wav', 'Content-Length': m.bytes.length });
      return res.end(Buffer.from(m.bytes));
    }

    // ── State ──
    if (req.method === 'GET' && path === '/api/state') {
      const db = await getState();
      const us = await getAccounts();
      return reply(200, { db: view(db, u, us), current: u.id, csrf: session.csrf });
    }

    if (req.method !== 'POST') fail(405, 'غير مسموح');
    if (req.headers['x-csrf-token'] !== session.csrf) fail(403, 'رمز الحماية غير صالح');
    await rate('user:' + u.id, 200);

    // ── Upload ──
    if (path === '/api/upload') {
      await rate('upload:' + u.id, 25);
      if (!['voice', 'music'].includes(body.kind) || typeof body.data !== 'string' ||
        !/^[A-Za-z0-9+/=]+$/.test(body.data)) fail(400, 'ملف غير صالح');
      const bytes = Buffer.from(body.data, 'base64');
      if (bytes.length > 12000000) fail(413, 'الصوت كبير');
      const duration = wav(bytes, body.kind === 'voice' ? 120 : 30);
      const mid = randomUUID();
      await sql`INSERT INTO media(id,owner,kind,mime,bytes,duration)
        VALUES(${mid},${u.id},${body.kind},'audio/wav',${sql.typed.bytea(bytes)},${duration})`;
      return reply(200, { id: mid, duration });
    }

    // ── Logout ──
    if (path === '/api/logout') {
      if (token) await sql`DELETE FROM sessions WHERE token=${hash(token)}`;
      const isHttps = prod || req.headers['x-forwarded-proto'] === 'https' || req.headers.origin?.startsWith('https');
      return reply(200, {}, { 'Set-Cookie': `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps ? '; Secure' : ''}` });
    }

    if (path !== '/api/action') fail(404, 'غير موجود');

    // ── Action ──
    const [stateRows, us] = await Promise.all([
      sql`SELECT json FROM state WHERE id=1`,
      getAccounts()
    ]);
    const stateDb = stateRows[0].json;
    const result = await action(stateDb, u, body, us);
    await Promise.all([
      sql`UPDATE state SET json=${sql.json(stateDb)} WHERE id=1`,
      sql`INSERT INTO audit(actor,action,time) VALUES(${u.id},${body.type},${Date.now()})`
    ]);

    return reply(200, { db: view(stateDb, u, us), current: u.id, result });

  } catch (e) {
    reply(e.status || 500, { error: e.status ? e.message : 'حدث خطأ في الخادم' });
    if (!e.status) console.error(e);
  }
}).listen(port, '0.0.0.0', () => console.log('TAWASOL listening on port ' + port));
