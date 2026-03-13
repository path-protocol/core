/* ============================================================
   PATH — script.js
   Complete MVP logic.
   Vanilla JS. No frameworks. No bundlers.
   4-space indentation. British English comments.

   Gemini model: gemini-2.5-flash (all calls — confirmed stable March 2026)
   CV input is compressed before sending to keep prompt tokens low
   and ensure the JSON response is never truncated.

   Firebase project: path-protocol
   ============================================================ */


/* ------------------------------------------------------------
   FIREBASE CONFIGURATION
   ------------------------------------------------------------ */

const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDpkxm7nXb4rM0cPKNoiwkMrXCbr4HRwM8",
    authDomain:        "path-protocol.firebaseapp.com",
    projectId:         "path-protocol",
    storageBucket:     "path-protocol.firebasestorage.app",
    messagingSenderId: "808785928819",
    appId:             "1:808785928819:web:80c912f0d06c9aa86f4006"
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL    = "gemini-2.5-flash";


/* ------------------------------------------------------------
   APPLICATION STATE
   ------------------------------------------------------------ */

const state = {
    sessionId:         null,
    onboardingPath:    null,   // "cv" | "reimagine"
    geminiKey:         null,

    rawInput: {
        cvText:             null,
        reimagineResponses: null
    },

    inference: {
        cardsPresented:      [],
        cardsSelectedRound1: [],
        cardsSelectedRound2: null,
        roundsToConverge:    0
    },

    confirmedPractice: null,
    pathName:          null,
    confidence:        null,   // "low" | "medium" | "high"

    statusScreen: {
        stats:        [],
        confirmed:    false,
        flaggedStats: [],
        originStory:  null
    },

    encounter: {
        name:           null,
        situation:      null,
        expertResponse: null
    },

    situationEngaged:  false,
    waitlistSignup:    false,
    waitlistEmail:     null,

    // Internal flow tracking
    reimagineCurrentQ: 1
};


/* ------------------------------------------------------------
   FIREBASE INITIALISATION
   ------------------------------------------------------------ */

let db = null;

function initFirebase() {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.firestore();
    } catch (err) {
        console.warn("PATH: Firebase init failed —", err.message);
    }
}

async function writeSessionToFirestore() {
    if (!db) return;
    try {
        await db.collection("sessions").doc(state.sessionId).set({
            sessionId:        state.sessionId,
            onboardingPath:   state.onboardingPath,
            rawInput: {
                cvText:             state.rawInput.cvText,
                reimagineResponses: state.rawInput.reimagineResponses
            },
            inference: {
                cardsPresented:      state.inference.cardsPresented,
                cardsSelectedRound1: state.inference.cardsSelectedRound1,
                cardsSelectedRound2: state.inference.cardsSelectedRound2,
                roundsToConverge:    state.inference.roundsToConverge
            },
            confirmedPractice: state.confirmedPractice,
            pathName:          state.pathName,
            confidence:        state.confidence,
            statusScreen: {
                stats:        state.statusScreen.stats,
                confirmed:    state.statusScreen.confirmed,
                flaggedStats: state.statusScreen.flaggedStats,
                originStory:  state.statusScreen.originStory
            },
            situationEngaged: state.situationEngaged,
            waitlistSignup:   state.waitlistSignup,
            waitlistEmail:    state.waitlistEmail,
            createdAt:        firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.warn("PATH: Firestore session write failed —", err.message);
    }
}


/* ------------------------------------------------------------
   SCREEN NAVIGATION
   ------------------------------------------------------------ */

function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add("active");
        window.scrollTo(0, 0);
    }
}


/* ------------------------------------------------------------
   GEMINI API
   ------------------------------------------------------------ */

async function callGemini(prompt, maxTokens) {
    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${state.geminiKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature:     0.7,
                maxOutputTokens: maxTokens || 8192
            }
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini API error ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
        const finishReason = data.candidates?.[0]?.finishReason;
        throw new Error(`Gemini returned no text. Finish reason: ${finishReason || "unknown"}`);
    }

    return text;
}

async function validateGeminiKey(key) {
    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${key}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with the single word: ready" }] }],
            generationConfig: { maxOutputTokens: 10 }
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || "Invalid key");
    }
    return true;
}

