/*
  Conferencia de DDA (Bradesco) contra as duplicatas.

  Duas frentes:

  1. O PARSER, contra a camada de texto REAL do PDF de 30/07/2026
     (dda-fixture.js): e' o arquivo que derrubou o parse sequencial —
     a coluna "Situacao" vem em blocos separados no content stream e
     dois registros atravessam a quebra de pagina. Se um refactor
     regredir para logica de ordem de leitura, estes testes caem.

  2. AS REGRAS de casamento e classificacao, com bases fabricadas.
     O principio que mais importa esta' no fim: fora da janela de
     carga vira ⚪ indeterminado, NUNCA 🔴 — zero e' uma afirmacao;
     ausencia de dado nao e'. Reportar como fraude uma duplicata que
     so' nao foi baixada seria o pior defeito possivel da tela.
*/
const App = require('../app-shared.js');
const Dda = require('../dda-nucleo.js');
const paginas = require('./dda-fixture.js');

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

const G = Dda.GRAVIDADE;
const gravidadeDe = (linha) =>
  linha.problemas.reduce((m, p) => Math.max(m, p.gravidade), G.OK);
const tipos = (linha) => linha.problemas.map(p => p.tipo).sort();

// ── 1. Normalizacoes ─────────────────────────────────────────

// O Bradesco imprime CNPJ com 15 digitos (zero a mais na frente).
eq('CNPJ de 15 digitos perde o zero da frente',
  Dda.normalizarCnpj('004.226.489/0001-75'), '04226489000175');
eq('CNPJ de 14 digitos fica como esta',
  Dda.normalizarCnpj('011.878.198/0001-27'.slice(1)), '11878198000127');
eq('CNPJ ja' + ' limpo tambem funciona', Dda.normalizarCnpj('04226489000175'), '04226489000175');

// Os quatro separadores vistos no PDF real, mais os zeros a esquerda.
eq('documento com "/" separa nota e parcela',
  Dda.dividirDocumento('460347/04'), { nota: '460347', parcela: '4' });
eq('documento com "-" separa nota e parcela',
  Dda.dividirDocumento('370357-3'), { nota: '370357', parcela: '3' });
eq('documento com ESPACO separa nota e parcela',
  Dda.dividirDocumento('471702 01'), { nota: '471702', parcela: '1' });
eq('letra no fim tambem e parcela (550072-D)',
  Dda.dividirDocumento('550072-D'), { nota: '550072', parcela: 'D' });
eq('letra minuscula vira maiuscula',
  Dda.dividirDocumento('550072-d'), { nota: '550072', parcela: 'D' });
eq('so digitos = nota sem parcela, sem zeros a esquerda',
  Dda.dividirDocumento('0000049676'), { nota: '49676', parcela: null });
eq('dois separadores = ambiguo, sem chute (1 1626 2)',
  Dda.dividirDocumento('1 1626 2'), { ambiguo: true });
eq('parcela do XML tambem perde zeros ("001" -> "1")',
  Dda.normalizarParcela('001'), '1');

// Comparacao em centavos INTEIROS, nunca float.
eq('valor brasileiro vira centavos inteiros',
  Dda.valorParaCentavos('33.383,97'), 3338397);
eq('com R$ na frente tambem', Dda.valorParaCentavos('R$ 2.274,85'), 227485);
eq('sem milhar tambem', Dda.valorParaCentavos('99,90'), 9990);
eq('formato fora do padrao devolve null (falha alto, nao vira zero)',
  Dda.valorParaCentavos('abc'), null);
eq('sem os dois decimais devolve null', Dda.valorParaCentavos('0,1'), null);
// 0.1 + 0.2 !== 0.3 em float; em centavos inteiros a soma confere.
eq('0,30 do PDF casa com duplicata de 0.1+0.2 (o caso classico do float)',
  Dda.valorParaCentavos('0,30') === Math.round((0.1 + 0.2) * 100), true);

// ── 2. O PDF real, inteiro ───────────────────────────────────

