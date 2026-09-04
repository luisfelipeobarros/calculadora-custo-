/*
  Vendas × Compras × Pagamentos (controle-notas.html) — o cruzamento
  da planilha publica de vendas com as notas e as duplicatas pagas,
  extraido do proprio HTML (o teste mede o codigo que roda na tela).

  O que estes testes travam:
  - a leitura enxuta do gviz (colunas pelo rotulo, linha invalida fora);
  - o vinculo por ROTULO vencendo o por CNPJ (e' o que separa a Vetrus,
    mesmo CNPJ com duas marcas decididas pelo produto);
  - o cruzamento por periodo: compra pela EMISSAO, titulos pelo
    VENCIMENTO — pagos ou nao (pedido de 04/09/2026: a comparacao nao
    depende de o pagamento ja ter sido efetivado) —, nota cancelada
    fora dos dois lados;
  - o titulo vale pelo VALOR dele, nao pelo valorPago;
  - marca casando sem caixa/acento ("Megaó" na planilha, "MEGAO" no
    vinculo = a mesma linha);
  - quem nao tem vinculo vai para semVinculo (nunca somado em silencio)
    e quem e' "nao comparar" sai da conta, somado em ignorados.
*/
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'controle-notas.html'), 'utf8');

function extrairDe(texto, nome, origem){
  const i = texto.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome + ' em ' + origem);
  let d = 0, j = texto.indexOf('{', i);
  for(; j < texto.length; j++){
    if(texto[j] === '{') d++;
    else if(texto[j] === '}'){ d--; if(d === 0) break; }
  }
  return texto.slice(i, j + 1);
}
const extrair = (nome) => extrairDe(html, nome, 'controle-notas.html');

const m = new Function(
  "var IGNORAR_VINCULO = '__ignorar';\n" +
  extrair('parseGvizTexto') + '\n' +
  extrair('linhasVendasDaResposta') + '\n' +
  extrair('chaveMarca') + '\n' +
  extrair('marcaDoVinculo') + '\n' +
  extrair('cruzarVendasCompras') + '\n' +
  'return { parseGvizTexto, linhasVendasDaResposta, chaveMarca, marcaDoVinculo, cruzarVendasCompras };'
)();

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => {
  const va = JSON.stringify(a), vb = JSON.stringify(b);
  va === vb ? ok(t) : erro(t + ' — esperava ' + vb + ', veio ' + va);
};

// ── Leitura do gviz (versao enxuta) ──────────────────────────

{
  const json = { table: {
    cols: [{ label: 'Faturamento' }, { label: 'Ano' }, { label: 'Mês' }, { label: 'Fornecedor' }],
    rows: [
      { c: [{ v: 1000 }, { v: 2026 }, { v: 8 }, { v: 'PAMESA' }] },
      { c: [{ v: 500 }, null, { v: 8 }, { v: 'X' }] },       // sem ano
      { c: [{ v: 500 }, { v: 2026 }, { v: 13 }, { v: 'X' }] } // mes invalido
    ]
  } };
  const ls = m.linhasVendasDaResposta(json);
  eq('colunas casadas pelo rotulo, linha invalida descartada', ls.length, 1);
  eq('linha valida com os campos certos',
    [ls[0].ano, ls[0].mes, ls[0].fornecedor, ls[0].faturamento], [2026, 8, 'PAMESA', 1000]);
}

// ── Vinculo ──────────────────────────────────────────────────

const vinculos = {
  porRotulo: { 'Vetrus (Pamesa)': 'PAMESA', 'Vetrus (Stela)': 'STELLA' },
  porCnpj: { '111': 'MEGAO', '222': '__ignorar', '333': 'KARINA' }
};

eq('vinculo por rotulo vence o por cnpj',
  m.marcaDoVinculo('03428', 'Vetrus (Stela)', vinculos), 'STELLA');
eq('sem rotulo casado, vale o cnpj', m.marcaDoVinculo('111', 'GOLD MEGAO', vinculos), 'MEGAO');
eq('sem vinculo nenhum: null (nunca chuta)', m.marcaDoVinculo('999', 'ZZZ', vinculos), null);

// ── O cruzamento ─────────────────────────────────────────────

// Stub com a MESMA regra da Vetrus do app: 46x46 -> Stela.
const rotular = (nome, produtos) => {
  if(/vetrus/i.test(nome || '')){
    if(produtos && produtos.join(' ').indexOf('46x46') !== -1) return 'Vetrus (Stela)';
    return 'Vetrus (Pamesa)';
  }
  return nome;
};

