// ====== SETTINGS ======
// The Apps Script web app link (ends with /exec)
const API_URL = 'https://script.google.com/macros/s/AKfycbxntJAFTBwmo6aLH9X7_15D1zLey2XRmKJLHDbJk5FhZeClIEy88O9iCppbVnHIwCv6UA/exec';

// ====== STATE ======
let animals = [];      // all animals from the sheet
let queue = [];        // animals the user has not decided on yet
let lastSwipe = null;  // the last decision, so we can undo it once

// Decisions are remembered on this device: { animalId: 'like' | 'pass' }
let decisions = loadDecisions();

// ====== ELEMENTS ======
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

// ====== STORAGE ======
function loadDecisions() {
  try {
    return JSON.parse(localStorage.getItem('decisions')) || {};
  } catch (e) {
    return {};
  }
}

function saveDecisions() {
  try {
    localStorage.setItem('decisions', JSON.stringify(decisions));
  } catch (e) {}
}

// ====== LOADING ======
async function loadAnimals() {
  try {
    const res = await fetch(API_URL + '?action=animals');
    animals = await res.json();
    buildQueue();
    showCurrent();
  } catch (err) {
    statusEl.textContent = 'Nepavyko užkrauti gyvūnų. Pabandykite vėliau.';
    console.error(err);
  }
}

function buildQueue() {
  queue = animals.filter(function (a) { return !decisions[a.id]; });
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
  if (n % 10 === 1) return n + ' metai';
  return n + ' metai';
}

// ====== BUTTONS ======
function decide(choice) {
  if (queue.length === 0) return;
  const a = queue.shift();
  decisions[a.id] = choice;
  saveDecisions();
  lastSwipe = a;
  // Step 6 (later): if choice === 'like', send the like to the shelter's file
  showCurrent();
}

function undo() {
  if (!lastSwipe) return;
  delete decisions[lastSwipe.id];
  saveDecisions();
  queue.unshift(lastSwipe);
  lastSwipe = null; // only one step back is allowed
  showCurrent();
}

function resetAll() {
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

// ====== START ======
loadAnimals();
