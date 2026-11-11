#!/usr/bin/env node
/*
  Versoes (?v=) dos arquivos compartilhados — 11/11/2026.

  O navegador guarda app-shared.css, app-shared.js e os *-nucleo.js em
  cache; os HTML os referenciam com "?v=N" e, ao mexer num deles, o
  numero TEM de subir (README, "Sempre que alterar..."). Ate' aqui isso
  dependia de memoria. Este teste trava duas coisas:

  1. Todos os HTML apontam a MESMA versao de cada arquivo (inclusive o
     dashboard.html, que carrega o app-shared.js por uma string no JS).
  2. Arquivo que mudou de conteudo mudou de versao. O conteudo de cada
     versao fica registrado em testes/versoes.json (um hash por arquivo).

  Fluxo ao alterar um arquivo compartilhado:
      1) suba o ?v= dele em todos os HTML que o carregam;
      2) node testes/versoes.js --gravar     (registra o hash novo)
  Sem o passo 1 o teste acusa "mudou e a versao nao subiu"; sem o passo
  2, acusa "registro desatualizado" e diz o comando.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raiz = path.resolve(__dirname, '..');
const arquivoRegistro = path.join(__dirname, 'versoes.json');
const gravar = process.argv.indexOf('--gravar') !== -1;

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };

const compartilhados = fs.readdirSync(raiz)
  .filter(f => f === 'app-shared.css' || f === 'app-shared.js' || /-nucleo\.js$/.test(f))
  .sort();
const paginas = fs.readdirSync(raiz).filter(f => /\.html$/.test(f)).sort();

// Fim de linha normalizado: o mesmo arquivo tem de dar o mesmo hash no
// Windows (CRLF) e no GitHub (LF).
function hashDe(nome) {
  const texto = fs.readFileSync(path.join(raiz, nome), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

// nome -> { versao: [paginas] }
const usos = {};
paginas.forEach(pagina => {
  const html = fs.readFileSync(path.join(raiz, pagina), 'utf8');
  compartilhados.forEach(nome => {
    const re = new RegExp(nome.replace(/[.]/g, '\\.') + '\\?v=(\\d+)', 'g');
    let m;
    while ((m = re.exec(html))) {
      const u = (usos[nome] = usos[nome] || {});
      (u[m[1]] = u[m[1]] || []).push(pagina);
    }
  });
});

const atual = {};
compartilhados.forEach(nome => {
  const versoes = Object.keys(usos[nome] || {});
  if (!versoes.length) { erro(nome + ' não é carregado por nenhum HTML (arquivo órfão?)'); return; }
  if (versoes.length > 1) {
    erro(nome + ' com versões diferentes: ' + versoes.map(v => '?v=' + v + ' em ' + usos[nome][v].join(', ')).join(' | '));
    return;
  }
  atual[nome] = { v: Number(versoes[0]), hash: hashDe(nome) };
});
if (!problemas) ok('cada arquivo compartilhado tem UMA versão em todos os HTML (' + compartilhados.length + ' arquivos, ' + paginas.length + ' páginas)');

if (gravar) {
  if (problemas) { console.log('  >>> corrija o que está acima antes de gravar'); process.exit(1); }
  fs.writeFileSync(arquivoRegistro, JSON.stringify(atual, null, 2) + '\n');
  console.log('  registro gravado em testes/versoes.json');
  process.exit(0);
}

let registro = {};
try { registro = JSON.parse(fs.readFileSync(arquivoRegistro, 'utf8')); }
catch (e) { erro('testes/versoes.json não existe ou está ilegível — rode: node testes/versoes.js --gravar'); }

let mudouSemSubir = 0, desatualizado = 0;
Object.keys(atual).forEach(nome => {
  const a = atual[nome], r = registro[nome];
  if (!r) { desatualizado++; erro(nome + ' não está no registro'); return; }
  if (a.hash !== r.hash && a.v <= r.v) {
    mudouSemSubir++;
    erro(nome + ' MUDOU e a versão não subiu (continua ?v=' + a.v + '): os navegadores vão usar a cópia antiga do cache. ' +
      'Suba para ?v=' + (r.v + 1) + ' em todos os HTML que o carregam.');
  } else if (a.hash !== r.hash || a.v !== r.v) {
    desatualizado++;
    erro(nome + ': registro desatualizado (versão ' + r.v + ' → ' + a.v + ')');
  }
});
if (desatualizado && !mudouSemSubir) console.log('  as versões estão certas; falta registrar: node testes/versoes.js --gravar');
if (!problemas) ok('nenhum arquivo compartilhado mudou sem subir a versão');

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
