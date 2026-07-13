const state = {
  rooms: [],
  accessAction: 'join',
  currentRoom: null,
  socket: null,
  localStream: null,
  peerConnection: null,
  queuedCandidates: [],
  timer: null,
  startedAt: null,
  inviteHandled: false,
  deviceOrientation: null,
};

const rtcConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const invitePathMatch = window.location.pathname.match(/^\/invite\/([a-f0-9-]+)\/?$/i);
const invitedRoomId = invitePathMatch?.[1] || null;
const isInviteVisit = Boolean(invitedRoomId);

const elements = {
  dashboard: document.querySelector('#dashboard-view'),
  callView: document.querySelector('#call-view'),
  createForm: document.querySelector('#create-form'),
  roomGrid: document.querySelector('#room-grid'),
  emptyState: document.querySelector('#empty-state'),
  roomSearch: document.querySelector('#room-search'),
  accessDialog: document.querySelector('#access-dialog'),
  accessForm: document.querySelector('#access-form'),
  editDialog: document.querySelector('#edit-dialog'),
  editForm: document.querySelector('#edit-form'),
  deleteDialog: document.querySelector('#delete-dialog'),
  deleteForm: document.querySelector('#delete-form'),
  localVideo: document.querySelector('#local-video'),
  remoteVideo: document.querySelector('#remote-video'),
  remotePlaceholder: document.querySelector('#remote-placeholder'),
  videoStage: document.querySelector('#video-stage'),
  localTile: document.querySelector('#local-tile'),
  showLocalPreview: document.querySelector('#show-local-preview'),
  callControls: document.querySelector('#call-controls'),
  toastRegion: document.querySelector('#toast-region'),
};

if (isInviteVisit) elements.dashboard.hidden = true;

function roomTokenKey(roomId) {
  return `roomlik:token:${roomId}`;
}

function getToken(roomId) {
  return sessionStorage.getItem(roomTokenKey(roomId));
}

function saveToken(roomId, token) {
  sessionStorage.setItem(roomTokenKey(roomId), token);
}

function forgetToken(roomId) {
  sessionStorage.removeItem(roomTokenKey(roomId));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    error.fields = data.fields || {};
    throw error;
  }

  return data;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function setButtonBusy(button, busy, label = 'Working…') {
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
  button.disabled = busy;
  button.innerHTML = busy ? label : button.dataset.originalLabel;
}

function setFieldErrors(form, errors, attribute = 'data-error-for') {
  form.querySelectorAll(`[${attribute}]`).forEach((node) => {
    const fieldName = node.getAttribute(attribute);
    node.textContent = errors[fieldName] || '';
    const input = form.querySelector(`[name="${fieldName}"]`) || form.querySelector(`#edit-${fieldName}`);
    input?.setAttribute('aria-invalid', errors[fieldName] ? 'true' : 'false');
  });
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(isoDate));
}

function roomMatches(room, query) {
  const text = `${room.name} ${room.description}`.toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase());
}

function makeRoomCard(room) {
  const card = document.createElement('article');
  const isFull = room.participants >= 2;
  card.className = 'room-card';
  card.dataset.roomId = room.id;
  card.innerHTML = `
    <div class="room-card-top">
      <span class="room-icon"><svg><use href="#icon-video"></use></svg></span>
      <div class="room-actions">
        <button class="icon-button" type="button" data-room-action="copy" aria-label="Copy invite link"><svg><use href="#icon-copy"></use></svg></button>
        <button class="icon-button" type="button" data-room-action="edit" aria-label="Edit room"><svg><use href="#icon-edit"></use></svg></button>
        <button class="icon-button danger" type="button" data-room-action="delete" aria-label="Delete room"><svg><use href="#icon-trash"></use></svg></button>
      </div>
    </div>
    <h3></h3>
    <p class="room-description"></p>
    <div class="room-card-bottom">
      <div class="room-meta">
        <span class="occupancy ${isFull ? 'full' : ''}">${room.participants} / 2</span>
        <span>·</span>
        <span>${formatDate(room.updatedAt)}</span>
      </div>
      <button class="join-button" type="button" data-room-action="join" ${isFull ? 'disabled' : ''}>
        ${isFull ? 'Full' : 'Join'} ${isFull ? '' : '<svg><use href="#icon-arrow"></use></svg>'}
      </button>
    </div>`;
  card.querySelector('h3').textContent = room.name;
  card.querySelector('.room-description').textContent = room.description || 'A private place for a face-to-face conversation.';
  return card;
}

