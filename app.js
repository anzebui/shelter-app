// ====== SETTINGS ======
// The Apps Script web app link (ends with /exec)
const API_URL = 'https://script.google.com/macros/s/AKfycbxntJAFTBwmo6aLH9X7_15D1zLey2XRmKJLHDbJk5FhZeClIEy88O9iCppbVnHIwCv6UA/exec';
// The Google sign-in Client ID (public, safe to keep here)
const GOOGLE_CLIENT_ID = '1066031956958-ljrjikacborkfg21ue0b0dk7141bl6sp.apps.googleusercontent.com';

// ====== STATE ======
let session = null;    // { token, exp, email, name }
let profile = null;    // the user's saved onboarding answers
let animals = [];      // all animals from the sheet
let queue = [];        // animals the user has not decided on yet
let lastSwipe = null;  // the last decision, so we can undo it once
let decisions = {};    // { animalId: 'like' | 'pass' } for this user, on this device

// ====== ELEMENTS ======
const screens = {
  loading: document.getElementById('loadingScreen'),
  login: document.getElementById('loginScreen'),
  onboard: document.getElementById('onboardScreen'),
  swipe: document.getElementById('swipeScreen'),
  matches: document.getElementById('matchesScreen')
};
const tabsEl = document.getElementById('tabs');
const tabAnimals = document.getElementById('tabAnimals');
const tabMatches = document.getElementById('tabMatches');
const matchesStatus = document.getElementById('matchesStatus');
const matchesList = document.getElementById('matchesList');
const refreshMatchesBtn = document.getElementById('refreshMatchesBtn');
const loginMessage = document.getElementById('loginMessage');

const form = document.getElementById('onboardForm');
const formError = document.getElementById('formError');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelOnboardBtn = document.getElementById('cancelOnboardBtn');

const statusEl = document.getElementById('status');
const cardEl = document.getElementById('card');
const photoEl = document.getElementById('photo');
const nameEl = document.getElementById('name');
const subtitleEl = document.getElementById('subtitle');
const tagsEl = document.getElementById('tags');
const buttonsEl = document.getElementById('buttons');
const counterEl = document.getElementById('counter');
const undoBtn = document.getElementById('undoBtn');
const passBtn = document.getElementById('passBtn');
const likeBtn = document.getElementById('likeBtn');
const resetBtn = document.getElementById('resetBtn');
const editProfileBtn = document.getElementById('editProfileBtn');
const logoutBtn = document.getElementById('logoutBtn');

function showScreen(name) {
  Object.keys(screens).forEach(function (key) {
    screens[key].classList.toggle('hidden', key !== name);
  });
  // The two tabs are only shown on the animals and matches screens
  const showTabs = name === 'swipe' || name === 'matches';
  tabsEl.classList.toggle('hidden', !showTabs);
  tabAnimals.classList.toggle('active', name === 'swipe');
  tabMatches.classList.toggle('active', name === 'matches');
  window.scrollTo(0, 0);
}

// ====== SESSION (who is signed in) ======
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem('session'));
    // Google sign-in tokens last about 1 hour; ignore ones about to expire
    if (s && s.token && s.exp * 1000 > Date.now() + 60000) return s;
  } catch (e) {}
  return null;
}

function saveSession(s) {
  try { localStorage.setItem('session', JSON.stringify(s)); } catch (e) {}
}

function clearSession() {
  try { localStorage.removeItem('session'); } catch (e) {}
}

// Reads the name/email inside the Google token (only for showing in the app;
// the backend checks the token properly itself)
function decodeJwt(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(part).split('').map(function (c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join('')
  );
  return JSON.parse(json);
}

// ====== DECISIONS (remembered per user, on this device) ======
function decisionsKey() {
  return 'decisions_' + (session ? session.email : 'anon');
}

function loadDecisions() {
  try {
    return JSON.parse(localStorage.getItem(decisionsKey())) || {};
  } catch (e) {
    return {};
  }
}

function saveDecisions() {
  try { localStorage.setItem(decisionsKey(), JSON.stringify(decisions)); } catch (e) {}
}

// ====== TALKING TO THE BACKEND ======
async function api(action, extra) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      // no custom headers on purpose: keeps it a "simple" request that Apps Script accepts
      body: JSON.stringify(Object.assign({ action: action, idToken: session.token }, extra || {}))
    });
    return await res.json();
  } catch (err) {
    console.error(err);
    return { error: 'network' };
  }
}

