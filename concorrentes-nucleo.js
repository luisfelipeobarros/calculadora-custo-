/* ============================================================
   concorrentes-nucleo.js — o catalogo da pesquisa em lote por
   planilha (aba Concorrentes da Calculadora).

   Mesmo desenho dos outros nucleos: o UNICO lugar onde as regras
   moram, carregavel com <script src> no navegador e com require()
   nos testes. O XLSX so' entra na borda (a tela converte o arquivo
   em linhas); aqui tudo trabalha sobre linhas ja' lidas.

   O que mora aqui:
   - leitura do catalogo (cabecalho tolerante a ordem/acento/caixa,
     preco com sujeira de float -> centavos inteiros, linha ruim
     CONTADA com motivo, nunca engolida);
   - a consulta de busca derivada do nome (sem a notacao interna);
   - o comparativo de substituicao (novo / saiu / mudou / igual);
   - o status de desatualizacao por produto, com TRES motivos
     distintos (nunca / preco mudou / passou do prazo) — o motivo
     importa para quem decide o que repesquisar primeiro;
   - o painel por fabricante, ordenado por quem esta' mais atrasado.

   Fabricante NUNCA e' normalizado/agrupado por semelhanca: dois
   textos diferentes na coluna sao dois fabricantes na tela — e'
   assim que o dono da planilha descobre que ela precisa de limpeza.

   Precisa vir DEPOIS de app-shared.js — usa App.parseNumeroBR,
   App.normalizarTexto e App.diasEntre.
   ============================================================ */
