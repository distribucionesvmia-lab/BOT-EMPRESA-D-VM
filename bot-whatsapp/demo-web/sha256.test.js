import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sha256hex } from "./sha256.js";

test("sha256 coincide con la implementación de Node", () => {
  for (const s of ["", "abc", "600000002:222222", "ñandú ✓", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)]) {
    assert.equal(sha256hex(s), crypto.createHash("sha256").update(s).digest("hex"), JSON.stringify(s.slice(0, 20)));
  }
});
