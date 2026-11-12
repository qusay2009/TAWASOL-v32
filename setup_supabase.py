import ssl
import json
import sqlite3
import pg8000.native

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

conn = pg8000.native.Connection(
    user='postgres.qdcchkjmcfhofabriokh',
    host='aws-0-ap-southeast-1.pooler.supabase.com',
    port=5432,
    database='postgres',
    password='Qusai2009200',
    ssl_context=ctx
)

statements = [
    """
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        profile JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        uid TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        csrf TEXT NOT NULL,
        expires BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS state (
        id INT PRIMARY KEY CHECK(id = 1),
        json JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
    """
    INSERT INTO state (id, json)
    VALUES (
        1,
        '{"posts":[],"groups":[],"messages":[],"reports":[],"notifications":[],"rooms":[],"settings":{"registration":true}}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
    """,
    """
    CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        kind TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes BYTEA NOT NULL,
        duration REAL NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS audit (
        id BIGSERIAL PRIMARY KEY,
        actor TEXT,
        action TEXT,
        time BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS limits (
        key TEXT PRIMARY KEY,
        count INT DEFAULT 1,
        until BIGINT NOT NULL
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);",
    "CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);",
    "CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner);"
]

for s in statements:
    conn.run(s)

print("All tables and indexes created successfully!")

# Let's also migrate accounts from local sqlite if any exist
try:
    sql_local = sqlite3.connect('data/tawasol.sqlite')
    c = sql_local.cursor()
    c.execute("SELECT id, email, hash, salt, profile FROM accounts")
    rows = c.fetchall()
    for row in rows:
        uid, email, phash, salt, profile = row
        conn.run(
            "INSERT INTO accounts (id, email, hash, salt, profile) VALUES (:id, :email, :hash, :salt, :profile::jsonb) ON CONFLICT (id) DO UPDATE SET profile = :profile::jsonb",
            id=uid, email=email, hash=phash, salt=salt, profile=profile
        )
        print(f"Migrated user {email} to Supabase!")
    sql_local.close()
except Exception as e:
    print(f"Local migration note: {e}")

# Fetch created tables
tables = conn.run("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
print("\nTables in Supabase public schema:")
for t in tables:
    print(f" - {t[0]}")

conn.close()
