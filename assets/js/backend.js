(function () {
  const globalConfig = window.BADMINTON_SUPABASE_CONFIG || {};
  const hasSupabaseLibrary = typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function';
  const hasServiceRoleKey = !!globalConfig.serviceRoleKey;
  const projectKey = globalConfig.serviceRoleKey || globalConfig.anonKey || '';
  const isConfigured = !!(globalConfig.url && projectKey && hasSupabaseLibrary);
  const SESSION_PLAYERS_TABLE = 'players';
  const PLAYER_PROFILES_TABLE = 'player_profiles';
  const DISPLAY_PLAYERS_VIEW = 'public_players_display';
  const PUBLIC_APP_CONFIG_VIEW = 'public_app_config';
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

  function normalizeLookupAccessResponse(data) {
    const source = data || {};
    return {
      phase: source.phase || null,
      playStarted: source.playStarted === true || source.play_started === true,
      profile: mapRemotePlayer(source.profile || null),
      sessionPlayer: mapRemotePlayer(source.sessionPlayer || source.session_player || null)
    };
  }

  function toPlayerPayload(player, index) {
    const level = Number.isFinite(Number(player.level)) ? Number(player.level) : 4;
    const rating = Number.isFinite(Number(player.rating)) ? Number(player.rating) : level * 100;
    return {
      id: player.id,
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
      updated_at: isoNow()
    };
  }

  function defaultConfigRow() {
    return {
      id: 'global',
      checkin_enabled: false,
      checkin_open_at: null,
      checkin_close_at: null,
      play_at: null,
      court_enabled_states: null,
      layout_state: null,
      updated_at: null
    };
  }

  function mapConfigRow(row) {
    const source = row || defaultConfigRow();
    return {
      id: source.id || 'global',
      checkinEnabled: !!source.checkin_enabled,
      checkinOpenAt: source.checkin_open_at || null,
      checkinCloseAt: source.checkin_close_at || null,
      playAt: source.play_at || null,
      courtEnabledStates: cloneArray(source.court_enabled_states),
      layoutState: source.layout_state || null,
      updatedAt: source.updated_at || null
    };
  }

  async function fetchTablePlayers(tableName) {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapRemotePlayer).filter(Boolean);
  }

  async function findTablePlayerByPhone(tableName, phone) {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;
    const { data, error } = await supabaseClient
      .from(tableName)
      .select('*')
      .eq('phone', normalizedPhone)
      .maybeSingle();
    if (error) throw error;
    return mapRemotePlayer(data);
  }

  async function upsertTablePlayers(tableName, players) {
    const supabaseClient = getClient();
    if (!supabaseClient) return [];
    const payload = (players || []).map((player, index) => toPlayerPayload(player, index));
    if (!payload.length) return [];
    const { error } = await supabaseClient.from(tableName).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    return payload;
  }

  async function upsertTablePlayer(tableName, player) {
    const supabaseClient = getClient();
    if (!supabaseClient) return null;
    const payload = toPlayerPayload(player);
    const { data, error } = await supabaseClient
      .from(tableName)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return mapRemotePlayer(data);
  }

  async function fetchPlayers() {
    return fetchTablePlayers(SESSION_PLAYERS_TABLE);
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

  async function findPlayerByPhone(phone) {
    return findTablePlayerByPhone(SESSION_PLAYERS_TABLE, phone);
  }

  async function upsertPlayers(players) {
    return upsertTablePlayers(SESSION_PLAYERS_TABLE, players);
  }

  async function upsertPlayer(player) {
    return upsertTablePlayer(SESSION_PLAYERS_TABLE, player);
  }

  async function fetchPlayerProfiles() {
    return fetchTablePlayers(PLAYER_PROFILES_TABLE);
  }

  async function findPlayerProfileByPhone(phone) {
    return findTablePlayerByPhone(PLAYER_PROFILES_TABLE, phone);
  }

  async function findSessionPlayerByPhone(phone) {
    return findTablePlayerByPhone(SESSION_PLAYERS_TABLE, phone);
  }

  async function upsertPlayerProfiles(players) {
    return upsertTablePlayers(PLAYER_PROFILES_TABLE, players);
  }

  async function upsertPlayerProfile(player) {
    return upsertTablePlayer(PLAYER_PROFILES_TABLE, player);
  }

  async function clearPlayers() {
    const supabaseClient = getClient();
    if (!supabaseClient) return;
    const { error } = await supabaseClient
      .from(SESSION_PLAYERS_TABLE)
      .delete()
      .not('id', 'is', null);
    if (error) throw error;
  }

  async function deletePlayer(id) {
    const supabaseClient = getClient();
    if (!supabaseClient || !id) return;
    const { error } = await supabaseClient.from(SESSION_PLAYERS_TABLE).delete().eq('id', id);
    if (error) throw error;
  }

  async function fetchAppConfig() {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapConfigRow(null);
    const configSource = hasServiceRoleKey ? 'app_config' : PUBLIC_APP_CONFIG_VIEW;
    const { data, error } = await supabaseClient
      .from(configSource)
      .select('*')
      .eq('id', 'global')
      .maybeSingle();
    if (error) throw error;
    return mapConfigRow(data);
  }

  async function saveAppConfig(config) {
    const supabaseClient = getClient();
    if (!supabaseClient) return mapConfigRow(config);
    const payload = {
      id: 'global',
      checkin_enabled: !!config.checkinEnabled,
      checkin_open_at: config.checkinOpenAt || null,
      checkin_close_at: config.checkinCloseAt || null,
      play_at: config.playAt || null,
      court_enabled_states: cloneArray(config.courtEnabledStates),
      layout_state: config.layoutState || null,
      updated_at: config.updatedAt || isoNow()
    };
    const { data, error } = await supabaseClient
      .from('app_config')
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

  async function lookupPlayerAccess(phone) {
    const supabaseClient = getClient();
    const normalizedPhone = normalizePhone(phone);
    if (!supabaseClient || !normalizedPhone) {
      return invokePlayerAccess('lookup', { phone });
    }

    try {
      const { data, error } = await supabaseClient.rpc('lookup_player_public', {
        p_phone: normalizedPhone
      });
      if (error) throw error;
      return normalizeLookupAccessResponse(data);
    } catch (error) {
      return invokePlayerAccess('lookup', { phone: normalizedPhone });
    }
  }

  async function checkDuplicatePlayerName(name) {
    return invokePlayerAccess('check-name', { name });
  }

  async function registerPlayerAccess(player) {
    return invokePlayerAccess('register', { player });
  }

  async function savePlayerAccess(player) {
    return invokePlayerAccess('save', { player });
  }

  async function cancelPlayerAccess(payload) {
    return invokePlayerAccess('cancel', payload);
  }

  function subscribeToTable(tableName, callback) {
    const supabaseClient = getClient();
    if (!supabaseClient) return function () {};
    const channel = supabaseClient
      .channel('badminton-' + tableName + '-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, callback)
      .subscribe();
    return function () {
      supabaseClient.removeChannel(channel);
    };
  }

  function subscribeToPlayers(callback) {
    return subscribeToTable('players', callback);
  }

  function subscribeToAppConfig(callback) {
    if (!hasServiceRoleKey) return function () {};
    return subscribeToTable('app_config', callback);
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
    saveAppConfig: saveAppConfig,
    subscribeToPlayers: subscribeToPlayers,
    subscribeToAppConfig: subscribeToAppConfig,
    lookupPlayerAccess: lookupPlayerAccess,
    checkDuplicatePlayerName: checkDuplicatePlayerName,
    registerPlayerAccess: registerPlayerAccess,
    savePlayerAccess: savePlayerAccess,
    cancelPlayerAccess: cancelPlayerAccess,
    mapRemotePlayer: mapRemotePlayer,
    mapConfigRow: mapConfigRow
  };
})();