// ====== LOGIN ======
function showLogin(message) {
  showScreen('login');
  if (message) {
    loginMessage.textContent = message;
    loginMessage.classList.remove('hidden');
  } else {
    loginMessage.classList.add('hidden');
  }
  initGoogle();
}

// The Google script loads in the background, so wait until it is ready
function initGoogle() {
  let tries = 0;
  const timer = setInterval(function () {
    tries++;
    if (window.google && google.accounts && google.accounts.id) {
      clearInterval(timer);
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredential,
        auto_select: true
      });
      const holder = document.getElementById('googleBtn');
      holder.innerHTML = '';
      google.accounts.id.renderButton(holder, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'lt'
      });
    } else if (tries > 100) {
      clearInterval(timer);
      loginMessage.textContent = 'Nepavyko užkrauti Google prisijungimo. Perkraukite puslapį.';
      loginMessage.classList.remove('hidden');
    }
  }, 100);
}

async function handleCredential(response) {
  try {
    const p = decodeJwt(response.credential);
    session = { token: response.credential, exp: p.exp, email: p.email, name: p.name || '' };
    saveSession(session);
    await afterLogin();
  } catch (err) {
    console.error(err);
    showLogin('Prisijungti nepavyko. Bandykite dar kartą.');
  }
}

function logout(message) {
  clearSession();
  session = null;
  profile = null;
  animals = [];
  queue = [];
  lastSwipe = null;
  decisions = {};
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  showLogin(message);
}

// After signing in: do we already know this person?
async function afterLogin() {
  showScreen('loading');
  const res = await api('getProfile');

  if (res.error === 'invalid_token') {
    logout('Sesija baigėsi. Prisijunkite iš naujo.');
    return;
  }
  if (res.error) {
    showLogin('Nepavyko susisiekti su serveriu. Bandykite vėliau.');
    return;
  }

  profile = res.profile;
  decisions = loadDecisions();

  if (profile && profile.consent === 'taip') {
    await openSwipe();
  } else {
    openOnboarding();
  }
}

// ====== ONBOARDING ======
function openOnboarding() {
  formError.classList.add('hidden');
  saveProfileBtn.disabled = false;

  // Fill the form with what we already know (or the Google name)
  form.elements.fullName.value = (profile && profile.name) || (session && session.name) || '';
  form.elements.phone.value = (profile && profile.phone) || '';
  setChecked('purpose', profile ? profile.purpose : '');
  setChecked('animals', profile ? profile.animals : '');
  setRadio('housing', profile ? profile.housing : '');
  setRadio('kids', profile ? profile.kids : '');
  setRadio('pets', profile ? profile.pets : '');
  setRadio('disabledOk', profile ? profile.disabledOk : '');
  form.elements.adult.checked = !!profile;
  form.elements.consent.checked = false;

  // "Cancel" only makes sense when editing an existing profile
  cancelOnboardBtn.classList.toggle('hidden', !(profile && profile.consent === 'taip'));
  showScreen('onboard');
}

function setChecked(name, joinedValues) {
  const values = String(joinedValues || '').split(', ');
  form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
    input.checked = values.indexOf(input.value) !== -1;
  });
}

function setRadio(name, value) {
  form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
    input.checked = input.value === value;
  });
}

function getChecked(name) {
  return Array.from(form.querySelectorAll('input[name="' + name + '"]:checked'))
    .map(function (i) { return i.value; })
    .join(', ');
}

function getRadio(name) {
  const r = form.querySelector('input[name="' + name + '"]:checked');
  return r ? r.value : '';
}

