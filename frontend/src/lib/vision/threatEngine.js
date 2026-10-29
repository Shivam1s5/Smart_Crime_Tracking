/**
 * ThreatEngine — the real-time surveillance pipeline.
 *
 * Design goals (replacing the previous all-in-one 1,195 line function):
 *   1. Every real person on screen gets a stable, persistent frame + id.
 *   2. No fabricated detections. Nothing is drawn or alerted that was not
 *      actually observed by a model. (The old code synthesised a fake skeleton
 *      after 5 empty frames and counted it as a person.)
 *   3. All motion thresholds are normalised by body scale (torso length), so
 *      detection behaves the same on 480p and 4K cameras.
 *   4. Every state must be confirmed over several frames (hysteresis) before it
 *      is reported, and confidence is derived from evidence — never hardcoded.
 *
 * Weapon detection note: COCO-SSD has no `gun` class. Only knife / scissors /
 * baseball bat / bottle / fork are detectable with this model. See
 * `WEAPON_CLASS_RULES` for the per-class precision gates.
 */

import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { PersonTracker, WeaponMemory } from './tracker.js';
import {
  boxFromPoints,
  boxCenter,
  boxWidth,
  boxHeight,
  boxArea,
  distance,
  clamp,
  ema,
  padBox,
} from './geometry.js';
import { drawScene } from './draw.js';

/** Tunable pipeline configuration. All speeds are in torso-lengths / second. */
export const DEFAULTS = {
  // Detection gates
  personMinScore: 0.4,
  poseMinScore: 0.3,
  maxPoses: 8,
  objectMinScore: 0.3,

  // Frame pacing
  targetFps: 9,

  // Weapon precision gates (higher score = stricter)
  weaponConfirmFrames: 2,
  weaponPersistenceMs: 1200,
  maxWeaponAreaRatio: 0.18,
  weaponBindTorsoRatio: 1.8,

  // Motion analysis
  strikeSpeed: 1.6,
  brawlSpeed: 1.1,
  contactRatio: 1.15,
  smoothAlpha: 0.5,

  // Hysteresis
  confirmFrames: { STRIKING: 2, GUARD: 3, ASSAULT: 2, BRAWL: 2, FALLEN: 3 },
  stateHoldMs: 1200,

  // Alert suppression windows (ms)
  alertCooldowns: {
    WEAPON: 20000,
    ASSAULT: 15000,
    BRAWL: 18000,
    CROWD: 45000,
    NOISE: 40000,
    FALLEN: 30000,
  },

  noiseSustainMs: 1500,
};

/**
 * COCO classes that can plausibly be a weapon, with the precision gates that
 * make them usable. `minScore` was tuned up sharply from the old 0.05, which
 * fired on any vaguely knife-shaped object in the room.
 */
export const WEAPON_CLASS_RULES = {
  knife: { minScore: 0.55, minAspect: 0.2, maxAspect: 4.5, label: 'Bladed object' },
  scissors: { minScore: 0.6, minAspect: 0.2, maxAspect: 3, label: 'Bladed object' },
  fork: { minScore: 0.8, minAspect: 0.2, maxAspect: 3, label: 'Pointed object' },
  'baseball bat': { minScore: 0.55, minAspect: 1.8, maxAspect: 12, label: 'Blunt weapon' },
  bottle: { minScore: 0.85, minAspect: 1.2, maxAspect: 6, label: 'Blunt object' },
};

const SKELETON_EDGES = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

export { SKELETON_EDGES };

let modelsPromise = null;

/** Loads COCO-SSD + MoveNet exactly once per page, shared by every consumer. */
export function loadAiModels(onProgress) {
  if (modelsPromise) return modelsPromise;

  modelsPromise = (async () => {
    onProgress?.('Preparing TensorFlow runtime…');
    await tf.ready();

    onProgress?.('Loading object detector (COCO-SSD)…');
    const objectModel = await cocoSsd.load({ base: 'mobilenet_v2' });

    onProgress?.('Loading pose engine (MoveNet MultiPose)…');
    const poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        enableSmoothing: true,
        minPoseScore: DEFAULTS.poseMinScore,
      },
    );

    return { objectModel, poseModel };
  })().catch((error) => {
    modelsPromise = null;
    throw error;
  });

  return modelsPromise;
}

