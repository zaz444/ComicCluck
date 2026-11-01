        const _supabase = supabase.createClient('https://mmycqeejhguzhtzkyjaj.supabase.co', 'sb_publishable_8Du2GAcH5oBeiHWe-1e0Fg_XtSub2QE', { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth' } });

        // fix quota crash on save, strip base64 first
        function ccSaveProfile(profile) {
            try {
                localStorage.setItem('user_profile', JSON.stringify(profile));
            } catch (e) {
                const trimmed = { ...profile };
                if (trimmed.pic && trimmed.pic.startsWith('data:image')) trimmed.pic = '';
                if (trimmed.banner && trimmed.banner.startsWith('data:image')) trimmed.banner = '';
                try {
                    localStorage.setItem('user_profile', JSON.stringify(trimmed));
                } catch (e2) {
                    localStorage.removeItem('user_profile');
                }
            }
        }

        const SOCIAL_CONFIG = [
            { key: 'x',           label: 'X / Twitter',  icon: '𝕏',  hint: '@username',   placeholder: '@handle' },
            { key: 'instagram',   label: 'Instagram',     icon: '📸', hint: '@username',   placeholder: '@handle' },
            { key: 'tiktok',      label: 'TikTok',        icon: '🎵', hint: '@username',   placeholder: '@handle' },
            { key: 'youtube',     label: 'YouTube',       icon: '📺', hint: '@channel',    placeholder: '@channel' },
            { key: 'discord',     label: 'Discord',       icon: '👾', hint: 'username#tag', placeholder: 'username' },
            { key: 'facebook',    label: 'Facebook',      icon: '👥', hint: 'profile name', placeholder: 'yourname' },
            { key: 'snapchat',    label: 'Snapchat',      icon: '👻', hint: 'username',    placeholder: 'snapname' },
            { key: 'playstation', label: 'PSN',           icon: '🎮', hint: 'PSN ID',      placeholder: 'PSN ID' },
            { key: 'xbox',        label: 'Xbox',          icon: '💚', hint: 'Gamertag',    placeholder: 'Gamertag' },
            { key: 'paypal',      label: 'PayPal',        icon: '💰', hint: 'username/link', placeholder: 'username' },
            { key: 'cashapp',     label: 'Cash App',      icon: '💸', hint: '$cashtag',    placeholder: '$cashtag' },
            { key: 'gmail',       label: 'Gmail',         icon: '📧', hint: 'email address', placeholder: 'you@gmail.com' },
        ];

        let pfpBase64 = "";
        let bannerBase64 = "";
        let _pfpChanged = false;
        let _isDirty = false;
        let _settingsMilestones = [];
        let _settingsMilestoneStyle = 'fire';
        let _settingsAccentColor = '#ff7a00';
        let _settingsPronoun = '';

        // -- unsaved changes tracker --
        function markDirty() {
            if (_isDirty) return;
            _isDirty = true;
            const b = document.getElementById('unsaved-banner');
            if (b) b.style.display = 'block';
        }

        function markClean() {
            _isDirty = false;
            const b = document.getElementById('unsaved-banner');
            if (b) b.style.display = 'none';
        }

        function attachDirtyListeners() {
            ['edit-name', 'edit-bio', 'milestone-message-input'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', markDirty);
            });
            SOCIAL_CONFIG.forEach(s => {
                const el = document.getElementById('social-' + s.key);
                if (el) el.addEventListener('input', markDirty);
            });
            [
                'st-show-followers','st-public-profile','st-show-status','st-squad-invites',
                'st-allow-dms','st-allow-comments','st-show-discover','st-share-cookies',
                'st-reduced-motion','st-show-socials','st-show-grid','st-pinned-comic',
                'st-milestones-enabled','st-notif-followers','st-notif-comments','st-notif-likes',
                'st-notif-mentions','st-notif-squads','st-notif-announcements','st-notif-milestones'
            ].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', markDirty);
            });
        }

        function normalizeStoragePath(pic) {
            if (!pic || pic.startsWith('data:image') || pic.startsWith('http')) return pic;
            let path = pic;
            let prefixes = 0;
            while (path.startsWith('avatars/')) { path = path.slice('avatars/'.length); prefixes++; }
            return prefixes > 0 ? `avatars/${path}` : pic;
        }

        function formatImageUrl(pic) {
            if (!pic) return '';
            if (pic.startsWith('data:image')) return pic;
            if (pic.startsWith('avatars/')) {
                let cleanPath = pic;
                while (cleanPath.startsWith('avatars/')) cleanPath = cleanPath.slice('avatars/'.length);
                const { data } = _supabase.storage.from('avatars').getPublicUrl(cleanPath);
                return data.publicUrl;
            }
            return pic;
        }

        async function migrateBase64ToStorage(base64Data, type, handle) {
            if (!base64Data || !base64Data.startsWith('data:image')) return base64Data;
            try {
                const res = await fetch(base64Data);
                const blob = await res.blob();
                const filename = `${type}_${handle}_${Date.now()}.jpg`;
                const { data, error } = await _supabase.storage.from('avatars').upload(filename, blob, { upsert: true, contentType: 'image/jpeg' });
                if (error) { console.warn('Avatar migration to Storage failed, keeping base64 for now:', error); return base64Data; }
                const storagePath = `avatars/${filename}`;
                const updateField = type === 'pfp' ? 'pic' : 'banner';
                await _supabase.from('profiles').update({ [updateField]: storagePath }).eq('handle', handle);
                return storagePath;
            } catch (err) {
                return base64Data;
            }
        }

        function getImageUrl(pic) { return formatImageUrl(pic); }

        let currentViewedHandle = "";
        let myProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');

        function buildSocialInfo(key, val) {
            if (!val) return null;
            const urlMap = {
                x:           `https://x.com/${val}`,
                instagram:   `https://instagram.com/${val}`,
                tiktok:      `https://tiktok.com/@${val}`,
                youtube:     `https://youtube.com/@${val}`,
                facebook:    `https://facebook.com/${val}`,
                snapchat:    `https://snapchat.com/add/${val}`,
                gmail:       `mailto:${val}`,
                paypal:      `https://paypal.me/${val}`,
                cashapp:     `https://cash.app/$${val}`,
                playstation: `https://psnprofiles.com/${val}`,
                xbox:        `https://account.xbox.com/en-US/Profile?gamertag=${encodeURIComponent(val)}`,
            };
            if (val.startsWith('http') || val.startsWith('mailto:')) return { url: val, isLink: true };
            if (urlMap[key]) return { url: urlMap[key], isLink: true };
            return { url: null, isLink: false, text: val };
        }

        function buildSocialUrl(key, val) {
            const info = buildSocialInfo(key, val);
            return info ? (info.url || val) : null;
        }

        async function init() {
            // apply cached accent color right away, same as discover.html
            applyAccentColor(myProfile.settings?.accent_color || '#ff7a00');

            const params = new URLSearchParams(window.location.search);
            currentViewedHandle = params.get('u');

            const container = document.getElementById('social-inputs-container');
            SOCIAL_CONFIG.forEach(s => {
                const card = document.createElement('div');
                card.className = 'social-card';
                card.innerHTML = `
                    <div class="social-card-icon">${s.icon}</div>
                    <div class="social-card-info">
                        <div class="social-card-platform">${s.label}</div>
                        <div class="social-card-hint">${s.hint || 'username'}</div>
                    </div>
                    <input type="text" id="social-${s.key}" placeholder="${s.placeholder || s.label}">
                `;
                container.appendChild(card);
            });

            if (!myProfile.handle && !currentViewedHandle) {
                const { data: { session: _ps } } = await _supabase.auth.getSession();
                const user = _ps?.user ?? null;
                if (!user) { alert('You must be logged in to edit your profile.'); location.href = 'login.html'; return; }
                const { data: fresh } = await _supabase.from('profiles').select('*').eq('permanent_id', user.id).maybeSingle();
                if (fresh) { myProfile = { ...myProfile, ...fresh }; ccSaveProfile(myProfile); }
                else { alert('Profile not found. Please sign in again.'); await _supabase.auth.signOut(); location.href = 'login.html'; return; }
            }

            if (currentViewedHandle) {
                await loadPublicProfile(currentViewedHandle);
            } else if (myProfile.handle) {
                openEditor();
            } else {
                alert('Could not load your profile. Please sign in again.');
                location.href = 'login.html';
            }
            const loader = document.getElementById('loading-screen');
            if (loader) loader.classList.add('hidden');
        }

        async function loadPublicProfile(handle) {
            document.getElementById('public-view').style.display = 'flex';
            document.getElementById('public-view').style.flexDirection = 'column';
            document.getElementById('edit-view').classList.remove('open');
            document.getElementById('edit-view').style.display = 'none';

            const { data: profile } = await _supabase.from('profiles').select('*').eq('handle', handle).single();
            if (!profile) return;

            // apply profile owner's accent color
            applyAccentColor(profile.settings?.accent_color || '#ff7a00');

            document.getElementById('view-name').innerText = profile.name || handle;

            const roleTag = document.getElementById('view-role-tag');
            const profileRole = profile.settings?.role || null;
            if (handle === 'jeffyplays') { roleTag.innerText = 'Owner'; roleTag.className = 'role-tag owner'; roleTag.style.display = 'inline-block'; }
            else if (profileRole === 'mod') { roleTag.innerText = 'Mod'; roleTag.className = 'role-tag mod'; roleTag.style.display = 'inline-block'; }
            else { roleTag.innerText = 'Creator'; roleTag.className = 'role-tag'; roleTag.style.display = 'inline-block'; }

            document.getElementById('view-handle').innerText = '@' + handle;
            document.getElementById('view-bio').innerText = profile.bio || '';
            const rawPic = profile.pic || '';
            let displayPic = rawPic;
            if (rawPic.startsWith('data:image')) { displayPic = await migrateBase64ToStorage(rawPic, 'pfp', handle); if (displayPic !== rawPic) profile.pic = displayPic; }
            document.getElementById('view-pfp').src = formatImageUrl(displayPic);

            updateOgTags({
                title: (profile.name || handle) + ' (@' + handle + ') · ComicCluck',
                description: profile.bio || 'Check out ' + (profile.name || handle) + '\'s profile on ComicCluck!',
                image: formatImageUrl(displayPic),
                url: 'https://zaz444.github.io/comiccore/profile.html?u=' + handle
            });

            const bannerImg = document.getElementById('view-banner');
            if (profile.banner && profile.banner.length > 10) {
                let displayBanner = profile.banner;
                if (profile.banner.startsWith('data:image')) { displayBanner = await migrateBase64ToStorage(profile.banner, 'banner', handle); if (displayBanner !== profile.banner) profile.banner = displayBanner; }
                bannerImg.src = formatImageUrl(displayBanner);
                bannerImg.style.display = 'block';
            } else { bannerImg.src = ''; bannerImg.style.display = 'none'; }

            const socialDiv = document.getElementById('social-links');
            socialDiv.innerHTML = '';
            const socials = profile.socials || {};
            SOCIAL_CONFIG.forEach(s => {
                const val = socials[s.key];
                if (!val) return;
                const info = buildSocialInfo(s.key, val);
                if (!info) return;
                const displayVal = val.replace(/^https?:\/\/[^/]+\//, '').replace(/^@/, '').substring(0, 18);
                if (info.isLink) {
                    socialDiv.innerHTML += `<a href="${info.url}" target="_blank" class="social-chip" title="${s.label}: ${val}"><span class="social-chip-icon">${s.icon}</span><div><div class="social-chip-label">${s.label}</div><div class="social-chip-val">${displayVal}</div></div></a>`;
                } else {
                    socialDiv.innerHTML += `<div class="social-chip" title="${s.label}: ${val}"><span class="social-chip-icon">${s.icon}</span><div><div class="social-chip-label">${s.label}</div><div class="social-chip-val">${val.substring(0,18)}</div></div></div>`;
                }
            });

            await loadUserStatus(handle);
            document.getElementById('share-profile-btn').style.display = 'block';

            const isOwn = handle === myProfile.handle;
            document.getElementById('edit-own-btn').style.display = isOwn ? 'flex' : 'none';

            const amOwner = myProfile.handle === 'jeffyplays';
            const { data: myProfileData } = myProfile.handle ? await _supabase.from('profiles').select('settings').eq('handle', myProfile.handle).maybeSingle() : { data: null };
            const amMod = amOwner || myProfileData?.settings?.role === 'mod';

            const actionRow = document.getElementById('action-row');
            actionRow.innerHTML = '';
            const secondaryRow = document.getElementById('secondary-action-row');
            secondaryRow.innerHTML = '';

            if (!isOwn && myProfile.handle) {
                const { data: followRow } = await _supabase.from('follows').select('id').eq('follower', myProfile.handle).eq('following', handle).maybeSingle();
                let isFollowing = !!followRow;
                const followBtn = document.createElement('button');
                followBtn.className = 'follow-btn' + (isFollowing ? ' following' : '');
                followBtn.innerText = isFollowing ? 'Following ✓' : 'Follow';
                followBtn.onclick = async () => {
                    followBtn.disabled = true;
                    if (isFollowing) { await _supabase.from('follows').delete().eq('follower', myProfile.handle).eq('following', handle); followBtn.innerText = 'Follow'; followBtn.classList.remove('following'); isFollowing = false; }
                    else { await _supabase.from('follows').insert([{ follower: myProfile.handle, following: handle }]); followBtn.innerText = 'Following ✓'; followBtn.classList.add('following'); isFollowing = true; }
                    followBtn.disabled = false;
                    loadFollowCounts(handle);
                };
                actionRow.appendChild(followBtn);

                const { data: conn } = await _supabase.from('connections').select('id').or(`and(sender_handle.eq.${myProfile.handle},receiver_handle.eq.${handle}),and(sender_handle.eq.${handle},receiver_handle.eq.${myProfile.handle})`).eq('status', 'accepted').maybeSingle();
                if (conn) { const msgBtn = document.createElement('button'); msgBtn.className = 'msg-btn'; msgBtn.innerHTML = 'Message'; msgBtn.onclick = () => location.href = `messages.html?to=${handle}`; actionRow.appendChild(msgBtn); }

                const { data: blockRow } = await _supabase.from('blocks').select('id').eq('blocker', myProfile.handle).eq('blocked', handle).maybeSingle();
                let isBlocked = !!blockRow;
                const blockBtn = document.createElement('button');
                blockBtn.className = 'small-action-btn' + (isBlocked ? ' blocked' : '');
                blockBtn.innerText = isBlocked ? 'Blocked' : 'Block';
                blockBtn.onclick = async () => {
                    blockBtn.disabled = true;
                    if (isBlocked) { await _supabase.from('blocks').delete().eq('blocker', myProfile.handle).eq('blocked', handle); isBlocked = false; blockBtn.innerText = 'Block'; blockBtn.classList.remove('blocked'); showToast('User unblocked'); }
                    else { await _supabase.from('blocks').insert([{ blocker: myProfile.handle, blocked: handle }]); isBlocked = true; blockBtn.innerText = 'Blocked'; blockBtn.classList.add('blocked'); showToast('User blocked'); }
                    blockBtn.disabled = false;
                };
                secondaryRow.appendChild(blockBtn);

                const inviteBtn = document.createElement('button'); inviteBtn.className = 'small-action-btn'; inviteBtn.innerText = 'Invite to Squad'; inviteBtn.onclick = () => openInviteModal(handle, profile.name || handle); secondaryRow.appendChild(inviteBtn);
                const reportBtn = document.createElement('button'); reportBtn.className = 'small-action-btn'; reportBtn.innerText = 'Report'; reportBtn.onclick = () => openReportModal(handle, profile.name || handle); secondaryRow.appendChild(reportBtn);

                const viewedIsOwner = handle === 'jeffyplays';
                const viewedIsMod = profileRole === 'mod';
                const adminPanel = document.getElementById('admin-panel');
                const adminGrid  = document.getElementById('admin-action-grid');
                const adminStatusBar = document.getElementById('admin-status-bar');
                adminGrid.innerHTML = ''; adminStatusBar.style.display = 'none';
                const canActOnTarget = amMod && !viewedIsOwner && (amOwner || !viewedIsMod);
                if (canActOnTarget) {
                    const { data: banRow } = await _supabase.from('bans').select('id, expires_at, action_type, reason').eq('banned_handle', handle).maybeSingle();
                    const currentAction = banRow?.action_type || null;
                    if (currentAction) {
                        const exp = banRow.expires_at ? new Date(banRow.expires_at).toLocaleDateString() : 'Forever';
                        const isPause = currentAction === 'pause';
                        adminStatusBar.className = 'admin-status-bar ' + (isPause ? 'paused' : 'banned');
                        adminStatusBar.style.display = 'flex';
                        adminStatusBar.innerHTML = `<span style="flex:1;">${isPause ? 'Paused' : 'Banned'} · until ${exp}</span>`;
                    }
                    if (!currentAction) {
                        const pauseBtn = document.createElement('button'); pauseBtn.className = 'admin-btn pause-col'; pauseBtn.innerText = 'Pause'; pauseBtn.onclick = () => openBanModal(handle, profile.name || handle, 'pause'); adminGrid.appendChild(pauseBtn);
                        const banBtn = document.createElement('button'); banBtn.className = 'admin-btn danger'; banBtn.innerText = 'Ban'; banBtn.onclick = () => openBanModal(handle, profile.name || handle, 'ban'); adminGrid.appendChild(banBtn);
                    } else {
                        const restoreBtn = document.createElement('button'); restoreBtn.className = 'admin-btn warn'; restoreBtn.innerText = 'Restore'; restoreBtn.onclick = async () => { await _supabase.from('bans').delete().eq('banned_handle', handle); await _supabase.from('banned_ips').delete().eq('banned_handle', handle); await logBanAction(handle, 'restore', null, 'Account restored', null); showToast('@' + handle + ' restored'); loadPublicProfile(handle); }; adminGrid.appendChild(restoreBtn);
                        const switchBtn = document.createElement('button');
                        if (currentAction === 'pause') { switchBtn.className = 'admin-btn danger'; switchBtn.innerText = 'Escalate to Ban'; switchBtn.onclick = () => openBanModal(handle, profile.name || handle, 'ban'); }
                        else { switchBtn.className = 'admin-btn pause-col'; switchBtn.innerText = 'Change to Pause'; switchBtn.onclick = () => openBanModal(handle, profile.name || handle, 'pause'); }
                        adminGrid.appendChild(switchBtn);
                    }
                    if (amOwner) {
                        const modBtn = document.createElement('button');
                        if (viewedIsMod) { modBtn.className = 'admin-btn warn'; modBtn.innerText = 'Revoke Mod'; modBtn.onclick = () => setModRole(handle, false); }
                        else { modBtn.className = 'admin-btn teal'; modBtn.innerText = 'Make Mod'; modBtn.onclick = () => setModRole(handle, true); }
                        adminGrid.appendChild(modBtn);
                        const logBtn = document.createElement('button'); logBtn.className = 'admin-btn'; logBtn.innerText = 'Action Log'; logBtn.onclick = () => openBanLog(handle); adminGrid.appendChild(logBtn);
                    }
                    adminPanel.classList.add('open');
                } else if (amMod && (viewedIsOwner || viewedIsMod)) {
                    adminGrid.innerHTML = `<div style="grid-column:span 2;font-size:11px;color:var(--dim);font-weight:700;padding:4px 2px;">Protected account — no actions available</div>`;
                    adminPanel.classList.add('open');
                }
            }

            loadFollowCounts(handle);
            loadUserComics(handle);
            loadCollabComics(handle);
            loadPlaylistsCount(handle);
            renderMilestoneBanner(profile, handle);

            const folPrivacy = localStorage.getItem('cc-privacy-followers');
            if (folPrivacy === 'false' && handle !== myProfile.handle) {
                document.getElementById('stat-following').style.cursor = 'default';
                document.getElementById('stat-followers').style.cursor = 'default';
                document.getElementById('stat-following').onclick = null;
                document.getElementById('stat-followers').onclick = null;
            }
        }

        // -- pause / ban system --
        let _banTargetHandle = '';
        let _banMode = 'pause';
        let _banDuration = '';

        const PAUSE_DURATIONS = [
            { label: '1 Day',   sub: '24 hrs',   val: '1d'   },
            { label: '3 Days',  sub: '72 hrs',   val: '3d'   },
            { label: '7 Days',  sub: '1 week',   val: '7d'   },
            { label: '14 Days', sub: '2 weeks',  val: '14d'  },
            { label: '30 Days', sub: '1 month',  val: '30d'  },
            { label: 'Forever', sub: 'Paused termination', val: 'perm' },
        ];
        const BAN_DURATIONS = [
            { label: '1 Day',   sub: '24 hrs',   val: '1d'   },
            { label: '7 Days',  sub: '1 week',   val: '7d'   },
            { label: '30 Days', sub: '1 month',  val: '30d'  },
            { label: '90 Days', sub: '3 months', val: '90d'  },
            { label: '1 Year',  sub: '365 days', val: '365d' },
            { label: 'Permanent', sub: 'Termination', val: 'perm' },
        ];

        function openBanModal(handle, name, mode = 'pause') {
            _banTargetHandle = handle; _banDuration = ''; _banMode = mode;
            document.getElementById('ban-reason-input').value = '';
            document.getElementById('ban-ip-checkbox').checked = false;
            switchBanMode(mode);
            document.getElementById('ban-sub-text').innerText = '@' + handle + (name && name !== handle ? ' · ' + name : '');
            document.getElementById('ban-overlay').classList.add('open');
        }

        function switchBanMode(mode) {
            _banMode = mode; _banDuration = '';
            const isPause = mode === 'pause';
            document.getElementById('ban-title-el').textContent = isPause ? 'Pause Account' : 'Ban Account';
            document.getElementById('ban-title-el').className = 'ban-title ' + (isPause ? 'is-pause' : 'is-ban');
            document.getElementById('mod-tab-pause').className = 'ban-mode-tab' + (isPause ? ' active-pause' : '');
            document.getElementById('mod-tab-ban').className   = 'ban-mode-tab' + (!isPause ? ' active-ban' : '');
            const confirmBtn = document.getElementById('ban-confirm-btn');
            confirmBtn.className = 'ban-confirm-btn ' + (isPause ? 'mode-pause' : 'mode-ban');
            confirmBtn.textContent = isPause ? 'Confirm Pause' : 'Confirm Ban';
            const durations = isPause ? PAUSE_DURATIONS : BAN_DURATIONS;
            const selClass  = isPause ? 'sel-pause' : 'sel-ban';
            const grid = document.getElementById('ban-dur-grid');
            grid.innerHTML = durations.map(d => `<button class="ban-dur-btn" data-val="${d.val}" onclick="selectBanDur(this,'${d.val}','${selClass}')">${d.label}<div class="dur-sub">${d.sub}</div></button>`).join('');
        }

        function closeBanModal() { document.getElementById('ban-overlay').classList.remove('open'); }

        function selectBanDur(btn, val, selClass) {
            document.querySelectorAll('.ban-dur-btn').forEach(b => b.className = 'ban-dur-btn');
            btn.classList.add(selClass); _banDuration = val;
        }

        function banDurToExpiry(val) {
            if (val === 'perm') return null;
            const days = { '1d':1,'3d':3,'7d':7,'14d':14,'30d':30,'90d':90,'365d':365 };
            const d = days[val] || 1;
            return new Date(Date.now() + d * 86400000).toISOString();
        }

        async function logBanAction(targetHandle, actionType, expiresAt, reason, durationLabel) {
            await _supabase.from('bans_log').insert([{ target_handle: targetHandle, action_by: myProfile.handle, action_type: actionType, expires_at: expiresAt, reason: reason || null, duration_label: durationLabel || null, created_at: new Date().toISOString() }]);
        }

        async function confirmBanAction() {
            if (!_banDuration) { showToast('Pick a duration first'); return; }
            const reason = document.getElementById('ban-reason-input').value.trim();
            const alsoBanIps = document.getElementById('ban-ip-checkbox').checked;
            const expiresAt = banDurToExpiry(_banDuration);
            const durLabels = [...PAUSE_DURATIONS, ...BAN_DURATIONS];
            const durLabel  = durLabels.find(d => d.val === _banDuration)?.label || _banDuration;
            const { error } = await _supabase.from('bans').upsert([{ banned_handle: _banTargetHandle, banned_by: myProfile.handle, action_type: _banMode, reason: reason || null, expires_at: expiresAt, created_at: new Date().toISOString() }], { onConflict: 'banned_handle' });
            if (error) { showToast('Error: ' + error.message); return; }
            await logBanAction(_banTargetHandle, _banMode, expiresAt, reason, durLabel + (_banDuration === 'perm' ? '' : ''));

            let ipNote = '';
            if (alsoBanIps) {
                const ipCount = await banKnownIps(_banTargetHandle, reason, expiresAt);
                ipNote = ipCount > 0 ? ` · ${ipCount} IP${ipCount === 1 ? '' : 's'} blocked` : ' · no known IPs on file';
            }

            closeBanModal();
            showToast((_banMode === 'pause' ? 'Paused' : 'Banned') + ' @' + _banTargetHandle + ' · ' + durLabel + ipNote);
            loadPublicProfile(_banTargetHandle);
        }

        // ban every ip this handle has logged in from too
        async function banKnownIps(handle, reason, expiresAt) {
            const { data: ips } = await _supabase.from('login_ips').select('ip').eq('handle', handle);
            if (!ips || !ips.length) return 0;
            const rows = ips.map(r => ({
                ip: r.ip,
                banned_handle: handle,
                banned_by: myProfile.handle,
                reason: reason || null,
                expires_at: expiresAt,
                created_at: new Date().toISOString()
            }));
            const { error } = await _supabase.from('banned_ips').upsert(rows, { onConflict: 'ip' });
            if (error) { showToast('IP ban error: ' + error.message); return 0; }
            return rows.length;
        }

        async function openBanLog(filterHandle) {
            document.getElementById('banlog-overlay').classList.add('open');
            const list = document.getElementById('banlog-list');
            list.innerHTML = '<div style="text-align:center;color:#444;padding:24px;">Loading…</div>';
            let query = _supabase.from('bans_log').select('*').order('created_at', { ascending: false }).limit(80);
            if (filterHandle) query = query.eq('target_handle', filterHandle);
            const { data, error } = await query;
            if (error || !data?.length) { list.innerHTML = '<div class="banlog-empty">No actions logged yet.</div>'; return; }
            const typeTag = { pause: 'bl-pause', ban: 'bl-ban', restore: 'bl-unban' };
            const typeLabel = { pause: 'Pause', ban: 'Ban', restore: 'Restore' };
            list.innerHTML = data.map(r => {
                const when = r.created_at ? new Date(r.created_at).toLocaleString() : '';
                const exp  = r.expires_at ? ' · until ' + new Date(r.expires_at).toLocaleDateString() : (r.action_type !== 'restore' ? ' · Forever' : '');
                return `<div class="banlog-row"><div class="banlog-top"><span class="banlog-type ${typeTag[r.action_type] || 'bl-ban'}">${typeLabel[r.action_type] || r.action_type}</span><span class="banlog-target">@${r.target_handle}</span>${r.duration_label ? `<span class="banlog-dur">${r.duration_label}${exp}</span>` : ''}</div>${r.reason ? `<div class="banlog-reason">${r.reason}</div>` : ''}<div class="banlog-meta"><span>by @${r.action_by}</span><span>${when}</span></div></div>`;
            }).join('');
        }

        function closeBanLog() { document.getElementById('banlog-overlay').classList.remove('open'); }

        // -- report system --
        let _reportTargetHandle = '';
        let _reportReason = '';

        function openReportModal(handle, name) {
            _reportTargetHandle = handle; _reportReason = '';
            document.getElementById('report-sub-text').innerText = 'Report @' + handle + ' (' + name + ')';
            document.querySelectorAll('.report-opt').forEach(o => o.classList.remove('selected'));
            document.getElementById('report-submit-btn').disabled = true;
            document.getElementById('report-overlay').classList.add('open');
        }
        function closeReportModal() { document.getElementById('report-overlay').classList.remove('open'); }
        function selectReportOpt(btn, reason) { document.querySelectorAll('.report-opt').forEach(o => o.classList.remove('selected')); btn.classList.add('selected'); _reportReason = reason; document.getElementById('report-submit-btn').disabled = false; }
        async function submitReport() {
            if (!_reportReason) return;
            const { error } = await _supabase.from('reports').insert([{ reporter_handle: myProfile.handle, reported_handle: _reportTargetHandle, reason: _reportReason, created_at: new Date().toISOString(), status: 'pending' }]);
            if (error) { showToast('Error: ' + error.message); return; }
            closeReportModal(); showToast('✓ Report submitted — thank you');
        }

        // -- squad invite system --
        function openInviteModal(handle, name) {
            document.getElementById('invite-sub-text').innerText = 'Pick a squad to invite ' + name + ' to';
            const list = document.getElementById('invite-squads-list');
            list.innerHTML = '<div style="text-align:center;color:#555;padding:16px;">Loading your squads…</div>';
            document.getElementById('invite-overlay').classList.add('open');
            loadMySquadsForInvite(handle);
        }
        function closeInviteModal() { document.getElementById('invite-overlay').classList.remove('open'); }

        async function loadMySquadsForInvite(targetHandle) {
            const list = document.getElementById('invite-squads-list');
            const [{ data: owned }, { data: myReqs }, { data: allAccepted }] = await Promise.all([
                _supabase.from('team_tickets').select('id, team_name').eq('owner_handle', myProfile.handle),
                _supabase.from('team_requests').select('ticket_id').eq('sender_handle', myProfile.handle).eq('status', 'accepted'),
                _supabase.from('team_requests').select('ticket_id').eq('status', 'accepted')
            ]);
            const joinedIds = (myReqs || []).map(r => String(r.ticket_id));
            let allSquads = owned || [];
            if (joinedIds.length) { const { data: joined } = await _supabase.from('team_tickets').select('id, team_name').in('id', joinedIds); allSquads = [...allSquads, ...(joined || [])]; }
            const seen = new Set(); allSquads = allSquads.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
            if (!allSquads.length) { list.innerHTML = '<div style="text-align:center;color:#555;padding:20px;">You\'re not in any squads yet.</div>'; return; }
            list.innerHTML = allSquads.map(s => {
                const memberCount = (allAccepted || []).filter(r => String(r.ticket_id) === String(s.id)).length + 1;
                const safeName = String(s.team_name || 'Squad').replace(/'/g, "\\'");
                return `<div class="squad-invite-item"><div><div class="squad-invite-name">${s.team_name}</div><div class="squad-invite-sub">${memberCount} member${memberCount === 1 ? '' : 's'}</div></div><button class="squad-invite-btn" id="inv-btn-${s.id}" onclick="sendSquadInvite('${s.id}','${safeName}','${targetHandle}')">Invite</button></div>`;
            }).join('');
        }

        async function sendSquadInvite(squadId, squadName, targetHandle) {
            const btn = document.getElementById('inv-btn-' + squadId);
            if (btn) { btn.disabled = true; btn.innerText = 'Sending…'; }
            const { data: targetProf } = await _supabase.from('profiles').select('settings').eq('handle', targetHandle).maybeSingle();
            const allowsInvites = targetProf?.settings?.allow_squad_invites !== false;
            if (!allowsInvites) { showToast('This user has disabled squad invites'); if (btn) { btn.disabled = false; btn.innerText = 'Invite'; } return; }
            const { error } = await _supabase.from('squad_invites').insert([{ squad_id: squadId, squad_name: squadName, from_handle: myProfile.handle, to_handle: targetHandle, created_at: new Date().toISOString(), status: 'pending' }]);
            if (error) { showToast(error.code === '23505' ? 'Already invited!' : 'Error: ' + error.message); if (btn) { btn.disabled = false; btn.innerText = 'Invite'; } return; }
            if (btn) btn.innerText = '✓ Sent';
            showToast('Invite sent to @' + targetHandle);
            setTimeout(closeInviteModal, 1200);
        }

        // -- mod management --
        async function setModRole(handle, makeMod) {
            if (myProfile.handle !== 'jeffyplays') return;
            const { data: p } = await _supabase.from('profiles').select('settings').eq('handle', handle).maybeSingle();
            const merged = { ...(p?.settings || {}), role: makeMod ? 'mod' : null };
            const { error } = await _supabase.from('profiles').update({ settings: merged }).eq('handle', handle);
            if (error) { showToast('Error: ' + error.message); return; }
            showToast(makeMod ? handle + ' is now a Mod' : 'Mod role removed from ' + handle);
            loadPublicProfile(handle);
        }

        async function loadFollowCounts(handle) {
            const [{ count: followers }, { count: following }] = await Promise.all([
                _supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following', handle),
                _supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower', handle),
            ]);
            document.getElementById('count-followers').innerText = followers || 0;
            document.getElementById('count-following').innerText = following || 0;
        }

        async function openFolModal(type) {
            const folPrivacy = localStorage.getItem('cc-privacy-followers');
            if (folPrivacy === 'false' && currentViewedHandle !== myProfile.handle) return;
            document.getElementById('fol-overlay').classList.add('open');
            document.getElementById('fol-title').innerText = type === 'followers' ? 'Followers' : 'Following';
            const list = document.getElementById('fol-list');
            list.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">Loading...</div>';
            let handles = [];
            if (type === 'followers') { const { data } = await _supabase.from('follows').select('follower').eq('following', currentViewedHandle); handles = (data || []).map(r => r.follower); }
            else { const { data } = await _supabase.from('follows').select('following').eq('follower', currentViewedHandle); handles = (data || []).map(r => r.following); }
            if (!handles.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">Nobody here yet.</div>'; return; }
            list.innerHTML = '';
            for (const h of handles) {
                const { data: p } = await _supabase.from('profiles').select('name, pic').eq('handle', h).maybeSingle();
                const row = document.createElement('div'); row.className = 'fol-row'; row.onclick = () => location.href = 'profile.html?u=' + h;
                row.innerHTML = `<img src="${p?.pic || ''}" class="fol-pic" onerror="this.style.display='none'"><div><div class="fol-name">${p?.name || h}</div><div class="fol-handle">@${h}</div></div>`;
                list.appendChild(row);
            }
        }
        function closeFolModal() { document.getElementById('fol-overlay').classList.remove('open'); }

        async function loadUserComics(handle) {
            const { data: comics } = await _supabase.from('comics').select('id, title, cover').eq('owner_handle', handle);
            const grid = document.getElementById('user-comic-grid');

            // load profile for pinned comics
            const { data: profile } = await _supabase.from('profiles').select('settings').eq('handle', handle).maybeSingle();
            const pinnedIds = profile?.settings?.pinned_comics || [];

            // render pinned comics section if any
            const pinnedSection = document.getElementById('pinned-section');
            if (pinnedIds.length > 0 && comics && comics.length > 0) {
                const pinnedComics = pinnedIds.map(id => comics.find(c => c.id === id)).filter(Boolean);
                if (pinnedComics.length > 0) {
                    pinnedSection.innerHTML = `
                        <div class="grid-section">
                            <div class="grid-header">Pinned</div>
                            <div class="pinned-comics-banner">
                                ${pinnedComics.map(c => `
                                    <div class="pinned-comic-card" onclick="location.href='reader.html?id=${c.id}'">
                                        <div class="pinned-comic-cover">
                                            ${c.cover ? `<img src="${c.cover}" loading="lazy">` : '<div style="width:100%;height:100%;background:#1a1a1e;display:flex;align-items:center;justify-content:center;color:#444;font-size:12px;font-weight:700;">No Cover</div>'}
                                        </div>
                                        <div class="pinned-comic-title">${c.title || 'Untitled'}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                    pinnedSection.style.display = '';
                } else {
                    pinnedSection.style.display = 'none';
                }
            } else {
                pinnedSection.style.display = 'none';
            }

            if (!comics || !comics.length) { grid.innerHTML = '<div class="grid-empty">No comics yet</div>'; return; }
            grid.innerHTML = comics.map(c => `<div class="grid-item" onclick="location.href='reader.html?id=${c.id}'"><img src="${c.cover}" loading="lazy"></div>`).join('');
        }

        async function loadCollabComics(handle) {
            const section = document.getElementById('collab-section');
            const grid    = document.getElementById('user-collab-grid');
            try {
                // get comics with an accepted collab invite
                const { data: collabs } = await _supabase
                    .from('comic_collaborators')
                    .select('comic_id')
                    .eq('invitee_handle', handle)
                    .eq('status', 'accepted');

                if (!collabs || !collabs.length) { section.style.display = 'none'; return; }

                const comicIds = collabs.map(c => c.comic_id);
                const { data: comics } = await _supabase
                    .from('comics')
                    .select('id, title, cover')
                    .in('id', comicIds);

                if (!comics || !comics.length) { section.style.display = 'none'; return; }

                section.style.display = '';
                grid.innerHTML = comics.map(c => `
                    <div class="grid-item" onclick="location.href='reader.html?id=${c.id}'" title="${c.title || 'Untitled'}">
                        ${c.cover
                            ? `<img src="${c.cover}" loading="lazy" onerror="this.parentNode.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#111;color:#333;font-size:10px;font-weight:700;\'>No Cover</div>'">`
                            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#111;color:#333;font-size:10px;font-weight:700;">No Cover</div>`}
                    </div>`).join('');
            } catch(e) {
                section.style.display = 'none';
            }
        }

        function openEditor() {
            if (!myProfile.handle) { alert('You need to be logged in to edit your profile.'); location.href = 'index.html'; return; }
            document.getElementById('public-view').style.display = 'none';
            document.getElementById('edit-view').style.display = 'flex';
            document.getElementById('edit-view').classList.add('open');
            backToSettingsMenu();

            document.getElementById('edit-name').value = myProfile.name || '';
            document.getElementById('edit-bio').value = myProfile.bio || '';

            if (!myProfile.pic) { pfpBase64 = randomAvatar(); } else { pfpBase64 = myProfile.pic; }
            document.getElementById('pfp-preview').src = getImageUrl(pfpBase64);
            _pfpChanged = false;

            bannerBase64 = myProfile.banner || '';
            const bPrev = document.getElementById('banner-preview');
            if (bannerBase64) { bPrev.src = getImageUrl(bannerBase64); bPrev.style.display = 'block'; }
            else { bPrev.src = ''; bPrev.style.display = 'none'; }

            const socials = myProfile.socials || {};
            SOCIAL_CONFIG.forEach(s => { const input = document.getElementById(`social-${s.key}`); if (input) input.value = socials[s.key] || ''; });

            const currentStatus = myProfile.settings?.status || 'online';
            selectStatus(currentStatus);

            const s = myProfile.settings || {};
            document.getElementById('st-show-followers').checked  = s.show_followers !== false;
            document.getElementById('st-public-profile').checked  = s.public_profile !== false;
            document.getElementById('st-show-status').checked     = s.show_status !== false;
            document.getElementById('st-squad-invites').checked   = s.allow_squad_invites !== false;
            document.getElementById('st-allow-dms').checked       = s.allow_dms !== false;
            document.getElementById('st-allow-comments').checked  = s.allow_comments !== false;
            document.getElementById('st-show-discover').checked   = s.show_discover !== false;
            document.getElementById('st-show-socials').checked    = s.show_socials !== false;
            document.getElementById('st-show-grid').checked       = s.show_grid !== false;
            _settingsAccentColor = s.accent_color || '#ff7a00';
            document.querySelectorAll('.accent-swatch').forEach(sw => sw.classList.toggle('selected', sw.dataset.color === _settingsAccentColor));
            _settingsPronoun = s.pronoun || '';
            document.querySelectorAll('.pronoun-chip').forEach(c => c.classList.toggle('selected', c.dataset.val === _settingsPronoun));

            const msEnabled = s.milestones?.enabled === true;
            document.getElementById('st-milestones-enabled').checked = msEnabled;
            _settingsMilestones = s.milestones?.thresholds?.length ? [...s.milestones.thresholds] : [...DEFAULT_MILESTONES];
            _settingsMilestoneStyle = s.milestones?.style || 'fire';
            document.getElementById('milestone-message-input').value = s.milestones?.message || '';
            renderMilestoneCheckboxes();
            renderMilestoneStylePicker();
            document.getElementById('milestone-customizer').style.display = msEnabled ? 'block' : 'none';

            document.getElementById('st-notif-followers').checked     = s.notif_new_follower !== false;
            document.getElementById('st-notif-comments').checked      = s.notif_comments !== false;
            document.getElementById('st-notif-likes').checked         = s.notif_likes !== false;
            document.getElementById('st-notif-mentions').checked      = s.notif_mentions !== false;
            document.getElementById('st-notif-squads').checked        = s.notif_squads !== false;
            document.getElementById('st-notif-announcements').checked = s.notif_announcements !== false;
            document.getElementById('st-notif-milestones').checked    = s.notif_milestones !== false;
            document.getElementById('st-reduced-motion').checked = !!s.reduced_motion;

            // mark clean first, attach listeners after a tick so populating doesn't flag dirty
            markClean();
            setTimeout(attachDirtyListeners, 50);
        }

        let _pinnedComicsTemp = [];
        let _myComicsData = [];

        async function openPinnedComicsModal() {
            _pinnedComicsTemp = [...(myProfile.settings?.pinned_comics || [])];
            const { data } = await _supabase.from('comics').select('id, title, cover').eq('owner_handle', myProfile.handle).order('created_at', { ascending: false });
            _myComicsData = data || [];
            renderPinnedComicsModal();
            document.getElementById('pinned-comics-overlay').classList.add('open');
        }

        function closePinnedComicsModal() {
            document.getElementById('pinned-comics-overlay').classList.remove('open');
        }

        function renderPinnedComicsModal() {
            const grid = document.getElementById('pinned-comics-modal-grid');
            if (!_myComicsData.length) {
                grid.innerHTML = '<p style="color:#888;text-align:center;grid-column:span 3;padding:20px;">No comics found</p>';
                return;
            }
            grid.innerHTML = _myComicsData.map(c => {
                const isSelected = _pinnedComicsTemp.includes(c.id);
                return `<div class="pinned-select-card ${isSelected ? 'selected' : ''}" onclick="togglePinnedComic('${c.id}', this)">
                    <div class="card-cover" style="position:relative;">
                        ${c.cover ? `<img src="${c.cover}" loading="lazy">` : '<div style="width:100%;aspect-ratio:2/3;background:#1a1a1e;display:flex;align-items:center;justify-content:center;color:#333;font-size:10px;font-weight:700;">No Cover</div>'}
                        <div class="card-check">✓</div>
                    </div>
                    <div class="card-title">${c.title || 'Untitled'}</div>
                </div>`;
            }).join('');
        }

        function togglePinnedComic(comicId, el) {
            const idx = _pinnedComicsTemp.indexOf(comicId);
            if (idx > -1) {
                _pinnedComicsTemp.splice(idx, 1);
                el.classList.remove('selected');
            } else if (_pinnedComicsTemp.length < 3) {
                _pinnedComicsTemp.push(comicId);
                el.classList.add('selected');
            } else {
                showToast('Maximum 3 pinned comics allowed');
                return;
            }
            renderPinnedComicsPreview();
        }

        function renderPinnedComicsPreview() {
            const preview = document.getElementById('pinned-comics-preview');
            const slots = [];
            for (let i = 0; i < 3; i++) {
                if (_pinnedComicsTemp[i]) {
                    const comic = _myComicsData.find(c => c.id === _pinnedComicsTemp[i]);
                    if (comic) {
                        slots.push(`<div class="pinned-preview-item"><img src="${comic.cover || ''}" onerror="this.parentNode.innerHTML='<div style=\\'width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center;color:#333;font-size:10px;font-weight:700;\\'>No Cover</div>'"></div>`);
                    } else {
                        slots.push('<div class="pinned-preview-item"><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#555;">?</div></div>');
                    }
                } else {
                    slots.push('<div class="pinned-preview-empty">+</div>');
                }
            }
            preview.innerHTML = slots.join('');
        }

        function savePinnedComics() {
            if (!myProfile.settings) myProfile.settings = {};
            myProfile.settings.pinned_comics = _pinnedComicsTemp;
            closePinnedComicsModal();
            showToast('Pinned comics saved!');
            markDirty();
        }

        // -- playlists -- ordered named collection, can include comics from any creator --
        let playlistsData = [];  // playlists for the currently open profile
        let plComicCache  = {};  // comic_id -> title/cover/owner cache
        let plEditDraft   = { id: null, title: '', comic_ids: [] };

        function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

        // count badge on the icon button
        async function loadPlaylistsCount(handle) {
            const badge = document.getElementById('playlists-nav-badge');
            if (!badge) return;
            const { data, error } = await _supabase.from('playlists').select('id').eq('owner_handle', handle);
            const n = error ? 0 : (data || []).length;
            if (n > 0) { badge.innerText = n > 9 ? '9+' : n; badge.style.display = 'flex'; }
            else { badge.style.display = 'none'; }
        }

        async function openPlaylistsModal() {
            const handle = currentViewedHandle || myProfile.handle;
            if (!handle) return;
            const grid = document.getElementById('playlists-modal-grid');
            grid.innerHTML = '<div style="grid-column:span 2;text-align:center;color:#555;padding:20px;">Loading…</div>';
            document.getElementById('playlists-overlay').classList.add('open');

            const { data, error } = await _supabase.from('playlists').select('*').eq('owner_handle', handle).order('created_at', { ascending: false });
            playlistsData = error ? [] : (data || []);

            // resolve cover thumbnails, first 4 comics per playlist
            const allIds = [...new Set(playlistsData.flatMap(p => (p.comic_ids || []).slice(0, 4)))];
            if (allIds.length) {
                const { data: comics } = await _supabase.from('comics').select('id,title,cover,owner_handle').in('id', allIds);
                (comics || []).forEach(c => { plComicCache[c.id] = c; });
            }
            renderPlaylistsGrid();
        }
        function closePlaylistsModal() { document.getElementById('playlists-overlay').classList.remove('open'); }

        function renderPlaylistsGrid() {
            const grid = document.getElementById('playlists-modal-grid');
            const isOwn = (currentViewedHandle || myProfile.handle) === myProfile.handle;
            let html = '';
            if (isOwn) {
                html += `<div class="playlist-card playlist-new-card" onclick="openPlaylistEdit(null)">+ New Playlist</div>`;
            }
            if (!playlistsData.length) {
                html += `<div style="grid-column:span 2;text-align:center;color:#555;font-size:12.5px;padding:20px 10px;">${isOwn ? 'Create a playlist to feature comics you love — yours or anyone else\'s.' : 'No playlists yet.'}</div>`;
            } else {
                html += playlistsData.map(p => {
                    const ids = (p.comic_ids || []).slice(0, 4);
                    const covers = ids.map(id => plComicCache[id]?.cover).filter(Boolean);
                    const coverHtml = covers.length
                        ? covers.map(c => `<img src="${escHtml(c)}" loading="lazy">`).join('')
                        : `<div class="playlist-cover-empty">No covers</div>`;
                    const count = (p.comic_ids || []).length;
                    return `<div class="playlist-card" onclick="openPlaylistDetail('${p.id}')">
                        <div class="playlist-cover">${coverHtml}</div>
                        <div class="playlist-card-body">
                            <div class="playlist-card-title">${escHtml(p.title || 'Untitled')}</div>
                            <div class="playlist-card-count">${count} comic${count !== 1 ? 's' : ''}</div>
                        </div>
                    </div>`;
                }).join('');
            }
            grid.innerHTML = html;
        }

        // -- playlist detail (with attribution) --
        async function openPlaylistDetail(playlistId) {
            const playlist = playlistsData.find(p => p.id === playlistId);
            if (!playlist) return;
            document.getElementById('playlist-detail-title').innerText = playlist.title || 'Untitled';
            const list = document.getElementById('playlist-detail-list');
            list.innerHTML = '<div style="text-align:center;color:#555;padding:20px;">Loading…</div>';
            document.getElementById('playlist-detail-overlay').classList.add('open');

            const isOwn = playlist.owner_handle === myProfile.handle;
            const ownerActions = document.getElementById('playlist-detail-owner-actions');
            ownerActions.innerHTML = isOwn ? `
                <button class="sheet-cancel-btn" style="flex:1;" onclick="closePlaylistDetail();openPlaylistEdit('${playlist.id}')">Edit</button>
                <button style="flex:1;padding:12px;border-radius:12px;border:none;background:rgba(255,59,48,0.12);color:#ff3b30;font-weight:800;font-size:13px;cursor:pointer;font-family:'Inter',sans-serif;" onclick="deletePlaylist('${playlist.id}')">Delete</button>
            ` : '';

            const ids = playlist.comic_ids || [];
            if (!ids.length) { list.innerHTML = '<div style="text-align:center;color:#555;padding:20px;">No comics in this playlist yet.</div>'; return; }

            const { data: comics } = await _supabase.from('comics').select('id,title,cover,owner_handle').in('id', ids);
            const comicMap = {}; (comics || []).forEach(c => { comicMap[c.id] = c; plComicCache[c.id] = c; });

            // show attribution for collab comics even if owner matches this playlist
            const { data: collabs } = await _supabase.from('comic_collaborators').select('comic_id,invitee_handle').in('comic_id', ids).eq('status', 'accepted');
            const collabMap = {};
            (collabs || []).forEach(c => { (collabMap[c.comic_id] = collabMap[c.comic_id] || []).push(c.invitee_handle); });

            list.innerHTML = ids.map(id => {
                const c = comicMap[id];
                if (!c) return '';
                const collaborators = collabMap[id] || [];
                let byline = '';
                if (collaborators.length) {
                    byline = `By @${escHtml(c.owner_handle)}, ${collaborators.map(h => '@' + escHtml(h)).join(', ')}`;
                } else if (c.owner_handle !== playlist.owner_handle) {
                    byline = `By @${escHtml(c.owner_handle)}`;
                }
                const removeBtn = isOwn ? `<div class="playlist-comic-remove" onclick="event.stopPropagation();removeComicFromLivePlaylist('${playlist.id}','${id}')">Remove</div>` : '';
                return `<div class="playlist-comic-row" onclick="location.href='reader.html?id=${id}'">
                    <div class="playlist-comic-cover">${c.cover ? `<img src="${escHtml(c.cover)}" loading="lazy">` : ''}</div>
                    <div style="flex:1;">
                        <div class="playlist-comic-title">${escHtml(c.title || 'Untitled')}</div>
                        ${byline ? `<div class="playlist-comic-byline">${byline}</div>` : ''}
                    </div>
                    ${removeBtn}
                </div>`;
            }).join('');
        }
        function closePlaylistDetail() { document.getElementById('playlist-detail-overlay').classList.remove('open'); }

        async function removeComicFromLivePlaylist(playlistId, comicId) {
            const playlist = playlistsData.find(p => p.id === playlistId);
            if (!playlist) return;
            playlist.comic_ids = (playlist.comic_ids || []).filter(id => id !== comicId);
            await _supabase.from('playlists').update({ comic_ids: playlist.comic_ids }).eq('id', playlistId);
            openPlaylistDetail(playlistId);
            renderPlaylistsGrid();
        }

        // -- playlist create/edit --
        function openPlaylistEdit(playlistId) {
            const existing = playlistId ? playlistsData.find(p => p.id === playlistId) : null;
            plEditDraft = existing
                ? { id: existing.id, title: existing.title || '', comic_ids: [...(existing.comic_ids || [])] }
                : { id: null, title: '', comic_ids: [] };
            document.getElementById('playlist-edit-heading').innerText = existing ? 'Edit Playlist' : 'New Playlist';
            document.getElementById('pl-edit-title').value = plEditDraft.title;
            document.getElementById('pl-comic-search').value = '';
            document.getElementById('pl-search-results').innerHTML = '';
            renderPlEditSelectedList();
            document.getElementById('playlist-edit-overlay').classList.add('open');
        }
        function closePlaylistEdit() { document.getElementById('playlist-edit-overlay').classList.remove('open'); }

        let _plSearchTimer = null;
        function searchComicsForPlaylist() {
            clearTimeout(_plSearchTimer);
            const q = document.getElementById('pl-comic-search').value.trim();
            const results = document.getElementById('pl-search-results');
            if (!q) { results.innerHTML = ''; return; }
            _plSearchTimer = setTimeout(async () => {
                const { data } = await _supabase.from('comics').select('id,title,cover,owner_handle')
                    .or(`title.ilike.%${q}%,owner_handle.ilike.%${q}%`).limit(15);
                const filtered = (data || []).filter(c => !plEditDraft.comic_ids.includes(c.id));
                if (!filtered.length) { results.innerHTML = '<div style="text-align:center;color:#555;font-size:12px;padding:10px;">No matches</div>'; return; }
                results.innerHTML = filtered.map(c => {
                    plComicCache[c.id] = c;
                    return `<div class="pl-search-row" onclick='addComicToPlaylistDraft(${JSON.stringify(c.id)})'>
                        <div class="pl-search-cover">${c.cover ? `<img src="${escHtml(c.cover)}" loading="lazy">` : ''}</div>
                        <div>
                            <div class="pl-search-title">${escHtml(c.title || 'Untitled')}</div>
                            <div class="pl-search-owner">@${escHtml(c.owner_handle)}</div>
                        </div>
                        <div class="pl-add-btn">+ Add</div>
                    </div>`;
                }).join('');
            }, 250);
        }

        function addComicToPlaylistDraft(comicId) {
            if (plEditDraft.comic_ids.includes(comicId)) return;
            plEditDraft.comic_ids.push(comicId);
            document.getElementById('pl-comic-search').value = '';
            document.getElementById('pl-search-results').innerHTML = '';
            renderPlEditSelectedList();
        }
        function removeComicFromPlaylistDraft(comicId) {
            plEditDraft.comic_ids = plEditDraft.comic_ids.filter(id => id !== comicId);
            renderPlEditSelectedList();
        }
        function renderPlEditSelectedList() {
            document.getElementById('pl-selected-count').innerText = plEditDraft.comic_ids.length;
            const list = document.getElementById('pl-selected-list');
            if (!plEditDraft.comic_ids.length) {
                list.innerHTML = '<div style="text-align:center;color:#555;font-size:12px;padding:14px;">Search above to add comics.</div>';
                return;
            }
            list.innerHTML = plEditDraft.comic_ids.map(id => {
                const c = plComicCache[id];
                return `<div class="pl-search-row">
                    <div class="pl-search-cover">${c?.cover ? `<img src="${escHtml(c.cover)}" loading="lazy">` : ''}</div>
                    <div>
                        <div class="pl-search-title">${escHtml(c?.title || 'Untitled')}</div>
                        <div class="pl-search-owner">@${escHtml(c?.owner_handle || '')}</div>
                    </div>
                    <div class="pl-add-btn" style="color:#ff3b30;" onclick="removeComicFromPlaylistDraft('${id}')">Remove</div>
                </div>`;
            }).join('');
        }

        async function savePlaylist() {
            const title = document.getElementById('pl-edit-title').value.trim();
            if (!title) { showToast('Give your playlist a title first'); return; }
            if (!plEditDraft.comic_ids.length) { showToast('Add at least one comic'); return; }

            if (plEditDraft.id) {
                await _supabase.from('playlists').update({ title, comic_ids: plEditDraft.comic_ids }).eq('id', plEditDraft.id);
            } else {
                await _supabase.from('playlists').insert([{ owner_handle: myProfile.handle, title, comic_ids: plEditDraft.comic_ids, created_at: new Date().toISOString() }]);
            }
            closePlaylistEdit();
            showToast('Playlist saved!');
            openPlaylistsModal();
            loadPlaylistsCount(myProfile.handle);
        }

        async function deletePlaylist(id) {
            if (!confirm('Delete this playlist? This cannot be undone.')) return;
            await _supabase.from('playlists').delete().eq('id', id);
            closePlaylistDetail();
            showToast('Playlist deleted');
            openPlaylistsModal();
            loadPlaylistsCount(myProfile.handle);
        }

        async function saveProfile() {
            if (!myProfile.handle) { alert('Session error: your handle is missing. Please log out and log in again.'); return; }

            let picPath = normalizeStoragePath(myProfile.pic || '');
            let bannerPath = normalizeStoragePath(myProfile.banner || '');

            if (pfpBase64 && pfpBase64.startsWith('data:image')) {
                try {
                    const res = await fetch(pfpBase64); const blob = await res.blob();
                    const filename = `pfp_${myProfile.handle}_${Date.now()}.jpg`;
                    const { data, error } = await _supabase.storage.from('avatars').upload(filename, blob, { upsert: true, contentType: 'image/jpeg' });
                    if (error) { showToast('Error uploading profile picture: ' + error.message); return; }
                    if (data) picPath = `avatars/${filename}`;
                } catch (err) { showToast('Error uploading profile picture: ' + err.message); return; }
            } else if (_pfpChanged && pfpBase64) {
                // gallery avatar, not a crop upload
                picPath = pfpBase64;
            }

            if (bannerBase64 && bannerBase64.startsWith('data:image')) {
                try {
                    const res = await fetch(bannerBase64); const blob = await res.blob();
                    const filename = `banner_${myProfile.handle}_${Date.now()}.jpg`;
                    const { data, error } = await _supabase.storage.from('avatars').upload(filename, blob, { upsert: true, contentType: 'image/jpeg' });
                    if (error) { showToast('Error uploading banner: ' + error.message); return; }
                    if (data) bannerPath = `avatars/${filename}`;
                } catch (err) { showToast('Error uploading banner: ' + err.message); return; }
            }

            const socials = {};
            SOCIAL_CONFIG.forEach(s => { const val = document.getElementById(`social-${s.key}`).value.trim(); if (val) socials[s.key] = val; });

            const selectedStatusEl = document.querySelector('.status-opt.selected');
            const newStatus = selectedStatusEl?.dataset.status || 'online';
            const msEnabled = document.getElementById('st-milestones-enabled').checked;
            const msMessage = document.getElementById('milestone-message-input').value.trim();
            // refetch from db, cache can be stale and shouldn't overwrite role
            const { data: freshRow } = await _supabase.from('profiles').select('settings').eq('handle', myProfile.handle).maybeSingle();
            const existingSettings = freshRow?.settings || myProfile.settings || {};
            const updatedSettings = {
                ...existingSettings,
                status: newStatus,
                show_followers:      document.getElementById('st-show-followers').checked,
                public_profile:      document.getElementById('st-public-profile').checked,
                show_status:         document.getElementById('st-show-status').checked,
                allow_squad_invites: document.getElementById('st-squad-invites').checked,
                allow_dms:           document.getElementById('st-allow-dms').checked,
                allow_comments:      document.getElementById('st-allow-comments').checked,
                show_discover:       document.getElementById('st-show-discover').checked,
                show_socials:        document.getElementById('st-show-socials').checked,
                show_grid:           document.getElementById('st-show-grid').checked,
                pinned_comics:       myProfile.settings?.pinned_comics || [],
                accent_color:        _settingsAccentColor,
                pronoun:             _settingsPronoun,
                milestones: { enabled: msEnabled, thresholds: _settingsMilestones, style: _settingsMilestoneStyle, message: msMessage || null },
                notif_new_follower:  document.getElementById('st-notif-followers').checked,
                notif_comments:      document.getElementById('st-notif-comments').checked,
                notif_likes:         document.getElementById('st-notif-likes').checked,
                notif_mentions:      document.getElementById('st-notif-mentions').checked,
                notif_squads:        document.getElementById('st-notif-squads').checked,
                notif_announcements: document.getElementById('st-notif-announcements').checked,
                notif_milestones:    document.getElementById('st-notif-milestones').checked,
                reduced_motion:      document.getElementById('st-reduced-motion').checked,
            };

            const updated = { ...myProfile, handle: myProfile.handle, name: document.getElementById('edit-name').value, bio: document.getElementById('edit-bio').value, pic: picPath, banner: bannerPath, socials, settings: updatedSettings };

            try { await _supabase.from('user_status').upsert({ handle: myProfile.handle, status: newStatus, updated_at: new Date().toISOString() }, { onConflict: 'handle' }); } catch(e) {}

            const { error } = await _supabase.from('profiles').upsert({ handle: myProfile.handle, name: updated.name, bio: updated.bio, pic: updated.pic, banner: updated.banner, socials: updated.socials, settings: updated.settings, permanent_id: myProfile.permanent_id || null }, { onConflict: 'handle' });

            if (!error) {
                markClean();
                _pfpChanged = false;
                ccSaveProfile(updated);
                showToast('Profile saved!');
                setTimeout(() => location.href = `profile.html?u=${myProfile.handle}`, 700);
            } else {
                showToast('Error: ' + error.message);
            }
        }

        // -- gallery avatars --
        const GALLERY_AVATARS = [
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/csf.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/fsfds.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/gegrg.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1806.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1807.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1809.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1810.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1811.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1812.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1813.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1814.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1815.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1816.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1817.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/IMG_1819.webp',
            'https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/public/comiccore-assets/pfps/rhge.webp',
        ];

        function randomAvatar() { return GALLERY_AVATARS[Math.floor(Math.random() * GALLERY_AVATARS.length)]; }

        let selectedGalleryUrl = null;

        function openPfpPicker() {
            selectedGalleryUrl = null;
            const grid = document.getElementById('pfp-gallery-grid');
            grid.innerHTML = GALLERY_AVATARS.map((url, i) => `<div class="pfp-gallery-item" id="gal-${i}" onclick="selectGalleryAvatar(${i}, '${url}')"><img src="${url}" loading="lazy"></div>`).join('');
            document.getElementById('pfp-gallery-confirm').classList.remove('visible');
            document.getElementById('pfp-source-overlay').classList.add('open');
        }
        function closePfpPicker() { document.getElementById('pfp-source-overlay').classList.remove('open'); selectedGalleryUrl = null; }
        function selectGalleryAvatar(idx, url) { document.querySelectorAll('.pfp-gallery-item').forEach(el => el.classList.remove('selected')); document.getElementById('gal-' + idx).classList.add('selected'); selectedGalleryUrl = url; document.getElementById('pfp-gallery-confirm').classList.add('visible'); }
        function confirmGalleryPfp() { if (!selectedGalleryUrl) return; pfpBase64 = selectedGalleryUrl; _pfpChanged = true; document.getElementById('pfp-preview').src = getImageUrl(pfpBase64); markDirty(); closePfpPicker(); }

        document.getElementById('pfp-input').onchange = (e) => {
            if (!e.target.files[0]) return;
            const file = e.target.files[0];
            document.getElementById('pfp-preview').src = URL.createObjectURL(file);
            const reader = new FileReader();
            reader.onload = (ev) => openPfpCrop(ev.target.result);
            reader.readAsDataURL(file);
            e.target.value = '';
        };

        // -- pfp crop --
        let pfpCropSrc = null, pfpCropOffsetX = 0, pfpCropOffsetY = 0, pfpCropScale = 1, pfpCropDrag = null, pfpImgNatW = 1, pfpImgNatH = 1;
        const PFP_SIZE = 240;

        function openPfpCrop(src) {
            pfpCropSrc = src; pfpCropOffsetX = 0; pfpCropOffsetY = 0; pfpCropScale = 1;
            document.getElementById('pfp-crop-zoom').value = 1;
            const img = document.getElementById('pfp-crop-img');
            img.crossOrigin = 'anonymous';
            img.onerror = () => { showToast('Could not load image for cropping'); closePfpCrop(); };
            img.src = formatImageUrl(src);
            img.onload = () => { pfpImgNatW = img.naturalWidth; pfpImgNatH = img.naturalHeight; updatePfpCropImg(); };
            document.getElementById('pfp-crop-overlay').classList.add('active');
        }
        function closePfpCrop() { document.getElementById('pfp-crop-overlay').classList.remove('active'); }
        function updatePfpCropImg() {
            const img = document.getElementById('pfp-crop-img');
            const baseScale = Math.max(PFP_SIZE / pfpImgNatW, PFP_SIZE / pfpImgNatH);
            const scale = baseScale * pfpCropScale;
            const w = pfpImgNatW * scale, h = pfpImgNatH * scale;
            const maxX = (w - PFP_SIZE) / 2, maxY = (h - PFP_SIZE) / 2;
            pfpCropOffsetX = Math.max(-maxX, Math.min(maxX, pfpCropOffsetX));
            pfpCropOffsetY = Math.max(-maxY, Math.min(maxY, pfpCropOffsetY));
            img.style.width = w + 'px'; img.style.height = h + 'px';
            img.style.left = (PFP_SIZE/2 - w/2 + pfpCropOffsetX) + 'px';
            img.style.top  = (PFP_SIZE/2 - h/2 + pfpCropOffsetY) + 'px';
        }
        function pfpCropZoom(val) { pfpCropScale = parseFloat(val); updatePfpCropImg(); }

        const pfpWrap = document.getElementById('pfp-crop-wrap');
        pfpWrap.addEventListener('mousedown', e => { pfpCropDrag = { x: e.clientX, y: e.clientY, ox: pfpCropOffsetX, oy: pfpCropOffsetY }; });
        window.addEventListener('mousemove', e => { if (!pfpCropDrag) return; pfpCropOffsetX = pfpCropDrag.ox + (e.clientX - pfpCropDrag.x); pfpCropOffsetY = pfpCropDrag.oy + (e.clientY - pfpCropDrag.y); updatePfpCropImg(); });
        window.addEventListener('mouseup', () => pfpCropDrag = null);
        pfpWrap.addEventListener('touchstart', e => { const t = e.touches[0]; pfpCropDrag = { x: t.clientX, y: t.clientY, ox: pfpCropOffsetX, oy: pfpCropOffsetY }; }, {passive:true});
        window.addEventListener('touchmove', e => { if (!pfpCropDrag) return; const t = e.touches[0]; pfpCropOffsetX = pfpCropDrag.ox + (t.clientX - pfpCropDrag.x); pfpCropOffsetY = pfpCropDrag.oy + (t.clientY - pfpCropDrag.y); updatePfpCropImg(); }, {passive:true});
        window.addEventListener('touchend', () => pfpCropDrag = null);

        function confirmPfpCrop() {
            const img = document.getElementById('pfp-crop-img');
            const baseScale = Math.max(PFP_SIZE / pfpImgNatW, PFP_SIZE / pfpImgNatH);
            const scale = baseScale * pfpCropScale;
            const w = pfpImgNatW * scale, h = pfpImgNatH * scale;
            const left = PFP_SIZE/2 - w/2 + pfpCropOffsetX, top = PFP_SIZE/2 - h/2 + pfpCropOffsetY;
            const sx = (-left) / scale, sy = (-top) / scale, sSize = PFP_SIZE / scale;
            try {
                const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
                canvas.getContext('2d').drawImage(img, sx, sy, sSize, sSize, 0, 0, 400, 400);
                pfpBase64 = canvas.toDataURL('image/jpeg', 0.9);
                _pfpChanged = true;
                document.getElementById('pfp-preview').src = getImageUrl(pfpBase64);
                markDirty();
            } catch (err) {
                showToast('Could not crop this image (cross-origin restriction)');
            } finally {
                closePfpCrop();
            }
        }

        document.getElementById('banner-input').onchange = (e) => {
            if (!e.target.files[0]) return;
            const file = e.target.files[0];
            const localPreviewUrl = URL.createObjectURL(file);
            document.getElementById('banner-preview').src = localPreviewUrl;
            document.getElementById('banner-preview').style.display = 'block';
            const reader = new FileReader();
            reader.onload = (ev) => openCropModal(ev.target.result);
            reader.readAsDataURL(file);
            e.target.value = '';
        };

        // -- banner crop --
        let cropImgNaturalW = 0, cropImgNaturalH = 0, cropOffsetX = 0, cropOffsetY = 0, cropScale = 1, cropDragStart = null;
        const BANNER_RATIO = 16 / 6;

        function openCropModal(src) {
            const overlay = document.getElementById('crop-overlay'), img = document.getElementById('crop-source');
            overlay.classList.add('active');
            img.crossOrigin = 'anonymous';
            img.onerror = () => { showToast('Could not load image for cropping'); closeCropModal(); };
            img.src = formatImageUrl(src);
            img.onload = () => { cropImgNaturalW = img.naturalWidth; cropImgNaturalH = img.naturalHeight; cropOffsetX = 0; cropOffsetY = 0; cropScale = 1; updateCropFrame(); };
        }
        function closeCropModal() { document.getElementById('crop-overlay').classList.remove('active'); document.getElementById('crop-frame').style.display = 'none'; }
        function updateCropFrame() {
            const container = document.getElementById('crop-container'), img = document.getElementById('crop-source'), frame = document.getElementById('crop-frame');
            const cW = container.offsetWidth, cH = img.offsetHeight;
            const frameW = cW, frameH = frameW / BANNER_RATIO;
            const top = Math.max(0, Math.min(cH - frameH, (cH - frameH) / 2 + cropOffsetY));
            frame.style.left = '0px'; frame.style.top = top + 'px'; frame.style.width = frameW + 'px'; frame.style.height = frameH + 'px'; frame.style.display = 'block';
            frame._top = top; frame._frameH = frameH;
        }

        const cropContainer = document.getElementById('crop-container');
        cropContainer.addEventListener('mousedown', e => { cropDragStart = { y: e.clientY, off: cropOffsetY }; });
        window.addEventListener('mousemove', e => { if (!cropDragStart) return; cropOffsetY = cropDragStart.off + (e.clientY - cropDragStart.y); updateCropFrame(); });
        window.addEventListener('mouseup', () => cropDragStart = null);
        cropContainer.addEventListener('touchstart', e => { cropDragStart = { y: e.touches[0].clientY, off: cropOffsetY }; }, {passive:true});
        window.addEventListener('touchmove', e => { if (!cropDragStart) return; cropOffsetY = cropDragStart.off + (e.touches[0].clientY - cropDragStart.y); updateCropFrame(); }, {passive:true});
        window.addEventListener('touchend', () => cropDragStart = null);

        function confirmCrop() {
            const img = document.getElementById('crop-source'), frame = document.getElementById('crop-frame'), container = document.getElementById('crop-container');
            const displayW = container.offsetWidth, displayH = img.offsetHeight;
            const scaleX = cropImgNaturalW / displayW, scaleY = cropImgNaturalH / displayH;
            const sy = Math.max(0, frame._top * scaleY), sw = cropImgNaturalW, sh = Math.min(frame._frameH * scaleY, cropImgNaturalH - sy);
            try {
                const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = Math.round(1200 / BANNER_RATIO);
                canvas.getContext('2d').drawImage(img, 0, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                bannerBase64 = canvas.toDataURL('image/jpeg', 0.85);
                const prev = document.getElementById('banner-preview'); prev.src = getImageUrl(bannerBase64); prev.style.display = 'block';
                markDirty();
            } catch (err) {
                showToast('Could not crop this image (cross-origin restriction)');
            } finally {
                closeCropModal();
            }
        }

        function closeEditor() {
            markClean();
            document.getElementById('crop-overlay').classList.remove('active');
            document.getElementById('pfp-crop-overlay').classList.remove('active');
            document.getElementById('pfp-source-overlay').classList.remove('open');
            if (currentViewedHandle) loadPublicProfile(currentViewedHandle);
            else location.href = 'discover.html';
        }

        function hexToRgb(hex) {
            const clean = hex.replace('#', '');
            const r = parseInt(clean.slice(0,2), 16);
            const g = parseInt(clean.slice(2,4), 16);
            const b = parseInt(clean.slice(4,6), 16);
            return `${r},${g},${b}`;
        }
        // hue-rotate the loading gif to match accent color (mirrors discover.html)
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
            const preview = document.getElementById('menu-accent-preview');
            if (preview) preview.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};vertical-align:-2px;"></span>`;

            // recolor loading gif dots to accent color
            const loaderImg = document.getElementById('loading-gif');
            if (loaderImg) {
                const shift = hexToHue(color) - LOADING_GIF_BASE_HUE;
                loaderImg.style.filter = `hue-rotate(${shift}deg)`;
            }
        }

        function switchSettingsPage(pageName) {
            document.getElementById('settings-menu').classList.remove('active');
            document.querySelectorAll('.settings-page').forEach(page => page.classList.remove('active'));
            const page = document.getElementById(`page-${pageName}`);
            if (page) page.classList.add('active');
            const titleMap = { 'profile': 'Profile', 'connections': 'Connections', 'privacy': 'Privacy & Data', 'account': 'Account', 'profile-display': 'Profile Display', 'accent-pronouns': 'Accent & Pronouns', 'notifications': 'Notifications', 'milestones': 'Milestones' };
            const titleEl = document.getElementById('settings-page-title');
            if (titleEl) titleEl.textContent = titleMap[pageName] || 'Settings';
            document.getElementById('settings-back-btn').classList.add('show');
            document.querySelector('.settings-content-scroll').scrollTop = 0;
        }

        function backToSettingsMenu() {
            document.querySelectorAll('.settings-page').forEach(page => page.classList.remove('active'));
            document.getElementById('settings-menu').classList.add('active');
            document.getElementById('settings-page-title').textContent = 'Settings';
            document.getElementById('settings-back-btn').classList.remove('show');
            document.querySelector('.settings-content-scroll').scrollTop = 0;
        }

        function updateOgTags({ title, description, image, url }) {
            const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el && val) el.setAttribute(attr, val); };
            set('meta[property="og:title"]', 'content', title); set('meta[property="og:description"]', 'content', description);
            set('meta[property="og:image"]', 'content', image); set('meta[property="og:url"]', 'content', url);
            set('meta[name="twitter:title"]', 'content', title); set('meta[name="twitter:description"]', 'content', description);
            set('meta[name="twitter:image"]', 'content', image); document.title = title;
        }

        function openShareModal() {
            const handle = currentViewedHandle; if (!handle) return;
            const name = document.getElementById('view-name').innerText;
            const bio = document.getElementById('view-bio').innerText;
            const pfpSrc = document.getElementById('view-pfp').src;
            const bannerSrc = document.getElementById('view-banner').src;
            const hasBanner = document.getElementById('view-banner').style.display !== 'none' && bannerSrc;
            document.getElementById('share-card-name').innerText = name;
            document.getElementById('share-card-handle').innerText = '@' + handle;
            document.getElementById('share-card-bio').innerText = (bio && bio !== '...') ? bio : '';
            document.getElementById('share-card-pfp').src = pfpSrc;
            document.getElementById('share-card-followers').innerText = document.getElementById('count-followers').innerText;
            document.getElementById('share-card-following').innerText = document.getElementById('count-following').innerText;
            const cardBanner = document.getElementById('share-card-banner'), fallback = document.getElementById('share-card-banner-fallback');
            if (hasBanner) { cardBanner.src = bannerSrc; cardBanner.style.display = 'block'; fallback.style.display = 'none'; }
            else { cardBanner.style.display = 'none'; fallback.style.display = 'block'; }
            if (navigator.share) document.getElementById('native-share-btn').style.display = 'block';
            document.getElementById('share-overlay').classList.add('open');
        }
        function closeShareModal() { document.getElementById('share-overlay').classList.remove('open'); }
        function getProfileUrl() { return `https://zaz444.github.io/comiccore/profile.html?u=${currentViewedHandle}`; }
        async function copyProfileLink() {
            const url = getProfileUrl();
            try { await navigator.clipboard.writeText(url); const btn = event.currentTarget; const orig = btn.innerHTML; btn.innerHTML = '<span>✓</span>Copied!'; btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; setTimeout(() => { btn.innerHTML = orig; btn.style.borderColor = ''; btn.style.color = ''; }, 2000); }
            catch { prompt('Copy this link:', url); }
        }
        async function nativeShare() { try { await navigator.share({ title: document.getElementById('share-card-name').innerText + ' on ComicCluck', text: document.getElementById('share-card-bio').innerText || 'Check out this profile on ComicCluck!', url: getProfileUrl() }); } catch {} }


        // -- status system --
        const STATUS_META = {
            online:  { label: 'Online',         color: '#32d74b', cls: 'online' },
            afk:     { label: 'AFK',            color: '#ffcc00', cls: 'afk' },
            dnd:     { label: 'Do Not Disturb', color: '#ff3b30', cls: 'dnd' },
            offline: { label: 'Appear Offline', color: '#555',    cls: 'offline' },
        };

        function selectStatus(status) {
            document.querySelectorAll('.status-opt').forEach(opt => opt.classList.toggle('selected', opt.dataset.status === status));
            markDirty();
        }

        async function loadUserStatus(handle) {
            const { data } = await _supabase.from('profiles').select('settings').eq('handle', handle).maybeSingle();
            applyStatusToUI(data?.settings?.status || 'offline');
        }
        function applyStatusToUI(status) {
            const meta = STATUS_META[status] || STATUS_META.offline;
            const dot = document.getElementById('view-status-dot'); if (dot) dot.className = 'pfp-status-dot ' + meta.cls;
            const labelRow = document.getElementById('status-label-row'), labelDot = document.getElementById('view-status-label-dot'), labelText = document.getElementById('view-status-text');
            if (labelRow && status !== 'offline') { labelRow.style.display = 'flex'; if (labelDot) labelDot.className = 'status-label-dot ' + meta.cls; if (labelText) labelText.textContent = meta.label; }
            else if (labelRow) labelRow.style.display = 'none';
        }

        // -- milestones --
        const DEFAULT_MILESTONES = [100, 500, 1000, 5000, 10000, 50000];
        const MILESTONE_STYLES = [
            { id: 'fire', icon: '🔥', label: 'Fire' },
            { id: 'star', icon: '⭐', label: 'Star' },
            { id: 'gem',  icon: '💎', label: 'Gem' },
        ];

        async function openSettingsModal() { openEditor(); }
        function closeSettingsModal() {}
        async function saveSettings() { await saveProfile(); }

        function selectAccentColor(color, el) {
            _settingsAccentColor = color;
            document.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('selected'));
            el.classList.add('selected');
            applyAccentColor(color);
            markDirty();
        }

        function selectPronoun(val, el) {
            _settingsPronoun = val;
            document.querySelectorAll('.pronoun-chip').forEach(c => c.classList.remove('selected'));
            el.classList.add('selected');
            markDirty();
        }

        function toggleMilestoneCustomizer() {
            const on = document.getElementById('st-milestones-enabled').checked;
            document.getElementById('milestone-customizer').style.display = on ? 'block' : 'none';
        }

        function renderMilestoneCheckboxes() {
            const grid = document.getElementById('milestone-checkboxes'); grid.innerHTML = '';
            const isDefault = n => DEFAULT_MILESTONES.includes(n);
            _settingsMilestones.forEach(n => {
                const el = document.createElement('div'); el.className = 'milestone-check-item active' + (isDefault(n) ? '' : ' custom'); el.dataset.val = n;
                el.innerHTML = `${fmtNum(n)}<span class="rm-x" onclick="removeMilestone(${n},event)">✕</span>`;
                el.onclick = (e) => { if (e.target.classList.contains('rm-x')) return; toggleMilestone(n); }; grid.appendChild(el);
            });
            DEFAULT_MILESTONES.forEach(n => {
                if (_settingsMilestones.includes(n)) return;
                const el = document.createElement('div'); el.className = 'milestone-check-item'; el.dataset.val = n; el.innerText = fmtNum(n);
                el.onclick = () => { _settingsMilestones.push(n); _settingsMilestones.sort((a,b)=>a-b); renderMilestoneCheckboxes(); markDirty(); }; grid.appendChild(el);
            });
        }

        function toggleMilestone(n) { if (_settingsMilestones.includes(n)) _settingsMilestones = _settingsMilestones.filter(x => x !== n); else { _settingsMilestones.push(n); _settingsMilestones.sort((a,b)=>a-b); } renderMilestoneCheckboxes(); markDirty(); }
        function removeMilestone(n, e) { e.stopPropagation(); _settingsMilestones = _settingsMilestones.filter(x => x !== n); renderMilestoneCheckboxes(); markDirty(); }
        function addCustomMilestone() {
            const val = parseInt(document.getElementById('custom-milestone-input').value);
            if (!val || val < 1) { showToast('Enter a valid number'); return; }
            if (_settingsMilestones.includes(val)) { showToast('Already added'); return; }
            _settingsMilestones.push(val); _settingsMilestones.sort((a,b)=>a-b);
            document.getElementById('custom-milestone-input').value = '';
            renderMilestoneCheckboxes(); markDirty();
        }

        function renderMilestoneStylePicker() {
            const grid = document.getElementById('milestone-style-picker');
            grid.innerHTML = MILESTONE_STYLES.map(s => `<div class="milestone-style-opt ${_settingsMilestoneStyle === s.id ? 'selected' : ''}" onclick="selectMilestoneStyle('${s.id}')">${s.icon} ${s.label}</div>`).join('');
        }
        function selectMilestoneStyle(id) { _settingsMilestoneStyle = id; renderMilestoneStylePicker(); markDirty(); }
        function fmtNum(n) { if (n >= 1000000) return (n/1000000).toFixed(n%1000000===0?0:1)+'M'; if (n >= 1000) return (n/1000).toFixed(n%1000===0?0:1)+'K'; return n.toString(); }

        async function signOut() { await _supabase.auth.signOut(); localStorage.removeItem('user_profile'); location.href = 'index.html'; }

        async function renderMilestoneBanner(profile, handle) {
            const banner = document.getElementById('milestone-banner'); banner.style.display = 'none';
            const ms = profile.settings?.milestones; if (!ms?.enabled || !ms?.thresholds?.length) return;
            const { count: followers } = await _supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following', handle);
            if (!followers) return;
            const reached = ms.thresholds.filter(t => followers >= t); if (!reached.length) return;
            const top = Math.max(...reached);
            const style = ms.style || 'fire', styleInfo = MILESTONE_STYLES.find(s => s.id === style) || MILESTONE_STYLES[0];
            document.getElementById('milestone-banner-inner').innerHTML = `<div class="milestone-badge style-${style}"><div class="milestone-badge-icon">${styleInfo.icon}</div><div class="milestone-badge-text"><div class="milestone-badge-title">${fmtNum(top)} Followers Milestone!</div><div class="milestone-badge-sub">${ms.message || 'Thank you for the support 🙏'}</div></div></div>`;
            banner.style.display = 'block';
        }

        // -- toast --
        let _toastTimer = null;
        function showToast(msg) {
            let el = document.getElementById('cc-toast');
            if (!el) { el = document.createElement('div'); el.id = 'cc-toast'; el.className = 'cc-toast'; document.body.appendChild(el); }
            el.textContent = msg; el.classList.add('show');
            clearTimeout(_toastTimer); _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
        }

        window.addEventListener('load', () => {
            document.querySelectorAll('body > *').forEach(el => {
                const tag = el.tagName.toLowerCase(), cls = (el.className || '').toLowerCase(), id = (el.id || '').toLowerCase();
                if (tag === 'nav' || cls.includes('nav') || cls.includes('tab-bar') || id.includes('nav') || id.includes('bottom')) el.style.display = 'none';
            });
        });

        init();
