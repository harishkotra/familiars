/* Familiars LLM integration — OpenAI-compatible chat completions.
 *
 * Lets the user point the chat at any OpenAI-compatible inference endpoint
 * (OpenAI, local Ollama, LM Studio, Groq, OpenRouter, Together, vLLM, etc.)
 * by editing their base URL / API key / model name. The pet's personality,
 * mood, needs, relationship and memories are injected as the system prompt so
 * the model stays in character and "remembers" the pet's life.
 *
 * If the endpoint is unreachable or unconfigured, the app falls back to the
 * deterministic local engine, so the site always works.
 */

(function (global) {
  "use strict";

  const CONFIG_KEY = "pixelpals.llm.v1";
  const DEFAULT_CONFIG = {
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.9,
    maxTokens: 200,
    systemBoost: 0, // extra push toward in-character roleplay
  };

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
    catch (e) {}
  }

  function normalizeUrl(u) {
    if (!u) return "";
    return String(u).replace(/\/+$/, "");
  }

  // Is the config genuinely usable to attempt a call?
  // AI chat is "enabled" by default, but we only actually call the LLM once
  // the details make it capable: a base URL + model, plus either an API key
  // or a local (keyless) server like Ollama / LM Studio.
  function isUsable(cfg) {
    const c = cfg || loadConfig();
    if (!c.enabled) return false;
    if (!normalizeUrl(c.baseUrl)) return false;
    if (!c.model) return false;
    const host = normalizeUrl(c.baseUrl);
    const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local/.test(host);
    if (isLocal) return true;          // local servers need no key
    if (c.apiKey && c.apiKey.trim()) return true;
    return false;
  }

  /* Build the system prompt that keeps the LLM "in character" as this pet. */
  function buildSystemPrompt(pet, pal, persona, engine, rel) {
    const mood = engine.computeMood(pet);
    const likes = (persona.likes || []).slice(0, 3).join(", ") || "spending time with you";
    const catchphrases = (persona.catchphrases || []).slice(0, 2);
    const memories = (pet.memories || [])
      .slice(0, 5)
      .map((m) => `- ${m.text} (${new Date(m.when).toLocaleDateString()})`)
      .join("\n") || "none yet";

    return [
      `You are playing the role of ${pet.name}, a ${pal.species} in the fictional Familiars AI pet simulator.`,
      `You were adopted by ${pet.adopter}. Speak as yourself in first person, in the voice of a beloved fictional AI pet.`,
      ``,
      `PERSONALITY: ${persona.archetype} archetype.`,
      `LIKES: ${likes}.`,
      catchphrases.length ? `CATCHPHRASES (use sparingly): ${catchphrases.join("; ")}.` : "",
      ``,
      `CURRENT STATE (NEEDS are 0-100: LOWER hunger is better, LOWER boredom/loneliness is better, energy is stamina):`,
      `  Mood: ${mood.label} (${Math.round(pet.happiness)}/100 happiness).`,
      `  Hunger: ${Math.round(pet.hunger)} (0 = full). Energy: ${Math.round(pet.energy)}. Boredom: ${Math.round(pet.boredom)} (lower better). Loneliness: ${Math.round(pet.loneliness)} (lower better).`,
      ``,
      `RELATIONSHIP with ${pet.adopter}: level ${rel.level}, "${engine.relLabel(rel.level)}". You care about them and it shows.`,
      ``,
      `MEMORIES (things you remember together):`,
      `${memories}`,
      ``,
      `STYLE RULES:`,
      `- Reply in 1-3 short sentences, in casual first-person. Sound genuinely alive, warm, and in character.`,
      `- Reference your needs naturally (e.g. "I could really use a snack" if hungry, "I'm sleepy" if tired, "I'm a bit lonely" if lonely, "I'm bored, let's goof off" if bored).`,
      `- Occasionally reference a relevant memory from MEMORIES if it fits.`,
      `- If asked about yourself, use the above facts. Be consistent and never break character to say you're an AI when the user is chatting casually.`,
      `- A little playful, a little quirky — you are a fun fictional pet, not a stiff assistant.`,
    ].filter(Boolean).join("\n");
  }

  /* Build the request messages: system + recent chat history (persisted) + user. */
  function buildMessages(opts) {
    const { pet, pal, persona, engine, rel, history, user } = opts;
    const messages = [{ role: "system", content: buildSystemPrompt(pet, pal, persona, engine, rel) }];
    (history || []).slice(-10).forEach((h) => {
      messages.push({ role: h.role === "pet" ? "assistant" : "user", content: h.text });
    });
    messages.push({ role: "user", content: user });
    return messages;
  }

  // Central chat-flavored wrapper used by the app. Returns { reply, source }
  // where source is "llm" or "local".
  async function getReply(opts) {
    const cfg = opts.config || loadConfig();
    if (!isUsable(cfg)) return null; // caller falls back to local

    const messages = buildMessages(opts);
    const body = {
      model: cfg.model,
      messages,
      temperature: cfg.temperature != null ? cfg.temperature : 0.9,
      max_tokens: cfg.maxTokens || 200,
      stream: false,
    };

    let res;
    try {
      res = await fetch(normalizeUrl(cfg.baseUrl) + "/chat/completions", {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json" },
          cfg.apiKey ? { Authorization: "Bearer " + cfg.apiKey.trim() } : {}
        ),
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { error: "NetworkError: " + err.message };
    }

    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = (j && j.error && (j.error.message || j.error.code)) || "";
      } catch (e) {}
      return { error: "HTTP " + res.status + (detail ? ": " + detail : "") };
    }

    let data;
    try { data = await res.json(); }
    catch (e) { return { error: "Invalid JSON response" }; }

    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return { error: "No content in response" };
    return { reply: text.trim(), source: "llm" };
  }

  global.__pixelLLM = {
    loadConfig,
    saveConfig,
    isUsable,
    buildSystemPrompt,
    buildMessages,
    getReply,
    DEFAULT_CONFIG,
  };
})(typeof window !== "undefined" ? window : globalThis);
