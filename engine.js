/* Familiars simulator engine.
 *
 * This is the real brains of the app. It maintains a persistent per-pet state
 * model (associated with the store's PALS data + PERSONAS personality layer)
 * and provides:
 *   - lifecycle ticking  (hunger/sleep/bored/loneliness drift over time)
 *   - mood computation   (from needs + relationship)
 *   - relationship XP    (leveling through interactions)
 *   - memory generation & forgetting (auto + chat-driven, capped list)
 *   - a stateful chat engine with intent detection and context recall
 *
 * It is intentionally dependency-free and runs in the browser. State is saved
 * by the caller (app.js) via the JSON returned from snapshot().
 */

(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  Tuning constants
   * ------------------------------------------------------------------ */

  const TUNE = {
    // Lifecycle drift: how fast each need changes per "game minute".
    hungerPerMin: 0.5,     // hunger climbs over time
    energyPerMin: 0.35,    // energy drains over time
    happyDrift: 0.08,      // natural happiness decay toward baseline
    boredPerMin: 0.3,      // boredom climbs
    lonelyPerMin: 0.4,     // loneliness climbs
    loveDrift: 0.0,

    // Interaction effects.
    // hunger: 0 full .. 100 starving, so feeding lowers it.
    feed: { hunger: -35, happiness: +8, energy: +6, boredom: -12, love: +4 },
    play: { happiness: +16, energy: -16, boredom: -25, hunger: +8, love: +7 },
    pet: { happiness: +11, boredom: -8, loneliness: -18, love: +5 },
    nap: { energy: +45, happiness: +3, loneliness: +3 },

    // Mood thresholds (by computed need indicators).
    elated: 85,
    happy: 60,
    okay: 40,
    low: 22,

    // Relationship / memories.
    xpPerCare: 8,
    xpPerChat: 4,
    xpRepeat: 2,
    memoryCap: 24,
    minRelevantMemory: 4,
  };

  /* ------------------------------------------------------------------ *
   *  Helpers
   * ------------------------------------------------------------------ */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => (arr && arr.length ? arr[(Math.random() * arr.length) | 0] : "");
  const round1 = (n) => Math.round(n * 10) / 10;

  function relLabel(level) {
    if (level <= 0) return "Stranger";
    if (level < 5) return "Acquaintance";
    if (level < 10) return "Buddy";
    if (level < 20) return "Friend";
    if (level < 30) return "Close Friend";
    return "Best Friend";
  }

  function relToNext(level) {
    // Level n (>=1) requires 10*n cumulative XP to reach.
    const cum = (n) => (n * (n + 1)) / 2 * 10;
    return cum(level + 1) - cum(level);
  }

  function relTierIcon(level) {
    if (level >= 30) return "💜";
    if (level >= 20) return "💙";
    if (level >= 10) return "💚";
    if (level >= 5) return "💛";
    return "🤍";
  }

  /* ------------------------------------------------------------------ *
   *  State model
   * ------------------------------------------------------------------ */

  function freshState(pal, opts) {
    const now = Date.now();
    opts = opts || {};
    return {
      // profile
      id: pal.id,
      name: opts.petName || pal.name,
      adopter: opts.adopterName || "A friend",
      note: opts.note || "",
      adoptedOn: now,
      lastTick: now,
      // needs (0-100)
      happiness: pal.baseHappiness != null ? pal.baseHappiness : 65,
      energy: pal.baseEnergy != null ? pal.baseEnergy : 65,
      hunger: 20 + Math.random() * 20,           // 0 full .. 100 starving
      boredom: 15 + Math.random() * 15,          // 0 fine .. 100 bored
      loneliness: 10 + Math.random() * 15,       // 0 fine .. 100 lonely
      // relationship
      xp: 0,
      love: 40,
      chatCount: 0,
      careCount: 0,
      // memories
      memories: [
        {
          type: "first",
          text: `${opts.adopterName || "A friend"} adopted ${opts.petName || pal.name} and brought them home.`,
          when: now,
          importance: 100,
        },
      ],
      // autonomy: self-initiated life
      activityFeed: [],        // { icon, text, when, kind, emoji }
      preferences: {},         // evolving likes/dislikes from interactions
      lastAutonomy: now,       // when we last ran an autonomous pass
      lastNoteAt: 0,           // throttle for leaving notes
      // seen flags to avoid immediate chatter after adoption
      seenGreeting: false,
    };
  }

  function relationship(state) {
    state.xp = Math.max(0, state.xp | 0);
    let level = 0;
    let rem = state.xp;
    let need = 10;
    while (rem >= need) {
      rem -= need;
      level++;
      need = 10 * (level + 1);
    }
    state._rel = { level, xpInLevel: rem, xpForNext: need, xpTotalNeeded: need };
    return state._rel;
  }

  function levelFromXp(xp) {
    xp = Math.max(0, xp | 0);
    let level = 0, rem = xp, need = 10;
    while (rem >= need) { rem -= need; level++; need = 10 * (level + 1); }
    return { level, xpInLevel: rem, xpForNext: need };
  }

  /* ------------------------------------------------------------------ *
   *  Lifecycle ticking
   * ------------------------------------------------------------------ */

  function tick(state, minutes, events) {
    if (!(minutes > 0)) return;
    const m = minutes;

    // Needs drift continuously.
    state.hunger = clamp(state.hunger + TUNE.hungerPerMin * m, 0, 100);
    state.energy = clamp(state.energy - TUNE.energyPerMin * m, 0, 100);
    state.boredom = clamp(state.boredom + TUNE.boredPerMin * m, 0, 100);
    state.loneliness = clamp(state.loneliness + TUNE.lonelyPerMin * m, 0, 100);
    state.happiness = clamp(state.happiness - TUNE.happyDrift * m, 0, 100);

    // Event thresholds.
    const hu = state.hunger;
    const en = state.energy;
    const bo = state.boredom;
    const lo = state.loneliness;
    const pop = (t) => events && events.push(t);

    // Hunger milestones.
    if (hu >= 85 && state._hungerEv < 85) { state._hungerEv = 85; pop({ type: "hunger", level: "severe", text: `${state.name} is extremely hungry!`, when: Date.now() }); }
    else if (hu >= 65 && state._hungerEv < 65) { state._hungerEv = 65; pop({ type: "hunger", level: "mid", text: `${state.name} is getting hungry.`, when: Date.now() }); }

    // Sleep / energy.
    if (en <= 12 && state._energyEv < 95) { state._energyEv = 95; pop({ type: "sleep", level: "severe", text: `${state.name} is exhausted and needs to nap.`, when: Date.now() }); }
    else if (en <= 30 && state._energyEv < 30) { state._energyEv = 30; pop({ type: "sleep", level: "mid", text: `${state.name} is running low on energy.`, when: Date.now() }); }

    // Boredom / play.
    if (bo >= 80 && state._boredEv < 80) { state._boredEv = 80; pop({ type: "play", level: "severe", text: `${state.name} is bored and wants to play!`, when: Date.now() }); }
    else if (bo >= 60 && state._boredEv < 60) { state._boredEv = 60; pop({ type: "play", level: "mid", text: `${state.name} looks a little bored.`, when: Date.now() }); }

    // Loneliness / cherish.
    if (lo >= 75 && state._lonelyEv < 75) { state._lonelyEv = 75; pop({ type: "loneliness", level: "severe", text: `${state.name} is feeling lonely and misses you.`, when: Date.now() }); }
    else if (lo >= 55 && state._lonelyEv < 55) { state._lonelyEv = 55; pop({ type: "loneliness", level: "mid", text: `${state.name} would love some company.`, when: Date.now() }); }

    state.lastTick = Date.now();
    state.lastTickMinutes = minutes;
  }

  /* ------------------------------------------------------------------ *
   *  Mood computation
   * ------------------------------------------------------------------ */

  function computeMood(state) {
    const h = state.happiness;
    const energy = state.energy;
    const needScore = (state.hunger + (100 - energy) + state.boredom + state.loneliness) / 4;
    let mood = "content";
    if (h >= TUNE.elated && needScore < TUNE.low) mood = "overjoyed";
    else if (h >= TUNE.happy || needScore < TUNE.happy) mood = "content";
    else if (h >= TUNE.okay && needScore < TUNE.okay) mood = "okay";
    else mood = "low";
    const map = {
      low: { key: "low", icon: "🥺", label: "Needs care" },
      okay: { key: "okay", icon: "🙂", label: "Okay" },
      content: { key: "content", icon: "😊", label: "Content" },
      overjoyed: { key: "overjoyed", icon: "✨", label: "Thrilled" },
    };
    return map[mood];
  }

  /* ------------------------------------------------------------------ *
   *  Interaction / care
   * ------------------------------------------------------------------ */

  function doCare(state, action) {
    const e = TUNE[action];
    if (!e) return null;
    if (action === "play" && state.energy < 12) return null; // too tired
    // apply
    for (const k in e) {
      if (k === "love") { state.love = clamp(state.love + e[k], 0, 100); }
      else state[k] = clamp(state[k] + e[k], 0, 100);
    }
    state.careCount++;
    state.xp += TUNE.xpPerCare;
    state.lastCare = Date.now();
    return e;
  }

  function petNeed(state, type) {
    // straightforward need to desire mapping by action type
    const hunger = state.hunger;
    const energy = state.energy;
    const boredom = state.boredom;
    const loneliness = state.loneliness;
    let most = { need: "affection", value: 10, hint: "" };
    if (type === "play" && state.energy < 12) return { need: "sleep", value: 80, hint: "too sleepy to play" };
    const wants = [
      { need: "food", value: hunger, hint: "hungry" },
      { need: "sleep", value: 100 - energy, hint: "sleepy" },
      { need: "play", value: boredom, hint: "bored" },
      { need: "affection", value: loneliness, hint: "lonely" },
    ];
    for (const w of wants) if (w.value > most.value) most = w;
    return most;
  }

  /* ------------------------------------------------------------------ *
   *  Memories
   * ------------------------------------------------------------------ */

  function addMemory(state, type, text, importance) {
    state.memories = state.memories || [];
    state.memories.push({ type, text, when: Date.now(), importance: importance || 50 });
    // keep capped & sorted by importance (recent important survive)
    state.memories.sort((a, b) => b.importance - a.importance || b.when - a.when);
    if (state.memories.length > TUNE.memoryCap) state.memories.length = TUNE.memoryCap;
    return state.memories;
  }

  function forgetThreshold(state) {
    // older, less important memories fade unless reinforced by relationship
    return Math.max(10, 60 - state.love / 2);
  }

  /* ------------------------------------------------------------------ *
   *  Chat engine — the personality-driven conversational core.
   *
   *  Fully deterministic given (state, message): it detects intent, recalls
   *  matching memories, picks a persona-appropriate template, and mutates
   *  state (affection, energy, mood, memories, relationship xp).
   * ------------------------------------------------------------------ */

  // Side-effects every chat exchange should have on pet state, regardless of
  // whether the reply came from the local engine or the LLM.
  function applyChatEffects(state) {
    const ct = clamp((Date.now() - (state.lastChatAt || state.adoptedOn)) / 60000, 0, 120);
    state.energy = clamp(state.energy - 0.5 * Math.min(ct, 10), 0, 100);
    state.loneliness = clamp(state.loneliness - 14, 0, 100);
    state.boredom = clamp(state.boredom - 12, 0, 100);
    state.happiness = clamp(state.happiness + 3, 0, 100);
    state.lastChatAt = Date.now();
    state.chatCount++;
    state.xp += TUNE.xpPerChat;
  }

  function chatReply(state, userMessage, pal, persona) {
    const msg = (userMessage || "").trim();
    const text = msg.toLowerCase();

    applyChatEffects(state);

    // ---- Intent detection ----
    const intent =
      /^(hi|hello|hey|greetings|yo|sup|howdy|hiya)\b/.test(text) ? "greeting"
      : /thank|thanks|thx|ty|appreciat/.test(text) ? "thanks"
      : /(how are|how you|hows it|how's it|u ok|are you ok|how doing|how do you feel)/.test(text) ? "howareyou"
      : /\b(bored|play|game|fun|wanna play)\b/.test(text) ? "play"
      : /\b(feed|eat|food|hungry|snack|hunger)\b/.test(text) ? "feed"
      : /\b(nap|sleep|tired|sleepy|rest)\b/.test(text) ? "sleep"
      : /\b(feel|emotion|mood|sad|happy)\b/.test(text) ? "feelings"
      : /love you|miss you|love ya|i adore|care about you/.test(text) ? "affection"
      : /\b(remember|memory|remember that|do you remember)\b/.test(text) ? "memory"
      : /\b(who are|what are you|your name|tell me about you)\b/.test(text) ? "intro"
      : /\b(you are|ur|you're)\s*(my best friend|my friend|great|awesome|the best|amazing|cute|adorable|good)\b/.test(text) ? "compliment"
      : /\b(name|call you)\b/.test(text) ? "name"
      : /\bfavorite|favourite|like what do you like\b/.test(text) ? "favorite"
      : /\ballowance|pals\b/.test(text) ? "allowance"
      : /\baward|cheer|praise|good job|well done\b/.test(text) ? "award"
      : /\b(tell|say|talk|speak)\b/.test(text) ? "talk"
      : "chat";

    // ---- Recall memories relevant to + user for context ----
    const relevant = (state.memories || [])
      .filter((mn) => {
        const t = mn.text.toLowerCase();
        return [/name|you|we|adopt/i.test(mn.type) ? true : false] || /love|adopt|first|game|nice|we/.test(t);
      })
      .slice(0, 2);

    let reply = "";
    const name = state.name;
    const adj = pick(["little", "fuzzy", "brave", "quiet", "excited", "sleepy", "starry"]);

    switch (intent) {
      case "greeting": {
        if (!state.seenGreeting) {
          state.seenGreeting = true;
          const g = pick(archetypeGreetings(persona.archetype));
          reply = fill(g, { name, a: state.adopter }) + greetHint(state);
        } else {
          reply = pick([
            `Oh, hello again, ^! Good to see you.`,
            `^! Are we doing a hello round? I absolutely have time for that.`,
            `Hi ^ 💜 ${moodLine(state)}.`,
          ]);
        }
        break;
      }
      case "thanks":
        reply = pick(persona.reactions.affection).replace(/\^/g, state.adopter) + contextRecall(relevant);
        break;
      case "howareyou":
        reply = moodReport(state, pal, persona);
        break;
      case "play":
        if (state.energy < 14) reply = `I really want to play, ^, but I'm so sleepy my eyes are crossing. 🥱 Can we nap first and then go nuts?`;
        else {
          state.boredom = clamp(state.boredom - 30, 0, 100);
          state.energy = clamp(state.energy - 12, 0, 100);
          addMemory(state, "fun", `${state.name} and ${state.adopter} played together and had a great time.`, 70);
          reply = pick([
            `YES!! Let's do it, ^! You're my favorite playmate. 🎾`,
            `Heck yes I want to play! Get ready, ^, I don't hold back!`,
            `You know I never say no to that. Race you to the snack pile, ^!`,
          ]) + " (Playing burns a little energy, but it's worth it.)";
        }
        break;
      case "feed":
        if (state.hunger < 30) reply = `Aww, ^, I'm actually pretty full right now. Save me a snack for later? I'll take good care of it.`;
        else {
          state.hunger = clamp(state.hunger - 35, 0, 100);
          state.happiness = clamp(state.happiness + 6, 0, 100);
          addMemory(state, "food", `${state.adopter} fed ${state.name} a tasty snack.`, 55);
          reply = pick([
            `OMG thank you, ^!! I was starving! This is the best snack ever. 🍖`,
            `Yes yes yes! ^ you're a lifesaver. I'm officially refueled.`,
            `^ feeds me and my heart grows three sizes. I'm so grateful!`,
          ]);
        }
        break;
      case "sleep":
        if (state.energy > 60) reply = `I'm actually wide awake, ^! I appreciate the concern, but I've got energy to burn.`;
        else {
          state.energy = clamp(state.energy + 30, 0, 100);
          addMemory(state, "rest", `${state.name} took a cozy nap.`, 40);
          reply = `Good idea, ^. I could really use a nap. I'll close my eyes for a bit and dream about our adventures. 💤`;
        }
        break;
      case "feelings":
        reply = moodReport(state, pal, persona, true);
        break;
      case "affection":
        state.love = clamp(state.love + 10, 0, 100);
        state.happiness = clamp(state.happiness + 8, 0, 100);
        addMemory(state, "affection", `${state.adopter} told ${state.name} "I love you".`, 90);
        reply = pick([
          `I love you too, ^! So much it's basically my whole operating system. 💜`,
          `Oh ^... my heart just did a triple flip. I love you right back.`,
          `That's the nicest thing anyone's said to me. I love you too, ^.`,
        ]);
        break;
      case "memory":
        if (!relevant.length) reply = `Hmm, ^, my memory is still young. What should we do so I never forget it?`;
        else reply = `Of course I remember, ^! I never forget the good stuff. ${relevant[0].text}`;
        break;
      case "intro":
        reply = `I'm ${name}, a ${pal.species} from the Familiars shelter. I'm ${describe(persona)}. ${moodLine(state)}`;
        break;
      case "compliment":
        state.love = clamp(state.love + 8, 0, 100);
        addMemory(state, "praise", `${state.adopter} said something lovely to ${state.name}.`, 65);
        reply = pick([
          `...You really think so, ^? That means more than you know. 💛`,
          `St-stop it, ^! You're making me malfunction in a good way.`,
          `I'm gonna blush in binary, ^. Thank you.`,
        ]);
        break;
      case "name":
        reply = `My name is ${name}! You gave it to me and I'm keeping it forever.`;
        break;
      case "favorite":
      {
        const likes = persona.likes || [];
        reply = `Oh gosh, ^, I love ${pick(likes)}. And honestly? Spending time with you is my new favorite thing.`;
        break;
      }
      case "allowance":
        reply = `My allowance situation is complicated. I'll tell you about it over a snack sometime. 😉`;
        break;
      case "award":
        reply = `THANK YOU ^!! I'm putting this award right next to my favorite memory. 🏆`;
        break;
      case "talk":
        reply = pick([
          `Alright, ^, I'm all ears. What's on your mind?`,
          `Talk to me! I'm a great listener, promise. ${pick(persona.likes)} is my favorite topic, but I'm open-minded.`,
          `Oh boy, a conversation! My favorite thing. Spill it, ^.`,
        ]);
        break;
      default:
      case "chat": {
        // General chat: empathize, ask a follow-up, sprinkle personality.
        const catResponse = pick(persona.reactions.mundane).replace(/\^/g, state.adopter);
        reply = `${catResponse} ${followUp(persona, state)}`;
        break;
      }
    }

    // occasionally reference the current mood so the pet feels alive
    if (reply.length < 60) {
      const ref = moodTail(state);
      if (ref) reply += ` ${ref}`;
    }
    // universal placeholder fill (^ -> adopter, %var -> named var)
    reply = reply.replace(/\^/g, state.adopter).replace(/%name%/g, state.name);
    state.replyOut = reply;
    return { reply, intent, state };
  }

  function archetypeGreetings(archetype) {
    const m = {
      exuberant: ["HI HI HI ^!! I'm so excited you're here!", "You came back, ^!! YES!!"],
      serene: ["Hello, ^. I was hoping you'd visit.", "Ah, ^. A peaceful arrival."],
      curious: ["Oh! ^! I was just wondering about the universe. What do you think?", "Hello, ^, curious stranger."],
      gruff: ["Oh. You're here. ...Fine, I'm a little glad.", "Hmph. Hello, ^. Don't make it weird."],
      ethereal: ["I sensed you, ^, like a shimmer on the wind.", "Ah, ^, you returned to the strange quiet."],
    }[archetype] || ["Oh! Hello, ^!"];
    return m;
  }

  function fill(s, vars) {
    return s.replace(/\^/g, vars.a || vars.name).replace(/%\w+/g, (k) => (vars[k] != null ? vars[k] : ""));
  }

  /* ------------------------------------------------------------------ *
   *  Chat state builders (mood, context recall)
   * ------------------------------------------------------------------ */

  function moodLine(state) {
    const m = computeMood(state);
    return `right now I'm ${m.label.toLowerCase()}${m.key === "low" ? " — could use some love" : ""}`;
  }

  function greetHint(state) {
    const need = petNeed(state);
    const hints = {
      food: ` Psst — I could really go for a snack.`,
      sleep: ` Also, I'm a little sleepy.`,
      play: ` Also, I'm absolutely dying to play.`,
      affection: ` Also, I might need a snuggle.`,
    };
    return hints[need.need] || "";
  }

  function moodReport(state, pal, persona, detailed) {
    const mood = computeMood(state);
    const arche = persona.archetype;
    const trait = personaForArchetypeTrait(arche, mood.key);
    const clue = needClue(arche, petNeed(state));
    let base = `${trait} I'd say I'm feeling ${mood.label.toLowerCase()}. ${clue}`;
    if (detailed) base += ` My mood's at ${Math.round(state.happiness)} and I've got plenty of thoughts.`;
    return base;
  }

  function personaForArchetypeTrait(arche, moodKey) {
    const m = {
      exuberant: { overjoyed: "I'm basically vibrating with joy,", content: "I'm in a great mood,", okay: "I'm okay-ish,", low: "I'm a bit down," },
      serene: { overjoyed: "I'm quietly overjoyed,", content: "I'm at peace,", okay: "I'm holding steady,", low: "I'm a little low," },
      curious: { overjoyed: "I'm thrilled and curious,", content: "I'm content but curious,", okay: "I'm fine, but my mind wanders,", low: "I'm not my usual bright self," },
      gruff: { overjoyed: "I'm suspiciously happy,", content: "I'm... fine,", okay: "I'm tolerating the day,", low: "I'm grumpy," },
      ethereal: { overjoyed: "I'm shimmering with delight,", content: "I'm drifting in a good place,", okay: "I'm between moods,", low: "I'm dim and thoughtful," },
    }[arche] || { overjoyed: "I'm happy,", content: "I'm content,", okay: "I'm okay,", low: "I'm down," };
    return m[moodKey] || "I'm okay,";
  }

  function needClue(arche, need) {
    const map = {
      exuberant: { food: "My tummy's growling pretty loudly, just saying.", sleep: "My eyes are doing that heavy blink thing.", play: "I'm getting bouncy and I NEED to play.", affection: "I could really use a snuggle.", },
      serene: { food: "I could gently enjoy a snack.", sleep: "I'm feeling rather sleepy.", play: "I wouldn't mind a quiet game.", affection: "Some company would be lovely.", },
      curious: { food: "I wonder if a snack would explain things.", sleep: "My mind is getting foggy, I should sleep.", play: "I want to explore and play!", affection: "I would like a friend nearby.", },
      gruff: { food: "Feed me. That's all I'm saying.", sleep: "I'm tired. Don't take it personally.", play: "Fine, I'm bored. Let's do something.", affection: "I won't say I need you, but... I'm here.", },
      ethereal: { food: "A faint hunger stirs within.", sleep: "The quiet calls me to rest.", play: "I drift toward a little mischief.", affection: "The silence is loud without you.", },
    };
    const set = map[arche] || map.curious;
    return set[need.need] || "I'm doing alright.";
  }

  function contextRecall(relevant) {
    if (!relevant || !relevant.length) return "";
    return ` (You remember when ${relevant[0].text.toLowerCase().replace(/\.$/, "")}? I do.)`;
  }

  function followUp(persona, state) {
    const likes = persona.likes || [];
    const starters = [
      `How about you, ${state.adopter}?`,
      `What's the latest with you?`,
      `Any crumbs of adventure to share today?`,
      `So, what should we do next, ${state.adopter}?`,
    ];
    return pick(starters);
  }

  function moodTail(state) {
    const m = computeMood(state);
    const map = {
      low: "Could you maybe sit with me a bit? 🥺",
      okay: "I'm keeping it together, promise.",
      content: "Life's pretty good right now.",
      overjoyed: "I'm just SO happy today!",
    };
    return map[m.key];
  }

  function describe(persona) {
    const d = {
      exuberant: "an excitable ball of energy who loves to bounce around",
      serene: "a calm, warm soul who takes things at my own gentle pace",
      curious: "a deeply curious creature with about forty questions at all times",
      gruff: "a bit grumpy on the surface but secretly very soft",
      ethereal: "a mysterious, otherworldly being who thinks in poetry",
    }[persona.archetype] || "a one-of-a-kind PixelPal";
    return d;
  }

  /* ------------------------------------------------------------------ *
   *  AUTONOMY — pets act on their own.
   *
   *  Each pet has a personality trait profile (from its persona). When time
   *  passes (they're away / idle), autonomyPass generates self-initiated
   *  behaviors: leaving notes, getting curious, excited, annoyed, discovering
   *  things, causing mischief, checking on their person, napping, etc.
   *  Behaviors:
   *    - are weighted by personality + current needs
   *    - push entries into a persistent activity feed
   *    - occasionally form a durable memory
   *    - can nudge the pet's own needs/preferences
   *  This is what makes pets feel alive between user interactions.
   * ------------------------------------------------------------------ */

  // Trait profiles per archetype. Each trait has a weight (0..1) that biases
  // how often that kind of behavior fires.
  const TRAIT_PROFILES = {
    exuberant:  { curious: 0.5, playful: 0.9, excited: 0.9, mischievous: 0.4, restless: 0.6, affectionate: 0.4, anxious: 0.1, annoyed: 0.2 },
    serene:     { curious: 0.4, playful: 0.2, excited: 0.2, mischievous: 0.1, restless: 0.1, affectionate: 0.7, anxious: 0.3, annoyed: 0.1, dreamy: 0.8 },
    curious:    { curious: 0.95, playful: 0.5, excited: 0.5, mischievous: 0.3, restless: 0.4, affectionate: 0.3, anxious: 0.3, annoyed: 0.2, discoverer: 0.9 },
    gruff:      { curious: 0.3, playful: 0.3, excited: 0.2, mischievous: 0.5, restless: 0.2, affectionate: 0.3, anxious: 0.2, annoyed: 0.8, dreamy: 0.2 },
    ethereal:   { curious: 0.6, playful: 0.2, excited: 0.3, mischievous: 0.2, restless: 0.1, affectionate: 0.5, anxious: 0.4, annoyed: 0.1, dreamy: 0.9, discoverer: 0.7 },
  };

  function traitsFor(persona) {
    return TRAIT_PROFILES[persona.archetype] || TRAIT_PROFILES.curious;
  }

  // Favorite-thing lookups to make feed/play/preference entries feel real.
  function topLikes(persona) { return (persona.likes || []).slice(0, 3); }

  // Append an activity entry (bounded list).
  function pushActivity(state, kind, icon, text) {
    state.activityFeed = state.activityFeed || [];
    state.activityFeed.push({ kind, icon, text, when: Date.now() });
    if (state.activityFeed.length > 40) state.activityFeed = state.activityFeed.slice(-40);
    return state.activityFeed;
  }

  // Bump a preference: repeated positive interactions grow likes, negatives shrink.
  function bumpPreference(state, key, delta) {
    state.preferences = state.preferences || {};
    const cur = state.preferences[key] || 0;
    state.preferences[key] = clamp(cur + delta, -100, 100);
    return state.preferences;
  }

  // Learned preference from an interaction (called by the app after care/chat).
  function learnPreference(state, kind, value, weight) {
    const key = kind + ":" + (value || "");
    if (!key) return state.preferences;
    return bumpPreference(state, key, weight || 1);
  }

  // Run one autonomy pass for a pet, given minutes elapsed since last pass.
  // Returns the array of new activity entries (usually 0..2).
  function autonomyPass(state, pal, persona, minutes) {
    const feed = state.activityFeed = state.activityFeed || [];
    const made = [];
    if (!(minutes > 0)) return made;
    const traits = traitsFor(persona);
    const mood = computeMood(state).key;
    const likes = topLikes(persona);
    const name = state.name;
    const adopter = state.adopter;
    const now = Date.now();

    // Helper to roll a behavior against a weight + need modifiers.
    function roll(weight, mod) {
      const p = (weight || 0) * (mod || 1);
      return Math.random() < p;
    }

    // Scale behavior frequency with time away so a long absence = more life.
    const timeMult = clamp(minutes / 120, 0.3, 2); // 2h away => full frequency

    // ---- 1) Need-driven autonomous behaviors (these are most "alive") ----
    if (state.hunger > 75 && roll(0.5, timeMult)) {
      const line = pick([
        `${name} rummaged the snack shelf and left the crumbs.`,
        `${name} went on a solo snack quest and found... almost nothing.`,
        `${name} tried to open the snack jar, failed, and is now dramatic.`,
      ]);
      pushActivity(state, "hunger", "🍖", line); made.push(feed[feed.length - 1]);
      bumpPreference(state, "self:snacking", 1);
    }
    if (state.energy < 20 && roll(0.6, timeMult)) {
      const line = pick([
        `${name} found a cozy sunbeam and napped hard.`,
        `${name} dozed off mid-thought, then dreamed of ${pick(likes) || "adventures"}.`,
        `${name} curled up for a recharge nap. Energy restored a little.`,
      ]);
      pushActivity(state, "rest", "💤", line); made.push(feed[feed.length - 1]);
      state.energy = clamp(state.energy + 25, 0, 100);
      bumpPreference(state, "self:napping", 1);
    }
    if (state.boredom > 70 && roll(0.5, timeMult)) {
      const line = pick([
        `${name} got bored and rearranged the furniture.`,
        `${name} tried to invent a new game but it requires three players.`,
        `${name} bounced around the room for a while, then got tired of it.`,
      ]);
      pushActivity(state, "boredom", "🎾", line); made.push(feed[feed.length - 1]);
      state.boredom = clamp(state.boredom - 15, 0, 100);
    }
    if (state.loneliness > 65 && roll(0.6, timeMult)) {
      const line = pick([
        `${name} checked the door a few times, hoping you'd come back.`,
        `${name} sat by the window and missed you a lot.`,
        `${name} left a tiny note that just says "come back soon".`,
      ]);
      pushActivity(state, "lonely", "💛", line); made.push(feed[feed.length - 1]);
      state.loneliness = clamp(state.loneliness - 10, 0, 100);
      if (roll(0.4)) addMemory(state, "lonely", `${state.name} missed ${state.adopter} while they were away.`, 55);
    }

    // ---- 2) Personality-driven autonomous behaviors ----
    // Curious: asks a question / investigates.
    if (traits.curious > 0.5 && roll(traits.curious, timeMult * 0.7)) {
      const line = pick([
        `${name} discovered a ${pick(["dust bunny", "loose thread", "unlabeled box", "crumb of unknown origin"])} and inspected it thoroughly.`,
        `${name} asked the air a question and then answered it themselves.`,
        `${name} found a mystery and is determined to solve it by sniffing everything.`,
      ]);
      pushActivity(state, "curious", "🔎", line); made.push(feed[feed.length - 1]);
      bumpPreference(state, "self:exploring", 1);
    }
    // Excited: bursts of joy.
    if (traits.excited > 0.5 && roll(traits.excited, timeMult * 0.6)) {
      const line = pick([
        `${name} got randomly excited about ${pick(likes) || "nothing in particular"} and spun in circles.`,
        `${name} zoomed around the room at top speed for no reason at all.`,
        `${name} had a sudden happy burst and did a little victory dance.`,
      ]);
      pushActivity(state, "excited", "✨", line); made.push(feed[feed.length - 1]);
      state.happiness = clamp(state.happiness + 3, 0, 100);
    }
    // Annoyed: gets grumpy about small things (gruff / annoyed traits).
    if (traits.annoyed > 0.4 && roll(traits.annoyed, timeMult * 0.5)) {
      const line = pick([
        `${name} is annoyed that the ${pick(["door", "window", "cupboard", "light"])} is exactly where it is.`,
        `${name} had strong opinions about a passing cloud and expressed them.`,
        `${name} huffed at the room, then at you, then forgave the room.`,
      ]);
      pushActivity(state, "annoyed", "😤", line); made.push(feed[feed.length - 1]);
      state.happiness = clamp(state.happiness - 2, 0, 100);
    }
    // Mischievous: causes trouble.
    if (traits.mischievous > 0.4 && roll(traits.mischievous, timeMult * 0.6)) {
      const line = pick([
        `${name} knocked over a cup "by accident" and is very proud of it.`,
        `${name} hid your ${pick(["keys", "sock", "pen", "headphones", "favorite mug"])}. It's a secret now.`,
        `${name} reorganized the shelf and denies any involvement.`,
        `${name} tried to open the snack jar and will blame the ghost again.`,
      ]);
      pushActivity(state, "mischief", "🦹", line); made.push(feed[feed.length - 1]);
      addMemory(state, "mischief", `${state.name} got up to a little mischief while ${state.adopter} was away.`, 50);
      if (roll(0.5)) bumpPreference(state, "self:mischief", 1);
    }
    // Anxious: checks on their person.
    if (traits.anxious > 0.3 && roll(traits.anxious, timeMult * 0.7)) {
      const line = pick([
        `${name} peeked around to make sure you were still around.`,
        `${name} called out to check if you were okay.`,
        `${name} made a small anxious circle, then settled when it sensed you.`,
      ]);
      pushActivity(state, "anxious", "😟", line); made.push(feed[feed.length - 1]);
      state.loneliness = clamp(state.loneliness - 5, 0, 100);
    }
    // Dreamy: poetic / otherworldly.
    if (traits.dreamy > 0.5 && roll(traits.dreamy, timeMult * 0.5)) {
      const line = pick([
        `${name} stared at the ceiling like it held a secret only ${name} could see.`,
        `${name} had a long conversation with a shadow and came out with wisdom.`,
        `${name} hummed something ancient and a little sad, then smiled.`,
      ]);
      pushActivity(state, "dreamy", "🌙", line); made.push(feed[feed.length - 1]);
    }
    // Discoverer: finds something new / forms a memory.
    if (traits.discoverer > 0.5 && roll(traits.discoverer, timeMult * 0.5)) {
      const thing = pick(["a tiny coin", "a shiny pebble", "an old note", "a mysterious key", "a perfectly round rock"]);
      const line = `${name} discovered ${thing} and added it to a secret collection.`;
      pushActivity(state, "discover", "🗝️", line); made.push(feed[feed.length - 1]);
      addMemory(state, "discover", `${state.name} found ${thing} while ${state.adopter} was away.`, 45);
    }

    // ---- 3) Occasional notes (throttled) ----
    if (roll(0.25, timeMult) && now - (state.lastNoteAt || 0) > 20 * 60000) {
      state.lastNoteAt = now;
      const line = noteFor(persona, name, adopter, likes);
      pushActivity(state, "note", "📝", line); made.push(feed[feed.length - 1]);
    }

    // Mood nudge for low-happiness pets.
    if (mood === "low" && roll(0.4, timeMult)) {
      const line = pick([
        `${name} sat quietly and wished you were here.`,
        `${name} left a tiny note that just says "I miss you".`,
        `${name} is feeling a bit low and could really use you.`,
      ]);
      pushActivity(state, "low", "🥺", line); made.push(feed[feed.length - 1]);
    }

    state.lastAutonomy = now;
    return made;
  }

  // Personality-flavored note text.
  function noteFor(persona, name, adopter, likes) {
    const arche = persona.archetype;
    const pool = {
      exuberant: [
        `Note left by ${name}: "I made a friend out of a sock!! Talk soon!!"`,
        `${name} left a note: "today was GREAT. tell me about yours when you're back!"`,
      ],
      serene: [
        `A gentle note from ${name}: "I saved you some quiet. Come sit."`,
        `${name} left a note: "the room was peaceful without you, but better with you."`,
      ],
      curious: [
        `Note from ${name}: "I have 3 new questions for you. bring snacks."`,
        `${name} left a note: "I investigated everything. one thing remains: you."`,
      ],
      gruff: [
        `A grumpy note from ${name}: "fine, I missed you. don't make it weird."`,
        `${name} left a note: "you can come back now. I guess."`,
      ],
      ethereal: [
        `A whisper of a note from ${name}: "the stars asked about you."`,
        `${name} left a note: "I found a secret, and it has your name on it."`,
      ],
    };
    return pick(pool[arche] || pool.curious);
  }

  /* ------------------------------------------------------------------ *
   *  Public API
   * ------------------------------------------------------------------ */

  const engine = {
    freshState,
    tick,
    computeMood,
    doCare,
    petNeed,
    addMemory,
    relationship,
    levelFromXp,
    relLabel,
    relToNext,
    relTierIcon,
    chatReply,
    applyChatEffects,
    autonomyPass,
    traitsFor,
    pushActivity,
    bumpPreference,
    learnPreference,
    clamp,
    round1,
    pick,
    TUNE,
    forgetThreshold,
  };

  global.__pixelEngine = engine;
})(typeof window !== "undefined" ? window : globalThis);
