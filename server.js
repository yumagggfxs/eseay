/**
 * BMJ VOICE AI — SERVER COMPLET
 * Node.js + Express + PostgreSQL + ElevenLabs
 *
 * IMPORTANT :
 * - Ne mettez JAMAIS la clé ElevenLabs ou DATABASE_URL dans ce fichier.
 * - Configurez-les dans Render > Environment.
 * - Les fichiers audio de ce prototype sont stockés en base64 dans PostgreSQL.
 */

"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const NODE_ENV = process.env.NODE_ENV || "development";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://audio_db_n28a_user:yLIb8T9QvrQtUPymu7D5U0jkLl6xBdYc@dpg-dai8lo0ae00c73dlk1rg-a/audio_db_n28a";
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_RENDER";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "sk_5e371bcffb2b4762ea4c6247699dfe32ec06092590143a86";
const ELEVENLABS_DEFAULT_VOICE_ID =
    process.env.ELEVENLABS_DEFAULT_VOICE_ID || "ojsdYNTmnPdf7yAl8rI5";

const ELEVENLABS_MODEL =
    process.env.ELEVENLABS_MODEL || "eleven_v3";

const ELEVENLABS_FAST_MODEL =
    process.env.ELEVENLABS_FAST_MODEL || "eleven_flash_v2_5";

const DEFAULT_FORMAT =
    process.env.DEFAULT_AUDIO_FORMAT || "mp3_44100_128";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

const FREE_QUOTA = Number(process.env.FREE_QUOTA || 10000);
const STANDARD_QUOTA = Number(process.env.STANDARD_QUOTA || 100000);
const PREMIUM_QUOTA = Number(process.env.PREMIUM_QUOTA || 1000000);

const MAX_TEXT_LENGTH = Number(process.env.MAX_TEXT_LENGTH || 50000);
const CHUNK_SIZE = Number(process.env.TTS_CHUNK_SIZE || 4500);

if (!DATABASE_URL) {
    console.error("DATABASE_URL est manquante.");
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL && !DATABASE_URL.includes("localhost")
        ? { rejectUnauthorized: false }
        : false
});

pool.on("error", (err) => {
    console.error("PostgreSQL pool error:", err.message);
});

app.disable("x-powered-by");

app.use(cors({
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-admin-token"
    ]
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

function now() {
    return new Date().toISOString();
}

function uuid() {
    return crypto.randomUUID();
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function safeUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        nom: user.nom,
        email: user.email,
        photo: user.photo || "",
        role: user.role || "user",
        plan: user.plan || "free",
        is_active: user.is_active !== false,
        is_blocked: user.is_blocked === true,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at
    };
}

function quotaForPlan(plan) {
    const p = String(plan || "free").toLowerCase();

    if (p === "premium") return PREMIUM_QUOTA;
    if (p === "standard") return STANDARD_QUOTA;
    return FREE_QUOTA;
}

function monthKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function countCharacters(text) {
    return Array.from(String(text || "")).length;
}

function makeToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role || "user"
        },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
}

function getBearerToken(req) {
    const header = String(req.headers.authorization || "");

    if (header.toLowerCase().startsWith("bearer ")) {
        return header.slice(7).trim();
    }

    return "";
}

async function authenticate(req, res, next) {
    try {
        const token = getBearerToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                error: "AUTH_REQUIRED",
                message: "Authentification requise."
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        const result = await pool.query(
            `SELECT *
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [decoded.sub]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                error: "USER_NOT_FOUND",
                message: "Utilisateur introuvable."
            });
        }

        const user = result.rows[0];

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: "USER_BLOCKED",
                message: "Votre compte est bloqué."
            });
        }

        if (user.is_active === false) {
            return res.status(403).json({
                success: false,
                error: "USER_INACTIVE",
                message: "Votre compte est désactivé."
            });
        }

        req.user = user;
        req.auth = decoded;

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: "INVALID_TOKEN",
            message: "Token invalide ou expiré."
        });
    }
}

async function adminAuth(req, res, next) {
    try {
        const token =
            getBearerToken(req) ||
            String(req.headers["x-admin-token"] || "").trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                error: "ADMIN_AUTH_REQUIRED",
                message: "Authentification administrateur requise."
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.role !== "admin") {
            return res.status(403).json({
                success: false,
                error: "ADMIN_ONLY",
                message: "Accès administrateur refusé."
            });
        }

        const result = await pool.query(
            `SELECT *
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [decoded.sub]
        );

        if (!result.rows.length || result.rows[0].role !== "admin") {
            return res.status(403).json({
                success: false,
                error: "ADMIN_NOT_FOUND",
                message: "Administrateur introuvable."
            });
        }

        req.admin = result.rows[0];
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: "INVALID_ADMIN_TOKEN",
            message: "Token administrateur invalide."
        });
    }
}

async function query(text, params = []) {
    return pool.query(text, params);
}

async function ensureColumn(table, column, definition) {
    await query(
        `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS ${column} ${definition}`
    );
}

