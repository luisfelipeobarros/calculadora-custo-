/*
  DANFE simplificado: as duas leituras deterministicas que ele faz.

  - ufDaChave: os 2 primeiros digitos da chave de acesso sao o codigo
    IBGE da UF do emitente (definicao do padrao da NF-e). Codigo
    desconhecido ou chave fora do padrao devolvem null — a tela mostra
    "—", nunca chuta.
  - classificarCfop: 1o digito = ambito (5 interna / 6 interestadual /
    7 exterior); grupo x.4xx = regime de ST, sendo 5405/6404 "ST retida
    anteriormente" (a nota vem sem cobranca e esta' CERTA assim);
    grupo x.1xx = venda sem ST. Grupo desconhecido -> st null, sem
    rotulo inventado.

  As funcoes moram no app-shared.js (o DANFE e' compartilhado entre o
  Controle de Notas e a NF-e Emitidas da Calculadora) e o teste carrega
  o modulo de verdade — o mesmo que as duas telas usam.
*/
const App = require('../app-shared.js');
const m = { ufDaChave: App.ufDaChave, classificarCfop: App.classificarCfop };

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── UF pela chave de acesso ──────────────────────────────────

const chavePE = '26260703428529000107550010003747371460563119';
eq('chave começando em 26 -> Pernambuco', m.ufDaChave(chavePE), 'PE (Pernambuco)');
eq('chave começando em 35 -> São Paulo',
  m.ufDaChave('35' + chavePE.substring(2)), 'SP (São Paulo)');
eq('codigo IBGE inexistente (99) -> null, nunca chute',
  m.ufDaChave('99' + chavePE.substring(2)), null);
eq('chave fora do padrao (curta) -> null', m.ufDaChave('2626'), null);
eq('chave vazia -> null', m.ufDaChave(''), null);

// ── Classificacao do CFOP ────────────────────────────────────

eq('5102: interna, venda sem ST',
  m.classificarCfop('5102'), { ambito: 'interna (mesmo estado do fornecedor)', st: 'venda sem ST' });
eq('6102: interestadual, venda sem ST',
  m.classificarCfop('6102'), { ambito: 'interestadual', st: 'venda sem ST' });
eq('6401: interestadual, venda com ST',
  m.classificarCfop('6401'), { ambito: 'interestadual', st: 'venda com ST' });
eq('5401: interna, venda com ST',
  m.classificarCfop('5401'), { ambito: 'interna (mesmo estado do fornecedor)', st: 'venda com ST' });

// 5405/6404: a ST foi retida numa etapa ANTERIOR — a nota vem sem
// cobranca e esta' certa assim. Rotular como "venda com ST" faria a
// checagem cruzada acusar divergencia em nota legitima.
eq('5405: ST retida anteriormente, nao "venda com ST"',
  m.classificarCfop('5405').st, 'ST retida anteriormente (sem cobrança nesta nota)');
eq('6404: idem no interestadual',
  m.classificarCfop('6404').st, 'ST retida anteriormente (sem cobrança nesta nota)');

eq('7101: exterior', m.classificarCfop('7101').ambito, 'exterior');
// Grupo que nao conhecemos (x.9xx): ambito sai, rotulo de ST nao.
eq('5910 (brinde/outras): ambito sem rotulo de ST',
  m.classificarCfop('5910'), { ambito: 'interna (mesmo estado do fornecedor)', st: null });
// CFOP de ENTRADA (1xxx/2xxx) nao e' o que o XML do fornecedor traz;
// se aparecer, melhor nao classificar do que classificar errado.
eq('CFOP de entrada (1102) -> null', m.classificarCfop('1102'), null);
eq('CFOP invalido -> null', m.classificarCfop('abc'), null);
eq('CFOP vazio -> null', m.classificarCfop(''), null);

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
