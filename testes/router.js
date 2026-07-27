// Testes do roteador de telas (App.criarRouter).
//
// O caso que motivou este arquivo: abrir a "Pesquisa de concorrentes em
// lote" mostrava a tela e, um instante depois, o app pulava sozinho de
// volta para a Calculadora. Causa: o hashchange disparado pela propria
// navegacao do app era tratado como "link colado" e caia no filtro das
// telas que dependem de um registro selecionado.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- DOM minimo com eventos e location.hash de verdade ---
function montar() {
  const elementos = {};
  const ouvintes = {};
  const win = {
    location: { href: 'http://x/app.html', _hash: '' },
    addEventListener(tipo, fn) { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
    removeEventListener() {},
    scrollTo() {},
    setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number,
    Set, Map, RegExp, Error, isNaN, parseFloat, parseInt, console, URL,
    document: {
      getElementById(id) {
        if (!elementos[id]) elementos[id] = { id: id, style: { display: '' }, setAttribute() {}, removeAttribute() {}, appendChild() {}, addEventListener() {} };
        return elementos[id];
      },
      createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } }; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      addEventListener() {},
      body: { appendChild() {} },
      activeElement: null
    },
    localStorage: { _d: {}, getItem(k) { return this._d[k] == null ? null : this._d[k]; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } }
  };
  // location.hash se comporta como no navegador: setar dispara hashchange
  // (de forma assincrona, igual ao browser de verdade).
  Object.defineProperty(win.location, 'hash', {
    get() { return this._hash; },
    set(v) {
      const novo = v.charAt(0) === '#' ? v : '#' + v;
      if (novo === this._hash) return;
      this._hash = novo;
      pendentes.push(() => (ouvintes.hashchange || []).forEach(fn => fn()));
    }
  });
  const pendentes = [];
  win.window = win;
  win.self = win;
  return { win, elementos, drenar: () => { while (pendentes.length) pendentes.shift()(); } };
}

const { win, elementos, drenar } = montar();
const ctx = vm.createContext(win);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'app-shared.js'), 'utf8'), ctx, { filename: 'app-shared.js' });

let ok = 0, falhas = 0;
function conferir(nome, obtido, esperado) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) { ok++; return; }
  falhas++;
  console.log('  [X] ' + nome + '\n      esperado: ' + JSON.stringify(esperado) +
              '\n      obtido:   ' + JSON.stringify(obtido));
}

const entradas = [];
const router = win.App.criarRouter({
  views: { Calculadora: 'vCalc', Historico: 'vHist', Comparar: 'vCmp', PesquisaLote: 'vLote' },
  padrao: 'Calculadora',
  naoRestauraveis: ['Comparar', 'PesquisaLote'],
  aoEntrar: {
    Historico: () => entradas.push('Historico'),
    PesquisaLote: () => entradas.push('PesquisaLote')
  }
});

const vis = id => win.document.getElementById(id).style.display;
const telaAtiva = () => ['vCalc', 'vHist', 'vCmp', 'vLote'].filter(id => vis(id) === 'block');

router.iniciar();
conferir('abre na tela padrao', telaAtiva(), ['vCalc']);

// --- O bug relatado ---
router.ir('Historico');
drenar();
conferir('vai para o Historico', telaAtiva(), ['vHist']);

router.ir('PesquisaLote');
conferir('abre a pesquisa em lote', telaAtiva(), ['vLote']);
drenar(); // <- aqui o app pulava de volta para a Calculadora
conferir('NAO volta sozinho apos o hashchange', telaAtiva(), ['vLote']);
drenar(); drenar();
conferir('continua na tela com hashchange repetido', telaAtiva(), ['vLote']);
conferir('hash acompanha a tela', win.location.hash, '#PesquisaLote');

// --- Mesma armadilha na comparacao com NF-e ---
router.ir('Historico'); drenar();
router.ir('Comparar');
drenar();
conferir('comparacao com NF-e tambem fica', telaAtiva(), ['vCmp']);

// --- Navegacao vinda de fora continua protegida ---
router.ir('Historico'); drenar();
win.location.hash = 'PesquisaLote'; // link colado / Voltar do navegador
drenar();
conferir('link direto para tela sem contexto cai na padrao', telaAtiva(), ['vCalc']);

win.location.hash = 'TelaInexistente';
drenar();
conferir('hash desconhecido cai na padrao', telaAtiva(), ['vCalc']);

win.location.hash = 'Historico';
drenar();
conferir('Voltar para tela normal funciona', telaAtiva(), ['vHist']);

// --- aoEntrar dispara uma vez por navegacao, nao a cada hashchange ---
const antes = entradas.filter(e => e === 'PesquisaLote').length;
router.ir('PesquisaLote');
drenar(); drenar();
const depois = entradas.filter(e => e === 'PesquisaLote').length;
conferir('aoEntrar roda uma vez so', depois - antes, 1);

// --- Uma so' tela visivel por vez, sempre ---
conferir('nunca ha duas telas abertas', telaAtiva().length, 1);

console.log('  ' + ok + ' verificacoes passaram' + (falhas ? ', ' + falhas + ' falharam' : ''));
if (falhas) { console.log('  >>> ' + falhas + ' FALHA(S)'); process.exitCode = 1; }
else console.log('  >>> tudo certo');
