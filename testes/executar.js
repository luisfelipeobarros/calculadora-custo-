#!/usr/bin/env node
/*
  Roda toda a verificacao automatizada do projeto.

      node testes/executar.js

  Nao precisa instalar nada — so' o Node. Sao vinte e duas etapas,
  em dezesseis frentes (a lista canonica, com o que cada uma cobre,
  esta' no README, secao "Rodando os testes"):

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
  - dda.js             — leitura do DDA do Bradesco (contra a camada de
                         texto real do PDF) e casamento boleto/duplicata.
  - painel.js          — Painel de metas: dias uteis, limite de 60% e a
                         previsao de faturamento do mes corrente.
  - simulador.js       — Simulador de compra: parcelas em centavos,
                         rampa de 12 meses e projecao de recorrentes.
  - danfe.js           — DANFE simplificado: UF pela chave de acesso e
                         classificacao da operacao pelo CFOP.
  - concorrentes.js    — catalogo da pesquisa em lote por planilha:
                         leitura, consulta de busca, diff e o painel
                         de desatualizacao por fabricante.
  - assistencias.js    — app de assistencias/reclamacoes: resumo,
                         filtro, duplicidade de sequencia e exportacao.
  - lancamentos.js     — lancamentos contabeis: partidas dobradas,
                         pendencias, arquivo da transferencia e o
                         layout de 19 colunas do contador.
*/
const { execFileSync } = require('child_process');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const aqui = __dirname;

const etapas = [
  ['Nucleo de calculo (200k casos)', 'calculo.js', ['index.html']],
  ['Estrutura: index.html', 'validar-html.js', ['index.html']],
  ['Estrutura: controle-notas.html', 'validar-html.js', ['controle-notas.html']],
  ['Estrutura: assistencias.html', 'validar-html.js', ['assistencias.html']],
  ['Estrutura: lancamentos.html', 'validar-html.js', ['lancamentos.html']],
  ['Carga em DOM: index.html', 'carregar-em-dom.js', ['index.html']],
  ['Carga em DOM: controle-notas.html', 'carregar-em-dom.js', ['controle-notas.html']],
  ['Carga em DOM: assistencias.html', 'carregar-em-dom.js', ['assistencias.html']],
  ['Carga em DOM: lancamentos.html', 'carregar-em-dom.js', ['lancamentos.html']],
  ['Helpers de app-shared.js', 'helpers.js', []],
  ['Roteador de telas', 'router.js', []],
  ['Regras da tela de cotacao', 'cotacao.js', ['index.html']],
  ['Fornecedores e prazos', 'fornecedores.js', []],
  ['Pagamentos e recorrencia', 'pagamentos.js', []],
  ['Conferencia de DDA (Bradesco)', 'dda.js', []],
  ['Painel de metas', 'painel.js', []],
  ['Simulador de compra', 'simulador.js', []],
  ['DANFE simplificado', 'danfe.js', []],
  ['Fiscal (NCM & ST)', 'fiscal.js', []],
  ['Concorrentes em lote (planilha)', 'concorrentes.js', []],
  ['Assistencias e reclamacoes', 'assistencias.js', []],
  ['Lancamentos contabeis', 'lancamentos.js', []]
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
