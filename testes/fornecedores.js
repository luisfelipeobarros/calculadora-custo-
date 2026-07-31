/*
  A aba "Fornecedores e prazos": separacao de fornecedor por produto e
  moda dos prazos.

  A regra do negocio aqui e' "o prazo que MAIS SE REPETE", nunca uma
  media — media esconderia exatamente o que a tela existe para mostrar.
  Estes testes travam isso.
*/
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'controle-notas.html'), 'utf8');

function extrair(nome){
  const i = html.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome + ' em controle-notas.html');
  let d = 0, j = html.indexOf('{', i);
  for(; j < html.length; j++){
    if(html[j] === '{') d++;
    else if(html[j] === '}'){ d--; if(d === 0) break; }
  }
  return html.slice(i, j + 1);
}

const regras = (html.match(/var REGRAS_FORNECEDOR = \[[\s\S]*?\];/) || [])[0];
if(!regras) throw new Error('nao achei REGRAS_FORNECEDOR');

const norm = s => String(s == null ? '' : s).toLowerCase();
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const duplicatas = [];

const m = new Function('norm', 'diasEntre', 'duplicatas',
  regras + '\n' + extrair('fornecedorDaNota') + '\n' + extrair('indexarDuplicatas') + '\n' +
  extrair('prazosDaNota') + '\n' +
  extrair('rotuloPrazo') + '\n' + extrair('prazosProximos') + '\n' + extrair('agruparPrazos') + '\n' +
  'return { fornecedorDaNota, indexarDuplicatas, prazosDaNota, rotuloPrazo, prazosProximos, agruparPrazos };'
)(norm, diasEntre, duplicatas);

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => a === b ? ok(t) : erro(t + ' — esperava "' + b + '", veio "' + a + '"');

// ── Os numeros que a tela usa ────────────────────────────────
const TOLERANCIA = Number((html.match(/var TOLERANCIA_PRAZO = (\d+)/) || [])[1]);
const MAX_VISIVEIS = Number((html.match(/var MAX_PRAZOS_VISIVEIS = (\d+)/) || [])[1]);
eq('a tolerancia da tela e de 5 dias', TOLERANCIA, 5);
eq('a tela mostra 4 prazos antes de agrupar o resto', MAX_VISIVEIS, 4);
// A tolerancia deixou de ser opcional: nao pode sobrar caixa de selecao.
eq('nao ha mais caixa de "agrupar prazos"', /id="tolerarPrazo"/.test(html), false);
eq('e o render usa a constante, nao um numero solto',
  /var tol = TOLERANCIA_PRAZO;/.test(html), true);

// ── Separacao da Vetrus por produto ──────────────────────────
// A Vetrus vende duas linhas, e nada na nota diz qual e': so' o produto.
eq('Vetrus com 46x46 -> Severo',
  m.fornecedorDaNota({ nomeEmitente:'VETRUS S A', produtosResumo:['PISO 46X46 STELA','RODAPE'] }),
  'Vetrus (Severo)');
eq('Vetrus sem 46x46 -> Pamesa',
  m.fornecedorDaNota({ nomeEmitente:'Vetrus S.A. em Recuperacao Judicial', produtosResumo:['PORCELANATO 62x62'] }),
  'Vetrus (Pamesa)');
eq('Vetrus sem produtos -> Pamesa (o padrao)',
  m.fornecedorDaNota({ nomeEmitente:'VETRUS', produtosResumo:[] }),
  'Vetrus (Pamesa)');
// A regra vale SO' para o fornecedor dela: 46x46 de outro nao muda nada.
eq('46x46 em outro fornecedor nao aplica a regra',
  m.fornecedorDaNota({ nomeEmitente:'CERAMICA BRASILEIRA CERBRAS LTDA', produtosResumo:['PISO 46x46'] }),
  'CERAMICA BRASILEIRA CERBRAS LTDA');
// Maiuscula/minuscula do termo nao pode mudar o resultado.
eq('o termo casa sem depender de caixa',
  m.fornecedorDaNota({ nomeEmitente:'vetrus', produtosResumo:['piso 46x46 branco'] }),
  'Vetrus (Severo)');

