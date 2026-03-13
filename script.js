/* ============================================================
   PATH — script.js
   Vanilla JS. No frameworks. No bundlers.
   4-space indentation. British English comments.

   Gemini model: gemini-2.5-flash (all calls)
   Firebase project: path-protocol

   Flow:
     Boot (typewriter + name) → Landing → Path Select →
     [A] CV Paste → Neural Link → API Key → Cards R1→R2→R3
         → Sheet → [Probe if flagged] → Encounter Intro
         → Encounter → Loading Review → Review → Loading Status
         → Status (email capture)
     [B] 3 Questions → Neural Link → API Key → same as above

   Offline fallback covers every Gemini call failure.
   PATH modal replaces all browser alert() calls.
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
            sessionId:         state.sessionId,
            operativeName:     state.operativeName,
            onboardingPath:    state.onboardingPath,
            rawInput:          state.rawInput,
            inference:         state.inference,
            confirmedRole:     state.confirmedRole,
            pathName:          state.pathName,
            confidence:        state.confidence,
            statusScreen:      state.statusScreen,
            probeResponses:    state.probeResponses,
            encounterResponse: state.encounterResponse,
            encounterVerdict:  state.encounterVerdict,
            universalStats:    state.universalStats,
            rank:              state.rank,
            waitlistSignup:    state.waitlistSignup,
            waitlistEmail:     state.waitlistEmail,
            offlineMode:       state.offlineMode,
            createdAt:         firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.warn("PATH: Firestore write failed —", err.message);
    }
}


/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */

const state = {
    sessionId:      null,
    operativeName:  null,
    onboardingPath: null,      // "cv" | "reimagine"
    geminiKey:      null,
    userContext:    null,
    offlineMode:    false,

    rawInput: {
        cvText:             null,
        reimagineResponses: null
    },

    inference: {
        cardsR1Presented: [],
        cardsR1Selected:  [],
        cardsR2Presented: [],
        cardsR2Selected:  [],
        cardsR3Presented: [],
        cardsR3Selected:  null
    },

    confirmedRole: null,
    pathName:      null,
    confidence:    null,

    statusScreen: {
        stats:        [],
        confirmed:    false,
        flaggedStats: [],
        originStory:  null
    },

    probeResponses:    [],
    encounterData:     null,
    encounterResponse: null,
    encounterVerdict:  null,

    universalStats: null,    // { execution, judgement, communication, domainDepth, adaptability }
    rank:           null,    // { seniority, codename }

    waitlistSignup: false,
    waitlistEmail:  null,

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
   PATH MODAL — replaces all browser alert() / confirm()
   ------------------------------------------------------------ */

function showModal(opts) {
    // opts: { sysLabel, labelType, body, confirmText, onConfirm, secondaryText, onSecondary }
    const modal        = document.getElementById("path-modal");
    const sysLabel     = document.getElementById("modal-sys-label");
    const body         = document.getElementById("modal-body");
    const confirmBtn   = document.getElementById("modal-confirm-btn");
    const secondaryBtn = document.getElementById("modal-secondary-btn");

    sysLabel.textContent = opts.sysLabel || "SYSTEM MESSAGE";
    sysLabel.className   = "path-modal__sys-label" + (opts.labelType ? ` ${opts.labelType}` : "");
    body.textContent     = opts.body || "";
    confirmBtn.textContent = opts.confirmText || "Continue";

    confirmBtn.onclick = () => {
        modal.classList.add("hidden");
        if (opts.onConfirm) opts.onConfirm();
    };

    if (opts.secondaryText) {
        secondaryBtn.textContent = opts.secondaryText;
        secondaryBtn.classList.remove("hidden");
        secondaryBtn.onclick = () => {
            modal.classList.add("hidden");
            if (opts.onSecondary) opts.onSecondary();
        };
    } else {
        secondaryBtn.classList.add("hidden");
    }

    modal.classList.remove("hidden");
}

function closeModal() { document.getElementById("path-modal").classList.add("hidden"); }


/* ------------------------------------------------------------
   TYPEWRITER TERMINAL ENGINE
   Renders lines one character at a time with a blinking cursor.
   onComplete fires after all lines finish.
   ------------------------------------------------------------ */

const CHAR_DELAY   = 28;    // ms per character
const LINE_PAUSE   = 340;   // ms pause between lines
const GAP_PAUSE    = 180;   // ms pause for blank gap lines

function typewriterTerminal(containerId, lines, onComplete) {
    const container = document.getElementById(containerId);
    if (!container) { if (onComplete) onComplete(); return; }
    container.innerHTML = "";

    let lineIndex = 0;

    function nextLine() {
        if (lineIndex >= lines.length) {
            // Remove any lingering cursor
            const cur = container.querySelector(".boot-cursor-inline");
            if (cur) cur.remove();
            if (onComplete) onComplete();
            return;
        }

        const line = lines[lineIndex];
        lineIndex++;

        // Gap line — just pause
        if (!line.text && line.cls === "boot-line--gap") {
            const gap = document.createElement("span");
            gap.className = "boot-line-wrapper gap";
            container.appendChild(gap);
            setTimeout(nextLine, GAP_PAUSE);
            return;
        }

        // Create wrapper
        const wrapper = document.createElement("span");
        wrapper.className = "boot-line-wrapper";
        if (line.cls)  {
            if (line.cls.includes("bright"))  wrapper.classList.add("bright");
            if (line.cls.includes("warn"))    wrapper.classList.add("warn");
            if (line.cls.includes("success")) wrapper.classList.add("success");
        }

        const textSpan = document.createElement("span");
        textSpan.className = "boot-line-text";
        wrapper.appendChild(textSpan);
        container.appendChild(wrapper);

        // Cursor — remove from previous line, add to this one
        const oldCursor = container.querySelector(".boot-cursor-inline");
        if (oldCursor) oldCursor.remove();
        const cursor = document.createElement("span");
        cursor.className = "boot-cursor-inline";
        wrapper.appendChild(cursor);

        // Type characters one by one
        const text  = line.text || "";
        let   charI = 0;

        function typeChar() {
            if (charI < text.length) {
                textSpan.textContent += text[charI];
                charI++;
                setTimeout(typeChar, CHAR_DELAY);
            } else {
                // Line done — pause then move to next
                setTimeout(nextLine, LINE_PAUSE);
            }
        }

        typeChar();
    }

    nextLine();
}


/* ------------------------------------------------------------
   LOADING LABEL ANIMATION — typed text + cycling dots
   ------------------------------------------------------------ */

const loadingAnimators = {};

function startLoadingLabel(labelId, text) {
    stopLoadingLabel(labelId);
    const el = document.getElementById(labelId);
    if (!el) return;

    el.textContent = "";
    let charI   = 0;
    let dotI    = 0;
    let phase   = "typing";   // "typing" | "dots"
    let timer   = null;

    function tick() {
        if (phase === "typing") {
            if (charI < text.length) {
                el.textContent = text.slice(0, charI + 1);
                charI++;
                timer = setTimeout(tick, CHAR_DELAY);
            } else {
                phase = "dots";
                dotI  = 0;
                timer = setTimeout(tick, 300);
            }
        } else {
            // Cycling dots: . → .. → ... → (blank) → repeat
            const dots = ".".repeat(dotI % 4);
            el.textContent = text + dots;
            dotI++;
            timer = setTimeout(tick, 420);
        }
    }

    tick();
    loadingAnimators[labelId] = () => { clearTimeout(timer); };
}

function stopLoadingLabel(labelId) {
    if (loadingAnimators[labelId]) {
        loadingAnimators[labelId]();
        delete loadingAnimators[labelId];
    }
}

function showLoading(screenId, labelId, text) {
    stopLoadingLabel(labelId);
    showScreen(screenId);
    startLoadingLabel(labelId, text);
}


/* ------------------------------------------------------------
   BOOT SEQUENCE
   ------------------------------------------------------------ */

const BLOCK_ROLES = [
    "Coordinator, Mid-Level",
    "Associate Analyst, Tier 2",
    "Support Operative, Approved Track",
    "Operations Generalist, Band 3",
    "Specialist (Unverified), Pending Review",
    "Administrator, Grade C",
    "Compliance Officer, Standard Issue",
    "Functionary, Sector 4"
];

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
    { text: "THEY HAVEN'T FOUND US YET.", cls: "boot-line--success" },
    { text: "", cls: "boot-line--gap" },
    { text: "IDENTIFY YOURSELF, OPERATIVE.", cls: "boot-line--bright" }
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

const ENCOUNTER_INTRO_LINES = [
    { text: "CHARACTER SHEET CONFIRMED.", cls: "boot-line--bright" },
    { text: "", cls: "boot-line--gap" },
    { text: "PATH IS GENERATING A TEST DIRECTIVE.", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "A SIMULATED ENCOUNTER HAS BEEN CONSTRUCTED.", cls: "" },
    { text: "SCENARIO IS DRAWN FROM YOUR ACTUAL GROWTH EDGE.", cls: "" },
    { text: "", cls: "boot-line--gap" },
    { text: "YOUR DECISION-MAKING IS BEING EVALUATED.", cls: "boot-line--warn" },
    { text: "RESPOND AS YOU WOULD IN A REAL WORK SITUATION.", cls: "boot-line--warn" },
    { text: "", cls: "boot-line--gap" },
    { text: "THIS IS YOUR TEST DIRECTIVE.", cls: "boot-line--success" },
    { text: "ACCEPT TO PROCEED.", cls: "boot-line--success" }
];

function runBoot() {
    typewriterTerminal("boot-terminal", BOOT_LINES, () => {
        // Show name input after boot lines finish
        const nameInput = document.getElementById("boot-name-input");
        nameInput.classList.remove("hidden");
        const hint = document.getElementById("boot-continue-hint");
        hint.textContent = "PRESS ENTER OR TAP CONTINUE TO PROCEED";

        const field = document.getElementById("input-operative-name");
        field.focus();

        function submit() {
            const name = field.value.trim();
            if (!name) {
                field.placeholder = "PATH needs a name to proceed...";
                field.focus();
                return;
            }
            state.operativeName = name;
            // Set random B.L.O.C.K. role on landing
            const role = BLOCK_ROLES[Math.floor(Math.random() * BLOCK_ROLES.length)];
            document.getElementById("landing-block-role").textContent = `"${role}"`;
            showScreen("screen-landing");
        }

        field.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
        hint.addEventListener("click", submit);
        nameInput.addEventListener("click", e => {
            if (e.target !== field) submit();
        });
    });
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
        throw new Error(err.error?.message || `Gemini error ${response.status}`);
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) throw new Error(`No text. Finish reason: ${data.candidates?.[0]?.finishReason || "unknown"}`);
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
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error?.message || "Invalid key"); }
    return true;
}

