// Pure-math core shared by the browser renderer and the Node analysis script:
// route geometry, ball kinematics (rolling without slipping, volume-conserving
// unwinding) and the camera shot list. Units are Web-Mercator meters.

export const W = 1920, H = 1080, FPS = 30, DURATION = 30;
export const NFRAMES = FPS * DURATION;
export const MERC_TILE = 156543.03392804097; // mercator meters per pixel at z0

// Ball: physical radius at start, fraction of its volume unwound by Harrods,
// on-screen radius used once the camera is far enough that the real ball
// would vanish (keeps the ball readable at continental scale).
export const BALL_R0 = 3.0;
export const BALL_UNWOUND = 0.72;
export const BALL_HERO_PX = 38;
export const THREAD_RATIO = 0.055; // yarn radius / ball radius

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, u) => a + (b - a) * u;
const lerpLog = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));

export class Path {
  constructor(data) {
    const n = data.mx.length;
    this.x = Float64Array.from(data.mx);
    this.y = Float64Array.from(data.my);
    this.km = Float64Array.from(data.km);
    this.s = new Float64Array(n);
    for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]);
    this.L = this.s[n - 1];
    this.n = n;
    this.marks = data.marks;
  }
  index(s) {
    s = clamp(s, 0, this.L);
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  at(s) {
    s = clamp(s, 0, this.L);
    const i = this.index(s), j = Math.min(i + 1, this.n - 1);
    const d = this.s[j] - this.s[i], u = d > 0 ? (s - this.s[i]) / d : 0;
    return { x: lerp(this.x[i], this.x[j], u), y: lerp(this.y[i], this.y[j], u), km: lerp(this.km[i], this.km[j], u), i };
  }
  sFromKm(km) {
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.km[m] <= km) lo = m; else hi = m; }
    const d = this.km[hi] - this.km[lo], u = d > 0 ? clamp((km - this.km[lo]) / d, 0, 1) : 0;
    return lerp(this.s[lo], this.s[hi], u);
  }
  // Unit direction of travel averaged over +-win meters (window grows with zoom
  // so road wiggles below a pixel don't jitter the ball or the camera).
  dir(s, win) {
    const a = this.at(s - win), b = this.at(s + win);
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) return this.dir(s, win * 2 + 1);
    return { x: dx / l, y: dy / l };
  }
  heading(s, win) { const d = this.dir(s, win); return Math.atan2(d.x, d.y); } // 0 = north, clockwise
}

export function fovFor(t) { return t < 3.6 ? 30 : t < 7 ? 38 : 32; }
export const mppAt = (dist, fov) => (2 * dist * Math.tan((fov * Math.PI) / 360)) / H;
const distFor = (mpp, fov) => (mpp * H) / (2 * Math.tan((fov * Math.PI) / 360));