(function (global) {
  'use strict';

  var App = (typeof module === 'object' && module.exports)
    ? require('./app-shared.js')
    : global.App;

  if (!App || !App.parseNumeroBR) {
    throw new Error('concorrentes-nucleo.js precisa de app-shared.js carregado antes.');
  }

  var normalizar = App.normalizarTexto;

  /* ============================================================
     1. Leitura do catalogo (linhas ja' lidas do XLSX)
     ============================================================ */

  // Sinonimos por coluna. A ordem dos campos importa: "Código
  // Produto" contem "produto", entao codigo e' testado antes de nome.
  var CAMPOS_CATALOGO = [
    ['codigo', ['codigo produto', 'codigo', 'cod', 'sku', 'referencia']],
    ['nome', ['nome produto', 'nome', 'produto', 'descricao', 'item']],
    ['unidade', ['unidade de venda', 'unidade', 'un.']],
    ['preco', ['preco de venda', 'preco', 'valor', 'vlr']],
    ['fabricante', ['fabricante/fornecedor', 'fabricante', 'fornecedor', 'marca']]
  ];

  function detectarColunasCatalogo(headerRow) {
    var map = { codigo: -1, nome: -1, unidade: -1, preco: -1, fabricante: -1 };
    (headerRow || []).forEach(function (cell, idx) {
      var texto = normalizar(String(cell == null ? '' : cell));
      if (!texto) return;
      for (var i = 0; i < CAMPOS_CATALOGO.length; i++) {
        var campo = CAMPOS_CATALOGO[i][0];
        if (map[campo] !== -1) continue;
        // Sinonimo guloso pegava a coluna errada: "Código de Barras"
        // virava a chave do catalogo e "Preço de Custo" virava o preco
        // de venda. As duas exclusoes fecham os casos reais.
        if (campo === 'codigo' && texto.indexOf('barra') !== -1) continue;
        if (campo === 'preco' && texto.indexOf('custo') !== -1) continue;
        var bate = CAMPOS_CATALOGO[i][1].some(function (p) { return texto.indexOf(p) !== -1; });
        if (bate) { map[campo] = idx; break; }
      }
    });
    return map;
  }

  // '64.900000000000006' -> 6490; '36,90' -> 3690; '1.234' (milhar a
  // brasileira, sem centavos) -> 123400. Arredonda para 2 casas ANTES
  // de virar centavo — a sujeira de float da planilha morre aqui e o
  // resto do fluxo so' ve inteiro. parseDinheiroBR, nao parseNumeroBR:
  // preco de VENDA formatado como "1.234" e' mil e pouco, nao R$ 1,23
  // (auditoria de 02/09/2026).
  function precoParaCentavos(v) {
    var n = App.parseDinheiroBR(v);
    if (n == null || !(n > 0)) return null;
    return Math.round(n * 100);
  }

  // A notacao interna do nome nao ajuda um site concorrente: sai o
  // '*' inicial e o tamanho da caixa entre parenteses (CX...). O nome
  // ORIGINAL fica intacto para exibir e salvar — so' a consulta muda.
  function consultaDeBusca(nome) {
    return String(nome == null ? '' : nome)
      .replace(/^\s*\*+\s*/, '')
      .replace(/\(\s*CX[^)]*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // rows: [[celulas da linha 1], [linha 2], ...] como o XLSX entrega
  // com header:1. Devolve { itens, ignoradas } ou { erro } quando o
  // cabecalho nao da' para reconhecer — melhor recusar a planilha
  // inteira do que importar um catalogo pela metade.
  function lerCatalogo(rows) {
    var headerIdx = -1, colMap = null;
    var limite = Math.min((rows || []).length, 10);
    for (var i = 0; i < limite; i++) {
      var map = detectarColunasCatalogo(rows[i]);
      if (map.nome !== -1 && map.preco !== -1) { headerIdx = i; colMap = map; break; }
    }
    if (headerIdx === -1) {
      return { erro: 'Não reconheci o cabeçalho — a planilha precisa de colunas como ' +
        '"Código Produto", "Nome Produto", "Preço de Venda" e "Fabricante/Fornecedor".' };
    }
    // O catalogo inteiro e' chaveado pelo codigo (painel, diff,
    // ultima pesquisa). Sem a coluna, nada disso funciona — recusa
    // explicita em vez de um catalogo que parece funcionar.
    if (colMap.codigo === -1) {
      return { erro: 'A planilha não tem a coluna de código do produto — ela é a chave de tudo aqui.' };
    }

    var itens = [], ignoradas = [];
    var codigosVistos = Object.create(null);
    for (var r = headerIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.every(function (c) { return c === '' || c == null; })) continue;
      var linhaHumana = r + 1; // planilha conta do 1
      var codigo = String(row[colMap.codigo] == null ? '' : row[colMap.codigo]).trim();
      var nome = String(row[colMap.nome] == null ? '' : row[colMap.nome]).trim();
      var precoCent = precoParaCentavos(row[colMap.preco]);
      if (!nome) { ignoradas.push({ linha: linhaHumana, motivo: 'sem nome' }); continue; }
      if (precoCent == null) { ignoradas.push({ linha: linhaHumana, motivo: 'sem preço', nome: nome }); continue; }
      if (!codigo) { ignoradas.push({ linha: linhaHumana, motivo: 'sem código', nome: nome }); continue; }
      // O catalogo inteiro e' chaveado pelo codigo: uma segunda linha
      // com o mesmo codigo duplicaria buscas, selecao e diff. A
      // PRIMEIRA vale; a repetida e' contada, nunca engolida.
      if (codigosVistos[codigo]) { ignoradas.push({ linha: linhaHumana, motivo: 'código repetido', nome: nome }); continue; }
      codigosVistos[codigo] = true;
      itens.push({
        codigo: codigo,
        nome: nome,
        consulta: consultaDeBusca(nome),
        unidade: colMap.unidade !== -1 ? String(row[colMap.unidade] || '').trim() : '',
        precoCent: precoCent,
        // Como esta' na coluna, sem juntar parecidos (regra da secao 3
        // do pedido): variacao de grafia TEM que aparecer na tela.
        fabricante: colMap.fabricante !== -1 ? String(row[colMap.fabricante] || '').trim() : ''
      });
    }
    return { itens: itens, ignoradas: ignoradas };
  }

  /* ============================================================
     2. Comparativo da substituicao (catalogo antigo x novo)
     ============================================================ */

  // Chave = codigo. "Mudou" cobre preco OU nome — o detalhe diz o
  // que mudou, e mudanca de nome com preco igual tambem aparece
  // (mesmo codigo com outro nome e' informacao, nao ruido).
  function diffCatalogos(antigo, novo) {
    var porCodigoAntigo = Object.create(null);
    (antigo || []).forEach(function (it) { porCodigoAntigo[it.codigo] = it; });
    var porCodigoNovo = Object.create(null);
    (novo || []).forEach(function (it) { porCodigoNovo[it.codigo] = it; });

    var novos = [], mudaram = [], iguais = 0;
    (novo || []).forEach(function (it) {
      var velho = porCodigoAntigo[it.codigo];
      if (!velho) { novos.push(it); return; }
      var mudouPreco = velho.precoCent !== it.precoCent;
      var mudouNome = velho.nome !== it.nome;
      if (mudouPreco || mudouNome) {
        mudaram.push({
          codigo: it.codigo, mudouPreco: mudouPreco, mudouNome: mudouNome,
          nomeDe: velho.nome, nomePara: it.nome,
          precoDeCent: velho.precoCent, precoParaCent: it.precoCent
        });
      } else {
        iguais++;
      }
    });
    var sairam = (antigo || []).filter(function (it) { return !porCodigoNovo[it.codigo]; });
    return { novos: novos, sairam: sairam, mudaram: mudaram, iguais: iguais };
  }

  /* ============================================================
     3. Desatualizacao — o coracao da tela
     ============================================================ */

  // ultima: { data: 'aaaa-mm-dd', meuPrecoCent } | null/undefined.
  // Os motivos, do mais grave para o menos:
  //   'nunca' — nao ha' pesquisa para este codigo;
  //   'preco' — o preco do catalogo mudou depois da ultima pesquisa:
  //             a comparacao guardada foi feita contra um preco que
  //             nao praticamos mais — parece atual e diz a coisa
  //             errada, PIOR que estar velha;
  //   'prazo' — passou de prazoDias sem repesquisar.
  function statusProduto(item, ultima, hoje, prazoDias) {
    if (!ultima || !ultima.data) return { motivo: 'nunca', ultima: null };
    if (ultima.meuPrecoCent != null && item.precoCent != null &&
        ultima.meuPrecoCent !== item.precoCent) {
      return { motivo: 'preco', ultima: ultima };
    }
    if (App.diasEntre(ultima.data, hoje) > prazoDias) {
      return { motivo: 'prazo', ultima: ultima };
    }
    return { motivo: null, ultima: ultima };
  }

  // Agrupa o catalogo por fabricante e responde a pergunta que a
  // pessoa traz para a tela: "quem esta' mais atrasado?" — ordenado
  // pela proporcao de desatualizados (fabricante nunca pesquisado tem
  // TODOS desatualizados, nunca zero).
  function painelFabricantes(itens, ultimaPorCodigo, hoje, prazoDias) {
    var grupos = Object.create(null);
    (itens || []).forEach(function (it) {
      var f = it.fabricante || '(sem fabricante)';
      var g = grupos[f];
      if (!g) {
        g = grupos[f] = { fabricante: f, qtd: 0, desatualizados: 0,
          motivos: { nunca: 0, preco: 0, prazo: 0 }, ultimaData: null };
      }
      g.qtd++;
      var st = statusProduto(it, (ultimaPorCodigo || {})[it.codigo], hoje, prazoDias);
      if (st.motivo) { g.desatualizados++; g.motivos[st.motivo]++; }
      if (st.ultima && st.ultima.data && (!g.ultimaData || st.ultima.data > g.ultimaData)) {
        g.ultimaData = st.ultima.data;
      }
    });
    return Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) {
        var pa = a.desatualizados / a.qtd, pb = b.desatualizados / b.qtd;
        if (pb !== pa) return pb - pa;
        if (b.desatualizados !== a.desatualizados) return b.desatualizados - a.desatualizados;
        return a.fabricante.localeCompare(b.fabricante, 'pt-BR');
      });
  }

  function contarBuscas(qtdProdutos, qtdLojas) {
    return (qtdProdutos || 0) * (qtdLojas || 0);
  }

  /* ============================================================
     Exporta
     ============================================================ */

  var ConcorrentesNucleo = {
    detectarColunasCatalogo: detectarColunasCatalogo,
    precoParaCentavos: precoParaCentavos,
    consultaDeBusca: consultaDeBusca,
    lerCatalogo: lerCatalogo,
    diffCatalogos: diffCatalogos,
    statusProduto: statusProduto,
    painelFabricantes: painelFabricantes,
    contarBuscas: contarBuscas
  };

  global.ConcorrentesNucleo = ConcorrentesNucleo;
  if (typeof module === 'object' && module.exports) module.exports = ConcorrentesNucleo;
})(typeof window !== 'undefined' ? window : globalThis);