// ── Prazo de uma nota ────────────────────────────────────────
duplicatas.push(
  { chaveAcesso:'k1', vencimento:'2026-07-03' },
  { chaveAcesso:'k1', vencimento:'2026-07-17' },
  { chaveAcesso:'k1', vencimento:'2026-07-31' },
  { chaveAcesso:'k2', vencimento:null },              // sem vencimento: fora do indice
  { chaveAcesso:'k3', vencimento:'2026-02-10' });

// O indice e' montado UMA vez por render. Antes prazosDaNota varria a
// lista inteira de duplicatas por nota, e o custo crescia ao quadrado:
// 4.000 notas x 8.000 duplicatas levavam 622 ms contra 21 ms com indice.
const idx = m.indexarDuplicatas();
eq('o indice agrupa por chave de acesso', (idx['k1'] || []).length, 3);
eq('duplicata sem vencimento fica fora do indice', idx['k2'], undefined);
eq('chave sem duplicata nao aparece no indice', idx['zzz'], undefined);

eq('prazo da NFe real da Cerbras (emissao 24/04)',
  m.rotuloPrazo(m.prazosDaNota({ id:'k1', dataEmissao:'2026-04-24' }, idx)), '70/84/98');
eq('nota sem duplicata conta como a vista',
  m.rotuloPrazo(m.prazosDaNota({ id:'sem', dataEmissao:'2026-01-01' }, idx)), 'à vista');
// Sem data de emissao nao ha' prazo: a nota fica de fora em vez de
// entrar com um numero inventado.
eq('nota sem data de emissao fica de fora',
  m.prazosDaNota({ id:'k1' }, idx), null);
// A nota so' enxerga as duplicatas DELA — o indice nao pode vazar.
eq('o indice nao mistura duplicatas de outra nota',
  m.rotuloPrazo(m.prazosDaNota({ id:'k3', dataEmissao:'2026-01-01' }, idx)), '40');

// ── Moda, e nunca media ──────────────────────────────────────
const amostra = [
  [70,84,98], [70,84,98], [70,84,99], [70,85,98], [70,84,98],
  [60,75,90], [60,75,90],
  [30]
];

// tol = 0 e' o agrupamento exato. A tela nao usa mais esse modo, mas o
// caso continua valendo como prova de que a funcao nao aproxima sozinha.
const exato = m.agruparPrazos(amostra, 0);
eq('exato: o vencedor e o prazo literalmente mais repetido', exato[0].rotulo, '70/84/98');
eq('exato: ele cobre so 3 notas', exato[0].qtd, 3);
eq('exato: cada jitter vira um grupo (5 no total)', exato.length, 5);

// E' assim que a tela roda: TOLERANCIA_PRAZO dias de folga.
const tol = m.agruparPrazos(amostra, TOLERANCIA);
eq('com a tolerancia da tela, o vencedor absorve o jitter', tol[0].qtd, 5);
// O rotulo continua sendo uma variante REAL, a mais comum do grupo —
// se virasse media daria 70/84.33/98.33, que nunca existiu.
eq('e o rotulo continua sendo um prazo que existiu de verdade', tol[0].rotulo, '70/84/98');
eq('com tolerancia sobram 3 grupos', tol.length, 3);

// 60/75/90 esta' a 10 dias de 70/84/98: longe demais para virar o mesmo
// grupo. A folga cobre feriado e fim de semana, nao negociacao diferente.
eq('a folga nao junta negociacoes de verdade diferentes',
  tol.filter(g => g.rotulo === '60/75/90').length, 1);

// Parcelamentos de tamanhos diferentes sao negociacoes diferentes e nao
// podem cair no mesmo grupo, por mais proximos que os primeiros sejam.
const misto = m.agruparPrazos([[30,60],[30,60,90],[30,60]], 3);
eq('30/60 e 30/60/90 nao se misturam', misto.length, 2);
eq('e o mais frequente entre eles vence', misto[0].rotulo, '30/60');

// Ordenacao: sempre do mais frequente para o menos.
const ordenado = m.agruparPrazos([[10],[20],[20],[30],[20],[10]], 0);
const qtds = ordenado.map(g => g.qtd);
eq('grupos saem ordenados por frequencia', JSON.stringify(qtds), JSON.stringify([3,2,1]));

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
