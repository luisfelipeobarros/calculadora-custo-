/* ============================================================
   simulador-nucleo.js — as contas do Simulador de compra.

   Mesmo desenho do calculo-nucleo.js: o UNICO lugar onde as regras
   moram, carregavel com <script src> no navegador e com require()
   nos testes — o teste exercita o codigo que a tela roda.

   Dinheiro aqui e' SEMPRE centavo inteiro. 0.1 + 0.2 !== 0.3, e em
   parcela mensal isso vira centavo perdido em toda linha; float so'
   existe na fronteira (o valor vindo do Firestore em reais e o que a
   tela exibe). A soma das parcelas TEM que bater com o valor da
   compra — e' invariante testada, nao esperanca.

   Este arquivo nao escreve nada em lugar nenhum: o Simulador e' um
   "e se", nao um lancamento.

   Precisa vir DEPOIS de app-shared.js — usa App.somarDias e
   App.somarMeses (a mesma rolagem mensal da recorrencia dos
   pagamentos internos; as datas das duas telas nao podem discordar).
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.somarMeses) {
    throw new Error('simulador-nucleo.js precisa de app-shared.js carregado antes.');
  }

  var somarDias = App.somarDias;
  var somarMeses = App.somarMeses;

  function centavosDe(valorReais) {
    return Math.round((valorReais || 0) * 100);
  }

  /* ============================================================
     1. Prazo digitado -> lista de dias
     ============================================================ */

  // '70/84/98' -> [70,84,98]; '28' -> [28]; 'a vista'/'' -> [0].
  //
  // "A vista" NORMALIZA para [0] — uma parcela, zero dias — em vez de
  // lista vazia: assim divisao, geracao de datas e agregacao tratam
  // tudo igual, sem caso especial espalhado (lista vazia seria divisao
  // por zero no dividirParcelas).
  //
  // Formato irreconhecivel devolve null: a linha e' marcada invalida e
  // fica FORA da simulacao, com aviso na tela — nunca contada como
  // zero, senao o total pareceria completo faltando uma compra.
  function parsePrazo(texto) {
    var t = String(texto == null ? '' : texto).trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (t === '' || t === 'a vista') return [0];
    var partes = t.split('/');
    var dias = [];
    for (var i = 0; i < partes.length; i++) {
      var p = partes[i].trim();
      if (!/^\d+$/.test(p)) return null;
      dias.push(Number(p));
    }
    return dias.sort(function (a, b) { return a - b; });
  }

  /* ============================================================
     2. Divisao do valor em parcelas (centavos inteiros)
     ============================================================ */

  // Sem 1a informada: divide igual, SOBRA NA ULTIMA (10.000/3 ->
  // 3.333,33 / 3.333,33 / 3.333,34). Com 1a informada: ela vale
  // exatamente o digitado e o restante divide igual, sobra na ultima.
  // Parcela unica ignora a 1a informada — vale o total (a tela
  // desabilita o campo para isso nem acontecer digitando).
  // Devolve null quando nao ha' como dividir (1a maior que o total):
  // quem chama avisa e nao simula a linha.
  function dividirParcelas(totalCent, qtd, primeiraCent) {
    if (!(qtd >= 1) || !(totalCent >= 0)) return null;
    if (qtd === 1) return [totalCent];

    var parcelas = [];
    var i;
    if (primeiraCent == null) {
      var base = Math.floor(totalCent / qtd);
      for (i = 0; i < qtd - 1; i++) parcelas.push(base);
      parcelas.push(totalCent - base * (qtd - 1));
      return parcelas;
    }

    if (primeiraCent > totalCent) return null;
    var resto = totalCent - primeiraCent;
    var demais = qtd - 1;
    var baseResto = Math.floor(resto / demais);
    parcelas.push(primeiraCent);
    for (i = 0; i < demais - 1; i++) parcelas.push(baseResto);
    parcelas.push(resto - baseResto * (demais - 1));
    return parcelas;
  }

  /* ============================================================
     3. Geracao das compras mensais (com a rampa)
     ============================================================ */

  // Uma compra por mes a partir de dataPrimeira, cada uma gerando suas
  // parcelas (compra + N dias). O dia da 1a compra vale como diaFixo:
  // compra dia 31 encolhe para 30/28 nos meses curtos e VOLTA a ser 31
  // depois — a mesma regra da recorrencia dos pagamentos internos.
  //
  // stCent e' a Substituicao Tributaria da compra: valor ADICIONAL
  // (total = compra + ST), que nao participa da divisao e recorre com
  // cada compra mensal. Onde ela cai (regra de negocio de 05/08/2026):
  //   - prazo com mais de uma parcela e a 1a ANTES de 30 dias ->
  //     junto da 1a parcela (mesma data);
  //   - parcela unica, ou 1a parcela aos 30 dias ou alem ->
  //     parcela propria aos 30 dias da compra.
  // A parcela de ST sai marcada (st: true) para o detalhe mostrar
  // separado, sem se misturar a' mercadoria.
  //
  // ateData diz ate' quando COMPRAR (o chamador passa o fim da janela
  // + o maior prazo — o efeito rampa: sem isso os ultimos meses da
  // janela sairiam artificialmente leves, porque a compra do mes 11
  // com prazo de 98 dias so' vence no mes 14). limiteCompras e' a
  // porta para compra avulsa (limite 1); ausente = sem limite.
  //
  // ajustes e' o "e se eu comprar mais/menos NAQUELE mes": um mapa
  // {'aaaa-mm': percentual} que escala a COMPRA feita no mes (valor,
  // ST e — porque quem chama passa o mesmo mapa — o frete junto).
  // "-10" em novembro reduz as compras de novembro em 10%; o efeito
  // aparece quando as parcelas DELAS vencem, meses depois — e' o
  // fluxo de caixa real, nao um corte visual na barra do mes. Abaixo
  // de -100% nao existe compra negativa: trava no zero.
  //
  // Devolve a lista de parcelas {compra, vencimento, cent} — quem
  // agrega depois descarta o que cair fora da janela — ou null quando
  // a divisao nao fecha (1a parcela maior que o total).
  function gerarCompras(opts) {
    var prazo = opts.prazoDias;
    // Valida a forma da divisao ANTES do laco (1a > total falha ja'
    // aqui, mesmo que o ajuste do mes fosse zerar a compra).
    if (!dividirParcelas(opts.valorCent, prazo.length,
      opts.primeiraCent == null ? null : opts.primeiraCent)) return null;

    var stCentBase = opts.stCent == null ? 0 : opts.stCent;
    var ajustes = opts.ajustes || {};
    var diaFixo = Number(opts.dataPrimeira.substring(8, 10));
    var saida = [];
    for (var k = 0; ; k++) {
      var dataCompra = k === 0 ? opts.dataPrimeira
        : somarMeses(opts.dataPrimeira, k, { diaFixo: diaFixo });
      if (dataCompra > opts.ateData) break;

      var pct = ajustes[dataCompra.substring(0, 7)];
      var fator = 1 + (Number(pct) || 0) / 100;
      if (fator < 0) fator = 0;

      // O fator escala o TOTAL da compra do mes e a divisao refaz por
      // cima — escalar parcela a parcela deixaria a soma divergir do
      // total escalado por arredondamento.
      var valorMes = Math.round(opts.valorCent * fator);
      var primeiraMes = opts.primeiraCent == null ? null : Math.round(opts.primeiraCent * fator);
      var stMes = Math.round(stCentBase * fator);
      var parcelas = dividirParcelas(valorMes, prazo.length, primeiraMes);

      for (var i = 0; i < prazo.length; i++) {
        saida.push({
          compra: dataCompra,
          vencimento: somarDias(dataCompra, prazo[i]),
          cent: parcelas[i]
        });
      }
      if (stMes > 0) {
        var diasSt = (prazo.length > 1 && prazo[0] < 30) ? prazo[0] : 30;
        saida.push({
          compra: dataCompra,
          vencimento: somarDias(dataCompra, diasSt),
          cent: stMes,
          st: true
        });
      }
      if (opts.limiteCompras && k + 1 >= opts.limiteCompras) break;
    }
    return saida;
  }

  /* ============================================================
     3b. Media de compra mensal de um fornecedor
     ============================================================ */

  // Quanto se comprou por mes, em media, nos ultimos `meses` meses —
  // o numero que normalmente se quer digitar em "compra mensal". Mes
  // sem compra conta como zero: e' a media REAL de desembolso, nao a
  // media so' dos meses em que houve nota. Notas fora da janela ficam
  // de fora; a soma e' em centavos, como todo dinheiro aqui.
  function mediaCompraMensal(notas, hoje, meses) {
    var corte = somarMeses(hoje, -meses);
    var totalCent = 0, qtd = 0;
    (notas || []).forEach(function (n) {
      if (!n.dataEmissao || n.dataEmissao < corte || n.dataEmissao > hoje) return;
      totalCent += Math.round((n.valorTotal || 0) * 100);
      qtd++;
    });
    return {
      totalCent: totalCent,
      mediaCent: Math.round(totalCent / meses),
      qtdNotas: qtd,
      meses: meses
    };
  }

  /* ============================================================
     4. Projecao dos pagamentos internos recorrentes
     ============================================================ */

  // Recorrente so' ganha documento quando o anterior e' pago — os
  // meses futuros estao VAZIOS no banco, e sem projetar a tela
  // passaria falsa folga. Rola cada corrente para frente ate' ateIso.
  //
  // Anti-dobra: se a proxima ocorrencia JA' existe como documento
  // (criada ao pagar a anterior), quem continua a corrente e' ELA —
  // este documento para de projetar ali. A chave e' a MESMA do
  // criarProximoRecorrente: origemId + vencimento. Assim cada corrente
  // e' projetada exatamente uma vez, a partir da ponta.
  function projetarInternos(pagamentos, ateIso) {
    var projecoes = [];
    (pagamentos || []).forEach(function (p) {
      if (p.recorrente !== true || !p.vencimento) return;

      // parcelaAtual ausente conta como 1 — `undefined >= 12` e' falso
      // e a corrente nunca terminaria (mesma guarda da recorrencia).
      var atual = Number(p.parcelaAtual) || 1;
      var total = Number(p.parcelasTotal) || 0;
      var venc = p.vencimento;

      while (true) {
        if (total && atual >= total) break; // ultima parcela nao gera proxima
        var prox = somarMeses(venc, 1,
          p.regra === 'ultimoDia' ? { ultimoDia: true } : { diaFixo: p.diaFixo });
        var jaExiste = pagamentos.some(function (x) {
          return x.origemId === p.id && x.vencimento === prox;
        });
        if (jaExiste) break;
        if (prox > ateIso) break;
        atual++;
        projecoes.push({
          vencimento: prox,
          valor: p.valor || 0,
          descricao: p.descricao,
          categoria: p.categoria,
          origemId: p.id,
          parcelaAtual: atual
        });
        venc = prox;
      }
    });
    return projecoes;
  }

  /* ============================================================
     5. Agregacao mensal em TRES origens
     ============================================================ */

  // Contratado, projetado e simulado ficam separados porque tem graus
  // de certeza diferentes: fato, inferencia e hipotese. Juntar num
  // numero so' esconderia exatamente o que a tela existe para mostrar.
  //
  // "Ja' contratado" = TODOS os pagamentos do mes, pagos e a pagar —
  // a pergunta e' "quanto este mes custa", nao "quanto falta". So'
  // fica de fora duplicata de NOTA CANCELADA (mesma regra do cartao
  // "mes inteiro" do Painel; nota nao carregada nao afirma nada e a
  // duplicata entra).
  function resumoMensal(ctx) {
    var qtdMeses = ctx.meses || 12;
    var meses = [];
    var porMes = Object.create(null);
    for (var i = 0; i < qtdMeses; i++) {
      var m = somarMeses(ctx.mesInicial + '-01', i).substring(0, 7);
      var linha = { mes: m, contratadoCent: 0, projetadoCent: 0, simuladoCent: 0,
                    contratado: [], projetado: [], simulado: [] };
      porMes[m] = linha;
      meses.push(linha);
    }
    function linhaDe(venc) {
      return venc ? porMes[String(venc).substring(0, 7)] : null;
    }

    (ctx.duplicatas || []).forEach(function (d) {
      var l = linhaDe(d.vencimento);
      if (!l) return;
      var nota = ctx.notasPorChave ? ctx.notasPorChave[d.chaveAcesso] : null;
      if (nota && nota.status === 'cancelada') return;
      l.contratadoCent += centavosDe(d.valor);
      l.contratado.push(d);
    });
    (ctx.pagamentosInternos || []).forEach(function (p) {
      var l = linhaDe(p.vencimento);
      if (!l) return;
      l.contratadoCent += centavosDe(p.valor);
      l.contratado.push(p);
    });
    (ctx.projetados || []).forEach(function (p) {
      var l = linhaDe(p.vencimento);
      if (!l) return;
      l.projetadoCent += centavosDe(p.valor);
      l.projetado.push(p);
    });
    (ctx.simuladas || []).forEach(function (s) {
      var l = linhaDe(s.vencimento);
      if (!l) return;
      l.simuladoCent += s.cent;
      l.simulado.push(s);
    });
    return meses;
  }

  /* ============================================================
     Exporta
     ============================================================ */

  var SimuladorNucleo = {
    parsePrazo: parsePrazo,
    dividirParcelas: dividirParcelas,
    gerarCompras: gerarCompras,
    mediaCompraMensal: mediaCompraMensal,
    projetarInternos: projetarInternos,
    resumoMensal: resumoMensal
  };

  global.SimuladorNucleo = SimuladorNucleo;
  if (typeof module === 'object' && module.exports) module.exports = SimuladorNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
