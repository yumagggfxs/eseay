"use strict";

/* ============================================================
   BMJ VOICE AI
   SERVER.JS COMPLET
   Node.js + Express + PostgreSQL + ElevenLabs
============================================================ */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Pool } = require("pg");


/* ============================================================
   CONFIGURATION
============================================================ */

const app = express();

const PORT =
    Number(process.env.PORT) || 10000;

const DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://audio_db_n28a_user:yLIb8T9QvrQtUPymu7D5U0jkLl6xBdYc@dpg-dai8lo0ae00c73dlk1rg-a/audio_db_n28a";

const ELEVENLABS_API_KEY =
    process.env.ELEVENLABS_API_KEY || "sk_5e371bcffb2b4762ea4c6247699dfe32ec06092590143a86";

const JWT_SECRET =
    process.env.JWT_SECRET ||
    "CHANGE_THIS_SECRET_IN_RENDER";

const ADMIN_EMAIL =
    process.env.ADMIN_EMAIL ||
    "";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD ||
    "";

const APP_NAME =
    "BMJ VOICE AI";

const DEFAULT_VOICE_ID =
    "ojsdYNTmnPdf7yAl8rI5";

const DEFAULT_MODEL =
    "eleven_v3";

const FAST_MODEL =
    "eleven_flash_v2_5";

const DEFAULT_FORMAT =
    "mp3_44100_128";


/* ============================================================
   QUOTAS
============================================================ */

const QUOTAS = {
    free: 10000,
    standard: 100000,
    premium: 1000000
};


/* ============================================================
   FALLBACK VOICES
============================================================ */

const FALLBACK_VOICES = [

    {
        external_voice_id:
            DEFAULT_VOICE_ID,

        name:
            "BMJ Voice — Serveur",

        provider:
            "elevenlabs",

        gender:
            "unknown",

        language:
            "fr",

        language_name:
            "Français",

        description:
            "Voix principale configurée sur le serveur.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_server_default:
            true
    },

    {
        external_voice_id:
            "21m00Tcm4TlvDq8ikWAM",

        name:
            "Rachel",

        provider:
            "elevenlabs",

        gender:
            "female",

        language:
            "en",

        language_name:
            "English",

        description:
            "Voix de secours.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_fallback:
            true
    },

    {
        external_voice_id:
            "EXAVITQu4vr4xnSDxMaL",

        name:
            "Bella",

        provider:
            "elevenlabs",

        gender:
            "female",

        language:
            "en",

        language_name:
            "English",

        description:
            "Voix de secours.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_fallback:
            true
    },

    {
        external_voice_id:
            "AZnzlk1XvdvUeBnXmlld",

        name:
            "Domi",

        provider:
            "elevenlabs",

        gender:
            "female",

        language:
            "en",

        language_name:
            "English",

        description:
            "Voix de secours.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_fallback:
            true
    },

    {
        external_voice_id:
            "ErXwobaYiN019PkySvjV",

        name:
            "Antoni",

        provider:
            "elevenlabs",

        gender:
            "male",

        language:
            "en",

        language_name:
            "English",

        description:
            "Voix de secours.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_fallback:
            true
    },

    {
        external_voice_id:
            "MF3mGyEYCl7XYWbV9V6O",

        name:
            "Elli",

        provider:
            "elevenlabs",

        gender:
            "female",

        language:
            "en",

        language_name:
            "English",

        description:
            "Voix de secours.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_fallback:
            true
    },

    {
        external_voice_id:
            "TxGEqnHWrfWFTfGW9XjX",

        name:
            "Josh",

        provider:
            "elevenlabs",

        gender:
            "male",

        language:
            "en",

        language_name:
            "English",

        description:
            "Voix de secours.",

        preview_url:
            "",

        is_active:
            true,

        is_premium:
            false,

        is_fallback:
            true
    }

];


/* ============================================================
   POSTGRESQL
============================================================ */

let pool = null;

if (DATABASE_URL) {

    pool = new Pool({
        connectionString:
            DATABASE_URL,

        ssl:
            process.env.NODE_ENV === "production"
                ? {
                    rejectUnauthorized:
                        false
                }
                : false,

        max:
            10,

        idleTimeoutMillis:
            30000,

        connectionTimeoutMillis:
            10000
    });

    pool.on(
        "error",
        error => {

            console.error(
                "PostgreSQL pool error:",
                error
            );

        }
    );

} else {

    console.warn(
        "DATABASE_URL n'est pas configurée."
    );

}


/* ============================================================
   EXPRESS
============================================================ */

app.use(
    cors({
        origin: true,
        credentials: true,
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
            "Authorization"
        ]
    })
);

app.use(
    express.json({
        limit: "15mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "15mb"
    })
);


/* ============================================================
   HELPERS
============================================================ */

function generateId() {

    return crypto
        .randomUUID();

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


function cleanText(
    value,
    max = 10000
) {

    return String(
        value || ""
    )
        .trim()
        .slice(
            0,
            max
        );

}


function safeNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(
        number
    )
        ? number
        : fallback;

}


function getPlanQuota(
    plan
) {

    return (
        QUOTAS[
            String(
                plan || "free"
            ).toLowerCase()
        ] ||
        QUOTAS.free
    );

}


function hashPassword(
    password
) {

    return bcrypt.hash(
        password,
        12
    );

}


function createToken(
    user
) {

    return jwt.sign(
        {
            id:
                user.id,

            email:
                user.email,

            role:
                user.role || "user"
        },

        JWT_SECRET,

        {
            expiresIn:
                "30d"
        }
    );

}


function extractToken(
    req
) {

    const header =
        req.headers.authorization;

    if (
        header &&
        header.startsWith(
            "Bearer "
        )
    ) {

        return header.slice(
            7
        ).trim();

    }

    return "";

}


/* ============================================================
   DATABASE CHECK
============================================================ */

async function dbQuery(
    text,
    params = []
) {

    if (!pool) {

        throw new Error(
            "Base de données non configurée."
        );

    }

    return pool.query(
        text,
        params
    );

}


/* ============================================================
   INITIALISATION DATABASE
============================================================ */

