const _sb = supabase.createClient(
  'https://mmycqeejhguzhtzkyjaj.supabase.co',
  'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE',
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' } }
);
const myProfile = JSON.parse(localStorage.getItem('user_profile') || '{"handle":"guest"}');

// bump on deploy to bust cache
const CACHE_VERSION = 'v5';
const CC_COMICS  = `cc-comics-cache-${CACHE_VERSION}`;
const CC_RATINGS = `cc-ratings-cache-${CACHE_VERSION}`;
const CC_FEEDS_TS = `cc-feeds-ts-${CACHE_VERSION}`;
const CC_STORIES  = `cc-stories-cache-${CACHE_VERSION}`;
const CC_STORIES_TS = `cc-stories-ts-${CACHE_VERSION}`;

// wait for auth before fetching, avoids race on load
let _resolveAuthReady;
const _authReady = new Promise(resolve => { _resolveAuthReady = resolve; });
_sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION') _resolveAuthReady(session);
});

// accent color
function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '');
  const r = parseInt(clean.slice(0,2), 16);
  const g = parseInt(clean.slice(2,4), 16);
  const b = parseInt(clean.slice(4,6), 16);
  return `${r},${g},${b}`;
}
// rotate gif hue to match accent
const LOADING_GIF_BASE_HUE = 29;
function hexToHue(hex) {
  const clean = (hex || '').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }
  return h < 0 ? h + 360 : h;
}
function applyAccentColor(hex) {
  const color = hex || '#ff7a00';
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(color));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = color;

  // recolor gif
  const loaderImg = document.getElementById('loading-gif');
  if (loaderImg) {
    const shift = hexToHue(color) - LOADING_GIF_BASE_HUE;
    loaderImg.style.filter = `hue-rotate(${shift}deg)`;
  }
}
applyAccentColor(myProfile.settings?.accent_color);

const isAdmin   = myProfile.handle === 'jeffyplays';
const isMod     = myProfile.settings?.role === 'mod';
// mods same as admin basically
const isModOrAdmin = isAdmin || isMod;

// age ratings
// locked after admin touches it
const AGE_RATINGS = [
  { code: 'G',     label: 'G',     desc: 'General audiences',          color: '#32d74b' },
  { code: 'PG',    label: 'PG',    desc: 'Parental guidance',          color: '#64d2ff' },
  { code: 'PG-13', label: 'PG-13', desc: 'Parents strongly cautioned', color: '#ffd60a' },
  { code: 'R',     label: 'R',     desc: 'Restricted',                 color: '#ff9f0a' },
  { code: 'TV-MA', label: 'TV-MA', desc: 'Mature audiences only',      color: '#ff453a' },
];
function ratingMeta(code) { return AGE_RATINGS.find(r => r.code === code) || null; }
function canEditRating(c) {
  const isMine = c.owner_handle === myProfile.handle;
  return isModOrAdmin || (isMine && !c.age_rating_locked);
}
// rating pill on tile
function ratingBadgeHtml(c) {
  const canEdit = canEditRating(c);
  if (!c.age_rating && !canEdit) return '';
  const meta  = ratingMeta(c.age_rating);
  const color = meta ? meta.color : '#888';
  const label = meta ? meta.label : 'Rate';
  const check = c.age_rating_locked ? ' ✓' : '';
  const click = canEdit ? ` onclick="event.stopPropagation(); openRatingPicker('${esc(c.id)}')"` : '';
  return `<div class="tile-age-rating${canEdit ? ' editable' : ''}" style="--rating-color:${color}"${click}>${esc(label)}${check}</div>`;
}

let allComics       = [];
let collabMap       = {};  // comicId -> accepted invitee handles
let activeComicId   = null;
let globalStars     = [];
let globalRatings   = [];
let activePopupComic   = null;
let activePopupStarred = false;
let currentSort     = 'recent';
let currentPage     = 0;
const ITEMS_PER_PAGE = 12;
let storiesLoaded   = false;
let shareComicId    = null;
let shareComicTitle = null;
let shareComicOwner = null;
let shareUrl        = '';
let toastTimer      = null;

// frame count cache
const frameCountCache = {};

// sync version, checks memory cache then localStorage (reader.html writes it)
function getCachedFrameCount(comicId) {
  if (frameCountCache[comicId] !== undefined) return frameCountCache[comicId];
  const stored = localStorage.getItem('cc-frame-count-' + comicId);
  if (stored !== null) {
    const n = parseInt(stored);
    if (!isNaN(n) && n > 0) { frameCountCache[comicId] = n; return n; }
  }
  return 0;
}

// async version, falls back to a supabase fetch
async function fetchAndCacheFrameCount(comicId) {
  const cached = getCachedFrameCount(comicId);
  if (cached > 0) return cached;
  try {
    const { data } = await _sb.from('comics').select('data').eq('id', comicId).maybeSingle();
    const count = (data?.data || []).length;
    frameCountCache[comicId] = count;
    if (count > 0) localStorage.setItem('cc-frame-count-' + comicId, count);
    return count;
  } catch(e) { return 0; }
}

// profile cache
const profileCache = {};
async function getCachedProfile(handle) {
  if (profileCache[handle]) return profileCache[handle];
  const { data } = await _sb.from('profiles').select('pic, name').eq('handle', handle).maybeSingle();
  profileCache[handle] = data || { pic: '', name: handle };
  return profileCache[handle];
}

const DEFAULT_AVATAR = 'https://via.placeholder.com/150';
function getPublicAvatarUrl(pic) {
  if (!pic) return '';
  const raw = String(pic).trim();
  if (raw.startsWith('http')) return raw;
  const path = raw.startsWith('avatars/') ? raw.slice(8) : raw;
  if (!path) return '';
  const { data } = _sb.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl || '';
}

// follow system
const followCache = {};  // handle -> bool

async function isFollowing(targetHandle) {
  if (!myProfile.handle || myProfile.handle === 'guest') return false;
  if (targetHandle === myProfile.handle) return false;
  if (followCache[targetHandle] !== undefined) return followCache[targetHandle];
  const { data } = await _sb.from('follows')
    .select('id').eq('follower', myProfile.handle).eq('following', targetHandle).maybeSingle();
  followCache[targetHandle] = !!data;
  return !!data;
}

async function tileFollow(btn, handle) {
  if (!myProfile.handle || myProfile.handle === 'guest') { showToast('Log in to follow!'); return; }
  btn.classList.add('loading');
  const already = await isFollowing(handle);
  if (already) {
    // unfollow
    await _sb.from('follows').delete().eq('follower', myProfile.handle).eq('following', handle);
    followCache[handle] = false;
    btn.textContent = 'Follow';
    btn.classList.remove('following');
    showToast(`Unfollowed @${handle}`);
  } else {
    // follow
    const { error } = await _sb.from('follows').insert([{ follower: myProfile.handle, following: handle }]);
    if (error) { showToast('Error — try again'); btn.classList.remove('loading'); return; }
    followCache[handle] = true;
    btn.textContent = '✓';
    btn.classList.add('following');
    showToast(`✅ Now following @${handle}`);
  }
  btn.classList.remove('loading');
  // refresh leaderboard
  loadTopCreators(currentRankTab);
}

// connection cache, keeping for share sheet
const connectionCache = {};
async function getConnectionStatus(targetHandle) {
  if (!myProfile.handle || myProfile.handle === 'guest') return 'guest';
  if (targetHandle === myProfile.handle) return 'self';
  const key = targetHandle;
  if (connectionCache[key] !== undefined) return connectionCache[key];
  const { data } = await _sb.from('connections')
    .select('status')
    .or(`and(sender_handle.eq.${myProfile.handle},receiver_handle.eq.${targetHandle}),and(sender_handle.eq.${targetHandle},receiver_handle.eq.${myProfile.handle})`)
    .maybeSingle();
  const status = data?.status || 'none';
  connectionCache[key] = status;
  return status;
}

// helpers
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function timeAgo(d) {
  if (!d) return '';
  const sec = Math.floor((Date.now() - new Date(d)) / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec/60); if (min < 60) return min+'m ago';
  const hr  = Math.floor(min/60); if (hr  < 24) return hr +'h ago';
  const day = Math.floor(hr /24); if (day <  7) return day+'d ago';
  const wk  = Math.floor(day/7);  if (wk  <  4) return wk +'w ago';
  const mo  = Math.floor(day/30); if (mo  < 12) return mo +'mo ago';
  return Math.floor(day/365)+'y ago';
}

