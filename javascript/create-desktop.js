// create-desktop.js: desktop-only behavior on top of create-mobile.js (load after it).
// canvas fit for the docked layout, wheel zoom, space/middle-mouse pan, keyboard shortcuts.
(function () {
    const vp = document.getElementById('viewport');

    // fit to the center column, not the whole window (mobile version measures visualViewport width)
    window.computeCanvasSize = function (w, h) {
        const vpW = vp.clientWidth - 48, vpH = vp.clientHeight - 48;
        let cw, ch;
        if (w / h > vpW / vpH) { cw = vpW; ch = Math.round(vpW * h / w); }
        else { ch = vpH; cw = Math.round(vpH * w / h); }
        return { cw, ch };
    };
    // the first fit ran before this override existed; redo it once layout has settled
    window.addEventListener('load', () => setTimeout(() => { try { setRatio(canvasRatio.w, canvasRatio.h); } catch (e) {} }, 150));
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { try { setRatio(canvasRatio.w, canvasRatio.h); } catch (e) {} }, 120); });

    // wheel = zoom at cursor (pinch on trackpads arrives as ctrl+wheel)
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = vp.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2, cy = e.clientY - rect.top - rect.height / 2;
        const ns = Math.min(5, Math.max(_vpMinZoom(), vpScale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
        const r = ns / vpScale;
        vpOffsetX = cx + (vpOffsetX - cx) * r; vpOffsetY = cy + (vpOffsetY - cy) * r; vpScale = ns;
        _applyVpTransform(); _showZoomIndicator();
    }, { passive: false });

    // pan: middle mouse, or hold space and drag
    let space = false, pan = null;
    vp.addEventListener('mousedown', e => {
        if (e.button === 1 || (e.button === 0 && space)) {
            e.preventDefault(); e.stopPropagation();
            pan = { x: e.clientX, y: e.clientY, ox: vpOffsetX, oy: vpOffsetY };
        }
    }, true);
    window.addEventListener('mousemove', e => {
        if (!pan) return;
        vpOffsetX = pan.ox + e.clientX - pan.x; vpOffsetY = pan.oy + e.clientY - pan.y; _applyVpTransform();
    });
    window.addEventListener('mouseup', () => { pan = null; });

    const typing = t => t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]');
    const modalOpen = () => [...document.querySelectorAll('.overlay-full')].some(m => getComputedStyle(m).display !== 'none');

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeAllSheets(); closeTransformSheet(); return; }
        if (typing(e.target) || modalOpen()) return;
        const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        if (e.code === 'Space') { space = true; document.body.classList.add('space-pan'); e.preventDefault(); return; }
        if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (mod && k === 'y') { e.preventDefault(); redo(); }
        else if (mod && k === 's') { e.preventDefault(); openSaveChoiceModal(); }
        else if (mod) return;
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteLayer(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); prevFrame(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); nextFrame(); }
        else if (e.key === '+' || e.key === '=') vpZoomStep(0.25);
        else if (e.key === '-') vpZoomStep(-0.25);
        else if (e.key === '0') vpZoomReset();
    });
    document.addEventListener('keyup', e => {
        if (e.code === 'Space') { space = false; document.body.classList.remove('space-pan'); }
    });
})();
