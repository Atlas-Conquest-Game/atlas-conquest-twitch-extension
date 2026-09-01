import test from "node:test";
import assert from "node:assert/strict";
import {
  applySnapshot, emptyBoard, isMoving, cellToViewport, hexRadius,
  mergeIntervals, estimateClockSkew,
  parseBroadcasterConfig, clampDelay, DEFAULT_CONFIG, MAX_DELAY_MS,
  type Snapshot, type Affine,
} from "./protocol.ts";

// O=(0,0)  U=(1,0)  V=(0,1)  no parity offsets
const IDENTITY: Affine = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0];

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

test("cellToViewport applies the linear part", () => {
  const a: Affine = [0.5, 0.5, 0.1, 0.0, 0.0, 0.08, 0, 0, 0, 0];
  assert.deepEqual(cellToViewport(a, 2, 3), { x: 0.5 + 0.2, y: 0.5 + 0.24 });
});

test("odd rows pick up the parity offset, even rows do not", () => {
  // Wr = (0.05, 0). This is the half-cell stagger that a plain affine cannot
  // express, and getting it wrong put hitboxes ~900px out at the board edges.
  const a: Affine = [0, 0, 0.1, 0, 0, 0.08, 0, 0, 0.05, 0];
  assert.equal(cellToViewport(a, 0, 2).x, 0.0, "even row: no stagger");
  assert.equal(cellToViewport(a, 0, 3).x, 0.05, "odd row: staggered half a cell");
});

test("the serialized basis matches a real Unity board", () => {
  // Not a simulation. These numbers were measured on a live Dunes board in the
  // editor: the affine is exactly what TwitchSnapshot.ToJson emitted at its
  // "0.####" precision, and the expected values are Camera.WorldToViewportPoint
  // on the same cells at the same camera.
  //
  // The simulation above proves the maths is self-consistent; this proves the
  // C# publisher and this TS reader actually agree about a specific board. It
  // is the only test here that would catch the two drifting apart.
  const a: Affine = [0.277, 0.7482, 0.1694, 0, 0, 0.2259, 0, 0, 0.0847, 0];

  // Wr.x = 0.0847 is half of U.x = 0.1694 -- the half-cell stagger on odd rows,
  // the term a six-float affine has nowhere to put.
  const unity: Array<[number, number, number, number]> = [
    [0, 0, 0.276985317, 0.7482353],
    [1, 0, 0.4463971, 0.7482353],
    [0, 1, 0.361691177, 0.9741176],
    [7, 3, 1.54757345, 1.42588234],
    [10, 10, 1.9711026, 3.00705862],
    [-3, 5, -0.146544039, 1.87764692],   // off-board: parity must hold for negatives
  ];

  let worstPx = 0;
  for (const [q, r, x, y] of unity) {
    const got = cellToViewport(a, q, r);
    worstPx = Math.max(worstPx, Math.abs(got.x - x) * 1920, Math.abs(got.y - y) * 1080);
  }

  // Sub-pixel. The residual is the 4dp quantisation of U and V multiplied by the
  // cell index, which is why it grows towards the far corner rather than being
  // uniform. A hex is ~50px across at typical zoom, so this is invisible.
  assert.ok(worstPx < 0.5, `worst disagreement with Unity was ${worstPx.toFixed(4)}px`);
});

test("the five-probe basis reproduces a real hex layout exactly", () => {
  // Simulate Unity: pointy-top hex cell->world, then an orthographic camera.
  // This is the regression test for the parity bug -- a three-probe affine fit
  // to the same board is out by hundreds of pixels toward the edges.
  const cell = (q: number, r: number) => ({
    x: q * 1.0 + (q & 1 ? 0 : 0) + (r & 1 ? 0.5 : 0),
    y: r * 0.75,
  });
  const cam = { cx: 1.3, cy: -2.1, S: 4.2, A: 16 / 9 };
  const project = (q: number, r: number) => {
    const w = cell(q, r);
    return { x: (w.x - cam.cx) / (2 * cam.S * cam.A) + 0.5, y: (w.y - cam.cy) / (2 * cam.S) + 0.5 };
  };

  // Solve exactly as TwitchBroadcastPublisher.SolveProjection does.
  const p00 = project(0, 0), p20 = project(2, 0), p02 = project(0, 2);
  const p10 = project(1, 0), p01 = project(0, 1);
  const ux = (p20.x - p00.x) / 2, uy = (p20.y - p00.y) / 2;
  const vx = (p02.x - p00.x) / 2, vy = (p02.y - p00.y) / 2;
  const basis: Affine = [
    p00.x, p00.y, ux, uy, vx, vy,
    p10.x - p00.x - ux, p10.y - p00.y - uy,
    p01.x - p00.x - vx, p01.y - p00.y - vy,
  ];

  let worstPx = 0;
  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      const got = cellToViewport(basis, q, r);
      const want = project(q, r);
      worstPx = Math.max(worstPx, Math.abs(got.x - want.x) * 1920, Math.abs(got.y - want.y) * 1080);
    }
  }
  assert.ok(worstPx < 0.001, `worst error ${worstPx}px across the board should be ~0`);
});