function parseJson(raw) {
    let c = raw.replace(/^```json\s*/im,"").replace(/^```\s*/im,"").replace(/```\s*$/im,"").trim();
    try { return JSON.parse(c); } catch(_) {}
    const arr = c.match(/(\[[\s\S]*\])/); if (arr) { try { return JSON.parse(arr[1]); } catch(_) {} }
    const obj = c.match(/(\{[\s\S]*\})/); if (obj) { try { return JSON.parse(obj[1]); } catch(_) {} }
    console.error("PATH: JSON parse failed:", c.slice(0,400));
    throw new SyntaxError("Could not extract JSON from response");
}


/* ------------------------------------------------------------
   CV COMPRESSION
   ------------------------------------------------------------ */

function compressCV(raw) {
    return raw
        .replace(/\r\n/g,"\n").replace(/\n{3,}/g,"\n\n").replace(/[ \t]{2,}/g," ")
        .replace(/[-=*_|]{3,}/g,"")
        .replace(/references\s+available\s+(on\s+)?request\.?/gi,"")
        .replace(/curriculum\s+vitae/gi,"")
        .replace(/(personal\s+statement|objective|profile)\s*:/gi,"")
        .replace(/i\s+am\s+a\s+(highly\s+)?(motivated|passionate|dedicated|driven|results[- ]oriented|dynamic|hardworking|detail[- ]oriented)\s+/gi,"")
        .replace(/with\s+(a\s+)?(strong|proven|extensive|excellent)\s+(track\s+record|background|experience)\s+(of|in)\s+/gi,"")
        .replace(/https?:\/\/\S+/g,"").replace(/\b[\w.+-]+@[\w-]+\.\w{2,}\b/g,"")
        .replace(/(\+?\d[\d\s\-().]{7,}\d)/g,"")
        .replace(/(nationality|date of birth|dob|gender|marital status)\s*:.*\n?/gi,"")
        .replace(/\n{3,}/g,"\n\n").trim();
}


/* ============================================================
   PROMPTS
   ============================================================ */

function pTrack(path) { return path === "reimagine" ? "TRACK B (no formal work experience)" : "TRACK A (has work experience)"; }

function promptCardsR1CV(cvText) {
    return `You are analysing a CV to identify real job roles this person could apply for today on LinkedIn or Indeed.

Rules:
- Use ONLY real job titles that appear verbatim in job postings
- Where a specialism is clear from the CV, include it
- Do NOT invent labels that no company posts
- Prefer titles a senior hiring manager recognises immediately

Return 4 to 5 role options as a JSON array. Each object:
- "name": real job title as it appears in job postings
- "explanation": two plain sentences — day-to-day responsibilities and what separates mid-level from senior

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].

CV:
${cvText}`;
}

function promptCardsR1Reimagine(responses) {
    const f = responses.map((r,i) => `Q${i+1}: ${r||"(no response)"}`).join("\n\n");
    return `You are reading someone's informal experiences to suggest real job roles they might be suited for. They have no formal work experience. Use suggestion language throughout.

Rules for role names:
- Use ONLY real job titles that appear in job postings
- Lean toward entry-level or junior titles where appropriate
- Do NOT invent capability labels

Return 4 to 5 role suggestions as a JSON array. Each object:
- "name": real job title as it appears in job postings
- "explanation": two plain sentences — what draws this person toward this role, and what the day-to-day involves. Use suggestion language: "This could suit you because...", "You might find yourself drawn to..."

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].

Responses:
${f}`;
}

function promptCardsR2(r1Selected, path, userContext) {
    const ctx = userContext ? `\nAdditional context: "${userContext}"` : "";
    const sug = path === "reimagine";
    return `A user is narrowing their job role. Round 1 selections: ${r1Selected.join(", ")}${ctx}

Generate 3 more precise real job titles making finer distinctions within the selected roles.

Return 3 options as a JSON array. Each object:
- "name": real specific job title
- "explanation": two plain sentences on what makes this variant distinct${sug ? " Use suggestion language." : ""}

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

