const fs = require('fs');
const arquivo = process.argv[2];
const html = fs.readFileSync(arquivo, 'utf8');
let problemas = 0;
const erro = (m) => { console.log('  [X] ' + m); problemas++; };
const ok = (m) => console.log('  [ok] ' + m);

console.log('== ' + arquivo + ' ==');

// Estrutura: so' o markup estatico, antes dos <script>, e sem o
// conteudo de <style> — comentarios de CSS citam nomes de tag
// ("as tres linhas sao <span> dentro de um <button>") e isso
// desequilibraria a contagem sem nenhum problema real existir.
const corte = html.indexOf('<script');
const estatico = (corte === -1 ? html : html.slice(0, corte))
  .replace(/<style[\s\S]*?<\/style>/g, '');

// 1) Sintaxe dos blocos <script> inline
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
scripts.forEach((m, i) => {
  const ehModulo = /type=["']module["']/.test(m[0]);
  if (ehModulo) { console.log('  (bloco ' + (i + 1) + ' e modulo ESM - checado a parte)'); return; }
  try { new Function(m[1]); ok('sintaxe do bloco <script> ' + (i + 1)); }
  catch (e) { erro('sintaxe no bloco <script> ' + (i + 1) + ': ' + e.message); }
});

// 2) Balanceamento de tags no markup estatico
const VAZIAS = ['input', 'img', 'br', 'hr', 'meta', 'link'];
['div', 'main', 'table', 'thead', 'tbody', 'nav', 'header', 'footer',
 'button', 'select', 'tr', 'td', 'th', 'label', 'span', 'p', 'a', 'textarea'].forEach(tag => {
  if (VAZIAS.includes(tag)) return;
  const a = (estatico.match(new RegExp('<' + tag + '(?=[ >])', 'g')) || []).length;
  const f = (estatico.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  if (a !== f) erro('<' + tag + '> desbalanceada no markup: ' + a + ' aberturas vs ' + f + ' fechamentos');
});
ok('balanceamento de tags verificado');

// 3) IDs duplicados
const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]);
const idsEstaticos = [...estatico.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]);
const dup = idsEstaticos.filter((v, i) => idsEstaticos.indexOf(v) !== i);
if (dup.length) erro('ids duplicados: ' + [...new Set(dup)].join(', '));
else ok(idsEstaticos.length + ' ids unicos no markup');

// 4) Todo $('x') precisa existir
const usados = new Set();
[...html.matchAll(/\$\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)].forEach(m => usados.add(m[1]));
[...html.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)].forEach(m => usados.add(m[1]));
const faltando = [...usados].filter(id => !ids.includes(id));
if (faltando.length) erro('$() aponta para id inexistente: ' + faltando.join(', '));
else ok('todos os ' + usados.size + ' $() apontam para ids existentes');

// 5) label for= casa com um campo
const fors = [...html.matchAll(/<label[^>]*\sfor=["']([^"']+)["']/g)].map(m => m[1]);
const forOrfao = fors.filter(f => !ids.includes(f) && !html.includes("id='" + f) && !html.includes('id="' + f));
if (forOrfao.length) erro('label for= sem campo: ' + forOrfao.join(', '));
else ok(fors.length + ' labels casam com campos');

// 6) arquivos locais referenciados existem
//    O "?v=N" no fim e' so' quebra de cache; o arquivo em disco nao tem isso.
const refs = [...html.matchAll(/(?:href|src)=["'](?!https?:|data:|#)([^"']+)["']/g)].map(m => m[1]);
refs.forEach(r => {
  const caminho = r.split('?')[0].split('#')[0];
  if (!fs.existsSync(caminho)) erro('arquivo referenciado nao existe: ' + caminho);
});
ok('refs locais: ' + refs.join(', '));

// 7) os arquivos compartilhados precisam de ?v=, senao o navegador
//    continua servindo a copia antiga depois de um deploy.
['app-shared.css', 'app-shared.js', 'calculo-nucleo.js', 'dda-nucleo.js'].forEach(nome => {
  const semVersao = new RegExp('(?:href|src)=["\']' + nome.replace('.', '\\.') + '["\']');
  if (semVersao.test(html)) erro(nome + ' referenciado sem ?v= (quebra de cache)');
});

// 8) href com dado dinamico precisa passar por safeUrl
const hrefsDinamicos = [...html.matchAll(/href='\s*\+\s*([A-Za-z0-9_.()]+)/g)].map(m => m[1]);
hrefsDinamicos.forEach(h => {
  if (!/safeUrl|escapeHtml\(link\)|escapeHtml\(url/.test(h)) {
    console.log('  [?] conferir href dinamico: ' + h);
  }
});

// 9) alert/confirm nativos nao devem sobrar
const nativos = (html.match(/(?<![.\w])(alert|confirm)\s*\(/g) || []);
if (nativos.length) erro('ainda usa ' + nativos.length + ' alert()/confirm() nativo(s)');
else ok('sem alert()/confirm() nativos');

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
