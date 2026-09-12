"use strict";

/* ============================================================
   BMJ VOICE AI
   BACKEND COMPLET
   Node.js + Express + PostgreSQL + ElevenLabs
   Hébergement : Render
============================================================ */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

/* ============================================================
   CONFIGURATION
============================================================ */

const app = express();

const PORT = Number(process.env.PORT || 10000);

const APP_NAME =
    process.env.APP_NAME || "BMJ VOICE AI";

const NODE_ENV =
    process.env.NODE_ENV || "development";

const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    "https://eseay-correct1.onrender.com";

const DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://audio_db_n28a_user:yLIb8T9QvrQtUPymu7D5U0jkLl6xBdYc@dpg-dai8lo0ae00c73dlk1rg-a/audio_db_n28a";

const JWT_SECRET =
    process.env.JWT_SECRET ||
    "CHANGE_ME_IN_RENDER";

const ADMIN_EMAIL =
    process.env.ADMIN_EMAIL || "";

const ADMIN_SECRET =
    process.env.ADMIN_SECRET || "";

const ELEVENLABS_API_KEY =
    process.env.ELEVENLABS_API_KEY || "sk_5e371bcffb2b4762ea4c6247699dfe32ec06092590143a86";

const ELEVENLABS_DEFAULT_VOICE_ID =
    process.env.ELEVENLABS_DEFAULT_VOICE_ID ||
    "mQS95w8LbLFsF6QihxDH";

const ELEVENLABS_MODEL_ID =
    process.env.ELEVENLABS_MODEL_ID ||
    "eleven_v3";

const ELEVENLABS_FAST_MODEL_ID =
    process.env.ELEVENLABS_FAST_MODEL_ID ||
    "eleven_flash_v2_5";

const DEFAULT_AUDIO_FORMAT =
    process.env.DEFAULT_AUDIO_FORMAT ||
    "mp3_44100_128";

const MAX_TEXT_LENGTH =
    Number(process.env.MAX_TEXT_LENGTH || 50000);

const TTS_CHUNK_SIZE =
    Number(process.env.TTS_CHUNK_SIZE || 4500);

/* ============================================================
   QUOTAS
============================================================ */

const PLAN_QUOTAS = {
    free: 10000,
    standard: 100000,
    premium: 1000000
};

/* ============================================================
   CORS
============================================================ */

const allowedOrigins = [
    "https://bmjservice.com",
    "https://www.bmjservice.com",
    "https://eseay.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5500",
    "http://localhost:5500"
];

app.use(
    cors({
        origin: function (origin, callback) {

            if (!origin) {
                return callback(null, true);
            }

            if (
                allowedOrigins.includes(origin) ||
                process.env.NODE_ENV !== "production"
            ) {
                return callback(null, true);
            }

            return callback(
                new Error(
                    "Origine non autorisée par CORS."
                )
            );
        },

        methods: [
            "GET",
            "POST",
            "PATCH",
            "PUT",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "x-admin-token"
        ],

        credentials: true
    })
);

app.options("*", cors());

/* ============================================================
   BODY PARSER
============================================================ */

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
   LOGS
============================================================ */

