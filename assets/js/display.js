const DISPLAY_COURT_NUMBERS = [9, 10, 11, 12];

let displayPlayers = [];
let displayConfig = {
  courtEnabledStates: [],
  layoutState: null,
  updatedAt: null
};
let displayPlayersUnsubscribe = null;
let displayConfigUnsubscribe = null;
let displayRefreshTimer = null;
const DISPLAY_REFRESH_INTERVAL_MS = 3000;

function displayCourtLabel(index) {
  return `Sân ${DISPLAY_COURT_NUMBERS[index] ?? (index + 1)}`;
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
  return `Cập nhật lúc ${parsed.toLocaleString('vi-VN')}`;
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
  courtsRow.innerHTML = DISPLAY_COURT_NUMBERS.map((_, index) => displayRenderCourt(index, activeMatches[index] || null, playerMap)).join('');
}

async function displayLoadAll() {
  displayPlayers = await window.BadmintonBackend.fetchPlayers();
  displayConfig = await window.BadmintonBackend.fetchAppConfig();
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

  await displayLoadAll();

  if (displayPlayersUnsubscribe) displayPlayersUnsubscribe();
  displayPlayersUnsubscribe = window.BadmintonBackend.subscribeToPlayers(async () => {
    displayPlayers = await window.BadmintonBackend.fetchPlayers();
    displayRender();
  });

  if (displayConfigUnsubscribe) displayConfigUnsubscribe();
  displayConfigUnsubscribe = window.BadmintonBackend.subscribeToAppConfig(async () => {
    await displayRefreshFromRemote();
  });

  startDisplayRefreshLoop();
}

displayStart();
