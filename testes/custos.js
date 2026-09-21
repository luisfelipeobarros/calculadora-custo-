/*
  Custos — custo operacional a partir dos lancamentos do contador
  (layout de 19 colunas, uma planilha por banco/caixa).

  Dados FABRICADOS com a forma dos arquivos reais (repositorio
  publico: nenhum nome, CNPJ ou valor de verdade). O que se trava:

  - a leitura em pares D/C, com o que nao fecha (uma perna so', sem
    data, sem valor, valores diferentes) indo para `problemas` e
    NUNCA virando lancamento pela metade;
  - a natureza pelo caminho do dinheiro: credito em caixa/banco =
    saida, debito = entrada, os dois = transferencia (fora de tudo);
  - a classificacao: escolha manual > regra da configuracao >
    historico (so' em conta generica) > conta > "a classificar";
  - mercadoria, frete de compra e ICMS de fronteira sao custo do
    PRODUTO, nao custo operacional (decisao de 21/09/2026);
  - estorno abate o grupo; recebimento soma em receita;
  - "valores a regularizar" sem padrao reconhecido fica A CLASSIFICAR,
    nunca herda grupo em silencio;
  - o id de importacao e' deterministico e nao colide quando o numero
    do contador se repete entre arquivos.
*/
const C = require('../custos-nucleo.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

const EMPRESA = '00111222000133|000000000';
const perna = (num, data, valor, conta, dc, hist, seq) =>
  [num, data, valor, '1', null, conta, dc, valor, EMPRESA, null, null, hist, 'N', 'D', null, null, null, null, seq];
const par = (num, data, valor, deb, cre, hist, seq) =>
  [perna(num, data, valor, deb, 'D', hist, seq), perna(num, data, valor, cre, 'C', hist, seq + 1)];

const BRADESCO = '1.1.1.2.0001', ITAU = '1.1.1.2.0002', CAIXA = '1.1.1.1.0001', VINC = '1.1.1.4.0006';

// ── 1. Leitura ───────────────────────────────────────────────

{
  const matriz = [].concat(
    par('00000001', new Date(2026, 0, 5), 700, '4.2.1.1.0021', BRADESCO, 'VALOR REF A FRETE  DE   ENTREGA ', 10),
    par('00000002', '12/01/2026', '1.234,56', '2.1.1.1.0001', BRADESCO, 'VALOR REF A FORNECEDOR', 12),
    [[null, null, null, null, null, null, null]],                        // linha em branco
    [perna('00000003', new Date(2026, 0, 7), 50, ITAU, 'D', 'UMA PERNA SO', 14)],
    par('00000004', null, 80, '4.2.4.1.0001', ITAU, 'TARIFA SEM DATA', 15),
    par('00000005', new Date(2026, 0, 8), null, '4.2.4.1.0001', ITAU, 'TARIFA SEM VALOR', 17),
    [perna('00000006', new Date(2026, 0, 9), 100, '4.2.4.1.0001', 'D', 'VALORES DIFERENTES', 19),
     perna('00000006', new Date(2026, 0, 9), 90, ITAU, 'C', 'VALORES DIFERENTES', 20)],
    [['Total', null, 999, null, null, 'abc', 'X']]                        // rodape estranho
  );
  const r = C.lerLayoutContador(matriz, 'BANCO TESTE.XLS');
  eq('leitura: dois lancamentos validos', r.lancamentos.length, 2);
  eq('leitura: data Date vira ISO, valor numero vira centavos, historico sem espaco sobrando',
    [r.lancamentos[0].data, r.lancamentos[0].mes, r.lancamentos[0].valorCentavos, r.lancamentos[0].historico],
    ['2026-01-05', '2026-01', 70000, 'VALOR REF A FRETE DE ENTREGA']);
  eq('leitura: data dd/mm/aaaa e valor "1.234,56" em texto tambem',
    [r.lancamentos[1].data, r.lancamentos[1].valorCentavos], ['2026-01-12', 123456]);
  eq('leitura: debito e credito no lugar, com o arquivo junto',
    [r.lancamentos[1].contaDebito, r.lancamentos[1].contaCredito, r.lancamentos[1].arquivo],
    ['2.1.1.1.0001', BRADESCO, 'BANCO TESTE.XLS']);
  eq('leitura: o que nao fecha vai para problemas, com o tipo',
    r.problemas.map(p => p.tipo), ['pernas', 'semData', 'semValor', 'valoresDiferentes', 'linhaEstranha']);
  eq('leitura: o problema diz arquivo, linha e historico',
    /BANCO TESTE\.XLS, linha 6 .*UMA PERNA SO/.test(r.problemas[0].texto), true);
  eq('leitura: matriz vazia', C.lerLayoutContador([], 'x'), { lancamentos: [], problemas: [] });
  eq('leitura: planilha de outro formato (folha por funcionario) nao rende lancamento',
    C.lerLayoutContador([['Funcionario', 'VALOR', 'Banco'], ['FULANO', 1182.04, 'DINHEIRO'], ['TOTAL', 26331.52]], 'FOLHA.xlsx').lancamentos.length, 0);
}

// Numero do contador repetido entre arquivos: ids diferentes; mesmo
// arquivo relido: id igual.
{
  const a = C.lerLayoutContador(par('00004425', new Date(2026, 0, 28), 110, '4.2.1.1.0021', CAIXA, 'FRETE', 598170), 'CAIXA.xlsx').lancamentos[0];
  const b = C.lerLayoutContador(par('00004425', new Date(2026, 0, 28), 110, '4.2.4.1.0001', ITAU, 'TARIFA', 598170), 'BANCO.xls').lancamentos[0];
  const a2 = C.lerLayoutContador(par('00004425', new Date(2026, 0, 28), 110, '4.2.1.1.0021', CAIXA, 'FRETE', 598170), 'CAIXA.xlsx').lancamentos[0];
  eq('id: mesmo numero em arquivos diferentes nao colide', C.idImportado(a) === C.idImportado(b), false);
  eq('id: reler o mesmo arquivo da o MESMO id (reimportar nao duplica)', C.idImportado(a), C.idImportado(a2));
  eq('id: comeca com imp_ e o mes', /^imp_2026-01_/.test(C.idImportado(a)), true);
  const renomeado = C.lerLayoutContador(par('00004425', new Date(2026, 0, 28), 110, '4.2.1.1.0021', CAIXA, 'FRETE', 598170), 'CAIXA (1).xlsx');
  eq('id: arquivo renomeado da o MESMO id (o nome fica de fora)', C.idImportado(renomeado.lancamentos[0]), C.idImportado(a));

  // Lote de arquivos: copia descartada pelo conteudo, documento de apoio listado.
  const lote = C.juntarLeituras([
    Object.assign({ arquivo: 'CAIXA.xlsx' }, C.lerLayoutContador(par('00004425', new Date(2026, 0, 28), 110, '4.2.1.1.0021', CAIXA, 'FRETE', 598170), 'CAIXA.xlsx')),
    Object.assign({ arquivo: 'CAIXA (1).xlsx' }, renomeado),
    Object.assign({ arquivo: 'FOLHA.xlsx' }, C.lerLayoutContador([['Funcionario', 'VALOR'], ['FULANO', 1182.04]], 'FOLHA.xlsx')),
    Object.assign({ arquivo: 'BANCO.xls' }, C.lerLayoutContador(par('00004425', new Date(2026, 0, 28), 110, '4.2.4.1.0001', ITAU, 'TARIFA', 598170), 'BANCO.xls'))
  ]);
  eq('lote: dois lancamentos (a copia nao dobra)', lote.lancamentos.length, 2);
  eq('lote: copia e documento de apoio listados como ignorados, com o motivo',
    lote.ignorados, [{ arquivo: 'CAIXA (1).xlsx', motivo: 'cópia de outro arquivo do lote' }, { arquivo: 'FOLHA.xlsx', motivo: 'outro formato (documento de apoio)' }]);
}

// ── 2. Natureza ──────────────────────────────────────────────

const L = (deb, cre, hist, valor, extra) => Object.assign(
  { data: '2026-01-10', mes: '2026-01', valorCentavos: valor == null ? 10000 : valor, contaDebito: deb, contaCredito: cre, historico: hist || '' }, extra);

eq('natureza: credito em banco = saida', C.natureza(L('4.2.1.1.0034', BRADESCO)), 'saida');
eq('natureza: credito em caixa (dinheiro) = saida', C.natureza(L('4.2.1.1.0034', CAIXA)), 'saida');
eq('natureza: debito em banco = entrada', C.natureza(L(BRADESCO, '1.1.2.1.0001')), 'entrada');
eq('natureza: banco contra vinculada = transferencia', C.natureza(L(BRADESCO, VINC)), 'transferencia');
eq('natureza: nenhuma das duas e caixa = outro', C.natureza(L('4.2.1.1.0034', '2.1.1.1.0001')), 'outro');

// ── 3. Classificacao ─────────────────────────────────────────

const g = (l, cfg) => C.classificar(l, cfg).grupo;
const t = (l, cfg) => C.classificar(l, cfg).tipo;

eq('conta exata: energia = ocupacao (operacional)', [g(L('4.2.1.1.0034', BRADESCO)), t(L('4.2.1.1.0034', BRADESCO))], ['ocupacao', 'operacional']);
eq('prefixo: 2.1.4.x = pessoal', g(L('2.1.4.1.0007', BRADESCO, 'RESCISAO')), 'pessoal');
eq('prefixo mais longo vence: 4.2.4.x = financeiras, nao "outras"', g(L('4.2.4.1.0001', BRADESCO)), 'financeiras');
eq('4.2.x sem conta cadastrada = outras despesas (operacional)', [g(L('4.2.1.1.0099', BRADESCO)), t(L('4.2.1.1.0099', BRADESCO))], ['outras', 'operacional']);
eq('adiantamento quinzenal (1.1.2.4.0003) = pessoal', g(L('1.1.2.4.0003', CAIXA, 'QUINZENA')), 'pessoal');

// As tres decisoes de 21/09/2026: custo do PRODUTO, nao operacional.
eq('fornecedor de mercadoria = cmv', t(L('2.1.1.1.0001', BRADESCO)), 'cmv');
eq('frete de compra (CT-e, fretes a pagar) = cmv', [g(L('2.1.1.1.0003', BRADESCO, 'FRETE CTE 8800')), t(L('2.1.1.1.0003', BRADESCO))], ['frete_compra', 'cmv']);
eq('ICMS de fronteira (ST fora da nota) = cmv', [g(L('2.1.3.1.0001', BRADESCO)), t(L('2.1.3.1.0001', BRADESCO))], ['icms_fronteira', 'cmv']);
eq('demais tributos = impostos', t(L('2.1.3.2.0001', BRADESCO, 'IMPOSTO TRIBUTO')), 'imposto');
eq('frete pago na hora (entrega) CONTINUA operacional', t(L('4.2.1.1.0021', CAIXA, 'FRETE SEQ 1158949')), 'operacional');

// Conta generica: o historico decide.
const REG = '1.1.2.4.0001';
eq('a regularizar + PARCELAMENTO = emprestimos', g(L(REG, ITAU, 'PARCELAMENTO')), 'emprestimos');
eq('a regularizar + CAPITAL DE GIRO = emprestimos', g(L(REG, BRADESCO, 'OPERAÇÃO CAPITAL DE GIRO 12/36')), 'emprestimos');
eq('a regularizar + JUROS = financeiras (juros vence emprestimo)', g(L(REG, ITAU, 'JUROS MORA GIRO 23/42')), 'financeiras');
eq('a regularizar + advogada = servicos', g(L(REG, BRADESCO, 'VALORES A REGULARIZAR PAGTO ADVOGADA FULANA')), 'servicos');
eq('a regularizar + contabilidade = servicos', g(L(REG, BRADESCO, 'PAGTO XYZ SOLUÇÕES CONTABEIS')), 'servicos');
eq('a regularizar + marketing = servicos', g(L(REG, BRADESCO, 'AGENCIA NOVA DIGITAL (MARKETING)')), 'servicos');
eq('a regularizar + devolucao cliente = deducao de receita', [g(L(REG, CAIXA, 'VALOR REF DEVOLUÇÃO CLIENTE')), t(L(REG, CAIXA, 'VALOR REF DEVOLUÇÃO CLIENTE'))], ['devolucao_cliente', 'receita']);
eq('a regularizar SEM padrao = a classificar (nunca herda grupo)', g(L(REG, BRADESCO, 'VALORES A REGULARIZAR FULANO DE TAL')), 'a_classificar');
eq('outras despesas + EXTRA SEMANAL = extras', g(L('4.2.1.1.0042', CAIXA, 'VALOR REF A EXTRA SEMANAL')), 'extras');
eq('outras despesas + seguranca = servicos', g(L('4.2.1.1.0042', CAIXA, 'SEGURANÇA ARMADA SEMANAL')), 'servicos');
eq('fornecedor de servicos + FRETE no historico = frete de compra', g(L('2.1.1.1.0002', BRADESCO, 'VALOR REF A FRETE TRANSPORTADOR NFSE 148')), 'frete_compra');
eq('fornecedor de servicos sem frete = servicos', g(L('2.1.1.1.0002', BRADESCO, 'NFSE 22 PLACAS')), 'servicos');
// Conta ESPECIFICA nao passa pelo historico: "frete" numa tarifa nao muda o grupo.
eq('historico so decide em conta generica', g(L('4.2.4.1.0001', BRADESCO, 'TARIFA FRETE')), 'financeiras');

// Configuracao (vem do Firestore — e' onde moram os nomes proprios).
{
  const cfg = { regras: [{ contem: 'Fulano de Tal', grupo: 'socios' }, { contem: 'xyz', grupo: 'nao-existe' }], porConta: { '4.2.1.1.0044': 'pessoal' } };
  eq('regra da configuracao: casa sem caixa/acento e vence a conta generica',
    [g(L(REG, BRADESCO, 'VALORES A REGULARIZAR FULANO DE TAL'), cfg), t(L(REG, BRADESCO, 'FULANO DE TAL'), cfg)], ['socios', 'socios']);
  eq('regra da configuracao vale para QUALQUER conta', g(L('4.2.1.1.0034', BRADESCO, 'ENERGIA FULANO DE TAL'), cfg), 'socios');
  eq('regra com grupo inexistente e ignorada', g(L(REG, BRADESCO, 'PAGTO XYZ'), cfg), 'a_classificar');
  eq('porConta da configuracao troca o grupo da conta', g(L('4.2.1.1.0044', BRADESCO, 'CARTAO'), cfg), 'pessoal');
  eq('escolha manual no lancamento vence tudo',
    [g(L(REG, BRADESCO, 'FULANO DE TAL', 100, { grupoCusto: 'ocupacao' }), cfg), C.classificar(L(REG, BRADESCO, 'x', 1, { grupoCusto: 'ocupacao' }), cfg).como], ['ocupacao', 'escolhido no lançamento']);
  eq('escolha manual com grupo inexistente e ignorada', g(L('4.2.1.1.0034', BRADESCO, '', 1, { grupoCusto: 'zzz' })), 'ocupacao');
}

// ── 4. Resumo do mes ─────────────────────────────────────────

{
  const mes = [
    L('4.2.1.1.0034', BRADESCO, 'ENERGIA', 100000),                  // operacional 1.000
    L('2.1.4.1.0001', CAIXA, 'SALARIO', 500000),                     // operacional 5.000
    L(BRADESCO, '4.2.1.1.0034', 'ESTORNO ENERGIA', 10000),           // estorno -100
    L('2.1.1.1.0001', BRADESCO, 'FORNECEDOR', 4000000),              // cmv 40.000
    L('2.1.3.1.0001', BRADESCO, 'ICMS FRONTEIRA', 800000),           // cmv 8.000
    L('2.1.3.2.0001', BRADESCO, 'TRIBUTO', 200000),                  // imposto 2.000
    L('4.2.4.1.0001', ITAU, 'TARIFA', 5000),                         // financeiro 50
    L(REG, ITAU, 'PARCELAMENTO', 1000000),                           // financiamento +10.000
    L(ITAU, REG, 'PARCELAMENTO', 1000000),                           // ...e a entrada que anula
    L(VINC, '1.1.2.1.0002', 'RECEBIMENTO DE CARTAO', 9000000),       // receita 90.000
    L(REG, CAIXA, 'VALOR REF DEVOLUÇÃO CLIENTE', 20000),             // receita -200
    L(BRADESCO, VINC, 'TRANSF VINCULADA/BANCO', 8000000),            // transferencia
    L(REG, BRADESCO, 'VALORES A REGULARIZAR FULANO', 30000)          // pendente 300
  ];
  const r = C.resumoDoMes(mes, {});
  eq('custo operacional = energia + salario - estorno', r.custoOperacionalCentavos, 590000);
  eq('cmv = mercadoria + ICMS de fronteira, FORA do operacional', r.tipos.cmv, 4800000);
  eq('impostos e financeiro separados', [r.tipos.imposto, r.tipos.financeiro], [200000, 5000]);
  eq('parcelamento que entra e sai no mes se anula', r.tipos.financiamento, 0);
  eq('receita = recebimentos - devolucao a cliente', r.tipos.receita, 8980000);
  eq('transferencia nao entra em nada', [r.transferenciasCentavos, r.saidasCentavos + r.entradasCentavos], [8000000, 6655000 + 10010000]);
  eq('a classificar: valor e a lista para a tela resolver', [r.pendenteCentavos, r.pendentes.length, r.pendentes[0].historico], [30000, 1, 'VALORES A REGULARIZAR FULANO']);
  const ocup = r.grupos.find(x => x.id === 'ocupacao');
  eq('grupo traz total, quantidade e o detalhe por conta',
    [ocup.totalCentavos, ocup.qtd, ocup.contas['4.2.1.1.0034']], [90000, 2, { totalCentavos: 90000, qtd: 2 }]);
  eq('grupos ordenados pelo valor (maior primeiro)', r.grupos[0].id, 'recebimentos');
  eq('mes vazio: tudo zero, nada explode', C.resumoDoMes([], {}).custoOperacionalCentavos, 0);
}

eq('percentual do faturamento: 590.000 centavos sobre R$ 100.000 = 5,9%', C.percentualDoFaturamento(590000, 100000), 0.059);
eq('sem faturamento: null, nunca zero nem infinito', [C.percentualDoFaturamento(590000, 0), C.percentualDoFaturamento(590000, null)], [null, null]);

// Todo grupo aponta para um tipo que existe (a tela monta as secoes por tipo).
eq('todo grupo tem tipo valido', Object.keys(C.GRUPOS).filter(k => !C.TIPOS[C.GRUPOS[k].tipo]), []);

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