const lido = Dda.interpretar(paginas);

eq('o PDF real rende os 36 boletos', lido.registros.length, 36);
eq('nenhum bloco ilegivel no PDF real', lido.ilegiveis.length, 0);
eq('o periodo vem do cabecalho ("31/07/2026 ate 31/07/2026")',
  lido.periodo, { ini: '2026-07-31', fim: '2026-07-31' });
eq('TODAS as situacoes casaram pelo y (a coluna vem em blocos no stream)',
  lido.registros.filter(r => r.situacao === 'A PAGAR').length, 36);

const porDoc = {};
lido.registros.forEach(r => { porDoc[r.documento] = r; });

// O registro que o parse sequencial desalinhou: comeca no pe da
// pagina 1 e o documento + situacao + banco estao na pagina 2.
const carmelo = porDoc['147863/04'];
eq('CARMELO FIOR (quebra de pagina 1->2) tem documento', !!carmelo, true);
eq('  ...com o valor certo', carmelo && carmelo.valorCentavos, 414750);
eq('  ...vencimento = a PRIMEIRA data', carmelo && carmelo.vencimento, '2026-07-31');
eq('  ...limite = a segunda, nao trocadas', carmelo && carmelo.limite, '2026-09-29');
eq('  ...e situacao presente', carmelo && carmelo.situacao, 'A PAGAR');

// O outro: so a linha de nomes na pagina 2, e no topo da pagina 3 o
// Bradesco funde vencimento+CNPJs+valor numa linha so.
const csmjQuebra = porDoc['372797-02'];
eq('CSMJ 372797-02 (quebra 2->3, linha fundida) completo', !!csmjQuebra, true);
eq('  ...valor', csmjQuebra && csmjQuebra.valorCentavos, 222486);
eq('  ...limite a dez anos nao virou vencimento', csmjQuebra && csmjQuebra.vencimento, '2026-07-31');

// Os gemeos de valor+vencimento identicos (o caso que quebra
// casamento global por valor).
eq('os gemeos 372280-02 e 372281-02 existem separados',
  !!(porDoc['372280-02'] && porDoc['372281-02']), true);
eq('  ...com o MESMO valor', porDoc['372280-02'].valorCentavos, porDoc['372281-02'].valorCentavos);

eq('CNPJ do pagador normalizado em todos',
  lido.registros.every(r => r.cnpjPagador === '04226489000175'), true);

// ── 3. Estrategias de casamento ──────────────────────────────

const dup = (o) => Object.assign({
  id: o.chaveAcesso ? undefined : 'dup-' + Math.random().toString(36).slice(2),
  chaveAcesso: 'chave-' + (o.numeroNota || 'x'),
  numeroNota: '1000', parcela: '001', vencimento: '2026-07-31',
  valor: 100, nomeEmitente: 'FORNECEDOR GENERICO LTDA', pago: false
}, o);

const reg = (o) => Object.assign({
  vencimento: '2026-07-31', limite: '2026-09-29',
  pagador: 'NOS', cnpjPagador: '04226489000175',
  documento: '1000-1', beneficiario: 'FORNECEDOR GENERICO LTDA',
  cnpjBeneficiario: '11111111000111', banco: '237 - BCO BRADESCO S.A.',
  valorCentavos: 10000, situacao: 'A PAGAR', semSituacao: false
}, o);

// padrao: nota+parcela, com normalizacao dos dois lados
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '49676', parcela: '001' }),
    dup({ id: 'b', numeroNota: '49676', parcela: '002' })
  ]);
  const c = Dda.casar(reg({ documento: '0049676/01' }), base);
  eq('notaEParcela: zeros a esquerda nos dois lados nao atrapalham', c.duplicata && c.duplicata.id, 'a');
  eq('  ...e o como diz "nota+parcela"', c.como, ['nota+parcela']);

  const c2 = Dda.casar(reg({ documento: '49676-05' }), base);
  eq('notaEParcela: parcela inexistente NAO casa', c2.duplicata, null);
  eq('  ...sem ambiguidade (a nota existe, a parcela nao)', c2.ambiguo, false);
}

