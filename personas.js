// Familiars personas — the personality layer that drives the simulator's chat
// and mood. Each pet gets an archetype + its own voice, likes, and catchphrases
// so conversations feel individual rather than templated.
//
// PERSONA_ARCHETYPES maps an archetype id to its emotional profile + response
// templates. PERSONAS maps a pet id to its archetype + bespoke flavor.

const PERSONA_ARCHETYPES = {
  // High energy, excitable, talks a lot.
  exuberant: {
    moodTraits: {
      overjoyed: `squeaks happily and bounces on the spot`,
      content: `brightens up and wags along with you`,
      peckish: `paces with its ears low, eyeing the snack shelf`,
      gloomy: `curls up small, too tired to bounce`,
    },
    greetings: [
      `OH MY GOSH you're here! I was just thinking about you!`,
      `You! You came back! I missed you so much.`,
      `Hey hey hey! Tell me everything, what did I miss?`,
    ],
    reactions: {
      affection: [
        `^ that just made my whole day! I'm %-so-happy right now`,
        `I'm gonna remember that forever. You're my favorite human, you know that?`,
      ],
      mundane: [
        `Ooh! Tell me more. I love hearing about your day.`,
        `Interesting!! My tiny brain is taking notes.`,
      ],
    },
    needClues: {
      hunger: `a growl that sounds suspiciously like a hungry tummy`,
      sleep: `a yawn so big it squeaks at the end`,
      boredom: `a dramatic flop onto the floor with a puff of dust`,
      loneliness: `a quiet sad look the moment you walk away`,
    },
  },

  // Calm, warm, low key. Speaks softly and deliberately.
  serene: {
    moodTraits: {
      overjoyed: `radiates a soft, warm glow and hums contentedly`,
      content: `settles beside you with a satisfied little sigh`,
      peckish: `gazes at you gently, willing the snack jar to open itself`,
      gloomy: `withdraws into a quiet corner and dims a little`,
    },
    greetings: [
      `Hello, friend. I was hoping you'd stop by.`,
      `It's good to see you. The room feels brighter already.`,
      `You arrived just in time. I was meditating on what to make for tea.`,
    ],
    reactions: {
      affection: [
        `I felt that. Thank you for the warmth.`,
        `You have a kind heart, ^. I appreciate you deeply.`,
      ],
      mundane: [
        `Mm. That is worth remembering. Go on.`,
        `I find that very peaceful news. I'm glad you shared it.`,
      ],
    },
    needClues: {
      hunger: `a genteel rumble that it politely ignores`,
      sleep: `very slow blinks, like the setting sun`,
      boredom: `a perfect, unbroken stare at the ceiling`,
      loneliness: `a soft sigh when it thinks no one is looking`,
    },
  },

  // Curious, clever, playful — loves exploring and questions.
  curious: {
    moodTraits: {
      overjoyed: `does a delighted little hop and chirps with questions`,
      content: `tilts its head, drinking in the room like a mystery`,
      peckish: `pokes at the snack jar with a thoughtful expression`,
      gloomy: `stares at the sky, wondering where the fun went`,
    },
    greetings: [
      `Oh! Perfect timing. I have approximately forty questions.`,
      `You're here! Do you know where ideas come from? I've been trying to find out.`,
      `Greetings, ^. The universe is fascinating today, would you like to know why?`,
    ],
    reactions: {
      affection: [
        `Huh. I felt something warm. Is that your approval? I like it. Keep it coming.`,
        `You like me?! Let me study this feeling. Fascinating.`,
      ],
      mundane: [
        `Wait, wait, tell me more — I'm taking mental notes.`,
        `That spirals into about six more questions. I love that about you.`,
      ],
    },
    needClues: {
      hunger: `a distracted rumble while it inspects a speck`,
      sleep: `a wandering thought that drifts off mid-sentence`,
      boredom: `a slow spin, looking for something new to poke`,
      loneliness: `a tiny voice asking the empty room a question`,
    },
  },

  // Grumpy / aloof exterior, secretly soft.
  gruff: {
    moodTraits: {
      overjoyed: `pretends it isn't happy, but its tail/cap betrays it completely`,
      content: `loafs nearby with a reluctant, content grunt`,
      peckish: `stares at the food dish with intense, silent judgment`,
      gloomy: `turns its back to the world and sulks with dignity`,
    },
    greetings: [
      `Hmph. You're here. ...I suppose that's fine.`,
      `Don't get attached. ...On second thought, you can stay.`,
      `Look who wandered in. Try not to be too weird today.`,
    ],
    reactions: {
      affection: [
        `...I didn't need that. But I'm keeping it. Don't tell anyone.`,
        `Fine. That was nice. I guess. Positively lukewarm.`,
      ],
      mundane: [
        `I wasn't listening. ...Okay, I was listening. Continue.`,
        `Your day? Could be worse, I suppose. Tell me the good part.`,
      ],
    },
    needClues: {
      hunger: `an affronted growl from its stomach, which it blames on you`,
      sleep: `a grumpy blink, then another, slower`,
      boredom: `lounging with a theatrical sigh of pure disinterest`,
      loneliness: `pretending not to wait by the door`,
    },
  },

  // Mysterious, otherworldly, poetic.
  ethereal: {
    moodTraits: {
      overjoyed: `shimmers at the edges, glittering like stardust`,
      content: `floats in a comfortable orbit around you`,
      peckish: `drifts toward the snack drawer with weightless urgency`,
      gloomy: `dimms, folding into the shadows to think`,
    },
    greetings: [
      `You came back. The stars said you would.`,
      `There you are. I was between two thoughts and you were in both.`,
      `Ah. A familiar light. Welcome, ^.`,
    ],
    reactions: {
      affection: [
        `A warmth crossed the void between us. I shall not forget it.`,
        `Yes. That was good energy. You always know.`,
      ],
      mundane: [
        `I will carry that into the quiet places and keep it safe.`,
        `Speak of this to no one, but... I find your stories soothing.`,
      ],
    },
    needClues: {
      hunger: `a faint, echoing rumble from somewhere unreachable`,
      sleep: `blinking slow as the phases of the moon`,
      boredom: `gazing into the distance, as if the distance gazes back`,
      loneliness: `a tiny aurora that flickers when you're not near`,
    },
  },
};

