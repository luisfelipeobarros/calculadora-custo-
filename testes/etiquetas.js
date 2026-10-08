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
eq('item sem "n" usa a posicao', linhas[2].n, 1);
eq('situacoes: retirar, concluida, dispensada', linhas.map(l => l.situacao), ['retirar', 'concluida', 'dispensada']);
eq('quantidade em texto vira numero; unidade e codigo vem junto',
  [linhas[1].qtd, linhas[1].un, linhas[1].codigo], [5, 'UN', 'P2']);
eq('recebimento e previsao vem da nota', [linhas[0].recebida, linhas[2].recebida, linhas[2].previsaoEntrega], [true, false, '2026-10-10']);
eq('fornecedor passa pela regra comum (nome cru fica guardado)', [linhas[0].fornecedor, linhas[0].nomeEmitente], ['Fornecedor <X>', 'Fornecedor <X>']);
eq('nota que nao esta carregada conta como nao recebida',
  N.linhasDeTransito([{ chave: 'Z', itens: [{ descricao: 'y' }] }], {}, {})[0].situacao, 'etiquetar');

// ── NCM: so' pisos, revestimentos e porcelanatos ─────────────

eq('NCM_PISOS e o 6907', N.NCM_PISOS, ['6907']);
eq('ncmCasa: prefixo, com ou sem pontos; sem prefixos aceita tudo',
  [N.ncmCasa('69072100', ['6907']), N.ncmCasa('6907.21.00', ['6907']), N.ncmCasa('69101000', ['6907']), N.ncmCasa(null, ['6907']), N.ncmCasa(null, []), N.ncmCasa('x', null)],
  [true, true, false, false, true, true]);
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
eq('busca com chips: basta um termo casar, sem acento, em fornecedor/produto/codigo/nota',
  [N.filtrar(linhas, { grupo: 'encerradas', termos: ['REJUNTE'] }).map(l => l.id),
   N.filtrar(linhas, { termos: ['argamassa', 'piso'] }).map(l => l.id),
   N.filtrar(linhas, { termos: ['nada'] }).length], [['A_2'], ['A_1', 'B_1'], 0]);

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