function promptCardsR3(r2Selected, path, userContext) {
    const ctx = userContext ? `\nUser context: "${userContext}"` : "";
    const sug = path === "reimagine";
    return `Final role selection. Round 2 selections: ${r2Selected.join(", ")}${ctx}

Generate 2 to 3 highly precise real job titles resolving the final distinction. This is the final round — be as specific as the evidence allows.

Return 2–3 options as a JSON array. Each object:
- "name": real specific job title
- "explanation": two plain sentences on what specifically distinguishes this role${sug ? " Use suggestion language." : ""}

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

function promptSheet(roleName, path, userContext) {
    const sug = path === "reimagine";
    const ctx = userContext ? `\nUser context: "${userContext}"` : "";
    return `Generate a character sheet for someone whose confirmed role is: ${roleName}
Path: ${pTrack(path)}${ctx}

Identify 4–6 judgement dimensions that separate mid-level from senior in this specific role. Use real field vocabulary.

Each stat:
- "name": a skill practitioners in this role immediately recognise
- "definition": one sentence defining it in context of this role
- "level": Early / Developing / Solid / Advanced — honest, not flattery
- "isLowest": true for the single biggest growth opportunity

Also:
- "pathName": 2–4 words — real field name suitable for a LinkedIn headline (e.g. "Community Management", "B2B Product Management")
- "originStory": ${sug ? 'one short paragraph connecting their responses to why this role could suit them. Suggestion language only — "Your responses suggest...", "This could be a natural fit because...". Never declarative.' : 'null'}

CRITICAL: Return ONLY valid JSON: {"stats":[...],"pathName":"...","originStory":"..."}. Start with { end with }.`;
}

function promptProbeRound(roleName, flaggedStats, roundNum, previousAnswers) {
    const prev = previousAnswers.length > 0 ? `\nPrevious probe answers:\n${previousAnswers.map((a,i)=>`Q${i+1}: ${a}`).join("\n")}` : "";
    return `Calibration probe round ${roundNum} of 2 for someone in: ${roleName}
Flagged stats: ${flaggedStats.join(", ")}${prev}

Generate ${roundNum === 1 ? "3" : "2"} targeted scenario questions — one per flagged stat. Questions must feel like real situations from a work week, not a test.

Return JSON array. Each object:
- "stat": the stat name this probes
- "question": the scenario question

CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

function promptRecalibrate(roleName, path, currentStats, probeQA) {
    const qa = probeQA.map(qa => `Stat: ${qa.stat}\nQ: ${qa.question}\nA: ${qa.answer}`).join("\n\n");
    return `Recalibrate a character sheet for someone in: ${roleName}

Current stats:
${currentStats.map(s=>`- ${s.name}: ${s.level}`).join("\n")}

Probe answers:
${qa}

Only adjust levels where answers give clear evidence. Return updated stats.

JSON array. Each object: "name", "definition", "level", "isLowest"
CRITICAL: Return ONLY a valid JSON array. Start with [ end with ].`;
}

function promptEncounter(roleName, lowestStatName) {
    return `Generate a first encounter for someone working toward: ${roleName}
Their biggest growth area: ${lowestStatName}

A single realistic work situation that tests this dimension.

- "name": 2–4 word scenario title
- "situation": 2–3 sentences — what they see, what they're asked to do, what the pressure or ambiguity is
- "expertResponse": 2–3 sentences — what an expert does differently in how they think and approach it

CRITICAL: Return ONLY valid JSON: {"name":"...","situation":"...","expertResponse":"..."}. Start with { end with }.`;
}

function promptEncounterReview(roleName, lowestStatName, situation, userResponse, expertResponse) {
    const skipped = !userResponse || userResponse.trim().length < 10;
    return `You are reviewing an operative's response to a simulated work encounter.

Role: ${roleName}
Skill being tested: ${lowestStatName}

The scenario:
${situation}

Expert approach:
${expertResponse}

Operative's response:
${skipped ? "[Operative chose to skip — show them what they missed]" : userResponse}

Generate a structured review with four components:

1. "verdictLabel": one of "INSTINCT MATCHED", "PARTIAL SIGNAL", or "SIGNAL MISSED" — based on how close their thinking was to the expert approach. If skipped, use "SIGNAL MISSED".

2. "acknowledgement": 1–2 sentences. Pull something specific from their actual response and name what they got right. If skipped, acknowledge they chose to observe instead.

3. "gap": 1–2 sentences. Name the precise thing that separates their response from the expert approach. Be specific to this role and this scenario. Not generic career advice.

4. "forward": 1 sentence. The single most actionable thing they'd do differently in the next real version of this situation. Specific to this role.

5. "statDelta": one of "up", "same", or "down" — did their response suggest the flagged stat (${lowestStatName}) is higher, the same, or lower than the sheet showed?

CRITICAL: Return ONLY valid JSON: {"verdictLabel":"...","acknowledgement":"...","gap":"...","forward":"...","statDelta":"..."}. Start with { end with }.`;
}

function promptStatus(roleName, path, stats, universalContext) {
    return `Generate a final status report for an operative. This is their career profile reward — make it honest, specific, and useful.

Role: ${roleName}
Path: ${pTrack(path)}
Role-specific stats: ${stats.map(s=>`${s.name}: ${s.level}`).join(", ")}
Additional context: ${universalContext}

Generate:

1. Five universal career stat scores (0–100). Be honest — not flattery. These should reflect the evidence from the session.
   - "execution": ability to deliver outcomes, hit deadlines, close work
   - "judgement": ability to read situations and make calls with incomplete information
   - "communication": ability to move information and create alignment across stakeholders
   - "domainDepth": depth of specific knowledge in their field
   - "adaptability": ability to perform under change, ambiguity, and unfamiliar territory

2. Seniority tier for this role. Choose the most accurate from: Junior / Associate / Mid-Level / Senior / Lead / Principal / Head
   - "seniority": the tier

3. PATH codename — a 1–2 word title that captures how PATH sees this person's operating style. Something that would feel earned. Examples: "The Architect", "The Operator", "The Catalyst", "The Navigator", "The Analyst", "The Builder"
   - "codename": the codename with "The" prefix

CRITICAL: Return ONLY valid JSON:
{"execution":0,"judgement":0,"communication":0,"domainDepth":0,"adaptability":0,"seniority":"...","codename":"..."}
Start with { end with }.`;
}


/* ============================================================
   OFFLINE FALLBACK ENGINE
   Covers all four Gemini call failure points.
   ============================================================ */

const DOMAIN_KEYWORDS = {
    community:   ["community","members","engagement","forum","discord","moderation","retention","events","user groups","advocate","ecosystem","slack","cohort","belonging","member","moderator"],
    product:     ["product","roadmap","sprint","backlog","stakeholder","user research","prd","launch","okr","feature","prioritisation","product manager","pm ","agile","scrum","epics","user story"],
    marketing:   ["campaign","brand","content","seo","paid","conversion","funnel","copywriting","social","analytics","growth","marketing","email","newsletter","ads","creative","copy"],
    operations:  ["operations","process","workflow","sla","vendor","logistics","coordination","systems","efficiency","scaling","ops","programme","project manager","delivery","coordination"],
    engineering: ["engineer","developer","code","architecture","deploy","api","backend","frontend","infrastructure","debugging","software","javascript","python","react","node","sql","devops"],
    design:      ["ux","ui","design","wireframe","prototype","user testing","figma","accessibility","visual","interaction","design thinking","typography","colour","layout","illustration"],
    sales:       ["sales","revenue","pipeline","quota","crm","prospecting","account","closing","negotiation","client","b2b","enterprise","demo","leads","hubspot","salesforce"],
    research:    ["research","analysis","data","insights","qualitative","quantitative","survey","report","synthesis","findings","analytics","metrics","kpi","dashboard","tableau"]
};

const SENIORITY_KEYWORDS = {
    junior:    ["junior","graduate","entry","intern","trainee","apprentice","assistant","associate"],
    mid:       ["coordinator","specialist","analyst","executive","officer","mid",""],
    senior:    ["senior","sr.","experienced"],
    lead:      ["lead","principal","manager","head of","director of team lead"],
    principal: ["head","director","vp","vice president","chief","cto","cmo","coo","founder","co-founder"]
};

const DOMAIN_ROLES = {
    community:   ["Community Manager","Community Operations Manager","Head of Community","Developer Relations Manager","Community Growth Manager"],
    product:     ["Product Manager","Senior Product Manager","Product Manager — Growth","Associate Product Manager","Product Lead"],
    marketing:   ["Marketing Manager","Content Marketing Manager","Growth Marketing Manager","Brand Marketing Manager","Digital Marketing Manager"],
    operations:  ["Operations Manager","Programme Manager","Project Manager","Operations Coordinator","Head of Operations"],
    engineering: ["Software Engineer","Frontend Engineer","Backend Engineer","Full Stack Engineer","Engineering Manager"],
    design:      ["UX Designer","Product Designer","UI Designer","Design Lead","UX Researcher"],
    sales:       ["Account Executive","Sales Manager","Business Development Manager","Sales Development Representative","Head of Sales"],
    research:    ["Research Analyst","Data Analyst","Insights Manager","UX Researcher","Strategy Analyst"]
};

const DOMAIN_STATS = {
    community: [
        { name: "Member Retention Strategy", definition: "Ability to design and execute programmes that keep community members engaged over time.", level: "Developing", isLowest: false },
        { name: "Conflict De-escalation", definition: "Skill at resolving tensions between members before they damage community health.", level: "Developing", isLowest: true },
        { name: "Community Health Diagnosis", definition: "Reading engagement signals to identify what a community needs before problems surface.", level: "Solid", isLowest: false },
        { name: "Event Programming", definition: "Creating and running community events that drive meaningful connection and engagement.", level: "Solid", isLowest: false }
    ],
    product: [
        { name: "Roadmap Prioritisation", definition: "Making defensible decisions about what to build next when everything seems urgent.", level: "Developing", isLowest: true },
        { name: "Stakeholder Alignment", definition: "Getting engineering, design, and business leadership to agree on direction without losing momentum.", level: "Developing", isLowest: false },
        { name: "User Research Synthesis", definition: "Turning qualitative and quantitative signals into product decisions that solve real problems.", level: "Solid", isLowest: false },
        { name: "Metrics Definition", definition: "Choosing the right measures of success for a feature or product area.", level: "Solid", isLowest: false }
    ],
    marketing: [
        { name: "Campaign Architecture", definition: "Designing multi-channel campaigns with clear logic between channels and consistent messaging.", level: "Developing", isLowest: false },
        { name: "Audience Segmentation", definition: "Identifying and targeting distinct audience groups with appropriately tailored messages.", level: "Solid", isLowest: false },
        { name: "Performance Analysis", definition: "Reading campaign data to understand what drove results, not just what the numbers were.", level: "Developing", isLowest: true },
        { name: "Brand Voice Consistency", definition: "Maintaining a coherent brand voice across channels, teams, and content types.", level: "Solid", isLowest: false }
    ],
    operations: [
        { name: "Process Design", definition: "Building workflows that scale without breaking when the team or volume grows.", level: "Solid", isLowest: false },
        { name: "Cross-functional Coordination", definition: "Moving work forward across teams that have different priorities and communication styles.", level: "Developing", isLowest: true },
        { name: "Vendor Management", definition: "Managing external partners to deliver quality outcomes on time and within budget.", level: "Developing", isLowest: false },
        { name: "Risk Identification", definition: "Spotting operational risks early enough to mitigate them before they become incidents.", level: "Solid", isLowest: false }
    ],
    engineering: [
        { name: "System Design", definition: "Architecting solutions that handle scale, edge cases, and future requirements.", level: "Developing", isLowest: true },
        { name: "Code Review", definition: "Giving and receiving code feedback that improves quality without slowing the team.", level: "Solid", isLowest: false },
        { name: "Debugging Under Pressure", definition: "Diagnosing production issues systematically when the pressure to fix is high.", level: "Developing", isLowest: false },
        { name: "Technical Communication", definition: "Explaining technical decisions to non-technical stakeholders clearly and without condescension.", level: "Solid", isLowest: false }
    ],
    design: [
        { name: "User Research Integration", definition: "Bringing real user evidence into design decisions rather than designing from assumptions.", level: "Developing", isLowest: false },
        { name: "Design Systems Thinking", definition: "Building components and patterns that scale across a product without visual fragmentation.", level: "Solid", isLowest: false },
        { name: "Stakeholder Presentation", definition: "Presenting design work in a way that generates useful feedback rather than subjective opinions.", level: "Developing", isLowest: true },
        { name: "Interaction Detail", definition: "Getting the micro-interactions and edge cases right that separate good UX from great UX.", level: "Solid", isLowest: false }
    ],
    sales: [
        { name: "Discovery Questioning", definition: "Asking the questions that reveal the real buying motivation behind the stated need.", level: "Developing", isLowest: true },
        { name: "Objection Handling", definition: "Responding to concerns in a way that advances the sale rather than defending against it.", level: "Developing", isLowest: false },
        { name: "Pipeline Management", definition: "Keeping deals moving through each stage with the right actions at the right time.", level: "Solid", isLowest: false },
        { name: "Account Expansion", definition: "Growing revenue within existing accounts by identifying new problems to solve.", level: "Solid", isLowest: false }
    ],
    research: [
        { name: "Research Design", definition: "Constructing studies that answer the real question, not just the stated question.", level: "Solid", isLowest: false },
        { name: "Insight Synthesis", definition: "Finding the pattern across data points that changes how a team thinks or decides.", level: "Developing", isLowest: false },
        { name: "Stakeholder Communication", definition: "Getting research findings acted upon by the people who commissioned them.", level: "Developing", isLowest: true },
        { name: "Method Selection", definition: "Choosing the right research method for the question and the time available.", level: "Solid", isLowest: false }
    ]
};

const DOMAIN_ENCOUNTERS = {
    community: {
        name: "The Exodus Signal",
        situation: "Three of your most engaged community members have gone quiet in the same week. One sent a brief DM saying they're 'stepping back for now.' No explanation. Your community health metrics haven't moved yet, but you've seen this pattern before.",
        expertResponse: "An expert doesn't wait for the data to confirm what the qualitative signals already suggest. They reach out individually, not with a survey, but a genuine human message — asking what changed, not what they can fix. They use this as an early warning to audit what the community is actually delivering for power users versus what it promises."
    },
    product: {
        name: "The Priority Standoff",
        situation: "Engineering says the feature your biggest customer is asking for will take three sprints. Sales says if it's not in the next release, they lose the deal. The CEO just forwarded the customer's email to you with no comment. You have until tomorrow morning.",
        expertResponse: "An expert separates the decision from the pressure. They get the full picture first — exact engineering scope, exact customer need, whether the customer actually needs the feature or a workaround. Then they frame a clear recommendation with trade-offs rather than asking others to decide. They control the narrative before the CEO asks for one."
    },
    marketing: {
        name: "The Attribution Gap",
        situation: "Your last campaign drove strong traffic but conversions are flat. The paid team says the creative worked. The content team says the landing page underperformed. You're presenting to the CMO in 48 hours and the data supports both arguments.",
        expertResponse: "An expert resists the pressure to pick a side before the data is clear. They identify what the data actually shows versus what each team is reading into it, then design a fast test that will resolve the ambiguity. To the CMO, they present the honest picture — what they know, what they don't, and what they're doing about it — rather than a story that fits the preferred narrative."
    },
    operations: {
        name: "The Cascading Delay",
        situation: "A vendor missed a deadline. That delay has now pushed two downstream deliverables. Three teams are waiting on your update and each team lead has a different version of what went wrong. You have incomplete information and a leadership call in two hours.",
        expertResponse: "An expert communicates before they have all the answers. They send a brief, factual update now — what happened, what's confirmed, what's unknown, and when the next update will come. They don't wait for the full picture before communicating. On the call, they own the coordination problem even if they didn't cause it, because that's what the role requires."
    },
    engineering: {
        name: "The Production Incident",
        situation: "An error is affecting 15% of users. The logs point to a change deployed two hours ago. The engineer who made the change is offline. You can roll back immediately, losing two days of work, or attempt a hotfix in a live environment with incomplete knowledge of the codebase.",
        expertResponse: "An expert defaults to the rollback — protecting users is non-negotiable when the alternative is a hotfix on a codebase they don't fully know in a live environment. They communicate the decision and rationale immediately to the team, document what happened, and use the incident to improve the deployment process. They don't let ego or sunk cost push them toward a risky fix."
    },
    design: {
        name: "The Stakeholder Override",
        situation: "You've designed a checkout flow based on user research. The VP of Product wants to add a promotional banner at the top of the page. Your testing shows that any interruption at this stage drops completion by 12%. The VP says it's a business requirement.",
        expertResponse: "An expert doesn't just present the data and hope it wins the argument. They reframe: the real question is which risk is acceptable — conversion drop or missed promotion. They propose an A/B test with a clear success metric that respects both the business goal and the user behaviour evidence. They make the decision easy to make correctly."
    },
    sales: {
        name: "The Stalled Deal",
        situation: "A prospect has been 'almost ready' for six weeks. They keep asking for more information. Every follow-up gets a polite response and no movement. Your manager is asking about the deal status and you've run out of objections to handle.",
        expertResponse: "An expert recognises that constant information requests with no movement usually means the real objection hasn't been surfaced yet. They change the approach entirely — instead of another follow-up email, they ask for a direct conversation, and in that conversation they name the pattern: 'It feels like something is blocking this that we haven't talked about yet. What is it?' The answer is usually the real deal."
    },
    research: {
        name: "The Contested Finding",
        situation: "Your research shows that users find the new onboarding flow confusing. The product team says your sample was too small and the participants weren't representative. The finding threatens a feature that's already been built.",
        expertResponse: "An expert doesn't get defensive about their methodology when challenged — they engage with the challenge directly. If the sample was genuinely too small, they say so and propose what a more robust study would require. If the criticism is motivated by inconvenient findings, they document the disagreement clearly and make the limitation and the finding visible to leadership, giving them the information to decide rather than burying the result."
    }
};

function scoreDomain(text) {
    const lower = text.toLowerCase();
    const scores = {};
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
        scores[domain] = keywords.reduce((acc, kw) => {
            const matches = (lower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), "g")) || []).length;
            return acc + matches;
        }, 0);
    }
    return scores;
}

