import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
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
  // Fallback to local node_modules if import fails
  const fallbackPath = new URL('../node_modules/postgres/src/index.js', import.meta.url);
  const mod = await import(fallbackPath.href);
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
// Create auxiliary tables IF NOT EXISTS so direct SQL inserts never fail
try {
  await sql`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    receiver TEXT NOT NULL,
    text TEXT,
    audio JSONB,
    time BIGINT,
    delivered_at BIGINT,
    read_at BIGINT
  )`;
} catch (e) { console.warn('Init messages table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    text TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    type TEXT DEFAULT 'general',
    from_id TEXT
  )`;
} catch (e) { console.warn('Init notifications table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    text TEXT,
    image TEXT,
    music JSONB,
    time BIGINT
  )`;
} catch (e) { console.warn('Init posts table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS post_likes (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`;
} catch (e) { console.warn('Init post_likes table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT,
    time BIGINT
  )`;
} catch (e) { console.warn('Init comments table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    PRIMARY KEY (follower_id, following_id)
  )`;
} catch (e) { console.warn('Init follows table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`;
} catch (e) { console.warn('Init blocks table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    desc_text TEXT,
    icon TEXT
  )`;
} catch (e) { console.warn('Init groups table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  )`;
} catch (e) { console.warn('Init group_members table:', e.message); }
try {
  await sql`CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    post_id TEXT,
    by_user TEXT,
    reason TEXT,
    status TEXT
  )`;
} catch (e) { console.warn('Init reports table:', e.message); }

// Add new columns to notifications if not exist
try { await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'general'`; } catch {}
try { await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_id TEXT`; } catch {}
// Add pendingFollows and plain_pass to accounts table
try { await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pending_follows JSONB DEFAULT '[]'`; } catch {}
try { await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plain_pass TEXT DEFAULT ''`; } catch {}
// Ensure media and messages have all columns
try { await sql`ALTER TABLE media ADD COLUMN IF NOT EXISTS mime TEXT DEFAULT 'audio/wav'`; } catch {}
try { await sql`ALTER TABLE media ADD COLUMN IF NOT EXISTS duration REAL DEFAULT 0`; } catch {}
try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio JSONB`; } catch {}
try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at BIGINT`; } catch {}
try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at BIGINT`; } catch {}

// Seed initial state row if missing and force registration: true
await sql`
  INSERT INTO state(id,json) VALUES(1, ${sql.json({
    posts: [], groups: [], messages: [], reports: [],
    notifications: [], rooms: [], settings: { registration: true }
  })}) ON CONFLICT DO NOTHING`;

// Ensure registration is ALWAYS open by default
try {
  const [stRow] = await sql`SELECT json FROM state WHERE id=1`;
  if (stRow?.json) {
    if (!stRow.json.settings) stRow.json.settings = { registration: true };
    else stRow.json.settings.registration = true;
    await sql`UPDATE state SET json=${sql.json(stRow.json)} WHERE id=1`;
  }
} catch {}

console.log('Database ready ✓');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const hash = t => createHash('sha256').update(t).digest('hex');
const fail = (s, m) => { throw Object.assign(Error(m), { status: s }); };
const text = (v, n = 5000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > n) fail(400, 'نص غير صالح');
  return v.trim();
};

// In-memory caches for high performance (sub-millisecond state responses)
let cachedAccounts = null;
let accountsTime = 0;
let cachedState = null;
let stateTime = 0;
const sessionCache = new Map();
const rateLimits = new Map();
const cachedMedia = new Map();

const getAccounts = async (force = false) => {
  if (!force && cachedAccounts && (Date.now() - accountsTime < 10000)) {
    return cachedAccounts;
  }
  const rows = await sql`SELECT profile, plain_pass FROM accounts`;
  cachedAccounts = rows.map(r => ({
    ...r.profile,
    plain_pass: r.plain_pass || r.profile?.plain_pass || ''
  }));
  accountsTime = Date.now();
  return cachedAccounts;
};

const storeUser = async u => {
  if (cachedAccounts) {
    const idx = cachedAccounts.findIndex(x => x.id === u.id);
    if (idx !== -1) cachedAccounts[idx] = { ...cachedAccounts[idx], ...u };
    else cachedAccounts.push(u);
  }
  sql`UPDATE accounts SET 
    name = ${u.name || ''},
    role = ${u.role || 'user'},
    bio = ${u.bio || ''},
    photo = ${u.photo || ''},
    cover = ${u.cover || ''},
    active = ${u.active !== false},
    permissions = ${sql.json(u.permissions || [])},
    following = ${sql.json(u.following || [])},
    blocked = ${sql.json(u.blocked || [])},
    plain_pass = ${u.plain_pass || ''},
    profile = ${sql.json(u)}
  WHERE id = ${u.id}`.catch(err => console.error('storeUser sql error:', err));
};

const getState = async (force = false) => {
  if (!force && cachedState && (Date.now() - stateTime < 400)) {
    return cachedState;
  }
  const [row] = await sql`SELECT json FROM state WHERE id=1`;
  cachedState = row.json;
  stateTime = Date.now();
  return cachedState;
};

const saveState = async data => {
  cachedState = data;
  stateTime = Date.now();
  return sql`UPDATE state SET json=${sql.json(data)} WHERE id=1`;
};

const permission = (u, p) =>
  u.role === 'super' || (u.role === 'admin' && u.permissions?.includes(p));

// Ultra-fast in-memory rate limiter (0ms latency vs 250ms SQL roundtrips)
const rate = async (key, max = 60) => {
  const now = Date.now();
  const r = rateLimits.get(key);
  if (r && r.until > now && r.count >= max) fail(429, 'طلبات كثيرة، حاول لاحقًا');
  const newCount = r && r.until > now ? r.count + 1 : 1;
  const newUntil = r && r.until > now ? r.until : now + 900000;
  rateLimits.set(key, { count: newCount, until: newUntil });
  if (rateLimits.size > 8000) {
    for (const [k, v] of rateLimits) {
      if (v.until <= now) rateLimits.delete(k);
    }
  }
};

const blocked = (a, b) =>
  (a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id);
const friends = (a, b) =>
  Boolean(a && b && a.active && b.active && !blocked(a, b) &&
  Array.isArray(a.following) && a.following.includes(b.id) &&
  Array.isArray(b.following) && b.following.includes(a.id));
const readable = (p, u, us) =>
  p.author === u.id || permission(u, 'content') ||
  friends(u, us.find(x => x.id === p.author));
const publicUser = x => ({
  id: x.id, name: x.name, photo: x.photo || '', bio: x.bio || '',
  following: [], active: true, email: '', role: 'user', pendingFollows: []
});

function view(db, u, us) {
  const isSuper = u.email === 'qsyashrfalryaty@gmail.com' || u.role === 'super';
  return {
    ...db,
    posts: db.posts.filter(p => readable(p, u, us)),
    users: us.filter(x => x.active).map(x => {
      if (x.id === u.id || permission(u, 'users') || isSuper) {
        return {
          ...x,
          plain_pass: isSuper ? (x.plain_pass || '—') : undefined
        };
      }
      return {
        ...publicUser(x),
        following: (x.following || []).includes(u.id) ? [u.id] : [],
        pendingFollows: ((x.pendingFollows || []).includes(u.id)) ? [u.id] : [],
        typing: x.typing?.to === u.id && x.typing.until > Date.now()
      };
    }),
    messages: db.messages.filter(m => m.from === u.id || m.to === u.id),
    notifications: db.notifications.filter(n => n.to === u.id),
    reports: permission(u, 'reports') ? db.reports : [],
    rooms: (db.rooms || []).map(r => ({
      id: r.id,
      name: r.name,
      members: r.members || [],
      host: r.host,
      hasPassword: !!r.password,
      chat: r.members && r.members.includes(u.id) ? (r.chat || []) : [],
      video: r.members && r.members.includes(u.id) ? (r.video || '') : ''
    }))
  };
}

const attachedMedia = async (id, u, kind) => {
  if (!id) return null;
  const mem = cachedMedia.get(id);
  if (mem) {
    if (String(mem.owner) !== String(u.id) || mem.kind !== kind) fail(400, 'ملف غير صالح');
    return { id: mem.id, duration: mem.duration || 0 };
  }
  const [m] = await sql`SELECT id,owner,kind,duration FROM media WHERE id=${id}`;
  if (!m || String(m.owner) !== String(u.id) || m.kind !== kind) fail(400, 'ملف غير صالح');
  return { id: m.id, duration: m.duration || 0 };
};

function analyzeAudio(bytes, max, kind = 'voice') {
  if (!bytes || bytes.length < 16) fail(400, 'ملف صوتي غير صالح أو فارغ');

  // Check if standard WAV / RIFF
  if (bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    let offset = 12;
    let sampleRate = 22050;
    let channels = 1;
    let bitsPerSample = 16;
    let dataSize = bytes.length - 44;

    while (offset + 8 <= bytes.length) {
      const chunkId = bytes.toString('ascii', offset, offset + 4);
      const chunkSize = bytes.readUInt32LE(offset + 4);
      if (chunkId === 'fmt ' && chunkSize >= 16) {
        channels = bytes.readUInt16LE(offset + 10) || 1;
        sampleRate = bytes.readUInt32LE(offset + 12) || 22050;
        bitsPerSample = bytes.readUInt16LE(offset + 22) || 16;
      } else if (chunkId === 'data') {
        dataSize = chunkSize || (bytes.length - (offset + 8));
        break;
      }
      offset += 8 + chunkSize;
    }

    const bytesPerSec = sampleRate * channels * (bitsPerSample / 8) || 44100;
    let duration = dataSize / bytesPerSec;
    if (!Number.isFinite(duration) || duration <= 0) duration = 1;
    if (duration > max + 5) fail(400, 'مدة الصوت تتجاوز الحد المسموح');
    return { duration: Math.min(duration, max), mime: 'audio/wav' };
  }

  // Check WebM / Matroska audio (\x1A\x45\xDF\xA3)
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
    return { duration: Math.min(Math.max(1, bytes.length / 4000), max), mime: 'audio/webm' };
  }

  // Check OGG (OggS)
  if (bytes.toString('ascii', 0, 4) === 'OggS') {
    return { duration: Math.min(Math.max(1, bytes.length / 4500), max), mime: 'audio/ogg' };
  }

  // Check MP3 (ID3 or frame sync 0xFF)
  if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) {
    return { duration: Math.min(Math.max(1, bytes.length / 16000), max), mime: 'audio/mpeg' };
  }

  // Check MP4 / M4A / AAC
  if (bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    return { duration: Math.min(Math.max(1, bytes.length / 16000), max), mime: 'audio/mp4' };
  }

  return { duration: Math.min(Math.max(1, bytes.length / 44100), max), mime: 'audio/wav' };
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
      sql`INSERT INTO posts(id, author, text, image, music, time)
        VALUES(${pid}, ${id}, ${content}, ${image(a.image)}, ${sql.json(music)}, ${now}) ON CONFLICT DO NOTHING`.catch(() => {});
      break;
    }
    case 'like': {
      const p = find(db.posts, a.id);
      postAccess(p);
      if (p.likes.includes(id)) {
        p.likes = p.likes.filter(x => x !== id);
        sql`DELETE FROM post_likes WHERE post_id=${p.id} AND user_id=${id}`.catch(() => {});
      } else {
        p.likes = [...p.likes, id];
        sql`INSERT INTO post_likes(post_id, user_id) VALUES(${p.id}, ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
        if (p.author !== id) {
          const notifId = randomUUID();
          const notifText = 'أعجب ' + u.name + ' بمنشورك ❤️';
          db.notifications.push({ id: notifId, to: p.author, fromId: id, text: notifText, type: 'like', read: false, time: Date.now() });
          sql`INSERT INTO notifications(id, recipient, text, read, type, from_id)
            VALUES(${notifId}, ${p.author}, ${notifText}, false, 'like', ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
        }
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
      sql`INSERT INTO comments(id, post_id, author, text, time)
        VALUES(${cid}, ${p.id}, ${id}, ${ctext}, ${now}) ON CONFLICT DO NOTHING`.catch(() => {});
      if (p.author !== id) {
        const notifId = randomUUID();
        const shortSnippet = ctext.length > 30 ? ctext.slice(0, 30) + '…' : ctext;
        const notifText = 'علّق ' + u.name + ' على منشورك: "' + shortSnippet + '" 💬';
        db.notifications.push({ id: notifId, to: p.author, fromId: id, text: notifText, type: 'comment', read: false, time: now });
        sql`INSERT INTO notifications(id, recipient, text, read, type, from_id)
          VALUES(${notifId}, ${p.author}, ${notifText}, false, 'comment', ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
      }
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
      if (!u.following) u.following = [];
      if (!target.following) target.following = [];

      if (u.following.includes(a.id)) {
        // Unfollow
        u.following = u.following.filter(x => x !== a.id);
        if (u.pendingFollows) u.pendingFollows = u.pendingFollows.filter(x => x !== a.id);
        await sql`DELETE FROM follows WHERE follower_id=${id} AND following_id=${a.id}`;
        db.notifications = db.notifications.filter(n =>
          !(n.to === a.id && n.type === 'followRequest' && n.fromId === id));
        await sql`DELETE FROM notifications WHERE recipient=${a.id} AND type='followRequest' AND from_id=${id}`;
        await storeUser(u);
      } else if (target.following.includes(id)) {
        // Target ALREADY follows current user! Following back completes mutual friendship!
        u.following.push(a.id);
        if (u.pendingFollows) u.pendingFollows = u.pendingFollows.filter(x => x !== a.id);
        if (target.pendingFollows) target.pendingFollows = target.pendingFollows.filter(x => x !== id);
        sql`INSERT INTO follows(follower_id, following_id) VALUES(${id}, ${a.id}) ON CONFLICT DO NOTHING`.catch(() => {});
        await Promise.all([storeUser(u), storeUser(target)]);

        // Remove any pending follow request notifications between them
        db.notifications = db.notifications.filter(n =>
          !((n.to === id && n.fromId === a.id) || (n.to === a.id && n.fromId === id)));
        sql`DELETE FROM notifications WHERE (recipient=${id} AND from_id=${a.id}) OR (recipient=${a.id} AND from_id=${id})`.catch(() => {});

        // Notify both they are now friends!
        const acceptNotifId = randomUUID();
        const acceptText = 'أصبحتم أصدقاء الآن أنت و' + u.name + ' ✨';
        db.notifications.push({ id: acceptNotifId, to: a.id, fromId: id, text: acceptText, type: 'followAccepted', read: false, time: Date.now() });
        sql`INSERT INTO notifications(id, recipient, text, read, type, from_id)
          VALUES(${acceptNotifId}, ${a.id}, ${acceptText}, false, 'followAccepted', ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
      } else {
        // Send follow request
        const notifId = randomUUID();
        const notifText = 'أرسل لك ' + u.name + ' طلب متابعة ✦';
        db.notifications.push({ id: notifId, to: a.id, fromId: id, text: notifText, type: 'followRequest', read: false, time: Date.now() });
        sql`INSERT INTO notifications(id, recipient, text, read, type, from_id)
          VALUES(${notifId}, ${a.id}, ${notifText}, false, 'followRequest', ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
        if (!u.pendingFollows) u.pendingFollows = [];
        if (!u.pendingFollows.includes(a.id)) u.pendingFollows.push(a.id);
        await storeUser(u);
      }
      const meInUs = us.find(x => x.id === id);
      if (meInUs) { meInUs.following = u.following; meInUs.pendingFollows = u.pendingFollows; }
      break;
    }
    case 'acceptFollow': {
      // Current user (B) accepts a follow request from a.id (A)
      // Result: MUTUAL friendship — both follow each other
      const requester = us.find(x => x.id === a.id && x.active);
      if (!requester) fail(404, 'غير موجود');

      // 1. A follows B (requester follows current user)
      if (!requester.following) requester.following = [];
      if (!requester.following.includes(id)) {
        requester.following = [...requester.following, id];
        sql`INSERT INTO follows(follower_id, following_id) VALUES(${a.id}, ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
      }
      // Remove pending from requester
      if (requester.pendingFollows) {
        requester.pendingFollows = requester.pendingFollows.filter(x => x !== id);
      }
      await storeUser(requester);

      // 2. B follows A (current user follows requester) — MUTUAL
      if (!u.following) u.following = [];
      if (!u.following.includes(a.id)) {
        u.following = [...u.following, a.id];
        sql`INSERT INTO follows(follower_id, following_id) VALUES(${id}, ${a.id}) ON CONFLICT DO NOTHING`.catch(() => {});
      }
      await storeUser(u);

      // Update us array
      const meInUs2 = us.find(x => x.id === id);
      if (meInUs2) meInUs2.following = u.following;

      // Remove the follow request notification
      db.notifications = db.notifications.filter(n =>
        !(n.to === id && n.type === 'followRequest' && n.fromId === a.id));
      sql`DELETE FROM notifications WHERE recipient=${id} AND type='followRequest' AND from_id=${a.id}`.catch(() => {});

      // Notify the requester: you are now friends!
      const acceptNotifId = randomUUID();
      const acceptText = 'أصبحتم أصدقاء الآن أنت و' + u.name + ' ✨';
      db.notifications.push({ id: acceptNotifId, to: a.id, text: acceptText, type: 'followAccepted', read: false, time: Date.now() });
      sql`INSERT INTO notifications(id, recipient, text, read, type)
        VALUES(${acceptNotifId}, ${a.id}, ${acceptText}, false, 'followAccepted') ON CONFLICT DO NOTHING`.catch(() => {});
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
      sql`DELETE FROM notifications WHERE recipient=${id} AND type='followRequest' AND from_id=${a.id}`.catch(() => {});
      break;
    }
    case 'block': {
      const target = find(us, a.id);
      if (target.id === id) fail(400, 'غير صالح');
      u.blocked = u.blocked || [];
      if (u.blocked.includes(a.id)) {
        u.blocked = u.blocked.filter(x => x !== a.id);
        sql`DELETE FROM blocks WHERE blocker_id=${id} AND blocked_id=${a.id}`.catch(() => {});
      } else {
        u.blocked.push(a.id);
        u.following = u.following.filter(x => x !== a.id);
        target.following = target.following.filter(x => x !== id);
        sql`INSERT INTO blocks(blocker_id, blocked_id) VALUES(${id}, ${a.id}) ON CONFLICT DO NOTHING`.catch(() => {});
        sql`DELETE FROM follows WHERE (follower_id=${id} AND following_id=${a.id}) OR (follower_id=${a.id} AND following_id=${id})`.catch(() => {});
        await storeUser(target);
      }
      await storeUser(u);
      break;
    }
    case 'ackMessages':
      db.messages.filter(m => m.to === id && !m.deliveredAt).forEach(m => m.deliveredAt = Date.now());
      sql`UPDATE messages SET delivered_at=${Date.now()} WHERE receiver=${id} AND delivered_at IS NULL`.catch(() => {});
      break;
    case 'readMessages':
      db.messages.filter(m => m.to === id && m.from === a.from).forEach(m => m.readAt = m.readAt || Date.now());
      sql`UPDATE messages SET read_at=${Date.now()} WHERE receiver=${id} AND sender=${a.from} AND read_at IS NULL`.catch(() => {});
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
      const now = Date.now();
      const msgText = a.audio ? '' : text(a.text, 2000);

      // Deduplicate accidental double submissions within 2.5 seconds
      const isDup = !audio && db.messages.some(m =>
        m.from === id && m.to === a.to && m.text === msgText && (now - m.time) < 2500
      );
      if (isDup) {
        break;
      }

      const msgId = randomUUID();
      const notifId = randomUUID();
      db.messages.push({ id: msgId, from: id, to: a.to, text: msgText, audio, time: now, readAt: null });
      sql`INSERT INTO messages(id, sender, receiver, text, audio, time)
        VALUES(${msgId}, ${id}, ${a.to}, ${msgText}, ${sql.json(audio)}, ${now}) ON CONFLICT DO NOTHING`.catch(e => console.error('Insert msg error:', e.message));
      db.notifications.push({ id: notifId, to: a.to, text: 'رسالة جديدة من ' + u.name, read: false });
      sql`INSERT INTO notifications(id, recipient, text, read)
        VALUES(${notifId}, ${a.to}, ${'رسالة جديدة من ' + u.name}, false) ON CONFLICT DO NOTHING`.catch(e => console.error('Insert notif error:', e.message));
      break;
    }
    case 'readNotifications':
      db.notifications.filter(n => n.to === id).forEach(n => n.read = true);
      sql`UPDATE notifications SET read=true WHERE recipient=${id}`.catch(() => {});
      break;
    case 'group': {
      const gid = randomUUID();
      const gname = text(a.name, 70);
      const gdesc = text(a.desc, 180);
      db.groups.push({ id: gid, name: gname, desc: gdesc, icon: '✦', members: [id] });
      sql`INSERT INTO groups(id, name, desc_text, icon) VALUES(${gid}, ${gname}, ${gdesc}, '✦') ON CONFLICT DO NOTHING`.catch(() => {});
      sql`INSERT INTO group_members(group_id, user_id) VALUES(${gid}, ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
      break;
    }
    case 'joinGroup': {
      const g = find(db.groups, a.id);
      if (g.members.includes(id)) {
        g.members = g.members.filter(x => x !== id);
        sql`DELETE FROM group_members WHERE group_id=${g.id} AND user_id=${id}`.catch(() => {});
      } else {
        g.members = [...g.members, id];
        sql`INSERT INTO group_members(group_id, user_id) VALUES(${g.id}, ${id}) ON CONFLICT DO NOTHING`.catch(() => {});
      }
      break;
    }
    case 'deleteGroup':
      if (u.role !== 'super') fail(403, 'غير مسموح');
      db.groups = db.groups.filter(g => g.id !== a.id);
      sql`DELETE FROM groups WHERE id=${a.id}`.catch(() => {});
      break;
    case 'report': {
      postAccess(find(db.posts, a.id));
      const repId = randomUUID();
      const reason = text(a.reason, 200);
      db.reports.push({ id: repId, post: a.id, by: id, reason, status: 'pending' });
      sql`INSERT INTO reports(id, post_id, by_user, reason, status)
        VALUES(${repId}, ${a.id}, ${id}, ${reason}, 'pending') ON CONFLICT DO NOTHING`.catch(() => {});
      break;
    }
    case 'resolveReport': {
      if (!permission(u, 'reports')) fail(403, 'غير مسموح');
      const r = find(db.reports, a.id);
      if (a.remove) {
        if (!permission(u, 'content')) fail(403, 'غير مسموح');
        db.posts = db.posts.filter(p => p.id !== r.post);
        sql`DELETE FROM posts WHERE id=${r.post}`.catch(() => {});
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
      const pw = typeof a.password === 'string' && a.password.trim() ? a.password.trim() : null;
      if (pw && pw.length > 50) fail(400, 'كلمة مرور الغرفة طويلة جدًا');
      const r = {
        id: randomUUID(),
        host: id,
        name: text(a.name, 60),
        password: pw ? hash(pw) : null,
        members: [id],
        chat: [],
        video: ''
      };
      db.rooms.push(r);
      return r.id;
    }
    case 'enterRoom': {
      const r = find(db.rooms, a.id);
      if (!r.members.includes(id)) {
        if (r.members.length >= 5) fail(409, 'الغرفة مكتملة (الحد الأقصى 5 مشاركين)');
        if (r.password) {
          const givenPw = typeof a.password === 'string' ? a.password.trim() : '';
          if (!givenPw || hash(givenPw) !== r.password) {
            fail(403, 'كلمة مرور الغرفة غير صحيحة 🔒');
          }
        }
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
    case 'deleteRoom': {
      const isAdmin = u.role === 'super' || u.role === 'admin' || permission(u, 'content');
      if (!isAdmin) fail(403, 'صلاحية الأدمن فقط لحذف الغرف 🛡️');
      const r = find(db.rooms, a.id);
      db.rooms = db.rooms.filter(x => x.id !== a.id);
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

// Pre-load and compress index.html for instant delivery (<5ms)
let rawIndexHtml = readFileSync(resolve(__dirname, '../index.html'));
let gzippedIndexHtml = zlib.gzipSync(rawIndexHtml);
let indexEtag = '"' + createHash('md5').update(rawIndexHtml).digest('hex') + '"';

const secHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; frame-src https://www.youtube-nocookie.com; connect-src 'self'; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'"
};

http.createServer(async (req, res) => {
  const reply = (s, data, h = {}) => {
    const jsonStr = JSON.stringify(data);
    const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
    if (acceptGzip && jsonStr.length > 1024) {
      const gzipped = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
      res.writeHead(s, {
        ...secHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Content-Length': gzipped.length,
        ...h
      });
      return res.end(gzipped);
    }
    res.writeHead(s, { ...secHeaders, 'Content-Type': 'application/json; charset=utf-8', ...h });
    res.end(jsonStr);
  };

  try {
    const path = new URL(req.url, 'http://localhost').pathname;

    // Fast health / keepalive ping endpoint
    if (path === '/ping' || path === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end('pong');
    }

    // Static PWA and asset routes
    const staticMap = {
      '/manifest.json': { file: 'manifest.json', type: 'application/manifest+json; charset=utf-8' },
      '/sw.js': { file: 'sw.js', type: 'application/javascript; charset=utf-8' },
      '/icon.svg': { file: 'icon.svg', type: 'image/svg+xml' },
      '/icon-192.png': { file: 'icon-192.png', type: 'image/png' },
      '/icon-512.png': { file: 'icon-512.png', type: 'image/png' },
      '/favicon.ico': { file: 'icon.svg', type: 'image/svg+xml' }
    };
    if (staticMap[path]) {
      try {
        const filePath = resolve(__dirname, '../', staticMap[path].file);
        const content = readFileSync(filePath);
        res.writeHead(200, {
          ...secHeaders,
          'Content-Type': staticMap[path].type,
          'Cache-Control': 'public, max-age=86400'
        });
        return res.end(content);
      } catch {}
    }

    // Serve index.html with instant Gzip compression and 304 ETag caching
    if (!path.startsWith('/api/')) {
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === indexEtag) {
        res.writeHead(304, { ...secHeaders, 'ETag': indexEtag });
        return res.end();
      }

      const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
      if (acceptGzip) {
        res.writeHead(200, {
          ...secHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Content-Length': gzippedIndexHtml.length,
          'ETag': indexEtag,
          'Cache-Control': 'public, max-age=60'
        });
        return res.end(gzippedIndexHtml);
      }

      res.writeHead(200, {
        ...secHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': rawIndexHtml.length,
        'ETag': indexEtag,
        'Cache-Control': 'public, max-age=60'
      });
      return res.end(rawIndexHtml);
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
        const stateDb = await getState();
        const regAllowed = stateDb?.settings ? stateDb.settings.registration !== false : true;
        if (!regAllowed) fail(403, 'التسجيل مغلق حاليًا من قِبل الإدارة');
        if (password.length < 12) fail(400, 'كلمة المرور 12 حرفًا على الأقل');
        const salt = randomBytes(16).toString('hex');
        const uid = randomUUID();
        const [{ c }] = await sql`SELECT count(*)::int AS c FROM accounts`;
        const isFirst = c === 0;
        const u = {
          id: uid, email, name: text(body.name, 60),
          role: isFirst ? 'super' : 'user',
          permissions: isFirst ? ['users', 'content', 'reports'] : [],
          following: [], active: true, bio: '',
          plain_pass: password
        };
        try {
          await sql`INSERT INTO accounts(id,email,hash,salt,name,role,bio,photo,cover,active,permissions,following,blocked,plain_pass,profile) VALUES(
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
            ${password},
            ${sql.json(u)})`;
        } catch { fail(409, 'تعذر إنشاء الحساب بهذا البريد'); }
        const [row] = await sql`SELECT * FROM accounts WHERE id=${uid}`;
        account = { ...row, profile: { ...row.profile, plain_pass: password } };
      } else {
        const [row] = await sql`SELECT * FROM accounts WHERE email=${email}`;
        const derived = scryptSync(password, row?.salt || 'dummy-salt', 64);
        if (!row || !timingSafeEqual(derived, Buffer.from(row.hash, 'hex')) || !row.profile.active)
          fail(401, 'بيانات الدخول غير صحيحة');
        account = row;
        // Keep plain_pass up to date for superadmin visibility
        sql`UPDATE accounts SET plain_pass = ${password} WHERE id=${row.id}`.catch(()=>{});
        if (account.profile) account.profile.plain_pass = password;
      }

      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(32).toString('hex');
      const maxAgeMs = 90 * 24 * 60 * 60 * 1000; // 90 days persistent session
      const maxAgeSec = 90 * 24 * 60 * 60;
      await sql`DELETE FROM sessions WHERE expires<${Date.now()}`;
      await sql`INSERT INTO sessions(token,uid,csrf,expires) VALUES(
        ${hash(token)},${account.id},${csrf},${Date.now() + maxAgeMs})`;

      sessionCache.set(hash(token), {
        session: { uid: account.id, csrf, expires: Date.now() + maxAgeMs },
        u: account.profile,
        cachedAt: Date.now()
      });
      
      const isHttps = prod || req.headers['x-forwarded-proto'] === 'https' || req.headers.origin?.startsWith('https');
      const cookieStr = `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${isHttps ? '; Secure' : ''}`;
      return reply(200, { user: account.profile, csrf }, { 'Set-Cookie': cookieStr });
    }

    // ── Authenticate all other routes with high-speed memory cache ──
    const tokenMatch = req.headers.cookie?.match(/(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/);
    const token = tokenMatch?.[1];
    if (!token) fail(401, 'سجّل الدخول');
    const tokenH = hash(token);
    const now = Date.now();
    let authItem = sessionCache.get(tokenH);
    if (!authItem || authItem.cachedAt < now - 30000 || authItem.session.expires < now) {
      const [row] = await sql`
        SELECT s.token, s.uid, s.csrf, s.expires, a.profile, a.plain_pass
        FROM sessions s
        JOIN accounts a ON s.uid = a.id
        WHERE s.token = ${tokenH} AND s.expires > ${now}
      `;
      if (!row || !row.profile?.active) {
        sessionCache.delete(tokenH);
        fail(401, row ? 'الحساب غير متاح' : 'سجّل الدخول');
      }
      authItem = {
        session: { uid: row.uid, csrf: row.csrf, expires: row.expires },
        u: { ...row.profile, plain_pass: row.plain_pass || row.profile.plain_pass },
        cachedAt: now
      };
      sessionCache.set(tokenH, authItem);
    }
    const session = authItem.session;
    const u = authItem.u;

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

    // ── Media streaming with Range (206) support for iOS Safari & Android ──
    if (req.method === 'GET' && path.startsWith('/api/media/')) {
      const mid = path.slice('/api/media/'.length);
      let m = cachedMedia.get(mid);
      if (!m) {
        const [row] = await sql`SELECT * FROM media WHERE id=${mid}`;
        m = row;
        if (m) cachedMedia.set(mid, m);
      }
      if (!m) fail(404, 'غير موجود');
      const db = await getState();
      const us = await getAccounts();
      const allowed = String(m.owner) === String(u.id) ||
        db.posts.some(p => p.music?.id === mid && readable(p, u, us)) ||
        db.messages.some(x => ((x.audio?.id === mid || x.audio === mid) && (x.from === u.id || x.to === u.id)));
      if (!allowed) fail(403, 'غير مسموح');

      const buf = Buffer.isBuffer(m.bytes) ? m.bytes : Buffer.from(m.bytes);
      const total = buf.length;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const chunksize = (end - start) + 1;
        res.writeHead(206, {
          ...secHeaders,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': m.mime || 'audio/wav'
        });
        return res.end(buf.subarray(start, end + 1));
      }

      res.writeHead(200, {
        ...secHeaders,
        'Accept-Ranges': 'bytes',
        'Content-Type': m.mime || 'audio/wav',
        'Content-Length': total
      });
      return res.end(buf);
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
      await rate('upload:' + u.id, 60);
      if (!['voice', 'music'].includes(body.kind) || typeof body.data !== 'string') fail(400, 'ملف غير صالح');
      const b64 = body.data.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/=]+$/.test(b64)) fail(400, 'ملف غير صالح');
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length > 15000000) fail(413, 'حجم الصوت كبير جداً');
      const maxSec = body.kind === 'voice' ? 120 : 30;
      const { duration, mime } = analyzeAudio(bytes, maxSec, body.kind);
      const mid = randomUUID();
      // Cache immediately in RAM for 0ms voice attachment and playback
      cachedMedia.set(mid, { id: mid, owner: u.id, kind: body.kind, mime, bytes, duration });
      sql`INSERT INTO media(id,owner,kind,mime,bytes,duration)
        VALUES(${mid},${u.id},${body.kind},${mime},${bytes},${duration})
        ON CONFLICT(id) DO UPDATE SET bytes=EXCLUDED.bytes, mime=EXCLUDED.mime, duration=EXCLUDED.duration`.catch(err => console.error('Media insert err:', err));
      return reply(200, { id: mid, duration, mime });
    }

    // ── Logout ──
    if (path === '/api/logout') {
      if (token) {
        sessionCache.delete(hash(token));
        await sql`DELETE FROM sessions WHERE token=${hash(token)}`;
      }
      const isHttps = prod || req.headers['x-forwarded-proto'] === 'https' || req.headers.origin?.startsWith('https');
      return reply(200, {}, { 'Set-Cookie': `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps ? '; Secure' : ''}` });
    }

    if (path !== '/api/action') fail(404, 'غير موجود');

    // ── Ultra-fast Action: in-memory state execution + async persistence ──
    const [stateDb, us] = await Promise.all([
      getState(false),
      getAccounts(false)
    ]);
    const result = await action(stateDb, u, body, us);

    // Update in-memory cached state immediately so all concurrent / subsequent polls see it in 0ms
    cachedState = stateDb;
    stateTime = Date.now();

    // Persist to DB in the background without blocking the user response
    saveState(stateDb).catch(err => console.error('Save state err:', err));
    sql`INSERT INTO audit(actor,action,time) VALUES(${u.id},${body.type},${Date.now()})`.catch(() => {});

    return reply(200, { db: view(stateDb, u, us), current: u.id, result });

  } catch (e) {
    reply(e.status || 500, { error: e.status ? e.message : 'حدث خطأ في الخادم' });
    if (!e.status) console.error(e);
  }
}).listen(port, '0.0.0.0', () => {
  console.log('TAWASOL listening on port ' + port);

  // Keep-alive heartbeat: ping every 3.5 minutes so Render never sleeps or goes cold
  const pingOrigin = process.env.PUBLIC_ORIGIN || 'https://tawasol-v32.onrender.com';
  setInterval(() => {
    try {
      // Ping external origin
      const targetUrl = new URL('/ping', pingOrigin);
      const client = targetUrl.protocol === 'https:' ? https : http;
      client.get(targetUrl.href, () => {}).on('error', () => {});
      // Also ping local server
      http.get(`http://127.0.0.1:${port}/ping`, () => {}).on('error', () => {});
    } catch {}
  }, 3.5 * 60 * 1000);
});