// Ball distance along the route as a function of time. From rest the ball
// accelerates uniformly through Brera; afterwards each shot gets a constant
// on-screen speed (ds/dt proportional to the camera's meters-per-pixel) scaled
// to reach that shot's landmark, and at Harrods it brakes with constant
// deceleration (rolling resistance) to a stop.
export class Timeline {
  constructor(path, cam) {
    this.path = path;
    const km = (k) => path.sFromKm(k), L = path.L;
    const DT = 1 / 600, N = Math.round(DURATION / DT) + 1;
    const mpp = (t) => { const c = cam(t, 0); return mppAt(c.dist, c.fov); };
    const s = new Float64Array(N);
    const T0 = 1.3, ACC = 3.5, T1 = 7.0;
    const segs = [[7.0, 11.0, km(60)], [11.0, 15.5, km(330)], [15.5, 21.0, km(1125)], [21.0, 24.5, km(1278)]];
    const TB = 26.9, TSTOP = 28.9, WEND = 0.2;
    const w = (t) => lerp(1, WEND, smooth((t - 24.5) / (TB - 24.5)));
    for (let i = 0; i < N; i++) { const t = i * DT; s[i] = t <= T0 ? 0 : 0.5 * ACC * (Math.min(t, T1) - T0) ** 2; }
    const one = () => 1;
    const integ = (a, b, wf = one) => { let acc = 0; for (let t = a; t < b - 1e-9; t += DT) acc += mpp(t + DT / 2) * wf(t + DT / 2) * DT; return acc; };
    const fill = (a, b, s0, lam, wf = one) => {
      let acc = s0;
      for (let i = Math.round(a / DT); i <= Math.round(b / DT); i++) { s[i] = acc; acc += lam * mpp(i * DT + DT / 2) * wf(i * DT + DT / 2) * DT; }
      return s[Math.round(b / DT)];
    };
    let cur = s[Math.round(T1 / DT)];
    this.lambda = [];
    for (const [a, b, target] of segs) { const lam = (target - cur) / integ(a, b); this.lambda.push(lam); cur = fill(a, b, cur, lam); }
    // Final approach: screen-constant speed until TB, then uniform braking.
    const lam = (L - cur) / (integ(24.5, TB, w) + 0.5 * mpp(TB) * WEND * (TSTOP - TB));
    this.lambda.push(lam);
    const sb = fill(24.5, TB, cur, lam, w), vb = lam * mpp(TB) * WEND;
    this.brake = { vb, decel: vb / (TSTOP - TB), TB, TSTOP };
    for (let i = Math.round(TB / DT); i < N; i++) {
      const tt = Math.min(i * DT, TSTOP) - TB;
      s[i] = Math.min(L, sb + vb * tt - (0.5 * vb / (TSTOP - TB)) * tt * tt);
    }
    this.table = s; this.DT = DT;
  }
  s(t) {
    const x = Math.min(Math.max(t / this.DT, 0), this.table.length - 1), i = Math.floor(x), j = Math.min(i + 1, this.table.length - 1);
    return lerp(this.table[i], this.table[j], x - i);
  }
}

// Camera shots. Each returns {s (ball distance), tx, ty (look-at target),
// dist, tilt (deg from straight down), heading (deg, 0 = north), fov}.
export function makeCamera(P) {
  const H0 = P.heading(0, 25) * 180 / Math.PI;
  const HEND = P.heading(P.L - 30, 25) * 180 / Math.PI;
  const unwrap = (a, ref) => { while (a - ref > 180) a -= 360; while (a - ref < -180) a += 360; return a; };
  const travelHeading = (s, win) => P.heading(s, win) * 180 / Math.PI;

  return function camera(t, s) {
    const fov = fovFor(t);
    let dist, tilt, heading, leadPx = 0, shot;
    if (t < 3.6) { // 1. top-down hero, Brera
      shot = 1; const u = t / 3.6;
      dist = lerp(distFor(0.105, fov), distFor(0.088, fov), smooth(u));
      tilt = lerp(0, 10, smooth(u)); heading = H0 + lerp(-25, -8, smooth(u)); leadPx = 90 * smooth(u);
    } else if (t < 7.0) { // 2. low chase camera through Milan streets
      shot = 2; const u = (t - 3.6) / 3.4;
      dist = lerp(150, 175, smooth(u)); tilt = lerp(26, 42, smooth(u));
      heading = travelHeading(s, 25) + lerp(14, 4, smooth(u)); leadPx = 40;
    } else if (t < 11.0) { // 3. crane up from street to region
      shot = 3; const u = (t - 7.0) / 4.0, e = smoother(u);
      dist = lerpLog(175, 620000, smooth(Math.min(1, u * 1.05))); tilt = lerp(42, 0, smooth(u * 1.3));
      const th = travelHeading(s, Math.max(12, mppAt(dist, fov) * 120));
      heading = lerp(th + 12, unwrap(-20, th), e); leadPx = lerp(40, 160, e);
    } else if (t < 15.5) { // 4. oblique orbit over the Alps (Mont Blanc)
      shot = 4; const u = (t - 11.0) / 4.5;
      dist = lerp(330000, 240000, smooth(u)); tilt = lerp(57, 52, u);
      const th = travelHeading(s, 60000);
      heading = th + lerp(55, -35, smooth(u)); leadPx = 60;
    } else if (t < 21.0) { // 5. high top-down across France
      shot = 5; const u = (t - 15.5) / 5.5;
      dist = lerp(1.70e6, 1.95e6, smooth(u)); tilt = lerp(4, 0, u); heading = lerp(-18, 6, smooth(u)); leadPx = 170;
    } else if (t < 24.5) { // 6. oblique over the Channel tunnel
      shot = 6; const u = (t - 21.0) / 3.5;
      dist = lerp(380000, 300000, smooth(u)); tilt = lerp(48, 55, u);
      heading = travelHeading(s, 40000) + lerp(-30, 10, smooth(u)); leadPx = 80;
    } else { // 7. descent onto Knightsbridge and Harrods
      shot = 7; const u = clamp((t - 24.5) / 2.9, 0, 1), e = smoother(u), v = smooth((t - 27.4) / 2.6);
      dist = t < 27.4 ? lerpLog(300000, distFor(0.13, fov), smooth(u)) : lerp(distFor(0.13, fov), distFor(0.115, fov), v);
      tilt = lerp(50, 0, smooth(u * 1.15)) + 8 * v;
      const th = travelHeading(s, Math.max(20, mppAt(dist, fov) * 100));
      heading = lerp(th, unwrap(HEND - 90, th), smooth(u * 1.25)) + 8 * v;
      leadPx = lerp(80, 45, e);
    }
    const mpp = mppAt(dist, fov);
    const hr = (heading * Math.PI) / 180;
    const b = P.at(s);
    const lead = leadPx * mpp;
    return { shot, s, fov, dist, tilt, heading, mpp, tx: b.x + Math.sin(hr) * lead, ty: b.y + Math.cos(hr) * lead, bx: b.x, by: b.y, km: b.km };
  };
}

