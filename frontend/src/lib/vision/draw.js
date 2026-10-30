/**
 * Canvas overlay renderer.
 *
 * Rewritten to be defensive: every canvas primitive is guarded, every track is
 * drawn inside its own try/catch, and no operation can leave the frame blank.
 * The previous version had a single outer try/catch, so one bad coordinate or
 * one undefined label erased the entire overlay — which is what made the body
 * frames appear only intermittently.
 */

const COLORS = {
  NORMAL: '#22d3ee',
  MOTION: '#94a3b8',
  GUARD: '#f59e0b',
  STRIKING: '#ef4444',
  VICTIM: '#fb923c',
  ARMED: '#dc2626',
  BRAWL: '#ef4444',
  FALLEN: '#fb923c',
};

const HOT_STATES = new Set(['ARMED', 'STRIKING', 'BRAWL']);

/** Coerce anything into a finite number so canvas calls never receive NaN. */
const num = (value, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const colorOf = (state) => COLORS[state] || COLORS.NORMAL;

const label = (ctx, text, x, y, options = {}) => {
  const {
    bg = 'rgba(15, 23, 42, 0.92)',
    fg = '#f8fafc',
    border = 'rgba(148, 163, 184, 0.6)',
    height = 22,
  } = options;

  ctx.font = 'bold 12px system-ui, -apple-system, Segoe UI, sans-serif';
  const width = num(ctx.measureText(text).width, 40) + 16;
  const left = Math.max(4, Math.min(x, num(ctx.canvas.width) - width - 4));
  const top = Math.max(4, y);

  ctx.fillStyle = bg;
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, width, height);

  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, left + 8, top + height / 2 + 1);
};

