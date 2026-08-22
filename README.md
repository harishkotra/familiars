# 🐾 Familiars — Adopt Your Fictional AI Pet

A self-contained, single-page **AI pet simulator** with a bright, fun, flat-color look. No build step, no backend, no dependencies — just open `index.html` in any modern browser and your pets will live, chat, remember you, build a relationship, and go on their own little adventures while you're away.

> **Style note:** the theme is deliberately *flat*. Cards use hard `2px` borders and offset solid shadows, buttons are solid color, and there are **zero CSS gradients anywhere** — just chunky solid colors, sticker cards, and playful accents.

<img width="3262" height="11254" alt="Familiars _ Adopt Your Fictional AI Pet" src="https://github.com/user-attachments/assets/1bb44248-2790-4a03-9b85-fee7fe32ca90" />
<img width="1621" height="1188" alt="Screenshot at Aug 22 11-25-13" src="https://github.com/user-attachments/assets/a81959a4-68d5-4921-b26a-ae1bbcea6b6e" />
<img width="1622" height="1188" alt="Screenshot at Aug 22 11-25-00" src="https://github.com/user-attachments/assets/577cd3e3-8b71-4dbf-ac2e-5e9a227f2497" />
<img width="1624" height="1195" alt="Screenshot at Aug 22 11-24-49" src="https://github.com/user-attachments/assets/40f2798f-4a93-4789-b34a-9c68ee21f8b1" />
<img width="1627" height="1193" alt="Screenshot at Aug 22 11-24-36" src="https://github.com/user-attachments/assets/3f7a5ed9-c469-445e-a51d-5286721ec450" />
<img width="1627" height="1190" alt="Screenshot at Aug 22 11-24-06" src="https://github.com/user-attachments/assets/da1968c5-ec72-400c-8a08-fbee12e4348b" />

---

