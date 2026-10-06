import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "./src/extract.js";

test("text under budget is returned whole, whitespace collapsed", () => {
  assert.equal(extract("Hello\n\n  world.", 100), "Hello world.");
});

test("drops UI fragments, prefers on-topic sentences, keeps page order and budget", () => {
  const page = [
    "Join", "Share", "47 comments",
    "The telescope mirror is made of gold-plated beryllium segments.",
    "My cat enjoys sleeping on the warm windowsill every single afternoon.",
    "The telescope observes infrared light from the earliest galaxies.",
    "Launch of the telescope happened on an Ariane rocket in December.",
    "Upvote",
  ].join("\n");
  const out = extract(page, 140);
  assert.ok(out.length <= 140, out);
  assert.ok(!/Join|Share|comments|Upvote|cat/.test(out), out);
  assert.ok(out.indexOf("mirror") < out.indexOf("infrared"), out);
});

test("falls back to a plain cut when no sentence qualifies", () => {
  assert.equal(extract("a b c\n".repeat(50), 20), "a b c a b c a b c a ");
});