function renderRooms() {
  const query = elements.roomSearch.value;
  const visibleRooms = state.rooms.filter((room) => roomMatches(room, query));
  elements.roomGrid.replaceChildren(...visibleRooms.map(makeRoomCard));
  elements.emptyState.hidden = visibleRooms.length > 0;

  if (state.rooms.length > 0 && visibleRooms.length === 0) {
    elements.emptyState.querySelector('h3').textContent = 'No rooms match that search';
    elements.emptyState.querySelector('p').textContent = 'Try another room name or clear your search.';
    elements.emptyState.querySelector('button').hidden = true;
  } else {
    elements.emptyState.querySelector('h3').textContent = 'No rooms here yet';
    elements.emptyState.querySelector('p').textContent = 'Create your first private space above. It only takes a few seconds.';
    elements.emptyState.querySelector('button').hidden = false;
  }
}

async function loadRooms({ quiet = false } = {}) {
  try {
    if (isInviteVisit) {
      const data = await api(`/api/rooms/${invitedRoomId}`);
      state.rooms = [data.room];
    } else {
      const data = await api('/api/rooms');
      state.rooms = data.rooms;
      renderRooms();
    }
    handleInviteLink();
  } catch (error) {
    if (!quiet) showToast(error.message, 'error');
  }
}

function findRoom(roomId) {
  return state.rooms.find((room) => room.id === roomId);
}

function inviteUrl(roomId) {
  return `${window.location.origin}/invite/${roomId}`;
}

