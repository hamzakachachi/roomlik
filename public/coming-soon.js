const trigger = document.querySelector('#preview-trigger');
const dialog = document.querySelector('#password-dialog');
const form = document.querySelector('#password-form');
const password = document.querySelector('#admin-password');
const error = document.querySelector('#password-error');
const submit = document.querySelector('#submit-password');
let clickCount = 0;
let clickTimer;

function openPasswordDialog() {
  clickCount = 0;
  window.clearTimeout(clickTimer);
  if (!dialog.open) dialog.showModal();
  password.value = '';
  error.textContent = '';
  window.setTimeout(() => password.focus(), 50);
}

trigger.addEventListener('dblclick', openPasswordDialog);
trigger.addEventListener('click', () => {
  clickCount += 1;
  window.clearTimeout(clickTimer);
  if (clickCount >= 2) {
    openPasswordDialog();
    return;
  }
  clickTimer = window.setTimeout(() => { clickCount = 0; }, 500);
});

document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Checking…';

  try {
    const response = await fetch('/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Access denied.');
    }

    window.location.reload();
  } catch (requestError) {
    error.textContent = requestError.message;
    password.select();
  } finally {
    submit.disabled = false;
    submit.textContent = 'Enter';
  }
});
