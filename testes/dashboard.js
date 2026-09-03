/*
  Dashboard de Vendas (dashboard.html) — as regras de calculo, extraidas
  do proprio HTML (mesmo padrao do pagamentos.js: o teste mede o codigo
  que roda na tela, nao uma copia).

  O que estes testes travam:
  - o desembrulho do gviz (a resposta NAO e' JSON puro);
  - a leitura das colunas pelo ROTULO, tolerante a ordem e acento;
  - a REGRA DE OURO: margem = soma(lucro)/soma(faturamento), NUNCA
    media de margens — e null sem faturamento, nunca "0%";
  - series mensais com mes sem dado = null (zero seria afirmacao);
  - agrupamento ordenado por faturamento com total pela mesma regra;
  - participacao por categoria fechando 100%.
*/
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard.html'), 'utf8');

function extrair(nome){
  const i = html.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome + ' em dashboard.html');
  let d = 0, j = html.indexOf('{', i);
  for(; j < html.length; j++){
    if(html[j] === '{') d++;
    else if(html[j] === '}'){ d--; if(d === 0) break; }
  }
  return html.slice(i, j + 1);
}

const m = new Function(
  extrair('parseGvizTexto') + '\n' +
  extrair('linhasDaResposta') + '\n' +
  extrair('filtrarLinhas') + '\n' +
  extrair('resumoKpis') + '\n' +
  extrair('agruparPor') + '\n' +
  extrair('seriesMensais') + '\n' +
  extrair('participacaoCategorias') + '\n' +
  extrair('marketShareFornecedores') + '\n' +
  extrair('crescimentoAnual') + '\n' +
  'return { parseGvizTexto, linhasDaResposta, filtrarLinhas, resumoKpis, agruparPor, seriesMensais, participacaoCategorias, marketShareFornecedores, crescimentoAnual };'
)();

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── gviz: desembrulho ────────────────────────────────────────

{
  const resposta = '/*O_o*/\ngoogle.visualization.Query.setResponse({"table":{"cols":[],"rows":[]}});';
  eq('desembrulha o setResponse(...) do gviz',
    m.parseGvizTexto(resposta), { table: { cols: [], rows: [] } });
  // Parenteses DENTRO do JSON (nome de fornecedor "(sem)") nao podem
  // confundir o recorte — por isso o ultimo ")", nao o primeiro.
  const comParenteses = 'setResponse({"table":{"cols":[],"rows":[],"x":"a(b)c"}});';
  eq('parenteses no conteudo nao quebram o recorte',
    m.parseGvizTexto(comParenteses).table.x, 'a(b)c');
  let estourou = false;
  try{ m.parseGvizTexto('<html>erro</html>'); }catch(e){ estourou = true; }
  eq('resposta fora do formato estoura em vez de devolver lixo', estourou, true);
}

// ── Leitura das colunas ──────────────────────────────────────

const gviz = (cols, rows) => ({ table: {
  cols: cols.map(l => ({ label: l })),
  rows: rows.map(r => ({ c: r.map(v => v == null ? null : { v }) }))
} });

{
  // Ordem trocada + acento no rotulo: casa pelo NOME, nao pela posicao.
  const json = gviz(['Faturamento', 'Ano', 'Mês', 'Fornecedor', 'Categoria', 'Quantidade', 'LucroBruto'],
    [[1000, 2026, 3, 'PAMESA', 'Cerâmica', 50, 100]]);
  const l = m.linhasDaResposta(json)[0];
  eq('colunas casadas pelo rotulo, mesmo fora de ordem',
    [l.ano, l.mes, l.fornecedor, l.faturamento, l.lucro], [2026, 3, 'PAMESA', 1000, 100]);
}
{
  const json = gviz(['Ano', 'Mes', 'Fornecedor', 'Categoria', 'Quantidade', 'Faturamento', 'LucroBruto'], [
    [2026, 1, 'A', 'Cerâmica', 10, 100, 10],
    [null, 5, 'B', 'Cerâmica', 10, 100, 10],   // sem ano
    [2026, 13, 'C', 'Cerâmica', 10, 100, 10],  // mes invalido
    [2026, 2, 'D', 'Telhas', null, 50, 5]      // quantidade vazia vira 0
  ]);
  const ls = m.linhasDaResposta(json);
  eq('linha sem ano ou com mes invalido e descartada', ls.length, 2);
  eq('quantidade vazia vira 0 (soma nao pode dar NaN)', ls[1].quantidade, 0);
}

// ── A regra de ouro da margem ────────────────────────────────

const linhas = [
  { ano: 2026, mes: 1, fornecedor: 'A', categoria: 'Cerâmica', quantidade: 10, faturamento: 100, lucro: 50 },
  { ano: 2026, mes: 1, fornecedor: 'B', categoria: 'Cerâmica', quantidade: 20, faturamento: 900, lucro: 45 },
  { ano: 2026, mes: 3, fornecedor: 'A', categoria: 'Telhas', quantidade: 5, faturamento: 500, lucro: 100 },
  { ano: 2025, mes: 1, fornecedor: 'A', categoria: 'Cerâmica', quantidade: 1, faturamento: 10, lucro: 1 }
];

{
  const k = m.resumoKpis(linhas.slice(0, 2));
  // Media das margens seria (50% + 5%) / 2 = 27,5% — ERRADO.
  eq('margem = soma/soma, NUNCA media de margens (9,5%, nao 27,5%)',
    k.margem, 0.095);
  eq('itens soma quantidade', k.itens, 30);
  eq('sem faturamento: margem null, nunca 0%',
    m.resumoKpis([{ faturamento: 0, lucro: 0, quantidade: 0 }]).margem, null);
}