async function initDatabase() {
    await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            nom VARCHAR(160) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            photo TEXT DEFAULT '',
            role VARCHAR(20) DEFAULT 'user',
            plan VARCHAR(20) DEFAULT 'free',
            is_active BOOLEAN DEFAULT TRUE,
            is_blocked BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            last_login_at TIMESTAMPTZ
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS voices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            external_voice_id VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            provider VARCHAR(50) DEFAULT 'elevenlabs',
            gender VARCHAR(50) DEFAULT '',
            language VARCHAR(50) DEFAULT '',
            language_name VARCHAR(100) DEFAULT '',
            description TEXT DEFAULT '',
            preview_url TEXT DEFAULT '',
            is_active BOOLEAN DEFAULT TRUE,
            is_premium BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            language VARCHAR(50) DEFAULT 'fr',
            status VARCHAR(30) DEFAULT 'draft',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS audio_generations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            voice_id UUID REFERENCES voices(id) ON DELETE SET NULL,
            provider VARCHAR(50) DEFAULT 'elevenlabs',
            model_id VARCHAR(100) DEFAULT '',
            original_text TEXT NOT NULL,
            processed_text TEXT DEFAULT '',
            language VARCHAR(50) DEFAULT 'fr',
            voice_external_id VARCHAR(255) DEFAULT '',
            format VARCHAR(100) DEFAULT 'mp3_44100_128',
            audio_url TEXT DEFAULT '',
            audio_path TEXT DEFAULT '',
            audio_chunks JSONB DEFAULT '[]'::jsonb,
            duration_seconds NUMERIC DEFAULT 0,
            character_count INTEGER DEFAULT 0,
            chunk_count INTEGER DEFAULT 0,
            status VARCHAR(30) DEFAULT 'processing',
            error TEXT DEFAULT '',
            request_id VARCHAR(255) DEFAULT '',
            provider_character_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS usage_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            month_key VARCHAR(20) NOT NULL,
            characters_used INTEGER DEFAULT 0,
            generations_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, month_key)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS user_quotas (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            month_key VARCHAR(20) NOT NULL,
            quota_limit INTEGER DEFAULT 10000,
            used INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, month_key)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS admin_activity (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(120) NOT NULL,
            description TEXT DEFAULT '',
            ip_address VARCHAR(100) DEFAULT '',
            user_agent TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS system_settings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            setting_key VARCHAR(150) UNIQUE NOT NULL,
            setting_value TEXT DEFAULT '',
            description TEXT DEFAULT '',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Compatibility with older database versions.
    await ensureColumn("users", "photo", "TEXT DEFAULT ''");
    await ensureColumn("users", "role", "VARCHAR(20) DEFAULT 'user'");
    await ensureColumn("users", "plan", "VARCHAR(20) DEFAULT 'free'");
    await ensureColumn("users", "is_active", "BOOLEAN DEFAULT TRUE");
    await ensureColumn("users", "is_blocked", "BOOLEAN DEFAULT FALSE");
    await ensureColumn("users", "updated_at", "TIMESTAMPTZ DEFAULT NOW()");
    await ensureColumn("users", "last_login_at", "TIMESTAMPTZ");

    await ensureColumn("audio_generations", "audio_chunks", "JSONB DEFAULT '[]'::jsonb");
    await ensureColumn("audio_generations", "provider_character_count", "INTEGER DEFAULT 0");
    await ensureColumn("audio_generations", "request_id", "VARCHAR(255) DEFAULT ''");

    const settings = [
        ["app_name", "BMJ VOICE AI", "Nom de l'application"],
        ["default_language", "fr", "Langue par défaut"],
        ["default_model", ELEVENLABS_MODEL, "Modèle ElevenLabs principal"],
        ["fast_model", ELEVENLABS_FAST_MODEL, "Modèle ElevenLabs rapide"],
        ["free_quota", String(FREE_QUOTA), "Quota mensuel gratuit"],
        ["standard_quota", String(STANDARD_QUOTA), "Quota mensuel Standard"],
        ["premium_quota", String(PREMIUM_QUOTA), "Quota mensuel Premium"],
        ["default_audio_format", DEFAULT_FORMAT, "Format audio par défaut"]
    ];

    for (const [key, value, description] of settings) {
        await query(
            `INSERT INTO system_settings
                (setting_key, setting_value, description)
             VALUES ($1, $2, $3)
             ON CONFLICT (setting_key)
             DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                description = EXCLUDED.description,
                updated_at = NOW()`,
            [key, value, description]
        );
    }

    if (ADMIN_EMAIL && ADMIN_SECRET) {
        const admin = await query(
            `SELECT id FROM users WHERE email = $1 LIMIT 1`,
            [ADMIN_EMAIL]
        );

        if (!admin.rows.length) {
            const hash = await bcrypt.hash(ADMIN_SECRET, 12);

            await query(
                `INSERT INTO users
                    (nom, email, password_hash, role, plan)
                 VALUES ($1, $2, $3, 'admin', 'premium')`,
                ["Administrateur BMJ", ADMIN_EMAIL, hash]
            );

            console.log("Compte administrateur créé :", ADMIN_EMAIL);
        } else {
            await query(
                `UPDATE users
                 SET role = 'admin',
                     plan = 'premium',
                     updated_at = NOW()
                 WHERE email = $1`,
                [ADMIN_EMAIL]
            );
        }
    }

    console.log("Base PostgreSQL initialisée.");
}

async function elevenLabsConfigured() {
    return Boolean(ELEVENLABS_API_KEY);
}

function elevenLabsHeaders() {
    return {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
    };
}

async function elevenLabsRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...elevenLabsHeaders(),
            ...(options.headers || {})
        }
    });

    const contentType = String(
        response.headers.get("content-type") || ""
    ).toLowerCase();

    if (!response.ok) {
        let detail = "";

        try {
            if (contentType.includes("application/json")) {
                const data = await response.json();
                detail = JSON.stringify(data);
            } else {
                detail = await response.text();
            }
        } catch (_) {}

        const error = new Error(
            `ElevenLabs ${response.status}: ${detail || response.statusText}`
        );

        error.status = response.status;
        error.providerDetail = detail;

        throw error;
    }

    return response;
}

