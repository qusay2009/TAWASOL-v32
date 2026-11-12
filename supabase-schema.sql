-- ========================================================
-- TAWASOL (تواصل) - Supabase SQL Schema (PostgreSQL)
-- انسخ هذا الكود بالكامل والصقه في SQL Editor داخل مشروع Supabase
-- ========================================================

-- 1. جدول الحسابات (Accounts)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    profile JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. جدول الجلسات (Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    uid TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    expires BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. جدول حالة وبيانات المنصة (State: Posts, Groups, Messages, Rooms, Reports)
CREATE TABLE IF NOT EXISTS state (
    id INT PRIMARY KEY CHECK(id = 1),
    json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- تهيئة الحالة الأولية للمنصة إن لم تكن موجودة
INSERT INTO state (id, json)
VALUES (
    1,
    '{"posts":[],"groups":[],"messages":[],"reports":[],"notifications":[],"rooms":[],"settings":{"registration":true}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 4. جدول الوسائط والصوتيات (Media: Music, Voice Notes)
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes BYTEA NOT NULL,
    duration REAL NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. جدول سجل العمليات والتدقيق (Audit Log)
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT,
    action TEXT,
    time BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. جدول حدود الطلبات ومكافحة السبام (Rate Limits)
CREATE TABLE IF NOT EXISTS limits (
    key TEXT PRIMARY KEY,
    count INT DEFAULT 1,
    until BIGINT NOT NULL
);

-- فهارس لتحسين سرعة الاستعلامات (Indexes)
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner);

-- تم بحمد الله إنشاء جداول منصة تواصل على Supabase بنجاح!
