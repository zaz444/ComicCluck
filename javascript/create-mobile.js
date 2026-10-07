// create-mobile.js — all the mobile creator JS, yanked out of the html
// good luck
        
        (function () {
            function setAppHeight() {
                var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                document.documentElement.style.setProperty('--app-vh', h + 'px');
            }
            setAppHeight();
            [0, 50, 150, 300, 600, 1000].forEach(function (t) { setTimeout(setAppHeight, t); });
            window.addEventListener('resize', setAppHeight);
            window.addEventListener('orientationchange', setAppHeight);
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', setAppHeight);
            }
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') setAppHeight();
            });
        })();
// supabase
const _supabase = supabase.createClient('https://mmycqeejhguzhtzkyjaj.supabase.co','sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE', {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' }
});

// upload bg image, returns url or null
async function uploadBgToStorage(dataUrl) {
    try {
        const handle = JSON.parse(localStorage.getItem('user_profile') || '{}').handle || 'guest';
        const safeHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'guest';
        const res  = await fetch(dataUrl);
        const blob = await res.blob();
        const ext  = dataUrl.startsWith('data:image/gif')  ? 'gif'
                   : dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg';
        const path = 'user/' + safeHandle + '/bg_' + Date.now() + '.' + ext;
        const { error } = await _supabase.storage
            .from('backgrounds')
            .upload(path, blob, { upsert: true, cacheControl: '3600' });
        if (error) { console.warn('BG storage upload error:', error); return null; }
        return _supabase.storage.from('backgrounds').getPublicUrl(path).data.publicUrl;
    } catch (e) {
        console.warn('uploadBgToStorage failed:', e);
        return null;
    }
}

// upload cover
async function uploadCoverToStorage(dataUrl) {
    try {
        const handle = (typeof myHandle !== 'undefined' && myHandle)
            || JSON.parse(localStorage.getItem('user_profile') || '{}').handle
            || 'guest';
        const safeHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'guest';
        const res  = await fetch(dataUrl);
        const blob = await res.blob();
        const ext  = dataUrl.startsWith('data:image/gif')  ? 'gif'
                   : dataUrl.startsWith('data:image/webp') ? 'webp'
                   : 'jpg';
        const path = 'userimages/coverimages/' + safeHandle + '_' + Date.now() + '.' + ext;
        const { error } = await _supabase.storage
            .from('comiccore-assets')
            .upload(path, blob, { upsert: true, cacheControl: '86400', contentType: 'image/' + ext });
        if (error) { console.warn('Cover storage upload error:', error); return null; }
        return _supabase.storage.from('comiccore-assets').getPublicUrl(path).data.publicUrl;
    } catch (e) {
        console.warn('uploadCoverToStorage failed:', e);
        return null;
    }
}

// upload sprite, separate from bg upload since sprites need png for transparency (bg defaults to jpg unless gif/webp)
async function uploadSpriteToStorage(dataUrl) {
    try {
        const handle = (typeof myHandle !== 'undefined' && myHandle)
            || JSON.parse(localStorage.getItem('user_profile') || '{}').handle
            || 'guest';
        const safeHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'guest';
        const res  = await fetch(dataUrl);
        const blob = await res.blob();
        const ext  = dataUrl.startsWith('data:image/gif')  ? 'gif'
                   : dataUrl.startsWith('data:image/webp') ? 'webp'
                   : dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg') ? 'jpg'
                   : 'png';
        const path = 'user/' + safeHandle + '/sprite_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
        const { error } = await _supabase.storage
            .from('backgrounds')
            .upload(path, blob, { upsert: true, cacheControl: '86400', contentType: 'image/' + ext });
        if (error) { console.warn('Sprite storage upload error:', error); return null; }
        return _supabase.storage.from('backgrounds').getPublicUrl(path).data.publicUrl;
    } catch (e) {
        console.warn('uploadSpriteToStorage failed:', e);
        return null;
    }
}

function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch(e) {
        try {
            const toDelete = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('sprite-used-') || k.startsWith('efx-used-') || k.startsWith('sb-full-'))) toDelete.push(k);
            }
            toDelete.slice(0, Math.max(1, Math.floor(toDelete.length / 2))).forEach(k => localStorage.removeItem(k));
            localStorage.setItem(key, value);
        } catch(e2) { /* still full, give up gracefully */ }
    }
}

// state
let frames = [{ layers: [], background: '#ffffff' }];
// plain buttons not color input — android webview renders it as a dead swatch
const MOB_COLOR_PRESETS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#8e8e93'];
// true if fx is for background not sprite
let fxEditingBg = false;
let currentIdx = 0;
let history = [], redoStack = [];
let activeLayer = null;
let selectedLayers = [];
// pin targeting: when one or more layers are pinned, canvas taps on any non-pinned layer are ignored
function anyLayersPinned() {
    const f = frames[currentIdx];
    return !!(f && f.layers && f.layers.some(l => l.pinned));
}
let cropper = null;
let currentImportType = null;
let hasUnsavedChanges = false;
let activeDraftId = null;
let draftRowExists = false; // true once a 'drafts' row is known to exist for activeDraftId
// loading flag — don't autosave during load or you nuke the draft (this was the bug that deleted drafts)
let _draftLoadPending = false;
let myHandle = null; // fix: was referenced in saveOffline() but never declared at this scope
let editingComicId = null;
// collab co-owner handles, populated on load, for notifications not auth
let _collabOwnerHandles = [];
// cached owner_handle/user_id sent on every save instead of gating on draftRowExists — that flag lied whenever client state was stale
let _draftOwnerHandle = null;
let _draftUserId = null;
// tracks blob path for current comic so republish can clean up the old one, see finalPublish
let loadedComicStoragePath = null;
let finalCoverBase64 = null;
// age rating
const PUB_AGE_RATINGS = [
    { code: null,  label: 'Unrated',  color: '#666' },
    { code: 'E',   label: 'Everyone', color: '#32d74b' },
    { code: 'T',   label: 'Teen',     color: '#ffd60a' },
    { code: 'T+',  label: 'Teen+',    color: '#ff453a' },
];
let pubSelectedRating = null;
let pubRatingLocked   = false;
const pubIsAdmin = JSON.parse(localStorage.getItem('user_profile') || '{}').handle === 'jeffyplays';

function renderPubRatingPicker() {
    const row  = document.getElementById('pub-rating-row');
    const note = document.getElementById('pub-rating-lock-note');
    if (!row) return;
    const canEdit = pubIsAdmin || !pubRatingLocked;

    row.innerHTML = PUB_AGE_RATINGS.map(r => {
        const active = pubSelectedRating === r.code;
        const border = active ? r.color : '#333';
        const bg     = active ? r.color + '22' : '#161616';
        const color  = active ? r.color : '#888';
        const codeArg = r.code ? `'${r.code}'` : 'null';
        return `<button type="button" class="pub-rating-pill" ` +
            `style="border-color:${border};background:${bg};color:${color};${canEdit ? 'cursor:pointer;' : 'opacity:.5;'}" ` +
            `${canEdit ? `onclick="selectPubRating(${codeArg})"` : 'disabled'}>${r.label}</button>`;
    }).join('');

    if (pubRatingLocked && !pubIsAdmin) {
        note.style.display = 'block';
        note.innerText = '🔒 An admin locked this rating — only they can change it.';
    } else {
        note.style.display = 'none';
    }
}

function selectPubRating(code) {
    if (pubRatingLocked && !pubIsAdmin) return;
    pubSelectedRating = code;
    renderPubRatingPicker();
}
let frameClipboard = null;
let canvasRatio = { w: 1, h: 1 };
let sidebarSprites = null;

const canvas = document.getElementById('comic-frame');
const onionCanvas = document.getElementById('onion-skin-canvas');
const onionCtx = onionCanvas.getContext('2d');
onionCtx.imageSmoothingEnabled = false; // keep onion-skin sprite previews crisp, not blurred

// ref canvas side (px) that default_scale / text defaults were authored against (iPhone, 1:1). change this one number if sprites still look off
const CC_REF_SIDE = 366;
function ccRefScale(cw, ch) { return Math.min(cw, ch) / CC_REF_SIDE; }

// canvas pixel size for ratio, shared by setRatio and save so reader scales layers back correctly
function computeCanvasSize(w, h) {
    const vp = document.getElementById('viewport');
    // use visualViewport if we have it, else clientWidth/Height
    const vpW = (window.visualViewport ? window.visualViewport.width : vp.clientWidth) - 24;
    const vpH = vp.clientHeight - 24;
    let cw, ch;
    if (w / h > vpW / vpH) { cw = vpW; ch = Math.round(vpW * h / w); }
    else { ch = vpH; cw = Math.round(vpH * w / h); }
    return { cw, ch };
}
// ratio for frame, falls back to live ratio for old drafts
function getFrameRatio(f) {
    return (f && f.ratio && f.ratio.w && f.ratio.h) ? f.ratio : canvasRatio;
}

// rescale layers per-ratio on viewport change instead of just refitting the canvas — fixes sprites drifting after publish (the misplaced-sprites bug)
let _lastCanvasSizeByRatio = {};
function _ratioKey(w, h) { return w + ':' + h; }
// session size, falls back to frame's persisted stamp so a reopened draft catches up on first activation
function _knownCanvasSizeForRatio(w, h) {
    const cached = _lastCanvasSizeByRatio[_ratioKey(w, h)];
    if (cached) return cached;
    const stamped = frames.find(f => {
        const fr = getFrameRatio(f);
        return fr.w === w && fr.h === h && f._editorW && f._editorH;
    });
    return stamped ? { cw: stamped._editorW, ch: stamped._editorH } : null;
}
function setRatio(w, h) {
    canvasRatio = { w, h };
    lsSet('cc-active-ratio', JSON.stringify({ w, h }));
    const { cw, ch } = computeCanvasSize(w, h);

    const prev = _knownCanvasSizeForRatio(w, h);
    // fixed a bug where a garbage mid-layout measurement (like 40x) flung layers way off canvas, looked exactly like they'd been deleted. real resizes never jump more than ~6x so anything crazier than that just gets ignored and we save the new size as the baseline instead
    if (prev && prev.cw > 0 && prev.ch > 0 && (Math.abs(prev.cw - cw) > 0.5 || Math.abs(prev.ch - ch) > 0.5)) {
        const scale = cw / prev.cw; // aspect is always preserved, so this equals ch/prev.ch too
        if (isFinite(scale) && scale > 0.15 && scale < 6) {
            frames.forEach(f => {
                const fr = getFrameRatio(f);
                if (fr.w !== w || fr.h !== h) return;
                (f.layers || []).forEach(l => {
                    if (l.x != null) l.x *= scale;
                    if (l.y != null) l.y *= scale;
                    if (l.w != null) l.w *= scale;
                    if (l.h != null) l.h *= scale;
                    // charHeight ref needs to track pose/action swaps, don't use stale value
                    if (l.charHeight != null) l.charHeight *= scale;
                    if (l.charScale != null) l.charScale *= scale;
                });
            });
        } else {
            console.warn('setRatio: implausible scale ' + scale + ' for ' + w + ':' + h + ' — skipped rescale, kept layer positions as-is');
        }
    }
    _lastCanvasSizeByRatio[_ratioKey(w, h)] = { cw, ch };

    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    onionCanvas.width = cw; onionCanvas.height = ch;
    // used to just call render() here but that only queues a rAF and silently no-ops if one's already pending, which on a fresh page load meant it sometimes never actually repainted til you tapped something. painting immediately instead since this only ever fires from real user actions anyway, no need to debounce
    if (_renderRaf) { cancelAnimationFrame(_renderRaf); _renderRaf = null; }
    _renderNow();
}
// switch to frame i, resize canvas to its ratio first so per-frame ratios work
function activateFrame(i) {
    currentIdx = i;
    activeLayer = null;
    const f = frames[currentIdx];
    const r = getFrameRatio(f);
    if (r.w !== canvasRatio.w || r.h !== canvasRatio.h) setRatio(r.w, r.h);
    else render();
}

// per-frame ratio change
const RATIO_PRESETS = [
    { w: 1,  h: 1,  label: '1:1' },
    { w: 4,  h: 5,  label: '4:5' },
    { w: 3,  h: 4,  label: '3:4' },
    { w: 2,  h: 3,  label: '2:3' },
    { w: 9,  h: 16, label: '9:16' },
    { w: 16, h: 9,  label: '16:9' },
    { w: 3,  h: 2,  label: '3:2' },
];
let pendingRatioChange = null; // { idx, w, h } awaiting a clip-warning decision

function openFrameRatioPicker() {
    const panel = document.getElementById('frame-ratio-panel');
    if (!panel) return;
    const isOpen = panel.style.display === 'flex';
    panel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) renderFrameRatioPicker();
}
function renderFrameRatioPicker() {
    const panel = document.getElementById('frame-ratio-panel');
    if (!panel) return;
    const active = getFrameRatio(frames[currentIdx]);
    panel.innerHTML = RATIO_PRESETS.map(p => {
        const isActive = active.w === p.w && active.h === p.h;
        return `<button onclick="pickFrameRatio(${p.w},${p.h})" style="padding:8px 10px;border-radius:8px;font-size:12px;font-weight:800;border:2px solid ${isActive ? 'var(--accent)' : '#333'};background:${isActive ? 'var(--accent)' : '#1b1b1c'};color:${isActive ? '#000' : '#ccc'};cursor:pointer;">${p.label}</button>`;
    }).join('');
    const numLbl = document.getElementById('frame-ratio-frame-num');
    if (numLbl) numLbl.innerText = currentIdx + 1;
    const curLbl = document.getElementById('frame-ratio-current');
    if (curLbl) curLbl.innerText = active.w + ':' + active.h;
}
// check if layer spills outside frame at this ratio
function checkRatioClipping(frame, w, h) {
    const { cw, ch } = computeCanvasSize(w, h);
    return (frame.layers || []).some(l => {
        const lw = l.w || 0;
        const lh = (l.h != null ? l.h : lw);
        return l.x < 0 || l.y < 0 || (l.x + lw) > cw || (l.y + lh) > ch;
    });
}
function pickFrameRatio(w, h) {
    const idx = currentIdx;
    const frame = frames[idx];
    const current = getFrameRatio(frame);
    if (current.w === w && current.h === h) { document.getElementById('frame-ratio-panel').style.display = 'none'; return; }
    if (checkRatioClipping(frame, w, h)) {
        pendingRatioChange = { idx, w, h };
        showRatioClipWarning(idx);
    } else {
        commitFrameRatioChange(idx, w, h);
        document.getElementById('frame-ratio-panel').style.display = 'none';
    }
}
function commitFrameRatioChange(idx, w, h) {
    saveState();
    // resize while old ratio still reported, so same-ratio rescale doesn't treat layers as already placed
    if (idx === currentIdx) setRatio(w, h);
    frames[idx].ratio = { w, h };
    hasUnsavedChanges = true;
    const dot = document.getElementById('unsaved-dot');
    if (dot) dot.style.display = 'block';
    renderMobFrames();
    renderFrameRatioPicker();
}
function showRatioClipWarning(idx) {
    const modal = document.getElementById('ratio-clip-modal');
    if (!modal) return;
    document.getElementById('ratio-clip-msg').innerText =
        `Changing to this ratio will push one or more layers on frame ${idx + 1} outside the frame edges.`;
    modal.style.display = 'flex';
}
function closeRatioClipModal() {
    const modal = document.getElementById('ratio-clip-modal');
    if (modal) modal.style.display = 'none';
    pendingRatioChange = null;
}
function applyPendingRatioAnyway() {
    if (!pendingRatioChange) return;
    const { idx, w, h } = pendingRatioChange;
    commitFrameRatioChange(idx, w, h);
    flashClippingLayers(idx);
    closeRatioClipModal();
    const panel = document.getElementById('frame-ratio-panel');
    if (panel) panel.style.display = 'none';
}
// jump to frame without applying ratio change, lets user move stuff first
function viewPendingRatioFrame() {
    if (!pendingRatioChange) return;
    const { idx } = pendingRatioChange;
    activateFrame(idx);
    renderMobFrames();
    updateFrameCounter();
    closeRatioClipModal();
    closeSheet('frames');
}
// flash outline on spilling layers so it's obvious what needs fixing
function flashClippingLayers(idx) {
    const frame = frames[idx];
    if (!frame) return;
    const r = getFrameRatio(frame);
    const { cw, ch } = computeCanvasSize(r.w, r.h);
    (frame.layers || []).forEach(l => {
        const lw = l.w || 0;
        const lh = (l.h != null ? l.h : lw);
        l._clipWarn = (l.x < 0 || l.y < 0 || (l.x + lw) > cw || (l.y + lh) > ch);
    });
    if (idx === currentIdx) render();
    setTimeout(() => {
        (frame.layers || []).forEach(l => { delete l._clipWarn; });
        if (idx === currentIdx) render();
    }, 3500);
}

// sheet system
function openSheet(name) {
    closeAllSheets();
    document.getElementById('sheet-overlay').classList.add('open');
    const sheetEl = document.getElementById('sheet-' + name);
    if (sheetEl) sheetEl.classList.add('open');
    if (name === 'sprites') loadMobSprites();
    if (name === 'mysprites') loadMySprites();
    if (name === 'gallery') loadMobGallery();
    if (name === 'effects' && mobSidebarEffects === null) loadMobEffects();
    if (name === 'bg') loadMobBgs();
    if (name === 'layers') renderMobLayers();
    if (name === 'frames') renderMobFrames();
    if (name === 'audio') renderMobAudioSheet();
    if (name === 'bg') syncBgSliders();
    if (name === 'fx') syncFxPanel();
    if (name === 'favorites') renderMobFavPanel();
}
function closeSheet(name) {
    document.getElementById('sheet-overlay').classList.remove('open');
    document.getElementById('sheet-' + name).classList.remove('open');
    // hide bg drag overlay on close
    if (name === 'bg' && mobBgDragActive) {
        mobBgDragActive = false;
        document.getElementById('bg-drag-overlay').style.display = 'none';
    }
    if (name === 'audio') stopAllMobAudioPreviews();
}
function closeAllSheets() {
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
    document.getElementById('sheet-overlay').classList.remove('open');
}

// transform sheet
function openTransformSheet() {
    if (!activeLayer) return;
    document.getElementById('transform-sheet').classList.add('open');
    document.getElementById('transform-sheet-backdrop').classList.add('open');
    syncTransformSheet();
}
function closeTransformSheet() {
    document.getElementById('transform-sheet').classList.remove('open');
    document.getElementById('transform-sheet-backdrop').classList.remove('open');
    const sw = document.getElementById('mob-text-color-swatches');
    if (sw) sw.style.display = 'none';
}
function syncTransformSheet() {
    if (!activeLayer) return;
    // cap sprite size to frame bounds, text keeps old range
    const sizeMax = activeLayer.type === 'img' ? getMaxSpriteSize() : 1600;
    const sizeSlider = document.getElementById('size-slider');
    const sizeNum = document.getElementById('size-num');
    sizeSlider.max = sizeMax; sizeNum.max = sizeMax;
    sizeSlider.value = activeLayer.w || 200;
    sizeNum.value = activeLayer.w || 200;
    document.getElementById('rotate-slider').value = activeLayer.rotation || 0;
    document.getElementById('rotate-num').value = activeLayer.rotation || 0;
    const isPanel = activeLayer.type === 'panel';
    const rotateRow = document.getElementById('ts-rotate-row');
    if (rotateRow) rotateRow.style.display = isPanel ? 'none' : 'flex'; // panels stay axis-aligned
    const panelSettings = document.getElementById('panel-settings');
    if (panelSettings) panelSettings.style.display = isPanel ? 'block' : 'none';
    if (isPanel) syncPanelSettingsUI();

    const isText = ['text','bubble','thinking','subtitle'].includes(activeLayer.type);
    document.getElementById('text-settings').style.display = isText ? 'block' : 'none';
    document.getElementById('sprite-nametag-row').style.display = activeLayer.type === 'img' ? 'flex' : 'none';
    document.getElementById('sprite-nametag-row').style.flexDirection = 'column';

    if (isText) {
        document.getElementById('text-content-input').value = activeLayer.content || '';
        const subNameRow = document.getElementById('subtitle-name-row');
        if (subNameRow) {
            subNameRow.style.display = activeLayer.type === 'subtitle' ? 'block' : 'none';
            if (activeLayer.type === 'subtitle') {
                document.getElementById('subtitle-name-input').value = activeLayer.characterName || '';
            }
        }
        if (activeLayer.fontFamily) document.getElementById('font-family-select').value = activeLayer.fontFamily;
        if (activeLayer.fontSize) {
            document.getElementById('font-size-slider').value = activeLayer.fontSize;
            document.getElementById('font-size-num').value = activeLayer.fontSize;
        }
        ['bold','italic','underline','outline'].forEach(prop => {
            const btn = document.getElementById('fmt-' + prop);
            if (btn) btn.classList.toggle('active', !!activeLayer[prop]);
        });
        const owRow = document.getElementById('outline-width-row');
        if (owRow) owRow.style.display = activeLayer.outline ? 'flex' : 'none';
        const owVal = activeLayer.outlineWidth != null ? activeLayer.outlineWidth : defaultOutlineWidth(activeLayer.fontSize || 24);
        document.getElementById('outline-width-slider').value = owVal;
        document.getElementById('outline-width-num').value = owVal;
    }
    const isBubble = ['bubble','thinking'].includes(activeLayer.type);
    document.getElementById('bubble-style-change-row').style.display = isBubble ? 'block' : 'none';
    if (isBubble) {
        renderBubbleMiniGrid();
        renderBubbleColorSwatches();
    }

    // free-transform (distort) toggle — sprites only, panels/text/bubbles keep their own resize rules
    const distortBtn = document.getElementById('ts-distort-btn');
    if (distortBtn) {
        distortBtn.style.display = activeLayer.type === 'img' ? 'inline-flex' : 'none';
        distortBtn.classList.toggle('active', !!activeLayer.distorted);
    }

    if (activeLayer.type === 'img') {
        document.getElementById('sprite-nametag-input').value = activeLayer.nameTag || '';
    }

    renderTransformPreview();
}

function toggleTextFmt(prop) {
    if (!activeLayer) return;
    saveState();
    if (prop === 'bold') activeLayer.bold = !activeLayer.bold;
    if (prop === 'italic') activeLayer.italic = !activeLayer.italic;
    if (prop === 'underline') activeLayer.underline = !activeLayer.underline;
    if (prop === 'outline') {
        activeLayer.outline = !activeLayer.outline;
        if (activeLayer.outline && activeLayer.outlineWidth == null) {
            activeLayer.outlineWidth = defaultOutlineWidth(activeLayer.fontSize || 24);
        }
        const owRow = document.getElementById('outline-width-row');
        if (owRow) owRow.style.display = activeLayer.outline ? 'flex' : 'none';
        const owSlider = document.getElementById('outline-width-slider');
        const owNum = document.getElementById('outline-width-num');
        if (owSlider) owSlider.value = activeLayer.outlineWidth;
        if (owNum) owNum.value = activeLayer.outlineWidth;
    }
    const btn = document.getElementById('fmt-' + prop);
    if (btn) btn.classList.toggle('active', !!activeLayer[prop]);
    render();
    renderTransformPreview();
}

// text outline scales with font size (overridable via stroke slider), paint-order fix for webkit/blink
function defaultOutlineWidth(fontSize) {
    if (!fontSize) fontSize = 24;
    return Math.max(1, Math.round(fontSize * 0.07 * 10) / 10);
}
function textOutlineCSS(fontSize, outlineWidth) {
    const w = (outlineWidth != null && outlineWidth !== '') ? (+outlineWidth) : defaultOutlineWidth(fontSize);
    return `-webkit-text-stroke:${w}px #000;paint-order:stroke fill;`;
}

// detect animated bg
function isAnimatedBg(src) {
    if (!src) return false;
    if (src.startsWith('data:image/gif')) return true;
    if (src.startsWith('data:image/webp')) return true;
    if (src.startsWith('data:image/apng')) return true;
    const lower = src.toLowerCase();
    return lower.includes('.gif') || lower.includes('.webp');
}

// render

function openTextEdit(layer) {
    // double tap / Edit Text now opens the full transform sheet's text editor instead of the old CAMC popup
    activeLayer = layer;
    openTransformSheet();
}

// debounced render — prevents excessive redraws during touch
let _renderRaf = null;
// build resize handles for sprite layer

// instant tap-select handles, used to need a re-render or double-tap to appear
function mobToggleTextColorSwatches() {
    const w = document.getElementById('mob-text-color-swatches');
    if (!w) return;
    const show = w.style.display !== 'flex';
    w.style.display = show ? 'flex' : 'none';
    if (show) renderTextColorSwatches();
}
function renderTextColorSwatches() {
    const w = document.getElementById('mob-text-color-swatches');
    if (!w || !activeLayer) return;
    const cur = (activeLayer.color || '#000000').toLowerCase();
    w.innerHTML = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="event.stopPropagation();mobPickTextColor('${hex}')" style="width:22px;height:22px;border-radius:50%;background:${hex};border:2px solid ${cur === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;flex-shrink:0;"></button>`
    ).join('') + `<button type="button" class="mob-color-trigger-btn" onclick="event.stopPropagation();mobOpenAdvancedTextColor()" title="More colors"></button>`
      + `<input type="text" id="text-color-hex" value="${activeLayer.color || '#000000'}" maxlength="7" oninput="event.stopPropagation();mobApplyTextColorHex(this.value)" style="width:56px;background:#000;border:1px solid #333;border-radius:6px;color:var(--text);font-size:10px;padding:5px;text-align:center;font-family:inherit;">`;
}
function mobOpenAdvancedTextColor() {
    if (!activeLayer) return;
    saveState();
    openAdvancedColorPicker(activeLayer.color || '#000000', (hex) => {
        activeLayer.color = hex;
        render(); renderTransformPreview(); renderTextColorSwatches();
    });
}
function mobPickTextColor(hex) {
    if (!activeLayer) return;
    saveState();
    activeLayer.color = hex;
    render(); renderTransformPreview(); renderTextColorSwatches();
}
function mobApplyTextColorHex(val) {
    if (!activeLayer) return;
    let v = (val || '').trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) return; // wait for a full valid hex
    saveState();
    activeLayer.color = v;
    render(); renderTransformPreview();
}

function renderBubbleColorSwatches() {
    if (!activeLayer) return;
    const bgWrap = document.getElementById('mob-bubble-bg-swatches');
    const borderWrap = document.getElementById('mob-bubble-border-swatches');
    const curBg = (activeLayer.bubbleBg || '#ffffff').toLowerCase();
    const curBorder = (activeLayer.bubbleBorderColor || '#000000').toLowerCase();
    if (bgWrap) bgWrap.innerHTML = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="event.stopPropagation();mobPickBubbleBg('${hex}')" style="width:22px;height:22px;border-radius:50%;background:${hex};border:2px solid ${curBg === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;flex-shrink:0;"></button>`
    ).join('') + `<button type="button" class="mob-color-trigger-btn" onclick="event.stopPropagation();mobOpenAdvancedBubbleBg()" title="More colors"></button>`;
    if (borderWrap) borderWrap.innerHTML = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="event.stopPropagation();mobPickBubbleBorder('${hex}')" style="width:22px;height:22px;border-radius:50%;background:${hex};border:2px solid ${curBorder === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;flex-shrink:0;"></button>`
    ).join('') + `<button type="button" class="mob-color-trigger-btn" onclick="event.stopPropagation();mobOpenAdvancedBubbleBorder()" title="More colors"></button>`;
    const bgHex = document.getElementById('bubble-bg-hex');
    if (bgHex) bgHex.value = activeLayer.bubbleBg || '#ffffff';
    const borderHex = document.getElementById('bubble-border-hex');
    if (borderHex) borderHex.value = activeLayer.bubbleBorderColor || '#000000';
}
function mobPickBubbleBg(hex) {
    if (!activeLayer) return;
    saveState();
    activeLayer.bubbleBg = hex;
    renderBubbleColorSwatches();
    render(); renderTransformPreview();
}
function mobPickBubbleBorder(hex) {
    if (!activeLayer) return;
    saveState();
    activeLayer.bubbleBorderColor = hex;
    renderBubbleColorSwatches();
    render(); renderTransformPreview();
}
function mobApplyBubbleColorHex(which, val) {
    if (!activeLayer) return;
    let v = (val || '').trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) return; // wait for a full valid hex
    saveState();
    if (which === 'bg') activeLayer.bubbleBg = v; else activeLayer.bubbleBorderColor = v;
    renderBubbleColorSwatches();
    render(); renderTransformPreview();
}
function mobOpenAdvancedBubbleBg() {
    if (!activeLayer) return;
    saveState();
    openAdvancedColorPicker(activeLayer.bubbleBg || '#ffffff', (hex) => {
        activeLayer.bubbleBg = hex;
        renderBubbleColorSwatches(); render(); renderTransformPreview();
    });
}
function mobOpenAdvancedBubbleBorder() {
    if (!activeLayer) return;
    saveState();
    openAdvancedColorPicker(activeLayer.bubbleBorderColor || '#000000', (hex) => {
        activeLayer.bubbleBorderColor = hex;
        renderBubbleColorSwatches(); render(); renderTransformPreview();
    });
}

// advanced color picker: spectrum + RGB sliders + hex + eyedropper + up to 5 saved swatches. openAdvancedColorPicker(hex, callback) fires callback on every change; caller owns saveState()/render()
let _cpOnChange = null;
let _cpHex = '#ffffff';
const CP_RECENT_KEY = 'cc-recent-colors';

function _cpHueToRgb(h) {
    h = ((h % 360) + 360) % 360;
    const c = 1, x = 1 - Math.abs((h / 60) % 2 - 1);
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function _cpRgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function _cpHexToRgb(hex) {
    let h = (hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (h.length !== 6 || isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _cpRgbToHue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
}
// spectrum fraction to hex — y picks hue, x blends white→hue then hue→black
function _cpSpectrumColorAt(xFrac, yFrac) {
    xFrac = Math.max(0, Math.min(1, xFrac));
    yFrac = Math.max(0, Math.min(1, yFrac));
    const [hr, hg, hb] = _cpHueToRgb(yFrac * 360);
    let r, g, b;
    if (xFrac <= 0.5) {
        const t = xFrac / 0.5;
        r = 255 + (hr - 255) * t; g = 255 + (hg - 255) * t; b = 255 + (hb - 255) * t;
    } else {
        const t = (xFrac - 0.5) / 0.5;
        r = hr * (1 - t); g = hg * (1 - t); b = hb * (1 - t);
    }
    return _cpRgbToHex(r, g, b);
}
// hex to spectrum cursor position, nearest point on path for colors off it (typed hex/eyedropper)
function _cpPositionForHex(hex) {
    const [r, g, b] = _cpHexToRgb(hex);
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const hue = _cpRgbToHue(r, g, b);
    const y = hue / 360;
    const sat = max === 0 ? 0 : (max - min) / max;
    const x = max >= 0.999 ? sat / 2 : 1 - max / 2;
    return { x, y };
}

function _cpRenderRecent() {
    const row = document.getElementById('cp-recent-row');
    if (!row) return;
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(CP_RECENT_KEY) || '[]'); } catch (e) { recent = []; }
    row.innerHTML = recent.slice(0, 5).map(hex =>
        `<button type="button" class="cp-recent-swatch" style="background:${hex};" onclick="cpApplyHex('${hex}')" title="${hex}"></button>`
    ).join('') + `<button type="button" class="cp-add-swatch" onclick="cpAddCurrentToRecent()" title="Save current color">+</button>`;
}
function cpAddCurrentToRecent() {
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(CP_RECENT_KEY) || '[]'); } catch (e) { recent = []; }
    recent = recent.filter(h => h.toLowerCase() !== _cpHex.toLowerCase());
    recent.unshift(_cpHex);
    recent = recent.slice(0, 5);
    try { localStorage.setItem(CP_RECENT_KEY, JSON.stringify(recent)); } catch (e) {}
    _cpRenderRecent();
}

function cpSwitchTab(tab) {
    document.getElementById('cp-tab-spectrum').classList.toggle('active', tab === 'spectrum');
    document.getElementById('cp-tab-sliders').classList.toggle('active', tab === 'sliders');
    document.getElementById('cp-pane-spectrum').style.display = tab === 'spectrum' ? 'block' : 'none';
    document.getElementById('cp-pane-sliders').style.display = tab === 'sliders' ? 'block' : 'none';
}

// push new color everywhere (spectrum/sliders/swatch) without re-triggering each other
function _cpSyncUI(hex, opts) {
    opts = opts || {};
    _cpHex = hex;
    const swatch = document.getElementById('cp-current-swatch');
    if (swatch) swatch.style.background = hex;
    const hexField = document.getElementById('cp-hex-field');
    if (hexField && document.activeElement !== hexField) hexField.value = hex.toUpperCase();
    if (opts.skipCursor !== true) {
        const pos = _cpPositionForHex(hex);
        const cursor = document.getElementById('cp-spectrum-cursor');
        const box = document.getElementById('cp-spectrum-box');
        if (cursor && box) {
            cursor.style.left = (pos.x * 100) + '%';
            cursor.style.top = (pos.y * 100) + '%';
        }
    }
    if (opts.skipSliders !== true) {
        const [r, g, b] = _cpHexToRgb(hex);
        const rEl = document.getElementById('cp-slider-r'), gEl = document.getElementById('cp-slider-g'), bEl = document.getElementById('cp-slider-b');
        if (rEl) rEl.value = r; if (gEl) gEl.value = g; if (bEl) bEl.value = b;
        const rv = document.getElementById('cp-slider-r-val'), gv = document.getElementById('cp-slider-g-val'), bv = document.getElementById('cp-slider-b-val');
        if (rv) rv.innerText = r; if (gv) gv.innerText = g; if (bv) bv.innerText = b;
    }
}
function cpApplyHex(hex) {
    _cpSyncUI(hex);
    if (_cpOnChange) _cpOnChange(hex);
}

function openAdvancedColorPicker(initialHex, onChange) {
    _cpOnChange = onChange || null;
    cpSwitchTab('spectrum');
    const hex = (initialHex || '#ffffff').toLowerCase();
    _cpSyncUI(hex);
    _cpRenderRecent();
    document.getElementById('color-picker-modal').style.display = 'flex';
    _cpWireSpectrum();
    _cpWireSliders();
    _cpWireHexField();
}
function closeAdvancedColorPicker() {
    document.getElementById('color-picker-modal').style.display = 'none';
    _cpOnChange = null;
}

let _cpSpectrumWired = false;
function _cpWireSpectrum() {
    if (_cpSpectrumWired) return;
    _cpSpectrumWired = true;
    const box = document.getElementById('cp-spectrum-box');
    if (!box) return;
    let dragging = false;
    function pick(clientX, clientY) {
        const rect = box.getBoundingClientRect();
        const xFrac = (clientX - rect.left) / rect.width;
        const yFrac = (clientY - rect.top) / rect.height;
        const hex = _cpSpectrumColorAt(xFrac, yFrac);
        _cpSyncUI(hex, { skipCursor: true });
        const cursor = document.getElementById('cp-spectrum-cursor');
        if (cursor) {
            cursor.style.left = (Math.max(0, Math.min(1, xFrac)) * 100) + '%';
            cursor.style.top = (Math.max(0, Math.min(1, yFrac)) * 100) + '%';
        }
        if (_cpOnChange) _cpOnChange(hex);
    }
    box.addEventListener('touchstart', e => { dragging = true; pick(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', e => { if (!dragging) return; pick(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend', () => { dragging = false; });
    box.addEventListener('mousedown', e => { dragging = true; pick(e.clientX, e.clientY); e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (dragging) pick(e.clientX, e.clientY); });
    document.addEventListener('mouseup', () => { dragging = false; });
}
let _cpSlidersWired = false;
function _cpWireSliders() {
    if (_cpSlidersWired) return;
    _cpSlidersWired = true;
    ['r', 'g', 'b'].forEach(ch => {
        const el = document.getElementById('cp-slider-' + ch);
        if (!el) return;
        el.addEventListener('input', () => {
            const [r, g, b] = _cpHexToRgb(_cpHex);
            const vals = { r, g, b };
            vals[ch] = parseInt(el.value) || 0;
            const hex = _cpRgbToHex(vals.r, vals.g, vals.b);
            document.getElementById('cp-slider-' + ch + '-val').innerText = vals[ch];
            _cpSyncUI(hex, { skipSliders: true });
            if (_cpOnChange) _cpOnChange(hex);
        });
    });
}
let _cpHexFieldWired = false;
function _cpWireHexField() {
    if (_cpHexFieldWired) return;
    _cpHexFieldWired = true;
    const field = document.getElementById('cp-hex-field');
    if (!field) return;
    function commit() {
        let v = (field.value || '').trim();
        if (v && v[0] !== '#') v = '#' + v;
        if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) return;
        _cpSyncUI(v);
        if (_cpOnChange) _cpOnChange(v);
    }
    field.addEventListener('blur', commit);
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); field.blur(); } });
}
// swatch button bridge for hidden color input, keeps old callers unchanged
function openAdvColorPickerFor(inputId, swatchBtn) {
    const input = document.getElementById(inputId);
    const cur = (input && input.value) || '#ffffff';
    openAdvancedColorPicker(cur, (hex) => {
        if (input) {
            input.value = hex;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (swatchBtn) swatchBtn.style.background = hex;
    });
}
// native EyeDropper only exists on desktop chrome/edge, in-app fallback samples real pixels via renderFrameToCanvas for everyone else
async function cpUseEyedropper() {
    if (window.EyeDropper) {
        try {
            const result = await new window.EyeDropper().open();
            if (result && result.sRGBHex) cpApplyHex(result.sRGBHex);
        } catch (e) { /* user backed out of the native picker — do nothing */ }
        return;
    }
    cpOpenInAppEyedropper();
}

let _cpPreEyedropHex = null;
async function cpOpenInAppEyedropper() {
    const frame = frames[currentIdx];
    if (!frame) return;
    const btn = document.getElementById('cp-eyedrop-btn');
    const originalBtnHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="cp-spin"></span>'; }

    const srcW = canvas.offsetWidth || 400, srcH = canvas.offsetHeight || 400;
    let snap;
    try {
        snap = await renderFrameToCanvas(frame, Math.round(srcW * 2), Math.round(srcH * 2));
    } catch (e) {
        snap = null;
    }
    if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHTML; }
    if (!snap) return;

    _cpPreEyedropHex = _cpHex;
    _cpBuildEyedropOverlay(snap);
}

function _cpBuildEyedropOverlay(snap) {
    const overlay = document.getElementById('cp-eyedrop-overlay');
    overlay.innerHTML = `
        <div class="cp-eyedrop-topbar">
            <span>Drag to sample a color from the frame</span>
            <button type="button" onclick="cpCancelEyedrop()">Cancel</button>
        </div>
        <div id="cp-eyedrop-canvas-wrap">
            <canvas id="cp-eyedrop-canvas"></canvas>
            <div id="cp-eyedrop-loupe">
                <canvas id="cp-eyedrop-loupe-canvas" width="76" height="76" style="width:100%;height:100%;"></canvas>
                <div id="cp-eyedrop-loupe-cross"></div>
            </div>
        </div>
        <div id="cp-eyedrop-confirm-row"><button type="button" onclick="cpConfirmEyedrop()">Use This Color</button></div>
    `;
    overlay.style.display = 'flex';

    const dispCanvas = document.getElementById('cp-eyedrop-canvas');
    dispCanvas.width = snap.width;
    dispCanvas.height = snap.height;
    const dctx = dispCanvas.getContext('2d');
    dctx.drawImage(snap, 0, 0);

    const loupe = document.getElementById('cp-eyedrop-loupe');
    const loupeCanvas = document.getElementById('cp-eyedrop-loupe-canvas');
    const lctx = loupeCanvas.getContext('2d');
    lctx.imageSmoothingEnabled = false;

    const wrap = document.getElementById('cp-eyedrop-canvas-wrap');
    let dragging = false;
    const HALF = 8; // px of source sampled into the loupe, before magnifying up to 76px

    function sampleAt(clientX, clientY) {
        const rect = dispCanvas.getBoundingClientRect();
        const xFrac = (clientX - rect.left) / rect.width;
        const yFrac = (clientY - rect.top) / rect.height;
        if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return;
        const px = Math.max(0, Math.min(snap.width - 1, Math.floor(xFrac * snap.width)));
        const py = Math.max(0, Math.min(snap.height - 1, Math.floor(yFrac * snap.height)));
        const data = dctx.getImageData(px, py, 1, 1).data;
        const hex = _cpRgbToHex(data[0], data[1], data[2]);

        lctx.clearRect(0, 0, 76, 76);
        lctx.drawImage(dispCanvas, px - HALF, py - HALF, HALF * 2, HALF * 2, 0, 0, 76, 76);

        const wrapRect = wrap.getBoundingClientRect();
        loupe.style.display = 'block';
        loupe.style.left = (clientX - wrapRect.left) + 'px';
        loupe.style.top = (clientY - wrapRect.top) + 'px';
        loupe.style.borderColor = hex;

        cpApplyHex(hex);
    }
    dispCanvas.addEventListener('touchstart', e => { dragging = true; sampleAt(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    dispCanvas.addEventListener('touchmove', e => { if (!dragging) return; sampleAt(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    dispCanvas.addEventListener('touchend', () => { dragging = false; loupe.style.display = 'none'; });
    dispCanvas.addEventListener('mousedown', e => { dragging = true; sampleAt(e.clientX, e.clientY); });
    dispCanvas.addEventListener('mousemove', e => { if (dragging) sampleAt(e.clientX, e.clientY); });
    dispCanvas.addEventListener('mouseup', () => { dragging = false; loupe.style.display = 'none'; });
}
function cpConfirmEyedrop() {
    document.getElementById('cp-eyedrop-overlay').style.display = 'none';
    document.getElementById('cp-eyedrop-overlay').innerHTML = '';
    _cpPreEyedropHex = null;
}
function cpCancelEyedrop() {
    if (_cpPreEyedropHex) cpApplyHex(_cpPreEyedropHex);
    document.getElementById('cp-eyedrop-overlay').style.display = 'none';
    document.getElementById('cp-eyedrop-overlay').innerHTML = '';
    _cpPreEyedropHex = null;
}
(function _cpInitEyedropBtn() {
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('cp-eyedrop-btn');
        // always on, native api or fallback
        if (btn) btn.title = window.EyeDropper ? 'Pick color from screen' : 'Pick color from this frame';
    });
})();

// tail: edge (default bottom) + 0-100% position along it, derives an equivalent for legacy tailFlip-only layers
const MOB_BUBBLE_TAIL_BASE = { round: 20, chat: 80, rect: 50, whisper: 25 };
function getBubbleTailEdge(layer) {
    return (layer.tailEdge === 'top' || layer.tailEdge === 'left' || layer.tailEdge === 'right')
        ? layer.tailEdge : 'bottom';
}
function getBubbleTailPos(layer, bStyle) {
    if (layer.tailPos != null) return Math.max(4, Math.min(96, layer.tailPos));
    const base = MOB_BUBBLE_TAIL_BASE[bStyle] ?? 50;
    return layer.tailFlip ? (100 - base) : base;
}

// tail shape engine: triangle defined once for the bottom edge, a table rotates it for the other three
const MOB_TAIL_SHAPE = {
    round:   { solid: 20, a: 12, b: 4,  inner: { solid: 16, a: 8,  b: 2,  gapMain: -19, gapCross: -9  } },
    chat:    { solid: 18, a: 14, b: 0,  inner: { solid: 14, a: 10, b: 0,  gapMain: -17, gapCross: -11 } },
    rect:    { solid: 18, a: 12, b: 12, inner: { solid: 14, a: 9,  b: 9,  gapMain: -17, gapCross: -9  } },
    whisper: { solid: 16, a: 8,  b: 8,  inner: null },
};
// css side for triangle base + inner nudge, pointing away from the bubble on that edge
const MOB_TAIL_SOLID_SIDE = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };

// builds tail div (+ keyline) for edge/pos — pos runs left→right on top/bottom, top→bottom on left/right. '' for tailless styles
function bubbleTailHTML(bStyle, edge, pos, bubBorder, bubBg) {
    const shape = MOB_TAIL_SHAPE[bStyle];
    if (!shape) return '';
    const alongEdge   = (edge === 'top' || edge === 'bottom');
    const solidSide   = MOB_TAIL_SOLID_SIDE[edge];
    const crossSides  = alongEdge ? ['left', 'right'] : ['top', 'bottom'];
    const alongProp   = alongEdge ? 'left' : 'top';
    const mirrorFn    = alongEdge ? 'scaleX' : 'scaleY';
    const translateFn = alongEdge ? 'translateX' : 'translateY';
    const flip = pos >= 50 ? ` ${mirrorFn}(-1)` : '';

    const outerBorders = `border-${crossSides[0]}:${shape.a}px solid transparent;border-${crossSides[1]}:${shape.b}px solid transparent;border-${solidSide}:${shape.solid}px solid ${bubBorder};`;
    let inner = '';
    if (shape.inner) {
        const s = shape.inner;
        const innerBorders = `border-${crossSides[0]}:${s.a}px solid transparent;border-${crossSides[1]}:${s.b}px solid transparent;border-${solidSide}:${s.solid}px solid ${bubBg};`;
        inner = `<div style="position:absolute;${solidSide}:${s.gapMain}px;${alongProp}:${s.gapCross}px;width:0;height:0;${innerBorders}"></div>`;
    }
    return `<div class="bubble-tail edge-${edge}" style="position:absolute;${edge}:-${shape.solid}px;${alongProp}:${pos}%;transform:${translateFn}(-50%)${flip};width:0;height:0;${outerBorders}">${inner}</div>`;
}

function attachResizeHandles(el, layer) {
    el.querySelectorAll('.resize-handle').forEach(h => h.remove());
    el.querySelectorAll('.rotate-handle, .rotate-handle-stem').forEach(h => h.remove());
    const isDistort = !!layer.distorted;
    ['tl','tr','bl','br'].forEach(corner => {
        const h = document.createElement('div');
        h.className = 'resize-handle ' + corner;
        h.textContent = corner === 'br' ? '⤡' : corner === 'tl' ? '⤡' : '';
        h.addEventListener('touchstart', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            saveState();
            const t0 = ev.touches[0];
            const origW = layer.w, origH = (layer.h != null ? layer.h : layer.w), origX = layer.x, origY = layer.y;
            const origCharScale = layer.charScale;
            const startClientX = t0.clientX;
            const startClientY = t0.clientY;
            const isLeft = (corner === 'tl' || corner === 'bl');
            const isTop  = (corner === 'tl' || corner === 'tr');
            // getBoundingClientRect for android twa accuracy
            const _cRect = canvas.getBoundingClientRect();
            const _cScale = _cRect.width / (canvas.offsetWidth || 1);
            const _maxSpriteW = getMaxSpriteSize();
            const onMove = (mv) => {
                if (mv.touches.length > 1) return;
                mv.preventDefault();
                mv.stopPropagation();
                const rawDx = (mv.touches[0].clientX - startClientX) / _cScale;
                const rawDy = (mv.touches[0].clientY - startClientY) / _cScale;
                const dx = isLeft ? -rawDx : rawDx;
                const dy = isTop  ? -rawDy : rawDy;
                let newW, newH;
                if (isDistort) {
                    // free transform — width and height stretch independently, no aspect lock
                    newW = Math.max(20, Math.min(_maxSpriteW, Math.round(origW + dx)));
                    newH = Math.max(20, Math.round(origH + dy));
                } else {
                    const delta = (dx + dy) / 2;
                    newW = Math.max(20, Math.min(_maxSpriteW, Math.round(origW + delta)));
                    newH = (origW ? Math.round(origH * newW / origW) : newW);
                }
                layer.h = newH;
                layer.w = newW;
                // keeps charHeight/charScale in sync after a manual resize so the next pose swap doesn't snap back to stale data (pinch-resize already had this, this path didn't). skipped while distorting since a stretched w/h isn't a real scale basis
                if (!isDistort) {
                    if (layer.charHeight != null) layer.charHeight = newH;
                    if (origCharScale != null && origH) layer.charScale = origCharScale * (newH / origH);
                }
                // lock non-dragged edges so resize doesn't drift — was missing for top handles, made tl/tr resize look like a move
                if (isLeft) layer.x = origX + (origW - newW);
                if (isTop)  layer.y = origY + (origH - newH);
                // direct dom update
                if (el) {
                    el.style.width = newW + 'px';
                    el.style.height = newH + 'px';
                    // resize the inner img too when the handle resizes, distorted sprites use object-fit:fill so it needs an explicit height set too not just width
                    const imgEl = el.querySelector('img');
                    if (imgEl) {
                        imgEl.style.width = newW + 'px';
                        if (isDistort) imgEl.style.height = newH + 'px';
                    }
                    if (isLeft) el.style.left = layer.x + 'px';
                    if (isTop)  el.style.top  = layer.y + 'px';
                }
                // sync slider if transform sheet is open
                const sl = document.getElementById('size-slider');
                if (sl) { sl.value = newW; const sn = document.getElementById('size-num'); if (sn) sn.value = newW; }
                applyPanelClip(layer, el);
            };
            const onUp = () => {
                // remove from same element
                h.removeEventListener('touchmove', onMove);
                h.removeEventListener('touchend', onUp);
                render(); // full re-render on finger lift
            };
            // attach to handle not document
            h.addEventListener('touchmove', onMove, { passive: false });
            h.addEventListener('touchend', onUp, { once: true });
        }, { passive: false });
        el.appendChild(h);
    });

    // the rotate dial turns into an exit button while free transform is active since rotating and distorting don't really mix, easier to reuse the dial than bolt on a whole new control
    const stem = document.createElement('div');
    stem.className = 'rotate-handle-stem';
    el.appendChild(stem);
    const rh = document.createElement('div');
    rh.className = 'rotate-handle';
    if (isDistort) {
        rh.textContent = '⤡';
        rh.title = 'Exit Free Transform';
        rh.addEventListener('touchstart', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            toggleDistortMode();
        }, { passive: false });
    } else {
        rh.textContent = '↻';
        rh.addEventListener('touchstart', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            saveState();
            const onMove = (mv) => {
                if (mv.touches.length > 1) return;
                mv.preventDefault(); mv.stopPropagation();
                const t = mv.touches[0];
                // re-measure center each move, doesn't need the _cScale correction the resize drag uses
                const elRect = el.getBoundingClientRect();
                const cx = elRect.left + elRect.width / 2;
                const cy = elRect.top + elRect.height / 2;
                const dx = t.clientX - cx;
                const dy = t.clientY - cy;
                let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
                angle = ((angle % 360) + 360) % 360;
                for (const sp of [0, 45, 90, 135, 180, 225, 270, 315, 360]) {
                    if (Math.abs(angle - sp) < 4) { angle = sp % 360; break; }
                }
                angle = Math.round(angle);
                layer.rotation = angle;
                el.style.transform = `rotate(${angle}deg) scaleX(${layer.flipped ? -1 : 1})`;
                const rs = document.getElementById('rotate-slider');
                if (rs) { rs.value = angle; const rn = document.getElementById('rotate-num'); if (rn) rn.value = angle; }
            };
            const onUp = () => {
                rh.removeEventListener('touchmove', onMove);
                rh.removeEventListener('touchend', onUp);
                render();
            };
            rh.addEventListener('touchmove', onMove, { passive: false });
            rh.addEventListener('touchend', onUp, { once: true });
        }, { passive: false });
    }
    el.appendChild(rh);
}

// re-clips every non-panel layer live while a panel is being resized so stuff snaps to the new edge in real time instead of waiting til you let go
function reclipAllContent() {
    const f = frames[currentIdx];
    if (!f) return;
    f.layers.forEach(l => {
        if (l.type === 'panel') return;
        const el = canvas.querySelector('.layer[data-layer-id="' + l.id + '"]');
        if (el) applyPanelClip(l, el);
    });
}

// panels stretch on each axis independently instead of scaling like sprites do, 4 corner + 4 edge handles, no rotate, keeps the slicing math sane
function attachPanelResizeHandles(el, layer) {
    el.querySelectorAll('.resize-handle').forEach(h => h.remove());
    el.querySelectorAll('.rotate-handle, .rotate-handle-stem').forEach(h => h.remove());
    const MIN = 30;
    ['tl','t','tr','r','br','b','bl','l'].forEach(pos => {
        const h = document.createElement('div');
        h.className = 'resize-handle ' + pos;
        h.addEventListener('touchstart', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            saveState();
            const t0 = ev.touches[0];
            const origW = layer.w, origH = (layer.h != null ? layer.h : layer.w), origX = layer.x, origY = layer.y;
            const startClientX = t0.clientX, startClientY = t0.clientY;
            const isLeft   = pos === 'tl' || pos === 'l' || pos === 'bl';
            const isRight  = pos === 'tr' || pos === 'r' || pos === 'br';
            const isTop    = pos === 'tl' || pos === 't' || pos === 'tr';
            const isBottom = pos === 'bl' || pos === 'b' || pos === 'br';
            const _cRect = canvas.getBoundingClientRect();
            const _cScale = _cRect.width / (canvas.offsetWidth || 1);
            const onMove = (mv) => {
                if (mv.touches.length > 1) return;
                mv.preventDefault(); mv.stopPropagation();
                const dx = (mv.touches[0].clientX - startClientX) / _cScale;
                const dy = (mv.touches[0].clientY - startClientY) / _cScale;
                let newW = origW, newH = origH, newX = origX, newY = origY;
                // width and height move independently — that's the "stretch", no proportional lock
                if (isRight) newW = Math.max(MIN, Math.round(origW + dx));
                if (isLeft)  { newW = Math.max(MIN, Math.round(origW - dx)); newX = origX + (origW - newW); }
                if (isBottom) newH = Math.max(MIN, Math.round(origH + dy));
                if (isTop)    { newH = Math.max(MIN, Math.round(origH - dy)); newY = origY + (origH - newH); }
                layer.w = newW; layer.h = newH; layer.x = newX; layer.y = newY;
                if (el) {
                    el.style.width  = newW + 'px';
                    el.style.height = newH + 'px';
                    el.style.left   = newX + 'px';
                    el.style.top    = newY + 'px';
                }
                reclipAllContent();
                if (_panelSliceLayer === layer) updatePanelSliceOverlayPosition();
            };
            const onUp = () => {
                h.removeEventListener('touchmove', onMove);
                h.removeEventListener('touchend', onUp);
                render(); // re-clips any content sitting on this panel to its new bounds
            };
            h.addEventListener('touchmove', onMove, { passive: false });
            h.addEventListener('touchend', onUp, { once: true });
        }, { passive: false });
        el.appendChild(h);
    });
}

// draggable tail puck, snaps to nearest edge+position instead of sliding under one fixed edge
const MOB_TAIL_HANDLE_GAP = 28; // how far outside the bubble's own edge the puck floats
function attachTailHandle(el, layer) {
    el.querySelectorAll('.tail-scroller-track, .tail-scroller-handle').forEach(h => h.remove());
    const bStyle = layer.bubbleStyle || 'round';
    const showTail = !['spiky', 'shout', 'electric', 'narrator', 'cloud'].includes(bStyle);
    if (!showTail) return;

    const track = document.createElement('div');
    track.className = 'tail-scroller-track';
    el.appendChild(track);

    const handle = document.createElement('div');
    handle.className = 'tail-scroller-handle';

    // puck position: offset outside the bubble's physical edge + 0-100% along the perpendicular axis
    function placeHandle(edge, pos) {
        handle.style.top = handle.style.bottom = handle.style.left = handle.style.right = '';
        const alongEdge = (edge === 'top' || edge === 'bottom');
        handle.style[edge] = '-' + MOB_TAIL_HANDLE_GAP + 'px';
        handle.style[alongEdge ? 'left' : 'top'] = pos + '%';
        handle.style.transform = alongEdge ? 'translateX(-50%)' : 'translateY(-50%)';
    }
    // touch point → nearest edge+position, scaled by axis half-size so shape doesn't bias tall/wide bubbles
    function nearestEdgePos(w, h, x, y) {
        const dx = x - w / 2, dy = y - h / 2;
        const favorSide = Math.abs(dx) / Math.max(1, w / 2) > Math.abs(dy) / Math.max(1, h / 2);
        if (favorSide) {
            return { edge: dx < 0 ? 'left' : 'right', pos: Math.max(4, Math.min(96, Math.round((y / h) * 100))) };
        }
        return { edge: dy < 0 ? 'top' : 'bottom', pos: Math.max(4, Math.min(96, Math.round((x / w) * 100))) };
    }

    placeHandle(getBubbleTailEdge(layer), getBubbleTailPos(layer, bStyle));

    handle.addEventListener('touchstart', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        saveState();
        let lastEdge = getBubbleTailEdge(layer);
        const bubBorder = layer.bubbleBorderColor || '#000';
        const bubBg = layer.bubbleBg || '#fff';
        const onMove = (mv) => {
            if (mv.touches.length > 1) return;
            mv.preventDefault(); mv.stopPropagation();
            const t = mv.touches[0];
            const elRect = el.getBoundingClientRect();
            if (!elRect.width || !elRect.height) return;
            const { edge, pos } = nearestEdgePos(elRect.width, elRect.height, t.clientX - elRect.left, t.clientY - elRect.top);
            layer.tailEdge = edge;
            layer.tailPos = pos;
            placeHandle(edge, pos);
            const tailEl = el.querySelector('.bubble-tail');
            if (tailEl) {
                if (edge !== lastEdge) {
                    // rebuild tail div on edge change since borders differ per edge
                    tailEl.outerHTML = bubbleTailHTML(bStyle, edge, pos, bubBorder, bubBg);
                    lastEdge = edge;
                } else {
                    const alongEdge = (edge === 'top' || edge === 'bottom');
                    const mirrorFn = alongEdge ? 'scaleX' : 'scaleY';
                    tailEl.style[alongEdge ? 'left' : 'top'] = pos + '%';
                    tailEl.style.transform = (alongEdge ? 'translateX(-50%)' : 'translateY(-50%)') + (pos >= 50 ? ` ${mirrorFn}(-1)` : '');
                }
            }
        };
        const onUp = () => {
            handle.removeEventListener('touchmove', onMove);
            handle.removeEventListener('touchend', onUp);
            delete layer.tailFlip; // superseded by the dragged edge/position
            render();
        };
        handle.addEventListener('touchmove', onMove, { passive: false });
        handle.addEventListener('touchend', onUp, { once: true });
    }, { passive: false });
    el.appendChild(handle);
}

// corner badge on selected text/bubble, jumps to font/style popover (same icon as bottom bar's edit tab)
function attachSqaEditToggle(el, layer) {
    el.querySelectorAll('.sqa-corner-toggle').forEach(h => h.remove());
    const btn = document.createElement('button');
    btn.className = 'sqa-corner-toggle';
    btn.type = 'button';
    btn.title = 'Text options';
    btn.innerHTML = '<img src="https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/avatars/uibuttons/edit.webp" alt="edit">';
    const open = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        mobToggleSqaPopover('font');
    };
    btn.addEventListener('touchstart', (ev) => { ev.stopPropagation(); }, { passive: true });
    btn.addEventListener('touchend', open, { passive: false });
    btn.addEventListener('click', open);
    el.appendChild(btn);
}

// grabbing the bg image's real w/h so render() can do actual cover/zoom/pan math in px instead of trusting css object-position, which does nothing once the aspect ratio already lines up
let _bgNatDimCache = {};
function render() {
    if (_renderRaf) return; // already queued
    _renderRaf = requestAnimationFrame(() => {
        _renderRaf = null;
        _renderNow();
    });
}
function _renderNow() {
    const f = frames[currentIdx];
    // preserve onion canvas before clear
    const onionCanvasEl = document.getElementById('onion-skin-canvas');
    const dragOverlay   = document.getElementById('bg-drag-overlay');
    if (onionCanvasEl && onionCanvasEl.parentNode === canvas) onionCanvasEl.remove();
    if (dragOverlay    && dragOverlay.parentNode    === canvas) dragOverlay.remove();
    // pool img elements to avoid re-decoding _fxSrc data-urls every RAF tick (the fx flicker source)
    const _imgPool = new Map();
    canvas.querySelectorAll('img').forEach(img => {
        const k = img.src ? img.src.substring(0,120) : '';
        if (k && !_imgPool.has(k)) _imgPool.set(k, img);
    });
    function _getImg(src) {
        const k = (src||'').substring(0,120);
        if (_imgPool.has(k)) { const i = _imgPool.get(k); _imgPool.delete(k); i.style.cssText = ''; i.className = ''; return i; }
        const i = document.createElement('img'); i.src = src; return i;
    }
    canvas.innerHTML = '';
    const bg = f.background || '#ffffff';
    const isImg = bg.startsWith('http') || bg.startsWith('data:image');
    const isGrad = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient');
    const isAnimated = isAnimatedBg(bg);

    // filter only on bg-layer div
    canvas.style.backgroundColor = '#ffffff';
    canvas.style.backgroundImage = 'none';
    canvas.style.backgroundSize  = '';
    canvas.style.backgroundPosition = '';
    canvas.style.filter = '';

    const s = f.bgSettings || {};
    const scale = s.scale ?? 1, rotate = s.rotate ?? 0, xOff = s.x ?? 0, yOff = s.y ?? 0, filter = s.filter || 'none';
    const filterCSS = filter === 'none' ? '' : filter;

    // bg fx, mirrors sprite layer fx
    const bgFx = f.bgFx || {};
    const bgFxCSS = getSpriteFilterCSS(bgFx);
    const bgFxChipCSS = (bgFx.fxFilter && bgFx.fxFilter !== 'none') ? bgFx.fxFilter : '';
    const combinedBgFilter = [filterCSS, bgFxCSS, bgFxChipCSS].filter(Boolean).join(' ');
    const bgHasFxSrc = !!bgFx._fxSrc;
    const bgFxStrength = (bgFx.blurStrength != null) ? bgFx.blurStrength : 100;

    // build bg-layer div
    const bgLayer = document.createElement('div');
    bgLayer.id = 'cc-bg-layer';
    bgLayer.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
    if (combinedBgFilter) bgLayer.style.filter = combinedBgFilter;
    if (bgFx.fxOpacity !== undefined) bgLayer.style.opacity = bgFx.fxOpacity / 100;
    if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') bgLayer.style.mixBlendMode = cssBlendMode(bgFx.fxBlend);

    if (isImg) {
        canvas.style.backgroundColor = 'transparent';
        // doing cover+zoom+pan math ourselves in px instead of object-position+scale — turns out object-position's slack gets computed before any transform runs, so scaling after the fact can't create new pan room. that's why the Y slider used to do nothing on canvases whose aspect already matched the image. computing it manually fixes both axes for real
        const cw = canvas.offsetWidth || 1, ch = canvas.offsetHeight || 1;
        let nat = _bgNatDimCache[bg];
        if (!nat) {
            const probe = new Image();
            probe.onload = () => { _bgNatDimCache[bg] = { w: probe.naturalWidth || cw, h: probe.naturalHeight || ch }; render(); };
            probe.src = bg;
            nat = { w: cw, h: ch }; // fallback until probe resolves, re-renders once cached
        }
        const imgAR = nat.w / nat.h, canvasAR = cw / ch;
        let baseW, baseH;
        if (s.fit) {
            // contain: whole image visible, letterboxed on one axis — opposite branch of cover
            if (imgAR > canvasAR) { baseW = cw; baseH = baseW / imgAR; } else { baseH = ch; baseW = baseH * imgAR; }
        } else if (imgAR > canvasAR) { baseH = ch; baseW = baseH * imgAR; } else { baseW = cw; baseH = baseW / imgAR; }
        const sv = Math.max(1, typeof scale === 'number' ? scale : 1);
        // no overscan, starts at true cover-fit (most zoomed out while still filling the frame), pan room comes from the natural overflow or the scale slider going above 1. same deal for fit mode
        const drawW = baseW * sv;
        const drawH = baseH * sv;
        const posXfrac = Math.max(0, Math.min(100, 50 + (xOff / 2))) / 100;
        const posYfrac = Math.max(0, Math.min(100, 50 + (yOff / 2))) / 100;
        const posX = (cw - drawW) * posXfrac;
        const posY = (ch - drawH) * posYfrac;
        const geomCSS = 'position:absolute;left:' + posX + 'px;top:' + posY + 'px;width:' + drawW + 'px;height:' + drawH + 'px;'
            + 'transform:rotate(' + rotate + 'deg);transform-origin:center center;';
        if (isAnimated) {
            // animated bg uses <img> not canvas
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
            const img = document.createElement('img');
            img.src = bg;
            img.style.cssText = geomCSS + 'pointer-events:none;';
            wrapper.appendChild(img);
            bgLayer.appendChild(wrapper);
        } else {
            if (bgHasFxSrc && bgFxStrength < 100) {
                // blend: base + fx overlay (matches sprite layer FX)
                const baseImg = document.createElement('img');
                baseImg.src = bg;
                baseImg.style.cssText = geomCSS + 'pointer-events:none;';
                const overlayImg = document.createElement('img');
                overlayImg.src = bgFx._fxSrc;
                overlayImg.style.cssText = geomCSS + 'pointer-events:none;opacity:' + (bgFxStrength / 100) + ';';
                bgLayer.appendChild(baseImg);
                bgLayer.appendChild(overlayImg);
            } else {
                const imgEl = document.createElement('img');
                imgEl.src = bgHasFxSrc ? bgFx._fxSrc : bg;
                imgEl.style.cssText = geomCSS + 'pointer-events:none;';
                bgLayer.appendChild(imgEl);
            }
        }
    } else if (isGrad) {
        canvas.style.backgroundColor = 'transparent';
        const inner = document.createElement('div');
        inner.style.cssText = `position:absolute;top:-100%;left:-100%;width:300%;height:300%;background:${bg};background-size:cover;background-position:center;transform:rotate(${rotate}deg);transform-origin:center center;`;
        bgLayer.appendChild(inner);
    } else {
        canvas.style.backgroundColor = bg;
    }

    // background color fx overlay
    applyColorFxToDOM(bgLayer, bgFx);

    // re-insert preserved elements
    canvas.appendChild(bgLayer);
    if (onionCanvasEl) canvas.appendChild(onionCanvasEl); // z-index:5 — above bg, below layers
    if (dragOverlay)   canvas.appendChild(dragOverlay);

    // onion skin
    const onionOn = document.getElementById('onion-toggle').checked;
    if (onionOn && currentIdx > 0) {
        onionCanvas.style.display = 'block';
        onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
        const prevFrame = frames[currentIdx - 1];
        const onionAlpha = parseFloat(document.getElementById('onion-opacity').value);
        prevFrame.layers.forEach(l => {
            if (l.type === 'img') {
                const img = new Image();
                img.src = l.src;
                const draw = () => {
                    // height from l.h or actual naturalWidth/Height ratio — needed for sprites like Balrog whose action frames differ from idle
                    let h;
                    if (l.h != null) {
                        h = l.h;
                    } else if (img.naturalWidth > 0) {
                        h = l.w * (img.naturalHeight / img.naturalWidth);
                    } else {
                        h = l.w; // square fallback
                    }
                    onionCtx.save();
                    onionCtx.globalAlpha = onionAlpha;
                    onionCtx.translate(l.x + l.w / 2, l.y + h / 2);
                    onionCtx.rotate((l.rotation || 0) * Math.PI / 180);
                    if (l.flipped) onionCtx.scale(-1, 1);
                    onionCtx.drawImage(img, -l.w / 2, -h / 2, l.w, h);
                    onionCtx.restore();
                };
                // wait for onload, img.complete can lie for cross-origin/undecoded images
                if (img.complete && img.naturalWidth > 0) {
                    draw();
                } else {
                    img.onload = draw;
                }
            }
        });
    } else { onionCanvas.style.display = 'none'; }

    f.layers.forEach((layer, idx) => {
        const el = document.createElement('div');
        el.className = 'layer' + (layer === activeLayer ? ' active' : '');
        el.style.zIndex = idx + 1; // +1 so layer 0 sits above bgLayer (z-index:0)
        el.dataset.layerId = layer.id;
        if (layer.fxBlend && layer.fxBlend !== 'normal') el.style.mixBlendMode = cssBlendMode(layer.fxBlend);

        if (layer.type === 'img') {
            const hasFxSrc   = !!layer._fxSrc;
            const bStrength  = (layer.blurStrength != null) ? layer.blurStrength : 100;
            const blurCSS    = hasFxSrc ? '' : getSpriteFilterCSS(layer);
            const lfCSS      = (layer.fxFilter && layer.fxFilter !== 'none') ? layer.fxFilter : '';
            const combinedFilter = [blurCSS, lfCSS].filter(Boolean).join(' ') || '';

            // transform goes on EL not img so selection outline + tail follow sprite flip
            const elTransform = `rotate(${layer.rotation||0}deg) scaleX(${layer.flipped ? -1 : 1})`;
            // free-transformed sprites have their own w/h that no longer matches the image's real aspect ratio, needs object-fit:fill to actually show the stretch instead of quietly ignoring it
            const spriteFit = layer.distorted ? 'fill' : 'contain';

            if (hasFxSrc && bStrength < 100) {
                // blend: base + fx overlay
                const base = _getImg(layer.src);
                base.src = layer.src; base.draggable = false;
                base.style.cssText = `width:100%;height:100%;object-fit:${spriteFit};display:block;user-select:none;`;
                if (layer.fxOpacity !== undefined) base.style.opacity = layer.fxOpacity / 100;
                const overlay = _getImg(layer._fxSrc);
                overlay.src = layer._fxSrc; overlay.draggable = false;
                overlay.style.cssText = `width:100%;height:100%;object-fit:${spriteFit};display:block;user-select:none;position:absolute;top:0;left:0;opacity:${bStrength/100};`;
                el.style.position = 'relative';
                el.appendChild(base);
                el.appendChild(overlay);
            } else {
                const _mSrc = hasFxSrc ? layer._fxSrc : layer.src;
                const img = _getImg(_mSrc);
                img.src = _mSrc;
                img.draggable = false;
                img.style.cssText = layer.distorted ? 'width:100%;height:100%;object-fit:fill;display:block;user-select:none;' : 'width:100%;display:block;user-select:none;';
                if (combinedFilter) img.style.filter = combinedFilter;
                if (layer.fxOpacity !== undefined) img.style.opacity = layer.fxOpacity / 100;

                // fix layer.h if it doesn't match natural height on load, or outline is off by >5%
                img.onload = () => {
                    if (!img.naturalWidth || !img.naturalHeight) return;
                    // when a pose swap gets CORS-blocked we keep the old box paired with an untrimmed image, and that image's aspect ratio can't be trusted, so auto-fit stays skipped while it's in place (persists across renders too, not just once). also skipped once distorted since the whole point of distort is a mismatched ratio
                    if (layer._cropBlocked || layer.distorted) return;
                    const expectedH = Math.round(layer.w * img.naturalHeight / img.naturalWidth);
                    if (layer.h == null || Math.abs(layer.h - expectedH) > Math.max(4, expectedH * 0.05)) {
                        const prevH = layer.h;
                        layer.h = expectedH;
                        el.style.height = expectedH + 'px';
                        // keeps canonical pose-swap height in sync, otherwise the next swap snaps back to stale data and the size/position jumps
                        if (layer.charHeight != null) layer.charHeight = expectedH;
                        if (layer.charScale != null && prevH) layer.charScale *= (expectedH / prevH);
                    }
                };

                el.appendChild(img);
            }
            if (layer.nameTag) { const nt = document.createElement('div'); nt.className = 'sprite-nametag'; nt.innerText = layer.nameTag; el.appendChild(nt); }
            // color fx overlay (lightness / color balance)
            applyColorFxToDOM(el, layer);
        } else if (layer.type === 'panel') {
            const shape = document.createElement('div');
            shape.className = 'panel-shape';
            const bw = layer.borderWidth != null ? layer.borderWidth : 4;
            const fill = layer.fill || 'transparent';
            const bc = layer.panelBorderColor || '#000000';
            const rad = layer.radius || 0;
            shape.style.cssText = `background:${fill};${bw > 0 ? `border:${bw}px solid ${bc};` : ''}border-radius:${rad}px;`;
            el.appendChild(shape);
        } else if (layer.type === 'bubble' || layer.type === 'thinking') {
            const bub = document.createElement('div');
            const bStyle = layer.bubbleStyle || 'round';
            const bubBorder = layer.bubbleBorderColor || '#000';
            const bubBg     = layer.bubbleBg || (bStyle === 'shout' ? '#ffeb3b' : bStyle === 'narrator' ? '#fffde7' : '#fff');
            const decoB = [layer.underline ? 'underline' : '', layer.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
            // burst/shout: css border on a clip-path shape only paints the box's literal edges leaving the zigzag unbordered, render outline via a nested fill layer instead
            const isBurst = bStyle === 'spiky' || bStyle === 'shout';
            bub.className = 'speech-bubble bubble-style-' + bStyle;
            bub.style.cssText = `width:${layer.w||120}px;font-size:${layer.fontSize||18}px;font-family:${layer.fontFamily||'Inter, sans-serif'};--bubble-border:${bubBorder};--bubble-bg:${bubBg};${isBurst ? '' : `border-color:${bubBorder};background:${bubBg};`}`;
            bub.style.transform = `rotate(${layer.rotation||0}deg)`;
            if (layer.fxOpacity !== undefined) bub.style.opacity = layer.fxOpacity / 100;
            const textCss = `font-weight:${layer.bold ? '900' : ''};font-style:${layer.italic ? 'italic' : 'normal'};text-decoration:${decoB};text-align:${layer.align || 'center'};${layer.color ? `color:${layer.color};` : ''}${layer.outline ? textOutlineCSS(layer.fontSize||18, layer.outlineWidth) : ''}`;
            if (isBurst) {
                const fill = document.createElement('div');
                fill.className = 'bubble-clip-fill';
                fill.style.cssText = textCss;
                fill.innerText = layer.content || '';
                bub.appendChild(fill);
            } else {
                bub.style.cssText += textCss;
                bub.innerText = layer.content || '';
            }
            const showTail = !['spiky','shout','electric','narrator','cloud'].includes(bStyle);
            if (showTail) {
                bub.insertAdjacentHTML('beforeend', bubbleTailHTML(bStyle, getBubbleTailEdge(layer), getBubbleTailPos(layer, bStyle), bubBorder, bubBg));
            }
            if (layer.type === 'thinking') {
                [1,2,3].forEach(n => { const dot = document.createElement('div'); dot.className = 'thought-dot-' + n; bub.appendChild(dot); });
            }
            el.appendChild(bub);
        } else if (layer.type === 'text') {
            const t = document.createElement('div');
            t.style.cssText = `color:${layer.color||'#000'};font-size:${layer.fontSize||24}px;font-family:${layer.fontFamily||'Inter, sans-serif'};font-weight:${layer.bold?'900':'700'};font-style:${layer.italic?'italic':'normal'};text-decoration:${layer.underline?'underline':'none'};white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;min-width:60px;width:${layer.w||200}px;transform:rotate(${layer.rotation||0}deg);text-align:${layer.align||'left'};${layer.outline ? textOutlineCSS(layer.fontSize||24, layer.outlineWidth) : ''}`;
            if (layer.fxOpacity !== undefined) t.style.opacity = layer.fxOpacity / 100;
            t.innerText = layer.content || 'Text';
            el.appendChild(t);
        } else if (layer.type === 'subtitle') {
            const nameColor   = layer.nameColor  || '#ff9500';
            const dialogColor = layer.color || '#111';
            const alignS  = layer.align  || 'left';
            const boldW   = layer.bold   ? '900' : '700';
            const italicS = layer.italic ? 'italic' : 'normal';
            const ff      = layer.fontFamily || "'Inter', sans-serif";
            const fs      = layer.fontSize || 16;
            const outlineS = layer.outline ? textOutlineCSS(fs, layer.outlineWidth) : '';
            const s = document.createElement('div');
            s.style.cssText = `width:${layer.w||canvas.offsetWidth}px;transform:rotate(${layer.rotation||0}deg);`;
            s.innerHTML = `
                <div style="background:${nameColor};color:#fff;font-size:${Math.max(10,fs*0.55)}px;font-weight:900;font-family:${ff};padding:3px 10px;border-radius:5px 5px 0 0;letter-spacing:1px;text-transform:uppercase;line-height:1.5;text-align:${alignS};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${layer.characterName || 'CHARACTER'}</div>
                <div style="background:rgba(255,255,255,0.96);color:${dialogColor};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};font-family:${ff};padding:6px 10px;border-radius:0 0 5px 5px;text-align:${alignS};line-height:1.4;border:1.5px solid rgba(0,0,0,0.1);border-top:none;${outlineS}">${layer.content || 'Dialogue...'}</div>
            `;
            if (layer.fxOpacity !== undefined) s.style.opacity = layer.fxOpacity / 100;
            el.appendChild(s);
        }

        el.style.left = (layer.x || 0) + 'px';
        el.style.top  = (layer.y || 0) + 'px';
        el.style.position = 'absolute';
        el.style.width = layer.w + 'px';
        if (layer.type === 'img') {
            el.style.height = (layer.h != null) ? layer.h + 'px' : 'auto';
            el.style.overflow = 'visible';
            // rotate/flip wrapper so outline follows sprite
            el.style.transform = `rotate(${layer.rotation||0}deg) scaleX(${layer.flipped ? -1 : 1})`;
            el.style.transformOrigin = 'center center';
        } else if (layer.type === 'panel') {
            // panels stay axis-aligned (no rotate) so slicing/clipping stays predictable
            el.style.height = (layer.h != null) ? layer.h + 'px' : 'auto';
            el.style.overflow = 'visible';
        }

        // double tap = edit
        let _lastTapTime = 0;
        // tap = select, drag = move, stop prop for pinch
        el.addEventListener('touchstart', (e) => {
            // pin targeting — if anything's pinned, taps on unpinned layers get ignored so you don't grab something underneath by accident. pin/unpin from the layers panel
            if (anyLayersPinned() && !layer.pinned) return;

            // double tap = edit text
            const now = Date.now();
            if (now - _lastTapTime < 300 && (layer.type === 'bubble' || layer.type === 'thinking' || layer.type === 'text' || layer.type === 'subtitle')) {
                openTextEdit(layer);
            }
            _lastTapTime = now;

            // 2 finger pinch = resize layer
            if (e.touches.length === 2 && layer === activeLayer && layer.type === 'img') {
                e.preventDefault();
                e.stopPropagation();
                startTouchPinchResize(e, layer);
                return;
            }
            // block viewport pinch when layer active
            if (e.touches.length > 1) {
                if (layer === activeLayer) { e.preventDefault(); e.stopPropagation(); }
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            selectLayerLight(layer);
            // instant resize handles on tap, used to need a re-render or double-tap first
            canvas.querySelectorAll('.resize-handle, .rotate-handle, .rotate-handle-stem, .tail-scroller-track, .tail-scroller-handle, .sqa-corner-toggle').forEach(h => h.remove());
            if (layer.type === 'img') attachResizeHandles(el, layer);
            else if (layer.type === 'panel') attachPanelResizeHandles(el, layer);
            if (layer.type === 'bubble' || layer.type === 'thinking') attachTailHandle(el, layer);
            if (['bubble', 'thinking', 'text', 'subtitle'].includes(layer.type)) attachSqaEditToggle(el, layer);
            startTouchDrag(e, layer);
        }, { passive: false });
        el.addEventListener('mousedown', (e) => { e.preventDefault(); if (anyLayersPinned() && !layer.pinned) return; selectLayer(layer); startDrag(e, layer); });

        // pin badge on targeted layers; dim layers that are shut out while a pin is active
        if (layer.pinned) {
            const pinBadge = document.createElement('div');
            pinBadge.style.cssText = 'position:absolute;top:2px;right:2px;font-size:10px;color:var(--accent);background:rgba(0,0,0,0.6);border-radius:3px;padding:2px 3px;pointer-events:none;z-index:10;';
            pinBadge.innerHTML = '<i class="fi fi-rs-thumbtack"></i>';
            el.appendChild(pinBadge);
        } else if (anyLayersPinned()) {
            el.style.opacity = ((layer.fxOpacity != null ? layer.fxOpacity / 100 : 1) * 0.5) + '';
        }

        // double tap = transform sheet
        let lastTap = 0;
        el.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1) {
                const now = Date.now();
                if (!_isDragging && now - lastTap < 300) { e.preventDefault(); openTransformSheet(); }
                lastTap = now;
            }
        }, { passive: false });

        // resize handles or tail scroller depending on layer type
        if (layer === activeLayer && layer.type === 'img') {
            attachResizeHandles(el, layer);
        }
        if (layer === activeLayer && layer.type === 'panel') {
            attachPanelResizeHandles(el, layer);
        }
        if (layer === activeLayer && (layer.type === 'bubble' || layer.type === 'thinking')) {
            attachTailHandle(el, layer);
        }
        if (layer === activeLayer && ['bubble', 'thinking', 'text', 'subtitle'].includes(layer.type)) {
            attachSqaEditToggle(el, layer);
        }

        canvas.appendChild(el);
        applyPanelClip(layer, el); // cut off anything spilling past whichever panel this sits on, frame-style
    });

    // flash outline on spilling layers after ratio change
    f.layers.forEach(layer => {
        if (!layer._clipWarn) return;
        const lw = layer.w || 0;
        const lh = (layer.h != null ? layer.h : lw);
        const warn = document.createElement('div');
        warn.style.cssText = `position:absolute;left:${layer.x||0}px;top:${layer.y||0}px;width:${lw}px;height:${lh}px;border:2px dashed #ff3b3b;border-radius:4px;pointer-events:none;z-index:9999;box-shadow:0 0 0 2px rgba(255,59,59,0.25);`;
        canvas.appendChild(warn);
    });

    // update mobile UI
    updateFrameCounter();
    document.getElementById('mob-frame-label') && (document.getElementById('mob-frame-label').innerText = (currentIdx + 1) + ' / ' + frames.length);
    if (document.getElementById('global-frame-indicator')) {
        const fi = document.getElementById('global-frame-indicator');
        fi.innerText = 'FRAME ' + (currentIdx + 1);
        fi.style.display = frames.length > 1 ? 'block' : 'none';
    }
    hasUnsavedChanges = true;
    const dot = document.getElementById('unsaved-dot');
    if (dot) dot.style.display = 'block';
    updateSpriteQuickBar(activeLayer);
    if (_panelSliceLayer) renderPanelSliceOverlay(); // canvas.innerHTML='' above wiped it — rebuild if slicing is active
}

function selectLayer(layer) {
    activeLayer = layer;
    selectedLayers = [layer];
    fxEditingBg = false;
    render();
    updateSpriteQuickBar(layer);
}

function selectLayerLight(layer) {
    activeLayer = layer;
    selectedLayers = [layer];
    fxEditingBg = false;
    document.querySelectorAll('.layer').forEach(function(el) {
        el.classList.toggle('active', el.dataset.layerId == layer.id);
    });
    updateSpriteQuickBar(layer);
}

// sprite quick-actions bar: pill above frame for image layers (pose-swap/duplicate/front/delete) + compact color/font popover
function mobToggleSqaPopover(kind) {
    const pop = document.getElementById('sqa-popover');
    if (!pop || !activeLayer) return;
    const alreadyOpenSame = pop.classList.contains('show') && pop.dataset.kind === kind;
    if (alreadyOpenSame) {
        pop.classList.remove('show');
        pop.dataset.kind = '';
        return;
    }
    pop.dataset.kind = kind;
    if (kind === 'font') _sqaStyleRowOpen = false;
    if (kind === 'color') renderSqaColorPopover();
    else if (kind === 'font') renderSqaFontPopover();
    else if (kind === 'panel') renderSqaPanelPopover();
    pop.classList.add('show');
    positionSqaPopover(activeLayer); // re-measure now that it's actually visible
}
// position popover above layer, opens below if no room, clamped to canvas top
function positionSqaPopover(layer) {
    const pop = document.getElementById('sqa-popover');
    if (!pop || !layer) return;
    const cw = canvas.offsetWidth || 300;
    const w = layer.w || 160;
    const h = layer.h || 40;
    let cx = layer.x + w / 2;
    cx = Math.max(60, Math.min(cw - 60, cx)); // keep it from hanging off either side
    pop.style.left = Math.round(cx) + 'px';
    pop.style.transform = 'translateX(-50%)';
    const GAP = 10;
    const estH = pop.offsetHeight || 150;
    let top = layer.y - estH - GAP;
    if (top < 4) top = layer.y + h + GAP; // not enough room above — drop it below instead
    pop.style.top = Math.round(top) + 'px';
}
function renderSqaColorPopover() {
    const pop = document.getElementById('sqa-popover');
    if (!pop || !activeLayer) return;
    const isBubble = ['bubble', 'thinking'].includes(activeLayer.type);
    const cur = (isBubble ? (activeLayer.bubbleBg || '#ffffff') : (activeLayer.color || '#000000')).toLowerCase();
    const swatches = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="event.stopPropagation();mobSqaPickColor('${hex}')" style="width:26px;height:26px;border-radius:50%;background:${hex};border:2px solid ${cur === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;"></button>`
    ).join('');
    pop.innerHTML = `
        <div style="font-size:9px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:1px;">${isBubble ? 'Bubble Color' : 'Text Color'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${swatches}<button type="button" class="mob-color-trigger-btn" onclick="event.stopPropagation();mobSqaOpenAdvancedPicker()" title="More colors"></button></div>
        <input type="text" id="sqa-color-hex" value="${cur}" maxlength="7" oninput="event.stopPropagation();mobSqaApplyColorHex(this.value)" style="width:100%;background:#000;border:1px solid #333;border-radius:8px;color:var(--text);font-size:12px;padding:8px;text-align:center;font-family:inherit;box-sizing:border-box;">
    `;
    positionSqaPopover(activeLayer);
}
function mobSqaPickColor(hex) {
    if (!activeLayer) return;
    saveState();
    const isBubble = ['bubble', 'thinking'].includes(activeLayer.type);
    if (isBubble) activeLayer.bubbleBg = hex; else activeLayer.color = hex;
    render();
    renderTransformPreview();
    renderBubbleColorSwatches();
    renderSqaColorPopover();
}
function mobSqaApplyColorHex(val) {
    if (!activeLayer) return;
    let v = (val || '').trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) return; // wait for a full valid hex
    saveState();
    const isBubble = ['bubble', 'thinking'].includes(activeLayer.type);
    if (isBubble) activeLayer.bubbleBg = v; else activeLayer.color = v;
    render();
    renderTransformPreview();
    renderBubbleColorSwatches();
}
function mobSqaOpenAdvancedPicker() {
    if (!activeLayer) return;
    const isBubble = ['bubble', 'thinking'].includes(activeLayer.type);
    const cur = isBubble ? (activeLayer.bubbleBg || '#ffffff') : (activeLayer.color || '#000000');
    saveState();
    openAdvancedColorPicker(cur, (hex) => {
        if (isBubble) activeLayer.bubbleBg = hex; else activeLayer.color = hex;
        render();
        renderTransformPreview();
        renderBubbleColorSwatches();
        renderSqaColorPopover();
    });
}
// panel fill/border style popover — same compact swatch pattern as text/bubble color
function renderSqaPanelPopover() {
    const pop = document.getElementById('sqa-popover');
    if (!pop || !activeLayer || activeLayer.type !== 'panel') return;
    const l = activeLayer;
    const curFill = (l.fill || '#ffffff').toLowerCase();
    const curBorder = (l.panelBorderColor || '#000000').toLowerCase();
    const bw = l.borderWidth != null ? l.borderWidth : 4;
    const rad = l.radius || 0;
    const fillSwatches = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="event.stopPropagation();mobSqaPanelPickFill('${hex}')" style="width:22px;height:22px;border-radius:50%;background:${hex};border:2px solid ${curFill === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;flex-shrink:0;"></button>`
    ).join('') + `<button type="button" onclick="event.stopPropagation();mobSqaPanelPickFill('transparent')" title="No fill" style="width:22px;height:22px;border-radius:50%;background:repeating-conic-gradient(#666 0% 25%, #222 0% 50%) 50% / 8px 8px;border:2px solid ${curFill === 'transparent' ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;flex-shrink:0;"></button>`;
    const borderSwatches = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="event.stopPropagation();mobSqaPanelPickBorder('${hex}')" style="width:22px;height:22px;border-radius:50%;background:${hex};border:2px solid ${curBorder === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;flex-shrink:0;"></button>`
    ).join('');
    pop.innerHTML = `
        <div style="font-size:9px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:1px;">Panel Fill</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${fillSwatches}</div>
        <div style="font-size:9px;font-weight:900;color:#666;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">Panel Border</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${borderSwatches}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
            <span style="font-size:10px;font-weight:800;color:#555;flex-shrink:0;width:44px;">WIDTH</span>
            <input type="range" min="0" max="20" step="1" value="${bw}" oninput="event.stopPropagation();mobSqaPanelSetBorderWidth(this.value)" style="flex:1;">
            <span style="font-size:11px;font-weight:800;color:#aaa;width:26px;text-align:right;">${bw}px</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;font-weight:800;color:#555;flex-shrink:0;width:44px;">CORNER</span>
            <input type="range" min="0" max="80" step="1" value="${rad}" oninput="event.stopPropagation();mobSqaPanelSetRadius(this.value)" style="flex:1;">
            <span style="font-size:11px;font-weight:800;color:#aaa;width:26px;text-align:right;">${rad}px</span>
        </div>
        <button type="button" onclick="event.stopPropagation();mobToggleSqaPopover('panel');startPanelSlice();" style="width:100%;padding:9px;background:rgba(255,122,0,0.1);border:1px solid rgba(255,122,0,0.35);border-radius:9px;color:var(--accent);font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2px;"><i class="fi fi-rs-scissors"></i> Slice Panel</button>
    `;
    positionSqaPopover(activeLayer);
}
function mobSqaPanelPickFill(hex) {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    saveState();
    activeLayer.fill = hex;
    render(); renderTransformPreview(); renderSqaPanelPopover();
    if (typeof syncPanelSettingsUI === 'function') syncPanelSettingsUI();
}
function mobSqaPanelPickBorder(hex) {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    saveState();
    activeLayer.panelBorderColor = hex;
    render(); renderTransformPreview(); renderSqaPanelPopover();
    if (typeof syncPanelSettingsUI === 'function') syncPanelSettingsUI();
}
function mobSqaPanelSetBorderWidth(val) {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    saveState();
    activeLayer.borderWidth = Math.max(0, Math.min(20, parseInt(val) || 0));
    render(); renderTransformPreview(); renderSqaPanelPopover();
    if (typeof syncPanelSettingsUI === 'function') syncPanelSettingsUI();
}
function mobSqaPanelSetRadius(val) {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    saveState();
    activeLayer.radius = Math.max(0, Math.min(80, parseInt(val) || 0));
    render(); renderTransformPreview(); renderSqaPanelPopover();
    if (typeof syncPanelSettingsUI === 'function') syncPanelSettingsUI();
}

let _sqaStyleRowOpen = false;
function mobToggleSqaStyleRow() {
    _sqaStyleRowOpen = !_sqaStyleRowOpen;
    renderSqaFontPopover();
}
function renderSqaFontPopover() {
    const pop = document.getElementById('sqa-popover');
    if (!pop || !activeLayer) return;
    const l = activeLayer;
    const isBubble = ['bubble', 'thinking'].includes(l.type);
    const bStyleForTail = l.bubbleStyle || (l.type === 'thinking' ? 'cloud' : 'round');
    const hasTail = isBubble && !['spiky', 'shout', 'electric', 'narrator', 'cloud'].includes(bStyleForTail);
    const fontSelectHtml = document.getElementById('font-family-select') ? document.getElementById('font-family-select').innerHTML : '';
    const anyStyleActive = !!(l.bold || l.italic || l.underline || l.outline);
    pop.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center;">
            <select onchange="event.stopPropagation();mobSqaSetFont(this.value)" style="flex:1;min-width:0;background:#111;border:1px solid #333;color:var(--text);border-radius:8px;padding:8px;font-size:12px;font-family:inherit;box-sizing:border-box;">
                ${fontSelectHtml}
            </select>
            ${hasTail ? `<button class="sqa-btn" onclick="event.stopPropagation();mobQuickFlipTailV();renderSqaFontPopover();" title="Flip tail vertically" style="flex-shrink:0;">▲▼</button><button class="sqa-btn" onclick="event.stopPropagation();mobQuickFlipTail();renderSqaFontPopover();" title="Flip tail horizontally" style="flex-shrink:0;"><i class="fi fi-rs-flip-horizontal"></i></button>` : ''}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;">
            <button onclick="event.stopPropagation();mobSqaBumpSize(-2)" style="width:26px;height:26px;border-radius:7px;border:1px solid #333;background:#111;color:var(--text);font-weight:900;cursor:pointer;">−</button>
            <span style="min-width:34px;text-align:center;font-size:11px;font-weight:800;color:#aaa;">${l.fontSize || 24}px</span>
            <button onclick="event.stopPropagation();mobSqaBumpSize(2)" style="width:26px;height:26px;border-radius:7px;border:1px solid #333;background:#111;color:var(--text);font-weight:900;cursor:pointer;">+</button>
        </div>
        <button id="sqa-style-toggle" class="ts-fmt-btn ${anyStyleActive ? 'active' : ''}" onclick="event.stopPropagation();mobToggleSqaStyleRow()" style="flex:none;width:100%;letter-spacing:3px;box-sizing:border-box;">
            <b>B</b> <i>I</i> <u>U</u> <b style="-webkit-text-stroke:1px currentColor;paint-order:stroke fill;">Aa</b>
        </button>
        ${_sqaStyleRowOpen ? `
        <div style="display:flex;gap:6px;">
            <button id="sqa-fmt-bold" class="ts-fmt-btn ${l.bold ? 'active' : ''}" onclick="event.stopPropagation();toggleTextFmt('bold');renderSqaFontPopover();" style="flex:1;"><b>B</b></button>
            <button id="sqa-fmt-italic" class="ts-fmt-btn ${l.italic ? 'active' : ''}" onclick="event.stopPropagation();toggleTextFmt('italic');renderSqaFontPopover();" style="flex:1;"><i>I</i></button>
            <button id="sqa-fmt-underline" class="ts-fmt-btn ${l.underline ? 'active' : ''}" onclick="event.stopPropagation();toggleTextFmt('underline');renderSqaFontPopover();" style="flex:1;"><u>U</u></button>
            <button id="sqa-fmt-outline" class="ts-fmt-btn ${l.outline ? 'active' : ''}" title="Outline" onclick="event.stopPropagation();toggleTextFmt('outline');renderSqaFontPopover();" style="flex:1;-webkit-text-stroke:1px currentColor;paint-order:stroke fill;"><b>Aa</b></button>
        </div>
        ${l.outline ? `
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;font-weight:800;color:#555;flex-shrink:0;">STROKE</span>
            <button onclick="event.stopPropagation();mobSqaBumpOutlineWidth(-0.5)" style="width:26px;height:26px;border-radius:8px;border:1px solid #333;background:#111;color:var(--text);font-weight:900;cursor:pointer;flex-shrink:0;">−</button>
            <span style="flex:1;text-align:center;font-size:12px;font-weight:800;color:#aaa;">${l.outlineWidth != null ? l.outlineWidth : defaultOutlineWidth(l.fontSize || 24)}px</span>
            <button onclick="event.stopPropagation();mobSqaBumpOutlineWidth(0.5)" style="width:26px;height:26px;border-radius:8px;border:1px solid #333;background:#111;color:var(--text);font-weight:900;cursor:pointer;flex-shrink:0;">+</button>
        </div>` : ''}` : ''}
    `;
    const sel = pop.querySelector('select');
    if (sel) sel.value = l.fontFamily || "'Inter', sans-serif";
    positionSqaPopover(l);
}
function mobSqaSetFont(val) {
    updateTextProp('fontFamily', val);
}
function mobSqaBumpSize(delta) {
    if (!activeLayer) return;
    saveState();
    activeLayer.fontSize = Math.max(8, Math.min(160, (activeLayer.fontSize || 24) + delta));
    render();
    renderTransformPreview();
    renderSqaFontPopover();
}
function mobSqaBumpOutlineWidth(delta) {
    if (!activeLayer) return;
    saveState();
    const base = activeLayer.outlineWidth != null ? activeLayer.outlineWidth : defaultOutlineWidth(activeLayer.fontSize || 24);
    activeLayer.outlineWidth = Math.round(Math.max(0.5, Math.min(12, base + delta)) * 10) / 10;
    render();
    renderTransformPreview();
    renderSqaFontPopover();
    // sync other panel slider
    const owSlider = document.getElementById('outline-width-slider');
    const owNum = document.getElementById('outline-width-num');
    if (owSlider) owSlider.value = activeLayer.outlineWidth;
    if (owNum) owNum.value = activeLayer.outlineWidth;
}

function updateSpriteQuickBar(layer) {
    const bar = document.getElementById('sprite-quick-actions');
    const pop = document.getElementById('sqa-popover');
    if (!bar) return;
    if (_panelSliceLayer) { bar.classList.remove('show'); bar.innerHTML = ''; updateCfbExtras(null); return; } // slice toolbar takes over while active
    const isSprite   = !!layer && layer.type === 'img';
    const isPanel    = !!layer && layer.type === 'panel';
    const isTextLike = !!layer && ['bubble', 'thinking', 'text', 'subtitle'].includes(layer.type);
    if (!layer || (!isSprite && !isTextLike && !isPanel)) {
        bar.classList.remove('show');
        bar.innerHTML = '';
        updateCfbExtras(null);
        if (pop) { pop.classList.remove('show'); pop.dataset.kind = ''; }
        return;
    }
    // duplicate lives in frame bar; rest of each type's actions slide in next to it there. standalone floating pill (with its own Duplicate) only if the bottom bar is collapsed
    const frameBar = document.getElementById('canvas-frame-bar');
    const frameBarHidden = !frameBar || frameBar.classList.contains('cfb-hidden');
    updateCfbExtras(frameBarHidden ? null : layer);
    if (isPanel) {
        if (frameBarHidden) {
            bar.innerHTML = `
                <button class="sqa-btn sqa-accent" onclick="event.stopPropagation();startPanelSlice()" title="Slice"><i class="fi fi-rs-scissors"></i></button>
                <button class="sqa-btn" onclick="event.stopPropagation();topBarDuplicate()" title="Duplicate"><i class="fi fi-rs-clone"></i></button>
                <button class="sqa-btn" onclick="event.stopPropagation();mobToggleSqaPopover('panel')" title="Style"><span style="width:16px;height:16px;border-radius:50%;background:conic-gradient(from 180deg,#ff3b30,#ff9500,#ffcc00,#34c759,#30b0c7,#007aff,#5856d6,#ff2d92,#ff3b30);border:1.5px solid rgba(255,255,255,0.4);display:block;"></span></button>
                <div class="sqa-sep"></div>
                <button class="sqa-btn sqa-danger" onclick="event.stopPropagation();deleteLayer()" title="Delete"><i class="fi fi-rs-trash"></i></button>
            `;
            bar.classList.add('show');
        } else {
            bar.classList.remove('show');
            bar.innerHTML = '';
        }
        if (pop && pop.classList.contains('show') && pop.dataset.kind === 'panel') renderSqaPanelPopover();
        else if (pop) { pop.classList.remove('show'); pop.dataset.kind = ''; }
    } else if (isSprite) {
        if (frameBarHidden) {
            const hasActions = !!layer.packData;
            bar.innerHTML = `
                ${hasActions ? `<button class="sqa-btn sqa-accent" onclick="event.stopPropagation();editCurrentSpriteAction()" title="Actions"><i class="fi fi-rs-shuffle"></i></button><div class="sqa-sep"></div>` : ''}
                <button class="sqa-btn" onclick="event.stopPropagation();topBarDuplicate()" title="Duplicate"><i class="fi fi-rs-clone"></i></button>
                <button class="sqa-btn" onclick="event.stopPropagation();flipHorizontal()" title="Flip"><i class="fi fi-rs-flip-horizontal"></i></button>
                <div class="sqa-sep"></div>
                <button class="sqa-btn sqa-danger" onclick="event.stopPropagation();deleteLayer()" title="Delete"><i class="fi fi-rs-trash"></i></button>
            `;
            bar.classList.add('show');
        } else {
            bar.classList.remove('show');
            bar.innerHTML = '';
        }
        if (pop) { pop.classList.remove('show'); pop.dataset.kind = ''; }
    } else {
        if (frameBarHidden) {
            const canQuickStyle = ['bubble', 'thinking', 'text'].includes(layer.type);
            bar.innerHTML = `
                <button class="sqa-btn" onclick="event.stopPropagation();topBarDuplicate()" title="Duplicate"><i class="fi fi-rs-clone"></i></button>
                ${canQuickStyle ? `<button class="sqa-btn" onclick="event.stopPropagation();mobToggleSqaPopover('color')" title="Color"><span style="width:16px;height:16px;border-radius:50%;background:conic-gradient(from 180deg,#ff3b30,#ff9500,#ffcc00,#34c759,#30b0c7,#007aff,#5856d6,#ff2d92,#ff3b30);border:1.5px solid rgba(255,255,255,0.4);display:block;"></span></button>` : ''}
                <div class="sqa-sep"></div>
                <button class="sqa-btn sqa-danger" onclick="event.stopPropagation();deleteLayer()" title="Delete"><i class="fi fi-rs-trash"></i></button>
            `;
            bar.classList.add('show');
        } else {
            bar.classList.remove('show');
            bar.innerHTML = '';
        }
        // keep popover content fresh instead of closing it out from under the user
        if (pop && pop.classList.contains('show')) {
            if (pop.dataset.kind === 'color') renderSqaColorPopover();
            else if (pop.dataset.kind === 'font') renderSqaFontPopover();
        }
    }
}

// slide flip+delete next to frame bar's duplicate button, no duplicate here since it's already there. null clears them
function updateCfbExtras(layer) {
    const extras = document.getElementById('cfb-text-extras');
    if (!extras) return;
    const isTextLike = !!layer && ['bubble', 'thinking', 'text', 'subtitle'].includes(layer.type);
    const isSprite   = !!layer && layer.type === 'img';
    const isPanel    = !!layer && layer.type === 'panel';
    if (!isTextLike && !isSprite && !isPanel) {
        extras.classList.remove('show');
        extras.innerHTML = '';
        return;
    }
    if (isPanel) {
        extras.innerHTML = `
            <button class="cfb-btn" style="color:var(--accent);" onclick="event.stopPropagation();startPanelSlice()" title="Slice"><i class="fi fi-rs-scissors"></i></button>
            <button class="cfb-btn" onclick="event.stopPropagation();mobToggleSqaPopover('panel')" title="Style"><span style="width:15px;height:15px;border-radius:50%;background:conic-gradient(from 180deg,#ff3b30,#ff9500,#ffcc00,#34c759,#30b0c7,#007aff,#5856d6,#ff2d92,#ff3b30);border:1.5px solid rgba(255,255,255,0.4);display:block;"></span></button>
            <button class="cfb-btn" style="color:#ff453a;" onclick="event.stopPropagation();deleteLayer()" title="Delete"><i class="fi fi-rs-trash"></i></button>
        `;
    } else if (isSprite) {
        const hasActions = !!layer.packData;
        extras.innerHTML = `
            ${hasActions ? `<button class="cfb-btn" style="color:var(--accent);" onclick="event.stopPropagation();editCurrentSpriteAction()" title="Actions"><i class="fi fi-rs-shuffle"></i></button>` : ''}
            <button class="cfb-btn" onclick="event.stopPropagation();flipHorizontal()" title="Flip"><i class="fi fi-rs-flip-horizontal"></i></button>
            <button class="cfb-btn" style="color:#ff453a;" onclick="event.stopPropagation();deleteLayer()" title="Delete"><i class="fi fi-rs-trash"></i></button>
        `;
    } else {
        const canQuickStyle = ['bubble', 'thinking', 'text'].includes(layer.type);
        extras.innerHTML = `
            ${canQuickStyle ? `<button class="cfb-btn" onclick="event.stopPropagation();mobToggleSqaPopover('color')" title="Color"><span style="width:15px;height:15px;border-radius:50%;background:conic-gradient(from 180deg,#ff3b30,#ff9500,#ffcc00,#34c759,#30b0c7,#007aff,#5856d6,#ff2d92,#ff3b30);border:1.5px solid rgba(255,255,255,0.4);display:block;"></span></button>` : ''}
            <button class="cfb-btn" style="color:#ff453a;" onclick="event.stopPropagation();deleteLayer()" title="Delete"><i class="fi fi-rs-trash"></i></button>
        `;
    }
    extras.classList.add('show');
}

// touch drag
var _isDragging = false; // blocks double-tap-to-transform during a drag
function startTouchDrag(e, layer) {
    if (e.touches.length > 1) return;
    var touch = e.touches[0];
    var fingerStartX = touch.clientX;
    var fingerStartY = touch.clientY;
    var layerStartX = layer.x;
    var layerStartY = layer.y;
    var stateSaved = false;
    // attach move/end to the touchstart element not document — iOS drops document-level touchmove after stopPropagation() on touchstart
    var el = e.currentTarget;

    var cleanup = function() {
        el.removeEventListener('touchmove', move);
        el.removeEventListener('touchend', up);
        el.removeEventListener('touchcancel', up);
        if (_isDragging) render();
        setTimeout(function() { _isDragging = false; }, 60);
    };
    // canvasRenderedScale: vpScale + device pixel diff (getBoundingClientRect is true css px on ios/android twa)
    var canvasRect = canvas.getBoundingClientRect();
    var canvasRenderedScale = canvasRect.width / (canvas.offsetWidth || 1);

    var move = function(me) {
        if (me.touches.length > 1) { cleanup(); return; }
        me.preventDefault();
        me.stopPropagation();
        var t = me.touches[0];
        var rawDx = t.clientX - fingerStartX;
        var rawDy = t.clientY - fingerStartY;
        // 3px dead zone
        if (!_isDragging && Math.hypot(rawDx, rawDy) < 3) return;
        if (!stateSaved) { saveState(); stateSaved = true; }
        _isDragging = true;
        layer.x = layerStartX + rawDx / canvasRenderedScale;
        layer.y = layerStartY + rawDy / canvasRenderedScale;
        // direct dom update during drag
        el.style.left = layer.x + 'px';
        el.style.top  = layer.y + 'px';
        if (layer.type === 'panel') reclipAllContent(); // panel moved — re-clip whatever now sits on it
        else applyPanelClip(layer, el); // content moved — re-clip it live against whichever panel it's over now
    };
    var up = function() { cleanup(); };
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up, { once: true });
    el.addEventListener('touchcancel', up, { once: true });
}

// cap sprite scale relative to frame — 1000px was too much on a ~300-400px frame, trivially blew past the frame edge
function getMaxSpriteSize() {
    const cw = (canvas && canvas.offsetWidth) || 300;
    const ch = (canvas && canvas.offsetHeight) || 300;
    return Math.round(Math.max(cw, ch) * 2.5);
}

function startTouchPinchResize(e, layer) {
    saveState();
    const t0 = e.touches[0], t1 = e.touches[1];
    const startDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    if (startDist < 5) return;
    const origW = layer.w;
    const origH = (layer.h != null ? layer.h : layer.w);
    const origX = layer.x, origY = layer.y;
    const origCharScale = layer.charScale;
    // attach to touchstart element not document
    const el = e.currentTarget;

    const onMove = (mv) => {
        if (mv.touches.length < 2) return;
        mv.preventDefault();
        mv.stopPropagation();
        const a = mv.touches[0], b = mv.touches[1];
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const scale = dist / startDist;
        const newPinchW = Math.max(30, Math.min(getMaxSpriteSize(), Math.round(origW * scale)));
        const newPinchH = origW ? Math.round(origH * newPinchW / origW) : newPinchW;
        // keep center fixed while resizing instead of drifting toward the bottom-right
        layer.x = origX - (newPinchW - origW) / 2;
        layer.y = origY - (newPinchH - origH) / 2;
        layer.w = newPinchW;
        layer.h = newPinchH;
        // keeps pose-swap height in sync after a manual resize, otherwise the next swap jumps back to old size/position
        if (layer.charHeight != null) layer.charHeight = newPinchH;
        if (origCharScale != null && origH) layer.charScale = origCharScale * (newPinchH / origH);
        // sync transform slider
        const sl = document.getElementById('size-slider');
        if (sl) { sl.value = layer.w; const sn = document.getElementById('size-num'); if (sn) sn.value = layer.w; }
        render();
    };
    const onUp = (ev) => {
        if (ev.touches.length < 2) {
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onUp);
        }
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onUp);
}
function startDrag(e, layer) {
    saveState();
    // client coords to canvas px
    function toLocal(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        const sx = r.width  / canvas.offsetWidth;
        const sy = r.height / canvas.offsetHeight;
        return { x: (clientX - r.left) / sx, y: (clientY - r.top) / sy };
    }
    const origin = toLocal(e.clientX, e.clientY);
    const startLayerX = layer.x, startLayerY = layer.y;
    let moved = false;
    const move = (me) => {
        moved = true;
        const cur = toLocal(me.clientX, me.clientY);
        const rawX = startLayerX + (cur.x - origin.x);
        const rawY = startLayerY + (cur.y - origin.y);
        if (layer.type === 'img') {
            const lW = layer.w || 100;
            const lH = layer.h || lW;
            const cw2 = canvas.offsetWidth, ch2 = canvas.offsetHeight;
            const SNAP = 14;
            let sx = rawX, sy = rawY;
            // snap horizontal center
            if (Math.abs(rawX - (cw2 - lW) / 2) < SNAP) sx = (cw2 - lW) / 2;
            // snap vertical center
            if (Math.abs(rawY - (ch2 - lH) / 2) < SNAP) sy = (ch2 - lH) / 2;
            layer.x = Math.min(Math.max(sx, -lW / 2), cw2 - lW / 2);
            layer.y = Math.min(Math.max(sy, -lH / 2), ch2 - lH / 2);
        } else {
            layer.x = rawX;
            layer.y = rawY;
        }
        render();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
}

function deselectLayer(e) {
    // tap canvas = close transform sheet
    if (e.target === canvas || e.target === document.getElementById('canvas-container') || e.target === document.getElementById('viewport')) {
        activeLayer = null; selectedLayers = []; closeTransformSheet(); render();
    }
}
function handleViewportClick(e) {
    // close sheets too
    if (e.target === document.getElementById('sheet-overlay')) closeAllSheets();
    // tap viewport bg = deselect
    if (e.target === document.getElementById('viewport') || e.target === document.getElementById('canvas-container')) {
        activeLayer = null; selectedLayers = []; closeTransformSheet(); render();
    }
}

// undo/redo
function saveState() {
    history.push(JSON.stringify(frames));
    if (history.length > 60) history.shift();
    redoStack = [];
}
function undo() { if (!history.length) return; redoStack.push(JSON.stringify(frames)); frames = JSON.parse(history.pop()); const newIdx = currentIdx >= frames.length ? frames.length - 1 : currentIdx; activateFrame(newIdx); renderMobFrames(); updateFrameCounter(); }
function redo() { if (!redoStack.length) return; history.push(JSON.stringify(frames)); frames = JSON.parse(redoStack.pop()); activateFrame(currentIdx); renderMobFrames(); updateFrameCounter(); }

// duplicate
function topBarDuplicate() {
    if (activeLayer) {
        // duplicate layer
        saveState();
        const copy = JSON.parse(JSON.stringify(activeLayer));
        copy.id = Date.now();
        const cw = canvas.offsetWidth || 300;
        const ch = canvas.offsetHeight || 300;
        copy.x = Math.min(Math.round(copy.x || 0) + 20, cw - (copy.w || 100));
        copy.y = Math.min(Math.round(copy.y || 0) + 20, ch - (copy.h || 100));
        frames[currentIdx].layers.push(copy);
        activeLayer = copy;
        render();
    } else {
        // duplicate whole frame
        duplicateFrame();
    }
}

// frames
function addFrame() { saveState(); const newFrame = { layers: [], background: '#ffffff', ratio: { ...getFrameRatio(frames[currentIdx]) } }; frames.splice(currentIdx + 1, 0, newFrame); activateFrame(currentIdx + 1); renderMobFrames(); updateFrameCounter(); }
function duplicateFrame() { saveState(); const copy = JSON.parse(JSON.stringify(frames[currentIdx])); copy.layers = copy.layers.map(l => ({ ...l, id: Date.now() + Math.random() })); frames.splice(currentIdx + 1, 0, copy); activateFrame(currentIdx + 1); renderMobFrames(); updateFrameCounter(); }
function deleteFrameIfSafe() { if (frames.length === 1) { alert('Cannot delete the only frame.'); return; } saveState(); frames.splice(currentIdx, 1); const newIdx = currentIdx >= frames.length ? frames.length - 1 : currentIdx; activateFrame(newIdx); renderMobFrames(); updateFrameCounter(); }
function prevFrame() { if (currentIdx > 0) { activateFrame(currentIdx - 1); updateFrameCounter(); } }
function nextFrame() {
    if (currentIdx < frames.length - 1) {
        activateFrame(currentIdx + 1); updateFrameCounter();
    } else {
        // last frame, check pref before auto-add
        const pref = localStorage.getItem('cc-new-frame-pref');
        if (pref === 'yes') { addFrame(); }
        else if (pref === 'no') { /* do nothing */ }
        else { showNewFramePopup(); }
    }
}
function jumpToFrame(frameNum) {
    const num = parseInt(frameNum);
    if (num >= 1 && num <= frames.length) {
        activateFrame(num - 1);
        updateFrameCounter();
    } else {
        updateFrameCounter(); // reset to valid value
    }
}
function updateFrameCounter() {
    const input = document.getElementById('frame-input');
    const total = document.getElementById('total-frames');
    if (input) input.value = currentIdx + 1;
    if (total) total.textContent = (currentIdx + 1) + '/' + frames.length;
    // sync frame pill
    const pill = document.getElementById('frame-pill-label');
    if (pill) pill.textContent = (currentIdx + 1) + '/' + frames.length;
    // sync audio badge
    const audioBadge = document.getElementById('frame-audio-badge');
    if (audioBadge) audioBadge.style.display = (frames[currentIdx] && frames[currentIdx].audio_url) ? 'inline-block' : 'none';
    // sync audio sheet ui if open
    if (document.getElementById('sheet-audio')?.classList.contains('open')) renderMobAudioSheet();
    // sync swipe strip dots
    renderFrameSwipeDots();
}

// page-dot indicator kept near updateFrameCounter/init calls to avoid call-before-declaration errors
function renderFrameSwipeDots() {
    const zone = document.getElementById('frame-swipe-zone');
    if (!zone) return;
    const total = frames.length;
    if (total <= 1) { zone.innerHTML = ''; return; }
    if (total <= 14) {
        zone.innerHTML = frames.map((_, i) =>
            `<span class="fsz-dot${i === currentIdx ? ' active' : ''}" onclick="goToFrame(${i})"></span>`
        ).join('');
    } else {
        zone.innerHTML = `<span class="fsz-hint">‹ swipe · frame ${currentIdx + 1}/${total} ›</span>`;
    }
}

// frame pill dropdown
function toggleFramePillMenu(e) {
    const menu = document.getElementById('frame-pill-menu');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    if (isOpen) { closeFramePillMenu(); return; }
    // dropdown opens upward since the frame bar sits near the bottom
    const pill = document.getElementById('canvas-frame-bar');
    if (pill) {
        const rect = pill.getBoundingClientRect();
        menu.style.top    = 'auto';
        menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        menu.style.left   = Math.max(4, rect.left) + 'px';
    }
    menu.style.display = 'block';
    // close on outside tap
    setTimeout(() => {
        document.addEventListener('touchstart', _fpillOutside, { once: true, capture: true });
        document.addEventListener('click',      _fpillOutside, { once: true, capture: true });
    }, 60);
}
function _fpillOutside(e) {
    const menu = document.getElementById('frame-pill-menu');
    if (menu && !menu.contains(e.target)) closeFramePillMenu();
}
function closeFramePillMenu() {
    const menu = document.getElementById('frame-pill-menu');
    if (menu) menu.style.display = 'none';
}

// floating canvas frame bar: hide in place to a small tab / bring it back
function collapseCanvasFrameBar() {
    closeFramePillMenu();
    const bar = document.getElementById('canvas-frame-bar');
    const tab = document.getElementById('cfb-tab');
    if (!bar || !tab) return;
    bar.classList.add('cfb-hidden');
    // wait for bar fade before switching tab so they don't overlap mid-animation
    setTimeout(() => { tab.style.display = 'flex'; }, 140);
    if (activeLayer) updateSpriteQuickBar(activeLayer);
}
function expandCanvasFrameBar() {
    const bar = document.getElementById('canvas-frame-bar');
    const tab = document.getElementById('cfb-tab');
    if (!bar || !tab) return;
    tab.style.display = 'none';
    bar.classList.remove('cfb-hidden');
    if (activeLayer) updateSpriteQuickBar(activeLayer);
}
function goToFrame(i) { if (i >= 0 && i < frames.length) { activateFrame(i); updateActiveFrameThumb(); updateFrameCounter(); closeSheet('frames'); } }
function copyCurrentFrame() { frameClipboard = JSON.parse(JSON.stringify(frames[currentIdx])); }
function pasteCurrentFrame() { if (!frameClipboard) return; saveState(); const copy = JSON.parse(JSON.stringify(frameClipboard)); copy.layers = copy.layers.map(l => ({...l, id: Date.now() + Math.random()})); frames.splice(currentIdx + 1, 0, copy); activateFrame(currentIdx + 1); renderMobFrames(); updateFrameCounter(); }

let _frameStripVisible = true;
function toggleFrameStrip() {
    _frameStripVisible = !_frameStripVisible;
    const wrap = document.getElementById('frame-strip-wrap');
    const arrow = document.getElementById('frame-strip-arrow');
    const bot = document.getElementById('bottom-toolbar') || document.getElementById('bot-bar');
    if (wrap) wrap.style.display = _frameStripVisible ? '' : 'none';
    if (arrow) arrow.innerText = _frameStripVisible ? '▼' : '▲';
}

// nav just toggles active highlight instead of a full renderMobFrames() rebuild — rebuild is janky at hundreds of frames
function updateActiveFrameThumb() {
    const scroll = document.getElementById('mob-frame-scroll');
    if (!scroll || scroll.children.length !== frames.length) return renderMobFrames(); // out of sync — fall back to a full rebuild
    for (let i = 0; i < scroll.children.length; i++) {
        scroll.children[i].classList.toggle('active', i === currentIdx);
    }
    if (document.getElementById('mob-frame-label')) document.getElementById('mob-frame-label').innerText = (currentIdx + 1) + ' / ' + frames.length;
}

function renderMobFrames() {
    const scroll = document.getElementById('mob-frame-scroll');
    if (!scroll) return;
    scroll.innerHTML = '';
    frames.forEach((f, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'mob-frame-thumb' + (i === currentIdx ? ' active' : '');
        thumb.style.background = (f.background && !f.background.startsWith('http') && !f.background.startsWith('data:')) ? f.background : '#222';
        if (f.background && (f.background.startsWith('http') || f.background.startsWith('data:'))) thumb.style.backgroundImage = `url(${f.background})`;
        thumb.innerHTML = `<span>${i + 1}</span>`;
        thumb.onclick = () => goToFrame(i);
        if (f.audio_url) {
            const ab = document.createElement('span');
            ab.className = 'mob-frame-audio-badge';
            ab.innerText = '🔊';
            thumb.appendChild(ab);
        }
        // ratio badge only shown when a frame's ratio differs from frame 1
        const fr = getFrameRatio(f);
        const baseR = getFrameRatio(frames[0]);
        if (fr.w !== baseR.w || fr.h !== baseR.h) {
            const rb = document.createElement('span');
            rb.style.cssText = 'position:absolute;bottom:2px;left:2px;right:2px;font-size:8px;font-weight:800;color:#000;background:var(--accent);border-radius:4px;padding:1px 0;text-align:center;line-height:1.4;';
            rb.innerText = fr.w + ':' + fr.h;
            thumb.appendChild(rb);
        }
        const del = document.createElement('button');
        del.className = 'mob-frame-del'; del.innerText = '✕';
        del.onclick = (e) => { e.stopPropagation(); if (frames.length === 1) { alert('Cannot delete only frame.'); return; } saveState(); frames.splice(i, 1); const newIdx = currentIdx >= frames.length ? frames.length - 1 : currentIdx; activateFrame(newIdx); renderMobFrames(); updateFrameCounter(); };
        thumb.appendChild(del);
        scroll.appendChild(thumb);
    });
    if (document.getElementById('mob-frame-label')) document.getElementById('mob-frame-label').innerText = (currentIdx + 1) + ' / ' + frames.length;
    if (typeof renderFrameRatioPicker === 'function') renderFrameRatioPicker();
}

// frame audio: 3-45s clip, optionally spanning frames. span frames share the same audio pair (dedup key) so it plays uninterrupted across swipes
let mobAudioMainTab   = 'library';
let mobAudioLibLoaded = false;
let mobAudioLib       = [];
let _mobAudioUploadFile = null;
let _mobAudioUploadObjUrl = null;
let _mobAudioUploadDuration = 0;
let _mobAudioRowPlaying = null; // rn playing <button> in the library list
let mobAudioSpanValue = 1;      // current value of the frame-span stepper in the sheet

function mobFmtTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
}

function stopAllMobAudioPreviews() {
    const p = document.getElementById('mob-audio-preview');
    if (p) { p.pause(); p.onended = null; p.ontimeupdate = null; }
    const up = document.getElementById('mob-audio-upload-player');
    if (up) up.pause();
    if (_mobAudioRowPlaying) { _mobAudioRowPlaying.innerText = '▶'; _mobAudioRowPlaying = null; }
    const curBtn = document.getElementById('mob-audio-current-play');
    if (curBtn) curBtn.innerText = '▶';
}

function setMobAudioMainTab(tab) {
    mobAudioMainTab = tab;
    document.getElementById('mob-audio-tab-library').classList.toggle('active', tab === 'library');
    document.getElementById('mob-audio-tab-upload').classList.toggle('active', tab === 'upload');
    document.getElementById('mob-audio-pane-library').style.display = tab === 'library' ? 'block' : 'none';
    document.getElementById('mob-audio-pane-upload').style.display = tab === 'upload' ? 'block' : 'none';
    stopAllMobAudioPreviews();
}

// refresh audio ui for current frame
function renderMobAudioSheet() {
    const label = document.getElementById('mob-audio-frame-label');
    if (label) label.innerText = 'Frame ' + (currentIdx + 1);

    const f = frames[currentIdx];
    const cur = document.getElementById('mob-audio-current');
    const empty = document.getElementById('mob-audio-empty');
    const spanRow = document.getElementById('mob-audio-span-row');
    const previewBtn = document.getElementById('mob-audio-preview-span-btn');
    const maxSpan = Math.max(1, frames.length - currentIdx);

    mobAudioSpanValue = Math.min((f && f.audio_span_len) ? f.audio_span_len : 1, maxSpan);

    if (f && f.audio_url) {
        cur.style.display = 'flex';
        empty.style.display = 'none';
        document.getElementById('mob-audio-current-name').innerText = f.audio_name || 'Track';
        const start = f.audio_start || 0, end = f.audio_end != null ? f.audio_end : 45;
        document.getElementById('mob-audio-current-range').innerText =
            mobFmtTime(start) + '–' + mobFmtTime(end) + ' (' + (end - start).toFixed(1) + 's)';
        document.getElementById('mob-audio-current-play').innerText = '▶';
        if (previewBtn) previewBtn.style.display = mobAudioSpanValue > 1 ? 'block' : 'none';
    } else {
        cur.style.display = 'none';
        empty.style.display = 'block';
        if (previewBtn) previewBtn.style.display = 'none';
    }

    if (spanRow) {
        spanRow.style.display = maxSpan > 1 ? 'flex' : 'none';
        document.getElementById('mob-audio-span-count').innerText = mobAudioSpanValue;
        document.getElementById('mob-audio-span-plural').innerText = mobAudioSpanValue === 1 ? '' : 's';
        const rangeEl = document.getElementById('mob-audio-span-range');
        if (rangeEl) {
            rangeEl.innerText = mobAudioSpanValue > 1
                ? ('Frames ' + (currentIdx + 1) + '–' + (currentIdx + mobAudioSpanValue))
                : '';
        }
    }

    if (!mobAudioLibLoaded) loadMobAudioLibrary(); else renderMobAudioList();
}

// changing span re-applies to the existing clip right away
function adjustAudioSpan(delta) {
    const maxSpan = Math.max(1, frames.length - currentIdx);
    mobAudioSpanValue = Math.max(1, Math.min(maxSpan, mobAudioSpanValue + delta));
    document.getElementById('mob-audio-span-count').innerText = mobAudioSpanValue;
    document.getElementById('mob-audio-span-plural').innerText = mobAudioSpanValue === 1 ? '' : 's';
    const rangeEl = document.getElementById('mob-audio-span-range');
    if (rangeEl) {
        rangeEl.innerText = mobAudioSpanValue > 1
            ? ('Frames ' + (currentIdx + 1) + '–' + (currentIdx + mobAudioSpanValue))
            : '';
    }
    const previewBtn = document.getElementById('mob-audio-preview-span-btn');
    const f = frames[currentIdx];
    if (f && f.audio_url) {
        applyAudioSpan(f.audio_url, f.audio_name, f.audio_start, f.audio_end, mobAudioSpanValue);
        if (previewBtn) previewBtn.style.display = mobAudioSpanValue > 1 ? 'block' : 'none';
    }
}

// clear audio from span starting at rootIdx
function clearAudioSpanFields(rootIdx) {
    if (rootIdx == null) return;
    frames.forEach(fr => {
        if (fr.audio_span_start === rootIdx) {
            delete fr.audio_url; delete fr.audio_name; delete fr.audio_start; delete fr.audio_end;
            delete fr.audio_span_start; delete fr.audio_span_len;
        }
    });
}

// apply clip across span of frames
function applyAudioSpan(url, name, start, end, span) {
    saveState();
    const startIdx = currentIdx;
    const clampedSpan = Math.max(1, Math.min(span || 1, frames.length - startIdx));

    const f0 = frames[startIdx];
    if (f0 && f0.audio_span_start != null) clearAudioSpanFields(f0.audio_span_start);
    for (let i = startIdx; i < startIdx + clampedSpan; i++) {
        const fr = frames[i];
        if (fr.audio_span_start != null && fr.audio_span_start !== startIdx) clearAudioSpanFields(fr.audio_span_start);
    }

    for (let i = startIdx; i < startIdx + clampedSpan; i++) {
        const fr = frames[i];
        fr.audio_url = url;
        fr.audio_name = name || 'Track';
        fr.audio_start = Math.max(0, start || 0);
        fr.audio_end = Math.max(fr.audio_start + 3, end || (fr.audio_start + 45));
        fr.audio_span_start = startIdx;
        fr.audio_span_len = clampedSpan;
    }
    mobAudioSpanValue = clampedSpan;
    hasUnsavedChanges = true;
    renderMobAudioSheet();
    renderMobFrames();
    updateFrameCounter();
}

function toggleCurrentFrameAudioPreview() {
    const f = frames[currentIdx];
    if (!f || !f.audio_url) return;
    const p = document.getElementById('mob-audio-preview');
    const btn = document.getElementById('mob-audio-current-play');
    if (!p.paused && p.src === f.audio_url) {
        p.pause(); btn.innerText = '▶'; return;
    }
    stopAllMobAudioPreviews();
    const start = f.audio_start || 0, end = f.audio_end != null ? f.audio_end : (start + 45);
    p.src = f.audio_url;
    p.currentTime = start;
    p.ontimeupdate = () => { if (p.currentTime >= end) { p.pause(); btn.innerText = '▶'; } };
    p.onended = () => { btn.innerText = '▶'; };
    p.play().catch(() => {});
    btn.innerText = '⏸';
}

function removeFrameAudio() {
    const f = frames[currentIdx];
    if (!f || !f.audio_url) return;
    stopAllMobAudioPreviews();
    saveState();
    const rootIdx = f.audio_span_start != null ? f.audio_span_start : currentIdx;
    clearAudioSpanFields(rootIdx);
    mobAudioSpanValue = 1;
    hasUnsavedChanges = true;
    renderMobAudioSheet();
    renderMobFrames();
    updateFrameCounter();
}

function applyAudioToFrame(url, name, start, end) {
    applyAudioSpan(url, name, start, end, mobAudioSpanValue);
    closeSheet('audio');
}

// preview keeps playing across span, same dedup rule as reader.html
let _audioPreviewSpanFrames = [];
let _audioPreviewPos = 0;
let _aspLastKey = null;

async function openAudioSpanPreview() {
    const f = frames[currentIdx];
    if (!f || !f.audio_url) return;
    const startIdx = f.audio_span_start != null ? f.audio_span_start : currentIdx;
    const spanLen = f.audio_span_len != null ? f.audio_span_len : 1;
    _audioPreviewSpanFrames = [];
    for (let i = startIdx; i < startIdx + spanLen && i < frames.length; i++) _audioPreviewSpanFrames.push(i);
    _audioPreviewPos = Math.max(0, _audioPreviewSpanFrames.indexOf(currentIdx));
    _aspLastKey = null;
    document.getElementById('audio-span-preview-modal').style.display = 'flex';
    await renderAudioSpanPreviewFrame();
}

async function renderAudioSpanPreviewFrame() {
    const idx = _audioPreviewSpanFrames[_audioPreviewPos];
    const f = frames[idx];
    document.getElementById('asp-frame-label').innerText =
        'Frame ' + (idx + 1) + ' (' + (_audioPreviewPos + 1) + ' of ' + _audioPreviewSpanFrames.length + ')';
    document.getElementById('asp-prev-btn').disabled = _audioPreviewPos === 0;
    document.getElementById('asp-next-btn').disabled = _audioPreviewPos === _audioPreviewSpanFrames.length - 1;

    const img = document.getElementById('asp-frame-img');
    try {
        const cw = canvas.offsetWidth || 400, ch = canvas.offsetHeight || 400;
        const offscreen = await renderFrameToCanvas(f, cw, ch);
        img.src = offscreen.toDataURL('image/jpeg', 0.85);
    } catch (e) { /* leave previous frame image up rather than blanking it */ }

    // same dedup key as reader
    const p = document.getElementById('mob-audio-preview');
    const start = f.audio_start || 0;
    const key = f.audio_url + '|' + start;
    if (key !== _aspLastKey) {
        _aspLastKey = key;
        p.pause();
        p.src = f.audio_url;
        p.currentTime = start;
        const end = f.audio_end != null ? f.audio_end : Infinity;
        p.ontimeupdate = () => { if (p.currentTime >= end) p.pause(); };
        p.play().catch(() => {});
    }
}

function aspNav(dir) {
    const newPos = _audioPreviewPos + dir;
    if (newPos < 0 || newPos >= _audioPreviewSpanFrames.length) return;
    _audioPreviewPos = newPos;
    renderAudioSpanPreviewFrame();
}

function closeAudioSpanPreview() {
    document.getElementById('audio-span-preview-modal').style.display = 'none';
    const p = document.getElementById('mob-audio-preview');
    if (p) p.pause();
    _aspLastKey = null;
}

// library (your saved clips, from `audio_library` table)
async function loadMobAudioLibrary() {
    const list = document.getElementById('mob-audio-list');
    if (list) list.innerHTML = '<div style="color:#555;font-size:12px;padding:16px;text-align:center;">Loading…</div>';
    try {
        const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
        const handle = profile.handle;
        if (handle) {
            const { data, error } = await _supabase.from('audio_library')
                .select('id,name,audio_url,duration,uploaded_by').eq('uploaded_by', handle).order('id', { ascending: false });
            if (error) throw error;
            mobAudioLib = data || [];
        } else { mobAudioLib = []; }

        mobAudioLibLoaded = true;
    } catch (e) {
        console.warn('loadMobAudioLibrary error:', e);
        if (list) {
            list.innerHTML = '<div style="color:#ff453a;font-size:12px;padding:16px;text-align:center;cursor:pointer;">Failed to load — tap to retry</div>';
            list.onclick = () => { list.onclick = null; mobAudioLibLoaded = false; loadMobAudioLibrary(); };
        }
        return;
    }
    renderMobAudioList();
}

function filterMobAudioLibrary() { renderMobAudioList(); }

function renderMobAudioList() {
    const list = document.getElementById('mob-audio-list');
    if (!list) return;
    const q = (document.getElementById('mob-audio-search')?.value || '').toLowerCase().trim();
    const filtered = q ? mobAudioLib.filter(a => (a.name || '').toLowerCase().includes(q)) : mobAudioLib;

    if (!filtered.length) {
        list.innerHTML = '<div style="color:#555;font-size:12px;padding:16px;text-align:center;">No saved clips yet — upload one!</div>';
        return;
    }

    list.innerHTML = '';
    filtered.forEach(clip => {
        const row = document.createElement('div');
        row.className = 'mob-audio-row';

        const playBtn = document.createElement('button');
        playBtn.className = 'ar-play';
        playBtn.innerText = '▶';
        playBtn.onclick = (e) => { e.stopPropagation(); toggleLibraryClipPreview(clip, playBtn); };

        const info = document.createElement('div');
        info.className = 'ar-info';
        info.innerHTML = `<div class="ar-name">${clip.name || 'Untitled'}</div><div class="ar-dur">${mobFmtTime(clip.duration || 0)}</div>`;

        const useBtn = document.createElement('div');
        useBtn.className = 'ar-use';
        useBtn.innerText = 'Use';

        row.appendChild(playBtn);
        row.appendChild(info);
        row.appendChild(useBtn);
        row.onclick = () => {
            const dur = clip.duration || 45;
            applyAudioToFrame(clip.audio_url, clip.name, 0, Math.min(dur, 45));
        };
        list.appendChild(row);
    });
}

function toggleLibraryClipPreview(clip, btnEl) {
    const p = document.getElementById('mob-audio-preview');
    if (_mobAudioRowPlaying === btnEl && !p.paused) {
        p.pause(); btnEl.innerText = '▶'; _mobAudioRowPlaying = null; return;
    }
    stopAllMobAudioPreviews();
    p.src = clip.audio_url;
    p.currentTime = 0;
    const maxLen = Math.min(clip.duration || 45, 45);
    p.ontimeupdate = () => { if (p.currentTime >= maxLen) { p.pause(); btnEl.innerText = '▶'; _mobAudioRowPlaying = null; } };
    p.onended = () => { btnEl.innerText = '▶'; _mobAudioRowPlaying = null; };
    p.play().catch(() => {});
    btnEl.innerText = '⏸';
    _mobAudioRowPlaying = btnEl;
}

// upload + trim
document.getElementById('audio-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    _mobAudioUploadFile = file;
    if (_mobAudioUploadObjUrl) URL.revokeObjectURL(_mobAudioUploadObjUrl);
    _mobAudioUploadObjUrl = URL.createObjectURL(file);

    const player = document.getElementById('mob-audio-upload-player');
    player.src = _mobAudioUploadObjUrl;
    document.getElementById('mob-audio-upload-name').innerText = file.name;
    document.getElementById('mob-audio-upload-preview').style.display = 'block';
    document.getElementById('mob-audio-use-btn').disabled = true;

    player.onloadedmetadata = () => {
        _mobAudioUploadDuration = player.duration || 0;
        const startSlider = document.getElementById('mob-audio-trim-start');
        const lenSlider = document.getElementById('mob-audio-trim-len');

        if (_mobAudioUploadDuration < 3) {
            document.getElementById('mob-audio-trim-label').innerText = 'Clip too short — needs at least 3 seconds';
            document.getElementById('mob-audio-use-btn').disabled = true;
            startSlider.max = 0; lenSlider.max = 3;
            return;
        }
        startSlider.min = 0;
        startSlider.max = Math.max(0, _mobAudioUploadDuration - 3);
        startSlider.value = 0;
        lenSlider.min = 3;
        lenSlider.max = Math.min(45, _mobAudioUploadDuration);
        lenSlider.value = Math.min(45, _mobAudioUploadDuration);
        onAudioTrimChange();
        document.getElementById('mob-audio-use-btn').disabled = false;
    };
});

function onAudioTrimChange() {
    const startSlider = document.getElementById('mob-audio-trim-start');
    const lenSlider = document.getElementById('mob-audio-trim-len');
    let start = parseFloat(startSlider.value);
    let len = parseFloat(lenSlider.value);
    // clamp trim to file duration
    if (start + len > _mobAudioUploadDuration) len = Math.max(3, _mobAudioUploadDuration - start);
    lenSlider.value = len;
    const end = start + len;
    document.getElementById('mob-audio-trim-label').innerText =
        mobFmtTime(start) + ' – ' + mobFmtTime(end) + ' (' + len.toFixed(1) + 's)';
}

function previewAudioTrim() {
    const player = document.getElementById('mob-audio-upload-player');
    const start = parseFloat(document.getElementById('mob-audio-trim-start').value);
    const len = parseFloat(document.getElementById('mob-audio-trim-len').value);
    const end = start + len;
    player.currentTime = start;
    player.ontimeupdate = () => { if (player.currentTime >= end) player.pause(); };
    player.play().catch(() => {});
}

async function useUploadedAudioClip() {
    if (!_mobAudioUploadFile) return;
    const start = parseFloat(document.getElementById('mob-audio-trim-start').value);
    const len = parseFloat(document.getElementById('mob-audio-trim-len').value);
    const end = start + len;
    if (len < 3 || len > 45) { alert('Clip length must be between 3 and 45 seconds.'); return; }

    const useBtn = document.getElementById('mob-audio-use-btn');
    useBtn.disabled = true;
    useBtn.innerText = 'Uploading…';

    try {
        const handle = JSON.parse(localStorage.getItem('user_profile') || '{}').handle || 'guest';
        const safeHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'guest';
        const ext = (_mobAudioUploadFile.name.split('.').pop() || 'mp3').toLowerCase();
        const path = 'audio/user/' + safeHandle + '/clip_' + Date.now() + '.' + ext;

        const { error: upErr } = await _supabase.storage
            .from('comiccore-assets')
            .upload(path, _mobAudioUploadFile, { upsert: true, cacheControl: '3600' });
        if (upErr) throw upErr;
        const url = _supabase.storage.from('comiccore-assets').getPublicUrl(path).data.publicUrl;

        const saveToLib = document.getElementById('mob-audio-save-to-library').checked;
        if (saveToLib && handle && handle !== 'guest') {
            // fixed: .insert() has no .catch(), wrap in Promise.resolve()
            await Promise.resolve(_supabase.from('audio_library').insert([{
                name: _mobAudioUploadFile.name, audio_url: url, duration: len,
                uploaded_by: handle, created_at: new Date().toISOString()
            }])).catch((e) => console.warn('audio_library insert skipped:', e));
            mobAudioLibLoaded = false; // refresh the library next time it's opened
        }

        applyAudioToFrame(url, _mobAudioUploadFile.name, start, end);

        // reset upload pane
        _mobAudioUploadFile = null;
        if (_mobAudioUploadObjUrl) { URL.revokeObjectURL(_mobAudioUploadObjUrl); _mobAudioUploadObjUrl = null; }
        document.getElementById('mob-audio-upload-preview').style.display = 'none';
    } catch (e) {
        console.warn('useUploadedAudioClip failed:', e);
        alert('Upload failed: ' + (e.message || 'please try again'));
    } finally {
        useBtn.disabled = false;
        useBtn.innerText = 'Use This Clip';
    }
}

// layers
function getLayerName(layer, i) {
    if (layer.nameTag) return layer.nameTag;
    if (layer.content) return layer.content.substring(0, 18) + (layer.content.length > 18 ? '…' : '');
    const typeNames = { img: 'Image', bubble: 'Bubble', thinking: 'Thought', text: 'Text', subtitle: 'Subtitle', panel: 'Panel' };
    return (typeNames[layer.type] || layer.type) + ' ' + (i + 1);
}

function renderMobLayers() {
    const list = document.getElementById('mob-layer-list');
    if (!list) return;
    list.innerHTML = '';
    const f = frames[currentIdx];
    if (!f.layers.length) {
        list.innerHTML = '<div style="color:#555;text-align:center;padding:20px;font-size:13px;">No layers yet</div>';
        return;
    }

    // render bottom-up = layers reversed
    [...f.layers].reverse().forEach((layer, ri) => {
        const i = f.layers.length - 1 - ri; // actual index in f.layers
        const item = document.createElement('div');
        item.className = 'mob-layer-item' + (layer === activeLayer ? ' active-l' : '') + (layer.pinned ? ' pinned-l' : '');
        item.dataset.layerIdx = i;

        const ico = layer.type === 'img' ? '🖼' : layer.type === 'bubble' ? '💬' :
                    layer.type === 'thinking' ? '💭' : layer.type === 'subtitle' ? '📋' :
                    layer.type === 'panel' ? '▭' : '✍️';
        const name = getLayerName(layer, i);

        // drag handle
        const handle = document.createElement('span');
        handle.className = 'l-drag-handle';
        handle.innerHTML = '⠿';
        handle.title = 'Drag to reorder';

        // icon
        const icoEl = document.createElement('span');
        icoEl.style.cssText = 'font-size:18px;flex-shrink:0;';
        icoEl.innerText = ico;

        // info
        const info = document.createElement('div');
        info.className = 'l-info';
        info.innerHTML = `<div class="l-name">${name}</div><div class="l-type">${layer.type}</div>`;

        // double tap to rename
        let nameTapTime = 0;
        info.addEventListener('touchend', () => {
            const now = Date.now();
            if (now - nameTapTime < 300) {
                const newName = prompt('Rename layer:', name);
                if (newName !== null) { layer.nameTag = newName.trim() || undefined; renderMobLayers(); }
            }
            nameTapTime = now;
        });

        // pin button — target this layer so canvas taps on other layers are ignored
        const pin = document.createElement('button');
        pin.className = 'l-pin' + (layer.pinned ? ' pinned' : '');
        pin.innerHTML = '<i class="fi fi-rs-thumbtack"></i>';
        pin.title = layer.pinned ? 'Unpin' : 'Pin (protect from stray taps on other layers)';
        const doPinToggle = e => {
            e.stopPropagation();
            e.preventDefault();
            layer.pinned = !layer.pinned;
            render(); renderMobLayers();
        };
        // touchend fires before the row's own select handler so bind it directly here, stopPropagation stops it double-counting as a select tap and preventDefault kills the ghost click after
        pin.addEventListener('touchend', doPinToggle);
        pin.onclick = doPinToggle;

        // delete button
        const del = document.createElement('button');
        del.className = 'l-del'; del.innerHTML = '<i class="fi fi-rs-trash"></i>';
        const doDelete = e => {
            e.stopPropagation();
            e.preventDefault();
            saveState();
            f.layers.splice(i, 1);
            if (activeLayer === layer) activeLayer = null;
            render(); renderMobLayers();
        };
        del.addEventListener('touchend', doDelete);
        del.onclick = doDelete;

        item.appendChild(handle);
        item.appendChild(icoEl);
        item.appendChild(info);
        item.appendChild(pin);
        item.appendChild(del);

        if (anyLayersPinned() && !layer.pinned) item.style.opacity = '0.5';

        // select on tap — always works from the layers panel regardless of pin state
        let tapStartTime = 0, tapMoved = false;
        item.addEventListener('touchstart', () => { tapStartTime = Date.now(); tapMoved = false; }, { passive: true });
        item.addEventListener('touchmove', () => { tapMoved = true; }, { passive: true });
        item.addEventListener('touchend', () => {
            if (!tapMoved && Date.now() - tapStartTime < 400) {
                activeLayer = layer; fxEditingBg = false;
                render(); renderMobLayers();
            }
        });
        item.ondblclick = () => openTransformSheet();

        // touch drag-to-reorder
        attachLayerDrag(handle, item, i);

        list.appendChild(item);
    });
}

// touch drag-to-reorder for layers
let _dragLayerIdx  = null;  // actual f.layers index of dragged item
let _dragItemEl    = null;
let _dragPlaceholder = null;

function attachLayerDrag(handle, item, layerIdx) {
    handle.addEventListener('touchstart', e => {
        e.stopPropagation();
        _dragLayerIdx = layerIdx;
        _dragItemEl   = item;
        item.classList.add('dragging');

        // create drag clone
        const clone = item.cloneNode(true);
        clone.id = 'layer-drag-clone';
        clone.style.cssText = `position:fixed;z-index:99999;width:${item.offsetWidth}px;opacity:0.92;pointer-events:none;background:#1a1a1a;border:2px solid var(--accent);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.7);transform:scale(1.03);transition:none;`;
        const touch = e.touches[0];
        clone.style.left = (touch.clientX - item.offsetWidth / 2) + 'px';
        clone.style.top  = (touch.clientY - item.offsetHeight / 2) + 'px';
        document.body.appendChild(clone);
    }, { passive: true });

    handle.addEventListener('touchmove', e => {
        if (_dragLayerIdx === null) return;
        e.preventDefault();
        const touch = e.touches[0];

        // move clone
        const clone = document.getElementById('layer-drag-clone');
        if (clone) {
            clone.style.left = (touch.clientX - clone.offsetWidth / 2) + 'px';
            clone.style.top  = (touch.clientY - clone.offsetHeight / 2) + 'px';
        }

        // find hovered item
        const list = document.getElementById('mob-layer-list');
        const items = [...list.querySelectorAll('.mob-layer-item:not(.dragging)')];
        items.forEach(el => el.classList.remove('drag-over'));

        let targetEl = null;
        for (const el of items) {
            const rect = el.getBoundingClientRect();
            if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
                targetEl = el; break;
            }
        }
        if (targetEl) targetEl.classList.add('drag-over');

    }, { passive: false });

    handle.addEventListener('touchend', e => {
        if (_dragLayerIdx === null) return;

        // remove clone
        const clone = document.getElementById('layer-drag-clone');
        if (clone) clone.remove();
        if (_dragItemEl) _dragItemEl.classList.remove('dragging');

        // find drop target
        const touch = e.changedTouches[0];
        const list = document.getElementById('mob-layer-list');
        const items = [...list.querySelectorAll('.mob-layer-item:not(.dragging)')];
        items.forEach(el => el.classList.remove('drag-over'));

        let targetIdx = null;
        for (const el of items) {
            const rect = el.getBoundingClientRect();
            if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
                targetIdx = parseInt(el.dataset.layerIdx);
                break;
            }
        }

        if (targetIdx !== null && targetIdx !== _dragLayerIdx) {
            saveState();
            const f = frames[currentIdx];
            const [moved] = f.layers.splice(_dragLayerIdx, 1);
            f.layers.splice(targetIdx, 0, moved);
            if (activeLayer === moved) activeLayer = moved; // keep reference
            render();
            renderMobLayers();
        }

        _dragLayerIdx = null;
        _dragItemEl   = null;
    });
}

function deleteLayer() { if (!activeLayer) return; saveState(); const f = frames[currentIdx]; f.layers = f.layers.filter(l => l !== activeLayer); activeLayer = null; closeTransformSheet(); render(); renderMobLayers(); }
function flipHorizontal() { if (!activeLayer) return; saveState(); activeLayer.flipped = !activeLayer.flipped; render(); }

// flips a sprite between normal locked-aspect resize and free transform (orange corner handles stretch independently). also toggleable from the on-canvas rotate handle so you don't have to reopen this sheet
function toggleDistortMode() {
    if (!activeLayer || activeLayer.type !== 'img') return;
    saveState();
    activeLayer.distorted = !activeLayer.distorted;
    syncTransformSheet();
    render();
}
// swatches + slider sync for the transform sheet panel section, separate dom from the on-canvas popover but same underlying setters
function syncPanelSettingsUI() {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    const bw = activeLayer.borderWidth != null ? activeLayer.borderWidth : 4;
    const rad = activeLayer.radius || 0;
    const bwSlider = document.getElementById('panel-border-width-slider');
    const bwNum = document.getElementById('panel-border-width-num');
    if (bwSlider) bwSlider.value = bw;
    if (bwNum) bwNum.value = bw;
    const radSlider = document.getElementById('panel-radius-slider');
    const radNum = document.getElementById('panel-radius-num');
    if (radSlider) radSlider.value = rad;
    if (radNum) radNum.value = rad;
    const fillWrap = document.getElementById('panel-fill-swatches');
    const borderWrap = document.getElementById('panel-border-swatches');
    if (!fillWrap || !borderWrap) return;
    const curFill = (activeLayer.fill || '#ffffff').toLowerCase();
    const curBorder = (activeLayer.panelBorderColor || '#000000').toLowerCase();
    fillWrap.innerHTML = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="mobSqaPanelPickFill('${hex}')" style="width:24px;height:24px;border-radius:50%;background:${hex};border:2px solid ${curFill === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;"></button>`
    ).join('') + `<button type="button" onclick="mobSqaPanelPickFill('transparent')" title="No fill" style="width:24px;height:24px;border-radius:50%;background:repeating-conic-gradient(#666 0% 25%, #222 0% 50%) 50% / 8px 8px;border:2px solid ${curFill === 'transparent' ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;"></button>`;
    borderWrap.innerHTML = MOB_COLOR_PRESETS.map(hex =>
        `<button type="button" onclick="mobSqaPanelPickBorder('${hex}')" style="width:24px;height:24px;border-radius:50%;background:${hex};border:2px solid ${curBorder === hex ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};cursor:pointer;padding:0;"></button>`
    ).join('');
}
function tsApplyPanelBorderWidth(val) {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    saveState();
    activeLayer.borderWidth = Math.max(0, Math.min(20, parseInt(val) || 0));
    render(); renderTransformPreview();
}
function tsApplyPanelRadius(val) {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    saveState();
    activeLayer.radius = Math.max(0, Math.min(80, parseInt(val) || 0));
    render(); renderTransformPreview();
}

function resetTransform() {
    if (!activeLayer) return;
    saveState();
    activeLayer.rotation = 0; activeLayer.flipped = false; activeLayer.distorted = false;
    if (activeLayer.type === 'img') {
        const resetProbe = new Image();
        resetProbe.onload = () => {
            if (resetProbe.naturalWidth && resetProbe.naturalHeight) {
                if (activeLayer.insertW && activeLayer.insertH) {
                    // restore the size it was actually placed at (recorded when the sprite was inserted), not a placeholder
                    activeLayer.w = activeLayer.insertW;
                    activeLayer.h = activeLayer.insertH;
                } else if (activeLayer.charHeight && activeLayer.charScale) {
                    // legacy character layer with no insertW/insertH on record — rebuild from its canonical height/scale instead
                    activeLayer.h = activeLayer.charHeight;
                    activeLayer.w = Math.round(resetProbe.naturalWidth * activeLayer.charScale);
                } else {
                    // legacy layer with no canonical size on record at all — last-resort default
                    activeLayer.w = 200;
                    activeLayer.h = Math.round(200 * resetProbe.naturalHeight / resetProbe.naturalWidth);
                }
                syncTransformSheet();
                render();
            }
        };
        resetProbe.src = activeLayer.src;
    } else {
        activeLayer.w = 200;
        syncTransformSheet();
        render();
    }
}
function moveLayerZ(dir) {
    if (!activeLayer) return;
    saveState();
    const layers = frames[currentIdx].layers;
    const idx = layers.findIndex(l => l.id === activeLayer.id);
    if (dir > 0 && idx < layers.length - 1) [layers[idx], layers[idx+1]] = [layers[idx+1], layers[idx]];
    else if (dir < 0 && idx > 0) [layers[idx], layers[idx-1]] = [layers[idx-1], layers[idx]];
    render();
    renderMobLayers();
}

function moveLayerToFront() {
    if (!activeLayer) return;
    saveState();
    const layers = frames[currentIdx].layers;
    const idx = layers.findIndex(l => l.id === activeLayer.id);
    if (idx === -1 || idx === layers.length - 1) return;
    layers.push(layers.splice(idx, 1)[0]);
    render();
    renderMobLayers();
}

function moveLayerToBack() {
    if (!activeLayer) return;
    saveState();
    const layers = frames[currentIdx].layers;
    const idx = layers.findIndex(l => l.id === activeLayer.id);
    if (idx === -1 || idx === 0) return;
    layers.unshift(layers.splice(idx, 1)[0]);
    render();
    renderMobLayers();
}

function sbCopyLayer() { if (activeLayer) { window._layerClipboard = JSON.parse(JSON.stringify(activeLayer)); } }
function sbPasteLayer() { if (!window._layerClipboard) return; saveState(); const copy = JSON.parse(JSON.stringify(window._layerClipboard)); copy.id = Date.now(); const cw = canvas.offsetWidth || 300; const ch = canvas.offsetHeight || 300; copy.x = Math.min(Math.round(copy.x || 0) + 20, cw - (copy.w || 100)); copy.y = Math.min(Math.round(copy.y || 0) + 20, ch - (copy.h || 100)); frames[currentIdx].layers.push(copy); activeLayer = copy; render(); renderMobLayers(); }
function updateTextProp(prop, value) {
    if (activeLayer && ['bubble','thinking','text','subtitle'].includes(activeLayer.type)) {
        activeLayer[prop] = (prop === 'fontSize') ? parseInt(value) : (prop === 'outlineWidth') ? parseFloat(value) : value;
        if (prop === 'fontFamily') { try { localStorage.setItem('cc-last-font', value); } catch(e) {} }
        render(); renderTransformPreview();
        if (prop === 'outlineWidth') {
            const pop = document.getElementById('sqa-popover');
            if (pop && pop.dataset.kind === 'font') renderSqaFontPopover();
        }
    }
}
function mobLastFont(fallback) {
    try { return localStorage.getItem('cc-last-font') || fallback; } catch(e) { return fallback; }
}
function updateNameTag(val) { if (activeLayer) { activeLayer.nameTag = val; render(); } }
function clearNameTag() { if (activeLayer) { activeLayer.nameTag = ''; document.getElementById('sprite-nametag-input').value = ''; render(); } }

// apply transform
function applyTransform() {
    if (!activeLayer) return;
    const sizeMax = activeLayer.type === 'img' ? getMaxSpriteSize() : 1600;
    const w = Math.min(sizeMax, parseInt(document.getElementById('size-slider').value));
    const r = parseInt(document.getElementById('rotate-slider').value);
    if (activeLayer.h != null && activeLayer.w && activeLayer.w !== w) {
        if (activeLayer.charScale != null) activeLayer.charScale *= (w / activeLayer.w);
        activeLayer.h = Math.round(activeLayer.h * w / activeLayer.w);
    }
    activeLayer.w = w; activeLayer.rotation = r;
    // keeps pose-swap height in sync after a manual resize, otherwise the next swap jumps back to old size/position
    if (activeLayer.charHeight != null) activeLayer.charHeight = activeLayer.h;
    render();
    renderTransformPreview();
}

// transform sheet covers the canvas, so this renders a live scaled-to-fit copy of the selected layer inside the sheet, kept synced to every control
function buildLayerPreviewElement(layer) {
    let el = null;

    if (layer.type === 'bubble' || layer.type === 'thinking') {
        const bStyle = layer.bubbleStyle || 'round';
        const bubBorder = layer.bubbleBorderColor || '#000';
        const bubBg = layer.bubbleBg || (bStyle === 'shout' ? '#ffeb3b' : bStyle === 'narrator' ? '#fffde7' : '#fff');
        const isBurst = bStyle === 'spiky' || bStyle === 'shout';
        el = document.createElement('div');
        el.className = 'speech-bubble bubble-style-' + bStyle;
        el.style.cssText = `width:${layer.w||120}px;font-size:${layer.fontSize||18}px;font-family:${layer.fontFamily||'Inter, sans-serif'};--bubble-border:${bubBorder};--bubble-bg:${bubBg};${isBurst ? '' : `border-color:${bubBorder};background:${bubBg};`}`;
        const textCss = `font-weight:${layer.bold ? '900' : ''};font-style:${layer.italic ? 'italic' : 'normal'};text-decoration:${[layer.underline ? 'underline' : '', layer.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'};text-align:${layer.align || 'center'};${layer.color ? `color:${layer.color};` : ''}${layer.outline ? textOutlineCSS(layer.fontSize||18, layer.outlineWidth) : ''}`;
        if (isBurst) {
            const fill = document.createElement('div');
            fill.className = 'bubble-clip-fill';
            fill.style.cssText = textCss;
            fill.innerText = layer.content || '';
            el.appendChild(fill);
        } else {
            el.style.cssText += textCss;
            el.innerText = layer.content || '';
        }
        const showTail = !['spiky','shout','electric','narrator','cloud'].includes(bStyle);
        if (showTail) {
            el.insertAdjacentHTML('beforeend', bubbleTailHTML(bStyle, getBubbleTailEdge(layer), getBubbleTailPos(layer, bStyle), bubBorder, bubBg));
        }
        if (layer.type === 'thinking') [1,2,3].forEach(n => { const d = document.createElement('div'); d.className = 'thought-dot-' + n; el.appendChild(d); });
    } else if (layer.type === 'text') {
        el = document.createElement('div');
        el.style.cssText = `color:${layer.color||'#000'};font-size:${layer.fontSize||24}px;font-family:${layer.fontFamily||'Inter, sans-serif'};font-weight:${layer.bold?'900':'700'};font-style:${layer.italic?'italic':'normal'};text-decoration:${layer.underline?'underline':'none'};white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;width:${layer.w||200}px;text-align:${layer.align||'left'};${layer.outline ? textOutlineCSS(layer.fontSize||24, layer.outlineWidth) : ''}`;
        el.innerText = layer.content || 'Text';
    } else if (layer.type === 'subtitle') {
        const nameColor = layer.nameColor || '#ff9500';
        const dialogColor = layer.color || '#111';
        const alignS = layer.align || 'left';
        const boldW = layer.bold ? '900' : '700';
        const italicS = layer.italic ? 'italic' : 'normal';
        const ff = layer.fontFamily || "'Inter', sans-serif";
        const fs = layer.fontSize || 16;
        const outlineS = layer.outline ? textOutlineCSS(fs, layer.outlineWidth) : '';
        el = document.createElement('div');
        el.style.cssText = `width:${layer.w||200}px;`;
        el.innerHTML = `
            <div style="background:${nameColor};color:#fff;font-size:${Math.max(10,fs*0.55)}px;font-weight:900;font-family:${ff};padding:3px 10px;border-radius:5px 5px 0 0;letter-spacing:1px;text-transform:uppercase;line-height:1.5;text-align:${alignS};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${layer.characterName || 'CHARACTER'}</div>
            <div style="background:rgba(255,255,255,0.96);color:${dialogColor};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};font-family:${ff};padding:6px 10px;border-radius:0 0 5px 5px;text-align:${alignS};line-height:1.4;border:1.5px solid rgba(0,0,0,0.1);border-top:none;${outlineS}">${layer.content || 'Dialogue...'}</div>
        `;
    } else if (layer.type === 'img') {
        el = document.createElement('img');
        el.src = layer._fxSrc || layer.src;
        el.draggable = false;
        const h = (layer.h != null) ? layer.h + 'px' : 'auto';
        // distorted sprites need fill here too or this sheet's preview shows the un-stretched original instead of what's actually on canvas
        el.style.cssText = `width:${layer.w||120}px;height:${h};display:block;object-fit:${layer.distorted ? 'fill' : 'contain'};transform:scaleX(${layer.flipped ? -1 : 1});`;
    } else if (layer.type === 'panel') {
        el = document.createElement('div');
        const bw = layer.borderWidth != null ? layer.borderWidth : 4;
        const fill = layer.fill || 'transparent';
        const bc = layer.panelBorderColor || '#000000';
        const rad = layer.radius || 0;
        el.style.cssText = `width:${layer.w||200}px;height:${layer.h||140}px;box-sizing:border-box;background:${fill};${bw > 0 ? `border:${bw}px solid ${bc};` : ''}border-radius:${rad}px;`;
    }

    return el;
}

// fit box inside wrap, scale down only
function _fitPreviewBox(wrap, box) {
    requestAnimationFrame(() => {
        if (!wrap.isConnected) return;
        const availW = wrap.clientWidth - 20;
        const availH = wrap.clientHeight - 20;
        const rect = box.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && availW > 0 && availH > 0) {
            const scale = Math.min(1, availW / rect.width, availH / rect.height);
            box.style.transform = `scale(${scale})`;
        }
    });
}

function renderTransformPreview() {
    const wrap = document.getElementById('ts-preview-box');
    const box  = document.getElementById('ts-preview-content');
    if (!wrap || !box || !activeLayer) { if (wrap) wrap.style.display = 'none'; return; }

    const layer = activeLayer;
    box.style.transform = 'none';
    box.innerHTML = '';

    const el = buildLayerPreviewElement(layer);
    if (!el) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    el.style.transform = (el.style.transform ? el.style.transform + ' ' : '') + `rotate(${layer.rotation||0}deg)`;
    box.appendChild(el);

    // scale down to fit preview box, never up
    _fitPreviewBox(wrap, box);
}

// fx preview
function renderFxPreview() {
    const wrap = document.getElementById('fx-preview-box');
    const box  = document.getElementById('fx-preview-content');
    if (!wrap || !box) return;
    if (fxEditingBg) { renderBgFxPreview(wrap, box); return; }
    if (!activeLayer) { wrap.style.display = 'none'; return; }

    const layer = activeLayer;

    // mix-blend-mode needs real content underneath — checkerboard when no blend mode is active, composited frame when one is
    if (layer.fxBlend && layer.fxBlend !== 'normal') {
        renderFxPreviewComposited(wrap, box, layer);
        return;
    }

    box.style.transform = 'none';
    box.innerHTML = '';

    const el = buildLayerPreviewElement(layer);
    if (!el) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    el.style.transform = (el.style.transform ? el.style.transform + ' ' : '') + `rotate(${layer.rotation||0}deg)`;

    if (layer.type === 'img') {
        const hasFxSrc  = !!layer._fxSrc;
        const bStrength = (layer.blurStrength != null) ? layer.blurStrength : 100;
        const lfCSS     = (layer.fxFilter && layer.fxFilter !== 'none') ? layer.fxFilter : '';
        const holder = document.createElement('div');
        holder.style.cssText = `position:relative;display:inline-block;width:${layer.w||120}px;height:${layer.h != null ? layer.h + 'px' : 'auto'};`;

        if (hasFxSrc && bStrength < 100) {
            // blend: base + fx overlay (matches main canvas)
            const base = document.createElement('img');
            base.src = layer.src; base.draggable = false;
            base.style.cssText = `width:100%;height:100%;display:block;object-fit:${layer.distorted ? 'fill' : 'contain'};`;
            if (layer.fxOpacity !== undefined) base.style.opacity = layer.fxOpacity / 100;
            el.style.position = 'absolute';
            el.style.top = '0';
            el.style.left = '0';
            el.style.width = '100%';
            el.style.height = '100%';
            el.style.opacity = bStrength / 100;
            holder.appendChild(base);
            holder.appendChild(el);
        } else {
            if (!hasFxSrc) {
                const blurCSS = getSpriteFilterCSS(layer);
                const combined = [blurCSS, lfCSS].filter(Boolean).join(' ');
                if (combined) el.style.filter = combined;
            }
            if (layer.fxOpacity !== undefined) el.style.opacity = layer.fxOpacity / 100;
            holder.appendChild(el);
        }
        applyColorFxToDOM(holder, layer);
        box.appendChild(holder);
    } else {
        if (layer.fxOpacity !== undefined) el.style.opacity = layer.fxOpacity / 100;
        box.appendChild(el);
    }

    _fitPreviewBox(wrap, box);
}

// cloned live canvas, updated on every fx change, so blend result shows against the real bg/sprites as it'll actually look
function renderFxPreviewComposited(wrap, box, layer) {
    wrap.style.display = 'flex';
    box.style.transform = 'none';
    box.innerHTML = '';

    const clone = canvas.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.position = 'relative';
    clone.style.inset = 'auto';
    clone.style.width = canvas.offsetWidth + 'px';
    clone.style.height = canvas.offsetHeight + 'px';
    clone.style.pointerEvents = 'none';
    clone.onclick = null;

    // strip interactive chrome, passive preview only
    clone.querySelectorAll('.resize-handle, .rotate-handle, .rotate-handle-stem, .tail-scroller-track, .tail-scroller-handle, .sqa-corner-toggle').forEach(h => h.remove());
    const onionClone = clone.querySelector('#onion-skin-canvas');
    if (onionClone) onionClone.style.display = 'none';
    const dragClone = clone.querySelector('#bg-drag-overlay');
    if (dragClone) dragClone.remove();

    // subtle outline on highlighted layers so it stays identifiable without cluttering the preview
    clone.querySelectorAll('.layer.active').forEach(el => el.classList.remove('active'));
    const targetEl = clone.querySelector(`[data-layer-id="${layer.id}"]`);
    if (targetEl) targetEl.style.outline = '2px solid rgba(0,210,255,0.9)';

    box.appendChild(clone);
    _fitPreviewBox(wrap, box);
}

// bg fx preview
function renderBgFxPreview(wrap, box) {
    const f = frames[currentIdx];
    const bgFx = (f && f.bgFx) || {};
    box.style.transform = 'none';
    box.innerHTML = '';
    const bg = (f && f.background) || '#ffffff';
    const isImg  = bg.startsWith('http') || bg.startsWith('data:image');
    const isGrad = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient');

    const holder = document.createElement('div');
    holder.style.cssText = 'position:relative;display:inline-block;width:140px;height:140px;overflow:hidden;border-radius:8px;';
    if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') holder.style.mixBlendMode = cssBlendMode(bgFx.fxBlend);

    const hasFxSrc  = !!bgFx._fxSrc;
    const bStrength = (bgFx.blurStrength != null) ? bgFx.blurStrength : 100;
    const lfCSS     = (bgFx.fxFilter && bgFx.fxFilter !== 'none') ? bgFx.fxFilter : '';
    const blurCSS   = getSpriteFilterCSS(bgFx);
    const combined  = [blurCSS, lfCSS].filter(Boolean).join(' ');

    if (isImg && hasFxSrc && bStrength < 100) {
        // blend: base + fx overlay (matches main canvas)
        const base = document.createElement('img');
        base.src = bg; base.draggable = false;
        base.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
        if (bgFx.fxOpacity !== undefined) base.style.opacity = bgFx.fxOpacity / 100;
        const overlay = document.createElement('img');
        overlay.src = bgFx._fxSrc; overlay.draggable = false;
        overlay.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:${bStrength/100};`;
        holder.appendChild(base);
        holder.appendChild(overlay);
    } else if (isImg) {
        const imgEl = document.createElement('img');
        imgEl.src = hasFxSrc ? bgFx._fxSrc : bg; imgEl.draggable = false;
        imgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
        if (!hasFxSrc && combined) imgEl.style.filter = combined;
        if (bgFx.fxOpacity !== undefined) imgEl.style.opacity = bgFx.fxOpacity / 100;
        holder.appendChild(imgEl);
    } else {
        // gradient/solid: css fx only, no canvas blur
        const swatch = document.createElement('div');
        swatch.style.cssText = `position:absolute;inset:0;background:${isGrad ? bg : bg};`;
        if (combined) swatch.style.filter = combined;
        if (bgFx.fxOpacity !== undefined) swatch.style.opacity = bgFx.fxOpacity / 100;
        holder.appendChild(swatch);
    }

    applyColorFxToDOM(holder, bgFx);
    box.appendChild(holder);
    wrap.style.display = 'flex';
    _fitPreviewBox(wrap, box);
}

// personal sprite library
let myLibrarySprites = null;   // full rows: {id, name, src, actions, pack_id, created_at}
let myLibraryPacks = null;     // {id, name, created_at}
let mobActivePackFilter = null; // null = show all sprites; else a pack id to filter by

async function loadMobSprites() {
    const grid = document.getElementById('mob-sprite-grid');
    grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">Loading your sprites...</div>';
    const { data: { session: _mls } } = await _supabase.auth.getSession();
    const user = _mls?.user ?? null;
    if (!user) {
        myLibrarySprites = [];
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">Log in to see your sprites</div>';
        return;
    }
    const { data, error } = await _supabase.from('personal_sprites')
        .select('id, name, src, actions, pack_id, created_at')
        .order('created_at', { ascending: false });
    if (error) {
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">Error loading sprites</div>';
        return;
    }
    myLibrarySprites = (data || []).map(s => ({ ...s, actions: (typeof s.actions === 'string' ? (JSON.parse(s.actions||'{}')) : (s.actions || {})) }));
    filterMobSprites();
}

function renderMobSpriteGrid(sprites) {
    const grid = document.getElementById('mob-sprite-grid');
    grid.innerHTML = '';
    sprites.forEach(sp => {
        const card = document.createElement('div');
        card.className = 'mob-sprite-card';
        card.style.position = 'relative';
        card.innerHTML = `<img src="${sp.src}" loading="lazy" style="width:100%;height:100%;object-fit:contain;border-radius:8px;"><div class="mob-sprite-name">${sp.name || 'My Sprite'}</div>`;
        card.onclick = () => {
            closeSheet('sprites');
            openActionModal({ id: sp.id, name: sp.name, image_data: sp.src, actions: sp.actions || {} });
        };
        grid.appendChild(card);
    });
    if (!sprites.length) grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">' +
        (mobActivePackFilter ? 'No sprites in this pack yet' : 'No sprites yet — tap + to add one') + '</div>';
}

function sortSpriteList(list, sort) {
    if (sort === 'newest')   return [...list].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    if (sort === 'oldest')   return [...list].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    if (sort === 'az')       return [...list].sort((a,b) => (a.name||'').localeCompare(b.name||''));
    if (sort === 'za')       return [...list].sort((a,b) => (b.name||'').localeCompare(a.name||''));
    return list;
}

// mobile sprite / packs sub-tab
let mobActiveSpriteTab = 'sprites';

function switchMobSpriteTab(tab) {
    mobActiveSpriteTab = tab;
    const tSprites = document.getElementById('mob-tab-sprites');
    const tPacks   = document.getElementById('mob-tab-packs');
    const pSprites = document.getElementById('mob-sprites-subpanel');
    const pPacks   = document.getElementById('mob-packs-subpanel');
    if (tSprites) { tSprites.style.background = tab==='sprites' ? 'var(--accent)' : '#111'; tSprites.style.color = tab==='sprites' ? '#000' : '#555'; }
    if (tPacks)   { tPacks.style.background   = tab==='packs'   ? 'var(--accent)' : '#111'; tPacks.style.color   = tab==='packs'   ? '#000' : '#555'; }
    if (pSprites) pSprites.style.display = tab==='sprites' ? 'block' : 'none';
    if (pPacks)   pPacks.style.display   = tab==='packs'   ? 'block' : 'none';
    if (tab === 'packs' && myLibraryPacks === null) loadMobPacks();
}

// packs = the user's own folders (personal_sprite_packs)
async function loadMobPacks() {
    const grid = document.getElementById('mob-pack-grid');
    grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">Loading packs...</div>';
    const { data, error } = await _supabase.from('personal_sprite_packs')
        .select('id, name, created_at').order('created_at', { ascending: true });
    if (error) { grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">Could not load packs</div>'; return; }
    myLibraryPacks = data || [];
    renderMobPacks(myLibraryPacks);
}

function filterMobPacks() {
    if (!myLibraryPacks) return;
    const q = (document.getElementById('mob-pack-search')?.value || '').toLowerCase().trim();
    const list = q ? myLibraryPacks.filter(p => p.name.toLowerCase().includes(q)) : myLibraryPacks;
    renderMobPacks(list);
}

function renderMobPacks(packs) {
    const grid = document.getElementById('mob-pack-grid');
    if (!packs.length) {
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">No packs yet — use Move to Pack in My Sprites to make one</div>';
        return;
    }
    grid.innerHTML = '';
    packs.forEach(pack => {
        const count = (myLibrarySprites || []).filter(s => s.pack_id === pack.id).length;
        const tile = document.createElement('div');
        tile.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px 6px;background:#161618;border:1px solid #2a2a2a;border-radius:14px;cursor:pointer;text-align:center;';
        tile.innerHTML = `
            <i class="fi fi-rs-box" style="font-size:22px;color:var(--accent);"></i>
            <span style="font-size:11px;font-weight:800;color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${pack.name}</span>
            <span style="font-size:9px;font-weight:700;color:#666;">${count} sprite${count!==1?'s':''}</span>
        `;
        tile.onclick = () => openMobPersonalPack(pack);
        grid.appendChild(tile);
    });
}

function openMobPersonalPack(pack) {
    mobActivePackFilter = pack.id;
    const ctx = document.getElementById('mob-sprite-pack-context');
    const ctxName = document.getElementById('mob-sprite-pack-context-name');
    if (ctx) ctx.style.display = 'flex';
    if (ctxName) ctxName.textContent = pack.name;
    switchMobSpriteTab('sprites');
    filterMobSprites();
}

function clearMobPackFilter() {
    mobActivePackFilter = null;
    const ctx = document.getElementById('mob-sprite-pack-context');
    if (ctx) ctx.style.display = 'none';
    filterMobSprites();
}

function openMobPackSheet(pack, items) {
    const existing = document.getElementById('mob-pack-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'mob-pack-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
    modal.innerHTML = `
        <div style="background:#111;border-top:1.5px solid var(--teal);border-radius:24px 24px 0 0;
                    padding:18px 16px 32px;width:100%;max-height:78vh;overflow-y:auto;box-sizing:border-box;">
            <div style="width:36px;height:4px;background:#2a2a2a;border-radius:2px;margin:0 auto 14px;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <div style="font-size:13px;font-weight:900;color:var(--teal);">📦 ${pack.name}</div>
                <span onclick="document.getElementById('mob-pack-modal').remove()"
                      style="color:#444;font-size:22px;cursor:pointer;line-height:1;">✕</span>
            </div>
            <div style="font-size:10px;color:#444;font-weight:700;margin-bottom:14px;">
                ${items.length} sprite${items.length!==1?'s':''} — tap one to choose its pose
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;" id="mob-pack-sprite-grid"></div>
        </div>
    `;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    const spriteGrid = document.getElementById('mob-pack-sprite-grid');
    items.forEach(it => {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0f0f11;border:1.5px solid #222;border-radius:12px;cursor:pointer;display:flex;flex-direction:column;overflow:hidden;';
        const src = it.image_url || '';
        const imgSt = 'max-width:100%;max-height:72px;object-fit:contain;';
        card.innerHTML = `
            <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:8px;min-height:72px;">
                ${src
                    ? `<img src="${src}" loading="lazy" style="${imgSt}">`
                    : `<div style="width:50px;height:50px;background:linear-gradient(90deg,#1e1e1e 25%,#2a2a2a 50%,#1e1e1e 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:8px;" class="mob-pk-skel"></div>`}
            </div>
            <div style="font-size:9px;font-weight:800;color:#666;padding:3px 5px 5px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(0,0,0,0.4);border-top:1px solid #1e1e1e;">${it.label||'Sprite'}</div>
        `;
        if (!src && it.sprite_id) {
            sbFetchFull(it.sprite_id).then(full => {
                if (!full?.image_data) return;
                const sk = card.querySelector('.mob-pk-skel');
                if (!sk) return;
                const img = document.createElement('img');
                img.src = full.image_data;
                img.style.cssText = imgSt;
                sk.replaceWith(img);
                it.image_url = full.image_data;
            });
        }
        card.addEventListener('click', () => mobPackItemClick(it));
        spriteGrid.appendChild(card);
    });
}

async function mobPackItemClick(it) {
    document.getElementById('mob-pack-modal')?.remove();
    const id = it.sprite_id;
    if (!id) return;
    const full = await sbFetchFull(id);
    if (!full) return;
    const spriteObj = (sidebarSprites||[]).find(s=>s.id===id) || { id, name:it.label };
    openActionModal({ ...spriteObj, ...full, id });
}

let mobSidebarEffects = null;
let mobEffectActiveTag = null;

const EFX_META_KEY = 'cc_effects_meta_v1';
const EFX_META_TTL = 10 * 60 * 1000;
const EFX_FULL_TTL = 30 * 60 * 1000;
const EFX_CACHE_VER = 'v1';

function efxSaveMetaCache(data) {
    const lean = (data||[]).map(({id,name,tags,creator,created_at})=>({id,name,tags,creator,created_at}));
    try { localStorage.setItem(EFX_META_KEY, JSON.stringify({ts:Date.now(),data:lean})); } catch(e) {}
}
function efxLoadMetaCache() {
    try {
        const raw = localStorage.getItem(EFX_META_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (Date.now()-p.ts > EFX_META_TTL) { localStorage.removeItem(EFX_META_KEY); return null; }
        return p.data;
    } catch(e) { return null; }
}
function efxGetImg(id) { try { return sessionStorage.getItem('cc_efx_'+id); } catch(e) { return null; } }
function efxSetImg(id,url) { try { sessionStorage.setItem('cc_efx_'+id,url); } catch(e) {} }
function efxGetFull(id) {
    try {
        const raw = localStorage.getItem('efx-full-'+id);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (p.v !== EFX_CACHE_VER || Date.now()-(p.ts||0) > EFX_FULL_TTL) { localStorage.removeItem('efx-full-'+id); return null; }
        return p;
    } catch(e) { return null; }
}
function efxSetFull(id, url, actions) {
    try { localStorage.setItem('efx-full-'+id, JSON.stringify({img:url, actions:actions||{}, ts:Date.now(),v:EFX_CACHE_VER})); } catch(e) {}
}

// batch lazy-loader for effect images (like sprite sidebar)
let _efxLazyQueue = [];
let _efxLazyTimer = null;

const _efxObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        _efxObserver.unobserve(entry.target);
        const id = entry.target.dataset.efxId;
        if (!id) return;
        const cached = efxGetImg(id);
        if (cached) {
            _efxApplyImg(entry.target, cached);
        } else {
            _efxLazyQueue.push(id);
            _efxScheduleBatch();
        }
    });
}, { rootMargin: '300px 0px' });

function _efxScheduleBatch() {
    if (_efxLazyTimer) return;
    _efxLazyTimer = setTimeout(_efxFlushBatch, 40);
}

async function _efxFlushBatch() {
    _efxLazyTimer = null;
    if (!_efxLazyQueue.length) return;
    const batch = [...new Set(_efxLazyQueue.splice(0, 20))];
    const { data } = await _supabase.from('effects_library')
        .select('id, image_data').in('id', batch);
    if (!data) return;
    data.forEach(row => {
        efxSetImg(row.id, row.image_data);
        const card = document.querySelector(`.mob-sprite-card[data-efx-id="${row.id}"]`);
        if (card) _efxApplyImg(card, row.image_data);
    });
    if (_efxLazyQueue.length) _efxScheduleBatch();
}

function _efxApplyImg(card, src) {
    const skeleton = card.querySelector('.efx-skeleton');
    if (!skeleton) return;
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:8px;';
    img.onload = () => skeleton.replaceWith(img);
    img.onerror = () => { skeleton.style.background = '#1a1a1a'; };
    img.src = src;
}

// background image lazy-loader
let _bgLazyQueue = [];
let _bgLazyTimer = null;

const _bgObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        _bgObserver.unobserve(entry.target);
        const id = entry.target.dataset.bgId;
        if (!id) return;
        // already loaded, skip
        if (entry.target._imgSrc) return;
        let cached;
        try { cached = sessionStorage.getItem('cc_bg_img_' + id); } catch(e) {}
        if (cached) {
            _bgApplyImg(entry.target, cached);
        } else {
            _bgLazyQueue.push(id);
            _bgScheduleBatch();
        }
    });
}, { rootMargin: '200px 0px' });

function _bgScheduleBatch() {
    if (_bgLazyTimer) return;
    _bgLazyTimer = setTimeout(_bgFlushBatch, 40);
}

async function _bgFlushBatch() {
    _bgLazyTimer = null;
    if (!_bgLazyQueue.length) return;
    const batch = [...new Set(_bgLazyQueue.splice(0, 10))];
    let data;
    try {
        const res = await _supabase.from('backgrounds_library')
            .select('id, image_data').in('id', batch);
        data = res.data;
    } catch(e) {
        console.warn('BG batch load failed:', e);
        // re-queue for retry on scroll
        _bgLazyQueue.unshift(...batch);
        return;
    }
    if (!data) return;
    data.forEach(row => {
        if (!row.image_data) return;
        try { sessionStorage.setItem('cc_bg_img_' + row.id, row.image_data); } catch(e) {}
        const card = document.querySelector(`.mob-bg-card[data-bg-id="${row.id}"]`);
        if (card) _bgApplyImg(card, row.image_data);
        // update in-memory list too
        const inOff = (mobBgOfficial||[]).find(b => b.id === row.id);
        if (inOff) inOff.image_data = row.image_data;
        const inMine = (mobBgMine||[]).find(b => b.id === row.id);
        if (inMine) inMine.image_data = row.image_data;
    });
    if (_bgLazyQueue.length) _bgScheduleBatch();
}

function _bgApplyImg(card, src) {
    // set _imgSrc early so click handler has it
    card._imgSrc = src;
    const skeleton = card.querySelector('.bg-skeleton');
    if (!skeleton) return;
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0;';
    img.onload  = () => { if (skeleton.parentNode) skeleton.replaceWith(img); };
    img.onerror = () => { if (skeleton.parentNode) skeleton.style.background = '#1a1a1a'; };
    img.src = src;
}

async function loadMobEffects() {
    const grid = document.getElementById('mob-effect-grid');
    const cached = efxLoadMetaCache();
    if (cached) {
        mobSidebarEffects = cached;
        renderMobEffectGrid(mobSidebarEffects);
        buildMobEffectTagChips(mobSidebarEffects);
    } else {
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:12px;">Loading...</div>';
    }
    const { data } = await _supabase.from('effects_library').select('id,name,tags,creator,created_at').order('created_at',{ascending:false});
    const fresh = data || [];
    mobSidebarEffects = fresh;
    efxSaveMetaCache(fresh);
    renderMobEffectGrid(fresh);
    buildMobEffectTagChips(fresh);
}

function buildMobEffectTagChips(effects) {
    const wrap = document.getElementById('mob-effect-tag-chips');
    if (!wrap) return;
    const counts = {};
    effects.forEach(e=>(e.tags||[]).forEach(t=>{ counts[t]=(counts[t]||0)+1; }));
    const top10 = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(e=>e[0]);
    wrap.innerHTML = ['All',...top10].map((t,i)=>
        `<button onclick="setMobEffectTag(${i===0?'null':JSON.stringify(t)})" style="padding:4px 10px;border-radius:12px;border:1px solid ${(i===0&&!mobEffectActiveTag)||(mobEffectActiveTag===t)?'#ff7a00':'#222'};background:${(i===0&&!mobEffectActiveTag)||(mobEffectActiveTag===t)?'rgba(255,122,0,.12)':'#111'};color:${(i===0&&!mobEffectActiveTag)||(mobEffectActiveTag===t)?'#ff7a00':'#555'};font-size:10px;font-weight:800;cursor:pointer;font-family:inherit;">${t}</button>`
    ).join('');
}

function setMobEffectTag(tag) { mobEffectActiveTag = tag; filterMobEffects(); }

function filterMobEffects() {
    const q    = document.getElementById('mob-effect-search').value.toLowerCase().trim();
    const sort = document.getElementById('mob-effect-sort')?.value||'newest';
    let list   = [...(mobSidebarEffects||[])];
    if (mobEffectActiveTag) list = list.filter(e=>(e.tags||[]).includes(mobEffectActiveTag));
    if (q) list = list.filter(e=>e.name.toLowerCase().includes(q)||(e.tags||[]).some(t=>t.includes(q)));
    // sort
    if (sort==='newest')   list.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if (sort==='oldest')   list.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    if (sort==='az')       list.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    if (sort==='za')       list.sort((a,b)=>(b.name||'').localeCompare(a.name||''));
    if (sort==='lastused') list.sort((a,b)=>(parseInt(localStorage.getItem('efx-used-'+b.id)||0))-(parseInt(localStorage.getItem('efx-used-'+a.id)||0)));
    renderMobEffectGrid(list);
    buildMobEffectTagChips(mobSidebarEffects||[]);
}

function renderMobEffectGrid(effects) {
    const grid = document.getElementById('mob-effect-grid');
    grid.innerHTML = '';
    if (!effects.length) { grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 2;font-size:12px;">No effects found</div>'; return; }
    effects.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'mob-sprite-card';
        card.dataset.efxId = pack.id;
        const cachedSrc = pack.image_data || efxGetImg(pack.id);
        if (cachedSrc) {
            card.innerHTML = `<img src="${cachedSrc}" style="width:100%;height:100%;object-fit:contain;border-radius:8px;"><div class="mob-sprite-name">${pack.name}</div>`;
        } else {
            card.innerHTML = `<div class="efx-skeleton" style="position:absolute;inset:0;border-radius:8px;background:linear-gradient(90deg,#1e1e1e 25%,#2a2a2a 50%,#1e1e1e 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;"></div><div class="mob-sprite-name">${pack.name}</div>`;
            _efxObserver.observe(card);
        }

        card.onclick = async () => {
            lsSet('efx-used-'+pack.id, Date.now());
            const cached = efxGetFull(pack.id);
            if (cached) {
                closeSheet('effects');
                openMobEffectModal({ ...pack, image_data: cached.img, actions: cached.actions });
            } else {
                card.style.opacity = '0.5';
                const { data } = await _supabase.from('effects_library')
                    .select('id, image_data, actions').eq('id', pack.id).single();
                card.style.opacity = '';
                if (data) {
                    efxSetFull(pack.id, data.image_data, data.actions);
                    pack.image_data = data.image_data;
                    closeSheet('effects');
                    openMobEffectModal({ ...pack, ...data });
                }
            }
        };
        grid.appendChild(card);
    });
}

function openMobEffectModal(pack) {
    // action modal places effects not sprites
    document.getElementById('pack-title').innerText = pack.name;
    const grid = document.getElementById('action-selector-list');
    grid.innerHTML = '';

    // default to cover
    const main = createActionOption(pack.image_data, 'Cover');
    main.onclick = () => { addEffectToCanvas(pack.image_data, pack); closeActionModal(); };
    grid.appendChild(main);

    // individual effects
    let actions = pack.actions;
    if (typeof actions === 'string') try { actions = JSON.parse(actions); } catch(e) { actions = {}; }
    Object.entries(actions || {}).forEach(([name, img]) => {
        const opt = createActionOption(img, name);
        opt.onclick = () => { addEffectToCanvas(img, pack); closeActionModal(); };
        grid.appendChild(opt);
    });

    document.getElementById('action-modal').style.display = 'flex';
}

function addEffectToCanvas(src, pack) {
    saveState();
    const cw = canvas.offsetWidth || 300;
    const ch = canvas.offsetHeight || 300;
    const initW = Math.round(cw * 0.4);
    const nl = {type:'img',src,w:initW,h:initW,x:Math.round(cw*0.3),y:Math.round(ch*0.3),rotation:0,flipped:false,effectData:pack,id:Date.now()};
    frames[currentIdx].layers.push(nl);
    activeLayer = nl;
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
        if (!probe.naturalWidth) { render(); return; }
        const cropped = cropSpriteToContent(probe);
        const scale = initW / cropped.w;
        nl.src = cropped.src;
        nl.w = Math.round(cropped.w * scale);
        nl.h = Math.round(cropped.h * scale);
        nl.insertW = nl.w; nl.insertH = nl.h; // canonical size at insertion — resetTransform() restores to this
        render();
    };
    probe.onerror = () => { const fb=new Image(); fb.onload=()=>{ nl.h=Math.round(initW*fb.naturalHeight/fb.naturalWidth); nl.insertW=nl.w; nl.insertH=nl.h; render(); }; fb.src=src; };
    probe.src = src;
}

// handle effect from effectssource
(function checkIncomingEffect() {
    const raw = localStorage.getItem('incoming_effect');
    if (!raw) return;
    localStorage.removeItem('incoming_effect');
    try {
        const effect = JSON.parse(raw);
        if (effect?.image_data) addEffectToCanvas(effect.image_data, effect);
    } catch(e) {}
})();



// inline background library (mobile)
let mobBgTab = 'official';
let mobBgOfficial = null;
let mobBgMine = null;
let mobBgLoaded = false;
let _mobBgLoading = false; // prevent concurrent fetches


// mobile bg: colors + gradients
const MOB_PRESET_COLORS = [
    '#ffffff','#f5f5f0','#cccccc','#888888','#444444','#222222','#111111','#000000',
    '#1a1a2e','#16213e','#0f3460','#533483','#e94560',
    '#ff6b6b','#ff9f43','#feca57','#48dbfb','#0abde3',
    '#1dd1a1','#10ac84','#2ecc71','#3498db','#9b59b6',
    '#e67e22','#e74c3c','#f8c291','#778ca3',
];
const MOB_PRESET_GRADIENTS = [
    { name:'Sunset',      css:'linear-gradient(to bottom right, #f8771f, #eb3349)' },
    { name:'Ocean',       css:'linear-gradient(to bottom, #2193b0, #6dd5ed)' },
    { name:'Forest',      css:'linear-gradient(to bottom right, #134e5e, #71b280)' },
    { name:'Purple Haze', css:'linear-gradient(135deg, #360033, #0b8793)' },
    { name:'Peach',       css:'linear-gradient(to right, #ed4264, #ffedbc)' },
    { name:'Midnight',    css:'linear-gradient(to bottom, #0f0c29, #302b63, #24243e)' },
    { name:'Candy',       css:'linear-gradient(to right, #d53369, #cbad6d)' },
    { name:'Aurora',      css:'linear-gradient(135deg, #00c6ff, #0072ff)' },
    { name:'Fire',        css:'linear-gradient(to top, #f12711, #f5af19)' },
    { name:'Mint',        css:'linear-gradient(to right, #00b09b, #96c93d)' },
    { name:'Rose Gold',   css:'linear-gradient(135deg, #f093fb, #f5576c)' },
    { name:'Night Sky',   css:'linear-gradient(to bottom, #0a0a0a, #1a1a4e, #2d2d8f)' },
    { name:'Lemon',       css:'linear-gradient(to bottom right, #f7ff00, #db36a4)' },
    { name:'Steel',       css:'linear-gradient(to right, #485563, #29323c)' },
    { name:'Violet',      css:'linear-gradient(135deg, #7f00ff, #e100ff)' },
    { name:'Cosmic',      css:'radial-gradient(circle, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
    { name:'Neon',        css:'linear-gradient(135deg, #08f1ff, #ff00c1)' },
    { name:'Lava',        css:'radial-gradient(circle at 50% 120%, #ff4500, #1a0000)' },
    { name:'Fog',         css:'linear-gradient(to bottom, #d7d2cc, #304352)' },
    { name:'Spring',      css:'linear-gradient(to bottom right, #a8ff78, #78ffd6)' },
];

let mobBgMainTab = 'images';

function setMobBgMainTab(tab) {
    mobBgMainTab = tab;
    ['images','colors','gradients'].forEach(t => {
        const btn  = document.getElementById('mob-bg-main-' + t);
        const pane = document.getElementById('mob-bg-pane-' + t);
        if (btn)  {
            const active = t === tab;
            btn.style.borderColor = active ? '#ff7a00' : '#222';
            btn.style.background  = active ? 'rgba(255,122,0,.12)' : '#111';
            btn.style.color       = active ? '#ff7a00' : '#555';
        }
        if (pane) pane.style.display = t === tab ? 'flex' : 'none';
    });
    if (tab === 'colors')    renderMobColors();
    if (tab === 'gradients') renderMobGradients();
    if (tab === 'images')    loadMobBgs();
}

function renderMobColors() {
    const grid = document.getElementById('mob-color-swatches');
    if (!grid) return;
    grid.innerHTML = MOB_PRESET_COLORS.map(c =>
        `<div onclick="applyMobBgColor('${c}')" style="aspect-ratio:1;border-radius:7px;background:${c};cursor:pointer;border:2px solid #1e1e1e;" onmouseover="this.style.borderColor='#ff7a00'" onmouseout="this.style.borderColor='#1e1e1e'"></div>`
    ).join('');
}

function applyMobBgColor(color) {
    saveState();
    frames[currentIdx].background = color;
    frames[currentIdx].bgSettings = { scale:1, rotate:0, x:0, y:0, filter:'none' };
    render();
    closeSheet('bg');
}

function renderMobGradients() {
    const grid = document.getElementById('mob-gradient-grid');
    if (!grid) return;
    grid.innerHTML = MOB_PRESET_GRADIENTS.map(g =>
        `<div onclick="applyMobBgColor('${g.css.replace(/'/g,"\'")}')" style="height:48px;border-radius:10px;background:${g.css};cursor:pointer;border:2px solid #1e1e1e;position:relative;" onmouseover="this.style.borderColor='#ff7a00'" onmouseout="this.style.borderColor='#1e1e1e'"><div style="position:absolute;bottom:4px;left:6px;font-size:9px;font-weight:900;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.8);">${g.name}</div></div>`
    ).join('');
    const update = () => {
        const c1  = document.getElementById('mob-grad-c1')?.value || '#ff7a00';
        const c2  = document.getElementById('mob-grad-c2')?.value || '#9b59b6';
        const dir = document.getElementById('mob-grad-dir')?.value || 'to right';
        const css = dir === 'circle' ? `radial-gradient(circle,${c1},${c2})` : `linear-gradient(${dir},${c1},${c2})`;
        const prev = document.getElementById('mob-grad-preview');
        if (prev) prev.style.background = css;
    };
    ['mob-grad-c1','mob-grad-c2','mob-grad-dir'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = update;
    });
    update();
}

function applyMobCustomGradient() {
    const c1  = document.getElementById('mob-grad-c1')?.value || '#ff7a00';
    const c2  = document.getElementById('mob-grad-c2')?.value || '#9b59b6';
    const dir = document.getElementById('mob-grad-dir')?.value || 'to right';
    const css = dir === 'circle' ? `radial-gradient(circle,${c1},${c2})` : `linear-gradient(${dir},${c1},${c2})`;
    applyMobBgColor(css);
}

function triggerBgCropImport() {
    currentImportType = 'bg_crop';
    document.getElementById('img-input').click();
}

async function loadMobBgs() {
    if (mobBgLoaded && mobBgOfficial !== null) { renderMobBgGrid(); return; }
    if (_mobBgLoading) return;
    _mobBgLoading = true;

    const grid = document.getElementById('mob-bg-grid');
    if (grid) grid.innerHTML = '<div style="color:#555;font-size:12px;padding:16px;grid-column:span 2;text-align:center;">Loading…</div>';

    try {
        // fetch metadata, lazy load images
        const { data: offData, error: offErr } = await _supabase.from('backgrounds_library')
            .select('id, name').eq('is_official', true).order('id', { ascending: false });
        if (offErr) throw offErr;
        mobBgOfficial = offData || [];

        const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
        const handle  = profile.handle;
        if (handle) {
            const { data: mineData } = await _supabase.from('backgrounds_library')
                .select('id, name').eq('uploaded_by', handle).order('id', { ascending: false });
            mobBgMine = mineData || [];
        } else { mobBgMine = []; }

        mobBgLoaded = true;
    } catch(e) {
        console.warn('loadMobBgs error:', e);
        if (grid) {
            grid.innerHTML = '<div style="color:#ff453a;font-size:12px;padding:16px;grid-column:span 2;text-align:center;cursor:pointer;">Failed to load — tap to retry</div>';
            grid.onclick = () => { grid.onclick = null; _mobBgLoading = false; loadMobBgs(); };
        }
        _mobBgLoading = false;
        return;
    }
    _mobBgLoading = false;
    renderMobBgGrid();
}

function setMobBgTab(tab) {
    mobBgTab = tab;
    const offBtn  = document.getElementById('mob-bg-tab-official');
    const mineBtn = document.getElementById('mob-bg-tab-mine');
    const editBtn = document.getElementById('mob-bg-tab-edit');
    const setBtn = (btn, active) => { if (!btn) return; btn.style.borderColor = active?'#ff7a00':'#222'; btn.style.background = active?'rgba(255,122,0,.12)':'#111'; btn.style.color = active?'#ff7a00':'#555'; };
    setBtn(offBtn,  tab === 'official');
    setBtn(mineBtn, tab === 'mine');
    setBtn(editBtn, tab === 'edit');

    const libraryContent = document.getElementById('mob-bg-library-content');
    const uploadButtons   = document.getElementById('mob-bg-upload-buttons');
    const editPane        = document.getElementById('mob-bg-edit-pane');
    const isEdit = tab === 'edit';
    // library: official + mine only
    if (libraryContent) libraryContent.style.display = isEdit ? 'none' : 'flex';
    // upload: mine + edit only
    if (uploadButtons)  uploadButtons.style.display   = (tab === 'official') ? 'none' : 'flex';
    // filter/fx/drag: edit tab only
    if (editPane)        editPane.style.display        = isEdit ? 'flex' : 'none';

    if (isEdit) { syncBgSliders(); return; }
    renderMobBgGrid();
}

function filterMobBgs() { renderMobBgGrid(); }

function renderMobBgGrid() {
    const grid = document.getElementById('mob-bg-grid');
    if (!grid) return;
    const q    = (document.getElementById('mob-bg-search')?.value || '').toLowerCase().trim();
    const list = mobBgTab === 'official' ? (mobBgOfficial || []) : (mobBgMine || []);
    const filtered = q ? list.filter(b => (b.name||'').toLowerCase().includes(q)) : list;
    if (!filtered.length) {
        grid.innerHTML = '<div style="color:#555;font-size:12px;padding:16px;grid-column:span 2;text-align:center;">' + (mobBgTab==='mine'?'No saved backgrounds':'No official backgrounds') + '</div>';
        return;
    }
    grid.innerHTML = '';
    filtered.forEach(bg => {
        const card = document.createElement('div');
        card.className = 'mob-bg-card';
        card.dataset.bgId = bg.id;

        // skeleton
        const skeleton = document.createElement('div');
        skeleton.className = 'bg-skeleton';
        card.appendChild(skeleton);

        const lbl = document.createElement('div');
        lbl.className = 'bg-label';
        lbl.innerText = bg.name || 'Untitled';
        card.appendChild(lbl);

        // check cache
        const cached = bg.image_data || (function(){ try { return sessionStorage.getItem('cc_bg_img_'+bg.id); } catch(e){ return null; } })();
        if (cached) {
            _bgApplyImg(card, cached);
        } else {
            _bgObserver.observe(card);
        }

        card.onclick = async () => {
            if (card._bgFetching) return; // prevent double-tap during fetch
            let src = card._imgSrc || bg.image_data;
            if (!src) {
                // not loaded, fetch it
                card._bgFetching = true;
                card.style.opacity = '0.6';
                try {
                    const { data, error } = await _supabase.from('backgrounds_library')
                        .select('image_data').eq('id', bg.id).single();
                    if (error || !data?.image_data) { card.style.opacity = ''; card._bgFetching = false; return; }
                    src = data.image_data;
                    bg.image_data = src;
                    card._imgSrc = src;
                    try { sessionStorage.setItem('cc_bg_img_' + bg.id, src); } catch(e) {}
                    _bgApplyImg(card, src);
                } catch(e) {
                    card.style.opacity = '';
                    card._bgFetching = false;
                    return;
                }
                card.style.opacity = '';
                card._bgFetching = false;
            }
            closeSheet('bg');
            currentImportType = 'bg';
            showBgImportChoice(src);
        };
        grid.appendChild(card);
    });
}


function filterMobSprites() {
    const q    = document.getElementById('mob-sprite-search').value.toLowerCase().trim();
    const sort = document.getElementById('mob-sprite-sort')?.value || 'newest';
    let list   = [...(myLibrarySprites || [])];
    if (mobActivePackFilter) list = list.filter(s => s.pack_id === mobActivePackFilter);
    if (q) list = list.filter(s => (s.name || '').toLowerCase().includes(q));
    list = sortSpriteList(list, sort);
    renderMobSpriteGrid(list);
}

// sprite meta cache
function sbGetImg(id) { try { return sessionStorage.getItem('cc_simg_' + id); } catch(e) { return null; } }
function sbSetImg(id, b64) { try { sessionStorage.setItem('cc_simg_' + id, b64); } catch(e) {} }
function sbSaveMetaCache(data) { try { localStorage.setItem('sb-meta-cache', JSON.stringify({ ts: Date.now(), data })); } catch(e) {} }
function sbLoadMetaCache() { try { const c = JSON.parse(localStorage.getItem('sb-meta-cache')); if (c && Date.now() - c.ts < 600000) return c.data; } catch(e) {} return null; }

const SB_FULL_TTL = 30 * 60 * 1000; // 30 minutes
function sbGetFullCache(id) {
    try {
        const raw = localStorage.getItem('sb-full-' + id);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (Date.now() - (p.ts || 0) > SB_FULL_TTL) { localStorage.removeItem('sb-full-' + id); return null; }
        return p;
    } catch(e) { return null; }
}
function sbSetFullCache(id, imageData, actions, defaultScale) {
    try { localStorage.setItem('sb-full-' + id, JSON.stringify({ img: imageData, actions: actions || {}, default_scale: defaultScale || null, ts: Date.now() })); } catch(e) {}
}

async function sbFetchFull(id) {
    // cache hit, no network
    const fullCached = sbGetFullCache(id);
    if (fullCached) return { image_data: fullCached.img, actions: fullCached.actions, default_scale: fullCached.default_scale || null };

    const { data } = await _supabase.from('sprites_library').select('*').eq('id', id).single();
    if (data?.image_data) sbSetFullCache(id, data.image_data, data.actions || {}, data.default_scale);
    return data;
}

// library / action modals
async function openLibrary() {
    const grid = document.getElementById('library-grid');
    document.getElementById('library-modal').style.display = 'flex';
    const meta = sidebarSprites || sbLoadMetaCache();
    if (meta?.length) { renderLibraryGrid(grid, meta); return; }
    grid.innerHTML = "<p style='color:white;font-size:12px;'>Loading...</p>";
    const { data } = await _supabase.from('sprites_library').select('id, name, image_data, tags, creator, created_at').order('created_at', { ascending: false });
}
function renderLibraryGrid(grid, sprites) {
    grid.innerHTML = '';
    sprites.forEach(pack => {
        const div = document.createElement('div');
        div.className = 'action-option';
        const cachedSrc = sbGetImg ? sbGetImg(pack.id) : null;
        if (cachedSrc) {
            div.innerHTML = `<img src="${cachedSrc}" loading="lazy" style="width:100%;aspect-ratio:1;border-radius:6px;"><strong>${pack.name}</strong>`;
            // cache image
            
        } else {
            div.innerHTML = `<div style="width:100%;aspect-ratio:1;background:#1a1a1a;border-radius:6px;"></div><strong>${pack.name}</strong>`;
            // fallback lazy load
            if (!pack.image_data) {
                const observer = new IntersectionObserver(entries => {
                    if (!entries[0].isIntersecting) return;
                    observer.disconnect();
                    sbFetchFull(pack.id).then(full => {
                        if (!full || !full.image_data) return;
                        const img = div.querySelector('div');
                        if (img) { const el = document.createElement('img'); el.src = full.image_data; el.loading = 'lazy'; el.style.cssText = 'width:100%;aspect-ratio:1;border-radius:6px;'; img.replaceWith(el); }
                    });
                }, { root: grid });
                observer.observe(div);
            }
        }
        grid.appendChild(div);
    });
}
function closeLibrary() { document.getElementById('library-modal').style.display = 'none'; }
function closeActionModal() { document.getElementById('action-modal').style.display = 'none'; }
function openActionModal(pack, isEditing = false) {
    document.getElementById('pack-title').innerText = pack.name;
    const grid = document.getElementById('action-selector-list');
    grid.innerHTML = '';
    // highlight current action when editing
    const lastUsedSrc = (isEditing && activeLayer) ? activeLayer.src : null;
    const main = createActionOption(pack.image_data, 'Default', lastUsedSrc === pack.image_data);
    main.onclick = () => handleActionSelect(pack.image_data, pack, isEditing);
    grid.appendChild(main);
    let actions = pack.actions;
    if (typeof actions === 'string') try { actions = JSON.parse(actions); } catch(e) { actions = {}; }
    const items = Array.isArray(actions) ? actions.map((img, i) => [`Action ${i+1}`, img]) : Object.entries(actions || {});
    items.forEach(([name, img]) => {
        const opt = createActionOption(img, name, lastUsedSrc === img);
        opt.onclick = () => handleActionSelect(img, pack, isEditing);
        grid.appendChild(opt);
    });
    document.getElementById('action-modal').style.display = 'flex';
}
function createActionOption(src, name, isLastUsed = false) {
    const div = document.createElement('div');
    div.className = 'action-option';
    const safeStyle = isLastUsed ? 'border:2px solid rgba(255,122,0,0.55);background:rgba(255,122,0,0.09);border-radius:12px;position:relative;' : '';
    if (safeStyle) div.style.cssText = safeStyle;
    const imgEl = src ? `<img src="${src}" crossorigin="anonymous" loading="lazy" onerror="this.parentNode.querySelector('img') && (this.style.display='none')">` 
                      : `<div style="width:80px;height:80px;background:#1a1a1a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#333;font-size:24px;">?</div>`;
    const dotEl = isLastUsed ? `<div style="position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:#ff7a00;opacity:0.85;pointer-events:none;"></div>` : '';
    div.innerHTML = `${imgEl}<strong>${name}</strong>${dotEl}`;
    return div;
}
function handleActionSelect(img, pack, isEditing) {
    if (isEditing && activeLayer) {
        saveState();
        const layer = activeLayer;
        const isChar = !!(layer.charHeight || layer.packData);

        const probeNew = new Image();
        probeNew.crossOrigin = 'anonymous';
        probeNew.onload = () => {
            if (!probeNew.naturalWidth) { closeActionModal(); render(); return; }
            const croppedNew = cropSpriteToContent(probeNew);

            // anchor bottom-center so feet stay grounded — pure left-anchor let wide poses creep, causing sprites to land on top of each other's box after a pose swap
            const oldW       = layer.w != null ? layer.w : layer.h;
            const oldH       = layer.h != null ? layer.h : layer.w;
            const oldBottom  = Math.round(layer.y + oldH);
            const oldCenterX = Math.round(layer.x + oldW / 2);

            const corsBlockedNew = (croppedNew.src === probeNew.src) && (croppedNew.w === probeNew.naturalWidth) && (croppedNew.h === probeNew.naturalHeight);

            const finish = (newW, newH) => {
                layer.src = croppedNew.src;
                layer.w = newW;
                layer.h = newH;
                layer.x = Math.round(oldCenterX - newW / 2);
                layer.y = Math.round(oldBottom - newH);
                closeActionModal();
                render();
            };

            if (isChar) {
                if (!layer.charHeight) layer.charHeight = oldH; // backfill for legacy layers

                if (layer._rawBasis || (corsBlockedNew && layer.charScale)) {
                    // untrimmed basis: size from the pose's own pixels * the layer's scale so every pose stays consistent
                    layer._cropBlocked = true;
                    const rawW = Math.round(probeNew.naturalWidth  * layer.charScale);
                    const rawH = Math.round(probeNew.naturalHeight * layer.charScale);
                    layer.charHeight = rawH;
                    layer.src = probeNew.src;
                    layer.w = rawW; layer.h = rawH;
                    layer.x = Math.round(oldCenterX - rawW / 2);
                    layer.y = Math.round(oldBottom - rawH);
                    closeActionModal(); render();
                    return;
                }

                if (corsBlockedNew) {
                    // can't read pose pixels for CORS reasons so no trimming, but naturalWidth/Height still work regardless. reusing the old box's w/h only ever matched the old pose's shape, new poses rarely match it, so we derive newH from this pose's own ratio instead, same as the non-char branch already does. charHeight/charScale stay untouched since that data's still padding-corrupted
                    layer._cropBlocked = true;
                    const rawAspect = probeNew.naturalWidth / probeNew.naturalHeight;
                    const newH = Math.round(oldW / rawAspect);
                    finish(oldW, newH);
                    return;
                }

                // charHeight = canonical reference height set on first placement; data-url can't be measured (cors), falls back to oldH
                layer._cropBlocked = false; // src is properly trimmed again, safety-net auto-fit is trustworthy

                // scales each pose by its own display-px-per-content-px ratio instead of forcing every pose into one fixed height, that was the actual bug — a taller/shorter pose (raised weapon, crouch, etc) was getting scaled to fit a box that never matched, making the character randomly look bigger or smaller
                if (!layer.charScale) layer.charScale = layer.charHeight / croppedNew.h; // legacy layer without one yet — establish it from this pose
                {
                    const scale = layer.charScale;
                    const newW  = Math.round(croppedNew.w * scale);
                    const newH  = Math.round(croppedNew.h * scale);
                    layer.charHeight = newH; // keep in sync for other code paths that still read charHeight
                    finish(newW, newH);
                }
            } else {
                layer._cropBlocked = false;
                // scale from current width proportionally
                const scale = oldW / croppedNew.w;
                finish(oldW, Math.round(croppedNew.h * scale));
            }
        };
        probeNew.onerror = () => { closeActionModal(); render(); };
        probeNew.src = img;
    } else {
        addSpriteToCanvas(img, pack);
        closeActionModal(); render();
    }
}
// trim transparent padding from a sprite image
function trimTransparentBounds(img) {
    const ow = img.naturalWidth, oh = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = ow; c.height = oh;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let data;
    try { data = ctx.getImageData(0, 0, ow, oh).data; }
    catch(e) { return { offsetX: 0, offsetY: 0, trimW: ow, trimH: oh }; }
    let minX = ow, minY = oh, maxX = 0, maxY = 0;
    for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
            if (data[(y * ow + x) * 4 + 3] > 8) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
    }
    if (minX > maxX || minY > maxY) return { offsetX: 0, offsetY: 0, trimW: ow, trimH: oh };
    return { offsetX: minX, offsetY: minY, trimW: maxX - minX + 1, trimH: maxY - minY + 1 };
}

function cropSpriteToContent(img) {
    const ow = img.naturalWidth, oh = img.naturalHeight;
    try {
        const c = document.createElement('canvas');
        c.width = ow; c.height = oh;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, ow, oh).data;
        let minX = ow, minY = oh, maxX = 0, maxY = 0;
        for (let y = 0; y < oh; y++) {
            for (let x = 0; x < ow; x++) {
                if (data[(y * ow + x) * 4 + 3] > 8) {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
        }
        if (minX > maxX || minY > maxY) return { src: img.src, w: ow, h: oh, origW: ow, origH: oh };
        const tw = maxX - minX + 1, th = maxY - minY + 1;
        if (minX <= 4 && minY <= 4 && ow - maxX <= 5 && oh - maxY <= 5) return { src: img.src, w: ow, h: oh, origW: ow, origH: oh };
        const out = document.createElement('canvas');
        out.width = tw; out.height = th;
        out.getContext('2d').drawImage(img, minX, minY, tw, th, 0, 0, tw, th);
        return { src: out.toDataURL('image/png'), w: tw, h: th, origW: ow, origH: oh };
    } catch(e) {
        return { src: img.src, w: ow, h: oh, origW: ow, origH: oh };
    }
}

function addSpriteToCanvas(src, pack) {
    saveState();
    const cw = canvas.offsetWidth || 300;
    const ch = canvas.offsetHeight || 300;
    const isCharacter = !!(pack && pack.id); // library/gallery sprites have an id — effects don't

    // default char height: 60% of canvas, default_scale = character height on db
    // default_scale is stored in absolute px, so scale it to this device's canvas, then never let a sprite exceed the canvas
    let targetH = (pack && pack.default_scale) ? Math.round(pack.default_scale * ccRefScale(cw, ch)) : Math.round(ch * 0.6);
    targetH = Math.max(20, Math.min(targetH, Math.round(ch * 0.9)));

    // nl built but not pushed/set as activeLayer until probe.onload resolves the true ar, so the outline never renders at a placeholder square size
    const nl = { type: 'img', src, w: targetH, h: targetH, x: Math.round(cw * 0.3), y: Math.round(ch * 0.2), rotation: 0, flipped: false, packData: pack, id: Date.now() };

    function _commit() {
        frames[currentIdx].layers.push(nl);
        activeLayer = nl;
        render();
    }

    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
        if (!probe.naturalWidth || !probe.naturalHeight) { _commit(); return; }
        const cropped = cropSpriteToContent(probe);

        if (isCharacter) {
            // character sprite: anchor to height, width = crop ar * target height
            const aspectRatio = cropped.w / cropped.h;
            nl.h = targetH;
            nl.w = Math.round(targetH * aspectRatio);
            nl.src = cropped.src;
            // store canonical height for action switches
            nl.charHeight = targetH;
            // same idea, canonical scale ratio set once from this pose, future swaps reuse it on whatever the new pose's real content is instead of forcing every pose to one fixed height
            nl.charScale = targetH / cropped.h;
        } else {
            // effect / plain image: keep original width-based sizing
            const initW = Math.round(cw * 0.4);
            const scale = initW / cropped.w;
            nl.src = cropped.src;
            nl.w = Math.round(cropped.w * scale);
            nl.h = Math.round(cropped.h * scale);
        }
        // canonical size at insertion — resetTransform() restores to this instead of a placeholder
        nl.insertW = nl.w; nl.insertH = nl.h;
        // bottom center
        nl.x = Math.round((cw - nl.w) / 2);
        nl.y = Math.round(ch - nl.h);
        _commit();
    };
    probe.onerror = () => {
        const fallback = new Image();
        fallback.onload = () => {
            if (fallback.naturalWidth && fallback.naturalHeight) {
                if (isCharacter) {
                    nl.h = targetH;
                    nl.w = Math.round(targetH * fallback.naturalWidth / fallback.naturalHeight);
                    // no trim possible here, so measure every later pose the same untrimmed way
                    nl.charHeight = targetH;
                    nl.charScale = targetH / fallback.naturalHeight;
                    nl._rawBasis = true;
                    nl.insertW = nl.w; nl.insertH = nl.h;
                } else {
                    nl.h = Math.round(nl.w * fallback.naturalHeight / fallback.naturalWidth);
                }
            }
            _commit();
        };
        fallback.onerror = () => { _commit(); }; // worst-case: add with placeholder dims
        fallback.src = src;
    };
    probe.src = src;
}

// text / bubbles
function addText(type) {
    saveState();
    const cw = canvas.offsetWidth || 300, ch = canvas.offsetHeight || 300;
    const rs = ccRefScale(cw, ch);
    const nl = { type: 'text', content: 'Text', fontSize: Math.round(24 * rs), fontFamily: mobLastFont("'Inter', sans-serif"), color: '#000', x: Math.round(cw*0.2), y: Math.round(ch*0.3), w: Math.round(160 * rs), rotation: 0, id: Date.now() };
    frames[currentIdx].layers.push(nl);
    activeLayer = nl;
    render();
}
function addSubtitle() {
    saveState();
    const cw = canvas.offsetWidth || 300, ch = canvas.offsetHeight || 300;
    const nl = { type: 'subtitle', content: 'Subtitle', fontSize: Math.round(16 * ccRefScale(cw, ch)), x: 0, y: Math.round(ch * 0.85), w: cw, rotation: 0, id: Date.now() };
    frames[currentIdx].layers.push(nl);
    activeLayer = nl;
    render();
}

// panels are just comic-panel shapes (fill+border), new ones start big and get sent to the back of the stack so sprites/text sit on top like actual page layout
function addPanel() {
    saveState();
    const cw = canvas.offsetWidth || 300, ch = canvas.offsetHeight || 300;
    const pad = Math.round(Math.min(cw, ch) * 0.04);
    const nl = {
        type: 'panel', id: Date.now(),
        x: pad, y: pad, w: Math.max(40, cw - pad * 2), h: Math.max(40, ch - pad * 2),
        fill: '#ffffff', panelBorderColor: '#000000', borderWidth: 4, radius: 0
    };
    frames[currentIdx].layers.unshift(nl); // back of stack — behind existing content
    activeLayer = nl;
    render();
    renderMobLayers();
}

// PANEL CONTAINMENT — panels act like little frames inside the frame, anything overlapping one gets visually clipped to it, same idea as the outer frame clipping everything to its own edges. real x/y/w/h never change, just what's visible, so dragging across a panel boundary still works fine. stuff with zero overlap (a caption in the gutter, say) just stays fully visible
function getPanelsInFrame() {
    const f = frames[currentIdx];
    return f ? f.layers.filter(l => l.type === 'panel') : [];
}
// which panel (if any) does this box overlap the most? null if it touches no panel at all
function findContainingPanel(x, y, w, h) {
    const panels = getPanelsInFrame();
    if (!panels.length) return null;
    let best = null, bestArea = 0;
    panels.forEach(p => {
        const ox = Math.max(0, Math.min(x + w, p.x + p.w) - Math.max(x, p.x));
        const oy = Math.max(0, Math.min(y + h, p.y + p.h) - Math.max(y, p.y));
        const area = ox * oy;
        if (area > bestArea) { bestArea = area; best = p; }
    });
    return best;
}
// sets/clears a clip-path on a layer so it's cut to whatever panel it overlaps most. el needs to already be attached to canvas so offsetWidth/Height are accurate for auto-height layers. safe to call on every render, nothing persisted
function applyPanelClip(layer, el) {
    if (!layer || !el || layer.type === 'panel') return;
    const lw = el.offsetWidth  || layer.w || 100;
    const lh = el.offsetHeight || (layer.h != null ? layer.h : lw);
    const panel = findContainingPanel(layer.x || 0, layer.y || 0, lw, lh);
    if (!panel) { el.style.clipPath = ''; return; }
    // clips to the panel's interior (inset by its border width) so the panel's own border art stays visible on top without any dom stacking hacks
    const bw = panel.borderWidth != null ? panel.borderWidth : 4;
    const ix = panel.x + bw, iy = panel.y + bw;
    const iw = Math.max(0, panel.w - bw * 2), ih = Math.max(0, panel.h - bw * 2);
    const lx = layer.x || 0, ly = layer.y || 0;
    const top    = Math.max(0, iy - ly);
    const left   = Math.max(0, ix - lx);
    const bottom = Math.max(0, (ly + lh) - (iy + ih));
    const right  = Math.max(0, (lx + lw) - (ix + iw));
    el.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

// PANEL SLICE TOOL — cuts a panel into two along a line you drag in with a scissors handle, can rerun on either half to keep subdividing
let _panelSliceLayer = null;   // the panel rn being sliced, or null when inactive
let _panelSliceAxis  = 'v';    // 'v' = vertical cut line (drag left/right), 'h' = horizontal (drag up/down)
let _panelSliceFrac  = 0.5;    // 0..1 position of the cut along the panel

function startPanelSlice() {
    if (!activeLayer || activeLayer.type !== 'panel') return;
    // close any open popover / quick-action bar — the slice toolbar takes over
    const pop = document.getElementById('sqa-popover');
    if (pop) { pop.classList.remove('show'); pop.dataset.kind = ''; }
    _panelSliceLayer = activeLayer;
    _panelSliceAxis = 'v';
    _panelSliceFrac = 0.5;
    updateSpriteQuickBar(activeLayer); // hides the normal quick-action bar while slicing
    renderPanelSliceOverlay();
}
function cancelPanelSlice() {
    _panelSliceLayer = null;
    document.querySelectorAll('.panel-slice-line, .panel-slice-handle, #panel-slice-bar').forEach(n => n.remove());
    updateSpriteQuickBar(activeLayer);
}
function togglePanelSliceAxis() {
    if (!_panelSliceLayer) return;
    _panelSliceAxis = _panelSliceAxis === 'v' ? 'h' : 'v';
    _panelSliceFrac = 0.5;
    updatePanelSliceOverlayPosition();
}
function commitPanelSlice() {
    if (!_panelSliceLayer) return;
    const p = _panelSliceLayer;
    const idx = frames[currentIdx].layers.indexOf(p);
    if (idx === -1) { cancelPanelSlice(); return; }
    saveState();
    const gutter = 6; // small comic-style gap between the two new panels
    let left, right;
    if (_panelSliceAxis === 'v') {
        const cutX = p.w * _panelSliceFrac;
        const leftW  = Math.max(24, Math.round(cutX - gutter / 2));
        const rightW = Math.max(24, Math.round(p.w - cutX - gutter / 2));
        left  = { ...p, id: Date.now(),     w: leftW };
        right = { ...p, id: Date.now() + 1, x: Math.round(p.x + cutX + gutter / 2), w: rightW };
    } else {
        const cutY = p.h * _panelSliceFrac;
        const topH = Math.max(24, Math.round(cutY - gutter / 2));
        const botH = Math.max(24, Math.round(p.h - cutY - gutter / 2));
        left  = { ...p, id: Date.now(),     h: topH };
        right = { ...p, id: Date.now() + 1, y: Math.round(p.y + cutY + gutter / 2), h: botH };
    }
    frames[currentIdx].layers.splice(idx, 1, left, right);
    activeLayer = left;
    _panelSliceLayer = null;
    document.querySelectorAll('.panel-slice-line, .panel-slice-handle, #panel-slice-bar').forEach(n => n.remove());
    render();
    renderMobLayers();
}
// (re)builds the dashed cut-line + scissors handle + confirm/cancel toolbar over the panel
function renderPanelSliceOverlay() {
    document.querySelectorAll('.panel-slice-line, .panel-slice-handle, #panel-slice-bar').forEach(n => n.remove());
    const p = _panelSliceLayer;
    if (!p) return;
    if (!frames[currentIdx].layers.includes(p)) { _panelSliceLayer = null; return; } // panel gone (deleted / frame switched)

    const line = document.createElement('div');
    line.id = 'panel-slice-line';
    line.className = 'panel-slice-line';
    canvas.appendChild(line);

    const handle = document.createElement('div');
    handle.id = 'panel-slice-handle';
    handle.className = 'panel-slice-handle';
    handle.innerHTML = '<i class="fi fi-rs-scissors"></i>';
    attachSliceHandleDrag(handle);
    canvas.appendChild(handle);

    const bar = document.createElement('div');
    bar.id = 'panel-slice-bar';
    bar.innerHTML = `
        <button class="sqa-btn" onclick="event.stopPropagation();togglePanelSliceAxis()" title="Switch cut direction">⇄</button>
        <div class="sqa-sep"></div>
        <button class="sqa-btn sqa-danger" onclick="event.stopPropagation();cancelPanelSlice()" title="Cancel">✕</button>
        <button class="sqa-btn sqa-accent" onclick="event.stopPropagation();commitPanelSlice()" title="Confirm cut">✓</button>
    `;
    canvas.appendChild(bar);

    updatePanelSliceOverlayPosition();
}
// cheap direct-style reposition of the overlay pieces, used during drag + live panel resize
function updatePanelSliceOverlayPosition() {
    const p = _panelSliceLayer;
    if (!p) return;
    const line = document.getElementById('panel-slice-line');
    const handle = document.getElementById('panel-slice-handle');
    const bar = document.getElementById('panel-slice-bar');
    if (!line || !handle) return;
    if (_panelSliceAxis === 'v') {
        const x = p.x + p.w * _panelSliceFrac;
        line.style.cssText = `position:absolute;left:${x}px;top:${p.y}px;width:0;height:${p.h}px;border-left:3px dashed var(--accent);z-index:240;pointer-events:none;`;
        handle.style.left = x + 'px';
        handle.style.top  = (p.y + p.h / 2) + 'px';
    } else {
        const y = p.y + p.h * _panelSliceFrac;
        line.style.cssText = `position:absolute;left:${p.x}px;top:${y}px;width:${p.w}px;height:0;border-top:3px dashed var(--accent);z-index:240;pointer-events:none;`;
        handle.style.left = (p.x + p.w / 2) + 'px';
        handle.style.top  = y + 'px';
    }
    if (bar) {
        bar.style.left = (p.x + p.w / 2) + 'px';
        bar.style.top  = (p.y + p.h + 14) + 'px';
    }
}
// drag the scissors handle along the active axis to reposition the cut
function attachSliceHandleDrag(handle) {
    handle.addEventListener('touchstart', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const _cRect = canvas.getBoundingClientRect();
        const _cScale = _cRect.width / (canvas.offsetWidth || 1);
        const onMove = (mv) => {
            if (mv.touches.length > 1) return;
            mv.preventDefault(); mv.stopPropagation();
            const p = _panelSliceLayer;
            if (!p) return;
            const t = mv.touches[0];
            const localX = (t.clientX - _cRect.left) / _cScale;
            const localY = (t.clientY - _cRect.top) / _cScale;
            if (_panelSliceAxis === 'v') {
                _panelSliceFrac = Math.max(0.08, Math.min(0.92, (localX - p.x) / p.w));
            } else {
                _panelSliceFrac = Math.max(0.08, Math.min(0.92, (localY - p.y) / p.h));
            }
            updatePanelSliceOverlayPosition();
        };
        const onUp = () => {
            handle.removeEventListener('touchmove', onMove);
            handle.removeEventListener('touchend', onUp);
        };
        handle.addEventListener('touchmove', onMove, { passive: false });
        handle.addEventListener('touchend', onUp, { once: true });
    }, { passive: false });
    // desktop mouse support
    handle.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const _cRect = canvas.getBoundingClientRect();
        const _cScale = _cRect.width / (canvas.offsetWidth || 1);
        const onMove = (mv) => {
            const p = _panelSliceLayer;
            if (!p) return;
            const localX = (mv.clientX - _cRect.left) / _cScale;
            const localY = (mv.clientY - _cRect.top) / _cScale;
            if (_panelSliceAxis === 'v') {
                _panelSliceFrac = Math.max(0.08, Math.min(0.92, (localX - p.x) / p.w));
            } else {
                _panelSliceFrac = Math.max(0.08, Math.min(0.92, (localY - p.y) / p.h));
            }
            updatePanelSliceOverlayPosition();
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

// bubble picker
const BUBBLE_STYLES = [
    { id: 'round',    label: 'Classic',   ico: '💬' },
    { id: 'chat',     label: 'Modern',    ico: '🗨'  },
    { id: 'rect',     label: 'Box',       ico: '⬜'  },
    { id: 'whisper',  label: 'Whisper',   ico: '🤫'  },
    { id: 'shout',    label: 'Shout',     ico: '📢'  },
    { id: 'spiky',    label: 'Burst',     ico: '💥'  },
    { id: 'electric', label: 'Mangabox',  ico: '⚡'  },
    { id: 'narrator', label: 'Narrator',  ico: '📋'  },
    { id: 'cloud',    label: 'Cloud',     ico: '💭'  },
];
let selectedBubbleStyle = 'round';
let currentBubbleMode = 'speech';
let mobBubbleTailFlip = false;
let _mobBubbleWidthFrac = 0.5; // default bubble width (fraction of canvas)

function setMobBubbleWidth(frac) {
    _mobBubbleWidthFrac = frac;
    document.querySelectorAll('.mob-bpick-w-btn').forEach(btn => {
        const active = parseFloat(btn.dataset.bw) === frac;
        btn.style.background  = active ? 'rgba(255,122,0,.18)' : '#111';
        btn.style.borderColor = active ? 'var(--accent)' : '#333';
        btn.style.color       = active ? 'var(--accent)' : '#666';
    });
}

function openBubblePicker(mode) {
    currentBubbleMode = mode;
    selectedBubbleStyle = 'round';
    mobBubbleTailFlip = false;
    document.getElementById('bubble-picker-title').innerText = 'Add Bubble';
    document.getElementById('bubble-picker-text').value = '';
    // reset tail buttons
    const tL = document.getElementById('mob-bpick-tail-left');
    const tR = document.getElementById('mob-bpick-tail-right');
    if (tL) { tL.style.background='rgba(255,122,0,.18)'; tL.style.borderColor='var(--accent)'; tL.style.color='var(--accent)'; }
    if (tR) { tR.style.background='#111'; tR.style.borderColor='#333'; tR.style.color='#666'; }
    // reset width to medium
    _mobBubbleWidthFrac = 0.5;
    setMobBubbleWidth(0.5);
    const grid = document.getElementById('bubble-style-grid');
    grid.innerHTML = '';
    BUBBLE_STYLES.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'bubble-preview-btn' + (s.id === selectedBubbleStyle ? ' selected' : '');
        const thumb = document.createElement('div');
        thumb.className = 'bubble-preview-thumb';
        btn.appendChild(thumb);
        mountBubbleStyleThumb(thumb, s.id, s.label);
        btn.onclick = () => {
            selectedBubbleStyle = s.id;
            grid.querySelectorAll('.bubble-preview-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            // show/hide tail direction
            const hasTail = !['spiky','shout','electric','narrator','cloud'].includes(s.id);
            const tailRow = document.getElementById('mob-bubble-tail-row');
            if (tailRow) tailRow.style.display = hasTail ? 'flex' : 'none';
        };
        grid.appendChild(btn);
    });
    document.getElementById('bubble-picker-modal').style.display = 'flex';
}

// scaled-down real bubble preview so the picker shows exactly what you get
function mountBubbleStyleThumb(container, styleId, label) {
    container.innerHTML = '';
    const dummy = { type: styleId === 'cloud' ? 'thinking' : 'bubble', bubbleStyle: styleId, content: label || '', fontSize: 12 };
    const bub = buildLayerPreviewElement(dummy);
    bub.style.pointerEvents = 'none';
    // plain box auto-sizes to label width then scales down as one piece, so long labels like "Mangabox" stay on one line. Burst/Shout keep fixed width since their clip-path can't stretch
    bub.style.whiteSpace = 'nowrap';
    const fill = bub.querySelector('.bubble-clip-fill');
    if (fill) {
        fill.style.whiteSpace = 'nowrap';
    } else {
        bub.style.width = 'max-content';
    }
    container.appendChild(bub);
    requestAnimationFrame(() => {
        if (!container.isConnected) return;
        const availW = container.clientWidth - 6, availH = container.clientHeight - 6;
        const rect = bub.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && availW > 0 && availH > 0) {
            const scale = Math.min(1, availW / rect.width, availH / rect.height);
            bub.style.transform = `scale(${scale})`;
        }
    });
}
function closeBubblePicker() { document.getElementById('bubble-picker-modal').style.display = 'none'; }
function confirmBubblePicker() {
    const text = document.getElementById('bubble-picker-text').value || 'Hello!';
    saveState();
    const cw = canvas.offsetWidth || 300, ch = canvas.offsetHeight || 300;
    const bubbleType = selectedBubbleStyle === 'cloud' ? 'thinking' : 'bubble';
    const nl = { type: bubbleType, content: text, fontSize: 18, fontFamily: mobLastFont("'Bangers', cursive"), bubbleStyle: selectedBubbleStyle, tailFlip: mobBubbleTailFlip, x: Math.round(cw*0.15), y: Math.round(ch*0.1), w: Math.round(cw * _mobBubbleWidthFrac), rotation: 0, id: Date.now() };
    mobBubbleTailFlip = false;
    frames[currentIdx].layers.push(nl);
    activeLayer = nl;
    closeBubblePicker();
    render();
}
function renderBubbleMiniGrid() {
    const grid = document.getElementById('bubble-style-mini-grid');
    if (!grid) return;
    grid.innerHTML = '';
    BUBBLE_STYLES.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'bubble-mini-btn' + (activeLayer && (activeLayer.bubbleStyle || 'round') === s.id ? ' selected' : '');
        const thumb = document.createElement('div');
        thumb.className = 'bubble-preview-thumb';
        btn.appendChild(thumb);
        mountBubbleStyleThumb(thumb, s.id, s.label);
        btn.onclick = () => { if (activeLayer) { saveState(); activeLayer.bubbleStyle = s.id; render(); renderBubbleMiniGrid(); renderTransformPreview(); } };
        grid.appendChild(btn);
    });
}

// tail mirror on flip: top/bottom edges use horizontal flip to slide the tail, vertical flip to swap edge; left/right edges are the reverse. shape also mirrored via bubbleTailHTML
function mobQuickFlipTail() { // horizontal (◀▶)
    if (!activeLayer) return;
    saveState();
    const bStyle = activeLayer.bubbleStyle || 'round';
    const edge = getBubbleTailEdge(activeLayer);
    const pos = getBubbleTailPos(activeLayer, bStyle);
    if (edge === 'left' || edge === 'right') {
        activeLayer.tailEdge = (edge === 'left') ? 'right' : 'left';
        activeLayer.tailPos = pos;
    } else {
        activeLayer.tailEdge = edge;
        activeLayer.tailPos = 100 - pos;
    }
    delete activeLayer.tailFlip; // superseded by the edge/position pair
    render();
    renderTransformPreview();
}
function mobQuickFlipTailV() { // vertical (▲▼)
    if (!activeLayer) return;
    saveState();
    const bStyle = activeLayer.bubbleStyle || 'round';
    const edge = getBubbleTailEdge(activeLayer);
    const pos = getBubbleTailPos(activeLayer, bStyle);
    if (edge === 'top' || edge === 'bottom') {
        activeLayer.tailEdge = (edge === 'bottom') ? 'top' : 'bottom';
        activeLayer.tailPos = pos;
    } else {
        activeLayer.tailEdge = edge;
        activeLayer.tailPos = 100 - pos;
    }
    delete activeLayer.tailFlip;
    render();
    renderTransformPreview();
}

// background
function openBackgroundSource() {
    if (canvasRatio) { lsSet('cc-bg-ratio-filter', JSON.stringify(canvasRatio)); lsSet('cc-active-ratio', JSON.stringify(canvasRatio)); }
    lsSet('cc-pending-frames', JSON.stringify({ frames, currentIdx }));
    location.href = 'backgroundsource.html';
}
function openBgAdjustBar() {
    syncBgSliders();
    document.getElementById('bg-adjust-bar').style.display = 'block';
}
function closeBgAdjustBar() {
    document.getElementById('bg-adjust-bar').style.display = 'none';
}
function updateMobBg() {
    const scale = document.getElementById('mob-bg-scale').value;
    const rotate = document.getElementById('mob-bg-rotate').value;
    const x = document.getElementById('mob-bg-x').value;
    const y = document.getElementById('mob-bg-y').value;
    document.getElementById('mob-bg-scale-v').innerText = parseFloat(scale).toFixed(1) + 'x';
    document.getElementById('mob-bg-rotate-v').innerText = rotate + '°';
    document.getElementById('mob-bg-x-v').innerText = x;
    document.getElementById('mob-bg-y-v').innerText = y;
    frames[currentIdx].bgSettings = { ...frames[currentIdx].bgSettings, scale: parseFloat(scale), rotate: parseInt(rotate), x: parseInt(x), y: parseInt(y) };
    render();
}
function syncBgSliders() {
    const s = frames[currentIdx].bgSettings || {};
    const scaleVal = typeof s.scale === 'number' ? s.scale : 1;
    document.getElementById('mob-bg-scale').value = scaleVal;
    document.getElementById('mob-bg-rotate').value = s.rotate ?? 0;
    document.getElementById('mob-bg-x').value = s.x ?? 0;
    document.getElementById('mob-bg-y').value = s.y ?? 0;
    document.getElementById('mob-bg-scale-v').innerText = scaleVal.toFixed(1) + 'x';
    document.getElementById('mob-bg-rotate-v').innerText = (s.rotate ?? 0) + '°';
    document.getElementById('mob-bg-x-v').innerText = (s.x ?? 0);
    document.getElementById('mob-bg-y-v').innerText = (s.y ?? 0);
    // filters
    const filterRow = document.getElementById('mob-bg-filter-row');
    const filterSec = document.getElementById('mob-bg-filter-section');
    const filters = ['none','grayscale(100%)','sepia(100%)','contrast(150%)','brightness(130%)','hue-rotate(90deg)','invert(100%)'];
    const filterLabels = ['None','B&W','Sepia','High Contrast','Bright','Color Shift','Invert'];
    filterRow.innerHTML = '';
    filters.forEach((f, i) => {
        const chip = document.createElement('button');
        chip.className = 'filter-chip' + (s.filter === f || (i === 0 && !s.filter) ? ' active' : '');
        chip.innerText = filterLabels[i];
        chip.onclick = () => { filterRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); frames[currentIdx].bgSettings = { ...frames[currentIdx].bgSettings, filter: f }; render(); renderBgEditPreview(); };
        filterRow.appendChild(chip);
    });
    if (filterSec) filterSec.style.display = filterRow.children.length ? 'block' : 'none';
    renderBgEditPreview();
}
function resetBgSettings() {
    saveState();
    // reset transform, keep bg image
    frames[currentIdx].bgSettings = { scale: 1, rotate: 0, x: 0, y: 0, filter: 'none' };
    syncBgSliders();
    document.querySelectorAll('#mob-bg-filter-row .filter-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    render();
    renderBgEditPreview();
}

// live bg edit preview, mirrors canvas compositing
function renderBgEditPreview() {
    const box = document.getElementById('mob-bg-edit-preview');
    if (!box) return;
    box.innerHTML = '';
    const f = frames[currentIdx];
    if (!f) return;
    const bg    = f.background || '#ffffff';
    const s     = f.bgSettings || {};
    const bgFx  = f.bgFx || {};
    const isImg = bg.startsWith('http') || bg.startsWith('data:image');

    const filterCSS  = (s.filter && s.filter !== 'none') ? s.filter : '';
    const bgFxCSS     = getSpriteFilterCSS(bgFx);
    const bgFxChipCSS = (bgFx.fxFilter && bgFx.fxFilter !== 'none') ? bgFx.fxFilter : '';
    const combined     = [filterCSS, bgFxCSS, bgFxChipCSS].filter(Boolean).join(' ');
    const hasFxSrc    = !!bgFx._fxSrc;
    const strength    = (bgFx.blurStrength != null) ? bgFx.blurStrength : 100;

    const holder = document.createElement('div');
    holder.style.cssText = 'position:relative;width:100%;aspect-ratio:1/1;max-height:150px;overflow:hidden;border-radius:10px;border:1px solid #222;background:#0a0a0a;';

    // px-based geometry here too (not object-position+scale) so this preview's pan actually matches the real canvas instead of looking stuck, see render()
    const pScale = typeof s.scale === 'number' ? s.scale : 1;
    const pRotate = s.rotate ?? 0;
    const boxSide = 150; // holder is square, max-height:150px caps the render size
    let pNat = isImg ? _bgNatDimCache[bg] : null;
    if (isImg && !pNat) {
        const probe = new Image();
        probe.onload = () => { _bgNatDimCache[bg] = { w: probe.naturalWidth || boxSide, h: probe.naturalHeight || boxSide }; renderBgEditPreview(); };
        probe.src = bg;
        pNat = { w: boxSide, h: boxSide };
    }
    let pGeomCSS = '';
    if (isImg) {
        const imgAR = pNat.w / pNat.h;
        let baseW, baseH;
        if (imgAR > 1) { baseH = boxSide; baseW = baseH * imgAR; } else { baseW = boxSide; baseH = baseW / imgAR; }
        const drawW = baseW * pScale, drawH = baseH * pScale;
        const pXfrac = Math.max(0, Math.min(100, 50 + ((s.x ?? 0) / 2))) / 100;
        const pYfrac = Math.max(0, Math.min(100, 50 + ((s.y ?? 0) / 2))) / 100;
        const pPosX = (boxSide - drawW) * pXfrac, pPosY = (boxSide - drawH) * pYfrac;
        pGeomCSS = `position:absolute;left:${pPosX}px;top:${pPosY}px;width:${drawW}px;height:${drawH}px;transform:rotate(${pRotate}deg);transform-origin:center center;`;
    }

    if (isImg && hasFxSrc && strength < 100) {
        const base = document.createElement('img');
        base.src = bg; base.draggable = false;
        base.style.cssText = pGeomCSS;
        if (bgFx.fxOpacity !== undefined) base.style.opacity = bgFx.fxOpacity / 100;
        const overlay = document.createElement('img');
        overlay.src = bgFx._fxSrc; overlay.draggable = false;
        overlay.style.cssText = `opacity:${strength/100};` + pGeomCSS;
        holder.appendChild(base);
        holder.appendChild(overlay);
    } else if (isImg) {
        const imgEl = document.createElement('img');
        imgEl.src = hasFxSrc ? bgFx._fxSrc : bg; imgEl.draggable = false;
        imgEl.style.cssText = pGeomCSS;
        if (!hasFxSrc && combined) imgEl.style.filter = combined;
        if (bgFx.fxOpacity !== undefined) imgEl.style.opacity = bgFx.fxOpacity / 100;
        holder.appendChild(imgEl);
    } else {
        // gradient or solid
        const swatch = document.createElement('div');
        swatch.style.cssText = `position:absolute;inset:0;background:${bg};`;
        if (combined) swatch.style.filter = combined;
        if (bgFx.fxOpacity !== undefined) swatch.style.opacity = bgFx.fxOpacity / 100;
        holder.appendChild(swatch);
    }
    applyColorFxToDOM(holder, bgFx);
    box.appendChild(holder);
}

// bg drag-to-pan (mobile)
let mobBgDragActive = false;
function toggleMobBgDrag() {
    mobBgDragActive = !mobBgDragActive;
    const overlay = document.getElementById('bg-drag-overlay');
    const btn = document.getElementById('mob-bg-drag-btn');
    overlay.style.display = mobBgDragActive ? 'block' : 'none';
    if (btn) {
        btn.style.background = mobBgDragActive ? 'rgba(0,180,255,0.15)' : '#111';
        btn.style.borderColor = mobBgDragActive ? '#00b4ff' : 'rgba(0,180,255,0.3)';
        btn.innerText = mobBgDragActive ? '✅ Dragging — tap again to stop' : '✋ Drag Canvas to Pan';
    }
    setupMobBgDrag();
}
function setupMobBgDrag() {
    const overlay = document.getElementById('bg-drag-overlay');
    if (!overlay) return;
    let dragging = false, startX = 0, startY = 0, startBgX = 0, startBgY = 0;
    const baseSensitivity = 0.33;
    const currentScale = parseFloat(document.getElementById('mob-bg-scale').value) || 1;
    const SENSITIVITY = baseSensitivity / Math.max(1, currentScale);
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    overlay.ontouchstart = e => {
        dragging = true;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        startBgX = parseInt(document.getElementById('mob-bg-x').value) || 0;
        startBgY = parseInt(document.getElementById('mob-bg-y').value) || 0;
        e.preventDefault(); e.stopPropagation();
    };
    overlay.ontouchmove = e => {
        if (!dragging) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        const newX = clamp(Math.round(startBgX + dx * SENSITIVITY), -100, 100);
        const newY = clamp(Math.round(startBgY + dy * SENSITIVITY), -100, 100);
        document.getElementById('mob-bg-x').value = newX;
        document.getElementById('mob-bg-x-v').innerText = newX;
        document.getElementById('mob-bg-y').value = newY;
        document.getElementById('mob-bg-y-v').innerText = newY;
        if (!frames[currentIdx].bgSettings) frames[currentIdx].bgSettings = {};
        frames[currentIdx].bgSettings.x = newX;
        frames[currentIdx].bgSettings.y = newY;
        render();
        e.preventDefault();
    };
    overlay.ontouchend = () => { dragging = false; };
    overlay.onmousedown = e => {
        dragging = true; startX = e.clientX; startY = e.clientY;
        startBgX = parseInt(document.getElementById('mob-bg-x').value) || 0;
        startBgY = parseInt(document.getElementById('mob-bg-y').value) || 0;
        e.preventDefault(); e.stopPropagation();
    };
    document.onmousemove = e => {
        if (!dragging || !mobBgDragActive) return;
        const newX = clamp(Math.round(startBgX + (e.clientX - startX) * SENSITIVITY), -100, 100);
        const newY = clamp(Math.round(startBgY + (e.clientY - startY) * SENSITIVITY), -100, 100);
        document.getElementById('mob-bg-x').value = newX;
        document.getElementById('mob-bg-x-v').innerText = newX;
        document.getElementById('mob-bg-y').value = newY;
        document.getElementById('mob-bg-y-v').innerText = newY;
        if (!frames[currentIdx].bgSettings) frames[currentIdx].bgSettings = {};
        frames[currentIdx].bgSettings.x = newX;
        frames[currentIdx].bgSettings.y = newY;
        render();
    };
    document.onmouseup = () => { dragging = false; };
}

// bg import choice
let _bgChoiceSrc = null;
function showBgImportChoice(src) {
    // auto apply fixed/centered, skip modal
    _bgChoiceSrc = src;
    bgChoiceFixed();
}
function bgChoiceCrop() {
    const t = document.getElementById('crop-target');
    document.getElementById('crop-modal').style.display = 'flex';
    if (cropper) { cropper.destroy(); cropper = null; }
    const r = canvasRatio || { w: 1, h: 1 };
    const initCropper = () => { cropper = new Cropper(t, { aspectRatio: r.w / r.h, viewMode: 1 }); };
    // wait for image load (fallback .complete) before cropper measures — src is set but not decoded yet, so it'd measure 0x0
    t.onload = () => { t.onload = null; initCropper(); };
    t.src = _bgChoiceSrc;
    if (t.complete && t.naturalWidth) { t.onload = null; initCropper(); }
}
async function bgChoiceFixed() {
    if (!_bgChoiceSrc) return;
    saveState();

    let finalSrc = _bgChoiceSrc;
    if (_bgChoiceSrc.startsWith('data:image')) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.92);color:#00d2ff;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:800;z-index:9999;pointer-events:none;border:1px solid rgba(0,210,255,0.3);letter-spacing:0.3px;';
        toast.innerText = '⬆️ Uploading background…';
        document.body.appendChild(toast);
        const url = await uploadBgToStorage(_bgChoiceSrc);
        toast.remove();
        if (url) finalSrc = url;
        // bust mine tab cache
        mobBgLoaded = false;
        mobBgMine = null;
    }

    frames[currentIdx].background = finalSrc;
    // reset bg settings on new bg
    frames[currentIdx].bgSettings = { scale: 1, rotate: 0, x: 0, y: 0, filter: 'none' };
    _bgChoiceSrc = null;
    // reset sliders
    syncBgSliders();
    // reset filter chips
    document.querySelectorAll('#mob-bg-filter-row .filter-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
    render();
}

// fx
const MOB_FX_BLUR_TYPES = ['none','gaussian','motion','lens','frosted','zoom','radial','pixel'];
// filter chips expand to sliders (ibis paint style). brightness/contrast/hue/sat map to native css filter, lightness/color balance render as tint overlays instead

// blend mode via css mix-blend-mode, kept to a short useful set not the full list
const FX_BLEND_MODES = ['normal','multiply','screen','add','overlay','difference','color','luminosity'];
const FX_BLEND_LABELS = ['None','Multiply','Screen','Add','Overlay','Difference','Color','Luminosity'];

// 'add' isn't a native name in either api — css calls it plus-lighter, canvas calls it lighter — helpers special-case it
function cssBlendMode(name) { return name === 'add' ? 'plus-lighter' : name; }
function canvasBlendMode(name) { return name === 'add' ? 'lighter' : name; }

// fx target: sprite layer or frame bg, mirrors the sprite fx toolkit. fxEditingBg tracks which is active
function setFxTarget(target) {
    fxEditingBg = (target === 'bg');
    syncFxPanel();
}
// get fx target, creates a fresh bgFx object on the current frame if none exists yet
function getFxTarget(create) {
    if (fxEditingBg) {
        const f = frames[currentIdx];
        // bg existence = f.background not f.bgFx (the fx settings) — checking bgFx wrongly reported no-bg when nothing had been applied yet
        if (!f || !f.background) return null;
        if (!f.bgFx && create) f.bgFx = {};
        return f.bgFx || {};
    }
    return activeLayer || null;
}

function syncFxPanel() {
    const hint     = document.getElementById('fx-selected-hint');
    const body     = document.getElementById('fx-controls-body');
    const layerTab = document.getElementById('fx-target-layer');
    const bgTab    = document.getElementById('fx-target-bg');
    const opSec    = document.getElementById('fx-opacity-section');
    if (layerTab) layerTab.classList.toggle('active', !fxEditingBg);
    if (bgTab)    bgTab.classList.toggle('active', fxEditingBg);
    // opacity: sprites only, bg always opaque
    if (opSec) opSec.style.display = fxEditingBg ? 'none' : 'block';

    const target = getFxTarget(false);

    if (!target) {
        if (hint) { hint.style.display = 'block'; hint.innerText = fxEditingBg ? '⚠️ No background on this frame yet' : '⚠️ Select a layer first to apply effects'; }
        if (body) { body.style.display = 'none'; }
        renderFxPreview();
        return;
    }

    // has target: hide hint, show controls
    if (hint) hint.style.display = 'none';
    if (body) body.style.display = 'block';

    // sync blur cards
    const bType = target.blurType || 'none';
    const resolvedType = bType === 'soft' ? 'gaussian' : bType;
    MOB_FX_BLUR_TYPES.forEach(t => {
        const el = document.getElementById('fx-blur-' + t);
        if (el) el.classList.toggle('active', t === resolvedType);
    });
    const bAmt = target.blurAmt || target.blurAmount || 4;
    const bAngle = target.blurAngle || 0;
    const amtEl = document.getElementById('fx-blur-amt');
    const amtRow = document.getElementById('fx-blur-amt-row');
    const motRow = document.getElementById('fx-motion-dir-row');
    const angEl  = document.getElementById('fx-motion-angle');
    const angVal = document.getElementById('fx-motion-angle-val');
    if (amtEl)  amtEl.value = bAmt;
    document.getElementById('fx-blur-amt-val').innerText = bAmt + 'px';
    if (amtRow) amtRow.style.display = resolvedType === 'none' ? 'none' : 'flex';
    if (motRow) motRow.style.display = resolvedType === 'motion' ? 'flex' : 'none';
    if (angEl)  angEl.value = bAngle;
    if (angVal) angVal.innerText = bAngle + '°';

    // sync filter sliders
    const adj = Object.assign({ brightness:0, contrast:0, hue:0, saturation:0, lightness:0, cr:0, mg:0, yb:0 }, target.fxAdjust || {});
    setFxAdjustSlider('fx-adj-brightness', adj.brightness, '');
    setFxAdjustSlider('fx-adj-contrast',   adj.contrast,   '');
    setFxAdjustSlider('fx-adj-cr', adj.cr, '');
    setFxAdjustSlider('fx-adj-mg', adj.mg, '');
    setFxAdjustSlider('fx-adj-yb', adj.yb, '');
    setFxAdjustSlider('fx-adj-hue', adj.hue, '°');
    setFxAdjustSlider('fx-adj-saturation', adj.saturation, '');
    setFxAdjustSlider('fx-adj-lightness',  adj.lightness,  '');
    // collapse panels, clear dot
    document.querySelectorAll('.fx-adjust-panel').forEach(p => p.classList.remove('show'));
    document.querySelectorAll('#fx-filter-row .fx-chip').forEach(c => c.classList.remove('active'));
    const grp = document.getElementById('fx-filter-row');
    if (grp) {
        grp.querySelector('[data-adjust="bc"]')?.classList.toggle('has-value', !!(adj.brightness || adj.contrast));
        grp.querySelector('[data-adjust="cb"]')?.classList.toggle('has-value', !!(adj.cr || adj.mg || adj.yb));
        grp.querySelector('[data-adjust="hsl"]')?.classList.toggle('has-value', !!(adj.hue || adj.saturation || adj.lightness));
    }

    // sync blend chips
    const br = document.getElementById('fx-blend-row');
    br.innerHTML = '';
    FX_BLEND_MODES.forEach((b, i) => {
        const chip = document.createElement('button');
        chip.className = 'fx-chip' + (target.fxBlend === b || (i===0&&!target.fxBlend) ? ' active' : '');
        chip.innerText = FX_BLEND_LABELS[i];
        chip.onclick = () => {
            const t2 = getFxTarget(true);
            if (!t2) return;
            saveState();
            t2.fxBlend = b;
            br.querySelectorAll('.fx-chip').forEach(c=>c.classList.remove('active'));
            chip.classList.add('active');
            applyFxToSelected();
        };
        br.appendChild(chip);
    });

    // sync opacity
    const opEl = document.getElementById('fx-opacity');
    const opVal = document.getElementById('fx-opacity-val');
    const op = target.fxOpacity !== undefined ? target.fxOpacity : 100;
    if (opEl) opEl.value = op;
    if (opVal) opVal.innerText = op + '%';

    // sync blur strength
    const bStr    = target.blurStrength != null ? target.blurStrength : 100;
    const strEl   = document.getElementById('fx-blur-strength');
    const strVal  = document.getElementById('fx-blur-strength-val');
    const strRow  = document.getElementById('fx-strength-row');
    if (strEl)  strEl.value = bStr;
    if (strVal) strVal.innerText = bStr + '%';
    if (strRow) strRow.style.display = (resolvedType !== 'none') ? 'block' : 'none';
    renderFxPreview();
}

// set slider value + readout
function setFxAdjustSlider(id, val, suffix) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-val');
    if (el)  el.value = val;
    if (lbl) lbl.innerText = (val > 0 ? '+' : '') + val + suffix;
}

// tap chip to toggle sliders, only one panel shown but all three groups' values stay active
function setFxAdjustGroup(key) {
    const panelId = 'fx-adjust-' + key;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const wasOpen = panel.classList.contains('show');
    document.querySelectorAll('.fx-adjust-panel').forEach(p => p.classList.remove('show'));
    document.querySelectorAll('#fx-filter-row .fx-chip').forEach(c => c.classList.remove('active'));
    if (!wasOpen) {
        panel.classList.add('show');
        document.querySelector(`#fx-filter-row .fx-chip[data-adjust="${key}"]`)?.classList.add('active');
    }
}

// read sliders into fxFilter (same field every render/export/reader path reads), lightness+color balance go to colorFx for the overlay renderer
function applyFxAdjust() {
    const target = getFxTarget(true);
    if (!target) return;
    const v = id => parseInt(document.getElementById(id)?.value || 0) || 0;
    const brightness = v('fx-adj-brightness'), contrast = v('fx-adj-contrast');
    const hue = v('fx-adj-hue'), saturation = v('fx-adj-saturation'), lightness = v('fx-adj-lightness');
    const cr = v('fx-adj-cr'), mg = v('fx-adj-mg'), yb = v('fx-adj-yb');

    setFxAdjustSlider('fx-adj-brightness', brightness, '');
    setFxAdjustSlider('fx-adj-contrast',   contrast,   '');
    setFxAdjustSlider('fx-adj-cr', cr, '');
    setFxAdjustSlider('fx-adj-mg', mg, '');
    setFxAdjustSlider('fx-adj-yb', yb, '');
    setFxAdjustSlider('fx-adj-hue', hue, '°');
    setFxAdjustSlider('fx-adj-saturation', saturation, '');
    setFxAdjustSlider('fx-adj-lightness',  lightness,  '');

    const grp = document.getElementById('fx-filter-row');
    if (grp) {
        grp.querySelector('[data-adjust="bc"]')?.classList.toggle('has-value', !!(brightness || contrast));
        grp.querySelector('[data-adjust="cb"]')?.classList.toggle('has-value', !!(cr || mg || yb));
        grp.querySelector('[data-adjust="hsl"]')?.classList.toggle('has-value', !!(hue || saturation || lightness));
    }

    target.fxAdjust = { brightness, contrast, hue, saturation, lightness, cr, mg, yb };

    const parts = [];
    if (brightness) parts.push(`brightness(${(1 + brightness / 100).toFixed(3)})`);
    if (contrast)   parts.push(`contrast(${(1 + contrast / 100).toFixed(3)})`);
    if (saturation) parts.push(`saturate(${(1 + saturation / 100).toFixed(3)})`);
    if (hue)        parts.push(`hue-rotate(${hue}deg)`);
    target.fxFilter = parts.length ? parts.join(' ') : 'none';

    target.colorFx = (lightness || cr || mg || yb)
        ? { enabled: true, lightness, cr, mg, yb }
        : { enabled: false };

    render();
    renderFxPreview();
}

function setFxBlur(type) {
    const target = getFxTarget(true);
    if (!target) return;
    saveState();
    target.blurType = type;
    MOB_FX_BLUR_TYPES.forEach(t => {
        const el = document.getElementById('fx-blur-' + t);
        if (el) el.classList.toggle('active', t === type);
    });
    const amtRow = document.getElementById('fx-blur-amt-row');
    const motRow = document.getElementById('fx-motion-dir-row');
    if (amtRow) amtRow.style.display = type === 'none' ? 'none' : 'flex';
    if (motRow) motRow.style.display = type === 'motion' ? 'flex' : 'none';
    applyFxToSelected();
}

function applyFxToSelected() {
    const target = getFxTarget(true);
    if (!target) return;
    const isBg = fxEditingBg;
    const amt          = parseInt(document.getElementById('fx-blur-amt').value) || 4;
    const angle        = parseInt(document.getElementById('fx-motion-angle')?.value || 0);
    const op           = parseInt(document.getElementById('fx-opacity').value);
    const blurStrength = parseInt(document.getElementById('fx-blur-strength')?.value ?? 100);
    document.getElementById('fx-blur-amt-val').innerText = amt + 'px';
    document.getElementById('fx-opacity-val').innerText  = op + '%';
    const strEl  = document.getElementById('fx-blur-strength-val');
    const strRow = document.getElementById('fx-strength-row');
    if (strEl)  strEl.innerText = blurStrength + '%';
    if (strRow) strRow.style.display = (target.blurType && target.blurType !== 'none') ? 'block' : 'none';
    target.blurAmt      = amt;
    target.blurAmount   = amt;
    target.blurAngle    = angle;
    // no opacity for backgrounds
    if (isBg) delete target.fxOpacity;
    else      target.fxOpacity = op;
    target.blurStrength = blurStrength;
    const needsRecompute = _fxCanvas_TYPES.includes(target.blurType);
    if (needsRecompute) {
        target._fxSrc = null;
        const computePromise = isBg ? computeBgFx() : computeLayerFx(target);
        computePromise.then(() => { render(); renderFxPreview(); });
    } else {
        target._fxSrc = null;
        render();
        renderFxPreview();
    }
}

function clearFxFromSelected() {
    const target = getFxTarget(true);
    if (!target) return;
    saveState();
    delete target.fxFilter;
    delete target.fxOpacity;
    delete target.fxBlend;
    delete target.fxAdjust;
    target.blurType     = 'none';
    target.blurAmt      = 4;
    target.blurAmount   = 4;
    target.blurAngle    = 0;
    target.blurStrength = 100;
    target._fxSrc       = null;
    target.colorFx      = { enabled: false };
    syncFxPanel();
    render();
    renderFxPreview();
}
// stubs for PC compat
function toggleFxPanel() { openSheet('fx'); }
function closeFxPanel() { closeSheet('fx'); }

// import
function triggerImport(type) { currentImportType = type; document.getElementById('img-input').click(); }
document.getElementById('img-input').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (currentImportType === 'bg_crop') {
            currentImportType = 'bg';
            _bgChoiceSrc = ev.target.result;
            bgChoiceCrop();
        } else if (currentImportType === 'bg') {
            showBgImportChoice(ev.target.result);
        }
        else {
            saveState();
            const cw = canvas.offsetWidth || 300, ch = canvas.offsetHeight || 300;
            const initW = Math.round(cw * 0.5);
            const nl = { type: 'img', src: ev.target.result, w: initW, x: Math.round(cw * 0.25), y: Math.round(ch * 0.25), rotation: 0, flipped: false, id: Date.now() };
            frames[currentIdx].layers.push(nl);
            activeLayer = nl;
            render();
            // trim transparent edges — uploads used to skip this unlike library sprites, so baked-in whitespace threw off sizing
            const probe = new Image();
            probe.onload = () => {
                if (!probe.naturalWidth || !probe.naturalHeight) return;
                const cropped = cropSpriteToContent(probe);
                const scale = initW / cropped.w;
                nl.src = cropped.src;
                nl.w = Math.min(getMaxSpriteSize(), Math.round(cropped.w * scale));
                nl.h = Math.round(cropped.h * scale);
                nl.insertW = nl.w; nl.insertH = nl.h; // canonical size at insertion — resetTransform() restores to this
                render();
            };
            probe.src = ev.target.result;
        }
    };
    reader.onerror = () => showToast('⚠️ Failed to read ' + file.name);
    reader.readAsDataURL(file);
    e.target.value = '';
});
function handleCoverInput(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        currentImportType = 'cover';
        const t = document.getElementById('crop-target');
        document.getElementById('crop-modal').style.display = 'flex';
        if (cropper) { cropper.destroy(); cropper = null; }
        const initCropper = () => { cropper = new Cropper(t, { aspectRatio: 1, viewMode: 1 }); };
        t.onload = () => { t.onload = null; initCropper(); };
        t.src = ev.target.result;
        if (t.complete && t.naturalWidth) { t.onload = null; initCropper(); }
    };
    reader.onerror = () => showToast('⚠️ Failed to read ' + file.name);
    reader.readAsDataURL(file);
    e.target.value = '';
}
function closeCrop() { document.getElementById('crop-modal').style.display='none'; if(cropper){cropper.destroy();cropper=null;} }
document.getElementById('apply-crop-btn').onclick = async () => {
    if (!cropper) return;
    if (currentImportType === 'bg') {
        const cropData = cropper.getData(true);
        const imgData  = cropper.getImageData();
        const naturalW = imgData.naturalWidth;
        const naturalH = imgData.naturalHeight;
        const cropCX   = (cropData.x + cropData.width  / 2) / naturalW * 100;
        const cropCY   = (cropData.y + cropData.height / 2) / naturalH * 100;
        // converts the crop focal point into the same -100..100 range the sliders use (renderer does 50 + offset/2 so we just invert it here)
        const bgX      = Math.round(Math.max(-100, Math.min(100, (cropCX - 50) * 2)));
        const bgY      = Math.round(Math.max(-100, Math.min(100, (cropCY - 50) * 2)));
        // converts crop zoom into the same 1..5 multiplier the scale slider uses, this used to store a 50-300% value which the renderer read as a raw multiplier lol
        const bgScale  = Math.round(Math.max(1, Math.min(5, naturalW / cropData.width)) * 10) / 10;

        // upload if still base64
        let fullSrc = _bgChoiceSrc || frames[currentIdx].background;
        if (fullSrc && fullSrc.startsWith('data:image')) {
            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.92);color:#00d2ff;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:800;z-index:9999;pointer-events:none;border:1px solid rgba(0,210,255,0.3);';
            toast.innerText = '⬆️ Uploading background…';
            document.body.appendChild(toast);
            const url = await uploadBgToStorage(fullSrc);
            toast.remove();
            if (url) fullSrc = url;
        }
        saveState();
        frames[currentIdx].background = fullSrc;
        frames[currentIdx].bgSettings = {
            scale: bgScale, rotate: 0, x: bgX, y: bgY,
            filter: frames[currentIdx].bgSettings?.filter || 'none'
        };
        _bgChoiceSrc = null;
        closeCrop(); render();
    } else if (currentImportType === 'cover') {
        const data = cropper.getCroppedCanvas().toDataURL('image/jpeg', 0.92);
        closeCrop();
        // show preview while uploading
        finalCoverBase64 = data;
        const img = document.getElementById('final-cover-img');
        img.src = data; img.style.display = 'block';
        document.getElementById('cover-label').style.display = 'none';
        // upload then swap to url
        uploadCoverToStorage(data).then(url => {
            if (url) {
                finalCoverBase64 = url;
                img.src = url;
            }
        });
    } else {
        // crop then upload
        const data = cropper.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 }).toDataURL('image/jpeg', 0.9);
        closeCrop();
        saveState();
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.92);color:#00d2ff;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:800;z-index:9999;pointer-events:none;border:1px solid rgba(0,210,255,0.3);letter-spacing:0.3px;';
        toast.innerText = '⬆️ Uploading image…';
        document.body.appendChild(toast);
        uploadBgToStorage(data).then(url => {
            toast.remove();
            const finalSrc = url || data;
            const cw = canvas.offsetWidth || 300, ch = canvas.offsetHeight || 300;
            const initW = Math.round(cw * 0.5);
            const nl = { type:'img', src:finalSrc, w:initW, h:initW, x:Math.round(cw*0.25), y:Math.round(ch*0.25), rotation:0, flipped:false, id:Date.now() };
            frames[currentIdx].layers.push(nl);
            activeLayer = nl;
            const probe = new Image();
            probe.crossOrigin = 'anonymous';
            probe.onload = () => {
                if (!probe.naturalWidth) { render(); return; }
                const cropped = cropSpriteToContent(probe);
                const scale = initW / cropped.w;
                nl.src = cropped.src;
                nl.w = Math.round(cropped.w * scale);
                nl.h = Math.round(cropped.h * scale);
                nl.insertW = nl.w; nl.insertH = nl.h; // canonical size at insertion — resetTransform() restores to this
                render();
            };
            probe.onerror = () => render();
            probe.src = finalSrc;
        });
    }
};

// multi import
let multiFiles = [];
function openMultiImport() {
    multiFiles = [];
    document.getElementById('multi-preview-grid').innerHTML = '';
    document.getElementById('multi-confirm-btn').disabled = true;
    document.getElementById('multi-import-modal').style.display = 'flex';
}
function closeMultiImport() { document.getElementById('multi-import-modal').style.display = 'none'; }
document.getElementById('multi-file-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    multiFiles = [];
    const grid = document.getElementById('multi-preview-grid');
    grid.innerHTML = '';
    files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            const img = new Image();
            img.onload = () => {
                multiFiles.push({ dataUrl, name: file.name, w: img.naturalWidth, h: img.naturalHeight });
                multiFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                // re-render preview
                grid.innerHTML = '';
                multiFiles.forEach((f, i) => {
                    const div = document.createElement('div');
                    div.className = 'multi-thumb';
                    div.style.backgroundImage = 'url(' + f.dataUrl + ')';
                    const badge = document.createElement('div');
                    badge.className = 'order-badge';
                    badge.innerText = i + 1;
                    div.appendChild(badge);
                    grid.appendChild(div);
                });
                document.getElementById('multi-confirm-btn').disabled = false;
            };
            img.onerror = () => showToast('⚠️ Could not load ' + file.name);
            img.src = dataUrl;
        };
        reader.onerror = () => showToast('⚠️ Failed to read ' + file.name);
        reader.readAsDataURL(file);
    });
    e.target.value = '';
});
function confirmMultiImport() {
    if (!multiFiles.length) return;
    saveState();
    const mode = document.getElementById('multi-insert-mode').value;
    const newFrames = multiFiles.map(f => ({
        layers: [], background: f.dataUrl,
        // fit:true — imported frames show the whole photo instead of getting cropped, since the user never got a chance to pan/crop it themselves. only set here, Import Background keeps the normal cover behavior
        bgSettings: { scale: 1, rotate: 0, x: 0, y: 0, filter: 'none', fit: true },
        ratio: (f.w && f.h) ? { w: f.w, h: f.h } : undefined
    }));
    if (mode === 'replace') {
        // fixed: saveState alone wasn't enough — undo stack is in-memory, gone on reload. This action can wipe a whole comic in one tap so it also backs up to localStorage (one slot), checked on load to offer restore
        try {
            localStorage.setItem('cc-replace-backup', JSON.stringify({
                draftId: activeDraftId, frames, ts: Date.now()
            }));
        } catch(e) { /* localStorage full/unavailable — the in-session undo still covers it */ }
        frames = newFrames; currentIdx = 0;
    }
    else if (mode === 'append') { frames.splice(currentIdx + 1, 0, ...newFrames); currentIdx++; }
    else if (mode === 'from-current') { frames.splice(currentIdx, frames.length - currentIdx, ...newFrames); }
    multiFiles = [];
    activeLayer = null;
    closeMultiImport();
    const activeF = frames[currentIdx];
    const activeR = getFrameRatio(activeF);
    if (activeR.w !== canvasRatio.w || activeR.h !== canvasRatio.h) setRatio(activeR.w, activeR.h);
    else render();
    renderMobFrames();
    updateFrameCounter();
}

// check backup on load, offer restore if it matches the open draft (or there's no draft context to compare) and is recent
function checkReplaceBackup() {
    let backup;
    try { backup = JSON.parse(localStorage.getItem('cc-replace-backup') || 'null'); } catch(e) { return; }
    if (!backup || !backup.frames || !backup.frames.length) return;
    if (backup.draftId && backup.draftId !== activeDraftId) return; // belongs to a different comic
    const ageHrs = (Date.now() - (backup.ts || 0)) / 3.6e6;
    if (ageHrs > 72) { localStorage.removeItem('cc-replace-backup'); return; } // stale — don't nag forever
    showReplaceBackupPrompt(backup);
}
function showReplaceBackupPrompt(backup) {
    let el = document.getElementById('replace-backup-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'replace-backup-toast';
        el.style.cssText = 'position:fixed;bottom:90px;left:14px;right:14px;background:rgba(20,20,22,0.97);color:#fff;padding:12px 14px;border-radius:14px;font-size:12px;font-weight:700;z-index:9999;border:1px solid #333;display:flex;align-items:center;gap:10px;';
        document.body.appendChild(el);
    }
    el.innerHTML = `
        <span style="flex:1;line-height:1.4;">Frames were replaced recently. Restore the previous ${backup.frames.length} frame${backup.frames.length !== 1 ? 's' : ''}?</span>
        <button onclick="restoreReplaceBackup()" style="background:var(--accent, #ff7a00);color:#000;border:none;padding:8px 12px;border-radius:10px;font-weight:800;font-size:11px;cursor:pointer;white-space:nowrap;">Restore</button>
        <button onclick="dismissReplaceBackup()" style="background:none;border:none;color:#888;font-size:11px;font-weight:800;cursor:pointer;padding:8px 4px;">Dismiss</button>
    `;
}
function restoreReplaceBackup() {
    let backup;
    try { backup = JSON.parse(localStorage.getItem('cc-replace-backup') || 'null'); } catch(e) { return; }
    if (!backup || !backup.frames) return;
    saveState(); // so undoing the restore itself is also possible
    frames = backup.frames;
    currentIdx = 0;
    activeLayer = null;
    localStorage.removeItem('cc-replace-backup');
    dismissReplaceBackup();
    activateFrame(0);
    renderMobFrames();
    updateFrameCounter();
    showToast('Frames restored');
}
function dismissReplaceBackup() {
    const el = document.getElementById('replace-backup-toast');
    if (el) el.remove();
    localStorage.removeItem('cc-replace-backup');
}

// save / drafts (sql-first, bucket spill for large drafts)
const _DRAFT_BUCKET = 'comiccore-assets';
const _DRAFT_PREFIX = 'drafts/';
const _PUBLISH_PREFIX = 'comics/'; // out-of-line frame-data blobs for published comics — see finalPublish()
const _INLINE_LIMIT = 900_000;
const _SNAPSHOT_CHUNK = 300; // frame_snapshots upsert batch size — keeps each request's statement small at any comic size

// stamp per-frame canvas pixel dims so reader can scale layers — fixed: was mutating live frames then stripping the stamp back off, losing the race with a lazy strip build (reader fell back to 900px, mismatched positions). Returns a fresh array, never mutates live frames, each frame recomputed from its own stored ratio (same formula as setRatio)
function getStampedFrames() {
    return frames.map(f => {
        const r = getFrameRatio(f);
        const { cw, ch } = computeCanvasSize(r.w, r.h);
        return { ...f, ratio: { w: r.w, h: r.h }, _editorW: cw || 300, _editorH: ch || 300 };
    });
}

// safety net before publish: re-rasterize sprites needing edge trim, re-upload any base64 that slipped through (add-time upload can fail silently), skip non-http src in snapshots. Returns a fresh array, doesn't touch live frames
async function ensureLayerImagesUploaded(frameList) {
    const out = [];
    let failCount = 0;
    for (const f of frameList) {
        const srcLayers = f.layers || [];
        let layers = srcLayers;
        for (let i = 0; i < srcLayers.length; i++) {
            const l = srcLayers[i];
            if (l.type !== 'img') continue;
            const patch = {};
            if (l.src && l.src.startsWith('data:')) {
                let url = await uploadSpriteToStorage(l.src);
                if (!url) url = await uploadSpriteToStorage(l.src); // one retry — transient hiccups shouldn't ship a broken sprite
                if (url) patch.src = url; else failCount++;
            }
            if (l._fxSrc && l._fxSrc.startsWith('data:')) {
                let url = await uploadSpriteToStorage(l._fxSrc);
                if (!url) url = await uploadSpriteToStorage(l._fxSrc);
                if (url) patch._fxSrc = url; else failCount++;
            }
            if (Object.keys(patch).length) {
                if (layers === srcLayers) layers = srcLayers.slice(); // copy-on-write, once
                layers[i] = { ...l, ...patch };
            }
        }
        // same safety net for bg base64 — last line of defense before publish so an oversized payload never hits supabase
        let bgPatch = null;
        if (f.background && f.background.startsWith('data:')) {
            let url = await uploadBgToStorage(f.background);
            if (!url) url = await uploadBgToStorage(f.background);
            if (url) bgPatch = url; else failCount++;
        }
        if (layers !== srcLayers || bgPatch) {
            out.push({ ...f, ...(layers !== srcLayers ? { layers } : {}), ...(bgPatch ? { background: bgPatch } : {}) });
        } else {
            out.push(f);
        }
    }
    if (failCount > 0) {
        console.warn(failCount + ' image(s) failed to upload after retry — they will publish as embedded data and may not render until re-saved with a working connection.');
    }
    ensureLayerImagesUploaded._lastFailCount = failCount;
    return out;
}

// resolve a comics/drafts row's frames whether inline or in storage — used in finalPublish's size check and whenever an existing comic loads back into the editor
async function resolveFramesFromRow(row) {
    if (row.data) return row.data;
    if (row.storage_path) {
        try {
            const { data: blob, error } = await _supabase.storage.from(_DRAFT_BUCKET).download(row.storage_path);
            if (error) throw error;
            return JSON.parse(await blob.text());
        } catch (e) {
            console.error('Failed to load out-of-line frame data from Storage:', e);
            return null;
        }
    }
    return row.frames || null;
}

// local backup independent of supabase/network — a second copy to recover from if the tab dies or a future bug produces a bad write
const _LOCAL_BACKUP_PREFIX = 'cc-local-backup-';
function localBackupSave() {
    if (!activeDraftId) return;
    try {
        lsSet(_LOCAL_BACKUP_PREFIX + activeDraftId, JSON.stringify({ frames, ratio: canvasRatio, ts: Date.now() }));
    } catch(e) { /* best effort — never let a backup failure block the real save */ }
}
function localBackupLoad(draftId) {
    try {
        const raw = localStorage.getItem(_LOCAL_BACKUP_PREFIX + draftId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.frames || !parsed.frames.length) return null;
        return parsed;
    } catch(e) { return null; }
}

// tripwire: refuses to silently autosave a near-empty canvas over an existing draft (signals something upstream broke). Manual saves still go through with a confirmation
function looksBlank(frameArr) {
    if (!frameArr || !frameArr.length) return true;
    if (frameArr.length > 1) return false;
    const f = frameArr[0];
    return (!f.layers || f.layers.length === 0) && (!f.background || f.background === '#ffffff');
}

// auto-retry cloud sync on reconnect — local backup already has the data, this just gets the cloud copy back in sync without the user noticing
let _pendingCloudSync = false;
let _onlineRetryRegistered = false;
function _scheduleCloudSyncRetry() {
    _pendingCloudSync = true;
    if (_onlineRetryRegistered) return;
    _onlineRetryRegistered = true;
    window.addEventListener('online', function _onlineHandler() {
        window.removeEventListener('online', _onlineHandler);
        _onlineRetryRegistered = false;
        if (_pendingCloudSync) {
            _pendingCloudSync = false;
            saveOffline(true); // silent — a background retry succeeding doesn't need a popup
        }
    });
}

async function saveOffline(silent = false) {
    // critical: safety net

    if (_draftLoadPending) {
        if (!silent) showMobSaveBadge('Still loading — try again in a moment', true);
        return;
    }
    // critical: safety net

    if (draftRowExists && looksBlank(frames)) {
        if (silent) {
            console.warn('Autosave blocked: canvas looks blank but draft "' + activeDraftId + '" already has saved content — refusing to silently overwrite it.');
            return;
        }
        if (!confirm('This looks like a blank canvas, but a saved draft already exists here. Saving now will replace it with an empty comic. Continue?')) return;
    }
    // local backup first, before network, so it happens even if the request below fails or times out
    localBackupSave();

    // skip network if device knows it's offline — calmer "saved locally" message instead of a scary fetch error, queues a retry for reconnect
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        _scheduleCloudSyncRetry();
        if (!silent) showMobSaveBadge('Saved on this device — will sync when back online', false);
        return;
    }

    // top-level ratio is just the back-compat/cover ratio, not a per-frame source of truth
    const ratio  = getFrameRatio(frames[0]) || { w:1, h:1 };
    const now    = new Date().toISOString();
    const handle = myHandle || JSON.parse(localStorage.getItem('user_profile') || '{}').handle;

    if (!handle) {
        if (!silent) showMobSaveBadge('Log in to save', true);
        return;
    }

    try {
        const { data: { session: _cm1 } } = await _supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const user = _cm1?.user ?? null;
        if (!user) { if (!silent) showMobSaveBadge('Log in to save', true); return; }

        // fixed: uuid generated once upfront, same id whether it's the first save or the hundredth
        activeDraftId = activeDraftId || crypto.randomUUID();
        lsSet('active_draft_id', activeDraftId);

        // stamp canvas dims for reader scaling (fresh array, doesn't touch live frames). fixed: draft saves were skipping the base64 strip, letting a leftover base64 layer (e.g. _fxSrc) push the payload past _INLINE_LIMIT and blow the bucket's max file size
        const stampedRaw = getStampedFrames();
        const stamped = await ensureLayerImagesUploaded(stampedRaw);
        if (ensureLayerImagesUploaded._lastFailCount > 0) {
            console.warn(ensureLayerImagesUploaded._lastFailCount + ' image(s) could not be uploaded during draft save — they remain embedded as base64 for now.');
        }
        const payload = JSON.stringify(stamped);
        let rowPatch;

        if (payload.length > _INLINE_LIMIT) {
            const path = `${_DRAFT_PREFIX}${activeDraftId}.json`;
            const { error: upErr } = await _supabase.storage
                .from(_DRAFT_BUCKET)
                .upload(path, new Blob([payload], { type: 'application/json' }), { upsert: true });
            if (upErr) throw upErr;
            rowPatch = { data: null, storage_path: path };
            lsSet('active_draft_storage_path', path); // fixed: was never written, only ever read
        } else {
            rowPatch = { data: stamped, storage_path: null };
            localStorage.removeItem('active_draft_storage_path');
        }

        // fixed: single upsert instead of an insert/update split on activeDraftId.includes('-') — that check broke once ids weren't guaranteed to contain a dash, causing duplicate rows
        const row = {
            id: activeDraftId,
            canvas_ratio: ratio,
            updated_at: now,
            // owner_handle/user_id/owner_handles back drafts RLS's NOT NULL check. Gating on draftRowExists was fragile (crashes traced back to stale state claiming a row existed when it didn't) — sending real cached values on every save is safe either way and can never be null
            owner_handle: _draftOwnerHandle || handle,
            user_id: _draftUserId || user.id,
            owner_handles: (_collabOwnerHandles && _collabOwnerHandles.length) ? _collabOwnerHandles : [handle],
            ...rowPatch
        };
        if (!draftRowExists) {
            row.title = 'Untitled Draft'; // only stamp default title on first creation
        }

        const { error: saveErr } = await _supabase.from('drafts').upsert(row, { onConflict: 'id' });
        if (saveErr) throw saveErr;
        draftRowExists = true;
        _draftOwnerHandle = row.owner_handle;
        _draftUserId = row.user_id;
        _collabOwnerHandles = row.owner_handles;

        hasUnsavedChanges = false;
        const dot2 = document.getElementById('unsaved-dot');
        if (dot2) dot2.style.display = 'none';
        if (!silent) showMobSaveBadge('✓ Saved', false);
        notifyCollabEdit(activeDraftId, true, document.getElementById('pub-title')?.value || row.title);
    } catch(e) {
        console.warn('Draft save failed:', e);
        // cloud failed but local backup saved — browser has its own copy separate from supabase
        const msg = (e && e.message) || '';
        // no response = a dropped connection, not a real supabase rejection (bad payload/auth/quota) — queue a silent retry instead of treating it as a failure
        const looksLikeConnectivity = /failed to fetch|networkerror|network request failed/i.test(msg)
            || (typeof navigator !== 'undefined' && navigator.onLine === false);
        if (looksLikeConnectivity) {
            _scheduleCloudSyncRetry();
            if (!silent) showMobSaveBadge('Saved on this device — will sync when back online', false);
        } else {
            if (!silent) showMobSaveBadge('✗ Save failed (backed up on this device): ' + msg, true);
        }
    }
}

function showMobSaveBadge(msg, isErr) {
    const existing = document.getElementById('_mob-save-badge');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = '_mob-save-badge';
    t.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);background:${isErr?'#3a1a1a':'#1a3a1a'};color:${isErr?'#ff453a':'#4cff7a'};padding:8px 18px;border-radius:20px;font-size:12px;font-weight:800;z-index:9999;border:1px solid ${isErr?'#5a2a2a':'#2a5a2a'};`;
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
}
// load failed: offer retry, restore from local backup if one exists, or a safe exit that saves nothing — so a connection blip can never silently wipe a real draft
function showDraftLoadError() {
    const existing = document.getElementById('_draft-load-error-modal');
    if (existing) existing.remove();
    const backup = activeDraftId ? localBackupLoad(activeDraftId) : null;
    const wrap = document.createElement('div');
    wrap.id = '_draft-load-error-modal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(10,10,12,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
    wrap.innerHTML = `
      <div style="background:#18181b;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:24px 20px;max-width:340px;width:100%;text-align:center;">
        <div style="font-size:34px;margin-bottom:10px;">⚠️</div>
        <div style="font-size:15px;font-weight:900;color:#f4f4f6;margin-bottom:8px;">Couldn't load your draft</div>
        <div style="font-size:13px;color:#aaa;line-height:1.5;margin-bottom:18px;">
          Your saved draft didn't come back correctly — this is usually a connection issue.
          Nothing has been changed or deleted. Please retry rather than starting fresh, so your work isn't overwritten.
        </div>
        <button onclick="retryDraftLoad()" style="width:100%;padding:13px;background:#ff7a00;color:#000;border:none;border-radius:12px;font-size:14px;font-weight:900;cursor:pointer;margin-bottom:10px;">RETRY</button>
        ${backup ? `<button onclick="restoreLocalBackupAndContinue()" style="width:100%;padding:13px;background:#26262c;color:#00c9b1;border:1px solid rgba(0,201,177,0.3);border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;margin-bottom:10px;">Restore backup saved on this device</button>` : ''}
        <button onclick="location.href='my-comics.html'" style="width:100%;padding:12px;background:none;color:#888896;border:none;font-size:12px;font-weight:700;cursor:pointer;">Back to My Comics (nothing will be saved)</button>
      </div>`;
    document.body.appendChild(wrap);
}
function retryDraftLoad() { location.reload(); }
async function restoreLocalBackupAndContinue() {
    const backup = localBackupLoad(activeDraftId);
    if (!backup) return;
    frames = backup.frames;
    const modal = document.getElementById('_draft-load-error-modal');
    if (modal) modal.remove();
    const r = backup.ratio || { w:1, h:1 };
    setRatio(r.w, r.h); activateFrame(0); renderMobFrames(); updateFrameCounter();
    hasUnsavedChanges = true;
    // can't tell if the row exists server-side after a real fetch failure — assuming true crashed on NOT NULL, assuming false would've stomped a real draft's owner. Check instead of guessing
    showMobSaveBadge('Restored from device backup — checking sync status…', false);
    try {
        const { data } = await _supabase.from('drafts').select('id, owner_handle, owner_handles, user_id').eq('id', activeDraftId).maybeSingle();
        draftRowExists = !!data;
        _draftOwnerHandle = data?.owner_handle || null;
        _draftUserId = data?.user_id || null;
        _collabOwnerHandles = data?.owner_handles || [];
    } catch(e) {
        draftRowExists = false; // can't confirm — safer to re-stamp ownership than risk another NOT NULL crash
    }
    showMobSaveBadge('Restored from device backup — save to sync', false);
}

function goToDrafts() { saveOffline(true); location.href = 'my-comics.html'; }
let _exitDestination = 'index.html';
function handleExit() {
    _exitDestination = 'index.html';
    // silent autosave then navigate
    if (hasUnsavedChanges && activeDraftId) {
        saveOffline(true).then(() => { location.href = _exitDestination; }).catch(() => { location.href = _exitDestination; });
    } else {
        location.href = _exitDestination;
    }
}
async function exitSaveAndLeave() {
    document.getElementById('exit-confirm-modal').style.display = 'none';
    await saveOffline(false);
    location.href = _exitDestination;
}
function exitLeaveWithoutSaving() {
    document.getElementById('exit-confirm-modal').style.display = 'none';
    location.href = _exitDestination;
}
function exitCancelLeave() {
    document.getElementById('exit-confirm-modal').style.display = 'none';
}

// save-choice modal (disk icon in top bar)
function openSaveChoiceModal() {
    const isCollab = _collabOwnerHandles && _collabOwnerHandles.length > 1;
    const lbl = document.getElementById('save-choice-label');
    // collab: opens a destination picker (CoCreate vs My Drafts) since it shouldn't assume one. solo: saves straight to My Comics
    if (lbl) lbl.textContent = isCollab ? 'Save' : 'Save to My Comics';
    document.getElementById('save-choice-modal').style.display = 'flex';
}
function closeSaveChoiceModal() { document.getElementById('save-choice-modal').style.display = 'none'; }
function saveChoicePublish() { closeSaveChoiceModal(); openPublishModal(); }
// solo draft has one place to save. collab hands off to the picker instead of assuming CoCreate — might want a private fork instead
function saveChoiceSaveToMyComics() {
    const isCollab = _collabOwnerHandles && _collabOwnerHandles.length > 1;
    closeSaveChoiceModal();
    if (isCollab) openSaveDestModal();
    else saveOffline(false);
}
function saveChoiceExport() { closeSaveChoiceModal(); openExportModal(); }

// save-destination modal (collab drafts only) — CoCreate (shared) vs My Drafts (private fork)
function openSaveDestModal() { document.getElementById('save-dest-modal').style.display = 'flex'; }
function closeSaveDestModal() { document.getElementById('save-dest-modal').style.display = 'none'; }
function saveDestCoCreate() { closeSaveDestModal(); saveOffline(false); }
function saveDestMyDrafts() { closeSaveDestModal(); forkToMyDrafts(); }

// forks current frames into a new solely-owned draft, leaves the shared collab draft untouched
async function forkToMyDrafts() {
    const handle = myHandle || JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
    if (!handle) { showMobSaveBadge('Log in to save', true); return; }
    showMobSaveBadge('Saving a copy to My Drafts…', false);
    try {
        const { data: { session } } = await _supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const user = session?.user ?? null;
        if (!user) { showMobSaveBadge('Log in to save', true); return; }

        const newId = crypto.randomUUID();
        const now   = new Date().toISOString();
        const ratio = getFrameRatio(frames[0]) || { w:1, h:1 };
        const stampedRaw = getStampedFrames();
        const stamped = await ensureLayerImagesUploaded(stampedRaw);
        const payload = JSON.stringify(stamped);

        let rowPatch;
        if (payload.length > _INLINE_LIMIT) {
            const path = `${_DRAFT_PREFIX}${newId}.json`;
            const { error: upErr } = await _supabase.storage
                .from(_DRAFT_BUCKET)
                .upload(path, new Blob([payload], { type: 'application/json' }), { upsert: true });
            if (upErr) throw upErr;
            rowPatch = { data: null, storage_path: path };
        } else {
            rowPatch = { data: stamped, storage_path: null };
        }

        const baseTitle = document.getElementById('pub-title')?.value || 'Untitled Draft';
        const row = {
            id: newId,
            title: baseTitle + ' (copy)',
            canvas_ratio: ratio,
            updated_at: now,
            owner_handle: handle,
            user_id: user.id,
            owner_handles: [handle], // solo owner — not part of the collab's owner_handles
            ...rowPatch
        };
        const { error: insErr } = await _supabase.from('drafts').insert(row);
        if (insErr) throw insErr;
        showMobSaveBadge('✓ Saved a copy to My Drafts', false);
    } catch(e) {
        console.error('forkToMyDrafts failed:', e);
        showMobSaveBadge('✗ Could not save a copy: ' + ((e && e.message) || ''), true);
    }
}

function openPublishModal() { document.getElementById('publish-modal').style.display='flex'; renderPubRatingPicker(); }
function closePublish() { document.getElementById('publish-modal').style.display='none'; }

// collab co-create (mobile)
let _collabCurrentInvites = [];

function maybeShowCollabBtn() {
    // co button always visible now, kept as a no-op so call sites don't need updating
}

async function openCollabPanel() {
    // saves as a draft first if unsaved, so there's an id to invite people onto — collab can exist as draft-only, no publish needed
    if (!editingComicId && !activeDraftId) {
        await saveOffline(true);
        if (!activeDraftId) {
            alert('Could not save a draft to collaborate on. Check your connection and try again.');
            return;
        }
    }
    document.getElementById('collab-panel').style.display = 'flex';
    _loadCollabPanel();
}

// collab invite target: draft id if unpublished, comic id if live
function _collabTargetId() { return editingComicId || activeDraftId; }
function _collabTargetIsDraft() { return !editingComicId; }

// notify co-creator on save, debounced — bumps timestamp on an existing unread notification instead of piling up new rows every autosave
async function notifyCollabEdit(comicId, isDraft, comicTitle) {
    const handle = myHandle || JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
    const others = (_collabOwnerHandles || []).filter(h => h && h !== handle);
    if (!others.length || !comicId) return;
    for (const h of others) {
        try {
            const { data: existing } = await _supabase.from('mentions')
                .select('id')
                .eq('to_handle', h).eq('from_handle', handle)
                .eq('comic_id', String(comicId)).eq('type', 'collab_edit').eq('is_read', false)
                .maybeSingle();
            if (existing) {
                await _supabase.from('mentions').update({ created_at: new Date().toISOString() }).eq('id', existing.id);
            } else {
                await _supabase.from('mentions').insert([{
                    to_handle: h, from_handle: handle, type: 'collab_edit',
                    comic_id: String(comicId), is_draft: isDraft,
                    message_text: comicTitle || 'Untitled Comic', is_read: false
                }]);
            }
        } catch(e) { console.warn('notifyCollabEdit failed for', h, e); }
    }
}

function closeCollabPanel() {
    document.getElementById('collab-panel').style.display = 'none';
}

async function _loadCollabPanel() {
    const myHandle = JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
    if (!myHandle) return;
    const hintSquad = localStorage.getItem('collab_hint_squad') || '';
    if (hintSquad) localStorage.removeItem('collab_hint_squad');

    document.getElementById('collab-squad-select-wrap').innerHTML =
        '<div style="font-size:12px;color:#444;font-weight:700;">Loading squads…</div>';
    document.getElementById('collab-member-list').innerHTML = '';

    const [{ data: owned }, { data: memberships }] = await Promise.all([
        _supabase.from('team_tickets').select('id,team_name').eq('owner_handle', myHandle),
        _supabase.from('team_requests').select('ticket_id').eq('sender_handle', myHandle).eq('status', 'accepted')
    ]);

    const squadIds = [...new Set([
        ...(owned || []).map(s => String(s.id)),
        ...(memberships || []).map(m => String(m.ticket_id))
    ])];

    if (!squadIds.length) {
        document.getElementById('collab-squad-select-wrap').innerHTML =
            '<div style="font-size:12px;color:#444;font-weight:700;">You\'re not in any squads yet.</div>';
        return;
    }

    const { data: squads } = await _supabase.from('team_tickets')
        .select('id,team_name').in('id', squadIds);

    document.getElementById('collab-squad-select-wrap').innerHTML = `
        <select id="collab-squad-select"
            style="width:100%;background:#111;color:#f5f5f7;border:1px solid #2a2a2a;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;cursor:pointer;-webkit-appearance:none;"
            onchange="_loadCollabMembers(this.value)">
            <option value="">— pick a squad —</option>
            ${(squads || []).map(s => `<option value="${s.id}"${hintSquad && String(s.id) === String(hintSquad) ? ' selected' : ''}>${s.team_name}</option>`).join('')}
        </select>`;

    await _refreshCollabCurrent();

    // auto load squad members if pre-hinted
    if (hintSquad && (squads || []).find(s => String(s.id) === String(hintSquad))) {
        await _loadCollabMembers(hintSquad);
    }
}

async function _loadCollabMembers(squadId) {
    const myHandle = JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
    if (!squadId) { document.getElementById('collab-member-list').innerHTML = ''; return; }

    const [{ data: reqs }, { data: squad }] = await Promise.all([
        _supabase.from('team_requests').select('sender_handle').eq('ticket_id', squadId).eq('status', 'accepted'),
        _supabase.from('team_tickets').select('owner_handle').eq('id', squadId).single()
    ]);

    const members = [...new Set([
        squad?.owner_handle,
        ...(reqs || []).map(r => r.sender_handle)
    ])].filter(h => h && h !== myHandle);

    if (!members.length) {
        document.getElementById('collab-member-list').innerHTML =
            '<div style="font-size:12px;color:#444;font-weight:700;padding:8px 0;">No other members in this squad.</div>';
        return;
    }

    const alreadyInvited = _collabCurrentInvites.map(i => i.invitee_handle);

    document.getElementById('collab-member-list').innerHTML = members.map(h => `
        <div style="display:flex;align-items:center;justify-content:space-between;background:#111;border-radius:12px;padding:12px 14px;gap:10px;">
            <span style="font-size:14px;font-weight:700;color:#ccc;">@${h}</span>
            ${alreadyInvited.includes(h)
                ? `<span style="font-size:12px;color:#555;font-weight:800;">Invited ✓</span>`
                : `<button onclick="_sendCollabInvite('${h}','${squadId}',this)"
                     style="background:var(--accent);border:none;color:#000;font-size:12px;font-weight:900;border-radius:10px;padding:8px 16px;cursor:pointer;font-family:inherit;white-space:nowrap;-webkit-tap-highlight-color:transparent;">
                     + Invite
                   </button>`
            }
        </div>`).join('');
}

async function _sendCollabInvite(inviteeHandle, squadId, btn) {
    const myHandle = JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
    const comicTitle = document.getElementById('pub-title')?.value || 'Untitled';
    btn.disabled = true; btn.textContent = '…';

    // guard 1: must have a handle from localstorage
    if (!myHandle) {
        btn.disabled = false; btn.textContent = '+ Invite';
        alert('Could not read your handle. Please refresh and try again.');
        return;
    }

    // guard 2: verify supabase auth session is still live — rls checks uid, expired session fails regardless of data
    const { data: { session: _inviteSession } } = await _supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (!_inviteSession) {
        btn.disabled = false; btn.textContent = '+ Invite';
        alert('Your session has expired. Please reload the page and sign in again.');
        return;
    }

    // guard 3: ensure comic/draft id exists before insert — autosave failure could leave targetId null, violating NOT NULL + ownership check
    if (!editingComicId && !activeDraftId) {
        await saveOffline(true);
    }
    const targetId = _collabTargetId();
    const targetIsDraft = _collabTargetIsDraft();
    if (!targetId) {
        btn.disabled = false; btn.textContent = '+ Invite';
        alert('Could not save a draft to attach the invite to. Check your connection and try again.');
        return;
    }

    const { data: inviteRow, error } = await _supabase.from('comic_collaborators').insert([{
        comic_id:       targetId,
        is_draft:       targetIsDraft,
        comic_title:    comicTitle,
        inviter_handle: myHandle,
        invitee_handle: inviteeHandle,
        squad_id:       String(squadId),
        status:         'pending'
    }]).select('id').single();

    if (error) {
        btn.disabled = false; btn.textContent = '+ Invite';
        // debug log: which rls policy rejected it, hidden from the generic user-facing alert below
        console.error('comic_collaborators insert failed:', {
            code: error.code, message: error.message, details: error.details, hint: error.hint
        });
        // better error messages for rls failures
        const msg = error.message || '';
        if (msg.includes('row-level security') || error.code === '42501') {
            alert('Permission denied: your session may have expired, or you don\'t have permission to invite collaborators to this comic. Try reloading the page.');
        } else {
            alert('Error: ' + msg);
        }
        return;
    }

    // post invite to squad chat
    try {
        const chatPayload = JSON.stringify({
            invite_id:      inviteRow.id,
            comic_id:       targetId,
            is_draft:       targetIsDraft,
            comic_title:    comicTitle,
            inviter_handle: myHandle,
            invitee_handle: inviteeHandle
        });
        await _supabase.from('team_messages').insert([{
            ticket_id:      squadId,
            sender_handle:  myHandle,
            content:        `[COLLAB_INVITE]:${chatPayload}`
        }]);
    } catch(e) { /* non-fatal */ }

    btn.textContent = 'Invited ✓';
    btn.style.background = '#1e1e1e';
    btn.style.color = '#555';
    btn.style.border = '1px solid #2a2a2a';
    await _refreshCollabCurrent();
}

async function _refreshCollabCurrent() {
    const { data } = await _supabase
        .from('comic_collaborators')
        .select('invitee_handle,status')
        .eq('comic_id', _collabTargetId())
        .eq('is_draft', _collabTargetIsDraft());

    _collabCurrentInvites = data || [];
    const el = document.getElementById('collab-current');
    if (!_collabCurrentInvites.length) { el.innerHTML = ''; return; }

    const statusColor = { accepted: '#32d74b', declined: '#ff453a', pending: '#ff7a00' };
    const statusLabel = { accepted: '✅ Accepted', declined: '❌ Declined', pending: '⏳ Pending' };

    el.innerHTML = `
        <div style="font-size:10px;font-weight:900;color:#333;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;border-top:1px solid #2a2a2a;padding-top:12px;">Co-creators</div>
        ${_collabCurrentInvites.map(i => `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:14px;color:#ccc;font-weight:700;">@${i.invitee_handle}</span>
                <span style="font-size:12px;font-weight:800;color:${statusColor[i.status] || '#555'};">
                    ${statusLabel[i.status] || i.status}
                </span>
            </div>`).join('')}`;
}
// end collab
async function finalPublish() {
    const btn = document.getElementById('publish-btn');
    const title = document.getElementById('pub-title').value.trim();
    if (!title) { alert('Please enter a title.'); return; }
    btn.disabled = true; btn.innerText = editingComicId ? 'UPDATING...' : 'POSTING...';
    // auto-gen cover from frame 0 if none
    if (!finalCoverBase64) {
        try {
            btn.innerText = 'Generating cover…';
            const f0 = frames[0];
            const _r = getFrameRatio(f0);
            const ar = _r.w / _r.h;
            const sz = 800;
            const hw = ar >= 1 ? sz : Math.round(sz * ar);
            const hh = ar <= 1 ? sz : Math.round(sz / ar);
            const offscreen = await renderFrameToCanvas(f0, hw, hh);
            finalCoverBase64 = offscreen.toDataURL('image/jpeg', 0.88);
            const img = document.getElementById('final-cover-img');
            img.src = finalCoverBase64; img.style.display = 'block';
            document.getElementById('cover-label').style.display = 'none';
        } catch(e) {
            alert('Could not auto-generate cover. Please upload one manually.');
            btn.disabled = false; btn.innerText = editingComicId ? 'UPDATE' : 'POST NOW';
            return;
        }
    }
    // upload cover if still base64
    if (finalCoverBase64.startsWith('data:')) {
        btn.innerText = 'Uploading cover…';
        const uploaded = await uploadCoverToStorage(finalCoverBase64);
        if (uploaded) finalCoverBase64 = uploaded;
    }
    try {
        const { data: { session: _cm2 } } = await _supabase.auth.getSession();
        const user = _cm2?.user ?? null;
        if (!user) { alert('Not logged in.'); btn.disabled=false; btn.innerText='POST NOW'; return; }
        const pubHandle = (typeof myHandle !== 'undefined' && myHandle)
            ? myHandle
            : (JSON.parse(localStorage.getItem('user_profile') || '{}').handle || user.email || 'unknown');
        const tags = document.getElementById('pub-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
        const desc = document.getElementById('pub-desc').value.trim();
        // fixed: same stamp race as create.html — fresh array, never mutate live frames, before supabase serializes
        const stamped = getStampedFrames();
        // catch leftover base64 image layers (crop re-rasterize discarding an earlier upload) before it's invisible in reader
        const hasUnuploadedLayer = stamped.some(f => (f.layers || []).some(l =>
            l.type === 'img' && ((l.src && l.src.startsWith('data:')) || (l._fxSrc && l._fxSrc.startsWith('data:')))));
        if (hasUnuploadedLayer) btn.innerText = 'Uploading artwork…';
        const finalFrames = await ensureLayerImagesUploaded(stamped);
        if (ensureLayerImagesUploaded._lastFailCount > 0) {
            showToast('⚠ ' + ensureLayerImagesUploaded._lastFailCount + ' image(s) failed to upload — re-save once your connection is stable');
        }

        // large-comic safety net (same pattern as saveOffline for drafts): publish used to inline everything in one statement, blows supabase's timeout past ~100 frames — ships to storage as a binary upload instead once over the inline limit
        const newComicId = editingComicId || crypto.randomUUID();
        const framesJson = JSON.stringify(finalFrames);
        let dataField = finalFrames, storagePathField = null;
        if (framesJson.length > _INLINE_LIMIT) {
            btn.innerText = 'Uploading frames…';
            const path = `${_PUBLISH_PREFIX}${newComicId}.json`;
            const { error: upErr } = await _supabase.storage
                .from(_DRAFT_BUCKET)
                .upload(path, new Blob([framesJson], { type: 'application/json' }), { upsert: true });
            if (upErr) throw upErr;
            dataField = null;
            storagePathField = path;
            btn.innerText = editingComicId ? 'UPDATING...' : 'POSTING...';
        }

        // canvas_ratio = frame 1's ratio, used as cover/back-compat/fallback regardless of which frame publish was tapped from
        const payload = { data: dataField, storage_path: storagePathField, cover: finalCoverBase64, title, tags, description: desc, canvas_ratio: getFrameRatio(frames[0]), age_rating: pubSelectedRating };
        let error, publishedId;
        if (editingComicId) {
            // owner_handle intentionally untouched here (set once at creation) — updating on every save would silently reassign ownership
            ({ error } = await _supabase.from('comics').update(payload).eq('id', editingComicId));
            publishedId = editingComicId;
            if (!error) notifyCollabEdit(editingComicId, false, title);
        } else {
            // carry collab draft collaborators over to the published comic instead of dropping to solo
            let publishOwners = [pubHandle];
            if (activeDraftId) {
                try {
                    const { data: draftRow } = await _supabase.from('drafts').select('owner_handles').eq('id', activeDraftId).maybeSingle();
                    if (draftRow?.owner_handles?.length) {
                        publishOwners = Array.from(new Set([...draftRow.owner_handles, pubHandle]));
                    }
                } catch(e) { /* fall back to solo ownership */ }
            }
            const res = await _supabase.from('comics').insert([{ id: newComicId, ...payload, owner_name: pubHandle, owner_handle: pubHandle, owner_handles: publishOwners }]).select('id').single();
            error = res.error;
            publishedId = res.data?.id;
            // repoint draft invites to the published comic so they keep working, and my-comics' Collab tab doesn't show a dead link
            if (!error && activeDraftId) {
                await Promise.resolve(_supabase.from('comic_collaborators')
                    .update({ comic_id: publishedId, is_draft: false, comic_title: title })
                    .eq('comic_id', activeDraftId).eq('is_draft', true)).catch(() => {});
            }
        }
        if (error) { alert('Error: ' + error.message); btn.disabled=false; btn.innerText=editingComicId?'UPDATE':'POST NOW'; return; }
        // clean up stale blob once superseded/replaced by the fresh one written above
        if (loadedComicStoragePath && loadedComicStoragePath !== storagePathField) {
            await _supabase.storage.from(_DRAFT_BUCKET).remove([loadedComicStoragePath]).catch(() => {});
        }
        loadedComicStoragePath = storagePathField;
        // clean up draft after publish
        if (activeDraftId) {
            const storagePath = localStorage.getItem('active_draft_storage_path');
            // fixed: .delete() is thenable-only, needs Promise.resolve() wrapping
            await Promise.resolve(_supabase.from('drafts').delete().eq('id', activeDraftId)).catch(() => {});
            if (storagePath) await _supabase.storage.from('comiccore-assets').remove([storagePath]).catch(() => {});
            localStorage.removeItem('active_draft_id');
            localStorage.removeItem('active_draft_storage_path');
        }
        localStorage.removeItem('edit_source_comic_id');
        hasUnsavedChanges = false;
        // fixed: wasn't awaiting _generateFrameSnapshots — location.href aborted the in-flight upload before it finished. Alert used to fire too early too (looked frozen on big comics); now waits for real completion and shows a corner progress ring/eta instead
        if (publishedId) {
            const showWidget = frames.length > 20;
            const startTime = Date.now();
            if (showWidget) { showPublishProgressWidget(finalCoverBase64); btn.innerText = 'Finishing up…'; }
            await _generateFrameSnapshots(publishedId, (done, total) => {
                if (showWidget) updatePublishProgressWidget(done, total, startTime);
            }).catch(() => {});
            if (showWidget) hidePublishProgressWidget();
        }
        // fixed: alert()+redirect looked frozen on mobile (native dialog is flaky, alert() blocks JS until tapped). Toast + nav right after doesn't block anything
        showToast(editingComicId ? 'Comic updated!' : 'Published to Discover!');
        setTimeout(() => { location.href = 'discover.html'; }, 700);
    } catch (err) {
        console.error('finalPublish error:', err);
        hidePublishProgressWidget();
        alert('Publish failed: ' + (err.message || 'Unknown error'));
        btn.disabled = false;
        btn.innerText = editingComicId ? 'UPDATE' : 'POST NOW';
    }
}

// a baked jpeg can only ever hold one still frame, so anything with an animated bg/sprite has to skip snapshotting entirely or publish would silently flatten the animation. reuses the same isAnimatedBg() as the live editor so it means the same thing in both places
function frameHasAnimatedMedia(f) {
    if (isAnimatedBg(f.background)) return true;
    return (f.layers || []).some(l => l.type === 'img' && (isAnimatedBg(l.src) || isAnimatedBg(l._fxSrc)));
}

// generates frame snapshots on mobile — renders frames, uploads jpegs, saves urls so the reader can instant-flip. animated frames get skipped on purpose, reader just falls back to a live dom render for those so the animation still plays
async function _generateFrameSnapshots(comicId, onProgress) {
    const SNAP_SIZE = 1200;
    // snapshot dims computed per frame (own ratio now) instead of once for the whole comic
    let upsertRows = [];
    let completed = 0;
    let animatedIdx = [];

    // flush in chunks not one big upsert (same timeout issue as the frames jsonb) — grab-and-clear is atomic in JS's single-threaded loop so it's safe to call concurrently, no row double-flushed or dropped
    async function flushSnapshotRows() {
        if (!upsertRows.length) return;
        const rows = upsertRows;
        upsertRows = [];
        // fixed: .upsert() thenable-only
        await Promise.resolve(_supabase.from('frame_snapshots')
            .upsert(rows, { onConflict: 'comic_id,frame_idx' })).catch((e) => console.warn('Snapshot batch upsert failed:', e));
    }

    // render+upload in small parallel batches — mostly i/o, fully sequential would leave the app looking frozen for minutes on a several-hundred-frame comic
    const CONCURRENT_LIMIT = 6;
    async function processFrame(i) {
        try {
            if (frameHasAnimatedMedia(frames[i])) {
                // don't bake this one — see frameHasAnimatedMedia comment above
                animatedIdx.push(i);
                completed++;
                if (onProgress) onProgress(completed, frames.length);
                return;
            }
            const r = getFrameRatio(frames[i]);
            const ar = (r && r.w && r.h) ? r.w / r.h : 1;
            const snapW = ar >= 1 ? SNAP_SIZE : Math.round(SNAP_SIZE * ar);
            const snapH = ar <= 1 ? SNAP_SIZE : Math.round(SNAP_SIZE / ar);
            const offscreen = await renderFrameToCanvas(frames[i], snapW, snapH);
            const blob = await new Promise(res => offscreen.toBlob(res, 'image/jpeg', 0.88));
            if (!blob) { console.warn('Frame snapshot ' + i + ': toBlob() returned null'); return; }
            const path = `snapshots/${comicId}/${i}.jpg`;
            const { error: upErr } = await _supabase.storage
                .from('comiccore-assets')
                .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
            if (upErr) { console.warn('Frame snapshot ' + i + ' upload failed:', upErr); return; }
            const { data: urlData } = _supabase.storage.from('comiccore-assets').getPublicUrl(path);
            if (urlData?.publicUrl) {
                upsertRows.push({ comic_id: comicId, frame_idx: i, url: urlData.publicUrl + '?t=' + Date.now() });
            }
        } catch(e) { console.warn('Frame snapshot ' + i + ' threw — falling back to DOM render for this frame:', e); }
        completed++;
        if (onProgress) onProgress(completed, frames.length);
        if (upsertRows.length >= _SNAPSHOT_CHUNK) await flushSnapshotRows();
    }

    for (let start = 0; start < frames.length; start += CONCURRENT_LIMIT) {
        const batch = [];
        for (let i = start; i < Math.min(start + CONCURRENT_LIMIT, frames.length); i++) batch.push(processFrame(i));
        await Promise.all(batch);
    }

    await flushSnapshotRows();

    // cleans up stale snapshots left from an earlier publish, like a frame that used to be a static image and got a jpeg but is now a gif. without this the old row keeps winning even though it should animate now
    if (animatedIdx.length) {
        await Promise.resolve(_supabase.from('frame_snapshots')
            .delete().eq('comic_id', comicId).in('frame_idx', animatedIdx))
            .catch((e) => console.warn('Stale snapshot cleanup failed:', e));
    }
}
// end frame snapshots / export
function openExportModal() { document.getElementById('export-modal').style.display='flex'; openExportFramesTab(); }
function closeExportModal() { document.getElementById('export-modal').style.display='none'; }
function switchExportTab(tab) {
    document.querySelectorAll('.export-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.export-section').forEach(s=>s.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('export-'+tab).classList.add('active');
    if (tab === 'frames') openExportFramesTab();
}
// export-time panel helpers, kept separate from the editor's own findContainingPanel/applyPanelClip since batch export walks other frames, not just the current one
function findContainingPanelInFrame(frame, x, y, w, h) {
    const panels = frame.layers.filter(l => l.type === 'panel');
    if (!panels.length) return null;
    let best = null, bestArea = 0;
    panels.forEach(p => {
        const ox = Math.max(0, Math.min(x + w, p.x + p.w) - Math.max(x, p.x));
        const oy = Math.max(0, Math.min(y + h, p.y + p.h) - Math.max(y, p.y));
        const area = ox * oy;
        if (area > bestArea) { bestArea = area; best = p; }
    });
    return best;
}
function drawPanelShapeOnCanvas(ctx, layer, scaleX, scaleY) {
    const x = (layer.x || 0) * scaleX, y = (layer.y || 0) * scaleY;
    const w = (layer.w || 0) * scaleX, h = (layer.h || 0) * scaleY;
    const bw = (layer.borderWidth != null ? layer.borderWidth : 4) * scaleX;
    const rad = (layer.radius || 0) * scaleX;
    const fill = layer.fill || 'transparent';
    const rr = (rx, ry, rw, rh, r) => {
        r = Math.max(0, Math.min(r, rw / 2, rh / 2));
        ctx.beginPath();
        ctx.moveTo(rx + r, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
        ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
        ctx.arcTo(rx, ry + rh, rx, ry, r);
        ctx.arcTo(rx, ry, rx + rw, ry, r);
        ctx.closePath();
    };
    ctx.save();
    if (fill && fill !== 'transparent') {
        rr(x, y, w, h, rad);
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (bw > 0) {
        rr(x + bw / 2, y + bw / 2, Math.max(0, w - bw), Math.max(0, h - bw), Math.max(0, rad - bw / 2));
        ctx.lineWidth = bw;
        ctx.strokeStyle = layer.panelBorderColor || '#000000';
        ctx.stroke();
    }
    ctx.restore();
}

// embeds ComicCluck into the export SVG, since page fonts don't load inside SVG images
let _ccFontB64 = null;
async function ccFontStyleTag(ff) {
    if (!/ComicCluck/.test(ff || '')) return '';
    try { await document.fonts.load("20px 'ComicCluck'"); } catch (e) {}
    try {
        if (!_ccFontB64) {
            const u8 = new Uint8Array(await (await fetch('css/fonts/ComicCluck-Regular.woff2')).arrayBuffer());
            let bin = '';
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            _ccFontB64 = btoa(bin);
        }
        return `<style>@font-face{font-family:'ComicCluck';src:url(data:font/woff2;base64,${_ccFontB64}) format('woff2');font-weight:100 900;}</style>`;
    } catch (e) { return ''; }
}

async function renderFrameToCanvas(frame, cw, ch) {
    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    const ctx = tmp.getContext('2d');
    const bg = frame.background || '#ffffff';
    const s = frame.bgSettings || {};
    const scale  = typeof s.scale === 'number' ? s.scale : 1;
    const xOff   = s.x      ?? 0;
    const yOff   = s.y      ?? 0;
    const rot    = s.rotate ?? 0;
    const isImg  = bg.startsWith('http') || bg.startsWith('data:image');
    const isGrad = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient');

    // fixed: layer coords are per-frame canvas size (own ratio), not a fixed reference like desktop's BASE_SIZE=900. Was dividing by the live/open frame's size, wrong for every other frame in a batch export — now recomputes each frame's own source size from its stored ratio
    const _r = getFrameRatio(frame);
    const _src = computeCanvasSize(_r.w, _r.h);
    const scaleX = cw / (_src.cw || cw);
    const scaleY = ch / (_src.ch || ch);

    // background: bgFx mirrors sprite fx, combined with the bg sheet filter chip
    const bgFx = frame.bgFx || {};
    const bgFxCSS = getSpriteFilterCSS(bgFx);
    const bgFxChipCSS = (bgFx.fxFilter && bgFx.fxFilter !== 'none') ? bgFx.fxFilter : '';
    const combinedBgFilter = [(s.filter && s.filter !== 'none') ? s.filter : '', bgFxCSS, bgFxChipCSS].filter(Boolean).join(' ');
    const bgAlpha = (bgFx.fxOpacity != null) ? bgFx.fxOpacity / 100 : 1;
    const bgHasFxSrc = !!bgFx._fxSrc;
    const bgFxStrength = (bgFx.blurStrength != null) ? bgFx.blurStrength : 100;

    await new Promise(res => {
        if (isImg) {
            const drawBgImage = (src, alpha, applyFilter) => new Promise(res2 => {
                const img = new Image(); img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const imgAR = img.naturalWidth / img.naturalHeight;
                    const canvasAR = cw / ch;
                    // base cover size fills the canvas on one axis and overflows the other, matches object-fit:cover at scale 1. when bgSettings.fit is on (frame importer) it does the opposite, contain + letterbox, mirrors the fit branch in render()
                    let baseW, baseH;
                    if (s.fit) {
                        if (imgAR > canvasAR) { baseW = cw; baseH = baseW / imgAR; }
                        else { baseH = ch; baseW = baseH * imgAR; }
                    } else if (imgAR > canvasAR) { baseH = ch; baseW = baseH * imgAR; }
                    else { baseW = cw; baseH = baseW / imgAR; }
                    // no overscan, just pure cover-fit minimum matching the live canvas, pan room comes from the overflow plus user zoom above 1
                    const drawW = baseW * scale;
                    const drawH = baseH * scale;
                    // pans within the covered overflow like css object-position, always gap-free since drawW/H is always >= canvas size, so this works even at default zoom now, not just when zoomed in
                    const posXfrac = Math.max(0, Math.min(100, 50 + xOff / 2)) / 100;
                    const posYfrac = Math.max(0, Math.min(100, 50 + yOff / 2)) / 100;
                    const posX = (cw - drawW) * posXfrac;
                    const posY = (ch - drawH) * posYfrac;
                    ctx.save();
                    if (applyFilter && combinedBgFilter) ctx.filter = combinedBgFilter;
                    if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') ctx.globalCompositeOperation = canvasBlendMode(bgFx.fxBlend);
                    ctx.globalAlpha = alpha;
                    ctx.translate(cw / 2, ch / 2);
                    ctx.rotate(rot * Math.PI / 180);
                    ctx.translate(-cw / 2, -ch / 2);
                    ctx.drawImage(img, posX, posY, drawW, drawH);
                    ctx.restore();
                    ctx.filter = 'none'; ctx.globalAlpha = 1;
                    res2();
                };
                img.onerror = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); res2(); };
                img.src = src;
            });
            (async () => {
                if (bgHasFxSrc && bgFxStrength < 100) {
                    // blend: base + fx overlay (matches sprite layer FX)
                    await drawBgImage(bg, bgAlpha, false);
                    await drawBgImage(bgFx._fxSrc, bgAlpha * bgFxStrength / 100, false);
                } else if (bgHasFxSrc) {
                    await drawBgImage(bgFx._fxSrc, bgAlpha, false);
                } else {
                    await drawBgImage(bg, bgAlpha, true);
                }
                res();
            })();
        } else if (isGrad) {
            // render gradient via svg foreignobject
            const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}">
                <foreignObject width="100%" height="100%">
                    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${cw}px;height:${ch}px;background:${bg.replace(/"/g,"'")};">
                    </div>
                </foreignObject>
            </svg>`;
            const blob = new Blob([svgStr], { type: 'image/svg+xml' });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = () => {
                ctx.save();
                if (combinedBgFilter) ctx.filter = combinedBgFilter;
                if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') ctx.globalCompositeOperation = canvasBlendMode(bgFx.fxBlend);
                ctx.globalAlpha = bgAlpha;
                ctx.drawImage(img, 0, 0, cw, ch);
                ctx.restore();
                ctx.filter = 'none'; ctx.globalAlpha = 1;
                URL.revokeObjectURL(url); res();
            };
            img.onerror = () => { ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, cw, ch); URL.revokeObjectURL(url); res(); };
            img.src = url;
        } else {
            ctx.save();
            if (combinedBgFilter) ctx.filter = combinedBgFilter;
            if (bgFx.fxBlend && bgFx.fxBlend !== 'normal') ctx.globalCompositeOperation = canvasBlendMode(bgFx.fxBlend);
            ctx.globalAlpha = bgAlpha;
            ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
            ctx.restore();
            ctx.filter = 'none'; ctx.globalAlpha = 1;
            res();
        }
    });

    // background color fx export overlay
    if (bgFx.colorFx && bgFx.colorFx.enabled) {
        renderColorFxOnCanvas(ctx, bgFx, 0, 0, cw, ch);
    }

    // layers
    for (const layer of frame.layers) {
        if (layer.type === 'panel') {
            drawPanelShapeOnCanvas(ctx, layer, scaleX, scaleY);
            continue;
        }
        // clips to whichever panel this layer overlaps most, same as the editor's live preview
        const _lw = layer.w || 100;
        const _lh = layer.h != null ? layer.h : _lw;
        const _panel = findContainingPanelInFrame(frame, layer.x || 0, layer.y || 0, _lw, _lh);
        if (_panel) {
            const pbw = _panel.borderWidth != null ? _panel.borderWidth : 4;
            ctx.save();
            ctx.beginPath();
            ctx.rect((_panel.x + pbw) * scaleX, (_panel.y + pbw) * scaleY, Math.max(0, _panel.w - pbw * 2) * scaleX, Math.max(0, _panel.h - pbw * 2) * scaleY);
            ctx.clip();
        }
        if (layer.type === 'img') {
            const bStrength  = (layer.blurStrength != null) ? layer.blurStrength : 100;
            const baseOpacity = (layer.fxOpacity != null ? layer.fxOpacity / 100 : 1);
            const cssFilt    = getSpriteFilterCSS(layer);
            const lfCSS      = (layer.fxFilter && layer.fxFilter !== 'none') ? layer.fxFilter : '';
            const combinedCSS = [cssFilt, lfCSS].filter(Boolean).join(' ') || '';

            const drawLayerSrc = (src, alpha, applyCSS) => new Promise(res => {
                const img = new Image(); img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
                    const lw0 = layer.w || 100;
                    const lh0 = layer.h != null ? layer.h : lw0 * (ih / iw);
                    const lw = lw0 * scaleX, lh = lh0 * scaleY;
                    const cx = (layer.x || 0) * scaleX + lw / 2, cy = (layer.y || 0) * scaleY + lh / 2;
                    ctx.save();
                    if (applyCSS && combinedCSS) ctx.filter = combinedCSS;
                    if (layer.fxBlend && layer.fxBlend !== 'normal') ctx.globalCompositeOperation = canvasBlendMode(layer.fxBlend);
                    ctx.globalAlpha = alpha;
                    ctx.imageSmoothingEnabled = false; // crisp sprites in exported/published frames, matching the live canvas
                    ctx.translate(cx, cy);
                    ctx.rotate((layer.rotation || 0) * Math.PI / 180);
                    if (layer.flipped) ctx.scale(-1, 1);
                    ctx.drawImage(img, -lw / 2, -lh / 2, lw, lh);
                    ctx.restore();
                    ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
                    res();
                };
                img.onerror = res; img.src = src;
            });

            if (layer._fxSrc && bStrength < 100) {
                await drawLayerSrc(layer.src,    baseOpacity,                false);
                await drawLayerSrc(layer._fxSrc, baseOpacity * bStrength/100, false);
            } else if (layer._fxSrc) {
                await drawLayerSrc(layer._fxSrc, baseOpacity, false);
            } else {
                await drawLayerSrc(layer.src, baseOpacity, true);
            }
            // color fx export overlay
            if (layer.colorFx && layer.colorFx.enabled) {
                const lx = (layer.x || 0) * scaleX, ly = (layer.y || 0) * scaleY;
                const lw = (layer.w || 100) * scaleX, lh = (layer.h != null ? layer.h : layer.w) * scaleY;
                renderColorFxOnCanvas(ctx, layer, lx, ly, lw, lh);
            }
        } else {
            // text/bubble: render via svg foreignobject
            const bx = (layer.x || 0) * scaleX, by = (layer.y || 0) * scaleY;
            const bw = (layer.w || 160) * scaleX;
            const fs = Math.round((layer.fontSize || (layer.type === 'subtitle' ? 16 : 22)) * scaleX);
            const ff = layer.fontFamily || "'Inter', sans-serif";
            const boldW    = layer.bold   ? '900' : '800';
            const italicS  = layer.italic ? 'italic' : 'normal';
            const deco     = [layer.underline ? 'underline' : '', layer.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
            const alignS   = layer.align  || 'center';
            const textColor = layer.color || '#000';
            const outlineS  = layer.outline ? textOutlineCSS(fs, layer.outlineWidth != null ? layer.outlineWidth * scaleX : null) : '';

            let innerHtml = '';
            if (layer.type === 'bubble' || layer.type === 'thinking') {
                const bStyle    = layer.bubbleStyle || (layer.type === 'thinking' ? 'cloud' : 'round');
                const bubBg     = layer.bubbleBg || (bStyle === 'shout' ? '#ffeb3b' : bStyle === 'narrator' ? '#fffde7' : '#fff');
                const bubBorder = layer.bubbleBorderColor || '#000';
                const showTail  = !['spiky','shout','electric','narrator','cloud'].includes(bStyle);
                const isCloud   = bStyle === 'cloud';

                const thoughtDots = isCloud
                    ? `<div style="position:absolute;width:12px;height:12px;bottom:-20px;left:24px;background:${bubBg};border:3px solid ${bubBorder};border-radius:50%;"></div>
                       <div style="position:absolute;width:8px;height:8px;bottom:-32px;left:18px;background:${bubBg};border:2.5px solid ${bubBorder};border-radius:50%;"></div>
                       <div style="position:absolute;width:5px;height:5px;bottom:-40px;left:13px;background:${bubBg};border:2px solid ${bubBorder};border-radius:50%;"></div>` : '';

                let tailHtml = '';
                if (showTail) {
                    tailHtml = bubbleTailHTML(bStyle, getBubbleTailEdge(layer), getBubbleTailPos(layer, bStyle), bubBorder, bubBg);
                }

                const clipPaths = {
                    spiky:    'polygon(50% 0%,58.28% 19.09%,75% 6.7%,72.63% 27.37%,93.3% 25%,80.91% 41.72%,100% 50%,80.91% 58.28%,93.3% 75%,72.63% 72.63%,75% 93.3%,58.28% 80.91%,50% 100%,41.72% 80.91%,25% 93.3%,27.37% 72.63%,6.7% 75%,19.09% 58.28%,0% 50%,19.09% 41.72%,6.7% 25%,27.37% 27.37%,25% 6.7%,41.72% 19.09%)',
                    shout:    'polygon(5% 10%,20% 0%,35% 10%,50% 0%,65% 10%,80% 0%,95% 10%,100% 30%,95% 50%,100% 70%,95% 90%,80% 100%,65% 90%,50% 100%,35% 90%,20% 100%,5% 90%,0% 70%,5% 50%,0% 30%)',
                    electric: 'polygon(8% 0%,92% 0%,100% 8%,100% 92%,92% 100%,65% 100%,60% 115%,52% 100%,8% 100%,0% 92%,0% 8%)',
                };
                const isBurst       = bStyle === 'spiky' || bStyle === 'shout';
                const clipStyle     = clipPaths[bStyle] ? `clip-path:${clipPaths[bStyle]};` : '';
                const borderRadius  = bStyle === 'cloud' ? '50%' : bStyle === 'chat' ? '18px' : bStyle === 'rect' ? '4px' : bStyle === 'narrator' ? '6px' : '999px';
                const extraBorder   = bStyle === 'narrator' ? `border-left:6px solid ${bubBorder};` : '';

                if (isBurst) {
                    // two-layer outline for clipped shapes: outer border + inset inner shape painted in bubble color, since a plain border only paints literal box edges not the zigzag
                    innerHtml = `<div style="background:${bubBorder};${clipStyle}padding:6px;width:${bw}px;box-sizing:border-box;"><div style="font-family:${ff};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};text-decoration:${deco};color:${textColor};text-align:${alignS};background:${bubBg};${clipStyle}padding:14px 18px;box-sizing:border-box;width:100%;${outlineS}">${layer.content || ''}</div></div>`;
                } else {
                    innerHtml = `<div style="font-family:${ff};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};text-decoration:${deco};color:${textColor};text-align:${alignS};background:${bubBg};border:3.5px solid ${bubBorder};border-radius:${borderRadius};padding:14px 18px;position:relative;overflow:visible;word-wrap:break-word;line-height:1.35;box-sizing:border-box;width:${bw}px;${clipStyle}${extraBorder}${outlineS}">${layer.content || ''}${tailHtml}${thoughtDots}</div>`;
                }
            } else if (layer.type === 'subtitle') {
                const nameColor = layer.nameColor || '#ff9500';
                const subFs = Math.round(fs * 0.55);
                innerHtml = `<div style="width:${bw}px;box-sizing:border-box;"><div style="background:${nameColor};color:#fff;font-size:${Math.max(10,subFs)}px;font-weight:900;font-family:${ff};padding:3px 10px;border-radius:5px 5px 0 0;letter-spacing:1px;text-transform:uppercase;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${layer.characterName || 'CHARACTER'}</div><div style="background:rgba(255,255,255,0.96);color:${textColor};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};font-family:${ff};padding:6px 10px;border-radius:0 0 5px 5px;text-align:${alignS};line-height:1.4;border:1.5px solid rgba(0,0,0,0.1);border-top:none;box-sizing:border-box;${outlineS}">${layer.content || ''}</div></div>`;
            } else {
                innerHtml = `<div style="font-family:${ff};font-size:${fs}px;font-weight:${boldW};font-style:${italicS};text-decoration:${deco};color:${textColor};text-align:${alignS};white-space:pre-wrap;word-wrap:break-word;line-height:1.3;width:${bw}px;box-sizing:border-box;${outlineS}">${(layer.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
            }

            // word wrap text to maxWidth
            const wrapLines = (text, maxWidth) => {
                const words = String(text || '').split(/\s+/).filter(Boolean);
                const lines = []; let cur = '';
                words.forEach(w => {
                    const test = cur ? cur + ' ' + w : w;
                    if (cur && ctx.measureText(test).width > maxWidth) { lines.push(cur); cur = w; }
                    else cur = test;
                });
                if (cur) lines.push(cur);
                return lines.length ? lines : [''];
            };
            // draw text box on canvas directly — SVG foreignObject silently fails to rasterize on WebKit/Safari (known iOS limitation)
            const drawFallback = () => {
                ctx.save();
                ctx.textBaseline = 'top';
                const pad = 12, innerW = Math.max(20, bw - pad * 2);
                const fontStr = `${boldW} ${fs}px ${ff.replace(/['"]/g,'')}`;
                if (layer.type === 'bubble' || layer.type === 'thinking') {
                    ctx.font = fontStr;
                    const lines = wrapLines(layer.content, innerW);
                    const lineH = fs * 1.3;
                    const boxH = Math.max(fs + pad * 2, lines.length * lineH + pad * 2);
                    ctx.fillStyle = layer.bubbleBg || '#fff';
                    ctx.fillRect(bx, by, bw, boxH);
                    ctx.strokeStyle = layer.bubbleBorderColor || '#000';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(bx, by, bw, boxH);
                    ctx.fillStyle = textColor;
                    lines.forEach((line, i) => ctx.fillText(line, bx + pad, by + pad + i * lineH, innerW));
                } else if (layer.type === 'subtitle') {
                    const subFs = Math.max(10, Math.round(fs * 0.55)), nameH = subFs + 12;
                    ctx.fillStyle = layer.nameColor || '#ff9500';
                    ctx.fillRect(bx, by, bw, nameH);
                    ctx.font = `900 ${subFs}px ${ff.replace(/['"]/g,'')}`;
                    ctx.fillStyle = '#fff';
                    ctx.fillText((layer.characterName || 'CHARACTER').toUpperCase(), bx + pad, by + 6, innerW);
                    ctx.font = fontStr;
                    const lines = wrapLines(layer.content, innerW);
                    const lineH = fs * 1.3;
                    const dialogH = Math.max(lineH, lines.length * lineH) + pad;
                    ctx.fillStyle = 'rgba(255,255,255,0.96)';
                    ctx.fillRect(bx, by + nameH, bw, dialogH);
                    ctx.fillStyle = textColor;
                    lines.forEach((line, i) => ctx.fillText(line, bx + pad, by + nameH + 6 + i * lineH, innerW));
                } else {
                    ctx.font = fontStr;
                    ctx.fillStyle = textColor;
                    const lines = wrapLines(layer.content, bw);
                    const lineH = fs * 1.3;
                    lines.forEach((line, i) => ctx.fillText(line, bx, by + i * lineH, bw));
                }
                ctx.restore();
            };
            const ccStyle = await ccFontStyleTag(ff);
            await new Promise(res => {
                let settled = false, url = null;
                const finish = () => {
                    if (settled) return;
                    settled = true; clearTimeout(timer);
                    if (url) URL.revokeObjectURL(url);
                    res();
                };
                // safety net: svg might not fire onload, ios safari can stall — fall back to plain canvas after timeout
                const timer = setTimeout(() => { if (!settled) { drawFallback(); finish(); } }, 1800);
                try {
                    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw + 60}" height="${ch}">
                        ${ccStyle}
                        <foreignObject width="${bw + 60}" height="${ch}">
                            <div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;overflow:visible;">${innerHtml}</div>
                        </foreignObject>
                    </svg>`;
                    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                    url = URL.createObjectURL(blob);
                    const img  = new Image();
                    img.onload = () => {
                        if (settled) return;
                        ctx.save();
                        if (layer.fxBlend && layer.fxBlend !== 'normal') ctx.globalCompositeOperation = canvasBlendMode(layer.fxBlend);
                        ctx.drawImage(img, bx, by);
                        ctx.restore();
                        finish();
                    };
                    img.onerror = () => { if (!settled) { drawFallback(); finish(); } };
                    img.src = url;
                } catch(e) { drawFallback(); finish(); }
            });
        }
        if (_panel) ctx.restore();
    }
    return tmp;
}

async function mobileDownload(dataUrl, filename) {
    // iOS Safari ignores <a download> and window.open(dataUrl) just opens a raw blob tab — navigator.share({files}) is the only reliable save path there. Android uses <a download> natively; data-url-in-new-tab is the last resort
    try {
        const res  = await fetch(dataUrl);
        const blob = await res.blob();
        const ext  = filename.split('.').pop() || 'png';
        const mime = blob.type || ('image/' + ext);
        const file = new File([blob], filename, { type: mime });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return;
        }
    } catch(shareErr) { /* share cancelled or not supported — fall through */ }
    // android/desktop download via anchor click
    try {
        var a = document.createElement('a');
        a.href = dataUrl; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        return;
    } catch(e) {}
    // last resort: open in new tab
    window.open(dataUrl, '_blank');
}

async function exportGIF() {
    var statusEl=document.getElementById('gif-status');
    var fillEl=document.getElementById('gif-progress-fill');
    var barEl=document.getElementById('gif-progress-bar');
    var resultWrap=document.getElementById('gif-result-wrap');
    var btn=document.getElementById('gif-generate-btn');
    resultWrap.style.display='none'; barEl.style.display='block'; fillEl.style.width='0%';
    statusEl.innerText='Rendering frames...'; btn.disabled=true; btn.innerText='GENERATING...';
    var fps=parseInt(document.getElementById('gif-fps').value);
    var quality=parseInt(document.getElementById('gif-quality').value);
    // gif output uses the frame's stored ratio regardless of which frame is active, but all frames share one output size so the encoder gets consistent dims
    var cw=canvas.offsetWidth||400, ch=canvas.offsetHeight||400;
    try {
        var renderedFrames=[];
        for (var i=0;i<frames.length;i++) {
            statusEl.innerText='Rendering frame '+(i+1)+' / '+frames.length;
            fillEl.style.width=(i/frames.length*40)+'%';
            // render each frame at its natural size, composite centered onto the shared output canvas so mixed-ratio comics keep aspect ratio in the gif
            var _fr=getFrameRatio(frames[i]);
            var _fs=computeCanvasSize(_fr.w,_fr.h);
            var _fcw=_fs.cw||cw, _fch=_fs.ch||ch;
            var rawFrame=await renderFrameToCanvas(frames[i],_fcw,_fch);
            if (_fcw===cw && _fch===ch) {
                renderedFrames.push(rawFrame);
            } else {
                // letterbox/pillarbox to output size
                var padded=document.createElement('canvas');
                padded.width=cw; padded.height=ch;
                var pctx=padded.getContext('2d');
                pctx.fillStyle='#000';
                pctx.fillRect(0,0,cw,ch);
                var ox=Math.round((cw-_fcw)/2), oy=Math.round((ch-_fch)/2);
                pctx.drawImage(rawFrame,ox,oy);
                renderedFrames.push(padded);
            }
        }
        var gif=new GIF({workers:2,quality:quality,width:cw,height:ch,workerScript:'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js'});
        for (var ri=0;ri<renderedFrames.length;ri++) gif.addFrame(renderedFrames[ri],{delay:Math.round(1000/fps),copy:true});
        fillEl.style.width='50%'; statusEl.innerText='Encoding GIF...';
        gif.on('progress',function(p){fillEl.style.width=(50+p*50)+'%';statusEl.innerText='Encoding: '+Math.round(50+p*50)+'%';});
        gif.on('finished',function(blob){
            var url=URL.createObjectURL(blob);
            document.getElementById('gif-result-img').src=url;
            // store object url on button, shared via native iOS share sheet as a Blob
            var dl=document.getElementById('gif-download-link'); dl.dataset.url=url;
            resultWrap.style.display='block'; barEl.style.display='none';
            statusEl.innerText='Done! Tap "Save GIF" below (or long-press the preview on iOS).';
            btn.disabled=false; btn.innerText='REGENERATE';
        });
        gif.on('error',function(err){statusEl.innerText='GIF failed: '+err;barEl.style.display='none';btn.disabled=false;btn.innerText='GENERATE GIF';});
        gif.render();
    } catch(err) { statusEl.innerText='Error: '+err.message; barEl.style.display='none'; btn.disabled=false; btn.innerText='GENERATE GIF'; }
}

async function exportStrip() {
    var cols=parseInt(document.getElementById('strip-cols').value);
    var statusEl=document.getElementById('strip-status');
    var previewWrap=document.getElementById('strip-preview-wrap');
    statusEl.innerText='Rendering...';
    try {
        // pixel size per frame from natural ratio, largest width/height picked as cell size, smaller frames letterboxed not stretched
        var frameSizes=frames.map(function(f){var _fr=getFrameRatio(f);var _fs=computeCanvasSize(_fr.w,_fr.h);return{cw:_fs.cw||400,ch:_fs.ch||400};});
        var cw=Math.max.apply(null,frameSizes.map(function(s){return s.cw;}))||400;
        var ch=Math.max.apply(null,frameSizes.map(function(s){return s.ch;}))||400;
        var rows=Math.ceil(frames.length/cols), pad=10;
        var sw=(cw+pad)*cols+pad, sh=(ch+pad)*rows+pad;
        var sc=document.createElement('canvas'); sc.width=sw; sc.height=sh;
        var ctx2=sc.getContext('2d'); ctx2.fillStyle='#111'; ctx2.fillRect(0,0,sw,sh);
        for (var i=0;i<frames.length;i++) {
            statusEl.innerText='Frame '+(i+1)+' / '+frames.length;
            var _fcw=frameSizes[i].cw, _fch=frameSizes[i].ch;
            var fc=await renderFrameToCanvas(frames[i],_fcw,_fch);
            var row=Math.floor(i/cols), col=i%cols;
            var cellX=pad+col*(cw+pad), cellY=pad+row*(ch+pad);
            // fill cell then center frame
            ctx2.fillStyle='#111'; ctx2.fillRect(cellX,cellY,cw,ch);
            var ox=Math.round((cw-_fcw)/2), oy=Math.round((ch-_fch)/2);
            ctx2.drawImage(fc,cellX+ox,cellY+oy);
            ctx2.fillStyle='rgba(255,122,0,0.9)'; ctx2.fillRect(pad+col*(cw+pad),pad+row*(ch+pad),22,18);
            ctx2.fillStyle='#000'; ctx2.font='bold 10px Inter'; ctx2.textAlign='center';
            ctx2.fillText(i+1,pad+col*(cw+pad)+11,pad+row*(ch+pad)+13);
        }
        var dataUrl=sc.toDataURL('image/png');
        document.getElementById('strip-preview-img').src=dataUrl;
        previewWrap.style.display='block';
        // mobileDownload: share sheet on iOS, anchor-download on Android/desktop
        statusEl.innerText='Saving…';
        await mobileDownload(dataUrl,'comic-strip.png');
        statusEl.innerText='Done! If the save dialog didn\'t appear, long-press the preview image.';
    } catch(err) {
        statusEl.innerText='Error: '+(err && err.message ? err.message : err);
    }
}

async function openExportFramesTab() {
    var grid=document.getElementById('export-frames-grid');
    grid.innerHTML='<div style="color:#555;font-size:12px;padding:10px;">Rendering...</div>';
    var built=document.createDocumentFragment();
    for (var i=0;i<frames.length;i++) {
        try {
            // export each frame at its own ratio size so mixed-ratio frames aren't squashed into the active frame's shape
            var _fr=getFrameRatio(frames[i]);
            var _fs=computeCanvasSize(_fr.w,_fr.h);
            var cw=_fs.cw||canvas.offsetWidth||400, ch=_fs.ch||canvas.offsetHeight||400;
            var fc=await renderFrameToCanvas(frames[i],cw,ch);
            var dataUrl=fc.toDataURL('image/png');
            var wrap=document.createElement('div');
            wrap.style.cssText='position:relative;border-radius:10px;overflow:hidden;border:2px solid #333;cursor:pointer;';
            var img=document.createElement('img');
            img.src=dataUrl; img.style.cssText='width:100%;display:block;';
            var label=document.createElement('div');
            label.style.cssText='position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);color:var(--accent);font-size:10px;font-weight:900;padding:5px 8px;text-align:center;';
            label.innerText='FRAME '+(i+1)+' — TAP TO SAVE';
            wrap.appendChild(img); wrap.appendChild(label);
            // mobileDownload is async: share sheet on iOS, anchor click/window.open fallback elsewhere
            (function(url,n){ wrap.onclick=function(){ mobileDownload(url,'frame-'+n+'.png'); }; })(dataUrl,i+1);
            built.appendChild(wrap);
        } catch(e) {
            var errBox=document.createElement('div');
            errBox.style.cssText='border:2px dashed #a33;border-radius:10px;padding:10px;color:#f88;font-size:11px;';
            errBox.innerText='Frame '+(i+1)+' failed to render'+(e && e.message ? (': '+e.message) : '');
            built.appendChild(errBox);
        }
    }
    grid.innerHTML='';
    grid.appendChild(built);
    if (!grid.children.length) {
        grid.innerHTML='<div style="color:#a33;font-size:12px;padding:10px;">Nothing could be rendered. Try again, or check your connection.</div>';
    }
}

// save sprite to personal
async function saveSpriteToPersonal() {
    if (!activeLayer?.src) return;
    const { data: { session: _cm3 } } = await _supabase.auth.getSession();
    const user = _cm3?.user ?? null;
    if (!user) { showToast('Log in first'); return; }
    const { error } = await _supabase.from('personal_sprites').insert([{ user_id: user.id, src: activeLayer.src, name: activeLayer.nameTag || 'My Sprite', created_at: new Date().toISOString() }]);
    showToast(error ? error.message : 'Sprite saved');
}

// go to my sprites (private sprite library/manager page)
async function goToMySprites() {
    saveOffline(true);
    closeSheet('add');
    // render frame 0 as cover hint for new sprite
    try {
        const f = frames[0];
        if (f) {
            const _r = getFrameRatio(f);
            const ar = _r.w / _r.h;
            const hintSize = 400;
            const hw = ar >= 1 ? hintSize : Math.round(hintSize * ar);
            const hh = ar <= 1 ? hintSize : Math.round(hintSize / ar);
            const offscreen = await renderFrameToCanvas(f, hw, hh);
            lsSet('ms_cover_hint', offscreen.toDataURL('image/jpeg', 0.82));
        }
    } catch(e) { /* non-critical */ }
    location.href = 'my-sprites.html';
}

// auto save
setInterval(() => { if (hasUnsavedChanges) saveOffline(true); }, 15000);
// local backup runs more often than cloud (localstorage only, no network) — shrinks the lost-work window to a few seconds, catches what cloud autosave missed
setInterval(() => { if (hasUnsavedChanges && !_draftLoadPending) localBackupSave(); }, 5000);
// visibilitychange fires right before mobile kills the tab — best last chance for a local backup
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && hasUnsavedChanges && !_draftLoadPending) localBackupSave();
});
// wait for draft load to settle
setTimeout(checkReplaceBackup, 600);

// load
function applyPendingBg(pendingBg, pendingBgId) {
    if (pendingBgId) {
        localStorage.removeItem('pending_bg_id');
        currentImportType = 'bg';
        _supabase.from('backgrounds_library').select('image_data').eq('id', pendingBgId).single().then(({ data }) => { if (data?.image_data) showBgImportChoice(data.image_data); });
        return;
    }
    if (!pendingBg) return;
    localStorage.removeItem('pending_background');
    if (pendingBg.startsWith('http') || pendingBg.startsWith('data:image')) { currentImportType='bg'; showBgImportChoice(pendingBg); }
    else { frames[currentIdx].background = pendingBg; render(); }
}

window.onload = async function() {
    // size and render canvas right away, before any async work, so it shows up even if supabase is slow
    (function initCanvas() {
        const storedNew    = localStorage.getItem('cc-new-comic-ratio');
        const storedActive = localStorage.getItem('cc-active-ratio');
        if (storedNew)    { const r = JSON.parse(storedNew);    setRatio(r.w, r.h); }
        else if (storedActive) { const r = JSON.parse(storedActive); setRatio(r.w, r.h); }
        else              { setRatio(1, 1); }
        render();
        renderMobFrames();
        updateFrameCounter();

        // fixed a bug where this blank-state paint ran before real data loaded, but setRatio() above had already cached a bogus size for whatever ratio it guessed. if the real draft happened to share that ratio (1:1 is the default so, often) everything got rescaled against garbage — the shifted/vanished layer bug. clearing the cache here forces it to use the frame's own real saved size instead
        _lastCanvasSizeByRatio = {};

        // re-run setRatio on viewport resize
        if (window.visualViewport) {
            let _vvResizeTimer = null;
            window.visualViewport.addEventListener('resize', () => {
                // fixed by debouncing — mobile fires a bunch of resize events while a sheet animates open/closed (keyboard, share sheet, etc) and each one used to call setRatio() immediately, re-baselining against some in-between size. waiting for it to settle means only the final size actually gets applied
                clearTimeout(_vvResizeTimer);
                _vvResizeTimer = setTimeout(() => {
                    const r = canvasRatio;
                    setRatio(r.w, r.h);
                }, 200);
            });
        }
    })();

    // tap backdrop to close overlay modals
    document.querySelectorAll('.overlay-full').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
                // destroy cropper on close
                if (overlay.id === 'crop-modal' && cropper) { cropper.destroy(); cropper = null; }
            }
        });
    });
    // fixed: myHandle was undeclared
    myHandle = JSON.parse(localStorage.getItem('user_profile') || '{}').handle || null;
    const pendingBg = localStorage.getItem('pending_background');
    const pendingBgId = localStorage.getItem('pending_bg_id');

    // edit_comic_id beats draft
    const editComicId = localStorage.getItem('edit_comic_id');
    if (editComicId) {
        localStorage.removeItem('edit_comic_id'); editingComicId = editComicId;
        document.getElementById('publish-btn').innerText = 'UPDATE';
        maybeShowCollabBtn();
        _supabase.from('comics').select('*').eq('id', editComicId).single().then(async ({data,error}) => {
            if (error||!data) { alert('Could not load comic.'); return; }
            // no single owner on collab comics, all owner_handles are equal co-owners
            const owners = (data.owner_handles && data.owner_handles.length) ? data.owner_handles : (data.owner_handle ? [data.owner_handle] : []);
            _collabOwnerHandles = owners;
            if (!owners.includes(myHandle)) {
                const { data: collab } = await _supabase.from('comic_collaborators')
                    .select('id').eq('comic_id', editComicId).eq('invitee_handle', myHandle).eq('status', 'accepted').maybeSingle();
                if (!collab) {
                    alert("You don't have permission to edit this comic.");
                    location.href = 'my-comics.html';
                    return;
                }
            }
            loadedComicStoragePath = data.storage_path || null;
            const resolved = await resolveFramesFromRow(data);
            if (!resolved || !resolved.length) { alert('Could not load comic frames.'); return; }
            frames = resolved;
            const r = data.canvas_ratio || {w:1,h:1}; setRatio(r.w,r.h); activateFrame(0);
            document.getElementById('pub-title').value = data.title || '';
            document.getElementById('pub-tags').value = (data.tags||[]).join(', ');
            document.getElementById('pub-desc').value = data.description || '';
            pubSelectedRating = data.age_rating || null;
            pubRatingLocked   = !!data.age_rating_locked;
            if (data.cover) { finalCoverBase64=data.cover; const img=document.getElementById('final-cover-img'); img.src=data.cover; img.style.display='block'; document.getElementById('cover-label').style.display='none'; }
            applyPendingBg(pendingBg,pendingBgId);
        });
        return;
    }

    // collab draft: invited user opening shared draft
    const editDraftId = localStorage.getItem('edit_draft_id');
    if (editDraftId) {
        localStorage.removeItem('edit_draft_id');
        _draftLoadPending = true;
        try {
            const { data, error } = await _supabase.from('drafts').select('*').eq('id', editDraftId).single();
            if (error || !data) {
                alert('Could not load this draft.');
                _draftLoadPending = false;
                location.href = 'my-comics.html';
                return;
            }
            // same co-owner check — no single owner once accepted, everyone in owner_handles (or accepted comic_collaborators) has full edit rights
            const owners = (data.owner_handles && data.owner_handles.length) ? data.owner_handles : (data.owner_handle ? [data.owner_handle] : []);
            _collabOwnerHandles = owners;
            _draftOwnerHandle = data.owner_handle || null;
            _draftUserId = data.user_id || null;
            if (!owners.includes(myHandle)) {
                const { data: collab } = await _supabase.from('comic_collaborators')
                    .select('id').eq('comic_id', editDraftId).eq('is_draft', true).eq('invitee_handle', myHandle).eq('status', 'accepted').maybeSingle();
                if (!collab) {
                    alert("You don't have permission to edit this draft.");
                    _draftLoadPending = false;
                    location.href = 'my-comics.html';
                    return;
                }
            }
            activeDraftId = editDraftId;
            lsSet('active_draft_id', editDraftId);
            if (data.storage_path) lsSet('active_draft_storage_path', data.storage_path);
            else localStorage.removeItem('active_draft_storage_path');
            draftRowExists = true;
            const resolved = await resolveFramesFromRow(data);
            if (!resolved || !resolved.length) { showDraftLoadError(); _draftLoadPending = false; return; }
            frames = resolved;
            const r = data.canvas_ratio || { w:1, h:1 };
            setRatio(r.w, r.h); activateFrame(0); renderMobFrames(); updateFrameCounter();
            document.getElementById('pub-title').value = data.title || '';
            applyPendingBg(pendingBg, pendingBgId);
            _draftLoadPending = false;
            hasUnsavedChanges = false;
        } catch(e) {
            console.error('Collab draft load failed:', e);
            showDraftLoadError();
            _draftLoadPending = false;
        }
        return;
    }

    // fixed: active_draft_id was only set after the resumeId block returned, so republish's editPublished() flag was unreachable dead code and finalPublish() always fell into insert, silently duplicating comic rows. Runs first now so republish updates in place; title-set stays fire-and-forget so it doesn't delay frame load
    const editSourceId = localStorage.getItem('edit_source_comic_id');
    if (editSourceId) {
        editingComicId = editSourceId;
        document.getElementById('publish-btn').innerText = 'REPUBLISH';
        maybeShowCollabBtn();
        _supabase.from('comics').select('owner_handle,owner_handles,title,tags,description,cover,storage_path,age_rating,age_rating_locked').eq('id', editSourceId).single().then(async ({ data }) => {
            if (!data) return;
            // same co-owner check
            const owners = (data.owner_handles && data.owner_handles.length) ? data.owner_handles : (data.owner_handle ? [data.owner_handle] : []);
            if (!owners.includes(myHandle)) {
                const { data: collab } = await _supabase.from('comic_collaborators')
                    .select('id').eq('comic_id', editSourceId).eq('invitee_handle', myHandle).eq('status', 'accepted').maybeSingle();
                if (!collab) {
                    alert("You don't have permission to edit this comic.");
                    location.href = 'my-comics.html';
                    return;
                }
            }
            loadedComicStoragePath = data.storage_path || null;
            document.getElementById('pub-title').value = data.title || '';
            document.getElementById('pub-tags').value = (data.tags||[]).join(', ');
            document.getElementById('pub-desc').value = data.description || '';
            pubSelectedRating = data.age_rating || null;
            pubRatingLocked   = !!data.age_rating_locked;
            if (data.cover) { finalCoverBase64=data.cover; const img=document.getElementById('final-cover-img'); if(img){ img.src=data.cover; img.style.display='block'; } }
        });
    }

    // check for draft after clearing edit id
    const resumeId = localStorage.getItem('active_draft_id');
    if (resumeId) {
        activeDraftId = resumeId;
        draftRowExists = true; // row already exists in Supabase — don't reset title on next save
        // critical: safety net

        _draftLoadPending = true;
        let loaded = false;
        const storagePath = localStorage.getItem('active_draft_storage_path');
        if (storagePath) {
            try {
                const { data: blob, error: dlErr } = await _supabase.storage.from('comiccore-assets').download(storagePath);
                if (dlErr) throw dlErr;
                const parsedFrames = JSON.parse(await blob.text());
                if (!parsedFrames || !parsedFrames.length) throw new Error('Draft file downloaded but contained no frames');
                frames = parsedFrames;
                // fixed: .single() is thenable-only, needs Promise.resolve() wrapping before .catch()
                const { data: row } = await Promise.resolve(_supabase.from('drafts').select('canvas_ratio, title, owner_handle, owner_handles, user_id').eq('id', resumeId).single()).catch(() => ({ data: null }));
                const r = row?.canvas_ratio || { w:1, h:1 };
                setRatio(r.w, r.h); activateFrame(0); renderMobFrames(); updateFrameCounter();
                // don't overwrite title with the draft's edit suffix when this is a republish draft
                if (!editSourceId) document.getElementById('pub-title').value = row?.title || '';
                _collabOwnerHandles = row?.owner_handles || [];
                _draftOwnerHandle = row?.owner_handle || null;
                _draftUserId = row?.user_id || null;
                applyPendingBg(pendingBg, pendingBgId);
                loaded = true;
            } catch(e) { console.error('Bucket draft load failed:', e); }
        } else {
            // fixed: same thenable issue
            const { data: sbDraft } = await Promise.resolve(_supabase.from('drafts')
                .select('data, storage_path, canvas_ratio, title, owner_handle, owner_handles, user_id').eq('id', resumeId).single()).catch(() => ({ data: null }));
            if (sbDraft) {
                let draftFrames = sbDraft.data;
                if (!draftFrames && sbDraft.storage_path) {
                    try {
                        const { data: blob } = await _supabase.storage.from('comiccore-assets').download(sbDraft.storage_path);
                        draftFrames = JSON.parse(await blob.text());
                    } catch(e) { console.error('Bucket fallback failed:', e); }
                }
                if (draftFrames && draftFrames.length) {
                    frames = draftFrames;
                    const r = sbDraft.canvas_ratio || { w:1, h:1 };
                    setRatio(r.w, r.h); activateFrame(0); renderMobFrames(); updateFrameCounter();
                    if (!editSourceId) document.getElementById('pub-title').value = sbDraft.title || '';
                    _collabOwnerHandles = sbDraft.owner_handles || [];
                    _draftOwnerHandle = sbDraft.owner_handle || null;
                    _draftUserId = sbDraft.user_id || null;
                    applyPendingBg(pendingBg, pendingBgId);
                    loaded = true;
                }
            }
        }
        _draftLoadPending = false;
        if (loaded) {
            // activateFrame() above triggers a render that unconditionally sets unsaved — opening a draft shouldn't count as unsaved
            hasUnsavedChanges = false;
            return;
        }
        // fixed: failed load used to fall into fresh-comic init, which re-rendered a blank frame and set unsaved — next autosave would silently overwrite the real draft in supabase. Now it stops, leaves the draft row untouched, and tells the user to retry
        showDraftLoadError();
        return;
    }

    // apply correct ratio and re-render once all async paths (fresh comic / failed fetch / bg source) complete
    const pendingFrames = localStorage.getItem('cc-pending-frames');
    if (pendingFrames) { localStorage.removeItem('cc-pending-frames'); const saved=JSON.parse(pendingFrames); frames=saved.frames; currentIdx=saved.currentIdx; }
    const storedNew = localStorage.getItem('cc-new-comic-ratio');
    const storedActive = localStorage.getItem('cc-active-ratio');
    if (storedNew) { const r=JSON.parse(storedNew); localStorage.removeItem('cc-new-comic-ratio'); setRatio(r.w,r.h); }
    else if (storedActive) { const r=JSON.parse(storedActive); setRatio(r.w,r.h); }
    else { setRatio(1,1); }
    activateFrame(currentIdx);
    renderMobFrames();
    updateFrameCounter();
    applyPendingBg(pendingBg,pendingBgId);

    // incoming sprite / pack from gallery
    const incomingRaw = localStorage.getItem('incoming_sprite_pack');
    if (incomingRaw) {
        localStorage.removeItem('incoming_sprite_pack');
        try {
            const incoming = JSON.parse(incomingRaw);
            if (incoming.items) {
                // it's a pack, open pack sheet
                if (typeof openPackSpriteSheet === 'function') {
                    const items = Array.isArray(incoming.items) ? incoming.items : [];
                    openPackSpriteSheet(incoming, items);
                }
            } else if (incoming.image_data) {
                // full data available, open modal directly
                if (typeof openActionModal === 'function') openActionModal(incoming);
            } else if (incoming.id) {
                // fetch full data then open modal
                if (typeof galFetchFull === 'function') {
                    galFetchFull(incoming.id).then(full => {
                        if (full && typeof openActionModal === 'function') openActionModal({ ...incoming, ...full });
                    });
                }
            }
        } catch(e) { console.warn('incoming_sprite_pack parse error', e); }
    }

    // auto-open collab panel (from "start a collab comic" in my comics)
    if (localStorage.getItem('cc_auto_open_collab')) {
        localStorage.removeItem('cc_auto_open_collab');
        setTimeout(() => { if (typeof openCollabPanel === 'function') openCollabPanel(); }, 300);
    }
};

// drafts modal
async function openDraftsModal() {
    saveOffline(true);
    const list = document.getElementById('drafts-list');
    list.innerHTML = '<div style="color:#666;font-size:13px;text-align:center;padding:30px 0;">Loading drafts...</div>';
    document.getElementById('drafts-modal').classList.add('open');

    const handle = myHandle || JSON.parse(localStorage.getItem('user_profile') || '{}').handle;
    if (!handle) {
        list.innerHTML = '<div style="color:#666;font-size:13px;text-align:center;padding:30px 0;">Please log in</div>';
        return;
    }

    try {
        const { data: drafts, error } = await _supabase.from('drafts')
            .select('id, title, data, storage_path, canvas_ratio, updated_at, owner_handle, owner_handles, user_id')
            .eq('owner_handle', handle)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        if (!drafts || !drafts.length) {
            list.innerHTML = '<div style="color:#666;font-size:13px;text-align:center;padding:30px 0;">No drafts yet. Start creating!</div>';
            return;
        }

        list.innerHTML = '';
        drafts.forEach(function(draft) {
            var item = document.createElement('div');
            item.className = 'draft-item';
            var f = (draft.data && draft.data[0]) || {};
            var bg = f.background || '#222';
            var frameCount = (draft.data || []).length;
            var date = draft.updated_at ? new Date(draft.updated_at).toLocaleDateString() : '';
            var isCurrent = String(draft.id) === String(activeDraftId);

            // build thumb
            var thumb = document.createElement('div');
            thumb.className = 'draft-thumb';
            if (bg.startsWith('http') || bg.startsWith('data:image')) {
                thumb.style.backgroundImage = 'url(' + bg + ')';
                thumb.style.backgroundSize = 'cover';
                thumb.style.backgroundPosition = 'center';
            } else {
                thumb.style.background = bg;
            }

            var info = document.createElement('div');
            info.className = 'draft-info';
            var title = document.createElement('div');
            title.className = 'draft-title';
            title.textContent = (isCurrent ? '▶ ' : '') + (draft.title || 'Untitled Draft');
            var meta = document.createElement('div');
            meta.className = 'draft-meta';
            meta.textContent = frameCount + ' frame' + (frameCount !== 1 ? 's' : '') + (date ? ' · ' + date : '');
            info.appendChild(title);
            info.appendChild(meta);

            var del = document.createElement('button');
            del.className = 'draft-del';
            del.innerHTML = '<i class="fi fi-rs-trash"></i>';
            del.title = 'Delete draft';
            del.onclick = async function(e) {
                e.stopPropagation();
                if (!confirm('Delete this draft?')) return;
                try {
                    await _supabase.from('drafts').delete().eq('id', draft.id);
                    if (draft.storage_path) {
                        await _supabase.storage.from('comiccore-assets').remove([draft.storage_path]).catch(() => {});
                    }
                    if (String(draft.id) === String(activeDraftId)) {
                        localStorage.removeItem('active_draft_id');
                        localStorage.removeItem('active_draft_storage_path');
                        activeDraftId = null;
                        draftRowExists = false; // that row is gone — next save is a fresh one
                        _draftOwnerHandle = null;
                        _draftUserId = null;
                    }
                    item.remove();
                    if (!document.querySelectorAll('.draft-item').length) {
                        list.innerHTML = '<div style="color:#666;font-size:13px;text-align:center;padding:30px 0;">No drafts yet. Start creating!</div>';
                    }
                } catch(e) { alert('Delete failed: ' + e.message); }
            };

            item.appendChild(thumb);
            item.appendChild(info);
            item.appendChild(del);

            // click to load
            item.onclick = async function() {
                if (isCurrent) { closeDraftsModal(); return; }
                if (hasUnsavedChanges) { if (!confirm('Save current work first?')) return; saveOffline(true); }
                let loadedFrames = draft.data;
                if (!loadedFrames && draft.storage_path) {
                    try {
                        const { data: blob } = await _supabase.storage.from('comiccore-assets').download(draft.storage_path);
                        loadedFrames = JSON.parse(await blob.text());
                    } catch(e) { alert('Failed to load draft: ' + e.message); return; }
                }
                frames = JSON.parse(JSON.stringify(loadedFrames || [{ layers:[], background:'#ffffff' }]));
                activeDraftId = draft.id;
                draftRowExists = true; // this row is a real, already-saved draft
                _draftOwnerHandle = draft.owner_handle || null;
                _draftUserId = draft.user_id || null;
                _collabOwnerHandles = draft.owner_handles || [];
                lsSet('active_draft_id', String(draft.id));
                if (draft.storage_path) lsSet('active_draft_storage_path', draft.storage_path);
                else localStorage.removeItem('active_draft_storage_path');
                var r = draft.canvas_ratio || {w:1,h:1};
                setRatio(r.w, r.h);
                currentIdx = 0;
                activeLayer = null;
                render();
                renderMobFrames();
                updateFrameCounter();
                closeDraftsModal();
            };

            list.appendChild(item);
        });
    } catch(e) {
        console.error('Failed to load drafts:', e);
        list.innerHTML = '<div style="color:#f55;font-size:13px;text-align:center;padding:30px 0;">Error loading drafts</div>';
    }
}

function closeDraftsModal() {
    document.getElementById('drafts-modal').classList.remove('open');
}

function startNewDraft() {
    if (hasUnsavedChanges) { if (!confirm('Save current work first?')) return; saveOffline(true); }
    frames = [{ layers: [], background: '#ffffff' }];
    activeDraftId = null;
    draftRowExists = false; // fresh comic, no row yet — without this, the next save
    // reused the previous draft's row-exists state and skipped owner_handle — hit NOT NULL since this id is actually brand new
    _draftOwnerHandle = null;
    _draftUserId = null;
    localStorage.removeItem('active_draft_id');
    localStorage.removeItem('active_draft_storage_path');
    currentIdx = 0;
    activeLayer = null;
    setRatio(1,1);
    render();
    renderMobFrames();
    updateFrameCounter();
    closeDraftsModal();
}

// pc compat stubs
function toggleMenu() {}
function toggleSidePanel() {}
function openBgPanel() { openSheet('bg'); }
function toggleTransform() { openTransformSheet(); }
function toggleFtbPanel() {}
function showFloatToolbar() {}
function hideFloatToolbar() {}
function closeFtbPanel() {}
function hideEditorUI() { if (document.getElementById('top-bar').style.display !== 'none') toggleHideUI(); }
function showEditorUI() { if (document.getElementById('top-bar').style.display === 'none') toggleHideUI(); }
function toggleHideUI() {
    const isHidden = document.getElementById('top-bar').style.display === 'none';
    document.getElementById('top-bar').style.display = isHidden ? '' : 'none';
    document.getElementById('bottom-bar').style.display = isHidden ? '' : 'none';
    document.getElementById('zoom-controls').style.display = isHidden ? '' : 'none';
    document.getElementById('hidden-ui-bar').style.display = isHidden ? 'none' : 'flex';
    if (!isHidden) { closeAllSheets(); closeTransformSheet(); }
}
function toggleEditorPrefs() {}
function closeEditorPrefs() {}
function toggleOnionSkin() { toggleOnionMobile(); }
function updateSelectionOpacity() {}
function sbEditAction() { if (activeLayer) openTransformSheet(); else { const t=document.createElement('div'); t.style.cssText='position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#aaa;padding:8px 18px;border-radius:20px;font-size:12px;font-weight:800;z-index:9999;border:1px solid #333;'; t.innerText='Tap a layer first'; document.body.appendChild(t); setTimeout(()=>t.remove(),1800); } }
function editCurrentSpriteAction() { if (activeLayer?.packData) openActionModal(activeLayer.packData, true); }
function copyLayer() { sbCopyLayer(); }
function pasteLayer() { sbPasteLayer(); }
function getSpriteFilterCSS(layer) {
    if (!layer.blurType || layer.blurType === 'none') return '';
    const amt = layer.blurAmt || layer.blurAmount || 4;
    switch (layer.blurType) {
        case 'gaussian':
        case 'soft': return `blur(${amt}px)`;
        case 'lens': return `blur(${amt * 1.2}px) brightness(112%) saturate(88%)`;
        default: return ''; // complex types use _fxSrc canvas pre-render
    }
}

// canvas fx implementations (shared with desktop)
const _fxCanvas_TYPES = ['motion','zoom','radial','frosted','pixel'];

function _fxLoadImage(src) {
    return new Promise(res => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => res(img); img.onerror = () => res(null); img.src = src;
    });
}
function _fxApplyMotion(ctx, img, w, h, amt, angle) {
    const steps = Math.min(Math.max(8, amt), 32);
    const rad = (angle * Math.PI) / 180;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < steps; i++) {
        const offset = ((i / (steps - 1)) - 0.5) * amt;
        ctx.globalAlpha = 1 / steps;
        ctx.drawImage(img, Math.cos(rad) * offset, Math.sin(rad) * offset, w, h);
    }
    ctx.globalAlpha = 1;
}
function _fxApplyZoom(ctx, img, w, h, amt) {
    const steps = 14;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < steps; i++) {
        const scale = 1 + (i / (steps - 1)) * (amt / 40);
        ctx.globalAlpha = 1 / steps;
        ctx.drawImage(img, (w - w * scale) / 2, (h - h * scale) / 2, w * scale, h * scale);
    }
    ctx.globalAlpha = 1;
}
function _fxApplyRadial(ctx, img, w, h, amt) {
    const steps = 14;
    const maxRad = (amt * 0.6) * (Math.PI / 180);
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < steps; i++) {
        ctx.globalAlpha = 1 / steps;
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(((i / (steps - 1)) - 0.5) * maxRad);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}
function _fxApplyFrosted(ctx, img, w, h, amt) {
    ctx.filter = `blur(${Math.max(1, amt * 0.6)}px)`;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';
    try {
        const px = ctx.getImageData(0, 0, w, h), d = px.data, noise = amt * 4;
        for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() - 0.5) * noise;
            d[i]   = Math.min(255, Math.max(0, d[i]   + n));
            d[i+1] = Math.min(255, Math.max(0, d[i+1] + n));
            d[i+2] = Math.min(255, Math.max(0, d[i+2] + n));
        }
        ctx.putImageData(px, 0, 0);
    } catch(e) {}
}
function _fxApplyMosaic(ctx, img, w, h, amt) {
    const bs = Math.max(2, Math.round(amt * 2.5));
    const sw = Math.max(1, Math.round(w / bs)), sh = Math.max(1, Math.round(h / bs));
    const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
    tmp.getContext('2d').drawImage(img, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
}
async function computeLayerFx(layer) {
    if (!layer.blurType || layer.blurType === 'none' || !_fxCanvas_TYPES.includes(layer.blurType)) {
        layer._fxSrc = null; return;
    }
    const img = await _fxLoadImage(layer.src);
    if (!img) { layer._fxSrc = null; return; }
    const w = img.naturalWidth || 200, h = img.naturalHeight || 200;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const amt = layer.blurAmt || layer.blurAmount || 4;
    switch (layer.blurType) {
        case 'motion':  _fxApplyMotion(ctx, img, w, h, amt, layer.blurAngle || 0); break;
        case 'zoom':    _fxApplyZoom(ctx, img, w, h, amt); break;
        case 'radial':  _fxApplyRadial(ctx, img, w, h, amt); break;
        case 'frosted': _fxApplyFrosted(ctx, img, w, h, amt); break;
        case 'pixel':   _fxApplyMosaic(ctx, img, w, h, amt); break;
    }
    layer._fxSrc = c.toDataURL('image/png');
}

// same blur pipeline, different source (bgFx._fxSrc) — only runs for image backgrounds, gradients/solid colors skip canvas and use css fx only
async function computeBgFx() {
    const f = frames[currentIdx];
    const bgFx = f && f.bgFx;
    if (!bgFx || !bgFx.blurType || bgFx.blurType === 'none' || !_fxCanvas_TYPES.includes(bgFx.blurType)) {
        if (bgFx) bgFx._fxSrc = null;
        return;
    }
    const bg = f.background || '';
    const isImg = bg.startsWith('http') || bg.startsWith('data:image');
    if (!isImg) { bgFx._fxSrc = null; return; }
    const img = await _fxLoadImage(bg);
    if (!img) { bgFx._fxSrc = null; return; }
    const w = img.naturalWidth || 400, h = img.naturalHeight || 400;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const amt = bgFx.blurAmt || bgFx.blurAmount || 4;
    switch (bgFx.blurType) {
        case 'motion':  _fxApplyMotion(ctx, img, w, h, amt, bgFx.blurAngle || 0); break;
        case 'zoom':    _fxApplyZoom(ctx, img, w, h, amt); break;
        case 'radial':  _fxApplyRadial(ctx, img, w, h, amt); break;
        case 'frosted': _fxApplyFrosted(ctx, img, w, h, amt); break;
        case 'pixel':   _fxApplyMosaic(ctx, img, w, h, amt); break;
    }
    bgFx._fxSrc = c.toDataURL('image/png');
}

function toggleSelectedLayerPin() {
    // pins are a targeting/workflow aid, not a content edit — kept out of undo history
    if (!activeLayer) return;
    activeLayer.pinned = !activeLayer.pinned;
    render();
    renderMobLayers();
}
function setRatioForBg() {}

// onion skin toggle

function toggleOnionMobile() {
    const toggle = document.getElementById('onion-toggle');
    toggle.checked = !toggle.checked;
    const on = toggle.checked;
    const btn = document.getElementById('onion-bot-btn');
    if (btn) {
        btn.classList.toggle('onion-on', on);
        btn.querySelector('.bico').innerHTML = '<i class="fi fi-rs-onion"></i>';
        btn.style.color = on ? 'var(--teal)' : '';
    }
    const popup = document.getElementById('onion-opacity-popup');
    if (on) {
        popup.classList.add('visible');
        // auto hide after 3s
        clearTimeout(popup._t);
        popup._t = setTimeout(() => popup.classList.remove('visible'), 3000);
    } else {
        popup.classList.remove('visible');
    }
    render();
}

// viewport pan/zoom

// computeCanvasSize() already fits the frame snug to the viewport at 100%, so starting zoom at 1 meant zero breathing room on one side. starting below 1 gives room on both axes right away
const VP_DEFAULT_SCALE = 0.8;

let vpScale = VP_DEFAULT_SCALE;
let vpOffsetX = 0, vpOffsetY = 0;
let vpZoomTimer = null;

const _vpViewport = document.getElementById('viewport');
const _vpContainer = document.getElementById('canvas-container');

function _applyVpTransform() {
    _vpContainer.style.transform = `translate(${vpOffsetX}px,${vpOffsetY}px) scale(${vpScale})`;
}

function _showZoomIndicator() {
    const el = document.getElementById('zoom-indicator');
    el.innerText = Math.round(vpScale * 100) + '%';
    el.classList.add('visible');
    clearTimeout(vpZoomTimer);
    vpZoomTimer = setTimeout(() => el.classList.remove('visible'), 1400);
}

// min zoom isn't a flat 20% anymore, bigger screens mean a bigger canvas at 100% so a flat floor left more unused space on big screens. now it targets an actual on-screen size (~70px) instead
function _vpMinZoom() {
    const cw = canvas.offsetWidth || 300;
    const ch = canvas.offsetHeight || 300;
    const ABS_MIN_PX = 70;
    return Math.min(0.2, Math.max(0.05, ABS_MIN_PX / Math.max(cw, ch)));
}

function vpZoomStep(delta) {
    vpScale = Math.min(5, Math.max(_vpMinZoom(), vpScale + delta));
    _applyVpTransform();
    _showZoomIndicator();
}

function vpZoomReset() {
    vpScale = VP_DEFAULT_SCALE; vpOffsetX = 0; vpOffsetY = 0;
    _applyVpTransform();
    _showZoomIndicator();
}

// swipe on the strip below canvas to switch frames — separate touch target from the canvas itself, so it never conflicts with dragging/resizing a layer
(function() {
    const zone = document.getElementById('frame-swipe-zone');
    if (!zone) return;
    const THRESHOLD = 40, MAX_TIME = 600;
    let startX = null, startY = null, startT = 0, dragging = false;

    function begin(x, y) { startX = x; startY = y; startT = Date.now(); dragging = true; }
    function finish(x, y) {
        if (!dragging) return;
        dragging = false;
        const dx = x - startX, dy = y - startY, dt = Date.now() - startT;
        if (dt > MAX_TIME) return;
        if (Math.abs(dx) > THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
            // swipe only navigates, never triggers the "add new frame?" flow — that's reserved for the explicit ▶ button
            if (dx < 0) { if (currentIdx < frames.length - 1) nextFrame(); }
            else { prevFrame(); }
        }
    }

    zone.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        begin(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    zone.addEventListener('touchend', e => {
        finish(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }, { passive: true });
    zone.addEventListener('touchcancel', () => { dragging = false; }, { passive: true });

    // mouse support for desktop testing
    zone.addEventListener('mousedown', e => begin(e.clientX, e.clientY));
    window.addEventListener('mouseup', e => { if (dragging) finish(e.clientX, e.clientY); });
})();



// touch: pinch-zoom + 2-finger pan
let _vpTouches = [];
let _vpPinchDist = 0;
let _vpPinchMidX = 0, _vpPinchMidY = 0;
let _vpPanStart = null;
let _vpIsPinching = false;

_vpViewport.addEventListener('touchstart', (e) => {
    _vpTouches = Array.from(e.touches);
    if (_vpTouches.length === 2) {
        e.preventDefault(); // MUST block browser zoom — requires passive:false
        _vpIsPinching = true;
        const dx = _vpTouches[1].clientX - _vpTouches[0].clientX;
        const dy = _vpTouches[1].clientY - _vpTouches[0].clientY;
        _vpPinchDist = Math.hypot(dx, dy);
        _vpPinchMidX = (_vpTouches[0].clientX + _vpTouches[1].clientX) / 2;
        _vpPinchMidY = (_vpTouches[0].clientY + _vpTouches[1].clientY) / 2;
        _vpPanStart = { x: vpOffsetX, y: vpOffsetY, midX: _vpPinchMidX, midY: _vpPinchMidY };
    } else {
        _vpIsPinching = false;
    }
}, { passive: false });

_vpViewport.addEventListener('touchmove', (e) => {
    _vpTouches = Array.from(e.touches);
    if (_vpTouches.length === 2 && _vpIsPinching) {
        e.preventDefault();
        const dx = _vpTouches[1].clientX - _vpTouches[0].clientX;
        const dy = _vpTouches[1].clientY - _vpTouches[0].clientY;
        const dist = Math.hypot(dx, dy);
        const midX = (_vpTouches[0].clientX + _vpTouches[1].clientX) / 2;
        const midY = (_vpTouches[0].clientY + _vpTouches[1].clientY) / 2;

        if (_vpPinchDist > 0) {
            const scaleChange = dist / _vpPinchDist;
            const rect = _vpViewport.getBoundingClientRect();
            const cx = midX - rect.left - rect.width / 2;
            const cy = midY - rect.top - rect.height / 2;
            const newScale = Math.min(5, Math.max(_vpMinZoom(), vpScale * scaleChange));
            const ratio = newScale / vpScale;
            vpOffsetX = cx + (vpOffsetX - cx) * ratio;
            vpOffsetY = cy + (vpOffsetY - cy) * ratio;
            vpScale = newScale;
        }
        // 2 finger pan
        if (_vpPanStart) {
            vpOffsetX = _vpPanStart.x + (midX - _vpPanStart.midX);
            vpOffsetY = _vpPanStart.y + (midY - _vpPanStart.midY);
        }

        _vpPinchDist = dist;
        _vpPinchMidX = midX; _vpPinchMidY = midY;
        _applyVpTransform();
        _showZoomIndicator();
    }
}, { passive: false });

_vpViewport.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        _vpIsPinching = false;
        _vpPinchDist = 0;
        _vpPanStart = null;
    }
    _vpTouches = Array.from(e.touches);
}, { passive: true });

// init
_applyVpTransform();

// block browser zoom on ui chrome, viewport does its own pinch
document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1 && !_vpViewport.contains(e.target)) {
        e.preventDefault();
    }
}, { passive: false });
document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1 && !_vpViewport.contains(e.target)) {
        e.preventDefault();
    }
}, { passive: false });
// block ios gesturestart on chrome
document.addEventListener('gesturestart', function(e) {
    if (!_vpViewport.contains(e.target)) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturechange', function(e) {
    if (!_vpViewport.contains(e.target)) e.preventDefault();
}, { passive: false });
// move bg modal
(function() {
    let mbgX = 0, mbgY = 0, mbgScale = 1;
    let dragging = false, startMX = 0, startMY = 0, startBX = 0, startBY = 0;
    const baseSens = 0.30;
    let _moveBgNatDimCache = {};

    function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, Math.round(v))); }

    function syncMoveBgFrame() {
        const el = document.getElementById('move-bg-frame-inner');
        const box = document.getElementById('move-bg-frame');
        if (!el || !box) return;
        // baking zoom into background-size in px instead of a separate transform so background-position's slack math actually sees it, same fix as the main canvas, otherwise pan does nothing when the aspect already matches
        const f = (typeof frames !== 'undefined' && frames[currentIdx]) ? frames[currentIdx] : null;
        const src = f && f.background;
        if (src && (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:'))) {
            const bw = box.offsetWidth || 1, bh = box.offsetHeight || 1;
            let nat = _moveBgNatDimCache[src];
            if (!nat) {
                const probe = new Image();
                probe.onload = () => { _moveBgNatDimCache[src] = { w: probe.naturalWidth || bw, h: probe.naturalHeight || bh }; syncMoveBgFrame(); };
                probe.src = src;
                nat = { w: bw, h: bh };
            }
            const imgAR = nat.w / nat.h, boxAR = bw / bh;
            let baseW, baseH;
            if (imgAR > boxAR) { baseH = bh; baseW = baseH * imgAR; } else { baseW = bw; baseH = baseW / imgAR; }
            const drawW = baseW * mbgScale;
            const drawH = baseH * mbgScale;
            el.style.backgroundSize = drawW + 'px ' + drawH + 'px';
        }
        el.style.backgroundPosition = Math.max(0, Math.min(100, 50 + mbgX / 2)) + '% ' + Math.max(0, Math.min(100, 50 + mbgY / 2)) + '%';
        document.getElementById('mbg-x-range').value = mbgX;
        document.getElementById('mbg-x-num').value   = mbgX;
        document.getElementById('mbg-y-range').value = mbgY;
        document.getElementById('mbg-y-num').value   = mbgY;
    }

    function commitMoveBg() {
        // sync to sliders
        document.getElementById('mob-bg-x').value    = mbgX;
        document.getElementById('mob-bg-x-v').innerText = mbgX;
        document.getElementById('mob-bg-y').value    = mbgY;
        document.getElementById('mob-bg-y-v').innerText = mbgY;
        updateMobBg();
    }

    window.openMoveBgModal = function() {
        const f = frames[currentIdx];
        if (!f || !f.background || f.background === '#ffffff') {
            alert('Add a background image first!'); return;
        }
        // close sheets
        document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
        const s = f.bgSettings || {};
        mbgX = s.x ?? 0;
        mbgY = s.y ?? 0;

        const inner = document.getElementById('move-bg-frame-inner');
        mbgScale = s.scale ?? 1;
        const rotate = s.rotate ?? 0;
        // zoom's already baked into background-size elsewhere, this transform just handles rotation
        inner.style.transform = `rotate(${rotate}deg)`;
        inner.style.transformOrigin = 'center center';
        inner.style.background = '';
        inner.style.backgroundImage = '';

        if (f.background && (f.background.startsWith('data:') || f.background.startsWith('http') || f.background.startsWith('blob:'))) {
            inner.style.backgroundImage = `url('${f.background}')`;
            inner.style.backgroundRepeat = 'no-repeat';
        } else {
            inner.style.background = f.background;
            inner.style.backgroundSize = 'cover';
        }

        const hint = document.getElementById('move-bg-hint');
        hint.style.opacity = '1';
        setTimeout(() => { hint.style.opacity = '0'; }, 2500);
        const modal = document.getElementById('move-bg-modal');
        modal.style.display = 'flex';
        modal.classList.add('open');
        // after display:flex so #move-bg-frame has real layout dimensions to size the bg against
        syncMoveBgFrame();
    };

    let isPanningOnCanvas = false;

    window.closeMoveBgModal = function() {
        commitMoveBg();
        // turn off pan mode
        const overlay = document.getElementById('bg-drag-overlay');
        if (overlay) { overlay.style.display = 'none'; isPanningOnCanvas = false; }
        const badge = document.getElementById('pan-canvas-badge');
        if (badge) badge.remove();
        const modal = document.getElementById('move-bg-modal');
        modal.classList.remove('open');
        modal.style.display = 'none';
        // back to bg sheet
        openSheet('bg');
    };

    window.togglePanOnCanvas = function() {
        isPanningOnCanvas = !isPanningOnCanvas;
        const overlay = document.getElementById('bg-drag-overlay');
        const modal = document.getElementById('move-bg-modal');
        if (isPanningOnCanvas) {
            // hide modal, show drag overlay
            modal.style.display = 'none';
            modal.classList.remove('open');
            if (overlay) overlay.style.display = 'block';
            // return badge
            let badge = document.getElementById('pan-canvas-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'pan-canvas-badge';
                badge.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:5000;background:var(--teal);color:#000;padding:12px 24px;border-radius:30px;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:0.5px;box-shadow:0 4px 20px rgba(0,210,255,0.4);white-space:nowrap;';
                badge.innerHTML = '✋ Panning BG — tap to return';
                badge.onclick = function() {
                    isPanningOnCanvas = false;
                    if (overlay) overlay.style.display = 'none';
                    badge.remove();
                    const m = document.getElementById('move-bg-modal');
                    m.style.display = 'flex';
                    m.classList.add('open');
                    mbgX = parseInt(document.getElementById('mob-bg-x').value) || 0;
                    mbgY = parseInt(document.getElementById('mob-bg-y').value) || 0;
                    syncMoveBgFrame();
                };
                document.body.appendChild(badge);
            }
        } else {
            if (overlay) overlay.style.display = 'none';
            const badge = document.getElementById('pan-canvas-badge');
            if (badge) badge.remove();
            modal.style.display = 'flex';
            modal.classList.add('open');
            mbgX = parseInt(document.getElementById('mob-bg-x').value) || 0;
            mbgY = parseInt(document.getElementById('mob-bg-y').value) || 0;
            syncMoveBgFrame();
        }
    };

    window.resetMoveBg = function() {
        mbgX = 0; mbgY = 0;
        syncMoveBgFrame();
        commitMoveBg();
    };

    window.onMoveBgInput = function(axis, val) {
        const v = clamp(parseFloat(val) || 0, -100, 100);
        if (axis === 'x') mbgX = v; else mbgY = v;
        syncMoveBgFrame();
        commitMoveBg();
    };

    // drag to pan
    document.addEventListener('DOMContentLoaded', function() {
        const frame = document.getElementById('move-bg-frame');
        if (!frame) return;

        frame.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            dragging = true;
            startMX = e.clientX; startMY = e.clientY;
            startBX = mbgX; startBY = mbgY;
            frame.classList.add('dragging');
            e.preventDefault();
        });

        frame.addEventListener('touchstart', function(e) {
            dragging = true;
            startMX = e.touches[0].clientX; startMY = e.touches[0].clientY;
            startBX = mbgX; startBY = mbgY;
            frame.classList.add('dragging');
            e.preventDefault();
        }, { passive: false });

        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            const f = frames[currentIdx];
            const scale = (f && f.bgSettings && f.bgSettings.scale) ? f.bgSettings.scale : 1;
            const SENS = baseSens / Math.max(1, scale);
            mbgX = clamp(startBX + (e.clientX - startMX) * SENS, -100, 100);
            mbgY = clamp(startBY + (e.clientY - startMY) * SENS, -100, 100);
            syncMoveBgFrame();
            commitMoveBg();
        });

        document.addEventListener('touchmove', function(e) {
            if (!dragging) return;
            const f = frames[currentIdx];
            const scale = (f && f.bgSettings && f.bgSettings.scale) ? f.bgSettings.scale : 1;
            const SENS = baseSens / Math.max(1, scale);
            mbgX = clamp(startBX + (e.touches[0].clientX - startMX) * SENS, -100, 100);
            mbgY = clamp(startBY + (e.touches[0].clientY - startMY) * SENS, -100, 100);
            syncMoveBgFrame();
            commitMoveBg();
        }, { passive: true });

        function endDrag() {
            if (!dragging) return;
            dragging = false;
            frame.classList.remove('dragging');
        }
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);

        // esc closes modal
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const modal = document.getElementById('move-bg-modal');
                if (modal.classList.contains('open')) closeMoveBgModal();
            }
        });
    });
})();

// gallery sheet
let mobGallerySprites = null;
let mobGalLoaded = false;
let mobGalActiveTag = null;

async function loadMobGallery() {
    if (mobGalLoaded) return;
    mobGalLoaded = true;
    const grid = document.getElementById('mob-gal-grid');
    grid.innerHTML = '<div style="color:#555;font-size:13px;text-align:center;padding:20px;grid-column:span 3;">Loading gallery...</div>';
    try {
        console.log('Fetching mobile gallery sprites...');
        const { data, error } = await _supabase
            .from('sprites_gallery')
            .select('id, name, default_scale, tags, creator')
            .order('id', { ascending: false });
        console.log('Mobile gallery fetch result:', { data, error });
        if (error) throw new Error(error.message);
        mobGallerySprites = data || [];
        console.log('Mobile gallery sprites loaded:', mobGallerySprites.length);
        renderMobGallery(mobGallerySprites);
        buildMobGalTagChips(mobGallerySprites);
    } catch(e) {
        console.error('Error loading mobile gallery sprites:', e);
        grid.innerHTML = '<div style="color:#555;font-size:13px;text-align:center;padding:20px;grid-column:span 3;">Error loading gallery</div>';
        mobGalLoaded = false;
    }
}

function buildMobGalTagChips(sprites) {
    const wrap = document.getElementById('mob-gal-tag-chips');
    if (!wrap) return;
    const counts = {};
    sprites.forEach(s => (s.tags||[]).forEach(t => { counts[t] = (counts[t]||0)+1; }));
    const top10 = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(e=>e[0]);
    wrap.innerHTML = '';
    ['All', ...top10].forEach((t, i) => {
        const isActive = (i === 0 && !mobGalActiveTag) || mobGalActiveTag === t;
        const btn = document.createElement('button');
        btn.textContent = t;
        btn.dataset.tag = i === 0 ? '' : t;
        btn.style.cssText = `padding:4px 10px;border-radius:12px;border:1px solid ${isActive?'#a855f7':'#222'};background:${isActive?'rgba(168,85,247,0.12)':'#111'};color:${isActive?'#a855f7':'#555'};font-size:10px;font-weight:800;cursor:pointer;font-family:inherit;`;
        btn.onclick = () => {
            mobGalActiveTag = btn.dataset.tag || null;
            wrap.querySelectorAll('button').forEach(b => {
                const active = b.dataset.tag === (mobGalActiveTag || '');
                b.style.borderColor = active ? '#a855f7' : '#222';
                b.style.background  = active ? 'rgba(168,85,247,0.12)' : '#111';
                b.style.color       = active ? '#a855f7' : '#555';
            });
            filterMobGallery();
        };
        wrap.appendChild(btn);
    });
}

function filterMobGallery() {
    if (!mobGallerySprites) return;
    const q    = (document.getElementById('mob-gal-search')?.value || '').toLowerCase().trim();
    const sort = document.getElementById('mob-gal-sort')?.value || 'newest';

    const searchEl = document.getElementById('mob-gal-search');
    const chipsEl  = document.getElementById('mob-gal-tag-chips');
    const gridEl   = document.getElementById('mob-gal-grid');
    const tagSecEl = document.getElementById('mob-gal-tagsections-grid');

    // tag sections mode
    if (sort === 'tagsections') {
        if (searchEl) searchEl.style.display = 'none';
        if (chipsEl)  chipsEl.style.display  = 'none';
        if (gridEl)   gridEl.style.display   = 'none';
        if (tagSecEl) { tagSecEl.style.display = 'grid'; renderMobGalTagSections(); }
        return;
    }
    if (searchEl) searchEl.style.display = '';
    if (chipsEl)  chipsEl.style.display  = 'flex';
    if (gridEl)   gridEl.style.display   = 'grid';
    if (tagSecEl) tagSecEl.style.display = 'none';

    let filtered = mobGallerySprites.filter(s =>
        (!q || s.name.toLowerCase().includes(q) || (s.tags||[]).some(t => t.includes(q))) &&
        (!mobGalActiveTag || (s.tags||[]).includes(mobGalActiveTag))
    );
    filtered = sortSpriteList(filtered, sort);
    renderMobGallery(filtered);
}

// tag section cover cards — note: verify this url still matches the supabase tag_sections folder path
const MOB_TAG_SECTIONS_BASE = 'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/avatars/tag_sections/';
const MOB_TAG_SECTIONS = [
    { tag: 'avengers',     label: 'Avengers',      img: 'avengers.png' },
    { tag: 'marvel',       label: 'Marvel',        img: 'marvel.png' },
    { tag: 'x-men',        label: 'X-Men',         img: 'x-men.png' },
    { tag: 'spider-man',   label: 'Spider-Man',    img: 'spider-man.png' },
    { tag: 'superhero',    label: 'Superhero',     img: 'superhero.png' },
    { tag: 'dc',           label: 'DC',            img: 'dc.png' },
    { tag: 'dbz',          label: 'Dragon Ball Z', img: 'dbz.png' },
    { tag: 'saiyan',       label: 'Saiyan',        img: 'saiyan.png' },
    { tag: 'fighter',      label: 'Fighters',      img: 'fighter.png' },
    { tag: 'supervillian', label: 'Supervillain',  img: 'supervillian.png' },
    { tag: 'villian',      label: 'Villain',       img: 'villian.png' },
];
const MOB_TAG_SECTIONS_EXIT = { label: 'All Sprites', img: 'allsprites.png' };

function renderMobGalTagSections() {
    const grid = document.getElementById('mob-gal-tagsections-grid');
    if (!grid) return;
    grid.innerHTML = '';
    MOB_TAG_SECTIONS.forEach(sec => grid.appendChild(buildMobTagSectionCard(sec, false)));
    grid.appendChild(buildMobTagSectionCard(MOB_TAG_SECTIONS_EXIT, true));
}

function buildMobTagSectionCard(sec, isExit) {
    const card = document.createElement('div');
    card.className = 'mob-sprite-card mob-tagsection-card' + (isExit ? ' mob-tagsection-exit' : '');
    card.innerHTML = `<img src="${MOB_TAG_SECTIONS_BASE}${sec.img}" loading="lazy" alt="${sec.label}"><div class="mob-sprite-name">${sec.label}</div>`;
    card.onclick = () => {
        // tap tag card = enter tag, tap exit = back to all

        mobGalActiveTag = isExit ? null : sec.tag;
        const sortEl = document.getElementById('mob-gal-sort');
        if (sortEl) sortEl.value = 'newest';
        buildMobGalTagChips(mobGallerySprites);
        filterMobGallery();
    };
    return card;
}

async function mobGalFetchFull(id) {
    const cached = sbGetFullCache(id);
    if (cached) return { id, image_data: cached.img, actions: cached.actions, default_scale: cached.default_scale || null };
    const { data } = await _supabase
        .from('sprites_gallery')
        .select('id, image_data, actions, default_scale')
        .eq('id', id).single();
    if (data?.image_data) sbSetFullCache(id, data.image_data, data.actions || {}, data.default_scale);
    return data;
}

function renderMobGallery(sprites) {
    const grid = document.getElementById('mob-gal-grid');
    if (!sprites.length) {
        grid.innerHTML = '<div style="color:#555;font-size:13px;text-align:center;padding:20px;grid-column:span 3;">No sprites found</div>';
        return;
    }
    grid.innerHTML = '';
    sprites.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'mob-sprite-card';
        card.style.position = 'relative';

        // use image_data or cache
        const cachedSrc = sbGetImg ? sbGetImg(pack.id) : null;
        if (cachedSrc) {
            card.innerHTML = `<img src="${cachedSrc}" loading="lazy" style="width:100%;height:100%;object-fit:contain;border-radius:8px;"><div class="mob-sprite-name">${pack.name}</div>`;
            // cache image
            
        } else {
            card.innerHTML = `<div style="width:100%;height:100%;background:linear-gradient(90deg,#1e1e1e 25%,#2a2a2a 50%,#1e1e1e 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:8px;"></div><div class="mob-sprite-name">${pack.name}</div>`;
            {
                const obs = new IntersectionObserver(entries => {
                    if (!entries[0].isIntersecting) return;
                    obs.disconnect();
                    mobGalFetchFull(pack.id).then(full => {
                        if (!full || !full.image_data) return;
                        const skel = card.querySelector('div:first-child');
                        if (skel) { const img = document.createElement('img'); img.src = full.image_data; img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:8px;'; skel.replaceWith(img); }
                    });
                }, { root: grid });
                obs.observe(card);
            }
        }

        // fav star
        const favBtn = document.createElement('button');
        favBtn.title = 'Favourite';
        favBtn.innerText = isMobFaved('sprite', pack.id) ? '⭐' : '☆';
        favBtn.style.cssText = 'position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.6);border:none;border-radius:4px;cursor:pointer;font-size:12px;padding:1px 3px;line-height:1;z-index:20;';
        favBtn.onclick = (e) => {
            e.stopPropagation();
            mobToggleFav('sprite', pack.id, pack);
            favBtn.innerText = isMobFaved('sprite', pack.id) ? '⭐' : '☆';
        };
        card.appendChild(favBtn);

        card.onclick = async (e) => {
            if (e.target === favBtn) return;
            lsSet('sprite-used-' + pack.id, Date.now());
            const full = await mobGalFetchFull(pack.id);
            if (full) { closeSheet('gallery'); openActionModal({ ...pack, ...full }); }
        };

        grid.appendChild(card);
    });
}

// my sprites: toast + mobile favorites
const MOB_FAV_SPRITE_KEY = 'cc_fav_sprites_v1';
const MOB_FAV_PACK_KEY   = 'cc_fav_packs_v1';

function getMobFavs(type) {
    const key = type === 'pack' ? MOB_FAV_PACK_KEY : MOB_FAV_SPRITE_KEY;
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; }
}
function saveMobFavs(type, arr) {
    const key = type === 'pack' ? MOB_FAV_PACK_KEY : MOB_FAV_SPRITE_KEY;
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) {}
}
function isMobFaved(type, id) {
    return getMobFavs(type).some(f => f.id === id);
}
function mobToggleFav(type, id, packData) {
    const arr = getMobFavs(type);
    const idx = arr.findIndex(f => f.id === id);
    if (idx === -1) {
        arr.unshift({ id, name: packData.name || 'Sprite', tags: packData.tags || [], creator: packData.creator || '', created_at: packData.created_at || new Date().toISOString(), default_scale: packData.default_scale || null });
        showToast('⭐ Added to Favorites!');
    } else {
        arr.splice(idx, 1);
        showToast('Removed from Favorites');
    }
    saveMobFavs(type, arr);
}

let mobFavActiveTab = 'sprites';

function switchMobFavTab(tab) {
    mobFavActiveTab = tab;
    const tS = document.getElementById('mob-fav-tab-sprites');
    const tP = document.getElementById('mob-fav-tab-packs');
    if (tS) { tS.style.background = tab==='sprites'?'var(--accent)':'#111'; tS.style.color = tab==='sprites'?'#000':'#555'; }
    if (tP) { tP.style.background = tab==='packs'  ?'var(--accent)':'#111'; tP.style.color = tab==='packs'  ?'#000':'#555'; }
    const pS = document.getElementById('mob-fav-sprites-panel');
    const pP = document.getElementById('mob-fav-packs-panel');
    if (pS) pS.style.display = tab==='sprites' ? 'block' : 'none';
    if (pP) pP.style.display = tab==='packs'   ? 'block' : 'none';
    renderMobFavPanel();
}

function renderMobFavPanel() {
    if (mobFavActiveTab === 'sprites') renderMobFavSprites();
    else renderMobFavPacks();
}

function renderMobFavSprites() {
    const grid = document.getElementById('mob-fav-sprite-grid');
    if (!grid) return;
    const q = (document.getElementById('mob-fav-sprite-search')?.value || '').toLowerCase().trim();
    let favs = getMobFavs('sprite');
    if (q) favs = favs.filter(f => f.name.toLowerCase().includes(q) || (f.tags||[]).some(t => t.includes(q)));
    if (!favs.length) {
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;grid-column:span 3;font-size:11px;">No favorite sprites yet<br><span style="font-size:10px;color:#333;">☆ Tap the star on Library sprites</span></div>';
        return;
    }
    grid.innerHTML = '';
    favs.forEach(fav => {
        const card = document.createElement('div');
        card.className = 'mob-sprite-card';
        card.style.position = 'relative';
        const cachedSrc = fav.image_data || (sbGetImg ? sbGetImg(fav.id) : null);
        if (cachedSrc) {
            const img = document.createElement('img'); img.src = cachedSrc; img.loading = 'lazy'; card.appendChild(img);
            // cache image
            if (fav.image_data && sbSetImg) sbSetImg(fav.id, fav.image_data);
        } else {
            const sk = document.createElement('div');
            sk.style.cssText = 'width:100%;height:100%;background:linear-gradient(90deg,#1e1e1e 25%,#2a2a2a 50%,#1e1e1e 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:8px;';
            card.appendChild(sk);
            // fallback lazy load
            if (!fav.image_data) {
                sbFetchFull(fav.id).then(full => {
                    if (!full?.image_data) return;
                    const old = card.querySelector('div');
                    if (old) { const img = document.createElement('img'); img.src = full.image_data; img.loading = 'lazy'; old.replaceWith(img); }
                });
            }
        }
        const nameEl = document.createElement('div'); nameEl.className = 'mob-sprite-name'; nameEl.innerText = fav.name;
        card.appendChild(nameEl);
        // unfav button
        const unfavBtn = document.createElement('button');
        unfavBtn.innerText = '⭐';
        unfavBtn.style.cssText = 'position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.6);border:none;border-radius:4px;cursor:pointer;font-size:12px;padding:1px 3px;line-height:1;z-index:20;';
        unfavBtn.onclick = (e) => { e.stopPropagation(); mobToggleFav('sprite', fav.id, fav); renderMobFavSprites(); };
        card.appendChild(unfavBtn);
        card.onclick = async (e) => {
            if (e.target === unfavBtn) return;
            const full = await sbFetchFull(fav.id);
            if (full) { closeSheet('favorites'); openActionModal({ ...fav, ...full }); }
        };
        grid.appendChild(card);
    });
}

function renderMobFavPacks() {
    const grid = document.getElementById('mob-fav-pack-grid');
    if (!grid) return;
    const q = (document.getElementById('mob-fav-pack-search')?.value || '').toLowerCase().trim();
    let favs = getMobFavs('pack');
    if (q) favs = favs.filter(f => f.name.toLowerCase().includes(q) || (f.tags||[]).some(t => t.includes(q)));
    if (!favs.length) {
        grid.innerHTML = '<div style="color:#555;text-align:center;padding:20px;font-size:11px;">No favorite packs yet<br><span style="font-size:10px;color:#333;">☆ Star packs in the Library</span></div>';
        return;
    }
    grid.innerHTML = '';
    favs.forEach(fav => {
        const existingPack = (mobSidebarPacks||[]).find(p => p.id === fav.id);
        let items = existingPack?.items || [];
        if (typeof items === 'string') try { items = JSON.parse(items); } catch(e) { items = []; }

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;background:#111;border:1.5px solid #2a2a2a;border-radius:12px;cursor:pointer;position:relative;transition:0.15s;';
        row.onmouseover = () => row.style.borderColor = '#f4c542';
        row.onmouseout  = () => row.style.borderColor = '#2a2a2a';

        // thumbnail
        const thumb = document.createElement('div');
        thumb.style.cssText = 'width:52px;height:52px;flex-shrink:0;border-radius:8px;background:#1a1a1a;border:1px solid #333;overflow:hidden;display:flex;align-items:center;justify-content:center;';
        // thumbnail from card_sprites or cover_image
        const cardSprites = existingPack?.card_sprites || fav.card_sprites || [];
        const thumbSrc = cardSprites[2] || cardSprites[1] || cardSprites[0] || existingPack?.cover_image || fav.cover_image || null;
        if (thumbSrc) {
            const img = document.createElement('img'); img.src = thumbSrc; img.style.cssText = 'width:100%;height:100%;object-fit:contain;padding:4px;'; thumb.appendChild(img);
        } else {
            thumb.innerHTML = '<span style="font-size:20px;color:#333;">📦</span>';
        }
        row.appendChild(thumb);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML = `<div style="font-size:12px;font-weight:800;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fav.name}</div><div style="font-size:10px;color:#555;font-weight:700;margin-top:2px;">${items.length || '?'} sprites</div>`;
        row.appendChild(info);

        // unfav
        const unfavBtn = document.createElement('button');
        unfavBtn.innerText = '⭐';
        unfavBtn.style.cssText = 'background:rgba(0,0,0,0.5);border:none;border-radius:6px;cursor:pointer;font-size:14px;padding:4px 6px;color:#f4c542;flex-shrink:0;';
        unfavBtn.onclick = (e) => { e.stopPropagation(); mobToggleFav('pack', fav.id, fav); renderMobFavPacks(); };
        row.appendChild(unfavBtn);

        row.onclick = (e) => {
            if (e.target === unfavBtn) return;
            const pack = existingPack || fav;
            openPackSpriteSheet(pack, Array.isArray(items) ? items : []);
        };
        grid.appendChild(row);
    });
}

function showToast(msg) {
    let el = document.getElementById('mys-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mys-toast';
        el.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(20,20,22,0.96);color:#fff;padding:9px 20px;border-radius:20px;font-size:12px;font-weight:800;z-index:9999;pointer-events:none;border:1px solid #333;letter-spacing:0.5px;transition:opacity 0.3s;white-space:nowrap;';
        document.body.appendChild(el);
    }
    el.innerText = msg; el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.opacity = '0', 2400);
}

// publish progress widget: thumbnail + progress ring + eta, blocks nav until export finishes so it doesn't look frozen
const _PPW_RADIUS = 28;
const _PPW_CIRC = 2 * Math.PI * _PPW_RADIUS;
function showPublishProgressWidget(coverUrl) {
    let el = document.getElementById('publish-progress-widget');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'publish-progress-widget';
    el.style.cssText = 'position:fixed;bottom:96px;right:18px;width:64px;height:78px;z-index:10000;font-family:inherit;';
    el.innerHTML = `
        <svg viewBox="0 0 64 64" style="position:absolute;top:0;left:0;width:64px;height:64px;transform:rotate(-90deg);">
            <circle cx="32" cy="32" r="${_PPW_RADIUS}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4"></circle>
            <circle id="ppw-ring" cx="32" cy="32" r="${_PPW_RADIUS}" fill="none" stroke="var(--accent)" stroke-width="4"
                stroke-dasharray="${_PPW_CIRC}" stroke-dashoffset="${_PPW_CIRC}" stroke-linecap="round"
                style="transition:stroke-dashoffset 0.25s linear;"></circle>
        </svg>
        <div style="position:absolute;top:5px;left:5px;width:54px;height:54px;border-radius:11px;overflow:hidden;background:#111;box-shadow:0 4px 14px rgba(0,0,0,0.4);">
            ${coverUrl ? `<img src="${coverUrl}" style="width:100%;height:100%;object-fit:cover;display:block;">` : ''}
        </div>
        <div id="ppw-label" style="position:absolute;bottom:0;left:0;width:100%;text-align:center;font-size:10px;font-weight:800;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.8);"></div>`;
    document.body.appendChild(el);
}
function updatePublishProgressWidget(done, total, startTime) {
    const ring = document.getElementById('ppw-ring');
    const label = document.getElementById('ppw-label');
    if (!ring || !label) return;
    const pct = total > 0 ? Math.min(1, done / total) : 0;
    ring.setAttribute('stroke-dashoffset', String(_PPW_CIRC * (1 - pct)));
    const elapsedSec = (Date.now() - startTime) / 1000;
    const rate = elapsedSec > 0 ? done / elapsedSec : 0; // frames/sec
    const remaining = rate > 0 ? Math.max(0, (total - done) / rate) : null;
    label.innerText = remaining == null ? Math.round(pct * 100) + '%' : '~' + _formatETA(remaining) + ' left';
}
function hidePublishProgressWidget() {
    const el = document.getElementById('publish-progress-widget');
    if (el) el.remove();
}
function _formatETA(seconds) {
    seconds = Math.round(seconds);
    if (seconds < 60) return seconds + 's';
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return m + 'm' + (s ? ' ' + s + 's' : '');
}
let mySpritesData = null;
const MYS_CACHE_KEY = 'cc_user_sprites_meta_v1';
const MYS_CACHE_TTL = 5 * 60 * 1000;
function mysSaveCache(data) { try { localStorage.setItem(MYS_CACHE_KEY, JSON.stringify({ts:Date.now(),data})); } catch(e) {} }
function mysLoadCache() {
    try {
        const raw = localStorage.getItem(MYS_CACHE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (Date.now() - p.ts > MYS_CACHE_TTL) { localStorage.removeItem(MYS_CACHE_KEY); return null; }
        return p.data;
    } catch(e) { return null; }
}

async function loadMySprites() {
    const grid = document.getElementById('mob-mys-grid');
    if (!grid) return;
    const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
    if (!profile.handle) {
        grid.innerHTML = '<div style="grid-column:span 3;text-align:center;color:#555;font-size:13px;padding:20px;">Log in to see your sprites</div>';
        return;
    }
    // check for new sprite from editor
    const editorResult = localStorage.getItem('sprite_editor_result');
    if (editorResult) {
        localStorage.removeItem('sprite_editor_result');
        localStorage.removeItem(MYS_CACHE_KEY);
        mySpritesData = null;
        showToast('✅ Sprite saved!');
    }
    const cached = mysLoadCache();
    if (cached && mySpritesData === null) { mySpritesData = cached; renderMobMySpritesGrid(mySpritesData); }
    else if (!cached) { grid.innerHTML = '<div style="grid-column:span 3;text-align:center;color:#555;font-size:13px;padding:20px;">Loading your sprites…</div>'; }
    try {
        const { data, error } = await _supabase.from('user_sprites')
            .select('id, name, image_data, actions, created_at')
            .eq('owner_handle', profile.handle)
            .order('created_at', { ascending: false });
        if (error) throw error;
        mySpritesData = data || [];
        mysSaveCache(mySpritesData);
        renderMobMySpritesGrid(mySpritesData);
    } catch(e) {
        if (!cached) grid.innerHTML = '<div style="grid-column:span 3;text-align:center;color:#f33;font-size:13px;padding:20px;">Error loading sprites</div>';
    }
}

function mobFilterMySprites() {
    if (!mySpritesData) return;
    const q = (document.getElementById('mob-mys-search')?.value || '').toLowerCase().trim();
    let list = [...mySpritesData];
    if (q) list = list.filter(s => (s.name||'').toLowerCase().includes(q));
    renderMobMySpritesGrid(list);
}

function renderMobMySpritesGrid(sprites) {
    const grid = document.getElementById('mob-mys-grid');
    if (!grid) return;
    if (!sprites || !sprites.length) {
        grid.innerHTML = '<div style="grid-column:span 3;text-align:center;color:#555;font-size:13px;padding:20px;">No sprites yet — create one!</div>';
        return;
    }
    grid.innerHTML = '';
    sprites.forEach(sp => {
        const card = document.createElement('div');
        card.className = 'mob-sprite-card';
        card.style.position = 'relative';
        const imgSrc = sp.image_data || '';
        card.innerHTML = imgSrc
            ? `<img src="${imgSrc}" crossorigin="anonymous" style="width:100%;height:100%;object-fit:contain;padding:6px;">`
            : `<div style="width:100%;height:70px;display:flex;align-items:center;justify-content:center;color:#333;font-size:28px;">?</div>`;
        card.innerHTML += `<div class="mob-sprite-name">${sp.name || 'Sprite'}</div>`;
        // edit btn
        const editBtn = document.createElement('button');
        editBtn.style.cssText = 'position:absolute;top:3px;left:3px;background:rgba(0,210,255,0.9);border:none;border-radius:4px;cursor:pointer;font-size:10px;padding:2px 5px;color:#000;font-weight:900;-webkit-tap-highlight-color:transparent;';
        editBtn.innerText = '✏';
        editBtn.onclick = (e) => { e.stopPropagation(); closeSheet('mysprites'); openSpriteEditorEdit(sp.id, sp.name, imgSrc, sp.actions); };
        card.appendChild(editBtn);
        // del btn
        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'position:absolute;top:3px;right:3px;background:rgba(255,59,48,0.85);border:none;border-radius:4px;cursor:pointer;font-size:10px;padding:2px 5px;color:#fff;font-weight:900;-webkit-tap-highlight-color:transparent;';
        delBtn.innerText = '✕';
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this sprite?')) return;
            await _supabase.from('user_sprites').delete().eq('id', sp.id);
            mySpritesData = (mySpritesData||[]).filter(s => s.id !== sp.id);
            mysSaveCache(mySpritesData);
            renderMobMySpritesGrid(mySpritesData);
        };
        card.appendChild(delBtn);
        card.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            let actions = sp.actions || {};
            if (typeof actions === 'string') try { actions = JSON.parse(actions); } catch(x) { actions = {}; }
            closeSheet('mysprites');
            openActionModal({ id: sp.id, name: sp.name, image_data: sp.image_data, actions, isUserSprite: true });
        };
        grid.appendChild(card);
    });
}

// go to sprite editor
function openSpriteEditorNew() {
    saveOffline(true);
    localStorage.setItem('sprite_editor_context', JSON.stringify({
        spriteId: null, spriteName: 'New Sprite', imageData: null, actions: null,
        returnPage: location.href
    }));
    location.href = 'sprite-editor.html';
}

function openSpriteEditorEdit(id, name, imageData, actions) {
    saveOffline(true);
    let acts = actions;
    if (typeof acts === 'string') try { acts = JSON.parse(acts); } catch(e) { acts = {}; }
    localStorage.setItem('sprite_editor_context', JSON.stringify({
        spriteId: id, spriteName: name, imageData, actions: acts,
        returnPage: location.href
    }));
    location.href = 'sprite-editor.html';
}

// check for sprite editor result on load
(function() {
    const raw = localStorage.getItem('sprite_editor_result');
    if (!raw) return;
    localStorage.removeItem('sprite_editor_result');
    localStorage.removeItem(MYS_CACHE_KEY);
    setTimeout(() => showToast('✅ Sprite saved! Find it in "MY" sprites'), 800);
})();
function showNewFramePopup() {
    const el = document.getElementById('new-frame-popup');
    el.style.display = 'flex';
}
function closeNewFramePopup() {
    document.getElementById('new-frame-popup').style.display = 'none';
}
function newFrameChoice(answer, remember) {
    closeNewFramePopup();
    if (remember) localStorage.setItem('cc-new-frame-pref', answer);
    if (answer === 'yes') addFrame();
}
// tap backdrop = dismiss
document.getElementById('new-frame-popup').addEventListener('click', function(e) {
    if (e.target === this) closeNewFramePopup();
});

// color fx overlay: brightness/contrast etc stay native css filters (fxFilter), lightness/color balance aren't native so faked with one tint per slider — same tint list used by dom and canvas so preview matches export


// fx config → color/alpha tint list, shared by dom and canvas
function colorFxOverlayLayers(cf) {
    const layers = [];
    if (!cf) return layers;
    const L = cf.lightness || 0;
    if (L > 0)      layers.push({ color: '255,255,255', alpha: Math.min(0.85, (L / 100) * 0.85) });
    else if (L < 0) layers.push({ color: '0,0,0',        alpha: Math.min(0.85, (-L / 100) * 0.85) });

    const cr = cf.cr || 0;
    if (cr > 0)      layers.push({ color: '255,40,40',   alpha: Math.min(0.5, (cr / 100) * 0.5) });   // toward Red
    else if (cr < 0) layers.push({ color: '40,220,220',  alpha: Math.min(0.5, (-cr / 100) * 0.5) });  // toward Cyan

    const mg = cf.mg || 0;
    if (mg > 0)      layers.push({ color: '40,220,90',   alpha: Math.min(0.5, (mg / 100) * 0.5) });   // toward Green
    else if (mg < 0) layers.push({ color: '230,40,220',  alpha: Math.min(0.5, (-mg / 100) * 0.5) });  // toward Magenta

    const yb = cf.yb || 0;
    if (yb > 0)      layers.push({ color: '50,90,240',   alpha: Math.min(0.5, (yb / 100) * 0.5) });   // toward Blue
    else if (yb < 0) layers.push({ color: '245,215,40',  alpha: Math.min(0.5, (-yb / 100) * 0.5) });  // toward Yellow

    return layers;
}

// dom version
function applyColorFxToDOM(el, layer) {
    const old = el.querySelector(':scope > .layer-colorfx-overlay');
    if (old) old.remove();
    if (!layer || !layer.colorFx || !layer.colorFx.enabled) return;
    const layers = colorFxOverlayLayers(layer.colorFx);
    if (!layers.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'layer-colorfx-overlay';
    layers.forEach(L => {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;inset:0;background:rgba(${L.color},${L.alpha});`;
        wrap.appendChild(d);
    });
    el.style.position = el.style.position || 'relative';
    el.appendChild(wrap);
}

// canvas version
function renderColorFxOnCanvas(ctx, layer, lx, ly, lw, lh) {
    if (!layer || !layer.colorFx || !layer.colorFx.enabled) return;
    const layers = colorFxOverlayLayers(layer.colorFx);
    if (!layers.length) return;
    ctx.save();
    layers.forEach(L => {
        ctx.fillStyle = `rgba(${L.color},${L.alpha})`;
        ctx.fillRect(lx, ly, lw, lh);
    });
    ctx.restore();
}