async function copyInvite(roomId) {
  try {
    await navigator.clipboard.writeText(inviteUrl(roomId));
    showToast('Invite link copied. Remember to share the password separately.');
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = inviteUrl(roomId);
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.append(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
    showToast('Invite link copied.');
  }
}

function openAccessDialog(room, action = 'join') {
  if (!room) {
    showToast('That room no longer exists.', 'error');
    return;
  }

  state.accessAction = action;
  document.querySelector('#access-room-id').value = room.id;
  document.querySelector('#access-title').textContent = action === 'join' ? `Join “${room.name}”` : `Unlock “${room.name}”`;
  document.querySelector('#access-copy').textContent = action === 'join'
    ? 'Enter the password your host shared with you.'
    : `Confirm the room password to ${action} its settings.`;
  document.querySelector('#access-password').value = '';
  document.querySelector('#access-error').textContent = '';
  elements.accessDialog.showModal();
  window.setTimeout(() => document.querySelector('#access-password').focus(), 50);
}

function requireRoomAccess(room, action) {
  const token = getToken(room.id);
  if (!token) {
    openAccessDialog(room, action);
    return;
  }

  if (action === 'join') openCall(room, token);
  if (action === 'edit') openEditDialog(room);
  if (action === 'delete') openDeleteDialog(room);
}

function openEditDialog(room) {
  document.querySelector('#edit-room-id').value = room.id;
  document.querySelector('#edit-name').value = room.name;
  document.querySelector('#edit-description').value = room.description;
  document.querySelector('#edit-password').value = '';
  setFieldErrors(elements.editForm, {}, 'data-edit-error-for');
  elements.editDialog.showModal();
}

function openDeleteDialog(room) {
  document.querySelector('#delete-room-id').value = room.id;
  document.querySelector('#delete-room-name').textContent = room.name;
  elements.deleteDialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  if (isInviteVisit && dialog === elements.accessDialog && !state.currentRoom) {
    window.location.replace('/');
  }
}

const OVERLAY_MARGIN = 8;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getOverlayPosition(element) {
  const stageRect = elements.videoStage.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return {
    left: elementRect.left - stageRect.left,
    top: elementRect.top - stageRect.top,
  };
}

function getOverlayBounds(element) {
  return {
    maximumLeft: Math.max(OVERLAY_MARGIN, elements.videoStage.clientWidth - element.offsetWidth - OVERLAY_MARGIN),
    maximumTop: Math.max(OVERLAY_MARGIN, elements.videoStage.clientHeight - element.offsetHeight - OVERLAY_MARGIN),
  };
}

function placeOverlay(element, left, top) {
  const { maximumLeft, maximumTop } = getOverlayBounds(element);
  const nextLeft = clamp(left, OVERLAY_MARGIN, maximumLeft);
  const nextTop = clamp(top, OVERLAY_MARGIN, maximumTop);

  element.style.left = `${nextLeft}px`;
  element.style.top = `${nextTop}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  element.style.translate = 'none';
  element.dataset.moved = 'true';
  element.dataset.positionX = String(maximumLeft === OVERLAY_MARGIN ? 0 : (nextLeft - OVERLAY_MARGIN) / (maximumLeft - OVERLAY_MARGIN));
  element.dataset.positionY = String(maximumTop === OVERLAY_MARGIN ? 0 : (nextTop - OVERLAY_MARGIN) / (maximumTop - OVERLAY_MARGIN));
}

function clampMovedOverlay(element) {
  if (element.hidden || element.dataset.moved !== 'true') return;
  const { maximumLeft, maximumTop } = getOverlayBounds(element);
  const horizontalRatio = Number(element.dataset.positionX);
  const verticalRatio = Number(element.dataset.positionY);

  if (Number.isFinite(horizontalRatio) && Number.isFinite(verticalRatio)) {
    placeOverlay(
      element,
      OVERLAY_MARGIN + horizontalRatio * (maximumLeft - OVERLAY_MARGIN),
      OVERLAY_MARGIN + verticalRatio * (maximumTop - OVERLAY_MARGIN),
    );
    return;
  }

  const position = getOverlayPosition(element);
  placeOverlay(element, position.left, position.top);
}

function viewportDimensions() {
  return {
    width: window.visualViewport?.width || window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight,
  };
}

function deviceOrientation() {
  const viewport = viewportDimensions();
  return viewport.height >= viewport.width ? 'portrait' : 'landscape';
}

function isPhoneViewport() {
  const viewport = viewportDimensions();
  return Math.min(viewport.width, viewport.height) < 680;
}

function cameraVideoConstraints() {
  if (isPhoneViewport()) {
    return {
      width: { ideal: 720 },
      height: { ideal: 1280 },
      aspectRatio: { ideal: 9 / 16 },
      resizeMode: { ideal: 'crop-and-scale' },
      facingMode: 'user',
    };
  }

  const portrait = deviceOrientation() === 'portrait';
  return {
    width: { ideal: portrait ? 720 : 1280 },
    height: { ideal: portrait ? 1280 : 720 },
    facingMode: 'user',
  };
}

async function adaptCameraToOrientation() {
  const videoTrack = state.localStream?.getVideoTracks()[0];
  if (!videoTrack?.applyConstraints) return;

  try {
    await videoTrack.applyConstraints(cameraVideoConstraints());
  } catch {
    // Some mobile cameras expose only one capture shape; CSS still adapts it.
  }
}

function mediaAspect(video, fallbackTrack) {
  const settings = fallbackTrack?.getSettings?.() || {};
  const width = video.videoWidth || settings.width || 0;
  const height = video.videoHeight || settings.height || 0;
  return width > 0 && height > 0 ? width / height : null;
}

function updateAdaptiveVideoLayout({ adaptCamera = true } = {}) {
  const viewport = viewportDimensions();
  const orientation = deviceOrientation();
  const phoneViewport = isPhoneViewport();
  const orientationChanged = state.deviceOrientation && state.deviceOrientation !== orientation;
  state.deviceOrientation = orientation;

  elements.callView.style.setProperty('--call-height', `${Math.round(viewport.height)}px`);
  elements.callView.classList.toggle('is-portrait', orientation === 'portrait');
  elements.callView.classList.toggle('is-landscape', orientation === 'landscape');
  elements.callView.classList.toggle('is-phone', phoneViewport);

  if (orientationChanged && adaptCamera && state.localStream) adaptCameraToOrientation();

  const localTrack = state.localStream?.getVideoTracks()[0];
  const localAspect = mediaAspect(elements.localVideo, localTrack);
  if (phoneViewport) {
    elements.localTile.style.setProperty('--local-aspect', String(9 / 16));
    elements.localTile.classList.add('is-portrait-video');
  } else if (localAspect) {
    const safeLocalAspect = clamp(localAspect, 0.72, 1.85);
    elements.localTile.style.setProperty('--local-aspect', String(safeLocalAspect));
    elements.localTile.classList.toggle('is-portrait-video', localAspect < 0.95);
  }

  const remoteTrack = elements.remoteVideo.srcObject?.getVideoTracks?.()[0];
  const remoteAspect = mediaAspect(elements.remoteVideo, remoteTrack);
  const stageAspect = elements.videoStage.clientHeight > 0
    ? elements.videoStage.clientWidth / elements.videoStage.clientHeight
    : null;

  if (phoneViewport) {
    elements.remoteVideo.classList.remove('fit-contain');
  } else if (remoteAspect && stageAspect) {
    const aspectMismatch = Math.max(remoteAspect / stageAspect, stageAspect / remoteAspect);
    const compactDevice = Math.min(viewport.width, viewport.height) < 760;
    elements.remoteVideo.classList.toggle('fit-contain', aspectMismatch > (compactDevice ? 1.28 : 1.55));
  } else {
    elements.remoteVideo.classList.remove('fit-contain');
  }

  clampMovedOverlay(elements.localTile);
  clampMovedOverlay(elements.callControls);
}

function makeDraggable(element, { pointerHandle = element, keyboardHandle = pointerHandle, ignoreSelector = '' } = {}) {
  let drag = null;

  pointerHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !state.currentRoom) return;
    if (ignoreSelector && event.target.closest?.(ignoreSelector)) return;

    const position = getOverlayPosition(element);
    placeOverlay(element, position.left, position.top);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: position.left,
      top: position.top,
    };
    element.classList.add('is-dragging');
    pointerHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  pointerHandle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    placeOverlay(
      element,
      drag.left + event.clientX - drag.startX,
      drag.top + event.clientY - drag.startY,
    );
  });

  const finishDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    element.classList.remove('is-dragging');
    if (pointerHandle.hasPointerCapture(event.pointerId)) pointerHandle.releasePointerCapture(event.pointerId);
  };

  pointerHandle.addEventListener('pointerup', finishDrag);
  pointerHandle.addEventListener('pointercancel', finishDrag);

  keyboardHandle.addEventListener('keydown', (event) => {
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction || !state.currentRoom) return;

    const position = getOverlayPosition(element);
    const distance = event.shiftKey ? 30 : 10;
    placeOverlay(
      element,
      position.left + direction[0] * distance,
      position.top + direction[1] * distance,
    );
    event.preventDefault();
  });
}

function resetCallOverlays() {
  [elements.localTile, elements.callControls].forEach((element) => {
    element.style.removeProperty('left');
    element.style.removeProperty('top');
    element.style.removeProperty('right');
    element.style.removeProperty('bottom');
    element.style.removeProperty('translate');
    element.classList.remove('is-dragging');
    delete element.dataset.moved;
    delete element.dataset.positionX;
    delete element.dataset.positionY;
  });

  elements.localTile.hidden = false;
  elements.showLocalPreview.hidden = true;
  elements.callControls.classList.remove('is-collapsed');
  elements.localTile.classList.remove('is-portrait-video');
  elements.localTile.style.removeProperty('--local-aspect');
  const collapseButton = document.querySelector('#collapse-toolbar');
  collapseButton.setAttribute('aria-expanded', 'true');
  collapseButton.setAttribute('aria-label', 'Collapse toolbar');
  collapseButton.dataset.tooltip = 'Collapse';
}

function handleInviteLink() {
  if (state.inviteHandled) return;
  const legacyMatch = window.location.hash.match(/^#room\/([a-f0-9-]+)$/i);
  const roomId = invitedRoomId || legacyMatch?.[1];
  if (!roomId) return;

  state.inviteHandled = true;
  const room = findRoom(roomId);
  if (!room) {
    window.history.replaceState({}, '', window.location.pathname);
    showToast('That invite link points to a room that no longer exists.', 'error');
    return;
  }
  requireRoomAccess(room, 'join');
}

elements.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = elements.createForm.querySelector('[type="submit"]');
  const body = {
    name: document.querySelector('#create-name').value,
    description: document.querySelector('#create-description').value,
    password: document.querySelector('#create-password').value,
  };

  setFieldErrors(elements.createForm, {});
  setButtonBusy(submitButton, true, 'Creating room…');

  try {
    const data = await api('/api/rooms', { method: 'POST', body: JSON.stringify(body) });
    saveToken(data.room.id, data.token);
    elements.createForm.reset();
    await loadRooms({ quiet: true });
    showToast(`“${data.room.name}” is ready. Share its invite when you are.`);
    document.querySelector(`[data-room-id="${data.room.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    setFieldErrors(elements.createForm, error.fields || {});
    showToast(error.message, 'error');
  } finally {
    setButtonBusy(submitButton, false);
  }
});

