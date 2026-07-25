(function () {
  const globalConfig = window.BADMINTON_SUPABASE_CONFIG || {};
  const hasSupabaseLibrary = typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function';
  const projectKey = globalConfig.anonKey || '';
  const isConfigured = !!(globalConfig.url && projectKey && hasSupabaseLibrary);
  const PLAYER_SESSIONS_TABLE = 'player_sessions';
  const SESSION_PLAYERS_TABLE = 'players';
  const PLAYER_PROFILES_TABLE = 'player_profiles';
  const APP_CONFIG_TABLE = 'app_config';
  const DISPLAY_PLAYERS_VIEW = 'public_players_display';

  const PUBLIC_APP_CONFIG_VIEW = 'public_app_config';
  const PUBLIC_PLAYER_SESSIONS_VIEW = 'public_player_sessions';
  const PLAYER_ACCESS_FUNCTION = 'player-access';
  let client = null;
  const adminPresenceChannels = new Map();

  function getClient() {
    if (!isConfigured) return null;
    if (!client) {
      client = window.supabase.createClient(globalConfig.url, projectKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    }
    return client;
  }

  function isoNow() {
    return new Date().toISOString();
  }
  function toNullableInteger(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizePhone(value) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    return text || null;
  }

  function tableHasSessionId(tableName) {
    return tableName === SESSION_PLAYERS_TABLE;
  }

  function tableHasUpdatedBy(tableName) {
    return tableName === SESSION_PLAYERS_TABLE || tableName === PLAYER_SESSIONS_TABLE;
  }

  function levelBaseRating(level) {
    const parsedLevel = Number.isFinite(Number(level)) ? Number(level) : 4;
    return parsedLevel * 100;
  }

  function resolveRatingAccumulated(source, level) {
    if (Number.isFinite(Number(source?.ratingAccumulated))) return Number(source.ratingAccumulated);
    if (Number.isFinite(Number(source?.rating_accumulated))) return Number(source.rating_accumulated);
    return 0;
  }

  function cloneArray(value) {
    return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : [];
  }

  function isEmptyRemotePlayerRow(row) {
    if (!row || typeof row !== 'object') return true;
    return !row.id
      && !row.session_id
      && !row.name
      && !row.phone
      && row.gender == null
      && row.level == null
      && row.prefer == null
      && row.ready == null
      && row.rating == null
      && row.rating_accumulated == null
      && row.couple == null
      && row.unpair == null
      && row.unpair_main == null
      && row.partner_slot == null
      && row.created_at == null
      && row.updated_at == null;
  }

  function mapRemotePlayer(row) {
    if (!row || isEmptyRemotePlayerRow(row)) return null;
    const level = Number.isFinite(Number(row.level)) ? Number(row.level) : 4;
    const ratingAccumulated = resolveRatingAccumulated(row, level);
    return {
      id: row.id,
      sessionId: row.session_id || null,
      name: row.name || '',
      phone: row.phone || '',
      gender: row.gender || 'male',
      level,
      prefer: row.prefer || 'normal',
      ready: row.ready !== false,
      ratingAccumulated,
      rating: levelBaseRating(level),
      couple: toNullableInteger(row.couple),
      unpair: toNullableInteger(row.unpair),
      unpairMain: !!row.unpair_main,
      partnerSlot: row.partner_slot || null,
      sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : null,
      version: Number.isFinite(Number(row.version)) ? Number(row.version) : null,
      updatedBy: row.updated_by || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  function mapPlayerSessionRow(row) {
    const source = row || {};
    return {
      id: 'global',
      sessionId: source.id || source.session_id || null,
      activeSessionId: source.active_session_id || source.id || source.session_id || null,
      hostUserId: source.host_user_id || source.hostUserId || null,
      ownershipVersion: Number.isFinite(Number(source.ownership_version)) ? Number(source.ownership_version) : null,
      location: source.location || null,
      checkinEnabled: !!source.checkin_enabled,
      checkinOpenAt: source.checkin_open_at || null,
      checkinCloseAt: source.checkin_close_at || null,
      playAt: source.play_at || null,
      courtEnabledStates: cloneArray(source.court_enabled_states),
      layoutState: source.layout_state || null,
      version: Number.isFinite(Number(source.version)) ? Number(source.version) : null,
      updatedBy: source.updated_by || null,
      createdAt: source.created_at || null,
      updatedAt: source.updated_at || null
    };
  }

  function normalizeLookupAccessResponse(data) {
    const source = data || {};
    return {
      phase: source.phase || null,
      playStarted: source.playStarted === true || source.play_started === true,
      profile: mapRemotePlayer(source.profile || null),
      sessionPlayer: mapRemotePlayer(source.sessionPlayer || source.session_player || null),
      accessToken: typeof source.accessToken === 'string'
        ? source.accessToken
        : (typeof source.access_token === 'string' ? source.access_token : null)
    };
  }

  function toPlayerPayload(tableName, player, sessionId) {
    const level = Number.isFinite(Number(player.level)) ? Number(player.level) : 4;
    const ratingAccumulated = resolveRatingAccumulated(player, level);
    const rating = levelBaseRating(level);
    const payload = {
      id: player.id,
      name: player.name || '',
      phone: normalizePhone(player.phone),
      gender: player.gender || 'male',
      level,
      prefer: player.prefer || 'normal',
      ready: player.ready !== false,
      rating_accumulated: ratingAccumulated,
      rating,
      couple: player.couple === undefined ? null : player.couple,
      unpair: player.unpair === undefined ? null : player.unpair,
      unpair_main: !!player.unpairMain,
      partner_slot: player.partnerSlot || null,
      created_at: player.createdAt || isoNow(),
      updated_at: player.updatedAt || isoNow()
    };

    if (tableHasUpdatedBy(tableName)) {
      payload.updated_by = player.updatedBy || player.updated_by || null;
    }

    if (tableHasSessionId(tableName)) {
      payload.session_id = sessionId || player.sessionId || null;
      payload.sort_order = Number.isFinite(Number(player.sortOrder)) ? Number(player.sortOrder) : null;
    }

    return payload;
  }

  function defaultConfigRow() {
    return {
      id: 'global',
      session_id: null,
      active_session_id: null,
      location: null,
      checkin_enabled: false,
      checkin_open_at: null,
      checkin_close_at: null,
      play_at: null,
      court_enabled_states: null,
      layout_state: null,
      version: null,
      updated_by: null,
      created_at: null,
      updated_at: null
    };
  }

  function mapConfigRow(row) {
    const source = row || defaultConfigRow();
    const normalizeSessionId = value => {
      const normalized = String(value || '').trim();
      if (!normalized) return null;
      return normalized.toLowerCase() === 'global' ? null : normalized;
    };
    const sessionId = normalizeSessionId(source.session_id) || normalizeSessionId(source.id);
    const activeSessionId = normalizeSessionId(source.active_session_id) || sessionId;
    return {
      id: source.id || 'global',
      sessionId,
      activeSessionId,
      hostUserId: source.host_user_id || source.hostUserId || null,
      location: source.location || null,
      checkinEnabled: !!source.checkin_enabled,
      checkinOpenAt: source.checkin_open_at || null,
      checkinCloseAt: source.checkin_close_at || null,
      playAt: source.play_at || null,
      courtEnabledStates: cloneArray(source.court_enabled_states),
      layoutState: source.layout_state || null,
      version: Number.isFinite(Number(source.version)) ? Number(source.version) : null,
      updatedBy: source.updated_by || null,
      createdAt: source.created_at || null,
      updatedAt: source.updated_at || null
    };
  }

  async function fetchTablePlayers(tableName, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    let query = supabaseClient
      .from(tableName)
      .select('*');
    if (options.sessionId && tableHasSessionId(tableName)) query = query.eq('session_id', options.sessionId);
    const { data, error } = await query
      .order('created_at', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapRemotePlayer).filter(Boolean);
  }

  async function findTablePlayerByPhone(tableName, phone, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;
    let query = supabaseClient
      .from(tableName)
      .select('*')
      .eq('phone', normalizedPhone);
    if (options.sessionId && tableHasSessionId(tableName)) query = query.eq('session_id', options.sessionId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return mapRemotePlayer(data);
  }

  async function upsertTablePlayers(tableName, players, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    const payload = (players || []).map(player => toPlayerPayload(tableName, player, options.sessionId));
    if (!payload.length) return [];
    const { error } = await supabaseClient.from(tableName).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    return payload;
  }

  async function upsertTablePlayer(tableName, player, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const payload = toPlayerPayload(tableName, player, options.sessionId);
    const { data, error } = await supabaseClient
      .from(tableName)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapRemotePlayer(data);
  }

  async function fetchPlayerSession(sessionId) {
    const supabaseClient = getClient();
    if (!supabaseClient || !sessionId) return mapConfigRow(null);
    const { data, error } = await supabaseClient
      .from(PLAYER_SESSIONS_TABLE)
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return mapPlayerSessionRow(data);
  }

  async function fetchPlayerSessions() {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from(PLAYER_SESSIONS_TABLE)
      .select('*')
      .order('checkin_open_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPlayerSessionRow).filter(session => !!session.sessionId);
  }

  async function fetchSelectablePlayerSessions() {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    const source = PUBLIC_PLAYER_SESSIONS_VIEW;
    const { data, error } = await supabaseClient
      .from(source)
      .select('*')
      .order('checkin_open_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPlayerSessionRow).filter(session => !!session.sessionId && session.checkinEnabled);
  }

  async function fetchPlayers(sessionId) {
    if (!sessionId) return [];
    return fetchTablePlayers(SESSION_PLAYERS_TABLE, { sessionId });
  }

  async function fetchDisplayPlayers(sessionId) {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    if (sessionId) {
      const { data, error } = await supabaseClient.rpc('display_players_public_by_session', {
        p_session_id: sessionId
      });
      if (error) throw error;
      return (data || []).map(mapRemotePlayer).filter(Boolean);
    }
    const { data, error } = await supabaseClient
      .from(DISPLAY_PLAYERS_VIEW)
      .select('*')
      .order('created_at', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapRemotePlayer).filter(Boolean);
  }

  async function findPlayerByPhone(phone, sessionId) {
    return findTablePlayerByPhone(SESSION_PLAYERS_TABLE, phone, { sessionId });
  }

  async function upsertPlayers(players, sessionId) {
    return upsertTablePlayers(SESSION_PLAYERS_TABLE, players, { sessionId });
  }

  async function upsertPlayer(player, sessionId) {
    return upsertTablePlayer(SESSION_PLAYERS_TABLE, player, { sessionId });
  }

  async function fetchPlayerProfiles() {
    return fetchTablePlayers(PLAYER_PROFILES_TABLE);
  }

  async function findPlayerProfileByPhone(phone) {
    return findTablePlayerByPhone(PLAYER_PROFILES_TABLE, phone);
  }

  async function findSessionPlayerByPhone(phone, sessionId) {
    return findTablePlayerByPhone(SESSION_PLAYERS_TABLE, phone, { sessionId });
  }

  async function upsertPlayerProfiles(players) {
    return upsertTablePlayers(PLAYER_PROFILES_TABLE, players);
  }

  function buildProfileSyncUpdate(profilePlayer, sessionPlayer) {
    const profileLevel = Number.isFinite(Number(profilePlayer?.level))
      ? Number(profilePlayer.level)
      : (Number.isFinite(Number(sessionPlayer?.level)) ? Number(sessionPlayer.level) : 4);
    const profileAccumulated = resolveRatingAccumulated(profilePlayer, profileLevel);
    const sessionAccumulated = resolveRatingAccumulated(sessionPlayer, sessionPlayer?.level || profileLevel);
    const sessionDelta = sessionAccumulated - profileAccumulated;
    const profileDelta = Math.round(sessionDelta / 10);
    const nextRatingAccumulated = profileAccumulated + profileDelta;
    const nextRating = levelBaseRating(profileLevel);
    const nowIso = isoNow();

    return {
      ...(profilePlayer || sessionPlayer || {}),
      id: profilePlayer?.id || sessionPlayer?.id,
      sessionId: profilePlayer?.sessionId || null,
      name: profilePlayer?.name || sessionPlayer?.name || '',
      phone: profilePlayer?.phone || sessionPlayer?.phone || '',
      gender: profilePlayer?.gender || sessionPlayer?.gender || 'male',
      prefer: profilePlayer?.prefer || sessionPlayer?.prefer || 'normal',
      ready: profilePlayer?.ready !== false,
      level: profileLevel,
      ratingAccumulated: nextRatingAccumulated,
      rating: nextRating,
      couple: profilePlayer?.couple ?? sessionPlayer?.couple ?? null,
      unpair: profilePlayer?.unpair ?? sessionPlayer?.unpair ?? null,
      unpairMain: profilePlayer?.unpairMain ?? sessionPlayer?.unpairMain ?? false,
      partnerSlot: profilePlayer?.partnerSlot ?? sessionPlayer?.partnerSlot ?? null,
      createdAt: profilePlayer?.createdAt || sessionPlayer?.createdAt || nowIso,
      updatedAt: nowIso
    };
  }

  async function syncPlayerProfilesFromSessionPlayers(sessionIds) {
    const normalizedSessionIds = Array.isArray(sessionIds)
      ? sessionIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (!getClient() || !normalizedSessionIds.length) return 0;

    const existingProfiles = await fetchPlayerProfiles();
    const profileById = new Map(existingProfiles.map(player => [player.id, player]));
    const profileByPhone = new Map(
      existingProfiles
        .filter(player => normalizePhone(player.phone))
        .map(player => [normalizePhone(player.phone), player])
    );
    const profileUpdates = [];

    for (const sessionId of normalizedSessionIds) {
      const sessionPlayers = await fetchTablePlayers(SESSION_PLAYERS_TABLE, { sessionId });
      sessionPlayers.forEach(sessionPlayer => {
        const normalizedPhone = normalizePhone(sessionPlayer?.phone);
        if (!normalizedPhone) return;

        const profilePlayer = profileById.get(sessionPlayer.id) || profileByPhone.get(normalizedPhone) || null;
        if (!profilePlayer) return;

        const nextProfile = buildProfileSyncUpdate(profilePlayer, sessionPlayer);
        profileUpdates.push(nextProfile);
        profileById.set(nextProfile.id, nextProfile);
        profileByPhone.set(normalizedPhone, nextProfile);
      });
    }

    if (!profileUpdates.length) return 0;
    await upsertPlayerProfiles(profileUpdates);
    return profileUpdates.length;
  }

  async function upsertPlayerProfile(player) {
    return upsertTablePlayer(PLAYER_PROFILES_TABLE, player);
  }

  async function clearPlayers(sessionId) {
    const supabaseClient = getClient();
    if (!supabaseClient || !sessionId) return;
    const { error } = await supabaseClient
      .from(SESSION_PLAYERS_TABLE)
      .delete()
      .eq('session_id', sessionId);
    if (error) throw error;
  }

  async function deletePlayerSession(sessionId) {
    const supabaseClient = getClient();
    if (!supabaseClient || !sessionId) return;
    const { error } = await supabaseClient
      .from(PLAYER_SESSIONS_TABLE)
      .delete()
      .eq('id', sessionId);
    if (error) throw error;
  }

  async function deletePlayer(id) {
    const supabaseClient = getClient();
    if (!supabaseClient || !id) return;
    const { error } = await supabaseClient.from(SESSION_PLAYERS_TABLE).delete().eq('id', id);
    if (error) throw error;
  }

  async function fetchAppConfig(sessionId) {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapConfigRow(null);
    if (sessionId) {
      const { data, error } = await supabaseClient
        .from(PLAYER_SESSIONS_TABLE)
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();
      if (error) throw error;
      return mapConfigRow(data ? {
        ...data,
        id: 'global',
        session_id: data.id || data.session_id || sessionId,
        active_session_id: data.id || data.active_session_id || data.session_id || sessionId
      } : null);
    }
    const { data, error } = await supabaseClient
      .from(PUBLIC_APP_CONFIG_VIEW)
      .select('*')
      .eq('id', 'global')
      .maybeSingle();
    if (error) throw error;
    return mapConfigRow(data);
  }

  async function fetchAuthenticatedUser() {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) throw error;
    const user = data && data.user ? data.user : null;
    if (!user || !user.id) return null;
    return {
      id: user.id,
      email: user.email || null
    };
  }

  async function fetchAuthSession() {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    const session = data && data.session ? data.session : null;
    if (!session) return null;
    return {
      accessToken: session.access_token || null,
      expiresAt: Number.isFinite(Number(session.expires_at)) ? Number(session.expires_at) : null,
      user: session.user ? {
        id: session.user.id || null,
        email: session.user.email || null
      } : null
    };
  }

  async function signInAdminWithPassword(email, password) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error('Supabase client is not configured.');
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) throw new Error('Email is required.');
    if (!password) throw new Error('Password is required.');

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });
    if (error) throw error;
    return {
      user: data && data.user ? {
        id: data.user.id || null,
        email: data.user.email || null
      } : null,
      session: data && data.session ? {
        expiresAt: Number.isFinite(Number(data.session.expires_at)) ? Number(data.session.expires_at) : null
      } : null
    };
  }

  async function signOutAdminSession() {
    const supabaseClient = getClient();
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  }

  function subscribeToAuthStateChange(callback) {
    const supabaseClient = getClient();
    if (!supabaseClient || typeof callback !== 'function') return function () {};
    const subscription = supabaseClient.auth.onAuthStateChange((event, session) => {
      const expiresAtRaw = session ? Number(session.expires_at) : NaN;
      const expiresAt = Number.isFinite(expiresAtRaw) ? expiresAtRaw : null;
      callback(event, {
        expiresAt,
        user: session && session.user ? {
          id: session.user.id || null,
          email: session.user.email || null
        } : null
      });
    });
    return function () {
      try {
        const sub = subscription && subscription.data ? subscription.data.subscription : null;
        if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
      } catch (error) {}
    };
  }

  function toPlayerSessionPayload(config, sessionId) {
    return {
      id: sessionId || config.sessionId,
      location: config.location || null,
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
      updated_by: config.updatedBy || null,
      created_at: config.createdAt || isoNow(),
      updated_at: config.updatedAt || isoNow()
    };
  }

  async function createPlayerSession(config) {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapPlayerSessionRow({
      id: config.sessionId,
      location: config.location || null,
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
      version: Number.isFinite(Number(config.version)) ? Number(config.version) : 0,
      updated_by: config.updatedBy || null,
      created_at: config.createdAt || isoNow(),
      updated_at: config.updatedAt || isoNow()
    });
    const payload = toPlayerSessionPayload(config, config.sessionId);
    const { data, error } = await supabaseClient
      .from(PLAYER_SESSIONS_TABLE)
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return mapPlayerSessionRow(data);
  }

  async function updatePlayerSession(config) {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapPlayerSessionRow({
      id: config.sessionId,
      location: config.location || null,
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
      version: Number.isFinite(Number(config.version)) ? Number(config.version) : 0,
      updated_by: config.updatedBy || null,
      created_at: config.createdAt || isoNow(),
      updated_at: config.updatedAt || isoNow()
    });
    const payload = toPlayerSessionPayload(config, config.sessionId);
    const { data, error } = await supabaseClient
      .from(PLAYER_SESSIONS_TABLE)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapPlayerSessionRow(data);
  }

  async function setActivePlayerSession(sessionId) {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapConfigRow({ id: 'global', session_id: sessionId, active_session_id: sessionId, updated_at: isoNow() });
    const { data, error } = await supabaseClient.rpc('set_active_player_session', {
      p_session_id: sessionId || null
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') {
      throw new Error('set_active_player_session returned invalid payload.');
    }
    return mapConfigRow(data);
  }

  async function commitMatchResult(payload, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error('Supabase client is not configured.');
    const rpcPayload = {
      p_payload: payload || {},
      p_test_fault_step: options && typeof options.testFaultStep === 'string'
        ? options.testFaultStep
        : null
    };
    const { data, error } = await supabaseClient.rpc('commit_match_result', rpcPayload);
    if (error) throw error;
    return data || null;
  }

  async function transferSessionHost(sessionId, targetAdmin) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error('Supabase client is not configured.');
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedTarget = String(targetAdmin || '').trim();
    if (!normalizedSessionId) throw new Error('Session id is required.');
    if (!normalizedTarget) throw new Error('Target admin is required.');

    const { data, error } = await supabaseClient.rpc('transfer_player_session_host', {
      p_session_id: normalizedSessionId,
      p_target_admin: normalizedTarget
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') {
      throw new Error('transfer_player_session_host returned invalid payload.');
    }
    return mapPlayerSessionRow(data);
  }

  async function fetchPrivateAdminRegistry() {
    const response = await fetch('/admin-auth/registry', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Registry request failed (${response.status}).`);
    }
    const payload = await response.json().catch(() => ({}));
    const records = Array.isArray(payload?.admins) ? payload.admins : [];
    return records.map(record => ({
      username: String(record?.username || '').trim().toLowerCase(),
      displayName: String(record?.displayName || '').trim(),
      userId: String(record?.supabaseUserId || '').trim().toLowerCase()
    })).filter(record => record.username && record.userId);
  }

  function toErrorMessage(error, fallbackMessage) {
    if (!error) return fallbackMessage || 'Unknown error';
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string' && error.message) return error.message;
    if (typeof error.error === 'string' && error.error) return error.error;
    if (typeof error.details === 'string' && error.details) return error.details;
    return fallbackMessage || 'Unknown error';
  }

  async function parseFunctionInvokeError(error) {
    const defaultMessage = toErrorMessage(error, 'Cannot reach secure player endpoint.');
    const context = error && typeof error === 'object' ? error.context : null;
    if (!context || typeof context.clone !== 'function') return defaultMessage;
    const statusCode = Number.isFinite(Number(context.status)) ? Number(context.status) : null;

    try {
      const response = context.clone();
      const payload = await response.json().catch(() => null);
      if (payload && typeof payload === 'object') {
        const nestedMessage = toErrorMessage(payload, '');
        if (nestedMessage) return nestedMessage;
      }

      const text = await response.text().catch(() => '');
      if (typeof text === 'string' && text.trim()) return text.trim();
    } catch (parseError) {
    }

    if (statusCode === 404) {
      return `Secure player endpoint not found (404). Please deploy Supabase function "${PLAYER_ACCESS_FUNCTION}".`;
    }
    if (statusCode === 401 || statusCode === 403) {
      return 'Secure player endpoint rejected access. Check Supabase key/project config.';
    }

    return defaultMessage;
  }

  async function invokePlayerAccess(action, payload) {
    const supabaseClient = getClient();
    if (!supabaseClient) throw new Error('Supabase client is not configured.');
    const { data, error } = await supabaseClient.functions.invoke(PLAYER_ACCESS_FUNCTION, {
      body: {
        action,
        ...(payload || {})
      }
    });
    if (error) throw new Error(await parseFunctionInvokeError(error));
    if (data && data.error) throw new Error(toErrorMessage(data, 'Secure player endpoint failed.'));
    return data || {};
  }

  async function lookupPlayerAccess(phone, sessionId) {
    const supabaseClient = getClient();
    const normalizedPhone = normalizePhone(phone);
    if (!supabaseClient || !normalizedPhone) {
      return invokePlayerAccess('lookup', { phone, sessionId });
    }

    try {
      const rpcName = sessionId ? 'lookup_player_public_by_session' : 'lookup_player_public';
      const rpcPayload = sessionId
        ? { p_phone: normalizedPhone, p_session_id: sessionId }
        : { p_phone: normalizedPhone };
      const { data, error } = await supabaseClient.rpc(rpcName, rpcPayload);
      if (error) throw error;
      return normalizeLookupAccessResponse(data);
    } catch (error) {
      return invokePlayerAccess('lookup', { phone: normalizedPhone, sessionId });
    }
  }

  async function checkDuplicatePlayerName(name) {
    return invokePlayerAccess('check-name', { name });
  }

  async function registerPlayerAccess(player, sessionId) {
    return invokePlayerAccess('register', { player, sessionId });
  }

  async function savePlayerAccess(player, sessionId, accessToken = null) {
    return invokePlayerAccess('save', { player, sessionId, accessToken });
  }

  async function cancelPlayerAccess(payload) {
    return invokePlayerAccess('cancel', payload);
  }

  function subscribeToTable(tableName, callback, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return function () {};
    const subscriptionConfig = { event: options.event || '*', schema: 'public', table: tableName };
    if (options.filter) subscriptionConfig.filter = options.filter;
    const channel = supabaseClient
      .channel('badminton-' + tableName + '-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', subscriptionConfig, callback)
      .subscribe();
    return function () {
      supabaseClient.removeChannel(channel);
    };
  }

  function subscribeToPlayers(callback, sessionId) {
    if (!sessionId) return function () {};
    return subscribeToTable(SESSION_PLAYERS_TABLE, callback, { filter: `session_id=eq.${sessionId}` });
  }

  function subscribeToAppConfig(callback) {
    const unsubscribeAppConfig = subscribeToTable(APP_CONFIG_TABLE, callback);
    const unsubscribeSessions = subscribeToTable(PLAYER_SESSIONS_TABLE, callback);
    return function () {
      unsubscribeAppConfig();
      unsubscribeSessions();
    };
  }

  function subscribeToAdminPresence(sessionId, hostInfo, callback, options = {}) {
    const supabaseClient = getClient();
    const normalizedSessionId = String(sessionId || 'no-session');
    if (!supabaseClient || !sessionId) return function () {};

    const channel = supabaseClient.channel(`badminton-admin-presence-${normalizedSessionId}`, {
      config: { presence: { key: hostInfo?.clientId || Math.random().toString(36).slice(2, 10) } }
    });
    adminPresenceChannels.set(normalizedSessionId, channel);
    const emitState = () => {
      const state = channel.presenceState();
      const hosts = Object.values(state || {}).flat().map(entry => ({
        clientId: entry.clientId || null,
        name: entry.name || 'Unknown host',
        sessionId: entry.sessionId || normalizedSessionId,
        onlineAt: entry.onlineAt || null
      }));
      callback(hosts);
    };

    channel
      .on('presence', { event: 'sync' }, emitState)
      .on('presence', { event: 'join' }, emitState)
      .on('presence', { event: 'leave' }, emitState)
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return;
        channel.track({
          clientId: hostInfo?.clientId || null,
          name: hostInfo?.name || 'Unknown host',
          sessionId: normalizedSessionId,
          onlineAt: isoNow()
        });
      });

    return function () {
      try { channel.untrack(); } catch (error) {}
      if (adminPresenceChannels.get(normalizedSessionId) === channel) adminPresenceChannels.delete(normalizedSessionId);
      supabaseClient.removeChannel(channel);
    };
  }

  function getMissingConfigMessage() {
    if (!hasSupabaseLibrary) return 'Missing Supabase JS library.';
    if (!globalConfig.url || !projectKey) return 'Fill url plus anonKey in config.';
    return '';
  }

  window.BadmintonBackend = {
    isConfigured: isConfigured,
    getClient: getClient,
    getMissingConfigMessage: getMissingConfigMessage,
    fetchPlayerSession: fetchPlayerSession,
    fetchPlayerSessions: fetchPlayerSessions,
    fetchSelectablePlayerSessions: fetchSelectablePlayerSessions,
    createPlayerSession: createPlayerSession,
    updatePlayerSession: updatePlayerSession,
    setActivePlayerSession: setActivePlayerSession,
    commitMatchResult: commitMatchResult,
    transferSessionHost: transferSessionHost,
    fetchPlayers: fetchPlayers,
    fetchDisplayPlayers: fetchDisplayPlayers,
    findPlayerByPhone: findPlayerByPhone,
    fetchPlayerProfiles: fetchPlayerProfiles,
    findPlayerProfileByPhone: findPlayerProfileByPhone,
    findSessionPlayerByPhone: findSessionPlayerByPhone,
    upsertPlayers: upsertPlayers,
    upsertPlayer: upsertPlayer,
    upsertPlayerProfiles: upsertPlayerProfiles,
    syncPlayerProfilesFromSessionPlayers: syncPlayerProfilesFromSessionPlayers,
    upsertPlayerProfile: upsertPlayerProfile,
    clearPlayers: clearPlayers,
    deletePlayerSession: deletePlayerSession,
    deletePlayer: deletePlayer,
    fetchAppConfig: fetchAppConfig,
    fetchAuthenticatedUser: fetchAuthenticatedUser,
    fetchAuthSession: fetchAuthSession,
    signInAdminWithPassword: signInAdminWithPassword,
    signOutAdminSession: signOutAdminSession,
    fetchPrivateAdminRegistry: fetchPrivateAdminRegistry,
    subscribeToAuthStateChange: subscribeToAuthStateChange,
    subscribeToPlayers: subscribeToPlayers,
    subscribeToAppConfig: subscribeToAppConfig,
    subscribeToAdminPresence: subscribeToAdminPresence,
    lookupPlayerAccess: lookupPlayerAccess,
    checkDuplicatePlayerName: checkDuplicatePlayerName,
    registerPlayerAccess: registerPlayerAccess,
    savePlayerAccess: savePlayerAccess,
    cancelPlayerAccess: cancelPlayerAccess,
    mapRemotePlayer: mapRemotePlayer,
    mapConfigRow: mapConfigRow,
    mapPlayerSessionRow: mapPlayerSessionRow
  };
})();