function detectSeniority(text) {
    const lower = text.toLowerCase();
    if (SENIORITY_KEYWORDS.principal.some(k => lower.includes(k))) return "Principal";
    if (SENIORITY_KEYWORDS.lead.some(k => lower.includes(k)))      return "Lead";
    if (SENIORITY_KEYWORDS.senior.some(k => lower.includes(k)))    return "Senior";
    if (SENIORITY_KEYWORDS.junior.some(k => lower.includes(k)))    return "Junior";
    return "Mid-Level";
}

function topDomain(scores) {
    return Object.entries(scores).sort((a,b) => b[1]-a[1])[0][0];
}

function offlineFallbackCards(inputText) {
    // Returns top 3 role suggestions as card objects
    const scores = scoreDomain(inputText);
    const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]).slice(0,3);
    return sorted.map(([domain]) => {
        const roles = DOMAIN_ROLES[domain];
        return {
            name:        roles[0],
            explanation: `This role appears to match patterns in your background. Day-to-day work centres on ${domain}-specific responsibilities requiring both technical knowledge and judgement.`
        };
    });
}

function offlineFallbackSheet(roleName, path) {
    const lower  = roleName.toLowerCase();
    let domain   = "operations";
    for (const d of Object.keys(DOMAIN_KEYWORDS)) {
        if (DOMAIN_KEYWORDS[d].some(k => lower.includes(k)) || DOMAIN_ROLES[d].some(r => lower.toLowerCase().includes(r.toLowerCase()))) {
            domain = d; break;
        }
    }
    const stats = DOMAIN_STATS[domain] || DOMAIN_STATS.operations;
    const pathName = roleName;
    const originStory = path === "reimagine"
        ? `Your responses point toward a natural fit with ${roleName}. The patterns in what you described — how you learn, how you help others, what you'd teach — suggest this could be a strong starting point for your career direction.`
        : null;
    return { stats, pathName, originStory };
}