elements.accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roomId = document.querySelector('#access-room-id').value;
  const password = document.querySelector('#access-password').value;
  const submitButton = elements.accessForm.querySelector('[type="submit"]');
  document.querySelector('#access-error').textContent = '';
  setButtonBusy(submitButton, true, 'Unlocking…');

  try {
    const data = await api(`/api/rooms/${roomId}/access`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    saveToken(roomId, data.token);
    elements.accessDialog.close();
    const room = { ...data.room };
    const index = state.rooms.findIndex((candidate) => candidate.id === roomId);
    if (index >= 0) state.rooms[index] = room;

    if (state.accessAction === 'join') await openCall(room, data.token);
    if (state.accessAction === 'edit') openEditDialog(room);
    if (state.accessAction === 'delete') openDeleteDialog(room);
  } catch (error) {
    document.querySelector('#access-error').textContent = error.message;
  } finally {
    setButtonBusy(submitButton, false);
  }
});

elements.editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roomId = document.querySelector('#edit-room-id').value;
  const password = document.querySelector('#edit-password').value;
  const body = {
    name: document.querySelector('#edit-name').value,
    description: document.querySelector('#edit-description').value,
  };
  if (password) body.password = password;

  const submitButton = elements.editForm.querySelector('[type="submit"]');
  setFieldErrors(elements.editForm, {}, 'data-edit-error-for');
  setButtonBusy(submitButton, true, 'Saving…');

  try {
    const data = await api(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${getToken(roomId)}` },
      body: JSON.stringify(body),
    });
    saveToken(roomId, data.token);
    closeDialog(elements.editDialog);
    await loadRooms({ quiet: true });
    showToast('Room details saved.');
  } catch (error) {
    if (error.status === 401) {
      forgetToken(roomId);
      closeDialog(elements.editDialog);
      openAccessDialog(findRoom(roomId), 'edit');
    } else {
      setFieldErrors(elements.editForm, error.fields || {}, 'data-edit-error-for');
      showToast(error.message, 'error');
    }
  } finally {
    setButtonBusy(submitButton, false);
  }
});

elements.deleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roomId = document.querySelector('#delete-room-id').value;
  const room = findRoom(roomId);
  const submitButton = elements.deleteForm.querySelector('[type="submit"]');
  setButtonBusy(submitButton, true, 'Deleting…');

  try {
    await api(`/api/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken(roomId)}` },
    });
    forgetToken(roomId);
    closeDialog(elements.deleteDialog);
    await loadRooms({ quiet: true });
    showToast(`“${room?.name || 'Room'}” was deleted.`);
  } catch (error) {
    if (error.status === 401) {
      forgetToken(roomId);
      closeDialog(elements.deleteDialog);
      openAccessDialog(room, 'delete');
    } else {
      showToast(error.message, 'error');
    }
  } finally {
    setButtonBusy(submitButton, false);
  }
});

elements.roomGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-room-action]');
  if (!button) return;
  const card = button.closest('[data-room-id]');
  const room = findRoom(card?.dataset.roomId);
  if (!room) return;

  const action = button.dataset.roomAction;
  if (action === 'copy') copyInvite(room.id);
  else requireRoomAccess(room, action);
});

elements.roomSearch.addEventListener('input', renderRooms);

document.querySelectorAll('[data-scroll-create]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#create-room').scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => document.querySelector('#create-name').focus(), 500);
  });
});

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.togglePassword}`);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Hide' : 'Show';
  });
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(button.closest('dialog')));
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener('cancel', () => {
    if (isInviteVisit && dialog === elements.accessDialog && !state.currentRoom) {
      window.setTimeout(() => window.location.replace('/'), 0);
    }
  });
});

