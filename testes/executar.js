#!/usr/bin/env node
/*
  Roda toda a verificacao automatizada do projeto.

      node testes/executar.js

  Nao precisa instalar nada — so' o Node. Sao dez etapas, em oito
  frentes (a lista canonica, com o que cada uma cobre, esta' no README,
  secao "Rodando os testes"):

  - calculo.js         — nucleo de calculo vs formula original (200 mil
                         casos) + a ligacao index.html <-> nucleo.
  - validar-html.js    — estrutura dos dois HTML: sintaxe dos <script>,
                         tags, ids, labels, arquivos referenciados, ?v=.
  - carregar-em-dom.js — executa os scripts de cada pagina num DOM
                         simulado, pegando erro em tempo de carga.
  - helpers.js         — funcoes de app-shared.js, uma a uma.
  - router.js          — roteador de telas (#Tela).
  - cotacao.js         — regras da tela de cotacao e travas de origem.
  - fornecedores.js    — separacao da Vetrus e moda dos prazos.
  - pagamentos.js      — categorias, recorrencia e filtro de periodo.
*/
const { execFileSync } = require('child_process');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const aqui = __dirname;

const etapas = [
  ['Nucleo de calculo (200k casos)', 'calculo.js', ['index.html']],
  ['Estrutura: index.html', 'validar-html.js', ['index.html']],
  ['Estrutura: controle-notas.html', 'validar-html.js', ['controle-notas.html']],
  ['Carga em DOM: index.html', 'carregar-em-dom.js', ['index.html']],
  ['Carga em DOM: controle-notas.html', 'carregar-em-dom.js', ['controle-notas.html']],
  ['Helpers de app-shared.js', 'helpers.js', []],
  ['Roteador de telas', 'router.js', []],
  ['Regras da tela de cotacao', 'cotacao.js', ['index.html']],
  ['Fornecedores e prazos', 'fornecedores.js', []],
  ['Pagamentos e recorrencia', 'pagamentos.js', []]
];

let falhou = 0;
etapas.forEach(([titulo, script, args]) => {
  console.log('\n[1m--- ' + titulo + ' ---[0m');
  try {
    const saida = execFileSync(process.execPath, [path.join(aqui, script), ...args], {
      cwd: raiz, encoding: 'utf8'
    });
    process.stdout.write(saida);
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    console.log('  >>> FALHOU');
    falhou++;
  }
});

console.log('\n' + '='.repeat(52));
if (falhou) {
  console.log('[31m' + falhou + ' etapa(s) falharam.[0m');
  process.exitCode = 1;
} else {
  console.log('[32mTodas as ' + etapas.length + ' etapas passaram.[0m');
}
