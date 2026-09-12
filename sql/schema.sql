/* ============================================================
   BMJ VOICE AI
   DATABASE SCHEMA
   PostgreSQL
============================================================ */


/* ============================================================
   EXTENSION UUID
============================================================ */

CREATE EXTENSION IF NOT EXISTS pgcrypto;


/* ============================================================
   USERS
============================================================ */

CREATE TABLE IF NOT EXISTS users (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    nom VARCHAR(150) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    photo TEXT,

    role VARCHAR(20) NOT NULL
        DEFAULT 'user',

    plan VARCHAR(20) NOT NULL
        DEFAULT 'free',

    is_active BOOLEAN NOT NULL
        DEFAULT TRUE,

    is_blocked BOOLEAN NOT NULL
        DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    last_login_at TIMESTAMPTZ,

    CONSTRAINT users_role_check
        CHECK (
            role IN (
                'user',
                'admin'
            )
        ),

    CONSTRAINT users_plan_check
        CHECK (
            plan IN (
                'free',
                'standard',
                'premium'
            )
        )

);


/* ============================================================
   VOICES
============================================================ */

CREATE TABLE IF NOT EXISTS voices (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    external_voice_id VARCHAR(255)
        NOT NULL UNIQUE,

    name VARCHAR(255)
        NOT NULL,

    provider VARCHAR(50)
        NOT NULL
        DEFAULT 'elevenlabs',

    gender VARCHAR(50),

    language VARCHAR(50),

    language_name VARCHAR(100),

    description TEXT,

    preview_url TEXT,

    is_active BOOLEAN NOT NULL
        DEFAULT TRUE,

    is_premium BOOLEAN NOT NULL
        DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


/* ============================================================
   PROJECTS
============================================================ */

CREATE TABLE IF NOT EXISTS projects (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    title VARCHAR(255)
        NOT NULL,

    description TEXT,

    language VARCHAR(50)
        DEFAULT 'fr',

    status VARCHAR(30)
        NOT NULL
        DEFAULT 'draft',

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    CONSTRAINT projects_status_check
        CHECK (
            status IN (
                'draft',
                'processing',
                'completed',
                'failed'
            )
        )

);


/* ============================================================
   AUDIO GENERATIONS
============================================================ */

CREATE TABLE IF NOT EXISTS audio_generations (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    project_id UUID
        REFERENCES projects(id)
        ON DELETE SET NULL,

    voice_id UUID
        REFERENCES voices(id)
        ON DELETE SET NULL,

    provider VARCHAR(50)
        NOT NULL
        DEFAULT 'elevenlabs',

    model_id VARCHAR(100)
        NOT NULL,

    original_text TEXT
        NOT NULL,

    processed_text TEXT,

    language VARCHAR(50),

    voice_external_id VARCHAR(255),

    format VARCHAR(20)
        DEFAULT 'mp3',

    audio_url TEXT,

    audio_path TEXT,

    duration_seconds NUMERIC(12,3),

    character_count INTEGER
        NOT NULL
        DEFAULT 0,

    chunk_count INTEGER
        NOT NULL
        DEFAULT 1,

    status VARCHAR(30)
        NOT NULL
        DEFAULT 'processing',

    error TEXT,

    request_id VARCHAR(255),

    provider_character_count INTEGER
        DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    CONSTRAINT audio_generation_status_check
        CHECK (
            status IN (
                'processing',
                'completed',
                'failed'
            )
        )

);


/* ============================================================
   USAGE RECORDS
============================================================ */

CREATE TABLE IF NOT EXISTS usage_records (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    generation_id UUID
        REFERENCES audio_generations(id)
        ON DELETE SET NULL,

    model_id VARCHAR(100),

    characters_used INTEGER
        NOT NULL
        DEFAULT 0,

    estimated_cost_usd NUMERIC(12,6)
        DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


/* ============================================================
   USER QUOTAS
============================================================ */

CREATE TABLE IF NOT EXISTS user_quotas (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id)
        ON DELETE CASCADE,

    monthly_characters_limit BIGINT
        NOT NULL
        DEFAULT 10000,

    monthly_characters_used BIGINT
        NOT NULL
        DEFAULT 0,

    reset_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


/* ============================================================
   ADMIN ACTIVITY
============================================================ */

CREATE TABLE IF NOT EXISTS admin_activity (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    admin_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    action VARCHAR(100)
        NOT NULL,

    description TEXT,

    ip_address INET,

    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


/* ============================================================
   SYSTEM SETTINGS
============================================================ */

CREATE TABLE IF NOT EXISTS system_settings (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    setting_key VARCHAR(150)
        NOT NULL UNIQUE,

    setting_value TEXT,

    description TEXT,

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

);


/* ============================================================
   INDEX USERS
============================================================ */

CREATE INDEX IF NOT EXISTS idx_users_email
ON users(email);

CREATE INDEX IF NOT EXISTS idx_users_plan
ON users(plan);

CREATE INDEX IF NOT EXISTS idx_users_role
ON users(role);

CREATE INDEX IF NOT EXISTS idx_users_created_at
ON users(created_at DESC);


/* ============================================================
   INDEX VOICES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_voices_language
ON voices(language);

CREATE INDEX IF NOT EXISTS idx_voices_active
ON voices(is_active);

CREATE INDEX IF NOT EXISTS idx_voices_premium
ON voices(is_premium);


/* ============================================================
   INDEX PROJECTS
============================================================ */

CREATE INDEX IF NOT EXISTS idx_projects_user
ON projects(user_id);

CREATE INDEX IF NOT EXISTS idx_projects_created
ON projects(created_at DESC);


/* ============================================================
   INDEX AUDIO
============================================================ */

CREATE INDEX IF NOT EXISTS idx_audio_user
ON audio_generations(user_id);

CREATE INDEX IF NOT EXISTS idx_audio_project
ON audio_generations(project_id);

CREATE INDEX IF NOT EXISTS idx_audio_status
ON audio_generations(status);

CREATE INDEX IF NOT EXISTS idx_audio_created
ON audio_generations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audio_request
ON audio_generations(request_id);


/* ============================================================
   INDEX USAGE
============================================================ */

CREATE INDEX IF NOT EXISTS idx_usage_user
ON usage_records(user_id);

CREATE INDEX IF NOT EXISTS idx_usage_generation
ON usage_records(generation_id);

CREATE INDEX IF NOT EXISTS idx_usage_created
ON usage_records(created_at DESC);


/* ============================================================
   INDEX ADMIN ACTIVITY
============================================================ */

CREATE INDEX IF NOT EXISTS idx_admin_activity_admin
ON admin_activity(admin_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_activity_created
ON admin_activity(created_at DESC);


/* ============================================================
   DEFAULT SYSTEM SETTINGS
============================================================ */

INSERT INTO system_settings
(
    setting_key,
    setting_value,
    description
)

VALUES

(
    'app_name',
    'BMJ VOICE AI',
    'Nom de la plateforme'
),

(
    'default_language',
    'fr',
    'Langue par défaut'
),

(
    'default_model',
    'eleven_v3',
    'Modèle ElevenLabs principal'
),

(
    'fast_model',
    'eleven_flash_v2_5',
    'Modèle ElevenLabs rapide'
),

(
    'free_monthly_characters',
    '10000',
    'Quota mensuel gratuit'
),

(
    'standard_monthly_characters',
    '100000',
    'Quota mensuel Standard'
),

(
    'premium_monthly_characters',
    '1000000',
    'Quota mensuel Premium'
),

(
    'default_audio_format',
    'mp3',
    'Format audio par défaut'
)

ON CONFLICT
(
    setting_key
)

DO NOTHING;


/* ============================================================
   FIN
============================================================ */

SELECT
    'BMJ VOICE AI DATABASE READY' AS status;