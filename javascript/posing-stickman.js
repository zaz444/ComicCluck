/* posing-stickman.js
 * Shared rig for the "Posing Stickman" sprite. Loaded by the editor (create-mobile.html) and the sprite gallery (spritegallery.html).
 * The sprite is still a normal 'img' layer: layer.src is a transparent PNG rendered from layer.rig (joint angles).
 * That means resize / rotate / flip / fx / layers / publish / reader all work with zero changes, and the reader only ever sees a PNG.
 */
(function (global) {
  'use strict';
  var D = Math.PI / 180;
  // every pose renders into the same fixed box, so box coords map linearly onto the layer box (no trimming for this sprite)
  var BOX = { w: 400, h: 460, ground: 452 };
  var LEN = { sp: 115, nk: 38, ua: 55, fa: 55, th: 85, sh: 88, head: 26 };
  // [id, label]. 'idle' is the gallery's Default image, the rest are its actions
  var ORDER = [['idle', 'Default'], ['shrug', 'Shrug'], ['point', 'Point'], ['angry', 'Angry'], ['kick', 'Kick'],
               ['punch', 'Punch'], ['fall', 'Fall'], ['handup', 'Hand up'], ['surprised', 'Surprised']];
  // angles in degrees (0 = right, 90 = down): spine, head, L upper arm, L forearm, R upper arm, R forearm, L thigh, L shin, R thigh, R shin
  var POSES = {
    idle:      { a: [-90, -90, 105, 95, 75, 85, 100, 108, 72, 80] },
    shrug:     { a: [-88, -82, 130, 200, 50, -20, 100, 108, 72, 80] },
    point:     { a: [-92, -88, 100, 95, -5, -5, 102, 110, 72, 82] },
    angry:     { a: [-80, -72, 125, 80, 55, 100, 108, 118, 62, 72] },
    kick:      { x: 190, a: [-98, -95, 150, 170, 30, 10, 92, 96, -15, -5] },
    punch:     { x: 190, a: [-85, -85, 120, -32, -2, -2, 105, 125, 50, 95] },
    fall:      { x: 240, y: 300, air: 1, a: [-145, -160, 160, 200, -60, -80, 40, 70, -70, -30] },
    handup:    { a: [-90, -88, 105, 95, -50, -92, 100, 108, 72, 80] },
    surprised: { a: [-95, -98, 145, 260, 35, -80, 96, 104, 76, 84] }
  };
  // joints: 0 head, 1 neck, 2 hip, 3 L elbow, 4 L hand, 5 R elbow, 6 R hand, 7 L knee, 8 L foot, 9 R knee, 10 R foot
  // two-bone limbs: hand/foot -> [root joint, upper angle idx, lower angle idx, upper len, lower len]
  var IK = { 4: [1, 2, 3, LEN.ua, LEN.fa], 6: [1, 4, 5, LEN.ua, LEN.fa], 8: [2, 6, 7, LEN.th, LEN.sh], 10: [2, 8, 9, LEN.th, LEN.sh] };
  var HANDLE_JOINTS = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10]; // hip is moved by dragging the layer itself

  function add(p, l, deg) { return [p[0] + l * Math.cos(deg * D), p[1] + l * Math.sin(deg * D)]; }
  function ang(f, t) { return Math.atan2(t[1] - f[1], t[0] - f[0]) / D; }

  function pts(r) {
    var a = r.a, h = [r.x, r.y], n = add(h, LEN.sp, a[0]), hd = add(n, LEN.nk, a[1]);
    var le = add(n, LEN.ua, a[2]), lh = add(le, LEN.fa, a[3]), re = add(n, LEN.ua, a[4]), rh = add(re, LEN.fa, a[5]);
    var lk = add(h, LEN.th, a[6]), lf = add(lk, LEN.sh, a[7]), rk = add(h, LEN.th, a[8]), rf = add(rk, LEN.sh, a[9]);
    return [hd, n, h, le, lh, re, rh, lk, lf, rk, rf];
  }

  function makeRig(id) {
    var key = POSES[id] ? id : 'idle', p = POSES[key];
    var r = { pose: key, x: p.x == null ? 200 : p.x, y: p.y || 0, a: p.a.slice() };
    if (!p.air) { var f = pts(r); r.y = BOX.ground - Math.max(f[8][1], f[10][1]); } // standing poses plant their lowest foot on the ground
    return r;
  }
  function cloneRig(r) { return { pose: r.pose, x: r.x, y: r.y, a: r.a.slice() }; }

  // ---- rendering (transparent PNG data URL) ----
  var _cv = null;
  function render(rig, scale) {
    scale = scale || 1.5;
    var c = _cv || (_cv = document.createElement('canvas'));
    c.width = Math.round(BOX.w * scale); c.height = Math.round(BOX.h * scale);
    var x = c.getContext('2d');
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.clearRect(0, 0, BOX.w, BOX.h);
    x.lineCap = 'round'; x.lineJoin = 'round';
    var f = pts(rig);
    function line(p) { x.beginPath(); x.moveTo(p[0][0], p[0][1]); for (var i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]); x.stroke(); }
    x.strokeStyle = '#000'; x.lineWidth = 7;
    line([f[1], f[2]]); line([f[1], f[3], f[4]]); line([f[1], f[5], f[6]]);
    line([f[2], f[7], f[8]]); line([f[2], f[9], f[10]]); line([f[1], f[0]]);
    x.fillStyle = '#000';
    [4, 6].forEach(function (j) { x.beginPath(); x.arc(f[j][0], f[j][1], 5.5, 0, 7); x.fill(); });
    x.fillStyle = '#fff'; x.lineWidth = 6;
    x.beginPath(); x.arc(f[0][0], f[0][1], LEN.head, 0, 7); x.fill(); x.stroke();
    return c.toDataURL('image/png');
  }

  // ---- joint dragging: bones keep their length ----
  function startDrag(rig, k) {
    if (!IK[k]) return 1;
    if (k >= 8) return -1; // knees always bend forward (poses face right; flip is CSS so it mirrors for free)
    var f = pts(rig), r = f[IK[k][0]], h = f[k], e = f[k - 1];
    return ((h[0] - r[0]) * (e[1] - r[1]) - (h[1] - r[1]) * (e[0] - r[0])) >= 0 ? 1 : -1;
  }
  function dragJoint(rig, k, q, sign) {
    var f = pts(rig), i, d;
    q = [Math.max(8, Math.min(BOX.w - 8, q[0])), Math.max(8, Math.min(BOX.h - 8, q[1]))];
    if (k === 0) rig.a[1] = ang(f[1], q);
    else if (k === 1) rig.a[0] = ang(f[2], q);
    else if (k === 3 || k === 5) { i = k === 3 ? 2 : 4; d = ang(f[1], q) - rig.a[i]; rig.a[i] += d; rig.a[i + 1] += d; }
    else if (k === 7 || k === 9) { i = k === 7 ? 6 : 8; d = ang(f[2], q) - rig.a[i]; rig.a[i] += d; rig.a[i + 1] += d; }
    else if (IK[k]) {
      var c = IK[k], r = f[c[0]], L1 = c[3], L2 = c[4];
      var base = Math.atan2(q[1] - r[1], q[0] - r[0]);
      var dd = Math.max(Math.abs(L1 - L2) + 1, Math.min(L1 + L2 - 0.01, Math.hypot(q[0] - r[0], q[1] - r[1])));
      var al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd))));
      var ua = base + sign * al;
      var el = [r[0] + L1 * Math.cos(ua), r[1] + L1 * Math.sin(ua)];
      rig.a[c[1]] = ua / D;
      rig.a[c[2]] = ang(el, [r[0] + dd * Math.cos(base), r[1] + dd * Math.sin(base)]);
    }
    rig.pose = 'custom';
  }

  // ---- library glue ----
  function isRigPack(p) {
    if (!p) return false;
    var t = p.tags;
    if (typeof t === 'string') t = t.split(',');
    t = (t || []).map(function (s) { return String(s).trim().toLowerCase(); });
    return (t.indexOf('poser') > -1 && t.indexOf('joints') > -1) || String(p.name || '').trim().toLowerCase() === 'posing stickman';
  }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); }
  // which pose did the user tap in the action modal? the modal only hands us the image url, so match it back to the pack's action names
  function poseIdFor(img, pack) {
    if (!pack) return 'idle';
    if (img && img === pack.image_data) return 'idle';
    var acts = pack.actions;
    if (typeof acts === 'string') { try { acts = JSON.parse(acts); } catch (e) { acts = {}; } }
    if (acts && !Array.isArray(acts)) for (var k in acts) { if (acts[k] === img && POSES[norm(k)]) return norm(k); }
    return 'idle';
  }
  function applyPose(layer, id) {
    layer.rig = makeRig(id);
    layer.src = render(layer.rig);
    delete layer._cropBlocked; delete layer.charScale; delete layer._rawBasis; // this sprite is never trimmed, so the char-trim bookkeeping doesn't apply
    return layer;
  }

  // ---- on-canvas joint handles, shown while the layer is selected ----
  function injectCss() {
    if (document.getElementById('ps-joint-css')) return;
    var s = document.createElement('style'); s.id = 'ps-joint-css';
    s.textContent = '.joint-handle{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2px solid #ff7a00;' +
      'background:rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(0,0,0,.35);z-index:30;touch-action:none;cursor:grab;box-sizing:border-box}';
    document.head.appendChild(s);
  }
  function toBox(el, layer, cx, cy) {
    var r = el.getBoundingClientRect(), mx = r.left + r.width / 2, my = r.top + r.height / 2;
    var par = el.parentElement, sc = (par && par.offsetWidth) ? (par.getBoundingClientRect().width / par.offsetWidth) || 1 : 1; // canvas zoom
    var dx = (cx - mx) / sc, dy = (cy - my) / sc, rot = -(layer.rotation || 0) * D;
    var lx = dx * Math.cos(rot) - dy * Math.sin(rot), ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    if (layer.flipped) lx = -lx; // el is rotate() then scaleX(-1), undo in reverse order
    var w = el.offsetWidth || layer.w, h = el.offsetHeight || layer.h;
    return [(lx + w / 2) * BOX.w / w, (ly + h / 2) * BOX.h / h];
  }
  // api: { saveState(), onCommit(layer) }
  function attachJointHandles(el, layer, api) {
    api = api || {};
    Array.prototype.forEach.call(el.querySelectorAll('.joint-handle'), function (n) { n.remove(); });
    if (!layer.rig) return;
    injectCss();
    var handles = [], raf = 0;
    function reposition() {
      var P = pts(layer.rig);
      handles.forEach(function (it) { it.h.style.left = (P[it.k][0] / BOX.w * 100) + '%'; it.h.style.top = (P[it.k][1] / BOX.h * 100) + '%'; });
    }
    function paint() {
      raf = 0;
      layer.src = render(layer.rig);
      var img = el.querySelector('img'); if (img) img.src = layer.src; // update in place, a full render() mid-drag would rebuild the handle under the finger
      reposition();
    }
    HANDLE_JOINTS.forEach(function (k) {
      var h = document.createElement('div');
      h.className = 'joint-handle'; h.dataset.joint = k;
      var sign = 1, dragging = false;
      function begin() {
        if (api.saveState) api.saveState();
        layer.rig = cloneRig(layer.rig); // duplicated layers share the rig object until now
        sign = startDrag(layer.rig, k); dragging = true;
      }
      function move(cx, cy) {
        if (!dragging) return;
        dragJoint(layer.rig, k, toBox(el, layer, cx, cy), sign);
        if (!raf) raf = requestAnimationFrame(paint);
      }
      function end() {
        if (!dragging) return; dragging = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        paint();
        if (api.onCommit) api.onCommit(layer);
      }
      h.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); begin(); }, { passive: false });
      h.addEventListener('touchmove', function (e) { e.preventDefault(); e.stopPropagation(); var t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: false });
      h.addEventListener('touchend', function (e) { e.stopPropagation(); end(); });
      h.addEventListener('touchcancel', function (e) { e.stopPropagation(); end(); });
      h.addEventListener('mousedown', function (e) {
        e.preventDefault(); e.stopPropagation(); begin();
        var mv = function (ev) { move(ev.clientX, ev.clientY); };
        var up = function () { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); end(); };
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
      el.appendChild(h); handles.push({ k: k, h: h });
    });
    reposition();
  }

  // ---- built-in gallery entry: no database row needed ----
  // The gallery pages splice this in client-side, so it shows up like any other sprite (card, preview, tags, actions, editor picker)
  var BUILTIN_ID = 'builtin-posing-stickman';
  var BUILTIN_TAGS = ['stickman', 'poser', 'joints', 'misc'];
  var _full = null;
  function fullData() { // image_data + actions as data URLs, rendered once per page load
    if (_full) return _full;
    var actions = {}, main = null;
    ORDER.forEach(function (o) { var u = render(makeRig(o[0])); if (o[0] === 'idle') main = u; else actions[o[1]] = u; });
    _full = { id: BUILTIN_ID, name: 'Posing Stickman', creator: 'ComicCluck', tags: BUILTIN_TAGS.slice(), default_scale: 400,
              image_data: main, actions: actions, builtin: true };
    return _full;
  }
  function meta() { // same shape as the lean rows the gallery lists load from the database; newest date so it sits first under "Newest"
    return { id: BUILTIN_ID, name: 'Posing Stickman', creator: 'ComicCluck', tags: BUILTIN_TAGS.slice(), default_scale: 400,
             created_at: new Date().toISOString(), builtin: true };
  }
  function withBuiltin(list) {
    list = list || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === BUILTIN_ID) return list;
    return [meta()].concat(list);
  }

  var API = {
    BUILTIN_ID: BUILTIN_ID, fullData: fullData, meta: meta, withBuiltin: withBuiltin,
    BOX: BOX, ORDER: ORDER, POSES: POSES, pts: pts, makeRig: makeRig, render: render, startDrag: startDrag, dragJoint: dragJoint,
    isRigPack: isRigPack, poseIdFor: poseIdFor, applyPose: applyPose, attachJointHandles: attachJointHandles
  };
  global.PosingStickman = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
