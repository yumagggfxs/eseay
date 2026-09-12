/* ============================================================
   CONFIGURATION BMJ VOICE AI
============================================================ */

"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");


/* ============================================================
   SERVEUR
============================================================ */

const app = express();

const PORT = process.env.PORT || 10000;

const NODE_ENV =
    process.env.NODE_ENV || "production";


/* ============================================================
   BASE DE DONNÉES
============================================================ */

/*
 * ⚠️ Remplace cette valeur par ton URL PostgreSQL.
 * Ne publie jamais cette URL sur GitHub.
 */

const DATABASE_URL =
    "postgresql://audio_db_n28a_user:yLIb8T9QvrQtUPymu7D5U0jkLl6xBdYc@dpg-dai8lo0ae00c73dlk1rg-a/audio_db_n28a";


const pool = new Pool({
    connectionString: DATABASE_URL,

    ssl:
        NODE_ENV === "production"
            ? {
                rejectUnauthorized: false
            }
            : false,

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
});


/* ============================================================
   ELEVENLABS
============================================================ */

/*
 * ⚠️ Ne mets pas ton ancienne clé exposée.
 * Crée une NOUVELLE clé ElevenLabs puis colle-la ici.
 */

const ELEVENLABS_API_KEY =
    "sk_5e371bcffb2b4762ea4c6247699dfe32ec06092590143a86";


/*
 * Voice ID fourni par ElevenLabs
 */

const ELEVENLABS_DEFAULT_VOICE_ID =
    "mQS95w8LbLFsF6QihxDH";


/* ============================================================
   MODÈLES ELEVENLABS
============================================================ */

const ELEVENLABS_MODEL_ID =
    "eleven_v3";

const ELEVENLABS_FAST_MODEL_ID =
    "eleven_flash_v2_5";


/* ============================================================
   AUTHENTIFICATION
============================================================ */

const JWT_SECRET =
    process.env.JWT_SECRET ||
    "BMJ_VOICE_AI_CHANGE_THIS_SECRET";


/* ============================================================
   ADMIN
============================================================ */

const ADMIN_EMAIL =
    process.env.ADMIN_EMAIL ||
    "admin@bmjvoiceai.com";

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD ||
    "CHANGE_ADMIN_PASSWORD";


/* ============================================================
   FRONTEND
============================================================ */

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "*";

const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    "https://eseay.onrender.com";


/* ============================================================
   MIDDLEWARE
============================================================ */

app.use(
    cors({
        origin: FRONTEND_URL === "*" ? true : FRONTEND_URL,
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
   TEST DATABASE
============================================================ */

async function testDatabase() {

    const result =
        await pool.query(
            "SELECT NOW() AS now, current_database() AS database"
        );

    return result.rows[0];
}


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
                api: "online",
                database: "connected",
                database_name: db.database,
                database_time: db.now,
                elevenlabs:
                    ELEVENLABS_API_KEY &&
                    ELEVENLABS_API_KEY.startsWith("sk_"),
                default_voice:
                    Boolean(ELEVENLABS_DEFAULT_VOICE_ID),
                model:
                    ELEVENLABS_MODEL_ID,
                fast_model:
                    ELEVENLABS_FAST_MODEL_ID,
                environment:
                    NODE_ENV,
                port:
                    PORT
            });

        } catch (error) {

            console.error(
                "Health error:",
                error
            );

            res.status(500).json({
                success: false,
                api: "online",
                database: "error",
                error: error.message
            });
        }
    }
);


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
            version: "1.0.0",
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
            version: "1.0.0",
            status: "online"
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
                    "SELECT NOW() AS now, current_database() AS database"
                );

            res.json({
                success: true,
                database:
                    result.rows[0].database,
                time:
                    result.rows[0].now
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* ============================================================
   SPLIT TEXT
============================================================ */

function splitText(
    text,
    maxLength
) {

    const clean =
        String(text || "")
            .trim();

    if (!clean) {
        return [];
    }

    if (clean.length <= maxLength) {
        return [clean];
    }

    const chunks = [];

    let current = "";

    const sentences =
        clean.match(
            /[^.!?]+[.!?]+|\s*$/g
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
            (current.length +
                part.length +
                1) <= maxLength
        ) {

            current =
                current
                    ? current + " " + part
                    : part;

        } else {

            if (current) {
                chunks.push(current);
            }

            if (
                part.length > maxLength
            ) {

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

                current = "";

            } else {

                current = part;
            }
        }
    }

    if (current) {
        chunks.push(current);
    }

    return chunks;
}


/* ============================================================
   ELEVENLABS GENERATION
============================================================ */

async function generateElevenLabsAudio(
    text,
    voiceId,
    modelId
) {

    if (
        !ELEVENLABS_API_KEY ||
        !ELEVENLABS_API_KEY.startsWith("sk_")
    ) {

        throw new Error(
            "Clé ElevenLabs non configurée."
        );
    }

    if (!voiceId) {

        throw new Error(
            "Voice ID ElevenLabs non configuré."
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

                body: JSON.stringify({
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
   VOICE TEST
============================================================ */

app.get(
    "/api/elevenlabs/status",
    (req, res) => {

        res.json({
            success: true,

            configured:
                Boolean(
                    ELEVENLABS_API_KEY &&
                    ELEVENLABS_API_KEY.startsWith("sk_")
                ),

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
   DÉMARRAGE
============================================================ */

async function startServer() {

    try {

        const db =
            await testDatabase();

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
            ELEVENLABS_API_KEY &&
            ELEVENLABS_API_KEY.startsWith("sk_")
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
            "Erreur démarrage BMJ VOICE AI :",
            error
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