// parcela em letra: nao converte; desempata por valor e REGISTRA
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '550072', parcela: '001', valor: 121.58 }),
    dup({ id: 'b', numeroNota: '550072', parcela: '002', valor: 999 })
  ]);
  const c = Dda.casar(reg({ documento: '550072-D', valorCentavos: 12158 }), base);
  eq('parcela em letra casa por desempate de valor', c.duplicata && c.duplicata.id, 'a');
  eq('  ...e o como registra o desempate',
    c.como.some(p => /letra/.test(p) && /valor/.test(p)), true);

  const c2 = Dda.casar(reg({ documento: '550072-D', valorCentavos: 77700 }), base);
  eq('parcela em letra sem valor igual = ambiguo, nunca chute', c2.ambiguo, true);
}

// mesmo numero de nota em fornecedores diferentes: desempate por valor
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '777', parcela: '001', valor: 100, nomeEmitente: 'AAA' }),
    dup({ id: 'b', numeroNota: '777', parcela: '001', valor: 200, nomeEmitente: 'BBB' })
  ]);
  const c = Dda.casar(reg({ documento: '777/1', valorCentavos: 20000 }), base);
  eq('nota+parcela repetida entre fornecedores: valor decide', c.duplicata && c.duplicata.id, 'b');
  const c2 = Dda.casar(reg({ documento: '777/1', valorCentavos: 55500 }), base);
  eq('  ...e sem valor igual vira ambiguo com candidatas', c2.ambiguo && c2.candidatas.length, 2);
}

// Mari: nota sem parcela, desempate valor -> vencimento -> ambiguo
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '49676', parcela: '001', valor: 333.83, vencimento: '2026-07-31' }),
    dup({ id: 'b', numeroNota: '49676', parcela: '002', valor: 333.83, vencimento: '2026-08-31' }),
    dup({ id: 'c', numeroNota: '49676', parcela: '003', valor: 100, vencimento: '2026-09-30' })
  ]);
  const r = reg({ documento: '0000049676', beneficiario: 'MARI', valorCentavos: 33383 });
  const c = Dda.casar(r, base);
  eq('Mari: empate de valor desempata por vencimento', c.duplicata && c.duplicata.id, 'a');

  const c2 = Dda.casar(reg({ documento: '0000049676', beneficiario: 'MARI', valorCentavos: 10000 }), base);
  eq('Mari: valor unico decide', c2.duplicata && c2.duplicata.id, 'c');

  const base2 = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '49676', parcela: '001', valor: 333.83, vencimento: '2026-07-31' }),
    dup({ id: 'b', numeroNota: '49676', parcela: '002', valor: 333.83, vencimento: '2026-07-31' })
  ]);
  const c3 = Dda.casar(r, base2);
  eq('Mari: empate total = ambiguo, nunca escolhe', c3.ambiguo, true);

  // "MARIA CERAMICAS" nao pode cair na regra da Mari (palavra inteira)
  const c4 = Dda.casar(reg({ documento: '49676/01', beneficiario: 'MARIA CERAMICAS LTDA', valorCentavos: 33383 }), base);
  eq('regra da Mari nao pega "MARIA..." (palavra inteira)', c4.duplicata && c4.duplicata.id, 'a');
}

