/**
 * Persistent identity tracking for people and weapons.
 *
 * The previous implementation re-numbered people every frame ("Person #1/#2"
 * swapping whenever two people crossed), which made alerts impossible to trust.
 * These trackers give every subject a stable id for its whole lifetime on
 * screen, and only report subjects once they have been seen more than once
 * (so a single noisy frame can never create a phantom person).
 */

import { iou, boxCenter, distance, smoothBox, boxHeight } from './geometry.js';

export class PersonTracker {
  constructor(options = {}) {
    this.iouGate = options.iouGate ?? 0.2;
    this.centerGateRatio = options.centerGateRatio ?? 0.65;
    this.maxLostMs = options.maxLostMs ?? 700;
    this.minHits = options.minHits ?? 2;
    this.bboxAlpha = options.bboxAlpha ?? 0.55;

    this.tracks = [];
    this.nextId = 1;
  }

  /**
   * @param {Array<{bbox: object, score: number, source: string}>} detections
   * @param {number} now epoch milliseconds
   */
  update(detections, now) {
    const pending = detections.slice();
    const matchedTracks = new Set();
    const matchedDets = new Set();

    // Pass 1 — greedy IoU matching, strongest overlap wins first.
    const candidates = [];
    for (const track of this.tracks) {
      for (let i = 0; i < pending.length; i += 1) {
        const overlap = iou(track.bbox, pending[i].bbox);
        if (overlap >= this.iouGate) {
          candidates.push({ track, detIndex: i, overlap });
        }
      }
    }
    candidates.sort((a, b) => b.overlap - a.overlap);

    for (const candidate of candidates) {
      if (matchedTracks.has(candidate.track.id) || matchedDets.has(candidate.detIndex)) continue;
      matchedTracks.add(candidate.track.id);
      matchedDets.add(candidate.detIndex);
      this._absorb(candidate.track, pending[candidate.detIndex], now);
    }

    // Pass 2 — centroid fallback for people who moved fast between frames.
    for (const track of this.tracks) {
      if (matchedTracks.has(track.id)) continue;

      const trackCenter = boxCenter(track.bbox);
      const gate = Math.max(24, boxHeight(track.bbox) * this.centerGateRatio);

      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < pending.length; i += 1) {
        if (matchedDets.has(i)) continue;
        const detCenter = boxCenter(pending[i].bbox);
        const gap = distance(trackCenter.x, trackCenter.y, detCenter.x, detCenter.y);
        if (gap < gate && gap < bestDistance) {
          bestDistance = gap;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        matchedTracks.add(track.id);
        matchedDets.add(bestIndex);
        this._absorb(track, pending[bestIndex], now);
      }
    }

    // Unmatched detections become new tracks (unconfirmed until seen twice).
    for (let i = 0; i < pending.length; i += 1) {
      if (matchedDets.has(i)) continue;
      const detection = pending[i];
      this.tracks.push({
        id: this.nextId,
        bbox: { ...detection.bbox },
        score: detection.score ?? 0,
        source: detection.source ?? 'unknown',
        hits: 1,
        firstSeen: now,
        lastSeen: now,
        pose: null,
        motion: null,
        state: 'NORMAL',
        stateLabel: 'Person',
        threatScore: 0,
        armedWeapon: null,
        victimId: null,
        candidate: null,
        stateHoldUntil: 0,
      });
      this.nextId += 1;
    }

    // Forget tracks that have been gone for too long.
    this.tracks = this.tracks.filter((track) => now - track.lastSeen <= this.maxLostMs);

    return this.tracks;
  }

  _absorb(track, detection, now) {
    track.bbox = smoothBox(track.bbox, detection.bbox, this.bboxAlpha);
    track.score = detection.score ?? track.score;
    track.source = detection.source ?? track.source;
    track.hits += 1;
    track.lastSeen = now;
  }

  /** Tracks confirmed by more than one observation — safe to draw and alert on. */
  confirmed() {
    return this.tracks.filter((track) => track.hits >= this.minHits);
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }
}

/**
 * Short-term memory for weapon detections.
 *
 * A weapon must be seen in at least `confirmFrames` of the last frames before
 * it is reported, which removes the single-frame flicker that made the old
 * pipeline fire "knife detected" at random. Confirmed weapons stay visible for
 * `persistenceMs` so the overlay does not blink between detections.
 */
export class WeaponMemory {
  constructor(options = {}) {
    this.persistenceMs = options.persistenceMs ?? 1200;
    this.confirmFrames = options.confirmFrames ?? 2;
    this.iouGate = options.iouGate ?? 0.25;
    this.nextId = 1;
    this.items = [];
  }

  update(detections, now) {
    const pending = detections.slice();

    for (const item of this.items) {
      let bestIndex = -1;
      let bestOverlap = this.iouGate;

      for (let i = 0; i < pending.length; i += 1) {
        if (pending[i].name !== item.name) continue;
        const overlap = iou(item.bbox, pending[i].bbox);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        const detection = pending[bestIndex];
        pending.splice(bestIndex, 1);
        item.bbox = smoothBox(item.bbox, detection.bbox, 0.6);
        item.score = detection.score;
        item.hits += 1;
        item.lastSeen = now;
        item.confirmed = item.confirmed || item.hits >= this.confirmFrames;
      }
    }

    for (const detection of pending) {
      this.items.push({
        id: this.nextId,
        name: detection.name,
        label: detection.label ?? detection.name,
        bbox: { ...detection.bbox },
        score: detection.score,
        hits: 1,
        confirmed: this.confirmFrames <= 1,
        firstSeen: now,
        lastSeen: now,
      });
      this.nextId += 1;
    }

    this.items = this.items.filter((item) => now - item.lastSeen <= this.persistenceMs);
    return this.items.filter((item) => item.confirmed);
  }

  reset() {
    this.items = [];
    this.nextId = 1;
  }
}
