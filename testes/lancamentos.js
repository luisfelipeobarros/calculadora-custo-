/*
  Lancamentos contabeis (lancamentos.html + nucleo).

  O que estes testes travam:
  - as partidas dobradas montadas pelo app (a funcionaria NUNCA
    escolhe D/C): saida = D categoria / C banco; entrada = D banco /
    C categoria; transferencia = D destino / C origem — e nada de
    partida com dado faltando;
  - pendencia (sem data ou sem valor) e que a EXPORTACAO estoura em
    vez de queimar numero de lancamento com linha lixo;
  - em qual arquivo a transferencia sai: no banco de MOVIMENTO (como
    na amostra real do contador), origem em caso de empate;
  - o layout de 19 colunas: sem cabecalho, duas linhas por
    lancamento (D primeiro), numero com 8 digitos, historico em
    maiusculas, constantes nas colunas certas e os DOIS contadores
    continuos entre exportacoes;
  - os seeds com a acentuacao corrigida (os JSONs de origem vieram
    com UTF-8 lido como Latin-1: "ItaÃº", "CombustÃ­vel").
*/
const App = require('../app-shared.js');
const L = require('../lancamentos-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── Partidas dobradas ────────────────────────────────────────

const bradesco = { conta: '1.1.1.2.0001', tipo: 'movimento' };
const pagueveloz = { conta: '1.1.1.4.0006', tipo: 'vinculada' };
const combustivel = { conta: '4.2.1.1.0024' };

eq('saida: D categoria / C banco',
  L.montarPartidas('saida', bradesco, combustivel, null),
  { debito: '4.2.1.1.0024', credito: '1.1.1.2.0001' });
eq('entrada: D banco / C categoria',
  L.montarPartidas('entrada', bradesco, { conta: '1.1.2.1.0001' }, null),
  { debito: '1.1.1.2.0001', credito: '1.1.2.1.0001' });
eq('transferencia: D destino / C origem',
  L.montarPartidas('transferencia', pagueveloz, null, bradesco),
  { debito: '1.1.1.2.0001', credito: '1.1.1.4.0006' });
eq('saida sem categoria nao monta (null, nunca partida pela metade)',
  L.montarPartidas('saida', bradesco, null, null), null);
eq('transferencia sem destino nao monta',
  L.montarPartidas('transferencia', bradesco, null, null), null);
eq('transferencia para a MESMA conta nao monta',
  L.montarPartidas('transferencia', bradesco, null, { conta: '1.1.1.2.0001' }), null);
eq('tipo desconhecido nao monta', L.montarPartidas('zzz', bradesco, combustivel, null), null);

// ── Pendencia ────────────────────────────────────────────────

const completo = { data: '2026-07-06', valor: 90.88,
  contaDebito: '4.2.1.1.0036', contaCredito: '1.1.1.2.0001' };
eq('sem data e pendente', L.pendente(Object.assign({}, completo, { data: null })), true);
eq('sem valor e pendente', L.pendente(Object.assign({}, completo, { valor: null })), true);
eq('valor zero e pendente (nao ha lancamento de zero)',
  L.pendente(Object.assign({}, completo, { valor: 0 })), true);
eq('sem a partida montada e pendente (pagamento sem conta mapeada)',
  L.pendente({ data: '2026-07-06', valor: 90.88 }), true);
eq('completo nao e pendente', L.pendente(completo), false);

// ── Filtro e totais ──────────────────────────────────────────

const lista = [
  { id: 'a', mes: '2026-07', data: '2026-07-06', valor: 90.88, tipo: 'saida',
    bancoId: 'bradesco', categoriaId: 'agua', historico: 'Valor ref a Compesa', fornecedor: 'Compesa',
    contaDebito: '4.2.1.1.0036', contaCredito: '1.1.1.2.0001' },
  { id: 'b', mes: '2026-07', data: '2026-07-01', valor: 174673, tipo: 'transferencia',
    bancoId: 'pagueveloz', bancoDestinoId: 'bradesco', historico: 'Transf PagueVeloz/Bradesco',
    contaDebito: '1.1.1.2.0001', contaCredito: '1.1.1.4.0006' },
  { id: 'c', mes: '2026-07', data: null, valor: null, tipo: 'saida',
    bancoId: 'bradesco', categoriaId: 'energia', historico: 'Conta de luz Neo Energia',
    contaDebito: '4.2.1.1.0034', contaCredito: '1.1.1.2.0001' },
  { id: 'd', mes: '2026-08', data: '2026-08-02', valor: 50, tipo: 'entrada',
    bancoId: 'itau', categoriaId: 'receb_clientes', historico: 'Recebimento',
    contaDebito: '1.1.1.2.0002', contaCredito: '1.1.2.1.0001' }
];

eq('filtro por mes', L.filtrarLancamentos(lista, { mes: '2026-07' }).length, 3);
eq('filtro por banco pega origem E destino da transferencia',
  L.filtrarLancamentos(lista, { mes: '2026-07', bancoId: 'bradesco' }).map(l => l.id), ['a', 'b', 'c']);
eq('filtro por tipo', L.filtrarLancamentos(lista, { tipo: 'entrada' }).map(l => l.id), ['d']);
eq('busca sem acento no historico ("compesa")',
  L.filtrarLancamentos(lista, { termo: 'compesa' }).map(l => l.id), ['a']);
{
  const t = L.totaisDoFiltro(L.filtrarLancamentos(lista, { mes: '2026-07' }));
  eq('totais: transferencia NAO soma em saida nem entrada',
    [t.saidas, t.entradas, t.transferencias], [90.88, 0, 174673]);
  eq('totais: pendencias contadas', t.pendencias, 1);
}

// ── Em qual arquivo a transferencia sai ──────────────────────

const bancos = {
  bradesco: { tipo: 'movimento' }, itau: { tipo: 'movimento' },
  pagueveloz: { tipo: 'vinculada' }, picpay: { tipo: 'vinculada' }
};
eq('lancamento comum sai no proprio banco',
  L.bancoDoArquivo({ tipo: 'saida', bancoId: 'bradesco' }, bancos), 'bradesco');
eq('vinculada -> movimento sai no arquivo do MOVIMENTO (a amostra real)',
  L.bancoDoArquivo({ tipo: 'transferencia', bancoId: 'pagueveloz', bancoDestinoId: 'bradesco' }, bancos), 'bradesco');
eq('movimento -> vinculada tambem fica no movimento',
  L.bancoDoArquivo({ tipo: 'transferencia', bancoId: 'bradesco', bancoDestinoId: 'picpay' }, bancos), 'bradesco');
eq('movimento -> movimento: empate fica na ORIGEM',
  L.bancoDoArquivo({ tipo: 'transferencia', bancoId: 'itau', bancoDestinoId: 'bradesco' }, bancos), 'itau');
eq('agrupar poe cada lancamento no arquivo certo',
  Object.keys(L.agruparPorArquivo([
    { tipo: 'saida', bancoId: 'itau' },
    { tipo: 'transferencia', bancoId: 'pagueveloz', bancoDestinoId: 'bradesco' }
  ], bancos)).sort(), ['bradesco', 'itau']);

// ── Nome do arquivo ──────────────────────────────────────────

eq('nome do arquivo sem o C/C e com o mes por extenso',
  L.nomeArquivo({ nome: 'Bradesco C/C' }, '2026-08'), 'BANCO BRADESCO AGOSTO 2026.xlsx');
eq('nome com acento preservado',
  L.nomeArquivo({ nome: 'Caixa Econômica Ag. 4253' }, '2026-03'), 'BANCO CAIXA ECONÔMICA AG. 4253 MARÇO 2026.xlsx');

// ── Layout de 19 colunas ─────────────────────────────────────

{
  const r = L.linhasExportacao([
    { data: '2026-07-06', valor: 90.88, historico: 'Valor ref a Compesa',
      contaDebito: '4.2.1.1.0036', contaCredito: '1.1.1.2.0001' },
    { data: '2026-07-02', valor: 6032.47, historico: 'Operação capital de giro 18/36',
      contaDebito: '1.1.2.4.0001', contaCredito: '1.1.1.2.0001' }
  ], { lancamento: 8902, linha: 1130342 });

  eq('duas linhas por lancamento', r.linhas.length, 4);
  eq('ordenado pela DATA, nao pela ordem de digitacao (02/07 vem antes)',
    r.linhas[0][1], '02/07/2026');
  eq('numero do lancamento com 8 digitos e zeros a esquerda', r.linhas[0][0], '00008902');
  eq('as duas pernas com o MESMO numero', r.linhas[1][0], '00008902');
  eq('perna a DEBITO primeiro', [r.linhas[0][6], r.linhas[1][6]], ['D', 'C']);
  eq('conta da perna certa (D na coluna 6)', r.linhas[2][5], '4.2.1.1.0036');
  eq('valor nas colunas 3 e 8', [r.linhas[2][2], r.linhas[2][7]], [90.88, 90.88]);
  eq('historico em MAIUSCULAS', r.linhas[2][11], 'VALOR REF A COMPESA');
  eq('constantes: col 4 = 1, col 9 = CNPJ|inscricao, col 13 = N, col 14 = D',
    [r.linhas[0][3], r.linhas[0][8], r.linhas[0][12], r.linhas[0][13]],
    [1, '04226489000175|027797147', 'N', 'D']);
  eq('col 19 e sequencial continuo de LINHA',
    r.linhas.map(l => l[18]), [1130342, 1130343, 1130344, 1130345]);
  eq('sao 19 colunas', r.linhas[0].length, 19);
  eq('devolve os contadores prontos para a proxima exportacao',
    [r.proximoLancamento, r.proximaLinha], [8904, 1130346]);

  // Pendente na exportacao e ERRO — a tela barra antes; se passar, o
  // nucleo estoura em vez de queimar numeracao com linha lixo.
  let estourou = false;
  try{ L.linhasExportacao([{ historico: 'sem data' }], { lancamento: 1, linha: 1 }); }
  catch(e){ estourou = true; }
  eq('lancamento pendente na exportacao estoura, nunca exporta lixo', estourou, true);
}

// ── Pagamento do Controle de Notas vira lancamento ───────────

const mapa = { fornecedor: 'forn_mercadoria', juros: 'juros',
  internas: { folha: 'salarios' } };
const bancosPag = { bradesco: { conta: '1.1.1.2.0001', tipo: 'movimento' } };
const categoriasPag = {
  forn_mercadoria: { conta: '2.1.1.1.0001' },
  juros: { conta: '4.2.4.1.0002' },
  salarios: { conta: '2.1.4.1.0001' }
};

{
  // Duplicata de 1.000 paga com 1.030: principal + juros de 30.
  const docs = L.lancamentosDePagamento({
    tipo: 'fornecedor', id: 'ABC1', data: '2026-09-02', valor: 1000,
    valorPago: 1030, bancoId: 'bradesco',
    historico: 'PAGTO CERBRAS NF 375912', fornecedor: 'CERBRAS', numeroDoc: '375912'
  }, mapa, bancosPag, categoriasPag);
  eq('paga com juros: DOIS lancamentos', docs.length, 2);
  eq('ids DETERMINISTICOS (pagar de novo nao duplica; desfazer sabe o que apagar)',
    docs.map(d => d.id), ['dup_ABC1', 'jurosdup_ABC1']);
  eq('principal: valor da DIVIDA e partida D fornecedor / C banco',
    [docs[0].doc.valor, docs[0].doc.contaDebito, docs[0].doc.contaCredito],
    [1000, '2.1.1.1.0001', '1.1.1.2.0001']);
  eq('juros: a DIFERENCA, na conta de juros',
    [docs[1].doc.valor, docs[1].doc.contaDebito, docs[1].doc.historico],
    [30, '4.2.4.1.0002', 'JUROS PAGTO CERBRAS NF 375912']);
  eq('mes derivado da data do pagamento', docs[0].doc.mes, '2026-09');
  eq('origem gravada para rastreio', docs[0].doc.origemId, 'dup_ABC1');
}
{
  // Interno mapeado (folha -> salarios), pago sem juros: um doc so'.
  const docs = L.lancamentosDePagamento({
    tipo: 'interno', id: 'X9', data: '2026-09-05', valor: 5000,
    valorPago: 5000, bancoId: 'bradesco',
    historico: 'PAGTO FOLHA', categoriaInterna: 'folha'
  }, mapa, bancosPag, categoriasPag);
  eq('interno sem juros: um lancamento (int_)', docs.map(d => d.id), ['int_X9']);
  eq('categoria interna mapeada -> conta de salarios',
    docs[0].doc.contaDebito, '2.1.4.1.0001');
}
{
  // Sem mapa/banco o PAGAMENTO nao trava: o doc nasce sem partida e
  // fica pendente no app de Lancamentos.
  const docs = L.lancamentosDePagamento({
    tipo: 'interno', id: 'Y1', data: '2026-09-05', valor: 100,
    valorPago: 100, bancoId: null,
    historico: 'PAGTO SEGURANCA', categoriaInterna: 'seguranca'
  }, mapa, bancosPag, categoriasPag);
  eq('sem mapa: doc criado SEM partida', [docs[0].doc.contaDebito, docs[0].doc.contaCredito], [null, null]);
  eq('  ...e por isso pendente (a exportacao barra)', L.pendente(docs[0].doc), true);
}
{
  // Sujeira de float no valor pago nao inventa juros de meio centavo.
  const docs = L.lancamentosDePagamento({
    tipo: 'fornecedor', id: 'Z', data: '2026-09-02', valor: 1000,
    valorPago: 1000.004, bancoId: 'bradesco', historico: 'PAGTO X'
  }, mapa, bancosPag, categoriasPag);
  eq('diferenca que arredonda para zero nao vira juros', docs.length, 1);
}

// As categorias internas espelhadas aqui TEM que existir no
// controle-notas.html — se uma categoria mudar la', este teste grita.
{
  const fs = require('fs');
  const path = require('path');
  const htmlControle = fs.readFileSync(path.resolve(__dirname, '..', 'controle-notas.html'), 'utf8');
  const sumidas = L.CATEGORIAS_CONTROLE
    .map(c => c.valor)
    .filter(v => htmlControle.indexOf("valor: '" + v + "'") === -1);
  eq('todas as categorias do espelho existem no controle-notas.html',
    sumidas.join(',') || 'nenhuma sumida', 'nenhuma sumida');
}

// ── Seeds com acentuacao corrigida ───────────────────────────

eq('Itaú com acento no seed de bancos', L.SEED_BANCOS.itau.nome, 'Itaú C/C');
eq('Caixa Econômica com acento', L.SEED_BANCOS.caixa_economica.nome, 'Caixa Econômica Ag. 4253');
eq('Combustível com acento no seed de categorias', L.SEED_CATEGORIAS.combustivel.nome, 'Combustível');
eq('Água, Salários e 13º corrigidos',
  [L.SEED_CATEGORIAS.agua.nome, L.SEED_CATEGORIAS.salarios.nome, L.SEED_CATEGORIAS.decimo.nome],
  ['Água', 'Salários', '13º salário a pagar']);
{
  const quebrado = Object.keys(L.SEED_CATEGORIAS).filter(k =>
    /Ã|Â/.test(L.SEED_CATEGORIAS[k].nome + L.SEED_CATEGORIAS[k].obs + L.SEED_CATEGORIAS[k].grupo));
  eq('nenhum seed sobrou com encoding quebrado', quebrado.join(','), '');
  eq('40 categorias no seed', Object.keys(L.SEED_CATEGORIAS).length, 40);
  eq('12 bancos no seed', Object.keys(L.SEED_BANCOS).length, 12);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