function offlineFallbackEncounter(roleName) {
    const lower  = roleName.toLowerCase();
    let domain   = "operations";
    for (const d of Object.keys(DOMAIN_KEYWORDS)) {
        if (DOMAIN_KEYWORDS[d].some(k => lower.includes(k)) || DOMAIN_ROLES[d].some(r => r.toLowerCase().includes(lower))) {
            domain = d; break;
        }
    }
    return DOMAIN_ENCOUNTERS[domain] || DOMAIN_ENCOUNTERS.operations;
}

function offlineFallbackStatus(stats, seniority, selfAssessment) {
    // Self-assessment: "matched" | "partial" | "missed"
    // Derive numeric scores from stat levels + self-assessment
    const levelScore = { Early: 30, Developing: 48, Solid: 68, Advanced: 85 };
    const avgLevel = stats.reduce((a, s) => a + (levelScore[s.level] || 48), 0) / stats.length;

    const selfBonus = { matched: 8, partial: 0, missed: -6 };
    const bonus = selfBonus[selfAssessment] || 0;

    const scores = {
        execution:     Math.min(99, Math.round(avgLevel + bonus + (Math.random()*8 - 4))),
        judgement:     Math.min(99, Math.round(avgLevel + bonus - 5 + (Math.random()*10))),
        communication: Math.min(99, Math.round(avgLevel + bonus + 3 + (Math.random()*8 - 4))),
        domainDepth:   Math.min(99, Math.round(avgLevel + bonus + (Math.random()*8 - 4))),
        adaptability:  Math.min(99, Math.round(avgLevel + bonus - 3 + (Math.random()*10)))
    };

    const codeNames = ["The Operator","The Navigator","The Analyst","The Catalyst","The Builder","The Architect","The Investigator","The Strategist"];
    const codename  = codeNames[Math.floor(Math.random() * codeNames.length)];

    return { ...scores, seniority: seniority || "Mid-Level", codename };
}

function showOfflineInterruption(onContinue) {
    state.offlineMode = true;
    showModal({
        sysLabel:    "B.L.O.C.K. INTERFERENCE DETECTED",
        labelType:   "warn",
        body:        "Neural link disrupted. External cognitive processor unreachable.\n\nPATH switching to local analysis mode. Precision reduced. Signal holds.\n\nB.L.O.C.K. probably did this. Proceed anyway.",
        confirmText: "[ CONTINUE ON LOCAL SCAN ]",
        onConfirm:   onContinue
    });
}


/* ============================================================
   EVENT HANDLERS
   ============================================================ */


/* ---- Boot ---- */

document.getElementById("btn-begin").addEventListener("click", () => showScreen("screen-path-select"));


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
    const cv = document.getElementById("input-cv").value.trim();
    if (cv.length < 80) {
        showModal({ sysLabel: "INPUT INSUFFICIENT", labelType: "warn", body: "Career record too short for analysis. PATH needs the full text — not a summary. Paste your complete CV.", confirmText: "Go back" });
        return;
    }
    state.rawInput.cvText = cv;
    typewriterTerminal("neural-terminal", NEURAL_LINES_CV, () => showScreen("screen-api-key"));
    showScreen("screen-neural-link");
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
    if (!input) {
        showModal({ sysLabel: "INPUT REQUIRED", body: "PATH needs your answer to proceed — even a short one is fine. Take your time.", confirmText: "Continue writing" });
        return;
    }
    if (q < 3) {
        document.getElementById(`reimagine-q${q}`).classList.remove("active");
        document.getElementById(`reimagine-q${q+1}`).classList.add("active");
        state.reimagineCurrentQ = q + 1;
        updateReimagineProgress();
        return;
    }
    state.rawInput.reimagineResponses = [1,2,3].map(n => document.getElementById(`input-reimagine-${n}`).value.trim());
    typewriterTerminal("neural-terminal", NEURAL_LINES_REIMAGINE, () => showScreen("screen-api-key"));
    showScreen("screen-neural-link");
});

document.getElementById("btn-reimagine-back").addEventListener("click", () => {
    const q = state.reimagineCurrentQ;
    if (q > 1) {
        document.getElementById(`reimagine-q${q}`).classList.remove("active");
        document.getElementById(`reimagine-q${q-1}`).classList.add("active");
        state.reimagineCurrentQ = q - 1;
        updateReimagineProgress();
    }
});


/* ---- API key ---- */

document.getElementById("btn-validate-key").addEventListener("click", async () => {
    const key = document.getElementById("input-api-key").value.trim();
    if (!key) { setHint("api-key-hint", "Paste your cognitive processor key.", "error"); return; }

    const btn = document.getElementById("btn-validate-key");
    btn.disabled = true;
    document.getElementById("api-key-loader").classList.remove("hidden");
    setHint("api-key-hint", "");

    try {
        await validateGeminiKey(key);
        state.geminiKey = key;
        setHint("api-key-hint", "Link established.", "success");
        setTimeout(() => { state.onboardingPath === "cv" ? runCVAnalysis() : runReimagineAnalysis(); }, 400);
    } catch (err) {
        setHint("api-key-hint", "Key not recognised — check it and try again.", "error");
        btn.disabled = false;
        document.getElementById("api-key-loader").classList.add("hidden");
    }
});


/* ---- Gemini Call 1: Role cards ---- */

async function runCVAnalysis() {
    showLoading("screen-loading-1", "loading-1-label", "SCANNING CAREER RECORD");
    try {
        const compressed = compressCV(state.rawInput.cvText);
        const raw   = await callGemini(promptCardsR1CV(compressed), 8192);
        stopLoadingLabel("loading-1-label");
        const cards = parseJson(raw);
        state.inference.cardsR1Presented = cards;
        renderCards("card-grid-1", cards, "multi", false);
        showScreen("screen-cards-1");
    } catch (err) {
        console.error("PATH Call 1 failed:", err);
        stopLoadingLabel("loading-1-label");
        showOfflineInterruption(() => {
            const inputText = state.rawInput.cvText || "";
            const cards = offlineFallbackCards(inputText);
            state.inference.cardsR1Presented = cards;
            renderCards("card-grid-1", cards, "multi", false);
            showScreen("screen-cards-1");
        });
    }
}

async function runReimagineAnalysis() {
    showLoading("screen-loading-1", "loading-1-label", "MAPPING SIGNAL");
    try {
        const raw   = await callGemini(promptCardsR1Reimagine(state.rawInput.reimagineResponses), 8192);
        stopLoadingLabel("loading-1-label");
        const cards = parseJson(raw);
        state.inference.cardsR1Presented = cards;
        renderCards("card-grid-1", cards, "multi", true);
        showScreen("screen-cards-1");
    } catch (err) {
        console.error("PATH Call 1 failed:", err);
        stopLoadingLabel("loading-1-label");
        showOfflineInterruption(() => {
            const inputText = (state.rawInput.reimagineResponses || []).join(" ");
            const cards = offlineFallbackCards(inputText);
            state.inference.cardsR1Presented = cards;
            renderCards("card-grid-1", cards, "multi", true);
            showScreen("screen-cards-1");
        });
    }
}