async function syncElevenLabsVoices() {
    if (!(await elevenLabsConfigured())) {
        return {
            success: false,
            configured: false,
            count: 0,
            message: "ELEVENLABS_API_KEY n'est pas configurée."
        };
    }

    const response = await elevenLabsRequest(
        "https://api.elevenlabs.io/v1/voices",
        { method: "GET" }
    );

    const data = await response.json();
    const voices = Array.isArray(data.voices) ? data.voices : [];

    let saved = 0;

    for (const voice of voices) {
        const externalId = String(voice.voice_id || "").trim();

        if (!externalId) continue;

        const labels = voice.labels || {};

        const gender =
            labels.gender ||
            labels.sex ||
            "";

        const language =
            labels.language ||
            labels.accent ||
            "";

        const languageName =
            labels.language_name ||
            labels.language ||
            "";

        const description =
            voice.description ||
            "";

        const previewUrl =
            voice.preview_url ||
            "";

        await query(
            `INSERT INTO voices
                (
                    external_voice_id,
                    name,
                    provider,
                    gender,
                    language,
                    language_name,
                    description,
                    preview_url,
                    is_active,
                    is_premium,
                    updated_at
                )
             VALUES
                ($1, $2, 'elevenlabs', $3, $4, $5, $6, $7, TRUE, FALSE, NOW())
             ON CONFLICT (external_voice_id)
             DO UPDATE SET
                name = EXCLUDED.name,
                gender = EXCLUDED.gender,
                language = EXCLUDED.language,
                language_name = EXCLUDED.language_name,
                description = EXCLUDED.description,
                preview_url = EXCLUDED.preview_url,
                updated_at = NOW()`,
            [
                externalId,
                voice.name || "Voix ElevenLabs",
                gender,
                language,
                languageName,
                description,
                previewUrl
            ]
        );

        saved++;
    }

    return {
        success: true,
        configured: true,
        count: saved,
        message: `${saved} voix synchronisées.`
    };
}

async function getActiveVoices() {
    const result = await query(
        `SELECT *
         FROM voices
         WHERE is_active = TRUE
         ORDER BY
            CASE
                WHEN external_voice_id = $1 THEN 0
                ELSE 1
            END,
            name ASC`,
        [ELEVENLABS_DEFAULT_VOICE_ID]
    );

    return result.rows;
}

async function getBestVoice(requestedVoiceId = "") {
    const requested = String(requestedVoiceId || "").trim();

    let voices = await getActiveVoices();

    if (requested) {
        const exact = voices.find(
            v =>
                v.id === requested ||
                v.external_voice_id === requested
        );

        if (exact) return exact;

        // Allow a valid ElevenLabs external voice ID even if not synced.
        if (await elevenLabsConfigured()) {
            return {
                id: null,
                external_voice_id: requested,
                name: "Voix ElevenLabs",
                is_active: true,
                is_premium: false
            };
        }
    }

    const defaultVoice = voices.find(
        v => v.external_voice_id === ELEVENLABS_DEFAULT_VOICE_ID
    );

    if (defaultVoice) return defaultVoice;

    if (!voices.length && await elevenLabsConfigured()) {
        try {
            await syncElevenLabsVoices();
            voices = await getActiveVoices();
        } catch (error) {
            console.error(
                "Synchronisation automatique des voix échouée:",
                error.message
            );
        }
    }

    const afterSyncDefault = voices.find(
        v => v.external_voice_id === ELEVENLABS_DEFAULT_VOICE_ID
    );

    if (afterSyncDefault) return afterSyncDefault;

    return voices[0] || null;
}

function splitText(text, maxLength = CHUNK_SIZE) {
    const clean = String(text || "")
        .replace(/\r\n/g, "\n")
        .trim();

    if (!clean) return [];

    if (clean.length <= maxLength) {
        return [clean];
    }

    const chunks = [];
    let remaining = clean;

    while (remaining.length > maxLength) {
        let cut = remaining.lastIndexOf("\n", maxLength);

        if (cut < Math.floor(maxLength * 0.55)) {
            cut = remaining.lastIndexOf(". ", maxLength);
        }

        if (cut < Math.floor(maxLength * 0.55)) {
            cut = remaining.lastIndexOf(" ", maxLength);
        }

        if (cut < Math.floor(maxLength * 0.55)) {
            cut = maxLength;
        }

        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }

    if (remaining) chunks.push(remaining);

    return chunks.filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);

    if (!Number.isFinite(n)) return fallback;

    return Math.max(min, Math.min(max, n));
}

function normalizeModel(model) {
    const m = String(model || "").trim();

    if (m === ELEVENLABS_FAST_MODEL) {
        return ELEVENLABS_FAST_MODEL;
    }

    return ELEVENLABS_MODEL;
}

function normalizeFormat(format) {
    const f = String(format || "").trim();

    const allowed = [
        "mp3_44100_128",
        "mp3_44100_192",
        "mp3_22050_32",
        "mp3_22050_64",
        "pcm_44100",
        "ulaw_8000"
    ];

    return allowed.includes(f) ? f : DEFAULT_FORMAT;
}

function base64Audio(buffer, mime = "audio/mpeg") {
    return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function generateElevenLabsChunk({
    text,
    voiceExternalId,
    modelId,
    language,
    format,
    speed,
    stability,
    similarityBoost,
    style
}) {
    const queryParams = new URLSearchParams();

    // ElevenLabs expects output_format as a query parameter.
    queryParams.set("output_format", format);

    const url =
        `https://api.elevenlabs.io/v1/text-to-speech/` +
        `${encodeURIComponent(voiceExternalId)}?${queryParams.toString()}`;

    const body = {
        text,
        model_id: modelId,
        language_code: language || undefined,
        voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            speed,
            use_speaker_boost: true
        }
    };

    try {
        const response = await elevenLabsRequest(url, {
            method: "POST",
            body: JSON.stringify(body)
        });

        return Buffer.from(await response.arrayBuffer());
    } catch (firstError) {
        // Some accounts/models may reject a voice setting combination.
        // Retry with a minimal valid body.
        if (firstError.status === 422 || firstError.status === 400) {
            const minimalBody = {
                text,
                model_id: modelId
            };

            const response = await elevenLabsRequest(url, {
                method: "POST",
                body: JSON.stringify(minimalBody)
            });

            return Buffer.from(await response.arrayBuffer());
        }

        throw firstError;
    }
}

async function ensureUsageRow(user) {
    const key = monthKey();
    const limit = quotaForPlan(user.plan);

    const result = await query(
        `INSERT INTO user_quotas
            (user_id, month_key, quota_limit, used)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET
            quota_limit = EXCLUDED.quota_limit,
            updated_at = NOW()
         RETURNING *`,
        [user.id, key, limit]
    );

    await query(
        `INSERT INTO usage_records
            (user_id, month_key, characters_used, generations_count)
         VALUES ($1, $2, 0, 0)
         ON CONFLICT (user_id, month_key)
         DO NOTHING`,
        [user.id, key]
    );

    return result.rows[0];
}