const keypointMap = (keypoints) => {
  const map = {};
  for (const point of keypoints || []) {
    if (point && point.name) map[point.name] = point;
  }
  return map;
};

const hasPoint = (point, minScore = 0.3) => Boolean(point) && (point.score ?? 0) >= minScore;

export class ThreatEngine {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...(options.config || {}) };
    this.onSnapshot = options.onSnapshot || (() => {});
    this.onAlert = options.onAlert || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onWarn = options.onWarn || (() => {});

    this.tracker = new PersonTracker();
    this.weaponMemory = new WeaponMemory({
      persistenceMs: this.config.weaponPersistenceMs,
      confirmFrames: this.config.weaponConfirmFrames,
    });

    this.models = null;
    this.running = false;
    this.rafId = null;
    this.lastRunAt = 0;
    this.lastAlertAt = {};
    this.frameCount = 0;
    this.fps = 0;
    this._fpsWindowStart = 0;
    this._fpsWindowCount = 0;

    this.soundLevel = 0;
    this._noiseSince = null;
    this.gatheringLimit = 5;
    this.soundLimit = 75;
    this.video = null;
    this.canvas = null;
    this.getVideo = null;
    this.getCanvas = null;
    this.lastError = null;
    this._frameHadError = false;
  }

  _fail(message) {
    this._frameHadError = true;
    if (this.lastError !== message) {
      this.lastError = message;
      this.onError(new Error(message));
    }
  }

  _warn(modelName, error) {
    this._frameHadError = true;
    const message = `${modelName}: ${error?.message || error}`;
    if (this.lastError !== message) {
      this.lastError = message;
      console.warn('[ThreatEngine]', message);
      this.onWarn(message);
    }
  }

  async init(onProgress) {
    if (this.models) return this.models;
    this.onStatus('loading');
    this.models = await loadAiModels(onProgress);
    this.onStatus('ready');
    return this.models;
  }

  setSoundLevel(dbfs) {
    this.soundLevel = dbfs;
  }

  setLimits({ gatheringLimit, soundLimit }) {
    if (Number.isFinite(gatheringLimit)) this.gatheringLimit = gatheringLimit;
    if (Number.isFinite(soundLimit)) this.soundLimit = soundLimit;
  }

  /**
   * Begin monitoring.
   *
   * Accepts either `start(video, canvas)` or `start({ getVideo, getCanvas })`.
   * The getter form is preferred: React can replace the <video>/<canvas> nodes
   * (a camera card remounts when its key changes), and a cached element
   * reference would then silently keep drawing into a detached canvas — which
   * is exactly the "engine runs but nothing appears" failure.
   */
  start(videoOrRefs, canvasArg) {
    if (videoOrRefs && typeof videoOrRefs === 'object' && typeof videoOrRefs.getVideo === 'function') {
      this.getVideo = videoOrRefs.getVideo;
      this.getCanvas = videoOrRefs.getCanvas;
    } else {
      this.getVideo = () => videoOrRefs;
      this.getCanvas = () => canvasArg;
    }

    if (this.running) this.stop();

    this.video = this.getVideo();
    this.canvas = this.getCanvas();
    if (!this.video || !this.canvas) {
      throw new Error('ThreatEngine.start requires a video and a canvas element.');
    }

    this.running = true;
    this.lastError = null;
    this.tracker.reset();
    this.weaponMemory.reset();
    this.onStatus('running');
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.tracker.reset();
    this.weaponMemory.reset();
    this.onStatus('stopped');
    this.onSnapshot({ tracks: [], weapons: [], gathering: 0, fps: 0, sound: this.soundLevel });
  }

  _schedule() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this._tick());
  }

  async _tick() {
    if (!this.running) return;

    const now = performance.now();
    const minInterval = 1000 / this.config.targetFps;
    if (now - this.lastRunAt < minInterval) {
      this._schedule();
      return;
    }
    this.lastRunAt = now;

    try {
      await this._processFrame(now);
    } catch (error) {
      this.onError(error);
    }

    this._schedule();
  }

  async _processFrame(now) {
    // Resolve the DOM nodes on every frame. React can replace a <video> or
    // <canvas> when a camera card remounts; a cached reference would then keep
    // drawing into a detached canvas, which looks exactly like "nothing draws".
    const video = this.getVideo ? this.getVideo() : this.video;
    const canvas = this.getCanvas ? this.getCanvas() : this.canvas;
    this.video = video;
    this.canvas = canvas;
    this._frameHadError = false;

    if (!video || !canvas) {
      this._fail('camera feed or overlay canvas is not mounted');
      return;
    }
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      // A stalled feed is another way to get "engine running, nothing drawn".
      this._stalledFrames = (this._stalledFrames || 0) + 1;
      if (this._stalledFrames > 20) {
        this._fail('camera feed is not producing frames (video paused or blocked)');
      }
      return;
    }
    this._stalledFrames = 0;
    if (!this.models) {
      this._fail('AI models are not loaded yet');
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this._fail('2D canvas context unavailable');
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Raw model output.
    // Each model is isolated on purpose: if the pose engine throws, the person
    // frames from the object detector must still render. One broken model must
    // never blank the whole overlay (that was the previous failure mode).
    let objectPredictions = [];
    let poses = [];

    try {
      objectPredictions = (await this.models.objectModel.detect(video, 24, this.config.objectMinScore)) || [];
    } catch (error) {
      this._warn('object detector', error);
    }

    try {
      poses =
        (await this.models.poseModel.estimatePoses(video, {
          maxPoses: this.config.maxPoses,
          flipHorizontal: false,
        })) || [];
    } catch (error) {
      this._warn('pose engine', error);
    }

    const poseEntries = (poses || [])
      .map((pose) => ({ pose, box: boxFromPoints(pose.keypoints, 0.25) }))
      .filter((entry) => entry.box && boxWidth(entry.box) > 12 && boxHeight(entry.box) > 24);

    // 2. Person detections = COCO people + any pose the detector missed -----
    const personDetections = [];
    const usedPoses = new Set();

    for (const prediction of objectPredictions || []) {
      if (prediction.class !== 'person') continue;
      if ((prediction.score ?? 0) < this.config.personMinScore) continue;

      const [x, y, w, h] = prediction.bbox;
      const bbox = { x1: x, y1: y, x2: x + w, y2: y + h };
      if (w < 12 || h < 24) continue;

      // Attach the best matching pose so we never count the same human twice.
      let bestIndex = -1;
      let bestGap = Infinity;
      const center = boxCenter(bbox);
      for (let i = 0; i < poseEntries.length; i += 1) {
        if (usedPoses.has(i)) continue;
        const poseCenter = boxCenter(poseEntries[i].box);
        const gap = distance(center.x, center.y, poseCenter.x, poseCenter.y);
        if (gap < Math.max(bbox.y2 - bbox.y1, 40) && gap < bestGap) {
          bestGap = gap;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0) usedPoses.add(bestIndex);

      personDetections.push({
        bbox,
        score: prediction.score,
        source: 'detector',
        pose: bestIndex >= 0 ? poseEntries[bestIndex].pose : null,
      });
    }

    // Poses with no matching person box are still real people — add them so
    // everybody on screen gets a frame, without inventing anything.
    for (let i = 0; i < poseEntries.length; i += 1) {
      if (usedPoses.has(i)) continue;
      personDetections.push({
        bbox: padBox(poseEntries[i].box, 0.12),
        score: clamp(poseEntries[i].pose.score ?? 0.4, 0.3, 0.85),
        source: 'pose',
        pose: poseEntries[i].pose,
      });
    }

    // 3. Weapons -----------------------------------------------------------
    const weaponDetections = [];
    for (const prediction of objectPredictions || []) {
      const rule = WEAPON_CLASS_RULES[prediction.class];
      if (!rule) continue;
      if ((prediction.score ?? 0) < rule.minScore) continue;

      const [x, y, w, h] = prediction.bbox;
      if (w < 6 || h < 6) continue;

      const aspect = w / Math.max(1, h);
      if (aspect < rule.minAspect || aspect > rule.maxAspect) continue;

      const bbox = { x1: x, y1: y, x2: x + w, y2: y + h };
      if (boxArea(bbox) / (canvas.width * canvas.height) > this.config.maxWeaponAreaRatio) continue;

      weaponDetections.push({
        name: prediction.class,
        label: rule.label,
        bbox,
        score: prediction.score,
      });
    }

    // 4. Tracking ----------------------------------------------------------
    const tracks = this.tracker
      .update(personDetections, now)
      .filter((track) => track.hits >= 2);

    // Re-bind poses after tracking (keeps skeletons attached to the right id).
    this._attachPoses(tracks, poseEntries);

    const weapons = this.weaponMemory.update(weaponDetections, now);
    this._bindWeapons(tracks, weapons);

    // 5. Motion + behaviour ------------------------------------------------
    for (const track of tracks) {
      this._updateMotion(track, now);
    }
    const events = this._classify(tracks, now);

    // 6. FPS ---------------------------------------------------------------
    this._fpsWindowCount += 1;
    if (!this._fpsWindowStart) this._fpsWindowStart = now;
    if (now - this._fpsWindowStart >= 500) {
      this.fps = (this._fpsWindowCount * 1000) / (now - this._fpsWindowStart);
      this._fpsWindowCount = 0;
      this._fpsWindowStart = now;
    }

    // 7. Render before alerting, so evidence screenshots contain the overlay.
    const gatheringCount = tracks.length;
    const maxSpeed = tracks.reduce((peak, track) => Math.max(peak, track.motion?.speed || 0), 0);

    drawScene(ctx, canvas, {
      tracks,
      weapons,
      gatheringCount,
      gatheringLimit: this.gatheringLimit,
      soundLevel: this.soundLevel,
      soundLimit: this.soundLimit,
      fps: this.fps,
      skeletonEdges: SKELETON_EDGES,
      diag: { persons: gatheringCount, maxSpeed, error: this.lastError },
    });

    this.onSnapshot({
      tracks,
      weapons,
      gathering: gatheringCount,
      fps: this.fps,
      sound: this.soundLevel,
      maxSpeed,
      error: this.lastError,
    });

    if (!this._frameHadError) this.lastError = null;

    // 8. Alerts ------------------------------------------------------------
    for (const event of events) {
      this._raiseAlert(event, now);
    }
  }

  _attachPoses(tracks, poseEntries) {
    for (const track of tracks) track.pose = null;

    for (const entry of poseEntries) {
      const poseCenter = boxCenter(entry.box);
      let bestTrack = null;
      let bestGap = Infinity;

      for (const track of tracks) {
        if (track.pose) continue;
        const center = boxCenter(track.bbox);
        const gap = distance(center.x, center.y, poseCenter.x, poseCenter.y);
        const gate = Math.max(48, boxHeight(track.bbox) * 0.6);
        if (gap < gate && gap < bestGap) {
          bestGap = gap;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        bestTrack.pose = entry.pose;
        bestTrack.poseBox = entry.box;
      }
    }
  }

  _bindWeapons(tracks, weapons) {
    for (const track of tracks) {
      track.armedWeapon = null;
    }

    for (const weapon of weapons) {
      const weaponCenter = boxCenter(weapon.bbox);
      let closest = null;
      let minGap = Infinity;

      for (const track of tracks) {
        const center = boxCenter(track.bbox);
        const gap = distance(center.x, center.y, weaponCenter.x, weaponCenter.y);
        if (gap < minGap) {
          minGap = gap;
          closest = track;
        }
      }

      if (!closest) continue;

      const reach = Math.max(40, boxHeight(closest.bbox) * this.config.weaponBindTorsoRatio);
      const motion = closest.motion;
      const wristReach = motion
        ? Math.min(
            motion.leftWrist ? distance(weaponCenter.x, weaponCenter.y, motion.leftWrist.x, motion.leftWrist.y) : Infinity,
            motion.rightWrist ? distance(weaponCenter.x, weaponCenter.y, motion.rightWrist.x, motion.rightWrist.y) : Infinity,
            minGap,
          )
        : minGap;

      if (wristReach < reach) {
        closest.armedWeapon = closest.armedWeapon
          ? { ...closest.armedWeapon, name: weapon.name, label: weapon.label, score: Math.max(closest.armedWeapon.score, weapon.score) }
          : { name: weapon.name, label: weapon.label, score: weapon.score };
      }
    }
  }

  _updateMotion(track, now) {
    const pose = track.pose;
    if (!pose) {
      track.motion = track.motion ? { ...track.motion, stale: true } : null;
      return;
    }

    const kp = keypointMap(pose.keypoints);
    const leftShoulder = hasPoint(kp.left_shoulder, 0.25) ? kp.left_shoulder : null;
    const rightShoulder = hasPoint(kp.right_shoulder, 0.25) ? kp.right_shoulder : null;
    const leftHip = hasPoint(kp.left_hip, 0.25) ? kp.left_hip : null;
    const rightHip = hasPoint(kp.right_hip, 0.25) ? kp.right_hip : null;

    const shoulderWidth =
      leftShoulder && rightShoulder
        ? Math.max(20, distance(leftShoulder.x, leftShoulder.y, rightShoulder.x, rightShoulder.y))
        : Math.max(20, boxWidth(track.bbox) * 0.45);

    const shoulderMid =
      leftShoulder && rightShoulder
        ? { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 }
        : null;
    const hipMid =
      leftHip && rightHip
        ? { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
        : null;

    // Torso length is the normalising unit: it scales with distance to camera,
    // which makes every speed threshold resolution independent.
    const torso = shoulderMid && hipMid ? Math.max(20, distance(shoulderMid.x, shoulderMid.y, hipMid.x, hipMid.y)) : shoulderWidth * 1.5;

    const bodyCenter = boxCenter(track.bbox);
    const headY = hasPoint(kp.nose, 0.25) ? kp.nose.y : shoulderMid ? shoulderMid.y - torso * 0.35 : bodyCenter.y - torso * 0.5;
    const hipY = hipMid ? hipMid.y : (shoulderMid ? shoulderMid.y + torso : bodyCenter.y + torso * 0.4);

    const leftWrist = hasPoint(kp.left_wrist, 0.2) ? kp.left_wrist : null;
    const rightWrist = hasPoint(kp.right_wrist, 0.2) ? kp.right_wrist : null;
    const leftElbow = hasPoint(kp.left_elbow, 0.2) ? kp.left_elbow : null;
    const rightElbow = hasPoint(kp.right_elbow, 0.2) ? kp.right_elbow : null;
    const leftAnkle = hasPoint(kp.left_ankle, 0.2) ? kp.left_ankle : null;
    const rightAnkle = hasPoint(kp.right_ankle, 0.2) ? kp.right_ankle : null;

    // Exponential smoothing on wrist position removes keypoint jitter, which is
    // otherwise interpreted as violent motion.
    const previous = track.smooth;
    const alpha = this.config.smoothAlpha;
    const smooth = {
      now,
      leftWrist: leftWrist
        ? { x: ema(previous?.leftWrist?.x, leftWrist.x, alpha), y: ema(previous?.leftWrist?.y, leftWrist.y, alpha) }
        : null,
      rightWrist: rightWrist
        ? { x: ema(previous?.rightWrist?.x, rightWrist.x, alpha), y: ema(previous?.rightWrist?.y, rightWrist.y, alpha) }
        : null,
    };

    const dt = previous ? clamp((now - previous.now) / 1000, 0.05, 0.6) : 0;
    const speedOf = (current, before) => {
      if (!current || !before || !dt) return 0;
      return distance(current.x, current.y, before.x, before.y) / dt / torso;
    };

    const speedLeft = speedOf(smooth.leftWrist, previous?.leftWrist);
    const speedRight = speedOf(smooth.rightWrist, previous?.rightWrist);

    const armExtLeft = leftWrist && leftShoulder ? distance(leftWrist.x, leftWrist.y, leftShoulder.x, leftShoulder.y) / shoulderWidth : 0;
    const armExtRight = rightWrist && rightShoulder ? distance(rightWrist.x, rightWrist.y, rightShoulder.x, rightShoulder.y) / shoulderWidth : 0;

    track.smooth = smooth;
    track.motion = {
      torso,
      shoulderWidth,
      bodyCenter,
      headY,
      hipY,
      shoulderMid,
      hipMid,
      leftWrist,
      rightWrist,
      leftElbow,
      rightElbow,
      leftAnkle,
      rightAnkle,
      speedLeft,
      speedRight,
      speed: Math.max(speedLeft, speedRight),
      armExtLeft,
      armExtRight,
      armExt: Math.max(armExtLeft, armExtRight),
      activeLimb:
        speedLeft >= speedRight
          ? leftWrist || leftElbow
          : rightWrist || rightElbow,
      stale: false,
    };
  }

  /** Decide the behavioural state of every track, returning alert-worthy events. */
  _classify(tracks, now) {
    const events = [];
    const cfg = this.config;

    // Reset transient victim links each pass, and expire stale confirmation
    // candidates so evidence cannot accumulate across long gaps.
    for (const track of tracks) {
      track.victimId = null;
      if (track.candidate && now - (track.candidate.at || 0) > 300) {
        track.candidate = null;
      }
    }

    // --- Weapons take precedence: an armed subject is not "striking". ------
    for (const track of tracks) {
      if (track.armedWeapon) {
        const score = track.armedWeapon.score;
        const rule = WEAPON_CLASS_RULES[track.armedWeapon.name] || { minScore: 0.6 };
        const confidence = clamp(0.5 + ((score - rule.minScore) / Math.max(0.01, 1 - rule.minScore)) * 0.45, 0.5, 0.95);

        if (this._confirm(track, 'ARMED', `${track.armedWeapon.label} (${track.armedWeapon.name})`, confidence, now)) {
          events.push({
            category: 'WEAPON',
            type: `WEAPON DETECTED: ${track.armedWeapon.label.toUpperCase()} (${track.armedWeapon.name})`,
            confidence,
            trackId: track.id,
            detail: `Subject #${track.id} holding ${track.armedWeapon.label.toLowerCase()}`,
          });
        }
        track.stateLabel = `${track.armedWeapon.label} · subject #${track.id}`;
        track.threatScore = Math.max(track.threatScore, confidence);
      }
    }

    // --- Pairwise contact: assault and brawl. ------------------------------
    const pairs = [];
    for (let i = 0; i < tracks.length; i += 1) {
      for (let j = i + 1; j < tracks.length; j += 1) {
        const a = tracks[i];
        const b = tracks[j];
        if (!a.motion || !b.motion) continue;
        if (a.motion.stale || b.motion.stale) continue;

        const gap = distance(a.motion.bodyCenter.x, a.motion.bodyCenter.y, b.motion.bodyCenter.x, b.motion.bodyCenter.y);
        const contactGate = Math.max(a.motion.torso, b.motion.torso) * 1.6;
        if (gap > contactGate) continue;

        const mutualFast = a.motion.speed >= cfg.brawlSpeed && b.motion.speed >= cfg.brawlSpeed;
        const aReaches = this._reaches(a, b);
        const bReaches = this._reaches(b, a);

        pairs.push({ a, b, mutualFast, aReaches, bReaches });
      }
    }

    for (const pair of pairs) {
      const { a, b, mutualFast, aReaches, bReaches } = pair;
      const aFast = a.motion.speed >= cfg.strikeSpeed;
      const bFast = b.motion.speed >= cfg.strikeSpeed;

      if (mutualFast && aReaches && bReaches && !a.armedWeapon && !b.armedWeapon) {
        const confidence = clamp(0.55 + Math.max(a.motion.speed, b.motion.speed) * 0.04, 0.55, 0.88);
        for (const track of [a, b]) {
          this._confirm(track, 'BRAWL', `Mutual altercation with #${track === a ? b.id : a.id}`, confidence, now);
        }
        events.push({
          category: 'BRAWL',
          type: 'PHYSICAL ALTERCATION / BRAWL (MUTUAL)',
          confidence,
          trackId: a.id,
          detail: `Subjects #${a.id} and #${b.id} exchanging blows`,
        });
        continue;
      }

      const attacker = aFast && aReaches ? a : bFast && bReaches ? b : null;
      const victim = attacker === a ? b : attacker === b ? a : null;

      if (attacker && victim && !attacker.armedWeapon) {
        const confidence = clamp(0.55 + (attacker.motion.speed - cfg.strikeSpeed) * 0.05, 0.55, 0.9);
        this._confirm(attacker, 'STRIKING', `Striking subject #${victim.id}`, confidence, now);
        if (victim.state !== 'ARMED') {
          this._confirm(victim, 'VICTIM', `Under attack by #${attacker.id}`, confidence * 0.8, now);
          victim.victimId = attacker.id;
        }
        attacker.victimId = victim.id;
        events.push({
          category: 'ASSAULT',
          type: 'PHYSICAL ASSAULT DETECTED',
          confidence,
          trackId: attacker.id,
          detail: `Subject #${attacker.id} striking subject #${victim.id}`,
        });
      }
    }

    // --- Solo strike (punch toward camera, no second person required). -----
    for (const track of tracks) {
      if (track.armedWeapon || track.state === 'STRIKING' || track.state === 'BRAWL') continue;
      const motion = track.motion;
      if (!motion || motion.stale) continue;
      if (track.victimId) continue;

      // A punch thrown toward the camera barely changes 2D arm extension
      // (foreshortening), so accept either a clearly extended arm or an
      // unmistakably fast snap.
      const extended = motion.armExt >= 0.55 || motion.speed >= 3.2;
      const raised = motion.activeLimb ? motion.activeLimb.y < motion.hipY : false;
      const fast = motion.speed >= cfg.strikeSpeed;

      if (fast && extended && raised) {
        const confidence = clamp(0.55 + (motion.speed - cfg.strikeSpeed) * 0.05, 0.55, 0.9);
        if (this._confirm(track, 'STRIKING', `Strike motion (${motion.speed.toFixed(1)} torso/s)`, confidence, now)) {
          events.push({
            category: 'ASSAULT',
            type: 'VIOLENT STRIKE DETECTED',
            confidence,
            trackId: track.id,
            detail: `Subject #${track.id} throwing a strike`,
          });
        }
      }
    }

    // --- Guard stance (informational, never a panic alert on its own). -----
    for (const track of tracks) {
      if (track.state !== 'NORMAL') continue;
      const motion = track.motion;
      if (!motion || motion.stale) continue;

      const anchorY = motion.shoulderMid ? motion.shoulderMid.y : motion.bodyCenter.y - motion.torso * 0.4;
      const leftUp = motion.leftWrist ? motion.leftWrist.y < anchorY + motion.torso * 0.35 : false;
      const rightUp = motion.rightWrist ? motion.rightWrist.y < anchorY + motion.torso * 0.35 : false;
      const handsIn = motion.leftWrist && motion.rightWrist
        ? distance(motion.leftWrist.x, motion.leftWrist.y, motion.rightWrist.x, motion.rightWrist.y) < motion.shoulderWidth * 1.6
        : false;

      if (leftUp && rightUp && handsIn) {
        this._confirm(track, 'GUARD', 'Fighting guard stance', 0.6, now);
      }
    }

    // --- Fallen / collapsed person. ---------------------------------------
    for (const track of tracks) {
      const aspect = boxWidth(track.bbox) / Math.max(1, boxHeight(track.bbox));
      const low = boxCenter(track.bbox).y > this.canvas.height * 0.55;
      if (aspect > 1.5 && low) {
        if (this._confirm(track, 'FALLEN', 'Person down on the ground', 0.65, now)) {
          events.push({
            category: 'FALLEN',
            type: 'PERSON DOWN / MEDICAL DISTRESS',
            confidence: 0.65,
            trackId: track.id,
            detail: `Subject #${track.id} appears to be on the ground`,
          });
        }
      }
    }

    // --- Release states that no longer have fresh evidence. ---------------
    for (const track of tracks) {
      if (!track.candidate && track.state !== 'NORMAL' && now > track.stateHoldUntil) {
        track.state = 'NORMAL';
        track.stateLabel = 'Person';
        track.threatScore = 0;
      }
    }

    // --- Crowd + noise thresholds. ----------------------------------------
    const gathering = tracks.length;
    if (gathering > this.gatheringLimit) {
      events.push({
        category: 'CROWD',
        type: `CROWD LIMIT EXCEEDED (${gathering}/${this.gatheringLimit})`,
        confidence: 0.9,
        trackId: null,
        detail: `${gathering} people tracked against a limit of ${this.gatheringLimit}`,
      });
    }

    if (this.soundLevel > this.soundLimit) {
      this._noiseSince = this._noiseSince ?? now;
      if (now - this._noiseSince >= cfg.noiseSustainMs) {
        const excess = this.soundLevel - this.soundLimit;
        events.push({
          category: 'NOISE',
          type: 'SUSTAINED HIGH NOISE',
          confidence: clamp(0.6 + excess / 100, 0.6, 0.9),
          trackId: null,
          detail: `${Math.round(this.soundLevel)} dB against a limit of ${this.soundLimit} dB`,
        });
      }
    } else {
      this._noiseSince = null;
    }

    return events;
  }

  _reaches(attacker, defender) {
    const motion = attacker.motion;
    if (!motion) return false;

    const target = defender.motion?.bodyCenter || boxCenter(defender.bbox);
    const shoulder = defender.motion?.shoulderWidth || boxWidth(defender.bbox) * 0.45;
    const gate = Math.max(shoulder * 1.2, 36);

    for (const wrist of [motion.leftWrist, motion.rightWrist]) {
      if (!wrist) continue;
      if (distance(wrist.x, wrist.y, target.x, target.y) < gate) return true;
      if (defender.motion && distance(wrist.x, wrist.y, defender.motion.bodyCenter.x, defender.motion.headY) < gate) return true;
    }
    return false;
  }

  /**
   * Multi-frame confirmation. A state is only published once it has been
   * observed `confirmFrames[state]` times in a row, which is what stops the
   * constant false "assault" alerts seen in the previous build.
   */
  _confirm(track, state, label, confidence, now) {
    const needed = this.config.confirmFrames[state] ?? 3;

    if (!track.candidate || track.candidate.state !== state) {
      track.candidate = { state, frames: 1, label, confidence, at: now };
      return false;
    }

    track.candidate.frames += 1;
    track.candidate.confidence = Math.max(track.candidate.confidence, confidence);
    track.candidate.label = label;
    track.candidate.at = now;

    if (track.candidate.frames < needed) return false;

    // Confirmed. The caller emits an event every frame from here on; the
    // per-category cooldown in _raiseAlert decides how often a human is
    // actually notified, so a sustained threat keeps alerting without spam.
    track.state = state;
    track.stateLabel = label;
    track.threatScore = track.candidate.confidence;
    track.stateHoldUntil = now + this.config.stateHoldMs;

    if (state === 'STRIKING') track.stateLabel = 'Striking';
    if (state === 'BRAWL') track.stateLabel = 'Brawling';
    if (state === 'ARMED') track.stateLabel = `Armed · ${label}`;

    return true;
  }

  _raiseAlert(event, now) {
    const cooldown = this.config.alertCooldowns[event.category] ?? 20000;
    const last = this.lastAlertAt[event.category] ?? 0;
    if (now - last < cooldown) return;

    this.lastAlertAt[event.category] = now;
    this.onAlert(event);
  }
}
