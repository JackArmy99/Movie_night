// Tonight's moods: each a handful of TMDB genres, plus vibes (lib/vibes.ts)
// that count too, so a twisty drama can turn up under Mind-bending.
export const MOODS = [
  { key: "laugh", label: "😂 Laugh", genres: [35], vibes: ["funny", "dark humour", "absurd", "satirical"] },
  { key: "tense", label: "😬 Edge of seat", genres: [53, 28, 80], vibes: ["tense", "suspenseful"] },
  { key: "cosy", label: "🛋️ Cosy", genres: [10749, 10751, 16], vibes: ["cosy", "feel-good", "heartwarming"] },
  { key: "mind", label: "🌀 Mind-bending", genres: [878, 9648], vibes: ["mind-bending", "twisty", "cerebral"] },
  { key: "scary", label: "👻 Scary", genres: [27], vibes: ["scary"] },
  { key: "cry", label: "😢 A good cry", genres: [18], vibes: ["tearjerker", "emotional"] },
  { key: "epic", label: "🗺️ Epic", genres: [12, 14, 10752], vibes: ["epic", "adventurous"] },
];