/* Robust JSON extraction — handles code fences and leading/trailing prose */
function parseJsonResponse(raw) {
    // Strip markdown code fences if present
    let cleaned = raw
        .replace(/^```json\s*/im, "")
        .replace(/^```\s*/im, "")
        .replace(/```\s*$/im, "")
        .trim();

    // Try direct parse first
    try {
        return JSON.parse(cleaned);
    } catch (_) {
        // Fall through to extraction
    }

    // Extract JSON array or object from surrounding prose
    const arrayMatch  = cleaned.match(/(\[[\s\S]*\])/);
    const objectMatch = cleaned.match(/(\{[\s\S]*\})/);

    if (arrayMatch) {
        try { return JSON.parse(arrayMatch[1]); } catch (_) {}
    }
    if (objectMatch) {
        try { return JSON.parse(objectMatch[1]); } catch (_) {}
    }

    // Log what we got to help diagnose future failures
    console.error("PATH: Could not parse JSON from Gemini response:", cleaned.slice(0, 500));
    throw new SyntaxError("Could not extract valid JSON from Gemini response");
}


/* ------------------------------------------------------------
   CV COMPRESSION
   Strips formatting noise and filler from pasted CV text before
   sending to Gemini. Keeps all signal (roles, dates, tasks,
   skills, results) and discards everything else.
   Goal: reduce a 2,000-word CV to ~600 tokens without losing
   any information the model needs to identify practice.
   ------------------------------------------------------------ */

function compressCV(raw) {
    return raw
        // Collapse runs of whitespace/newlines into single spaces
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        // Strip horizontal rules and repeated punctuation used as decorators
        .replace(/[-=*_|]{3,}/g, "")
        // Strip common boilerplate phrases (case-insensitive)
        .replace(/references\s+available\s+(on\s+)?request\.?/gi, "")
        .replace(/curriculum\s+vitae/gi, "")
        .replace(/personal\s+statement\s*:/gi, "")
        .replace(/objective\s*:/gi, "")
        .replace(/profile\s*:/gi, "")
        .replace(/i\s+am\s+a\s+(highly\s+)?(motivated|passionate|dedicated|driven|results[- ]oriented|dynamic|hardworking|detail[- ]oriented)\s+/gi, "")
        .replace(/with\s+(a\s+)?(strong|proven|extensive|excellent)\s+(track\s+record|background|experience)\s+(of|in)\s+/gi, "")
        // Strip URLs and email addresses (signal-free for this analysis)
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\b[\w.+-]+@[\w-]+\.\w{2,}\b/g, "")
        // Strip phone numbers
        .replace(/(\+?\d[\d\s\-().]{7,}\d)/g, "")
        // Strip nationality / date of birth lines (common in Nigerian/UK CVs)
        .replace(/(nationality|date of birth|dob|gender|marital status)\s*:.*\n?/gi, "")
        // Clean up leftover blank lines from stripping
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}


/* ------------------------------------------------------------
   GEMINI PROMPTS
   ------------------------------------------------------------ */

function buildPromptCV(cvText) {
    return `You are analysing a CV to identify the user's specific career practice — the precise mode of work where a coherent set of expert judgement calls exists. Not their job title or industry — their practice.

Extract:
- Current and most recent roles
- Actual tasks and responsibilities in the user's own words
- Industry and sub-field signals
- Language pointing toward practice-level specificity
- Indicators of seniority and experience depth

Return exactly 3 to 5 practice options as a JSON array. Each object must have:
- "name": precise practice name (e.g. "Early-stage B2B SaaS sales", not "Sales")
- "explanation": two plain-language sentences describing what this practice involves day-to-day

CRITICAL: Return ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].

CV:
${cvText}`;
}

function buildPromptReimagine(responses) {
    const formatted = responses.map((r, i) => `Q${i + 1}: ${r || "(no response)"}`).join("\n\n");
    return `You are analysing informal experience descriptions to identify capability signals pointing toward a specific career practice. The person may have no professional experience.

Find what their experiences already demonstrate. A person who organised a group trip demonstrates project coordination. A person who runs an online community demonstrates community management. A person who taught themselves to code demonstrates self-directed technical learning. Translate informal experience into practice-level signals.

Return exactly 3 to 5 practice options as a JSON array. Each object must have:
- "name": precise practice name matching the capability signals found
- "explanation": two plain-language sentences describing what this practice involves and why their experiences point toward it

Cards may point forward — toward where these signals naturally lead.

CRITICAL: Return ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].

