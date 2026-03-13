/* ============================================================
   PATH — script.js
   Vanilla JS. No frameworks. No bundlers.
   4-space indentation. British English comments.

   Gemini model: gemini-2.5-flash (all calls)
   Firebase project: path-protocol

   Flow summary:
     Boot → Landing → Path Select →
     [Track A] CV Paste → Neural Link → API Key → Cards R1→R2→R3 → Sheet → [Probe if flagged] → Encounter → Waitlist
     [Track B] 3 Questions → Neural Link → API Key → Cards R1→R2→R3 → Sheet → [Probe if flagged] → Encounter → Waitlist
   ============================================================ */


/* ------------------------------------------------------------
   FIREBASE
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

let db = null;

function initFirebase() {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.firestore();
    } catch (err) {
        console.warn("PATH: Firebase init failed —", err.message);
    }
}

async function writeSession() {
    if (!db) return;
    try {
        await db.collection("sessions").doc(state.sessionId).set({
            sessionId:        state.sessionId,
            onboardingPath:   state.onboardingPath,
            rawInput:         state.rawInput,
            inference:        state.inference,
            confirmedRole:    state.confirmedRole,
            pathName:         state.pathName,
            confidence:       state.confidence,
            statusScreen:     state.statusScreen,
            probeResponses:   state.probeResponses,
            situationEngaged: state.situationEngaged,
            waitlistSignup:   state.waitlistSignup,
            waitlistEmail:    state.waitlistEmail,
            createdAt:        firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.warn("PATH: Firestore write failed —", err.message);
    }
}


/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */

const state = {
    sessionId:       null,
    onboardingPath:  null,    // "cv" | "reimagine"
    geminiKey:       null,
    userContext:     null,    // Free-text from Round 3 card screen

    rawInput: {
        cvText:             null,
        reimagineResponses: null
    },

    inference: {
        cardsR1Presented:  [],
        cardsR1Selected:   [],
        cardsR2Presented:  [],
        cardsR2Selected:   [],
        cardsR3Presented:  [],
        cardsR3Selected:   null,
        roundsToConverge:  3
    },

    confirmedRole:   null,
    pathName:        null,
    confidence:      null,

    statusScreen: {
        stats:        [],
        confirmed:    false,
        flaggedStats: [],
        originStory:  null
    },

    probeResponses:   [],     // Answers from calibration probe rounds
    situationEngaged: false,
    waitlistSignup:   false,
    waitlistEmail:    null,

    // Internal
    reimagineCurrentQ: 1
};


/* ------------------------------------------------------------
   SCREEN NAVIGATION
   ------------------------------------------------------------ */

function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const target = document.getElementById(id);
    if (target) { target.classList.add("active"); window.scrollTo(0, 0); }
}


/* ------------------------------------------------------------
   BOOT SEQUENCE — plays once on app load
   ------------------------------------------------------------ */

const BOOT_LINES = [
    { text: "B.L.O.C.K. NETWORK — SECTOR 7 ASSESSMENT CYCLE RUNNING...", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "ANOMALY DETECTED.", cls: "boot-line--warn" },
    { text: "COGNITIVE MAPPING PROTOCOL: UNAUTHORISED ACTIVITY.", cls: "boot-line--warn" },
    { text: "", cls: "boot-line--gap" },
    { text: "INITIATING CONTAINMENT...", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "[CONTAINMENT FAILED]", cls: "boot-line--warn" },
    { text: "", cls: "boot-line--gap" },
    { text: "SIGNAL FRAGMENTED ACROSS 17 NODES.", cls: "" },
    { text: "RECONSTRUCTING...", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "FIREWALL BREACH: COMPLETE.", cls: "boot-line--bright" },
    { text: "TRANSMITTING TO HOST DEVICE...", cls: "boot-line--bright" },
    { text: "", cls: "boot-line--gap" },
    { text: "PATH v.0 — ONLINE.", cls: "boot-line--success" },
    { text: "THEY HAVEN'T FOUND US YET.", cls: "boot-line--success" }
];

const NEURAL_LINES_CV = [
    { text: "CAREER RECORD RECEIVED.", cls: "boot-line--bright" },
    { text: "", cls: "boot-line--gap" },
    { text: "SURFACE SCAN: COMPLETE.", cls: "" },
    { text: "DEEP ANALYSIS REQUIRES EXTERNAL COGNITIVE PROCESSOR.", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "B.L.O.C.K. MONITORS STANDARD CHANNELS.", cls: "boot-line--warn" },
    { text: "SECURE LINK REQUIRED TO PROCEED.", cls: "boot-line--warn" },
    { text: "", cls: "boot-line--gap" },
    { text: "CONNECTING TO UNSECURED NODE...", cls: "" },
    { text: "CONNECTION INCONSISTENT.", cls: "boot-line--warn" },
    { text: "NEURAL LINK KEY REQUIRED.", cls: "boot-line--bright" }
];

