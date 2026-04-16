const PLAYER_LEVEL_LABELS = {
  0: 'Newbie',
  1: 'Yếu -',
  2: 'Yếu',
  3: 'Yếu +',
  4: 'Trung Bình -',
  5: 'Trung Bình',
  6: 'Trung Bình +',
  7: 'Khá -',
  8: 'Khá',
  9: 'Khá +',
  10: 'Giỏi'
};

let playerWindowConfig = {
  checkinEnabled: false,
  checkinOpenAt: null,
  checkinCloseAt: null,
  playAt: null
};
let activePlayer = null;
let activePlayerProfile = null;
let activeSessionPlayer = null;
let appReady = false;
let playerSettingsSubscription = null;
let duplicateNameCheckTimer = null;
let duplicateNameCheckSequence = 0;
const PLAYER_NAME_MAX_LENGTH = 13;

function playerNow() {
  return new Date();
}

function isWindowOpen(config) {
  if (!config || !config.checkinEnabled || !config.checkinOpenAt || !config.checkinCloseAt) return false;
  const now = playerNow().getTime();
  const opensAt = new Date(config.checkinOpenAt).getTime();
  const closesAt = new Date(config.checkinCloseAt).getTime();
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt)) return false;
  return now >= opensAt && now <= closesAt;
}

function getPlayerAccessPhase(config = playerWindowConfig) {
  if (!config || !config.checkinEnabled || !config.checkinOpenAt || !config.checkinCloseAt) return 'locked';
  const now = playerNow().getTime();
  const opensAt = new Date(config.checkinOpenAt).getTime();
  const closesAt = new Date(config.checkinCloseAt).getTime();
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt)) return 'locked';
  if (now < opensAt) return 'before-open';
  if (now <= closesAt) return 'checkin-open';
  return 'after-close';
}

function canLookupPlayers(config = playerWindowConfig) {
  const phase = getPlayerAccessPhase(config);
  return phase === 'checkin-open' || phase === 'after-close';
}

function canRegisterNewPlayers(config = playerWindowConfig) {
  return getPlayerAccessPhase(config) === 'checkin-open';
}

function canManageRegisteredPlayers(config = playerWindowConfig) {
  const phase = getPlayerAccessPhase(config);
  return phase === 'checkin-open' || phase === 'after-close';
}

function canCancelRegisteredPlayers(config = playerWindowConfig) {
  return getPlayerAccessPhase(config) === 'checkin-open';
}

function hasPlayStarted(config = playerWindowConfig) {
  if (!config || !config.playAt) return false;
  const playAt = new Date(config.playAt).getTime();
  if (!Number.isFinite(playAt)) return false;
  return playerNow().getTime() >= playAt;
}

function formatWindowDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function levelLabel(level) {
  return PLAYER_LEVEL_LABELS[level] || 'Trung Bình';
}

function sexLabel(value) {
  return value === 'female' ? 'Nữ' : 'Nam';
}

function createPlayerId() {
  return 'player_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function getFeedbackBox() {
  return document.getElementById('playerFeedback');
}

function setFeedback(message, type) {
  const box = getFeedbackBox();
  if (!box) return;
  if (!message) {
    box.className = 'alert d-none';
    box.style.whiteSpace = '';
    box.textContent = '';
    return;
  }
  box.className = 'alert alert-' + (type || 'secondary');
  box.style.whiteSpace = 'pre-line';
  box.textContent = message;
}

function appendDuplicateNameNotice(message, response) {
  const duplicateNameNotice = response && typeof response.duplicateNameNotice === 'string'
    ? response.duplicateNameNotice.trim()
    : '';
  if (!duplicateNameNotice) return message;
  return `${message}\n${duplicateNameNotice}`;
}

function formatRegisterNameValue(value) {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  const buildFormattedName = (baseName, suffix, separator) => {
    const maxBaseLength = Math.max(1, PLAYER_NAME_MAX_LENGTH - suffix.length - separator.length);
    const trimmedBaseName = String(baseName || '').trimEnd().slice(0, maxBaseLength).trimEnd();
    return `${trimmedBaseName}${separator}${suffix}`;
  };

  const mixedNameMatch = collapsed.match(/^(.*?)(\d+)$/);
  if (mixedNameMatch && mixedNameMatch[1] && /\D/.test(mixedNameMatch[1]) && !/[_]$/.test(mixedNameMatch[1])) {
    return buildFormattedName(mixedNameMatch[1], mixedNameMatch[2], '_');
  }

  return collapsed.slice(0, PLAYER_NAME_MAX_LENGTH).trim();
}