Responses:
${formatted}`;
}

function buildPromptReconcile(selectedNames) {
    return `A user is identifying their career practice and selected multiple options in round one, suggesting the options were too broad or overlapping.

Selected practices: ${selectedNames.join(", ")}

Generate 2 to 3 more precise practice options that make finer distinctions within or between the selected practices.

Each object must have:
- "name": more precise practice name
- "explanation": two plain-language sentences

CRITICAL: Return ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].`;
}

function buildPromptCharacterSheet(practiceName, path) {
    return `You are generating a career character sheet for someone whose confirmed practice is:
${practiceName}
Onboarding path: ${path}

Identify:
1. What a surface-level practitioner does
2. What an expert practitioner does differently
3. The key dimensions of judgement that separate them

Generate 4 to 6 stats measuring the user's starting level across those dimensions.

Each stat must have:
- "name": plain-language, immediately self-explanatory to someone in this field. Not abstract. Not metaphorical. (e.g. "Case Theory Construction" not "Pattern Lock")
- "definition": one sentence in the exact vocabulary of this practice
- "level": one of — Early, Developing, Solid, Advanced
- "isLowest": true for the one stat with the weakest starting level, false for all others

Also generate:
- "pathName": two words — [Field Noun] + [Judgement Word] (e.g. "Product Sense", "Legal Reasoning", "Clinical Judgement")
- "originStory": for reimagine path only — one short paragraph describing what the user's experiences already demonstrate and where that naturally points. For cv path, return null.

Levels should reflect honest starting baselines — not flattery.

CRITICAL: Return ONLY a valid JSON object with keys: "stats" (array), "pathName" (string), "originStory" (string or null). No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;
}

function buildPromptEncounter(practiceName, lowestStatName) {
    return `You are generating a first encounter preview for someone in the practice: ${practiceName}

Their weakest stat is: ${lowestStatName}

Generate a single named situation that tests this specific dimension.

The situation must:
- Have a name (2 to 4 words, like a scenario title)
- Describe exactly what the situation looks like when it arrives (2 to 3 sentences, plain language)
- Include an expert response — what the reasoning-layer practitioner does differently (2 to 3 sentences)

CRITICAL: Return ONLY a valid JSON object with keys: "name" (string), "situation" (string), "expertResponse" (string). No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;
}


/* ------------------------------------------------------------
   CARD RENDERING
   ------------------------------------------------------------ */

function renderCards(containerId, cards, multiSelect) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    cards.forEach((card, i) => {
        const el = document.createElement("div");
        el.className = "practice-card";
        el.dataset.index = i;
        el.dataset.name  = card.name;
        el.innerHTML = `
            <span class="card-check">SEL</span>
            <div class="card-name">${escapeHtml(card.name)}</div>
            <div class="card-explanation">${escapeHtml(card.explanation)}</div>
        `;
        el.addEventListener("click", () => {
            if (multiSelect) {
                el.classList.toggle("selected");
            } else {
                container.querySelectorAll(".practice-card").forEach(c => c.classList.remove("selected"));
                el.classList.add("selected");
            }
        });
        container.appendChild(el);
    });
}

function getSelectedCardNames(containerId) {
    return Array.from(
        document.querySelectorAll(`#${containerId} .practice-card.selected`)
    ).map(el => el.dataset.name);
}


/* ------------------------------------------------------------
   STAT AND FLAG RENDERING
   ------------------------------------------------------------ */

function renderStats(stats) {
    const container = document.getElementById("stat-list");
    container.innerHTML = "";
    stats.forEach(stat => {
        const levelClass = `stat-level--${stat.level.toLowerCase()}`;
        const item = document.createElement("div");
        item.className = "stat-item";
        item.innerHTML = `
            <span class="stat-name term"
                  data-definition="${escapeHtml(stat.definition)}"
                  data-stat-name="${escapeHtml(stat.name)}">${escapeHtml(stat.name)}</span>
            <span class="stat-level ${levelClass}">${escapeHtml(stat.level)}</span>
        `;
        // Wire tooltip to stored definition — no second API call
        item.querySelector(".term").addEventListener("click", function () {
            showTooltip(this.dataset.statName, this.dataset.definition);
        });
        container.appendChild(item);
    });
}