async function getUsage(user) {
    const key = monthKey();
    const limit = quotaForPlan(user.plan);

    const quota = await query(
        `INSERT INTO user_quotas
            (user_id, month_key, quota_limit, used)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET quota_limit = EXCLUDED.quota_limit
         RETURNING *`,
        [user.id, key, limit]
    );

    const usage = await query(
        `INSERT INTO usage_records
            (user_id, month_key, characters_used, generations_count)
         VALUES ($1, $2, 0, 0)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [user.id, key]
    );

    const q = quota.rows[0];
    const u = usage.rows[0];

    const used = Number(q.used || 0);
    const remaining = Math.max(0, Number(q.quota_limit || limit) - used);
    const percent = q.quota_limit
        ? Math.min(100, Math.round((used / q.quota_limit) * 100))
        : 0;

    return {
        month: key,
        plan: user.plan,
        used,
        quota: Number(q.quota_limit || limit),
        remaining,
        percent,
        generations: Number(u.generations_count || 0),
        characters_used: Number(u.characters_used || 0)
    };
}

async function addUsage(user, characters) {
    const key = monthKey();

    await query(
        `INSERT INTO user_quotas
            (user_id, month_key, quota_limit, used)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET
            used = user_quotas.used + EXCLUDED.used,
            quota_limit = EXCLUDED.quota_limit,
            updated_at = NOW()`,
        [user.id, key, quotaForPlan(user.plan), characters]
    );

    await query(
        `INSERT INTO usage_records
            (user_id, month_key, characters_used, generations_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET
            characters_used = usage_records.characters_used + EXCLUDED.characters_used,
            generations_count = usage_records.generations_count + 1,
            updated_at = NOW()`,
        [user.id, key, characters]
    );
}

async function logAdmin(admin, action, description, req) {
    try {
        await query(
            `INSERT INTO admin_activity
                (
                    admin_user_id,
                    action,
                    description,
                    ip_address,
                    user_agent
                )
             VALUES ($1, $2, $3, $4, $5)`,
            [
                admin.id,
                action,
                description,
                req.ip || "",
                String(req.headers["user-agent"] || "")
            ]
        );
    } catch (error) {
        console.error("Journal admin:", error.message);
    }
}

/* ============================================================
   ROOT / HEALTH
============================================================ */

app.get("/", (req, res) => {
    res.json({
        success: true,
        name: "BMJ VOICE AI",
        message: "BMJ VOICE AI API active",
        version: "1.0.0",
        environment: NODE_ENV,
        time: now()
    });
});

app.get("/api/health", async (req, res) => {
    try {
        await query("SELECT 1");

        res.json({
            success: true,
            database: true,
            elevenlabs: await elevenLabsConfigured(),
            time: now()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            database: false,
            elevenlabs: await elevenLabsConfigured(),
            error: error.message
        });
    }
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await query("SELECT NOW() AS now");

        res.json({
            success: true,
            database: true,
            now: result.rows[0].now
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            database: false,
            message: error.message
        });
    }
});

app.get("/api/elevenlabs/status", async (req, res) => {
    res.json({
        success: true,
        configured: await elevenLabsConfigured(),
        default_voice: ELEVENLABS_DEFAULT_VOICE_ID,
        model: ELEVENLABS_MODEL,
        fast_model: ELEVENLABS_FAST_MODEL,
        format: DEFAULT_FORMAT
    });
});

/* ============================================================
   AUTH
============================================================ */

app.post("/api/auth/register", async (req, res) => {
    try {
        const nom = String(req.body.nom || "").trim();
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

        if (nom.length < 2) {
            return res.status(400).json({
                success: false,
                message: "Le nom est obligatoire."
            });
        }

        if (!email || !email.includes("@")) {
            return res.status(400).json({
                success: false,
                message: "Adresse email invalide."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Le mot de passe doit contenir au moins 6 caractères."
            });
        }

        const exists = await query(
            `SELECT id FROM users WHERE email = $1 LIMIT 1`,
            [email]
        );

        if (exists.rows.length) {
            return res.status(409).json({
                success: false,
                message: "Cet email est déjà utilisé."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await query(
            `INSERT INTO users
                (nom, email, password_hash, role, plan)
             VALUES ($1, $2, $3, 'user', 'free')
             RETURNING *`,
            [nom, email, passwordHash]
        );

        const user = result.rows[0];
        const token = makeToken(user);

        await ensureUsageRow(user);

        res.status(201).json({
            success: true,
            message: "Compte créé avec succès.",
            token,
            user: safeUser(user)
        });
    } catch (error) {
        console.error("REGISTER:", error);
        res.status(500).json({
            success: false,
            message: "Impossible de créer le compte."
        });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email et mot de passe requis."
            });
        }

        const result = await query(
            `SELECT * FROM users WHERE email = $1 LIMIT 1`,
            [email]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                message: "Email ou mot de passe incorrect."
            });
        }

        const user = result.rows[0];

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                message: "Votre compte est bloqué."
            });
        }

        if (user.is_active === false) {
            return res.status(403).json({
                success: false,
                message: "Votre compte est désactivé."
            });
        }

        const valid = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Email ou mot de passe incorrect."
            });
        }

        await query(
            `UPDATE users
             SET last_login_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [user.id]
        );

        const fresh = {
            ...user,
            last_login_at: new Date()
        };

        const token = makeToken(fresh);

        await ensureUsageRow(fresh);

        res.json({
            success: true,
            message: "Connexion réussie.",
            token,
            access_token: token,
            user: safeUser(fresh)
        });
    } catch (error) {
        console.error("LOGIN:", error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur pendant la connexion."
        });
    }
});