const vendas = [
  { ano: 2026, mes: 8, fornecedor: 'Megaó', faturamento: 1000 },
  { ano: 2026, mes: 8, fornecedor: 'PAMESA', faturamento: 500 },
  { ano: 2026, mes: 8, fornecedor: 'KARINA', faturamento: 300 },
  { ano: 2026, mes: 7, fornecedor: 'Megaó', faturamento: 900 }
];
const notas = [
  { id: 'A', cnpjEmitente: '111', nomeEmitente: 'GOLD MEGAO', dataEmissao: '2026-08-05', valorTotal: 400 },
  { id: 'B', cnpjEmitente: '03428', nomeEmitente: 'VETRUS S/A', produtosResumo: ['piso 46x46'], dataEmissao: '2026-08-10', valorTotal: 200 },
  { id: 'C', cnpjEmitente: '111', nomeEmitente: 'GOLD MEGAO', dataEmissao: '2026-08-20', valorTotal: 50, status: 'cancelada' },
  { id: 'D', cnpjEmitente: '222', nomeEmitente: 'FACEBOOK', dataEmissao: '2026-08-01', valorTotal: 99 },
  { id: 'E', cnpjEmitente: '999', nomeEmitente: 'DESCONHECIDO LTDA', dataEmissao: '2026-08-02', valorTotal: 70 },
  { id: 'F', cnpjEmitente: '111', nomeEmitente: 'GOLD MEGAO', dataEmissao: '2026-07-01', valorTotal: 1234 }
];
const duplicatas = [
  // Paga com juros: o que conta e' o VALOR do titulo (160), nao os 150
  // efetivamente pagos — e pelo VENCIMENTO, nao pela data do pagamento.
  { chaveAcesso: 'A', pago: true, dataPagamento: '2026-09-02', vencimento: '2026-08-10', valorPago: 150, valor: 160 },
  { chaveAcesso: 'C', pago: true, vencimento: '2026-08-16', valor: 50 },   // nota cancelada
  { chaveAcesso: 'ZZZ', pago: true, vencimento: '2026-08-17', valor: 80, nomeEmitente: 'VETRUS S/A' }, // sem a nota
  { chaveAcesso: 'A', pago: false, vencimento: '2026-08-20', valor: 40 },  // EM ABERTO: conta igual
  { chaveAcesso: 'A', pago: false, vencimento: '2026-09-10', valor: 500 }, // vence fora do mes
  { chaveAcesso: 'A', pago: false, vencimento: null, valor: 777 },         // sem vencimento: fora
  { chaveAcesso: 'D', pago: true, vencimento: '2026-08-18', valor: 30 }
];

{
  const r = m.cruzarVendasCompras(vendas, notas, duplicatas, vinculos, rotular, 2026, 8);
  eq('ordenado pelo vendido, marca da planilha na frente',
    r.linhas.map(l => l.marca), ['Megaó', 'PAMESA', 'KARINA', 'STELLA']);
  const megao = r.linhas[0];
  eq('"Megaó" da planilha e "MEGAO" do vinculo somam na MESMA linha (caixa/acento fora)',
    [megao.vendido, megao.comprado, megao.titulos], [1000, 400, 200]);
  eq('titulo em aberto conta IGUAL ao pago, pelo valor do titulo (160 + 40, nunca o valorPago)',
    megao.titulos, 200);
  eq('nota da Vetrus com 46x46 compra como STELLA (vinculo pelo rotulo)',
    [r.linhas[3].marca, r.linhas[3].comprado], ['STELLA', 200]);
  eq('duplicata SEM a nota carregada classifica pelo proprio nome (Vetrus sem produto -> Pamesa)',
    [r.linhas[1].marca, r.linhas[1].titulos], ['PAMESA', 80]);
  eq('nota cancelada e vencimento fora do mes ficam fora dos titulos',
    r.totais.titulos, 280);
  eq('sem vinculo: agrupado a parte, nunca somado em silencio',
    r.semVinculo.map(s => [s.rotulo, s.cnpjs, s.comprado]),
    [['DESCONHECIDO LTDA', ['999'], 70]]);
  eq('"nao comparar" sai da conta, mas somado em ignorados',
    [r.ignorados.comprado, r.ignorados.titulos], [99, 30]);
  eq('totais fecham com as linhas',
    [r.totais.vendido, r.totais.comprado], [1800, 600]);
}

{
  // Ano inteiro (mes = null): julho e setembro entram; sem vencimento
  // continua fora (nao ha mes onde encaixar).
  const r = m.cruzarVendasCompras(vendas, notas, duplicatas, vinculos, rotular, 2026, null);
  const megao = r.linhas[0];
  eq('ano inteiro soma todos os meses (venda 1900, compra 400+1234, titulos 160+40+500)',
    [megao.vendido, megao.comprado, megao.titulos], [1900, 1634, 700]);
}

// ── Espelho: o dashboard usa as MESMAS funcoes ───────────────
// A area logada do dashboard.html carrega uma COPIA de chaveMarca,
// marcaDoVinculo e cruzarVendasCompras. Copia diverge em silencio;
// este teste compara os dois arquivos caractere a caractere — quem
// mudar a regra num lado e esquecer o outro quebra aqui.

{
  const htmlDash = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard.html'), 'utf8');
  ['chaveMarca', 'marcaDoVinculo', 'cruzarVendasCompras'].forEach((nome) => {
    eq('copia fiel no dashboard.html: ' + nome,
      extrairDe(htmlDash, nome, 'dashboard.html') === extrair(nome), true);
  });
}

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
