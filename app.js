/* Familiars app — UI layer on top of engine.js.
 *
 * Responsibilities:
 *   - load/migrate/save persistent pet state (localStorage)
 *   - run the live lifecycle ticker (engine.tick) on a heartbeat and on load
 *   - render catalog, adoption flow, sanctuary dashboard, and chat
 *   - wire all user interactions to the engine
 */

(function () {
  "use strict";

  const STORAGE_KEY = "pixelpals.sanctuary.v2";
  const LEGACY_KEY = "pixelpals.sanctuary.v1";
  const engine = window.__pixelEngine;
  const llm = window.__pixelLLM;
  const TICK_MS = 5000;      // heartbeat
  const SIM_MINUTES_PER_TICK = 10;  // each heartbeat advances the sim 10 game-minutes
  const REFRESH_INTERVAL = 6000;    // dashboard stat re-render cadence (cheap)

  let sanctuary = [];
  let activeFilter = "all";
  let chatPetId = null;

  /* ---------- DOM helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  /* ---------- Persistence (with legacy migration) ---------- */

  function loadSanctuary() {
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch (e) { legacy = null; }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { saved = null; }

    if (saved && Array.isArray(saved)) return saved;

    // No v2 yet — migrate any v1 adoption records into engine state.
    if (legacy && Array.isArray(legacy)) {
      const migrated = legacy.map((old) => {
        const pal = palById(old.id);
        if (!pal) return null;
        const st = engine.freshState(pal, { petName: old.name, adopterName: old.adopter, note: old.note || "" });
        st.adoptedOn = old.adoptedOn || Date.now();
        st.lastTick = Date.now();
        // Carry over old base stats.
        st.happiness = old.happiness != null ? old.happiness : st.happiness;
        st.love = old.love != null ? old.love : 40;
        st.xp = 0;
        return st;
      }).filter(Boolean);
      try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
      return migrated;
    }
    return [];
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanctuary)); }
    catch (e) { /* private mode / quota — non-fatal */ }
  }

  /* ---------- Lookups ---------- */

  function palById(id) { return PALS.find((p) => p.id === id); }
  function ownedPet(id) { return sanctuary.find((p) => p.id === id); }
  function isAdopted(id) { return sanctuary.some((p) => p.id === id); }
  function typeInfo(typeId) { return PET_TYPES.find((t) => t.id === typeId) || { label: typeId, icon: "✨" }; }
  function personaFor(id) { return window.personaFor(id); }
  const clamp = engine.clamp;

  /* ---------- Toast ---------- */

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------- Lifecycle ticker ---------- */

  function advanceSimAll() {
    const alerts = [];
    sanctuary.forEach((pet) => {
      // Just compute minutes since lastTick once per pet.
      const ms = Date.now() - (pet.lastTick || pet.adoptedOn);
      const minutes = Math.min(720, Math.max(0, ms / 60000));
      engine.tick(pet, minutes, alerts);
      pet.lastTick = Date.now();
    });
    if (alerts.length) {
      const recent = alerts.slice(-1)[0];
      if (recent) toast(`${recent.text.slice(0, 60)}`);
    }
    save();
  }

  // Run autonomous behavior passes for all pets, throttled so they don't
  // flood. Each pet lives on its own clock (lastAutonomy).
  function autonomyPassAll() {
    let changed = false;
    const now = Date.now();
    sanctuary.forEach((pet) => {
      const pal = palById(pet.id);
      if (!pal) return;
      const persona = personaFor(pet.id);
      const since = (now - (pet.lastAutonomy || pet.adoptedOn)) / 60000;
      // autonomy runs roughly every ~20-40 min of sim time; only when enough
      // time has passed AND the tab is open (so it feels alive, not flooding).
      if (since >= 25 && since <= 720) {
        const acts = engine.autonomyPass(pet, pal, persona, since);
        if (acts && acts.length) changed = true;
      }
    });
    if (changed) save();
  }

  function startTicker() {
    setInterval(() => {
      advanceSimAll();
      autonomyPassAll();
      if (!document.hidden) {
        renderSanctuary();
        renderFeed();
      }
    }, TICK_MS);
    setInterval(() => {
      if (document.readyState === "complete" && !document.hidden) {
        if (chatPetId) renderChatPetStatus();
      }
    }, REFRESH_INTERVAL);
  }

  /* ---------- Rendering: filters + catalog ---------- */

  function renderFilters() {
    const wrap = $("#filterChips");
    const chips = [
      { id: "all", label: "All" },
      ...PALS.map((p) => ({ id: p.rarity, label: p.rarity })),
    ];
    const seen = new Set();
    const uniq = chips.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    wrap.innerHTML = uniq
      .map((c) => `<button class="chip ${c.id === activeFilter ? "active" : ""}" data-filter="${c.id}" role="tab" aria-selected="${c.id === activeFilter}">${c.label}</button>`)
      .join("");
  }

  function renderCatalog() {
    const grid = $("#catalogGrid");
    const list = PALS.filter((p) => activeFilter === "all" || p.rarity === activeFilter);
    const empty = $("#catalogEmpty");

    grid.innerHTML = list
      .map((p) => {
        const adopted = isAdopted(p.id);
        const t = typeInfo(p.type);
        const adoptedChip = adopted ? `<span class="adopted-chip">✓ Adopted</span>` : "";
        return `
          <article class="pet-card ${adopted ? "adopted" : ""}" data-id="${p.id}" tabindex="0" role="button" aria-label="View ${p.name}">
            <span class="rarity-tag rarity-${p.rarity}">${p.rarity}</span>
            ${adopted ? adoptedChip : `<span class="type-icon" title="${t.label}">${t.icon}</span>`}
            <div class="emoji-holder">${p.emoji}</div>
            <h3>${p.name}</h3>
            <div class="species">${p.species}</div>
            <p class="blurb">${p.blurb}</p>
            ${adopted ? `<p class="fee">Already yours 💛</p>` : `<p class="fee">Rescue fee: <small>${p.rescueFee === 0 ? "Free" : p.rescueFee + " Pals"}</small></p>`}
          </article>`;
      })
      .join("");

    empty.hidden = list.length > 0;
    const total = $("#statTotal");
    if (total) total.textContent = PALS.length;
  }

  /* ---------- Profile + adoption modals ---------- */

  function openProfile(pal) {
    const t = typeInfo(pal.type);
    const adopted = isAdopted(pal.id);
    const backdrop = $("#adoptModal");
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${pal.name} profile">
        <button class="modal-close" data-close aria-label="Close">×</button>
        <div class="profile-head">
          <div class="profile-emoji">${pal.emoji}</div>
          <div>
            <h3>${pal.name}</h3>
            <div class="species">${pal.species}</div>
            <div class="type">${t.icon} ${t.label} · <span class="rarity-${pal.rarity}" style="text-transform:capitalize">${pal.rarity}</span></div>
          </div>
        </div>
        <div class="profile-sect"><p>${pal.blurb}</p></div>
        <div class="profile-sect">
          <h4>Traits</h4>
          <div class="profile-traits">${pal.traits.map((tr) => `<span class="trait">${tr}</span>`).join("")}</div>
        </div>
        <div class="profile-sect">
          <h4>Backstory</h4>
          <p>${pal.backstory}</p>
        </div>
        <div class="profile-sect">
          <h4>Stats</h4>
          <div class="profile-stats">
            ${miniStatBar("Happiness", pal.baseHappiness)}
            ${miniStatBar("Energy", pal.baseEnergy)}
            ${miniStatBar("Appetite", pal.baseAppetite)}
          </div>
        </div>
        <div class="modal-actions">
          ${adopted
            ? `<button class="btn btn-primary btn-block" data-close>It's already yours 💛</button>`
            : `<button class="btn btn-primary btn-block" data-adopt="${pal.id}">Adopt ${pal.name}${pal.rescueFee ? " · " + pal.rescueFee + " Pals" : ""}</button>`}
        </div>
      </div>
    `;
    backdrop.hidden = false;
  }

  function miniStatBar(label, value) {
    return `
      <div class="stat-row">
        <span class="label">${label}</span>
        <div class="stat-track"><div class="stat-fill" style="width:${value}%"></div></div>
        <span class="pct">${value}</span>
      </div>`;
  }

  function openAdopt(pal) {
    const backdrop = $("#adoptModal");
    const t = typeInfo(pal.type);
    backdrop.innerHTML = `
      <div class="modal adopt-modal" role="dialog" aria-modal="true" aria-labelledby="adoptTitle">
        <button class="modal-close" data-close aria-label="Close">×</button>
        <div class="adopt-head">
          <div class="adopt-portrait">${pal.emoji}</div>
          <div>
            <h3 id="adoptTitle">Adopt ${pal.name}</h3>
            <p class="adopt-species">${t.icon} ${pal.species} · ${pal.rarity}</p>
          </div>
        </div>
        <form id="adoptForm">
          <label for="petName">Your pal's new name</label>
          <input id="petName" name="petName" type="text" maxlength="20" placeholder="e.g. Nova" required />
          <label for="adopterName">Your name (the adopter)</label>
          <input id="adopterName" name="adopterName" type="text" maxlength="24" placeholder="e.g. Sam" required />
          <label for="adoptNote">A note for your pal (optional)</label>
          <textarea id="adoptNote" name="adoptNote" rows="3" maxlength="140" placeholder="Why did you pick them?"></textarea>
          <button type="submit" class="btn btn-primary btn-block">Adopt & welcome home 💛</button>
        </form>
      </div>
    `;
    backdrop.hidden = false;
    window.__pendingPal = pal;
    $("#petName").focus();
  }

  function confirmAdoption(pal, data) {
    const st = engine.freshState(pal, {
      petName: data.petName.trim() || pal.name,
      adopterName: data.adopterName.trim() || "A friend",
      note: data.note.trim(),
    });
    sanctuary.push(st);
    save();
    renderAll();
    closeModals();
    showPromo(st);
  }

  function showPromo(pet) {
    const backdrop = $("#promoBackdrop");
    $("#promoArt").textContent = palById(pet.id).emoji;
    $("#promoText").textContent = `${pet.name} has been adopted by ${pet.adopter}! They're waiting in your sanctuary. Say hi and start building your bond.`;
    backdrop.hidden = false;
  }

  /* ---------- Sanity helpers for dashboard ---------- */

  function statBar(label, value, gradient) {
    const cls = value < 30 ? "low" : value < 62 ? "mid" : "";
    const fill = gradient ? `background:var(--happy)` : "";
    return `
      <div class="stat-row">
        <span class="label">${label}</span>
        <div class="stat-track"><div class="stat-fill ${cls}" style="width:${value}%;${fill}"></div></div>
        <span class="pct">${Math.round(value)}</span>
      </div>`;
  }

  function needBar(label, value, invert) {
    // Need bars: low value = good. Show as a fill sized by (100-value) so a
    // satisfied pet shows a full bar, and invert semantics for clarity.
    const pct = invert ? value : 100 - value;
    const cls = pct < 30 ? "low" : pct < 60 ? "mid" : "";
    return `
      <div class="stat-row">
        <span class="label">${label}</span>
        <div class="stat-track"><div class="stat-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="pct">${Math.round(value)}</span>
      </div>`;
  }

  function memoryListHtml(pet) {
    const mems = (pet.memories || []).slice(0, 3);
    if (!mems.length) return `<p class="san-mem-empty">No memories yet — chat with ${pet.name} or spend time together to make some.</p>`;
    return mems.map((m) => {
      const when = timeAgo(m.when);
      const icon = { first: "🏡", food: "🍖", fun: "🎾", affection: "💛", praise: "🏆", rest: "💤", lose: "🙈", upset: "💔", suggest: "✨" }[m.type] || "🧠";
      return `<li class="san-mem"><span>${icon}</span><div><p>${m.text}</p><time>${when}</time></div></li>`;
    }).join("");
  }

  function timeAgo(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "yesterday" : `${d}d ago`;
  }

  function relBarHtml(pet) {
    const rel = engine.relationship(pet);
    const pct = Math.min(100, Math.round((rel.xpInLevel / rel.xpForNext) * 100));
    const icon = engine.relTierIcon(rel.level);
    return `
      <div class="rel-row">
        <span class="rel-icon">${icon}</span>
        <div>
          <p class="rel-name">${engine.relLabel(rel.level)}</p>
          <div class="stat-track"><div class="stat-fill rel-fill" style="width:${pct}%"></div></div>
          <span class="rel-xp">Level ${rel.level} · ${rel.xpInLevel}/${rel.xpForNext} XP</span>
        </div>
      </div>`;
  }

  /* ---------- Rendering: sanctuary dashboard ---------- */

  function renderSanctuary() {
    const grid = $("#sanctuaryGrid");
    const empty = $("#sanctuaryEmpty");
    const tagline = $("#sanctuaryTagline");
    const summary = $("#sanctuarySummary");
    $("#sanctuaryCount").textContent = sanctuary.length;

    if (sanctuary.length === 0) {
      grid.innerHTML = "";
      empty.hidden = false;
      summary.hidden = true;
      tagline.textContent = "Your adopted pals live here. Care for them and they'll love you back.";
      return;
    }
    empty.hidden = true;
    summary.hidden = false;
    $("#sumCount").textContent = sanctuary.length;
    $("#sumHappy").textContent = Math.round(sanctuary.reduce((a, p) => a + (p.happiness || 0), 0) / sanctuary.length);
    $("#sumLove").textContent = Math.round(sanctuary.reduce((a, p) => a + (p.love || 0), 0) / sanctuary.length);
    $("#sumMems").textContent = sanctuary.reduce((a, p) => a + (p.memories || []).length, 0);
    tagline.textContent = sanctuary.map((p) => p.name).join(", ") + " — welcome home, fam. 💛";

    grid.innerHTML = sanctuary.map((pet) => {
      const pal = palById(pet.id);
      if (!pal) return "";
      const mood = engine.computeMood(pet);
      const persona = personaFor(pet.id);
      const adoptedOn = new Date(pet.adoptedOn).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      return `
        <article class="sanctuary-card" data-id="${pet.id}">
          <div class="san-top" data-chat="${pet.id}" title="Open chat">
            <span class="san-emoji">${pal.emoji}</span>
            <div class="san-id">
              <h3>${pet.name} <span class="chat-pip" title="Chat">💬</span></h3>
              <div class="species">${pal.species}</div>
              <div class="san-adopter">Adopted by <b>${pet.adopter}</b></div>
            </div>
            <span class="mood-chip">${mood.icon} ${mood.label}</span>
          </div>
          <div class="san-persona"><span class="persona-badge">${personaTag(persona.archetype)}</span></div>
          ${pet.note ? `<p class="san-note">"${pet.note}"</p>` : ""}
          ${preferenceTagsHtml(pet)}
          <div class="adopted-on">Together since ${adoptedOn}</div>

          <div class="rel-block">
            <h5>Relationship</h5>
            ${relBarHtml(pet)}
          </div>

          <div class="san-stats">
            ${needBar("Hunger", pet.hunger, false)}
            ${needBar("Energy", pet.energy, true)}
            ${needBar("Boredom", pet.boredom, false)}
            ${needBar("Loneliness", pet.loneliness, false)}
            ${statBar("Happiness", pet.happiness, true)}
          </div>

          <div class="san-memories">
            <h5>Recent memories</h5>
            <ul>${memoryListHtml(pet)}</ul>
          </div>

          <div class="san-actions">
            <button class="action-btn" data-action="feed" title="Feed"><span class="icon">🍖</span>Feed</button>
            <button class="action-btn" data-action="play" title="Play"><span class="icon">🎾</span>Play</button>
            <button class="action-btn" data-action="pet" title="Pet"><span class="icon">🤲</span>Pet</button>
            <button class="action-btn" data-action="nap" title="Nap"><span class="icon">💤</span>Nap</button>
            <button class="action-btn chat-btn" data-action="chat" title="Chat"><span class="icon">💬</span>Chat</button>
          </div>
          <div class="san-tools">
            <button class="tool-btn" data-action="rename" title="Rename">✎ Rename</button>
            <button class="tool-btn danger" data-action="release" title="Release back to the shelter">Release</button>
          </div>
        </article>`;
    }).join("");
    renderRelationshipsOnLoad();
  }

  // Small helper to refresh relationship labels on dashboard after XP changes.
  function renderRelationshipsOnLoad() { /* relationship is already in relBarHtml */ }

  /* ---------- Care / actions ---------- */

  function doAction(pet, action) {
    if (action === "chat") { openChat(pet.id); return; }
    if (action === "rename") { renamePet(pet); return; }
    if (action === "release") { releasePet(pet); return; }
    if (action === "nap") {
      const before = pet.energy;
      engine.doCare(pet, "nap");
      engine.addMemory(pet, "rest", `${pet.name} took a cozy nap in the sunbeam.`, 40);
      save(); renderSanctuary();
      toast(`${pet.name} napped and gained energy (+${Math.round(pet.energy - before)}). 💤`);
      return;
    }
    const eff = engine.doCare(pet, action);
    if (!eff) {
      if (action === "play") toast(`${pet.name} is too tired to play right now. Try a nap or a snuggle. 🥱`);
      else toast(`That didn't seem to help right now.`);
      return;
    }
    const msgs = {
      feed: `${pet.name} was well fed! Hunger down. 🍖`,
      play: `You and ${pet.name} played — so much fun! 🎾`,
      pet: `${pet.name} snuggled closer. 💛`,
    };
    const mem = {
      feed: { text: `${pet.adopter} fed ${pet.name} a tasty meal.`, importance: 55 },
      play: { text: `${pet.name} and ${pet.adopter} played until they were happily worn out.`, importance: 70 },
      pet: { text: `${pet.adopter} gave ${pet.name} some gentle affection.`, importance: 60 },
    }[action];
    if (mem) engine.addMemory(pet, action === "pet" ? "affection" : action, mem.text, mem.importance);
    // Pets develop preferences from how you treat them.
    engine.learnPreference(pet, "interaction", action, action === "play" ? 2 : 1);
    save(); renderSanctuary();
    toast(msgs[action] || `Done!`);
  }

  function releasePet(pet) {
    if (!confirm(`Release ${pet.name} back to the shelter? They'll be available for someone else to adopt.`)) return;
    sanctuary = sanctuary.filter((p) => p.id !== pet.id);
    save(); renderAll();
    toast(`${pet.name} has been released kindly back to the shelter. 🌈`);
  }

  function renamePet(pet) {
    const name = prompt(`What should ${pet.name}'s new name be?`, pet.name);
    if (name === null) return;
    const clean = name.trim();
    if (!clean) { toast("Name can't be empty."); return; }
    pet.name = clean.slice(0, 20);
    save(); renderSanctuary();
    toast("Renamed! 🏷️");
  }

  /* ---------- Chat ---------- */

  function openChat(id) {
    chatPetId = id;
    const pet = ownedPet(id);
    if (!pet) return;
    const pal = palById(id);
    const t = typeInfo(pal.type);
    const backdrop = $("#chatModal");
    $("#chatAvatar").textContent = pal.emoji;
    $("#chatTitle").textContent = `${pet.name}`;
    $("#chatSub").textContent = `${t.icon} ${pal.species}`;
    $("#chatLog").innerHTML = "";
    renderChatPetStatus();
    openChatGreeting(pet, pal);
    backdrop.hidden = false;
    setTimeout(() => {
      const inp = $("#chatInput");
      if (inp) inp.focus();
    }, 50);
  }

  function closeChat() {
    chatPetId = null;
    $("#chatModal").hidden = true;
  }

  function renderChatPetStatus() {
    const pet = ownedPet(chatPetId);
    if (!pet) return;
    const rel = engine.relationship(pet);
    const mood = engine.computeMood(pet);
    $("#chatRel").textContent = `${engine.relTierIcon(rel.level)} ${engine.relLabel(rel.level)} · ${mood.icon}`;
    const cfg = llm.loadConfig();
    const badge = $("#chatEngineBadge");
    if (badge) {
      const us = llm.isUsable(cfg);
      badge.textContent = us ? "ai" : "local";
      badge.classList.toggle("on", !!us);
      badge.title = us ? `AI: ${cfg.model}` : "Local engine — add AI in settings";
    }
  }

  function chatBubble(text, from) {
    const id = "b" + Math.random().toString(36).slice(2, 9);
    const div = document.createElement("div");
    div.className = "chat-bubble " + from;
    div.dataset.bubble = id;
    div.innerHTML = text;
    $("#chatLog").appendChild(div);
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
    return id;
  }

  // Append an exchange to the pet's persisted chat history (LLM context source).
  function appendHistory(pet, role, text) {
    pet.chatHistory = pet.chatHistory || [];
    pet.chatHistory.push({ role, text, at: Date.now() });
    if (pet.chatHistory.length > 40) pet.chatHistory = pet.chatHistory.slice(-40);
    save();
  }

  function openChatGreeting(pet, pal) {
    const persona = personaFor(pet.id);
    const r = engine.chatReply(pet, "hi", pal, persona);
    appendHistory(pet, "pet", r.reply);
    save();
    renderChatPetStatus();
    renderSanctuary();
    chatBubble(r.reply, "pet");
  }

  function sendChat(text) {
    const pet = ownedPet(chatPetId);
    if (!pet) return;
    const pal = palById(chatPetId);
    const persona = personaFor(chatPetId);
    const user = text.trim();
    if (!user) return;

    chatBubble(escapeHtml(user), "user");
    appendHistory(pet, "user", user);

    // typing indicator
    const typingId = chatBubble('<span class="typing">…</span>', "pet");

    const finish = (replyText, bubble) => {
      if (bubble) bubble.innerHTML = replyText;
      appendHistory(pet, "pet", replyText);
      save();
      renderChatPetStatus();
      renderSanctuary();
      $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
    };

    // shared simulator side-effects for the LLM path only. The local engine's
    // chatReply ALREADY applies these internally, so it must not be double-applied.
    const applyState = () => engine.applyChatEffects(pet);

    const doLocal = () => {
      const typingBubble = $(`[data-bubble="${typingId}"]`);
      const r = engine.chatReply(pet, user, pal, persona);
      finish(r.reply, typingBubble);
    };

    let stateApplied = false;
    const doLLM = async () => {
      const typingBubble = $(`[data-bubble="${typingId}"]`);
      const cfg = llm.loadConfig();
      const rel = engine.relationship(pet);
      const res = await llm.getReply({
        config: cfg,
        pet, pal, persona, engine, rel,
        history: pet.chatHistory || [],
        user,
      });
      if (res && res.reply) {
        stateApplied = true;
        applyState();
        finish(res.reply, typingBubble);
        return "llm";
      }
      // fall back to local engine on any error
      if (res && res.error) {
        console.warn("[familiars] LLM failed, falling back to local:", res.error);
        toast("AI chat failed (" + res.error + ") — using local engine.");
      }
      doLocal();
      return "local";
    };

    const cfg = llm.loadConfig();
    if (llm.isUsable(cfg)) {
      doLLM();
    } else {
      // small delay for typing effect
      setTimeout(doLocal, 500 + Math.random() * 400);
    }
  }

  /* ---------- AI settings ---------- */

  const AI_PRESETS = {
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1", apikeyNote: "" },
    lmstudio: { baseUrl: "http://localhost:1234/v1", model: "qwen2.5-7b-instruct" },
    groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
    openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct" },
  };

  function openAiSettings() {
    const cfg = llm.loadConfig();
    $("#aiEnabled").checked = !!cfg.enabled;
    $("#aiBase").value = cfg.baseUrl || "";
    $("#aiKey").value = cfg.apiKey || "";
    $("#aiModel").value = cfg.model || "";
    $("#aiTemp").value = cfg.temperature != null ? cfg.temperature : 0.9;
    $("#aiTokens").value = cfg.maxTokens || 200;
    $("#aiTempOut").textContent = $("#aiTemp").value;
    $("#aiTokensOut").textContent = $("#aiTokens").value;
    $("#aiStatus").textContent = "";
    const ai = $("#aiModal");
    ai.hidden = false;
  }

  function saveAiSettings() {
    const cfg = llm.loadConfig();
    cfg.enabled = $("#aiEnabled").checked;
    cfg.baseUrl = $("#aiBase").value.trim();
    cfg.apiKey = $("#aiKey").value.trim();
    cfg.model = $("#aiModel").value.trim() || "gpt-4o-mini";
    cfg.temperature = parseFloat($("#aiTemp").value);
    cfg.maxTokens = parseInt($("#aiTokens").value, 10) || 200;
    llm.saveConfig(cfg);
    const st = $("#aiStatus");
    if (cfg.enabled && cfg.baseUrl && cfg.model) {
      st.textContent = "Saved — chat will use AI when each pal is opened. 🔌";
      st.className = "ai-note ok";
    } else if (cfg.enabled) {
      st.textContent = "Saved, but fill in a Base URL and Model to enable AI. (Local engine still works.)";
      st.className = "ai-note warn";
    } else {
      st.textContent = "Saved — chat uses the built-in local engine. ✨";
      st.className = "ai-note ok";
    }
    renderChatPetStatus();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- Modals ---------- */

  function closeModals() {
    $$(".modal-backdrop").forEach((m) => (m.hidden = true));
    chatPetId = null;
  }

  /* ---------- Event wiring ---------- */

  function bindEvents() {
    // Filters
    $("#filterChips").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      activeFilter = chip.dataset.filter;
      renderFilters();
      renderCatalog();
    });

    // Catalog
    $("#catalogGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".pet-card");
      if (!card) return;
      const pal = palById(card.dataset.id);
      if (!pal || isAdopted(pal.id)) return;
      openProfile(pal);
    });
    $("#catalogGrid").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".pet-card");
      if (!card) return;
      e.preventDefault();
      const pal = palById(card.dataset.id);
      if (pal && !isAdopted(pal.id)) openProfile(pal);
    });

    // Sanctuary
    $("#sanctuaryGrid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (btn) {
        const card = btn.closest(".sanctuary-card");
        const id = card && card.dataset.id;
        const pet = ownedPet(id);
        if (pet) doAction(pet, btn.dataset.action);
        return;
      }
      const head = e.target.closest(".san-top");
      if (head) {
        const card = head.closest(".sanctuary-card");
        if (card) openChat(card.dataset.id);
      }
    });

    // Modal actions (data-adopt / data-close)
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) { closeModals(); return; }
      const adoptBtn = e.target.closest("[data-adopt]");
      if (adoptBtn) {
        const pal = palById(adoptBtn.dataset.adopt);
        if (pal) openAdopt(pal);
        return;
      }
    });

    // Adoption form
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "adoptForm") return;
      e.preventDefault();
      const pending = window.__pendingPal;
      if (!pending) return;
      confirmAdoption(pending, {
        petName: $("#petName").value,
        adopterName: $("#adopterName").value,
        note: $("#adoptNote").value,
      });
    });

    // Chat form
    const chatForm = $("#chatForm");
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = $("#chatInput");
      sendChat(inp.value);
      inp.value = "";
    });

    // Quick chips
    $("#chatQuick").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-q]");
      if (!chip || !chatPetId) return;
      sendChat(chip.dataset.q);
    });

    // AI settings
    $("#navAi").addEventListener("click", openAiSettings);
    document.addEventListener("click", (e) => {
      const preset = e.target.closest("[data-preset]");
      if (!preset) return;
      const p = AI_PRESETS[preset.dataset.preset];
      if (!p) return;
      const cur = llm.loadConfig();
      cur.baseUrl = p.baseUrl;
      cur.model = p.model;
      $("#aiBase").value = p.baseUrl;
      $("#aiModel").value = p.model;
      $("#aiStatus").textContent = "Preset applied — pick a model tweak if you need. 🔌";
      $("#aiStatus").className = "ai-note ok";
      llm.saveConfig(cur);
    });
    $("#aiTemp").addEventListener("input", () => { $("#aiTempOut").textContent = $("#aiTemp").value; });
    $("#aiTokens").addEventListener("input", () => { $("#aiTokensOut").textContent = $("#aiTokens").value; });
    $("#aiForm").addEventListener("submit", (e) => {
      e.preventDefault();
      saveAiSettings();
    });

    // Mobile nav
    $("#navTrigger").addEventListener("click", () => {
      const nav = $(".nav");
      nav.classList.toggle("open");
      $("#navTrigger").setAttribute("aria-expanded", String(nav.classList.contains("open")));
    });
    $$(".nav a").forEach((a) => a.addEventListener("click", () => $(".nav").classList.remove("open")));

    // Pixel mode toggle
    $("#navPixel").addEventListener("click", () => setPixelTheme(!isPixelTheme()));

    // Backdrop click to close
    $$(".modal-backdrop").forEach((m) =>
      m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; })
    );
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });
  }

  /* ---------- Brain Freeze (pixel) mode ---------- */

  const PIXEL_KEY = "pixelpals.pixeltheme.v1";

  function isPixelTheme() {
    return document.body.classList.contains("theme-pixel");
  }

  function setPixelTheme(on) {
    document.body.classList.toggle("theme-pixel", on);
    const btn = $("#navPixel");
    if (btn) {
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent = on ? "🧊 Thaw" : "🧊 Pixel";
      btn.title = on ? "Turn off Brain Freeze pixel mode" : "Toggle Brain Freeze pixel mode";
    }
    try { localStorage.setItem(PIXEL_KEY, on ? "1" : "0"); } catch (e) {}
  }

  /* ---------- Boot ---------- */

  // Render the combined activity feed (newest first) across all pets.
  function renderFeed() {
    const grid = $("#feedGrid");
    const empty = $("#feedEmpty");
    if (!grid) return;
    const items = [];
    sanctuary.forEach((pet) => {
      const pal = palById(pet.id);
      if (!pal) return;
      (pet.activityFeed || []).forEach((a) => items.push({ pet, pal, a }));
    });
    items.sort((x, y) => y.a.when - x.a.when);
    if (!items.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = items.slice(0, 24).map(({ pet, pal, a }) => {
      const ago = timeAgo(a.when);
      return `
        <article class="feed-item" data-id="${pet.id}">
          <span class="feed-icon">${a.icon || "✦"}</span>
          <div class="feed-body">
            <p class="feed-text">${a.text}</p>
            <span class="feed-meta"><span class="feed-emoji">${pal.emoji}</span> ${pet.name} · ${ago}</span>
          </div>
        </article>`;
    }).join("");
  }

  // Render a pet's personality + learned preferences as tags on its card.
  function personaTag(archetype) {
    const labels = {
      exuberant: { icon: "⚡", label: "Exuberant" },
      serene: { icon: "🍃", label: "Serene" },
      curious: { icon: "🔎", label: "Curious" },
      gruff: { icon: "😤", label: "Gruff" },
      ethereal: { icon: "🌙", label: "Ethereal" },
    }[archetype] || { icon: "✨", label: "Peculiar" };
    return `${labels.icon} ${labels.label}`;
  }

  function preferenceTagsHtml(pet) {
    const prefs = pet.preferences || {};
    const entries = Object.entries(prefs).filter(([, v]) => Math.abs(v) >= 2).slice(0, 3);
    if (!entries.length) return "";
    const labels = {
      "interaction:play": "loves playtime",
      "interaction:feed": "loves treats",
      "interaction:pet": "loves snuggles",
      "self:exploring": "a little explorer",
      "self:napping": "pro napper",
      "self:snacking": "snack enthusiast",
      "self:mischief": "a known troublemaker",
    };
    return `<div class="pref-tags">` + entries.map(([k, v]) => {
      const base = labels[k] || k.split(":")[1] || "curious";
      const txt = v > 0 ? base : (labels[k] ? "not into " + (labels[k].replace("loves ", "")) : "avoiding it");
      return `<span class="pref-tag ${v > 0 ? "pos" : "neg"}">${v > 0 ? "💚" : "💔"} ${txt}</span>`;
    }).join("") + `</div>`;
  }

  function renderAll() {
    renderFilters();
    renderCatalog();
    renderSanctuary();
    renderFeed();
  }

  function init() {
    sanctuary = loadSanctuary();
    bindEvents();
    // apply persisted pixel mode before paint-ish render
    let pixel = false;
    try { pixel = localStorage.getItem(PIXEL_KEY) === "1"; } catch (e) {}
    setPixelTheme(pixel);
    renderAll();
    advanceSimAll();       // catch up on time away
    save();
    startTicker();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
