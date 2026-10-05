// Testes diretos das funcoes de app-shared.js.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { instalar } = require('./dom-falso.js');

const { window } = instalar([]);
const ctx = vm.createContext(window);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'app-shared.js'), 'utf8'), ctx, {
  filename: 'app-shared.js'
});
const App = window.App;

let ok = 0, falhas = 0;
function conferir(nome, obtido, esperado) {
  const igual = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (igual) { ok++; }
  else {
    falhas++;
    console.log('  [X] ' + nome + '\n      esperado: ' + JSON.stringify(esperado) +
                '\n      obtido:   ' + JSON.stringify(obtido));
  }
}

// --- escapeHtml: fecha todas as portas de injecao em atributo e texto ---
conferir('escapeHtml aspas duplas', App.escapeHtml('a"b'), 'a&quot;b');
conferir('escapeHtml aspas simples', App.escapeHtml("a'b"), 'a&#39;b');
conferir('escapeHtml tags', App.escapeHtml('<img onerror=x>'), '&lt;img onerror=x&gt;');
conferir('escapeHtml e comercial', App.escapeHtml('a&b'), 'a&amp;b');
conferir('escapeHtml nulo vira vazio', App.escapeHtml(null), '');

// --- safeUrl: so' http/https passam ---
conferir('safeUrl https', App.safeUrl('https://loja.com/p'), 'https://loja.com/p');
conferir('safeUrl bloqueia javascript:', App.safeUrl('javascript:alert(1)'), '');
conferir('safeUrl bloqueia data:', App.safeUrl('data:text/html,<script>x</script>'), '');
conferir('safeUrl bloqueia vbscript:', App.safeUrl('vbscript:msgbox'), '');
conferir('safeUrl com espacos e maiusculas', App.safeUrl('  JavaScript:alert(1)  '), '');
conferir('safeUrl vazio', App.safeUrl(''), '');
conferir('safeUrl nulo', App.safeUrl(null), '');

// --- moeda e porcentagem ---
conferir('brl inteiro', App.brl(1234.5), 'R$ 1.234,50');
conferir('brl zero', App.brl(0), 'R$ 0,00');
conferir('brl nao-numero', App.brl(undefined), '--');
conferir('brl NaN', App.brl(NaN), '--');
conferir('pct padrao 2 casas', App.pct(0.0825), '8,25%');
conferir('pct nulo', App.pct(null), '--');

// --- centavos: o arredondamento que faz os totais fecharem ---
conferir('centavos 0.1+0.2', App.centavos(0.1 + 0.2), 0.3);
conferir('centavos meio centavo pra cima', App.centavos(1.005), 1.01);
conferir('centavos negativo', App.centavos(-2.345), -2.35);
conferir('centavos preserva nulo', App.centavos(null), null);

// --- numeros em formato brasileiro ---
conferir('parseNumeroBR com R$', App.parseNumeroBR('R$ 1.234,56'), 1234.56);
conferir('parseNumeroBR ponto decimal', App.parseNumeroBR('1234.56'), 1234.56);
// Planilha de fornecedor traz "0,325" e "1,500": virgula unica seguida
// de digitos e' decimal, com quantas casas vierem (antes virava 325).
conferir('parseNumeroBR virgula com 3 decimais', App.parseNumeroBR('0,325'), 0.325);
conferir('parseNumeroBR "1,500" e um e meio', App.parseNumeroBR('1,500'), 1.5);
conferir('parseNumeroBR duas virgulas = milhar', App.parseNumeroBR('1,234,567'), 1234567);
// AMBIGUIDADE CONHECIDA (comportamento original, mantido de proposito):
// sem virgula, "1.234" e' lido como 1,234 e nao como mil duzentos e
// trinta e quatro. Nao da' para desfazer sem saber como os fornecedores
// formatam as planilhas — precos quase sempre trazem centavos
// ("1.234,56"), que caem no ramo correto. Ver README.
conferir('parseNumeroBR ponto sem virgula = decimal', App.parseNumeroBR('1.234'), 1.234);
conferir('parseNumeroBR vazio', App.parseNumeroBR(''), null);
conferir('parseNumeroBR nulo', App.parseNumeroBR(null), null);
conferir('parseNumeroBR ja numero', App.parseNumeroBR(9.9), 9.9);
conferir('parseNumeroBR lixo', App.parseNumeroBR('abc'), null);

// --- toNum: nunca devolve NaN ---
conferir('toNum texto invalido', App.toNum('abc'), 0);
conferir('toNum vazio', App.toNum(''), 0);
conferir('toNum decimal', App.toNum('12.5'), 12.5);

// --- datas: a aritmetica que decide atraso e vencimento ---
conferir('fmtData ISO', App.fmtData('2026-07-27'), '27/07/2026');
conferir('fmtData vazia', App.fmtData(''), '--');

// fmtDataFirestore: Timestamp (toDate), Date, string ISO e nulo — o
// nulo e' o serverTimestamp ainda pendente na leitura local, e virava
// 31/12/1969; a string ISO passava pelo fuso e perdia um dia.
conferir('fmtDataFirestore com Timestamp', App.fmtDataFirestore({ toDate: () => new Date(2026, 8, 14) }), '14/09/2026');
conferir('fmtDataFirestore com Date', App.fmtDataFirestore(new Date(2026, 0, 5)), '05/01/2026');
conferir('fmtDataFirestore com string ISO nao perde um dia', App.fmtDataFirestore('2026-09-14'), '14/09/2026');
conferir('fmtDataFirestore nulo = "-", nao 31/12/1969', App.fmtDataFirestore(null), '-');
conferir('fmtDataFirestore undefined = "-"', App.fmtDataFirestore(undefined), '-');
conferir('fmtDataFirestore com lixo = "-"', App.fmtDataFirestore('abc'), '-');