test("hexRadius scales with zoom instead of being sent separately", () => {
  const near: Affine = [0.5, 0.5, 0.2, 0, 0, 0.2, 0, 0, 0, 0];
  const far: Affine  = [0.5, 0.5, 0.1, 0, 0, 0.1, 0, 0, 0, 0];
  assert.ok(hexRadius(near) > hexRadius(far));
  assert.equal(hexRadius(near), 0.1);
});

// --- interval merging -------------------------------------------------------

test("an open interval is replaced, not duplicated, when re-sent", () => {
  // The publisher re-sends the same open interval every snapshot until the
  // camera settles. Appending would pile up duplicates of a span that never ends.
  let held = mergeIntervals([], [[1000, null]]);
  held = mergeIntervals(held, [[1000, null]]);
  held = mergeIntervals(held, [[1000, null]]);
  assert.equal(held.length, 1);
});

test("closing an interval clears the open-ended version", () => {
  let held = mergeIntervals([], [[1000, null]]);
  held = mergeIntervals(held, [[1000, 1600]]);
  assert.deepEqual(held, [[1000, 1600]]);
  assert.equal(isMoving(held, 5000, 0), false,
    "hitboxes must come back after the pan ends");
});

test("distinct pans accumulate", () => {
  let held = mergeIntervals([], [[1000, 1200]]);
  held = mergeIntervals(held, [[3000, 3400]]);
  assert.equal(held.length, 2);
  assert.equal(isMoving(held, 1100, 0), true);
  assert.equal(isMoving(held, 2000, 0), false);
  assert.equal(isMoving(held, 3200, 0), true);
});

test("intervals too old to matter are dropped", () => {
  const held = mergeIntervals([[1000, 1200]], [[90_000, 90_500]], 100_000, 60_000);
  assert.deepEqual(held, [[90_000, 90_500]]);
});

test("an open interval survives pruning regardless of age", () => {
  const held = mergeIntervals([[1000, null]], [], 100_000, 60_000);
  assert.equal(held.length, 1, "still moving; dropping it would un-blank hitboxes mid-pan");
});

// --- clock skew -------------------------------------------------------------

test("skew estimate ignores a single delayed message", () => {
  // Snapshot stamps come from the streamer's clock, which may disagree with the
  // viewer's by any amount. Four samples agreeing on ~500ms, one outlier at 9s.
  assert.equal(estimateClockSkew([500, 505, 495, 9000, 500]), 500);
});

test("no samples means assume no skew", () => {
  assert.equal(estimateClockSkew([]), 0);
});

// --- broadcaster config ------------------------------------------------------

test("config round-trips what the config page writes", () => {
  const written = JSON.stringify({ delayMs: 7500, boardHover: false });
  assert.deepEqual(parseBroadcasterConfig(written), { delayMs: 7500, boardHover: false });
});

test("a missing or unreadable config falls back to defaults", () => {
  // A streamer who never opened the config page has no stored segment at all,
  // which is the common case rather than an error.
  for (const raw of [undefined, null, "", "not json", "[1,2,3]", "null"]) {
    assert.deepEqual(parseBroadcasterConfig(raw), DEFAULT_CONFIG, `failed for ${String(raw)}`);
  }
});

test("unknown or missing fields fall back individually, not wholesale", () => {
  // A config written by a newer version must not discard the fields this one
  // does understand -- that would silently reset a streamer's delay on rollback.
  const partial = JSON.stringify({ delayMs: 9000, somethingNew: true });
  assert.deepEqual(parseBroadcasterConfig(partial), {
    delayMs: 9000,
    boardHover: DEFAULT_CONFIG.boardHover,
  });
});

test("implausible delays are clamped rather than trusted", () => {
  // Negative would render snapshots that have not happened yet; enormous would
  // park the overlay before the match started.
  assert.equal(clampDelay(-5000), 0);
  assert.equal(clampDelay(999_999), MAX_DELAY_MS);
  assert.equal(clampDelay(Number.NaN), DEFAULT_CONFIG.delayMs);
  assert.equal(clampDelay("6000"), DEFAULT_CONFIG.delayMs, "a string delay is not a number");
  assert.equal(clampDelay(4321.7), 4322, "sub-millisecond precision is meaningless here");
});