function formatRegisterNameDraftValue(value) {
  return String(value || '').slice(0, PLAYER_NAME_MAX_LENGTH);
}

function getRegisterNameInput() {
  return document.getElementById('registerName');
}

function getRegisterNameWarning() {
  return document.getElementById('registerNameWarning');
}

function clearDuplicateNameWarning() {
  const input = getRegisterNameInput();
  const warning = getRegisterNameWarning();
  if (input) input.classList.remove('player-name-duplicate');
  if (warning) {
    warning.classList.add('d-none');
    warning.textContent = '';
  }
}

function showDuplicateNameWarning(message) {
  const input = getRegisterNameInput();
  const warning = getRegisterNameWarning();
  if (input) input.classList.add('player-name-duplicate');
  if (warning) {
    warning.classList.remove('d-none');
    warning.textContent = message;
  }
}

async function checkDuplicateRegisterNameNow() {
  const input = getRegisterNameInput();
  if (!input) return;
  const formattedName = formatRegisterNameValue(input.value);
  const name = formattedName;
  const requestId = ++duplicateNameCheckSequence;

  if (!name || !window.BadmintonBackend || !window.BadmintonBackend.isConfigured) {
    clearDuplicateNameWarning();
    return;
  }

  try {
    const response = await window.BadmintonBackend.checkDuplicatePlayerName(name);
    if (requestId !== duplicateNameCheckSequence) return;
    const duplicateNameNotice = response && typeof response.duplicateNameNotice === 'string'
      ? response.duplicateNameNotice.trim()
      : '';
    if (duplicateNameNotice) showDuplicateNameWarning(duplicateNameNotice);
    else clearDuplicateNameWarning();
  } catch (error) {
    if (requestId !== duplicateNameCheckSequence) return;
    clearDuplicateNameWarning();
  }
}

function scheduleDuplicateRegisterNameCheck(immediate = false) {
  if (duplicateNameCheckTimer) {
    window.clearTimeout(duplicateNameCheckTimer);
    duplicateNameCheckTimer = null;
  }

  if (immediate) {
    void checkDuplicateRegisterNameNow();
    return;
  }

  duplicateNameCheckTimer = window.setTimeout(() => {
    duplicateNameCheckTimer = null;
    void checkDuplicateRegisterNameNow();
  }, 350);
}

function renderWindowBanner() {
  const banner = document.getElementById('playerWindowBanner');
  if (!banner) return;
  banner.style.whiteSpace = '';
  const phase = getPlayerAccessPhase(playerWindowConfig);
  if (phase === 'locked') {
    banner.className = 'alert alert-secondary';
    banner.textContent = 'Admin chưa mở cổng check-in.';
    return;
  }
  const playStarted = hasPlayStarted(playerWindowConfig);
  const playAtHint = (!playStarted && playerWindowConfig.playAt)
    ? '. Status sẽ mở sau ' + formatWindowDate(playerWindowConfig.playAt)
    : '';

  if (phase === 'before-open') {
    banner.className = 'alert alert-warning';
    banner.textContent = 'Chỉ được đăng nhập trong khung giờ ' + formatWindowDate(playerWindowConfig.checkinOpenAt) + ' - ' + formatWindowDate(playerWindowConfig.checkinCloseAt);
    return;
  }

  if (phase === 'checkin-open') {
    banner.className = 'alert alert-success';
    banner.style.whiteSpace = 'pre-line';
    banner.textContent = 'Cổng check-in đang mở đến ' + formatWindowDate(playerWindowConfig.checkinCloseAt) + '.\nTrong thời gian này bạn có thể đăng ký mới, đăng ký lại bằng phone hoặc hủy đăng ký hiện tại.';
    return;
  }

  banner.className = 'alert alert-info';
  banner.textContent = 'Khung giờ đăng ký mới đã đóng. Bạn chỉ có thể nhập phone để truy suất player đã đăng ký và cập nhật prefer/status.';
}

function updateStatusFieldVisibility(player = activePlayer) {
  const showStatus = hasPlayStarted(playerWindowConfig);
  const registerField = document.getElementById('registerStatusField');
  const manageField = document.getElementById('manageStatusField');
  if (registerField) registerField.classList.toggle('d-none', !showStatus);
  if (manageField) manageField.classList.toggle('d-none', !showStatus);

  const registerReady = document.getElementById('registerReady');
  if (registerReady && !showStatus) registerReady.value = 'not_ready';

  const manageReady = document.getElementById('manageReady');
  if (manageReady) manageReady.value = showStatus && player && player.ready === true ? 'ready' : 'not_ready';
}

