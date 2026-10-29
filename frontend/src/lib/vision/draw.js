/**
 * Canvas overlay renderer for the surveillance feed.
 *
 * Kept separate from detection so the visuals can be changed or snapshot-tested
 * without touching the pipeline. Every draw call is wrapped so a single bad
 * coordinate can never blank the whole frame (the previous build could throw
 * mid-render and leave the canvas empty).
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

const FONT_BADGE = 'bold 13px system-ui, -apple-system, Segoe UI, sans-serif';
const FONT_SMALL = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';

const clampNumber = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

const roundRect = (ctx, x, y, w, h, r) => {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
};

const fillBadge = (ctx, x, y, text, { bg = 'rgba(15, 23, 42, 0.92)', fg = '#f8fafc', border = 'rgba(148, 163, 184, 0.5)' } = {}) => {
  ctx.save();
  ctx.font = FONT_BADGE;
  const width = ctx.measureText(text).width + 18;
  const height = 24;
  const left = clampNumber(x, 6, Math.max(6, ctx.canvas.width - width - 6));
  const top = Math.max(6, y);

  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.2;
  roundRect(ctx, left, top, width, height, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 9, top + height / 2 + 1);
  ctx.restore();

  return { width, height, left, top };
};

const drawSkeleton = (ctx, track, color, edges) => {
  const pose = track.pose;
  if (!pose || !pose.keypoints) return;

  const points = {};
  for (const point of pose.keypoints) {
    if (point && point.name) points[point.name] = point;
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.9;
  ctx.lineCap = 'round';

  for (const [from, to] of edges) {
    const a = points[from];
    const b = points[to];
    if (!a || !b) continue;
    if ((a.score ?? 0) < 0.25 || (b.score ?? 0) < 0.25) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  for (const point of pose.keypoints) {
    if ((point.score ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawTrack = (ctx, track, edges) => {
  const color = COLORS[track.state] || COLORS.NORMAL;
  const { x1, y1, x2, y2 } = track.bbox;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  const hot = track.state === 'ARMED' || track.state === 'STRIKING' || track.state === 'BRAWL';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = hot ? 3 : 2;
  if (hot) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }

  // Corner brackets — the tactical frame requested for every person.
  const corner = Math.max(12, Math.min(26, width * 0.18, height * 0.18));
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

  // Thin body outline.
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1;
  ctx.strokeRect(x1, y1, width, height);
  ctx.setLineDash([]);
  ctx.restore();

  drawSkeleton(ctx, track, color, edges);

  // Nameplate above the frame.
  const label = `#${track.id} · ${track.stateLabel || 'Person'}`;
  fillBadge(ctx, x1, y1 - 30, label, {
    bg: hot ? 'rgba(127, 29, 29, 0.94)' : 'rgba(15, 23, 42, 0.92)',
    border: color,
  });

  // Motion readout for confirmed movement.
  if (track.motion && track.motion.speed >= 1.2) {
    ctx.save();
    ctx.font = FONT_SMALL;
    ctx.fillStyle = color;
    ctx.fillText(`${track.motion.speed.toFixed(1)} torso/s`, x1 + 4, y2 + 14);
    ctx.restore();
  }
};

const drawWeapon = (ctx, weapon) => {
  const { x1, y1, x2, y2 } = weapon.bbox;
  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.6;
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 10;
  ctx.strokeRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
  ctx.restore();

  const text = `WEAPON: ${weapon.name.toUpperCase()} ${Math.round((weapon.score || 0) * 100)}%`;
  fillBadge(ctx, x1, y1 - 26, text, { bg: 'rgba(127, 29, 29, 0.95)', border: '#ef4444', fg: '#fee2e2' });
};

const drawStrikeLine = (ctx, attacker, victim) => {
  const from = attacker.motion?.activeLimb;
  const to = victim.motion?.bodyCenter;
  if (!from || !to) return;

  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(to.x, to.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {object} scene
 */
