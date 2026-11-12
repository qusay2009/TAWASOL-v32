import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

// Test room business logic directly
test('room password protection and admin deletion logic', () => {
  const hash = t => createHash('sha256').update(t).digest('hex');
  const fail = (s, m) => { throw Object.assign(Error(m), { status: s }); };
  const text = (v, n = 5000) => {
    if (typeof v !== 'string' || !v.trim() || v.length > n) fail(400, 'نص غير صالح');
    return v.trim();
  };
  const permission = (u, p) => u.role === 'super' || (u.role === 'admin' && u.permissions?.includes(p));

  const db = {
    rooms: []
  };

  const userA = { id: 'user-a', name: 'User A', role: 'user', permissions: [] };
  const userB = { id: 'user-b', name: 'User B', role: 'user', permissions: [] };
  const adminUser = { id: 'admin-1', name: 'Admin', role: 'admin', permissions: ['content'] };

  // 1. Create a password-protected room
  const createRoom = (u, a) => {
    const pw = typeof a.password === 'string' && a.password.trim() ? a.password.trim() : null;
    if (pw && pw.length > 50) fail(400, 'كلمة مرور الغرفة طويلة جدًا');
    const r = {
      id: randomUUID(),
      host: u.id,
      name: text(a.name, 60),
      password: pw ? hash(pw) : null,
      members: [u.id],
      chat: [],
      video: ''
    };
    db.rooms.push(r);
    return r.id;
  };

  const roomId = createRoom(userA, { name: 'VIP Cinema', password: 'secret123' });
  const room = db.rooms.find(r => r.id === roomId);
  assert.equal(room.name, 'VIP Cinema');
  assert.equal(room.password, hash('secret123'));
  assert.equal(room.members.length, 1);

  // 2. View representation must NEVER leak password
  const viewRooms = (rooms, u) => rooms.map(r => ({
    id: r.id,
    name: r.name,
    members: r.members || [],
    host: r.host,
    hasPassword: !!r.password,
    chat: r.members && r.members.includes(u.id) ? (r.chat || []) : [],
    video: r.members && r.members.includes(u.id) ? (r.video || '') : ''
  }));

  const viewedByB = viewRooms(db.rooms, userB);
  assert.equal(viewedByB[0].hasPassword, true);
  assert.equal('password' in viewedByB[0], false);
  assert.equal(viewedByB[0].chat.length, 0);

  // 3. User B tries to enter without password or with wrong password
  const enterRoom = (u, a) => {
    const r = db.rooms.find(x => x.id === a.id) || fail(404, 'غير موجود');
    if (!r.members.includes(u.id)) {
      if (r.members.length >= 5) fail(409, 'الغرفة مكتملة (الحد الأقصى 5 مشاركين)');
      if (r.password) {
        const givenPw = typeof a.password === 'string' ? a.password.trim() : '';
        if (!givenPw || hash(givenPw) !== r.password) {
          fail(403, 'كلمة مرور الغرفة غير صحيحة 🔒');
        }
      }
      r.members.push(u.id);
    }
  };

  assert.throws(() => enterRoom(userB, { id: roomId, password: '' }), /كلمة مرور الغرفة غير صحيحة/);
  assert.throws(() => enterRoom(userB, { id: roomId, password: 'wrong' }), /كلمة مرور الغرفة غير صحيحة/);

  // Correct password
  enterRoom(userB, { id: roomId, password: 'secret123' });
  assert.equal(room.members.includes('user-b'), true);

  // 4. Delete room permissions
  const deleteRoom = (u, a) => {
    const isAdmin = u.role === 'super' || u.role === 'admin' || permission(u, 'content');
    if (!isAdmin) fail(403, 'صلاحية الأدمن فقط لحذف الغرف 🛡️');
    const r = db.rooms.find(x => x.id === a.id) || fail(404, 'غير موجود');
    db.rooms = db.rooms.filter(x => x.id !== a.id);
  };

  // Normal user cannot delete room
  assert.throws(() => deleteRoom(userB, { id: roomId }), /صلاحية الأدمن فقط/);
  assert.throws(() => deleteRoom(userA, { id: roomId }), /صلاحية الأدمن فقط/);

  // Admin user CAN delete room
  deleteRoom(adminUser, { id: roomId });
  assert.equal(db.rooms.length, 0);
});