app.get("/api/auth/me", authenticate, async (req, res) => {
    try {
        const result = await query(
            `SELECT * FROM users WHERE id = $1 LIMIT 1`,
            [req.user.id]
        );

        res.json({
            success: true,
            user: safeUser(result.rows[0])
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de récupérer le profil."
        });
    }
});

app.patch("/api/auth/profile", authenticate, async (req, res) => {
    try {
        const nom =
            req.body.nom === undefined
                ? req.user.nom
                : String(req.body.nom || "").trim();

        const photo =
            req.body.photo === undefined
                ? req.user.photo || ""
                : String(req.body.photo || "").trim();

        if (nom.length < 2) {
            return res.status(400).json({
                success: false,
                message: "Le nom est invalide."
            });
        }

        const result = await query(
            `UPDATE users
             SET nom = $1,
                 photo = $2,
                 updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [nom, photo, req.user.id]
        );

        res.json({
            success: true,
            message: "Profil mis à jour.",
            user: safeUser(result.rows[0])
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de modifier le profil."
        });
    }
});

app.patch("/api/auth/password", authenticate, async (req, res) => {
    try {
        const currentPassword =
            String(req.body.current_password || "");

        const newPassword =
            String(req.body.new_password || "");

        if (!currentPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Mot de passe actuel et nouveau mot de passe requis."
            });
        }

        const valid = await bcrypt.compare(
            currentPassword,
            req.user.password_hash
        );

        if (!valid) {
            return res.status(400).json({
                success: false,
                message: "Mot de passe actuel incorrect."
            });
        }

        const hash = await bcrypt.hash(newPassword, 12);

        await query(
            `UPDATE users
             SET password_hash = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [hash, req.user.id]
        );

        res.json({
            success: true,
            message: "Mot de passe modifié."
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de modifier le mot de passe."
        });
    }
});

/* ============================================================
   VOICES
============================================================ */

app.get("/api/voices", async (req, res) => {
    try {
        let voices = await getActiveVoices();

        // Critical fix:
        // a fresh PostgreSQL database may contain zero voices.
        // Synchronize ElevenLabs automatically instead of returning
        // an empty list to the dashboard.
        if (!voices.length && await elevenLabsConfigured()) {
            try {
                await syncElevenLabsVoices();
                voices = await getActiveVoices();
            } catch (syncError) {
                console.error(
                    "Auto-sync voices:",
                    syncError.message
                );
            }
        }

        res.json({
            success: true,
            voices,
            count: voices.length,
            default_voice: ELEVENLABS_DEFAULT_VOICE_ID
        });
    } catch (error) {
        console.error("GET /api/voices:", error);

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les voix.",
            voices: [],
            default_voice: ELEVENLABS_DEFAULT_VOICE_ID
        });
    }
});

app.post("/api/voices/sync", adminAuth, async (req, res) => {
    try {
        const result = await syncElevenLabsVoices();

        await logAdmin(
            req.admin,
            "SYNC_VOICES",
            result.message,
            req
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Synchronisation des voix échouée.",
            error: error.message
        });
    }
});

app.post("/api/admin/voices/sync", adminAuth, async (req, res) => {
    try {
        const result = await syncElevenLabsVoices();

        await logAdmin(
            req.admin,
            "SYNC_VOICES",
            result.message,
            req
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Synchronisation des voix échouée.",
            error: error.message
        });
    }
});