function renderFlagList(stats) {
    const container = document.getElementById("flag-list");
    container.innerHTML = "";
    stats.forEach(stat => {
        const item = document.createElement("label");
        item.className = "flag-item";
        item.innerHTML = `
            <input type="checkbox" value="${escapeHtml(stat.name)}" />
            ${escapeHtml(stat.name)}
        `;
        item.querySelector("input").addEventListener("change", () => {
            item.classList.toggle("flagged", item.querySelector("input").checked);
        });
        container.appendChild(item);
    });
}


/* ------------------------------------------------------------
   CONFIDENCE
   ------------------------------------------------------------ */

function calculateConfidence(roundsToConverge, flagCount) {
    if (roundsToConverge >= 3 || flagCount >= 2) return "low";
    if (roundsToConverge === 2 || flagCount === 1) return "medium";
    return "high";
}


/* ------------------------------------------------------------
   TOOLTIP SYSTEM
   ------------------------------------------------------------ */

const TERM_DEFINITIONS = {
    "origin-story": "The part of your character sheet that tells the story of where your capabilities come from — what your experience already demonstrates, before any formal job title gets in the way.",
    "encounter":    "A named situation from your practice — one that regularly separates people who operate on instinct from people who operate with real judgement. You face it, make a call, then see how an expert approaches it."
};

function showTooltip(termName, bodyText) {
    document.getElementById("tooltip-term").textContent = termName;
    document.getElementById("tooltip-body").textContent = bodyText || TERM_DEFINITIONS[termName] || "";
    document.getElementById("tooltip-overlay").classList.remove("hidden");
}

function closeTooltip() {
    document.getElementById("tooltip-overlay").classList.add("hidden");
}

function attachStaticTermTriggers() {
    document.querySelectorAll(".term[data-term]").forEach(el => {
        const fresh = el.cloneNode(true);
        el.parentNode.replaceChild(fresh, el);
        fresh.addEventListener("click", () => {
            showTooltip(fresh.textContent.trim(), TERM_DEFINITIONS[fresh.dataset.term] || "");
        });
    });
}

