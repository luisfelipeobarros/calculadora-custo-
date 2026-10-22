/*
  App de Etiquetas (etiquetas.html + nucleo).

  O que estes testes travam:
  - a situacao de cada linha a partir do estado da nota (entrou no
    ERP = recebida; cancelada some) e do documento de etiqueta
    (etiquetada / dispensada / retirada);
  - uma linha por item de cada NF-e, com o fornecedor rotulado pela
    MESMA regra das outras telas e id chave_n estavel;
  - contagem, ordem (acao primeiro) e filtro (grupo + busca com chips);
  - as vermelhas: pendentes, e a dica quando o produto aparece faturado;
  - o relatorio: so' o que retirar, o que etiquetar e as vermelhas,
    agrupado por fornecedor, tudo escapado.
*/
const App = require('../app-shared.js');
const N = require('../etiquetas-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── Situacao ─────────────────────────────────────────────────

eq('nao recebida, sem etiqueta: etiquetar', N.situacaoDe(false, null), 'etiquetar');
eq('nao recebida, etiquetada: em transito', N.situacaoDe(false, { etiquetada: true }), 'transito');
eq('nao recebida, dispensada: sem etiqueta', N.situacaoDe(false, { dispensada: true }), 'dispensada');
eq('recebida com etiqueta: RETIRAR', N.situacaoDe(true, { etiquetada: true }), 'retirar');
eq('recebida, etiqueta retirada: concluida', N.situacaoDe(true, { etiquetada: true, retirada: true }), 'concluida');
eq('recebida sem etiqueta: nada a fazer', [N.situacaoDe(true, null), N.situacaoDe(true, { dispensada: true })], ['recebida', 'recebida']);
eq('etiquetada vale mais que dispensada (os dois marcados por engano)', N.situacaoDe(false, { etiquetada: true, dispensada: true }), 'transito');
eq('nao exposto: em transito com situacao propria; recebida vira retirar como as outras',
  [N.situacaoDe(false, { etiquetada: true, tipo: 'naoExposto' }), N.situacaoDe(true, { etiquetada: true, tipo: 'naoExposto' })], ['naoExposto', 'retirar']);
eq('id da linha = chave + item', N.idDaLinha('351', 2), '351_2');

// ── Linhas ───────────────────────────────────────────────────

const itens = [
  { chave: 'A', numero: '10', dataEmissao: '2026-10-01', nomeEmitente: 'Fornecedor <X>', itens: [
    { n: 1, codigo: 'P1', descricao: 'Piso 60x60', qtd: 30, un: 'CX' },
    { n: 2, codigo: 'P2', descricao: 'Rejunte cinza', qtd: '5', un: 'UN' }] },
  { chave: 'B', numero: '11', dataEmissao: '2026-10-03', nomeEmitente: 'Outro', itens: [
    { codigo: 'Q1', descricao: 'Argamassa', qtd: 100, un: 'SC' }] },
  { chave: 'C', numero: '12', dataEmissao: '2026-09-20', nomeEmitente: 'Cancelado', itens: [{ n: 1, descricao: 'X' }] },
  { chave: 'D', numero: '13', dataEmissao: '2026-09-25', nomeEmitente: 'Sem itens' }
];
const notas = {
  A: { noSistema: true, status: 'ativa' },
  C: { status: 'cancelada' },
  B: { previsaoEntrega: '2026-10-10' }
};
const etiquetas = { A_1: { etiquetada: true }, A_2: { etiquetada: true, retirada: true }, B_1: { dispensada: true } };
const linhas = N.linhasDeTransito(itens, notas, etiquetas);

eq('uma linha por item; nota cancelada some; nota sem itens nao gera linha',
  linhas.map(l => l.id), ['A_1', 'A_2', 'B_1']);
eq('nota cancelada com etiqueta pendente fica como "retirar" (a etiqueta esta na gondola)',
  (l => [l.map(x => x.id), l[0].situacao, l[0].cancelada])(N.linhasDeTransito([itens[2]], notas, { C_1: { etiquetada: true } })),
  [['C_1'], 'retirar', true]);
eq('item sem "n" usa a posicao', linhas[2].n, 1);
eq('situacoes: retirar, concluida, dispensada', linhas.map(l => l.situacao), ['retirar', 'concluida', 'dispensada']);
eq('quantidade em texto vira numero; unidade e codigo vem junto',
  [linhas[1].qtd, linhas[1].un, linhas[1].codigo], [5, 'UN', 'P2']);
eq('recebimento e previsao vem da nota', [linhas[0].recebida, linhas[2].recebida, linhas[2].previsaoEntrega], [true, false, '2026-10-10']);
{
  const ts = { toDate: () => new Date(2026, 9, 20, 15, 30) }; // Timestamp do Firestore, 20/10/2026 local
  const docs = [{ chave: 'R', itens: [{ n: 1, descricao: 'x' }] }];
  eq('data do recebimento: noSistemaEm do script vence; senao o dia do carimbo; nao recebida nao tem',
    [N.linhasDeTransito(docs, { R: { noSistema: true, noSistemaEm: '2026-10-19', alteradoEm: ts } }, {})[0].recebidaEm,
     N.linhasDeTransito(docs, { R: { noSistema: true, alteradoEm: ts } }, {})[0].recebidaEm,
     N.linhasDeTransito(docs, { R: { noSistema: true } }, {})[0].recebidaEm,
     N.linhasDeTransito(docs, { R: { alteradoEm: ts } }, {})[0].recebidaEm],
    ['2026-10-19', '2026-10-20', null, null]);
  eq('relatorio mostra a data do recebimento no retirar',
    N.htmlRelatorio(N.linhasDeTransito(docs, { R: { noSistema: true, noSistemaEm: '2026-10-19' } }, { R_1: { etiquetada: true } }), [], { hoje: '2026-10-22' }).indexOf('recebida em 19/10/2026') !== -1, true);
}
eq('fornecedor passa pela regra comum (nome cru fica guardado)', [linhas[0].fornecedor, linhas[0].nomeEmitente], ['Fornecedor <X>', 'Fornecedor <X>']);
eq('nota que nao esta carregada conta como nao recebida',
  N.linhasDeTransito([{ chave: 'Z', itens: [{ descricao: 'y' }] }], {}, {})[0].situacao, 'etiquetar');

// ── NCM: so' pisos, revestimentos e porcelanatos ─────────────

eq('NCM_PISOS e o 6907', N.NCM_PISOS, ['6907']);
eq('ncmCasa: prefixo, com ou sem pontos; sem prefixos aceita tudo',
  [N.ncmCasa('69072100', ['6907']), N.ncmCasa('6907.21.00', ['6907']), N.ncmCasa('69.07.21.00', ['6907']), N.ncmCasa('69101000', ['6907']), N.ncmCasa(null, ['6907']), N.ncmCasa(null, []), N.ncmCasa('x', null)],
  [true, true, true, false, false, true, true]);
const comNcm = N.linhasDeTransito([{ chave: 'A', itens: [
  { n: 1, descricao: 'piso', ncm: '69072200' }, { n: 2, descricao: 'rejunte', ncm: '38245000' }, { n: 3, descricao: 'sem ncm' }] }], {}, {}, { ncm: N.NCM_PISOS });
eq('com o filtro de NCM so o piso vira linha', comNcm.map(l => l.id), ['A_1']);
eq('sem o filtro, todos', N.linhasDeTransito([{ chave: 'A', itens: [{ ncm: '1' }, { ncm: '2' }] }], {}, {}).length, 2);

// ── Contagem, ordem, filtro ──────────────────────────────────

const c = N.contar(linhas);
eq('contagem por situacao', [c.retirar, c.concluida, c.dispensada, c.etiquetar, c.transito, c.recebida], [1, 1, 1, 0, 0, 0]);

const mistura = N.linhasDeTransito([
  { chave: 'A', dataEmissao: '2026-10-01', nomeEmitente: 'F1', itens: [{ n: 1, descricao: 'a' }, { n: 2, descricao: 'b' }] },
  { chave: 'B', dataEmissao: '2026-10-05', nomeEmitente: 'F2', itens: [{ n: 1, descricao: 'c' }] },
  { chave: 'C', dataEmissao: '2026-10-02', nomeEmitente: 'F3', itens: [{ n: 1, descricao: 'd' }] }
], { A: { noSistema: true } }, { A_1: { etiquetada: true }, C_1: { etiquetada: true } });
eq('ordem: retirar, etiquetar, em transito; mais recente primeiro dentro do grupo',
  N.ordenar(mistura).map(l => l.id + ':' + l.situacao), ['A_1:retirar', 'B_1:etiquetar', 'C_1:transito', 'A_2:recebida']);
eq('filtro sem grupo esconde as encerradas', N.filtrar(mistura, {}).map(l => l.id), ['A_1', 'B_1', 'C_1']);
eq('filtro "encerradas" mostra so recebidas e concluidas', N.filtrar(mistura, { grupo: 'encerradas' }).map(l => l.id), ['A_2']);
eq('filtro por situacao', N.filtrar(mistura, { grupo: 'transito' }).map(l => l.id), ['C_1']);
eq('chips agrupam: "em transito" inclui nao exposto; "com estoque" inclui o decidido pelo cadastro',
  [N.GRUPOS.transito, N.GRUPOS.azul, N.GRUPOS.dispensada], [['transito', 'naoExposto'], ['transito'], ['dispensada', 'comEstoque']]);
eq('chips "so azul" e "so nao exposto" separam as duas',
  [N.filtrar(mistura, { grupo: 'azul' }).map(l => l.id), N.filtrar(mistura, { grupo: 'naoExposto' }).length], [['C_1'], 0]);
eq('busca com chips: basta um termo casar, sem acento, em fornecedor/produto/codigo/nota',
  [N.filtrar(linhas, { grupo: 'encerradas', termos: ['REJUNTE'] }).map(l => l.id),
   N.filtrar(linhas, { termos: ['argamassa', 'piso'] }).map(l => l.id),
   N.filtrar(linhas, { termos: ['nada'] }).length], [['A_2'], ['A_1', 'B_1'], 0]);

// ── Agrupamento: um produto por linha ────────────────────────

{
  const seis = N.linhasDeTransito([
    { chave: 'N1', numero: '47904', dataEmissao: '2026-10-05', nomeEmitente: 'CERAMICA X', itens: [{ n: 1, descricao: 'NATURALLE BIANCO 45X45', qtd: 1284.48, un: 'M2' }] },
    { chave: 'N2', numero: '47905', dataEmissao: '2026-10-05', nomeEmitente: 'CERAMICA X', itens: [{ n: 1, descricao: 'NATURALLE BIANCO 45X45', qtd: 428.16, un: 'M2' }] },
    { chave: 'N3', numero: '47909', dataEmissao: '2026-10-09', nomeEmitente: 'CERAMICA X', itens: [{ n: 1, descricao: 'Naturalle Bianco 45x45', qtd: 428.16, un: 'm2' }, { n: 2, descricao: 'OUTRO 60X60', qtd: 10, un: 'M2' }] },
    { chave: 'N4', numero: '47910', dataEmissao: '2026-10-09', nomeEmitente: 'CERAMICA X', itens: [{ n: 1, descricao: 'NATURALLE BIANCO 45X45', qtd: 100, un: 'M2' }] }
  ], { N4: { noSistema: true } }, { N4_1: { etiquetada: true } });
  const g = N.agrupar(seis);
  eq('mesmo produto, mesmo fornecedor, mesma situacao: uma linha; situacao diferente: outra', g.map(x => x.ids.join('+')), ['N1_1+N2_1+N3_1', 'N3_2', 'N4_1']);
  eq('quantidade somada, notas e periodo', [g[0].qtd, g[0].notas, N.textoNotas(g[0]), N.textoEmissao(g[0])], [2140.8, 3, '3 NF (47904–47909)', '05/10 a 09/10/2026']);
  eq('linha de uma nota so: texto simples', [N.textoNotas(g[1]), N.textoEmissao(g[1]), g[1].id], ['NF 47909', '09/10/2026', 'N3_2']);
  eq('o id do grupo junta os ids (a acao grava um registro por item)', g[0].id, 'N1_1|N2_1|N3_1');
  eq('contagem e ordem funcionam sobre grupos', [N.contar(g).etiquetar, N.contar(g).retirar, N.ordenar(g)[0].id], [2, 1, 'N4_1']);
  eq('relatorio agrupa: a caminho vira uma linha com 3 NF; a recebida fica na secao de retirar', (r => [(r.match(/NATURALLE BIANCO 45X45/g) || []).length, r.indexOf('3 NF (47904–47909)') !== -1])(N.htmlRelatorio(seis, [], { hoje: '2026-10-22' })), [2, true]);
}

// ── Vermelhas ────────────────────────────────────────────────

const verm = [
  { id: 'v1', produto: 'Argamassa AC3', criadaEm: '2026-10-02' },
  { id: 'v2', produto: 'Piso', codigo: 'P1', criadaEm: '2026-10-01' },
  { id: 'v3', produto: 'Resolvida', criadaEm: '2026-09-01', resolvidaEm: '2026-09-05' },
  { id: 'v4', produto: 'abc', criadaEm: '2026-10-03' }
];
eq('vermelhas pendentes, mais antiga primeiro', N.vermelhasPendentes(verm).map(v => v.id), ['v2', 'v1', 'v4']);
eq('dica: pelo nome contido na descricao (sem acento)', N.dicaDeFaturamento(verm[0], linhas).map(l => l.id), []);
eq('dica: pelo codigo igual, mesmo com nome curto', N.dicaDeFaturamento(verm[1], linhas).map(l => l.id), ['A_1']);
eq('dica: nome com menos de 4 letras e sem codigo nao casa com nada', N.dicaDeFaturamento(verm[3], linhas), []);
eq('dica ignora linhas encerradas', N.dicaDeFaturamento({ produto: 'rejunte' }, linhas), []);
eq('dica acha a argamassa em transito', N.dicaDeFaturamento({ produto: 'ARGAMASSA' }, linhas).map(l => l.id), ['B_1']);

// ── Importacao do estoque ────────────────────────────────────

{
  const cab = ['Código', 'Nome', 'Unid. Venda', 'Quantidade', 'Código Adicional 1', 'Código Barras', 'Nome Classe', 'Nome Subclasse', 'Nome Fabricante', 'Últ. Data'];
  const matriz = [
    ['Relatório de estoque', null, null, null, null, null, null, null, null, null],
    cab,
    ['100', 'PISO REF 75004 75X75 A POL (CX2,23MT) KARINA', 'CX', 0, null, '7899588825272', 'Porcelanato', 'Porcelanatos', 'Karina', '15/09/2026'],
    ['101', '*PISO GANTE MR 50 A FORMIGRES', 'CX', 0, null, '7891', 'Piso cerâmico', 'Pisos', 'Formigres', '01/09/2026'],
    ['102', 'PISO HD 32X57 AMOSTRA', 'PÇ', 0, null, '', 'Amostras', 'Lojinha', '', '01/01/2018'],
    ['103', 'REVEST ANTIGO 25X40', 'CX', 0, null, '7892', 'Revest. cerâmico', 'Revestimento', '', '10/01/2025'],
    ['104', 'PISO COM ESTOQUE 60X60', 'CX', 12, null, '7893', 'Piso cerâmico', 'Pisos', '', '01/10/2026'],
    ['105', 'PISO BAIXO 60X60', 'CX', 3, null, '7894', 'Piso cerâmico', 'Pisos', '', '01/10/2026'],
    ['106', 'PORC EM TRANSITO 80X80', 'CX', 0, null, '7895', 'Porcelanato', 'Porcelanatos', '', '05/10/2026'],
    ['107', 'PISO JA VERMELHO 45X45', 'CX', 0, null, '7896', 'Piso cerâmico', 'Pisos', '', '05/10/2026'],
    ['108', 'PISO IGNORADO 45X45', 'CX', 0, null, '7897', 'Piso cerâmico', 'Pisos', '', '05/10/2026'],
    ['109', 'PISO 58004 58X58 A VIVA PISOS', 'CX', 0, null, '', 'Piso cerâmico', 'Pisos', '', '05/10/2026'],
    ['110', 'PISO QTD RUIM', 'CX', 'abc', null, '', 'Piso cerâmico', 'Pisos', '', '05/10/2026'],
    ['112', 'PISO PARADO POUCO 60X60', 'CX', 5, null, '7812', 'Piso cerâmico', 'Pisos', '', '01/01/2026'],
    ['113', 'PISO PARADO MUITO 60X60', 'CX', 80, null, '7813', 'Piso cerâmico', 'Pisos', '', '01/01/2026'],
    ['114', 'PISO PARADO MARCADO 60X60', 'CX', 90, null, '7814', 'Piso cerâmico', 'Pisos', '', '01/01/2026'],
    [null, null, null, null, null, null, null, null, null, null]
  ];
  const lido = N.lerPlanilhaEstoque(matriz);
  eq('planilha: acha o cabecalho fora da primeira linha e le todos os itens', lido.itens.length, 14);
  eq('planilha: campos do item (asterisco = nao repor, barras so digitos, data ISO)',
    [lido.itens[0].codigo, lido.itens[0].ean, lido.itens[0].ultData, lido.itens[0].naoRepor, lido.itens[1].naoRepor, lido.itens[0].classe],
    ['100', '7899588825272', '2026-09-15', false, true, 'Porcelanato']);
  eq('planilha: quantidade ilegivel vira problema, nao quebra', [lido.problemas.length, lido.itens[10].quantidade], [1, null]);
  eq('planilha sem cabecalho: problema explicado', N.lerPlanilhaEstoque([['a', 'b'], [1, 2]]).problemas.length, 1);

  const transito = N.linhasDeTransito([
    { chave: 'T', numero: '5', dataEmissao: '2026-10-05', nomeEmitente: 'F', itens: [
      { n: 1, descricao: 'PORCELANATO 80X80 POLIDO', ean: '7895', qtd: 10 },
      { n: 2, descricao: 'PISO 58004 58X58 ESMALTADO', qtd: 10 },
      { n: 3, descricao: 'PISO REF 75004 75X75 POL', ean: '0000', qtd: 10 }] }
  ], {}, {});
  eq('semelhanca por palavras: codigo de referencia e tamanho casam; nomes diferentes nao; cor diferente no mesmo tamanho nao',
    [N.semelhanca('PISO 58004 58X58 A VIVA PISOS', 'PISO 58004 58X58 ESMALTADO') >= 0.75, N.semelhanca('PISO AZUL 60X60', 'REVEST BRANCO 30X60') >= 0.75,
     N.semelhanca('PISO 57X57 CINZA', 'PISO 57X57 BEGE') >= 0.75, N.semelhanca('PISO REF 75004 75X75 A POL (CX2,23MT) KARINA', 'PISO 75004 75X75 POLIDO') >= 0.75,
     N.semelhanca('PORCELANATO 80X80 POLIDO', 'PORCELANATO 80X80 ACETINADO') >= 0.75],
    [true, false, false, true, false]);
  eq('dica de vermelha vinda do estoque ignora o codigo interno (nao e o da nota)',
    N.dicaDeFaturamento({ produto: 'x', codigo: 'P1', origem: 'estoque' }, transito).length, 0);
  const comHora = N.lerPlanilhaEstoque([cab, ['200', 'PISO COM HORA', 'CX', 0, null, '', 'Piso cerâmico', 'Pisos', '', '15/09/2026 14:33']]);
  eq('data com hora vira so a data', comHora.itens[0].ultData, '2026-09-15');
  eq('sem a coluna de data: avisa, e ninguem vira parado',
    (x => [x.problemas.length, N.sugestoesVermelhas(x.itens, [], [], { hoje: '2026-10-09' }).semData])(N.lerPlanilhaEstoque([cab.slice(0, 9), ['1', 'PISO SEM DATA', 'CX', 5, null, '', 'Piso cerâmico', 'Pisos', '']])), [1, 1]);
  eq('faturados: com codigo de barras dos dois lados so vale o codigo de barras (nome parecido nao engana)',
    N.faturadosDoItem(lido.itens[0], transito).length, 0);
  const verm = [{ id: 'v1', produto: 'PISO JA VERMELHO 45X45', codigo: '107', criadaEm: '2026-10-01' }, { id: 'v2', produto: 'antiga', codigo: '104', criadaEm: '2026-09-01', resolvidaEm: '2026-09-02' }];
  const r = N.sugestoesVermelhas(lido.itens, transito, verm, { hoje: '2026-10-09', minimo: 0, dias: 180, ignorados: { '108': '2026-10-01' }, marcados: { '114': { tipo: 'promocao', em: '2026-10-01' } } });
  eq('sugestoes: so o que esta zerado, vendavel, com movimento recente, sem vermelha, nao ignorado e nao faturado',
    r.sugerir.map(i => i.codigo), ['100']);
  eq('sugestoes: ja faturado vai para a lista azul (por barras e por nome)', r.jaFaturados.map(x => x.item.codigo + ':' + x.linhas.map(l => l.id).join('+')), ['109:T_2', '106:T_1']);
  eq('sugestoes: contagens do que ficou de fora',
    [r.foraDoControle, r.naoRepor, r.paradosSemEstoque, r.ignorados, r.jaVermelhas, r.normais], [1, 1, 1, 1, 1, 3]);
  eq('parado com estoque: ate o minimo e saldao, acima e promocao; marcado fica fora',
    [r.saldao.map(i => i.codigo), r.promocao.map(i => i.codigo), r.jaMarcados.map(x => x.item.codigo + ':' + x.tipo)], [[], ['113', '112'], ['114:promocao']]);
  eq('com minimo 40, o parado com 5 vira saldao e o com 80 promocao',
    (x => [x.saldao.map(i => i.codigo), x.promocao.map(i => i.codigo)])(N.sugestoesVermelhas(lido.itens, transito, verm, { hoje: '2026-10-09', minimo: 40, dias: 90 })), [['112'], ['114', '113']]);
  eq('padroes: minimo 40 e 90 dias',
    (x => [x.saldao.length, x.promocao.length, x.sugerir.length])(N.sugestoesVermelhas(lido.itens, transito, verm, { hoje: '2026-10-09' })), [1, 2, 4]);
  const relEst = N.htmlRelatorio([], [], { hoje: '2026-10-09', estoque: N.sugestoesVermelhas(lido.itens, transito, verm, { hoje: '2026-10-09', minimo: 40, dias: 90 }) });
  eq('relatorio: saldao e promocao entram quando ha estoque importado',
    [/SALDÃO[^(]*\(1\)/.test(relEst), /PROMOÇÃO[^(]*\(2\)/.test(relEst), relEst.indexOf('PISO PARADO POUCO 60X60') !== -1, N.htmlRelatorio([], [], { hoje: '2026-10-09' }).indexOf('SALDÃO') === -1], [true, true, true, true]);
  eq('sugestoes: minimo 5 inclui o estoque baixo; dias 0 = sem corte de data',
    N.sugestoesVermelhas(lido.itens, transito, verm, { hoje: '2026-10-09', minimo: 5, dias: 0 }).sugerir.map(i => i.codigo), ['105', '108', '112', '100', '103']);
  eq('vermelha que ganhou estoque: pelo codigo interno ou barras, so pendente',
    N.vermelhasComEstoque([{ id: 'a', codigo: '104', criadaEm: '2026-10-01' }, { id: 'b', ean: '7894', criadaEm: '2026-10-01' }, { id: 'c', codigo: '100', criadaEm: '2026-10-01' }, { id: 'd', codigo: '104', criadaEm: '2026-09-01', resolvidaEm: '2026-09-02' }], lido.itens, 0)
      .map(x => x.vermelha.id + ':' + x.item.quantidade), ['a:12', 'b:3']);
  eq('dica de faturamento tambem casa pelo codigo de barras', N.dicaDeFaturamento({ produto: 'x', ean: '7895' }, transito).map(l => l.id), ['T_1']);
}

// ── Catalogo interno e troca vermelha -> azul ────────────────

{
  const estoque = [
    { codigo: '100', nome: 'PISO INTERNO 60X60', ean: '7899000000011', classe: 'Piso cerâmico' },
    { codigo: '101', nome: 'SEM BARRAS', ean: '', classe: 'Piso cerâmico' },
    { codigo: '102', nome: 'AMOSTRA', ean: '7899000000028', classe: 'Amostras' }
  ];
  const doc = N.montarCatalogo(estoque, '2026-10-15');
  eq('catalogo: so vendaveis, compacto, com data e estoque', [doc.qtd, doc.porCodigo['100'], doc.porCodigo['102'], doc.geradoEm], [2, { n: 'PISO INTERNO 60X60', e: '7899000000011', q: null }, undefined, '2026-10-15']);
  const cat = N.expandirCatalogo(doc);
  eq('catalogo expandido: indice por barras so de quem tem', [Object.keys(cat.porEan), cat.porEan['7899000000011'].codigo], [['7899000000011'], '100']);
  eq('produtoDoCatalogo: acha pelo codigo (com espaco), nao acha o que nao existe',
    [N.produtoDoCatalogo(cat, ' 100 '), N.produtoDoCatalogo(cat, '999'), N.produtoDoCatalogo(null, '100')],
    [{ codigo: '100', nome: 'PISO INTERNO 60X60', ean: '7899000000011', qtd: null }, null, null]);
  const linhasCat = N.linhasDeTransito([{ chave: 'K', numero: '9', dataEmissao: '2026-10-10', nomeEmitente: 'F', itens: [
    { n: 1, descricao: 'PISO DO FORNECEDOR', ean: '7899000000011' }, { n: 2, descricao: 'OUTRO', ean: '1' }, { n: 3, descricao: 'SEM EAN' }] }], {}, {}, { catalogo: cat });
  eq('linha ganha codigo e nome internos so pelo codigo de barras', linhasCat.map(l => l.codigoInterno + '|' + l.nomeInterno), ['100|PISO INTERNO 60X60', '|', '|']);
  eq('possivel produto novo: barras na nota e fora do catalogo (sem barras nao da para dizer)', linhasCat.map(l => l.possivelNovo), [false, true, false]);
  eq('sem catalogo importado ninguem e "novo"', N.linhasDeTransito([{ chave: 'K', itens: [{ ean: '1' }] }], {}, {}, {}).map(l => l.possivelNovo), [false]);
  // Estoque do cadastro decide a azul: acima do minimo, faturado nao precisa de etiqueta.
  const catQ = N.expandirCatalogo(N.montarCatalogo([{ codigo: '100', nome: 'A', ean: '7899000000011', quantidade: 120, classe: 'Piso cerâmico' }, { codigo: '101', nome: 'B', ean: '7899000000028', quantidade: 3, classe: 'Piso cerâmico' }]));
  const docQ = [{ chave: 'Q', itens: [{ n: 1, descricao: 'A', ean: '7899000000011' }, { n: 2, descricao: 'B', ean: '7899000000028' }, { n: 3, descricao: 'C', ean: '9' }] }];
  eq('com estoque acima do minimo no cadastro: "com estoque" (sem ninguem marcar); abaixo e desconhecido: etiquetar',
    N.linhasDeTransito(docQ, {}, {}, { catalogo: catQ, minimo: 40 }).map(l => l.situacao + ':' + l.estoqueCadastro), ['comEstoque:120', 'etiquetar:3', 'etiquetar:null']);
  eq('quem ja marcou etiquetei ou recebeu nao e mexido pelo cadastro',
    N.linhasDeTransito(docQ, { Q: { noSistema: true } }, { Q_1: { etiquetada: true } }, { catalogo: catQ, minimo: 40 }).map(l => l.situacao), ['retirar', 'recebida', 'recebida']);
  eq('sem minimo informado o cadastro nao decide', N.linhasDeTransito(docQ, {}, {}, { catalogo: catQ }).map(l => l.situacao), ['etiquetar', 'etiquetar', 'etiquetar']);
  eq('relatorio marca o possivel novo e o nao exposto a expor',
    (r => [r.indexOf('NOVO? (não está no cadastro)') !== -1, r.indexOf('NÃO EXPOSTO — expor o produto') !== -1])(
      N.htmlRelatorio(N.linhasDeTransito(docQ, { Q: { noSistema: true } }, { Q_3: { etiquetada: true, tipo: 'naoExposto' } }, { catalogo: catQ, minimo: 40 })
        .concat(N.linhasDeTransito([{ chave: 'Z', itens: [{ n: 1, descricao: 'NOVO', ean: '5' }] }], {}, {}, { catalogo: catQ })), [], { hoje: '2026-10-22' })), [true, true]);
  eq('busca acha pelo codigo interno e pelo nome da loja', [N.filtrar(linhasCat, { termos: ['100'] }).length, N.filtrar(linhasCat, { termos: ['interno 60x60'] }).length], [1, 1]);
  const verm = [{ id: 'v1', codigo: '100', ean: '7899000000011', criadaEm: '2026-10-01' }, { id: 'v2', codigo: '7', ean: '', criadaEm: '2026-10-01' }, { id: 'v3', ean: '7899000000011', criadaEm: '2026-09-01', resolvidaEm: '2026-09-02' }];
  eq('vermelha casa com a linha pelas barras (resolvida nao conta)', Object.keys(N.vermelhasPorLinha(linhasCat, verm)).join(','), 'K_1');
  eq('vermelha casa pelo codigo interno quando a nota tem barras mas a vermelha nao',
    Object.keys(N.vermelhasPorLinha(linhasCat, [{ id: 'v4', codigo: '100', criadaEm: '2026-10-01' }])).join(','), 'K_1');
  eq('dica da vermelha tambem pelo codigo interno', N.dicaDeFaturamento({ codigo: '100', produto: 'x' }, linhasCat).map(l => l.id), ['K_1']);
  const relCat = N.htmlRelatorio(linhasCat, verm, { hoje: '2026-10-15' });
  eq('relatorio: "trocar vermelha por azul" separado de "colocar azul", com o codigo interno',
    [/TROCAR VERMELHA POR AZUL[^(]*\(1\)/.test(relCat), /COLOCAR ETIQUETA AZUL[^(]*\(2\)/.test(relCat), relCat.indexOf('<td>100</td>') !== -1], [true, true, true]);
}

// ── Saldao registrado ────────────────────────────────────────

{
  const cat = N.expandirCatalogo({ porCodigo: { '10': { n: 'A', e: '1', q: 0 }, '11': { n: 'B', e: '2', q: 7 } } });
  const sald = [
    { id: 's1', codigo: '11', produto: 'B', local: 'externo', estoqueInicial: 20, criadaEm: '2026-10-01' },
    { id: 's2', codigo: '10', produto: 'A', local: 'interno', estoqueInicial: 5, criadaEm: '2026-10-02' },
    { id: 's3', codigo: '12', produto: 'C', criadaEm: '2026-09-01', encerradaEm: '2026-09-20' },
    { id: 's4', codigo: '13', produto: 'D', criadaEm: '2026-10-03' }
  ];
  eq('saldoes ativos: sem os encerrados, interno antes de externo, por nome', N.saldoesAtivos(sald).map(s => s.id), ['s2', 's4', 's1']);
  eq('estoque do saldao pelo catalogo: atual, saiu, zerou, sem dado',
    [N.estoqueDoSaldao(sald[0], cat), N.estoqueDoSaldao(sald[1], cat), N.estoqueDoSaldao(sald[3], cat)],
    [{ inicial: 20, atual: 7, saiu: 13, zerado: false, semDado: false }, { inicial: 5, atual: 0, saiu: 5, zerado: true, semDado: false }, { inicial: null, atual: null, saiu: null, zerado: false, semDado: true }]);
  eq('quem esta no saldao registrado conta como marcado na classificacao (a marca antiga vence)',
    N.marcadosComSaldao({ '10': { tipo: 'promocao' } }, sald), { '10': { tipo: 'promocao' }, '11': { tipo: 'saldao', em: '2026-10-01', registro: true }, '13': { tipo: 'saldao', em: '2026-10-03', registro: true } });
  const rel = N.htmlRelatorio([], [], { hoje: '2026-10-22', saldoes: sald, catalogo: cat });
  eq('relatorio: saldao em andamento por local, com estoque e ZEROU',
    [/SALDÃO EM ANDAMENTO[^(]*\(3\)/.test(rel), rel.indexOf('Interno (2)') !== -1, rel.indexOf('Externo (1)') !== -1, rel.indexOf('7 de 20') !== -1, rel.indexOf('ZEROU') !== -1, rel.indexOf('>C<') === -1],
    [true, true, true, true, true, true]);
}

// ── Relatorio ────────────────────────────────────────────────

const rel = N.htmlRelatorio(mistura.concat(linhas), verm, { hoje: '2026-10-08', hora: '09:00:00' });
eq('relatorio: tres secoes com as contagens', [/RETIRAR ETIQUETA[^(]*\(2\)/.test(rel), /COLOCAR ETIQUETA AZUL[^(]*\(1\)/.test(rel), /VERMELHAS[^(]*\(3\)/.test(rel)], [true, true, true]);
eq('relatorio: fornecedor escapado, nada de tag crua', [rel.indexOf('Fornecedor &lt;X&gt;') !== -1, rel.indexOf('<X>') === -1], [true, true]);
eq('relatorio: em transito ja etiquetada e concluida ficam fora', [rel.indexOf('>d<') === -1, rel.indexOf('Rejunte') === -1], [true, true]);
eq('relatorio: data e hora no cabecalho', rel.indexOf('08/10/2026 09:00:00') !== -1, true);
eq('relatorio vazio nao quebra', /Nada para retirar|Nada para etiquetar/.test(N.htmlRelatorio([], [], { hoje: '2026-10-08' })), true);
eq('relatorio: quadrinho para marcar em cada linha', (rel.match(/rl-caixa/g) || []).length, 2 + 1 + 3);

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
