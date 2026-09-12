"use strict";

/* ============================================================
   BMJ VOICE AI
   BACKEND COMPLET
   Node.js + Express + PostgreSQL + ElevenLabs
============================================================ */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");


/* ============================================================
   CONFIGURATION
============================================================ */

const app = express();

const PORT =
    Number(process.env.PORT) || 10000;

const NODE_ENV =
    process.env.NODE_ENV || "production";

const API_VERSION =
    "1.0.0";


/* ============================================================
   VARIABLES D'ENVIRONNEMENT
============================================================ */

const DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://audio_db_n28a_user:yLIb8T9QvrQtUPymu7D5U0jkLl6xBdYc@dpg-dai8lo0ae00c73dlk1rg-a/audio_db_n28a";

const ELEVENLABS_API_KEY =
    process.env.ELEVENLABS_API_KEY || "sk_5e371bcffb2b4762ea4c6247699dfe32ec06092590143a86";

const ELEVENLABS_DEFAULT_VOICE_ID =
    process.env.ELEVENLABS_DEFAULT_VOICE_ID || "mQS95w8LbLFsF6QihxDH";

const ELEVENLABS_MODEL_ID =
    process.env.ELEVENLABS_MODEL_ID ||
    "eleven_v3";

const ELEVENLABS_FAST_MODEL_ID =
    process.env.ELEVENLABS_FAST_MODEL_ID ||
    "eleven_flash_v2_5";

const JWT_SECRET =
    process.env.JWT_SECRET ||
    "BMJ_VOICE_AI_CHANGE_THIS_SECRET";

const ADMIN_EMAIL =
    process.env.ADMIN_EMAIL ||
    "admin@bmjvoiceai.com";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD ||
    "CHANGE_ADMIN_PASSWORD";

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "*";

const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    "https://eseay.onrender.com";


/* ============================================================
   QUOTAS
============================================================ */

const FREE_QUOTA =
    Number(process.env.FREE_MONTHLY_CHARACTERS) ||
    10000;

const STANDARD_QUOTA =
    Number(process.env.STANDARD_MONTHLY_CHARACTERS) ||
    100000;

const PREMIUM_QUOTA =
    Number(process.env.PREMIUM_MONTHLY_CHARACTERS) ||
    1000000;


/* ============================================================
   LIMITES
============================================================ */

const MAX_TEXT_LENGTH =
    50000;

const MAX_PROJECT_TITLE =
    150;

const MAX_PROJECT_DESCRIPTION =
    2000;


/* ============================================================
   POSTGRESQL
============================================================ */

if (!DATABASE_URL) {

    console.warn(
        "⚠️ DATABASE_URL n'est pas configurée."
    );
}

const pool =
    new Pool({
        connectionString:
            DATABASE_URL,

        ssl:
            NODE_ENV === "production"
                ? {
                    rejectUnauthorized:
                        false
                }
                : false,

        max: 10,

        idleTimeoutMillis:
            30000,

        connectionTimeoutMillis:
            10000
    });


/* ============================================================
   ELEVENLABS
============================================================ */

function elevenLabsConfigured() {

    return Boolean(
        ELEVENLABS_API_KEY &&
        ELEVENLABS_API_KEY.startsWith("sk_")
    );
}


/* ============================================================
   MIDDLEWARE
============================================================ */

app.use(
    cors({
        origin:
            FRONTEND_URL === "*"
                ? true
                : FRONTEND_URL,

        credentials: true
    })
);

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "10mb"
    })
);


/* ============================================================
   OUTILS
============================================================ */

function cleanString(
    value,
    max = 10000
) {

    return String(
        value ?? ""
    )
        .trim()
        .slice(0, max);
}


function normalizeEmail(
    email
) {

    return String(
        email || ""
    )
        .trim()
        .toLowerCase();
}


function generateRequestId() {

    return crypto
        .randomUUID();
}


function getClientIp(req) {

    return (
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        ""
    )
        .toString()
        .split(",")[0]
        .trim();
}


function getQuotaLimit(plan) {

    switch (plan) {

        case "premium":
            return PREMIUM_QUOTA;

        case "standard":
            return STANDARD_QUOTA;

        default:
            return FREE_QUOTA;
    }
}


function getResetDate() {

    const date =
        new Date();

    date.setUTCMonth(
        date.getUTCMonth() + 1
    );

    date.setUTCDate(1);

    date.setUTCHours(
        0,
        0,
        0,
        0
    );

    return date;
}


function hashForLog(value) {

    if (!value) {
        return "";
    }

    return crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex")
        .slice(0, 16);
}


/* ============================================================
   JWT
============================================================ */

function createToken(user) {

    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role || "user"
        },

        JWT_SECRET,

        {
            expiresIn: "30d"
        }
    );
}


/* ============================================================
   AUTHENTIFICATION UTILISATEUR
============================================================ */

async function authenticate(
    req,
    res,
    next
) {

    try {

        const header =
            req.headers.authorization || "";

        if (
            !header.startsWith("Bearer ")
        ) {

            return res.status(401).json({
                success: false,
                message:
                    "Authentification requise."
            });
        }

        const token =
            header.substring(7).trim();

        if (!token) {

            return res.status(401).json({
                success: false,
                message:
                    "Token manquant."
            });
        }

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        const result =
            await pool.query(
                `
                SELECT
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
                WHERE id = $1
                LIMIT 1
                `,
                [decoded.id]
            );

        if (
            result.rows.length === 0
        ) {

            return res.status(401).json({
                success: false,
                message:
                    "Utilisateur introuvable."
            });
        }

        const user =
            result.rows[0];

        if (
            user.is_blocked ||
            user.is_active === false
        ) {

            return res.status(403).json({
                success: false,
                message:
                    "Votre compte est bloqué ou désactivé."
            });
        }

        req.user =
            user;

        next();

    } catch (error) {

        console.error(
            "Authentication error:",
            error.message
        );

        return res.status(401).json({
            success: false,
            message:
                "Token invalide ou expiré."
        });
    }
}


/* ============================================================
   AUTH ADMIN
============================================================ */

