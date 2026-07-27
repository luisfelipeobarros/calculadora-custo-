// DOM minimo, so' o suficiente para executar os scripts das paginas e
// detectar referencias quebradas / erros em tempo de carga.
function criarElemento(tag, id) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    srcdoc: '',
    className: '',
    type: '',
    noValidate: false,
    autocomplete: '',
    required: false,
    style: new Proxy({}, { get: (t, k) => t[k] || '', set: (t, k, v) => { t[k] = v; return true; } }),
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {},
    setAttribute(k, v) { if (k === 'id') this.id = v; this['attr_' + k] = v; },
    getAttribute(k) { return this['attr_' + k]; },
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    click() {},
    closest() { return null; },
    contains() { return true; },
    querySelector() { return null; },
    querySelectorAll() { const a = []; a.forEach = Array.prototype.forEach; return a; },
    insertBefore() {},
    remove() {}
  };
  return el;
}

function instalar(ids) {
  const cache = {};
  ids.forEach(id => { cache[id] = criarElemento('div', id); });

  const document = {
    getElementById(id) { return cache[id] || null; },
    createElement(tag) { return criarElemento(tag); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      // [data-toggle] precisa devolver algo com dataset.toggle
      if (sel && sel.includes('data-toggle')) {
        return ['credIcmsFrete', 'comST', 'prejuizoContabil', 'tipoBonificacao'].map(k => {
          const e = criarElemento('div');
          e.dataset.toggle = k;
          e.querySelectorAll = () => [];
          e.querySelector = () => criarElemento('button');
          return e;
        });
      }
      return [];
    },
    addEventListener() {},
    body: criarElemento('body'),
    documentElement: criarElemento('html'),
    activeElement: null
  };

  const localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };

  const window = {
    document, localStorage,
    location: { href: 'http://localhost/x.html', hash: '', search: '' },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, Number, String, Object, Array, Set, Map, RegExp, Error, isNaN, parseFloat, parseInt,
    console, URL,
    navigator: { onLine: true },
    CSS: { escape: s => String(s) },
    firebase: criarFirebaseFalso()
  };
  window.window = window;
  window.self = window;
  return { window, document, localStorage, cache };
}

function criarFirebaseFalso() {
  const doc = {
    get: () => Promise.resolve({ exists: false, data: () => ({}) }),
    set: () => Promise.resolve(),
    update: () => Promise.resolve(),
    delete: () => Promise.resolve()
  };
  const query = {
    where() { return query; },
    orderBy() { return query; },
    limit() { return query; },
    get: () => Promise.resolve({ forEach() {}, docs: [], empty: true, docChanges: () => [] }),
    onSnapshot() { return () => {}; }
  };
  const col = Object.assign({
    doc: () => doc,
    add: () => Promise.resolve({ id: 'novo' })
  }, query);
  const db = {
    collection: () => col,
    batch: () => ({ set() {}, commit: () => Promise.resolve() }),
    enablePersistence: () => Promise.resolve()
  };
  const auth = { onAuthStateChanged() {}, signInWithEmailAndPassword: () => Promise.resolve({ user: {} }), signOut: () => Promise.resolve() };
  const app = { name: 'x', firestore: () => db, auth: () => auth, delete: () => Promise.resolve() };
  const fb = function () { return app; };
  fb.apps = [];
  fb.initializeApp = () => app;
  fb.firestore = { FieldValue: { serverTimestamp: () => 'ts' } };
  return fb;
}

module.exports = { instalar, criarElemento };