async function openCall(room, token) {
  state.currentRoom = room;
  state.queuedCandidates = [];
  elements.dashboard.hidden = true;
  elements.callView.hidden = false;
  resetCallOverlays();
  updateAdaptiveVideoLayout({ adaptCamera: false });
  document.querySelector('#call-room-name').textContent = room.name;
  document.querySelector('#call-status').textContent = 'Preparing your camera…';
  document.querySelector('#participant-count').textContent = '1 / 2';
  elements.remotePlaceholder.hidden = false;
  elements.remoteVideo.srcObject = null;
  if (!isInviteVisit) window.location.hash = `room/${room.id}`;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access requires HTTPS or localhost.');
    }
    state.localStream = await navigator.mediaDevices.getUserMedia({
      video: cameraVideoConstraints(),
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    elements.localVideo.srcObject = state.localStream;
    window.requestAnimationFrame(() => updateAdaptiveVideoLayout({ adaptCamera: false }));
  } catch (error) {
    leaveCall({ updateHash: true });
    showToast(error.message || 'Camera and microphone permission is needed to join.', 'error');
    return;
  }

  document.querySelector('#call-status').textContent = 'Connecting securely…';
  state.socket = io({ auth: { roomId: room.id, token } });

  state.socket.on('connect', () => {
    document.querySelector('#call-status').textContent = 'Waiting for someone to join';
    startCallTimer();
  });

  state.socket.on('connect_error', (error) => {
    if (/unlock/i.test(error.message)) forgetToken(room.id);
    showToast(error.message, 'error');
    leaveCall({ updateHash: true });
  });

  state.socket.on('participant-count', (count) => {
    document.querySelector('#participant-count').textContent = `${count} / 2`;
  });

  state.socket.on('peer-joined', async () => {
    document.querySelector('#call-status').textContent = 'Connecting to your guest…';
    try {
      const connection = createPeerConnection();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      state.socket.emit('signal', { type: 'offer', sdp: connection.localDescription });
    } catch {
      showToast('The video connection could not be started.', 'error');
    }
  });

  state.socket.on('signal', handleSignal);
  state.socket.on('peer-left', () => {
    closePeerConnection();
    elements.remoteVideo.srcObject = null;
    elements.remoteVideo.classList.remove('fit-contain');
    elements.remotePlaceholder.hidden = false;
    document.querySelector('#call-status').textContent = 'Your guest left — waiting again';
    showToast('The other person left the room.');
  });
  state.socket.on('room-deleted', () => {
    showToast('This room was deleted by its owner.', 'error');
    leaveCall({ updateHash: true });
    loadRooms({ quiet: true });
  });
}