document.getElementById("tooltip-close").addEventListener("click", closeTooltip);
document.getElementById("tooltip-overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeTooltip();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTooltip(); });


/* ------------------------------------------------------------
   UTILITY
   ------------------------------------------------------------ */

function generateSessionId() {
    return "path_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setHint(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "field-hint" + (type ? ` field-hint--${type}` : "");
}


/* ============================================================
   EVENT HANDLERS — full flow
   ============================================================ */


/* ------------------------------------------------------------
   LANDING
   ------------------------------------------------------------ */

document.getElementById("btn-begin").addEventListener("click", () => {
    showScreen("screen-path-select");
});


/* ------------------------------------------------------------
   PATH SELECTION
   ------------------------------------------------------------ */

document.getElementById("btn-cv-path").addEventListener("click", () => {
    state.onboardingPath = "cv";
    showScreen("screen-cv-paste");     // Input first
});

document.getElementById("btn-reimagine-path").addEventListener("click", () => {
    state.onboardingPath = "reimagine";
    showScreen("screen-reimagine");    // Input first
});


/* ------------------------------------------------------------
   CV PASTE → API KEY → GEMINI CALL 1
   Flow: CV paste → Continue → API key screen → Validate & Analyse
   ------------------------------------------------------------ */

document.getElementById("btn-cv-next").addEventListener("click", () => {
    const cvText = document.getElementById("input-cv").value.trim();
    if (cvText.length < 80) {
        alert("Please paste your full CV — the analysis needs enough text to work from.");
        return;
    }
    state.rawInput.cvText = cvText;
    showScreen("screen-api-key");
});


/* ------------------------------------------------------------
   RE-IMAGINE QUESTION NAVIGATION
   Flow: Q1–Q5 → Complete → API key screen → Validate & Analyse
   ------------------------------------------------------------ */

function updateReimagineUI() {
    const q = state.reimagineCurrentQ;
    document.getElementById("reimagine-q-num").textContent = q;
    document.getElementById("btn-reimagine-back").style.visibility = q === 1 ? "hidden" : "visible";
    document.getElementById("btn-reimagine-next").textContent = q === 5 ? "Continue" : "Next";
}

document.getElementById("btn-reimagine-next").addEventListener("click", () => {
    const q     = state.reimagineCurrentQ;
    const input = document.getElementById(`input-reimagine-${q}`).value.trim();

    if (!input) {
        alert("Please write something before continuing — even a short answer is fine.");
        return;
    }

    if (q < 5) {
        document.getElementById(`reimagine-q${q}`).classList.remove("active");
        document.getElementById(`reimagine-q${q + 1}`).classList.add("active");
        state.reimagineCurrentQ = q + 1;
        updateReimagineUI();
        return;
    }

    // All 5 answered — store and proceed to API key
    const responses = [1, 2, 3, 4, 5].map(n =>
        document.getElementById(`input-reimagine-${n}`).value.trim()
    );
    state.rawInput.reimagineResponses = responses;
    showScreen("screen-api-key");
});

document.getElementById("btn-reimagine-back").addEventListener("click", () => {
    const q = state.reimagineCurrentQ;
    if (q > 1) {
        document.getElementById(`reimagine-q${q}`).classList.remove("active");
        document.getElementById(`reimagine-q${q - 1}`).classList.add("active");
        state.reimagineCurrentQ = q - 1;
        updateReimagineUI();
    }
});


/* ------------------------------------------------------------
   API KEY VALIDATION → DISPATCH TO ANALYSIS
   ------------------------------------------------------------ */

document.getElementById("btn-validate-key").addEventListener("click", async () => {
    const key = document.getElementById("input-api-key").value.trim();
    if (!key) {
        setHint("api-key-hint", "Please paste your Gemini API key.", "error");
        return;
    }

    const btn    = document.getElementById("btn-validate-key");
    const loader = document.getElementById("api-key-loader");
    btn.disabled = true;
    loader.classList.remove("hidden");
    setHint("api-key-hint", "");

    try {
        await validateGeminiKey(key);
        state.geminiKey = key;
        setHint("api-key-hint", "Key validated.", "success");

        // Dispatch based on which path collected input
        setTimeout(() => {
            if (state.onboardingPath === "cv") {
                runCVAnalysis();
            } else {
                runReimagineAnalysis();
            }
        }, 400);
    } catch (err) {
        setHint("api-key-hint", "Key not recognised. Check it and try again.", "error");
        btn.disabled = false;
        loader.classList.add("hidden");
    }
});


/* ------------------------------------------------------------
   CV ANALYSIS — GEMINI CALL 1
   ------------------------------------------------------------ */

async function runCVAnalysis() {
    document.getElementById("loading-1-label").textContent = "READING CAREER HISTORY...";
    showScreen("screen-loading-1");

    try {
        const compressed = compressCV(state.rawInput.cvText);
        const raw   = await callGemini(buildPromptCV(compressed), 8192);
        const cards = parseJsonResponse(raw);
        state.inference.cardsPresented = cards;
        renderCards("card-grid-1", cards, true);
        showScreen("screen-cards-1");
    } catch (err) {
        console.error("PATH: CV analysis failed —", err);
        alert("Analysis failed — " + err.message + "\n\nPlease go back and try again.");
        showScreen("screen-cv-paste");
    }
}


/* ------------------------------------------------------------
   RE-IMAGINE ANALYSIS — GEMINI CALL 1
   ------------------------------------------------------------ */

async function runReimagineAnalysis() {
    document.getElementById("loading-1-label").textContent = "FINDING WHAT YOUR EXPERIENCE IS TELLING US...";
    showScreen("screen-loading-1");

    try {
        const raw   = await callGemini(buildPromptReimagine(state.rawInput.reimagineResponses), 8192);
        const cards = parseJsonResponse(raw);
        state.inference.cardsPresented = cards;
        renderCards("card-grid-1", cards, true);
        showScreen("screen-cards-1");
    } catch (err) {
        console.error("PATH: Re-imagine analysis failed —", err);
        alert("Analysis failed — " + err.message + "\n\nPlease go back and try again.");
        showScreen("screen-reimagine");
    }
}


/* ------------------------------------------------------------
   PRACTICE CARDS ROUND 1
   ------------------------------------------------------------ */

document.getElementById("btn-cards-1-confirm").addEventListener("click", async () => {
    const selected = getSelectedCardNames("card-grid-1");
    if (selected.length === 0) {
        alert("Please select at least one practice that resonates.");
        return;
    }

    state.inference.cardsSelectedRound1 = selected;

    if (selected.length === 1) {
        state.confirmedPractice          = selected[0];
        state.inference.roundsToConverge = 1;
        await generateCharacterSheet();
    } else {
        state.inference.roundsToConverge = 2;
        await runRound2(selected);
    }
});

async function runRound2(selectedNames) {
    document.getElementById("loading-1-label").textContent = "NARROWING DOWN...";
    showScreen("screen-loading-1");
    try {
        const raw   = await callGemini(buildPromptReconcile(selectedNames), 4096);
        const cards = parseJsonResponse(raw);
        renderCards("card-grid-2", cards, false);
        showScreen("screen-cards-2");
    } catch (err) {
        console.error("PATH: Round 2 failed —", err);
        alert("Something went wrong. Please try again.\n\n" + err.message);
        showScreen("screen-cards-1");
    }
}


/* ------------------------------------------------------------
   PRACTICE CARDS ROUND 2
   ------------------------------------------------------------ */

document.getElementById("btn-cards-2-confirm").addEventListener("click", async () => {
    const selected = getSelectedCardNames("card-grid-2");
    if (selected.length === 0) {
        alert("Please select the practice that fits best.");
        return;
    }
    state.inference.cardsSelectedRound2 = selected;
    state.confirmedPractice             = selected[0];
    await generateCharacterSheet();
});


/* ------------------------------------------------------------
   CHARACTER SHEET GENERATION — GEMINI CALL 2
   ------------------------------------------------------------ */

async function generateCharacterSheet() {
    document.getElementById("loading-2-label").textContent = "BUILDING CHARACTER SHEET...";
    showScreen("screen-loading-2");

    try {
        const raw  = await callGemini(buildPromptCharacterSheet(state.confirmedPractice, state.onboardingPath), 8192);
        const data = parseJsonResponse(raw);

        state.pathName                 = data.pathName;
        state.statusScreen.stats       = data.stats;
        state.statusScreen.originStory = data.originStory || null;

        document.getElementById("sheet-practice-name").textContent = state.confirmedPractice;
        document.getElementById("sheet-path-name").textContent     = state.pathName;

        // Origin Story: Re-imagine path only
        const originBlock = document.getElementById("origin-story-block");
        if (state.onboardingPath === "reimagine" && data.originStory) {
            document.getElementById("origin-story-text").textContent = data.originStory;
            originBlock.classList.remove("hidden");
        } else {
            originBlock.classList.add("hidden");
        }

        // Confirmation footer differs by path
        document.getElementById("sheet-footer-note").textContent =
            state.onboardingPath === "reimagine"
                ? "THESE REFLECT WHERE YOU ARE STARTING FROM. THEY CHANGE AS YOU PLAY."
                : "THESE REFLECT WHERE YOU ARE NOW. THEY CHANGE AS YOU PLAY.";

        renderStats(data.stats);
        attachStaticTermTriggers();
        showScreen("screen-character-sheet");
    } catch (err) {
        console.error("PATH: Character sheet generation failed —", err);
        alert("Something went wrong building your character sheet. Please try again.\n\n" + err.message);
        showScreen("screen-cards-1");
    }
}


/* ------------------------------------------------------------
   CHARACTER SHEET CONFIRMATION
   ------------------------------------------------------------ */

document.getElementById("btn-sheet-confirm").addEventListener("click", () => {
    state.statusScreen.confirmed    = true;
    state.statusScreen.flaggedStats = [];
    state.confidence = calculateConfidence(state.inference.roundsToConverge, 0);
    generateEncounterPreview();
});

document.getElementById("btn-sheet-flag").addEventListener("click", () => {
    renderFlagList(state.statusScreen.stats);
    showScreen("screen-flag");
});

document.getElementById("btn-flag-confirm").addEventListener("click", () => {
    const flagged = Array.from(
        document.querySelectorAll("#flag-list input[type='checkbox']:checked")
    ).map(el => el.value);

    state.statusScreen.confirmed    = false;
    state.statusScreen.flaggedStats = flagged;
    state.confidence = calculateConfidence(state.inference.roundsToConverge, flagged.length);

    state.statusScreen.stats = state.statusScreen.stats.map(stat => ({
        ...stat,
        flagged: flagged.includes(stat.name)
    }));

    generateEncounterPreview();
});


/* ------------------------------------------------------------
   ENCOUNTER PREVIEW — GEMINI CALL 3
   ------------------------------------------------------------ */

async function generateEncounterPreview() {
    const lowest = state.statusScreen.stats.find(s => s.isLowest)
        || state.statusScreen.stats[state.statusScreen.stats.length - 1];

    document.getElementById("loading-2-label").textContent = "GENERATING FIRST ENCOUNTER...";
    showScreen("screen-loading-2");

    try {
        const raw  = await callGemini(buildPromptEncounter(state.confirmedPractice, lowest.name), 4096);
        const data = parseJsonResponse(raw);

        state.encounter.name           = data.name;
        state.encounter.situation      = data.situation;
        state.encounter.expertResponse = data.expertResponse;

        document.getElementById("encounter-name").textContent       = data.name;
        document.getElementById("encounter-situation").textContent  = data.situation;
        document.getElementById("expert-response-text").textContent = data.expertResponse;

        // Reset encounter UI state
        document.getElementById("expert-response-block").classList.add("hidden");
        document.getElementById("encounter-actions-primary").classList.remove("hidden");
        document.getElementById("input-encounter-response").value = "";

        attachStaticTermTriggers();
        showScreen("screen-encounter");
    } catch (err) {
        console.error("PATH: Encounter generation failed —", err);
        // Non-fatal — skip to waitlist and still record session
        writeSessionToFirestore();
        showScreen("screen-waitlist");
    }
}


/* ------------------------------------------------------------
   ENCOUNTER INTERACTIONS
   ------------------------------------------------------------ */

document.getElementById("btn-reveal-expert").addEventListener("click", () => {
    state.situationEngaged = true;
    document.getElementById("encounter-actions-primary").classList.add("hidden");
    document.getElementById("expert-response-block").classList.remove("hidden");
});

document.getElementById("btn-encounter-skip").addEventListener("click", () => {
    writeSessionToFirestore();
    showScreen("screen-waitlist");
});

document.getElementById("btn-encounter-continue").addEventListener("click", () => {
    writeSessionToFirestore();
    showScreen("screen-waitlist");
});


/* ------------------------------------------------------------
   WAITLIST
   ------------------------------------------------------------ */

document.getElementById("btn-waitlist-submit").addEventListener("click", async () => {
    const email = document.getElementById("input-waitlist-email").value.trim();
    if (!email || !email.includes("@")) {
        alert("Please enter a valid email address.");
        return;
    }

    state.waitlistSignup = true;
    state.waitlistEmail  = email;

    // Write full session
    await writeSessionToFirestore();

    // Also write to dedicated waitlist collection for easy querying
    if (db) {
        try {
            await db.collection("waitlist").add({
                email:     email,
                sessionId: state.sessionId,
                path:      state.onboardingPath,
                practice:  state.confirmedPractice,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.warn("PATH: Waitlist write failed —", err.message);
        }
    }

    document.getElementById("waitlist-form").classList.add("hidden");
    document.getElementById("waitlist-confirmation").classList.remove("hidden");
});

document.getElementById("btn-waitlist-skip").addEventListener("click", () => {
    state.waitlistSignup = false;
    writeSessionToFirestore();
    document.getElementById("waitlist-form").classList.add("hidden");
    document.getElementById("waitlist-confirmation").classList.remove("hidden");
    document.getElementById("waitlist-confirmation-text").textContent =
        "YOUR CHARACTER SHEET HAS BEEN RECORDED.";
});


/* ------------------------------------------------------------
   INITIALISATION
   ------------------------------------------------------------ */

function init() {
    state.sessionId = generateSessionId();
    initFirebase();
    updateReimagineUI();
    attachStaticTermTriggers();
}

init();