function updatePlayerAccessControls() {
  const allowLookup = canLookupPlayers(playerWindowConfig);
  const allowRegister = canRegisterNewPlayers(playerWindowConfig);
  const allowManage = canManageRegisteredPlayers(playerWindowConfig);
  const allowStatusEdit = allowManage && hasPlayStarted(playerWindowConfig);

  ['lookupPhone', 'lookupButton'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = !allowLookup;
  });

  ['registerName', 'registerPhone', 'registerSex', 'registerLevel', 'registerPrefer'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = !allowRegister;
  });

  const registerReady = document.getElementById('registerReady');
  if (registerReady) registerReady.disabled = !allowRegister || !allowStatusEdit;

  ['managePrefer'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = !allowManage;
  });

  const manageReady = document.getElementById('manageReady');
  if (manageReady) manageReady.disabled = !allowStatusEdit;

  const registerSubmit = document.querySelector('#playerRegisterForm button[type="submit"]');
  if (registerSubmit) registerSubmit.disabled = !allowRegister;

  const manageSubmit = document.getElementById('playerManageSubmit');
  if (manageSubmit) manageSubmit.disabled = !allowManage;

  const cancelButton = document.getElementById('playerCancelRegistration');
  if (cancelButton) cancelButton.disabled = !canCancelRegisteredPlayers(playerWindowConfig) || !activeSessionPlayer;
}

function resetRegisterForm(phone = '') {
  const registerForm = document.getElementById('playerRegisterForm');
  if (registerForm) registerForm.reset();

  const registerName = document.getElementById('registerName');
  if (registerName) registerName.value = '';
  duplicateNameCheckSequence += 1;
  clearDuplicateNameWarning();

  const registerPhone = document.getElementById('registerPhone');
  if (registerPhone) registerPhone.value = phone || '';

  const registerSex = document.getElementById('registerSex');
  if (registerSex) registerSex.value = '';

  const registerLevel = document.getElementById('registerLevel');
  if (registerLevel) registerLevel.value = '';

  const registerPrefer = document.getElementById('registerPrefer');
  if (registerPrefer) registerPrefer.value = '';

  const registerReady = document.getElementById('registerReady');
  if (registerReady) registerReady.value = 'not_ready';

  updateStatusFieldVisibility();
}

function showRegisterCard(phone) {
  const card = document.getElementById('playerRegisterCard');
  const manage = document.getElementById('playerManageCard');
  if (card) card.classList.remove('d-none');
  if (manage) manage.classList.add('d-none');
  resetRegisterForm(phone);
}

function showManageCard(player) {
  const card = document.getElementById('playerRegisterCard');
  const manage = document.getElementById('playerManageCard');
  if (card) card.classList.add('d-none');
  if (manage) manage.classList.remove('d-none');
  document.getElementById('manageName').value = player.name || '';
  document.getElementById('managePhone').value = player.phone || '';
  document.getElementById('manageSex').value = sexLabel(player.gender);
  document.getElementById('manageLevel').value = levelLabel(Number(player.level));
  document.getElementById('managePrefer').value = player.prefer || 'normal';
  document.getElementById('manageReady').value = player.ready === false ? 'not_ready' : 'ready';
  updateStatusFieldVisibility(player);
  updateManageSubmitButton();
}

function resetPlayerCards() {
  const registerCard = document.getElementById('playerRegisterCard');
  const manageCard = document.getElementById('playerManageCard');
  if (registerCard) registerCard.classList.add('d-none');
  if (manageCard) manageCard.classList.add('d-none');
  resetRegisterForm('');
}

function resetActivePlayerState() {
  activePlayer = null;
  activePlayerProfile = null;
  activeSessionPlayer = null;
  updateManageSubmitButton();
}