export function drawScene(ctx, canvas, scene) {
  const {
    tracks = [],
    weapons = [],
    gatheringCount = 0,
    gatheringLimit = 5,
    soundLevel = 0,
    soundLimit = 75,
    fps = 0,
    skeletonEdges = [],
    diag = {},
  } = scene;

  try {
    for (const track of tracks) drawTrack(ctx, track, skeletonEdges);
    for (const weapon of weapons) drawWeapon(ctx, weapon);

    for (const track of tracks) {
      if (track.state !== 'STRIKING' || !track.victimId) continue;
      const victim = tracks.find((candidate) => candidate.id === track.victimId);
      if (victim) drawStrikeLine(ctx, track, victim);
    }

    // Top threat banner.
    const hot = tracks.filter(
      (track) => track.state === 'ARMED' || track.state === 'STRIKING' || track.state === 'BRAWL',
    );
    if (hot.length > 0) {
      const primary = hot[0];
      const text = `THREAT: ${primary.stateLabel.toUpperCase()} · SUBJECT #${primary.id}`;
      ctx.save();
      ctx.font = FONT_BADGE;
      const width = ctx.measureText(text).width + 26;
      const x = Math.max(8, (canvas.width - width) / 2);
      ctx.fillStyle = 'rgba(153, 27, 27, 0.95)';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      roundRect(ctx, x, 10, width, 28, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 13, 25);
      ctx.restore();
    }

    // Telemetry strip.
    ctx.save();
    ctx.font = FONT_SMALL;
    ctx.textBaseline = 'top';

    const crowded = gatheringCount > gatheringLimit;
    const noise = soundLevel > soundLimit;

    const left = `PEOPLE ${gatheringCount}/${gatheringLimit}`;
    ctx.fillStyle = crowded ? 'rgba(153, 27, 27, 0.9)' : 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = crowded ? '#ef4444' : 'rgba(34, 211, 238, 0.5)';
    roundRect(ctx, 10, 10, ctx.measureText(left).width + 16, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = crowded ? '#fecaca' : '#67e8f9';
    ctx.fillText(left, 18, 16);

    const right = `NOISE ${Math.round(soundLevel)}/${soundLimit} dB`;
    const rightWidth = ctx.measureText(right).width + 16;
    ctx.fillStyle = noise ? 'rgba(124, 45, 18, 0.9)' : 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = noise ? '#fb923c' : 'rgba(234, 179, 8, 0.5)';
    roundRect(ctx, canvas.width - rightWidth - 10, 10, rightWidth, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = noise ? '#fed7aa' : '#fde68a';
    ctx.fillText(right, canvas.width - rightWidth - 2, 16);
    ctx.restore();

    // Liveness heartbeat. This is drawn on every frame, even with nobody in
    // view, so "engine running but nothing on screen" can never be ambiguous
    // again: if this chip is visible the render path works.
    ctx.save();
    ctx.font = FONT_SMALL;
    ctx.textBaseline = 'top';
    const persons = diag.persons ?? gatheringCount;
    const maxSpeed = diag.maxSpeed ?? 0;
    const heartbeat = `AI LIVE · ${fps.toFixed(1)} FPS · ${persons} TRACKED · MAX ${maxSpeed.toFixed(1)} t/s`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.65)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, 10, canvas.height - 50, ctx.measureText(heartbeat).width + 18, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#67e8f9';
    ctx.fillText(heartbeat, 18, canvas.height - 44);

    if (diag.error) {
      const message = String(diag.error).slice(0, 120);
      const errorText = `ENGINE ERROR · ${message}`;
      ctx.fillStyle = 'rgba(127, 29, 29, 0.94)';
      ctx.strokeStyle = '#ef4444';
      roundRect(ctx, 10, canvas.height - 76, ctx.measureText(errorText).width + 18, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fecaca';
      ctx.fillText(errorText, 18, canvas.height - 70);
    }
    ctx.restore();

    // Forensic footer: timestamp + engine state.
    ctx.save();
    ctx.font = FONT_SMALL;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, canvas.height - 22, canvas.width, 22);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.9)';
    const stamp = new Date().toLocaleString();
    ctx.fillText(
      `POLICE AI SURVEILLANCE · ${fps.toFixed(1)} FPS · ${stamp}`,
      10,
      canvas.height - 15,
    );
    ctx.restore();
  } catch (error) {
    // Never let a rendering bug kill the detection loop.
    console.error('Overlay render error:', error);
  }
}
