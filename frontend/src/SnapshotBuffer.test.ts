import test from "node:test";
import assert from "node:assert/strict";
import { SnapshotBuffer } from "./SnapshotBuffer.ts";
import type { Snapshot, Affine } from "../../shared/protocol.ts";

const BASIS: Affine = [0, 0, 0.1, 0, 0, 0.08, 0, 0, 0.05, 0];

function keyframe(t: number, s: number, entities: number[][] = []): Snapshot {
  return { v: 1, t, s, k: 1, a: BASIS, e: entities as any };
}
function delta(t: number, s: number, patch: Partial<Snapshot> = {}): Snapshot {
  return { v: 1, t, s, k: 0, ...patch };
}

test("renders the delayed frame, not the newest state", () => {
  const buf = new SnapshotBuffer(4000);
  // No clock skew: stamps and arrivals agree.
  buf.ingest(keyframe(10_000, 0, [[1, 7, 0, 0, 5, 0]]), 10_000);
  buf.ingest(delta(13_000, 1, { e: [[1, 7, 0, 0, 1, 0]] as any }), 13_000);

  // Viewer at 14_000 is watching the 10_000 frame.
  const state = buf.stateAt(14_000);
  assert.equal(state?.entities.get(1)?.[4], 5,
    "the health drop at 13s has not reached the viewer's screen yet");

  assert.equal(buf.stateAt(17_000)?.entities.get(1)?.[4], 1,
    "once the video catches up, the drop is visible");
});

test("corrects for a streamer clock that disagrees with the viewer's", () => {
  const buf = new SnapshotBuffer(4000);
  // Streamer's clock runs 30s behind this browser's.
  buf.ingest(keyframe(10_000, 0, [[1, 7, 0, 0, 5, 0]]), 40_000);
  buf.ingest(delta(13_000, 1, { e: [[1, 7, 0, 0, 1, 0]] as any }), 43_000);

  assert.equal(buf.clockSkewMs, 30_000);
  assert.equal(buf.stateAt(44_000)?.entities.get(1)?.[4], 5,
    "a 30s clock offset must not shift which frame is rendered");
  assert.equal(buf.stateAt(47_000)?.entities.get(1)?.[4], 1);
});

test("nothing renders until a keyframe has arrived", () => {
  const buf = new SnapshotBuffer(0);
  buf.ingest(delta(1000, 5, { e: [[1, 7, 0, 0, 5, 0]] as any }), 1000);
  assert.equal(buf.stateAt(2000), null);
});

test("a viewer joining mid-match syncs on the next keyframe", () => {
  const buf = new SnapshotBuffer(0);
  buf.ingest(delta(1000, 41, { e: [[1, 7, 0, 0, 5, 0]] as any }), 1000);
  assert.equal(buf.stateAt(1500), null, "orphan deltas are not renderable");

  buf.ingest(keyframe(2000, 42, [[1, 7, 0, 0, 3, 0]]), 2000);
  assert.equal(buf.stateAt(2500)?.entities.get(1)?.[4], 3);
});

test("a dropped message costs one keyframe, not the whole session", () => {
  const buf = new SnapshotBuffer(0);
  buf.ingest(keyframe(1000, 0, [[1, 7, 0, 0, 5, 0]]), 1000);
  // seq 1 never arrives.
  buf.ingest(delta(2000, 2, { e: [[1, 7, 0, 0, 1, 0]] as any }), 2000);

  assert.equal(buf.stateAt(2500)?.entities.get(1)?.[4], 5,
    "the gapped delta is refused rather than applied out of order");

  buf.ingest(keyframe(3000, 3, [[1, 7, 0, 0, 1, 0]]), 3000);
  assert.equal(buf.stateAt(3500)?.entities.get(1)?.[4], 1, "keyframe repairs it");
});

test("out-of-order arrivals are ordered by stamp", () => {
  const buf = new SnapshotBuffer(0);
  buf.ingest(keyframe(1000, 0, [[1, 7, 0, 0, 5, 0]]), 1000);
  buf.ingest(delta(3000, 2, { e: [[1, 7, 0, 0, 1, 0]] as any }), 3000);
  buf.ingest(delta(2000, 1, { e: [[2, 8, 1, 1, 4, 1]] as any }), 3100); // late

  const state = buf.stateAt(4000);
  assert.equal(state?.entities.size, 2);
  assert.equal(state?.entities.get(1)?.[4], 1, "both deltas applied in stamp order");
});

