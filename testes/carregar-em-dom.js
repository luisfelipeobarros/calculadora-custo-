// Executa app-shared.js + o script da pagina num DOM simulado.
// Pega referencias quebradas, colisoes de nome e erros em tempo de carga.
const fs = require('fs');
const vm = require('vm');
const { instalar } = require('./dom-falso.js');

const arquivo = process.argv[2];
const html = fs.readFileSync(arquivo, 'utf8');

// Todos os ids presentes no markup viram elementos de verdade.
const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]);
const { window } = instalar([...new Set(ids)]);

const contexto = vm.createContext(window);
const erros = [];

// 1) app-shared.js
try {
  vm.runInContext(fs.readFileSync('app-shared.js', 'utf8'), contexto, { filename: 'app-shared.js' });
} catch (e) {
  erros.push('app-shared.js: ' + e.message);
}

// 2) blocos <script> inline nao-modulo
const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .filter(m => !/type=["']module["']/.test(m[0]))
  .map(m => m[1]);

blocos.forEach((codigo, i) => {
  try {
    vm.runInContext(codigo, contexto, { filename: arquivo + ' bloco ' + (i + 1) });
  } catch (e) {
    erros.push('bloco ' + (i + 1) + ': ' + e.message);
  }
});

console.log('== ' + arquivo + ' (execucao em DOM simulado) ==');
console.log('  ids no markup: ' + ids.length + ' | blocos executados: ' + blocos.length);
if (window.App) {
  console.log('  App exportado com ' + Object.keys(window.App).length + ' membros');
}
if (erros.length) {
  erros.forEach(e => console.log('  [X] ' + e));
  console.log('  >>> ' + erros.length + ' ERRO(S) EM TEMPO DE CARGA');
  process.exitCode = 1;
} else {
  console.log('  >>> carregou sem erros');
}
