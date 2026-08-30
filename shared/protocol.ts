/**
 * Wire format shared by the Unity publisher, the EBS relay, and the viewer
 * frontend. Keep this file and TwitchSnapshot.cs in step.
 *
 * Two constraints shape every decision here:
 *
 *  1. Twitch PubSub caps a message at 5KB and roughly 1/second, so the stream is
 *     change-driven deltas with a periodic keyframe rather than full state.
 *  2. The viewer's video runs 3-20s behind live. The frontend renders the
 *     snapshot matching the delayed video, which means it always holds snapshots
 *     *newer* than what is on screen -- see MotionInterval.
 */

export const PROTOCOL_VERSION = 1;

/** Entity tuple: [handle, cardId, q, r, health, owner].
 *
 *  A fixed-order tuple rather than a keyed object, which is roughly 60% smaller
 *  on the wire. `handle` is a small per-match integer, not Character.UID, so
 *  deltas can reference an entity in a couple of bytes. */
export type EntityTuple = [number, number, number, number, number, number];

/** Field offsets into EntityTuple. */
export const E = { Handle: 0, CardId: 1, Q: 2, R: 3, Health: 4, Owner: 5 } as const;

/**
 * A span of wall-clock time during which the camera was moving, in client epoch
 * milliseconds. `end` is null while motion is still in progress; a later
 * snapshot closes it.
 *
 * Why intervals instead of an `inMotion` boolean sampled into each snapshot:
 * at ~1Hz, a pan that starts and finishes between two samples would never be
 * captured at all, and motion onset would be detected up to a second late. The
 * publisher runs at frame rate and knows the exact boundaries, so it sends them
 * verbatim and the transport rate stops mattering.
 */
export type MotionInterval = [number, number | null];

/**
 * Cell -> viewport affine transform, [a00, a01, a10, a11, bx, by].
 *
 * The board camera is orthographic and Unity's hex cell->world map is linear, so
 * the composition of the two is exactly affine. Six floats therefore place every
 * hex on screen at any pan or zoom, and the frontend never has to reimplement
 * Unity's hex layout.
 *
 * Only sent when the camera has *settled* and the value changed. Mid-motion
 * values are never rendered (hitboxes are hidden while the camera moves), so
 * sending them would be pure waste.
 */
export type Affine = [number, number, number, number, number, number];

export interface Snapshot {
  /** Protocol version. */
  v: number;
  /** Client epoch milliseconds this snapshot describes. */
  t: number;
  /** Monotonic sequence number; gaps mean a dropped message. */
  s: number;
  /** 1 if this is a keyframe (full state), 0 if a delta. */
  k: 0 | 1;
  /** Motion intervals opened or closed since the previous snapshot. */
  m?: MotionInterval[];
  /** Settled affine, when it changed. */
  a?: Affine;
  /** Entities added or changed. On a keyframe, this is the whole board. */
  e?: EntityTuple[];
  /** Handles of entities removed since the previous snapshot. */
  x?: number[];
}

/** Board state the frontend renders, reconstructed from keyframe + deltas. */
export interface BoardState {
  t: number;
  seq: number;
  affine: Affine | null;
  entities: Map<number, EntityTuple>;
}

export function emptyBoard(): BoardState {
  return { t: 0, seq: -1, affine: null, entities: new Map() };
}

/**
 * Fold one snapshot into a board state, returning a new state.
 *
 * A keyframe replaces the entity set outright; a delta patches it. Returns null
 * if the snapshot cannot be applied (a delta arriving before any keyframe, or
 * after a sequence gap) -- the caller should then wait for the next keyframe
 * rather than render a board it cannot vouch for.
 */
export function applySnapshot(prev: BoardState, snap: Snapshot): BoardState | null {
  if (snap.k !== 1) {
    if (prev.seq < 0) return null;                 // no keyframe yet
    if (snap.s !== prev.seq + 1) return null;      // gap: state would be wrong
  }

  const entities = snap.k === 1 ? new Map<number, EntityTuple>() : new Map(prev.entities);

  for (const e of snap.e ?? []) entities.set(e[E.Handle], e);
  for (const handle of snap.x ?? []) entities.delete(handle);

  return {
    t: snap.t,
    seq: snap.s,
    affine: snap.a ?? prev.affine,
    entities,
  };
}

/** Project a hex cell to viewport space (0..1, y up, matching Unity). */
export function cellToViewport(a: Affine, q: number, r: number): { x: number; y: number } {
  return { x: a[0] * q + a[1] * r + a[4], y: a[2] * q + a[3] * r + a[5] };
}

/**
 * Viewport-space radius of one hex, derived from the affine rather than sent.
 *
 * The distance covered by a one-cell step already encodes zoom, so a separate
 * size field would be redundant (and could disagree with the transform).
 */
export function hexRadius(a: Affine): number {
  const stepQ = Math.hypot(a[0], a[2]);
  const stepR = Math.hypot(a[1], a[3]);
  return Math.min(stepQ, stepR) * 0.5;
}

/**
 * True if the camera is moving at `t`, given every interval known so far.
 *
 * `lead` blanks hitboxes slightly *before* motion begins. The error here is
 * asymmetric: hiding 100ms early is invisible to a viewer, while hiding late
 * leaves hitboxes visibly detached from a sliding board, which is exactly what
 * reads as broken. The lead also absorbs small errors in the broadcaster's
 * configured delay.
 *
 * No prediction is involved. Because the frontend renders at `now - delay`, its
 * buffer already contains intervals that start after the currently rendered
 * moment -- looking them up is just a read further along a buffer it keeps
 * anyway.
 */
export function isMoving(intervals: MotionInterval[], t: number, lead = 100): boolean {
  for (const [start, end] of intervals) {
    if (t >= start - lead && (end === null || t <= end)) return true;
  }
  return false;
}
