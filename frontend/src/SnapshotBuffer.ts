import {
  applySnapshot, emptyBoard, estimateClockSkew, isMoving, mergeIntervals,
  type Affine, type BoardState, type MotionInterval, type Snapshot,
} from "../../shared/protocol.ts";

/**
 * Holds incoming snapshots and answers "what did the board look like in the frame
 * the viewer is currently seeing?"
 *
 * Everything here follows from one fact: the viewer's video is 3-20s behind the
 * game. Snapshots arrive live, so at any moment this buffer knows more than the
 * screen shows. Rendering the newest snapshot would put hitboxes several seconds
 * ahead of the board. So we render the snapshot that matches the delayed frame,
 * and keep the newer ones — which is also what makes motion blanking exact rather
 * than predictive.
 */
export class SnapshotBuffer {
  /** Newest-last. Bounded by pruning below, not by count. */
  private snapshots: Snapshot[] = [];
  private intervals: MotionInterval[] = [];

  /** arrival - stamp, per message. The publisher's clock is not ours. */
  private skewSamples: number[] = [];
  private skew = 0;

  /** How far behind live to render, in ms. Broadcaster-configured. */
  private delayMs: number;

  constructor(delayMs = 4000) {
    this.delayMs = delayMs;
  }

  setDelay(ms: number) {
    this.delayMs = Math.max(0, ms);
  }

  /** Milliseconds of history kept. Comfortably past the worst plausible delay. */
  private static readonly RETAIN_MS = 45_000;

  /** Hard ceiling, ~10 minutes at the publisher's maximum rate. */
  private static readonly MAX_SNAPSHOTS = 600;

  /**
   * Ingest one snapshot. `arrivedAt` is this browser's clock at receipt.
   *
   * Snapshots can arrive out of order, so they are inserted by timestamp rather
   * than pushed; the render path assumes ascending order.
   */
  ingest(snap: Snapshot, arrivedAt = Date.now()) {
    // Transit is milliseconds against a multi-second delay, so arrival minus
    // stamp is a good estimate of how far the two clocks differ.
    this.skewSamples.push(arrivedAt - snap.t);
    if (this.skewSamples.length > 21) this.skewSamples.shift();
    this.skew = estimateClockSkew(this.skewSamples);

    if (snap.m?.length) {
      this.intervals = mergeIntervals(this.intervals, snap.m, snap.t);
    }

    const at = this.snapshots.findIndex((s) => s.t > snap.t);
    if (at === -1) this.snapshots.push(snap);
    else this.snapshots.splice(at, 0, snap);

    this.prune(snap.t);
  }

  private prune(newestStamp: number) {
    const cutoff = newestStamp - SnapshotBuffer.RETAIN_MS;

    // Drop only what sits before the last keyframe old enough to be expendable.
    //
    // Trimming to "the newest snapshot before the cutoff" is not good enough:
    // that snapshot is usually a delta, and a delta chain is worthless without
    // the keyframe it builds on. Cutting there would leave the buffer full and
    // the overlay blank until the next keyframe happened to arrive.
    let anchor = -1;
    for (let i = 0; i < this.snapshots.length; i++) {
      if (this.snapshots[i].t > cutoff) break;
      if (this.snapshots[i].k === 1) anchor = i;
    }

    if (anchor > 0) this.snapshots.splice(0, anchor);

    // Backstop. The rule above intentionally refuses to drop the only keyframe,
    // so a publisher that stops sending them (a bug, or a hostile client) would
    // otherwise grow this without limit. Past this cap, memory safety wins:
    // trim anyway and accept a blank overlay until the next keyframe arrives.
    if (this.snapshots.length > SnapshotBuffer.MAX_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - SnapshotBuffer.MAX_SNAPSHOTS);
    }
  }

  /** The publisher's clock time corresponding to the frame now on screen. */
  renderTime(now = Date.now()): number {
    return now - this.skew - this.delayMs;
  }

  /**
   * Board state as of the currently visible frame, or null if nothing is
   * renderable yet.
   *
   * Folds forward from the most recent keyframe at or before the render time.
   * Starting from a keyframe rather than from the buffer's head means a viewer
   * who joined mid-match is correct as soon as one arrives, and a dropped message
   * costs at most one keyframe interval rather than corrupting state forever.
   */
  stateAt(now = Date.now()): BoardState | null {
    const t = this.renderTime(now);

    let start = -1;
    for (let i = 0; i < this.snapshots.length; i++) {
      if (this.snapshots[i].t > t) break;
      if (this.snapshots[i].k === 1) start = i;
    }
    if (start === -1) return null;

    let state = emptyBoard();
    for (let i = start; i < this.snapshots.length; i++) {
      const snap = this.snapshots[i];
      if (snap.t > t) break;

      const next = applySnapshot(state, snap);
      // A gap: stop here rather than render a board we cannot vouch for. The
      // next keyframe repairs it.
      if (next === null) break;
      state = next;
    }

    return state.seq < 0 ? null : state;
  }

  /**
   * Whether hitboxes should be hidden right now.
   *
   * `lead` blanks slightly before motion begins. The error is asymmetric: hiding
   * 100ms early is imperceptible, while hiding late leaves hitboxes visibly
   * detached from a sliding board. No prediction is involved -- the buffer holds
   * intervals starting after the visible frame simply because it runs ahead of
   * the video.
   */
  cameraMoving(now = Date.now(), lead = 100): boolean {
    return isMoving(this.intervals, this.renderTime(now), lead);
  }

  /** Latest projection basis at or before the visible frame. */
  projectionAt(now = Date.now()): Affine | null {
    return this.stateAt(now)?.affine ?? null;
  }

  get clockSkewMs() { return this.skew; }
  get size() { return this.snapshots.length; }
}