export const ballRadius = (s, L, mppBall) => {
  const rp = BALL_R0 * Math.cbrt(1 - BALL_UNWOUND * clamp(s / L, 0, 1));
  return { r: Math.hypot(rp, BALL_HERO_PX * mppBall * (rp / BALL_R0)), rPhys: rp };
};

// Quaternion helpers [x, y, z, w]
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qaxis = (ax, ay, az, ang) => { const s = Math.sin(ang / 2); return [ax * s, ay * s, az * s, Math.cos(ang / 2)]; };
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };

// Integrates the ball state for every frame: rolling without slipping means
// the ball turns by ds / R about the axis up x v (world frame), so its
// orientation is the product of those small rotations along the path.
export function simulate(path) {
  const cam = makeCamera(path);
  const tl = new Timeline(path, cam);
  const SUB = 12;
  const frames = [];
  let q = qnorm(qmul(qaxis(0, 1, 0, 0.7), qaxis(1, 0, 0, 0.4)));
  let prevS = 0;
  for (let f = 0; f < NFRAMES; f++) {
    const t = f / FPS;
    const c = cam(t, tl.s(t));
    const R = ballRadius(c.s, path.L, mppAt(c.dist, c.fov));
    for (let k = 1; k <= SUB; k++) {
      const s0 = prevS + ((c.s - prevS) * (k - 1)) / SUB, s1 = prevS + ((c.s - prevS) * k) / SUB;
      const ds = s1 - s0;
      if (ds <= 0) continue;
      const d = path.dir((s0 + s1) / 2, Math.max(R.r * 0.6, 0.5));
      // three.js frame: X east, Y up, Z south. v = (d.x, 0, -d.y); axis = up x v = (-d.y, 0, -d.x)
      q = qnorm(qmul(qaxis(-d.y, 0, -d.x, ds / R.r), q));
    }
    const d = path.dir(c.s, Math.max(R.r * 0.6, 0.5));
    frames.push({ t, ...c, R: R.r, rPhys: R.rPhys, q, speed: (c.s - prevS) * FPS, dx: d.x, dy: d.y });
    prevS = c.s;
  }
  return { tl, frames };
}
