#!/usr/bin/env node
/*
  Roda toda a verificacao automatizada do projeto.

      node testes/executar.js

  Nao precisa instalar nada — so' o Node. Sao quatro etapas:

  1. calculo.js         — compara o nucleo de calculo atual com a formula
                          original, em 200 mil casos aleatorios. E' a rede
                          de seguranca contra mexer nas aliquotas sem querer.
  2. validar-html.js    — sintaxe dos <script>, tags balanceadas, ids
                          duplicados, $() apontando para ids inexistentes,
                          labels orfas, arquivos referenciados que sumiram.
  3. carregar-em-dom.js — executa app-shared.js + o script de cada pagina
                          num DOM simulado, pegando referencia quebrada e
                          erro em tempo de carga.
  4. helpers            — testes diretos das funcoes de app-shared.js.
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