app.use((req, res, next) => {

    const started = Date.now();

    res.on("finish", () => {

        const duration =
            Date.now() - started;

        console.log(
            `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
        );
    });

    next();
});

/* ============================================================
   POSTGRESQL
============================================================ */

if (!DATABASE_URL) {

    console.error(
        "❌ DATABASE_URL n'est pas configurée."
    );
}

const pool = new Pool({
    connectionString: DATABASE_URL,

    ssl:
        process.env.NODE_ENV === "production"
            ? {
                rejectUnauthorized: false
            }
            : false,

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {

    console.error(
        "❌ Erreur PostgreSQL inattendue :",
        error.message
    );
});

/* ============================================================
   OUTILS
============================================================ */

function sendSuccess(
    res,
    data = {},
    status = 200
) {

    return res.status(status).json({
        success: true,
        ...data
    });
}


function sendError(
    res,
    message,
    status = 500,
    extra = {}
) {

    return res.status(status).json({
        success: false,
        message,
        ...extra
    });
}


function normalizeEmail(email) {

    return String(email || "")
        .trim()
        .toLowerCase();
}


function safeNumber(value, fallback = 0) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function clamp(
    value,
    min,
    max
) {

    return Math.min(
        max,
        Math.max(min, value)
    );
}


function getClientIp(req) {

    const forwarded =
        req.headers["x-forwarded-for"];

    if (forwarded) {

        return String(forwarded)
            .split(",")[0]
            .trim();
    }

    return (
        req.ip ||
        req.socket?.remoteAddress ||
        ""
    );
}


/* ============================================================
   JWT
============================================================ */

function createToken(payload) {

    return jwt.sign(
        payload,
        JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );
}


function getBearerToken(req) {

    const authorization =
        req.headers.authorization || "";

    if (
        authorization &&
        authorization.startsWith("Bearer ")
    ) {

        return authorization.substring(7).trim();
    }

    const headerToken =
        req.headers["x-admin-token"];

    if (headerToken) {
        return String(headerToken).trim();
    }

    return "";
}


/* ============================================================
   AUTH UTILISATEUR
============================================================ */

async function authenticateUser(
    req,
    res,
    next
) {

    try {

        const token =
            getBearerToken(req);

        if (!token) {

            return sendError(
                res,
                "Authentification requise.",
                401
            );
        }

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        if (
            !decoded ||
            !decoded.user_id
        ) {

            return sendError(
                res,
                "Token utilisateur invalide.",
                401
            );
        }

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
                [decoded.user_id]
            );

        if (!result.rows.length) {

            return sendError(
                res,
                "Utilisateur introuvable.",
                401
            );
        }

        const user =
            result.rows[0];

        if (user.is_blocked) {

            return sendError(
                res,
                "Votre compte est bloqué.",
                403
            );
        }

        if (
            user.is_active === false
        ) {

            return sendError(
                res,
                "Votre compte est désactivé.",
                403
            );
        }

        req.user = user;

        next();

    } catch (error) {

        console.error(
            "AUTH USER ERROR:",
            error.message
        );

        if (
            error.name ===
            "TokenExpiredError"
        ) {

            return sendError(
                res,
                "Token expiré. Veuillez vous reconnecter.",
                401
            );
        }

        return sendError(
            res,
            "Token invalide.",
            401
        );
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

        const token =
            getBearerToken(req);

        if (!token) {

            return sendError(
                res,
                "Authentification administrateur requise.",
                401
            );
        }

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        if (
            !decoded ||
            decoded.role !== "admin"
        ) {

            return sendError(
                res,
                "Accès administrateur refusé.",
                403
            );
        }

        req.admin = decoded;

        next();

    } catch (error) {

        console.error(
            "ADMIN AUTH ERROR:",
            error.message
        );

        return sendError(
            res,
            "Token administrateur invalide ou expiré.",
            401
        );
    }
}


/* ============================================================
   ELEVENLABS
============================================================ */

function elevenLabsConfigured() {

    return Boolean(
        ELEVENLABS_API_KEY &&
        ELEVENLABS_API_KEY.trim()
    );
}


/* ============================================================
   ELEVENLABS REQUEST
============================================================ */

async function elevenLabsRequest(
    url,
    options = {}
) {

    if (!elevenLabsConfigured()) {

        throw new Error(
            "ELEVENLABS_API_KEY n'est pas configurée dans Render."
        );
    }

    const response =
        await fetch(
            url,
            {
                ...options,

                headers: {
                    "xi-api-key":
                        ELEVENLABS_API_KEY,

                    "Content-Type":
                        "application/json",

                    ...(options.headers || {})
                }
            }
        );

    return response;
}


/* ============================================================
   TEST ELEVENLABS
============================================================ */

async function testElevenLabsConnection() {

    if (!elevenLabsConfigured()) {

        return {
            configured: false,
            success: false,
            message:
                "ELEVENLABS_API_KEY absente."
        };
    }

    try {

        const response =
            await elevenLabsRequest(
                "https://api.elevenlabs.io/v1/user"
            );

        if (!response.ok) {

            const text =
                await response.text();

            return {
                configured: true,
                success: false,
                status: response.status,
                message: text
            };
        }

        const data =
            await response.json();

        return {
            configured: true,
            success: true,
            user: data
        };

    } catch (error) {

        return {
            configured: true,
            success: false,
            message: error.message
        };
    }
}


/* ============================================================
   RÉCUPÉRER LES VOIX ELEVENLABS
============================================================ */

async function fetchElevenLabsVoices() {

    const response =
        await elevenLabsRequest(
            "https://api.elevenlabs.io/v1/voices"
        );

    const contentType =
        response.headers.get(
            "content-type"
        ) || "";

    if (!response.ok) {

        let message =
            "Impossible de récupérer les voix ElevenLabs.";

        if (
            contentType.includes(
                "application/json"
            )
        ) {

            try {

                const data =
                    await response.json();

                message =
                    data.detail?.message ||
                    data.detail ||
                    message;

            } catch (_) {}
        } else {

            try {

                const text =
                    await response.text();

                if (text) {
                    message = text;
                }

            } catch (_) {}
        }

        const error =
            new Error(message);

        error.status =
            response.status;

        throw error;
    }

    return response.json();
}


/* ============================================================
   SYNCHRONISATION DES VOIX
============================================================ */

async function syncElevenLabsVoices() {

    console.log(
        "🎙️ Synchronisation des voix ElevenLabs..."
    );

    if (!elevenLabsConfigured()) {

        console.warn(
            "⚠️ ElevenLabs non configuré."
        );

        return 0;
    }

    try {

        const data =
            await fetchElevenLabsVoices();

        const voices =
            Array.isArray(data.voices)
                ? data.voices
                : [];

        console.log(
            `🎙️ ElevenLabs a retourné ${voices.length} voix.`
        );

        let inserted = 0;

        for (const voice of voices) {

            if (!voice.voice_id) {
                continue;
            }

            const labels =
                voice.labels || {};

            const verifiedLanguages =
                Array.isArray(
                    voice.verified_languages
                )
                    ? voice.verified_languages
                    : [];

            let language = "";

            if (
                verifiedLanguages.length
            ) {

                language =
                    verifiedLanguages[0]
                        ?.language_code ||
                    verifiedLanguages[0]
                        ?.language ||
                    "";
            }

            if (!language) {

                language =
                    labels.language ||
                    labels.accent ||
                    "";
            }

            const languageName =
                labels.language ||
                language ||
                "";

            const gender =
                labels.gender ||
                "";

            const description =
                voice.description ||
                labels.description ||
                "";

            const previewUrl =
                voice.preview_url ||
                null;

            const isPremium =
                Boolean(
                    labels.premium === "true" ||
                    labels.premium === true
                );

            await pool.query(
                `
                INSERT INTO voices (
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
                    created_at,
                    updated_at
                )
                VALUES (
                    $1,$2,'elevenlabs',
                    $3,$4,$5,$6,$7,
                    true,$8,NOW(),NOW()
                )
                ON CONFLICT (
                    external_voice_id
                )
                DO UPDATE SET
                    name = EXCLUDED.name,
                    gender = EXCLUDED.gender,
                    language = EXCLUDED.language,
                    language_name = EXCLUDED.language_name,
                    description = EXCLUDED.description,
                    preview_url = EXCLUDED.preview_url,
                    is_premium = EXCLUDED.is_premium,
                    updated_at = NOW()
                `,
                [
                    voice.voice_id,
                    voice.name ||
                        `Voix ${voice.voice_id}`,
                    gender,
                    language,
                    languageName,
                    description,
                    previewUrl,
                    isPremium
                ]
            );

            inserted++;
        }

        console.log(
            `✅ ${inserted} voix synchronisées.`
        );

        return inserted;

    } catch (error) {

        console.error(
            "❌ ERREUR SYNCHRONISATION VOIX:",
            error.message
        );

        return 0;
    }
}


/* ============================================================
   TROUVER LA MEILLEURE VOIX
============================================================ */

async function getBestVoice(
    requestedVoiceId = ""
) {

    const requested =
        String(
            requestedVoiceId || ""
        ).trim();

    /* --------------------------------------------------------
       1. VOIX DEMANDÉE DANS LA DB
    -------------------------------------------------------- */

    if (requested) {

        const result =
            await pool.query(
                `
                SELECT *
                FROM voices
                WHERE external_voice_id = $1
                  AND is_active = true
                LIMIT 1
                `,
                [requested]
            );

        if (result.rows.length) {

            return result.rows[0];
        }

        /*
         * Même si la voix n'est pas dans notre table,
         * ElevenLabs peut quand même la connaître.
         */
        return {
            external_voice_id: requested,
            name: "Voix ElevenLabs",
            provider: "elevenlabs",
            is_active: true,
            is_premium: false
        };
    }


    /* --------------------------------------------------------
       2. VOIX PAR DÉFAUT
    -------------------------------------------------------- */

    if (ELEVENLABS_DEFAULT_VOICE_ID) {

        const result =
            await pool.query(
                `
                SELECT *
                FROM voices
                WHERE external_voice_id = $1
                  AND is_active = true
                LIMIT 1
                `,
                [
                    ELEVENLABS_DEFAULT_VOICE_ID
                ]
            );

        if (result.rows.length) {

            return result.rows[0];
        }

        return {
            external_voice_id:
                ELEVENLABS_DEFAULT_VOICE_ID,

            name:
                "Voix par défaut ElevenLabs",

            provider:
                "elevenlabs",

            is_active: true,

            is_premium: false
        };
    }


    /* --------------------------------------------------------
       3. PREMIÈRE VOIX DB
    -------------------------------------------------------- */

    let result =
        await pool.query(
            `
            SELECT *
            FROM voices
            WHERE is_active = true
            ORDER BY
                is_premium ASC,
                name ASC
            LIMIT 1
            `
        );

    if (result.rows.length) {

        return result.rows[0];
    }


    /* --------------------------------------------------------
       4. SYNCHRONISATION AUTOMATIQUE
    -------------------------------------------------------- */

    await syncElevenLabsVoices();


    /* --------------------------------------------------------
       5. RETENTER
    -------------------------------------------------------- */

    result =
        await pool.query(
            `
            SELECT *
            FROM voices
            WHERE is_active = true
            ORDER BY
                is_premium ASC,
                name ASC
            LIMIT 1
            `
        );

    if (result.rows.length) {

        return result.rows[0];
    }


    throw new Error(
        "Aucune voix ElevenLabs disponible. Vérifiez ELEVENLABS_API_KEY et ELEVENLABS_DEFAULT_VOICE_ID."
    );
}


/* ============================================================
   GÉNÉRATION ELEVENLABS
============================================================ */

async function generateElevenLabsAudio({
    text,
    voiceId,
    modelId,
    language,
    speed,
    stability,
    similarityBoost,
    style
}) {

    if (!elevenLabsConfigured()) {

        throw new Error(
            "ElevenLabs n'est pas configuré."
        );
    }

    const cleanText =
        String(text || "").trim();

    if (!cleanText) {

        throw new Error(
            "Le texte à convertir est vide."
        );
    }

    const selectedModel =
        modelId ||
        ELEVENLABS_MODEL_ID;

    const selectedSpeed =
        clamp(
            safeNumber(speed, 1),
            0.7,
            1.2
        );

    const selectedStability =
        clamp(
            safeNumber(
                stability,
                0.5
            ),
            0,
            1
        );

    const selectedSimilarity =
        clamp(
            safeNumber(
                similarityBoost,
                0.75
            ),
            0,
            1
        );

    const selectedStyle =
        clamp(
            safeNumber(
                style,
                0
            ),
            0,
            1
        );

    const url =
        new URL(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
                voiceId
            )}`
        );

    /*
     * IMPORTANT :
     * output_format est passé dans la QUERY,
     * pas dans le JSON.
     */
    url.searchParams.set(
        "output_format",
        DEFAULT_AUDIO_FORMAT
    );


    const body = {

        text: cleanText,

        model_id: selectedModel,

        voice_settings: {

            stability:
                selectedStability,

            similarity_boost:
                selectedSimilarity,

            style:
                selectedStyle,

            speed:
                selectedSpeed
        }
    };


    if (language) {

        body.language_code =
            String(language)
                .trim()
                .toLowerCase();
    }


    /* ========================================================
       PREMIER ESSAI
    ======================================================== */

    let response =
        await elevenLabsRequest(
            url.toString(),
            {
                method: "POST",

                body:
                    JSON.stringify(body)
            }
        );


    /* ========================================================
       FALLBACK
       Certains modèles/voix peuvent refuser certains
       paramètres voice_settings.
    ======================================================== */

    if (
        response.status === 400 ||
        response.status === 422
    ) {

        let errorText = "";

        try {

            errorText =
                await response.text();

        } catch (_) {}

        console.warn(
            "⚠️ ElevenLabs a refusé les voice_settings. Nouvelle tentative minimale."
        );

        response =
            await elevenLabsRequest(
                url.toString(),
                {
                    method: "POST",

                    body:
                        JSON.stringify({
                            text: cleanText,
                            model_id: selectedModel
                        })
                }
            );

        if (!response.ok) {

            let secondError = "";

            try {

                secondError =
                    await response.text();

            } catch (_) {}

            throw new Error(
                `ElevenLabs ${response.status}: ${
                    secondError ||
                    errorText ||
                    "Erreur de génération audio."
                }`
            );
        }
    }


    if (!response.ok) {

        let errorMessage = "";

        try {

            const contentType =
                response.headers.get(
                    "content-type"
                ) || "";

            if (
                contentType.includes(
                    "application/json"
                )
            ) {

                const data =
                    await response.json();

                errorMessage =
                    data.detail?.message ||
                    data.detail ||
                    JSON.stringify(data);

            } else {

                errorMessage =
                    await response.text();
            }

        } catch (_) {}

        throw new Error(
            `ElevenLabs ${response.status}: ${
                errorMessage ||
                "Erreur de génération audio."
            }`
        );
    }


    const arrayBuffer =
        await response.arrayBuffer();

    const buffer =
        Buffer.from(arrayBuffer);


    if (!buffer.length) {

        throw new Error(
            "ElevenLabs a retourné un audio vide."
        );
    }


    return {
        buffer,
        contentType:
            "audio/mpeg",

        format:
            "mp3",

        model:
            selectedModel
    };
}


/* ============================================================
   DÉCOUPAGE DU TEXTE
============================================================ */

function splitText(
    text,
    maxLength = TTS_CHUNK_SIZE
) {

    const clean =
        String(text || "")
            .trim();

    if (
        clean.length <= maxLength
    ) {

        return [clean];
    }

    const chunks = [];

    let remaining =
        clean;


    while (
        remaining.length >
        maxLength
    ) {

        let cut =
            remaining.lastIndexOf(
                "\n",
                maxLength
            );

        if (
            cut < maxLength * 0.5
        ) {

            cut =
                remaining.lastIndexOf(
                    ". ",
                    maxLength
                );
        }

        if (
            cut < maxLength * 0.5
        ) {

            cut =
                remaining.lastIndexOf(
                    " ",
                    maxLength
                );
        }

        if (cut <= 0) {

            cut = maxLength;
        }

        chunks.push(
            remaining
                .slice(0, cut)
                .trim()
        );

        remaining =
            remaining
                .slice(cut)
                .trim();
    }


    if (remaining) {

        chunks.push(
            remaining
        );
    }

    return chunks.filter(Boolean);
}


/* ============================================================
   TABLES DATABASE
============================================================ */

async function initializeDatabase() {

    console.log(
        "🗄️ Initialisation PostgreSQL..."
    );

    const client =
        await pool.connect();

    try {

        await client.query(
            "CREATE EXTENSION IF NOT EXISTS pgcrypto"
        );


        /* ====================================================
           USERS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                nom VARCHAR(150) NOT NULL,

                email VARCHAR(255)
                    UNIQUE NOT NULL,

                password_hash TEXT NOT NULL,

                photo TEXT,

                role VARCHAR(30)
                    NOT NULL DEFAULT 'user',

                plan VARCHAR(30)
                    NOT NULL DEFAULT 'free',

                is_active BOOLEAN
                    NOT NULL DEFAULT true,

                is_blocked BOOLEAN
                    NOT NULL DEFAULT false,

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                last_login_at TIMESTAMPTZ
            )
        `);


        /* ====================================================
           VOICES
        ==================================================== */

        await client.query(`
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
                    NOT NULL DEFAULT true,

                is_premium BOOLEAN
                    NOT NULL DEFAULT false,

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
            )
        `);


        /* ====================================================
           PROJECTS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                user_id UUID
                    NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,

                title VARCHAR(255)
                    NOT NULL,

                description TEXT,

                language VARCHAR(50),

                status VARCHAR(50)
                    NOT NULL DEFAULT 'draft',

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
            )
        `);


        /* ====================================================
           AUDIO GENERATIONS
        ==================================================== */

        await client.query(`
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

                format VARCHAR(30)
                    NOT NULL DEFAULT 'mp3',

                audio_url TEXT,

                audio_path TEXT,

                audio_chunks JSONB,

                duration_seconds NUMERIC,

                character_count INTEGER
                    NOT NULL DEFAULT 0,

                chunk_count INTEGER
                    NOT NULL DEFAULT 1,

                status VARCHAR(30)
                    NOT NULL DEFAULT 'processing',

                error TEXT,

                request_id VARCHAR(255),

                provider_character_count INTEGER,

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
            )
        `);


        /* ====================================================
           USAGE
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS usage_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                user_id UUID
                    NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,

                period VARCHAR(7)
                    NOT NULL,

                characters_used BIGINT
                    NOT NULL DEFAULT 0,

                generations_count INTEGER
                    NOT NULL DEFAULT 0,

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                UNIQUE(user_id, period)
            )
        `);


        /* ====================================================
           USER QUOTAS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_quotas (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                user_id UUID
                    UNIQUE
                    NOT NULL
                    REFERENCES users(id)
                    ON DELETE CASCADE,

                monthly_limit BIGINT
                    NOT NULL DEFAULT 10000,

                characters_used BIGINT
                    NOT NULL DEFAULT 0,

                reset_date DATE,

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW(),

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
            )
        `);


        /* ====================================================
           ADMIN ACTIVITY
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_activity (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                admin_user_id UUID,

                action VARCHAR(100)
                    NOT NULL,

                description TEXT,

                ip_address VARCHAR(255),

                user_agent TEXT,

                created_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
            )
        `);


        /* ====================================================
           SYSTEM SETTINGS
        ==================================================== */

        await client.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                setting_key VARCHAR(150)
                    UNIQUE NOT NULL,

                setting_value TEXT,

                description TEXT,

                updated_at TIMESTAMPTZ
                    NOT NULL DEFAULT NOW()
            )
        `);


        /* ====================================================
           INDEX
        ==================================================== */

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_users_email
            ON users(email)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_generations_user
            ON audio_generations(user_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_generations_created
            ON audio_generations(created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_voices_active
            ON voices(is_active)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS
            idx_projects_user
            ON projects(user_id)
        `);


        /* ====================================================
           SETTINGS PAR DÉFAUT
        ==================================================== */

        const settings = [

            [
                "app_name",
                APP_NAME,
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
                "free_monthly_quota",
                String(PLAN_QUOTAS.free),
                "Quota mensuel Free"
            ],

            [
                "standard_monthly_quota",
                String(PLAN_QUOTAS.standard),
                "Quota mensuel Standard"
            ],

            [
                "premium_monthly_quota",
                String(PLAN_QUOTAS.premium),
                "Quota mensuel Premium"
            ],

            [
                "default_audio_format",
                DEFAULT_AUDIO_FORMAT,
                "Format audio par défaut"
            ]
        ];


        for (
            const [
                key,
                value,
                description
            ]
            of settings
        ) {

            await client.query(
                `
                INSERT INTO system_settings (
                    setting_key,
                    setting_value,
                    description
                )
                VALUES ($1,$2,$3)
                ON CONFLICT (
                    setting_key
                )
                DO NOTHING
                `,
                [
                    key,
                    value,
                    description
                ]
            );
        }


        /* ====================================================
           MIGRATIONS DE SÉCURITÉ
        ==================================================== */

        await client.query(`
            ALTER TABLE audio_generations
            ADD COLUMN IF NOT EXISTS
            audio_chunks JSONB
        `);


        console.log(
            "✅ Base de données prête."
        );

    } finally {

        client.release();
    }
}


/* ============================================================
   QUOTA UTILISATEUR
============================================================ */

function currentPeriod() {

    const now =
        new Date();

    const year =
        now.getUTCFullYear();

    const month =
        String(
            now.getUTCMonth() + 1
        ).padStart(2, "0");

    return `${year}-${month}`;
}


async function getUserQuota(
    user
) {

    const plan =
        PLAN_QUOTAS[user.plan]
            ? user.plan
            : "free";

    const monthlyLimit =
        PLAN_QUOTAS[plan];

    const period =
        currentPeriod();


    const usage =
        await pool.query(
            `
            SELECT *
            FROM usage_records
            WHERE user_id = $1
              AND period = $2
            LIMIT 1
            `,
            [
                user.id,
                period
            ]
        );


    let charactersUsed = 0;
    let generationsCount = 0;


    if (usage.rows.length) {

        charactersUsed =
            Number(
                usage.rows[0]
                    .characters_used || 0
            );

        generationsCount =
            Number(
                usage.rows[0]
                    .generations_count || 0
            );
    }


    return {

        plan,

        monthlyLimit,

        charactersUsed,

        generationsCount,

        remaining:
            Math.max(
                0,
                monthlyLimit -
                charactersUsed
            ),

        period
    };
}


/* ============================================================
   AJOUT USAGE
============================================================ */

async function addUsage(
    userId,
    characterCount
) {

    const period =
        currentPeriod();

    await pool.query(
        `
        INSERT INTO usage_records (
            user_id,
            period,
            characters_used,
            generations_count,
            created_at,
            updated_at
        )
        VALUES (
            $1,$2,$3,1,NOW(),NOW()
        )

        ON CONFLICT (
            user_id,
            period
        )

        DO UPDATE SET
            characters_used =
                usage_records.characters_used
                + EXCLUDED.characters_used,

            generations_count =
                usage_records.generations_count
                + 1,

            updated_at = NOW()
        `,
        [
            userId,
            period,
            characterCount
        ]
    );


    const userResult =
        await pool.query(
            `
            SELECT plan
            FROM users
            WHERE id = $1
            LIMIT 1
            `,
            [userId]
        );


    if (userResult.rows.length) {

        const plan =
            userResult.rows[0].plan;

        const limit =
            PLAN_QUOTAS[plan] ||
            PLAN_QUOTAS.free;


        await pool.query(
            `
            INSERT INTO user_quotas (
                user_id,
                monthly_limit,
                characters_used,
                reset_date,
                created_at,
                updated_at
            )
            VALUES (
                $1,$2,$3,
                DATE_TRUNC(
                    'month',
                    CURRENT_DATE
                ) + INTERVAL '1 month'
                - INTERVAL '1 day',
                NOW(),
                NOW()
            )

            ON CONFLICT (
                user_id
            )

            DO UPDATE SET

                monthly_limit =
                    EXCLUDED.monthly_limit,

                characters_used =
                    EXCLUDED.characters_used,

                reset_date =
                    EXCLUDED.reset_date,

                updated_at = NOW()
            `,
            [
                userId,
                limit,
                characterCount
            ]
        );
    }
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
            INSERT INTO admin_activity (
                admin_user_id,
                action,
                description,
                ip_address,
                user_agent
            )
            VALUES ($1,$2,$3,$4,$5)
            `,
            [
                req.admin?.user_id ||
                    null,

                action,

                description,

                getClientIp(req),

                req.headers[
                    "user-agent"
                ] || ""
            ]
        );

    } catch (error) {

        console.error(
            "ADMIN ACTIVITY ERROR:",
            error.message
        );
    }
}


/* ============================================================
   ROOT
============================================================ */

app.get(
    "/",
    (req, res) => {

        return res.json({

            success: true,

            name:
                APP_NAME,

            message:
                "BMJ VOICE AI API active",

            version:
                "1.0.0",

            environment:
                NODE_ENV,

            public_url:
                PUBLIC_BASE_URL,

            elevenlabs:
                elevenLabsConfigured()
                    ? "configured"
                    : "not_configured"
        });
    }
);


/* ============================================================
   HEALTH
============================================================ */

app.get(
    "/api/health",
    async (req, res) => {

        let database =
            false;

        try {

            await pool.query(
                "SELECT 1"
            );

            database = true;

        } catch (_) {}

        return res.json({

            success:
                database,

            api:
                true,

            database,

            elevenlabs:
                elevenLabsConfigured(),

            name:
                APP_NAME,

            environment:
                NODE_ENV,

            time:
                new Date().toISOString()
        });
    }
);


/* ============================================================
   TEST DATABASE
============================================================ */

app.get(
    "/api/test-db",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        NOW() AS server_time,
                        current_database()
                        AS database_name
                    `
                );

            return sendSuccess(
                res,
                {
                    database:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   TEST ELEVENLABS
============================================================ */

app.get(
    "/api/elevenlabs/status",
    async (req, res) => {

        const result =
            await testElevenLabsConnection();

        return res.json({
            success:
                result.success,

            configured:
                result.configured,

            default_voice:
                ELEVENLABS_DEFAULT_VOICE_ID,

            model:
                ELEVENLABS_MODEL_ID,

            fast_model:
                ELEVENLABS_FAST_MODEL_ID,

            details:
                result.success
                    ? "ElevenLabs connecté."
                    : result.message
        });
    }
);


/* ============================================================
   AUTH - INSCRIPTION
============================================================ */

app.post(
    "/api/auth/register",
    async (req, res) => {

        try {

            const {
                nom,
                email,
                password,
                photo
            } = req.body;


            const cleanName =
                String(
                    nom || ""
                ).trim();

            const cleanEmail =
                normalizeEmail(email);

            const cleanPassword =
                String(
                    password || ""
                );


            if (
                cleanName.length < 2
            ) {

                return sendError(
                    res,
                    "Le nom doit contenir au moins 2 caractères.",
                    400
                );
            }


            if (
                !cleanEmail ||
                !cleanEmail.includes("@")
            ) {

                return sendError(
                    res,
                    "Adresse email invalide.",
                    400
                );
            }


            if (
                cleanPassword.length < 6
            ) {

                return sendError(
                    res,
                    "Le mot de passe doit contenir au moins 6 caractères.",
                    400
                );
            }


            const existing =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE email = $1
                    LIMIT 1
                    `,
                    [cleanEmail]
                );


            if (existing.rows.length) {

                return sendError(
                    res,
                    "Cette adresse email est déjà utilisée.",
                    409
                );
            }


            const passwordHash =
                await bcrypt.hash(
                    cleanPassword,
                    12
                );


            const result =
                await pool.query(
                    `
                    INSERT INTO users (
                        nom,
                        email,
                        password_hash,
                        photo,
                        role,
                        plan,
                        is_active,
                        is_blocked,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        $1,$2,$3,$4,
                        'user',
                        'free',
                        true,
                        false,
                        NOW(),
                        NOW()
                    )
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
                        cleanName,
                        cleanEmail,
                        passwordHash,
                        photo || null
                    ]
                );


            const user =
                result.rows[0];


            await pool.query(
                `
                INSERT INTO user_quotas (
                    user_id,
                    monthly_limit,
                    characters_used,
                    reset_date
                )
                VALUES (
                    $1,
                    $2,
                    0,
                    DATE_TRUNC(
                        'month',
                        CURRENT_DATE
                    ) + INTERVAL '1 month'
                    - INTERVAL '1 day'
                )
                ON CONFLICT (
                    user_id
                )
                DO NOTHING
                `,
                [
                    user.id,
                    PLAN_QUOTAS.free
                ]
            );


            const token =
                createToken({

                    user_id:
                        user.id,

                    email:
                        user.email,

                    role:
                        "user"
                });


            return sendSuccess(
                res,
                {
                    message:
                        "Inscription réussie.",

                    token,

                    user
                },
                201
            );

        } catch (error) {

            console.error(
                "REGISTER ERROR:",
                error
            );

            if (
                error.code === "23505"
            ) {

                return sendError(
                    res,
                    "Cette adresse email existe déjà.",
                    409
                );
            }

            return sendError(
                res,
                "Erreur lors de l'inscription.",
                500
            );
        }
    }
);


/* ============================================================
   AUTH - CONNEXION
============================================================ */

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const {
                email,
                password
            } = req.body;


            const cleanEmail =
                normalizeEmail(email);

            const cleanPassword =
                String(
                    password || ""
                );


            if (
                !cleanEmail ||
                !cleanPassword
            ) {

                return sendError(
                    res,
                    "Email et mot de passe requis.",
                    400
                );
            }


            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM users
                    WHERE email = $1
                    LIMIT 1
                    `,
                    [cleanEmail]
                );


            if (!result.rows.length) {

                return sendError(
                    res,
                    "Email ou mot de passe incorrect.",
                    401
                );
            }


            const user =
                result.rows[0];


            if (
                user.is_blocked
            ) {

                return sendError(
                    res,
                    "Votre compte est bloqué.",
                    403
                );
            }


            if (
                user.is_active === false
            ) {

                return sendError(
                    res,
                    "Votre compte est désactivé.",
                    403
                );
            }


            const valid =
                await bcrypt.compare(
                    cleanPassword,
                    user.password_hash
                );


            if (!valid) {

                return sendError(
                    res,
                    "Email ou mot de passe incorrect.",
                    401
                );
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


            const token =
                createToken({

                    user_id:
                        user.id,

                    email:
                        user.email,

                    role:
                        user.role
                });


            delete user.password_hash;


            return sendSuccess(
                res,
                {
                    message:
                        "Connexion réussie.",

                    token,

                    user
                }
            );

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            return sendError(
                res,
                "Erreur lors de la connexion.",
                500
            );
        }
    }
);


/* ============================================================
   AUTH - ME
============================================================ */

app.get(
    "/api/auth/me",
    authenticateUser,
    async (req, res) => {

        try {

            const quota =
                await getUserQuota(
                    req.user
                );

            return sendSuccess(
                res,
                {
                    user:
                        req.user,

                    quota
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   AUTH - PROFILE
============================================================ */

app.patch(
    "/api/auth/profile",
    authenticateUser,
    async (req, res) => {

        try {

            const {
                nom,
                photo
            } = req.body;


            const newName =
                String(
                    nom ??
                    req.user.nom
                ).trim();


            if (
                newName.length < 2
            ) {

                return sendError(
                    res,
                    "Nom invalide.",
                    400
                );
            }


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        nom = $1,
                        photo = $2,
                        updated_at = NOW()
                    WHERE id = $3

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
                        newName,
                        photo ??
                            req.user.photo ??
                            null,
                        req.user.id
                    ]
                );


            return sendSuccess(
                res,
                {
                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   AUTH - PASSWORD
============================================================ */

app.patch(
    "/api/auth/password",
    authenticateUser,
    async (req, res) => {

        try {

            const {
                currentPassword,
                newPassword
            } = req.body;


            if (
                !currentPassword ||
                !newPassword
            ) {

                return sendError(
                    res,
                    "Ancien et nouveau mot de passe requis.",
                    400
                );
            }


            if (
                String(
                    newPassword
                ).length < 6
            ) {

                return sendError(
                    res,
                    "Le nouveau mot de passe doit contenir au moins 6 caractères.",
                    400
                );
            }


            const result =
                await pool.query(
                    `
                    SELECT password_hash
                    FROM users
                    WHERE id = $1
                    LIMIT 1
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

                return sendError(
                    res,
                    "Ancien mot de passe incorrect.",
                    401
                );
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
                    password_hash = $1,
                    updated_at = NOW()
                WHERE id = $2
                `,
                [
                    hash,
                    req.user.id
                ]
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Mot de passe modifié."
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
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

            let result =
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
                        created_at,
                        updated_at
                    FROM voices
                    WHERE is_active = true
                    ORDER BY
                        is_premium ASC,
                        name ASC
                    `
                );


            /*
             * Si la table est vide,
             * synchronisation automatique.
             */

            if (
                result.rows.length === 0 &&
                elevenLabsConfigured()
            ) {

                await syncElevenLabsVoices();

                result =
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
                            created_at,
                            updated_at
                        FROM voices
                        WHERE is_active = true
                        ORDER BY
                            is_premium ASC,
                            name ASC
                        `
                    );
            }


            return sendSuccess(
                res,
                {
                    voices:
                        result.rows,

                    count:
                        result.rows.length,

                    default_voice:
                        ELEVENLABS_DEFAULT_VOICE_ID
                }
            );

        } catch (error) {

            console.error(
                "VOICES ERROR:",
                error
            );

            return sendError(
                res,
                "Impossible de récupérer les voix.",
                500
            );
        }
    }
);


/* ============================================================
   TEST DES VOIX
============================================================ */

app.get(
    "/api/voices/test",
    async (req, res) => {

        try {

            const eleven =
                await testElevenLabsConnection();


            const db =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::INTEGER
                        AS total,

                        COUNT(*) FILTER (
                            WHERE is_active = true
                        )::INTEGER
                        AS active
                    FROM voices
                    `
                );


            return res.json({

                success:
                    eleven.success,

                configured:
                    eleven.configured,

                default_voice:
                    ELEVENLABS_DEFAULT_VOICE_ID,

                model:
                    ELEVENLABS_MODEL_ID,

                fast_model:
                    ELEVENLABS_FAST_MODEL_ID,

                database_voices:
                    db.rows[0],

                elevenlabs:
                    eleven.success
                        ? "OK"
                        : eleven.message
            });

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
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

            const {
                email,
                password
            } = req.body;


            const cleanEmail =
                normalizeEmail(email);


            if (
                !ADMIN_EMAIL ||
                !ADMIN_SECRET
            ) {

                return sendError(
                    res,
                    "ADMIN_EMAIL ou ADMIN_SECRET n'est pas configuré dans Render.",
                    500
                );
            }


            if (
                cleanEmail !==
                normalizeEmail(
                    ADMIN_EMAIL
                ) ||
                String(password || "") !==
                String(ADMIN_SECRET)
            ) {

                return sendError(
                    res,
                    "Identifiants administrateur incorrects.",
                    401
                );
            }


            const token =
                createToken({

                    user_id:
                        "admin",

                    email:
                        ADMIN_EMAIL,

                    role:
                        "admin"
                });


            return sendSuccess(
                res,
                {
                    message:
                        "Connexion administrateur réussie.",

                    token,

                    admin: {

                        email:
                            ADMIN_EMAIL,

                        role:
                            "admin"
                    }
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - VÉRIFICATION
============================================================ */

app.get(
    "/api/admin/me",
    adminAuth,
    async (req, res) => {

        return sendSuccess(
            res,
            {
                admin: {
                    email:
                        req.admin.email,

                    role:
                        req.admin.role
                }
            }
        );
    }
);


/* ============================================================
   ADMIN - SYNCHRONISATION VOIX
============================================================ */

app.post(
    "/api/admin/voices/sync",
    adminAuth,
    async (req, res) => {

        try {

            const count =
                await syncElevenLabsVoices();


            await logAdminActivity(
                req,
                "voices_sync",
                `${count} voix ElevenLabs synchronisées.`
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Voix synchronisées.",

                    count
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - LISTE VOIX
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

            return sendSuccess(
                res,
                {
                    voices:
                        result.rows
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - ACTIVER/DÉSACTIVER VOIX
============================================================ */

app.patch(
    "/api/admin/voices/:id/status",
    adminAuth,
    async (req, res) => {

        try {

            const {
                is_active
            } = req.body;


            const result =
                await pool.query(
                    `
                    UPDATE voices
                    SET
                        is_active = $1,
                        updated_at = NOW()
                    WHERE id = $2

                    RETURNING *
                    `,
                    [
                        Boolean(
                            is_active
                        ),
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Voix introuvable.",
                    404
                );
            }


            await logAdminActivity(
                req,
                "voice_status",
                `Voix ${req.params.id} : ${
                    is_active
                        ? "activée"
                        : "désactivée"
                }`
            );


            return sendSuccess(
                res,
                {
                    voice:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   GÉNÉRATION TTS
============================================================ */

app.post(
    "/api/tts/generate",
    authenticateUser,
    async (req, res) => {

        const started =
            Date.now();

        let generationId =
            null;


        try {

            const {
                text,
                language,
                voice_id,
                model_id,
                format,
                speed,
                stability,
                similarity_boost,
                similarityBoost,
                style,
                project_id
            } = req.body;


            /* =================================================
               TEXTE
            ================================================= */

            const cleanText =
                String(
                    text || ""
                ).trim();


            if (!cleanText) {

                return sendError(
                    res,
                    "Veuillez saisir un texte.",
                    400
                );
            }


            if (
                cleanText.length >
                MAX_TEXT_LENGTH
            ) {

                return sendError(
                    res,
                    `Le texte est trop long. Maximum ${MAX_TEXT_LENGTH} caractères.`,
                    400
                );
            }


            /* =================================================
               QUOTA
            ================================================= */

            const quota =
                await getUserQuota(
                    req.user
                );


            if (
                cleanText.length >
                quota.remaining
            ) {

                return sendError(
                    res,
                    "Quota mensuel insuffisant.",
                    429,
                    {
                        quota
                    }
                );
            }


            /* =================================================
               VOIX
            ================================================= */

            const voice =
                await getBestVoice(
                    voice_id
                );


            if (
                !voice ||
                !voice.external_voice_id
            ) {

                return sendError(
                    res,
                    "Aucune voix ElevenLabs disponible.",
                    503
                );
            }


            /* =================================================
               MODÈLE
            ================================================= */

            let selectedModel =
                model_id ||
                ELEVENLABS_MODEL_ID;


            if (
                selectedModel !==
                    ELEVENLABS_MODEL_ID &&
                selectedModel !==
                    ELEVENLABS_FAST_MODEL_ID
            ) {

                selectedModel =
                    ELEVENLABS_MODEL_ID;
            }


            /* =================================================
               FORMAT
            ================================================= */

            let selectedFormat =
                format ||
                DEFAULT_AUDIO_FORMAT;


            /*
             * Pour le moment le backend produit
             * du MP3 ElevenLabs.
             */

            if (
                !selectedFormat.startsWith(
                    "mp3_"
                )
            ) {

                selectedFormat =
                    DEFAULT_AUDIO_FORMAT;
            }


            /* =================================================
               PROJET
            ================================================= */

            let projectId =
                project_id ||
                null;


            if (projectId) {

                const project =
                    await pool.query(
                        `
                        SELECT id
                        FROM projects
                        WHERE id = $1
                          AND user_id = $2
                        LIMIT 1
                        `,
                        [
                            projectId,
                            req.user.id
                        ]
                    );


                if (
                    !project.rows.length
                ) {

                    projectId = null;
                }
            }


            /* =================================================
               INSERT GENERATION
            ================================================= */

            const generation =
                await pool.query(
                    `
                    INSERT INTO audio_generations (
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
                        created_at,
                        updated_at
                    )
                    VALUES (
                        $1,$2,$3,
                        'elevenlabs',
                        $4,$5,$5,$6,$7,$8,
                        $9,$10,
                        'processing',
                        NOW(),
                        NOW()
                    )
                    RETURNING id
                    `,
                    [
                        req.user.id,

                        projectId,

                        voice.id || null,

                        selectedModel,

                        cleanText,

                        language ||
                            null,

                        voice.external_voice_id,

                        "mp3",

                        cleanText.length,

                        1
                    ]
                );


            generationId =
                generation.rows[0].id;


            /* =================================================
               DÉCOUPAGE
            ================================================= */

            const chunks =
                splitText(
                    cleanText
                );


            await pool.query(
                `
                UPDATE audio_generations
                SET
                    chunk_count = $1,
                    updated_at = NOW()
                WHERE id = $2
                `,
                [
                    chunks.length,
                    generationId
                ]
            );


            /* =================================================
               GÉNÉRATION CHUNKS
            ================================================= */

            const audioChunks = [];


            for (
                let i = 0;
                i < chunks.length;
                i++
            ) {

                console.log(
                    `🎙️ Génération audio ${i + 1}/${chunks.length}`
                );


                const audio =
                    await generateElevenLabsAudio({

                        text:
                            chunks[i],

                        voiceId:
                            voice.external_voice_id,

                        modelId:
                            selectedModel,

                        language:
                            language || null,

                        speed,

                        stability,

                        similarityBoost:
                            similarity_boost ??
                            similarityBoost,

                        style
                    });


                const base64 =
                    audio.buffer.toString(
                        "base64"
                    );


                audioChunks.push({

                    index:
                        i,

                    text:
                        chunks[i],

                    mime:
                        "audio/mpeg",

                    format:
                        "mp3",

                    data:
                        `data:audio/mpeg;base64,${base64}`,

                    size:
                        audio.buffer.length
                });
            }


            /* =================================================
               AUDIO PRINCIPAL
            ================================================= */

            /*
             * Pour un texte court = un seul MP3 valide.
             *
             * Pour plusieurs morceaux, on conserve
             * les morceaux séparément au lieu de concaténer
             * des fichiers MP3 bruts, ce qui peut produire
             * un fichier invalide.
             */

            const firstAudio =
                audioChunks[0];


            const firstAudioUrl =
                firstAudio?.data || null;


            const chunksJson =
                JSON.stringify(
                    audioChunks
                );


            /* =================================================
               MISE À JOUR
            ================================================= */

            await pool.query(
                `
                UPDATE audio_generations
                SET
                    audio_url = $1,
                    audio_chunks = $2::jsonb,
                    status = 'completed',
                    provider_character_count = $3,
                    updated_at = NOW()
                WHERE id = $4
                `,
                [
                    firstAudioUrl,

                    chunksJson,

                    cleanText.length,

                    generationId
                ]
            );


            /* =================================================
               USAGE
            ================================================= */

            await addUsage(
                req.user.id,
                cleanText.length
            );


            /* =================================================
               RÉSULTAT
            ================================================= */

            const newQuota =
                await getUserQuota(
                    req.user
                );


            console.log(
                `✅ Audio généré en ${Date.now() - started}ms`
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Audio généré avec succès.",

                    generation_id:
                        generationId,

                    id:
                        generationId,

                    voice: {

                        id:
                            voice.id ||
                            null,

                        external_voice_id:
                            voice.external_voice_id,

                        name:
                            voice.name
                    },

                    model:
                        selectedModel,

                    format:
                        "mp3",

                    character_count:
                        cleanText.length,

                    chunk_count:
                        audioChunks.length,

                    audio_url:
                        firstAudioUrl,

                    audio:
                        firstAudioUrl,

                    audio_chunks:
                        audioChunks,

                    quota:
                        newQuota
                }
            );

        } catch (error) {

            console.error(
                "❌ TTS GENERATE ERROR:",
                error
            );


            if (generationId) {

                try {

                    await pool.query(
                        `
                        UPDATE audio_generations
                        SET
                            status = 'failed',
                            error = $1,
                            updated_at = NOW()
                        WHERE id = $2
                        `,
                        [
                            String(
                                error.message ||
                                error
                            ).slice(
                                0,
                                5000
                            ),

                            generationId
                        ]
                    );

                } catch (_) {}
            }


            let status =
                500;


            if (
                error.status === 401 ||
                error.status === 403
            ) {

                status =
                    error.status;
            }


            if (
                error.status === 429
            ) {

                status = 429;
            }


            if (
                error.status === 400 ||
                error.status === 422
            ) {

                status =
                    error.status;
            }


            return sendError(
                res,
                error.message ||
                    "Impossible de générer l'audio.",
                status
            );
        }
    }
);


/* ============================================================
   HISTORIQUE AUDIO
============================================================ */

app.get(
    "/api/audio",
    authenticateUser,
    async (req, res) => {

        try {

            const limit =
                clamp(
                    safeNumber(
                        req.query.limit,
                        50
                    ),
                    1,
                    100
                );


            const result =
                await pool.query(
                    `
                    SELECT
                        ag.id,
                        ag.project_id,
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
                        v.name AS voice_name
                    FROM audio_generations ag
                    LEFT JOIN voices v
                        ON v.id = ag.voice_id
                    WHERE ag.user_id = $1
                    ORDER BY
                        ag.created_at DESC
                    LIMIT $2
                    `,
                    [
                        req.user.id,
                        limit
                    ]
                );


            return sendSuccess(
                res,
                {
                    generations:
                        result.rows
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   AUDIO PAR ID
============================================================ */

app.get(
    "/api/audio/:id",
    authenticateUser,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        ag.*,
                        v.name AS voice_name
                    FROM audio_generations ag
                    LEFT JOIN voices v
                        ON v.id = ag.voice_id
                    WHERE ag.id = $1
                      AND ag.user_id = $2
                    LIMIT 1
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Audio introuvable.",
                    404
                );
            }


            return sendSuccess(
                res,
                {
                    generation:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   SUPPRIMER AUDIO
============================================================ */

app.delete(
    "/api/audio/:id",
    authenticateUser,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM audio_generations
                    WHERE id = $1
                      AND user_id = $2
                    RETURNING id
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Audio introuvable.",
                    404
                );
            }


            return sendSuccess(
                res,
                {
                    message:
                        "Audio supprimé.",

                    id:
                        req.params.id
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   USAGE
============================================================ */

app.get(
    "/api/usage",
    authenticateUser,
    async (req, res) => {

        try {

            const quota =
                await getUserQuota(
                    req.user
                );


            return sendSuccess(
                res,
                {
                    usage:
                        quota
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   PROJETS - CRÉER
============================================================ */

app.post(
    "/api/projects",
    authenticateUser,
    async (req, res) => {

        try {

            const {
                title,
                description,
                language
            } = req.body;


            const cleanTitle =
                String(
                    title || ""
                ).trim();


            if (!cleanTitle) {

                return sendError(
                    res,
                    "Titre du projet requis.",
                    400
                );
            }


            const result =
                await pool.query(
                    `
                    INSERT INTO projects (
                        user_id,
                        title,
                        description,
                        language,
                        status,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        $1,$2,$3,$4,
                        'draft',
                        NOW(),
                        NOW()
                    )
                    RETURNING *
                    `,
                    [
                        req.user.id,
                        cleanTitle,
                        description ||
                            null,
                        language ||
                            null
                    ]
                );


            return sendSuccess(
                res,
                {
                    project:
                        result.rows[0]
                },
                201
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   PROJETS - LISTE
============================================================ */

app.get(
    "/api/projects",
    authenticateUser,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        p.*,

                        (
                            SELECT COUNT(*)::INTEGER
                            FROM audio_generations ag
                            WHERE ag.project_id = p.id
                        ) AS generations_count

                    FROM projects p

                    WHERE p.user_id = $1

                    ORDER BY
                        p.created_at DESC
                    `,
                    [req.user.id]
                );


            return sendSuccess(
                res,
                {
                    projects:
                        result.rows
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   PROJET - SUPPRIMER
============================================================ */

app.delete(
    "/api/projects/:id",
    authenticateUser,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM projects
                    WHERE id = $1
                      AND user_id = $2
                    RETURNING id
                    `,
                    [
                        req.params.id,
                        req.user.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Projet introuvable.",
                    404
                );
            }


            return sendSuccess(
                res,
                {
                    message:
                        "Projet supprimé."
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   SETTINGS PUBLICS
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
                        setting_value,
                        description
                    FROM system_settings
                    ORDER BY
                        setting_key ASC
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


            return sendSuccess(
                res,
                {
                    settings
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - STATISTIQUES
============================================================ */

app.get(
    "/api/admin/statistiques",
    adminAuth,
    async (req, res) => {

        try {

            const [
                users,
                activeUsers,
                blockedUsers,
                generations,
                completed,
                failed,
                characters,
                voices,
                premium
            ] =
                await Promise.all([

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM users
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM users
                        WHERE is_active = true
                          AND is_blocked = false
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM users
                        WHERE is_blocked = true
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM audio_generations
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM audio_generations
                        WHERE status = 'completed'
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM audio_generations
                        WHERE status = 'failed'
                        `
                    ),

                    pool.query(
                        `
                        SELECT
                            COALESCE(
                                SUM(character_count),
                                0
                            )::BIGINT AS count
                        FROM audio_generations
                        WHERE status = 'completed'
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM voices
                        WHERE is_active = true
                        `
                    ),

                    pool.query(
                        `
                        SELECT COUNT(*)::INTEGER
                        AS count
                        FROM users
                        WHERE plan = 'premium'
                        `
                    )
                ]);


            return sendSuccess(
                res,
                {
                    statistiques: {

                        users:
                            Number(
                                users.rows[0]
                                    .count
                            ),

                        active_users:
                            Number(
                                activeUsers
                                    .rows[0]
                                    .count
                            ),

                        blocked_users:
                            Number(
                                blockedUsers
                                    .rows[0]
                                    .count
                            ),

                        generations:
                            Number(
                                generations
                                    .rows[0]
                                    .count
                            ),

                        completed_generations:
                            Number(
                                completed
                                    .rows[0]
                                    .count
                            ),

                        failed_generations:
                            Number(
                                failed
                                    .rows[0]
                                    .count
                            ),

                        characters:
                            Number(
                                characters
                                    .rows[0]
                                    .count
                            ),

                        voices:
                            Number(
                                voices.rows[0]
                                    .count
                            ),

                        premium_users:
                            Number(
                                premium
                                    .rows[0]
                                    .count
                            )
                    }
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - UTILISATEURS
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
                            (
                                SELECT
                                    SUM(
                                        ur.characters_used
                                    )
                                FROM usage_records ur
                                WHERE ur.user_id = u.id
                            ),
                            0
                        )::BIGINT
                        AS characters_used,

                        COALESCE(
                            (
                                SELECT
                                    COUNT(*)
                                FROM audio_generations ag
                                WHERE ag.user_id = u.id
                            ),
                            0
                        )::INTEGER
                        AS generations_count

                    FROM users u

                    ORDER BY
                        u.created_at DESC
                    `
                );


            return sendSuccess(
                res,
                {
                    users:
                        result.rows,

                    count:
                        result.rows.length
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - UTILISATEUR PAR ID
============================================================ */

app.get(
    "/api/admin/users/:id",
    adminAuth,
    async (req, res) => {

        try {

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
                    [req.params.id]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Utilisateur introuvable.",
                    404
                );
            }


            return sendSuccess(
                res,
                {
                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - BLOQUER
============================================================ */

app.patch(
    "/api/admin/users/:id/block",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        is_blocked = true,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING
                        id,
                        nom,
                        email,
                        plan,
                        is_blocked
                    `,
                    [req.params.id]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Utilisateur introuvable.",
                    404
                );
            }


            await logAdminActivity(
                req,
                "block_user",
                `Utilisateur ${req.params.id} bloqué.`
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Utilisateur bloqué.",

                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - DÉBLOQUER
============================================================ */

app.patch(
    "/api/admin/users/:id/unblock",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        is_blocked = false,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING
                        id,
                        nom,
                        email,
                        plan,
                        is_blocked
                    `,
                    [req.params.id]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Utilisateur introuvable.",
                    404
                );
            }


            await logAdminActivity(
                req,
                "unblock_user",
                `Utilisateur ${req.params.id} débloqué.`
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Utilisateur débloqué.",

                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - CHANGER PLAN
============================================================ */

app.patch(
    "/api/admin/users/:id/plan",
    adminAuth,
    async (req, res) => {

        try {

            const {
                plan
            } = req.body;


            const allowedPlans = [
                "free",
                "standard",
                "premium"
            ];


            if (
                !allowedPlans.includes(
                    plan
                )
            ) {

                return sendError(
                    res,
                    "Plan invalide.",
                    400
                );
            }


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        plan = $1,
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING
                        id,
                        nom,
                        email,
                        plan
                    `,
                    [
                        plan,
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Utilisateur introuvable.",
                    404
                );
            }


            await pool.query(
                `
                INSERT INTO user_quotas (
                    user_id,
                    monthly_limit,
                    characters_used,
                    reset_date
                )
                VALUES (
                    $1,$2,0,
                    DATE_TRUNC(
                        'month',
                        CURRENT_DATE
                    ) + INTERVAL '1 month'
                    - INTERVAL '1 day'
                )
                ON CONFLICT (
                    user_id
                )
                DO UPDATE SET
                    monthly_limit =
                        EXCLUDED.monthly_limit,

                    reset_date =
                        EXCLUDED.reset_date,

                    updated_at = NOW()
                `,
                [
                    req.params.id,
                    PLAN_QUOTAS[plan]
                ]
            );


            await logAdminActivity(
                req,
                "change_plan",
                `Utilisateur ${req.params.id} : plan ${plan}.`
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Plan utilisateur modifié.",

                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - ACTIVÉ / DÉSACTIVÉ
============================================================ */

app.patch(
    "/api/admin/users/:id/status",
    adminAuth,
    async (req, res) => {

        try {

            const {
                is_active
            } = req.body;


            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        is_active = $1,
                        updated_at = NOW()
                    WHERE id = $2
                    RETURNING
                        id,
                        nom,
                        email,
                        is_active
                    `,
                    [
                        Boolean(
                            is_active
                        ),
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Utilisateur introuvable.",
                    404
                );
            }


            await logAdminActivity(
                req,
                "user_status",
                `Utilisateur ${req.params.id} : ${
                    is_active
                        ? "activé"
                        : "désactivé"
                }`
            );


            return sendSuccess(
                res,
                {
                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - GÉNÉRATIONS
============================================================ */

app.get(
    "/api/admin/generations",
    adminAuth,
    async (req, res) => {

        try {

            const limit =
                clamp(
                    safeNumber(
                        req.query.limit,
                        100
                    ),
                    1,
                    500
                );


            const result =
                await pool.query(
                    `
                    SELECT
                        ag.id,
                        ag.user_id,
                        u.nom AS user_name,
                        u.email AS user_email,
                        ag.project_id,
                        ag.provider,
                        ag.model_id,
                        ag.original_text,
                        ag.language,
                        ag.voice_external_id,
                        v.name AS voice_name,
                        ag.format,
                        ag.character_count,
                        ag.chunk_count,
                        ag.status,
                        ag.error,
                        ag.created_at,
                        ag.updated_at
                    FROM audio_generations ag

                    JOIN users u
                        ON u.id = ag.user_id

                    LEFT JOIN voices v
                        ON v.id = ag.voice_id

                    ORDER BY
                        ag.created_at DESC

                    LIMIT $1
                    `,
                    [limit]
                );


            return sendSuccess(
                res,
                {
                    generations:
                        result.rows
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - ACTIVITÉS
============================================================ */

app.get(
    "/api/admin/activities",
    adminAuth,
    async (req, res) => {

        try {

            const limit =
                clamp(
                    safeNumber(
                        req.query.limit,
                        100
                    ),
                    1,
                    500
                );


            const result =
                await pool.query(
                    `
                    SELECT *
                    FROM admin_activity
                    ORDER BY
                        created_at DESC
                    LIMIT $1
                    `,
                    [limit]
                );


            return sendSuccess(
                res,
                {
                    activities:
                        result.rows
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - SETTINGS
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
                    ORDER BY
                        setting_key ASC
                    `
                );


            return sendSuccess(
                res,
                {
                    settings:
                        result.rows
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - MODIFIER SETTING
============================================================ */

app.patch(
    "/api/admin/settings/:key",
    adminAuth,
    async (req, res) => {

        try {

            const {
                value
            } = req.body;


            const result =
                await pool.query(
                    `
                    UPDATE system_settings
                    SET
                        setting_value = $1,
                        updated_at = NOW()
                    WHERE setting_key = $2
                    RETURNING *
                    `,
                    [
                        String(
                            value ?? ""
                        ),
                        req.params.key
                    ]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Paramètre introuvable.",
                    404
                );
            }


            await logAdminActivity(
                req,
                "setting_update",
                `Paramètre ${req.params.key} modifié.`
            );


            return sendSuccess(
                res,
                {
                    setting:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ADMIN - SUPPRIMER UTILISATEUR
============================================================ */

app.delete(
    "/api/admin/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    DELETE FROM users
                    WHERE id = $1
                    RETURNING
                        id,
                        nom,
                        email
                    `,
                    [req.params.id]
                );


            if (
                !result.rows.length
            ) {

                return sendError(
                    res,
                    "Utilisateur introuvable.",
                    404
                );
            }


            await logAdminActivity(
                req,
                "delete_user",
                `Utilisateur ${req.params.id} supprimé.`
            );


            return sendSuccess(
                res,
                {
                    message:
                        "Utilisateur supprimé.",

                    user:
                        result.rows[0]
                }
            );

        } catch (error) {

            return sendError(
                res,
                error.message,
                500
            );
        }
    }
);


/* ============================================================
   ERREUR 404
============================================================ */

app.use(
    (req, res) => {

        return res.status(404).json({

            success: false,

            message:
                "Route API introuvable.",

            method:
                req.method,

            path:
                req.originalUrl
        });
    }
);


/* ============================================================
   GESTION ERREUR GLOBALE
============================================================ */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(error);
        }


        if (
            error.message &&
            error.message.includes(
                "CORS"
            )
        ) {

            return sendError(
                res,
                error.message,
                403
            );
        }


        return sendError(
            res,
            "Erreur interne du serveur.",
            500
        );
    }
);


/* ============================================================
   DÉMARRAGE
============================================================ */

async function startServer() {

    try {

        console.log(
            "================================================"
        );

        console.log(
            "🚀 DÉMARRAGE BMJ VOICE AI"
        );

        console.log(
            "================================================"
        );

        console.log(
            `🌍 Environment : ${NODE_ENV}`
        );

        console.log(
            `🌐 URL publique : ${PUBLIC_BASE_URL}`
        );

        console.log(
            `🎙️ ElevenLabs : ${
                elevenLabsConfigured()
                    ? "CONFIGURÉ"
                    : "NON CONFIGURÉ"
            }`
        );

        console.log(
            `🎙️ Modèle principal : ${ELEVENLABS_MODEL_ID}`
        );

        console.log(
            `⚡ Modèle rapide : ${ELEVENLABS_FAST_MODEL_ID}`
        );

        console.log(
            `🎙️ Voix par défaut : ${ELEVENLABS_DEFAULT_VOICE_ID}`
        );


        /* ====================================================
           DATABASE
        ==================================================== */

        await initializeDatabase();


        /* ====================================================
           VÉRIFICATION ELEVENLABS
        ==================================================== */

        if (
            elevenLabsConfigured()
        ) {

            console.log(
                "🎙️ Vérification ElevenLabs..."
            );


            const eleven =
                await testElevenLabsConnection();


            if (
                eleven.success
            ) {

                console.log(
                    "✅ Connexion ElevenLabs OK."
                );


                /*
                 * Synchronisation automatique au démarrage.
                 */
                const count =
                    await syncElevenLabsVoices();


                console.log(
                    `🎙️ Voix disponibles en base : ${count}`
                );

            } else {

                console.error(
                    "❌ ElevenLabs ne répond pas correctement :",
                    eleven.message
                );
            }

        } else {

            console.warn(
                "⚠️ ELEVENLABS_API_KEY absente."
            );
        }


        /* ====================================================
           SERVER
        ==================================================== */

        const server =
            app.listen(
                PORT,
                "0.0.0.0",
                () => {

                    console.log(
                        "================================================"
                    );

                    console.log(
                        `✅ BMJ VOICE AI API ÉCOUTE SUR PORT ${PORT}`
                    );

                    console.log(
                        `🌐 ${PUBLIC_BASE_URL}`
                    );

                    console.log(
                        "================================================"
                    );
                }
            );


        /* ====================================================
           GRACEFUL SHUTDOWN
        ==================================================== */

        const shutdown =
            async (
                signal
            ) => {

                console.log(
                    `\n🛑 Signal ${signal} reçu.`
                );


                server.close(
                    async () => {

                        console.log(
                            "🛑 Serveur HTTP arrêté."
                        );


                        try {

                            await pool.end();

                            console.log(
                                "🗄️ PostgreSQL fermé."
                            );

                        } catch (error) {

                            console.error(
                                "Erreur fermeture DB:",
                                error.message
                            );
                        }


                        process.exit(0);
                    }
                );


                setTimeout(
                    () => {

                        console.error(
                            "⚠️ Arrêt forcé."
                        );

                        process.exit(1);

                    },
                    10000
                );
            };


        process.once(
            "SIGTERM",
            () => shutdown("SIGTERM")
        );

        process.once(
            "SIGINT",
            () => shutdown("SIGINT")
        );


    } catch (error) {

        console.error(
            "================================================"
        );

        console.error(
            "❌ IMPOSSIBLE DE DÉMARRER BMJ VOICE AI"
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
   START
============================================================ */

startServer();