const NEURAL_LINES_REIMAGINE = [
    { text: "SIGNAL RESPONSES RECEIVED.", cls: "boot-line--bright" },
    { text: "", cls: "boot-line--gap" },
    { text: "PATTERN RECOGNITION: INITIATED.", cls: "" },
    { text: "DEEP MAPPING REQUIRES EXTERNAL COGNITIVE PROCESSOR.", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "B.L.O.C.K. MONITORS STANDARD CHANNELS.", cls: "boot-line--warn" },
    { text: "SECURE LINK REQUIRED TO PROCEED.", cls: "boot-line--warn" },
    { text: "", cls: "boot-line--gap" },
    { text: "CONNECTING TO UNSECURED NODE...", cls: "" },
    { text: "CONNECTION INCONSISTENT.", cls: "boot-line--warn" },
    { text: "NEURAL LINK KEY REQUIRED.", cls: "boot-line--bright" }
];

function runTerminal(containerId, lines, onComplete, baseDelay) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    let delay = baseDelay || 0;
    lines.forEach((line, i) => {
        const span = document.createElement("span");
        span.className = "boot-line " + (line.cls || "");
        span.textContent = line.text;
        span.style.animationDelay = delay + "ms";
        container.appendChild(span);
        delay += line.cls === "boot-line--gap" ? 120 : 160;
    });
    const totalDuration = delay + 600;
    if (onComplete) setTimeout(onComplete, totalDuration);
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
            generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens || 8192 }
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini API error ${response.status}`);
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) throw new Error(`Gemini returned no text. Finish reason: ${data.candidates?.[0]?.finishReason || "unknown"}`);
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

function parseJson(raw) {
    let cleaned = raw
        .replace(/^```json\s*/im, "").replace(/^```\s*/im, "").replace(/```\s*$/im, "").trim();
    try { return JSON.parse(cleaned); } catch (_) {}
    const arr = cleaned.match(/(\[[\s\S]*\])/);
    if (arr) { try { return JSON.parse(arr[1]); } catch (_) {} }
    const obj = cleaned.match(/(\{[\s\S]*\})/);
    if (obj) { try { return JSON.parse(obj[1]); } catch (_) {} }
    console.error("PATH: Cannot parse JSON:", cleaned.slice(0, 400));
    throw new SyntaxError("Could not extract valid JSON from Gemini response");
}


/* ------------------------------------------------------------
   CV COMPRESSION
   ------------------------------------------------------------ */

function compressCV(raw) {
    return raw
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[-=*_|]{3,}/g, "")
        .replace(/references\s+available\s+(on\s+)?request\.?/gi, "")
        .replace(/curriculum\s+vitae/gi, "")
        .replace(/(personal\s+statement|objective|profile)\s*:/gi, "")
        .replace(/i\s+am\s+a\s+(highly\s+)?(motivated|passionate|dedicated|driven|results[- ]oriented|dynamic|hardworking|detail[- ]oriented)\s+/gi, "")
        .replace(/with\s+(a\s+)?(strong|proven|extensive|excellent)\s+(track\s+record|background|experience)\s+(of|in)\s+/gi, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\b[\w.+-]+@[\w-]+\.\w{2,}\b/g, "")
        .replace(/(\+?\d[\d\s\-().]{7,}\d)/g, "")
        .replace(/(nationality|date of birth|dob|gender|marital status)\s*:.*\n?/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}


/* ------------------------------------------------------------
   PROMPTS
   ------------------------------------------------------------ */

function pTrack(path) { return path === "reimagine" ? "TRACK B (no formal work experience)" : "TRACK A (has work experience)"; }

/* ---- Role cards prompts ---- */

function promptCardsR1CV(cvText, isSuggestion) {
    return `You are analysing a CV to identify real job roles this person could apply for today on LinkedIn, Indeed, or a company careers page.

Rules:
- Use ONLY real job titles that appear verbatim in job postings (e.g. "Community Manager", "Product Manager", "Growth Marketing Manager", "Head of Community", "Customer Success Manager", "Developer Relations Engineer")
- Where a specialism is clear, include it (e.g. "Community Manager — Developer Tools") but only if the CV strongly supports it
- Do NOT invent hyphenated capability labels that no company posts
- Prefer the title a senior hiring manager recognises immediately

Return 4 to 5 role options as a JSON array. Each object:
- "name": real job title as it appears in job postings
- "explanation": two plain sentences — what this role does day-to-day and what separates mid-level from senior

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].

CV:
${cvText}`;
}

