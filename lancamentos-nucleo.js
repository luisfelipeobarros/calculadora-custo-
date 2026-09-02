/* ============================================================
   lancamentos-nucleo.js — regras do app de Lançamentos Contábeis
   (lancamentos.html: partidas dobradas e exportação ao contador).

   Mesmo desenho dos outros núcleos: o ÚNICO lugar onde as regras
   moram, carregável com <script src> no navegador e com require()
   nos testes. A tela só coleta campos simples; quem monta débito e
   crédito é este arquivo — a funcionária NUNCA escolhe D/C.

   O que mora aqui:
   - os seeds de bancos e categorias (com a acentuação CORRIGIDA —
     os JSONs de origem vieram com UTF-8 lido como Latin-1);
   - a montagem das partidas (saída / entrada / transferência);
   - a regra de pendência (sem data ou sem valor não exporta);
   - o filtro da lista e os totais do rodapé;
   - EM QUAL ARQUIVO a transferência sai: no do banco de MOVIMENTO.
     A amostra real do contador mostra as TRANSF PAGUEVELOZ/BRADESCO
     no arquivo do Bradesco (destino) — a regra "sempre na origem"
     do rascunho contradizia a amostra. Perna vinculada não ganha
     arquivo; empate (dois movimentos) fica na origem;
   - o layout de 19 colunas do contador, SEM cabeçalho, duas linhas
     por lançamento (D primeiro, C depois), com os contadores das
     colunas 1 e 19 CONTÍNUOS entre exportações.

   Precisa vir DEPOIS de app-shared.js — usa App.centavos e
   App.normalizarTexto.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.normalizarTexto) {
    throw new Error('lancamentos-nucleo.js precisa de app-shared.js carregado antes.');
  }

  // CNPJ | inscrição da empresa, como o layout do contador espera.
  var EMPRESA_EXPORTACAO = '04226489000175|027797147';

  /* ============================================================
     1. Seeds (acentuação corrigida na mão, campo a campo)
     ============================================================ */

  var SEED_BANCOS = {
    bradesco:        { nome: 'Bradesco C/C',              conta: '1.1.1.2.0001', tipo: 'movimento', ativo: true },
    itau:            { nome: 'Itaú C/C',                  conta: '1.1.1.2.0002', tipo: 'movimento', ativo: true },
    santander:       { nome: 'Santander C/C',             conta: '1.1.1.2.0004', tipo: 'movimento', ativo: true },
    bb:              { nome: 'Banco do Brasil C/C',       conta: '1.1.1.2.0010', tipo: 'movimento', ativo: true },
    safra:           { nome: 'Safra C/C',                 conta: '1.1.1.2.0011', tipo: 'movimento', ativo: true },
    caixa_economica: { nome: 'Caixa Econômica Ag. 4253',  conta: '1.1.1.2.0014', tipo: 'movimento', ativo: true },
    caixa_dinheiro:  { nome: 'Caixa (dinheiro)',          conta: '1.1.1.1.0001', tipo: 'caixa',     ativo: true },
    itau_vinc:       { nome: 'Itaú Vinculada',            conta: '1.1.1.4.0003', tipo: 'vinculada', ativo: true },
    safra_vinc:      { nome: 'Safra Vinculada',           conta: '1.1.1.4.0005', tipo: 'vinculada', ativo: true },
    pagueveloz:      { nome: 'PagueVeloz',                conta: '1.1.1.4.0006', tipo: 'vinculada', ativo: true },
    caixa_vinc:      { nome: 'Caixa Econômica Vinculada', conta: '1.1.1.4.0007', tipo: 'vinculada', ativo: true },
    picpay:          { nome: 'PicPay',                    conta: '1.1.1.4.0008', tipo: 'vinculada', ativo: true }
  };

  var SEED_CATEGORIAS = {
    forn_mercadoria:  { nome: 'Fornecedor - mercadoria',           conta: '2.1.1.1.0001', direcao: 'saida',   grupo: 'Fornecedores',  obs: '', usoJulho: 82, ativo: true },
    forn_servicos:    { nome: 'Fornecedor - serviços',             conta: '2.1.1.1.0002', direcao: 'saida',   grupo: 'Fornecedores',  obs: 'quando for pago no mês seguinte', usoJulho: 8, ativo: true },
    fretes_pagar:     { nome: 'Fretes a pagar (CTE / cheque)',     conta: '2.1.1.1.0003', direcao: 'saida',   grupo: 'Fornecedores',  obs: 'CTE e fretes com cheque', usoJulho: 67, ativo: true },
    forn_uso_consumo: { nome: 'Fornecedor - uso e consumo',        conta: '2.1.1.1.0004', direcao: 'saida',   grupo: 'Fornecedores',  obs: '', usoJulho: 2, ativo: true },
    fretes_pf:        { nome: 'Frete PF (pago na hora)',           conta: '4.2.1.1.0021', direcao: 'saida',   grupo: 'Fretes',        obs: '', usoJulho: 146, ativo: true },
    fretes_pj:        { nome: 'Frete PJ',                          conta: '4.2.1.1.0022', direcao: 'saida',   grupo: 'Fretes',        obs: 'frete peneira', usoJulho: 12, ativo: true },
    combustivel:      { nome: 'Combustível',                       conta: '4.2.1.1.0024', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 16, ativo: true },
    servicos_pj:      { nome: 'Serviços PJ (notas de serviço)',    conta: '4.2.1.1.0026', direcao: 'saida',   grupo: 'Despesas',      obs: 'cartucho recarga', usoJulho: 11, ativo: true },
    alimentacao:      { nome: 'Alimentação (café / almoço)',       conta: '4.2.1.1.0014', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 4, ativo: true },
    expediente:       { nome: 'Material expediente / limpeza',     conta: '4.2.1.1.0037', direcao: 'saida',   grupo: 'Despesas',      obs: 'cartuchos, material escritório, filme, compras', usoJulho: 8, ativo: true },
    impostos_taxas:   { nome: 'Impostos e taxas (sindicato)',      conta: '4.2.1.1.0031', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 2, ativo: true },
    multas:           { nome: 'Multas (Speed)',                    conta: '4.2.1.1.0040', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 0, ativo: true },
    conservacao:      { nome: 'Conservação e reforma',             conta: '4.2.1.1.0041', direcao: 'saida',   grupo: 'Despesas',      obs: 'fbonet', usoJulho: 0, ativo: true },
    outras_despesas:  { nome: 'Outras despesas',                   conta: '4.2.1.1.0042', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 79, ativo: true },
    cartao_credito:   { nome: 'Cartão de crédito',                 conta: '4.2.1.1.0044', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 2, ativo: true },
    seguro_vida:      { nome: 'Seguro de vida (Itaú)',             conta: '4.2.1.1.0012', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 4, ativo: true },
    agua:             { nome: 'Água',                              conta: '4.2.1.1.0036', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 3, ativo: true },
    energia:          { nome: 'Energia',                           conta: '4.2.1.1.0034', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 1, ativo: true },
    ajuda_custo:      { nome: 'Ajuda de custo',                    conta: '4.2.1.1.0002', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 0, ativo: true },
    vale_transporte:  { nome: 'Vale transporte',                   conta: '4.2.1.1.0010', direcao: 'saida',   grupo: 'Despesas',      obs: '', usoJulho: 1, ativo: true },
    pat:              { nome: 'PAT / aluguel de máquina',          conta: '4.2.1.1.0009', direcao: 'saida',   grupo: 'Despesas',      obs: 'aluguéis de máquina', usoJulho: 1, ativo: true },
    tarifas:          { nome: 'Tarifas bancárias',                 conta: '4.2.4.1.0001', direcao: 'saida',   grupo: 'Financeiro',    obs: '', usoJulho: 41, ativo: true },
    juros:            { nome: 'Juros / multas de duplicatas',      conta: '4.2.4.1.0002', direcao: 'saida',   grupo: 'Financeiro',    obs: 'multas e juros de duplicatas', usoJulho: 0, ativo: true },
    parcelamento_rfb: { nome: 'Parcelamento RFB',                  conta: '2.1.3.2.0001', direcao: 'saida',   grupo: 'Impostos',      obs: 'todos os parcelamentos', usoJulho: 19, ativo: true },
    icms_fronteira:   { nome: 'ICMS a recolher (fronteira)',       conta: '2.1.3.1.0001', direcao: 'saida',   grupo: 'Impostos',      obs: '', usoJulho: 0, ativo: true },
    salarios:         { nome: 'Salários',                          conta: '2.1.4.1.0001', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 2, ativo: true },
    adiant_quinzenal: { nome: 'Adiantamento quinzenal',            conta: '1.1.2.4.0003', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 2, ativo: true },
    adiant_ferias:    { nome: 'Adiantamento de férias',            conta: '1.1.2.4.0004', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 3, ativo: true },
    adiant_13:        { nome: 'Adiantamento de 13º',               conta: '1.1.2.4.0005', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 0, ativo: true },
    pensao:           { nome: 'Pensão alimentícia',                conta: '2.1.4.1.0003', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 0, ativo: true },
    ferias:           { nome: 'Férias a pagar',                    conta: '2.1.4.1.0005', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 0, ativo: true },
    decimo:           { nome: '13º salário a pagar',               conta: '2.1.4.1.0006', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 0, ativo: true },
    rescisao:         { nome: 'Rescisão',                          conta: '2.1.4.1.0007', direcao: 'saida',   grupo: 'Pessoal',       obs: '', usoJulho: 0, ativo: true },
    distribuicao:     { nome: 'Distribuição de lucro',             conta: '2.4.3.1.0003', direcao: 'saida',   grupo: 'Sócios',        obs: 'D conta / C banco (bilhete)', usoJulho: 3, ativo: true },
    regularizar:      { nome: 'Valores a regularizar',             conta: '1.1.2.4.0001', direcao: 'saida',   grupo: 'Regularização', obs: '', usoJulho: 424, ativo: true },
    receb_clientes:   { nome: 'Recebimento de clientes',           conta: '1.1.2.1.0001', direcao: 'entrada', grupo: 'Recebimentos',  obs: '', usoJulho: 92, ativo: true },
    receb_cartoes:    { nome: 'Recebimento de cartões',            conta: '1.1.2.1.0002', direcao: 'entrada', grupo: 'Recebimentos',  obs: '', usoJulho: 81, ativo: true },
    rendimentos:      { nome: 'Rendimento de aplicação',           conta: '3.2.1.1.0003', direcao: 'entrada', grupo: 'Recebimentos',  obs: '', usoJulho: 8, ativo: true },
    juros_recebidos:  { nome: 'Juros recebidos',                   conta: '3.2.1.1.0002', direcao: 'entrada', grupo: 'Recebimentos',  obs: '', usoJulho: 0, ativo: true },
    devolucao:        { nome: 'Devolução (a regularizar)',         conta: '1.1.2.4.0001', direcao: 'entrada', grupo: 'Regularização', obs: '', usoJulho: 424, ativo: true }
  };

  /* ============================================================
     2. Partidas dobradas — o coração do módulo
     ============================================================ */

  // A funcionária informa tipo + banco (+ categoria ou destino); o
  // D/C sai daqui. Qualquer coisa faltando devolve null — a tela não
  // grava lançamento sem partida montada.
  function montarPartidas(tipo, bancoOrigem, categoria, bancoDestino) {
    if (!bancoOrigem || !bancoOrigem.conta) return null;
    if (tipo === 'transferencia') {
      if (!bancoDestino || !bancoDestino.conta) return null;
      if (bancoDestino.conta === bancoOrigem.conta) return null; // mesma conta não transfere
      return { debito: bancoDestino.conta, credito: bancoOrigem.conta };
    }
    if (!categoria || !categoria.conta) return null;
    if (tipo === 'saida')   return { debito: categoria.conta,   credito: bancoOrigem.conta };
    if (tipo === 'entrada') return { debito: bancoOrigem.conta, credito: categoria.conta };
    return null;
  }

  // Pendência = não pode ir para o contador. Sem data válida, sem
  // valor positivo OU sem a partida montada (acontece quando um
  // pagamento chega do Controle de Notas sem a conta mapeada), o
  // lançamento fica amarelo na lista e TRAVA a exportação do mês (a
  // numeração contínua não permite reexportar "consertado" depois).
  function pendente(l) {
    if (!l) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.data || ''))) return true;
    if (l.valor == null || !(l.valor > 0)) return true;
    if (!l.contaDebito || !l.contaCredito) return true;
    return false;
  }

  /* ============================================================
     2b. Pagamentos vindos do Controle de Notas
     ============================================================ */

  // As categorias de pagamento interno do Controle de Notas, para o
  // mapa de contas dos Cadastros. E' um ESPELHO da lista de la' —
  // um teste textual confere que cada valor continua existindo no
  // controle-notas.html (se uma categoria mudar la', o teste grita).
  var CATEGORIAS_CONTROLE = [
    { valor: 'fornecedor', rotulo: 'Fornecedor (duplicatas)' },
    { valor: 'advogada', rotulo: 'Advogada' },
    { valor: 'a-lf-pa', rotulo: 'A LF PA' },
    { valor: 'agencia-t1-mkt', rotulo: 'Agência T1 MKT' },
    { valor: 'almocos', rotulo: 'Almoços' },
    { valor: 'contador', rotulo: 'Contador' },
    { valor: 'diarias', rotulo: 'Diárias' },
    { valor: 'diego', rotulo: 'Diego' },
    { valor: 'empilhadeiras', rotulo: 'Empilhadeiras' },
    { valor: 'emprestimos', rotulo: 'Empréstimos' },
    { valor: 'energia', rotulo: 'Energia' },
    { valor: 'estacionamentos', rotulo: 'Estacionamentos' },
    { valor: 'folha', rotulo: 'Folha de Pagamento' },
    { valor: 'gilson', rotulo: 'Gilson' },
    { valor: 'imposto-mensal', rotulo: 'Imposto Mensal' },
    { valor: 'impostos-folha', rotulo: 'Impostos Folha' },
    { valor: 'parcelamentos-imposto', rotulo: 'Parcelamentos Imposto' },
    { valor: 'moab', rotulo: 'Moab' },
    { valor: 'passagens', rotulo: 'Passagens' },
    { valor: 'policiais', rotulo: 'Policiais' },
    { valor: 'seguranca', rotulo: 'Segurança' },
    { valor: 'trafego-pago', rotulo: 'Tráfego Pago' },
    { valor: 'vem', rotulo: 'VEM' },
    { valor: 'vr', rotulo: 'VR' },
    { valor: 'outro', rotulo: 'Outros' }
  ];

  // Um pagamento marcado no Controle de Notas vira lançamento(s) aqui
  // — com ID DETERMINÍSTICO: pagar duas vezes não duplica, e desfazer
  // o pagamento sabe exatamente o que apagar.
  //
  // pag: { tipo: 'fornecedor'|'interno', id, data ('aaaa-mm-dd'),
  //        valor (o da divida), valorPago (o que passou no banco),
  //        bancoId, historico, fornecedor?, numeroDoc?,
  //        categoriaInterna? (so' interno) }
  // mapa (config/contasContabeis): { fornecedor: categoriaId,
  //        juros: categoriaId, internas: { folha: categoriaId, ... } }
  //
  // Devolve [{ id, doc }]: o principal e, se valorPago > valor, um
  // segundo lançamento com a DIFERENÇA como juros. Mapa ou banco
  // faltando NÃO impede o pagamento: o doc sai sem partida e vira
  // pendência amarela aqui no app — quem entende de conta resolve.
  function lancamentosDePagamento(pag, mapa, bancos, categorias) {
    var m = mapa || {};
    var catId = pag.tipo === 'fornecedor'
      ? (m.fornecedor || null)
      : ((m.internas || {})[pag.categoriaInterna] || null);
    var banco = (bancos || {})[pag.bancoId] || null;
    var prefixo = (pag.tipo === 'fornecedor' ? 'dup_' : 'int_') + pag.id;

    function docDe(valor, categoriaId, historico) {
      var categoria = categoriaId ? (categorias || {})[categoriaId] : null;
      var partida = montarPartidas('saida', banco, categoria, null);
      return {
        data: pag.data || null,
        valor: valor,
        bancoId: pag.bancoId || null,
        tipo: 'saida',
        categoriaId: categoriaId,
        bancoDestinoId: null,
        historico: historico,
        fornecedor: pag.fornecedor || null,
        numeroDoc: pag.numeroDoc || null,
        contaDebito: partida ? partida.debito : null,
        contaCredito: partida ? partida.credito : null,
        mes: String(pag.data || '').substring(0, 7) || null,
        origemId: prefixo
      };
    }

    // O que conta para o extrato e' o que SAIU do banco: pago MENOS
    // que o devido (desconto negociado), o principal e' o valor pago —
    // lancar o valor cheio deixaria a conciliacao bancaria furada
    // (auditoria de 02/09/2026). Pago a MAIS, a diferenca e' juros.
    var principal = (pag.valorPago != null && pag.valor != null && pag.valorPago < pag.valor)
      ? pag.valorPago : pag.valor;
    var docs = [{ id: prefixo, doc: docDe(principal, catId, pag.historico) }];
    var juros = (pag.valorPago != null && pag.valor != null)
      ? App.centavos(pag.valorPago - pag.valor) : 0;
    if (juros > 0) {
      docs.push({
        id: 'juros' + prefixo,
        doc: docDe(juros, m.juros || null, 'JUROS ' + (pag.historico || ''))
      });
    }
    return docs;
  }

  /* ============================================================
     3. Lista: filtro e totais
     ============================================================ */

  function filtrarLancamentos(lista, f) {
    var o = f || {};
    var termo = App.normalizarTexto(o.termo || '');
    return (lista || []).filter(function (l) {
      if (o.mes && l.mes !== o.mes) return false;
      if (o.bancoId && l.bancoId !== o.bancoId && l.bancoDestinoId !== o.bancoId) return false;
      if (o.tipo && l.tipo !== o.tipo) return false;
      if (o.categoriaId && l.categoriaId !== o.categoriaId) return false;
      if (termo &&
          App.normalizarTexto(l.historico).indexOf(termo) === -1 &&
          App.normalizarTexto(l.fornecedor).indexOf(termo) === -1) return false;
      return true;
    });
  }

  // Transferência não é saída nem entrada da empresa — sai contada à
  // parte, senão o rodapé somaria o mesmo dinheiro dos dois lados.
  function totaisDoFiltro(lista) {
    var t = { qtd: 0, saidas: 0, entradas: 0, transferencias: 0, pendencias: 0 };
    (lista || []).forEach(function (l) {
      t.qtd++;
      if (pendente(l)) t.pendencias++;
      var v = l.valor || 0;
      if (l.tipo === 'saida') t.saidas += v;
      else if (l.tipo === 'entrada') t.entradas += v;
      else if (l.tipo === 'transferencia') t.transferencias += v;
    });
    t.saidas = App.centavos(t.saidas);
    t.entradas = App.centavos(t.entradas);
    t.transferencias = App.centavos(t.transferencias);
    return t;
  }

  /* ============================================================
     4. Exportação — em qual arquivo cada lançamento sai
     ============================================================ */

  // Transferência: no arquivo do banco de MOVIMENTO (é o que a
  // amostra real mostra — TRANSF PAGUEVELOZ/BRADESCO está no arquivo
  // do Bradesco, o destino). Perna vinculada não ganha arquivo
  // próprio; com as duas pernas de movimento (ou as duas vinculadas),
  // fica na ORIGEM. Lançamento comum sai no próprio banco.
  function bancoDoArquivo(l, bancosPorId) {
    if (l.tipo !== 'transferencia') return l.bancoId;
    var origem = (bancosPorId || {})[l.bancoId];
    var destino = (bancosPorId || {})[l.bancoDestinoId];
    var origemMov = !!origem && origem.tipo !== 'vinculada';
    var destinoMov = !!destino && destino.tipo !== 'vinculada';
    if (origemMov === destinoMov) return l.bancoId;
    return origemMov ? l.bancoId : l.bancoDestinoId;
  }

  function agruparPorArquivo(lista, bancosPorId) {
    var grupos = Object.create(null);
    (lista || []).forEach(function (l) {
      var b = bancoDoArquivo(l, bancosPorId);
      (grupos[b] = grupos[b] || []).push(l);
    });
    return grupos;
  }

  var MESES_ARQUIVO = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  // 'BANCO BRADESCO AGOSTO 2026.xlsx' — o "C/C" do cadastro não
  // entra no nome do arquivo.
  function nomeArquivo(banco, mes) {
    var nome = String((banco && banco.nome) || 'BANCO').replace(/\s*C\/C\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return 'BANCO ' + nome.toUpperCase() + ' ' +
      MESES_ARQUIVO[Number(String(mes).substring(5, 7)) - 1] + ' ' + String(mes).substring(0, 4) + '.xlsx';
  }

  /* ============================================================
     5. Layout do contador — 19 colunas, sem cabeçalho
     ============================================================ */

  function dataBR(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
  }

  // Cada lançamento vira DUAS linhas consecutivas: a perna a débito
  // primeiro, a crédito depois — mesmo número (col 1, 8 dígitos com
  // zeros), mesma data, mesmo valor e mesmo histórico (MAIÚSCULAS).
  // A col 19 é o sequencial GLOBAL de linha. Os dois contadores
  // continuam de onde pararam (cont = { lancamento, linha }) e a
  // resposta devolve os próximos, para gravar de volta na config.
  // Lançamento pendente aqui é ERRO de quem chamou: a exportação tem
  // que barrar antes (a numeração não pode queimar número com lixo).
  function linhasExportacao(lista, cont) {
    var numero = cont.lancamento;
    var linha = cont.linha;
    var linhas = [];
    var ordenada = (lista || []).slice().sort(function (a, b) {
      return String(a.data || '').localeCompare(String(b.data || ''));
    });
    ordenada.forEach(function (l) {
      if (pendente(l)) throw new Error('Lançamento pendente na exportação (sem data ou valor): ' + (l.historico || l.id || ''));
      var num = String(numero).padStart(8, '0');
      var hist = String(l.historico || '').toUpperCase();
      var pernas = [
        { conta: l.contaDebito, dc: 'D' },
        { conta: l.contaCredito, dc: 'C' }
      ];
      pernas.forEach(function (p) {
        linhas.push([
          num,                    // 1  nº do lançamento (texto, 8 dígitos)
          dataBR(l.data),         // 2  dd/mm/aaaa
          l.valor,                // 3  valor
          1,                      // 4  constante
          '',                     // 5
          p.conta,                // 6  conta contábil
          p.dc,                   // 7  D | C
          l.valor,                // 8  valor repetido
          EMPRESA_EXPORTACAO,     // 9  CNPJ|inscrição
          '', '',                 // 10, 11
          hist,                   // 12 histórico em maiúsculas
          'N',                    // 13
          'D',                    // 14
          '', '', '', '',         // 15–18
          linha                   // 19 sequencial global de linha
        ]);
        linha++;
      });
      numero++;
    });
    return { linhas: linhas, proximoLancamento: numero, proximaLinha: linha };
  }

  var LancamentosNucleo = {
    EMPRESA_EXPORTACAO: EMPRESA_EXPORTACAO,
    SEED_BANCOS: SEED_BANCOS,
    SEED_CATEGORIAS: SEED_CATEGORIAS,
    montarPartidas: montarPartidas,
    pendente: pendente,
    CATEGORIAS_CONTROLE: CATEGORIAS_CONTROLE,
    lancamentosDePagamento: lancamentosDePagamento,
    filtrarLancamentos: filtrarLancamentos,
    totaisDoFiltro: totaisDoFiltro,
    bancoDoArquivo: bancoDoArquivo,
    agruparPorArquivo: agruparPorArquivo,
    nomeArquivo: nomeArquivo,
    linhasExportacao: linhasExportacao
  };

  global.LancamentosNucleo = LancamentosNucleo;
  if (typeof module === 'object' && module.exports) module.exports = LancamentosNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
