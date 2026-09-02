/*
  A tela de Pagamentos: categorias, recorrencia e o filtro de periodo.

  Duas coisas aqui nasceram de defeitos reais e nao podem voltar:

  1. Duplicata de fornecedor nao estava em CATEGORIAS, entao caia no
     ultimo item da lista e a aba "Todos" carimbava TODA nota como
     "Outros".
  2. A recorrencia parava de contar parcelas quando parcelaAtual vinha
     vazio: `undefined >= 12` e' falso, e a corrente nunca terminava.
*/
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'controle-notas.html'), 'utf8');

function extrair(nome){
  const i = html.indexOf('function ' + nome + '(');
  if(i === -1) throw new Error('nao achei ' + nome + ' em controle-notas.html');
  let d = 0, j = html.indexOf('{', i);
  for(; j < html.length; j++){
    if(html[j] === '{') d++;
    else if(html[j] === '}'){ d--; if(d === 0) break; }
  }
  return html.slice(i, j + 1);
}
function bloco(re, nome){
  const m = html.match(re);
  if(!m) throw new Error('nao achei ' + nome);
  return m[0];
}

const somarDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// calcularProximoVencimento virou involucro do App.somarMeses — o App
// de verdade entra na sandbox para o teste medir a conta real.
const App = require('../app-shared.js');

const estado = { filtroPag: 'pendentes' };
const m = new Function('estado', 'somarDias', 'App',
  'var filtroPag;\n' +
  bloco(/var CATEGORIAS = \[[\s\S]*?\n  \];/, 'CATEGORIAS') + '\n' +
  bloco(/var CAT_FORNECEDOR = \{[^}]*\};/, 'CAT_FORNECEDOR') + '\n' +
  extrair('categoriaPorValor') + '\n' +
  extrair('calcularProximoVencimento') + '\n' +
  extrair('janelaSemanaPagamento') + '\n' +
  extrair('passaFiltroPag') + '\n' +
  'return { CATEGORIAS: CATEGORIAS, CAT_FORNECEDOR: CAT_FORNECEDOR,' +
  ' categoriaPorValor: categoriaPorValor,' +
  ' calcularProximoVencimento: calcularProximoVencimento,' +
  ' passaFiltroPag: function(p, v, h, i){ filtroPag = estado.filtroPag; return passaFiltroPag(p, v, h, i); } };'
)(estado, somarDias, App);

let problemas = 0;
const ok = (t) => console.log('  [ok] ' + t);
const erro = (t) => { console.log('  [X] ' + t); problemas++; };
const eq = (t, a, b) => a === b ? ok(t) : erro(t + ' — esperava "' + b + '", veio "' + a + '"');

// ── Categorias ───────────────────────────────────────────────
eq('duplicata de fornecedor tem rotulo proprio',
  m.categoriaPorValor('fornecedor').rotulo, 'Fornecedor');
eq('e cor propria, nao a de "Outros"',
  m.categoriaPorValor('fornecedor').classe, 'cat-fornecedor');
// Se voltasse para CATEGORIAS, "Fornecedor" viraria opcao do <select>
// do formulario de pagamento interno — e nao e'.
eq('"Fornecedor" nao e escolhivel no formulario',
  m.CATEGORIAS.some(c => c.valor === 'fornecedor'), false);
