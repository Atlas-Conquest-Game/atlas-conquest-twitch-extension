import test from "node:test";
import assert from "node:assert/strict";
import {
  applySnapshot, emptyBoard, isMoving, cellToViewport, hexRadius,
  type Snapshot, type Affine,
} from "./protocol.ts";

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function keyframe(seq: number, entities: number[][] = []): Snapshot {
  return { v: 1, t: 1000 + seq, s: seq, k: 1, a: IDENTITY, e: entities as any };
}

test("keyframe establishes state from nothing", () => {
  const s = applySnapshot(emptyBoard(), keyframe(0, [[1, 7, 2, 3, 5, 0]]));
  assert.ok(s);
  assert.equal(s.entities.size, 1);
  assert.deepEqual(s.entities.get(1), [1, 7, 2, 3, 5, 0]);
});

test("delta before any keyframe is rejected rather than half-applied", () => {
  const delta: Snapshot = { v: 1, t: 1, s: 5, k: 0, e: [[1, 7, 0, 0, 5, 0]] };
  assert.equal(applySnapshot(emptyBoard(), delta), null);
});

test("delta after a sequence gap is rejected", () => {
  const base = applySnapshot(emptyBoard(), keyframe(0))!;
  const skipped: Snapshot = { v: 1, t: 2, s: 2, k: 0, e: [[1, 7, 0, 0, 5, 0]] };
  assert.equal(applySnapshot(base, skipped), null,
    "a gap means we cannot vouch for the board; wait for the next keyframe");
});

test("deltas add, mutate, and remove entities", () => {
  let s = applySnapshot(emptyBoard(), keyframe(0, [[1, 7, 0, 0, 5, 0], [2, 8, 1, 1, 3, 1]]))!;
  s = applySnapshot(s, { v: 1, t: 2, s: 1, k: 0, e: [[1, 7, 0, 0, 2, 0]] })!;   // damaged
  assert.equal(s.entities.get(1)![4], 2);
  s = applySnapshot(s, { v: 1, t: 3, s: 2, k: 0, x: [2] })!;                      // died
  assert.equal(s.entities.size, 1);
  assert.equal(s.entities.has(2), false);
});

test("replaying deltas reproduces the state a later keyframe asserts", () => {
  let viaDeltas = applySnapshot(emptyBoard(), keyframe(0, [[1, 7, 0, 0, 5, 0]]))!;
  viaDeltas = applySnapshot(viaDeltas, { v: 1, t: 2, s: 1, k: 0, e: [[2, 8, 1, 1, 4, 1]] })!;
  viaDeltas = applySnapshot(viaDeltas, { v: 1, t: 3, s: 2, k: 0, e: [[1, 7, 0, 0, 1, 0]] })!;

  const viaKeyframe = applySnapshot(emptyBoard(),
    keyframe(3, [[1, 7, 0, 0, 1, 0], [2, 8, 1, 1, 4, 1]]))!;

  assert.deepEqual(
    [...viaDeltas.entities.entries()].sort(),
    [...viaKeyframe.entities.entries()].sort());
});

test("keyframe resyncs a viewer who joined mid-stream", () => {
  const stale = applySnapshot(emptyBoard(), keyframe(0, [[9, 1, 0, 0, 1, 0]]))!;
  const fresh = applySnapshot(stale, keyframe(50, [[1, 7, 0, 0, 5, 0]]))!;
  assert.equal(fresh.entities.has(9), false, "keyframe replaces state, never merges");
  assert.equal(fresh.seq, 50);
});

test("affine persists across deltas that omit it", () => {
  let s = applySnapshot(emptyBoard(), keyframe(0))!;
  s = applySnapshot(s, { v: 1, t: 2, s: 1, k: 0, e: [] })!;
  assert.deepEqual(s.affine, IDENTITY, "camera did not move, so no affine was sent");
});

// --- motion intervals -------------------------------------------------------

test("a sub-second pan entirely between two snapshots still blanks hitboxes", () => {
  // The exact bug the interval design exists to prevent: at 1Hz, sampling an
  // inMotion boolean at t=1000 and t=2000 would miss this pan completely.
  const intervals: [number, number | null][] = [[1200, 1700]];
  assert.equal(isMoving(intervals, 1000, 0), false);
  assert.equal(isMoving(intervals, 1450, 0), true, "mid-pan must blank");
  assert.equal(isMoving(intervals, 2000, 0), false);
});

test("blanking leads motion by the configured margin", () => {
  const intervals: [number, number | null][] = [[1000, 1500]];
  assert.equal(isMoving(intervals, 950, 100), true, "hides early, which is invisible");
  assert.equal(isMoving(intervals, 850, 100), false);
});

test("an open interval blanks indefinitely until closed", () => {
  assert.equal(isMoving([[1000, null]], 99999, 0), true);
});

// --- projection -------------------------------------------------------------

test("cellToViewport applies the affine", () => {
  const a: Affine = [0.1, 0.05, 0.0, 0.08, 0.5, 0.5];
  assert.deepEqual(cellToViewport(a, 2, 3), { x: 0.1 * 2 + 0.05 * 3 + 0.5, y: 0.08 * 3 + 0.5 });
});

test("hexRadius scales with zoom instead of being sent separately", () => {
  const near: Affine = [0.2, 0, 0, 0.2, 0.5, 0.5];
  const far: Affine  = [0.1, 0, 0, 0.1, 0.5, 0.5];
  assert.ok(hexRadius(near) > hexRadius(far));
  assert.equal(hexRadius(near), 0.1);
});