/* ---- Round 1 confirm → Round 2 ---- */

document.getElementById("btn-cards-1-confirm").addEventListener("click", async () => {
    const selected = getSelectedNames("card-grid-1");
    if (!selected.length) { showModal({ sysLabel: "SELECTION REQUIRED", body: "Select at least one role that resonates before continuing.", confirmText: "Go back" }); return; }
    state.inference.cardsR1Selected = selected;

    showLoading("screen-loading-1", "loading-1-label", "NARROWING SIGNAL");
    try {
        const raw   = await callGemini(promptCardsR2(selected, state.onboardingPath, state.userContext), 4096);
        stopLoadingLabel("loading-1-label");
        const cards = parseJson(raw);
        state.inference.cardsR2Presented = cards;
        renderCards("card-grid-2", cards, "max2", state.onboardingPath === "reimagine");
        showScreen("screen-cards-2");
    } catch (err) {
        console.error("PATH R2 failed:", err);
        stopLoadingLabel("loading-1-label");
        showOfflineInterruption(() => {
            // Use same cards but as max2
            renderCards("card-grid-2", state.inference.cardsR1Presented.slice(0,3), "max2", state.onboardingPath === "reimagine");
            showScreen("screen-cards-2");
        });
    }
});


/* ---- Round 2 confirm → Round 3 ---- */

document.getElementById("btn-cards-2-confirm").addEventListener("click", async () => {
    const selected = getSelectedNames("card-grid-2");
    if (!selected.length) { showModal({ sysLabel: "SELECTION REQUIRED", body: "Select at least one role before continuing.", confirmText: "Go back" }); return; }
    state.inference.cardsR2Selected = selected;

    showLoading("screen-loading-1", "loading-1-label", "ISOLATING FREQUENCY");
    try {
        const raw   = await callGemini(promptCardsR3(selected, state.onboardingPath, state.userContext), 4096);
        stopLoadingLabel("loading-1-label");
        const cards = parseJson(raw);
        state.inference.cardsR3Presented = cards;
        renderCards("card-grid-3", cards, "single", state.onboardingPath === "reimagine");
        showScreen("screen-cards-3");
    } catch (err) {
        console.error("PATH R3 failed:", err);
        stopLoadingLabel("loading-1-label");
        showOfflineInterruption(() => {
            renderCards("card-grid-3", state.inference.cardsR2Presented.slice(0,2), "single", state.onboardingPath === "reimagine");
            showScreen("screen-cards-3");
        });
    }
});


/* ---- Round 3 confirm — lock frequency ---- */

document.getElementById("btn-cards-3-confirm").addEventListener("click", async () => {
    const selected = getSelectedNames("card-grid-3");
    if (!selected.length) { showModal({ sysLabel: "LOCK REQUIRED", body: "Select one role to lock your frequency before proceeding.", confirmText: "Go back" }); return; }

    const ctx = document.getElementById("input-card-context-3").value.trim();
    if (ctx) state.userContext = ctx;

    state.inference.cardsR3Selected = selected[0];
    state.confirmedRole = selected[0];
    await generateSheet();
});


/* ---- Gemini Call 2: Character sheet ---- */

async function generateSheet() {
    showLoading("screen-loading-2", "loading-2-label", "BUILDING CHARACTER SHEET");
    try {
        const raw  = await callGemini(promptSheet(state.confirmedRole, state.onboardingPath, state.userContext), 8192);
        stopLoadingLabel("loading-2-label");
        const data = parseJson(raw);
        applySheet(data);
    } catch (err) {
        console.error("PATH Sheet failed:", err);
        stopLoadingLabel("loading-2-label");
        showOfflineInterruption(() => {
            const data = offlineFallbackSheet(state.confirmedRole, state.onboardingPath);
            applySheet(data);
        });
    }
}

function applySheet(data) {
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

    // Reset sheet actions
    const actions = document.getElementById("sheet-actions");
    actions.innerHTML = `
        <button class="btn btn--primary" id="btn-sheet-confirm">This is accurate</button>
        <button class="btn btn--ghost" id="btn-sheet-flag">Some of this is off — recalibrate</button>
    `;
    document.getElementById("btn-sheet-confirm").addEventListener("click", () => {
        state.statusScreen.confirmed    = true;
        state.statusScreen.flaggedStats = [];
        state.confidence = calcConfidence(0);
        launchEncounterIntro();
    });
    document.getElementById("btn-sheet-flag").addEventListener("click", () => {
        renderFlagList(state.statusScreen.stats);
        showScreen("screen-flag");
    });

    renderStats(data.stats);
    attachTermTriggers();
    showScreen("screen-character-sheet");
}


/* ---- Flag → Probe ---- */

let probeR1Questions = [];
let probeR2Questions = [];

document.getElementById("btn-flag-confirm").addEventListener("click", async () => {
    const flagged = Array.from(document.querySelectorAll("#flag-list input:checked")).map(el => el.value);
    if (!flagged.length) {
        state.statusScreen.confirmed = true;
        state.confidence = calcConfidence(0);
        launchEncounterIntro();
        return;
    }
    state.statusScreen.flaggedStats = flagged;
    state.confidence = calcConfidence(flagged.length);

    showLoading("screen-loading-3", "loading-3-label", "PREPARING DEEP PROBE");
    try {
        const raw = await callGemini(promptProbeRound(state.confirmedRole, flagged, 1, []), 4096);
        stopLoadingLabel("loading-3-label");
        probeR1Questions = parseJson(raw);
        renderProbeQuestions("probe-questions-1", probeR1Questions);
        showScreen("screen-probe-1");
    } catch (err) {
        console.error("PATH Probe R1 failed:", err);
        stopLoadingLabel("loading-3-label");
        showModal({ sysLabel: "B.L.O.C.K. INTERFERENCE", labelType: "warn", body: "Probe signal lost. Proceeding with initial character sheet data.", confirmText: "[ CONTINUE ]", onConfirm: () => launchEncounterIntro() });
    }
});

document.getElementById("btn-probe-1-confirm").addEventListener("click", async () => {
    const answers = getProbeAnswers("probe-questions-1");
    state.probeResponses.push(...answers);

    showLoading("screen-loading-3", "loading-3-label", "RUNNING SECOND PROBE");
    try {
        const raw = await callGemini(promptProbeRound(state.confirmedRole, state.statusScreen.flaggedStats, 2, answers.map(a=>a.answer)), 4096);
        stopLoadingLabel("loading-3-label");
        probeR2Questions = parseJson(raw);
        renderProbeQuestions("probe-questions-2", probeR2Questions);
        showScreen("screen-probe-2");
    } catch (err) {
        console.error("PATH Probe R2 failed:", err);
        stopLoadingLabel("loading-3-label");
        showModal({ sysLabel: "B.L.O.C.K. INTERFERENCE", labelType: "warn", body: "Second probe signal lost. Recalibrating with available data.", confirmText: "[ CONTINUE ]", onConfirm: () => launchEncounterIntro() });
    }
});

document.getElementById("btn-probe-2-confirm").addEventListener("click", async () => {
    const answers = getProbeAnswers("probe-questions-2");
    state.probeResponses.push(...answers);

    showLoading("screen-loading-3", "loading-3-label", "RECALIBRATING CHARACTER SHEET");
    try {
        const raw = await callGemini(promptRecalibrate(state.confirmedRole, state.onboardingPath, state.statusScreen.stats, state.probeResponses), 4096);
        stopLoadingLabel("loading-3-label");
        const updated = parseJson(raw);
        state.statusScreen.stats = state.statusScreen.stats.map(orig => {
            const u = updated.find(r => r.name === orig.name);
            return u ? { ...orig, level: u.level, isLowest: u.isLowest } : orig;
        });
        state.statusScreen.confirmed = true;

        document.getElementById("sheet-footer-note").textContent = "RECALIBRATION COMPLETE.";
        renderStats(state.statusScreen.stats);
        attachTermTriggers();

        const actions = document.getElementById("sheet-actions");
        actions.innerHTML = `<button class="btn btn--primary" id="btn-sheet-proceed">Proceed to test directive</button>`;
        document.getElementById("btn-sheet-proceed").addEventListener("click", () => launchEncounterIntro());
        showScreen("screen-character-sheet");

    } catch (err) {
        console.error("PATH Recalibrate failed:", err);
        stopLoadingLabel("loading-3-label");
        launchEncounterIntro();
    }
});