function showFormError(text) {
  formError.textContent = text;
  formError.classList.remove('hidden');
  formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('submit', async function (event) {
  event.preventDefault();

  const data = {
    name: form.elements.fullName.value.trim(),
    phone: form.elements.phone.value.trim(),
    purpose: getChecked('purpose'),
    animals: getChecked('animals'),
    housing: getRadio('housing'),
    kids: getRadio('kids'),
    pets: getRadio('pets'),
    disabledOk: getRadio('disabledOk'),
    adult: form.elements.adult.checked,
    consent: form.elements.consent.checked
  };

  // Check everything is filled in
  if (data.name.length < 3) return showFormError('Įveskite vardą ir pavardę.');
  if (data.phone.replace(/\D/g, '').length < 8) return showFormError('Įveskite teisingą telefono numerį.');
  if (!data.purpose) return showFormError('Pasirinkite bent vieną priežastį.');
  if (!data.animals) return showFormError('Pasirinkite bent vieną gyvūnų rūšį.');
  if (!data.housing) return showFormError('Pasirinkite, kur gyvenate.');
  if (!data.kids) return showFormError('Atsakykite, ar turite vaikų iki 14 metų.');
  if (!data.pets) return showFormError('Atsakykite, ar turite kitų augintinių.');
  if (!data.disabledOk) return showFormError('Atsakykite, ar galėtumėte priimti neįgalų augintinį.');
  if (!data.adult) return showFormError('Programėle gali naudotis tik pilnamečiai.');
  if (!data.consent) return showFormError('Reikia sutikimo dalytis duomenimis su prieglaudomis.');

  formError.classList.add('hidden');
  saveProfileBtn.disabled = true;

  const res = await api('saveProfile', { profile: data });

  if (res.error === 'invalid_token') {
    logout('Sesija baigėsi. Prisijunkite iš naujo.');
    return;
  }
  if (res.error || !res.ok) {
    saveProfileBtn.disabled = false;
    showFormError('Nepavyko išsaugoti. Bandykite dar kartą.');
    return;
  }

  profile = {
    name: data.name,
    phone: data.phone,
    purpose: data.purpose,
    animals: data.animals,
    housing: data.housing,
    kids: data.kids,
    pets: data.pets,
    disabledOk: data.disabledOk,
    consent: 'taip'
  };
  lastSwipe = null;
  await openSwipe();
});

cancelOnboardBtn.addEventListener('click', function () {
  openSwipe();
});

// ====== ANIMALS ======
async function openSwipe() {
  showScreen('swipe');
  flushOps(); // send any likes that are still waiting
  cardEl.classList.add('hidden');
  buttonsEl.classList.add('hidden');
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Kraunama...';

  if (animals.length === 0) {
    try {
      const res = await fetch(API_URL + '?action=animals');
      animals = await res.json();
    } catch (err) {
      statusEl.textContent = 'Nepavyko užkrauti gyvūnų. Pabandykite vėliau.';
      console.error(err);
      return;
    }
  }
  buildQueue();
  showCurrent();
}

// Only show the species the user said they are interested in
function wantedSpecies(a) {
  const wants = (profile && profile.animals) || '';
  const wantsDogs = wants.indexOf('Šunys') !== -1;
  const wantsCats = wants.indexOf('Katės') !== -1;
  if (!wantsDogs && !wantsCats) return true;
  const s = String(a.species).toLowerCase();
  if (s.indexOf('šuo') === 0) return wantsDogs;
  if (s.indexOf('katė') === 0) return wantsCats;
  return true;
}

function buildQueue() {
  queue = animals.filter(function (a) {
    return wantedSpecies(a) && !decisions[a.id];
  });
}

// ====== SHOWING A CARD ======
function showCurrent() {
  undoBtn.disabled = !lastSwipe;

  if (queue.length === 0) {
    cardEl.classList.add('hidden');
    buttonsEl.classList.remove('hidden');
    passBtn.disabled = true;
    likeBtn.disabled = true;
    statusEl.classList.remove('hidden');
    statusEl.textContent = animals.length
      ? 'Šiuo metu daugiau gyvūnų nėra. Užsukite vėliau! 🐾'
      : 'Gyvūnų kol kas nėra.';
    counterEl.textContent = '';
    return;
  }

  const a = queue[0];
  statusEl.classList.add('hidden');
  cardEl.classList.remove('hidden');
  buttonsEl.classList.remove('hidden');
  passBtn.disabled = false;
  likeBtn.disabled = false;

  photoEl.src = a.photo;
  photoEl.alt = a.name;
  nameEl.textContent = a.name;
  subtitleEl.textContent = a.species + ' · ' + ageText(a.age) + ' · ' + a.sex + ' · ' + a.shelter;

  tagsEl.innerHTML = '';
  addTag('Ieško: ' + a.lookingFor);
  addTag('Reikalingas plotas: ' + a.space);
  addTag(a.withKids === 'taip' ? 'Sutaria su vaikais' : 'Nesutaria su vaikais', a.withKids !== 'taip');
  addTag(a.withAnimals === 'taip' ? 'Sutaria su kitais gyvūnais' : 'Nesutaria su kitais gyvūnais', a.withAnimals !== 'taip');
  if (a.disabled === 'taip') {
    addTag('Neįgalumas: ' + (a.disability || 'taip'), true);
  }

  counterEl.textContent = 'Liko peržiūrėti: ' + queue.length;
}

function addTag(text, warn) {
  const el = document.createElement('span');
  el.className = 'tag' + (warn ? ' warn' : '');
  el.textContent = text;
  tagsEl.appendChild(el);
}

function ageText(age) {
  const n = Number(age);
  if (n === 0) return 'iki 1 metų';
  if (n === 1) return '1 metai';
  if (n % 10 === 0 || (n >= 11 && n <= 19)) return n + ' metų';
  return n + ' metai';
}

// ====== MATCHES ======
async function openMatches() {
  showScreen('matches');
  matchesStatus.classList.remove('hidden');
  matchesStatus.textContent = 'Kraunama...';
  matchesList.innerHTML = '';

  const res = await api('getMatches');

  if (res.error === 'invalid_token') {
    logout('Sesija baigėsi. Prisijunkite iš naujo.');
    return;
  }
  if (res.error || !res.matches) {
    matchesStatus.textContent = 'Nepavyko užkrauti sutapimų. Bandykite vėliau.';
    return;
  }
  if (res.matches.length === 0) {
    matchesStatus.textContent = 'Kol kas sutapimų nėra. Prieglaudos peržiūri jūsų anketas — užsukite vėliau! 🐾';
    return;
  }

  matchesStatus.classList.add('hidden');
  res.matches.forEach(function (m) {
    matchesList.appendChild(buildMatchCard(m));
  });
}

function buildMatchCard(m) {
  const card = document.createElement('div');
  card.className = 'card match';

  if (m.photo) {
    const img = document.createElement('img');
    img.className = 'photo small-photo';
    img.src = m.photo;
    img.alt = m.animalName;
    card.appendChild(img);
  }

  const info = document.createElement('div');
  info.className = 'info';

  const title = document.createElement('h2');
  title.textContent = m.animalName + ' 💚';
  info.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'subtitle';
  const bits = [m.species, m.age !== '' ? ageText(m.age) : '', m.sex].filter(function (x) { return x; });
  sub.textContent = bits.join(' · ');
  info.appendChild(sub);

  const lead = document.createElement('p');
  lead.className = 'match-lead';
  lead.textContent = 'Prieglauda „' + m.shelter + '“ nori su jumis susisiekti!';
  info.appendChild(lead);

  const lines = document.createElement('div');
  lines.className = 'contact';
  if (m.phone) lines.appendChild(contactLine('📞', m.phone, 'tel:' + m.phone.replace(/[^\d+]/g, '')));
  if (m.email) lines.appendChild(contactLine('✉️', m.email, 'mailto:' + m.email));
  if (m.hours) lines.appendChild(contactLine('🕘', m.hours));
  if (m.city) lines.appendChild(contactLine('📍', m.city));
  info.appendChild(lines);

  card.appendChild(info);
  return card;
}

function contactLine(icon, text, href) {
  const row = document.createElement('p');
  row.className = 'contact-line';
  row.appendChild(document.createTextNode(icon + ' '));
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    row.appendChild(a);
  } else {
    row.appendChild(document.createTextNode(text));
  }
  return row;
}

