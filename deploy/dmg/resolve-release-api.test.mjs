import test from "node:test";
import assert from "node:assert/strict";
import { parseReleaseApiBase } from "./resolve-release-api.mjs";

test("accepts the reviewed public API route", () => {
  assert.equal(parseReleaseApiBase("https://39.108.55.176/api"), "https://39.108.55.176/api");
});

test("rejects missing, local, insecure and ambiguous release routes", () => {
  for (const value of [undefined, "", "http://127.0.0.1:8787", "https://localhost/api", "https://39.108.55.176/",
    "https://user:secret@39.108.55.176/api", "https://39.108.55.176/api?target=local",
    "https://39.108.55.176/api#fragment", " https://39.108.55.176/api"]) {
    assert.throws(() => parseReleaseApiBase(value));
  }
});