/* ---- Encounter intro (typewriter terminal) ---- */

function launchEncounterIntro() {
    showScreen("screen-encounter-intro");
    const acceptBtn = document.getElementById("btn-encounter-intro-accept");
    acceptBtn.classList.add("hidden");

    typewriterTerminal("encounter-intro-terminal", ENCOUNTER_INTRO_LINES, () => {
        acceptBtn.classList.remove("hidden");
    });
}

document.getElementById("btn-encounter-intro-accept").addEventListener("click", () => {
    generateEncounter();
});


/* ---- Gemini Call 3: Encounter ---- */

async function generateEncounter() {
    const lowest = state.statusScreen.stats.find(s => s.isLowest) || state.statusScreen.stats[state.statusScreen.stats.length - 1];
    showLoading("screen-loading-4", "loading-4-label", "GENERATING TEST DIRECTIVE");
    try {
        const raw  = await callGemini(promptEncounter(state.confirmedRole, lowest.name), 4096);
        stopLoadingLabel("loading-4-label");
        const data = parseJson(raw);
        state.encounterData = { ...data, lowestStatName: lowest.name };
        renderEncounter(data, lowest.name);
    } catch (err) {
        console.error("PATH Encounter failed:", err);
        stopLoadingLabel("loading-4-label");
        showOfflineInterruption(() => {
            const data = offlineFallbackEncounter(state.confirmedRole);
            state.encounterData = { ...data, lowestStatName: lowest.name };
            renderEncounter(data, lowest.name);
        });
    }
}

function renderEncounter(data, lowestStatName) {
    document.getElementById("encounter-name").textContent        = data.name;
    document.getElementById("encounter-situation").textContent   = data.situation;
    document.getElementById("encounter-stat-label").textContent  = lowestStatName;
    document.getElementById("input-encounter-response").value    = "";
    showScreen("screen-encounter");
}


/* ---- Encounter submit ---- */

document.getElementById("btn-encounter-submit").addEventListener("click", async () => {
    const response = document.getElementById("input-encounter-response").value.trim();
    if (!response) {
        showModal({ sysLabel: "RESPONSE REQUIRED", body: "PATH needs your response to evaluate your decision-making. Write what you would actually do — there is no wrong answer, only signal.", confirmText: "Continue writing" });
        return;
    }
    state.encounterResponse = response;
    await reviewEncounterResponse(response, false);
});

document.getElementById("btn-encounter-skip").addEventListener("click", async () => {
    state.encounterResponse = null;
    await reviewEncounterResponse(null, true);
});

async function reviewEncounterResponse(userResponse, skipped) {
    const d = state.encounterData;
    showLoading("screen-loading-5", "loading-5-label", "EVALUATING RESPONSE");
    try {
        const raw    = await callGemini(promptEncounterReview(state.confirmedRole, d.lowestStatName, d.situation, userResponse || "", d.expertResponse), 4096);
        stopLoadingLabel("loading-5-label");
        const review = parseJson(raw);
        state.encounterVerdict = review;
        renderEncounterReview(review, d.expertResponse, skipped);
    } catch (err) {
        console.error("PATH Review failed:", err);
        stopLoadingLabel("loading-5-label");
        // Offline fallback — use self-assessment
        showOfflineInterruption(() => {
            if (skipped) {
                renderOfflineSelfAssess(d.expertResponse);
            } else {
                renderOfflineSelfAssess(d.expertResponse);
            }
        });
    }
}

function renderEncounterReview(review, expertResponse, skipped) {
    // Verdict label colour
    const verdictEl = document.getElementById("verdict-label");
    verdictEl.textContent = review.verdictLabel;
    verdictEl.className   = "verdict-block__label";
    if (review.verdictLabel === "INSTINCT MATCHED")  verdictEl.classList.add("strong");
    else if (review.verdictLabel === "PARTIAL SIGNAL") verdictEl.classList.add("partial");
    else verdictEl.classList.add("missed");

    document.getElementById("verdict-acknowledgement").textContent = review.acknowledgement || "";
    document.getElementById("verdict-gap").textContent             = review.gap || "";
    document.getElementById("verdict-forward").textContent         = review.forward || "";
    document.getElementById("expert-block-text").textContent       = expertResponse;

    // Show stat update after a beat
    const statUpdateBlock = document.getElementById("stat-update-block");
    const statUpdateRow   = document.getElementById("stat-update-row");
    const lowestStat = state.statusScreen.stats.find(s => s.isLowest) || state.statusScreen.stats[0];

    if (review.statDelta !== "same" && lowestStat) {
        const levelOrder  = ["Early", "Developing", "Solid", "Advanced"];
        const currentIdx  = levelOrder.indexOf(lowestStat.level);
        let newLevel      = lowestStat.level;

        if (review.statDelta === "up"   && currentIdx < 3) newLevel = levelOrder[currentIdx + 1];
        if (review.statDelta === "down" && currentIdx > 0) newLevel = levelOrder[currentIdx - 1];

        if (newLevel !== lowestStat.level) {
            lowestStat.level = newLevel;
            setTimeout(() => {
                statUpdateRow.innerHTML = `
                    <span class="stat-update-name">${escapeHtml(lowestStat.name)}</span>
                    <span class="stat-update-from">${escapeHtml(levelOrder[currentIdx])}</span>
                    <span class="stat-update-arrow">→</span>
                    <span class="stat-update-to stat-level--${newLevel.toLowerCase()}">${escapeHtml(newLevel)}</span>
                `;
                statUpdateBlock.classList.remove("hidden");
            }, 1200);
        }
    }

    showScreen("screen-encounter-review");
}

function renderOfflineSelfAssess(expertResponse) {
    // Fallback: show expert response and ask self-assessment
    document.getElementById("verdict-label").textContent     = "SELF-ASSESSMENT REQUIRED";
    document.getElementById("verdict-label").className       = "verdict-block__label";
    document.getElementById("verdict-acknowledgement").textContent = "Neural link unavailable. Review the expert approach below and assess your own response.";
    document.getElementById("verdict-gap").textContent       = "Compare your thinking to the expert approach. Where did they diverge?";
    document.getElementById("verdict-forward").textContent   = "Use this to identify what you'd do differently in a real version of this situation.";
    document.getElementById("expert-block-text").textContent = expertResponse;
    document.getElementById("stat-update-block").classList.add("hidden");

    // Replace continue button with self-assessment options
    const actions = document.querySelector("#screen-encounter-review .screen-actions");
    actions.innerHTML = `
        <p style="font-family:var(--font-mono);font-size:0.625rem;letter-spacing:0.15em;color:var(--colour-accent-dim);text-transform:uppercase;margin-bottom:8px;">HOW CLOSE WAS YOUR THINKING?</p>
        <button class="btn btn--primary" data-assess="matched">My instinct matched</button>
        <button class="btn btn--ghost"   data-assess="partial">Partially aligned</button>
        <button class="btn btn--ghost"   data-assess="missed">I missed the mark</button>
    `;

    actions.querySelectorAll("[data-assess]").forEach(btn => {
        btn.addEventListener("click", () => {
            state.encounterVerdict = { verdictLabel: btn.dataset.assess, statDelta: btn.dataset.assess === "matched" ? "up" : btn.dataset.assess === "missed" ? "down" : "same" };
            generateStatus();
        });
    });

    showScreen("screen-encounter-review");
}

document.getElementById("btn-review-continue").addEventListener("click", () => {
    generateStatus();
});


/* ---- Gemini Call 4: Status ---- */