// Back to the animal cards without reloading them
function backToAnimals() {
  if (animals.length === 0) {
    openSwipe();
  } else {
    showScreen('swipe');
    showCurrent();
  }
}

// ====== SENDING LIKES TO THE SHELTER ======
// Likes (and un-likes) wait in a small list on this device and are sent one by one.
// If the internet drops, they stay in the list and are sent later.
let flushing = false;
let inFlight = null; // the request being sent right now

function opsKey() {
  return 'ops_' + (session ? session.email : 'anon');
}

function loadOps() {
  try {
    return JSON.parse(localStorage.getItem(opsKey())) || [];
  } catch (e) {
    return [];
  }
}

function saveOps(ops) {
  try { localStorage.setItem(opsKey(), JSON.stringify(ops)); } catch (e) {}
}

function queueOp(type, animalId) {
  const ops = loadOps();
  // If a like was never sent yet, un-liking just cancels it
  const idx = ops.findIndex(function (o) {
    return o.type === 'like' && o.animalId === animalId;
  });
  const isSendingNow = inFlight && inFlight.type === 'like' && inFlight.animalId === animalId;
  if (type === 'unlike' && idx !== -1 && !isSendingNow) {
    ops.splice(idx, 1);
  } else {
    ops.push({ type: type, animalId: animalId });
  }
  saveOps(ops);
  flushOps();
}

