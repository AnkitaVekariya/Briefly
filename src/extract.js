const STOP = new Set(
  "about after also been before being between both could does each from have here into just like more most much only other over said same should some such than that their them then there these they this those through under very want were what when where which while will with would your".split(" "),
);

const words = (s) => (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w));

// Pick the most informative sentences, scored by how common their words are across the page,
// up to `budget` chars, returned in page order. Short fragments (nav, buttons, "47 comments") are dropped.
export function extract(text, budget) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= budget) return flat;

  const sentences = text
    .split("\n")
    .flatMap((line) => line.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [])
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.split(" ").length >= 6);

  const freq = new Map();
  for (const s of sentences) for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const score = (s) => {
    const ws = words(s);
    return ws.length ? ws.reduce((sum, w) => sum + freq.get(w), 0) / ws.length : 0;
  };

  const ranked = sentences.map((s, i) => ({ s, i, score: score(s) })).sort((a, b) => b.score - a.score);
  const picked = [];
  let used = 0;
  for (const r of ranked) {
    if (used + r.s.length + 1 > budget) continue;
    picked.push(r);
    used += r.s.length + 1;
  }
  return picked.length ? picked.sort((a, b) => a.i - b.i).map((r) => r.s).join(" ") : flat.slice(0, budget);
}
