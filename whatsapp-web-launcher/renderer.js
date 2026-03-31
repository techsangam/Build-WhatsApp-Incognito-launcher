const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const detectedPath = document.getElementById('detectedPath');
const chromePathInput = document.getElementById('chromePath');
const openButton = document.getElementById('openButton');
const closeButton = document.getElementById('closeButton');

function setBusy(isBusy) {
  openButton.disabled = isBusy;
  chromePathInput.disabled = isBusy;
}

function updateStatus(state) {
  const badgeLabels = {
    running: 'Live Session',
    launching: 'Launching',
    closing: 'Closing',
    missing: 'Chrome Missing',
    error: 'Launch Error',
    ready: 'Ready'
  };

  statusBadge.textContent = badgeLabels[state.status] || 'Ready';
  statusBadge.className = `status-badge ${state.status}`;
  statusText.textContent = state.message;
  detectedPath.textContent = state.activeChromePath || state.detectedChromePath || 'Not detected';
  closeButton.disabled = !state.isRunning;

  if (!state.isRunning && state.status !== 'launching' && state.status !== 'closing') {
    openButton.disabled = false;
    chromePathInput.disabled = false;
  }
}

async function openWhatsApp() {
  setBusy(true);
  const result = await window.launcherApi.openWhatsApp(chromePathInput.value);

  if (!result.ok) {
    setBusy(false);
  }
}

async function closeSession() {
  closeButton.disabled = true;
  await window.launcherApi.closeSession();
}

openButton.addEventListener('click', openWhatsApp);
closeButton.addEventListener('click', closeSession);

window.launcherApi.onStateChange((state) => {
  updateStatus(state);
});

window.addEventListener('DOMContentLoaded', async () => {
  const state = await window.launcherApi.getState();
  updateStatus(state);
});