// ── Filtros e agrupamento ────────────────────────────────────

eq('filtros combinam (ano + categoria)',
  m.filtrarLinhas(linhas, { ano: 2026, categoria: 'Cerâmica' }).length, 2);
eq('sem filtro passa tudo', m.filtrarLinhas(linhas, {}).length, 4);

{
  const g = m.agruparPor(m.filtrarLinhas(linhas, { ano: 2026 }), 'categoria');
  eq('agrupado ordenado por faturamento desc',
    g.lista.map(x => x.nome), ['Cerâmica', 'Telhas']);
  eq('margem do grupo pela regra de ouro', g.lista[0].margem, 0.095);
  eq('total do agrupamento fecha com o conjunto',
    [g.total.faturamento, g.total.lucro], [1500, 195]);
}

// ── Series mensais ───────────────────────────────────────────

{
  const s = m.seriesMensais(m.filtrarLinhas(linhas, { ano: 2026 }));
  eq('mes com dado soma', s.faturamento[0], 1000);
  eq('mes SEM dado e null, nunca zero', s.faturamento[1], null);
  eq('margem mensal pela regra de ouro', s.margem[0], 0.095);
  eq('margem de mes vazio e null', s.margem[1], null);
  eq('sao sempre 12 posicoes', s.faturamento.length, 12);
}

// ── Participacao por categoria ───────────────────────────────

{
  const p = m.participacaoCategorias(m.filtrarLinhas(linhas, { ano: 2026 }));
  eq('participacao ordenada e fechando 100%',
    Math.round(p.reduce((s, x) => s + x.pct, 0) * 1000) / 1000, 1);
  eq('maior categoria primeiro', p[0].nome, 'Cerâmica');
  eq('sem faturamento nenhum: lista vazia (nao divide por zero)',
    m.participacaoCategorias([]), []);
}

// ── Market share por fornecedor (pizza) ──────────────────────

{
  // 15 fornecedores com faturamento decrescente; topN=3 vira 3 fatias
  // nomeadas + a "Demais (12)".
  const muitos = [];
  for(let i = 1; i <= 15; i++){
    muitos.push({ ano: 2026, mes: 1, fornecedor: 'F' + String(i).padStart(2, '0'),
      categoria: 'X', quantidade: 1, faturamento: 1600 - i * 100, lucro: 10 });
  }
  const ms = m.marketShareFornecedores(muitos, 3);
  eq('topN fatias nomeadas + a fatia Demais', ms.length, 4);
  eq('maior fornecedor primeiro', ms[0].nome, 'F01');
  eq('a Demais agrega os que sobraram, com a contagem no nome',
    [ms[3].demais, ms[3].nome], [true, 'Demais (12)']);
  eq('as participacoes fecham 100%',
    Math.round(ms.reduce((s, f) => s + f.pct, 0) * 1000) / 1000, 1);
  eq('sem faturamento: pizza vazia (nao divide por zero)',
    m.marketShareFornecedores([], 3), []);
}

// ── Crescimento anual no PERÍODO COMPARÁVEL ──────────────────

{
  const l = (ano, mes, categoria, fat) =>
    ({ ano, mes, fornecedor: 'F', categoria, quantidade: 1, faturamento: fat, lucro: 1 });
  // 2025 cheio (jan..mar); 2026 preenchido só até fevereiro.
  const dados = [
    l(2025, 1, 'Cerâmica', 100), l(2025, 2, 'Cerâmica', 100), l(2025, 3, 'Cerâmica', 999),
    l(2025, 1, 'Telhas', 50), l(2025, 2, 'Telhas', 50),
    l(2026, 1, 'Cerâmica', 120), l(2026, 2, 'Cerâmica', 124),
    l(2026, 1, 'Argamassa', 80) // nova em 2026
    // Telhas zerou em 2026
  ];
  const r = m.crescimentoAnual(dados, 2026, 'categoria', null);
  eq('o período comparável é o preenchido do ano selecionado (jan–fev)',
    [r.periodo.de, r.periodo.ate, r.periodo.anoAnterior], [1, 2, 2025]);
  const porNome = {};
  r.itens.forEach(i => { porNome[i.nome] = i; });
  eq('crescimento compara SÓ os mesmos meses (244/200 − 1 = 22%, mar/2025 fora)',
    Math.round(porNome['Cerâmica'].cresc * 100) / 100, 0.22);
  eq('categoria nova vira "novo", nunca % infinito',
    [porNome['Argamassa'].novo, porNome['Argamassa'].cresc], [true, null]);
  eq('quem zerou aparece com −100%', porNome['Telhas'].cresc, -1);
  eq('ordenado da maior alta para a maior queda (novos no topo)',
    r.itens.map(i => i.nome), ['Argamassa', 'Cerâmica', 'Telhas']);

  // Mês específico: julho × julho.
  const dadosJul = [l(2025, 7, 'Cerâmica', 200), l(2026, 7, 'Cerâmica', 300)];
  const rj = m.crescimentoAnual(dadosJul, 2026, 'categoria', 7);
  eq('com mês filtrado, compara mês × mesmo mês (+50%)',
    [rj.periodo.de, rj.periodo.ate, rj.itens[0].cresc], [7, 7, 0.5]);

  // Sem NADA do ano anterior no período: aviso, não gráfico vazio.
  eq('sem ano anterior -> periodo null (a tela avisa)',
    m.crescimentoAnual([l(2026, 1, 'Cerâmica', 100)], 2026, 'categoria', null).periodo, null);
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