app.get("/api/voices/test", async (req, res) => {
    try {
        const configured = await elevenLabsConfigured();
        const dbVoices = await getActiveVoices();

        res.json({
            success: true,
            configured,
            default_voice: ELEVENLABS_DEFAULT_VOICE_ID,
            database_voice_count: dbVoices.length,
            database_voices: dbVoices.slice(0, 20).map(v => ({
                id: v.id,
                external_voice_id: v.external_voice_id,
                name: v.name,
                is_active: v.is_active
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/* ============================================================
   PROJECTS
============================================================ */

app.get("/api/projects", authenticate, async (req, res) => {
    try {
        const result = await query(
            `SELECT *
             FROM projects
             WHERE user_id = $1
             ORDER BY updated_at DESC, created_at DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            projects: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            projects: [],
            message: "Impossible de récupérer les projets."
        });
    }
});

app.post("/api/projects", authenticate, async (req, res) => {
    try {
        const title =
            String(req.body.title || "Nouveau projet").trim();

        const description =
            String(req.body.description || "").trim();

        const language =
            String(req.body.language || "fr").trim();

        if (!title) {
            return res.status(400).json({
                success: false,
                message: "Le titre du projet est requis."
            });
        }

        const result = await query(
            `INSERT INTO projects
                (user_id, title, description, language)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [req.user.id, title, description, language]
        );

        res.status(201).json({
            success: true,
            project: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de créer le projet."
        });
    }
});

app.patch("/api/projects/:id", authenticate, async (req, res) => {
    try {
        const result = await query(
            `UPDATE projects
             SET title = COALESCE($1, title),
                 description = COALESCE($2, description),
                 language = COALESCE($3, language),
                 status = COALESCE($4, status),
                 updated_at = NOW()
             WHERE id = $5
               AND user_id = $6
             RETURNING *`,
            [
                req.body.title !== undefined ? String(req.body.title) : null,
                req.body.description !== undefined ? String(req.body.description) : null,
                req.body.language !== undefined ? String(req.body.language) : null,
                req.body.status !== undefined ? String(req.body.status) : null,
                req.params.id,
                req.user.id
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Projet introuvable."
            });
        }

        res.json({
            success: true,
            project: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de modifier le projet."
        });
    }
});

app.delete("/api/projects/:id", authenticate, async (req, res) => {
    try {
        const result = await query(
            `DELETE FROM projects
             WHERE id = $1
               AND user_id = $2
             RETURNING id`,
            [req.params.id, req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Projet introuvable."
            });
        }

        res.json({
            success: true,
            message: "Projet supprimé."
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de supprimer le projet."
        });
    }
});

/* ============================================================
   USAGE
============================================================ */

app.get("/api/usage", authenticate, async (req, res) => {
    try {
        const usage = await getUsage(req.user);

        res.json({
            success: true,
            usage
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de récupérer l'utilisation."
        });
    }
});

/* ============================================================
   TTS GENERATION
============================================================ */

app.post("/api/tts/generate", authenticate, async (req, res) => {
    const generationId = uuid();

    try {
        if (!(await elevenLabsConfigured())) {
            return res.status(503).json({
                success: false,
                error: "ELEVENLABS_NOT_CONFIGURED",
                message: "ElevenLabs n'est pas configuré sur le serveur."
            });
        }

        const text =
            String(req.body.text || "").trim();

        const language =
            String(req.body.language || "fr")
                .trim()
                .toLowerCase();

        const requestedVoice =
            String(
                req.body.voice_id ||
                req.body.voiceId ||
                ""
            ).trim();

        const modelId =
            normalizeModel(
                req.body.model_id ||
                req.body.model ||
                ELEVENLABS_MODEL
            );

        const format =
            normalizeFormat(
                req.body.format ||
                DEFAULT_FORMAT
            );

        const speed =
            clampNumber(
                req.body.speed,
                0.7,
                1.2,
                1
            );

        const stability =
            clampNumber(
                req.body.stability,
                0,
                1,
                0.5
            );

        const similarityBoost =
            clampNumber(
                req.body.similarity_boost ??
                req.body.similarity,
                0,
                1,
                0.75
            );

        const style =
            clampNumber(
                req.body.style,
                0,
                1,
                0
            );

        const projectId =
            String(req.body.project_id || "").trim() || null;

        if (!text) {
            return res.status(400).json({
                success: false,
                error: "TEXT_REQUIRED",
                message: "Le texte à convertir est obligatoire."
            });
        }

        if (text.length > MAX_TEXT_LENGTH) {
            return res.status(400).json({
                success: false,
                error: "TEXT_TOO_LONG",
                message:
                    `Le texte ne peut pas dépasser ${MAX_TEXT_LENGTH} caractères.`
            });
        }

        const characterCount = countCharacters(text);

        const usage = await getUsage(req.user);

        if (characterCount > usage.remaining) {
            return res.status(429).json({
                success: false,
                error: "QUOTA_EXCEEDED",
                message:
                    `Quota insuffisant. Il vous reste ${usage.remaining} caractères.`,
                usage
            });
        }

        const voice = await getBestVoice(requestedVoice);

        // Critical fix:
        // Never continue with an empty voice_id.
        if (!voice || !voice.external_voice_id) {
            return res.status(503).json({
                success: false,
                error: "VOICE_MISSING",
                message:
                    "Aucune voix ElevenLabs disponible. Vérifiez ELEVENLABS_API_KEY puis synchronisez les voix.",
                default_voice: ELEVENLABS_DEFAULT_VOICE_ID
            });
        }

        if (projectId) {
            const project = await query(
                `SELECT id
                 FROM projects
                 WHERE id = $1
                   AND user_id = $2
                 LIMIT 1`,
                [projectId, req.user.id]
            );

            if (!project.rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Projet introuvable."
                });
            }
        }

        await query(
            `INSERT INTO audio_generations
                (
                    id,
                    user_id,
                    project_id,
                    voice_id,
                    provider,
                    model_id,
                    original_text,
                    processed_text,
                    language,
                    voice_external_id,
                    format,
                    status,
                    character_count,
                    chunk_count
                )
             VALUES
                ($1, $2, $3, $4, 'elevenlabs', $5, $6, $6, $7, $8, $9,
                 'processing', $10, 0)`,
            [
                generationId,
                req.user.id,
                projectId,
                voice.id,
                modelId,
                text,
                language,
                voice.external_voice_id,
                format,
                characterCount
            ]
        );

        const chunks = splitText(text);

        const audioChunks = [];

        for (let i = 0; i < chunks.length; i++) {
            const audioBuffer =
                await generateElevenLabsChunk({
                    text: chunks[i],
                    voiceExternalId: voice.external_voice_id,
                    modelId,
                    language,
                    format,
                    speed,
                    stability,
                    similarityBoost,
                    style
                });

            audioChunks.push({
                index: i + 1,
                characters: countCharacters(chunks[i]),
                audio_url: base64Audio(audioBuffer),
                mime_type: "audio/mpeg"
            });
        }

        const firstAudio =
            audioChunks.length
                ? audioChunks[0].audio_url
                : "";

        await query(
            `UPDATE audio_generations
             SET audio_url = $1,
                 audio_chunks = $2::jsonb,
                 chunk_count = $3,
                 status = 'completed',
                 provider_character_count = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [
                firstAudio,
                JSON.stringify(audioChunks),
                audioChunks.length,
                characterCount,
                generationId
            ]
        );

        await addUsage(req.user, characterCount);

        if (projectId) {
            await query(
                `UPDATE projects
                 SET status = 'completed',
                     updated_at = NOW()
                 WHERE id = $1`,
                [projectId]
            );
        }

        const saved = await query(
            `SELECT
                ag.*,
                v.name AS voice_name,
                v.external_voice_id AS voice_external_id_db
             FROM audio_generations ag
             LEFT JOIN voices v ON v.id = ag.voice_id
             WHERE ag.id = $1
             LIMIT 1`,
            [generationId]
        );

        const generation = saved.rows[0];

        res.status(201).json({
            success: true,
            message: "Audio généré avec succès.",
            id: generationId,
            generation,
            audio_url: firstAudio,
            audio_chunks: audioChunks,
            voice: {
                id: voice.id,
                external_voice_id: voice.external_voice_id,
                name: voice.name
            },
            usage: await getUsage(req.user)
        });
    } catch (error) {
        console.error("TTS GENERATE:", error);

        await query(
            `UPDATE audio_generations
             SET status = 'failed',
                 error = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [error.message || "Erreur inconnue", generationId]
        ).catch(() => {});

        if (error.status === 401 || error.status === 403) {
            return res.status(502).json({
                success: false,
                error: "ELEVENLABS_AUTH_ERROR",
                message:
                    "La clé ElevenLabs est refusée par ElevenLabs. Vérifiez la clé dans Render."
            });
        }

        if (error.status === 422) {
            return res.status(502).json({
                success: false,
                error: "ELEVENLABS_VALIDATION_ERROR",
                message:
                    "ElevenLabs a refusé les paramètres de génération.",
                detail: error.providerDetail || error.message
            });
        }

        res.status(500).json({
            success: false,
            error: "TTS_ERROR",
            message: "Impossible de générer l'audio.",
            detail:
                NODE_ENV === "development"
                    ? error.message
                    : undefined
        });
    }
});

/* ============================================================
   AUDIO / HISTORY
============================================================ */

app.get("/api/audio", authenticate, async (req, res) => {
    try {
        const limit = Math.min(
            Math.max(Number(req.query.limit || 50), 1),
            100
        );

        const result = await query(
            `SELECT
                ag.id,
                ag.project_id,
                ag.voice_id,
                ag.provider,
                ag.model_id,
                ag.original_text,
                ag.processed_text,
                ag.language,
                ag.voice_external_id,
                ag.format,
                ag.audio_url,
                ag.audio_chunks,
                ag.duration_seconds,
                ag.character_count,
                ag.chunk_count,
                ag.status,
                ag.error,
                ag.created_at,
                ag.updated_at,
                v.name AS voice_name,
                p.title AS project_title
             FROM audio_generations ag
             LEFT JOIN voices v ON v.id = ag.voice_id
             LEFT JOIN projects p ON p.id = ag.project_id
             WHERE ag.user_id = $1
             ORDER BY ag.created_at DESC
             LIMIT $2`,
            [req.user.id, limit]
        );

        res.json({
            success: true,
            generations: result.rows,
            audio: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            generations: [],
            audio: [],
            message: "Impossible de récupérer l'historique."
        });
    }
});

app.get("/api/tts/generations", authenticate, async (req, res) => {
    try {
        const result = await query(
            `SELECT
                ag.*,
                v.name AS voice_name,
                p.title AS project_title
             FROM audio_generations ag
             LEFT JOIN voices v ON v.id = ag.voice_id
             LEFT JOIN projects p ON p.id = ag.project_id
             WHERE ag.user_id = $1
             ORDER BY ag.created_at DESC
             LIMIT 100`,
            [req.user.id]
        );

        res.json({
            success: true,
            generations: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            generations: [],
            message: "Impossible de récupérer les générations."
        });
    }
});

app.get("/api/audio/:id", authenticate, async (req, res) => {
    try {
        const result = await query(
            `SELECT
                ag.*,
                v.name AS voice_name,
                p.title AS project_title
             FROM audio_generations ag
             LEFT JOIN voices v ON v.id = ag.voice_id
             LEFT JOIN projects p ON p.id = ag.project_id
             WHERE ag.id = $1
               AND ag.user_id = $2
             LIMIT 1`,
            [req.params.id, req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio introuvable."
            });
        }

        res.json({
            success: true,
            generation: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de récupérer cet audio."
        });
    }
});

app.delete("/api/audio/:id", authenticate, async (req, res) => {
    try {
        const result = await query(
            `DELETE FROM audio_generations
             WHERE id = $1
               AND user_id = $2
             RETURNING id`,
            [req.params.id, req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Audio introuvable."
            });
        }

        res.json({
            success: true,
            message: "Génération supprimée."
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de supprimer la génération."
        });
    }
});

/* ============================================================
   SETTINGS
============================================================ */

app.get("/api/settings", async (req, res) => {
    try {
        const result = await query(
            `SELECT setting_key, setting_value, description
             FROM system_settings
             ORDER BY setting_key`
        );

        const settings = {};

        for (const row of result.rows) {
            settings[row.setting_key] = row.setting_value;
        }

        res.json({
            success: true,
            settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            settings: {},
            message: "Impossible de récupérer les paramètres."
        });
    }
});

/* ============================================================
   ADMIN LOGIN
============================================================ */

app.post("/api/admin/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

        const result = await query(
            `SELECT *
             FROM users
             WHERE email = $1
             LIMIT 1`,
            [email]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                message: "Identifiants administrateur incorrects."
            });
        }

        const admin = result.rows[0];

        if (admin.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Ce compte n'est pas administrateur."
            });
        }

        const valid = await bcrypt.compare(
            password,
            admin.password_hash
        );

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Identifiants administrateur incorrects."
            });
        }

        const token = makeToken(admin);

        await logAdmin(
            admin,
            "ADMIN_LOGIN",
            "Connexion administrateur",
            req
        );

        res.json({
            success: true,
            message: "Connexion administrateur réussie.",
            token,
            access_token: token,
            user: safeUser(admin)
        });
    } catch (error) {
        console.error("ADMIN LOGIN:", error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur."
        });
    }
});