## Table of contents
- [Why this project](#why-this-project)
- [Two looks — pick your vibe](#two-looks--pick-your-vibe)
- [Run it](#run-it)
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Technologies used](#technologies-used)
- [Code deep-dive](#code-deep-dive)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Fork & contribute](#fork--contribute)
- [Ideas for new features](#ideas-for-new-features)
- [License](#license)

---

## Why this project

Familiars is a **hands-on AI-agent teaching project** wrapped in a toy you can play with. It exercises the hard parts of agent engineering — persistent state, time-driven simulation, memory with a retention policy, personality modeling, hybrid rule+LLM intelligence, reward loops, and autonomous behavior — all in ~3,700 lines of dependency-free vanilla JavaScript.

The core insight: **an agent's "brain" is just pure functions over a state object.** Everything that feels alive in Familiars — the pet that naps, leaves you a note, and hides your keys while you're gone — is a small, deterministic rule engine composed with a mutable state model. No magic.

---

## Two looks — pick your vibe

- **Sunny Side Up (default)** — warm cream + flat color blobs, sticker cards, chunky buttons.
- **🧊 Brain Freeze** — click the **Pixel** button in the header to freeze everything into shiny retro **pixel art**: a cold icy palette, square corners, hard pixel shadows, and the "Press Start 2P" pixel font. Your choice is remembered across refreshes.

---

## Run it

There's **no build step and no backend**. Two options:

```bash
# Option A — just open the file
open index.html

# Option B — serve the folder (recommended for the nicest experience)
python3 -m http.server 8080
# then visit http://localhost:8080
```

> Everything runs in the browser and every byte of data lives in the visitor's own `localStorage` — there is no server, no database, and no tracking.

---

## What it does

### Shelter & adoption
- **Catalog** — browse 22 fictional AI pets across 6 types (Mystic, Digital, Mech, Pocket, Void, Aqua) and 5 rarities, with a filter bar.
- **Profiles** — click any pal for traits, stats, personality, and a full backstory.
- **Adoption** — name your pal, add yourself as adopter, leave a note, and welcome them home.

### The simulator (`engine.js`)
Each pet has its own **persistent state**: name, adopter, needs (hunger / energy / boredom / loneliness), happiness, mood, a **relationship** with you (XP + level: Stranger → … → Best Friend), and a capped list of **memories**.

- **Daily lifecycle** — a live ticker makes pets get hungry, tired, bored, and lonely over time, exactly like a real companion. Care actions counteract it.
- **Mood engine** — mood is computed from needs + happiness (Needs care → Thrilled) and drives the chat voice.
- **Care actions** — 🍖 Feed, 🎾 Play, 🤲 Pet, 💤 Nap, plus Chat. Each changes stats, generates memories, and earns relationship XP. Feed refills hunger; play drains energy and is blocked when exhausted.
- **Memories** — significant moments (first adoption, meals, play, "I love you", praise, naps) are stored, timestamped, and shown on the dashboard.

### Autonomy — pets live on their own
Pets don't just wait for you. Each has a **personality trait profile** (derived from its archetype) and, while you're away, runs its own autonomous life:
- Get **hungry**, **nap**, get **bored**, feel **lonely**, get **curious** (investigate things, ask questions), burst with **excitement**, get **annoyed** (gruff pets), cause **mischief** (mischievous pets hide your keys), feel **anxious** (anxious pets check if you're still around), go **dreamy**, and **discover** things — some behaviors form durable memories.
- **Notes** — pets occasionally leave personality-flavored notes ("fine, I missed you. don't make it weird.").
- **Learned preferences** — repeated interactions (what you play, feed, and pet) and self-behaviors build up a `preferences` map that shows up as 💚/💔 tags on their card.
- **Activity feed** — a "What your pals got up to while you were away" feed shows a combined, newest-first log of everything your pets did on their own, with each pet's avatar and time-ago. It's in the **Activity** section (also linked in the nav).
- **Personality badges** — each pet's archetype (Exuberant / Serene / Curious / Gruff / Ethereal) is tagged on its card so their differences are visible at a glance.

Every autonomous action is persisted, so when you come back after a long absence you can see exactly what your pets got up to.

### Chat (`Chat` button on any pal)
A real conversational interface. The pet responds according to its **personality** (one of 5 archetypes — exuberant / serene / curious / gruff / ethereal — with per-pet voice lines and favorites), **remembers previous interactions** (recalls memories, references past adventures), and reacts to its current needs and mood. Typing indicator, quick-chips, relationship status, and an engine badge (local/AI) live in the chat modal.

**Two chat engines:**
- **Local engine** (default, always works offline) — a deterministic rule-based AI for ~15 intents (greeting, how-are-you, play, feed, sleep, feelings, memory recall, compliments, "I love you", name, favorites, open chat…).
- **LLM engine** (optional) — wire in **any OpenAI-compatible endpoint** via the **AI button** in the header. Enter your Base URL, API key (optional — local servers like Ollama don't need one), model, temperature, and max tokens. Presets included for OpenAI, Ollama, LM Studio, Groq, and OpenRouter. The pet's full personality, current needs, relation, and memories are injected as the system prompt so the model stays in character and remembers the pet's life. The previous few messages are also sent for context. If the endpoint is unreachable or unconfigured, the chat **gracefully falls back to the local engine**.

### My Sanctuary dashboard
Each card shows the pal's **mood**, a **relationship bar** with level + XP progress, live **need/happiness bars**, **recent memories** (with time-ago stamps), a summary strip of the whole sanctuary, and all care + chat controls.

### Persistence
Everything is saved to `localStorage` and survives refreshes. Old v1 adoptions are automatically migrated into the simulator format on first load.

---

## Architecture

Familiars follows a strict **state → logic → UI** separation. The *agent* lives in pure modules with no DOM access; the *host* (UI) renders them.

```
┌────────────────────────────────────────────────────────────┐
│                         app.js (UI host)                    │
│  catalog · adoption · sanctuary · feed · chat · settings    │
│  ticker loop (setInterval) · renderers · localStorage IO    │
└──────────────┬────────────────────────────┬────────────────┘
               │ reads / writes             │ renders
               ▼                            ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│      engine.js (the brain)   │   │      personas.js          │
│  freshState · tick · mood    │   │  archetypes + per-pet     │
│  doCare · memories · chat    │   │  voice, likes, traits     │
│  autonomy · preferences      │   │                          │
└──────────────┬───────────────┘   └────────────┬─────────────┘
               │ state                            │ personality
               ▼                                 ▼
┌────────────────────────────────────────────────────────────┐
│   data.js  =  PALS (22 species) + PET_TYPES                 │
│   llm.js   =  optional OpenAI-compatible client + fallback  │
│   localStorage  =  pixelpals.sanctuary.v2 (pet state)       │
│                   + pixelpals.llm.v1 (AI config)            │
│                   + pixelpals.pixeltheme.v1 (theme)         │
└────────────────────────────────────────────────────────────┘
```

**Data flow at a glance:**

1. `app.js` boots → `loadSanctuary()` (with v1→v2 migration) → `bindEvents()` → `renderAll()`.
2. A `setInterval` ticker calls `engine.tick(pet, minutes)` for each pet every 5s, drifting needs and firing threshold events. A slower `autonomyPassAll()` runs autonomous behaviors on each pet's own clock.
3. Every user action (feed/play/pet/nap/chat) calls an `engine.*` function that mutates state and returns results; `app.js` re-renders and saves to `localStorage`.
4. Chat is either `engine.chatReply(...)` (local) or `llm.getReply(...)` (LLM) — both call `engine.applyChatEffects(state)` so the sim updates identically either way.

---

## Technologies used

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **Vanilla JavaScript (ES6+)** | Zero build step, no framework lock-in; ideal for teaching agent fundamentals |
| Markup | **HTML5** (semantic, ARIA) | Accessible by default |
| Styling | **CSS3** (custom properties, animations, responsive) | Flat, fun, dependency-free theming with two toggleable themes |
| Fonts | **Google Fonts** — Outfit, Nunito, Press Start 2P | Playful UI + retro pixel font for Brain Freeze mode |
| LLM | **OpenAI-compatible Chat Completions** (`fetch`) | Works with OpenAI, Ollama, LM Studio, Groq, OpenRouter, vLLM, Together… |
| Storage | **localStorage** | Zero-backend persistence |
| Sim engine | **Custom deterministic rule engine** | Predictable, testable agent "brain" |
| Testing | **Node `vm` harnesses + Playwright (headless Chromium)** | Logic-level + full-browser E2E checks |

**Not used (by design):** no React/Vue/Svelte, no bundler, no npm runtime deps, no backend server, no database, no build step. The only external dependency is Google Fonts (and an optional LLM endpoint you supply yourself).

---

## Code deep-dive

### 1. The state model — everything hangs off this

Pets are plain objects with a fixed shape. Needs are 0–100, mood is *derived* (never stored), and relationship XP maps to levels.

```js
// engine.js — freshState()
function freshState(pal, opts) {
  return {
    id: pal.id,
    name: opts.petName || pal.name,
    adopter: opts.adopterName || "A friend",
    adoptedOn: now,
    lastTick: now,
    // needs (0-100)
    happiness: pal.baseHappiness != null ? pal.baseHappiness : 65,
    energy:     pal.baseEnergy != null ? pal.baseEnergy : 65,
    hunger:     20 + Math.random() * 20,   // 0 full .. 100 starving
    boredom:    15 + Math.random() * 15,
    loneliness: 10 + Math.random() * 15,
    // relationship
    xp: 0, love: 40, chatCount: 0, careCount: 0,
    // memories (capped, importance-ranked)
    memories: [ /* ... */ ],
    // autonomy
    activityFeed: [],  preferences: {},
    lastAutonomy: now, lastNoteAt: 0,
  };
}
```

### 2. The tick — agents act over time, not just on input

The `tick(minutes)` signature is the key abstraction. It makes the whole simulation **deterministic and fast-forwardable**, which is what makes it testable.

```js
function tick(state, minutes, events) {
  state.hunger     = clamp(state.hunger     + TUNE.hungerPerMin  * minutes, 0, 100);
  state.energy     = clamp(state.energy     - TUNE.energyPerMin  * minutes, 0, 100);
  state.boredom    = clamp(state.boredom    + TUNE.boredPerMin   * minutes, 0, 100);
  state.loneliness = clamp(state.loneliness + TUNE.lonelyPerMin  * minutes, 0, 100);
  state.happiness  = clamp(state.happiness  - TUNE.happyDrift    * minutes, 0, 100);
  // ... threshold events push into `events`
}
```

### 3. Personality = parameters, not hardcoded lines

Each archetype has a trait profile; autonomy rolls against these weights, modulated by needs and time away. Two pets share **one** behavior system but live completely different lives.

```js
const TRAIT_PROFILES = {
  exuberant: { curious: .5, playful: .9, excited: .9, mischievous: .4, restless: .6, affectionate: .4, anxious: .1, annoyed: .2 },
  curious:   { curious: .95, playful: .5, excited: .5, mischievous: .3, restless: .4, affectionate: .3, anxious: .3, annoyed: .2, discoverer: .9 },
  gruff:     { curious: .3, playful: .3, excited: .2, mischievous: .5, restless: .2, affectionate: .3, anxious: .2, annoyed: .8 },
  // ...
};
```

### 4. Memory with a retention policy

Memories are a **capped, importance-ranked list** — the same pattern behind RAG and long-term memory:

```js
function addMemory(state, type, text, importance) {
  state.memories.push({ type, text, when: Date.now(), importance: importance || 50 });
  state.memories.sort((a, b) => b.importance - a.importance || b.when - a.when);
  if (state.memories.length > TUNE.memoryCap) state.memories.length = TUNE.memoryCap;
}
```

### 5. Hybrid intelligence with graceful fallback

The app decides between two "brains" behind a single interface, and **falls back to local on any failure**:

```js
// app.js — sendChat()
const cfg = llm.loadConfig();
if (llm.isUsable(cfg)) {
  doLLM();                                   // calls the endpoint
} else {
  setTimeout(doLocal, 500 + Math.random() * 400);   // deterministic rule engine
}
// in doLLM: on any error → toast + doLocal()
```

And `llm.getReply()` decides "usable" sensibly: a cloud endpoint needs an API key, but a local server (`localhost`) doesn't:

```js
function isUsable(cfg) {
  if (!c.enabled) return false;
  if (!normalizeUrl(c.baseUrl)) return false;
  if (!c.model) return false;
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local/.test(c.baseUrl);
  if (isLocal) return true;                 // no key needed
  if (c.apiKey && c.apiKey.trim()) return true;
  return false;
}
```

### 6. Autonomy — emergent "aliveness" from small weighted rolls

Each autonomous behavior is a simple weighted roll that pushes to the feed, sometimes forms a memory, and nudges needs:

```js
// A mischievous pet occasionally causes trouble
if (traits.mischievous > 0.4 && roll(traits.mischievous, timeMult * 0.6)) {
  pushActivity(state, "mischief", "🦹",
    `${name} hid your ${pick(["keys","sock","pen","headphones","favorite mug"])}. It's a secret now.`);
  addMemory(state, "mischief", `${state.name} got up to a little mischief while ${state.adopter} was away.`, 50);
}
```

The pet *feels* alive not because any one system is smart, but because **many weak signals compose**: needs drift + mood + personality weights + memory + autonomy + feed.

---

## Testing

Because the brain is pure functions, it's testable without a browser:

```js
// Logic-level: fast-forward 240 "game minutes" and assert behavior
const st = engine.freshState(pal, { petName: "Nova", adopterName: "Sam" });
st.hunger = 90; st.boredom = 80;
engine.autonomyPass(st, pal, persona, 240);
assert(st.activityFeed.length > 0);   // the pet did something on its own
```

And full-browser E2E via Playwright headless Chromium checks the whole flow — adoption → chat (local *and* LLM against a mock endpoint) → autonomy → feed rendering — asserting **zero console/page errors** and no horizontal overflow.

> For a one-file-static-site project we intentionally kept tests as scripts rather than a framework, but the principle — *test the brain independent of the UI* — is exactly how production agents are built.

---

## Project structure

```
.
├── index.html      # Markup shell: catalog, sanctuary, feed, modals, AI settings
├── styles.css      # Flat "Sunny Side Up" theme + Brain Freeze pixel theme
├── data.js         # PALS (22 species) + PET_TYPES
├── personas.js     # Personality archetypes + per-pet voice/likes/traits
├── engine.js       # THE BRAIN: state, tick, mood, memories, chat, autonomy
├── llm.js          # OpenAI-compatible client + config + fallback
├── app.js          # UI host: renderers, ticker, events, persistence
├── README.md       # You are here
└── blog.md         # Companion technical write-up (see below)
└── x-thread.md     # Two-tweet X thread about the project
└── linkedin.md     # LinkedIn post about the project
```

> There's also a full developer write-up in [`blog.md`](./blog.md) covering the architecture and agent-engineering lessons, plus ready-to-post [`x-thread.md`](./x-thread.md) and [`linkedin.md`](./linkedin.md) if you want to share the project.

---

## Fork & contribute

This is a deliberately simple codebase — you can read the whole thing in an afternoon. Here's how to dive in.

### Getting started

```bash
git clone <your-fork-url>
cd one-line-agent-ideas
python3 -m http.server 8080
# open http://localhost:8080
```

No install, no build. Just edit, refresh, repeat.

### Suggested workflow for a first contribution

1. **Find something to fix or add** (see [ideas below](#ideas-for-new-features)) and open an issue first to discuss it.
2. **Branch off `main`:** `git checkout -b feat/my-cool-pet`.
3. **Make the change.** The pattern is almost always: add data in `data.js` / `personas.js`, add logic in `engine.js`, render it in `app.js`, style it in `styles.css`.
4. **Test:** run the Node logic harness for `engine.js` changes, and (if you can) the Playwright E2E. At minimum confirm the page loads with no console errors.
5. **Open a PR** with a clear description and, if visual, a screenshot.

### Contribution guidelines

- Keep the **zero-dependency, no-build** philosophy. New features should work by opening `index.html`.
- Keep **state and logic out of the DOM** — put behavior in `engine.js`, keep `app.js` thin.
- **Clamp all stat values** 0–100; compute derived values (like mood) rather than storing them.
- **Preserve the flat, gradient-free design language** (or the pixel theme), whichever you extend.
- Add/update **tests** for any new engine behavior.
- Update this README if you change structure or add a notable feature.

---

## Ideas for new features

Here are concrete, well-scoped features — each is a great first PR:

- **Schedules & rituals** — pets that nap at the same time each day, or get extra-hungry at meal times, using real wall-clock hours in `tick()`.
- **Multi-pet interactions** — pets that play with or annoy *each other*, not just the player (add a `pairInteraction` pass to the autonomy ticker).
- **Pet-to-pet / broadcast messages** — an in-app "mailbox" where pets occasionally ping you (requires reworking the chat to support async-initiated messages).
- **A persistence export/import** — a "download your sanctuary" button (JSON) and a restore option, so pets survive across devices.
- **More archetypes & behaviors** — add archetypes like `heroic`, `lazy`, `competitive`, or new autonomy behaviors (e.g. a `hoarder` trait).
- **Daily rewards & streaks** — log-in streak and a small daily reward to keep the relationship loop sticky.
- **Sound design** — WebAudio chimes for events (care, adoption, level-up, pet-initiated messages), respecting a mute toggle.
- **Accessibility pass** — keyboard-only flows, `prefers-reduced-motion` to tone down animations, and better focus management in modals.
- **Progressive Web App** — a manifest + service worker to make Familiars installable and fully offline.
- **Profile share cards** — generate a shareable image/text card of your favorite pet's stats.

---

## License

This project is released for learning and experimentation. All creatures are imaginary, and all data lives only in the visitor's own browser.