// iso: data local, sem passar por UTC (23h de Sao Paulo ainda e' hoje).
conferir('iso de Date local', App.iso(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
conferir('iso preenche mes e dia com zero', App.iso(new Date(2026, 0, 2)), '2026-01-02');
// O fallback ESCAPADO: fmtData e' interpolado direto em innerHTML em
// ~10 pontos dos apps — valor fora do padrao nao pode voltar cru.
conferir('fmtData com lixo volta ESCAPADO (fecha o furo de XSS)',
  App.fmtData('<img src=x>'), '&lt;img src=x&gt;');

// --- dinheiro a brasileira (campos de valor grande) ---
// parseNumeroBR mantem "1.234" = 1,234 de proposito (precos unitarios
// de fornecedor); parseDinheiroBR le "1.234" como milhar — e' ele que
// os campos de DINHEIRO usam (o bug corrompia >= 1000 nas assistencias).
conferir('parseDinheiroBR 25.000 = vinte e cinco mil', App.parseDinheiroBR('25.000'), 25000);
conferir('parseDinheiroBR com R$', App.parseDinheiroBR('R$ 2.500.000'), 2500000);
conferir('parseDinheiroBR com centavos nao muda', App.parseDinheiroBR('1.234,56'), 1234.56);
conferir('parseDinheiroBR decimal simples nao muda', App.parseDinheiroBR('64.9'), 64.9);
conferir('parseDinheiroBR nulo', App.parseDinheiroBR(null), null);
conferir('somarDias vira o mes', App.somarDias('2026-01-31', 1), '2026-02-01');
conferir('somarDias ano bissexto', App.somarDias('2028-02-28', 1), '2028-02-29');
conferir('somarDias nao bissexto', App.somarDias('2026-02-28', 1), '2026-03-01');
conferir('somarDias negativo (janela da segunda)', App.somarDias('2026-07-27', -2), '2026-07-25');
conferir('somarDias vira o ano', App.somarDias('2026-12-31', 1), '2027-01-01');
conferir('diasEntre', App.diasEntre('2026-01-01', '2026-03-01'), 59);
conferir('diasEntre mesmo dia', App.diasEntre('2026-05-05', '2026-05-05'), 0);

// somarMeses: a rolagem mensal de vencimento (recorrencia dos
// pagamentos internos e compras do Simulador). Encolhe mes curto em
// vez de transbordar, e o diaFixo faz o 31 VOLTAR a ser 31 depois de
// fevereiro — sem ele o encolhimento seria permanente.
conferir('somarMeses simples', App.somarMeses('2026-08-10', 1), '2026-09-10');
conferir('somarMeses dia 31 encolhe para mes de 30', App.somarMeses('2026-08-31', 1), '2026-09-30');
conferir('somarMeses fevereiro encolhe para 28', App.somarMeses('2026-01-31', 1), '2026-02-28');
conferir('somarMeses fevereiro bissexto vai a 29', App.somarMeses('2028-01-31', 1), '2028-02-29');
conferir('somarMeses NAO transborda (31/01 + 1 nunca e 03/03)',
         App.somarMeses('2026-01-31', 1) < '2026-03-01', true);
conferir('somarMeses vira o ano', App.somarMeses('2026-12-15', 1), '2027-01-15');
conferir('somarMeses varios meses de uma vez', App.somarMeses('2026-01-15', 13), '2027-02-15');
conferir('somarMeses diaFixo devolve o 31 depois do mes curto',
         App.somarMeses('2026-09-30', 1, { diaFixo: 31 }), '2026-10-31');
conferir('somarMeses ultimoDia cai no fim do mes de destino',
         App.somarMeses('2026-01-31', 1, { ultimoDia: true }), '2026-02-28');
conferir('somarMeses ultimoDia em mes de 31', App.somarMeses('2026-02-28', 1, { ultimoDia: true }), '2026-03-31');

// Datas em texto aaaa-mm-dd sao comparaveis alfabeticamente — o app
// depende disso em todos os filtros de vencimento.
conferir('ordem alfabetica = ordem cronologica', ['2026-10-01', '2026-02-01', '2026-01-15'].sort(),
         ['2026-01-15', '2026-02-01', '2026-10-01']);

// --- busca sem acento ---
conferir('normalizarTexto tira acento', App.normalizarTexto('Porcelanato AÇÃO Ônix'), 'porcelanato acao onix');
conferir('normalizarTexto nulo', App.normalizarTexto(null), '');

// --- busca com varios termos (etiquetas) ---
conferir('termosDaBusca: etiquetas + texto em digitacao, normalizados',
  App.termosDaBusca({ _chips: ['132500', ' Cerâmica '], value: ' 185066 ' }), ['132500', 'ceramica', '185066']);
conferir('termosDaBusca: campo sem etiqueta vale o texto', App.termosDaBusca({ value: 'Vetrus' }), ['vetrus']);
conferir('termosDaBusca: tudo vazio = lista vazia', App.termosDaBusca({ _chips: [], value: '  ' }), []);
conferir('termosDaBusca: sem campo = lista vazia', App.termosDaBusca(null), []);
conferir('normalizarTexto acha com acento no termo',
         App.normalizarTexto('CERÂMICA').includes(App.normalizarTexto('ceramica')), true);

// --- usuario simples <-> e-mail que o Firebase exige ---
conferir('usuario simples ganha dominio', App.usuarioParaEmail('Administrativo'),
         'administrativo@' + App.DOMINIO_LOGIN);
conferir('usuario com espacos', App.usuarioParaEmail('  Compras  '),
         'compras@' + App.DOMINIO_LOGIN);
conferir('maiusculas viram minusculas', App.usuarioParaEmail('COMPRAS'),
         'compras@' + App.DOMINIO_LOGIN);
conferir('espaco no meio some', App.usuarioParaEmail('conta bil'),
         'contabil@' + App.DOMINIO_LOGIN);
conferir('e-mail completo passa direto', App.usuarioParaEmail('chefe@empresa.com.br'),
         'chefe@empresa.com.br');
conferir('vazio continua vazio', App.usuarioParaEmail('   '), '');
conferir('volta para exibicao', App.emailParaUsuario('administrativo@' + App.DOMINIO_LOGIN),
         'administrativo');
conferir('e-mail de fora e exibido inteiro', App.emailParaUsuario('chefe@empresa.com.br'),
         'chefe@empresa.com.br');
// Ida e volta tem que fechar, senao a barra de conta mostraria uma coisa
// e o login esperaria outra.
conferir('ida e volta', App.emailParaUsuario(App.usuarioParaEmail('Compras')), 'compras');

// --- deteccao de permissao negada (dispara o login) ---
conferir('permissao negada por code', App.ehPermissaoNegada({ code: 'permission-denied' }), true);
conferir('permissao negada por mensagem',
         App.ehPermissaoNegada({ message: 'Missing or insufficient permissions.' }), true);
conferir('erro de rede nao e permissao', App.ehPermissaoNegada({ code: 'unavailable' }), false);
conferir('nulo nao e permissao', App.ehPermissaoNegada(null), false);

// --- casaFornecedor: busca sem acento dos dois lados ---
// As buscas de Produtos salvos ja' ignoravam acento; as telas de notas
// nao. Agora todas passam por normalizarTexto, inclusive esta.
conferir('casaFornecedor acha "CERÂMICA" digitando "ceramica"',
         App.casaFornecedor('CERÂMICA BRASILEIRA', 'CERÂMICA BRASILEIRA LTDA', 'ceramica'), true);
conferir('casaFornecedor aceita acento no termo digitado',
         App.casaFornecedor('Ceramica Brasileira', 'CERAMICA LTDA', 'cerâmica'), true);
conferir('casaFornecedor continua achando pelo rotulo da tela',
         App.casaFornecedor('Vetrus (Stela)', 'VETRUS S/A', 'stela'), true);
conferir('casaFornecedor nao casa a toa',
         App.casaFornecedor('Vetrus (Stela)', 'VETRUS S/A', 'pamesa'), false);

// --- notaAImportar: a regra da aba "A importar", usada pelas DUAS ---
// paginas (Controle de Notas e o filtro "so' as nao recebidas" da NF-e
// Emitidas). Se uma tela mostrar uma nota que a outra nao mostra, e'
// aqui que se conserta.
const pendente = { emitida: true, noSistema: false, status: 'ativa', dataEmissao: '2026-08-10' };
conferir('notaAImportar: emitida, ativa e sem entrada no ERP -> a importar',
         App.notaAImportar(pendente), true);
conferir('notaAImportar: ja deu entrada (noSistema) -> nao',
         App.notaAImportar(Object.assign({}, pendente, { noSistema: true })), false);
conferir('notaAImportar: cancelada -> nao',
         App.notaAImportar(Object.assign({}, pendente, { status: 'cancelada' })), false);
conferir('notaAImportar: sem o campo emitida (doc da funcao 2 do Apps Script) -> nao',
         App.notaAImportar({ noSistema: false, dataEmissao: '2026-08-10' }), false);
conferir('notaAImportar: sem status vale como ativa',
         App.notaAImportar({ emitida: true, noSistema: false, dataEmissao: '2026-08-10' }), true);
conferir('notaAImportar: antes do corte -> nao',
         App.notaAImportar(pendente, '2026-09-01'), false);
conferir('notaAImportar: nota ausente (null) -> nao, nunca chute',
         App.notaAImportar(null), false);

// --- confirmar / pedirData: o que a Promise devolve -----------
//
// Estes testes existem por causa de um bug real: alguem acrescentou uma
// opcao `inputDate` ao confirmar() para reaproveita-lo como seletor de
// data. So' que confirmar() termina em `.then(v => v === true)`, entao a
// data escolhida virava `false` e o "Prorrogar vencimento" nao fazia
// NADA — sem erro no console, sem aviso. Nao basta o modal abrir: o
// teste tem que apertar o botao e olhar o valor que volta.
const { achar, acharTodos } = require('./dom-falso.js');

function modalAberto() {
  return achar(window.document.body, el => el.className === 'modal-caixa');
}
function botaoDoModal(texto) {
  return acharTodos(modalAberto(), el => el.tagName === 'BUTTON')
    .find(b => b.textContent === texto);
}
function campoDataDoModal() {
  return achar(modalAberto(), el => el.type === 'date');
}

const pendentes = [];
function assincrono(nome, executar) { pendentes.push({ nome, executar }); }

assincrono('confirmar devolve true no Confirmar', () => {
  const p = App.confirmar({ titulo: 'x', mensagem: 'y' });
  botaoDoModal('Confirmar').disparar('click');
  return p.then(v => conferir('confirmar devolve true no Confirmar', v, true));
});

assincrono('confirmar devolve false no Cancelar', () => {
  const p = App.confirmar({ titulo: 'x', mensagem: 'y' });
  botaoDoModal('Cancelar').disparar('click');
  return p.then(v => conferir('confirmar devolve false no Cancelar', v, false));
});

assincrono('pedirData devolve a data escolhida', () => {
  const p = App.pedirData({ titulo: 'Prorrogar', mensagem: 'Nova data:', confirmar: 'Prorrogar' });
  campoDataDoModal().value = '2026-09-15';
  botaoDoModal('Prorrogar').disparar('click');
  return p.then(v => conferir('pedirData devolve a data escolhida', v, '2026-09-15'));
});

assincrono('pedirData devolve null no Cancelar', () => {
  const p = App.pedirData({ titulo: 'Prorrogar', mensagem: 'Nova data:' });
  botaoDoModal('Cancelar').disparar('click');
  return p.then(v => conferir('pedirData devolve null no Cancelar', v, null));
});

// Sem data escolhida o modal NAO fecha: fechar aqui gravaria '' no
// vencimento de todo mundo que estivesse selecionado.
assincrono('pedirData nao fecha com o campo vazio', () => {
  let resolveu = false;
  const p = App.pedirData({ titulo: 'Prorrogar', mensagem: 'Nova data:' });
  p.then(() => { resolveu = true; });
  const caixa = modalAberto();
  botaoDoModal('Confirmar').disparar('click');
  return Promise.resolve().then(() => {
    conferir('pedirData nao fecha com o campo vazio', resolveu, false);
    conferir('e avisa o que falta',
      achar(caixa, el => el.className === 'modal-erro').textContent, 'Escolha uma data.');
    botaoDoModal('Cancelar').disparar('click');
    return p;
  });
});

// pedirTexto: cancelar devolve null; confirmar devolve o texto — e
// confirmar VAZIO devolve '' (limpar a observacao e' resposta valida,
// diferente de cancelar). Quem chama testa `!== null`.
function campoTextoDoModal() {
  return achar(modalAberto(), el => el.type === 'text');
}

assincrono('pedirTexto devolve o texto digitado', () => {
  const p = App.pedirTexto({ titulo: 'Observação', mensagem: 'x', confirmar: 'Salvar' });
  campoTextoDoModal().value = '  acordo com o fornecedor  ';
  botaoDoModal('Salvar').disparar('click');
  return p.then(v => conferir('pedirTexto devolve o texto digitado (sem espacos das pontas)',
    v, 'acordo com o fornecedor'));
});

assincrono('pedirTexto devolve null no Cancelar', () => {
  const p = App.pedirTexto({ titulo: 'Observação', mensagem: 'x' });
  campoTextoDoModal().value = 'digitei mas desisti';
  botaoDoModal('Cancelar').disparar('click');
  return p.then(v => conferir('pedirTexto devolve null no Cancelar', v, null));
});

assincrono('pedirTexto confirmado em branco devolve "" (limpar), nao null', () => {
  const p = App.pedirTexto({ titulo: 'Observação', mensagem: 'x' });
  botaoDoModal('Confirmar').disparar('click');
  return p.then(v => conferir('pedirTexto confirmado em branco devolve "" (limpar), nao null', v, ''));
});

// --- leitura economica: cache do navegador + so' o que mudou ---
//
// Firestore de mentira: uma lista "servidor" e uma lista "cache". Toda
// leitura do servidor ALIMENTA o cache (como o SDK faz) e fica
// registrada em `log`, que e' o que os testes conferem: quantos
// documentos cada caminho pagou.
function firestoreFalso(servidor, cache, log) {
  const doc = (x) => ({ id: x.id, data: () => x.dados });
  const valor = (v) => (v && v.toMillis ? v.toMillis() : v);
  function consulta(filtros) {
    return {
      where(campo, op, v) { return consulta(filtros.concat([[campo, op, v]])); },
      get(opts) {
        const deCache = !!(opts && opts.source === 'cache');
        if (deCache && cache === null) return Promise.reject(new Error('sem cache'));
        const lista = (deCache ? cache : servidor).filter(x => filtros.every(([c, op, v]) => {
          const a = valor(x.dados[c]), b = valor(v);
          if (a == null) return false;
          return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : a === b;
        }));
        log.push((deCache ? 'cache' : 'servidor') + ':' + lista.length);
        if (!deCache && cache) lista.forEach(x => {
          const i = cache.findIndex(y => y.id === x.id);
          if (i === -1) cache.push(x); else cache[i] = x;
        });
        return Promise.resolve({ size: lista.length, forEach: (fn) => lista.map(doc).forEach(fn) });
      }
    };
  }
  return consulta([]);
}
const carimbo = (ms) => ({ toMillis: () => ms });
const HORA = 3600000;
function armazenamentoFalso() {
  const m = {};
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; } };
}
const ids = (r) => r.docs.map(d => d.id).sort().join(',');