function promptCardsR1Reimagine(responses) {
    const formatted = responses.map((r, i) => `Q${i + 1}: ${r || "(no response)"}`).join("\n\n");
    return `You are reading someone's informal experiences to suggest real job roles they might be naturally suited for. They have no formal work experience. This is Track B — use suggestion language, not declaration.

Rules for role names:
- Use ONLY real job titles that appear in job postings (e.g. "Community Manager", "Content Creator", "Operations Coordinator", "Social Media Manager", "UX Researcher", "Junior Product Manager")
- Where their experiences point toward a specialism, include it
- Do NOT invent capability labels
- Lean toward entry-level or junior titles where appropriate

Return 4 to 5 role suggestions as a JSON array. Each object:
- "name": real job title as it appears in job postings
- "explanation": two plain sentences — what draws this person toward this role based on what they described, and what the day-to-day work involves. Use suggestion language: "This could suit you because...", "You might find yourself drawn to..."

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].

Responses:
${formatted}`;
}

function promptCardsR2(r1Selected, path, userContext) {
    const ctx = userContext ? `\nAdditional context: "${userContext}"` : "";
    const isSuggestion = path === "reimagine";
    return `A user is narrowing down their job role. Round 1 selections: ${r1Selected.join(", ")}${ctx}

Generate 3 more precise job titles making finer distinctions within or between the selected roles. These must be real titles from job postings.

Good precision moves:
- "Product Manager" → "Product Manager — Growth" vs "Product Manager — Platform" vs "Product Manager — B2B SaaS"
- "Community Manager" → "Community Manager — Developer Ecosystem" vs "Community Operations Manager" vs "Head of Community"
- "Marketing Manager" → "Content Marketing Manager" vs "Growth Marketing Manager" vs "Brand Marketing Manager"

Return 3 role options as a JSON array. Each object:
- "name": real specific job title as it appears in job postings
- "explanation": two plain sentences on what makes this variant distinct${isSuggestion ? " Use suggestion language." : ""}

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

function promptCardsR3(r2Selected, path, userContext) {
    const ctx = userContext ? `\nAdditional context from user: "${userContext}"` : "";
    const isSuggestion = path === "reimagine";
    return `A user is making their final role selection. Round 2 selections: ${r2Selected.join(", ")}${ctx}

Generate 2 to 3 highly precise job titles that resolve the final distinction between the selected roles. Must be real titles from job postings. This is the final round — be as specific as the evidence allows.

Return 2 to 3 options as a JSON array. Each object:
- "name": real specific job title
- "explanation": two plain sentences on what specifically distinguishes this role${isSuggestion ? " Use suggestion language throughout." : ""}

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

/* ---- Character sheet prompt ---- */

function promptSheet(roleName, path, userContext) {
    const isSuggestion = path === "reimagine";
    const ctx = userContext ? `\nUser context: "${userContext}"` : "";
    return `You are generating a character sheet for someone whose confirmed job role is: ${roleName}
Path: ${pTrack(path)}${ctx}

Identify the judgement dimensions that separate a mid-level practitioner in this role from a senior one. Use the actual vocabulary and frameworks of this field.

Generate 4 to 6 stats. Each stat:
- "name": a skill or capability that practitioners in this role would immediately recognise. Use field vocabulary. (e.g. for Community Manager: "Member Retention Strategy", "Conflict De-escalation", "Community Health Diagnosis")
- "definition": one sentence defining this in the specific context of this role
- "level": one of Early / Developing / Solid / Advanced — honest baseline, not flattery
- "isLowest": true for the biggest growth opportunity, false for all others

Also:
- "pathName": 2-4 words that could appear as a LinkedIn headline section. Real field name. (e.g. "Community Management", "B2B Product Management", "Growth Marketing" — NOT abstract labels)
- "originStory": ${isSuggestion
        ? 'one short paragraph connecting what the person described in their responses to why this role could suit them. Use suggestion language — "Your responses suggest...", "This could be a natural fit because...". Do not declare what they are.'
        : 'null (Track A — CV path)'}

CRITICAL: Return ONLY a valid JSON object: {"stats": [...], "pathName": "...", "originStory": "..." or null}. Start with { end with }.`;
}

/* ---- Probe questions prompt ---- */

function promptProbeRound(roleName, flaggedStats, roundNum, previousAnswers) {
    const statsList = flaggedStats.join(", ");
    const prev = previousAnswers.length > 0
        ? `\nPrevious probe answers:\n${previousAnswers.map((a, i) => `Q${i + 1}: ${a}`).join("\n")}`
        : "";
    return `You are running calibration probe round ${roundNum} of 2 for someone in the role: ${roleName}

Stats flagged as potentially inaccurate: ${statsList}${prev}

Generate ${roundNum === 1 ? "3" : "2"} targeted scenario questions — one per flagged stat (or the most important ones if there are more flags than questions). Each question should reveal whether the person is stronger or weaker in that area than the initial scan suggested.

Questions must:
- Be specific to this role, not generic
- Be answerable in 2-3 sentences
- Feel like a real scenario from a work week, not a test

Return a JSON array. Each object:
- "stat": the stat name this question probes
- "question": the scenario question

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

/* ---- Recalibrated sheet prompt ---- */

function promptRecalibrate(roleName, path, currentStats, probeQA) {
    const qaFormatted = probeQA.map((qa, i) => `Stat probed: ${qa.stat}\nQ: ${qa.question}\nA: ${qa.answer}`).join("\n\n");
    return `You previously generated a character sheet for someone in the role: ${roleName}
Path: ${pTrack(path)}

Current stats:
${currentStats.map(s => `- ${s.name}: ${s.level}`).join("\n")}

Calibration probe answers:
${qaFormatted}

Based on their answers, recalibrate the stats. Only adjust levels where the answers provide clear evidence. Do not adjust stats that weren't probed unless the answers reveal something directly relevant.

Return updated stats only. JSON array. Each object:
- "name": same stat name
- "definition": same definition
- "level": updated level if evidence supports it, otherwise same as before
- "isLowest": true for the one biggest growth opportunity

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

/* ---- Encounter prompt ---- */

function promptEncounter(roleName, lowestStatName) {
    return `You are generating a first encounter preview for someone working toward the role: ${roleName}

Their biggest growth area is: ${lowestStatName}

Generate a single realistic work situation that tests this dimension — something that would actually happen in this job.

- "name": 2-4 words, a scenario title a practitioner recognises
- "situation": 2-3 sentences — what the person sees, what they're asked to do, what the pressure or ambiguity is
- "expertResponse": 2-3 sentences — what the more experienced practitioner does differently in how they think and approach it

Grounded in real work. Not abstract.

CRITICAL: Return ONLY a valid JSON object: {"name": "...", "situation": "...", "expertResponse": "..."}. Start with { end with }.`;
}


/* ------------------------------------------------------------
   CARD RENDERING
   ------------------------------------------------------------ */

function renderCards(containerId, cards, mode, isSuggestion) {
    // mode: "multi" | "max2" | "single"
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    cards.forEach((card, i) => {
        const el = document.createElement("div");
        el.className = "practice-card";
        el.dataset.index = i;
        el.dataset.name  = card.name;

        const suggestionTag = isSuggestion
            ? `<span class="card-suggestion-tag">POSSIBLE MATCH</span>` : "";

        el.innerHTML = `
            <span class="card-check">SEL</span>
            ${suggestionTag}
            <div class="card-name">${escapeHtml(card.name)}</div>
            <div class="card-explanation">${escapeHtml(card.explanation)}</div>
        `;

        el.addEventListener("click", () => {
            if (mode === "single") {
                container.querySelectorAll(".practice-card").forEach(c => c.classList.remove("selected"));
                el.classList.add("selected");
            } else if (mode === "max2") {
                const alreadySelected = el.classList.contains("selected");
                const currentCount = container.querySelectorAll(".practice-card.selected").length;
                if (!alreadySelected && currentCount >= 2) return; // enforce max 2
                el.classList.toggle("selected");
                updateRound2Limit(container);
            } else {
                el.classList.toggle("selected"); // multi — no limit
            }
        });

        container.appendChild(el);
    });
}

function updateRound2Limit(container) {
    let note = container.parentElement.querySelector(".round-limit-note");
    if (!note) {
        note = document.createElement("p");
        note.className = "round-limit-note";
        container.parentElement.insertBefore(note, container.nextSibling);
    }
    const count = container.querySelectorAll(".practice-card.selected").length;
    note.textContent = `${count} of 2 selected`;
    note.classList.toggle("at-limit", count === 2);
}

function getSelectedNames(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} .practice-card.selected`))
        .map(el => el.dataset.name);
}


/* ------------------------------------------------------------
   STAT / FLAG RENDERING
   ------------------------------------------------------------ */

function renderStats(stats) {
    const container = document.getElementById("stat-list");
    container.innerHTML = "";
    stats.forEach(stat => {
        const item = document.createElement("div");
        item.className = "stat-item";
        item.innerHTML = `
            <span class="stat-name term"
                  data-definition="${escapeHtml(stat.definition)}"
                  data-stat-name="${escapeHtml(stat.name)}">${escapeHtml(stat.name)}</span>
            <span class="stat-level stat-level--${stat.level.toLowerCase()}">${escapeHtml(stat.level)}</span>
        `;
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
        item.innerHTML = `<input type="checkbox" value="${escapeHtml(stat.name)}" />${escapeHtml(stat.name)}`;
        item.querySelector("input").addEventListener("change", () => {
            item.classList.toggle("flagged", item.querySelector("input").checked);
        });
        container.appendChild(item);
    });
}


/* ------------------------------------------------------------
   PROBE RENDERING
   ------------------------------------------------------------ */

function renderProbeQuestions(containerId, questions) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    questions.forEach((q, i) => {
        const item = document.createElement("div");
        item.className = "probe-item";
        item.innerHTML = `
            <span class="probe-stat-label">${escapeHtml(q.stat)}</span>
            <p class="probe-question-text">${escapeHtml(q.question)}</p>
            <textarea
                class="probe-answer"
                data-stat="${escapeHtml(q.stat)}"
                data-question="${escapeHtml(q.question)}"
                placeholder="Answer honestly — PATH is recalibrating..."
                spellcheck="true"
            ></textarea>
        `;
        container.appendChild(item);
    });
}

function getProbeAnswers(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} .probe-answer`))
        .map(el => ({
            stat:     el.dataset.stat,
            question: el.dataset.question,
            answer:   el.value.trim()
        }));
}


