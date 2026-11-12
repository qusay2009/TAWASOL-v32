import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const envText = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

let postgres;
try {
  const mod = await import('postgres');
  postgres = mod.default || mod;
} catch {
  const postgresUrl = new URL('./server/node_modules/postgres/src/index.js', import.meta.url);
  const mod = await import(postgresUrl.href);
  postgres = mod.default || mod;
}

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL ||
  'postgresql://postgres.qdcchkjmcfhofabriokh:Qusai2009200@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

const sql = postgres(DB_URL, { ssl: 'require', max: 5, connect_timeout: 15 });

console.log('Connecting...');

// 1. Delete all data except admin account
console.log('Deleting all sessions...');
await sql`DELETE FROM sessions`;

console.log('Deleting all notifications...');
await sql`DELETE FROM notifications`;

console.log('Deleting all messages...');
await sql`DELETE FROM messages`;

console.log('Deleting all follows...');
await sql`DELETE FROM follows`;

console.log('Deleting all blocks...');
await sql`DELETE FROM blocks`;

try { await sql`DELETE FROM post_likes`; } catch {}
try { await sql`DELETE FROM comments`; } catch {}
try { await sql`DELETE FROM posts`; } catch {}
try { await sql`DELETE FROM media`; } catch {}
try { await sql`DELETE FROM groups`; } catch {}
try { await sql`DELETE FROM group_members`; } catch {}
try { await sql`DELETE FROM reports`; } catch {}
try { await sql`DELETE FROM rooms`; } catch {}
try { await sql`DELETE FROM room_members`; } catch {}
try { await sql`DELETE FROM room_messages`; } catch {}

// 2. Delete all non-admin accounts
console.log('Deleting non-admin accounts...');
await sql`DELETE FROM accounts WHERE email != 'qsyashrfalryaty@gmail.com'`;

// 3. Reset state
console.log('Resetting state...');
await sql`UPDATE state SET json=${sql.json({
  posts: [], groups: [], messages: [], reports: [],
  notifications: [], rooms: [], settings: { registration: true }
})} WHERE id=1`;

// 4. Update admin account profile to ensure it's correct
const [admin] = await sql`SELECT * FROM accounts WHERE email='qsyashrfalryaty@gmail.com'`;
if(admin) {
  const profile = {
    ...admin.profile,
    following: [],
    blocked: [],
    pendingFollows: [],
    active: true,
    role: 'super',
    permissions: ['users', 'content', 'reports']
  };
  await sql`UPDATE accounts SET 
    following=${sql.json([])},
    blocked=${sql.json([])},
    profile=${sql.json(profile)}
  WHERE email='qsyashrfalryaty@gmail.com'`;
  console.log('Admin account cleaned up:', admin.profile?.name, admin.email);
} else {
  console.log('WARNING: Admin account not found!');
}

// 5. Add new columns if needed
try { await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'general'`; console.log('type column added'); } catch(e) { console.log('type col:', e.message); }
try { await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_id TEXT`; console.log('from_id column added'); } catch(e) { console.log('from_id col:', e.message); }
try { await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pending_follows JSONB DEFAULT '[]'`; console.log('pending_follows column added'); } catch(e) { console.log('pending_follows col:', e.message); }

await sql.end();
console.log('\nDB CLEANED SUCCESSFULLY ✓');
console.log('Only admin account remains: qsyashrfalryaty@gmail.com');
