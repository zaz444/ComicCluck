/* idb.js — offline storage for spritomic, load right after dexie.min.js
   - local indexeddb mirror of the comics/drafts supabase tables
   - window.CCOffline = the cache/read helpers everything else calls into
   - shows/hides the "you're offline" banner
   - sync queue: pushes offline drafts to supabase on reconnect, server
     wins if it moved on while we were offline
   (not called "saveOffline" bc that name's already taken elsewhere by
   the cloud autosave-to-drafts flow) */

(function () {
  // local db schema. keeping the old 'ComicCoreLocal' db name and the
  // window.ComicCoreDB global on purpose — renaming either one orphans
  // everyone's already-cached offline comics/drafts
  const db = new Dexie('ComicCoreLocal');
  db.version(3).stores({
    comics: 'id, owner_handle, cached_at, pending_sync', // pending_sync = edited offline, needs a push
    drafts: 'id, owner_handle, updated_at, pending_sync', // mirrors the cloud autosave
    // own table per asset type, same numeric id can mean 3 different things otherwise
    sprites: 'id, cached_at',
    backgrounds: 'id, cached_at',
    effects: 'id, cached_at',
  });

  window.ComicCoreDB = db;

  // url params give ids as strings, indexeddb keys care about type, so
  // "42" != 42 and lookups would silently miss. drafts use real uuids
  // so isNaN() just leaves those alone
  function normalizeId(id) {
    if (typeof id === 'string' && id !== '' && !isNaN(id)) return Number(id);
    return id;
  }

  // public helpers, called from reader/my-comics/create pages
  window.CCOffline = {
    // -- comics (published) --------------------------
    async cacheComic(comic) {
      if (!comic || comic.id == null) return;
      try {
        const id = normalizeId(comic.id);
        await db.comics.put({ ...comic, id, cached_at: Date.now(), pending_sync: !!comic.pending_sync });
      } catch (e) { console.warn('CCOffline.cacheComic failed:', e); }
    },

    async getCachedComic(id) {
      try { return await db.comics.get(normalizeId(id)); }
      catch (e) { console.warn('CCOffline.getCachedComic failed:', e); return null; }
    },

    async cacheMyComics(handle, comics) {
      if (!handle || !Array.isArray(comics)) return;
      try {
        await db.comics.bulkPut(
          comics.map((c) => ({ ...c, id: normalizeId(c.id), owner_handle: handle, cached_at: Date.now(), pending_sync: !!c.pending_sync }))
        );
      } catch (e) { console.warn('CCOffline.cacheMyComics failed:', e); }
    },

    async getCachedMyComics(handle) {
      try { return await db.comics.where('owner_handle').equals(handle).toArray(); }
      catch (e) { console.warn('CCOffline.getCachedMyComics failed:', e); return []; }
    },

    // -- drafts (in-progress editing) -----------------
    async cacheDraft(draft) {
      if (!draft || !draft.id) return;
      try {
        // baseline updated_at so sync can tell later if the server moved on without us
        let baseUpdatedAt;
        if (draft.pending_sync) {
          const existing = await db.drafts.get(draft.id);
          if (existing && existing.pending_sync && existing._base_updated_at) {
            baseUpdatedAt = existing._base_updated_at; // keep it through repeated offline saves
          } else {
            baseUpdatedAt = (existing && existing.updated_at) || null; // null = brand new, made offline
          }
        }
        await db.drafts.put({
          ...draft,
          cached_at: Date.now(),
          pending_sync: !!draft.pending_sync,
          _base_updated_at: draft.pending_sync ? baseUpdatedAt : undefined,
        });
      } catch (e) { console.warn('CCOffline.cacheDraft failed:', e); }
    },

    async getCachedDraft(id) {
      try { return await db.drafts.get(id); }
      catch (e) { console.warn('CCOffline.getCachedDraft failed:', e); return null; }
    },

    async cacheMyDrafts(handle, drafts) {
      if (!handle || !Array.isArray(drafts)) return;
      try {
        // don't stomp drafts still waiting to sync, the fetched list predates that edit
        const existingPending = new Set(
          (await db.drafts.where('owner_handle').equals(handle).toArray())
            .filter((d) => d.pending_sync)
            .map((d) => d.id)
        );
        const toWrite = drafts.filter((d) => !existingPending.has(d.id));
        await db.drafts.bulkPut(
          toWrite.map((d) => ({ ...d, owner_handle: handle, cached_at: Date.now(), pending_sync: false }))
        );
      } catch (e) { console.warn('CCOffline.cacheMyDrafts failed:', e); }
    },

    async getCachedMyDrafts(handle) {
      try { return await db.drafts.where('owner_handle').equals(handle).toArray(); }
      catch (e) { console.warn('CCOffline.getCachedMyDrafts failed:', e); return []; }
    },

    async deleteCachedDraft(id) {
      try { await db.drafts.delete(id); }
      catch (e) { console.warn('CCOffline.deleteCachedDraft failed:', e); }
    },

    // -- sprite library (create.html's sprite picker) -------------------
    // merge not overwrite, a metadata-only fetch shouldn't nuke image data we already have
    async cacheSpriteLibrary(sprites) {
      if (!Array.isArray(sprites) || !sprites.length) return;
      try {
        const ids = sprites.map((s) => s.id);
        const existingRows = await db.sprites.bulkGet(ids);
        const merged = sprites.map((s, i) => ({
          ...(existingRows[i] || {}),
          ...s,
          // keep existing image_data/actions if this fetch didn't bring any
          image_data: s.image_data || existingRows[i]?.image_data,
          actions: s.actions || existingRows[i]?.actions,
          default_scale: s.default_scale ?? existingRows[i]?.default_scale,
          cached_at: Date.now(),
        }));
        await db.sprites.bulkPut(merged);
      } catch (e) { console.warn('CCOffline.cacheSpriteLibrary failed:', e); }
    },

    async cacheSpriteFull(id, full) {
      if (!id || !full) return;
      try {
        const existing = await db.sprites.get(id);
        await db.sprites.put({
          ...(existing || { id }),
          image_data: full.image_data,
          actions: full.actions,
          default_scale: full.default_scale,
          cached_at: Date.now(),
        });
      } catch (e) { console.warn('CCOffline.cacheSpriteFull failed:', e); }
    },

    async getCachedSpriteLibrary() {
      try { return await db.sprites.toArray(); }
      catch (e) { console.warn('CCOffline.getCachedSpriteLibrary failed:', e); return []; }
    },

    async getCachedSprite(id) {
      try { return await db.sprites.get(id); }
      catch (e) { console.warn('CCOffline.getCachedSprite failed:', e); return null; }
    },

    // -- background library --------------------------------------------
    async cacheBackgroundLibrary(backgrounds) {
      if (!Array.isArray(backgrounds) || !backgrounds.length) return;
      try {
        const ids = backgrounds.map((b) => b.id);
        const existingRows = await db.backgrounds.bulkGet(ids);
        const merged = backgrounds.map((b, i) => ({
          ...(existingRows[i] || {}),
          ...b,
          image_data: b.image_data || existingRows[i]?.image_data,
          cached_at: Date.now(),
        }));
        await db.backgrounds.bulkPut(merged);
      } catch (e) { console.warn('CCOffline.cacheBackgroundLibrary failed:', e); }
    },

    async cacheBackgroundFull(id, full) {
      if (!id || !full) return;
      try {
        const existing = await db.backgrounds.get(id);
        await db.backgrounds.put({ ...(existing || { id }), ...full, cached_at: Date.now() });
      } catch (e) { console.warn('CCOffline.cacheBackgroundFull failed:', e); }
    },

    async getCachedBackgroundLibrary() {
      try { return await db.backgrounds.toArray(); }
      catch (e) { console.warn('CCOffline.getCachedBackgroundLibrary failed:', e); return []; }
    },

    async getCachedBackground(id) {
      try { return await db.backgrounds.get(id); }
      catch (e) { console.warn('CCOffline.getCachedBackground failed:', e); return null; }
    },

    // -- effect library ---------------------------------------------------
    async cacheEffectLibrary(effects) {
      if (!Array.isArray(effects) || !effects.length) return;
      try {
        const ids = effects.map((x) => x.id);
        const existingRows = await db.effects.bulkGet(ids);
        const merged = effects.map((x, i) => ({
          ...(existingRows[i] || {}),
          ...x,
          image_data: x.image_data || existingRows[i]?.image_data,
          actions: x.actions || existingRows[i]?.actions,
          default_scale: x.default_scale ?? existingRows[i]?.default_scale,
          cached_at: Date.now(),
        }));
        await db.effects.bulkPut(merged);
      } catch (e) { console.warn('CCOffline.cacheEffectLibrary failed:', e); }
    },

    async cacheEffectFull(id, full) {
      if (!id || !full) return;
      try {
        const existing = await db.effects.get(id);
        await db.effects.put({ ...(existing || { id }), ...full, cached_at: Date.now() });
      } catch (e) { console.warn('CCOffline.cacheEffectFull failed:', e); }
    },

    async getCachedEffectLibrary() {
      try { return await db.effects.toArray(); }
      catch (e) { console.warn('CCOffline.getCachedEffectLibrary failed:', e); return []; }
    },

    async getCachedEffect(id) {
      try { return await db.effects.get(id); }
      catch (e) { console.warn('CCOffline.getCachedEffect failed:', e); return null; }
    },

    // -- misc ------------------------------------------
    isOnline() {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    },

    // -- sync queue --------------------------------------
    // pushes pending offline drafts to supabase, no-ops if offline or no sdk
    async syncPendingDrafts() {
      return syncPendingDrafts();
    },
  };

  // own supabase client just for the sync queue below — pages' own
  // _sb/_supabase consts aren't reachable from here, and multiple client
  // instances against the same project are totally fine
  const SUPABASE_URL = 'https://mmycqeejhguzhtzkyjaj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE';
  let _syncClient = null;

  function getSyncClient() {
    if (_syncClient) return _syncClient;
    if (typeof supabase === 'undefined' || !supabase.createClient) return null; // SDK not loaded on this page
    try {
      _syncClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) { console.warn('CCOffline sync client init failed:', e); }
    return _syncClient;
  }

  let _syncInFlight = false;

  async function syncPendingDrafts() {
    if (_syncInFlight) return { pushed: 0, conflicts: 0 }; // avoid overlapping runs
    if (!navigator.onLine) return { pushed: 0, conflicts: 0 };

    const client = getSyncClient();
    if (!client) return { pushed: 0, conflicts: 0 };

    _syncInFlight = true;
    let pushed = 0, conflicts = 0;

    try {
      const all = await db.drafts.toArray();
      const pending = all.filter((d) => d.pending_sync);

      for (const draft of pending) {
        try {
          // server-wins check — if it moved on since our offline edit started, we lose
          const { data: serverRow } = await client
            .from('drafts').select('updated_at').eq('id', draft.id).maybeSingle();

          const baseline = draft._base_updated_at;
          const serverMovedOn =
            serverRow && baseline && new Date(serverRow.updated_at) > new Date(baseline);

          if (serverMovedOn) {
            // conflict, toss our edit and take the server's copy
            const { data: full } = await client.from('drafts').select('*').eq('id', draft.id).maybeSingle();
            if (full) await db.drafts.put({ ...full, cached_at: Date.now(), pending_sync: false, _base_updated_at: undefined });
            else await db.drafts.delete(draft.id);
            conflicts++;
            continue;
          }

          // no conflict, push ours
          const row = {
            id: draft.id,
            owner_handle: draft.owner_handle,
            title: draft.title,
            data: draft.data,
            storage_path: null,
            canvas_ratio: draft.canvas_ratio,
            updated_at: draft.updated_at,
          };
          const { error } = await client.from('drafts').upsert(row, { onConflict: 'id' });
          if (error) throw error;

          await db.drafts.put({ ...draft, pending_sync: false, _base_updated_at: undefined });
          pushed++;
        } catch (e) {
          console.warn('Sync failed for draft', draft.id, '— will retry next time:', e);
          // leave pending_sync alone, it'll retry next reconnect/load
        }
      }
    } finally {
      _syncInFlight = false;
    }

    if (pushed || conflicts) showSyncToast(pushed, conflicts);
    return { pushed, conflicts };
  }

  function showSyncToast(pushed, conflicts) {
    injectBannerStyles();
    const t = document.createElement('div');
    t.className = 'cc-sync-toast';
    const parts = [];
    if (pushed) parts.push(`\u2713 Synced ${pushed} offline change${pushed === 1 ? '' : 's'}`);
    if (conflicts) parts.push(`\u26a0 ${conflicts} skipped \u2014 newer version found online`);
    t.textContent = parts.join(' \u2014 ');
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('cc-show'));
    setTimeout(() => { t.classList.remove('cc-show'); setTimeout(() => t.remove(), 300); }, 4000);
  }

  // offline banner, self-contained since not every page loads theme.css
  function injectBannerStyles() {
    if (document.getElementById('cc-offline-style')) return;
    const style = document.createElement('style');
    style.id = 'cc-offline-style';
    style.textContent = `
      #cc-offline-banner {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 99999;
        background: #3a2a0f;
        color: #ffb45c;
        border-bottom: 1px solid rgba(255,122,0,0.35);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        padding: 8px 38px 8px 12px;
        transform: translateY(-100%);
        transition: transform 0.25s ease;
      }
      #cc-offline-banner.cc-show { transform: translateY(0); }
      #cc-offline-banner .cc-dot {
        display: inline-block;
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #ffb45c;
        margin-right: 7px;
        vertical-align: middle;
      }
      #cc-offline-banner .cc-close {
        position: absolute;
        right: 10px; top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: #ffb45c;
        opacity: 0.7;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 6px;
      }
      #cc-offline-banner .cc-close:hover { opacity: 1; }
      .cc-sync-toast {
        position: fixed;
        bottom: 24px; left: 50%;
        transform: translate(-50%, 12px);
        opacity: 0;
        z-index: 99999;
        background: #1a3a1a;
        color: #32d74b;
        border: 1px solid #2a5a2a;
        border-radius: 20px;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 700;
        padding: 9px 18px;
        white-space: nowrap;
        max-width: 90vw;
        text-overflow: ellipsis;
        overflow: hidden;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .cc-sync-toast.cc-show { opacity: 1; transform: translate(-50%, 0); }
    `;
    document.head.appendChild(style);
  }

  function ensureBanner() {
    let el = document.getElementById('cc-offline-banner');
    if (!el) {
      injectBannerStyles();
      el = document.createElement('div');
      el.id = 'cc-offline-banner';
      el.innerHTML =
        '<span class="cc-dot"></span>You\u2019re offline \u2014 showing cached comics. Changes will save once you\u2019re back online.' +
        '<button class="cc-close" aria-label="Dismiss">\u00d7</button>';
      el.querySelector('.cc-close').addEventListener('click', () => {
        bannerDismissed = true;
        el.classList.remove('cc-show');
      });
      document.body.appendChild(el);
    }
    return el;
  }

  let bannerDismissed = false;

  function updateBanner() {
    const online = navigator.onLine;
    const el = ensureBanner();
    if (online) {
      el.classList.remove('cc-show');
      bannerDismissed = false; // reset so it shows fresh next time you go offline
    } else if (!bannerDismissed) {
      el.classList.add('cc-show');
    }
  }

  function handleOnline() {
    updateBanner();
    syncPendingDrafts();
  }

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', updateBanner);

  if (document.body) {
    updateBanner();
  } else {
    document.addEventListener('DOMContentLoaded', updateBanner);
  }

  // also try once on load — covers pending edits from a previous session
  // where we're already online and no 'online' event ever fires
  if (navigator.onLine) {
    setTimeout(syncPendingDrafts, 1500); // let the page finish booting first
  }
})();
