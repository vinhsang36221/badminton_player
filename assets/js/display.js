const DISPLAY_DEFAULT_COURT_START_NUMBER = 9;
const DISPLAY_DEFAULT_COURT_COUNT = 4;

let displayPlayers = [];
let displayConfig = {
  sessionId: null,
  location: null,
  courtEnabledStates: [],
  layoutState: null,
  updatedAt: null
};
let displayAvailableSessions = [];
let displaySelectedSessionId = null;
let displayPlayersUnsubscribe = null;
let displayConfigUnsubscribe = null;
let displayRefreshTimer = null;
const DISPLAY_REFRESH_INTERVAL_MS = 3000;

function displayEscapeOptionLabel(value) {
  return String(value || '').replace(/[&<>"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[character]));
}

function displayFormatDate(value) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return parsed.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function displayFormatSessionOptionLabel(session) {
  if (!session || !session.sessionId) return 'Session không hợp lệ';
  const locationText = session.location ? `${displayEscapeOptionLabel(session.location)} | ` : '';
  return `${locationText}${displayFormatDate(session.checkinOpenAt)} -> ${displayFormatDate(session.checkinCloseAt)} | Play ${displayFormatDate(session.playAt)}`;
}

function displayRenderSessionSelector() {
  const card = document.getElementById('displaySessionCard');
  const select = document.getElementById('displaySessionSelect');
  const hint = document.getElementById('displaySessionHint');
  if (!card || !select || !hint) return;

  const hasSessions = displayAvailableSessions.length > 0;
  card.classList.toggle('d-none', !hasSessions);
  if (!hasSessions) {
    select.innerHTML = '<option value="">Hiện chưa có khung thời gian mở</option>';
    select.disabled = true;
    hint.textContent = 'Admin cần bật ít nhất một khung thời gian để display chọn session.';
    return;
  }

  const currentSessionId = displaySelectedSessionId || displayConfig.sessionId || null;
  const options = ['<option value="">Session hiển thị hiện tại</option>'];
  displayAvailableSessions.forEach(session => {
    const selected = currentSessionId && session.sessionId === currentSessionId ? ' selected' : '';
    options.push(`<option value="${session.sessionId}"${selected}>${displayFormatSessionOptionLabel(session)}</option>`);
  });
  select.innerHTML = options.join('');
  select.value = currentSessionId || '';
  select.disabled = false;
  hint.textContent = currentSessionId
    ? 'Display đang xem dữ liệu sân của session đang chọn.'
    : 'Đang xem session hiển thị hiện tại từ admin.';
}

function displayGetCourtCount() {
  if (Array.isArray(displayConfig.courtEnabledStates) && displayConfig.courtEnabledStates.length) {
    return displayConfig.courtEnabledStates.length;
  }
  if (Array.isArray(displayConfig.layoutState?.active_matches) && displayConfig.layoutState.active_matches.length) {
    return displayConfig.layoutState.active_matches.length;
  }
  return DISPLAY_DEFAULT_COURT_COUNT;
}

function displayGetCourtNumbers() {
  const count = displayGetCourtCount();
  const remoteCourtNumbers = displayConfig.layoutState?.court_numbers;
  if (Array.isArray(remoteCourtNumbers) && remoteCourtNumbers.length) {
    return Array.from({ length: count }, (_, index) => {
      const parsed = Number(remoteCourtNumbers[index]);
      return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DISPLAY_DEFAULT_COURT_START_NUMBER + (count - 1 - index);
    });
  }

  const remoteStart = displayConfig.layoutState?.court_number_start;
  if (Number.isFinite(Number(remoteStart)) && Number(remoteStart) > 0) {
    return Array.from({ length: count }, (_, index) => Number(remoteStart) + (count - 1 - index));
  }

  return Array.from({ length: count }, (_, index) => DISPLAY_DEFAULT_COURT_START_NUMBER + (count - 1 - index));
}

function displayGetCourtNumber(index) {
  return displayGetCourtNumbers()[index] ?? (DISPLAY_DEFAULT_COURT_START_NUMBER + index);
}

function displayCourtLabel(index) {
  return `Sân ${displayGetCourtNumber(index)}`;
}

function displayPlayerName(player) {
  return player ? player.name || '' : '';
}

function displayPlayerClass(player) {
  return player && player.gender === 'female' ? 'female' : 'male';
}

function displayResolvePlayer(ref, playerMap) {
  if (!ref) return null;
  return playerMap.get(ref) || null;
}

function displayBuildPlayerMap() {
  return new Map((displayPlayers || []).map(player => [player.id, player]));
}

function displayIsCourtEnabled(index) {
  if (!Array.isArray(displayConfig.courtEnabledStates) || !displayConfig.courtEnabledStates.length) return true;
  return displayConfig.courtEnabledStates[index] !== false;
}

function displayRenderPlayerSpan(player) {
  if (!player) return '<span class="player-drop-slot player-drop-slot-static">Waiting</span>';
  return `<span class="player-name ${displayPlayerClass(player)}">${displayPlayerName(player)}</span>`;
}

function displayResolveMatch(matchSnapshot, playerMap) {
  if (!Array.isArray(matchSnapshot) || matchSnapshot.length !== 2) return null;
  return matchSnapshot.map(team => {
    if (!Array.isArray(team) || team.length !== 2) return [null, null];
    return team.map(ref => displayResolvePlayer(ref, playerMap));
  });
}

function displayStatusText() {
  if (!displayConfig.updatedAt) return 'Chưa có dữ liệu build sân.';
  const parsed = new Date(displayConfig.updatedAt);
  if (Number.isNaN(parsed.getTime())) return 'Đã tải dữ liệu sân.';
  const sessionText = displayConfig.location ? ` | ${displayConfig.location}` : '';
  return `Cập nhật lúc ${parsed.toLocaleString('vi-VN')} | ${displayGetCourtCount()} sân | ${displayCourtLabel(displayGetCourtCount() - 1)} -> ${displayCourtLabel(0)}${sessionText}`;
}

function displayRenderCourt(index, matchSnapshot, playerMap) {
  const courtEnabled = displayIsCourtEnabled(index);
  const courtLabel = displayCourtLabel(index);
  const match = displayResolveMatch(matchSnapshot, playerMap);

  if (match && match.some(team => team.some(Boolean))) {
    const [team1, team2] = match;
    return `
      <div class="col-12 court-card">
        <div class="card ${team1.concat(team2).every(Boolean) ? '' : 'manual-match-card'}">
          <div class="card-header position-relative d-flex justify-content-between align-items-center">
            <div class="fs-5 fw-bold">${courtLabel}</div>
            <span class="court-switch court-switch-static ${courtEnabled ? 'court-switch-on' : 'court-switch-off'}" aria-hidden="true"><span class="court-switch-track"><span class="court-switch-thumb"></span></span></span>
          </div>
          <div class="card-body d-flex align-items-center">
            <div class="team-col text-center flex-fill">
              <div class="team-row">
                ${displayRenderPlayerSpan(team1[0])}
                <span class="sep">-</span>
                ${displayRenderPlayerSpan(team1[1])}
              </div>
            </div>
            <div class="vs-col text-center px-2"><strong>VS</strong></div>
            <div class="team-col text-center flex-fill">
              <div class="team-row">
                ${displayRenderPlayerSpan(team2[0])}
                <span class="sep">-</span>
                ${displayRenderPlayerSpan(team2[1])}
              </div>
            </div>
            <div class="enter-col ms-2">
              ${team1.concat(team2).every(Boolean) ? '' : '<span class="badge bg-secondary">Waiting</span>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="col-12 court-card">
      <div class="card">
        <div class="card-header position-relative d-flex justify-content-between align-items-center">
          <div class="fs-5 fw-bold">${courtLabel}</div>
          <span class="court-switch court-switch-static ${courtEnabled ? 'court-switch-on' : 'court-switch-off'}" aria-hidden="true"><span class="court-switch-track"><span class="court-switch-thumb"></span></span></span>
        </div>
        <div class="card-body">
          ${courtEnabled ? '<div class="empty-slot"><span class="waiting-pill">Waiting</span></div>' : '<div class="empty-slot empty-slot-off">Court OFF</div>'}
        </div>
      </div>
    </div>`;
}

function displayRender() {
  const statusBanner = document.getElementById('displayStatusBanner');
  const courtsRow = document.getElementById('courtsRow');
  if (!courtsRow) return;

  if (statusBanner) {
    statusBanner.className = 'alert alert-secondary';
    statusBanner.textContent = displayStatusText();
  }

  const playerMap = displayBuildPlayerMap();
  const activeMatches = Array.isArray(displayConfig.layoutState?.active_matches) ? displayConfig.layoutState.active_matches : [];
  courtsRow.innerHTML = Array.from({ length: displayGetCourtCount() }, (_, index) => displayRenderCourt(index, activeMatches[index] || null, playerMap)).join('');
}

async function displayLoadAll() {
  const sessionId = displaySelectedSessionId || null;
  displayConfig = await window.BadmintonBackend.fetchAppConfig(sessionId);
  displayPlayers = await window.BadmintonBackend.fetchDisplayPlayers(sessionId);
  if (!displaySelectedSessionId && displayConfig.sessionId) {
    displaySelectedSessionId = displayConfig.sessionId;
  }
  displayRenderSessionSelector();
  displayRender();
}

async function displayRefreshFromRemote() {
  if (!window.BadmintonBackend || !window.BadmintonBackend.isConfigured) return;
  try {
    await displayLoadAll();
  } catch (error) {
    console.error('display refresh failed', error);
  }
}

async function displayRefreshSessions() {
  displayAvailableSessions = await window.BadmintonBackend.fetchSelectablePlayerSessions();
  const selectedStillAvailable = displaySelectedSessionId
    ? displayAvailableSessions.some(session => session.sessionId === displaySelectedSessionId)
    : false;
  if (displaySelectedSessionId && !selectedStillAvailable) {
    displaySelectedSessionId = null;
  }
  displayRenderSessionSelector();
}

function startDisplayRefreshLoop() {
  if (displayRefreshTimer) window.clearInterval(displayRefreshTimer);
  displayRefreshTimer = window.setInterval(() => {
    displayRefreshFromRemote();
  }, DISPLAY_REFRESH_INTERVAL_MS);
}

async function displayStart() {
  const warning = document.getElementById('displayConfigWarning');
  if (!window.BadmintonBackend || !window.BadmintonBackend.isConfigured) {
    if (warning) {
      warning.classList.remove('d-none');
      warning.textContent = window.BadmintonBackend ? window.BadmintonBackend.getMissingConfigMessage() : 'Backend chưa sẵn sàng.';
    }
    return;
  }

  await displayRefreshSessions();
  await displayLoadAll();

  if (displayConfigUnsubscribe) displayConfigUnsubscribe();
  displayConfigUnsubscribe = window.BadmintonBackend.subscribeToAppConfig(async () => {
    await displayRefreshSessions();
    await displayRefreshFromRemote();
  });

  startDisplayRefreshLoop();
}

const displaySessionSelect = document.getElementById('displaySessionSelect');
if (displaySessionSelect) {
  displaySessionSelect.addEventListener('change', event => {
    displaySelectedSessionId = event && event.target ? event.target.value || null : null;
    void displayRefreshFromRemote();
  });
}

displayStart();