const drawSkeleton = (ctx, keypoints, color) => {
  if (!Array.isArray(keypoints) || keypoints.length === 0) return;

  const points = {};
  for (const point of keypoints) {
    if (point && point.name) points[point.name] = point;
  }

  const edges = [
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'],
    ['left_hip', 'right_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
  ];

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  for (const [from, to] of edges) {
    const a = points[from];
    const b = points[to];
    if (!a || !b) continue;
    if (num(a.score) < 0.2 || num(b.score) < 0.2) continue;
    ctx.beginPath();
    ctx.moveTo(num(a.x), num(a.y));
    ctx.lineTo(num(b.x), num(b.y));
    ctx.stroke();
  }

  ctx.fillStyle = color;
  for (const point of keypoints) {
    if (num(point?.score) < 0.25) continue;
    ctx.beginPath();
    ctx.arc(num(point.x), num(point.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawTrack = (ctx, track) => {
  const box = track.bbox || {};
  const x1 = num(box.x1);
  const y1 = num(box.y1);
  const x2 = num(box.x2);
  const y2 = num(box.y2);
  const width = Math.max(2, x2 - x1);
  const height = Math.max(2, y2 - y1);

  const color = colorOf(track.state);
  const hot = HOT_STATES.has(track.state);

  // Body outline — the permanent frame requested for every person.
  ctx.strokeStyle = color;
  ctx.lineWidth = hot ? 3 : 2.5;
  ctx.strokeRect(x1, y1, width, height);

  // Tactical corner brackets.
  const corner = Math.max(10, Math.min(26, width * 0.2, height * 0.2));
  ctx.lineWidth = hot ? 4 : 3;
  const corners = [
    [x1, y1, 1, 1],
    [x2, y1, -1, 1],
    [x1, y2, 1, -1],
    [x2, y2, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + corner * sy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + corner * sx, cy);
    ctx.stroke();
  }

  if (track.pose && track.pose.keypoints) {
    drawSkeleton(ctx, track.pose.keypoints, color);
  }

  const stateText = String(track.stateLabel || 'Person');
  label(ctx, `#${num(track.id, 0)} · ${stateText}`, x1, y1 - 26, {
    bg: hot ? 'rgba(127, 29, 29, 0.95)' : 'rgba(15, 23, 42, 0.92)',
    border: color,
  });
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {object} scene
 */
export function drawScene(ctx, canvas, scene = {}) {
  if (!ctx || !canvas) return;

  const tracks = Array.isArray(scene.tracks) ? scene.tracks : [];
  const weapons = Array.isArray(scene.weapons) ? scene.weapons : [];
  const gatheringCount = num(scene.gatheringCount, tracks.length);
  const gatheringLimit = num(scene.gatheringLimit, 5);
  const soundLevel = num(scene.soundLevel, 0);
  const soundLimit = num(scene.soundLimit, 75);
  const fps = num(scene.fps, 0);
  const diag = scene.diag || {};

  const width = num(canvas.width);
  const height = num(canvas.height);

  // The webcam preview is mirrored (selfie view), so every overlay coordinate
  // must be flipped around the frame centre to stay on the correct body part.
  const mirror = Boolean(scene.mirror);
  const flip = (x) => (mirror ? width - num(x) : num(x));

  const mirrorTrack = (track) => {
    if (!mirror) return track;
    const box = track.bbox || {};
    const pose = track.pose && Array.isArray(track.pose.keypoints)
      ? {
          ...track.pose,
          keypoints: track.pose.keypoints.map((point) => ({ ...point, x: flip(point.x) })),
        }
      : track.pose;

    return {
      ...track,
      bbox: { x1: flip(box.x2), y1: num(box.y1), x2: flip(box.x1), y2: num(box.y2) },
      pose,
    };
  };

  let drawn = 0;

  for (const track of tracks) {
    try {
      drawTrack(ctx, mirrorTrack(track));
      drawn += 1;
    } catch (error) {
      // One malformed track must never erase the others.
      console.warn('[overlay] track render skipped:', error?.message || error);
    }
  }

  for (const weapon of weapons) {
    try {
      const b = weapon.bbox || {};
      const x1 = flip(b.x1);
      const x2 = flip(b.x2);
      const left = Math.min(x1, x2);
      const boxWidth = Math.max(2, Math.abs(x2 - x1));
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(left, num(b.y1), boxWidth, Math.max(2, num(b.y2) - num(b.y1)));
      label(ctx, `WEAPON ${String(weapon.name || '').toUpperCase()} ${Math.round(num(weapon.score) * 100)}%`, left, num(b.y1) - 24, {
        bg: 'rgba(127, 29, 29, 0.95)',
        border: '#ef4444',
        fg: '#fee2e2',
      });
    } catch (error) {
      console.warn('[overlay] weapon render skipped:', error?.message || error);
    }
  }

  // --- HUD ---------------------------------------------------------------
  try {
    const crowded = gatheringCount > gatheringLimit;
    label(ctx, `PEOPLE ${gatheringCount}/${gatheringLimit}`, 10, 10, {
      bg: crowded ? 'rgba(153, 27, 27, 0.92)' : 'rgba(15, 23, 42, 0.88)',
      border: crowded ? '#ef4444' : 'rgba(34, 211, 238, 0.6)',
      fg: crowded ? '#fecaca' : '#67e8f9',
    });

    const noisy = soundLevel > soundLimit;
    ctx.font = 'bold 12px system-ui, sans-serif';
    const noiseText = `NOISE ${Math.round(soundLevel)}/${Math.round(soundLimit)} dB`;
    const noiseWidth = num(ctx.measureText(noiseText).width, 80) + 16;
    label(ctx, noiseText, width - noiseWidth - 10, 10, {
      bg: noisy ? 'rgba(124, 45, 18, 0.92)' : 'rgba(15, 23, 42, 0.88)',
      border: noisy ? '#fb923c' : 'rgba(234, 179, 8, 0.6)',
      fg: noisy ? '#fed7aa' : '#fde68a',
    });
  } catch (error) {
    console.warn('[overlay] hud render skipped:', error?.message || error);
  }

  // --- Liveness heartbeat ------------------------------------------------
  try {
    const persons = num(diag.persons, gatheringCount);
    const maxSpeed = num(diag.maxSpeed, 0);
    const heartbeat = `AI LIVE  ${fps.toFixed(1)} FPS  ${persons} TRACKED  ${drawn}/${tracks.length} DRAWN  MAX ${maxSpeed.toFixed(1)}`;

    label(ctx, heartbeat, 10, height - 52, {
      bg: 'rgba(15, 23, 42, 0.92)',
      border: 'rgba(34, 211, 238, 0.7)',
      fg: '#67e8f9',
    });

    if (diag.error) {
      label(ctx, `ENGINE ERROR: ${String(diag.error).slice(0, 90)}`, 10, height - 78, {
        bg: 'rgba(127, 29, 29, 0.95)',
        border: '#ef4444',
        fg: '#fecaca',
      });
    }
  } catch (error) {
    console.warn('[overlay] heartbeat render skipped:', error?.message || error);
  }

  // --- Footer ------------------------------------------------------------
  try {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, height - 22, width, 22);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.9)';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`POLICE AI SURVEILLANCE  ${new Date().toLocaleString()}`, 10, height - 11);
  } catch {
    /* footer is cosmetic */
  }
}