// Cerbras: valor e a chave forte, ESCOPADO ao cedente; vencimento so
// desempata; data diferente NAO derruba o casamento.
{
  const base = Dda.prepararBase([
    dup({ id: 'cerb1', numeroNota: '111', valor: 165.22, vencimento: '2026-08-01', nomeEmitente: 'CERAMICA BRASILEIRA CERBRAS LTDA' }),
    // mesmo valor em OUTRO fornecedor: nao pode entrar no escopo
    dup({ id: 'outro', numeroNota: '222', valor: 165.22, vencimento: '2026-07-31', nomeEmitente: 'OUTRA CERAMICA LTDA' })
  ]);
  const r = reg({ documento: '1812762', beneficiario: 'CERAMICA BRASILEIRA CERBRAS LTDA', valorCentavos: 16522 });
  const c = Dda.casar(r, base);
  eq('Cerbras: casa por valor dentro do escopo do cedente', c.duplicata && c.duplicata.id, 'cerb1');
  eq('  ...mesmo com vencimento deslocado (data nao e filtro)', c.duplicata.vencimento, '2026-08-01');
  eq('  ...e o documento interno do cedente foi ignorado', c.estrategia.indexOf('cerbras') !== -1, true);

  const base2 = Dda.prepararBase([
    dup({ id: 'c1', valor: 165.22, vencimento: '2026-07-31', nomeEmitente: 'CERBRAS LTDA' }),
    dup({ id: 'c2', valor: 165.22, vencimento: '2026-08-15', nomeEmitente: 'CERBRAS LTDA' })
  ]);
  const c2 = Dda.casar(r, base2);
  eq('Cerbras: dois valores iguais, vencimento exato desempata', c2.duplicata && c2.duplicata.id, 'c1');

  const base3 = Dda.prepararBase([
    dup({ id: 'c1', valor: 165.22, vencimento: '2026-08-15', nomeEmitente: 'CERBRAS LTDA' }),
    dup({ id: 'c2', valor: 165.22, vencimento: '2026-08-20', nomeEmitente: 'CERBRAS LTDA' })
  ]);
  const c3 = Dda.casar(r, base3);
  eq('Cerbras: dois iguais sem vencimento exato = ambiguo com candidatas',
    c3.ambiguo && c3.candidatas.length, 2);

  // duplicata ja paga e de outro ciclo: fora do escopo
  const base4 = Dda.prepararBase([
    dup({ id: 'paga', valor: 165.22, vencimento: '2026-07-31', nomeEmitente: 'CERBRAS LTDA', pago: true })
  ]);
  const c4 = Dda.casar(r, base4);
  eq('Cerbras: duplicata paga nao entra no escopo', c4.duplicata, null);
}

// documento ambiguo ("1 1626 2"): nem tenta
{
  const base = Dda.prepararBase([dup({ id: 'a', numeroNota: '1626' })]);
  const c = Dda.casar(reg({ documento: '1 1626 2' }), base);
  eq('documento com dois separadores vira ambiguo, sem chute', c.ambiguo, true);
}

// ── 4. As situacoes do relatorio ─────────────────────────────

const notasPorChave = {
  'chave-ok':        { noSistema: true },
  'chave-semEntrada':{ noSistema: false },
  'chave-cancelada': { noSistema: true, status: 'cancelada' }
};
const ctx = (duplicatas, extra) => Object.assign({
  duplicatas: duplicatas, notasPorChave: notasPorChave,
  corteJanela: '2025-08-01', periodo: { ini: '2026-07-31', fim: '2026-07-31' }
}, extra);

// 1+7 cumulativos: valor divergente E vencimento antecipado na mesma linha
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', valor: 100, vencimento: '2026-08-05', chaveAcesso: 'chave-ok' });
  const rel = Dda.conferir([reg({ documento: '10/1', valorCentavos: 9999 })], ctx([d]));
  const l = rel.linhas[0];
  eq('valor divergente E vencimento antecipado ACUMULAM na mesma linha',
    tipos(l), ['valorDivergente', 'vencimentoAntecipado']);
  eq('  ...gravidade da linha = a pior (vermelho)', gravidadeDe(l), G.VERMELHO);
  eq('  ...um centavo ja e divergencia (9999 != 10000)',
    l.problemas.some(p => p.tipo === 'valorDivergente'), true);
}

// 4: ja pago
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', pago: true, chaveAcesso: 'chave-ok' });
  const rel = Dda.conferir([reg({ documento: '10/1' })], ctx([d]));
  eq('boleto de duplicata ja paga = vermelho',
    tipos(rel.linhas[0]).includes('jaPago') && gravidadeDe(rel.linhas[0]) === G.VERMELHO, true);
}