function mergePlayerRecords(profile, sessionPlayer) {
  const source = sessionPlayer || profile;
  if (!source) return null;
  return {
    ...(profile || {}),
    ...(sessionPlayer || {}),
    id: (profile && profile.id) || (sessionPlayer && sessionPlayer.id) || createPlayerId(),
    name: (sessionPlayer && sessionPlayer.name) || (profile && profile.name) || '',
    phone: (sessionPlayer && sessionPlayer.phone) || (profile && profile.phone) || '',
    gender: (sessionPlayer && sessionPlayer.gender) || (profile && profile.gender) || 'male',
    level: Number.isFinite(Number((sessionPlayer && sessionPlayer.level) || (profile && profile.level)))
      ? Number((sessionPlayer && sessionPlayer.level) || (profile && profile.level))
      : 4,
    prefer: (sessionPlayer && sessionPlayer.prefer) || (profile && profile.prefer) || 'normal',
    ready: sessionPlayer ? sessionPlayer.ready !== false : (profile ? profile.ready === true : false),
    rating: Number.isFinite(Number((sessionPlayer && sessionPlayer.rating) || (profile && profile.rating)))
      ? Number((sessionPlayer && sessionPlayer.rating) || (profile && profile.rating))
      : (Number.isFinite(Number(source.level)) ? Number(source.level) : 4) * 100,
    createdAt: (profile && profile.createdAt) || (sessionPlayer && sessionPlayer.createdAt) || null,
    updatedAt: (sessionPlayer && sessionPlayer.updatedAt) || (profile && profile.updatedAt) || null
  };
}

function setActivePlayerRecords(profile, sessionPlayer) {
  activePlayerProfile = profile || null;
  activeSessionPlayer = sessionPlayer || null;
  activePlayer = mergePlayerRecords(profile, sessionPlayer);
}

function updateManageSubmitButton() {
  const button = document.getElementById('playerManageSubmit');
  if (button) button.textContent = activeSessionPlayer ? 'Cập Nhật Thông Tin' : 'Đăng ký';

  const cancelButton = document.getElementById('playerCancelRegistration');
  if (cancelButton) {
    cancelButton.disabled = !canCancelRegisteredPlayers(playerWindowConfig) || !activeSessionPlayer;
    cancelButton.title = activeSessionPlayer
      ? (canCancelRegisteredPlayers(playerWindowConfig) ? 'Xóa player khỏi danh sách của đợt hiện tại.' : 'Chỉ có thể hủy đăng ký trong thời gian mở check-in.')
      : 'Player này chưa có trong danh sách của đợt hiện tại.';
  }
}

async function loadWindowConfig() {
  if (!window.BadmintonBackend || !window.BadmintonBackend.isConfigured) return;
  playerWindowConfig = await window.BadmintonBackend.fetchAppConfig();
  renderWindowBanner();
  updatePlayerAccessControls();
  updateStatusFieldVisibility();
}

async function lookupPlayerByPhone(phone) {
  if (!window.BadmintonBackend || !window.BadmintonBackend.isConfigured) return;
  const response = await window.BadmintonBackend.lookupPlayerAccess(phone);
  const profile = response && response.profile ? response.profile : null;
  const sessionPlayer = response && response.sessionPlayer ? response.sessionPlayer : null;

  if (sessionPlayer) {
    setActivePlayerRecords(profile || sessionPlayer, sessionPlayer);
    showManageCard(activePlayer);
    setFeedback('Đã tải thông tin player trong đợt đăng ký hiện tại. Bạn có thể cập nhật thông tin hoặc hủy đăng ký.', 'success');
    return;
  }

  if (profile) {
    if (!canRegisterNewPlayers(playerWindowConfig)) {
      resetPlayerCards();
      resetActivePlayerState();
      setFeedback('Khung giờ đăng ký mới đã đóng. Chỉ player đã đăng ký trong đợt hiện tại mới có thể cập nhật thông tin.', 'warning');
      return;
    }
    setActivePlayerRecords(profile, null);
    showManageCard(activePlayer);
    setFeedback('Chúng tôi đã có thông tin đăng ký của bạn trước đây. Bấm "Đăng ký" để vào danh sách player của đợt hiện tại.', 'info');
    return;
  }

  if (!canRegisterNewPlayers(playerWindowConfig)) {
    resetActivePlayerState();
    resetPlayerCards();
    setFeedback('Đã hết giờ đăng ký mới. Chỉ player đã đăng ký mới có thể truy suất và cập nhật thông tin.', 'warning');
    return;
  }
  resetActivePlayerState();
  showRegisterCard(phone);
  setFeedback('Chưa có hồ sơ. Bạn hãy đăng ký lần đầu.', 'secondary');
}