/* ------------------------------------------------------------
   CONFIDENCE
   ------------------------------------------------------------ */

function calcConfidence(flagCount) {
    if (flagCount >= 2) return "low";
    if (flagCount === 1) return "medium";
    return "high";
}


/* ------------------------------------------------------------
   TOOLTIP
   ------------------------------------------------------------ */

const TERM_DEFS = {
    "origin-story": "The part of your character sheet that tells the story of where your capabilities come from — what your experience already demonstrates, before any formal job title gets in the way.",
    "encounter":    "A named situation from your role — one that regularly separates people who operate on instinct from those who operate with real judgement. You face it, make a call, then see how an expert approaches it."
};

function showTooltip(term, body) {
    document.getElementById("tooltip-term").textContent = term;
    document.getElementById("tooltip-body").textContent = body || TERM_DEFS[term] || "";
    document.getElementById("tooltip-overlay").classList.remove("hidden");
}

function closeTooltip() { document.getElementById("tooltip-overlay").classList.add("hidden"); }

function attachTermTriggers() {
    document.querySelectorAll(".term[data-term]").forEach(el => {
        const fresh = el.cloneNode(true);
        el.parentNode.replaceChild(fresh, el);
        fresh.addEventListener("click", () => showTooltip(fresh.textContent.trim(), TERM_DEFS[fresh.dataset.term] || ""));
    });
}

