(function () {
  const globalConfig = window.BADMINTON_SUPABASE_CONFIG || {};
  const hasSupabaseLibrary = typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function';
  const hasServiceRoleKey = !!globalConfig.serviceRoleKey;
  const projectKey = globalConfig.serviceRoleKey || globalConfig.anonKey || '';
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

  function getClient() {
    if (!isConfigured) return null;
    if (!client) {
      client = window.supabase.createClient(globalConfig.url, projectKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
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
      && row.couple == null
      && row.unpair == null
      && row.unpair_main == null
      && row.partner_slot == null
      && row.created_at == null
      && row.updated_at == null;
  }

  function mapRemotePlayer(row) {
    if (!row || isEmptyRemotePlayerRow(row)) return null;
    return {
      id: row.id,
      sessionId: row.session_id || null,
      name: row.name || '',
      phone: row.phone || '',
      gender: row.gender || 'male',
      level: Number.isFinite(Number(row.level)) ? Number(row.level) : 4,
      prefer: row.prefer || 'normal',
      ready: row.ready !== false,
      rating: Number.isFinite(Number(row.rating)) ? Number(row.rating) : (Number(row.level) || 4) * 100,
      couple: toNullableInteger(row.couple),
      unpair: toNullableInteger(row.unpair),
      unpairMain: !!row.unpair_main,
      partnerSlot: row.partner_slot || null,
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
      checkinEnabled: !!source.checkin_enabled,
      checkinOpenAt: source.checkin_open_at || null,
      checkinCloseAt: source.checkin_close_at || null,
      playAt: source.play_at || null,
      courtEnabledStates: cloneArray(source.court_enabled_states),
      layoutState: source.layout_state || null,
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
      sessionPlayer: mapRemotePlayer(source.sessionPlayer || source.session_player || null)
    };
  }

  function toPlayerPayload(player, sessionId) {
    const level = Number.isFinite(Number(player.level)) ? Number(player.level) : 4;
    const rating = Number.isFinite(Number(player.rating)) ? Number(player.rating) : level * 100;
    return {
      id: player.id,
      session_id: sessionId || player.sessionId || null,
      name: player.name || '',
      phone: normalizePhone(player.phone),
      gender: player.gender || 'male',
      level,
      prefer: player.prefer || 'normal',
      ready: player.ready !== false,
      rating,
      couple: player.couple === undefined ? null : player.couple,
      unpair: player.unpair === undefined ? null : player.unpair,
      unpair_main: !!player.unpairMain,
      partner_slot: player.partnerSlot || null,
      created_at: player.createdAt || isoNow(),
      updated_at: player.updatedAt || isoNow()
    };
  }

  function defaultConfigRow() {
    return {
      id: 'global',
      session_id: null,
      active_session_id: null,
      checkin_enabled: false,
      checkin_open_at: null,
      checkin_close_at: null,
      play_at: null,
      court_enabled_states: null,
      layout_state: null,
      created_at: null,
      updated_at: null
    };
  }

  function mapConfigRow(row) {
    const source = row || defaultConfigRow();
    return {
      id: source.id || 'global',
      sessionId: source.session_id || null,
      activeSessionId: source.active_session_id || source.session_id || null,
      checkinEnabled: !!source.checkin_enabled,
      checkinOpenAt: source.checkin_open_at || null,
      checkinCloseAt: source.checkin_close_at || null,
      playAt: source.play_at || null,
      courtEnabledStates: cloneArray(source.court_enabled_states),
      layoutState: source.layout_state || null,
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
    if (options.sessionId) query = query.eq('session_id', options.sessionId);
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
    if (options.sessionId) query = query.eq('session_id', options.sessionId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return mapRemotePlayer(data);
  }

  async function upsertTablePlayers(tableName, players, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    const payload = (players || []).map(player => toPlayerPayload(player, options.sessionId));
    if (!payload.length) return [];
    const { error } = await supabaseClient.from(tableName).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    return payload;
  }

  async function upsertTablePlayer(tableName, player, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const payload = toPlayerPayload(player, options.sessionId);
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
    const source = hasServiceRoleKey ? PLAYER_SESSIONS_TABLE : PUBLIC_PLAYER_SESSIONS_VIEW;
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

  async function fetchDisplayPlayers() {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
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
      if (hasServiceRoleKey) return fetchPlayerSession(sessionId);
      const { data, error } = await supabaseClient
        .from(PUBLIC_PLAYER_SESSIONS_VIEW)
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (error) throw error;
      return mapConfigRow(data ? { ...data, id: 'global' } : null);
    }
    const { data, error } = await supabaseClient
      .from(PUBLIC_APP_CONFIG_VIEW)
      .select('*')
      .eq('id', 'global')
      .maybeSingle();
    if (error) throw error;
    return mapConfigRow(data);
  }

  function toPlayerSessionPayload(config, sessionId) {
    return {
      id: sessionId || config.sessionId,
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
      created_at: config.createdAt || isoNow(),
      updated_at: config.updatedAt || isoNow()
    };
  }

  async function createPlayerSession(config) {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapPlayerSessionRow({
      id: config.sessionId,
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
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
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
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
    const payload = {
      id: 'global',
      active_session_id: sessionId || null,
      updated_at: isoNow()
    };
    const { data, error } = await supabaseClient
      .from(APP_CONFIG_TABLE)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapConfigRow(data);
  }

  function toErrorMessage(error, fallbackMessage) {
    if (!error) return fallbackMessage || 'Unknown error';
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string' && error.message) return error.message;
    if (typeof error.error === 'string' && error.error) return error.error;
    if (typeof error.details === 'string' && error.details) return error.details;
    return fallbackMessage || 'Unknown error';
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
    if (error) throw new Error(toErrorMessage(error, 'Cannot reach secure player endpoint.'));
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

  async function savePlayerAccess(player, sessionId) {
    return invokePlayerAccess('save', { player, sessionId });
  }

  async function cancelPlayerAccess(payload) {
    return invokePlayerAccess('cancel', payload);
  }

  function subscribeToTable(tableName, callback, options = {}) {
    const supabaseClient = getClient();
    if (!supabaseClient) return function () {};
    const subscriptionConfig = { event: '*', schema: 'public', table: tableName };
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
    if (!hasServiceRoleKey) return function () {};
    const unsubscribeAppConfig = subscribeToTable(APP_CONFIG_TABLE, callback);
    const unsubscribeSessions = subscribeToTable(PLAYER_SESSIONS_TABLE, callback);
    return function () {
      unsubscribeAppConfig();
      unsubscribeSessions();
    };
  }

  function getMissingConfigMessage() {
    if (!hasSupabaseLibrary) return 'Missing Supabase JS library.';
    if (!globalConfig.url || !projectKey) return 'Fill url plus anonKey or serviceRoleKey in config.';
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
    fetchPlayers: fetchPlayers,
    fetchDisplayPlayers: fetchDisplayPlayers,
    findPlayerByPhone: findPlayerByPhone,
    fetchPlayerProfiles: fetchPlayerProfiles,
    findPlayerProfileByPhone: findPlayerProfileByPhone,
    findSessionPlayerByPhone: findSessionPlayerByPhone,
    upsertPlayers: upsertPlayers,
    upsertPlayer: upsertPlayer,
    upsertPlayerProfiles: upsertPlayerProfiles,
    upsertPlayerProfile: upsertPlayerProfile,
    clearPlayers: clearPlayers,
    deletePlayer: deletePlayer,
    fetchAppConfig: fetchAppConfig,
    subscribeToPlayers: subscribeToPlayers,
    subscribeToAppConfig: subscribeToAppConfig,
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