function createPeerConnection() {
  if (state.peerConnection) return state.peerConnection;

  const connection = new RTCPeerConnection(rtcConfiguration);
  state.peerConnection = connection;
  state.localStream?.getTracks().forEach((track) => connection.addTrack(track, state.localStream));

  connection.addEventListener('icecandidate', (event) => {
    if (event.candidate && state.socket?.connected) {
      state.socket.emit('signal', { type: 'ice-candidate', candidate: event.candidate.toJSON() });
    }
  });

  connection.addEventListener('track', (event) => {
    elements.remoteVideo.srcObject = event.streams[0];
    elements.remotePlaceholder.hidden = true;
    window.requestAnimationFrame(() => updateAdaptiveVideoLayout({ adaptCamera: false }));
  });

  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'connected') {
      document.querySelector('#call-status').textContent = 'Connected';
      elements.remotePlaceholder.hidden = true;
    }
    if (['failed', 'disconnected'].includes(connection.connectionState)) {
      document.querySelector('#call-status').textContent = 'Connection interrupted';
    }
  });

  return connection;
}

async function handleSignal(message) {
  try {
    const connection = createPeerConnection();

    if (message.type === 'offer') {
      await connection.setRemoteDescription(message.sdp);
      await flushQueuedCandidates(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      state.socket.emit('signal', { type: 'answer', sdp: connection.localDescription });
    }

    if (message.type === 'answer') {
      await connection.setRemoteDescription(message.sdp);
      await flushQueuedCandidates(connection);
    }

    if (message.type === 'ice-candidate' && message.candidate) {
      if (connection.remoteDescription) await connection.addIceCandidate(message.candidate);
      else state.queuedCandidates.push(message.candidate);
    }
  } catch {
    showToast('There was a problem negotiating the video connection.', 'error');
  }
}

async function flushQueuedCandidates(connection) {
  const candidates = state.queuedCandidates.splice(0);
  for (const candidate of candidates) await connection.addIceCandidate(candidate);
}

function closePeerConnection() {
  if (!state.peerConnection) return;
  state.peerConnection.ontrack = null;
  state.peerConnection.close();
  state.peerConnection = null;
  state.queuedCandidates = [];
}

function startCallTimer() {
  window.clearInterval(state.timer);
  state.startedAt = Date.now();
  const timerNode = document.querySelector('#call-timer');
  const update = () => {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    timerNode.textContent = hours > 0
      ? [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')
      : [minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
  };
  update();
  state.timer = window.setInterval(update, 1000);
}

function leaveCall({ updateHash = true } = {}) {
  state.socket?.disconnect();
  state.socket = null;
  closePeerConnection();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  elements.localVideo.srcObject = null;
  elements.remoteVideo.srcObject = null;
  elements.remoteVideo.classList.remove('fit-contain');
  window.clearInterval(state.timer);
  state.timer = null;
  state.currentRoom = null;
  resetCallOverlays();
  elements.callView.hidden = true;
  elements.dashboard.hidden = false;
  document.querySelector('#toggle-mic').classList.remove('is-off');
  document.querySelector('#toggle-camera').classList.remove('is-off');
  document.querySelector('#local-camera-off').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (isInviteVisit) {
    window.location.replace('/');
    return;
  }
  if (updateHash) window.history.replaceState({}, '', window.location.pathname);
  state.inviteHandled = true;
  loadRooms({ quiet: true });
}

document.querySelector('#toggle-mic').addEventListener('click', (event) => {
  const track = state.localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  event.currentTarget.classList.toggle('is-off', !track.enabled);
  event.currentTarget.setAttribute('aria-label', track.enabled ? 'Mute microphone' : 'Unmute microphone');
  event.currentTarget.dataset.tooltip = track.enabled ? 'Mute' : 'Unmute';
});

document.querySelector('#toggle-camera').addEventListener('click', (event) => {
  const track = state.localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  event.currentTarget.classList.toggle('is-off', !track.enabled);
  event.currentTarget.setAttribute('aria-label', track.enabled ? 'Turn camera off' : 'Turn camera on');
  event.currentTarget.dataset.tooltip = track.enabled ? 'Camera' : 'Camera on';
  document.querySelector('#local-camera-off').hidden = track.enabled;
});

document.querySelector('#hide-local-preview').addEventListener('click', () => {
  elements.localTile.hidden = true;
  elements.showLocalPreview.hidden = false;
  elements.showLocalPreview.focus();
});

elements.showLocalPreview.addEventListener('click', () => {
  elements.showLocalPreview.hidden = true;
  elements.localTile.hidden = false;
  window.requestAnimationFrame(() => {
    clampMovedOverlay(elements.localTile);
    document.querySelector('#hide-local-preview').focus();
  });
});

document.querySelector('#collapse-toolbar').addEventListener('click', (event) => {
  const collapsed = elements.callControls.classList.toggle('is-collapsed');
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  event.currentTarget.setAttribute('aria-label', collapsed ? 'Expand toolbar' : 'Collapse toolbar');
  event.currentTarget.dataset.tooltip = collapsed ? 'Expand' : 'Collapse';
  window.requestAnimationFrame(() => clampMovedOverlay(elements.callControls));
});

makeDraggable(elements.localTile, {
  pointerHandle: elements.localTile,
  keyboardHandle: document.querySelector('#local-drag-handle'),
  ignoreSelector: '[data-no-drag]',
});
makeDraggable(elements.callControls, {
  pointerHandle: document.querySelector('#toolbar-drag-handle'),
});

let resizeFrame;
function keepOverlaysInView() {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    updateAdaptiveVideoLayout();
  });
}

window.addEventListener('resize', keepOverlaysInView);
window.addEventListener('orientationchange', keepOverlaysInView);
window.visualViewport?.addEventListener('resize', keepOverlaysInView);
window.screen.orientation?.addEventListener('change', keepOverlaysInView);
document.addEventListener('fullscreenchange', keepOverlaysInView);
elements.localVideo.addEventListener('loadedmetadata', () => updateAdaptiveVideoLayout({ adaptCamera: false }));
elements.localVideo.addEventListener('resize', () => updateAdaptiveVideoLayout({ adaptCamera: false }));
elements.remoteVideo.addEventListener('loadedmetadata', () => updateAdaptiveVideoLayout({ adaptCamera: false }));
elements.remoteVideo.addEventListener('resize', () => updateAdaptiveVideoLayout({ adaptCamera: false }));

document.querySelector('#leave-call').addEventListener('click', () => leaveCall({ updateHash: true }));
document.querySelector('#copy-call-link').addEventListener('click', () => state.currentRoom && copyInvite(state.currentRoom.id));
document.querySelector('#copy-waiting-link').addEventListener('click', () => state.currentRoom && copyInvite(state.currentRoom.id));
document.querySelector('#fullscreen-call').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (elements.videoStage.requestFullscreen) await elements.videoStage.requestFullscreen();
    else if (elements.remoteVideo.webkitEnterFullscreen) elements.remoteVideo.webkitEnterFullscreen();
  } catch {
    showToast('Fullscreen is not available on this device.', 'error');
  }
});

window.addEventListener('beforeunload', () => {
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.socket?.disconnect();
});

loadRooms();
window.setInterval(() => {
  if (!isInviteVisit && !elements.dashboard.hidden && document.visibilityState === 'visible') loadRooms({ quiet: true });
}, 15_000);