async function initDatabase() {

    if (!pool) {

        return;

    }


    await dbQuery(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS users (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            nom VARCHAR(150) NOT NULL,

            email VARCHAR(255) UNIQUE NOT NULL,

            password_hash TEXT NOT NULL,

            photo TEXT,

            role VARCHAR(30)
                DEFAULT 'user',

            plan VARCHAR(30)
                DEFAULT 'free',

            is_active BOOLEAN
                DEFAULT TRUE,

            is_blocked BOOLEAN
                DEFAULT FALSE,

            created_at TIMESTAMPTZ
                DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                DEFAULT NOW(),

            last_login_at TIMESTAMPTZ

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS voices (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            external_voice_id VARCHAR(255)
                UNIQUE NOT NULL,

            name VARCHAR(255)
                NOT NULL,

            provider VARCHAR(100)
                DEFAULT 'elevenlabs',

            gender VARCHAR(50),

            language VARCHAR(20),

            language_name VARCHAR(100),

            description TEXT,

            preview_url TEXT,

            is_active BOOLEAN
                DEFAULT TRUE,

            is_premium BOOLEAN
                DEFAULT FALSE,

            created_at TIMESTAMPTZ
                DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                DEFAULT NOW()

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS projects (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            title VARCHAR(255)
                NOT NULL,

            description TEXT,

            language VARCHAR(20),

            status VARCHAR(30)
                DEFAULT 'draft',

            created_at TIMESTAMPTZ
                DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                DEFAULT NOW()

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS audio_generations (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            project_id UUID
                REFERENCES projects(id)
                ON DELETE SET NULL,

            voice_id UUID
                REFERENCES voices(id)
                ON DELETE SET NULL,

            provider VARCHAR(100)
                DEFAULT 'elevenlabs',

            model_id VARCHAR(100),

            original_text TEXT,

            processed_text TEXT,

            language VARCHAR(20),

            voice_external_id VARCHAR(255),

            format VARCHAR(100),

            audio_url TEXT,

            audio_path TEXT,

            audio_chunks JSONB,

            duration_seconds NUMERIC,

            character_count INTEGER
                DEFAULT 0,

            chunk_count INTEGER
                DEFAULT 1,

            status VARCHAR(30)
                DEFAULT 'processing',

            error TEXT,

            request_id VARCHAR(255),

            provider_character_count INTEGER,

            stability NUMERIC,

            similarity_boost NUMERIC,

            style NUMERIC,

            speed NUMERIC,

            created_at TIMESTAMPTZ
                DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                DEFAULT NOW()

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS usage_records (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            month_key VARCHAR(20)
                NOT NULL,

            characters_used INTEGER
                DEFAULT 0,

            generations_count INTEGER
                DEFAULT 0,

            created_at TIMESTAMPTZ
                DEFAULT NOW(),

            updated_at TIMESTAMPTZ
                DEFAULT NOW(),

            UNIQUE(
                user_id,
                month_key
            )

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS user_quotas (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            user_id UUID UNIQUE NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            monthly_limit INTEGER
                DEFAULT 10000,

            characters_used INTEGER
                DEFAULT 0,

            month_key VARCHAR(20),

            updated_at TIMESTAMPTZ
                DEFAULT NOW()

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS admin_activity (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            admin_user_id UUID
                REFERENCES users(id)
                ON DELETE SET NULL,

            action VARCHAR(150),

            description TEXT,

            ip_address VARCHAR(100),

            user_agent TEXT,

            created_at TIMESTAMPTZ
                DEFAULT NOW()

        )
    `);


    await dbQuery(`
        CREATE TABLE IF NOT EXISTS system_settings (

            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            setting_key VARCHAR(150)
                UNIQUE NOT NULL,

            setting_value TEXT,

            description TEXT,

            updated_at TIMESTAMPTZ
                DEFAULT NOW()

        )
    `);


    const settings = [

        [
            "app_name",
            APP_NAME
        ],

        [
            "default_language",
            "fr"
        ],

        [
            "default_model",
            DEFAULT_MODEL
        ],

        [
            "fast_model",
            FAST_MODEL
        ],

        [
            "free_monthly_quota",
            String(
                QUOTAS.free
            )
        ],

        [
            "standard_monthly_quota",
            String(
                QUOTAS.standard
            )
        ],

        [
            "premium_monthly_quota",
            String(
                QUOTAS.premium
            )
        ],

        [
            "default_audio_format",
            DEFAULT_FORMAT
        ],

        [
            "default_voice_id",
            DEFAULT_VOICE_ID
        ]

    ];


    for (
        const setting of settings
    ) {

        await dbQuery(
            `
            INSERT INTO system_settings
                (
                    setting_key,
                    setting_value
                )
            VALUES
                ($1, $2)
            ON CONFLICT
                (setting_key)
            DO NOTHING
            `,
            setting
        );

    }


    /*
     * Ajouter les voix de secours.
     */

    for (
        const voice
        of FALLBACK_VOICES
    ) {

        await dbQuery(
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
                is_active,
                is_premium
            )
            VALUES
            (
                $1,$2,$3,$4,$5,
                $6,$7,$8,$9,$10
            )
            ON CONFLICT
                (external_voice_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
            `,
            [
                voice.external_voice_id,
                voice.name,
                voice.provider,
                voice.gender,
                voice.language,
                voice.language_name,
                voice.description,
                voice.preview_url,
                voice.is_active,
                voice.is_premium
            ]
        );

    }


    console.log(
        "Base de données initialisée."
    );

}


/* ============================================================
   ADMIN ACTIVITY
============================================================ */

async function logAdminActivity(
    req,
    adminUserId,
    action,
    description
) {

    try {

        await dbQuery(
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
                adminUserId || null,

                action,

                description,

                req.ip || "",

                req.headers[
                    "user-agent"
                ] || ""
            ]
        );

    } catch (error) {

        console.error(
            "Erreur journal admin:",
            error.message
        );

    }

}


/* ============================================================
   AUTHENTICATION
============================================================ */

async function authenticate(
    req,
    res,
    next
) {

    try {

        const token =
            extractToken(req);


        if (!token) {

            return res
                .status(401)
                .json({
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
            await dbQuery(
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
                [
                    decoded.id
                ]
            );


        if (
            !result.rows.length
        ) {

            return res
                .status(401)
                .json({
                    success: false,
                    message:
                        "Utilisateur introuvable."
                });

        }


        const user =
            result.rows[0];


        if (
            !user.is_active ||
            user.is_blocked
        ) {

            return res
                .status(403)
                .json({
                    success: false,
                    message:
                        "Compte désactivé ou bloqué."
                });

        }


        req.user =
            user;


        next();


    } catch (error) {

        return res
            .status(401)
            .json({
                success: false,
                message:
                    "Token invalide."
            });

    }

}


/* ============================================================
   ADMIN AUTH
============================================================ */

async function adminAuth(
    req,
    res,
    next
) {

    try {

        const token =
            extractToken(req);


        if (!token) {

            return res
                .status(401)
                .json({
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


        const result =
            await dbQuery(
                `
                SELECT *
                FROM users
                WHERE id = $1
                LIMIT 1
                `,
                [
                    decoded.id
                ]
            );


        if (
            !result.rows.length
        ) {

            return res
                .status(401)
                .json({
                    success: false,
                    message:
                        "Administrateur introuvable."
                });

        }


        const admin =
            result.rows[0];


        if (
            admin.role !==
            "admin"
        ) {

            return res
                .status(403)
                .json({
                    success: false,
                    message:
                        "Accès administrateur refusé."
                });

        }


        req.admin =
            admin;

        next();


    } catch (error) {

        return res
            .status(401)
            .json({
                success: false,
                message:
                    "Authentification administrateur invalide."
            });

    }

}


/* ============================================================
   ROOT
============================================================ */

app.get(
    "/",
    (req, res) => {

        res.json({

            success:
                true,

            name:
                APP_NAME,

            message:
                "BMJ VOICE AI API active",

            version:
                "1.0.0",

            environment:
                process.env.NODE_ENV ||
                "production"

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

            if (pool) {

                await dbQuery(
                    "SELECT 1"
                );

                database =
                    true;

            }

        } catch (_) {

            database =
                false;

        }


        res.json({

            success:
                true,

            name:
                APP_NAME,

            database,

            elevenlabs:
                Boolean(
                    ELEVENLABS_API_KEY
                ),

            default_voice:
                DEFAULT_VOICE_ID,

            model:
                DEFAULT_MODEL,

            fast_model:
                FAST_MODEL

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
                await dbQuery(
                    `
                    SELECT
                        NOW() AS now
                    `
                );


            res.json({

                success:
                    true,

                database:
                    true,

                time:
                    result.rows[0].now

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    database:
                        false,

                    message:
                        error.message

                });

        }

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
                cleanText(
                    req.body.nom,
                    150
                );

            const email =
                normalizeEmail(
                    req.body.email
                );

            const password =
                String(
                    req.body.password ||
                    ""
                );


            if (
                !nom ||
                !email ||
                !password
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Nom, email et mot de passe sont obligatoires."

                    });

            }


            if (
                password.length < 6
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Le mot de passe doit contenir au moins 6 caractères."

                    });

            }


            const existing =
                await dbQuery(
                    `
                    SELECT id
                    FROM users
                    WHERE email = $1
                    LIMIT 1
                    `,
                    [
                        email
                    ]
                );


            if (
                existing.rows.length
            ) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        message:
                            "Cette adresse email est déjà utilisée."

                    });

            }


            const passwordHash =
                await hashPassword(
                    password
                );


            const result =
                await dbQuery(
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
                        req.body.photo ||
                            null
                    ]
                );


            const user =
                result.rows[0];


            await dbQuery(
                `
                INSERT INTO user_quotas
                (
                    user_id,
                    monthly_limit,
                    characters_used,
                    month_key
                )
                VALUES
                ($1,$2,0,$3)
                ON CONFLICT
                    (user_id)
                DO NOTHING
                `,
                [
                    user.id,
                    QUOTAS.free,
                    getMonthKey()
                ]
            );


            const token =
                createToken(
                    user
                );


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
                "REGISTER:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Erreur lors de la création du compte."

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
                    req.body.password ||
                    ""
                );


            if (
                !email ||
                !password
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Email et mot de passe obligatoires."

                    });

            }


            const result =
                await dbQuery(
                    `
                    SELECT *
                    FROM users
                    WHERE email = $1
                    LIMIT 1
                    `,
                    [
                        email
                    ]
                );


            if (
                !result.rows.length
            ) {

                return res
                    .status(401)
                    .json({

                        success:
                            false,

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

                return res
                    .status(401)
                    .json({

                        success:
                            false,

                        message:
                            "Email ou mot de passe incorrect."

                    });

            }


            if (
                user.is_blocked ||
                !user.is_active
            ) {

                return res
                    .status(403)
                    .json({

                        success:
                            false,

                        message:
                            "Votre compte est bloqué ou désactivé."

                    });

            }


            await dbQuery(
                `
                UPDATE users
                SET
                    last_login_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                `,
                [
                    user.id
                ]
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
                "LOGIN:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

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

            const usage =
                await getUserUsage(
                    req.user.id,
                    req.user.plan
                );


            res.json({

                success:
                    true,

                user:
                    req.user,

                usage

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   UPDATE PROFILE
============================================================ */

app.patch(
    "/api/auth/profile",
    authenticate,
    async (req, res) => {

        try {

            const nom =
                cleanText(
                    req.body.nom,
                    150
                );


            const photo =
                req.body.photo !==
                undefined
                    ? String(
                        req.body.photo ||
                        ""
                    )
                    : req.user.photo;


            if (!nom) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Le nom est obligatoire."

                    });

            }


            const result =
                await dbQuery(
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
                        last_login_at
                    `,
                    [
                        nom,
                        photo,
                        req.user.id
                    ]
                );


            res.json({

                success:
                    true,

                message:
                    "Profil mis à jour.",

                user:
                    result.rows[0]

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   CHANGE PASSWORD
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

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Les deux mots de passe sont obligatoires."

                    });

            }


            if (
                newPassword.length < 6
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Le nouveau mot de passe doit contenir au moins 6 caractères."

                    });

            }


            const result =
                await dbQuery(
                    `
                    SELECT password_hash
                    FROM users
                    WHERE id = $1
                    `,
                    [
                        req.user.id
                    ]
                );


            const valid =
                await bcrypt.compare(
                    currentPassword,
                    result.rows[0].password_hash
                );


            if (!valid) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Mot de passe actuel incorrect."

                    });

            }


            const passwordHash =
                await hashPassword(
                    newPassword
                );


            await dbQuery(
                `
                UPDATE users
                SET
                    password_hash = $1,
                    updated_at = NOW()
                WHERE id = $2
                `,
                [
                    passwordHash,
                    req.user.id
                ]
            );


            res.json({

                success:
                    true,

                message:
                    "Mot de passe modifié avec succès."

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   MONTH KEY
============================================================ */

function getMonthKey() {

    const now =
        new Date();

    return (
        now.getUTCFullYear() +
        "-" +
        String(
            now.getUTCMonth() + 1
        ).padStart(
            2,
            "0"
        )
    );

}


/* ============================================================
   USER USAGE
============================================================ */

async function getUserUsage(
    userId,
    plan
) {

    const monthKey =
        getMonthKey();


    const quota =
        getPlanQuota(
            plan
        );


    const result =
        await dbQuery(
            `
            SELECT
                characters_used,
                generations_count
            FROM usage_records
            WHERE
                user_id = $1
                AND month_key = $2
            LIMIT 1
            `,
            [
                userId,
                monthKey
            ]
        );


    let used =
        0;

    let generations =
        0;


    if (
        result.rows.length
    ) {

        used =
            Number(
                result.rows[0]
                    .characters_used || 0
            );

        generations =
            Number(
                result.rows[0]
                    .generations_count || 0
            );

    }


    return {

        plan:
            plan || "free",

        used,

        characters_used:
            used,

        limit:
            quota,

        monthly_limit:
            quota,

        remaining:
            Math.max(
                0,
                quota - used
            ),

        generations,

        generations_count:
            generations,

        month:
            monthKey,

        percentage:
            quota > 0
                ? Math.min(
                    100,
                    (
                        used /
                        quota
                    ) *
                    100
                )
                : 0

    };

}


/* ============================================================
   ADD USAGE
============================================================ */

async function addUsage(
    userId,
    plan,
    characters
) {

    const monthKey =
        getMonthKey();


    await dbQuery(
        `
        INSERT INTO usage_records
        (
            user_id,
            month_key,
            characters_used,
            generations_count
        )
        VALUES
        ($1,$2,$3,1)

        ON CONFLICT
        (
            user_id,
            month_key
        )

        DO UPDATE SET

            characters_used =
                usage_records.characters_used
                + EXCLUDED.characters_used,

            generations_count =
                usage_records.generations_count
                + 1,

            updated_at =
                NOW()
        `,
        [
            userId,
            monthKey,
            characters
        ]
    );


    await dbQuery(
        `
        INSERT INTO user_quotas
        (
            user_id,
            monthly_limit,
            characters_used,
            month_key
        )
        VALUES
        ($1,$2,$3,$4)

        ON CONFLICT
        (
            user_id
        )

        DO UPDATE SET

            monthly_limit =
                EXCLUDED.monthly_limit,

            characters_used =
                EXCLUDED.characters_used,

            month_key =
                EXCLUDED.month_key,

            updated_at =
                NOW()
        `,
        [
            userId,
            getPlanQuota(plan),
            characters,
            monthKey
        ]
    );

}


/* ============================================================
   USAGE ROUTE
============================================================ */

app.get(
    "/api/usage",
    authenticate,
    async (req, res) => {

        try {

            const usage =
                await getUserUsage(
                    req.user.id,
                    req.user.plan
                );


            res.json({

                success:
                    true,

                usage

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
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
                Boolean(
                    ELEVENLABS_API_KEY
                ),

            default_voice:
                DEFAULT_VOICE_ID,

            model:
                DEFAULT_MODEL,

            fast_model:
                FAST_MODEL,

            output_format:
                DEFAULT_FORMAT

        });

    }
);


/* ============================================================
   ELEVENLABS VOICES SYNC
============================================================ */

async function syncElevenLabsVoices() {

    if (
        !ELEVENLABS_API_KEY
    ) {

        return [];

    }


    try {

        const response =
            await fetch(
                "https://api.elevenlabs.io/v1/voices",
                {
                    method:
                        "GET",

                    headers: {
                        "xi-api-key":
                            ELEVENLABS_API_KEY
                    }
                }
            );


        if (!response.ok) {

            throw new Error(
                `ElevenLabs voices HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        const voices =
            Array.isArray(
                data.voices
            )
                ? data.voices
                : [];


        for (
            const voice of voices
        ) {

            await dbQuery(
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
                    is_active,
                    is_premium
                )
                VALUES
                (
                    $1,$2,$3,$4,$5,
                    $6,$7,$8,$9,$10
                )

                ON CONFLICT
                (
                    external_voice_id
                )

                DO UPDATE SET

                    name =
                        EXCLUDED.name,

                    gender =
                        EXCLUDED.gender,

                    description =
                        EXCLUDED.description,

                    preview_url =
                        EXCLUDED.preview_url,

                    updated_at =
                        NOW()
                `,
                [
                    voice.voice_id,

                    voice.name ||
                        "Voix ElevenLabs",

                    "elevenlabs",

                    voice.labels &&
                    (
                        voice.labels.gender ||
                        voice.labels.sex
                    ) ||
                    "unknown",

                    voice.labels &&
                    (
                        voice.labels.language ||
                        ""
                    ) ||
                    "",

                    voice.labels &&
                    (
                        voice.labels.language ||
                        ""
                    ) ||
                    "",

                    voice.description ||
                        "",

                    voice.preview_url ||
                        "",

                    true,

                    false
                ]
            );

        }


        /*
         * S'assurer que la voix serveur
         * reste active.
         */

        await dbQuery(
            `
            UPDATE voices
            SET
                is_active = TRUE,
                updated_at = NOW()
            WHERE
                external_voice_id = $1
            `,
            [
                DEFAULT_VOICE_ID
            ]
        );


        return voices;


    } catch (error) {

        console.error(
            "SYNC ELEVENLABS VOICES:",
            error.message
        );

        return [];

    }

}


/* ============================================================
   ADMIN SYNC VOICES
============================================================ */

app.post(
    "/api/admin/voices/sync",
    adminAuth,
    async (req, res) => {

        try {

            const voices =
                await syncElevenLabsVoices();


            await logAdminActivity(
                req,
                req.admin.id,
                "voices_sync",
                `Synchronisation de ${voices.length} voix.`
            );


            res.json({

                success:
                    true,

                count:
                    voices.length,

                message:
                    "Voix synchronisées."

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   GET VOICES
============================================================ */

app.get(
    "/api/voices",
    async (req, res) => {

        try {

            let result =
                await dbQuery(
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
                    ORDER BY
                        CASE
                            WHEN external_voice_id = $1
                            THEN 0
                            ELSE 1
                        END,
                        name ASC
                    `,
                    [
                        DEFAULT_VOICE_ID
                    ]
                );


            /*
             * Si la base est vide,
             * on synchronise automatiquement.
             */

            if (
                !result.rows.length
            ) {

                await syncElevenLabsVoices();


                result =
                    await dbQuery(
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
                        ORDER BY
                            CASE
                                WHEN external_voice_id = $1
                                THEN 0
                                ELSE 1
                            END,
                            name ASC
                        `,
                        [
                            DEFAULT_VOICE_ID
                        ]
                    );

            }


            /*
             * Toujours fournir la voix serveur.
             */

            let voices =
                result.rows;


            const hasDefault =
                voices.some(
                    voice =>
                        voice.external_voice_id ===
                        DEFAULT_VOICE_ID
                );


            if (!hasDefault) {

                voices = [

                    {
                        id:
                            null,

                        external_voice_id:
                            DEFAULT_VOICE_ID,

                        name:
                            "BMJ Voice — Serveur",

                        provider:
                            "elevenlabs",

                        gender:
                            "unknown",

                        language:
                            "fr",

                        language_name:
                            "Français",

                        description:
                            "Voix principale configurée sur le serveur.",

                        preview_url:
                            "",

                        is_active:
                            true,

                        is_premium:
                            false,

                        is_server_default:
                            true

                    },

                    ...voices

                ];

            }


            res.json({

                success:
                    true,

                default_voice:
                    DEFAULT_VOICE_ID,

                count:
                    voices.length,

                voices

            });


        } catch (error) {

            console.error(
                "GET VOICES:",
                error
            );


            /*
             * Même en cas de problème DB,
             * ne jamais renvoyer une liste vide.
             */

            res.json({

                success:
                    true,

                default_voice:
                    DEFAULT_VOICE_ID,

                count:
                    FALLBACK_VOICES.length,

                voices:
                    FALLBACK_VOICES,

                fallback:
                    true

            });

        }

    }
);


/* ============================================================
   VOICE TEST
============================================================ */

app.get(
    "/api/voices/test",
    async (req, res) => {

        try {

            const result =
                await dbQuery(
                    `
                    SELECT
                        COUNT(*) AS count
                    FROM voices
                    WHERE is_active = TRUE
                    `
                );


            res.json({

                success:
                    true,

                database_voices:
                    Number(
                        result.rows[0].count
                    ),

                default_voice:
                    DEFAULT_VOICE_ID,

                fallback_voices:
                    FALLBACK_VOICES.length

            });


        } catch (error) {

            res.json({

                success:
                    true,

                database_voices:
                    0,

                default_voice:
                    DEFAULT_VOICE_ID,

                fallback_voices:
                    FALLBACK_VOICES.length,

                fallback:
                    true

            });

        }

    }
);


/* ============================================================
   FIND VOICE
============================================================ */

async function getBestVoice(
    requestedVoiceId
) {

    const requested =
        String(
            requestedVoiceId ||
            ""
        ).trim();


    /*
     * 1. Voix demandée en base.
     */

    if (requested) {

        const result =
            await dbQuery(
                `
                SELECT *
                FROM voices
                WHERE
                    is_active = TRUE
                    AND
                    (
                        id::text = $1
                        OR external_voice_id = $1
                    )
                LIMIT 1
                `,
                [
                    requested
                ]
            );


        if (
            result.rows.length
        ) {

            return result.rows[0];

        }


        /*
         * La voix demandée peut être une
         * voix ElevenLabs qui n'est pas encore
         * dans notre base.
         */

        const fallbackMatch =
            FALLBACK_VOICES.find(
                voice =>
                    voice.external_voice_id ===
                    requested
            );


        if (fallbackMatch) {

            return {

                id:
                    null,

                external_voice_id:
                    fallbackMatch.external_voice_id,

                name:
                    fallbackMatch.name,

                provider:
                    "elevenlabs",

                is_active:
                    true,

                is_premium:
                    false

            };

        }

    }


    /*
     * 2. Toujours essayer la voix serveur.
     */

    const defaultResult =
        await dbQuery(
            `
            SELECT *
            FROM voices
            WHERE
                external_voice_id = $1
                AND is_active = TRUE
            LIMIT 1
            `,
            [
                DEFAULT_VOICE_ID
            ]
        );


    if (
        defaultResult.rows.length
    ) {

        return defaultResult.rows[0];

    }


    /*
     * 3. Retour direct de la voix serveur.
     */

    return {

        id:
            null,

        external_voice_id:
            DEFAULT_VOICE_ID,

        name:
            "BMJ Voice — Serveur",

        provider:
            "elevenlabs",

        is_active:
            true,

        is_premium:
            false

    };

}


/* ============================================================
   SPLIT TEXT
============================================================ */

function splitText(
    text,
    maxLength = 4500
) {

    const clean =
        String(
            text || ""
        ).trim();


    if (
        clean.length <=
        maxLength
    ) {

        return [
            clean
        ];

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
                ".",
                maxLength
            );


        if (
            cut < maxLength * 0.5
        ) {

            cut =
                remaining.lastIndexOf(
                    " ",
                    maxLength
                );

        }


        if (
            cut <= 0
        ) {

            cut =
                maxLength;

        }


        chunks.push(
            remaining
                .slice(
                    0,
                    cut + 1
                )
                .trim()
        );


        remaining =
            remaining
                .slice(
                    cut + 1
                )
                .trim();

    }


    if (remaining) {

        chunks.push(
            remaining
        );

    }


    return chunks
        .filter(Boolean);

}


/* ============================================================
   ELEVENLABS GENERATE CHUNK
============================================================ */

async function generateElevenLabsChunk(
    voiceId,
    text,
    options = {}
) {

    if (
        !ELEVENLABS_API_KEY
    ) {

        throw new Error(
            "La clé ElevenLabs n'est pas configurée sur Render."
        );

    }


    const modelId =
        options.model_id ||
        DEFAULT_MODEL;


    const outputFormat =
        options.format ||
        DEFAULT_FORMAT;


    const body = {

        text,

        model_id:
            modelId

    };


    if (
        options.language &&
        options.language !==
        "auto"
    ) {

        body.language_code =
            options.language;

    }


    const voiceSettings = {

        stability:
            Math.min(
                1,
                Math.max(
                    0,
                    safeNumber(
                        options.stability,
                        0.5
                    )
                )
            ),

        similarity_boost:
            Math.min(
                1,
                Math.max(
                    0,
                    safeNumber(
                        options.similarity_boost,
                        0.75
                    )
                )
            ),

        style:
            Math.min(
                1,
                Math.max(
                    0,
                    safeNumber(
                        options.style,
                        0
                    )
                )
            ),

        speed:
            Math.min(
                1.2,
                Math.max(
                    0.7,
                    safeNumber(
                        options.speed,
                        1
                    )
                )
            ),

        use_speaker_boost:
            true

    };


    body.voice_settings =
        voiceSettings;


    const url =
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
            voiceId
        )}?output_format=${encodeURIComponent(
            outputFormat
        )}`;


    let response =
        await fetch(
            url,
            {
                method:
                    "POST",

                headers: {

                    "xi-api-key":
                        ELEVENLABS_API_KEY,

                    "Content-Type":
                        "application/json",

                    "Accept":
                        "audio/mpeg"

                },

                body:
                    JSON.stringify(
                        body
                    )
            }
        );


    /*
     * ElevenLabs peut refuser certains
     * paramètres selon le modèle/voix.
     * On retente avec un body minimal.
     */

    if (!response.ok) {

        const errorText =
            await response.text();


        console.error(
            "ElevenLabs première tentative:",
            response.status,
            errorText
        );


        const minimalBody = {

            text,

            model_id:
                modelId

        };


        if (
            options.language &&
            options.language !==
            "auto"
        ) {

            minimalBody.language_code =
                options.language;

        }


        response =
            await fetch(
                url,
                {
                    method:
                        "POST",

                    headers: {

                        "xi-api-key":
                            ELEVENLABS_API_KEY,

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "audio/mpeg"

                    },

                    body:
                        JSON.stringify(
                            minimalBody
                        )

                }
            );

    }


    if (!response.ok) {

        const errorText =
            await response.text();


        throw new Error(
            `ElevenLabs ${response.status}: ${errorText.slice(
                0,
                500
            )}`
        );

    }


    const buffer =
        Buffer.from(
            await response.arrayBuffer()
        );


    if (
        !buffer.length
    ) {

        throw new Error(
            "ElevenLabs a retourné un audio vide."
        );

    }


    return buffer;

}


/* ============================================================
   AUDIO DATA URL
============================================================ */

function bufferToDataUrl(
    buffer
) {

    return (
        "data:audio/mpeg;base64," +
        buffer.toString(
            "base64"
        )
    );

}


/* ============================================================
   TTS GENERATE
============================================================ */

app.post(
    "/api/tts/generate",
    authenticate,
    async (req, res) => {

        const requestId =
            generateId();


        try {

            const text =
                String(
                    req.body.text ||
                    ""
                ).trim();


            if (!text) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Le texte est obligatoire."

                    });

            }


            if (
                text.length >
                50000
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Le texte ne peut pas dépasser 50 000 caractères."

                    });

            }


            const usage =
                await getUserUsage(
                    req.user.id,
                    req.user.plan
                );


            const characters =
                text.length;


            if (
                characters >
                usage.remaining
            ) {

                return res
                    .status(402)
                    .json({

                        success:
                            false,

                        message:
                            "Votre quota mensuel est insuffisant.",

                        usage

                    });

            }


            const voice =
                await getBestVoice(
                    req.body.voice_id
                );


            if (
                !voice ||
                !voice.external_voice_id
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Aucune voix valide n'a été trouvée."

                    });

            }


            const language =
                String(
                    req.body.language ||
                    "fr"
                );


            const model =
                String(
                    req.body.model_id ||
                    DEFAULT_MODEL
                );


            const format =
                String(
                    req.body.format ||
                    DEFAULT_FORMAT
                );


            const options = {

                model_id:
                    model,

                format,

                language,

                stability:
                    safeNumber(
                        req.body.stability,
                        0.5
                    ),

                similarity_boost:
                    safeNumber(
                        req.body.similarity_boost,
                        0.75
                    ),

                style:
                    safeNumber(
                        req.body.style,
                        0
                    ),

                speed:
                    safeNumber(
                        req.body.speed,
                        1
                    )

            };


            const chunks =
                splitText(
                    text
                );


            const audioChunks =
                [];


            /*
             * Générer chaque morceau.
             */

            for (
                let index = 0;
                index < chunks.length;
                index++
            ) {

                try {

                    const buffer =
                        await generateElevenLabsChunk(
                            voice.external_voice_id,
                            chunks[index],
                            options
                        );


                    audioChunks.push({

                        index,

                        audio_url:
                            bufferToDataUrl(
                                buffer
                            ),

                        characters:
                            chunks[index].length

                    });


                } catch (voiceError) {

                    /*
                     * Si une voix de secours échoue,
                     * on retente avec la voix serveur.
                     */

                    if (
                        voice.external_voice_id !==
                        DEFAULT_VOICE_ID
                    ) {

                        console.warn(
                            "Voix de secours échouée. Nouvelle tentative avec la voix serveur."
                        );


                        const buffer =
                            await generateElevenLabsChunk(
                                DEFAULT_VOICE_ID,
                                chunks[index],
                                options
                            );


                        audioChunks.push({

                            index,

                            audio_url:
                                bufferToDataUrl(
                                    buffer
                                ),

                            characters:
                                chunks[index].length

                        });

                    } else {

                        throw voiceError;

                    }

                }

            }


            if (
                !audioChunks.length
            ) {

                throw new Error(
                    "Aucun audio n'a été généré."
                );

            }


            /*
             * Pour compatibilité frontend,
             * audio_url contient le premier morceau.
             */

            const firstAudio =
                audioChunks[0]
                    .audio_url;


            /*
             * Enregistrer l'historique.
             */

            const generationResult =
                await dbQuery(
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
                        audio_url,
                        audio_chunks,
                        character_count,
                        chunk_count,
                        status,
                        request_id,
                        provider_character_count,
                        stability,
                        similarity_boost,
                        style,
                        speed
                    )
                    VALUES
                    (
                        $1,$2,$3,$4,$5,
                        $6,$7,$8,$9,$10,
                        $11,$12,$13,$14,$15,
                        $16,$17,$18,$19,$20,$21
                    )
                    RETURNING *
                    `,
                    [

                        req.user.id,

                        req.body.project_id ||
                            null,

                        voice.id ||
                            null,

                        "elevenlabs",

                        model,

                        text,

                        text,

                        language,

                        voice.external_voice_id,

                        format,

                        firstAudio,

                        JSON.stringify(
                            audioChunks
                        ),

                        characters,

                        chunks.length,

                        "completed",

                        requestId,

                        characters,

                        options.stability,

                        options.similarity_boost,

                        options.style,

                        options.speed

                    ]
                );


            await addUsage(
                req.user.id,
                req.user.plan,
                characters
            );


            const updatedUsage =
                await getUserUsage(
                    req.user.id,
                    req.user.plan
                );


            res.json({

                success:
                    true,

                message:
                    "Audio généré avec succès.",

                generation:
                    generationResult.rows[0],

                audio_url:
                    firstAudio,

                audio:
                    firstAudio,

                data_url:
                    firstAudio,

                audio_chunks:
                    audioChunks,

                voice:
                    {

                        id:
                            voice.id,

                        external_voice_id:
                            voice.external_voice_id,

                        name:
                            voice.name

                    },

                model:
                    model,

                format:
                    format,

                character_count:
                    characters,

                chunk_count:
                    chunks.length,

                usage:
                    updatedUsage,

                request_id:
                    requestId

            });


        } catch (error) {

            console.error(
                "TTS GENERATE:",
                error
            );


            /*
             * En cas d'échec, enregistrer
             * l'erreur si possible.
             */

            try {

                await dbQuery(
                    `
                    INSERT INTO audio_generations
                    (
                        user_id,
                        provider,
                        model_id,
                        original_text,
                        character_count,
                        status,
                        error,
                        request_id
                    )
                    VALUES
                    ($1,$2,$3,$4,$5,$6,$7,$8)
                    `,
                    [

                        req.user.id,

                        "elevenlabs",

                        req.body.model_id ||
                            DEFAULT_MODEL,

                        String(
                            req.body.text ||
                            ""
                        ),

                        String(
                            req.body.text ||
                            ""
                        ).length,

                        "failed",

                        error.message,

                        requestId

                    ]
                );

            } catch (_) {}


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message ||
                        "Erreur pendant la génération audio.",

                    request_id:
                        requestId

                });

        }

    }
);


/* ============================================================
   GET AUDIO HISTORY
============================================================ */

app.get(
    "/api/audio",
    authenticate,
    async (req, res) => {

        try {

            const limit =
                Math.min(
                    100,
                    Math.max(
                        1,
                        Number(
                            req.query.limit
                        ) || 50
                    )
                );


            const result =
                await dbQuery(
                    `
                    SELECT
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
                        ag.request_id,
                        ag.provider_character_count,
                        ag.stability,
                        ag.similarity_boost,
                        ag.style,
                        ag.speed,
                        ag.created_at,
                        v.name AS voice_name,
                        p.title AS project_title
                    FROM audio_generations ag
                    LEFT JOIN voices v
                        ON v.id = ag.voice_id
                    LEFT JOIN projects p
                        ON p.id = ag.project_id
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


            res.json({

                success:
                    true,

                generations:
                    result.rows,

                history:
                    result.rows,

                count:
                    result.rows.length

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   GET SINGLE AUDIO
============================================================ */

app.get(
    "/api/audio/:id",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await dbQuery(
                    `
                    SELECT
                        ag.*,
                        v.name AS voice_name,
                        p.title AS project_title
                    FROM audio_generations ag
                    LEFT JOIN voices v
                        ON v.id = ag.voice_id
                    LEFT JOIN projects p
                        ON p.id = ag.project_id
                    WHERE
                        ag.id = $1
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

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Audio introuvable."

                    });

            }


            const generation =
                result.rows[0];


            res.json({

                success:
                    true,

                ...generation,

                generation

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

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
                await dbQuery(
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
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Génération introuvable."

                    });

            }


            res.json({

                success:
                    true,

                message:
                    "Génération supprimée.",

                id:
                    result.rows[0].id

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   PROJECTS
============================================================ */

app.get(
    "/api/projects",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await dbQuery(
                    `
                    SELECT
                        p.*,
                        COUNT(
                            ag.id
                        )::INTEGER AS generations_count
                    FROM projects p
                    LEFT JOIN audio_generations ag
                        ON ag.project_id = p.id
                    WHERE p.user_id = $1
                    GROUP BY p.id
                    ORDER BY
                        p.created_at DESC
                    `,
                    [
                        req.user.id
                    ]
                );


            res.json({

                success:
                    true,

                projects:
                    result.rows

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   CREATE PROJECT
============================================================ */

app.post(
    "/api/projects",
    authenticate,
    async (req, res) => {

        try {

            const title =
                cleanText(
                    req.body.title,
                    255
                );


            if (!title) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Le nom du projet est obligatoire."

                    });

            }


            const result =
                await dbQuery(
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

                        cleanText(
                            req.body.description,
                            5000
                        ),

                        req.body.language ||
                            "fr"

                    ]
                );


            res.status(201).json({

                success:
                    true,

                project:
                    result.rows[0]

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   DELETE PROJECT
============================================================ */

app.delete(
    "/api/projects/:id",
    authenticate,
    async (req, res) => {

        try {

            const result =
                await dbQuery(
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
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Projet introuvable."

                    });

            }


            res.json({

                success:
                    true,

                message:
                    "Projet supprimé.",

                id:
                    result.rows[0].id

            });


        } catch (error) {

            console.error(
                "DELETE PROJECT:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message ||
                        "Impossible de supprimer le projet."

                });

        }

    }
);


/* ============================================================
   SETTINGS
============================================================ */

app.get(
    "/api/settings",
    async (req, res) => {

        try {

            const result =
                await dbQuery(
                    `
                    SELECT
                        setting_key,
                        setting_value,
                        description
                    FROM system_settings
                    ORDER BY setting_key
                    `
                );


            const settings = {};


            for (
                const row
                of result.rows
            ) {

                settings[
                    row.setting_key
                ] =
                    row.setting_value;

            }


            /*
             * Toujours garantir les paramètres
             * essentiels au frontend.
             */

            settings.app_name =
                settings.app_name ||
                APP_NAME;


            settings.default_language =
                settings.default_language ||
                "fr";


            settings.default_model =
                settings.default_model ||
                DEFAULT_MODEL;


            settings.fast_model =
                settings.fast_model ||
                FAST_MODEL;


            settings.default_audio_format =
                settings.default_audio_format ||
                DEFAULT_FORMAT;


            settings.free_monthly_quota =
                settings.free_monthly_quota ||
                String(
                    QUOTAS.free
                );


            settings.standard_monthly_quota =
                settings.standard_monthly_quota ||
                String(
                    QUOTAS.standard
                );


            settings.premium_monthly_quota =
                settings.premium_monthly_quota ||
                String(
                    QUOTAS.premium
                );


            /*
             * IMPORTANT :
             * La voix principale du serveur
             * est toujours celle-ci.
             */

            settings.default_voice_id =
                DEFAULT_VOICE_ID;


            res.json({

                success:
                    true,

                settings

            });


        } catch (error) {

            console.error(
                "GET SETTINGS:",
                error
            );


            /*
             * Même si la DB rencontre un problème,
             * le frontend reçoit des paramètres valides.
             */

            res.json({

                success:
                    true,

                settings: {

                    app_name:
                        APP_NAME,

                    default_language:
                        "fr",

                    default_model:
                        DEFAULT_MODEL,

                    fast_model:
                        FAST_MODEL,

                    free_monthly_quota:
                        String(
                            QUOTAS.free
                        ),

                    standard_monthly_quota:
                        String(
                            QUOTAS.standard
                        ),

                    premium_monthly_quota:
                        String(
                            QUOTAS.premium
                        ),

                    default_audio_format:
                        DEFAULT_FORMAT,

                    default_voice_id:
                        DEFAULT_VOICE_ID

                },

                fallback:
                    true

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
                    req.body.password ||
                    ""
                );


            if (
                !email ||
                !password
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Email et mot de passe obligatoires."

                    });

            }


            /*
             * --------------------------------------------------
             * 1. Chercher un administrateur dans PostgreSQL
             * --------------------------------------------------
             */

            if (pool) {

                const result =
                    await dbQuery(
                        `
                        SELECT *
                        FROM users
                        WHERE
                            email = $1
                            AND role = 'admin'
                        LIMIT 1
                        `,
                        [
                            email
                        ]
                    );


                if (
                    result.rows.length
                ) {

                    const admin =
                        result.rows[0];


                    const valid =
                        await bcrypt.compare(
                            password,
                            admin.password_hash
                        );


                    if (
                        valid &&
                        admin.is_active &&
                        !admin.is_blocked
                    ) {

                        const token =
                            createToken(
                                admin
                            );


                        await logAdminActivity(
                            req,
                            admin.id,
                            "admin_login",
                            "Connexion administrateur réussie."
                        );


                        return res.json({

                            success:
                                true,

                            message:
                                "Connexion administrateur réussie.",

                            token,

                            admin: {

                                id:
                                    admin.id,

                                nom:
                                    admin.nom,

                                email:
                                    admin.email,

                                role:
                                    admin.role,

                                plan:
                                    admin.plan

                            }

                        });

                    }

                }

            }


            /*
             * --------------------------------------------------
             * 2. Compatibilité avec ADMIN_EMAIL /
             *    ADMIN_PASSWORD de Render
             * --------------------------------------------------
             */

            if (
                ADMIN_EMAIL &&
                ADMIN_PASSWORD &&
                email ===
                normalizeEmail(
                    ADMIN_EMAIL
                ) &&
                password ===
                ADMIN_PASSWORD
            ) {

                let admin = null;


                /*
                 * Si la DB existe, créer le compte admin
                 * automatiquement s'il n'existe pas.
                 */

                if (pool) {

                    const existing =
                        await dbQuery(
                            `
                            SELECT *
                            FROM users
                            WHERE email = $1
                            LIMIT 1
                            `,
                            [
                                email
                            ]
                        );


                    if (
                        existing.rows.length
                    ) {

                        admin =
                            existing.rows[0];


                        /*
                         * S'assurer qu'il reste admin.
                         */

                        if (
                            admin.role !==
                            "admin"
                        ) {

                            const updated =
                                await dbQuery(
                                    `
                                    UPDATE users
                                    SET
                                        role = 'admin',
                                        plan = 'premium',
                                        is_active = TRUE,
                                        is_blocked = FALSE,
                                        updated_at = NOW()
                                    WHERE id = $1
                                    RETURNING *
                                    `,
                                    [
                                        admin.id
                                    ]
                                );


                            admin =
                                updated.rows[0];

                        }

                    } else {

                        const passwordHash =
                            await hashPassword(
                                password
                            );


                        const created =
                            await dbQuery(
                                `
                                INSERT INTO users
                                (
                                    nom,
                                    email,
                                    password_hash,
                                    role,
                                    plan,
                                    is_active,
                                    is_blocked
                                )
                                VALUES
                                (
                                    'Administrateur',
                                    $1,
                                    $2,
                                    'admin',
                                    'premium',
                                    TRUE,
                                    FALSE
                                )
                                RETURNING *
                                `,
                                [
                                    email,
                                    passwordHash
                                ]
                            );


                        admin =
                            created.rows[0];

                    }

                } else {

                    /*
                     * Mode sans DB.
                     */

                    admin = {

                        id:
                            "env-admin",

                        nom:
                            "Administrateur",

                        email,

                        role:
                            "admin",

                        plan:
                            "premium"

                    };

                }


                const token =
                    createToken(
                        admin
                    );


                if (
                    pool &&
                    admin.id !==
                    "env-admin"
                ) {

                    await logAdminActivity(
                        req,
                        admin.id,
                        "admin_login",
                        "Connexion administrateur via variables Render."
                    );

                }


                return res.json({

                    success:
                        true,

                    message:
                        "Connexion administrateur réussie.",

                    token,

                    admin: {

                        id:
                            admin.id,

                        nom:
                            admin.nom,

                        email:
                            admin.email,

                        role:
                            "admin",

                        plan:
                            admin.plan ||
                            "premium"

                    }

                });

            }


            /*
             * Aucun identifiant valide.
             */

            return res
                .status(401)
                .json({

                    success:
                        false,

                    message:
                        "Identifiants administrateur incorrects."

                });


        } catch (error) {

            console.error(
                "ADMIN LOGIN:",
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "Erreur de connexion administrateur."

                });

        }

    }
);


/* ============================================================
   ADMIN ME
============================================================ */

app.get(
    "/api/admin/me",
    adminAuth,
    async (req, res) => {

        res.json({

            success:
                true,

            admin: {

                id:
                    req.admin.id,

                nom:
                    req.admin.nom,

                email:
                    req.admin.email,

                role:
                    req.admin.role,

                plan:
                    req.admin.plan

            }

        });

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
                await dbQuery(
                    `
                    SELECT
                        COUNT(*)::INTEGER AS total,

                        COUNT(*) FILTER (
                            WHERE plan = 'free'
                        )::INTEGER AS free,

                        COUNT(*) FILTER (
                            WHERE plan = 'standard'
                        )::INTEGER AS standard,

                        COUNT(*) FILTER (
                            WHERE plan = 'premium'
                        )::INTEGER AS premium,

                        COUNT(*) FILTER (
                            WHERE is_blocked = TRUE
                        )::INTEGER AS blocked,

                        COUNT(*) FILTER (
                            WHERE role = 'admin'
                        )::INTEGER AS admins
                    FROM users
                    `
                );


            const generations =
                await dbQuery(
                    `
                    SELECT
                        COUNT(*)::INTEGER AS total,

                        COUNT(*) FILTER (
                            WHERE status = 'completed'
                        )::INTEGER AS completed,

                        COUNT(*) FILTER (
                            WHERE status = 'processing'
                        )::INTEGER AS processing,

                        COUNT(*) FILTER (
                            WHERE status = 'failed'
                        )::INTEGER AS failed,

                        COALESCE(
                            SUM(character_count),
                            0
                        )::BIGINT AS characters
                    FROM audio_generations
                    `
                );


            const projects =
                await dbQuery(
                    `
                    SELECT
                        COUNT(*)::INTEGER AS total
                    FROM projects
                    `
                );


            const voices =
                await dbQuery(
                    `
                    SELECT
                        COUNT(*)::INTEGER AS total
                    FROM voices
                    WHERE is_active = TRUE
                    `
                );


            const usage =
                await dbQuery(
                    `
                    SELECT
                        COALESCE(
                            SUM(characters_used),
                            0
                        )::BIGINT AS characters_used,

                        COALESCE(
                            SUM(generations_count),
                            0
                        )::BIGINT AS generations
                    FROM usage_records
                    `
                );


            const stats = {

                users:
                    users.rows[0],

                generations:
                    generations.rows[0],

                projects:
                    projects.rows[0],

                voices:
                    voices.rows[0],

                usage:
                    usage.rows[0]

            };


            res.json({

                success:
                    true,

                statistiques:
                    stats,

                stats

            });


        } catch (error) {

            console.error(
                "ADMIN STATISTIQUES:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

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
                await dbQuery(
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
                    ORDER BY
                        created_at DESC
                    `
                );


            res.json({

                success:
                    true,

                users:
                    result.rows,

                count:
                    result.rows.length

            });


        } catch (error) {

            console.error(
                "ADMIN USERS:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN USER DETAILS
============================================================ */

app.get(
    "/api/admin/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            const result =
                await dbQuery(
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
                    [
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Utilisateur introuvable."

                    });

            }


            const user =
                result.rows[0];


            const usage =
                await getUserUsage(
                    user.id,
                    user.plan
                );


            const generations =
                await dbQuery(
                    `
                    SELECT
                        COUNT(*)::INTEGER AS total
                    FROM audio_generations
                    WHERE user_id = $1
                    `,
                    [
                        user.id
                    ]
                );


            res.json({

                success:
                    true,

                user,

                usage,

                generations:
                    Number(
                        generations.rows[0].total
                    )

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN BLOCK / UNBLOCK USER
============================================================ */

app.patch(
    "/api/admin/users/:id/block",
    adminAuth,
    async (req, res) => {

        try {

            /*
             * Empêcher de bloquer le compte
             * administrateur connecté.
             */

            if (
                String(
                    req.params.id
                ) ===
                String(
                    req.admin.id
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Vous ne pouvez pas bloquer votre propre compte administrateur."

                    });

            }


            const result =
                await dbQuery(
                    `
                    UPDATE users
                    SET
                        is_blocked =
                            NOT is_blocked,

                        updated_at =
                            NOW()
                    WHERE id = $1
                    RETURNING
                        id,
                        nom,
                        email,
                        plan,
                        role,
                        is_active,
                        is_blocked
                    `,
                    [
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Utilisateur introuvable."

                    });

            }


            const user =
                result.rows[0];


            const action =
                user.is_blocked
                    ? "block_user"
                    : "unblock_user";


            await logAdminActivity(
                req,
                req.admin.id,
                action,
                `${user.is_blocked ? "Blocage" : "Déblocage"} de ${user.email}`
            );


            res.json({

                success:
                    true,

                message:
                    user.is_blocked
                        ? "Utilisateur bloqué."
                        : "Utilisateur débloqué.",

                user

            });


        } catch (error) {

            console.error(
                "BLOCK USER:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN ACTIVATE / DEACTIVATE USER
============================================================ */

app.patch(
    "/api/admin/users/:id/status",
    adminAuth,
    async (req, res) => {

        try {

            const isActive =
                Boolean(
                    req.body.is_active
                );


            const result =
                await dbQuery(
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
                        role,
                        plan,
                        is_active,
                        is_blocked
                    `,
                    [
                        isActive,
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Utilisateur introuvable."

                    });

            }


            const user =
                result.rows[0];


            await logAdminActivity(
                req,
                req.admin.id,
                isActive
                    ? "activate_user"
                    : "deactivate_user",
                `${isActive ? "Activation" : "Désactivation"} de ${user.email}`
            );


            res.json({

                success:
                    true,

                message:
                    isActive
                        ? "Utilisateur activé."
                        : "Utilisateur désactivé.",

                user

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN CHANGE PLAN
============================================================ */

app.patch(
    "/api/admin/users/:id/plan",
    adminAuth,
    async (req, res) => {

        try {

            const plan =
                String(
                    req.body.plan ||
                    ""
                )
                    .trim()
                    .toLowerCase();


            if (
                ![
                    "free",
                    "standard",
                    "premium"
                ].includes(
                    plan
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Plan invalide. Utilisez free, standard ou premium."

                    });

            }


            const result =
                await dbQuery(
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
                        role,
                        plan,
                        is_active,
                        is_blocked
                    `,
                    [
                        plan,
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Utilisateur introuvable."

                    });

            }


            const user =
                result.rows[0];


            /*
             * Mettre à jour son quota.
             */

            await dbQuery(
                `
                INSERT INTO user_quotas
                (
                    user_id,
                    monthly_limit,
                    characters_used,
                    month_key
                )
                VALUES
                (
                    $1,
                    $2,
                    0,
                    $3
                )

                ON CONFLICT
                    (user_id)

                DO UPDATE SET

                    monthly_limit =
                        EXCLUDED.monthly_limit,

                    updated_at =
                        NOW()
                `,
                [
                    user.id,

                    getPlanQuota(
                        plan
                    ),

                    getMonthKey()

                ]
            );


            await logAdminActivity(
                req,
                req.admin.id,
                "change_plan",
                `${user.email} → ${plan}`
            );


            res.json({

                success:
                    true,

                message:
                    `Plan ${plan} appliqué avec succès.`,

                user

            });


        } catch (error) {

            console.error(
                "CHANGE PLAN:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN DELETE USER
============================================================ */

app.delete(
    "/api/admin/users/:id",
    adminAuth,
    async (req, res) => {

        try {

            if (
                String(
                    req.params.id
                ) ===
                String(
                    req.admin.id
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "Vous ne pouvez pas supprimer votre propre compte."

                    });

            }


            const result =
                await dbQuery(
                    `
                    DELETE FROM users
                    WHERE id = $1
                    RETURNING
                        id,
                        email
                    `,
                    [
                        req.params.id
                    ]
                );


            if (
                !result.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Utilisateur introuvable."

                    });

            }


            await logAdminActivity(
                req,
                req.admin.id,
                "delete_user",
                `Suppression de ${result.rows[0].email}`
            );


            res.json({

                success:
                    true,

                message:
                    "Utilisateur supprimé.",

                id:
                    result.rows[0].id

            });


        } catch (error) {

            console.error(
                "DELETE USER:",
                error
            );


            res
                .status(500)
                .json({

                    success:
                        false,

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
                await dbQuery(
                    `
                    SELECT
                        ag.id,
                        ag.user_id,
                        ag.project_id,
                        ag.voice_id,
                        ag.voice_external_id,
                        ag.provider,
                        ag.model_id,
                        ag.language,
                        ag.format,
                        ag.character_count,
                        ag.chunk_count,
                        ag.status,
                        ag.error,
                        ag.created_at,
                        u.nom,
                        u.email,
                        v.name AS voice_name,
                        p.title AS project_title
                    FROM audio_generations ag

                    LEFT JOIN users u
                        ON u.id = ag.user_id

                    LEFT JOIN voices v
                        ON v.id = ag.voice_id

                    LEFT JOIN projects p
                        ON p.id = ag.project_id

                    ORDER BY
                        ag.created_at DESC

                    LIMIT 500
                    `
                );


            res.json({

                success:
                    true,

                generations:
                    result.rows,

                count:
                    result.rows.length

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

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
                await dbQuery(
                    `
                    SELECT
                        a.id,
                        a.action,
                        a.description,
                        a.ip_address,
                        a.user_agent,
                        a.created_at,
                        u.nom AS admin_nom,
                        u.email AS admin_email
                    FROM admin_activity a

                    LEFT JOIN users u
                        ON u.id =
                           a.admin_user_id

                    ORDER BY
                        a.created_at DESC

                    LIMIT 500
                    `
                );


            res.json({

                success:
                    true,

                activities:
                    result.rows,

                count:
                    result.rows.length

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

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
                await dbQuery(
                    `
                    SELECT *
                    FROM voices
                    ORDER BY
                        CASE
                            WHEN external_voice_id = $1
                            THEN 0
                            ELSE 1
                        END,
                        name ASC
                    `,
                    [
                        DEFAULT_VOICE_ID
                    ]
                );


            res.json({

                success:
                    true,

                default_voice:
                    DEFAULT_VOICE_ID,

                voices:
                    result.rows,

                count:
                    result.rows.length

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        true,

                    default_voice:
                        DEFAULT_VOICE_ID,

                    voices:
                        FALLBACK_VOICES,

                    count:
                        FALLBACK_VOICES.length,

                    fallback:
                        true

                });

        }

    }
);


/* ============================================================
   ADMIN UPDATE VOICE
============================================================ */

app.patch(
    "/api/admin/voices/:id",
    adminAuth,
    async (req, res) => {

        try {

            /*
             * Ne jamais désactiver la voix
             * principale du serveur.
             */

            const voiceCheck =
                await dbQuery(
                    `
                    SELECT *
                    FROM voices
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [
                        req.params.id
                    ]
                );


            if (
                !voiceCheck.rows.length
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        message:
                            "Voix introuvable."

                    });

            }


            const currentVoice =
                voiceCheck.rows[0];


            let isActive =
                currentVoice.is_active;


            let isPremium =
                currentVoice.is_premium;


            if (
                typeof req.body.is_active ===
                "boolean"
            ) {

                isActive =
                    req.body.is_active;

            }


            if (
                typeof req.body.is_premium ===
                "boolean"
            ) {

                isPremium =
                    req.body.is_premium;

            }


            if (
                currentVoice.external_voice_id ===
                DEFAULT_VOICE_ID
            ) {

                isActive =
                    true;

            }


            const result =
                await dbQuery(
                    `
                    UPDATE voices
                    SET
                        is_active = $1,
                        is_premium = $2,
                        updated_at = NOW()
                    WHERE id = $3
                    RETURNING *
                    `,
                    [
                        isActive,
                        isPremium,
                        req.params.id
                    ]
                );


            await logAdminActivity(
                req,
                req.admin.id,
                "voice_update",
                `Modification de la voix ${result.rows[0].name}`
            );


            res.json({

                success:
                    true,

                voice:
                    result.rows[0]

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN SYNC VOICES
============================================================ */

app.post(
    "/api/admin/voices/sync",
    adminAuth,
    async (req, res) => {

        try {

            const voices =
                await syncElevenLabsVoices();


            await logAdminActivity(
                req,
                req.admin.id,
                "voices_sync",
                `Synchronisation de ${voices.length} voix ElevenLabs.`
            );


            res.json({

                success:
                    true,

                message:
                    "Voix ElevenLabs synchronisées.",

                count:
                    voices.length,

                default_voice:
                    DEFAULT_VOICE_ID

            });


        } catch (error) {

            res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        error.message

                });

        }

    }
);


/* ============================================================
   ADMIN HEALTH
============================================================ */

app.get(
    "/api/admin/health",
    adminAuth,
    async (req, res) => {

        let database =
            false;

        let databaseTime =
            null;


        try {

            const result =
                await dbQuery(
                    `
                    SELECT NOW() AS now
                    `
                );


            database =
                true;

            databaseTime =
                result.rows[0].now;

        } catch (_) {

            database =
                false;

        }


        res.json({

            success:
                true,

            server:
                true,

            database,

            database_time:
                databaseTime,

            elevenlabs:
                Boolean(
                    ELEVENLABS_API_KEY
                ),

            default_voice:
                DEFAULT_VOICE_ID,

            model:
                DEFAULT_MODEL,

            fast_model:
                FAST_MODEL,

            environment:
                process.env.NODE_ENV ||
                "production"

        });

    }
);


/* ============================================================
   404
============================================================ */

app.use(
    (
        req,
        res
    ) => {

        res
            .status(404)
            .json({

                success:
                    false,

                message:
                    "Route introuvable.",

                path:
                    req.path

            });

    }
);


/* ============================================================
   ERROR HANDLER
============================================================ */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "EXPRESS ERROR:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(
                error
            );

        }


        res
            .status(
                error.status ||
                500
            )
            .json({

                success:
                    false,

                message:
                    error.message ||
                    "Erreur interne du serveur."

            });

    }
);


/* ============================================================
   START SERVER
============================================================ */

async function startServer() {

    try {

        console.log("");
        console.log(
            "============================================================"
        );
        console.log(
            " INITIALISATION DE BMJ VOICE AI"
        );
        console.log(
            "============================================================"
        );


        /* ========================================================
           INITIALISATION DE LA BASE DE DONNÉES
        ======================================================== */

        console.log(
            "Initialisation de la base de données..."
        );

        await initDatabase();

        console.log(
            "Base de données initialisée avec succès."
        );


        /* ========================================================
           VÉRIFICATION ELEVENLABS
        ======================================================== */

        if (
            pool &&
            ELEVENLABS_API_KEY
        ) {

            console.log(
                "ElevenLabs détecté."
            );

            console.log(
                "Synchronisation des voix ElevenLabs..."
            );


            try {

                await syncElevenLabsVoices();

                console.log(
                    "Synchronisation des voix ElevenLabs terminée."
                );

            } catch (voiceError) {

                console.error(
                    "Erreur pendant la synchronisation ElevenLabs :",
                    voiceError.message
                );

                /*
                 * Une erreur de synchronisation des voix
                 * ne doit pas empêcher le serveur de démarrer.
                 */

            }

        } else {

            console.log(
                "Synchronisation ElevenLabs ignorée."
            );

            if (!pool) {

                console.log(
                    "PostgreSQL n'est pas disponible."
                );

            }

            if (!ELEVENLABS_API_KEY) {

                console.log(
                    "ELEVENLABS_API_KEY n'est pas configurée."
                );

            }

        }


        /* ========================================================
           GARANTIR LA PRÉSENCE DE LA VOIX PRINCIPALE
        ======================================================== */

        if (pool) {

            try {

                console.log(
                    "Vérification de la voix principale..."
                );


                await dbQuery(
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
                        is_premium
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        TRUE,
                        FALSE
                    )
                    ON CONFLICT (
                        external_voice_id
                    )
                    DO UPDATE SET
                        name = EXCLUDED.name,
                        provider = EXCLUDED.provider,
                        gender = EXCLUDED.gender,
                        language = EXCLUDED.language,
                        language_name = EXCLUDED.language_name,
                        description = EXCLUDED.description,
                        is_active = TRUE,
                        is_premium = FALSE
                    `,
                    [
                        DEFAULT_VOICE_ID,
                        "BMJ Voice — Voix principale",
                        "ElevenLabs",
                        "neutral",
                        "fr",
                        "Français",
                        "Voix principale du serveur BMJ VOICE AI.",
                        null
                    ]
                );


                console.log(
                    "Voix principale vérifiée : " +
                    DEFAULT_VOICE_ID
                );


            } catch (voiceDatabaseError) {

                console.error(
                    "Erreur lors de la vérification de la voix principale :",
                    voiceDatabaseError.message
                );

            }

        }


        /* ========================================================
           VÉRIFICATION POSTGRESQL
        ======================================================== */

        if (pool) {

            try {

                const databaseCheck =
                    await dbQuery(
                        `
                        SELECT
                            NOW() AS current_time
                        `
                    );


                if (
                    databaseCheck &&
                    databaseCheck.rows &&
                    databaseCheck.rows.length
                ) {

                    console.log(
                        "Connexion PostgreSQL : OK"
                    );

                    console.log(
                        "Heure PostgreSQL :",
                        databaseCheck.rows[0].current_time
                    );

                }


            } catch (databaseError) {

                console.error(
                    "Erreur de vérification PostgreSQL :",
                    databaseError.message
                );

            }

        } else {

            console.log(
                "PostgreSQL : NON CONFIGURÉ"
            );

        }


        /* ========================================================
           VÉRIFICATION DES VARIABLES PRINCIPALES
        ======================================================== */

        console.log("");
        console.log(
            "Configuration BMJ VOICE AI :"
        );

        console.log(
            "Application :",
            APP_NAME
        );

        console.log(
            "Port :",
            PORT
        );

        console.log(
            "Environnement :",
            process.env.NODE_ENV || "development"
        );

        console.log(
            "Modèle principal :",
            DEFAULT_MODEL
        );

        console.log(
            "Modèle rapide :",
            FAST_MODEL
        );

        console.log(
            "Format audio :",
            DEFAULT_FORMAT
        );

        console.log(
            "Voix principale :",
            DEFAULT_VOICE_ID
        );

        console.log(
            "ElevenLabs :",
            ELEVENLABS_API_KEY
                ? "CONFIGURÉ"
                : "NON CONFIGURÉ"
        );

        console.log(
            "PostgreSQL :",
            pool
                ? "CONFIGURÉ"
                : "NON CONFIGURÉ"
        );


        /* ========================================================
           DÉMARRAGE DU SERVEUR HTTP
        ======================================================== */

        const server =
            app.listen(
                PORT,
                "0.0.0.0",
                () => {

                    console.log("");
                    console.log(
                        "============================================================"
                    );

                    console.log(
                        " BMJ VOICE AI — SERVEUR ACTIF"
                    );

                    console.log(
                        "============================================================"
                    );

                    console.log(
                        `Port : ${PORT}`
                    );

                    console.log(
                        `Environnement : ${
                            process.env.NODE_ENV ||
                            "development"
                        }`
                    );

                    console.log(
                        `Modèle principal : ${DEFAULT_MODEL}`
                    );

                    console.log(
                        `Modèle rapide : ${FAST_MODEL}`
                    );

                    console.log(
                        `Voix principale : ${DEFAULT_VOICE_ID}`
                    );

                    console.log(
                        `ElevenLabs : ${
                            ELEVENLABS_API_KEY
                                ? "CONFIGURÉ"
                                : "NON CONFIGURÉ"
                        }`
                    );

                    console.log(
                        `PostgreSQL : ${
                            pool
                                ? "CONFIGURÉ"
                                : "NON CONFIGURÉ"
                        }`
                    );

                    console.log(
                        "============================================================"
                    );

                    console.log(
                        "BMJ VOICE AI est prêt à recevoir les requêtes."
                    );

                    console.log("");
                }
            );


        /* ========================================================
           ERREUR DU SERVEUR HTTP
        ======================================================== */

        server.on(
            "error",
            error => {

                console.error("");
                console.error(
                    "Erreur du serveur HTTP :"
                );

                console.error(
                    error
                );

            }
        );


        /* ========================================================
           ARRÊT PROPRE DU SERVEUR
        ======================================================== */

        let isShuttingDown = false;


        const shutdown =
            async signal => {

                if (isShuttingDown) {

                    return;

                }


                isShuttingDown = true;


                console.log("");
                console.log(
                    "============================================================"
                );

                console.log(
                    `Signal ${signal} reçu.`
                );

                console.log(
                    "Arrêt de BMJ VOICE AI..."
                );

                console.log(
                    "============================================================"
                );


                /*
                 * Empêcher les nouvelles connexions.
                 */

                server.close(
                    async error => {

                        if (error) {

                            console.error(
                                "Erreur pendant l'arrêt HTTP :",
                                error.message
                            );

                        } else {

                            console.log(
                                "Serveur HTTP arrêté."
                            );

                        }


                        /* ============================================
                           FERMETURE POSTGRESQL
                        ============================================ */

                        if (pool) {

                            try {

                                await pool.end();

                                console.log(
                                    "Connexion PostgreSQL fermée."
                                );

                            } catch (databaseError) {

                                console.error(
                                    "Erreur fermeture PostgreSQL :",
                                    databaseError.message
                                );

                            }

                        }


                        console.log("");
                        console.log(
                            "BMJ VOICE AI arrêté proprement."
                        );

                        console.log("");

                        process.exit(
                            error
                                ? 1
                                : 0
                        );

                    }
                );


                /* ============================================
                   ARRÊT FORCÉ DE SÉCURITÉ
                ============================================ */

                setTimeout(
                    () => {

                        console.error(
                            "Le serveur n'a pas pu s'arrêter correctement."
                        );

                        console.error(
                            "Arrêt forcé."
                        );

                        process.exit(1);

                    },
                    10000
                ).unref();

            };


        /* ========================================================
           SIGTERM — RENDER
        ======================================================== */

        process.once(
            "SIGTERM",
            () => {

                shutdown(
                    "SIGTERM"
                );

            }
        );


        /* ========================================================
           SIGINT — LOCAL / CTRL+C
        ======================================================== */

        process.once(
            "SIGINT",
            () => {

                shutdown(
                    "SIGINT"
                );

            }
        );


    } catch (error) {

        console.error("");
        console.error(
            "============================================================"
        );

        console.error(
            " ERREUR FATALE AU DÉMARRAGE DE BMJ VOICE AI"
        );

        console.error(
            "============================================================"
        );

        console.error(
            error
        );

        console.error(
            "============================================================"
        );

        process.exit(1);

    }

}


/* ============================================================
   LANCEMENT DE BMJ VOICE AI
============================================================ */

startServer()
    .catch(
        error => {

            console.error("");
            console.error(
                "============================================================"
            );

            console.error(
                " ERREUR INATTENDUE"
            );

            console.error(
                "============================================================"
            );

            console.error(
                error
            );

            console.error(
                "============================================================"
            );

            process.exit(1);

        }
    );