eq('a classe existe no CSS', /\.badge\.cat-fornecedor\{/.test(html), true);

eq('categoria conhecida vem inteira', m.categoriaPorValor('folha').rotulo, 'Folha de Pagamento');
eq('categoria desconhecida cai em Outros', m.categoriaPorValor('zzz').rotulo, 'Outros');
eq('categoria vazia cai em Outros', m.categoriaPorValor(undefined).rotulo, 'Outros');
// Documentos gravados antes da revisao das categorias.
eq('valor antigo "impostos" migra', m.categoriaPorValor('impostos').rotulo, 'Imposto Mensal');
eq('valor antigo "emprestimo" migra', m.categoriaPorValor('emprestimo').rotulo, 'Empréstimos');

// Toda categoria tem uma classe de badge escrita no CSS: sem isso o
// rotulo aparece sem cor nenhuma e ninguem percebe.
const semCss = m.CATEGORIAS.filter(c => !new RegExp('\\.badge\\.' + c.classe + '\\{').test(html));
eq('toda categoria tem cor definida', semCss.map(c => c.valor).join(',') || 'nenhuma sem cor', 'nenhuma sem cor');

// ── Proximo vencimento da recorrencia ────────────────────────
const prox = (p) => m.calcularProximoVencimento(p);
eq('dia fixo no mes seguinte',
  prox({ vencimento:'2026-08-10', regra:'diaFixo', diaFixo:10 }), '2026-09-10');
eq('vira o ano em dezembro',
  prox({ vencimento:'2026-12-05', regra:'diaFixo', diaFixo:5 }), '2027-01-05');
// Dia 31 em mes de 30 nao pode virar 1o do mes seguinte.
eq('dia 31 encolhe para o ultimo dia do mes',
  prox({ vencimento:'2026-08-31', regra:'diaFixo', diaFixo:31 }), '2026-09-30');
eq('dia 30 encolhe em fevereiro',
  prox({ vencimento:'2027-01-30', regra:'diaFixo', diaFixo:30 }), '2027-02-28');
eq('ultimo dia do mes segue sendo o ultimo',
  prox({ vencimento:'2026-08-31', regra:'ultimoDia' }), '2026-09-30');
eq('ultimo dia em fevereiro bissexto',
  prox({ vencimento:'2028-01-31', regra:'ultimoDia' }), '2028-02-29');
// Sem diaFixo gravado, o dia sai da propria data.
eq('sem diaFixo usa o dia do vencimento',
  prox({ vencimento:'2026-08-07', regra:'diaFixo' }), '2026-09-07');

// ── Filtro de periodo ────────────────────────────────────────
// Roda antes de montar a linha; se errar, a tela some com item pago ou
// mostra item que nao devia.
const HOJE = '2026-08-03', INICIO = '2026-08-03';
function comFiltro(f, pago, venc){
  estado.filtroPag = f;
  return m.passaFiltroPag(pago, venc, HOJE, INICIO);
}
eq('pendentes: nao mostra pago', comFiltro('pendentes', true, '2026-08-10'), false);
eq('pendentes: mostra a vencer', comFiltro('pendentes', false, '2026-08-10'), true);
eq('atrasadas: ontem entra', comFiltro('atrasadas', false, '2026-08-02'), true);
eq('atrasadas: hoje nao esta atrasado', comFiltro('atrasadas', false, '2026-08-03'), false);
eq('atrasadas: pago nunca entra', comFiltro('atrasadas', true, '2026-07-01'), false);
eq('hoje: vence hoje', comFiltro('hoje', false, '2026-08-03'), true);
eq('hoje: amanha nao', comFiltro('hoje', false, '2026-08-04'), false);
// Semana de PAGAMENTO = sabado a sexta (paga-se de segunda a sexta; a
// segunda acumula o fim de semana). HOJE e' segunda 03/08/2026, entao
// a janela vai do sabado 01/08 ate a sexta 07/08 — inclusive os dias
// que JA' passaram: e' exatamente o que a segunda acumula.
eq('semana: sabado passado entra (a segunda acumula o fim de semana)',
  comFiltro('semana', false, '2026-08-01'), true);
eq('semana: hoje entra', comFiltro('semana', false, '2026-08-03'), true);
eq('semana: a sexta desta semana entra', comFiltro('semana', false, '2026-08-07'), true);
eq('semana: o sabado SEGUINTE fica fora', comFiltro('semana', false, '2026-08-08'), false);
eq('semana: semana anterior fica fora (é caso de Atrasadas)',
  comFiltro('semana', false, '2026-07-31'), false);
eq('semana: pago nao entra', comFiltro('semana', true, '2026-08-05'), false);
// No proprio sabado, o "ultimo sabado" e' o dia mesmo.
{
  estado.filtroPag = 'semana';
  eq('semana começando no proprio sabado: a sexta dali entra',
    m.passaFiltroPag(false, '2026-08-07', '2026-08-01', '2026-08-01'), true);
  eq('  ...e a sexta anterior nao',
    m.passaFiltroPag(false, '2026-07-31', '2026-08-01', '2026-08-01'), false);
}
eq('pagas: so as pagas', comFiltro('pagas', true, '2026-07-01'), true);
eq('pagas: pendente fica de fora', comFiltro('pagas', false, '2026-07-01'), false);
eq('todas: deixa tudo passar', comFiltro('todas', true, '2026-01-01'), true);
eq('todas: inclusive sem vencimento', comFiltro('todas', false, null), true);

// ── carregarContabil devolve Promise no primeiro uso ─────────
// O bug de 02/09/2026: a funcao montava a promessa em
// carregandoContabil mas nao a DEVOLVIA — o primeiro clique em pagar
// recebia undefined e morria no .then, derrubando a tela.
{
  const fonte = extrair('carregarContabil');
  const resultado = new Function('App', 'db',
    'var cadContabil = null, carregandoContabil = null;\n' + fonte +
    '\nreturn carregarContabil();')(
    { comAuth: () => Promise.resolve([{ forEach(){} }, { forEach(){} }, { exists: false }]) },
    null);
  eq('carregarContabil devolve uma Promise no PRIMEIRO uso',
    typeof (resultado && resultado.then), 'function');
}

// ── Guardas de estrutura ─────────────────────────────────────
// Prorrogar tem que usar pedirData. Com confirmar (que promete um
// booleano) a data escolhida virava `false` e o botao nao fazia nada.
eq('prorrogar usa App.pedirData', /App\.pedirData\(\{/.test(html), true);
eq('e nao sobrou inputDate na pagina', /inputDate/.test(html), false);

// "Nenhum item nesse filtro" e' uma afirmacao: nao pode aparecer
// enquanto as colecoes ainda estao chegando.
eq('renderPagamentos espera as tres colecoes (incluindo as notas)',
  /if\(!carregouDuplicatas \|\| !carregouPgtosInternos \|\| !carregouNotas\)\{\s*\$\('tabelaPag'\)/.test(html), true);

// A recorrencia sai do documento, nao da linha da tabela — e o
// documento e' capturado ANTES da gravacao (docsRecorrentes): pago, o
// interno fora da janela some das escutas e a corrente morreria.
eq('recorrencia em lote parte do documento capturado antes',
  /docsRecorrentes\[id\] = pgtoInternoPorId\(id\);/.test(html) &&
  /var doc = docsRecorrentes\[id\];/.test(html), true);

// Selecao em massa por indice, nao por varredura.
eq('a selecao usa o indice por id', /pagPorId\.get\(id\)/.test(html), true);
// A lista solta que as acoes varriam nao existe mais.
eq('nao sobrou a lista varrida por .find', /ultimaListaPag/.test(html), false);

// ── Janela de carga dos pagamentos internos ──────────────────
// Cada recorrente cria um documento por mes: sem corte, a colecao so'
// cresce e toda abertura do app paga por ela inteira.
eq('pagamentos internos respeitam MESES_HISTORICO',
  /colPgto\s*\n?\s*\.where\('vencimento', '>=', cortePorMeses\(MESES_HISTORICO\)\)/.test(html), true);
// Mas o que esta' EM ABERTO vem de qualquer epoca — some justamente o
// que importa. Mesmo principio das notas canceladas.
eq('o que esta em aberto vem de qualquer epoca',
  /colPgto\s*\n?\s*\.where\('pago', '==', false\)/.test(html), true);
// O botao "carregar historico completo" tem que valer para eles tambem.
eq('historico completo tambem traz os pagamentos internos',
  /if\(carregarTudo\)\{\s*\n\s*assinaturas\.push\(colPgto\.onSnapshot\(/.test(html), true);
// Duas consultas, dois mapas, unidos por id: sem isso o pendente que
// cai nas duas apareceria duplicado na tela.
eq('as duas consultas se unem por id, sem duplicar',
  /\[mapaPgtoJanela, mapaPgtoEmAberto\]\.forEach/.test(html), true);
// E nao pode voltar a ser uma escuta unica na colecao inteira.
eq('nao ha mais escuta na colecao inteira',
  /db\.collection\('pagamentosInternos'\)\.onSnapshot/.test(html), false);

// O filtro por `pago` so' funciona se o campo existir SEMPRE. Todo
// caminho que grava um pagamento interno tem que defini-lo.
const gravaPagoFalse = (html.match(/pago: false,/g) || []).length;
eq('todo pagamento nasce com pago definido', gravaPagoFalse >= 2, true);
// E a edicao nao pode reescrever o campo: quem edita um pagamento ja'
// pago nao o torna pendente de novo.
eq('editar nao mexe em pago', /delete dados\.pago;/.test(html), true);

console.log(problemas ? '  >>> ' + problemas + ' PROBLEMA(S)' : '  >>> tudo certo');
process.exitCode = problemas ? 1 : 0;