async function flushOps() {
  if (flushing || !session) return;
  flushing = true;
  try {
    let ops = loadOps();
    while (ops.length > 0) {
      const op = ops[0];
      inFlight = op;
      const res = await api(op.type, { animalId: op.animalId });
      inFlight = null;

      if (res.error === 'invalid_token') {
        flushing = false;
        logout('Sesija baigėsi. Prisijunkite iš naujo.');
        return;
      }
      if (res.error === 'network') break; // keep it in the list, try again later
      if (res.error) console.warn('Server refused', op, res.error);

      // Done (or permanently refused): remove this request from the list
      ops = loadOps();
      const i = ops.findIndex(function (o) {
        return o.type === op.type && o.animalId === op.animalId;
      });
      if (i !== -1) ops.splice(i, 1);
      saveOps(ops);
    }
  } finally {
    inFlight = null;
    flushing = false;
  }
}

window.addEventListener('online', flushOps);

// ====== BUTTONS ======
function decide(choice) {
  if (queue.length === 0) return;
  const a = queue.shift();
  decisions[a.id] = choice;
  saveDecisions();
  lastSwipe = a;
  if (choice === 'like') queueOp('like', a.id);
  showCurrent();
}

function undo() {
  if (!lastSwipe) return;
  const wasLike = decisions[lastSwipe.id] === 'like';
  delete decisions[lastSwipe.id];
  saveDecisions();
  if (wasLike) queueOp('unlike', lastSwipe.id);
  queue.unshift(lastSwipe);
  lastSwipe = null; // only one step back is allowed
  showCurrent();
}

// For testing: forget all decisions and also withdraw all likes
function resetAll() {
  Object.keys(decisions).forEach(function (id) {
    if (decisions[id] === 'like') queueOp('unlike', id);
  });
  decisions = {};
  saveDecisions();
  lastSwipe = null;
  buildQueue();
  showCurrent();
}

passBtn.addEventListener('click', function () { decide('pass'); });
likeBtn.addEventListener('click', function () { decide('like'); });
undoBtn.addEventListener('click', undo);
resetBtn.addEventListener('click', resetAll);
editProfileBtn.addEventListener('click', openOnboarding);
tabAnimals.addEventListener('click', backToAnimals);
tabMatches.addEventListener('click', openMatches);
refreshMatchesBtn.addEventListener('click', openMatches);
logoutBtn.addEventListener('click', function () { logout(); });

// ====== START ======
function start() {
  session = loadSession();
  if (session) {
    afterLogin();
  } else {
    showLogin();
  }
}

start();
