/*
  Conferencia de DDA (PDF do Bradesco e planilha do Safra) contra as
  duplicatas.

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

// O CNPJ da fixture e' ficticio (repositorio publico); o que o teste
// trava e' a NORMALIZACAO: 15 digitos do Bradesco -> 14, em todos.
eq('CNPJ do pagador normalizado em todos',
  lido.registros.every(r => r.cnpjPagador === '00111222000133'), true);

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

// A regra (14/09/2026): a NOTA e' o eixo; dentro dela, VALOR e
// VENCIMENTO decidem. A parcela do boleto so' desempata — e, quando
// nenhuma parcela tem o valor do boleto, e' o que permite casar e
// acusar o valor adulterado.

// 1) nota + valor + vencimento exatos, com normalizacao dos dois lados
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '49676', parcela: '001', valor: 100, vencimento: '2026-07-31' }),
    dup({ id: 'b', numeroNota: '49676', parcela: '002', valor: 200, vencimento: '2026-08-31' })
  ]);
  const c = Dda.casar(reg({ documento: '0049676/01', valorCentavos: 10000 }), base);
  eq('nota+valor+vencimento: zeros a esquerda nos dois lados nao atrapalham', c.duplicata && c.duplicata.id, 'a');
  eq('  ...e o como diz por onde', c.como, ['nota', 'valor', 'vencimento']);

  // A parcela do boleto NAO manda: "parcela 1" do fornecedor que conta
  // a partir da segunda casa com a nossa 002 pelo valor e vencimento.
  const c2 = Dda.casar(reg({ documento: '49676/01', valorCentavos: 20000, vencimento: '2026-08-31' }), base);
  eq('parcela do boleto diferente da nossa: valor e vencimento decidem', c2.duplicata && c2.duplicata.id, 'b');

  // Parcela inexistente com valor e vencimento certos: casa igual.
  const c3 = Dda.casar(reg({ documento: '49676-05', valorCentavos: 10000 }), base);
  eq('parcela inexistente + valor e vencimento certos: casa (a parcela nao e filtro)', c3.duplicata && c3.duplicata.id, 'a');

  // Sem parcela nenhuma (Mari: '0000049676'): a mesma regra.
  const c4 = Dda.casar(reg({ documento: '0000049676', valorCentavos: 20000, vencimento: '2026-08-31' }), base);
  eq('documento so com a nota: casa por valor e vencimento', c4.duplicata && c4.duplicata.id, 'b');
}

// 2) so' o valor bate: casa, e o vencimento diferente fica registrado
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '500', parcela: '001', valor: 100, vencimento: '2026-08-10' }),
    dup({ id: 'b', numeroNota: '500', parcela: '002', valor: 200, vencimento: '2026-09-10' })
  ]);
  const c = Dda.casar(reg({ documento: '500/1', valorCentavos: 20000, vencimento: '2026-08-31' }), base);
  eq('valor unico na nota com vencimento diferente: casa', c.duplicata && c.duplicata.id, 'b');
  eq('  ...e o como registra "vencimento diferente"', c.como, ['nota', 'valor', 'vencimento diferente']);
}

// Empates: a parcela desempata (numero ou letra como posicao); sem
// desempate, ambiguo com as candidatas.
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '600', parcela: '001', valor: 363, vencimento: '2026-07-31' }),
    dup({ id: 'b', numeroNota: '600', parcela: '002', valor: 363, vencimento: '2026-07-31' }),
    dup({ id: 'c', numeroNota: '600', parcela: '003', valor: 363, vencimento: '2026-09-30' })
  ]);
  const c = Dda.casar(reg({ documento: '600/02', valorCentavos: 36300 }), base);
  eq('duas parcelas iguais em valor e vencimento: a parcela desempata', c.duplicata && c.duplicata.id, 'b');
  eq('  ...e o como registra o desempate', c.como, ['nota', 'valor', 'vencimento', 'desempate pela parcela']);
  const c2 = Dda.casar(reg({ documento: '600B H', valorCentavos: 36300 }), base);
  eq('  ...tambem com a parcela em letra (B = 2a)', c2.duplicata && c2.duplicata.id, 'b');
  const c3 = Dda.casar(reg({ documento: '600', valorCentavos: 36300 }), base);
  eq('  ...sem parcela para desempatar = ambiguo, nunca escolhe', c3.ambiguo && c3.candidatas.length, 2);
  const c4 = Dda.casar(reg({ documento: '600/9', valorCentavos: 36300 }), base);
  eq('  ...parcela que nao existe tambem nao desempata', c4.ambiguo, true);

  // So' valor bate (vencimento de nenhuma), duas iguais: parcela desempata
  const c5 = Dda.casar(reg({ documento: '600/1', valorCentavos: 36300, vencimento: '2026-12-01' }), base);
  eq('tres do mesmo valor, nenhuma no vencimento: parcela desempata', c5.duplicata && c5.duplicata.id, 'a');
  eq('  ...e o como diz nota, valor, desempate', c5.como, ['nota', 'valor', 'desempate pela parcela']);
}

// 3) nenhuma parcela da nota tem o valor: casa pela parcela para o
// relatorio acusar o valor divergente (o alarme de fraude).
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '700', parcela: '001', valor: 121.58 }),
    dup({ id: 'b', numeroNota: '700', parcela: '002', valor: 999 })
  ]);
  const c = Dda.casar(reg({ documento: '700/2', valorCentavos: 99999 }), base);
  eq('valor nao bate em nenhuma parcela, mas a parcela existe: casa por ela', c.duplicata && c.duplicata.id, 'b');
  eq('  ...e o como avisa que o valor NAO bate', c.como, ['nota', 'parcela', 'valor NÃO bate']);
  const c2 = Dda.casar(reg({ documento: '700-B', valorCentavos: 99999 }), base);
  eq('  ...parcela em letra tambem (B = 2a)', c2.duplicata && c2.duplicata.id, 'b');

  // 4) nota existe, nada bate: sem casar, com as parcelas mostradas, e
  // NAO cai no ultimo recurso (a nota e' o eixo).
  const c3 = Dda.casar(reg({ documento: '700/9', valorCentavos: 99999 }), base);
  eq('nota existe, valor e parcela sem par: nao casa', c3.duplicata, null);
  eq('  ...sem ambiguidade, com as parcelas da nota como candidatas', [c3.ambiguo, c3.candidatas.length], [false, 2]);
  eq('  ...e o motivo explica', /nenhuma parcela tem esse valor nem a parcela 9/.test(c3.motivo), true);
  const c4 = Dda.casar(reg({ documento: '700', valorCentavos: 99999 }), base);
  eq('nota existe, sem parcela no documento, valor sem par: nao casa', [c4.duplicata, c4.candidatas.length], [null, 2]);
}

// Mesmo numero de nota em fornecedores diferentes: valor decide (a base
// e' por numero da nota; o fornecedor vem da duplicata encontrada).
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '777', parcela: '001', valor: 100, nomeEmitente: 'AAA' }),
    dup({ id: 'b', numeroNota: '777', parcela: '001', valor: 200, nomeEmitente: 'BBB' })
  ]);
  const c = Dda.casar(reg({ documento: '777/1', valorCentavos: 20000 }), base);
  eq('nota repetida entre fornecedores: valor decide', c.duplicata && c.duplicata.id, 'b');
  const c2 = Dda.casar(reg({ documento: '777/1', valorCentavos: 55500 }), base);
  eq('  ...valor sem par: as duas tem a parcela 1, ambiguo entre elas',
    [c2.duplicata, c2.ambiguo, c2.candidatas.length], [null, false, 2]);
}

// "MARIA CERAMICAS" nao pode cair em regra de cedente (palavra inteira):
// hoje so' a Cerbras tem regra, e a Mari segue a estrategia padrao.
{
  const base = Dda.prepararBase([dup({ id: 'a', numeroNota: '49676', parcela: '001', valor: 333.83 })]);
  const c = Dda.casar(reg({ documento: '0000049676', beneficiario: 'MARI', valorCentavos: 33383 }), base);
  eq('Mari: estrategia padrao, casa por nota+valor+vencimento', [c.duplicata && c.duplicata.id, c.estrategia], ['a', 'nota+valor+vencimento']);
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

// documento ambiguo ("1 1626 2"): o documento NAO e' interpretado.
// O que resta e' o ultimo recurso — valor E vencimento exatos, na base
// inteira, so' se sobrar UMA duplicata — e o `como` registra que foi
// por ai'. Sem par exato: ambiguo, sem chute.
{
  const base = Dda.prepararBase([dup({ id: 'a', numeroNota: '1626' })]);
  const c = Dda.casar(reg({ documento: '1 1626 2', valorCentavos: 12345 }), base);
  eq('documento com dois separadores e valor sem par = ambiguo, sem chute', c.ambiguo, true);
  eq('  ...e o motivo diz que o documento e ambiguo', /ambíguo/.test(c.motivo), true);
  const c2 = Dda.casar(reg({ documento: '1 1626 2' }), base);
  eq('documento ambiguo + valor e vencimento UNICOS na base = casa pelo ultimo recurso',
    c2.duplicata && c2.duplicata.id, 'a');
  eq('  ...e o como registra o caminho', c2.como, ['valor+vencimento únicos na base']);
}

// ultimo recurso: nunca escolhe entre duas
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '7001', valor: 2199.86 }),
    dup({ id: 'b', numeroNota: '7002', valor: 2199.86 })
  ]);
  const c = Dda.casar(reg({ documento: '', valorCentavos: 219986 }), base);
  eq('sem documento + duas duplicatas com o mesmo valor e vencimento = ambiguo', c.ambiguo, true);
  eq('  ...com as duas candidatas mostradas', c.candidatas.map(d => d.id), ['a', 'b']);
  eq('  ...e o motivo diz "sem número de documento"', /sem número de documento/.test(c.motivo), true);

  // Uma paga e uma em aberto: a em aberto desempata, e o como registra.
  const base2 = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '7001', valor: 2199.86, pago: true }),
    dup({ id: 'b', numeroNota: '7002', valor: 2199.86 })
  ]);
  const c2 = Dda.casar(reg({ documento: '', valorCentavos: 219986 }), base2);
  eq('  ...mas se so uma esta em aberto, ela desempata', c2.duplicata && c2.duplicata.id, 'b');
  eq('  ...e o como diz que foi desempate', c2.como, ['valor+vencimento', 'desempate: única em aberto']);

  // Nota fora da base + valor/vencimento unicos: tambem casa (cedente
  // que numera o boleto do seu jeito: '1634349E G').
  const c3 = Dda.casar(reg({ documento: '999999/1', valorCentavos: 219986 }), base2);
  eq('nota fora da base + valor/vencimento unicos em aberto = casa, e diz por onde',
    c3.duplicata && c3.duplicata.id === 'b' && c3.como[0] === 'valor+vencimento', true);
  // Nota que existe: a parcela nao importa, o valor e o vencimento
  // dentro dela decidem — e sem par dentro da nota NAO cai no ultimo
  // recurso (a nota e' o eixo).
  const c4 = Dda.casar(reg({ documento: '7002/9', valorCentavos: 219986 }), base2);
  eq('nota existe: casa pelo valor e vencimento dentro dela, parcela 9 ignorada', c4.duplicata && c4.duplicata.id, 'b');
  const c5 = Dda.casar(reg({ documento: '7002/9', valorCentavos: 1 }), base2);
  eq('nota existe sem par dentro dela: nao casa, e NAO tenta a base inteira', [c5.duplicata, c5.candidatas.length], [null, 1]);
}

// separador no fim ('44536-', planilha do Safra) = nota sem parcela
eq('documento com separador no fim = nota sem parcela',
  Dda.dividirDocumento('44536-'), { nota: '44536', parcela: null });

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

// ── 5. Planilha do Safra (.xlsx) ─────────────────────────────
//
// Mesmo layout da exportacao real "Boletos DDA" (14/09/2026): titulo,
// CNPJ e periodo acima, um resumo, a linha de cabecalho e os boletos.
// Nomes e valores sao fabricados; a FORMA e' a do banco: valor em
// numero, data em texto dd/mm/aaaa, documento com espaco ('375033 01'),
// com letra ('1634349E G'), com separador no fim ('44536-') e VAZIO,
// beneficiario final so' quando o cedente e' fundo, BAIXADO com valor
// a pagar zero.

const CAB = ['Tipo', 'Empresa', 'CNPJ / CPF', 'Vencimento', 'Nº documento', 'Nosso número',
  'Beneficiário', 'Banco', 'Nominal (R$)', 'Valor Total (R$)', 'Situação', 'Beneficiario Final'];
const linhaSafra = (o) => ['Pagador', 'NOSSA LOJA LTDA', '00.111.222/0001-33',
  o.venc || '14/09/2026', o.doc == null ? '375033 01' : o.doc, o.nn || '01008251230002348097',
  o.ben || 'SECURITIZADORA XYZ S.A.', o.banco || 756,
  o.nominal == null ? 4940.76 : o.nominal, o.total == null ? (o.nominal == null ? 4940.76 : o.nominal) : o.total,
  o.sit || 'ABERTO', o.final || ''];
const planilhaSafra = (boletos) => [
  ['', 'Banco Safra', '', '', '', '', '', '', 'FULANO', '', '14/09/2026 11:49', ''],
  ['', 'CNPJ: 00.000.000/0001-00'],
  [],
  ['Boletos DDA'],
  [],
  ['Período: 08/09/2026 até 14/09/2026'],
  [],
  ['Quantidade', 'Valor nominal total (R$)', 'Valor a pagar total (R$)'],
  [boletos.length, 1, 1],
  [],
  CAB
].concat(boletos);

{
  const lido = Dda.interpretarPlanilha(planilhaSafra([
    linhaSafra({}),
    linhaSafra({ doc: '1634349E G', ben: 'CERAMICA ABC LTDA.', banco: 1, nominal: 511.92 }),
    linhaSafra({ doc: '44536-', nominal: 2370.19 }),
    linhaSafra({ doc: '', ben: 'A. FULANO', nominal: 1650 }),
    linhaSafra({ doc: '15974 2', ben: 'FUNDO DE INVESTIMENTO Q', nominal: 645.83, final: 'INDUSTRIA DE PAPEL LTDA' }),
    linhaSafra({ doc: '000001195', nominal: 3370.91, total: 0, sit: 'BAIXADO' }),
    linhaSafra({ doc: '0760825 02', nominal: 3483.26, total: 3500.10, sit: 'PAGO' })
  ]));
  eq('planilha: origem marcada', lido.origem, 'planilha');
  eq('planilha: periodo lido do cabecalho ("Período: X até Y")', lido.periodo, { ini: '2026-09-08', fim: '2026-09-14' });
  eq('planilha: 7 boletos, 0 ilegiveis', [lido.registros.length, lido.ilegiveis.length], [7, 0]);
  const r0 = lido.registros[0];
  eq('planilha: vencimento dd/mm/aaaa vira ISO', r0.vencimento, '2026-09-14');
  eq('planilha: valor em numero vira centavos inteiros (4940.76 -> 494076)', r0.valorCentavos, 494076);
  eq('planilha: documento, beneficiario, banco e nosso numero no lugar',
    [r0.documento, r0.beneficiario, r0.banco, r0.nossoNumero],
    ['375033 01', 'SECURITIZADORA XYZ S.A.', '756', '01008251230002348097']);
  eq('planilha: CNPJ do pagador normalizado, CNPJ do beneficiario vazio (a planilha nao traz)',
    [r0.cnpjPagador, r0.cnpjBeneficiario], ['00111222000133', '']);
  eq('planilha: situacao presente, semSituacao false', [r0.situacao, r0.semSituacao], ['ABERTO', false]);
  eq('planilha: beneficiario final so quando existe',
    [lido.registros[4].beneficiarioFinal, r0.beneficiarioFinal], ['INDUSTRIA DE PAPEL LTDA', null]);
  eq('planilha: documento vazio e registro VALIDO (nao ilegivel)', lido.registros[3].documento, '');
  eq('planilha: BAIXADO com valor a pagar zero, nominal preservado',
    [lido.registros[5].valorCentavos, lido.registros[5].valorAPagarCentavos], [337091, 0]);
  eq('planilha: valor a pagar diferente do nominal preservado (3500.10)',
    lido.registros[6].valorAPagarCentavos, 350010);
}

// Cabecalho em outra posicao/ordem e datas como Date ou serial:
// o que ancora e' o ROTULO, nao a coluna.
{
  const lido = Dda.interpretarPlanilha([
    ['qualquer coisa'],
    ['Beneficiário', 'Nominal (R$)', 'Vencimento', 'Nº documento', 'Situação'],
    ['FORN A', 100, new Date(2026, 8, 14), '10/1', 'PAGO'],
    ['FORN B', 200, 46279, '11/1', 'ABERTO'],      // serial do Excel = 14/09/2026
    ['FORN C', 300, 'não é data', '12/1', 'ABERTO'],
    ['Total', 600]
  ]);
  eq('planilha: colunas fora de ordem, achadas pelo rotulo',
    lido.registros.map(r => r.beneficiario), ['FORN A', 'FORN B']);
  eq('planilha: Date e serial do Excel viram a mesma data ISO',
    lido.registros.map(r => r.vencimento), ['2026-09-14', '2026-09-14']);
  eq('planilha: linha com data ilegivel vai para ilegiveis (nunca registro pela metade)',
    lido.ilegiveis.length === 1 && /vencimento ilegível/.test(lido.ilegiveis[0].motivo), true);
  eq('planilha: linha "Total" do rodape e ignorada em silencio',
    lido.registros.length + lido.ilegiveis.length, 3);
  eq('planilha: sem periodo no cabecalho = null (o check 8 e pulado, como no PDF)', lido.periodo, null);
}

{
  const lido = Dda.interpretarPlanilha([['Boletos'], ['a', 'b', 'c']]);
  eq('planilha sem cabecalho reconhecivel: zero registros e UM ilegivel explicando',
    [lido.registros.length, lido.ilegiveis.length, /cabeçalho/.test(lido.ilegiveis[0].motivo)], [0, 1, true]);
}

// A planilha entra no MESMO conferir do PDF — e' o que faz a lista
// de baixa em lote existir para os dois bancos.
{
  const base = [
    dup({ id: 'a', numeroNota: '375033', parcela: '001', valor: 4940.76, vencimento: '2026-09-14', chaveAcesso: 'chave-ok' }),
    dup({ id: 'b', numeroNota: '760825', parcela: '002', valor: 3483.26, vencimento: '2026-09-14', chaveAcesso: 'chave-ok' }),
    dup({ id: 'c', numeroNota: '44536', parcela: '001', valor: 2370.19, vencimento: '2026-09-14', chaveAcesso: 'chave-ok', pago: true }),
    dup({ id: 'd', numeroNota: '1195', parcela: '001', valor: 3370.91, vencimento: '2026-09-14', chaveAcesso: 'chave-ok' }),
    dup({ id: 'e', numeroNota: '9', parcela: '001', valor: 1650, vencimento: '2026-09-14', chaveAcesso: 'chave-ok' })
  ];
  const lido = Dda.interpretarPlanilha(planilhaSafra([
    linhaSafra({ doc: '375033 01', nominal: 4940.76, sit: 'PAGO' }),                    // pago la, aberto aqui
    linhaSafra({ doc: '0760825 02', nominal: 3483.26, total: 3500.10, sit: 'PAGO' }),   // idem, com juros embutidos
    linhaSafra({ doc: '44536-', nominal: 2370.19, sit: 'PAGO' }),                       // pago dos dois lados
    linhaSafra({ doc: '000001195', nominal: 3370.91, total: 0, sit: 'BAIXADO' }),       // baixado: nao e pago
    linhaSafra({ doc: '', ben: 'A. FULANO', nominal: 1650, sit: 'ABERTO' })             // sem documento, em aberto
  ]));
  const rel = Dda.conferir(lido.registros, ctx(base, { periodo: lido.periodo }));
  const por = (doc) => rel.linhas.find(l => l.registro.documento === doc);

  eq('PAGO no banco + aberto aqui = amarelo bancoBaixouNosNao', tipos(por('375033 01')), ['bancoBaixouNosNao']);
  eq('  ...e entra na lista de baixa em lote', rel.baixaveis.map(l => l.casamento.duplicata.id).sort(), ['a', 'b']);
  eq('juros embutidos: aviso branco a mais, e continua baixavel',
    tipos(por('0760825 02')), ['bancoBaixouNosNao', 'valorAPagarDiferente']);
  eq('PAGO no banco + pago aqui = ✅ (reimportar o DDA de ontem nao acusa nada)',
    [tipos(por('44536-')), gravidadeDe(por('44536-'))], [[], G.OK]);
  eq('BAIXADO = amarelo proprio (baixadoNoBanco), fora do lote',
    [tipos(por('000001195')), rel.baixaveis.some(l => l.casamento.duplicata.id === 'd')], [['baixadoNoBanco'], false]);
  eq('  ...e o valor a pagar zero do BAIXADO nao vira aviso de juros',
    tipos(por('000001195')).includes('valorAPagarDiferente'), false);
  eq('sem documento, em aberto: casa pelo ultimo recurso e fica ✅',
    [por('').casamento.duplicata.id, gravidadeDe(por(''))], ['e', G.OK]);
  eq('resumo: 3 amarelos, 2 ok', [rel.resumo.amarelos, rel.resumo.ok, rel.resumo.vermelhos], [3, 2, 0]);
}

// Lote NUNCA leva vermelho: banco diz pago, mas o valor diverge.
{
  const base = [dup({ id: 'a', numeroNota: '10', parcela: '001', valor: 100, chaveAcesso: 'chave-ok' })];
  const rel = Dda.conferir([reg({ documento: '10/1', situacao: 'PAGO', valorCentavos: 10001 })], ctx(base));
  eq('pago no banco com valor divergente: vermelho, e FORA da lista de baixa',
    [gravidadeDe(rel.linhas[0]), rel.baixaveis.length], [G.VERMELHO, 0]);
}

// ── 6. Formatos de documento da planilha real de 30 dias ─────

eq('Formigres "1666488B H": nota + parcela B, o H (ultima parcela) se descarta',
  Dda.dividirDocumento('1666488B H'), { nota: '1666488', parcela: 'B' });
eq('nota colada na letra ("000341713C"): nota sem zeros + parcela C',
  Dda.dividirDocumento('000341713C'), { nota: '341713', parcela: 'C' });
eq('nota + sigla do cedente ("1715506STI"): nota sem parcela',
  Dda.dividirDocumento('1715506STI'), { nota: '1715506', parcela: null });
eq('separador sobrando no fim ("470970/02/"): nota + parcela 2',
  Dda.dividirDocumento('470970/02/'), { nota: '470970', parcela: '2' });
eq('ponto como separador ("48074.1")', Dda.dividirDocumento('48074.1'), { nota: '48074', parcela: '1' });
eq('espacos repetidos ("7359   P1"): nota + "parcela" P1 (sigla, nao posicao)',
  Dda.dividirDocumento('7359   P1'), { nota: '7359', parcela: 'P1' });
eq('"482700 ST": nota + sigla como parcela (vai desempatar por valor)',
  Dda.dividirDocumento('482700 ST'), { nota: '482700', parcela: 'ST' });
eq('transportadora "1 7112 1" continua ambiguo (serie? nota? parcela?)',
  Dda.dividirDocumento('1 7112 1'), { ambiguo: true });
eq('letra unica vira posicao: A=1, B=2, H=8', ['A', 'b', 'H'].map(Dda.parcelaDaLetra), ['1', '2', '8']);
eq('sigla nao e posicao: ST, ICM, P1 -> null', ['ST', 'ICM', 'P1'].map(Dda.parcelaDaLetra), [null, null, null]);

// Letra = posicao da parcela (regra do fornecedor, 14/09/2026): casa
// pela POSICAO antes de desempatar por valor, e o como registra.
{
  const base = Dda.prepararBase([
    dup({ id: 'a', numeroNota: '1666488', parcela: '001', valor: 363 }),
    dup({ id: 'b', numeroNota: '1666488', parcela: '002', valor: 363 }),
    dup({ id: 'c', numeroNota: '1666488', parcela: '003', valor: 363 })
  ]);
  const c = Dda.casar(reg({ documento: '1666488B H', valorCentavos: 36300 }), base);
  eq('parcela B com tres parcelas do MESMO valor e vencimento: a letra desempata (B = 2a)',
    c.duplicata && c.duplicata.id, 'b');
  eq('  ...e o como registra o desempate', c.como, ['nota', 'valor', 'vencimento', 'desempate pela parcela']);
  // Posicao que nao existe (D = 4a): nao desempata, ambiguo.
  const c2 = Dda.casar(reg({ documento: '1666488D H', valorCentavos: 36300 }), base);
  eq('posicao inexistente + valores iguais = ambiguo, sem chute', c2.ambiguo, true);
  eq('parcelaCasa: numero ou letra como posicao',
    [Dda.parcelaCasa({ parcela: '002' }, '2'), Dda.parcelaCasa({ parcela: '002' }, 'B'), Dda.parcelaCasa({ parcela: '002' }, 'C')],
    [true, true, false]);
}

// PAGO e BAIXADO vem com "valor a pagar" ZERO na planilha real (447 de
// 500 linhas): zero nao e' juros nem desconto.
{
  const base = [dup({ id: 'a', numeroNota: '10', parcela: '001', valor: 100, chaveAcesso: 'chave-ok' })];
  const rel = Dda.conferir([reg({ documento: '10/1', situacao: 'PAGO', valorAPagarCentavos: 0 })], ctx(base));
  eq('PAGO com valor a pagar zero: so o aviso de baixa, sem "valor a pagar difere"',
    tipos(rel.linhas[0]), ['bancoBaixouNosNao']);
  const rel2 = Dda.conferir([reg({ documento: '10/1', situacao: 'VENCIDO', valorAPagarCentavos: 10500 })], ctx(base));
  eq('VENCIDO com juros embutidos: aviso branco de valor a pagar', tipos(rel2.linhas[0]), ['valorAPagarDiferente']);
}

// O Safra corta a exportacao em 500 linhas sem avisar.
{
  const muitas = [];
  for (let i = 0; i < 500; i++) muitas.push(linhaSafra({ doc: String(1000 + i) + ' 1', venc: i < 250 ? '08/09/2026' : '09/09/2026', sit: 'PAGO', total: 0 }));
  const lido = Dda.interpretarPlanilha(planilhaSafra(muitas));
  eq('500 linhas: aviso de corte', /500 linhas/.test(lido.aviso || ''), true);
  eq('  ...e o periodo encolhe ate o ultimo vencimento lido, marcado como cortado',
    lido.periodo, { ini: '2026-09-08', fim: '2026-09-09', cortado: true });
  const poucas = Dda.interpretarPlanilha(planilhaSafra(muitas.slice(0, 40)));
  eq('40 linhas: sem aviso, periodo do cabecalho intacto', [poucas.aviso, poucas.periodo.cortado], [null, undefined]);
}

// "ja pago" so' e' vermelho quando o banco AINDA cobra.
{
  const d = dup({ id: 'a', numeroNota: '10', parcela: '001', pago: true, dataPagamento: '2026-09-10', chaveAcesso: 'chave-ok' });
  const rel = Dda.conferir([reg({ documento: '10/1', situacao: 'A PAGAR' })], ctx([d]));
  eq('pago aqui + banco ainda cobrando = vermelho jaPago', tipos(rel.linhas[0]).includes('jaPago'), true);
  const rel2 = Dda.conferir([reg({ documento: '10/1', situacao: 'BAIXADO' })], ctx([d]));
  eq('pago aqui + BAIXADO no banco = nada a apontar', tipos(rel2.linhas[0]), []);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
