/* ============================================================
   calculo-nucleo.js — a formula de custo, margem e preco.

   Este arquivo existe por um motivo so': ser o UNICO lugar onde a
   conta mora. Antes a formula vivia dentro do <script> do
   index.html, e o teste automatizado nao tinha como chamar a funcao
   de verdade — ele recortava o texto da funcao do HTML com indexOf
   e remontava com new Function(). Funcionava, mas testava uma copia
   remontada, nao o codigo que roda na tela: bastava mudar o nome de
   uma funcao, ou mover um trecho, para o teste passar a medir outra
   coisa (ou parar de achar o que procurava) sem nada avisar.

   Agora a tela e o teste carregam este mesmo arquivo.

   Nao usa modulos ES: carrega com <script src="calculo-nucleo.js">
   (funciona em file://) e tambem com require() no Node.
   Precisa vir DEPOIS de app-shared.js — usa App.centavos e App.toNum.
   ============================================================ */
(function (global) {
  'use strict';

  // No navegador o app-shared.js ja' rodou e deixou o App no window.
  // No Node (testes) carregamos o mesmo arquivo, para o arredondamento
  // de centavos ser o de verdade e nao uma imitacao escrita no teste.
  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.centavos) {
    throw new Error('calculo-nucleo.js precisa de app-shared.js carregado antes.');
  }

  var centavos = App.centavos;
  var toNum = App.toNum;
  var pct = App.pct;

  // ============================================================
  // ATENCAO: as aliquotas ficam SO' aqui. Antes elas estavam
  // escritas na mao em dois lugares (computeCalc e
  // computeCoeficientes). Se um dia o ICMS mudasse e alguem
  // editasse so' um dos dois, a margem exibida e o preco sugerido
  // passariam a discordar em silencio, sem erro nenhum — num
  // sistema de precificacao, o pior tipo de bug.
  // ============================================================
  const TRIBUTOS = {
    pisCofins:  0.0925, // PIS+COFINS sobre a venda (e credito sobre custo+frete)
    icmsDebito: 0.205,  // debito de ICMS na venda, quando o produto NAO tem ST
    irpj:       0.25,
    csll:       0.09
  };
  // Quanto do lucro antes de impostos sobra depois de IRPJ+CSLL.
  TRIBUTOS.fatorLucro = 1 - TRIBUTOS.irpj - TRIBUTOS.csll; // 0,66

  // ============================================================
  // As tres metas de margem da tela "Sugestao de preco", e a que
  // serve de referencia na cotacao.
  //
  // Os percentuais ficam SO' aqui: o texto "margem de 13%" embaixo
  // de cada valor e a coluna "Sugerido" da cotacao sao escritos a
  // partir destes numeros. Antes o 13% aparecia em quatro lugares
  // (markup, array de metas, MARGEM_SUGERIDA e o teste); mudar a
  // meta significava achar todos, e a tela podia acabar dizendo um
  // percentual enquanto a conta usava outro.
  //
  //   id       — o <span> que recebe o preco na tela
  //   idDica   — o <span> menor que recebe "margem de X%"
  //   alvo     — a margem liquida que aquele preco atinge
  //   sugerida — a meta usada como referencia na cotacao
  // ============================================================
  const METAS = [
    { id: 'precoMinimo',      idDica: 'precoMinimoDica',      alvo: 0.04 },
    { id: 'precoRecomendado', idDica: 'precoRecomendadoDica', alvo: 0.08 },
    { id: 'precoIdeal',       idDica: 'precoIdealDica',       alvo: 0.13, sugerida: true }
  ];
  METAS.forEach(function (meta) {
    meta.rotulo = pct(meta.alvo, 0);           // "13%"
    meta.dica = 'margem de ' + meta.rotulo;    // "margem de 13%"
  });

  // Preco de referencia da cotacao: a margem "Ideal". Partir do ideal
  // deixa espaco para o comprador negociar para baixo sem furar o piso.
  const META_SUGERIDA = METAS.filter(function (m) { return m.sugerida; })[0];
  const MARGEM_SUGERIDA = META_SUGERIDA.alvo;
  const ROTULO_MARGEM_SUGERIDA = META_SUGERIDA.rotulo;

  // Decompoe o custo em: custo = C0 + k * venda.
  // "k" e' a parte que varia com o preco (PIS/COFINS sobre a venda e,
  // quando nao ha' ST, o debito de ICMS). "m" e' quanto de cada real
  // vendido sobra antes dos impostos sobre o lucro.
  // Esta e' a UNICA definicao da formula; computeCalc usa ela tambem.
  function computeCoeficientes(v){
    const custoNFe = v.custoNFe;
    const frete = v.frete;
    const pctCredFrete = v.pctCredFrete/100;
    const valorST = v.valorST/100;
    const icmsCredito = v.icmsCredito/100;
    const ipi = v.ipi/100;
    const custoFinanceiroPct = v.custoFinanceiroPct/100;
    const avariasPct = v.avariasPct/100;
    const bonificacaoRS = v.tipoBonificacao === 1 ? (custoNFe * (v.bonificacao||0)/100) : (v.bonificacao || 0);
    const comST = !!v.comST;
    const creditoFrete = pctCredFrete !== 0 ? (pctCredFrete * frete) : 0;

    // Parte fixa, igual nos dois cenarios.
    const base = custoNFe + frete + (ipi*custoNFe)
               - ((custoNFe+frete) * TRIBUTOS.pisCofins)
               - creditoFrete - bonificacaoRS;

    let k, C0;
    if(comST){
      k = TRIBUTOS.pisCofins;
      C0 = (custoNFe * valorST) + base;
    } else {
      k = TRIBUTOS.icmsDebito + TRIBUTOS.pisCofins;
      C0 = -(custoNFe * icmsCredito) + base;
    }

    const m = 1 - k - custoFinanceiroPct - avariasPct;
    return { C0, k, m, bonificacaoRS, custoFinanceiroPct, avariasPct };
  }

  // Nucleo puro — usado pelo formulario ao vivo e pela previa da lista
  // de produtos salvos.
  function computeCalc(v){
    const { C0, k, m, bonificacaoRS, custoFinanceiroPct, avariasPct } = computeCoeficientes(v);
    const venda = v.venda;
    const prejuizoContabil = !!v.prejuizoContabil;

    const custo = C0 + k * venda;
    const avariasRS = venda * avariasPct;
    const custoFinanceiroRS = venda * custoFinanceiroPct;

    // base = venda - custo - custo financeiro - avarias = m*venda - C0
    const base = m * venda - C0;
    const semTributo = (base < 0) || prejuizoContabil;
    const irpj = semTributo ? 0 : base * TRIBUTOS.irpj;
    const csll = semTributo ? 0 : base * TRIBUTOS.csll;

    const lucro = base - irpj - csll;
    const margem = venda !== 0 ? (lucro/venda) : NaN;

    const vista = custoFinanceiroPct === 0 ? ' à vista' : ' cartão';
    const descricao = 'Custo NF-e R$ ' + v.custoNFe.toFixed(2) + ' | Frete R$ ' + v.frete.toFixed(2) + ' |\n' +
      'Venda R$ ' + venda.toFixed(2) + vista;

    // Arredonda os valores em dinheiro no ponto em que viram resultado:
    // sem isso o erro de fracao de centavo do float se acumula nos
    // totais somados na tela do historico.
    const rCusto = centavos(custo);
    const rIrpj = centavos(irpj);
    const rCsll = centavos(csll);
    const rAvarias = centavos(avariasRS);
    const rCustoFin = centavos(custoFinanceiroRS);

    return {
      custo: rCusto,
      irpj: rIrpj,
      csll: rCsll,
      avariasRS: rAvarias,
      custoFinanceiroRS: rCustoFin,
      // Soma das parcelas JA' arredondadas: a coluna TOTAL do razao
      // sempre fecha com as linhas exibidas acima dela.
      total: centavos(rCusto + rCustoFin + rIrpj + rCsll + rAvarias),
      lucro: centavos(lucro),
      margem,
      descricao,
      venda,
      custoNFe: v.custoNFe,
      frete: v.frete,
      bonificacao: centavos(bonificacaoRS)
    };
  }

  // Resolve o preco de venda que resulta na margem-alvo informada
  // (ex: 0.08 = 8%). Sai da mesma decomposicao acima:
  //   margem = fatorLucro * (m*venda - C0) / venda = alvo
  //   =>  venda = fatorLucro*C0 / (fatorLucro*m - alvo)
  function precoParaMargem(v, targetMargem){
    const { C0, m } = computeCoeficientes(v);
    const f = TRIBUTOS.fatorLucro;
    const denom = f*m - targetMargem;
    if(denom <= 0) return null; // custo alto demais para essa margem ser atingivel
    const preco = (f*C0) / denom;
    if(!isFinite(preco) || preco <= 0) return null;
    return preco;
  }

  // Arredonda para cima até o próximo valor terminado em ",90" (24.90, 25.90, 26.90...)
  function arredondarNovanta(v){
    if(v == null || !isFinite(v) || v <= 0) return null;
    const inteiro = Math.floor(v);
    let candidato = inteiro + 0.9;
    if(candidato < v - 1e-9) candidato += 1;
    return candidato;
  }

  // Converte uma "cfg" de tela (tudo em texto, como sai dos campos) nos
  // numeros que computeCalc/precoParaMargem esperam.
  //
  // Esta e' a UNICA ponte entre a tela e a formula. O mapeamento estava
  // copiado em quatro lugares — aqui, na margem do lote, na do modo
  // individual e na coluna do historico. Bastava um deles esquecer um
  // campo para aquela tela mostrar uma margem diferente das outras, sem
  // erro nenhum.
  function valoresParaCalculo(custoNFe, cfg, venda){
    return {
      custoNFe: custoNFe,
      frete: toNum(cfg.frete), pctCredFrete: toNum(cfg.pctCredFrete),
      valorST: toNum(cfg.valorST), icmsCredito: toNum(cfg.icmsCredito),
      ipi: toNum(cfg.ipi), custoFinanceiroPct: toNum(cfg.custoFinanceiroPct),
      avariasPct: toNum(cfg.avariasPct), bonificacao: toNum(cfg.bonificacao),
      tipoBonificacao: cfg.tipoBonificacao, venda: venda,
      comST: cfg.comST, prejuizoContabil: 0
    };
  }

  // Preco da coluna "Sugerido" da cotacao: a margem sugerida,
  // arredondada para ,90 — o mesmo numero que a calculadora mostra
  // naquele nivel.
  function precoSugerido(custoNFe, cfg){
    if(!(custoNFe > 0)) return null;
    return arredondarNovanta(
      precoParaMargem(valoresParaCalculo(custoNFe, cfg, 0), MARGEM_SUGERIDA));
  }

  var api = {
    TRIBUTOS: TRIBUTOS,
    METAS: METAS,
    MARGEM_SUGERIDA: MARGEM_SUGERIDA,
    ROTULO_MARGEM_SUGERIDA: ROTULO_MARGEM_SUGERIDA,
    computeCoeficientes: computeCoeficientes,
    computeCalc: computeCalc,
    precoParaMargem: precoParaMargem,
    arredondarNovanta: arredondarNovanta,
    valoresParaCalculo: valoresParaCalculo,
    precoSugerido: precoSugerido
  };

  global.Calculo = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