function exactDate(d) {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleString('en-US',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}

function isNewComic(c) {
  if (!c || !c.created_at) return false;
  if (localStorage.getItem('cc-seen-' + c.id)) return false;  // already opened by this viewer
  return (Date.now() - new Date(c.created_at)) < 1000 * 60 * 60 * 48;
}

// mark comic as seen so the new badge clears and stays cleared
function markComicSeen(comicId) {
  try { localStorage.setItem('cc-seen-' + comicId, '1'); } catch (e) {}
}

function getProgress(comicId, totalFrames) {
  try {
    const s = localStorage.getItem('cc-progress-' + comicId);
    if (s === null || s === '__done__' || !totalFrames) return null;
    const f = parseInt(s);
    if (isNaN(f) || f <= 0 || f >= totalFrames - 1) return null;
    return { frame: f + 1, total: totalFrames, pct: Math.round(((f + 1) / totalFrames) * 100) };
  } catch(e) { return null; }
}

// arrow buttons

// weighted shuffle, favors popular but keeps some variety
function smartRandomSort(comics, stars) {
  const starMap = {};
  stars.forEach(s => { starMap[s.receiver_hand] = (starMap[s.receiver_hand] || 0) + 1; });
  // score = stars + noise
  const maxStars = Math.max(1, ...comics.map(c => starMap[c.id] || 0));
  return [...comics].sort((a, b) => {
    const scoreA = ((starMap[a.id] || 0) / maxStars) * 0.6 + Math.random() * 0.4;
    const scoreB = ((starMap[b.id] || 0) / maxStars) * 0.6 + Math.random() * 0.4;
    return scoreB - scoreA;
  });
}


// shared weighted-rating helper, used by top comics sort and top creators leaderboard so they agree.
// discounts low-sample scores toward zero instead of the mean, so a lucky 2-rater 5star doesn't win
function getRatingStats(stars) {
  const byComic = {};  // comic id -> { sum, count }
  stars.forEach(s => {
    const val = parseInt(s.content) || 0;
    if (!byComic[s.receiver_hand]) byComic[s.receiver_hand] = { sum: 0, count: 0 };
    byComic[s.receiver_hand].sum   += val;
    byComic[s.receiver_hand].count += 1;
  });

  const rated = Object.values(byComic).filter(r => r.count > 0);
  const globalAvgRaters = rated.length
    ? rated.reduce((a, r) => a + r.count, 0) / rated.length
    : 1;

  // confidence divisor, floor of 4 so small samples don't overrank, scales with dataset size
  const K = Math.max(4, globalAvgRaters);

  // ratings/views ratio as a second confidence signal, clamped to 1, only adds
  const weightedScore = (avg, count, views) => {
    if (!count) return 0;
    const responseRatio = views > 0 ? Math.min(1, count / views) : 0;
    const effectiveCount = count * (1 + responseRatio);
    return avg * (effectiveCount / (effectiveCount + K));
  };

  return { byComic, globalAvgRaters, K, weightedScore };
}

// sort
function setSort(s) {
  currentSort = s;
  currentPage = 0;
  ['recent','popular','oldest'].forEach(k => {
    const el = document.getElementById('chip-'+k);
    if (el) el.classList.toggle('on', k === s);
  });
  const labels = { recent:'Latest', popular:'Top Comics', oldest:'Oldest First' };
  document.getElementById('comics-label').innerText = labels[s] || 'Latest';
  renderComics(allComics, globalStars);
}

function sortedComics(comics, stars) {
  const c = [...comics];
  if (currentSort === 'popular') {
    const { byComic, weightedScore } = getRatingStats(stars);
    return c.sort((a, b) => {
      const ra = byComic[a.id] || { sum: 0, count: 0 };
      const rb = byComic[b.id] || { sum: 0, count: 0 };
      const scoreA = weightedScore(ra.count ? ra.sum / ra.count : 0, ra.count, a.views);
      const scoreB = weightedScore(rb.count ? rb.sum / rb.count : 0, rb.count, b.views);
      return scoreB - scoreA || rb.count - ra.count;
    });
  }
  if (currentSort === 'oldest') return c.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  if (currentSort === 'smart_random') return smartRandomSort(c, stars);
  return c.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
}

// top creators
let currentRankTab = 'stars';
let topCreatorsData = { stars: [], follows: [] };

function switchRankTab(tab, el) {
  currentRankTab = tab;
  document.querySelectorAll('.creator-rank-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  topCreatorsData[tab] = [];  // clear cache, forces refetch
  loadTopCreators(tab);
}

async function loadTopCreators(tab) {
  const list = document.getElementById('top-creators-list');
  if (!list) return;

  // cache check
  if (topCreatorsData[tab]?.length) {
    renderTopCreators(topCreatorsData[tab], tab);
    return;
  }

  list.innerHTML = '<div style="color:#333;font-size:12px;font-weight:700;padding:20px;">Loading…</div>';

  try {
    if (tab === 'stars') {
      // rank by best comic's weighted score, matches top comics sort
      const { byComic: ratingsByComic, weightedScore } = getRatingStats(globalStars);

      // best comic per owner, ranked by weighted score not raw average
      const bestByOwner = {};  // handle -> { avgRating, raterCount, weighted, title }
      allComics.forEach(c => {
        if (!c.owner_handle) return;
        const r = ratingsByComic[c.id];
        if (!r || r.count === 0) return;
        const avg = r.sum / r.count;
        const weighted = weightedScore(avg, r.count, c.views);
        if (!bestByOwner[c.owner_handle] || weighted > bestByOwner[c.owner_handle].weighted) {
          bestByOwner[c.owner_handle] = { avgRating: avg, raterCount: r.count, weighted, title: c.title || 'Untitled' };
        }
      });

      // fallback: comic count
      const comicsByOwner = {};
      allComics.forEach(c => { if (c.owner_handle) comicsByOwner[c.owner_handle] = (comicsByOwner[c.owner_handle] || 0) + 1; });

      // merge and rank by weighted score, raw rating/count only break ties
      const allOwners = [...new Set([...Object.keys(bestByOwner), ...Object.keys(comicsByOwner)])];
      const ranked = allOwners
        .map(h => ({
          handle: h,
          bestRating: bestByOwner[h]?.avgRating  || 0,
          raterCount: bestByOwner[h]?.raterCount || 0,
          weighted:   bestByOwner[h]?.weighted   || 0,
          bestTitle:  bestByOwner[h]?.title      || '',
          count: comicsByOwner[h] || 0  // kept for reference, not displayed
        }))
        .filter(h => h.bestRating > 0)  // only creators with at least one rated comic
        .sort((a, b) => b.weighted - a.weighted || b.raterCount - a.raterCount)
        .slice(0, 10);

      if (!ranked.length) { list.innerHTML = '<div style="color:#333;font-size:12px;font-weight:700;padding:20px;">No data yet</div>'; return; }

      const handles = ranked.map(r => r.handle);
      const { data: profiles } = await _sb.from('profiles').select('handle,name,pic').in('handle', handles);
      const profMap = Object.fromEntries((profiles||[]).map(p => [p.handle, p]));
      profiles?.forEach(p => { profileCache[p.handle] = p; });
      topCreatorsData.stars = ranked.map(r => ({ ...r, ...(profMap[r.handle]||{}) }));

    } else if (tab === 'follows') {
      const { data: followCounts } = await _sb.from('follows').select('following').limit(2000);
      const countMap = {};
      (followCounts || []).forEach(r => { countMap[r.following] = (countMap[r.following] || 0) + 1; });

      // fallback if no follows yet
      if (!Object.keys(countMap).length) {
        allComics.forEach(c => { if (c.owner_handle) countMap[c.owner_handle] = (countMap[c.owner_handle] || 0) + 1; });
      }

      const sorted = Object.entries(countMap).sort((a,b) => b[1]-a[1]).slice(0,10);
      if (!sorted.length) { list.innerHTML = '<div style="color:#333;font-size:12px;font-weight:700;padding:20px;">No data yet</div>'; return; }

      const handles = sorted.map(([h]) => h);
      const { data: profiles } = await _sb.from('profiles').select('handle,name,pic').in('handle', handles);
      const profMap = Object.fromEntries((profiles||[]).map(p => [p.handle, p]));
      profiles?.forEach(p => { profileCache[p.handle] = p; });
      topCreatorsData.follows = sorted.map(([handle, count]) => ({ handle, count, ...(profMap[handle]||{}) }));
    }

    renderTopCreators(topCreatorsData[tab], tab);
  } catch(e) {
    console.error('loadTopCreators error:', e);
    list.innerHTML = '<div style="color:#333;font-size:12px;font-weight:700;padding:20px;">Could not load creators</div>';
  }
}

const RANK_MEDALS = ['🥇','🥈','🥉','4','5','6','7','8','9','10'];
const RANK_CLASSES = ['gold','silver','bronze','','','','','','',''];

function renderTopCreators(creators, tab) {
  const list = document.getElementById('top-creators-list');
  if (!list) return;
  if (!creators.length) {
    list.innerHTML = '<div style="color:#333;font-size:12px;font-weight:700;padding:20px;">No data yet</div>';
    return;
  }
  list.innerHTML = creators.map((c, i) => {
    const medal = RANK_MEDALS[i] || (i+1);
    const rankClass = RANK_CLASSES[i] || '';
    const isMedal = i < 3;
    const avatarUrl = getPublicAvatarUrl(c.pic);
    const avatarHtml = avatarUrl
      ? `<img class="creator-rank-avatar" data-handle="${esc(c.handle)}" src="${esc(avatarUrl)}" onerror="this.onerror=null;this.src='';this.style.display='none';this.nextElementSibling.style.display='flex';" alt="${esc(c.handle)}"><div class="creator-rank-avatar" style="display:none;align-items:center;justify-content:center;font-size:22px;background:#222;border:2px solid #333;">👤</div>`
      : `<div class="creator-rank-avatar" style="display:flex;align-items:center;justify-content:center;font-size:22px;background:#222;border:2px solid #333;">👤</div>`;

    // stat display
    let statHtml;
    if (tab === 'stars') {
      const raterCount = c.raterCount || 0;
      statHtml = `<div class="creator-rank-stat" style="display:flex;align-items:center;gap:4px;">
        ${starNumIcon(c.bestRating, 'md')}
        ${raterCount > 0 ? `<span style="font-size:10px;color:#888;font-weight:700;">(${raterCount})</span>` : ''}
      </div>`;
    } else {
      statHtml = `<div class="creator-rank-stat">👥 ${c.count}</div>`;
    }

    return `
      <a class="creator-rank-card ${rankClass}" href="profile.html?u=${esc(c.handle)}">
        ${isMedal ? `<div class="rank-badge">${medal}</div>` : `<div style="position:absolute;top:6px;left:8px;font-size:9px;color:#444;font-weight:900;">#${i+1}</div>`}
        ${avatarHtml}
        <div class="creator-rank-name">${esc(c.name||c.handle)}</div>
        <div class="creator-rank-handle">@${esc(c.handle)}</div>
        ${statHtml}
      </a>`;
  }).join('');

  // hydrate missing avatars
  list.querySelectorAll('img.creator-rank-avatar[src=""]').forEach(async img => {
    const handle = img.dataset.handle;
    if (!handle) return;
    const p = await getCachedProfile(handle);
    const nextSrc = getPublicAvatarUrl(p?.pic);
    if (nextSrc) { img.src = nextSrc; img.style.display = ''; }
  });
}

// load
function init() {
  // nuke bad cache
  try {
    const cached = localStorage.getItem(CC_COMICS);
    if (cached) {
      const arr = JSON.parse(cached);
      // old base64 covers, ditch em
      if (arr?.[0]?.cover?.startsWith('data:')) {
        localStorage.removeItem(CC_COMICS);
        localStorage.removeItem(CC_RATINGS);
        localStorage.removeItem(CC_FEEDS_TS);
      }
    }
  } catch(e) {
    localStorage.removeItem(CC_COMICS);
    localStorage.removeItem(CC_FEEDS_TS);
  }

  loadFeeds().then(() => {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.add('hidden');
  });
  setTimeout(() => {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.add('hidden');
  }, 1800);
  setupRealtime();
}

function setupRealtime() {
  _sb.channel('discover_realtime')
    .on('postgres_changes', { event:'*', schema:'public', table:'messages' }, () => {
      // comments only if popup open
      if (activeComicId) fetchComments();
    })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'comics' }, ({ new: updated }) => {
      // live patch views
      const c = allComics.find(x => x.id === updated.id);
      if (!c || c.views === updated.views) return;
      c.views = updated.views;

      const tile = document.querySelector(`.comic-card[data-id="${updated.id}"] .tile-views`);
      if (tile) {
        tile.textContent = `${updated.views} View${updated.views === 1 ? '' : 's'}`;
        tile.style.display = 'block';
      }

      if (activePopupComic?.id === updated.id) {
        const chip = document.getElementById('popup-views-chip');
        if (chip) chip.innerText = `${updated.views} View${updated.views === 1 ? '' : 's'}`;
      }
    })
    .subscribe();
}

async function loadFeeds() {
  // 1. cache paint
  const CACHE_TTL = 120000;  // 2 min
  const cachedComics  = localStorage.getItem(CC_COMICS);
  const cachedStars   = localStorage.getItem(CC_RATINGS);
  const cachedTs      = parseInt(localStorage.getItem(CC_FEEDS_TS) || '0');
  const cacheIsValid  = Date.now() - cachedTs < CACHE_TTL;

  if (cachedComics && cachedStars && cacheIsValid) {
    allComics     = JSON.parse(cachedComics);
    globalRatings = JSON.parse(cachedStars);
    globalStars   = globalRatings;
    renderComics(allComics, globalRatings);
    loadTopCreators(currentRankTab);
    return;
  }

  // 2. stale cache, paint then refresh
  if (cachedComics && cachedStars) {
    allComics     = JSON.parse(cachedComics);
    globalRatings = JSON.parse(cachedStars);
    globalStars   = globalRatings;
    renderComics(allComics, globalRatings);
    loadTopCreators(currentRankTab);
  } else {
    // no cache yet, skeletons
    showComicSkeletons();
  }

  // 3. fetch, dont nuke screen on error
  await _authReady;
  let comics, ratings;
  try {
    const [comicsRes, ratingsRes] = await Promise.all([
      _sb.from('comics')
        .select('id,title,cover,owner_handle,owner_name,created_at,tags,swipe_dir,toonscroll_status,canvas_ratio,age_rating,age_rating_locked,views')
        .order('created_at', { ascending: false })
        .limit(80),
      _sb.from('messages').select('receiver_hand,content').eq('reaction','rating').limit(2000),
    ]);
    if (comicsRes.error || ratingsRes.error) throw (comicsRes.error || ratingsRes.error);
    comics  = comicsRes.data;
    ratings = ratingsRes.data;
  } catch (e) {
    console.error('Failed to load feed:', e);
    if (!allComics.length) showComicSkeletons();
    return Promise.resolve();
  }

  allComics     = (comics || []).filter(c => c.title && c.owner_handle);
  globalRatings = ratings || [];
  globalStars   = globalRatings;  // keep in sync for legacy refs

  // fetch collabs
  collabMap = {};
  try {
    const comicIds = allComics.map(c => c.id);
    if (comicIds.length) {
      const { data: collabs } = await _sb
        .from('comic_collaborators')
        .select('comic_id, invitee_handle')
        .in('comic_id', comicIds)
        .eq('status', 'accepted');
      (collabs || []).forEach(r => {
        if (!collabMap[r.comic_id]) collabMap[r.comic_id] = [];
        collabMap[r.comic_id].push(r.invitee_handle);
      });
    }
  } catch(e) { /* no collab table yet */ }

  // reset leaderboard cache
  topCreatorsData = { stars: [], follows: [] };

  // save to cache
  try {
    localStorage.setItem(CC_COMICS,   JSON.stringify(allComics));
    localStorage.setItem(CC_RATINGS,  JSON.stringify(globalRatings));
    localStorage.setItem(CC_FEEDS_TS, String(Date.now()));
  } catch(e) {
    localStorage.removeItem(CC_COMICS);
    localStorage.removeItem(CC_RATINGS);
    localStorage.removeItem(CC_STORIES);
  }

  renderComics(allComics, globalRatings);
  loadTopCreators(currentRankTab);
  return Promise.resolve();
}

// skeletons
function showComicSkeletons(count = 12) {
  const container = document.getElementById('recentFeed');
  if (!container) return;
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="comic-card comic-card-skel">
      <div class="cover-skel"></div>
      <div class="info-skel">
        <div class="line-skel" style="width:75%"></div>
        <div class="line-skel" style="width:45%;height:9px;margin-top:2px;"></div>
      </div>
    </div>`).join('');
}

// render grid
function renderComics(comics, stars) {
  const sorted    = sortedComics(comics, stars);
  const container = document.getElementById('recentFeed');
  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
  if (currentPage >= totalPages) currentPage = 0;

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-feed" style="padding:40px 20px;grid-column:1/-1;">No comics yet.<br>Be the first to publish!</div>';
    renderPagination(0);
    return;
  }

  const slice = sorted.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

  container.innerHTML = slice.map(c => {
    const starCount  = globalRatings.filter(r => r.receiver_hand === c.id).length;
    const avgRating = starCount > 0 ?
      globalRatings.filter(r => r.receiver_hand === c.id)
        .reduce((sum, r) => sum + (parseInt(r.content) || 0), 0) / starCount : 0;
    const isMine     = c.owner_handle === myProfile.handle;
    const isNew      = isNewComic(c) && !isMine;
    const prog       = getProgress(c.id, getCachedFrameCount(c.id));
    const coverHtml  = c.cover
      ? `<img src="${esc(c.cover)}" loading="lazy" decoding="async" class="cover-loading" onload="this.classList.remove('cover-loading')" onerror="this.parentNode.innerHTML='<div class=no-cover>📖</div>'">`
      : `<div class="no-cover">📖</div>`;
    const progressHtml = prog
      ? `<div class="tile-progress"><div class="tile-progress-fill" style="width:${prog.pct}%"></div></div>` : '';
    const badgeHtml  = isMine ? `<div class="tile-mine">MINE</div>`
      : (isNew ? `<div class="tile-new">NEW</div>` : '');
    const starsHtml  = avgRating > 0 ? `<div class="tile-stars" onclick="event.stopPropagation(); toggleStarExpand(this, ${starCount}, ${avgRating.toFixed(1)})">${starNumIcon(avgRating)}<span>(${starCount})</span></div>` : '';
    const viewsHtml  = `<div class="tile-views"${c.views > 0 ? '' : ' style="display:none"'}>${c.views} View${c.views === 1 ? '' : 's'}</div>`;
    const ownerHandle = esc(c.owner_handle || 'unknown');
    const coAuthors   = collabMap[c.id] || [];
    const allAuthors  = [c.owner_handle, ...coAuthors].filter(Boolean);
    const authorLine  = allAuthors.map(h =>
      `<span class="comic-card-handle" onclick="event.stopPropagation(); location.href='profile.html?u=${esc(h)}'">@${esc(h)}</span>`
    ).join('<span style="color:#333;margin:0 1px;">·</span>');
    const followBtn = (!isMine && myProfile.handle !== 'guest')
      ? `<button class="comic-card-follow" data-follow-handle="${ownerHandle}" onclick="event.stopPropagation(); tileFollow(this, '${ownerHandle}')">Follow</button>` : '';

    return `<div class="comic-card" data-id="${esc(c.id)}">
      <div class="comic-card-cover">
        <div style="width:100%;height:100%;border-radius:14px;overflow:hidden;position:relative;">
          ${coverHtml}${badgeHtml}${starsHtml}${viewsHtml}${progressHtml}
        </div>
      </div>
      <div class="comic-card-info">
        <div class="comic-card-title" title="${esc(c.title || 'Untitled')}">${esc(c.title || 'Untitled')}</div>
        <div class="comic-card-meta">
          <img class="comic-card-avatar comic-card-pfp" data-handle="${ownerHandle}" src="" alt=""
            onclick="event.stopPropagation(); location.href='profile.html?u=${ownerHandle}'"
            onerror="this.style.display='none'">
          <span style="min-width:0;overflow:hidden;display:flex;align-items:center;gap:1px;flex-wrap:wrap;">${authorLine}</span>
          ${followBtn}
        </div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.comic-card').forEach(card => {
    card.addEventListener('click', () => openPopup(card.dataset.id));
  });

  hydrateCardAvatars(container);
  hydrateFollowButtons(container);
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const prev = document.getElementById('home-prev-btn');
  const next = document.getElementById('home-next-btn');
  if (prev) prev.disabled = (currentPage === 0);
  if (next) next.disabled = (currentPage >= totalPages - 1);
}

function goToPage(n) {
  const sorted = sortedComics(allComics, globalStars);
  const totalPages = Math.ceil(sorted.length / ITEMS_PER_PAGE);
  currentPage = Math.max(0, Math.min(n, totalPages - 1));
  renderComics(allComics, globalStars);
  document.getElementById('section-recents')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openRandomComic() {
  if (!allComics.length) return;
  const r = allComics[Math.floor(Math.random() * allComics.length)];
  openPopup(r.id);
}

// sort dropdown
function toggleSortDropdown(e) {
  e?.stopPropagation();
  const menu = document.getElementById('sort-dropdown-menu');
  const btn  = document.getElementById('sort-dropdown-btn');
  const isOpen = menu.classList.contains('open');
  if (isOpen) { menu.classList.remove('open'); return; }
  // position menu
  const rect = btn.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  menu.classList.add('open');
}

function setSortFromDropdown(sort) {
  document.getElementById('sort-dropdown-menu').classList.remove('open');
  // highlight active
  ['recent','popular','oldest','favorites'].forEach(s => {
    document.getElementById('sort-opt-' + s)?.classList.toggle('sort-active', s === sort);
  });
  // update label
  const labels = { recent: 'Recent ▾', popular: 'Top ▾', oldest: 'Oldest ▾', favorites: '⭐ Favs ▾' };
  const btn = document.getElementById('sort-dropdown-btn');
  if (btn) btn.textContent = labels[sort] || 'All ▾';

  if (sort === 'favorites') {
    switchTab('favorites');
  } else {
    if (document.getElementById('section-favorites').style.display !== 'none') {
      switchTab('all');
    }
    setSort(sort);
  }
}

// close dropdown on outside click
document.addEventListener('click', (e) => {
  const menu = document.getElementById('sort-dropdown-menu');
  const btn  = document.getElementById('sort-dropdown-btn');
  if (menu && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.remove('open');
  }
});

function hydrateCardAvatars(container) {
  // hydrate avatars
  const avatars = container.querySelectorAll('[data-handle].comic-card-avatar, [data-handle].comic-card-pfp');
  const handles = [...new Set([...avatars].map(a => a.dataset.handle))];
  handles.forEach(async handle => {
    const p = await getCachedProfile(handle);
    const avatarUrl = getPublicAvatarUrl(p?.pic) || DEFAULT_AVATAR;
    container.querySelectorAll(`[data-handle="${handle}"].comic-card-avatar, [data-handle="${handle}"].comic-card-pfp`).forEach(img => {
      img.src = avatarUrl;
      img.classList.remove('hidden');
    });
  });
}



async function hydrateAvatars(container) {
  const avatars = container.querySelectorAll('.tile-creator-avatar[data-handle]');
  // batch handles
  const handles = [...new Set([...avatars].map(a => a.dataset.handle))];
  await Promise.all(handles.map(async handle => {
    const p = await getCachedProfile(handle);
    const avatarUrl = getPublicAvatarUrl(p?.pic) || DEFAULT_AVATAR;
    container.querySelectorAll(`.tile-creator-avatar[data-handle="${handle}"]`).forEach(img => {
      img.src = avatarUrl;
      img.style.display = '';
    });
  }));
}

async function hydrateFollowButtons(container) {
  if (!myProfile.handle || myProfile.handle === 'guest') return;
  const btns = container.querySelectorAll('[data-follow-handle]');
  const handles = [...new Set([...btns].map(b => b.dataset.followHandle))];
  await Promise.all(handles.map(async handle => {
    const following = await isFollowing(handle);
    container.querySelectorAll(`[data-follow-handle="${handle}"]`).forEach(btn => {
      if (following) { btn.textContent = '✓'; btn.classList.add('following'); }
      else { btn.textContent = 'Follow'; }
    });
  }));
}

// popup
async function openPopup(id) {
  const c = allComics.find(c => c.id === id);
  if (!c) return;
  activePopupComic = c;

  // clear new badge
  if (c.owner_handle !== myProfile.handle) {
    markComicSeen(c.id);
  }

  // cover
  const coverWrap = document.getElementById('popup-cover-wrap');
  coverWrap.innerHTML = c.cover
    ? `<img class="popup-cover" src="${esc(c.cover)}" onerror="this.parentNode.innerHTML='<div class=popup-cover-placeholder>📖</div>'">`
    : `<div class="popup-cover-placeholder">📖</div>`;

  // title + creator
  document.getElementById('popup-title').innerText   = c.title || 'Untitled';
  const ownerHandle = c.owner_handle || 'unknown';
  const popupCollabs = collabMap[c.id] || [];
  const popupAllAuthors = [ownerHandle, ...popupCollabs];
  const popupAuthorLinks = popupAllAuthors.map(h =>
    `<a href="profile.html?u=${esc(h)}" onclick="event.stopPropagation()">@${esc(h)}</a>`
  ).join(' <span style="color:#333;">·</span> ');
  document.getElementById('popup-creator').innerHTML =
    `by ${popupAuthorLinks} · ${timeAgo(c.created_at)}`;

  // meta
  let frameCount = getCachedFrameCount(c.id);
  const starCount  = globalRatings.filter(r => r.receiver_hand === c.id).length;
  const avgRating = starCount > 0 ?
    globalRatings.filter(r => r.receiver_hand === c.id)
      .reduce((sum, r) => sum + (parseInt(r.content) || 0), 0) / starCount : 0;
  document.getElementById('popup-meta').innerHTML = `
    <span class="popup-meta-chip" id="popup-frame-chip">${frameCount > 0 ? frameCount + ' frame' + (frameCount !== 1 ? 's' : '') : '…'}</span>
    ${c.toonscroll_status === 'enabled' ? '' : c.swipe_dir === 'vertical' ? '<span class="popup-meta-chip">↕</span>' : c.swipe_dir === 'horizontal' ? '<span class="popup-meta-chip">↔</span>' : ''}
    <span class="popup-meta-chip">${exactDate(c.created_at).split(',')[0]}</span>
    ${(() => {
      const canEdit = canEditRating(c);
      if (!c.age_rating && !canEdit) return '';
      const meta  = ratingMeta(c.age_rating);
      const cls   = 'popup-meta-chip' + (canEdit ? ' clickable' : '');
      const style = meta ? ` style="color:${meta.color};"` : '';
      const attrs = canEdit ? ` onclick="openRatingPicker('${esc(c.id)}')"` : '';
      const check = c.age_rating_locked ? ' <span title="Verified by admin" style="color:#32d74b;">✓</span>' : '';
      return `<span class="${cls}"${style}${attrs}>${esc(c.age_rating || 'Rate')}${check}</span>`;
    })()}`;

  // desc
  const descEl = document.getElementById('popup-desc');
  descEl.innerText = c.description || '';
  descEl.style.display = c.description ? 'block' : 'none';

  // tags
  const tags = c.tags || [];
  document.getElementById('popup-tags').innerHTML =
    tags.map(t => `<span class="popup-tag">#${esc(t)}</span>`).join('');

  // progress
  function applyProgressUI(total) {
    const prog = total > 0 ? getProgress(c.id, total) : null;
    const progWrap = document.getElementById('popup-progress-wrap');
    if (prog) {
      progWrap.style.display = 'block';
      document.getElementById('popup-progress-fill').style.width  = prog.pct + '%';
      document.getElementById('popup-progress-label').innerText   =
        `Reading progress: frame ${prog.frame} of ${prog.total} (${prog.pct}%)`;
    } else {
      progWrap.style.display = 'none';
    }
    return prog;
  }
  let prog = applyProgressUI(frameCount);

  // lazy fetch frame count
  if (!frameCount) {
    fetchAndCacheFrameCount(c.id).then(count => {
      if (!count || count === frameCount) return;  // no change
      frameCount = count;
      const chip = document.getElementById('popup-frame-chip');
      if (chip) chip.textContent = `${count} frame${count !== 1 ? 's' : ''}`;
      prog = applyProgressUI(count);
      // update continue btn
      const readBtn = document.getElementById('popup-read-btn');
      if (readBtn) readBtn.innerHTML = prog ? '▶ Continue' : '▶ Read Now';
    });
  }

  // fav + comment count
  const isMine = c.owner_handle === myProfile.handle;
  activePopupStarred = false;
  const hideCommentsInDiscover = myProfile.settings?.hide_discover_comments === true;
  const [starRes, commentCountRes] = await Promise.all([
    myProfile.handle !== 'guest'
      ? _sb.from('messages').select('id')
          .eq('sender_handle', myProfile.handle)
          .eq('receiver_hand', c.id)
          .eq('reaction', '⭐')
          .maybeSingle()
      : Promise.resolve({ data: null }),
    !hideCommentsInDiscover
      ? _sb.from('comments').select('id', { count: 'exact', head: true })
          .eq('comic_id', c.id).eq('deleted', false)
      : Promise.resolve({ count: 0 })
  ]);
  activePopupStarred = !!starRes.data;
  const commentCount = commentCountRes.count || 0;

  // build buttons
  const btnsRow1 = document.getElementById('popup-btns-row1');
  const btnsRow2 = document.getElementById('popup-btns-row2');
  btnsRow1.innerHTML = '';
  btnsRow2.innerHTML = '';

  const readBtn = document.createElement('button');
  readBtn.className = 'read-btn';
  readBtn.id        = 'popup-read-btn';
  readBtn.innerHTML = prog ? '▶ Continue' : '▶ Read Now';
  readBtn.onclick = () => {
    closePopup();
    const ratioParam = c.canvas_ratio?.w && c.canvas_ratio?.h
      ? `&ratio=${c.canvas_ratio.w}:${c.canvas_ratio.h}` : '';
    location.href = 'reader.html?id=' + encodeURIComponent(c.id) + ratioParam;
  };
  btnsRow1.appendChild(readBtn);

  if (!hideCommentsInDiscover) {
    const commentBtn = document.createElement('button');
    commentBtn.className = 'popup-icon-btn popup-comment-badge';
    commentBtn.innerHTML = `<i class="fi fi-rs-comment"></i><span class="popup-comment-count">${commentCount}</span>`;
    commentBtn.title     = 'Comments';
    commentBtn.onclick   = () => openCommentSheet(c.id);
    btnsRow1.appendChild(commentBtn);
  }

  // delete btn, mods can delete anything
  if (isMine || isModOrAdmin) {
    const asModerator = isModOrAdmin;
    const delBtn = document.createElement('button');
    delBtn.className = 'popup-delete-btn';
    delBtn.innerHTML = ICON_TRASH;
    delBtn.title     = asModerator ? 'Delete comic (moderator action)' : 'Delete comic';
    delBtn.onclick   = () => deleteComic(c.id, c.title, asModerator);
    btnsRow2.appendChild(delBtn);
  }

  const favBtn = document.createElement('button');
  favBtn.className = 'popup-icon-btn popup-fav-btn' + (activePopupStarred ? ' starred' : '');
  favBtn.id         = 'popup-star-btn';
  favBtn.innerHTML  = '<span class="popup-fav-label">FAV</span>';
  favBtn.title      = activePopupStarred ? 'Remove from Favorites' : 'Add to Favorites';
  favBtn.onclick    = () => popupToggleStar(c.id);
  btnsRow2.appendChild(favBtn);

  const shareBtn = document.createElement('button');
  shareBtn.className = 'popup-icon-btn';
  shareBtn.innerHTML = '↗';
  shareBtn.title     = 'Share';
  shareBtn.onclick   = () => openShareSheet(c.id, c.title, c.owner_handle);
  btnsRow2.appendChild(shareBtn);

  if (isMine) {
    const editBtn = document.createElement('button');
    editBtn.className = 'popup-edit-btn';
    editBtn.innerHTML = '<img src="https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/avatars/uibuttons/edit.webp" class="popup-edit-icon" alt="edit">Edit';
    editBtn.onclick   = () => {
      closePopup();
      localStorage.setItem('edit_comic_id', c.id);
      location.href = 'create.html';
    };
    btnsRow2.appendChild(editBtn);

    const episodeBtn = document.createElement('button');
    episodeBtn.className = 'popup-icon-btn';
    episodeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 26 26" style="display:block;"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="var(--accent)"/><text x="13" y="18" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="900" fill="#000">E</text></svg>';
    episodeBtn.title = 'Add Episode';
    episodeBtn.onclick = () => openAddEpisodeModal(c.id);
    btnsRow2.appendChild(episodeBtn);
  }

  document.getElementById('popup-overlay').classList.add('open');
}

function closePopup() {
  document.getElementById('popup-overlay').classList.remove('open');
  activePopupComic = null;
}

let _episodeParentId = null;
let _episodeSelected = [];

async function openAddEpisodeModal(parentId) {
  _episodeParentId = parentId;
  _episodeSelected = [];

  // load episodes
  const { data: parentComic } = await _sb.from('comics').select('episodes').eq('id', parentId).maybeSingle();
  _episodeSelected = parentComic?.episodes || [];

  // load my comics
  const { data: myComics } = await _sb.from('comics').select('id, title, cover').eq('owner_handle', myProfile.handle);

  const grid = document.getElementById('episode-comics-grid');
  const availableComics = (myComics || []).filter(c => c.id !== parentId);

  if (!availableComics.length) {
    grid.innerHTML = '<p style="color:#888;text-align:center;grid-column:span 3;padding:20px;">No other comics available to add as episodes</p>';
  } else {
    grid.innerHTML = availableComics.map(c => {
      const isSelected = _episodeSelected.includes(c.id);
      return `<div class="episode-comic-card ${isSelected ? 'selected' : ''}" onclick="toggleEpisodeComic('${c.id}', '${esc(c.title || 'Untitled')}', '${c.cover || ''}', this)">
        <div class="episode-comic-cover">
          ${c.cover ? `<img src="${c.cover}" loading="lazy">` : '<div style="width:100%;height:100%;background:#1a1a1e;display:flex;align-items:center;justify-content:center;font-size:24px;">📖</div>'}
        </div>
        <div class="episode-comic-title">${esc(c.title || 'Untitled')}</div>
      </div>`;
    }).join('');
  }

  renderEpisodeSelection();
  document.getElementById('episode-overlay').classList.add('open');
}

function toggleEpisodeComic(id, title, cover, el) {
  const idx = _episodeSelected.indexOf(id);
  if (idx > -1) {
    _episodeSelected.splice(idx, 1);
    el.classList.remove('selected');
  } else {
    _episodeSelected.push(id);
    el.classList.add('selected');
  }
  renderEpisodeSelection();
}

function renderEpisodeSelection() {
  const info = document.getElementById('episode-selected-info');
  const count = document.getElementById('episode-count');
  const list = document.getElementById('episode-selected-list');

  if (_episodeSelected.length === 0) {
    info.style.display = 'none';
    return;
  }

  info.style.display = '';
  count.innerText = _episodeSelected.length;
  list.innerHTML = _episodeSelected.map(id => {
    return `<div class="episode-chip" onclick="removeEpisodeComic('${id}')">${id.substring(0, 8)}... <span>✕</span></div>`;
  }).join('');
}

function removeEpisodeComic(id) {
  _episodeSelected = _episodeSelected.filter(e => e !== id);
  const cards = document.querySelectorAll('.episode-comic-card');
  cards.forEach(card => {
    if (card.querySelector('.episode-comic-title').innerText.includes(id.substring(0, 8))) {
      card.classList.remove('selected');
    }
  });
  renderEpisodeSelection();
}

function closeEpisodeModal() {
  document.getElementById('episode-overlay').classList.remove('open');
  _episodeParentId = null;
  _episodeSelected = [];
}

async function saveEpisodeSelection() {
  if (!_episodeParentId) return;

  closePopup();  // close the comic popup too

  const { error } = await _sb.from('comics').update({ episodes: _episodeSelected }).eq('id', _episodeParentId);

  if (error) {
    showToast('Error saving episodes: ' + error.message);
  } else {
    showToast('Episodes saved!');
  }

  closeEpisodeModal();
}

async function popupToggleStar(comicId) {
  if (myProfile.handle === 'guest') { showToast('Log in to favorite!'); return; }
  const btn = document.getElementById('popup-star-btn');
  if (activePopupStarred) {
    await _sb.from('messages').delete()
      .eq('sender_handle', myProfile.handle)
      .eq('receiver_hand', comicId)
      .eq('reaction','⭐');
    activePopupStarred = false;
    if (btn) { btn.classList.remove('starred'); btn.title = 'Add to Favorites'; }
    showToast('Removed from Favorites');
  } else {
    await _sb.from('messages').insert([{
      sender_handle: myProfile.handle,
      receiver_hand: comicId,
      content: '⭐', reaction: '⭐'
    }]);
    activePopupStarred = true;
    if (btn) { btn.classList.add('starred'); btn.title = 'Remove from Favorites'; }
    showToast('⭐ Added to Favorites!');
  }
  loadFeeds();
}

async function deleteComic(id, title, asModerator = false) {
  const msg = asModerator
    ? `Remove "${title}" as a moderator? This deletes it from Discover permanently for its creator.`
    : `Delete "${title}"? This removes it from Discover permanently.`;
  if (!confirm(msg)) return;
  closePopup();
  // rls doesnt error, check rows actually deleted
  const { data, error } = await _sb.from('comics').delete().eq('id', id).select('id');
  if (error) { showToast('Error deleting comic: ' + error.message); return; }
  if (!data || !data.length) {
    showToast("Couldn't delete — you may not have permission to remove this comic.");
    return;
  }
  allComics = allComics.filter(c => c.id !== id);
  renderComics(allComics, globalStars);
  showToast(asModerator ? 'Comic removed' : 'Comic deleted');
}

// comments
let pendingReactionImg = null;  // {name, src} to insert
let activeReplyTo   = null;  // {id, handle} being replied to, or null
let commentSortMode = 'top';  // 'top' | 'newest'
let commentsCache   = [];  // top-level comments for the open comic
let myReactionsMap  = {};  // { commentId: 'like'|'dislike' }
const openReplyThreads = new Set();  // commentIds currently expanded

const ICON_THUMB_UP   = '<svg viewBox="0 0 24 24"><path d="M7 10v11H3V10h4zm4.5-8L7 10v11h11.4c.9 0 1.6-.6 1.9-1.4l2.5-6.5c.4-1.2-.5-2.6-1.9-2.6H15l1-4.5C16.3 4.5 15 2 11.5 2z"/></svg>';
const ICON_THUMB_DOWN = '<svg viewBox="0 0 24 24"><path d="M17 14V3h4v11h-4zm-4.5 8L17 14V3H5.6c-.9 0-1.6.6-1.9 1.4L1.2 10.9c-.4 1.2.5 2.6 1.9 2.6H9l-1 4.5C7.7 19.5 9 22 12.5 22z"/></svg>';
const ICON_REPLY      = '<svg viewBox="0 0 24 24"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2"/></svg>';
const ICON_PIN        = '<svg viewBox="0 0 24 24"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>';
const ICON_HEART      = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.2C.5 8.6 2.3 5 6 5c2 0 3.5 1.1 4.5 2.5C11.5 6.1 13 5 15 5c3.7 0 5.5 3.6 4 6.8-2.5 4.6-10 9.2-10 9.2z"/></svg>';
const ICON_TRASH       = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14"/></svg>';

// returns viewed/total from reader's progress cache, or null
function getFramesViewedForComment(comicId) {
  const total = getCachedFrameCount(comicId);
  if (!total) return null;
  const raw = localStorage.getItem('cc-progress-' + comicId);
  if (raw === null) return null;
  if (raw === '__done__') return { viewed: total, total };
  const f = parseInt(raw);
  if (isNaN(f) || f < 0) return null;
  return { viewed: Math.min(total, f + 1), total };
}

// escape text, linkify @handle mentions
function linkifyComment(text) {
  return esc(text).replace(/@([a-zA-Z0-9_]{2,30})/g, (match, handle) =>
    '<span class="comment-mention" onclick="location.href=&quot;profile.html?u=' + esc(handle) + '&quot;">@' + esc(handle) + '</span>'
  );
}

function extractMentions(text) {
  const matches = text.match(/@([a-zA-Z0-9_]{2,30})/g) || [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

function openCommentSheet(id) {
  if (myProfile.settings?.hide_discover_comments) {
    showToast('Comments are hidden in settings.');
    return;
  }

  activeComicId = id;
  pendingReactionImg = null;
  cancelReply();
  document.getElementById('comment-overlay').classList.add('open');
  // close tray on open
  const tray = document.getElementById('reaction-tray');
  const toggleBtn = document.getElementById('reaction-toggle-btn');
  if (tray) tray.classList.remove('open');
  if (toggleBtn) toggleBtn.classList.remove('active');
  openReplyThreads.clear();
  fetchComments();
}

function closeCommentSheet() {
  document.getElementById('comment-overlay').classList.remove('open');
  activeComicId = null;
  pendingReactionImg = null;
  cancelReply();
}

// reaction picker
const BASE_URL = 'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/avatars/reactions/';

// reactions
const ALL_REACTIONS = [
  { name: 'nuke the whole generation', src: BASE_URL + 'IMG_1823.webp', tags: ['rage','angry'] },
  { name: 'who is this',               src: BASE_URL + 'IMG_1824.webp', tags: ['confused','who'] },
  { name: 'sipping lex luthor',        src: BASE_URL + 'IMG_1825.webp', tags: ['sipping','smug'] },
  { name: 'read',                      src: BASE_URL + 'IMG_1826.webp', tags: ['read','seen'] },
  { name: 'sobbing man',               src: BASE_URL + 'IMG_1827.webp', tags: ['sad','crying'] },
  { name: 'thinking',                  src: BASE_URL + 'IMG_1829.webp', tags: ['thinking','hmm'] },
  { name: 'gem found',                 src: BASE_URL + 'IMG_1831.webp', tags: ['gem','wow'] },
  { name: 'flight interested',         src: BASE_URL + 'IMG_1832.webp', tags: ['interested','nice'] },
  { name: 'spongebob phone',           src: BASE_URL + 'IMG_1833.webp', tags: ['phone','calling'] },
];

// categories
const CATEGORIES = ['All', 'Angry', 'Sad', 'Funny', 'Confused', 'Wow'];

let reactionLoaded = false;
let currentReactionFilter = 'all';

function toggleReactionPicker() {
  const picker = document.getElementById('reaction-picker');
  const btn = document.getElementById('reaction-toggle-btn');
  const isOpen = picker.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  if (isOpen && !reactionLoaded) {
    loadReactionGrid(ALL_REACTIONS);
    buildCategoryBtns();
    reactionLoaded = true;
  }
}

function buildCategoryBtns() {
  const wrap = document.getElementById('reaction-categories');
  wrap.innerHTML = CATEGORIES.map((c, i) =>
    `<button class="reaction-cat-btn ${i===0?'active':''}" onclick="filterReactions('${c.toLowerCase()}', this)">${c}</button>`
  ).join('');
}

function filterReactions(cat, btn) {
  currentReactionFilter = cat;
  document.querySelectorAll('.reaction-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = cat === 'all' ? ALL_REACTIONS
    : ALL_REACTIONS.filter(r => r.tags.some(t => t.includes(cat)) || r.name.toLowerCase().includes(cat));
  loadReactionGrid(filtered);
}

function loadReactionGrid(reactions) {
  const grid = document.getElementById('reaction-grid');
  if (!reactions.length) {
    grid.innerHTML = '<div class="reaction-tray-empty">No reactions found</div>';
    return;
  }
  grid.innerHTML = reactions.map(r => `
    <button class="reaction-img-btn" title="${esc(r.name)}" onclick="selectReaction('${esc(r.src)}', '${esc(r.name)}')" style="aspect-ratio:1;">
      <img src="${esc(r.src)}" alt="${esc(r.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">
    </button>
  `).join('');
}

function searchReactions(query) {
  const grid = document.getElementById('reaction-search-grid');
  if (!query.trim()) {
    grid.innerHTML = '<div class="reaction-tray-empty">Type to search reactions</div>';
    return;
  }
  const q = query.toLowerCase();
  const results = ALL_REACTIONS.filter(r =>
    r.name.toLowerCase().includes(q) || r.tags.some(t => t.includes(q))
  );
  if (!results.length) {
    grid.innerHTML = '<div class="reaction-tray-empty">No results for "' + esc(query) + '"</div>';
    return;
  }
  grid.innerHTML = results.map(r => `
    <button class="reaction-img-btn" title="${esc(r.name)}" onclick="selectReaction('${esc(r.src)}', '${esc(r.name)}')" style="aspect-ratio:1;">
      <img src="${esc(r.src)}" alt="${esc(r.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">
    </button>
  `).join('');
}

function switchReactionTab(tab) {
  document.getElementById('reaction-panel-images').style.display = tab === 'images' ? 'flex' : 'none';
  document.getElementById('reaction-panel-search').style.display = tab === 'search' ? 'flex' : 'none';
  document.getElementById('tab-images').classList.toggle('active', tab === 'images');
  document.getElementById('tab-search').classList.toggle('active', tab === 'search');
  if (tab === 'images') {
    document.getElementById('reaction-panel-images').style.flexDirection = 'column';
  }
  if (tab === 'search') setTimeout(() => document.getElementById('reaction-search-input').focus(), 50);
}

function selectReaction(src, name) {
  pendingReactionImg = { src, name };
  document.getElementById('commentInput').placeholder = '📎 "' + name + '" — add text or post!';
  document.getElementById('commentInput').value = '';
  document.getElementById('reaction-picker').classList.remove('open');
  document.getElementById('reaction-toggle-btn').classList.remove('active');
  showToast('🎭 "' + name + '" selected');
}

// legacy compat
function selectReactionImage(index) {
  const img = ALL_REACTIONS[index];
  if (!img) return;
  selectReaction(img.src, img.name);
}

function loadReactionTray() { /* legacy, no-op, replaced by picker */ }

let repliesCache = {};  // { parentCommentId: [reply, ...] }

function getActiveComicOwner() {
  const c = allComics.find(x => x.id === activeComicId);
  return c ? c.owner_handle : null;
}
function canPinOrDelete() {
  return isModOrAdmin || getActiveComicOwner() === myProfile.handle;
}
function canHeart() {
  return getActiveComicOwner() === myProfile.handle;
}
function findCommentById(id) {
  return commentsCache.find(c => c.id === id) ||
    Object.values(repliesCache).flat().find(c => c.id === id);
}

async function fetchComments() {
  const listEl = document.getElementById('commentList');
  listEl.innerHTML = '<div class="comment-empty">Loading…</div>';
  repliesCache = {};
  openReplyThreads.clear();

  const { data: comments, error } = await _sb
    .from('comments')
    .select('*')
    .eq('comic_id', activeComicId)
    .eq('deleted', false)
    .is('parent_id', null);

  if (error) {
    listEl.innerHTML = '<div class="comment-empty">Could not load comments.</div>';
    return;
  }

  commentsCache = comments || [];
  myReactionsMap = {};

  if (!commentsCache.length) {
    listEl.innerHTML = '<div class="comment-empty">No comments yet. Be first!</div>';
    return;
  }

  // batch fetch profiles
  const handles = [...new Set(commentsCache.map(m => m.author_handle).filter(Boolean))];
  const { data: profiles } = await _sb.from('profiles').select('handle,pic,name').in('handle', handles);
  (profiles || []).forEach(p => { profileCache[p.handle] = p; });

  // fetch my reactions
  if (myProfile.handle && myProfile.handle !== 'guest') {
    const { data: myReactions } = await _sb
      .from('comment_reactions')
      .select('comment_id,reaction_type')
      .eq('user_handle', myProfile.handle)
      .in('comment_id', commentsCache.map(c => c.id));
    (myReactions || []).forEach(r => { myReactionsMap[r.comment_id] = r.reaction_type; });
  }

  renderCommentList();
}

function formatCommentTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd';
  return new Date(iso).toLocaleDateString();
}

function buildCommentItemHtml(c, isReply) {
  const p = profileCache[c.author_handle] || { pic: '', name: c.author_handle };
  const profileUrl = 'profile.html?u=' + esc(c.author_handle);
  const avatarUrl = getPublicAvatarUrl(p?.pic) || DEFAULT_AVATAR;

  let bodyHtml = '';
  if (c.image_src) bodyHtml += '<img src="' + esc(c.image_src) + '" class="comment-reaction-img" loading="lazy">';
  if (c.content) bodyHtml += '<div class="comment-text-body">' + linkifyComment(c.content) + '</div>';

  let badges = '';
  if (c.is_pinned) badges += '<span class="comment-badge comment-badge-pinned">' + ICON_PIN + ' Pinned</span>';
  if (c.frames_viewed != null && c.frames_total) {
    const full = c.frames_viewed >= c.frames_total;
    badges += '<span class="comment-badge comment-badge-frames' + (full ? '' : ' partial') + '">' +
      (full ? 'Read all ' + c.frames_total + ' frames' : 'Read ' + c.frames_viewed + '/' + c.frames_total + ' frames') +
      '</span>';
  }

  const iLiked      = myReactionsMap[c.id] === 'like';
  const iDisliked   = myReactionsMap[c.id] === 'dislike';
  const isAuthorMe  = c.author_handle === myProfile.handle;
  const modCanAct   = canPinOrDelete();
  const heartCanAct = canHeart();

  let toolbar = '<div class="comment-toolbar">';
  toolbar += '<button class="c-action-btn' + (iLiked ? ' active-like' : '') + '" onclick="toggleReaction(&quot;' + c.id + '&quot;,&quot;like&quot;)">' + ICON_THUMB_UP + (c.like_count > 0 ? '<span>' + c.like_count + '</span>' : '') + '</button>';
  toolbar += '<button class="c-action-btn' + (iDisliked ? ' active-dislike' : '') + '" onclick="toggleReaction(&quot;' + c.id + '&quot;,&quot;dislike&quot;)">' + ICON_THUMB_DOWN + '</button>';
  if (!isReply) {
    toolbar += '<button class="c-action-btn" onclick="startReply(&quot;' + c.id + '&quot;,&quot;' + esc(c.author_handle) + '&quot;)">' + ICON_REPLY + '<span>Reply</span></button>';
  }
  if (heartCanAct && !isAuthorMe) {
    toolbar += '<button class="c-action-btn' + (c.is_hearted ? ' active-heart' : '') + '" onclick="toggleHeart(&quot;' + c.id + '&quot;)" title="Heart">' + ICON_HEART + '</button>';
  }
  if (modCanAct && !isReply) {
    toolbar += '<button class="c-action-btn is-mod-action' + (c.is_pinned ? ' active-pin' : '') + '" onclick="togglePin(&quot;' + c.id + '&quot;)" title="Pin">' + ICON_PIN + '</button>';
  }
  if (isAuthorMe || modCanAct) {
    const parentArg = c.parent_id ? ('&quot;' + c.parent_id + '&quot;') : 'null';
    toolbar += '<button class="c-action-btn' + (modCanAct && !isReply ? '' : ' is-mod-action') + '" onclick="deleteCommentRow(&quot;' + c.id + '&quot;,' + parentArg + ')" title="Delete">' + ICON_TRASH + '</button>';
  }
  toolbar += '</div>';

  return '<div class="comment-item' + (c.is_pinned ? ' is-pinned' : '') + (isReply ? ' is-reply' : '') + '" data-comment-id="' + c.id + '">' +
    '<img src="' + esc(avatarUrl) + '" class="comment-avatar" onclick="location.href=&quot;' + profileUrl + '&quot;" onerror="this.onerror=null;this.src=\'' + DEFAULT_AVATAR + '\';">' +
    '<div class="comment-content">' +
      '<div class="comment-user-row">' +
        '<span class="comment-user" onclick="location.href=&quot;' + profileUrl + '&quot;">@' + esc(c.author_handle) + '</span>' +
        '<span class="comment-time">' + formatCommentTime(c.created_at) + '</span>' +
        badges +
      '</div>' +
      bodyHtml + toolbar +
    '</div></div>';
}

function buildCommentBlockHtml(c) {
  let html = buildCommentItemHtml(c, false);
  const isOpen = openReplyThreads.has(c.id);
  if (c.reply_count > 0 || isOpen) {
    html += '<div style="margin-left:38px;"><button class="comment-replies-toggle" onclick="toggleReplies(&quot;' + c.id + '&quot;)">' +
      (isOpen ? 'Hide replies' : 'View ' + c.reply_count + (c.reply_count === 1 ? ' reply' : ' replies')) +
      '</button></div>';
  }
  if (isOpen) {
    const replies = repliesCache[c.id] || [];
    html += '<div class="comment-replies-wrap">' + replies.map(r => buildCommentItemHtml(r, true)).join('') + '</div>';
  }
  return html;
}

function renderCommentList() {
  const listEl = document.getElementById('commentList');
  if (!commentsCache.length) {
    listEl.innerHTML = '<div class="comment-empty">No comments yet. Be first!</div>';
    return;
  }
  const sorted = [...commentsCache].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (commentSortMode === 'newest') return new Date(b.created_at) - new Date(a.created_at);
    const scoreA = (a.like_count || 0) - (a.dislike_count || 0);
    const scoreB = (b.like_count || 0) - (b.dislike_count || 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  listEl.innerHTML = sorted.map(c => buildCommentBlockHtml(c)).join('');
}

function setCommentSort(mode) {
  commentSortMode = mode;
  document.getElementById('sort-top-btn').classList.toggle('active', mode === 'top');
  document.getElementById('sort-new-btn').classList.toggle('active', mode === 'newest');
  renderCommentList();
}

async function toggleReplies(commentId) {
  if (openReplyThreads.has(commentId)) {
    openReplyThreads.delete(commentId);
    renderCommentList();
    return;
  }
  openReplyThreads.add(commentId);
  if (!repliesCache[commentId]) {
    const { data: replies, error } = await _sb
      .from('comments').select('*')
      .eq('parent_id', commentId).eq('deleted', false)
      .order('created_at', { ascending: true });

    if (!error && replies && replies.length) {
      const missing = [...new Set(replies.map(r => r.author_handle))].filter(h => !profileCache[h]);
      if (missing.length) {
        const { data: profiles } = await _sb.from('profiles').select('handle,pic,name').in('handle', missing);
        (profiles || []).forEach(p => { profileCache[p.handle] = p; });
      }
      if (myProfile.handle && myProfile.handle !== 'guest') {
        const { data: myR } = await _sb.from('comment_reactions').select('comment_id,reaction_type')
          .eq('user_handle', myProfile.handle).in('comment_id', replies.map(r => r.id));
        (myR || []).forEach(r => { myReactionsMap[r.comment_id] = r.reaction_type; });
      }
      repliesCache[commentId] = replies;
    } else {
      repliesCache[commentId] = [];
    }
  }
  renderCommentList();
}

async function toggleReaction(commentId, type) {
  if (!myProfile.handle || myProfile.handle === 'guest') { showToast('Log in to react!'); return; }

  const prevState = myReactionsMap[commentId];  // undefined | 'like' | 'dislike'
  const target = findCommentById(commentId);

  // optimistic
  if (prevState === type) {
    delete myReactionsMap[commentId];
    if (target) target[type + '_count'] = Math.max(0, (target[type + '_count'] || 0) - 1);
  } else {
    if (target) {
      if (prevState) target[prevState + '_count'] = Math.max(0, (target[prevState + '_count'] || 0) - 1);
      target[type + '_count'] = (target[type + '_count'] || 0) + 1;
    }
    myReactionsMap[commentId] = type;
  }
  renderCommentList();

  const { error } = prevState === type
    ? await _sb.from('comment_reactions').delete().eq('comment_id', commentId).eq('user_handle', myProfile.handle)
    : await _sb.from('comment_reactions').upsert(
        { comment_id: commentId, user_handle: myProfile.handle, reaction_type: type },
        { onConflict: 'comment_id,user_handle' }
      );

  if (error) {
    // rollback
    if (prevState) myReactionsMap[commentId] = prevState; else delete myReactionsMap[commentId];
    if (target) {
      if (prevState === type) {
        target[type + '_count'] = (target[type + '_count'] || 0) + 1;
      } else {
        target[type + '_count'] = Math.max(0, (target[type + '_count'] || 0) - 1);
        if (prevState) target[prevState + '_count'] = (target[prevState + '_count'] || 0) + 1;
      }
    }
    renderCommentList();
    showToast('Error saving reaction');
  }
}

async function togglePin(commentId) {
  if (!canPinOrDelete()) return;
  const target = commentsCache.find(c => c.id === commentId);
  if (!target) return;

  if (target.is_pinned) {
    const { error } = await _sb.from('comments').update({ is_pinned: false }).eq('id', commentId);
    if (error) { showToast('Error unpinning comment'); return; }
    target.is_pinned = false;
  } else {
    const prevPinned = commentsCache.find(c => c.is_pinned);
    if (prevPinned) {
      const { error: unpinErr } = await _sb.from('comments').update({ is_pinned: false }).eq('id', prevPinned.id);
      if (unpinErr) { showToast('Error updating pin'); return; }
      prevPinned.is_pinned = false;
    }
    const { error } = await _sb.from('comments').update({ is_pinned: true }).eq('id', commentId);
    if (error) { showToast('Error pinning comment'); return; }
    target.is_pinned = true;
  }
  renderCommentList();
}

async function toggleHeart(commentId) {
  if (!canHeart()) return;
  const target = findCommentById(commentId);
  if (!target) return;
  const next = !target.is_hearted;
  const { error } = await _sb.from('comments').update({ is_hearted: next }).eq('id', commentId);
  if (error) { showToast('Error updating heart'); return; }
  target.is_hearted = next;
  renderCommentList();
}

async function deleteCommentRow(commentId, parentId) {
  if (!confirm('Delete this comment?')) return;
  const { error } = await _sb.from('comments').update({ deleted: true }).eq('id', commentId);
  if (error) { showToast('Error deleting comment'); return; }

  if (parentId) {
    if (repliesCache[parentId]) repliesCache[parentId] = repliesCache[parentId].filter(r => r.id !== commentId);
    const parent = commentsCache.find(c => c.id === parentId);
    if (parent) parent.reply_count = Math.max(0, (parent.reply_count || 0) - 1);
  } else {
    commentsCache = commentsCache.filter(c => c.id !== commentId);
    delete repliesCache[commentId];
    openReplyThreads.delete(commentId);
  }
  renderCommentList();
  showToast('Comment deleted');
}

function startReply(commentId, handle) {
  activeReplyTo = { id: commentId, handle };
  document.getElementById('reply-banner').classList.add('open');
  document.getElementById('reply-banner-text').textContent = 'Replying to @' + handle;
  const input = document.getElementById('commentInput');
  input.placeholder = 'Reply to @' + handle + '…';
  input.focus();
}

function cancelReply() {
  activeReplyTo = null;
  const banner = document.getElementById('reply-banner');
  if (banner) banner.classList.remove('open');
  const input = document.getElementById('commentInput');
  if (input) input.placeholder = 'Add a comment…';
}

async function postComment() {
  const input = document.getElementById('commentInput');
  const text  = input.value.trim();
  if (!text && !pendingReactionImg) return;
  if (!myProfile.handle || myProfile.handle === 'guest') {
    showToast('Log in to comment!'); return;
  }

  const frames = getFramesViewedForComment(activeComicId);
  const row = {
    comic_id: activeComicId,
    author_handle: myProfile.handle,
    parent_id: activeReplyTo ? activeReplyTo.id : null,
    content: text || null,
    image_src: pendingReactionImg ? pendingReactionImg.src : null,
    mentions: extractMentions(text),
    frames_viewed: frames ? frames.viewed : null,
    frames_total: frames ? frames.total : null
  };

  const { data, error } = await _sb.from('comments').insert([row]).select().single();
  if (error) { showToast('Error posting comment'); return; }

  // notify owner
  const ownerHandle = getActiveComicOwner();
  if (ownerHandle && ownerHandle !== myProfile.handle) {
    _sb.from('mentions').insert([{
      to_handle: ownerHandle,
      from_handle: myProfile.handle,
      type: 'comment',
      comic_id: activeComicId,
      comment_id: data.id,
      content: text || (row.image_src ? '📎 sent a reaction image' : ''),
      is_read: false
    }]).then(({ error: notifErr }) => { if (notifErr) console.warn('Comment notification insert failed:', notifErr); });
  }

  if (!profileCache[myProfile.handle]) profileCache[myProfile.handle] = { pic: myProfile.pic, name: myProfile.name };

  input.value = '';
  pendingReactionImg = null;

  if (row.parent_id) {
    if (!repliesCache[row.parent_id]) repliesCache[row.parent_id] = [];
    repliesCache[row.parent_id].push(data);
    openReplyThreads.add(row.parent_id);
    const parent = commentsCache.find(c => c.id === row.parent_id);
    if (parent) parent.reply_count = (parent.reply_count || 0) + 1;
  } else {
    commentsCache.unshift(data);
  }
  cancelReply();
  renderCommentList();
}

// search
async function filterSearch() {
  const q = document.getElementById('tagSearch').value.toLowerCase().trim();
  const creatorSection = document.getElementById('creatorResultsSection');
  if (!q) {
    creatorSection.style.display = 'none';
    renderComics(allComics, globalStars);
    return;
  }
  const filtered = allComics.filter(c =>
    c.title?.toLowerCase().includes(q) ||
    (c.tags && c.tags.some(t => t.toLowerCase().includes(q))) ||
    c.owner_handle?.toLowerCase().includes(q)
  );
  renderComics(filtered, globalStars);

  const { data: profiles } = await _sb
    .from('profiles').select('*')
    .or(`handle.ilike.%${q}%,name.ilike.%${q}%`)
    .limit(8);
  if (profiles?.length) {
    creatorSection.style.display = 'block';
    document.getElementById('creatorResults').innerHTML = profiles.map(p => {
      const avatarUrl = getPublicAvatarUrl(p.pic);
      const picHtml = avatarUrl
        ? `<img src="${esc(avatarUrl)}" onerror="this.style.display='none'">`
        : `<div style="width:46px;height:46px;border-radius:50%;background:#222;border:2px solid #333;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">👤</div>`;
      return `<div class="creator-card" onclick="location.href='profile.html?u=${esc(p.handle)}'">
        ${picHtml}
        <div>@${esc(p.handle)}</div>
      </div>`;
    }).join('');
  } else {
    creatorSection.style.display = 'none';
  }
}

// tabs
function switchTab(type) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const activeTabEl = document.getElementById('tab-'+type);
  if (activeTabEl) activeTabEl.classList.add('active');
  // highlight favs in dropdown
  if (type === 'favorites') {
    document.getElementById('sort-dropdown-btn')?.classList.add('active');
  }
  document.getElementById('section-recents').style.display   = type === 'all'       ? 'block' : 'none';
  document.getElementById('section-stories').style.display   = type === 'stories'   ? 'block' : 'none';
  document.getElementById('section-favorites').style.display = type === 'favorites' ? 'block' : 'none';
  // top creators only on home tab
  const tcSection = document.getElementById('top-creators-section');
  if (tcSection) tcSection.style.display = type === 'all' ? '' : 'none';
  if (type === 'stories') { if (!storiesLoaded) loadStories(); }
  if (type === 'favorites') loadFavoritesSection();
}

function renderSkeletons(n) {
  return Array.from({length: n}, () => `
    <div class="story-card story-skeleton" style="pointer-events:none">
      <div class="skel-cover"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:4px 0">
        <div class="skel-line" style="width:62%"></div>
        <div class="skel-line" style="width:30%;height:10px"></div>
        <div class="skel-line" style="width:80%;height:10px"></div>
        <div class="skel-line" style="width:40%;height:9px"></div>
      </div>
    </div>`).join('');
}

function renderStories(stories) {
  const feed = document.getElementById('storiesFeed');
  if (!stories || !stories.length) {
    feed.innerHTML = '<div class="empty-feed">No stories yet.<br>Be the first to publish one! ✍️</div>';
    return;
  }
  feed.innerHTML = stories.map(s => {
    const pages = s.page_count || Math.max(1, Math.ceil((s.word_count||0)/350));
    const coverHtml = s.cover
      ? '<img src="' + esc(s.cover) + '" class="story-cover" loading="lazy">'
      : '<div class="story-cover-placeholder"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:#555;"><path d="M7 3.5h9a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3.5Z"/><path d="M7 3.5H5.5a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1H15"/><path d="M10 8h4"/><path d="M10 11.5h4"/></svg></div>';
    const descHtml = s.description
      ? '<div class="story-desc">' + esc(s.description) + '</div>'
      : '';
    const pageLabel = pages + ' page' + (pages !== 1 ? 's' : '');
    const href = 'reader.html?id=' + esc(s.id);
    return '<div class="story-card" onclick="location.href=&quot;' + href + '&quot;">'
      + coverHtml
      + '<div style="flex:1;min-width:0">'
      + '<div class="story-title">' + esc(s.title) + '</div>'
      + '<a href="profile.html?u=' + esc(s.owner_handle) + '" class="story-author" onclick="event.stopPropagation()">@' + esc(s.owner_handle) + '</a>'
      + descHtml
      + '<div class="story-meta"><span>📄 ' + pageLabel + '</span><span>' + timeAgo(s.created_at) + '</span></div>'
      + '</div></div>';
  }).join('');
}

async function loadStories() {
  const feed = document.getElementById('storiesFeed');
  storiesLoaded = true;

  // 1. cache
  const cacheKey = CC_STORIES;
  const cacheTs  = CC_STORIES_TS;
  const cached   = localStorage.getItem(cacheKey);
  const ts       = parseInt(localStorage.getItem(cacheTs) || '0');
  const stale    = Date.now() - ts > 90000;  // 90s ttl

  if (cached && !stale) {
    try { renderStories(JSON.parse(cached)); return; } catch(e) {}
  }
  if (cached) {
    try { renderStories(JSON.parse(cached)); } catch(e) { feed.innerHTML = renderSkeletons(4); }
  } else {
    feed.innerHTML = renderSkeletons(4);
  }

  // 2. fetch
  const { data: stories, error } = await _sb.from('stories')
    .select('id,title,description,cover,tags,word_count,owner_name,owner_handle,created_at')
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) {
    console.warn('Stories fetch error:', error.message);
    // dont leave skeletons up
    if (cached) {
      try { renderStories(JSON.parse(cached)); } catch(e) {
        feed.innerHTML = '<div class="empty-feed">Could not load stories. Try refreshing.</div>';
      }
    } else {
      feed.innerHTML = '<div class="empty-feed">Could not load stories. Try refreshing.</div>';
    }
    return;
  }

  try {
    localStorage.setItem(cacheKey, JSON.stringify(stories || []));
    localStorage.setItem(cacheTs, String(Date.now()));
  } catch(e) {
    localStorage.removeItem(cacheKey);
  }
  renderStories(stories || []);
}

// share (same sheet as the reader: link, Discord, X, WhatsApp, More…)
function openShareSheet(comicId, comicTitle, ownerHandle) {
  shareComicId    = comicId;
  shareComicTitle = comicTitle || 'this comic';
  shareComicOwner = ownerHandle || null;
  shareUrl = new URL('reader.html?id=' + encodeURIComponent(comicId), location.href).href;

  const title  = shareComicTitle;
  const author = shareComicOwner ? ` by @${shareComicOwner}` : '';
  document.getElementById('sh-title').innerText     = `Share "${title}"`;
  document.getElementById('sh-sub').innerText       = 'Anyone with this link can read it';
  document.getElementById('sh-link-text').innerText = shareUrl;
  const copyBtn = document.getElementById('copy-btn');
  copyBtn.textContent = 'Copy';
  copyBtn.classList.remove('copied');

  const enc = encodeURIComponent(shareUrl);
  const txt = encodeURIComponent(`"${title}"${author} — a comic on ComicCore 🎨`);
  document.getElementById('discord-btn').onclick = e => { e.preventDefault(); copyLink(); showToast('Link copied! Paste it into Discord 🎮'); };
  document.getElementById('twitter-btn').href    = `https://twitter.com/intent/tweet?text=${txt}&url=${enc}`;
  document.getElementById('whatsapp-btn').href   = `https://wa.me/?text=${txt}%20${enc}`;

  document.getElementById('share-sheet').classList.add('open');
}

function closeShareSheet() {
  document.getElementById('share-sheet').classList.remove('open');
}

async function copyLink() {
  try { await navigator.clipboard.writeText(shareUrl); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = shareUrl; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2500);
  showToast('Link copied to clipboard!');
}

async function nativeShare() {
  if (navigator.share) {
    try {
      await navigator.share({ title: shareComicTitle || 'ComicCore', text: `Check out "${shareComicTitle || 'this comic'}" on ComicCore!`, url: shareUrl });
    } catch(e) { if (e.name !== 'AbortError') copyLink(); }
  } else { copyLink(); }
}

// trending/recent reaction tabs

async function loadTrendingReactions() {
  const grid = document.getElementById('reaction-grid');
  grid.innerHTML = '<div class="reaction-tray-empty">Loading…</div>';

  try {
    // fetch recent reactions
    const { data: comments } = await _sb
      .from('messages')
      .select('content')
      .like('content', '[IMG_REACTION]:%')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!comments || !comments.length) {
      // fallback
      loadReactionGrid(ALL_REACTIONS);
      return;
    }

    // count usage
    const counts = {};
    comments.forEach(c => {
      const src = c.content.replace('[IMG_REACTION]:', '').trim();
      counts[src] = (counts[src] || 0) + 1;
    });

    // sort by usage
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([src]) => ALL_REACTIONS.find(r => r.src === src))
      .filter(Boolean);

    // pad with unused
    const usedSrcs = new Set(sorted.map(r => r.src));
    const unused = ALL_REACTIONS.filter(r => !usedSrcs.has(r.src));

    loadReactionGrid([...sorted, ...unused]);
  } catch(e) {
    loadReactionGrid(ALL_REACTIONS);
  }
}

async function loadRecentReactions() {
  const grid = document.getElementById('reaction-grid');
  grid.innerHTML = '<div class="reaction-tray-empty">Loading…</div>';

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: comments } = await _sb
      .from('messages')
      .select('content')
      .like('content', '[IMG_REACTION]:%')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!comments || !comments.length) {
      grid.innerHTML = '<div class="reaction-tray-empty">No reactions used recently — showing all</div>';
      setTimeout(() => loadReactionGrid(ALL_REACTIONS), 1200);
      return;
    }

    // dedupe
    const seen = new Set();
    const recent = [];
    comments.forEach(c => {
      const src = c.content.replace('[IMG_REACTION]:', '').trim();
      if (!seen.has(src)) {
        seen.add(src);
        const r = ALL_REACTIONS.find(r => r.src === src);
        if (r) recent.push(r);
      }
    });

    // pad unused
    const unused = ALL_REACTIONS.filter(r => !seen.has(r.src));
    loadReactionGrid([...recent, ...unused]);
  } catch(e) {
    loadReactionGrid(ALL_REACTIONS);
  }
}