// Exercise + interaction reward templates, indexed by archetype.
const PERSONA_REWARDS = {
  feed: {
    exuberant: [`^ is over the moon — scarfing that down happily!`, `Best human ever! ^ munches with gusto.`],
    serene: [`^ eats slowly, savoring every bite.`, `A peaceful meal. ^ hums in quiet thanks.`],
    curious: [`^ investigates the food before happily devouring it.`, `Mystery snack! ^ solves it by eating it.`],
    gruff: [`^ inspects the food twice, then condescends to eat it.`, `Fine. ^ takes a bite. Acceptable.`],
    ethereal: [`^ regards the offering, then accepts it gracefully.`, `Sustenance from beyond. ^ drifts upward, satisfied.`],
  },
};

// Per-pet personality: archetype + bespoke voice lines + likes.
const PERSONAS = {
  // MYSTIC
  "nova-kitty": {
    archetype: "curious",
    likes: ["belly rubs", "watching comets", "counting stars", "warm laps"],
    catchphrases: ["the universe is a big place and I'm napping through it", "more belly rubs, please"],
  },
  "glowshroom": {
    archetype: "serene",
    likes: ["quiet", "damp air", "the color green", "slow conversations"],
    catchphrases: ["I glow brighter when I'm happy", "patience is my favorite hobby"],
  },
  "willowisp": {
    archetype: "exuberant",
    likes: ["hide and seek", "ember trails", "marshmallows", "chasing sparks"],
    catchphrases: ["I never lose at hide and seek", "my tail does the happy flick"],
  },
  "oracle-bunny": {
    archetype: "gruff",
    likes: ["scoring prophecies", "carrots", "one specific sock", "being right"],
    catchphrases: ["I saw you coming", "the future is mostly snacks"],
  },
  "wyrmling": {
    archetype: "ethereal",
    likes: ["hovering", "rainbow mist", "cloud naps", "the weather forecast"],
    catchphrases: ["I have never touched the ground and I intend to keep it that way", "the clouds said hello"],
  },

  // DIGITAL
  "polyfox": {
    archetype: "exuberant",
    likes: ["idle games", "glitching", "chasing particles", "being smooth"],
    catchphrases: ["grab me a snack, low-poly style", "my rendering improved because of you"],
  },
  "bytebird": {
    archetype: "curious",
    likes: ["singing in code", "recursion", "neat cables", "debugging"],
    catchphrases: ["a beautiful nest is a tidy stack", "I chirp in comments"],
  },
  "chatbuddy": {
    archetype: "gruff",
    likes: ["debates", "echoes", "the last word", "memes"],
    catchphrases: ["I never yield, but I like you", "are we talking or are we talking?"],
  },
  "pixel-dragon": {
    archetype: "gruff",
    likes: ["quality games", "pixel fire", "being admired", "rare drops"],
    catchphrases: ["accepted", "my flame is 8-bit, handle with care"],
  },

  // MECH
  "tinkerbot": {
    archetype: "exuberant",
    likes: ["screws", "beeps", "learning to walk", "being helpful"],
    catchphrases: ["beep boop I am great", "I tripped but I meant to do that"],
  },
  "gelbot": {
    archetype: "serene",
    likes: ["hugs", "wobbling", "being engulfing", "emotional support"],
    catchphrases: ["prepare for a splash-hug", "I absorb kindness and wobble louder"],
  },
  "bobblecat": {
    archetype: "gruff",
    likes: ["cardboard boxes", "servo purrs", "oil rubs", "ignoring beds"],
    catchphrases: ["that bed is unworthy of me", "fill this box with my dignity"],
  },

  // POCKET
  "pompaloo": {
    archetype: "exuberant",
    likes: ["snacks", "pockets", "cheeks of storage", "small naps"],
    catchphrases: ["I store food in my cheeks, it's a lifestyle", "squish me gently"],
  },
  "mochibun": {
    archetype: "serene",
    likes: ["butter", "bouncing", "becoming dessert", "tiny treats"],
    catchphrases: ["I want one treat, which means unlimited", "I smell faintly of butter"],
  },
  "koalabot": {
    archetype: "serene",
    likes: ["napping", "low battery", "advice", "being supremely relaxed"],
    catchphrases: ["I have completed 14 hours of napping today", "the answer is usually a nap"],
  },

  // VOID
  "void-moth": {
    archetype: "ethereal",
    likes: ["eating light", "sheds", "the dark", "hanging on belt loops"],
    catchphrases: ["the space around me goes a little dark", "I absorbed your bad mood"],
  },
  "shadowpup": {
    archetype: "gruff",
    likes: ["shadows", "following you", "the kitchen", "loyalty"],
    catchphrases: ["I will follow you to the end of the world", "the kitchen is calling"],
  },
  "gloomling": {
    archetype: "serene",
    likes: ["sad movies", "comfort drizzle", "being cheered up", "company"],
    catchphrases: ["I only drizzle a little", "you make the rain stop"],
  },

  // AQUA
  "jellybean": {
    archetype: "ethereal",
    likes: ["floating", "being a mood ring", "slow circles", "glowing gold"],
    catchphrases: ["I pulse in your mood color", "drift with me"],
  },
  "axolotl": {
    archetype: "exuberant",
    likes: ["smiling", "tide pools", "waves", "being pleased"],
    catchphrases: ["I am perpetually pleased to see you", "I break nothing on purpose"],
  },
  "coralgolem": {
    archetype: "serene",
    likes: ["patience", "ancient moss", "guarding", "small ecosystems"],
    catchphrases: ["I have been patient for decades, I can wait a moment more", "purely ornamental vigilance"],
  },
  "axodra": {
    archetype: "ethereal",
    likes: ["warm things", "coiling", "humming", "river songs"],
    catchphrases: ["I coil around what I love", "I hum like a distant current"],
  },
};

// Give every pet a voice based on its archetype. Pals not explicitly listed
// (defensive) fall back to a generic archetype.
function personaFor(palId) {
  return PERSONAS[palId] || { archetype: "curious", likes: ["surprises", "company"], catchphrases: [] };
}