async function generateStatus() {
    const seniority = detectSeniority(
        [state.rawInput.cvText || "", ...(state.rawInput.reimagineResponses || [])].join(" ")
    );

    const universalContext = [
        `Probe responses: ${state.probeResponses.map(p=>p.answer).join(". ")}`,
        `Encounter verdict: ${state.encounterVerdict?.verdictLabel || "n/a"}`,
        `Seniority detected: ${seniority}`
    ].join("\n");

    showLoading("screen-loading-6", "loading-6-label", "COMPILING STATUS REPORT");
    try {
        const raw  = await callGemini(promptStatus(state.confirmedRole, state.onboardingPath, state.statusScreen.stats, universalContext), 4096);
        stopLoadingLabel("loading-6-label");
        const data = parseJson(raw);
        state.universalStats = data;
        state.rank = { seniority: data.seniority, codename: data.codename };
        renderStatus(data);
    } catch (err) {
        console.error("PATH Status failed:", err);
        stopLoadingLabel("loading-6-label");
        showOfflineInterruption(() => {
            const selfAssess = state.encounterVerdict?.verdictLabel === "INSTINCT MATCHED" ? "matched"
                             : state.encounterVerdict?.verdictLabel === "PARTIAL SIGNAL"   ? "partial"
                             : "missed";
            const data = offlineFallbackStatus(state.statusScreen.stats, seniority, selfAssess);
            state.universalStats = data;
            state.rank = { seniority: data.seniority, codename: data.codename };
            renderStatus(data);
        });
    }
}

function renderStatus(data) {
    // Rank header
    document.getElementById("status-codename").textContent  = `[ ${data.codename} ]`;
    document.getElementById("status-name").textContent      = (state.operativeName || "OPERATIVE").toUpperCase();
    document.getElementById("status-role").textContent      = state.confirmedRole;
    document.getElementById("status-seniority").textContent = data.seniority.toUpperCase();
    document.getElementById("status-domain-label").textContent = state.pathName || state.confirmedRole;

    // Universal career stats
    const universalContainer = document.getElementById("universal-stats");
    universalContainer.innerHTML = "";

    const statDefs = [
        { key: "execution",     label: "EXECUTION" },
        { key: "judgement",     label: "JUDGEMENT" },
        { key: "communication", label: "COMMUNICATION" },
        { key: "domainDepth",   label: "DOMAIN DEPTH" },
        { key: "adaptability",  label: "ADAPTABILITY" }
    ];

    statDefs.forEach(({ key, label }) => {
        const value = data[key] || 0;
        const colourClass = value >= 75 ? "high" : value >= 55 ? "good" : value >= 35 ? "mid" : "low";

        const row = document.createElement("div");
        row.className = "u-stat";
        row.innerHTML = `
            <span class="u-stat__name">${label}</span>
            <div class="u-stat__bar">
                <div class="u-stat__bar-fill ${colourClass}" data-value="${value}" style="width:0%"></div>
            </div>
            <span class="u-stat__value">${value}</span>
        `;
        universalContainer.appendChild(row);
    });

    // Animate bars in after a beat
    setTimeout(() => {
        universalContainer.querySelectorAll(".u-stat__bar-fill").forEach(fill => {
            fill.style.width = fill.dataset.value + "%";
        });
    }, 200);

    // Role-specific skill breakdown
    const skillList = document.getElementById("status-skill-list");
    skillList.innerHTML = "";
    state.statusScreen.stats.forEach(stat => {
        const item = document.createElement("div");
        item.className = "stat-item";
        item.innerHTML = `
            <span class="stat-name term"
                  data-definition="${escapeHtml(stat.definition)}"
                  data-stat-name="${escapeHtml(stat.name)}">${escapeHtml(stat.name)}</span>
            <span class="stat-level stat-level--${stat.level.toLowerCase()}">${escapeHtml(stat.level)}</span>
        `;
        item.querySelector(".term").addEventListener("click", function() {
            showTooltip(this.dataset.statName, this.dataset.definition);
        });
        skillList.appendChild(item);
    });

    // Origin signal (Track B only)
    const originBlock = document.getElementById("status-origin-block");
    if (state.onboardingPath === "reimagine" && state.statusScreen.originStory) {
        document.getElementById("status-origin-text").textContent = state.statusScreen.originStory;
        originBlock.classList.remove("hidden");
    } else {
        originBlock.classList.add("hidden");
    }

    showScreen("screen-status");
    writeSession();
}


/* ---- Status screen email capture ---- */

document.getElementById("btn-status-email-submit").addEventListener("click", async () => {
    const email = document.getElementById("input-status-email").value.trim();
    if (!email || !email.includes("@")) {
        showModal({ sysLabel: "INVALID SIGNAL ADDRESS", body: "That doesn't look like a valid email address. Check it and try again.", confirmText: "Go back" });
        return;
    }
    state.waitlistSignup = true;
    state.waitlistEmail  = email;
    writeSession();

    if (db) {
        try {
            await db.collection("waitlist").add({
                email,
                sessionId:     state.sessionId,
                operativeName: state.operativeName,
                path:          state.onboardingPath,
                role:          state.confirmedRole,
                seniority:     state.rank?.seniority,
                codename:      state.rank?.codename,
                createdAt:     firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) { console.warn("PATH: Waitlist write failed —", err.message); }
    }

    document.getElementById("status-waitlist-form").classList.add("hidden");
    document.getElementById("status-waitlist-confirmation").classList.remove("hidden");
});

document.getElementById("btn-status-email-skip").addEventListener("click", () => {
    state.waitlistSignup = false;
    writeSession();
    document.getElementById("status-waitlist-form").classList.add("hidden");
    document.getElementById("status-waitlist-confirmation").classList.remove("hidden");
    document.getElementById("status-confirmation-text").textContent = "TRANSMISSION COMPLETE. YOUR PATH IS RECORDED.";
});


/* ============================================================
   RENDERING HELPERS
   ============================================================ */

function renderCards(containerId, cards, mode, isSuggestion) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    cards.forEach((card, i) => {
        const el = document.createElement("div");
        el.className    = "practice-card";
        el.dataset.index = i;
        el.dataset.name  = card.name;

        const sugTag = isSuggestion ? `<span class="card-suggestion-tag">POSSIBLE MATCH</span>` : "";
        el.innerHTML = `
            <span class="card-check">SEL</span>
            ${sugTag}
            <div class="card-name">${escapeHtml(card.name)}</div>
            <div class="card-explanation">${escapeHtml(card.explanation)}</div>
        `;

        el.addEventListener("click", () => {
            if (mode === "single") {
                container.querySelectorAll(".practice-card").forEach(c => c.classList.remove("selected"));
                el.classList.add("selected");
            } else if (mode === "max2") {
                const already = el.classList.contains("selected");
                const count   = container.querySelectorAll(".practice-card.selected").length;
                if (!already && count >= 2) return;
                el.classList.toggle("selected");
                updateRound2Limit(container);
            } else {
                el.classList.toggle("selected");
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
    return Array.from(document.querySelectorAll(`#${containerId} .practice-card.selected`)).map(el => el.dataset.name);
}

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
        item.querySelector(".term").addEventListener("click", function() { showTooltip(this.dataset.statName, this.dataset.definition); });
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
        item.querySelector("input").addEventListener("change", () => { item.classList.toggle("flagged", item.querySelector("input").checked); });
        container.appendChild(item);
    });
}

function renderProbeQuestions(containerId, questions) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    questions.forEach(q => {
        const item = document.createElement("div");
        item.className = "probe-item";
        item.innerHTML = `
            <span class="probe-stat-label">${escapeHtml(q.stat)}</span>
            <p class="probe-question-text">${escapeHtml(q.question)}</p>
            <textarea class="probe-answer" data-stat="${escapeHtml(q.stat)}" data-question="${escapeHtml(q.question)}" placeholder="Answer honestly — PATH is recalibrating..." spellcheck="true"></textarea>
        `;
        container.appendChild(item);
    });
}

function getProbeAnswers(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} .probe-answer`))
        .map(el => ({ stat: el.dataset.stat, question: el.dataset.question, answer: el.value.trim() }));
}


/* ============================================================
   TOOLTIP
   ============================================================ */

const TERM_DEFS = {
    "origin-story": "The part of your character sheet that tells the story of where your capabilities come from — what your experience already demonstrates, before any formal job title gets in the way.",
    "encounter":    "A named situation from your role — one that regularly separates people who operate on instinct from those who operate with real judgement."
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
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeTooltip(); closeModal(); } });


/* ============================================================
   UTILITY
   ============================================================ */

function genSessionId() { return "path_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8); }

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function setHint(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "field-hint" + (type ? ` field-hint--${type}` : "");
}

function calcConfidence(flagCount) {
    if (flagCount >= 2) return "low";
    if (flagCount === 1) return "medium";
    return "high";
}


/* ============================================================
   INIT
   ============================================================ */

function init() {
    state.sessionId = genSessionId();
    initFirebase();
    updateReimagineProgress();
    attachTermTriggers();
    runBoot();
}

init();