async function adminAuth(
    req,
    res,
    next
) {

    try {

        const header =
            req.headers.authorization || "";

        let token = "";

        if (
            header.startsWith("Bearer ")
        ) {

            token =
                header.substring(7).trim();

        } else {

            token =
                req.headers["x-admin-token"] ||
                "";
        }

        if (!token) {

            return res.status(401).json({
                success: false,
                message:
                    "Authentification administrateur requise."
            });
        }

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        if (
            decoded.role !== "admin"
        ) {

            return res.status(403).json({
                success: false,
                message:
                    "Accès administrateur refusé."
            });
        }

        req.admin =
            decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message:
                "Session administrateur invalide."
        });
    }
}


/* ============================================================
   BASE DE DONNÉES
============================================================ */

async function testDatabase() {

    const result =
        await pool.query(
            `
            SELECT
                NOW() AS now,
                current_database() AS database
            `
        );

    return result.rows[0];
}


/* ============================================================
   INITIALISATION DES TABLES
============================================================ */

async function initializeDatabase() {

    await pool.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            nom VARCHAR(150) NOT NULL,

            email VARCHAR(255)
                UNIQUE NOT NULL,

            password_hash TEXT NOT NULL,

            photo TEXT,

            role VARCHAR(20)
                NOT NULL DEFAULT 'user',

            plan VARCHAR(20)
                NOT NULL DEFAULT 'free',

            is_active BOOLEAN
                NOT NULL DEFAULT TRUE,

            is_blocked BOOLEAN
                NOT NULL DEFAULT FALSE,

            created_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW(),

            last_login_at TIMESTAMPTZ
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS voices (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            external_voice_id VARCHAR(255)
                UNIQUE NOT NULL,

            name VARCHAR(255)
                NOT NULL,

            provider VARCHAR(50)
                NOT NULL DEFAULT 'elevenlabs',

            gender VARCHAR(50),

            language VARCHAR(50),

            language_name VARCHAR(100),

            description TEXT,

            preview_url TEXT,

            is_active BOOLEAN
                NOT NULL DEFAULT TRUE,

            is_premium BOOLEAN
                NOT NULL DEFAULT FALSE,

            created_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS projects (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            title VARCHAR(150)
                NOT NULL,

            description TEXT,

            language VARCHAR(50)
                DEFAULT 'fr',

            status VARCHAR(30)
                NOT NULL DEFAULT 'draft',

            created_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS audio_generations (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            project_id UUID
                REFERENCES projects(id)
                ON DELETE SET NULL,

            voice_id UUID
                REFERENCES voices(id)
                ON DELETE SET NULL,

            provider VARCHAR(50)
                NOT NULL DEFAULT 'elevenlabs',

            model_id VARCHAR(100),

            original_text TEXT
                NOT NULL,

            processed_text TEXT,

            language VARCHAR(50),

            voice_external_id VARCHAR(255),

            format VARCHAR(20)
                DEFAULT 'mp3',

            audio_url TEXT,

            audio_path TEXT,

            duration_seconds NUMERIC,

            character_count INTEGER
                DEFAULT 0,

            chunk_count INTEGER
                DEFAULT 1,

            status VARCHAR(30)
                NOT NULL DEFAULT 'processing',

            error TEXT,

            request_id VARCHAR(255),

            provider_character_count INTEGER,

            created_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS usage_records (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            generation_id UUID
                REFERENCES audio_generations(id)
                ON DELETE SET NULL,

            model_id VARCHAR(100),

            characters_used INTEGER
                NOT NULL DEFAULT 0,

            estimated_cost_usd NUMERIC(12,6)
                DEFAULT 0,

            created_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_quotas (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID
                UNIQUE
                NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            monthly_characters_limit INTEGER
                NOT NULL DEFAULT 10000,

            monthly_characters_used INTEGER
                NOT NULL DEFAULT 0,

            reset_at TIMESTAMPTZ
                NOT NULL,

            updated_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_activity (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            admin_user_id UUID,

            action VARCHAR(100)
                NOT NULL,

            description TEXT,

            ip_address VARCHAR(100),

            user_agent TEXT,

            created_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE TABLE IF NOT EXISTS system_settings (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            setting_key VARCHAR(150)
                UNIQUE NOT NULL,

            setting_value TEXT,

            description TEXT,

            updated_at TIMESTAMPTZ
                NOT NULL DEFAULT NOW()
        );
    `);


    await pool.query(`
        CREATE INDEX IF NOT EXISTS
        idx_audio_user
        ON audio_generations(user_id);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS
        idx_usage_user
        ON usage_records(user_id);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS
        idx_projects_user
        ON projects(user_id);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS
        idx_activity_created
        ON admin_activity(created_at DESC);
    `);


    const defaultSettings = [

        [
            "app_name",
            "BMJ VOICE AI",
            "Nom de l'application"
        ],

        [
            "default_language",
            "fr",
            "Langue par défaut"
        ],

        [
            "default_model",
            ELEVENLABS_MODEL_ID,
            "Modèle ElevenLabs principal"
        ],

        [
            "fast_model",
            ELEVENLABS_FAST_MODEL_ID,
            "Modèle ElevenLabs rapide"
        ],

        [
            "free_monthly_characters",
            String(FREE_QUOTA),
            "Quota mensuel Free"
        ],

        [
            "standard_monthly_characters",
            String(STANDARD_QUOTA),
            "Quota mensuel Standard"
        ],

        [
            "premium_monthly_characters",
            String(PREMIUM_QUOTA),
            "Quota mensuel Premium"
        ],

        [
            "default_audio_format",
            "mp3",
            "Format audio par défaut"
        ]
    ];


    for (
        const setting of defaultSettings
    ) {

        await pool.query(
            `
            INSERT INTO system_settings
                (
                    setting_key,
                    setting_value,
                    description
                )
            VALUES
                ($1,$2,$3)
            ON CONFLICT (setting_key)
            DO NOTHING
            `,
            setting
        );
    }


    console.log(
        "PostgreSQL : tables vérifiées."
    );
}


/* ============================================================
   QUOTA
============================================================ */

async function ensureUserQuota(
    user
) {

    const limit =
        getQuotaLimit(
            user.plan
        );

    const existing =
        await pool.query(
            `
            SELECT *
            FROM user_quotas
            WHERE user_id = $1
            LIMIT 1
            `,
            [user.id]
        );

    if (
        existing.rows.length === 0
    ) {

        const reset =
            getResetDate();

        const created =
            await pool.query(
                `
                INSERT INTO user_quotas
                (
                    user_id,
                    monthly_characters_limit,
                    monthly_characters_used,
                    reset_at
                )
                VALUES
                ($1,$2,0,$3)
                RETURNING *
                `,
                [
                    user.id,
                    limit,
                    reset
                ]
            );

        return created.rows[0];
    }


    let quota =
        existing.rows[0];


    if (
        new Date(quota.reset_at)
            <= new Date()
    ) {

        const reset =
            getResetDate();

        const updated =
            await pool.query(
                `
                UPDATE user_quotas
                SET
                    monthly_characters_limit = $2,
                    monthly_characters_used = 0,
                    reset_at = $3,
                    updated_at = NOW()
                WHERE user_id = $1
                RETURNING *
                `,
                [
                    user.id,
                    limit,
                    reset
                ]
            );

        return updated.rows[0];
    }


    if (
        Number(
            quota.monthly_characters_limit
        ) !== limit
    ) {

        const updated =
            await pool.query(
                `
                UPDATE user_quotas
                SET
                    monthly_characters_limit = $2,
                    updated_at = NOW()
                WHERE user_id = $1
                RETURNING *
                `,
                [
                    user.id,
                    limit
                ]
            );

        return updated.rows[0];
    }


    return quota;
}


/* ============================================================
   SPLIT TEXT
============================================================ */

function splitText(
    text,
    maxLength = 4500
) {

    const clean =
        String(text || "")
            .trim();

    if (!clean) {
        return [];
    }

    if (
        clean.length <= maxLength
    ) {

        return [clean];
    }


    const chunks = [];

    let current = "";

    const sentences =
        clean.match(
            /[^.!?]+[.!?]+|[^.!?]+$/g
        ) || [clean];


    for (
        const sentence of sentences
    ) {

        const part =
            sentence.trim();

        if (!part) {
            continue;
        }


        if (
            current.length +
            part.length +
            1 <= maxLength
        ) {

            current =
                current
                    ? `${current} ${part}`
                    : part;

            continue;
        }


        if (current) {

            chunks.push(
                current
            );

            current = "";
        }


        if (
            part.length <= maxLength
        ) {

            current =
                part;

            continue;
        }


        for (
            let i = 0;
            i < part.length;
            i += maxLength
        ) {

            chunks.push(
                part.substring(
                    i,
                    i + maxLength
                )
            );
        }
    }


    if (current) {

        chunks.push(
            current
        );
    }


    return chunks;
}


/* ============================================================
   ELEVENLABS
============================================================ */

async function generateElevenLabsAudio(
    text,
    voiceId,
    modelId
) {

    if (
        !elevenLabsConfigured()
    ) {

        throw new Error(
            "ElevenLabs n'est pas configuré sur le serveur."
        );
    }


    if (!voiceId) {

        throw new Error(
            "Voice ID ElevenLabs manquant."
        );
    }


    const response =
        await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "xi-api-key":
                        ELEVENLABS_API_KEY,

                    "Accept":
                        "audio/mpeg"
                },

                body:
                    JSON.stringify({
                        text,

                        model_id:
                            modelId,

                        output_format:
                            "mp3_44100_128",

                        voice_settings: {

                            stability:
                                0.5,

                            similarity_boost:
                                0.75,

                            style:
                                0.3,

                            use_speaker_boost:
                                true
                        }
                    })
            }
        );


    if (!response.ok) {

        const errorText =
            await response.text();

        throw new Error(
            `ElevenLabs ${response.status}: ${errorText}`
        );
    }


    const arrayBuffer =
        await response.arrayBuffer();


    return Buffer.from(
        arrayBuffer
    );
}


/* ============================================================
   LOG ADMIN
============================================================ */

async function logAdminActivity(
    req,
    action,
    description
) {

    try {

        await pool.query(
            `
            INSERT INTO admin_activity
            (
                admin_user_id,
                action,
                description,
                ip_address,
                user_agent
            )
            VALUES
            ($1,$2,$3,$4,$5)
            `,
            [
                req.admin?.id || null,
                action,
                description,
                getClientIp(req),
                req.headers["user-agent"] || ""
            ]
        );

    } catch (error) {

        console.error(
            "Admin activity error:",
            error.message
        );
    }
}


/* ============================================================
   RACINE
============================================================ */

app.get(
    "/",
    (req, res) => {

        res.json({
            success: true,
            name: "BMJ VOICE AI",
            message:
                "BMJ VOICE AI API active",
            version:
                API_VERSION,
            environment:
                NODE_ENV
        });
    }
);


/* ============================================================
   API
============================================================ */

app.get(
    "/api",
    (req, res) => {

        res.json({
            success: true,
            name: "BMJ VOICE AI",
            version:
                API_VERSION,
            status:
                "online"
        });
    }
);


/* ============================================================
   HEALTH
============================================================ */

app.get(
    "/api/health",
    async (req, res) => {

        try {

            const db =
                await testDatabase();

            res.json({
                success: true,

                api:
                    "online",

                database:
                    "connected",

                database_name:
                    db.database,

                database_time:
                    db.now,

                elevenlabs:
                    elevenLabsConfigured(),

                default_voice:
                    Boolean(
                        ELEVENLABS_DEFAULT_VOICE_ID
                    ),

                model:
                    ELEVENLABS_MODEL_ID,

                fast_model:
                    ELEVENLABS_FAST_MODEL_ID,

                environment:
                    NODE_ENV
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                api: "online",
                database: "error",
                error:
                    error.message
            });
        }
    }
);


/* ============================================================
   TEST DATABASE
============================================================ */

app.get(
    "/api/test-db",
    async (req, res) => {

        try {

            const db =
                await testDatabase();

            res.json({
                success: true,
                database:
                    db.database,
                time:
                    db.now
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error:
                    error.message
            });
        }
    }
);


/* ============================================================
   ELEVENLABS STATUS
============================================================ */

app.get(
    "/api/elevenlabs/status",
    (req, res) => {

        res.json({

            success:
                true,

            configured:
                elevenLabsConfigured(),

            default_voice:
                ELEVENLABS_DEFAULT_VOICE_ID,

            model:
                ELEVENLABS_MODEL_ID,

            fast_model:
                ELEVENLABS_FAST_MODEL_ID
        });
    }
);


/* ============================================================
   AUTH REGISTER
============================================================ */

app.post(
    "/api/auth/register",
    async (req, res) => {

        try {

            const nom =
                cleanString(
                    req.body.nom,
                    150
                );

            const email =
                normalizeEmail(
                    req.body.email
                );

            const password =
                String(
                    req.body.password || ""
                );

            const photo =
                cleanString(
                    req.body.photo,
                    500000
                );


            if (
                !nom ||
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Nom, email et mot de passe sont obligatoires."
                });
            }


            if (
                password.length < 6
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Le mot de passe doit contenir au moins 6 caractères."
                });
            }


            const emailValid =
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    .test(email);


            if (!emailValid) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Adresse email invalide."
                });
            }


            const existing =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE email = $1
                    LIMIT 1
                    `,
                    [email]
                );


            if (
                existing.rows.length > 0
            ) {

                return res.status(409).json({
                    success: false,
                    message:
                        "Cette adresse email est déjà utilisée."
                });
            }


            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );


            const result =
                await pool.query(
                    `
                    INSERT INTO users
                    (
                        nom,
                        email,
                        password_hash,
                        photo,
                        role,
                        plan
                    )
                    VALUES
                    ($1,$2,$3,$4,'user','free')
                    RETURNING
                        id,
                        nom,
                        email,
                        photo,
                        role,
                        plan,
                        is_active,
                        is_blocked,
                        created_at
                    `,
                    [
                        nom,
                        email,
                        passwordHash,
                        photo || null
                    ]
                );


            const user =
                result.rows[0];


            await ensureUserQuota(
                user
            );


            const token =
                createToken(user);


            res.status(201).json({

                success:
                    true,

                message:
                    "Compte créé avec succès.",

                token,

                user
            });

        } catch (error) {

            console.error(
                "Register error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Impossible de créer le compte."
            });
        }
    }
);


/* ============================================================
   AUTH LOGIN
============================================================ */

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const email =
                normalizeEmail(
                    req.body.email
                );

            const password =
                String(
                    req.body.password || ""
                );


            if (
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Email et mot de passe obligatoires."
                });
            }


            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM users
                    WHERE email = $1
                    LIMIT 1
                    `,
                    [email]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Email ou mot de passe incorrect."
                });
            }


            const user =
                result.rows[0];


            const valid =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );


            if (!valid) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Email ou mot de passe incorrect."
                });
            }


            if (
                user.is_blocked ||
                user.is_active === false
            ) {

                return res.status(403).json({
                    success: false,
                    message:
                        "Votre compte est bloqué ou désactivé."
                });
            }


            await pool.query(
                `
                UPDATE users
                SET
                    last_login_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                `,
                [user.id]
            );


            await ensureUserQuota(
                user
            );


            const safeUser = {

                id:
                    user.id,

                nom:
                    user.nom,

                email:
                    user.email,

                photo:
                    user.photo,

                role:
                    user.role,

                plan:
                    user.plan,

                is_active:
                    user.is_active,

                is_blocked:
                    user.is_blocked,

                created_at:
                    user.created_at,

                last_login_at:
                    new Date()
            };


            const token =
                createToken(
                    safeUser
                );


            res.json({

                success:
                    true,

                message:
                    "Connexion réussie.",

                token,

                user:
                    safeUser
            });

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Erreur de connexion."
            });
        }
    }
);


/* ============================================================
   AUTH ME
============================================================ */

app.get(
    "/api/auth/me",
    authenticate,
    async (req, res) => {

        try {

            const quota =
                await ensureUserQuota(
                    req.user
                );


            res.json({

                success:
                    true,

                user:
                    req.user,

                quota: {

                    limit:
                        Number(
                            quota.monthly_characters_limit
                        ),

                    used:
                        Number(
                            quota.monthly_characters_used
                        ),

                    remaining:
                        Math.max(
                            0,
                            Number(
                                quota.monthly_characters_limit
                            ) -
                            Number(
                                quota.monthly_characters_used
                            )
                        ),

                    reset_at:
                        quota.reset_at
                }
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   PROFILE
============================================================ */

app.patch(
    "/api/auth/profile",
    authenticate,
    async (req, res) => {

        try {

            const nom =
                cleanString(
                    req.body.nom,
                    150
                );

            const photo =
                cleanString(
                    req.body.photo,
                    500000
                );


            if (!nom) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Le nom est obligatoire."
                });
            }


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        nom = $2,
                        photo = $3,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING
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
                    `,
                    [
                        req.user.id,
                        nom,
                        photo || null
                    ]
                );


            res.json({
                success: true,
                message:
                    "Profil mis à jour.",
                user:
                    result.rows[0]
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   PASSWORD
============================================================ */

app.patch(
    "/api/auth/password",
    authenticate,
    async (req, res) => {

        try {

            const currentPassword =
                String(
                    req.body.current_password ||
                    ""
                );

            const newPassword =
                String(
                    req.body.new_password ||
                    ""
                );


            if (
                !currentPassword ||
                !newPassword
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Les deux mots de passe sont obligatoires."
                });
            }


            if (
                newPassword.length < 6
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Le nouveau mot de passe doit contenir au moins 6 caractères."
                });
            }


            const result =
                await pool.query(
                    `
                    SELECT password_hash
                    FROM users
                    WHERE id = $1
                    `,
                    [req.user.id]
                );


            const valid =
                await bcrypt.compare(
                    currentPassword,
                    result.rows[0]
                        .password_hash
                );


            if (!valid) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Ancien mot de passe incorrect."
                });
            }


            const hash =
                await bcrypt.hash(
                    newPassword,
                    12
                );


            await pool.query(
                `
                UPDATE users
                SET
                    password_hash = $2,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [
                    req.user.id,
                    hash
                ]
            );


            res.json({
                success: true,
                message:
                    "Mot de passe modifié avec succès."
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   VOIX
============================================================ */

app.get(
    "/api/voices",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
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
                        created_at
                    FROM voices
                    WHERE is_active = TRUE
                    ORDER BY name ASC
                    `
                );


            res.json({

                success:
                    true,

                voices:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   SYNCHRONISATION VOIX ELEVENLABS
============================================================ */

app.post(
    "/api/admin/voices/sync",
    adminAuth,
    async (req, res) => {

        try {

            if (
                !elevenLabsConfigured()
            ) {

                return res.status(503).json({
                    success: false,
                    message:
                        "ElevenLabs n'est pas configuré."
                });
            }


            const response =
                await fetch(
                    "https://api.elevenlabs.io/v1/voices",
                    {
                        headers: {
                            "xi-api-key":
                                ELEVENLABS_API_KEY
                        }
                    }
                );


            if (!response.ok) {

                const text =
                    await response.text();

                throw new Error(
                    `ElevenLabs ${response.status}: ${text}`
                );
            }


            const data =
                await response.json();


            const voices =
                Array.isArray(data.voices)
                    ? data.voices
                    : [];


            let count = 0;


            for (
                const voice of voices
            ) {

                const labels =
                    voice.labels || {};


                await pool.query(
                    `
                    INSERT INTO voices
                    (
                        external_voice_id,
                        name,
                        provider,
                        gender,
                        language,
                        language_name,
                        description,
                        preview_url,
                        is_active
                    )
                    VALUES
                    ($1,$2,'elevenlabs',$3,$4,$5,$6,$7,TRUE)

                    ON CONFLICT
                    (external_voice_id)

                    DO UPDATE SET

                        name = EXCLUDED.name,

                        gender = EXCLUDED.gender,

                        language = EXCLUDED.language,

                        language_name =
                            EXCLUDED.language_name,

                        description =
                            EXCLUDED.description,

                        preview_url =
                            EXCLUDED.preview_url,

                        is_active = TRUE,

                        updated_at = NOW()
                    `,
                    [
                        voice.voice_id,

                        voice.name ||
                            "Voix ElevenLabs",

                        labels.gender ||
                            null,

                        labels.language ||
                            null,

                        labels.language ||
                            null,

                        voice.description ||
                            "",

                        voice.preview_url ||
                            null
                    ]
                );


                count++;
            }


            await logAdminActivity(
                req,
                "voices_sync",
                `Synchronisation de ${count} voix ElevenLabs.`
            );


            res.json({

                success:
                    true,

                message:
                    "Voix synchronisées.",

                count
            });

        } catch (error) {

            console.error(
                "Voice sync error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   TTS GENERATE
============================================================ */

app.post(
    "/api/tts/generate",
    authenticate,
    async (req, res) => {

        const requestId =
            generateRequestId();


        let generationId =
            null;


        try {

            const text =
                cleanString(
                    req.body.text,
                    MAX_TEXT_LENGTH
                );

            const language =
                cleanString(
                    req.body.language,
                    50
                ) ||
                "fr";

            const requestedVoice =
                cleanString(
                    req.body.voice_id,
                    255
                );

            const requestedModel =
                cleanString(
                    req.body.model_id,
                    100
                );

            const projectId =
                cleanString(
                    req.body.project_id,
                    100
                );

            const format =
                cleanString(
                    req.body.format,
                    20
                ) ||
                "mp3";


            if (!text) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Le texte est obligatoire."
                });
            }


            if (
                text.length >
                MAX_TEXT_LENGTH
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        `Le texte ne peut pas dépasser ${MAX_TEXT_LENGTH} caractères.`
                });
            }


            if (
                format !== "mp3"
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Le format disponible actuellement est MP3."
                });
            }


            if (
                !elevenLabsConfigured()
            ) {

                return res.status(503).json({
                    success: false,
                    message:
                        "ElevenLabs n'est pas configuré."
                });
            }


            const voiceId =
                requestedVoice ||
                ELEVENLABS_DEFAULT_VOICE_ID;


            if (!voiceId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Aucune voix ElevenLabs n'est configurée."
                });
            }


            const modelId =
                requestedModel ===
                ELEVENLABS_FAST_MODEL_ID

                    ? ELEVENLABS_FAST_MODEL_ID

                    : ELEVENLABS_MODEL_ID;


            const quota =
                await ensureUserQuota(
                    req.user
                );


            const characterCount =
                text.length;


            const used =
                Number(
                    quota.monthly_characters_used
                );

            const limit =
                Number(
                    quota.monthly_characters_limit
                );


            if (
                used +
                characterCount >
                limit
            ) {

                return res.status(429).json({

                    success:
                        false,

                    message:
                        "Votre quota mensuel de caractères est insuffisant.",

                    quota: {

                        limit,

                        used,

                        remaining:
                            Math.max(
                                0,
                                limit - used
                            ),

                        requested:
                            characterCount
                    }
                });
            }


            const chunks =
                splitText(
                    text,
                    4500
                );


            if (
                chunks.length === 0
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Texte invalide."
                });
            }


            let validProjectId =
                null;


            if (projectId) {

                const project =
                    await pool.query(
                        `
                        SELECT id
                        FROM projects
                        WHERE
                            id = $1
                            AND user_id = $2
                        LIMIT 1
                        `,
                        [
                            projectId,
                            req.user.id
                        ]
                    );


                if (
                    project.rows.length === 0
                ) {

                    return res.status(404).json({
                        success: false,
                        message:
                            "Projet introuvable."
                    });
                }


                validProjectId =
                    project.rows[0].id;
            }


            let voiceDatabaseId =
                null;


            const voiceResult =
                await pool.query(
                    `
                    SELECT id
                    FROM voices
                    WHERE
                        external_voice_id = $1
                    LIMIT 1
                    `,
                    [voiceId]
                );


            if (
                voiceResult.rows.length > 0
            ) {

                voiceDatabaseId =
                    voiceResult.rows[0].id;
            }


            const inserted =
                await pool.query(
                    `
                    INSERT INTO audio_generations
                    (
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
                        character_count,
                        chunk_count,
                        status,
                        request_id
                    )
                    VALUES
                    (
                        $1,$2,$3,'elevenlabs',$4,
                        $5,$6,$7,$8,$9,
                        $10,$11,'processing',$12
                    )
                    RETURNING id
                    `,
                    [
                        req.user.id,

                        validProjectId,

                        voiceDatabaseId,

                        modelId,

                        text,

                        text,

                        language,

                        voiceId,

                        format,

                        characterCount,

                        chunks.length,

                        requestId
                    ]
                );


            generationId =
                inserted.rows[0].id;


            const audioBuffers = [];


            for (
                const chunk of chunks
            ) {

                const audio =
                    await generateElevenLabsAudio(
                        chunk,
                        voiceId,
                        modelId
                    );

                audioBuffers.push(
                    audio
                );
            }


            const audioBuffer =
                Buffer.concat(
                    audioBuffers
                );


            const audioBase64 =
                audioBuffer.toString(
                    "base64"
                );


            const audioUrl =
                `data:audio/mpeg;base64,${audioBase64}`;


            await pool.query(
                `
                UPDATE audio_generations
                SET
                    audio_url = $2,
                    status = 'completed',
                    provider_character_count = $3,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [
                    generationId,
                    audioUrl,
                    characterCount
                ]
            );


            await pool.query(
                `
                INSERT INTO usage_records
                (
                    user_id,
                    generation_id,
                    model_id,
                    characters_used,
                    estimated_cost_usd
                )
                VALUES
                ($1,$2,$3,$4,0)
                `,
                [
                    req.user.id,
                    generationId,
                    modelId,
                    characterCount
                ]
            );


            await pool.query(
                `
                UPDATE user_quotas
                SET
                    monthly_characters_used =
                        monthly_characters_used + $2,
                    updated_at = NOW()
                WHERE user_id = $1
                `,
                [
                    req.user.id,
                    characterCount
                ]
            );


            const finalQuota =
                await ensureUserQuota(
                    req.user
                );


            res.json({

                success:
                    true,

                message:
                    "Audio généré avec succès.",

                generation: {

                    id:
                        generationId,

                    request_id:
                        requestId,

                    provider:
                        "elevenlabs",

                    model_id:
                        modelId,

                    voice_id:
                        voiceId,

                    language,

                    format,

                    character_count:
                        characterCount,

                    chunk_count:
                        chunks.length,

                    status:
                        "completed",

                    audio_url:
                        audioUrl
                },

                quota: {

                    limit:
                        Number(
                            finalQuota.monthly_characters_limit
                        ),

                    used:
                        Number(
                            finalQuota.monthly_characters_used
                        ),

                    remaining:
                        Math.max(
                            0,
                            Number(
                                finalQuota.monthly_characters_limit
                            ) -
                            Number(
                                finalQuota.monthly_characters_used
                            )
                        ),

                    reset_at:
                        finalQuota.reset_at
                }
            });

        } catch (error) {

            console.error(
                "TTS generation error:",
                error
            );


            if (
                generationId
            ) {

                await pool.query(
                    `
                    UPDATE audio_generations
                    SET
                        status = 'failed',
                        error = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    `,
                    [
                        generationId,
                        error.message
                    ]
                );
            }


            res.status(500).json({

                success:
                    false,

                message:
                    "La génération audio a échoué.",

                error:
                    error.message,

                request_id:
                    requestId
            });
        }
    }
);


/* ============================================================
   AUDIO LIST
============================================================ */

app.get(
    "/api/audio",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        project_id,
                        voice_id,
                        provider,
                        model_id,
                        original_text,
                        processed_text,
                        language,
                        voice_external_id,
                        format,
                        audio_url,
                        duration_seconds,
                        character_count,
                        chunk_count,
                        status,
                        error,
                        request_id,
                        created_at,
                        updated_at
                    FROM audio_generations
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT 100
                    `,
                    [req.user.id]
                );


            res.json({

                success:
                    true,

                audio:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   AUDIO ONE
============================================================ */

app.get(
    "/api/audio/:id",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM audio_generations
                    WHERE
                        id = $1
                        AND user_id = $2
                    LIMIT 1
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Génération audio introuvable."
                });
            }


            res.json({

                success:
                    true,

                generation:
                    result.rows[0]
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   DELETE AUDIO
============================================================ */

app.delete(
    "/api/audio/:id",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM audio_generations
                    WHERE
                        id = $1
                        AND user_id = $2
                    RETURNING id
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio introuvable."
                });
            }


            res.json({

                success:
                    true,

                message:
                    "Audio supprimé."
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   PROJECT CREATE
============================================================ */

app.post(
    "/api/projects",
    authenticate,
    async (req, res) => {

        try {

            const title =
                cleanString(
                    req.body.title,
                    MAX_PROJECT_TITLE
                );

            const description =
                cleanString(
                    req.body.description,
                    MAX_PROJECT_DESCRIPTION
                );

            const language =
                cleanString(
                    req.body.language,
                    50
                ) ||
                "fr";


            if (!title) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Le titre du projet est obligatoire."
                });
            }


            const result =
                await pool.query(
                    `
                    INSERT INTO projects
                    (
                        user_id,
                        title,
                        description,
                        language,
                        status
                    )
                    VALUES
                    ($1,$2,$3,$4,'draft')
                    RETURNING *
                    `,
                    [
                        req.user.id,
                        title,
                        description || null,
                        language
                    ]
                );


            res.status(201).json({

                success:
                    true,

                message:
                    "Projet créé.",

                project:
                    result.rows[0]
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   PROJECT LIST
============================================================ */

app.get(
    "/api/projects",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        p.*,
                        COUNT(a.id)::INTEGER
                            AS generation_count
                    FROM projects p

                    LEFT JOIN
                        audio_generations a
                    ON
                        a.project_id = p.id

                    WHERE
                        p.user_id = $1

                    GROUP BY p.id

                    ORDER BY
                        p.updated_at DESC
                    `,
                    [req.user.id]
                );


            res.json({

                success:
                    true,

                projects:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   PROJECT DELETE
============================================================ */

app.delete(
    "/api/projects/:id",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM projects
                    WHERE
                        id = $1
                        AND user_id = $2
                    RETURNING id
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Projet introuvable."
                });
            }


            res.json({

                success:
                    true,

                message:
                    "Projet supprimé."
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   USAGE
============================================================ */

app.get(
    "/api/usage",
    authenticate,
    async (req, res) => {

        try {

            const quota =
                await ensureUserQuota(
                    req.user
                );


            const usage =
                await pool.query(
                    `
                    SELECT
                        id,
                        generation_id,
                        model_id,
                        characters_used,
                        estimated_cost_usd,
                        created_at
                    FROM usage_records
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT 100
                    `,
                    [req.user.id]
                );


            const totals =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUM(characters_used),
                            0
                        )::INTEGER
                        AS total_characters,

                        COUNT(*)::INTEGER
                        AS total_generations
                    FROM usage_records
                    WHERE user_id = $1
                    `,
                    [req.user.id]
                );


            res.json({

                success:
                    true,

                quota: {

                    limit:
                        Number(
                            quota.monthly_characters_limit
                        ),

                    used:
                        Number(
                            quota.monthly_characters_used
                        ),

                    remaining:
                        Math.max(
                            0,
                            Number(
                                quota.monthly_characters_limit
                            ) -
                            Number(
                                quota.monthly_characters_used
                            )
                        ),

                    reset_at:
                        quota.reset_at
                },

                totals:
                    totals.rows[0],

                records:
                    usage.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   SETTINGS PUBLIC
============================================================ */

app.get(
    "/api/settings",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        setting_key,
                        setting_value
                    FROM system_settings
                    ORDER BY setting_key
                    `
                );


            const settings = {};


            for (
                const row of result.rows
            ) {

                settings[
                    row.setting_key
                ] =
                    row.setting_value;
            }


            res.json({

                success:
                    true,

                settings
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN LOGIN
============================================================ */

app.post(
    "/api/admin/login",
    async (req, res) => {

        try {

            const email =
                normalizeEmail(
                    req.body.email
                );

            const password =
                String(
                    req.body.password || ""
                );


            if (
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Email et mot de passe obligatoires."
                });
            }


            if (
                email !==
                normalizeEmail(
                    ADMIN_EMAIL
                ) ||
                password !==
                ADMIN_PASSWORD
            ) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Identifiants administrateur incorrects."
                });
            }


            const token =
                jwt.sign(
                    {
                        id:
                            "admin",

                        email:
                            ADMIN_EMAIL,

                        role:
                            "admin"
                    },

                    JWT_SECRET,

                    {
                        expiresIn:
                            "12h"
                    }
                );


            res.json({

                success:
                    true,

                message:
                    "Connexion administrateur réussie.",

                token,

                admin: {

                    email:
                        ADMIN_EMAIL,

                    role:
                        "admin"
                }
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN STATISTIQUES
============================================================ */

app.get(
    "/api/admin/statistiques",
    adminAuth,
    async (req, res) => {

        try {

            const users =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::INTEGER
                        AS total,

                        COUNT(*) FILTER
                        (
                            WHERE plan = 'free'
                        )::INTEGER
                        AS free,

                        COUNT(*) FILTER
                        (
                            WHERE plan = 'standard'
                        )::INTEGER
                        AS standard,

                        COUNT(*) FILTER
                        (
                            WHERE plan = 'premium'
                        )::INTEGER
                        AS premium,

                        COUNT(*) FILTER
                        (
                            WHERE is_blocked = TRUE
                        )::INTEGER
                        AS blocked
                    FROM users
                    `
                );


            const generations =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::INTEGER
                        AS total,

                        COUNT(*) FILTER
                        (
                            WHERE status = 'completed'
                        )::INTEGER
                        AS completed,

                        COUNT(*) FILTER
                        (
                            WHERE status = 'failed'
                        )::INTEGER
                        AS failed
                    FROM audio_generations
                    `
                );


            const characters =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUM(characters_used),
                            0
                        )::BIGINT
                        AS total_characters
                    FROM usage_records
                    `
                );


            const projects =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::INTEGER
                        AS total
                    FROM projects
                    `
                );


            res.json({

                success:
                    true,

                users:
                    users.rows[0],

                generations:
                    generations.rows[0],

                characters:
                    characters.rows[0],

                projects:
                    projects.rows[0],

                elevenlabs:
                    elevenLabsConfigured(),

                models: {

                    main:
                        ELEVENLABS_MODEL_ID,

                    fast:
                        ELEVENLABS_FAST_MODEL_ID
                }
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN USERS
============================================================ */

app.get(
    "/api/admin/users",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        u.id,
                        u.nom,
                        u.email,
                        u.photo,
                        u.role,
                        u.plan,
                        u.is_active,
                        u.is_blocked,
                        u.created_at,
                        u.updated_at,
                        u.last_login_at,

                        COALESCE(
                            q.monthly_characters_limit,
                            0
                        ) AS monthly_limit,

                        COALESCE(
                            q.monthly_characters_used,
                            0
                        ) AS monthly_used,

                        COUNT(a.id)::INTEGER
                            AS generations

                    FROM users u

                    LEFT JOIN
                        user_quotas q
                    ON
                        q.user_id = u.id

                    LEFT JOIN
                        audio_generations a
                    ON
                        a.user_id = u.id

                    GROUP BY
                        u.id,
                        q.monthly_characters_limit,
                        q.monthly_characters_used

                    ORDER BY
                        u.created_at DESC
                    `
                );


            res.json({

                success:
                    true,

                users:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN USER BLOCK
============================================================ */

app.patch(
    "/api/admin/users/:id/block",
    adminAuth,
    async (req, res) => {

        try {

            const blocked =
                Boolean(
                    req.body.blocked
                );


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        is_blocked = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING
                        id,
                        nom,
                        email,
                        plan,
                        is_blocked
                    `,
                    [
                        req.params.id,
                        blocked
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });
            }


            await logAdminActivity(
                req,
                blocked
                    ? "block_user"
                    : "unblock_user",
                `${blocked ? "Blocage" : "Déblocage"} de l'utilisateur ${hashForLog(req.params.id)}.`
            );


            res.json({

                success:
                    true,

                message:
                    blocked
                        ? "Utilisateur bloqué."
                        : "Utilisateur débloqué.",

                user:
                    result.rows[0]
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN USER PLAN
============================================================ */

app.patch(
    "/api/admin/users/:id/plan",
    adminAuth,
    async (req, res) => {

        try {

            const plan =
                cleanString(
                    req.body.plan,
                    20
                )
                .toLowerCase();


            if (
                ![
                    "free",
                    "standard",
                    "premium"
                ].includes(plan)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Plan invalide."
                });
            }


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        plan = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING
                        id,
                        nom,
                        email,
                        plan
                    `,
                    [
                        req.params.id,
                        plan
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });
            }


            const user =
                result.rows[0];


            await ensureUserQuota(
                user
            );


            await logAdminActivity(
                req,
                "change_plan",
                `Plan ${plan} attribué à ${hashForLog(req.params.id)}.`
            );


            res.json({

                success:
                    true,

                message:
                    `Plan ${plan} attribué.`,

                user
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN GENERATIONS
============================================================ */

app.get(
    "/api/admin/generations",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        a.id,
                        a.user_id,
                        u.nom,
                        u.email,
                        a.project_id,
                        a.provider,
                        a.model_id,
                        a.language,
                        a.voice_external_id,
                        a.format,
                        a.character_count,
                        a.chunk_count,
                        a.status,
                        a.error,
                        a.request_id,
                        a.created_at
                    FROM audio_generations a

                    LEFT JOIN users u
                    ON u.id = a.user_id

                    ORDER BY
                        a.created_at DESC

                    LIMIT 500
                    `
                );


            res.json({

                success:
                    true,

                generations:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN ACTIVITIES
============================================================ */

app.get(
    "/api/admin/activities",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        admin_user_id,
                        action,
                        description,
                        ip_address,
                        user_agent,
                        created_at
                    FROM admin_activity
                    ORDER BY
                        created_at DESC
                    LIMIT 500
                    `
                );


            res.json({

                success:
                    true,

                activities:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN VOICES
============================================================ */

app.get(
    "/api/admin/voices",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM voices
                    ORDER BY
                        name ASC
                    `
                );


            res.json({

                success:
                    true,

                voices:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN VOICE UPDATE
============================================================ */

app.patch(
    "/api/admin/voices/:id",
    adminAuth,
    async (req, res) => {

        try {

            const isActive =
                req.body.is_active;

            const isPremium =
                req.body.is_premium;


            const result =
                await pool.query(
                    `
                    UPDATE voices
                    SET
                        is_active =
                            COALESCE($2,is_active),

                        is_premium =
                            COALESCE($3,is_premium),

                        updated_at =
                            NOW()

                    WHERE id = $1

                    RETURNING *
                    `,
                    [
                        req.params.id,

                        typeof isActive ===
                        "boolean"
                            ? isActive
                            : null,

                        typeof isPremium ===
                        "boolean"
                            ? isPremium
                            : null
                    ]
                );


            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Voix introuvable."
                });
            }


            await logAdminActivity(
                req,
                "update_voice",
                `Modification de la voix ${hashForLog(req.params.id)}.`
            );


            res.json({

                success:
                    true,

                message:
                    "Voix mise à jour.",

                voice:
                    result.rows[0]
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN SETTINGS
============================================================ */

app.get(
    "/api/admin/settings",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM system_settings
                    ORDER BY setting_key
                    `
                );


            res.json({

                success:
                    true,

                settings:
                    result.rows
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN SETTINGS UPDATE
============================================================ */

app.patch(
    "/api/admin/settings/:key",
    adminAuth,
    async (req, res) => {

        try {

            const key =
                cleanString(
                    req.params.key,
                    150
                );

            const value =
                cleanString(
                    req.body.value,
                    10000
                );


            if (!key) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Clé de paramètre invalide."
                });
            }


            const result =
                await pool.query(
                    `
                    INSERT INTO system_settings
                    (
                        setting_key,
                        setting_value,
                        description
                    )
                    VALUES
                    ($1,$2,'')
                    ON CONFLICT
                    (setting_key)
                    DO UPDATE SET
                        setting_value =
                            EXCLUDED.setting_value,
                        updated_at =
                            NOW()
                    RETURNING *
                    `,
                    [
                        key,
                        value
                    ]
                );


            await logAdminActivity(
                req,
                "update_setting",
                `Modification du paramètre ${key}.`
            );


            res.json({

                success:
                    true,

                message:
                    "Paramètre mis à jour.",

                setting:
                    result.rows[0]
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                message:
                    error.message
            });
        }
    }
);


/* ============================================================
   ADMIN SESSION TEST
============================================================ */

app.get(
    "/api/admin/session",
    adminAuth,
    (req, res) => {

        res.json({

            success:
                true,

            authenticated:
                true,

            admin: {

                email:
                    req.admin.email,

                role:
                    req.admin.role
            }
        });
    }
);


/* ============================================================
   404
============================================================ */

app.use(
    (req, res) => {

        res.status(404).json({

            success:
                false,

            message:
                "Route API introuvable.",

            path:
                req.originalUrl
        });
    }
);


/* ============================================================
   ERREUR GLOBALE
============================================================ */

app.use(
    (error, req, res, next) => {

        console.error(
            "Global server error:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(error);
        }


        res.status(500).json({

            success:
                false,

            message:
                "Erreur interne du serveur."
        });
    }
);


/* ============================================================
   DÉMARRAGE
============================================================ */

async function startServer() {

    try {

        const db =
            await testDatabase();


        await initializeDatabase();


        console.log("");

        console.log(
            "================================================"
        );

        console.log(
            "             BMJ VOICE AI"
        );

        console.log(
            "================================================"
        );

        console.log(
            "API              : ONLINE"
        );

        console.log(
            "PostgreSQL       : CONNECTED"
        );

        console.log(
            "Database         :",
            db.database
        );

        console.log(
            "Database time    :",
            db.now
        );

        console.log(
            "ElevenLabs       :",
            elevenLabsConfigured()
                ? "CONFIGURED"
                : "MISSING"
        );

        console.log(
            "Main model       :",
            ELEVENLABS_MODEL_ID
        );

        console.log(
            "Fast model       :",
            ELEVENLABS_FAST_MODEL_ID
        );

        console.log(
            "Default voice    :",
            ELEVENLABS_DEFAULT_VOICE_ID
                ? "CONFIGURED"
                : "NOT CONFIGURED"
        );

        console.log(
            "Free quota       :",
            FREE_QUOTA
        );

        console.log(
            "Standard quota   :",
            STANDARD_QUOTA
        );

        console.log(
            "Premium quota    :",
            PREMIUM_QUOTA
        );

        console.log(
            "Port             :",
            PORT
        );

        console.log(
            "Environment      :",
            NODE_ENV
        );

        console.log(
            "================================================"
        );


        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `BMJ VOICE AI disponible sur le port ${PORT}`
                );

                console.log(
                    `URL publique : ${PUBLIC_BASE_URL}`
                );

                console.log(
                    "================================================"
                );
            }
        );

    } catch (error) {

        console.error(
            "================================================"
        );

        console.error(
            "ERREUR DÉMARRAGE BMJ VOICE AI"
        );

        console.error(
            error
        );

        console.error(
            "================================================"
        );

        process.exit(1);
    }
}


/* ============================================================
   ARRÊT PROPRE
============================================================ */

async function shutdown(
    signal
) {

    console.log(
        `${signal} reçu. Arrêt de BMJ VOICE AI...`
    );


    try {

        await pool.end();

        console.log(
            "Connexion PostgreSQL fermée."
        );

        process.exit(0);

    } catch (error) {

        console.error(
            "Erreur fermeture PostgreSQL:",
            error
        );

        process.exit(1);
    }
}


process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);


/* ============================================================
   LANCEMENT
============================================================ */

startServer();