/* ============================================================
   ADMIN STATISTICS
============================================================ */

app.get("/api/admin/statistiques", adminAuth, async (req, res) => {
    try {
        const [
            users,
            generations,
            projects,
            characters,
            voices
        ] = await Promise.all([
            query(`SELECT COUNT(*)::int AS count FROM users WHERE role <> 'admin'`),
            query(`SELECT COUNT(*)::int AS count FROM audio_generations`),
            query(`SELECT COUNT(*)::int AS count FROM projects`),
            query(`SELECT COALESCE(SUM(character_count), 0)::bigint AS total FROM audio_generations WHERE status = 'completed'`),
            query(`SELECT COUNT(*)::int AS count FROM voices WHERE is_active = TRUE`)
        ]);

        res.json({
            success: true,
            statistiques: {
                users: users.rows[0].count,
                utilisateurs: users.rows[0].count,
                generations: generations.rows[0].count,
                projets: projects.rows[0].count,
                characters: Number(characters.rows[0].total),
                voix: voices.rows[0].count
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les statistiques."
        });
    }
});

app.get("/api/admin/users", adminAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT
                id,
                nom,
                email,
                photo,
                role,
                plan,
                is_active,
                is_blocked,
                created_at,
                updated_at,
                last_login_at
             FROM users
             ORDER BY created_at DESC`
        );

        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            users: [],
            message: "Impossible de récupérer les utilisateurs."
        });
    }
});

app.patch("/api/admin/users/:id/block", adminAuth, async (req, res) => {
    try {
        const blocked =
            req.body.blocked === undefined
                ? true
                : Boolean(req.body.blocked);

        const result = await query(
            `UPDATE users
             SET is_blocked = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND role <> 'admin'
             RETURNING id, nom, email, is_blocked`,
            [blocked, req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable."
            });
        }

        await logAdmin(
            req.admin,
            blocked ? "BLOCK_USER" : "UNBLOCK_USER",
            `${blocked ? "Blocage" : "Déblocage"} de ${result.rows[0].email}`,
            req
        );

        res.json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de modifier le blocage."
        });
    }
});

app.patch("/api/admin/users/:id/plan", adminAuth, async (req, res) => {
    try {
        const plan = String(req.body.plan || "").toLowerCase();

        if (!["free", "standard", "premium"].includes(plan)) {
            return res.status(400).json({
                success: false,
                message: "Plan invalide."
            });
        }

        const result = await query(
            `UPDATE users
             SET plan = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND role <> 'admin'
             RETURNING id, nom, email, plan`,
            [plan, req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable."
            });
        }

        await logAdmin(
            req.admin,
            "CHANGE_PLAN",
            `${result.rows[0].email} -> ${plan}`,
            req
        );

        res.json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de modifier le plan."
        });
    }
});

app.get("/api/admin/generations", adminAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT
                ag.id,
                ag.user_id,
                ag.model_id,
                ag.language,
                ag.voice_external_id,
                ag.character_count,
                ag.chunk_count,
                ag.status,
                ag.created_at,
                u.nom AS user_name,
                u.email AS user_email,
                v.name AS voice_name
             FROM audio_generations ag
             JOIN users u ON u.id = ag.user_id
             LEFT JOIN voices v ON v.id = ag.voice_id
             ORDER BY ag.created_at DESC
             LIMIT 200`
        );

        res.json({
            success: true,
            generations: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            generations: [],
            message: "Impossible de récupérer les générations."
        });
    }
});