// 5: nota cancelada
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', chaveAcesso: 'chave-cancelada' });
  const rel = Dda.conferir([reg({ documento: '10/1' })], ctx([d]));
  eq('nota de origem cancelada = vermelho', tipos(rel.linhas[0]).includes('notaCancelada'), true);
}

// 6: material nao recebido e AMARELO, nao vermelho
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', chaveAcesso: 'chave-semEntrada' });
  const rel = Dda.conferir([reg({ documento: '10/1' })], ctx([d]));
  const l = rel.linhas[0];
  eq('nota sem entrada no ERP = amarelo (caso de prorrogar)',
    tipos(l).includes('materialNaoRecebido') && gravidadeDe(l) === G.AMARELO, true);
}

// banco baixou, nos nao (a divergencia de controle que so o DDA mostra)
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', pago: false, chaveAcesso: 'chave-ok' });
  const rel = Dda.conferir([reg({ documento: '10/1', situacao: 'LIQUIDADO' })], ctx([d]));
  eq('banco diz liquidado + nos sem baixa = amarelo',
    tipos(rel.linhas[0]).includes('bancoBaixouNosNao'), true);
  // "A PAGAR" contem "pagar": nao pode disparar o mesmo aviso
  const rel2 = Dda.conferir([reg({ documento: '10/1', situacao: 'A PAGAR' })], ctx([d]));
  eq('  ..."A PAGAR" NAO dispara o aviso (palavra inteira)',
    tipos(rel2.linhas[0]).includes('bancoBaixouNosNao'), false);
}

// 7 com vencimento null: vira branco e NAO bloqueia as outras checagens
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', vencimento: null, valor: 50, chaveAcesso: 'chave-ok' });
  const rel = Dda.conferir([reg({ documento: '10/1', valorCentavos: 9999 })], ctx([d]));
  const l = rel.linhas[0];
  eq('duplicata sem vencimento: aviso branco', tipos(l).includes('duplicataSemVencimento'), true);
  eq('  ...e o valor divergente continua valendo na mesma linha',
    tipos(l).includes('valorDivergente'), true);
}

// 3: duplicidade nivel 1 (linha repetida no PDF)
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', chaveAcesso: 'chave-ok' });
  const r1 = reg({ documento: '10/1' });
  const rel = Dda.conferir([r1, Object.assign({}, r1)], ctx([d]));
  eq('linha repetida no PDF marca os DOIS boletos',
    rel.linhas.every(l => tipos(l).includes('duplicidadeNoPdf')), true);
}

// 3: duplicidade nivel 2 (dois boletos -> a MESMA duplicata; o caso do
// fundo, que a chave por beneficiario deixaria passar)
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', chaveAcesso: 'chave-ok' });
  const doFundo = reg({ documento: '10-1', beneficiario: 'CSMJ SECURITIZADORA S.A.', cnpjBeneficiario: '32945591000166' });
  const doFornecedor = reg({ documento: '10/1', beneficiario: 'FORNECEDOR GENERICO LTDA' });
  const rel = Dda.conferir([doFundo, doFornecedor], ctx([d]));
  eq('fundo e fornecedor cobrando a MESMA duplicata: vermelho nos dois',
    rel.linhas.every(l => tipos(l).includes('duplicidadeDeDuplicata') && gravidadeDe(l) === G.VERMELHO), true);
}