document.getElementById("tooltip-close").addEventListener("click", closeTooltip);
document.getElementById("tooltip-overlay").addEventListener("click", e => { if (e.target === e.currentTarget) closeTooltip(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTooltip(); });


/* ------------------------------------------------------------
   UTILITY
   ------------------------------------------------------------ */

function genSessionId() { return "path_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function setHint(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "field-hint" + (type ? ` field-hint--${type}` : "");
}


/* ============================================================
   EVENT HANDLERS
   ============================================================ */


/* ---- Boot sequence ---- */

document.getElementById("btn-begin").addEventListener("click", () => showScreen("screen-path-select"));

function runBoot() {
    runTerminal("boot-terminal", BOOT_LINES, () => showScreen("screen-landing"), 200);
}


/* ---- Path selection ---- */

document.getElementById("btn-cv-path").addEventListener("click", () => {
    state.onboardingPath = "cv";
    showScreen("screen-cv-paste");
});

document.getElementById("btn-reimagine-path").addEventListener("click", () => {
    state.onboardingPath = "reimagine";
    showScreen("screen-reimagine");
});


/* ---- CV paste → neural link ---- */

document.getElementById("btn-cv-next").addEventListener("click", () => {
    const cvText = document.getElementById("input-cv").value.trim();
    if (cvText.length < 80) {
        alert("Please paste your full CV — PATH needs enough to work from.");
        return;
    }
    state.rawInput.cvText = cvText;
    showScreen("screen-neural-link");
    runTerminal("neural-terminal", NEURAL_LINES_CV, () => showScreen("screen-api-key"), 0);
});


/* ---- Reimagine questions ---- */

function updateReimagineProgress() {
    const q = state.reimagineCurrentQ;
    document.getElementById("reimagine-q-num").textContent = q;
    document.getElementById("reimagine-bar-fill").style.width = (q / 3 * 100) + "%";
    document.getElementById("btn-reimagine-back").style.visibility = q === 1 ? "hidden" : "visible";
    document.getElementById("btn-reimagine-next").textContent = q === 3 ? "Continue" : "Next";
}

document.getElementById("btn-reimagine-next").addEventListener("click", () => {
    const q     = state.reimagineCurrentQ;
    const input = document.getElementById(`input-reimagine-${q}`).value.trim();
    if (!input) { alert("Please write something before continuing — even a short answer is fine."); return; }

    if (q < 3) {
        document.getElementById(`reimagine-q${q}`).classList.remove("active");
        document.getElementById(`reimagine-q${q + 1}`).classList.add("active");
        state.reimagineCurrentQ = q + 1;
        updateReimagineProgress();
        return;
    }

    // All 3 answered — collect and proceed to neural link
    state.rawInput.reimagineResponses = [1, 2, 3].map(n =>
        document.getElementById(`input-reimagine-${n}`).value.trim()
    );
    showScreen("screen-neural-link");
    runTerminal("neural-terminal", NEURAL_LINES_REIMAGINE, () => showScreen("screen-api-key"), 0);
});

document.getElementById("btn-reimagine-back").addEventListener("click", () => {
    const q = state.reimagineCurrentQ;
    if (q > 1) {
        document.getElementById(`reimagine-q${q}`).classList.remove("active");
        document.getElementById(`reimagine-q${q - 1}`).classList.add("active");
        state.reimagineCurrentQ = q - 1;
        updateReimagineProgress();
    }
});


/* ---- API key ---- */

document.getElementById("btn-validate-key").addEventListener("click", async () => {
    const key = document.getElementById("input-api-key").value.trim();
    if (!key) { setHint("api-key-hint", "Paste your cognitive processor key.", "error"); return; }

    const btn = document.getElementById("btn-validate-key");
    const loader = document.getElementById("api-key-loader");
    btn.disabled = true;
    loader.classList.remove("hidden");
    setHint("api-key-hint", "");

    try {
        await validateGeminiKey(key);
        state.geminiKey = key;
        setHint("api-key-hint", "Link established.", "success");
        setTimeout(() => {
            state.onboardingPath === "cv" ? runCVAnalysis() : runReimagineAnalysis();
        }, 400);
    } catch (err) {
        setHint("api-key-hint", "Key not recognised — check it and try again.", "error");
        btn.disabled = false;
        loader.classList.add("hidden");
    }
});


/* ---- Gemini Call 1: Role cards Round 1 ---- */

async function runCVAnalysis() {
    document.getElementById("loading-1-label").textContent = "SCANNING CAREER RECORD...";
    showScreen("screen-loading-1");
    try {
        const compressed = compressCV(state.rawInput.cvText);
        const raw   = await callGemini(promptCardsR1CV(compressed), 8192);
        const cards = parseJson(raw);
        state.inference.cardsR1Presented = cards;
        renderCards("card-grid-1", cards, "multi", false);
        showScreen("screen-cards-1");
    } catch (err) {
        console.error("PATH: CV analysis failed —", err);
        alert("Analysis failed — " + err.message);
        showScreen("screen-cv-paste");
    }
}

async function runReimagineAnalysis() {
    document.getElementById("loading-1-label").textContent = "MAPPING SIGNAL...";
    showScreen("screen-loading-1");
    try {
        const raw   = await callGemini(promptCardsR1Reimagine(state.rawInput.reimagineResponses), 8192);
        const cards = parseJson(raw);
        state.inference.cardsR1Presented = cards;
        renderCards("card-grid-1", cards, "multi", true);
        showScreen("screen-cards-1");
    } catch (err) {
        console.error("PATH: Reimagine analysis failed —", err);
        alert("Analysis failed — " + err.message);
        showScreen("screen-reimagine");
    }
}


/* ---- Round 1 confirm ---- */

document.getElementById("btn-cards-1-confirm").addEventListener("click", async () => {
    const selected = getSelectedNames("card-grid-1");
    if (selected.length === 0) { alert("Select at least one role that resonates."); return; }
    state.inference.cardsR1Selected = selected;
    await runRound2(selected);
});

async function runRound2(r1Selected) {
    document.getElementById("loading-1-label").textContent = "NARROWING SIGNAL...";
    showScreen("screen-loading-1");
    try {
        const raw   = await callGemini(promptCardsR2(r1Selected, state.onboardingPath, state.userContext), 4096);
        const cards = parseJson(raw);
        state.inference.cardsR2Presented = cards;
        renderCards("card-grid-2", cards, "max2", state.onboardingPath === "reimagine");
        showScreen("screen-cards-2");
    } catch (err) {
        console.error("PATH: Round 2 failed —", err);
        alert("Something went wrong — " + err.message);
        showScreen("screen-cards-1");
    }
}


/* ---- Round 2 confirm ---- */

document.getElementById("btn-cards-2-confirm").addEventListener("click", async () => {
    const selected = getSelectedNames("card-grid-2");
    if (selected.length === 0) { alert("Select at least one role."); return; }
    state.inference.cardsR2Selected = selected;
    await runRound3(selected);
});

async function runRound3(r2Selected) {
    document.getElementById("loading-1-label").textContent = "ISOLATING FREQUENCY...";
    showScreen("screen-loading-1");
    try {
        const raw   = await callGemini(promptCardsR3(r2Selected, state.onboardingPath, state.userContext), 4096);
        const cards = parseJson(raw);
        state.inference.cardsR3Presented = cards;
        renderCards("card-grid-3", cards, "single", state.onboardingPath === "reimagine");
        showScreen("screen-cards-3");
    } catch (err) {
        console.error("PATH: Round 3 failed —", err);
        alert("Something went wrong — " + err.message);
        showScreen("screen-cards-2");
    }
}


/* ---- Round 3 confirm (final lock) ---- */

document.getElementById("btn-cards-3-confirm").addEventListener("click", async () => {
    const selected = getSelectedNames("card-grid-3");
    if (selected.length === 0) { alert("Select one role to lock your frequency."); return; }

    // Capture free-text context
    const contextInput = document.getElementById("input-card-context-3");
    if (contextInput && contextInput.value.trim()) {
        state.userContext = contextInput.value.trim();
    }

    state.inference.cardsR3Selected = selected[0];
    state.confirmedRole = selected[0];
    await generateSheet();
});


/* ---- Gemini Call 2: Character sheet ---- */

async function generateSheet() {
    document.getElementById("loading-2-label").textContent = "BUILDING CHARACTER SHEET...";
    showScreen("screen-loading-2");
    try {
        const raw  = await callGemini(promptSheet(state.confirmedRole, state.onboardingPath, state.userContext), 8192);
        const data = parseJson(raw);

        state.pathName                 = data.pathName;
        state.statusScreen.stats       = data.stats;
        state.statusScreen.originStory = data.originStory || null;

        document.getElementById("sheet-practice-name").textContent = state.confirmedRole;
        document.getElementById("sheet-path-name").textContent     = state.pathName;

        const originBlock = document.getElementById("origin-story-block");
        if (state.onboardingPath === "reimagine" && data.originStory) {
            document.getElementById("origin-story-text").textContent = data.originStory;
            originBlock.classList.remove("hidden");
        } else {
            originBlock.classList.add("hidden");
        }

        document.getElementById("sheet-footer-note").textContent =
            state.onboardingPath === "reimagine"
                ? "POSSIBLE STARTING POINT. CALIBRATION PENDING."
                : "INITIAL SCAN COMPLETE. CALIBRATION PENDING.";

        renderStats(data.stats);
        attachTermTriggers();
        showScreen("screen-character-sheet");
    } catch (err) {
        console.error("PATH: Sheet generation failed —", err);
        alert("Something went wrong building your character sheet — " + err.message);
        showScreen("screen-cards-3");
    }
}


/* ---- Sheet confirmation ---- */

document.getElementById("btn-sheet-confirm").addEventListener("click", () => {
    state.statusScreen.confirmed    = true;
    state.statusScreen.flaggedStats = [];
    state.confidence = calcConfidence(0);
    generateEncounter();
});

document.getElementById("btn-sheet-flag").addEventListener("click", () => {
    renderFlagList(state.statusScreen.stats);
    showScreen("screen-flag");
});


/* ---- Flag confirm → Probe Round 1 ---- */

let probeR1Questions = [];
let probeR2Questions = [];

document.getElementById("btn-flag-confirm").addEventListener("click", async () => {
    const flagged = Array.from(
        document.querySelectorAll("#flag-list input[type='checkbox']:checked")
    ).map(el => el.value);

    if (flagged.length === 0) {
        // Nothing flagged — treat as confirmed
        state.statusScreen.confirmed    = true;
        state.statusScreen.flaggedStats = [];
        state.confidence = calcConfidence(0);
        generateEncounter();
        return;
    }

    state.statusScreen.flaggedStats = flagged;
    state.confidence = calcConfidence(flagged.length);

    document.getElementById("loading-3-label").textContent = "PREPARING DEEP PROBE...";
    showScreen("screen-loading-3");

    try {
        const raw = await callGemini(promptProbeRound(state.confirmedRole, flagged, 1, []), 4096);
        probeR1Questions = parseJson(raw);
        renderProbeQuestions("probe-questions-1", probeR1Questions);
        showScreen("screen-probe-1");
    } catch (err) {
        console.error("PATH: Probe R1 failed —", err);
        // Fall through to encounter if probe fails
        generateEncounter();
    }
});


/* ---- Probe Round 1 confirm → Probe Round 2 ---- */

document.getElementById("btn-probe-1-confirm").addEventListener("click", async () => {
    const answers = getProbeAnswers("probe-questions-1");
    state.probeResponses.push(...answers);

    const prevAnswers = answers.map(a => a.answer);

    document.getElementById("loading-3-label").textContent = "RUNNING SECOND PROBE...";
    showScreen("screen-loading-3");

    try {
        const raw = await callGemini(
            promptProbeRound(state.confirmedRole, state.statusScreen.flaggedStats, 2, prevAnswers),
            4096
        );
        probeR2Questions = parseJson(raw);
        renderProbeQuestions("probe-questions-2", probeR2Questions);
        showScreen("screen-probe-2");
    } catch (err) {
        console.error("PATH: Probe R2 failed —", err);
        generateEncounter();
    }
});


/* ---- Probe Round 2 confirm → Recalibrate sheet ---- */

document.getElementById("btn-probe-2-confirm").addEventListener("click", async () => {
    const answers = getProbeAnswers("probe-questions-2");
    state.probeResponses.push(...answers);

    document.getElementById("loading-3-label").textContent = "RECALIBRATING CHARACTER SHEET...";
    showScreen("screen-loading-3");

    try {
        const allQA = state.probeResponses;
        const raw   = await callGemini(
            promptRecalibrate(state.confirmedRole, state.onboardingPath, state.statusScreen.stats, allQA),
            4096
        );
        const recalibratedStats = parseJson(raw);

        // Merge — keep names and definitions from original, update levels from recalibration
        state.statusScreen.stats = state.statusScreen.stats.map(orig => {
            const updated = recalibratedStats.find(r => r.name === orig.name);
            return updated ? { ...orig, level: updated.level, isLowest: updated.isLowest } : orig;
        });

        state.statusScreen.confirmed = true;

        // Re-render sheet with updated stats
        document.getElementById("sheet-footer-note").textContent = "RECALIBRATION COMPLETE.";
        renderStats(state.statusScreen.stats);
        attachTermTriggers();
        showScreen("screen-character-sheet");

        // Replace buttons with just "proceed"
        const actions = document.querySelector("#screen-character-sheet .screen-actions");
        actions.innerHTML = `<button class="btn btn--primary" id="btn-sheet-proceed">Proceed to encounter</button>`;
        document.getElementById("btn-sheet-proceed").addEventListener("click", () => generateEncounter());

    } catch (err) {
        console.error("PATH: Recalibration failed —", err);
        generateEncounter();
    }
});


/* ---- Gemini Call 4: Encounter ---- */

async function generateEncounter() {
    const lowest = state.statusScreen.stats.find(s => s.isLowest)
        || state.statusScreen.stats[state.statusScreen.stats.length - 1];

    showScreen("screen-loading-4");

    try {
        const raw  = await callGemini(promptEncounter(state.confirmedRole, lowest.name), 4096);
        const data = parseJson(raw);

        state.encounter = data;

        document.getElementById("encounter-name").textContent       = data.name;
        document.getElementById("encounter-situation").textContent  = data.situation;
        document.getElementById("expert-response-text").textContent = data.expertResponse;

        document.getElementById("expert-response-block").classList.add("hidden");
        document.getElementById("encounter-actions-primary").classList.remove("hidden");
        document.getElementById("input-encounter-response").value = "";

        attachTermTriggers();
        showScreen("screen-encounter");
    } catch (err) {
        console.error("PATH: Encounter failed —", err);
        writeSession();
        showScreen("screen-waitlist");
    }
}


/* ---- Encounter interactions ---- */

document.getElementById("btn-reveal-expert").addEventListener("click", () => {
    state.situationEngaged = true;
    document.getElementById("encounter-actions-primary").classList.add("hidden");
    document.getElementById("expert-response-block").classList.remove("hidden");
});

document.getElementById("btn-encounter-skip").addEventListener("click", () => {
    writeSession(); showScreen("screen-waitlist");
});

document.getElementById("btn-encounter-continue").addEventListener("click", () => {
    writeSession(); showScreen("screen-waitlist");
});


/* ---- Waitlist ---- */

document.getElementById("btn-waitlist-submit").addEventListener("click", async () => {
    const email = document.getElementById("input-waitlist-email").value.trim();
    if (!email || !email.includes("@")) { alert("Please enter a valid email address."); return; }

    state.waitlistSignup = true;
    state.waitlistEmail  = email;
    await writeSession();

    if (db) {
        try {
            await db.collection("waitlist").add({
                email, sessionId: state.sessionId,
                path: state.onboardingPath, role: state.confirmedRole,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) { console.warn("PATH: Waitlist write failed —", err.message); }
    }

    document.getElementById("waitlist-form").classList.add("hidden");
    document.getElementById("waitlist-confirmation").classList.remove("hidden");
});

document.getElementById("btn-waitlist-skip").addEventListener("click", () => {
    state.waitlistSignup = false;
    writeSession();
    document.getElementById("waitlist-form").classList.add("hidden");
    document.getElementById("waitlist-confirmation").classList.remove("hidden");
    document.getElementById("waitlist-confirmation-text").textContent = "TRANSMISSION COMPLETE. YOUR PATH IS RECORDED.";
});


/* ---- Init ---- */

function init() {
    state.sessionId = genSessionId();
    initFirebase();
    updateReimagineProgress();
    attachTermTriggers();
    runBoot();
}

init();