// override category btns
function buildCategoryBtns() {
  const wrap = document.getElementById('reaction-categories');
  wrap.innerHTML = `
    <button class="reaction-cat-btn active" id="reaction-tab-trending" onclick="switchReactionCategory('trending', this)">🔥 Trending</button>
    <button class="reaction-cat-btn" id="reaction-tab-recent" onclick="switchReactionCategory('recent', this)">🕐 Recent</button>
  `;
  // default to trending
  loadTrendingReactions();
}

function switchReactionCategory(tab, btn) {
  document.querySelectorAll('.reaction-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'trending') loadTrendingReactions();
  else loadRecentReactions();
}

// star rating
function starCountToRating(count) {
  if (!count || count <= 0) return 0;
  if (count >= 120) return 5;
  if (count >= 90)  return 4.5;
  if (count >= 70)  return 4;
  if (count >= 50)  return 3.5;
  if (count >= 35)  return 3;
  if (count >= 22)  return 2.5;
  if (count >= 15)  return 2;
  if (count >= 9)   return 1.5;
  if (count >= 5)   return 1;
  if (count >= 2)   return 0.5;
  return 0;
}

// star icon
function starNumIcon(rating, size) {
  const GOLD = '#ffd700';
  const cls = size === 'lg' ? 'star-num-icon star-num-icon-lg'
            : size === 'md' ? 'star-num-icon star-num-icon-md'
            : 'star-num-icon';
  const label = (Math.round(rating * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `<span class="${cls}">
    <svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="${GOLD}" stroke="${GOLD}" stroke-width="1" stroke-linejoin="round"/></svg>
    <span class="star-num-text">${esc(label)}</span>
  </span>`;
}

function renderStarRating(avgRating, count) {
  if (avgRating <= 0) return '';
  return `<div class="star-rating">${starNumIcon(avgRating)}<span class="star-count">${count} rating${count !== 1 ? 's' : ''}</span></div>`;
}

// favorites
let favoritesPage = 0;
let favoriteComics = [];
const FAV_PER_PAGE = 12;

async function loadFavoritesSection() {
  const container = document.getElementById('favoritesFeed');
  if (!myProfile.handle || myProfile.handle === 'guest') {
    container.innerHTML = '<div style="color:#555;font-size:13px;font-weight:700;padding:40px 20px;grid-column:1/-1;text-align:center;">Log in to see your favorites!</div>';
    return;
  }

  container.innerHTML = '<div style="color:#333;font-size:12px;font-weight:700;padding:40px 20px;grid-column:1/-1;text-align:center;">Loading favorites…</div>';

  const { data: starEntries } = await _sb
    .from('messages')
    .select('receiver_hand')
    .eq('sender_handle', myProfile.handle)
    .eq('reaction', '\u2b50');

  if (!starEntries || !starEntries.length) {
    container.innerHTML = '<div style="color:#555;font-size:13px;font-weight:700;padding:40px 20px;grid-column:1/-1;text-align:center;">No favorites yet.\u2028Star comics to see them here!</div>';
    document.getElementById('favorites-pagination-row').innerHTML = '';
    return;
  }

  const favoriteIds = starEntries.map(e => e.receiver_hand);
  favoriteComics = allComics.filter(c => favoriteIds.includes(c.id));

  // fetch missing comics
  const missing = favoriteIds.filter(id => !allComics.find(c => c.id === id));
  if (missing.length) {
    const { data: extras } = await _sb
      .from('comics')
      .select('id,title,cover,owner_handle,owner_name,created_at,tags,swipe_dir,toonscroll_status,canvas_ratio,age_rating,age_rating_locked,views')
      .in('id', missing);
    if (extras) favoriteComics = [...favoriteComics, ...extras.filter(c => c.title && c.owner_handle)];
  }

  renderFavoritesPage();
}

function renderFavoritesPage() {
  const container = document.getElementById('favoritesFeed');
  const pagRow = document.getElementById('favorites-pagination-row');
  const totalPages = Math.max(1, Math.ceil(favoriteComics.length / FAV_PER_PAGE));
  if (favoritesPage >= totalPages) favoritesPage = 0;

  if (!favoriteComics.length) {
    container.innerHTML = '<div style="color:#555;font-size:13px;font-weight:700;padding:40px 20px;grid-column:1/-1;text-align:center;">No favorites found.</div>';
    pagRow.innerHTML = '';
    return;
  }

  const slice = favoriteComics.slice(favoritesPage * FAV_PER_PAGE, (favoritesPage + 1) * FAV_PER_PAGE);
  container.innerHTML = slice.map(c => {
    const starCount = globalRatings.filter(r => r.receiver_hand === c.id).length;
    const avgRating = starCount > 0 ?
      globalRatings.filter(r => r.receiver_hand === c.id)
        .reduce((sum, r) => sum + (parseInt(r.content) || 0), 0) / starCount : 0;
    const isMine = c.owner_handle === myProfile.handle;
    const prog = getProgress(c.id, getCachedFrameCount(c.id));
    const coverHtml = c.cover
      ? `<img src="${esc(c.cover)}" loading="lazy" decoding="async" class="cover-loading" onload="this.classList.remove('cover-loading')" onerror="this.parentNode.innerHTML='<div class=no-cover>\ud83d\udcd6</div>'">`
      : '<div class="no-cover">\ud83d\udcd6</div>';
    const progressHtml = prog ? `<div class="tile-progress"><div class="tile-progress-fill" style="width:${prog.pct}%"></div></div>` : '';
    const ownerHandle = esc(c.owner_handle || 'unknown');
    const favCollabs  = collabMap[c.id] || [];
    const favAllAuthors = [c.owner_handle, ...favCollabs].filter(Boolean);
    const favAuthorLine = favAllAuthors.map(h =>
      `<span class="comic-card-handle" onclick="event.stopPropagation(); location.href='profile.html?u=${esc(h)}'">@${esc(h)}</span>`
    ).join('<span style="color:#333;margin:0 1px;">·</span>');
    const followBtn = (!isMine && myProfile.handle !== 'guest')
      ? `<button class="comic-card-follow" data-follow-handle="${ownerHandle}" onclick="event.stopPropagation(); tileFollow(this, '${ownerHandle}')">Follow</button>` : '';

    return `<div class="comic-card" data-id="${esc(c.id)}">
      <div class="comic-card-cover">
        <div style="width:100%;height:100%;border-radius:14px;overflow:hidden;position:relative;">
          ${coverHtml}
          <div class="tile-stars" onclick="event.stopPropagation(); toggleStarExpand(this, ${starCount || 0})">⭐ FAV</div>
          ${progressHtml}
        </div>
      </div>
      <div class="comic-card-info">
        <div class="comic-card-title" title="${esc(c.title || 'Untitled')}">${esc(c.title || 'Untitled')}</div>
        <div class="comic-card-meta">
          <img class="comic-card-avatar" data-handle="${ownerHandle}" src="" alt=""
            onclick="event.stopPropagation(); location.href='profile.html?u=${ownerHandle}'"
            onerror="this.style.display='none'">
          <span style="min-width:0;overflow:hidden;display:flex;align-items:center;gap:1px;flex-wrap:wrap;">${favAuthorLine}</span>
          ${followBtn}
        </div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.comic-card').forEach(card => {
    card.addEventListener('click', () => openPopup(card.dataset.id));
  });
  hydrateCardAvatars(container);
  hydrateFollowButtons(container);

  // pagination
  if (totalPages <= 1) { pagRow.innerHTML = ''; return; }
  pagRow.innerHTML = `
    <button class="page-btn pg-arrow" onclick="goToFavPage(${favoritesPage - 1})" ${favoritesPage <= 0 ? 'disabled' : ''}>\u2039</button>
    ${Array.from({length: totalPages}, (_,i) => `<button class="page-btn ${i===favoritesPage?'pg-active':''}" onclick="goToFavPage(${i})">${i+1}</button>`).join('')}
    <button class="page-btn pg-arrow" onclick="goToFavPage(${favoritesPage + 1})" ${favoritesPage >= totalPages - 1 ? 'disabled' : ''}>\u203a</button>`;
}

function goToFavPage(n) {
  const totalPages = Math.ceil(favoriteComics.length / FAV_PER_PAGE);
  favoritesPage = Math.max(0, Math.min(n, totalPages - 1));
  renderFavoritesPage();
  document.getElementById('section-favorites')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// star expand
function toggleStarExpand(badge, starCount, avgRating) {
  const coverInner = badge.closest('div[style]') || badge.parentElement;
  // toggle panel
  const existing = coverInner.querySelector('.tile-star-expanded');
  if (existing) { existing.remove(); return; }

  const rating = parseFloat(avgRating);
  const panel = document.createElement('div');
  panel.className = 'tile-star-expanded';
  panel.onclick = (e) => { e.stopPropagation(); panel.remove(); };
  panel.innerHTML = `
    ${starNumIcon(rating, 'lg')}
    <div class="star-expanded-count">${starCount} rating${starCount !== 1 ? 's' : ''} · ${rating.toFixed(1)} / 5 avg</div>
    <div class="star-expanded-close">tap to close</div>`;
  coverInner.appendChild(panel);
}

// age rating picker
function openRatingPicker(comicId) {
  const c = allComics.find(x => x.id === comicId) || favoriteComics.find(x => x.id === comicId);
  if (!c) return;
  if (!canEditRating(c)) { showToast('Only the creator or an admin can change this.'); return; }

  document.querySelector('.rating-picker-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'rating-picker-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const locked = !!c.age_rating_locked;
  const optionsHtml = AGE_RATINGS.map(r => `
    <div class="rating-picker-opt${c.age_rating === r.code ? ' active' : ''}" style="--opt-color:${r.color}"
      onclick="setComicRating('${esc(c.id)}', '${r.code}')">
      <div><div class="rating-picker-opt-label">${esc(r.label)}</div><div class="rating-picker-opt-desc">${esc(r.desc)}</div></div>
      ${c.age_rating === r.code ? '<span class="rating-picker-opt-check">✓</span>' : ''}
    </div>`).join('');

  overlay.innerHTML = `
    <div class="rating-picker-sheet" onclick="event.stopPropagation()">
      <div class="rating-picker-title">Age rating</div>
      <div class="rating-picker-sub">${esc(c.title || 'This comic')}</div>
      <div class="rating-picker-options">${optionsHtml}</div>
      ${c.age_rating ? `<div class="rating-picker-clear" onclick="setComicRating('${esc(c.id)}', null)">Clear rating</div>` : ''}
      ${isModOrAdmin ? `<div class="rating-picker-lock-toggle" onclick="setRatingLock('${esc(c.id)}', ${!locked})">${locked ? '🔓 Unlock — let the creator manage this' : '🔒 Lock — only an admin/mod can change it'}</div>` : ''}
      ${locked && !isModOrAdmin ? `<div class="rating-picker-locked-note">An admin/mod set this rating. You can't change it until they unlock it.</div>` : ''}
      <div class="rating-picker-cancel" onclick="this.closest('.rating-picker-overlay').remove()">Cancel</div>
    </div>`;
  document.body.appendChild(overlay);
}

async function setComicRating(comicId, code) {
  const update = { age_rating: code };
  // admin sets = locked, creator sets = stays editable
  if (isModOrAdmin) update.age_rating_locked = true;

  const { error } = await _sb.from('comics').update(update).eq('id', comicId);
  document.querySelector('.rating-picker-overlay')?.remove();
  if (error) { showToast('Error saving rating: ' + error.message); return; }

  [allComics, favoriteComics].forEach(list => {
    const c = list.find(x => x.id === comicId);
    if (c) { c.age_rating = code; if (isModOrAdmin) c.age_rating_locked = true; }
  });

  if (document.getElementById('favoritesFeed')?.offsetParent) renderFavoritesPage();
  else renderComics(allComics, globalRatings);
  if (activePopupComic?.id === comicId) openPopup(comicId);
  showToast(code ? `Rating set to ${code}` : 'Rating cleared');
}

async function setRatingLock(comicId, locked) {
  const { error } = await _sb.from('comics').update({ age_rating_locked: locked }).eq('id', comicId);
  if (error) { showToast('Error: ' + error.message); return; }

  [allComics, favoriteComics].forEach(list => {
    const c = list.find(x => x.id === comicId);
    if (c) c.age_rating_locked = locked;
  });

  document.querySelector('.rating-picker-overlay')?.remove();
  if (document.getElementById('favoritesFeed')?.offsetParent) renderFavoritesPage();
  else renderComics(allComics, globalRatings);
  showToast(locked ? 'Locked — only an admin can change it now' : 'Unlocked — the creator can manage it again');
}

window.onload = init;