// 8: titulo nosso no periodo sem boleto — informativo, com exclusoes
{
  const semBoleto = dup({ id: 'x', numeroNota: '99', parcela: '001', vencimento: '2026-07-31', chaveAcesso: 'chave-ok' });
  const paga = dup({ id: 'y', numeroNota: '98', parcela: '001', vencimento: '2026-07-31', pago: true, chaveAcesso: 'chave-ok' });
  const cancelada = dup({ id: 'z', numeroNota: '97', parcela: '001', vencimento: '2026-07-31', chaveAcesso: 'chave-cancelada' });
  const foraPeriodo = dup({ id: 'w', numeroNota: '96', parcela: '001', vencimento: '2026-08-15', chaveAcesso: 'chave-ok' });
  const rel = Dda.conferir([], ctx([semBoleto, paga, cancelada, foraPeriodo]));
  eq('so a duplicata aberta, do periodo e de nota viva fica "fora do DDA"',
    rel.foraDoDda.map(d2 => d2.id), ['x']);
  const rel2 = Dda.conferir([], ctx([semBoleto], { periodo: null }));
  eq('sem periodo lido do cabecalho, a lista nem e feita', rel2.foraDoDda.length, 0);
}

// ── 5. O principio da janela: ⚪, nunca 🔴 ────────────────────

{
  // Boleto que nao casou com NADA, vencendo ANTES do corte da janela:
  // pode ser so uma duplicata que nao foi baixada. ⚪ indeterminado.
  const r = reg({ documento: '55555/1', vencimento: '2024-01-15', valorCentavos: 7777 });
  const rel = Dda.conferir([r], ctx([], { periodo: null }));
  const l = rel.linhas[0];
  eq('nao casou + fora da janela = BRANCO indeterminado', gravidadeDe(l), G.BRANCO);
  eq('  ...do tipo foraDaJanela', tipos(l).includes('foraDaJanela'), true);
  eq('  ...e NUNCA cobrancaSemNota', tipos(l).includes('cobrancaSemNota'), false);

  // Mesmo boleto, historico completo carregado (corte null): agora a
  // ausencia E' resposta.
  const rel2 = Dda.conferir([r], ctx([], { corteJanela: null, periodo: null }));
  eq('nao casou + historico completo = VERMELHO cobranca sem nota',
    tipos(rel2.linhas[0]).includes('cobrancaSemNota'), true);

  // Dentro da janela tambem e vermelho.
  const r3 = reg({ documento: '55555/1', vencimento: '2026-07-31' });
  const rel3 = Dda.conferir([r3], ctx([], { periodo: null }));
  eq('nao casou + dentro da janela = VERMELHO', gravidadeDe(rel3.linhas[0]), G.VERMELHO);

  // Ambiguidade tambem nunca vira vermelho.
  const base = [
    dup({ id: 'a', numeroNota: '70', parcela: '001', valor: 10, vencimento: '2026-07-31', chaveAcesso: 'chave-ok' }),
    dup({ id: 'b', numeroNota: '70', parcela: '001', valor: 10, vencimento: '2026-07-31', chaveAcesso: 'chave-ok' })
  ];
  const rel4 = Dda.conferir([reg({ documento: '70/1', valorCentavos: 1000 })], ctx(base, { periodo: null }));
  eq('casamento ambiguo = BRANCO, com as candidatas mostradas',
    gravidadeDe(rel4.linhas[0]) === G.BRANCO && rel4.linhas[0].casamento.candidatas.length === 2, true);
}

// Ordenacao: vermelho primeiro, e valor maior primeiro dentro da gravidade
{
  const ds = [dup({ id: 'a', numeroNota: '10', parcela: '001', valor: 99.99, chaveAcesso: 'chave-ok' })];
  const rel = Dda.conferir([
    reg({ documento: '10/1', valorCentavos: 9999 }),                              // ✅ ok
    reg({ documento: '404/1', vencimento: '2026-07-31', valorCentavos: 100 }),    // 🔴 menor
    reg({ documento: '405/1', vencimento: '2026-07-31', valorCentavos: 900000 })  // 🔴 maior
  ], ctx(ds, { periodo: null }));
  eq('ordem: vermelhos primeiro, maior valor primeiro, ok por ultimo',
    rel.linhas.map(l => l.registro.documento), ['405/1', '404/1', '10/1']);
  eq('resumo bate com as linhas', [rel.resumo.vermelhos, rel.resumo.ok], [2, 1]);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