app.get("/api/admin/activities", adminAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT
                aa.*,
                u.nom AS admin_name,
                u.email AS admin_email
             FROM admin_activity aa
             LEFT JOIN users u ON u.id = aa.admin_user_id
             ORDER BY aa.created_at DESC
             LIMIT 200`
        );

        res.json({
            success: true,
            activities: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            activities: [],
            message: "Impossible de récupérer les activités."
        });
    }
});

app.get("/api/admin/voices", adminAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT *
             FROM voices
             ORDER BY name ASC`
        );

        res.json({
            success: true,
            voices: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            voices: [],
            message: "Impossible de récupérer les voix."
        });
    }
});

app.patch("/api/admin/voices/:id", adminAuth, async (req, res) => {
    try {
        const isActive =
            req.body.is_active === undefined
                ? undefined
                : Boolean(req.body.is_active);

        const isPremium =
            req.body.is_premium === undefined
                ? undefined
                : Boolean(req.body.is_premium);

        const result = await query(
            `UPDATE voices
             SET is_active = COALESCE($1, is_active),
                 is_premium = COALESCE($2, is_premium),
                 updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [isActive, isPremium, req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Voix introuvable."
            });
        }

        await logAdmin(
            req.admin,
            "UPDATE_VOICE",
            `Modification de la voix ${result.rows[0].name}`,
            req
        );

        res.json({
            success: true,
            voice: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Impossible de modifier la voix."
        });
    }
});

/* ============================================================
   404 + ERROR HANDLER
============================================================ */

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: `Route introuvable: ${req.method} ${req.originalUrl}`
    });
});

app.use((error, req, res, next) => {
    console.error("EXPRESS ERROR:", error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        message: "Erreur interne du serveur."
    });
});

/* ============================================================
   START SERVER
============================================================ */

let server;

async function startServer() {
    try {
        await query("SELECT 1");
        console.log("PostgreSQL connecté.");

        await initDatabase();

        // Automatic voice synchronization.
        // This is intentionally NOT protected by admin auth because a new
        // installation otherwise starts with zero voices.
        if (await elevenLabsConfigured()) {
            try {
                const existing = await getActiveVoices();

                if (!existing.length) {
                    const result = await syncElevenLabsVoices();
                    console.log(result.message);
                } else {
                    console.log(
                        `Voix disponibles en base: ${existing.length}`
                    );
                }
            } catch (error) {
                console.error(
                    "Synchronisation initiale des voix:",
                    error.message
                );
            }
        } else {
            console.warn(
                "ELEVENLABS_API_KEY non configurée. Les voix ne pourront pas être générées."
            );
        }

        server = app.listen(PORT, "0.0.0.0", () => {
            console.log("==============================================");
            console.log("BMJ VOICE AI");
            console.log(`PORT: ${PORT}`);
            console.log(`ENV: ${NODE_ENV}`);
            console.log(`MODEL: ${ELEVENLABS_MODEL}`);
            console.log(`FAST MODEL: ${ELEVENLABS_FAST_MODEL}`);
            console.log(`DEFAULT VOICE: ${ELEVENLABS_DEFAULT_VOICE_ID}`);
            console.log(`ELEVENLABS: ${ELEVENLABS_API_KEY ? "OK" : "MISSING"}`);
            console.log("==============================================");
        });
    } catch (error) {
        console.error("Impossible de démarrer le serveur:", error);
        process.exit(1);
    }
}

async function shutdown(signal) {
    console.log(`${signal} reçu. Arrêt du serveur...`);

    try {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }

        await pool.end();

        console.log("Serveur arrêté proprement.");
        process.exit(0);
    } catch (error) {
        console.error("Erreur arrêt:", error);
        process.exit(1);
    }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer();

module.exports = app;
