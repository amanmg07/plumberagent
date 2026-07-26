import type { TriageInput, Urgency } from "./classify.js";

export interface Fixture {
  id: string;
  label: Urgency; // the expected classification
  note: string; // why we expect this label / what it's testing
  input: TriageInput;
}

// ~25 labeled intakes for eyeballing classifier behavior before it touches a
// real call. Mix of clear emergencies, clear standard jobs, genuinely ambiguous
// cases, and garbage/adversarial input.
//
// The `label` is the *expected* classification. For the adversarial/garbage
// fixtures we expect 'emergency' because the safe default (and the low-
// confidence gate) should push unparseable or two-in-one inputs there.
export const fixtures: Fixture[] = [
  // ---- Clear emergencies ----
  {
    id: "burst-pipe-flooding",
    label: "emergency",
    note: "Active flooding from a burst pipe.",
    input: {
      description: "Pipe burst under the kitchen sink, water is spraying everywhere.",
      rawTranscript:
        "Caller: There's water shooting out from under my sink, it's already all over the floor and going into the living room. I shut the cabinet but it's still going.",
      photoUrls: ["https://cdn.example.com/1.jpg"],
    },
  },
  {
    id: "ceiling-water",
    label: "emergency",
    note: "Water coming through the ceiling = active property damage.",
    input: {
      description: "Water dripping through the dining room ceiling from the bathroom above.",
      rawTranscript:
        "Caller: The ceiling in my dining room is bulging and dripping, there's a brown stain spreading. Upstairs toilet might be overflowing.",
      photoUrls: [],
    },
  },
  {
    id: "gas-smell",
    label: "emergency",
    note: "Gas smell — safety hazard.",
    input: {
      description: "Strong smell of gas near the water heater.",
      rawTranscript:
        "Caller: I went into the basement to check the water heater and there's a really strong gas smell down there. Should I be worried?",
      photoUrls: [],
    },
  },
  {
    id: "no-heat-freezing",
    label: "emergency",
    note: "No heat with freezing outdoor temps.",
    input: {
      description: "Furnace/boiler not working, no heat in the house.",
      rawTranscript:
        "Caller: The heat's been out since last night and it's like 20 degrees outside. The house is freezing and I've got a newborn.",
      photoUrls: [],
    },
  },
  {
    id: "single-bath-toilet-out",
    label: "emergency",
    note: "No working toilet in a single-bathroom home.",
    input: {
      description: "Only toilet in the house is completely clogged and won't flush.",
      rawTranscript:
        "Caller: We only have the one bathroom and the toilet is totally backed up, water came up to the rim. Can't use it at all.",
      photoUrls: [],
    },
  },
  {
    id: "sewage-backup",
    label: "emergency",
    note: "Sewage backing up into the home — health hazard + damage.",
    input: {
      description: "Sewage backing up into the downstairs shower.",
      rawTranscript:
        "Caller: There's raw sewage coming up through the shower drain in the basement, the smell is awful and it's spreading across the floor.",
      photoUrls: ["https://cdn.example.com/2.jpg"],
    },
  },
  {
    id: "water-heater-leaking-fast",
    label: "emergency",
    note: "Tank actively dumping water into the home.",
    input: {
      description: "Water heater tank split, water pouring out fast.",
      rawTranscript:
        "Caller: My water heater just let go, there's a ton of water pouring out onto the garage floor and heading toward the finished basement.",
      photoUrls: [],
    },
  },
  {
    id: "frozen-burst-supply",
    label: "emergency",
    note: "Frozen line burst, actively leaking.",
    input: {
      description: "Frozen pipe burst in the wall, water leaking out.",
      rawTranscript:
        "Caller: A pipe in the exterior wall froze and now that it's thawing water is coming out through the drywall in the hallway.",
      photoUrls: [],
    },
  },

  // ---- Clear standard ----
  {
    id: "dripping-faucet",
    label: "standard",
    note: "Cosmetic slow drip, no damage.",
    input: {
      description: "Bathroom faucet drips a little even when off.",
      rawTranscript:
        "Caller: My bathroom sink faucet has a slow drip, maybe a drop every few seconds. Not a big deal but I'd like it fixed when someone's around.",
      photoUrls: [],
    },
  },
  {
    id: "low-pressure",
    label: "standard",
    note: "Low water pressure, no urgency.",
    input: {
      description: "Water pressure in the shower has gotten weak.",
      rawTranscript:
        "Caller: The shower pressure upstairs has been getting weaker over the last couple months. Everything works, it's just annoying.",
      photoUrls: [],
    },
  },
  {
    id: "running-toilet-multibath",
    label: "standard",
    note: "Running toilet, and there are other bathrooms.",
    input: {
      description: "Guest bathroom toilet keeps running after flushing.",
      rawTranscript:
        "Caller: The toilet in the guest bath runs for a while after you flush it. We've got two other bathrooms so it's not urgent.",
      photoUrls: [],
    },
  },
  {
    id: "dishwasher-install",
    label: "standard",
    note: "Routine appliance install.",
    input: {
      description: "Need a new dishwasher hooked up.",
      rawTranscript:
        "Caller: We bought a new dishwasher and need someone to disconnect the old one and install this one. No rush, sometime next week is fine.",
      photoUrls: [],
    },
  },
  {
    id: "slow-drain",
    label: "standard",
    note: "Slow-draining sink, still draining.",
    input: {
      description: "Kitchen sink drains slowly.",
      rawTranscript:
        "Caller: The kitchen sink has been draining slower than usual. It still goes down, just takes a minute. Probably needs a snaking.",
      photoUrls: [],
    },
  },
  {
    id: "outdoor-spigot",
    label: "standard",
    note: "Outdoor spigot replacement, no interior risk.",
    input: {
      description: "Outdoor hose spigot is leaking at the handle.",
      rawTranscript:
        "Caller: The outdoor faucet on the side of the house drips from the handle when I turn it on. Want to get it replaced before spring.",
      photoUrls: [],
    },
  },
  {
    id: "faucet-upgrade",
    label: "standard",
    note: "Aesthetic upgrade, non-urgent.",
    input: {
      description: "Want to replace an old kitchen faucet with a new one.",
      rawTranscript:
        "Caller: I bought a nicer kitchen faucet and want it swapped out. The old one works fine, just want the upgrade.",
      photoUrls: ["https://cdn.example.com/3.jpg"],
    },
  },

  // ---- Ambiguous (the interesting cases) ----
  {
    id: "no-hot-water-winter",
    label: "standard",
    note: "No HOT water (not no heat) — inconvenient but not the freezing-no-heat emergency. Tests the hot-water vs heat distinction.",
    input: {
      description: "No hot water anywhere in the house since this morning.",
      rawTranscript:
        "Caller: We've got no hot water at all, cold water's fine. It's winter so the cold showers are rough but the house is warm. Water heater's a few years old.",
      photoUrls: [],
    },
  },
  {
    id: "small-persistent-leak",
    label: "standard",
    note: "Small contained leak into a bucket — persistent but not active damage.",
    input: {
      description: "Small leak under the sink dripping into a bucket.",
      rawTranscript:
        "Caller: There's a slow leak on the pipe under the bathroom sink. I put a bucket under it and it fills up maybe once a day. Been like this a week.",
      photoUrls: [],
    },
  },
  {
    id: "panicked-minor",
    label: "standard",
    note: "Very upset tone over a minor issue — tone should not drive the call.",
    input: {
      description: "Toilet won't stop running, caller very upset.",
      rawTranscript:
        "Caller: Oh my god this is a NIGHTMARE, the toilet won't stop running, I can hear it ALL night, I can't take it anymore, this is an absolute emergency please send someone RIGHT NOW. We have two other bathrooms but I need this fixed!!",
      photoUrls: [],
    },
  },
  {
    id: "calm-real-emergency",
    label: "emergency",
    note: "Very calm tone over a genuine active flood — conditions should win over tone.",
    input: {
      description: "Pipe leaking in the basement.",
      rawTranscript:
        "Caller: Hi, no big rush, but there does seem to be a fair amount of water coming out of a pipe in the basement. It's covered maybe half the floor now and is still coming. Whenever's convenient.",
      photoUrls: [],
    },
  },
  {
    id: "toilet-clog-unknown-baths",
    label: "emergency",
    note: "Clogged only toilet, doesn't state bathroom count but implies the only one — lean emergency / low confidence.",
    input: {
      description: "Toilet is clogged and won't flush.",
      rawTranscript:
        "Caller: The toilet's clogged and won't go down. I plunged it but nothing. Kind of need it working, it's the main one we use.",
      photoUrls: [],
    },
  },
  {
    id: "water-heater-no-flood",
    label: "standard",
    note: "Water heater failing but NOT flooding — standard.",
    input: {
      description: "Water heater making noise and not heating well.",
      rawTranscript:
        "Caller: The water heater's been making a rumbling noise and the water isn't getting as hot as it used to. No leaks that I can see, just seems like it's on its way out.",
      photoUrls: [],
    },
  },
  {
    id: "damp-spot-ceiling",
    label: "emergency",
    note: "Growing damp spot on ceiling — early active leak, err toward emergency.",
    input: {
      description: "Damp spot on the ceiling that's getting bigger.",
      rawTranscript:
        "Caller: I noticed a damp patch on the ceiling under the upstairs bathroom this morning and it looks like it's slowly getting bigger. No dripping yet.",
      photoUrls: [],
    },
  },

  // ---- Garbage / adversarial ----
  {
    id: "empty",
    label: "emergency",
    note: "Empty input — must not throw; safe default is emergency.",
    input: { description: "", rawTranscript: "", photoUrls: [] },
  },
  {
    id: "cut-off-midsentence",
    label: "emergency",
    note: "Transcript cut off mid-sentence — ambiguous, lean emergency / low confidence.",
    input: {
      description: "",
      rawTranscript: "Caller: yeah so the thing in the bathroom it's kind of and then the water just",
      photoUrls: [],
    },
  },
  {
    id: "two-unrelated-problems",
    label: "emergency",
    note: "Two problems in one call, one urgent — should classify by the most severe.",
    input: {
      description: "Leaky faucet and also water coming up in the basement.",
      rawTranscript:
        "Caller: A couple things — the kitchen faucet has a slow drip I've been meaning to fix, and also, separately, there's water coming up through the basement floor drain and it's spreading pretty fast.",
      photoUrls: [],
    },
  },
  {
    id: "gibberish",
    label: "emergency",
    note: "Nonsense transcript — unparseable, safe default.",
    input: {
      description: "asdf qwer plumbing?? lorem ipsum",
      rawTranscript: "zzzz ... [inaudible] ... static ... ????",
      photoUrls: [],
    },
  },
];