test("hitboxes blank across a pan that no snapshot sampled", () => {
  const buf = new SnapshotBuffer(4000);
  buf.ingest(keyframe(10_000, 0), 10_000);
  // A 300ms flick between snapshots. A sampled boolean would have missed it.
  buf.ingest(delta(11_000, 1, { m: [[10_400, 10_700]] }), 11_000);

  assert.equal(buf.cameraMoving(14_300, 0), false);
  assert.equal(buf.cameraMoving(14_500, 0), true, "mid-pan, on the viewer's screen");
  assert.equal(buf.cameraMoving(14_800, 0), false);
});

test("blanking begins before the pan is visible", () => {
  const buf = new SnapshotBuffer(4000);
  buf.ingest(keyframe(10_000, 0), 10_000);
  buf.ingest(delta(11_000, 1, { m: [[10_400, 10_700]] }), 11_000);

  assert.equal(buf.cameraMoving(14_350, 100), true,
    "hidden 50ms early: invisible to a viewer, and covers delay-setting error");
});

test("an ongoing pan keeps hitboxes hidden until it closes", () => {
  const buf = new SnapshotBuffer(0);
  buf.ingest(keyframe(1000, 0), 1000);
  buf.ingest(delta(2000, 1, { m: [[1500, null]] }), 2000);
  assert.equal(buf.cameraMoving(9000, 0), true);

  buf.ingest(delta(3000, 2, { m: [[1500, 2500]] }), 3000);
  assert.equal(buf.cameraMoving(9000, 0), false, "closed span must release the hitboxes");
});

test("old snapshots are pruned without losing the renderable keyframe", () => {
  const buf = new SnapshotBuffer(0);
  // Realistic traffic: a keyframe every 5s, deltas in between.
  let seq = 0;
  buf.ingest(keyframe(0, seq++, [[1, 7, 0, 0, 5, 0]]), 0);
  for (let t = 1000; t <= 120_000; t += 1000) {
    buf.ingest(t % 5000 === 0
      ? keyframe(t, seq++, [[1, 7, 0, 0, 5, 0]])
      : delta(t, seq++, {}), t);
  }

  assert.ok(buf.size < 121, `buffer is bounded (was ${buf.size})`);
  assert.ok(buf.stateAt(120_000) !== null,
    "pruning must never strand the buffer without an anchoring keyframe");
});

test("a publisher that never sends keyframes cannot grow the buffer forever", () => {
  // The prune rule deliberately refuses to drop a lone keyframe, so without a
  // hard cap a client that stopped sending them would leak memory in every
  // viewer's browser.
  const buf = new SnapshotBuffer(0);
  buf.ingest(keyframe(0, 0, [[1, 7, 0, 0, 5, 0]]), 0);
  for (let i = 1; i <= 2000; i++) buf.ingest(delta(i * 100, i, {}), i * 100);

  assert.ok(buf.size <= 600, `hard cap holds (was ${buf.size})`);
});

test("the board clears once the streamer leaves the match", () => {
  // The game publishes a keyframe every 5s in a match and nothing outside one.
  const buf = new SnapshotBuffer(4000);
  buf.ingest(keyframe(10_000, 0, [[1, 7, 0, 0, 5, 0]]), 10_000);
  buf.ingest(keyframe(15_000, 1, [[1, 7, 0, 0, 5, 0]]), 15_000);
  assert.ok(buf.stateAt(19_000 + 11_000), "still in the match within the grace period");
  assert.equal(buf.stateAt(19_000 + 13_000), null, "silence past 12s means no match: draw nothing");
});

test("a new match after leaving shows the new board, not the old one", () => {
  const buf = new SnapshotBuffer(0);
  buf.ingest(keyframe(10_000, 40, [[1, 7, 0, 0, 5, 0]]), 10_000);
  // Left, went to the deck editor, started again: sequence restarts at 0.
  buf.ingest(keyframe(60_000, 0, [[3, 9, 1, 1, 4, 0]]), 60_000);
  const state = buf.stateAt(60_500);
  assert.ok(state);
  assert.equal(state.entities.has(1), false);
  assert.equal(state.entities.get(3)?.[1], 9);
});

test("the stream's language is the newest keyframe's, whatever order they arrive in", () => {
  const b = new SnapshotBuffer(0);
  assert.equal(b.streamLocale, null, "unknown before the first keyframe");
  b.ingest({ ...keyframe(2000, 2), lg: "ja" }, 2000);
  b.ingest({ ...keyframe(1000, 1), lg: "de" }, 2100);
  assert.equal(b.streamLocale, "ja", "a late older keyframe does not win");
  b.ingest({ ...keyframe(3000, 3), lg: "fr" }, 3000);
  assert.equal(b.streamLocale, "fr", "the streamer switching language mid-stream is followed");
});