function buildRegisteredPlayer() {
  const level = parseInt(document.getElementById('registerLevel').value, 10);
  const canEditStatus = hasPlayStarted(playerWindowConfig);
  return {
    id: createPlayerId(),
    name: document.getElementById('registerName').value.trim(),
    phone: document.getElementById('registerPhone').value.trim(),
    gender: document.getElementById('registerSex').value,
    level: Number.isFinite(level) ? level : 4,
    prefer: document.getElementById('registerPrefer').value,
    ready: canEditStatus ? document.getElementById('registerReady').value === 'ready' : false,
    rating: (Number.isFinite(level) ? level : 4) * 100,
    matches: 0,
    idleIndex: 0,
    couple: null,
    unpair: null,
    unpairMain: false,
    partnerSlot: null,
    recentTeammates: [],
    recentOpponents: [],
    sortOrder: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function setLookupLoading(isLoading) {
  const phoneInput = document.getElementById('lookupPhone');
  const lookupButton = document.getElementById('lookupButton');
  if (phoneInput) phoneInput.disabled = !!isLoading || !canLookupPlayers(playerWindowConfig);
  if (lookupButton) {
    lookupButton.disabled = !!isLoading || !canLookupPlayers(playerWindowConfig);
    lookupButton.textContent = isLoading ? 'Đang tải...' : 'Tiếp tục';
  }
}

async function handleLookupSubmit(event) {
  event.preventDefault();
  setFeedback('', 'secondary');
  if (!appReady) return;
  if (!canLookupPlayers(playerWindowConfig)) {
    setFeedback('Hiện chưa đến khung giờ cho phép truy suất player.', 'warning');
    return;
  }
  const phone = document.getElementById('lookupPhone').value.trim();
  if (!phone) {
    setFeedback('Nhập số điện thoại trước.', 'warning');
    return;
  }
  try {
    setLookupLoading(true);
    await lookupPlayerByPhone(phone);
  } catch (error) {
    setFeedback(error.message || 'Không thể tải dữ liệu player.', 'danger');
  } finally {
    setLookupLoading(false);
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  if (!canRegisterNewPlayers(playerWindowConfig)) {
    setFeedback('Khung giờ đăng ký mới đã đóng.', 'warning');
    return;
  }
  const player = buildRegisteredPlayer();
  if (!player.name || !player.phone || !player.gender || !document.getElementById('registerLevel').value || !player.prefer) {
    setFeedback('Hãy nhập name, phone và chọn đầy đủ giới tính, level, prefer.', 'warning');
    return;
  }
  try {
    const response = await window.BadmintonBackend.registerPlayerAccess(player);
    const savedProfile = response && response.profile ? response.profile : null;
    const savedSession = response && response.sessionPlayer ? response.sessionPlayer : null;
    setActivePlayerRecords(savedProfile, savedSession);
    showManageCard(activePlayer);
    setFeedback(
      appendDuplicateNameNotice('Đăng ký thành công ! Hãy nhớ check status Ready khi đến sân nhé.\nHẹn gặp lại bạn.', response),
      'success'
    );
  } catch (error) {
    setFeedback(error.message || 'Không thể đăng ký player.', 'danger');
  }
}

async function handleManageSubmit(event) {
  event.preventDefault();
  if (!activePlayer) return;
  if (!canManageRegisteredPlayers(playerWindowConfig)) {
    setFeedback('Hiện chưa đến thời gian cho phép truy suất player đã đăng ký.', 'warning');
    return;
  }
  const wasRegisteredInCurrentSession = !!activeSessionPlayer;
  const nextPlayer = {
    ...(activePlayerProfile || activePlayer),
    ...(activeSessionPlayer || {}),
    id: (activePlayerProfile && activePlayerProfile.id) || activePlayer.id || createPlayerId(),
    name: activePlayer.name,
    phone: activePlayer.phone,
    gender: activePlayer.gender,
    level: Number.isFinite(Number(activePlayer.level)) ? Number(activePlayer.level) : 4,
    rating: Number.isFinite(Number(activePlayer.rating)) ? Number(activePlayer.rating) : ((Number.isFinite(Number(activePlayer.level)) ? Number(activePlayer.level) : 4) * 100),
    prefer: document.getElementById('managePrefer').value,
    ready: hasPlayStarted(playerWindowConfig)
      ? document.getElementById('manageReady').value === 'ready'
      : (activeSessionPlayer ? activeSessionPlayer.ready === true : false),
    updatedAt: new Date().toISOString()
  };
  try {
    const response = await window.BadmintonBackend.savePlayerAccess(nextPlayer);
    const savedProfile = response && response.profile ? response.profile : null;
    const savedSession = response && response.sessionPlayer ? response.sessionPlayer : null;
    setActivePlayerRecords(savedProfile, savedSession);
    showManageCard(activePlayer);
    setFeedback(
      appendDuplicateNameNotice(
        wasRegisteredInCurrentSession
          ? (hasPlayStarted(playerWindowConfig) ? 'Đã cập nhật prefer và status.' : 'Đã cập nhật prefer.')
          : 'Đăng ký thành công vào danh sách player hiện tại.',
        response
      ),
      'success'
    );
  } catch (error) {
    setFeedback(error.message || 'Không thể lưu thay đổi.', 'danger');
  }
}

async function handleCancelRegistration() {
  if (!activeSessionPlayer || !activeSessionPlayer.id) {
    setFeedback('Player này chưa có trong danh sách của đợt hiện tại để hủy.', 'warning');
    return;
  }
  if (!canCancelRegisteredPlayers(playerWindowConfig)) {
    setFeedback('Chỉ có thể hủy đăng ký trong thời gian check-in đang mở.', 'warning');
    return;
  }

  const phone = activePlayer && activePlayer.phone ? activePlayer.phone : '';
  try {
    await window.BadmintonBackend.cancelPlayerAccess({
      phone,
      sessionPlayerId: activeSessionPlayer.id
    });
    if (phone) {
      await lookupPlayerByPhone(phone);
    } else {
      resetActivePlayerState();
      resetPlayerCards();
    }
    setFeedback('Đã hủy đăng ký khỏi player session hiện tại.', 'success');
  } catch (error) {
    setFeedback(error.message || 'Không thể hủy đăng ký.', 'danger');
  }
}

function handleLogout() {
  resetActivePlayerState();
  document.getElementById('lookupPhone').value = '';
  resetPlayerCards();
  setFeedback('', 'secondary');
}

async function startPlayerPage() {
  const warning = document.getElementById('playerConfigWarning');
  if (!window.BadmintonBackend || !window.BadmintonBackend.isConfigured) {
    if (warning) {
      warning.classList.remove('d-none');
      warning.textContent = window.BadmintonBackend ? window.BadmintonBackend.getMissingConfigMessage() : 'Backend chưa sẵn sàng.';
    }
    renderWindowBanner();
    updatePlayerAccessControls();
    return;
  }

  await loadWindowConfig();
  if (playerSettingsSubscription) playerSettingsSubscription();
  playerSettingsSubscription = window.BadmintonBackend.subscribeToAppConfig(async () => {
    await loadWindowConfig();
  });

  appReady = true;
  document.getElementById('lookupPhone').value = '';
  resetRegisterForm('');
  setLookupLoading(false);
}

const lookupForm = document.getElementById('playerLookupForm');
if (lookupForm) lookupForm.addEventListener('submit', handleLookupSubmit);
const registerForm = document.getElementById('playerRegisterForm');
if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);
const registerNameInput = document.getElementById('registerName');
if (registerNameInput) {
  registerNameInput.addEventListener('input', () => {
    const formattedName = formatRegisterNameDraftValue(registerNameInput.value);
    if (registerNameInput.value !== formattedName) {
      registerNameInput.value = formattedName;
    }
    const currentValue = formattedName.trim();
    if (!currentValue) {
      duplicateNameCheckSequence += 1;
      clearDuplicateNameWarning();
      return;
    }
    scheduleDuplicateRegisterNameCheck(false);
  });
  registerNameInput.addEventListener('blur', () => {
    const formattedName = formatRegisterNameValue(registerNameInput.value);
    if (registerNameInput.value !== formattedName) {
      registerNameInput.value = formattedName;
    }
    const currentValue = formattedName.trim();
    if (!currentValue) {
      duplicateNameCheckSequence += 1;
      clearDuplicateNameWarning();
      return;
    }
    scheduleDuplicateRegisterNameCheck(true);
  });
}
const manageForm = document.getElementById('playerManageForm');
if (manageForm) manageForm.addEventListener('submit', handleManageSubmit);
const cancelRegistrationButton = document.getElementById('playerCancelRegistration');
if (cancelRegistrationButton) cancelRegistrationButton.addEventListener('click', handleCancelRegistration);
const logoutButton = document.getElementById('playerLogout');
if (logoutButton) logoutButton.onclick = handleLogout;

startPlayerPage();