assincrono('lerComDelta: completa na primeira vez, delta depois, e completa de novo na duvida', async () => {
  const servidor = [
    { id: 'a', dados: { v: 1, atualizadoEm: carimbo(10 * HORA) } },
    { id: 'b', dados: { v: 1, atualizadoEm: carimbo(20 * HORA) } },
    { id: 'c', dados: { v: 1 } } // ficha antiga, sem carimbo
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const ler = (extra) => App.lerComDelta(Object.assign({
    consulta: firestoreFalso(servidor, cache, log), campo: 'atualizadoEm', chave: 'k', hoje: '2026-10-05',
    versao: 0, armazenamento: arm, deMillis: carimbo
  }, extra));

  const r1 = await ler();
  conferir('delta: primeira leitura e completa e paga tudo', [r1.modo, r1.lidasNoServidor, ids(r1)], ['completa', 3, 'a,b,c']);

  log.length = 0;
  const r2 = await ler();
  conferir('delta: segunda leitura vem do cache e paga so o que esta na folga do ultimo carimbo',
    [r2.modo, r2.lidasNoServidor, ids(r2), log], ['delta', 1, 'a,b,c', ['cache:3', 'servidor:1']]);

  // Outra maquina alterou "a" e criou "d".
  servidor[0] = { id: 'a', dados: { v: 2, atualizadoEm: carimbo(30 * HORA) } };
  servidor.push({ id: 'd', dados: { v: 1, atualizadoEm: carimbo(31 * HORA) } });
  const r3 = await ler();
  // 3 leituras: as duas novidades + "b", que estava dentro da folga do ultimo carimbo.
  conferir('delta: traz a ficha alterada e a nova, com o valor NOVO',
    [r3.modo, r3.lidasNoServidor, ids(r3), r3.docs.find(d => d.id === 'a').data().v], ['delta', 3, 'a,b,c,d', 2]);
  conferir('delta: o controle avanca para o ultimo carimbo visto', [JSON.parse(arm.m.k).ultima, JSON.parse(arm.m.k).qtd], [31 * HORA, 4]);

  const r4 = await ler({ hoje: '2026-10-06' });
  conferir('delta: primeira leitura de outro dia e completa', [r4.modo, r4.motivo], ['completa', 'renovação diária']);
  const r5 = await ler({ hoje: '2026-10-06', versao: 1 });
  conferir('delta: contador de exclusao diferente = completa', [r5.modo, r5.motivo], ['completa', 'houve exclusão em outra máquina']);

  // O navegador limpou parte do cache: menos documentos do que o controle diz.
  cache.splice(0, 2);
  const r6 = await ler({ hoje: '2026-10-06', versao: 1 });
  conferir('delta: cache menor que o esperado = completa (nunca lista pela metade)', [r6.modo, r6.motivo, ids(r6)], ['completa', 'cache do navegador incompleto', 'a,b,c,d']);

  // Exclusao feita AQUI: some do cache local, e o controle e ajustado
  // para a propria maquina nao pagar uma leitura inteira por isso.
  servidor.splice(servidor.findIndex(x => x.id === 'd'), 1);
  cache.splice(cache.findIndex(x => x.id === 'd'), 1);
  App.ajustarLeitura('k', (m) => { m.qtd -= 1; m.versao += 1; }, arm);
  const r7 = await ler({ hoje: '2026-10-06', versao: 2 });
  conferir('delta: depois de excluir aqui e ajustar o controle, continua em delta', [r7.modo, ids(r7)], ['delta', 'a,b,c']);

  App.esquecerLeitura('k', arm);
  const r8 = await ler({ hoje: '2026-10-06', versao: 2 });
  conferir('delta: controle apagado = completa', r8.modo, 'completa');
});

assincrono('lerComDelta: navegador sem cache cai na leitura completa', async () => {
  const servidor = [{ id: 'a', dados: { atualizadoEm: carimbo(HORA) } }];
  const arm = armazenamentoFalso(), log = [];
  const o = { campo: 'atualizadoEm', chave: 'k', hoje: '2026-10-05', armazenamento: arm, deMillis: carimbo };
  await App.lerComDelta(Object.assign({ consulta: firestoreFalso(servidor, [], log) }, o));
  const r = await App.lerComDelta(Object.assign({ consulta: firestoreFalso(servidor, null, log) }, o));
  conferir('delta: erro ao ler o cache = completa', [r.modo, r.motivo, ids(r)], ['completa', 'cache do navegador indisponível', 'a']);
  const semLS = await App.lerComDelta(Object.assign({ consulta: firestoreFalso(servidor, [], log) }, o, { armazenamento: null }));
  conferir('delta: sem localStorage, sempre completa', semLS.modo, 'completa');
});

assincrono('lerComDelta: consulta com filtro proprio usa a colecao pura no delta e filtra o que chega', async () => {
  const servidor = [
    { id: 'p1', dados: { codigo: '10', data: carimbo(10 * HORA) } },
    { id: 's1', dados: { data: carimbo(11 * HORA) } } // pesquisa sem codigo: fora da consulta
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const col = firestoreFalso(servidor, cache, log);
  const o = { consulta: col.where('codigo', '>=', ''), delta: col, aceita: d => !!d.data().codigo,
    campo: 'data', chave: 'c', hoje: '2026-10-05', armazenamento: arm, deMillis: carimbo };
  const r1 = await App.lerComDelta(o);
  conferir('delta com filtro: a completa respeita a consulta', ids(r1), 'p1');
  servidor.push({ id: 'p2', dados: { codigo: '11', data: carimbo(12 * HORA) } }, { id: 's2', dados: { data: carimbo(13 * HORA) } });
  const r2 = await App.lerComDelta(o);
  conferir('delta com filtro: o que chega sem codigo e descartado, mas o carimbo avanca',
    [r2.modo, ids(r2), JSON.parse(arm.m.c).ultima], ['delta', 'p1,p2', 13 * HORA]);
});

assincrono('lerFaixaComCache: passado do cache, recente do servidor, completa a cada 7 dias', async () => {
  const servidor = [
    { id: 'jan', dados: { vencimento: '2026-01-10', valor: 1 } },
    { id: 'jun', dados: { vencimento: '2026-06-10', valor: 1 } },
    { id: 'set', dados: { vencimento: '2026-09-20', valor: 1 } },
    { id: 'out', dados: { vencimento: '2026-10-02', valor: 1 } },
    { id: 'antes', dados: { vencimento: '2025-12-31', valor: 1 } } // fora da faixa
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const ler = (extra) => App.lerFaixaComCache(Object.assign({
    col: firestoreFalso(servidor, cache, log), campo: 'vencimento', ini: '2026-01-01', corte: '2026-08-06',
    chave: 'f', hoje: '2026-10-05', armazenamento: arm
  }, extra));

  const r1 = await ler();
  conferir('faixa: primeira leitura e completa', [r1.modo, r1.lidasNoServidor, ids(r1)], ['completa', 4, 'jan,jun,out,set']);

  log.length = 0;
  const r2 = await ler({ hoje: '2026-10-06' });
  conferir('faixa: no dia seguinte, so os recentes pagam leitura; servidor ANTES do cache',
    [r2.modo, r2.lidasNoServidor, ids(r2), log], ['parcial', 2, 'jan,jun,out,set', ['servidor:2', 'cache:2']]);

  // "jun" foi prorrogado para outubro em outra maquina: chega pelo
  // servidor e NAO pode aparecer duas vezes nem com a data velha.
  servidor[1] = { id: 'jun', dados: { vencimento: '2026-10-20', valor: 1 } };
  const r3 = await ler({ hoje: '2026-10-06' });
  conferir('faixa: documento que mudou de data entra uma vez so, com a data nova',
    [ids(r3), r3.docs.find(d => d.id === 'jun').data().vencimento, r3.lidasNoServidor], ['jan,jun,out,set', '2026-10-20', 3]);

  const r4 = await ler({ hoje: '2026-10-12' });
  conferir('faixa: depois de 7 dias, completa', [r4.modo, r4.motivo], ['completa', 'renovação a cada 7 dias']);
  const r5 = await ler({ hoje: '2026-10-13', forcar: true });
  conferir('faixa: recarga pedida = completa', [r5.modo, r5.motivo], ['completa', 'recarga pedida']);
  const r6 = await ler({ hoje: '2026-10-13', ini: '2025-01-01' });
  conferir('faixa: periodo diferente do guardado = completa', [r6.modo, ids(r6)], ['completa', 'antes,jan,jun,out,set']);

  cache.splice(cache.findIndex(x => x.id === 'jan'), 1);
  const r7 = await ler({ hoje: '2026-10-14', ini: '2025-01-01' });
  conferir('faixa: cache menor que o esperado = completa', [r7.modo, r7.motivo, ids(r7)], ['completa', 'cache do navegador incompleto', 'antes,jan,jun,out,set']);

  const semCache = await App.lerFaixaComCache({ col: firestoreFalso(servidor, null, log), campo: 'vencimento', ini: '2025-01-01',
    corte: '2026-08-06', chave: 'f', hoje: '2026-10-14', armazenamento: arm });
  conferir('faixa: erro ao ler o cache = completa', [semCache.modo, semCache.motivo], ['completa', 'cache do navegador indisponível']);
});

assincrono('lerFaixaComCache: faixa com fim; ano passado inteiro nao paga leitura nenhuma', async () => {
  const servidor = [
    { id: 'a', dados: { vencimento: '2025-03-10' } }, { id: 'b', dados: { vencimento: '2025-11-10' } },
    { id: 'c', dados: { vencimento: '2026-07-10' } } // depois do fim
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const o = { col: firestoreFalso(servidor, cache, log), campo: 'vencimento', ini: '2025-01-01', fim: '2026-06-30',
    corte: '2026-08-06', chave: 'p', hoje: '2026-10-05', armazenamento: arm };
  const r1 = await App.lerFaixaComCache(o);
  conferir('faixa com fim: a completa respeita o fim', ids(r1), 'a,b');
  log.length = 0;
  const r2 = await App.lerFaixaComCache(Object.assign({}, o, { hoje: '2026-10-06' }));
  conferir('faixa com fim antes do corte: tudo do cache, zero leitura no servidor',
    [r2.modo, r2.lidasNoServidor, ids(r2), log], ['parcial', 0, 'a,b', ['cache:2']]);
});

// --- carimbo de alteracao: escuta ao vivo so' do que mudou ---
//
// Firestore de mentira com escuta: `mudar`/`apagar` mexem no servidor e
// avisam quem esta' escutando. O log conta o que cada escuta recebeu do
// servidor (e' o que se paga) e o que foi lido do cache.
function firestoreVivo(servidor, cache, log) {
  const ouvintes = [];
  const valor = (v) => (v && v.toMillis ? v.toMillis() : v);
  const casa = (dados, filtros) => filtros.every(([c, op, v]) => {
    const a = valor(dados[c]), b = valor(v);
    if (op === '==') return a !== undefined && a === b;
    if (a == null) return false;
    return op === '>' ? a > b : op === '>=' ? a >= b : false;
  });
  const doc = (x) => ({ id: x.id, data: () => Object.assign({}, x.dados), get: (c) => x.dados[c] });
  function entregar(o) {
    if (!o.ativo) return;
    const agora = servidor.filter(x => casa(x.dados, o.filtros));
    const ids = new Set(agora.map(x => x.id));
    const mud = [];
    agora.forEach(x => {
      const antes = o.vistos.get(x.id);
      if (antes !== x.dados) mud.push({ type: antes ? 'modified' : 'added', doc: doc(x) });
      o.vistos.set(x.id, x.dados);
    });
    Array.from(o.vistos.keys()).forEach(id => {
      if (!ids.has(id)) { mud.push({ type: 'removed', doc: { id, data: () => ({}), get: () => undefined } }); o.vistos.delete(id); }
    });
    const pagos = mud.filter(m => m.type !== 'removed').length;
    if (pagos) log.push('servidor:' + pagos);
    if (cache) agora.forEach(x => {
      const i = cache.findIndex(y => y.id === x.id);
      if (i === -1) cache.push(x); else cache[i] = x;
    });
    o.ok({ metadata: { fromCache: false }, docChanges: () => mud, forEach: (fn) => agora.map(doc).forEach(fn) });
  }
  function consulta(filtros) {
    return {
      where(c, op, v) { return consulta(filtros.concat([[c, op, v]])); },
      get() {
        if (cache === null) return Promise.reject(new Error('sem cache'));
        const l = cache.filter(x => casa(x.dados, filtros));
        log.push('cache:' + l.length);
        return Promise.resolve({ size: l.length, forEach: (fn) => l.map(doc).forEach(fn) });
      },
      onSnapshot(opcoes, ok) {
        const o = { filtros, ok, vistos: new Map(), ativo: true };
        ouvintes.push(o);
        Promise.resolve().then(() => entregar(o));
        return () => { o.ativo = false; };
      }
    };
  }
  const avisar = () => ouvintes.forEach(entregar);
  return {
    col: consulta([]),
    mudar(id, dados) {
      const i = servidor.findIndex(x => x.id === id);
      if (i === -1) servidor.push({ id, dados }); else servidor[i] = { id, dados };
      avisar();
    },
    apagar(id) { servidor.splice(servidor.findIndex(x => x.id === id), 1); avisar(); },
    ativos: () => ouvintes.filter(o => o.ativo).length
  };
}
const respiro = () => new Promise(r => setImmediate(r));

assincrono('escutarComDelta: completa na primeira vez, depois so o que mudou — e ao vivo', async () => {
  // Janela: emissao >= 2026-01-01, mais as canceladas de qualquer epoca.
  const servidor = [
    { id: 'n1', dados: { dataEmissao: '2026-03-01', alteradoEm: carimbo(10 * HORA) } },
    { id: 'n0', dados: { dataEmissao: '2026-02-01' } },                                   // nunca carimbadas
    { id: 'n2', dados: { dataEmissao: '2026-05-01' } },
    { id: 'velha', dados: { dataEmissao: '2024-01-01', status: 'cancelada', alteradoEm: carimbo(20 * HORA) } },
    { id: 'fora', dados: { dataEmissao: '2024-02-02' } }
  ];
  const cache = [], log = [], arm = armazenamentoFalso();
  const fs1 = firestoreVivo(servidor, cache, log);
  const telas = [];
  const abrir = (fb, extra) => {
    const tela = { mapa: {}, eventos: [] };
    telas.push(tela);
    tela.escuta = App.escutarComDelta(Object.assign({
      consultas: [fb.col.where('dataEmissao', '>=', '2026-01-01'), fb.col.where('status', '==', 'cancelada')],
      delta: fb.col, campo: 'alteradoEm', chave: 'kn', hoje: '2026-10-06', versao: 0,
      armazenamento: arm, deMillis: carimbo,
      aceita: (n) => (n.dataEmissao || '') >= '2026-01-01' || n.status === 'cancelada',
      aoReceber: (mud, info) => {
        mud.forEach(m => { if (m.dados === null) delete tela.mapa[m.id]; else tela.mapa[m.id] = m.dados; });
        tela.eventos.push(info.modo + ':' + mud.map(m => m.id + (m.dados === null ? '-' : '')).sort().join(','));
      }
    }, extra));
    return tela;
  };
  const chaves = (t) => Object.keys(t.mapa).sort().join(',');

  const t1 = abrir(fs1);
  await respiro();
  conferir('carimbo: primeira vez e completa, a tela recebe a uniao de uma vez so',
    [t1.escuta.modo(), t1.eventos, chaves(t1)], ['completa', ['completa:n0,n1,n2,velha'], 'n0,n1,n2,velha']);
  conferir('carimbo: a completa paga as duas consultas inteiras', log, ['servidor:3', 'servidor:1']);
  conferir('carimbo: o controle guarda o dia, o total e o ultimo carimbo',
    JSON.parse(arm.m.kn), { dia: '2026-10-06', versao: 0, ultima: 20 * HORA, qtd: 4 });

  // Completa: nota cancelada que tambem esta' na janela sai de UMA consulta e fica na tela.
  fs1.mudar('n1', { dataEmissao: '2026-03-01', status: 'cancelada', alteradoEm: carimbo(21 * HORA) });
  fs1.mudar('n1', { dataEmissao: '2026-03-01', status: 'ativa', alteradoEm: carimbo(22 * HORA) });
  await respiro();
  conferir('carimbo: sair de uma consulta e continuar em outra nao tira da tela',
    [chaves(t1), t1.mapa.n1.status], ['n0,n1,n2,velha', 'ativa']);
  t1.escuta.parar();
  conferir('carimbo: parar cancela todas as escutas', fs1.ativos(), 0);

  // Segunda abertura no mesmo dia: base do cache, servidor so' com o carimbo novo.
  log.length = 0;
  const fs2 = firestoreVivo(servidor, cache, log);
  const t2 = abrir(fs2);
  await respiro();
  conferir('carimbo: segunda abertura le a base do cache e paga so o ultimo carimbo',
    [t2.escuta.modo(), log, chaves(t2)], ['delta', ['cache:3', 'cache:1', 'servidor:1'], 'n0,n1,n2,velha']);
  conferir('carimbo: uma escuta so no modo delta', fs2.ativos(), 1);

  // Ao vivo: nota nova do Apps Script, entrada no ERP, e nota que sai da uniao.
  log.length = 0;
  fs2.mudar('n3', { dataEmissao: '2026-10-06', emitida: true, alteradoEm: carimbo(30 * HORA) });
  await respiro();
  fs2.mudar('n2', { dataEmissao: '2026-05-01', noSistema: true, alteradoEm: carimbo(31 * HORA) });
  await respiro();
  fs2.mudar('velha', { dataEmissao: '2024-01-01', status: 'ativa', alteradoEm: carimbo(32 * HORA) });
  await respiro();
  conferir('carimbo: o que muda chega ao vivo, um documento por vez',
    [t2.eventos.slice(1), log, chaves(t2), t2.mapa.n2.noSistema],
    [['delta:n3', 'delta:n2', 'delta:velha-'], ['servidor:1', 'servidor:1', 'servidor:1'], 'n0,n1,n2,n3', true]);
  conferir('carimbo: o controle avanca com o que chegou', JSON.parse(arm.m.kn).ultima, 32 * HORA);

  // O limite conhecido: gravacao SEM carimbo nao chega no modo delta...
  fs2.mudar('n0', { dataEmissao: '2026-02-01', noSistema: true });
  fs2.mudar('fora', { dataEmissao: '2024-02-02', alteradoEm: carimbo(33 * HORA) }); // carimbada, mas fora da janela
  await respiro();
  conferir('carimbo: gravacao sem carimbo nao aparece no delta; a de fora da janela e ignorada',
    [t2.mapa.n0.noSistema, chaves(t2)], [undefined, 'n0,n1,n2,n3']);
  // ...apagar com a escuta aberta sai na hora (o documento tinha carimbo recente).
  fs2.apagar('n3');
  await respiro();
  conferir('carimbo: documento apagado sai da tela', chaves(t2), 'n0,n1,n2');
  t2.escuta.parar();

  // ...e a virada do dia relê tudo: a gravacao sem carimbo aparece.
  log.length = 0;
  const t3 = abrir(firestoreVivo(servidor, cache, log), { hoje: '2026-10-07' });
  await respiro();
  conferir('carimbo: no dia seguinte a leitura e completa e pega o que ficou sem carimbo',
    [t3.escuta.modo(), t3.eventos[0].slice(0, 8), t3.mapa.n0.noSistema], ['completa', 'completa', true]);
  t3.escuta.parar();

  // Exclusao avisada pelo contador, cache menor que o guardado, navegador sem cache.
  const t4 = abrir(firestoreVivo(servidor, cache, log), { hoje: '2026-10-07', versao: 1 });
  await respiro();
  conferir('carimbo: contador de exclusoes diferente = completa', t4.escuta.modo(), 'completa');
  t4.escuta.parar();
  const t5 = abrir(firestoreVivo(servidor, cache.slice(0, 1), log), { hoje: '2026-10-07', versao: 1 });
  await respiro();
  conferir('carimbo: cache menor que o guardado = completa', [t5.escuta.modo(), chaves(t5)], ['completa', 'n0,n1,n2']);
  t5.escuta.parar();
  const t6 = abrir(firestoreVivo(servidor, null, log), { hoje: '2026-10-07', versao: 1 });
  await respiro();
  conferir('carimbo: navegador sem cache = completa', [t6.escuta.modo(), chaves(t6)], ['completa', 'n0,n1,n2']);
  t6.escuta.parar();
  const t7 = abrir(firestoreVivo(servidor, cache, log), { hoje: '2026-10-07', versao: 1, armazenamento: null });
  await respiro();
  conferir('carimbo: sem localStorage, sempre completa', t7.escuta.modo(), 'completa');
  t7.escuta.parar();
});

assincrono('gravarCarimbado: grava com carimbo e se ajusta as regras que estiverem no ar', async () => {
  const negada = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  let regras = 'novas';          // 'antigas' recusam o campo; 'novas' exigem; 'fechadas' recusam tudo
  const tentativas = [];
  const gravar = () => App.gravarCarimbado((carimbar) => {
    const campos = carimbar({ pago: true });
    const com = 'alteradoEm' in campos;
    tentativas.push(com ? 'com' : 'sem');
    if (regras === 'fechadas' || (regras === 'antigas') === com) return Promise.reject(negada());
    return Promise.resolve(campos);
  });
  let recusas = 0;
  App.aoRecusarCarimbo(() => { recusas++; });

  const g1 = await gravar();
  conferir('carimbo na gravacao: vai com a hora do servidor', [tentativas, g1], [['com'], { pago: true, alteradoEm: 'ts' }]);

  tentativas.length = 0; regras = 'antigas';
  const g2 = await gravar();
  conferir('regras antigas recusam o campo: a gravacao e refeita sem ele', [tentativas, g2, recusas], [['com', 'sem'], { pago: true }, 1]);
  tentativas.length = 0;
  await gravar();
  conferir('  ...e a sessao passa a gravar sem, direto', tentativas, ['sem']);
  conferir('  ...com a leitura por carimbo respondendo "desligada" sem nem consultar',
    await App.lerSincNotas({ collection() { throw new Error('nao era para ler'); } }), null);

  tentativas.length = 0; regras = 'novas';
  await gravar();
  conferir('regras novas publicadas com o app aberto: volta a carimbar sozinho', [tentativas, recusas], [['sem', 'com'], 1]);
  tentativas.length = 0;
  await gravar();
  conferir('  ...e segue carimbando', tentativas, ['com']);

  tentativas.length = 0; regras = 'fechadas';
  const erro = await gravar().then(() => null, e => e.code);
  conferir('recusado dos dois jeitos: devolve o erro de permissao (quem chama pede o login)',
    [tentativas, erro], [['com', 'sem'], 'permission-denied']);
  tentativas.length = 0; regras = 'novas';
  await gravar();
  conferir('  ...sem mudar a preferencia da sessao', tentativas, ['com']);

  let chamadas = 0;
  const outro = await App.gravarCarimbado((carimbar) => { chamadas++; carimbar({}); return Promise.reject(new Error('rede')); })
    .then(() => null, e => e.message);
  conferir('erro que nao e de permissao nao repete a gravacao', [chamadas, outro], [1, 'rede']);
  chamadas = 0;
  await App.gravarCarimbado(() => { chamadas++; return Promise.reject(negada()); }).catch(() => {});
  conferir('lote sem nenhuma nota/duplicata nao e repetido', chamadas, 1);

  const banco = (dados, falha) => ({ collection: () => ({ doc: () => ({
    get: () => falha ? Promise.reject(new Error('offline')) : Promise.resolve({ exists: dados !== null, data: () => dados })
  }) }) });
  const erroOriginal = console.error; console.error = () => {};
  conferir('config/notasSync ligado devolve o contador de exclusoes',
    [await App.lerSincNotas(banco({ carimbo: true, exclusoes: 4 })), await App.lerSincNotas(banco({ carimbo: true }))],
    [{ exclusoes: 4 }, { exclusoes: 0 }]);
  conferir('config/notasSync desligado, ausente ou ilegivel = leitura de sempre',
    [await App.lerSincNotas(banco({ carimbo: false })), await App.lerSincNotas(banco(null)), await App.lerSincNotas(banco(null, true))],
    [null, null, null]);
  console.error = erroOriginal;
});

// --- itensQueFaltam: quais itens buscar um a um (NF-e Emitidas ao vivo) ---
(function () {
  const info = {
    A: { emitida: true, dataEmissao: '2026-10-01' },
    B: { emitida: true, dataEmissao: '2026-10-03' },
    C: { emitida: true, dataEmissao: '2026-10-02', tipo: 'nfse' },
    D: { emitida: false, dataEmissao: '2026-10-04' },
    E: { emitida: true, dataEmissao: '2026-05-01' },
    F: { emitida: true, dataEmissao: '2026-10-05', status: 'cancelada' }
  };
  const com = new Set(['A']);
  conferir('itensQueFaltam: so nota emitida, NF-e, na janela e sem itens — mais nova primeiro',
    App.itensQueFaltam(info, com, {}, { agora: 1000, corte: '2026-06-01' }), ['F', 'B']);
  conferir('itensQueFaltam: sem corte, a antiga tambem entra',
    App.itensQueFaltam(info, com, {}, { agora: 1000 }), ['F', 'B', 'E']);
  conferir('itensQueFaltam: o limite corta o que e antigo',
    App.itensQueFaltam(info, com, {}, { agora: 1000, limite: 1 }), ['F']);
  conferir('itensQueFaltam: chave ja buscada conta no limite da sessao',
    App.itensQueFaltam(info, com, { X: { n: 3, em: 0 } }, { agora: 1000, limite: 2 }), ['F']);
  conferir('itensQueFaltam: tentativa recente espera',
    App.itensQueFaltam(info, com, { B: { n: 1, em: 1000 } }, { agora: 2000, corte: '2026-06-01' }), ['F']);
  conferir('itensQueFaltam: passada a espera, tenta de novo',
    App.itensQueFaltam(info, com, { B: { n: 1, em: 1000 } }, { agora: 70000, corte: '2026-06-01' }), ['F', 'B']);
  conferir('itensQueFaltam: desiste depois de 3 tentativas',
    App.itensQueFaltam(info, com, { B: { n: 3, em: 0 } }, { agora: 9e9, corte: '2026-06-01' }), ['F']);
  conferir('itensQueFaltam: nada falta quando todas tem itens',
    App.itensQueFaltam(info, new Set(['A', 'B', 'E', 'F']), {}, { agora: 1 }), []);
})();

// E o confirmar nao pode voltar a aceitar inputDate por engano.
conferir('confirmar nao tem mais inputDate',
  /inputDate/.test(fs.readFileSync(path.resolve(__dirname, '..', 'app-shared.js'), 'utf8')), false);

// Modal que nunca resolve a promessa deixaria a fila parada e o
// processo sairia com 0: o codigo de saida comeca em 1 e so' vira 0
// quando o ultimo .then de fato rodou.
process.exitCode = 1;
pendentes
  .reduce((fila, t) => fila.then(t.executar).catch(e => {
    falhas++;
    console.log('  [X] ' + t.nome + ' — explodiu: ' + (e && e.message));
  }), Promise.resolve())
  .then(() => {
    console.log('  ' + ok + ' verificacoes passaram' + (falhas ? ', ' + falhas + ' falharam' : ''));
    if (falhas) { console.log('  >>> ' + falhas + ' FALHA(S)'); process.exitCode = 1; }
    else { console.log('  >>> tudo certo'); process.exitCode = 0; }
  });
