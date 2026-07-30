/* ============================================================
   app-shared.js — nucleo comum aos dois aplicativos
   (Calculadora de Custo e Controle de Notas).

   Antes cada HTML tinha sua propria copia de escapeHtml, debounce,
   formatacao de moeda/data e da config do Firebase. Corrigir um bug
   em um arquivo e esquecer o outro era so' questao de tempo.

   Carregue com <script src="app-shared.js"></script> ANTES do script
   da pagina. Nao usa modulos ES, entao funciona tambem em file://.

   O rodape tambem exporta para require(), sem prejuizo do navegador:
   e' assim que os testes e o calculo-nucleo.js usam o arredondamento
   de centavos de verdade, em vez de uma copia escrita a parte.
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     1. Configuracao
     ============================================================ */

  // A apiKey de um app web do Firebase e' publica por design — ela
  // identifica o projeto, nao autoriza nada. Quem autoriza sao as
  // regras do Firestore (veja firestore.rules) + o login abaixo.
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCYZmYORbmVpgN0rNDsdCwN0Xm2Ce1SRyU',
    authDomain: 'bd-calculadora-d2ce0.firebaseapp.com',
    projectId: 'bd-calculadora-d2ce0',
    storageBucket: 'bd-calculadora-d2ce0.firebasestorage.app',
    messagingSenderId: '543548220495',
    appId: '1:543548220495:web:b3559aff504028b3ad363a'
  };

  var DEBOUNCE_BUSCA = 250;

  /* ============================================================
     2. Helpers de DOM e texto
     ============================================================ */

  function $(id) { return document.getElementById(id); }

  var MAPA_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return MAPA_ESCAPE[c]; });
  }

  // Toda URL que vai parar num href precisa passar por aqui.
  // O escapeHtml impede quebrar o atributo, mas nao impede
  // "javascript:..." — e boa parte das URLs desta aplicacao vem de
  // texto que o Gemini leu de paginas da web, ou seja, de fora.
  function safeUrl(u) {
    if (!u) return '';
    try {
      var p = new URL(String(u), global.location.href);
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    } catch (e) {
      return '';
    }
  }

  // Minusculas + sem acento, para busca tolerante.
  function normalizarTexto(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // remove os acentos separados pelo NFD
  }

  function norm(s) { return String(s == null ? '' : s).toLowerCase(); }

  /* ============================================================
     3. Numeros, moeda e datas
     ============================================================ */

  function toNum(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  // Dinheiro em float acumula erro de fracao de centavo. Arredondar
  // nos pontos em que o valor vira "resultado" mantem os totais
  // batendo com a soma das partes exibidas.
  //
  // Arredonda meio centavo SEMPRE para longe do zero (2,345 -> 2,35 e
  // -2,345 -> -2,35). O Math.round puro empurra o meio para cima nos
  // dois sinais, o que trataria prejuizo e lucro com criterios
  // diferentes — e aqui ha' valores negativos de verdade (lucro
  // negativo, diferenca de preco para menos).
  function centavos(v) {
    if (v == null || !isFinite(v)) return v;
    var sinal = v < 0 ? -1 : 1;
    return sinal * Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100;
  }

  function brl(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '--';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function pct(v, casas) {
    if (v == null || !isFinite(v)) return '--';
    var c = casas == null ? 2 : casas;
    return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
  }

  function num(v, casas) {
    if (v == null || !isFinite(v)) return '0';
    var o = {};
    if (casas != null) { o.minimumFractionDigits = casas; o.maximumFractionDigits = casas; }
    return Number(v).toLocaleString('pt-BR', o);
  }

  // Aceita "1.234,56", "1234.56", "R$ 99,90" e devolve numero ou null.
  function parseNumeroBR(v) {
    if (v === '' || v == null) return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim().replace(/^R\$\s*/i, '').trim();
    if (s === '') return null;
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function iso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function hojeISO() { return iso(new Date()); }

  // aaaa-mm-dd -> dd/mm/aaaa
  function fmtData(v) {
    if (!v) return '--';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(v);
  }

  // Meio-dia evita que fuso horario empurre a data para o dia anterior.
  function somarDias(isoStr, n) {
    var d = new Date(isoStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  function diasEntre(a, b) {
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  }

  function fmtDataFirestore(ts) {
    try {
      var d = (ts && ts.toDate) ? ts.toDate() : new Date(ts);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('pt-BR');
    } catch (e) { return '-'; }
  }

  function horaAgora() { return new Date().toLocaleTimeString('pt-BR'); }

  /* ============================================================
     4. Eventos
     ============================================================ */

  // Agrupa disparos rapidos (digitacao) numa unica execucao.
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms == null ? DEBOUNCE_BUSCA : ms);
    };
  }

  // Delegacao de evento: registre UMA vez no container, e vale para
  // todo elemento que casar com o seletor, inclusive os que ainda nem
  // existem. Substitui o padrao "innerHTML + querySelectorAll +
  // addEventListener em cada render", que reanexava centenas de
  // listeners a cada redesenho.
  function delegar(container, evento, seletor, handler) {
    if (!container) return;
    container.addEventListener(evento, function (ev) {
      var alvo = ev.target.closest ? ev.target.closest(seletor) : null;
      if (alvo && container.contains(alvo)) handler(alvo, ev);
    });
  }

  // (Havia aqui um delegarTeclado, para cabecalho que abre/fecha
  // responder a Enter e Espaco quando nao era um <button> de verdade.
  // Os cabecalhos viraram <button>, o navegador passou a cuidar disso
  // sozinho, e a funcao ficou sem nenhum chamador.)

  // Menu de telas do mobile. No desktop o CSS mantem a nav sempre
  // visivel e o botao escondido, entao isto so' tem efeito abaixo de
  // 880px — nao ha' nada a desligar quando a janela cresce.
  function montarMenu(idBotao, idNav) {
    var botao = $(idBotao), nav = $(idNav);
    if (!botao || !nav) return;

    function fechar() {
      nav.classList.remove('aberto');
      botao.setAttribute('aria-expanded', 'false');
    }

    botao.addEventListener('click', function () {
      var abrindo = !nav.classList.contains('aberto');
      nav.classList.toggle('aberto', abrindo);
      botao.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
    });

    // Escolher uma tela fecha o menu — senao ele cobriria justamente o
    // conteudo que a pessoa acabou de pedir. O <a> para o outro app
    // troca de pagina, entao nao precisa de tratamento.
    nav.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('button')) fechar();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && nav.classList.contains('aberto')) {
        fechar();
        botao.focus();
      }
    });
  }

  /* ============================================================
     5. Avisos e confirmacoes (substituem alert/confirm)
     ============================================================ */

  function areaToast() {
    var el = $('toastArea');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toastArea';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  // tipo: 'ok' | 'erro' | 'info'
  function toast(mensagem, tipo, segundos) {
    var area = areaToast();
    var el = document.createElement('div');
    el.className = 'toast ' + (tipo || 'info');

    var msg = document.createElement('div');
    msg.className = 'toast-msg';
    msg.textContent = String(mensagem);

    var fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'toast-fechar';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.textContent = '✕';

    function sair() { if (el.parentNode) el.parentNode.removeChild(el); }
    fechar.addEventListener('click', sair);

    el.appendChild(msg);
    el.appendChild(fechar);
    area.appendChild(el);

    // Erro fica ate' o usuario fechar; o resto some sozinho.
    var espera = segundos != null ? segundos : (tipo === 'erro' ? 0 : 5);
    if (espera > 0) setTimeout(sair, espera * 1000);
    return el;
  }

  function erroDe(e) {
    if (!e) return 'erro desconhecido';
    return e.message || String(e);
  }

  function toastErro(prefixo, e) {
    console.error(prefixo, e);
    return toast(prefixo + ': ' + erroDe(e), 'erro');
  }

  // Modal generico. Devolve uma Promise com o valor passado a resolver().
  // opcoes.obrigatorio = true: nao fecha com Esc nem clicando no fundo
  // (usado no login de entrada, que nao pode ser dispensado).
  function abrirModal(construir, opcoes) {
    var op = opcoes || {};
    return new Promise(function (resolve) {
      var focoAnterior = document.activeElement;
      var fundo = document.createElement('div');
      fundo.className = 'modal-fundo';

      var caixa = document.createElement('div');
      caixa.className = 'modal-caixa';
      caixa.setAttribute('role', 'dialog');
      caixa.setAttribute('aria-modal', 'true');

      var fechado = false;
      function fechar(valor) {
        if (fechado) return;
        fechado = true;
        document.removeEventListener('keydown', aoTeclar, true);
        if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
        if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
        resolve(valor);
      }

      function aoTeclar(ev) {
        if (ev.key === 'Escape' && !op.obrigatorio) { ev.preventDefault(); fechar(null); return; }
        if (ev.key !== 'Tab') return;
        // Prende o Tab dentro do modal.
        var focaveis = caixa.querySelectorAll('button, input, select, textarea, a[href]');
        if (!focaveis.length) return;
        var primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
        if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
      }

      if (!op.obrigatorio) {
        fundo.addEventListener('mousedown', function (ev) { if (ev.target === fundo) fechar(null); });
      }
      document.addEventListener('keydown', aoTeclar, true);

      construir(caixa, fechar);
      fundo.appendChild(caixa);
      document.body.appendChild(fundo);

      var primeiroFoco = caixa.querySelector('input, button');
      if (primeiroFoco) primeiroFoco.focus();
    });
  }

  // Substitui confirm(). opcoes: {titulo, mensagem, confirmar, cancelar, perigo}
  function confirmar(opcoes) {
    var o = opcoes || {};
    return abrirModal(function (caixa, fechar) {
      var h = document.createElement('h2');
      h.textContent = o.titulo || 'Confirmar';
      var p = document.createElement('p');
      p.textContent = o.mensagem || '';
      var acoes = document.createElement('div');
      acoes.className = 'modal-acoes';

      var cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'btn secondary';
      cancelar.textContent = o.cancelar || 'Cancelar';
      cancelar.addEventListener('click', function () { fechar(false); });

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn' + (o.perigo ? ' perigo' : '');
      ok.textContent = o.confirmar || 'Confirmar';
      ok.addEventListener('click', function () { fechar(true); });

      acoes.appendChild(cancelar);
      acoes.appendChild(ok);
      caixa.appendChild(h);
      caixa.appendChild(p);
      caixa.appendChild(acoes);
      caixa.setAttribute('aria-label', o.titulo || 'Confirmar');
      // Foco comeca no Cancelar: acao destrutiva nao deve sair no Enter reflexo.
      setTimeout(function () { cancelar.focus(); }, 0);
    }).then(function (v) { return v === true; });
  }

  // Substitui alert().
  function avisar(mensagem, titulo) {
    return abrirModal(function (caixa, fechar) {
      var h = document.createElement('h2');
      h.textContent = titulo || 'Aviso';
      var p = document.createElement('p');
      p.textContent = String(mensagem);
      var acoes = document.createElement('div');
      acoes.className = 'modal-acoes';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn';
      ok.textContent = 'Entendi';
      ok.addEventListener('click', function () { fechar(true); });
      acoes.appendChild(ok);
      caixa.appendChild(h);
      caixa.appendChild(p);
      caixa.appendChild(acoes);
      caixa.setAttribute('aria-label', titulo || 'Aviso');
    });
  }

  /* ============================================================
     6. Autenticacao
     ============================================================

     Login obrigatorio na entrada: sem usuario e senha o app nao
     mostra dado nenhum. Alem disso, toda operacao no Firestore passa
     por comAuth(), que reabre o login se a sessao expirar no meio do
     trabalho.

     "Manter conectado" usa a persistencia LOCAL do Firebase: o
     computador do escritorio entra uma vez e continua entrando
     sozinho, ate' alguem clicar em Sair. Desmarcado, a sessao morre
     ao fechar o navegador — util em maquina compartilhada.
  */

  // O Firebase exige formato de e-mail, mas ninguem precisa digitar
  // dominio: "administrativo" vira "administrativo@calculadora.local"
  // aqui dentro. Para usar o dominio real da empresa, troque a
  // constante — e cadastre os usuarios no Console com o mesmo dominio.
  var DOMINIO_LOGIN = 'calculadora.local';
  var CHAVE_MANTER = 'app_manter_conectado';

  function usuarioParaEmail(entrada) {
    var s = String(entrada == null ? '' : entrada).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return '';
    return s.indexOf('@') === -1 ? (s + '@' + DOMINIO_LOGIN) : s;
  }

  // Caminho inverso, para exibir "administrativo" e nao o e-mail inteiro.
  function emailParaUsuario(email) {
    var s = String(email == null ? '' : email);
    var sufixo = '@' + DOMINIO_LOGIN;
    return s.slice(-sufixo.length) === sufixo ? s.slice(0, -sufixo.length) : s;
  }

  function manterConectado() {
    try { return localStorage.getItem(CHAVE_MANTER) !== '0'; } // padrao: sim
    catch (e) { return true; }
  }
  function setManterConectado(v) {
    // Engolir e' de proposito: e' preferencia de maquina, nao dado. Se
    // localStorage nao estiver disponivel (aba anonima, cota estourada),
    // a caixa de login volta marcada no proximo acesso — incomodo
    // pequeno, longe de justificar interromper o login por causa disso.
    try { localStorage.setItem(CHAVE_MANTER, v ? '1' : '0'); } catch (e) {}
  }

  var _auth = null;
  var _usuario = null;
  var _loginEmAndamento = null;
  var _ouvintesUsuario = [];
  var _authPronto = null;

  function ehPermissaoNegada(e) {
    if (!e) return false;
    var c = e.code || '';
    return c === 'permission-denied' ||
      c === 'firestore/permission-denied' ||
      c === 'unauthenticated' ||
      /missing or insufficient permissions/i.test(e.message || '');
  }

  function iniciarAuth(app) {
    if (!app || typeof app.auth !== 'function') return null; // SDK de auth nao carregado
    _auth = app.auth();

    // Resolve na PRIMEIRA notificacao, que e' quando o Firebase termina
    // de restaurar (ou nao) a sessao salva neste computador. Sem esperar
    // por ela, o app acharia que ninguem esta' logado e pediria senha a
    // cada F5, mesmo com "manter conectado" marcado.
    _authPronto = new Promise(function (resolve) {
      var primeira = true;
      _auth.onAuthStateChanged(function (u) {
        _usuario = u;
        _ouvintesUsuario.forEach(function (fn) {
          try { fn(u); } catch (e) { console.error('ouvinte de auth:', e); }
        });
        if (primeira) { primeira = false; resolve(u); }
      });
    });
    return _auth;
  }

  function usuario() { return _usuario; }

  // Espera o Firebase decidir se ha' sessao salva.
  function authPronto() {
    return _authPronto || Promise.resolve(null);
  }

  // Porta de entrada: garante que ha' alguem logado antes de o app
  // mostrar qualquer dado. Se ja' havia sessao salva, passa direto.
  function exigirLogin(motivo) {
    if (!_auth) {
      return Promise.reject(new Error(
        'Este app precisa de login, mas o SDK de autenticacao do Firebase nao carregou.'
      ));
    }
    return authPronto().then(function (u) {
      if (u) return u;
      return pedirLogin(motivo || 'Entre com seu usuário para acessar o sistema.', true);
    });
  }

  function aoMudarUsuario(fn) {
    _ouvintesUsuario.push(fn);
    // Mesmo tratamento do disparo em iniciarAuth: um ouvinte que estoura
    // nao pode derrubar quem chamou, mas tambem nao pode sumir sem deixar
    // rastro no console.
    if (_usuario !== undefined) {
      try { fn(_usuario); } catch (e) { console.error('ouvinte de auth:', e); }
    }
  }

  // Abre a caixa de login. Chamadas simultaneas compartilham a mesma
  // caixa, em vez de empilhar cinco modais quando cinco consultas
  // falham juntas.
  function pedirLogin(motivo, obrigatorio) {
    if (_loginEmAndamento) return _loginEmAndamento;
    if (!_auth) {
      return Promise.reject(new Error(
        'Este app precisa de login, mas o SDK de autenticacao do Firebase nao carregou.'
      ));
    }

    _loginEmAndamento = abrirModal(function (caixa, fechar) {
      var h = document.createElement('h2');
      h.textContent = 'Entrar';
      caixa.setAttribute('aria-label', 'Entrar');

      var p = document.createElement('p');
      p.textContent = motivo || 'Entre com seu usuário para acessar os dados da empresa.';

      var form = document.createElement('form');
      form.noValidate = true;

      function campo(id, rotulo, tipo, autocomplete, dica) {
        var wrap = document.createElement('div');
        wrap.className = 'field';
        var lab = document.createElement('label');
        lab.setAttribute('for', id);
        lab.textContent = rotulo;
        if (dica) {
          var span = document.createElement('span');
          span.className = 'hint';
          span.textContent = dica;
          lab.appendChild(span);
        }
        var linha = document.createElement('div');
        linha.className = 'input-row';
        var inp = document.createElement('input');
        inp.type = tipo;
        inp.id = id;
        inp.autocomplete = autocomplete;
        inp.required = true;
        linha.appendChild(inp);
        wrap.appendChild(lab);
        wrap.appendChild(linha);
        form.appendChild(wrap);
        return inp;
      }

      // type=text, e nao email: senao o navegador recusaria "administrativo"
      // por nao ter arroba — e o dominio quem poe e' o app.
      var user = campo('authUsuario', 'Usuário', 'text', 'username', 'ex: administrativo');
      var senha = campo('authSenha', 'Senha', 'password', 'current-password');

      // Manter conectado
      var wrapLembrar = document.createElement('label');
      wrapLembrar.style.cssText =
        'display:flex; align-items:center; gap:8px; font-size:13px; margin:2px 0 0; cursor:pointer;';
      var lembrar = document.createElement('input');
      lembrar.type = 'checkbox';
      lembrar.id = 'authLembrar';
      lembrar.checked = manterConectado();
      lembrar.style.cssText = 'width:16px; height:16px; cursor:pointer; accent-color:var(--brick);';
      wrapLembrar.appendChild(lembrar);
      wrapLembrar.appendChild(document.createTextNode('Manter conectado neste computador'));
      form.appendChild(wrapLembrar);

      var msg = document.createElement('div');
      msg.className = 'empty-note';
      msg.style.display = 'block';
      msg.style.margin = '8px 0 0';
      msg.setAttribute('role', 'alert');

      var acoes = document.createElement('div');
      acoes.className = 'modal-acoes';
      acoes.style.marginTop = '14px';

      var entrar = document.createElement('button');
      entrar.type = 'submit';
      entrar.className = 'btn';
      entrar.textContent = 'Entrar';
      acoes.appendChild(entrar);

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = usuarioParaEmail(user.value), s = senha.value;
        if (!email || !s) {
          msg.textContent = 'Preencha usuário e senha.';
          msg.style.color = 'var(--loss)';
          return;
        }
        entrar.disabled = true;
        msg.style.color = 'var(--ink-soft)';
        msg.textContent = 'Entrando...';

        setManterConectado(lembrar.checked);
        // LOCAL sobrevive a fechar o navegador; SESSION morre junto com a aba.
        var modo = lembrar.checked
          ? global.firebase.auth.Auth.Persistence.LOCAL
          : global.firebase.auth.Auth.Persistence.SESSION;

        _auth.setPersistence(modo)
          .then(function () { return _auth.signInWithEmailAndPassword(email, s); })
          .then(function (cred) { fechar(cred.user); })
          .catch(function (err) {
            entrar.disabled = false;
            msg.style.color = 'var(--loss)';
            msg.textContent = mensagemErroAuth(err);
            senha.value = '';
            senha.focus();
          });
      });

      form.appendChild(msg);
      form.appendChild(acoes);
      caixa.appendChild(h);
      caixa.appendChild(p);
      caixa.appendChild(form);
    }, { obrigatorio: !!obrigatorio }).then(function (u) {
      _loginEmAndamento = null;
      if (!u) throw new Error('Login cancelado.');
      _usuario = u;
      return u;
    }, function (e) {
      _loginEmAndamento = null;
      throw e;
    });

    return _loginEmAndamento;
  }

  function mensagemErroAuth(err) {
    var c = (err && err.code) || '';
    if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' ||
        c === 'auth/user-not-found' || c === 'auth/invalid-email') {
      return 'Usuário ou senha incorretos.';
    }
    if (c === 'auth/too-many-requests') return 'Muitas tentativas. Aguarde alguns minutos.';
    if (c === 'auth/network-request-failed') return 'Sem conexão com a internet.';
    if (c === 'auth/user-disabled') return 'Este usuário foi desativado.';
    if (c === 'auth/operation-not-allowed') {
      return 'Login por e-mail/senha ainda não foi ativado no Firebase Console ' +
             '(Authentication > Sign-in method).';
    }
    return erroDe(err);
  }

  function sair() {
    if (!_auth) return Promise.resolve();
    return _auth.signOut();
  }

  // Envolve qualquer operacao no Firestore. Se cair por permissao,
  // pede o login e tenta UMA vez mais.
  function comAuth(operacao) {
    return Promise.resolve().then(operacao).catch(function (e) {
      if (!ehPermissaoNegada(e)) throw e;
      return pedirLogin('Sua sessao expirou ou estes dados exigem login.').then(function () {
        return operacao();
      });
    });
  }

  /* ============================================================
     7. Firebase
     ============================================================ */

  // Inicializa (ou reinicializa) um app nomeado do Firebase.
  // Aguarda o delete do app anterior — sem o await, o initializeApp
  // seguinte podia esbarrar num app com o mesmo nome ainda vivo.
  function iniciarFirebase(nomeApp, config) {
    if (typeof global.firebase === 'undefined') {
      return Promise.reject(new Error('SDK do Firebase nao carregou (sem internet?)'));
    }
    var existente = null;
    try {
      existente = global.firebase.apps.filter(function (a) { return a.name === nomeApp; })[0] || null;
    } catch (e) { /* apps ainda nao inicializado */ }

    return Promise.resolve(existente ? existente.delete() : null).then(function () {
      var app = global.firebase.initializeApp(config || FIREBASE_CONFIG, nomeApp);
      var db = app.firestore();
      iniciarAuth(app);
      // Cache local: a segunda visita abre instantaneamente e o app
      // continua util sem internet. Falha de proposito quando ha' outra
      // aba aberta com persistencia — nao e' erro, so' seguir sem cache.
      return Promise.resolve()
        .then(function () { return db.enablePersistence({ synchronizeTabs: true }); })
        .catch(function (e) {
          if (e && e.code !== 'failed-precondition' && e.code !== 'unimplemented') {
            console.warn('Cache local indisponivel:', e);
          }
        })
        .then(function () { return { app: app, db: db }; });
    });
  }

  /* ============================================================
     8. Roteador por hash
     ============================================================

     Antes a navegacao era um monte de style.display na mao e nao dava
     para recarregar a pagina na mesma tela, nem mandar um link para
     alguem "ja' aberto em Pagamentos".
  */

  function criarRouter(config) {
    var views = config.views;                       // { Painel: 'viewPainel', ... }
    var padrao = config.padrao;
    var aoEntrar = config.aoEntrar || {};
    var naoRestauraveis = config.naoRestauraveis || []; // telas que dependem de contexto
    var nomes = Object.keys(views);
    var atual = null;

    function existe(nome) { return Object.prototype.hasOwnProperty.call(views, nome); }

    function aplicar(nome) {
      nomes.forEach(function (n) {
        var el = $(views[n]);
        if (el) el.style.display = (n === nome) ? 'block' : 'none';
      });
      atual = nome;
      if (config.aoTrocar) config.aoTrocar(nome);
      var fn = aoEntrar[nome];
      if (fn) fn();
    }

    function ir(nome, opcoes) {
      var o = opcoes || {};
      if (!existe(nome)) nome = padrao;
      if (nome === atual && !o.forcar) return;

      // Troca a tela AGORA e so' depois atualiza o endereco. Delegar a
      // troca ao evento hashchange nao funciona: ele e' assincrono, e a
      // tela ficava sem mudar no mesmo instante do clique.
      aplicar(nome);

      var alvoHash = '#' + nome;
      if (global.location.hash !== alvoHash) global.location.hash = nome;
      // O hashchange que isso dispara cai no guarda "nome === atual"
      // do ouvinte abaixo e nao faz nada — o estado ja' esta' certo.

      if (!o.semRolar) global.scrollTo(0, 0);
    }

    global.addEventListener('hashchange', function () {
      var bruto = decodeURIComponent(global.location.hash.slice(1));

      // Navegacao feita pelo proprio app: ir() ja' aplicou a tela e so'
      // depois mexeu no endereco. Sem esta saida antecipada, as telas de
      // "naoRestauraveis" eram jogadas de volta para a tela padrao logo
      // apos abrir — era o que fazia a pesquisa em lote e a comparacao
      // com NF-e pularem sozinhas para a Calculadora.
      if (bruto === atual) return;

      // Daqui para baixo e' navegacao de fora (Voltar/Avancar do
      // navegador, ou link colado): ai' sim vale o filtro das telas que
      // dependem de um registro selecionado.
      var nome = bruto;
      if (!existe(nome) || naoRestauraveis.indexOf(nome) !== -1) nome = padrao;
      if (nome === atual) return;
      aplicar(nome);
      global.scrollTo(0, 0);
    });

    function iniciar() {
      var nome = decodeURIComponent(global.location.hash.slice(1));
      // Telas que precisam de um registro selecionado nao podem ser
      // restauradas de um link; caem na tela padrao.
      if (!existe(nome) || naoRestauraveis.indexOf(nome) !== -1) nome = padrao;
      aplicar(nome);
    }

    return { ir: ir, iniciar: iniciar, atual: function () { return atual; } };
  }

  /* ============================================================
     9. Tabela de itens de NF-e (usada pelos dois apps)
     ============================================================ */

  // dados: { itens:[...], stTotal, valorProdutos }
  // opcoes: { comPisCofins: bool, larguraMinima: '900px' }
  function tabelaItensNota(dados, opcoes) {
    var o = opcoes || {};
    var itens = (dados && dados.itens) || [];
    if (!itens.length) {
      return '<p class="empty-note" style="display:block;">Esta nota nao tem itens detalhados.</p>';
    }

    var colunas = ['Cod. / Produto', 'NCM / CFOP', 'Qtd', 'V. Unit.', 'V. Total', 'ICMS', 'IPI'];
    if (o.comPisCofins) colunas.push('PIS+COFINS');

    var html = '<div class="tabela-rolavel"><table class="quote-table" style="min-width:' +
      (o.larguraMinima || '860px') + ';"><thead><tr>' +
      colunas.map(function (c) { return '<th scope="col">' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    itens.slice().sort(function (a, b) { return (a.n || 0) - (b.n || 0); }).forEach(function (it) {
      var icms = 'CST ' + escapeHtml(it.icmsCst || '-');
      if (it.icmsValor) icms += ' · ' + num(it.icmsAliq || 0) + '% · ' + brl(it.icmsValor);
      if (it.icmsStValor > 0) {
        var pctSt = (it.vTotal > 0) ? (it.icmsStValor / it.vTotal * 100) : 0;
        icms += '<br><span style="color:var(--brick); font-weight:600;">ST: ' + brl(it.icmsStValor) +
          ' · ' + num(pctSt, 2) + '%</span>';
      }
      var ipi = it.ipiValor ? (num(it.ipiAliq || 0) + '% · ' + brl(it.ipiValor)) : '—';

      html += '<tr>' +
        '<td><span style="font-family:var(--font-mono); font-size:10.5px; color:var(--ink-soft);">' +
        escapeHtml(it.codigo || '-') + '</span><br>' + escapeHtml(it.descricao || '-') + '</td>' +
        '<td style="font-size:11px;">' + escapeHtml(it.ncm || '-') + '<br>CFOP ' + escapeHtml(it.cfop || '-') + '</td>' +
        '<td>' + num(it.qtd || 0) + ' ' + escapeHtml(it.un || '') + '</td>' +
        '<td>' + brl(it.vUnit || 0) + '</td>' +
        '<td>' + brl(it.vTotal || 0) + '</td>' +
        '<td style="font-size:11px;">' + icms + '</td>' +
        '<td style="font-size:11px;">' + ipi + '</td>';
      if (o.comPisCofins) {
        var pc = (it.pisValor || it.cofinsValor)
          ? (num((it.pisAliq || 0) + (it.cofinsAliq || 0)) + '% · ' + brl((it.pisValor || 0) + (it.cofinsValor || 0)))
          : '—';
        html += '<td style="font-size:11px;">' + pc + '</td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    if ((dados.stTotal || 0) > 0) {
      var baseProd = dados.valorProdutos || itens.reduce(function (s, it) { return s + (it.vTotal || 0); }, 0);
      var pctStNota = baseProd > 0 ? (dados.stTotal / baseProd * 100) : 0;
      html += '<div style="margin-top:8px; font-family:var(--font-mono); font-size:12px; color:var(--brick); font-weight:600;">' +
        'ST total da nota: ' + brl(dados.stTotal) + ' · ' + num(pctStNota, 2) + '% sobre os produtos' +
        (baseProd > 0 ? ' (' + brl(baseProd) + ')' : '') + '</div>';
    }

    var link = safeUrl(dados.linkXml);
    if (link) {
      html += '<div style="margin-top:8px;"><a class="btn secondary" style="text-decoration:none; font-size:12px; padding:6px 12px;" href="' +
        escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">⬇ Baixar XML</a></div>';
    }
    return html;
  }

  /* ============================================================
     9b. Vencimentos (duplicatas) de uma nota
     ============================================================

     Usada pelos dois apps. O Controle de Notas ja' tem as duplicatas
     em memoria (onSnapshot) e so' filtra; a Calculadora nao carrega a
     colecao e consulta por nota, quando alguem abre a linha. Quem
     desenha e' esta funcao nos dois casos, para o quadro ser o mesmo.

     dups: [{ vencimento, valor, parcela, pago, dataPagamento }]
     opcoes: { dataEmissao }  — necessaria para calcular o prazo
  */
  function tabelaVencimentos(dups, opcoes) {
    var o = opcoes || {};
    var lista = (dups || []).slice().sort(function (a, b) {
      return String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999'));
    });
    if (!lista.length) {
      return '<p class="empty-note" style="display:block;">Esta nota nao tem duplicatas registradas.</p>';
    }

    var hoje = hojeISO();
    var emissao = o.dataEmissao || '';
    var total = 0, somaPonderada = 0, comPrazo = 0;
    var prazos = [];

    var linhas = lista.map(function (d) {
      var valor = d.valor || 0;
      total += valor;

      // Prazo = dias entre a emissao da nota e o vencimento da parcela.
      // Sem data de emissao (ou de vencimento) nao da' para calcular:
      // a celula fica com "—" em vez de um numero inventado.
      var dias = null;
      if (emissao && d.vencimento) {
        dias = diasEntre(emissao, d.vencimento);
        prazos.push(dias);
        somaPonderada += dias * valor;
        comPrazo += valor;
      }

      var sit, classe;
      if (d.pago === true) {
        sit = 'PAGO' + (d.dataPagamento ? ' em ' + fmtData(d.dataPagamento) : '');
        classe = 'pago';
      } else if (d.vencimento && d.vencimento < hoje) {
        sit = 'ATRASADO'; classe = 'atrasado';
      } else {
        sit = 'A VENCER'; classe = 'avencer';
      }

      return '<tr>' +
        '<td>' + escapeHtml(d.parcela || '-') + '</td>' +
        '<td>' + fmtData(d.vencimento) + '</td>' +
        '<td>' + (dias != null ? dias + ' dias' : '—') + '</td>' +
        '<td>' + brl(valor) + '</td>' +
        '<td><span class="badge ' + classe + '">' + escapeHtml(sit) + '</span></td>' +
        '</tr>';
    }).join('');

    var html = '<div class="tabela-rolavel"><table class="quote-table"><thead><tr>' +
      '<th scope="col">Parc.</th><th scope="col">Vencimento</th><th scope="col">Prazo</th>' +
      '<th scope="col">Valor</th><th scope="col">Situacao</th></tr></thead><tbody>' +
      linhas + '</tbody></table></div>';

    // Resumo. O prazo medio e' PONDERADO PELO VALOR, nao a media simples
    // dos dias: uma parcela de R$ 9.000 em 90 dias e outra de R$ 1.000
    // em 30 pesam diferente no caixa. Com parcelas iguais os dois dao o
    // mesmo numero, que e' o caso de 30/60/90.
    var resumo = [];
    if (prazos.length) resumo.push('prazo ' + prazos.join('/'));
    if (comPrazo > 0) {
      resumo.push('prazo médio ' + Math.round(somaPonderada / comPrazo) + ' dias');
    }
    resumo.push('total ' + brl(total));

    html += '<div style="margin-top:8px; font-family:var(--font-mono); font-size:12px; color:var(--ink-soft);">' +
      escapeHtml(resumo.join(' · ')) + '</div>';
    return html;
  }

  /* ============================================================
     10. Rede de seguranca
     ============================================================ */

  // Sem isto, um erro inesperado deixava a tela em branco em silencio.
  function instalarErroGlobal() {
    global.addEventListener('error', function (ev) {
      console.error('Erro nao tratado:', ev.error || ev.message);
      toast('Algo deu errado nesta tela. Recarregue a pagina se ela parar de responder.', 'erro');
    });
    global.addEventListener('unhandledrejection', function (ev) {
      var e = ev.reason;
      if (e && e.message === 'Login cancelado.') return; // o usuario fechou a caixa de proposito
      console.error('Promise rejeitada sem tratamento:', e);
      toast('Uma operacao falhou: ' + erroDe(e), 'erro');
    });
  }

  // Barra de conta no cabecalho: mostra quem esta' logado e o botao Sair.
  // Idempotente de proposito: iniciarFirebase() roda de novo toda vez
  // que alguem troca a configuracao na aba Sincronizacao, e sem esta
  // guarda cada chamada acrescentava um segundo nome de usuario, um
  // segundo botao "Sair" e mais um ouvinte de auth que nunca saia.
  function montarBarraConta(container) {
    if (!container) return;
    if (container.dataset.contaMontada === '1') return;
    container.dataset.contaMontada = '1';
    container.className = 'conta-barra';
    var email = document.createElement('span');
    email.className = 'conta-email';
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn secondary mini';

    function pintar(u) {
      if (u) {
        // Mostra "administrativo", nao "administrativo@calculadora.local".
        email.textContent = emailParaUsuario(u.email) || 'conectado';
        email.title = u.email || '';
        botao.textContent = 'Sair';
        botao.onclick = function () {
          confirmar({
            titulo: 'Sair',
            mensagem: 'Sair da conta neste computador? Será preciso entrar de novo com usuário e senha.',
            confirmar: 'Sair'
          }).then(function (ok) {
            if (!ok) return;
            sair().then(function () { global.location.reload(); });
          });
        };
      } else {
        email.textContent = '';
        email.title = '';
        botao.textContent = 'Entrar';
        botao.onclick = function () {
          pedirLogin().then(function () {
            toast('Conectado. Recarregando os dados...', 'ok');
            if (typeof global.__aoEntrar === 'function') global.__aoEntrar();
          }).catch(function () { /* cancelado */ });
        };
      }
    }

    container.appendChild(email);
    container.appendChild(botao);
    aoMudarUsuario(pintar);
    pintar(_usuario);
  }

  /* ============================================================
     Exporta
     ============================================================ */

  // So' entra aqui o que algum dos dois apps (ou os testes) realmente
  // usa. num, abrirModal, iniciarAuth, authPronto, sair, usuario e
  // aoMudarUsuario existem e sao usados INTERNAMENTE — por
  // tabelaItensNota, confirmar/avisar/pedirLogin, iniciarFirebase,
  // exigirLogin e montarBarraConta. Estavam exportados sem nenhum
  // consumidor de fora; se um dia algum app precisar, e' so' devolver.
  global.App = {
    FIREBASE_CONFIG: FIREBASE_CONFIG,
    DEBOUNCE_BUSCA: DEBOUNCE_BUSCA,

    $: $,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    normalizarTexto: normalizarTexto,
    norm: norm,

    toNum: toNum,
    centavos: centavos,
    brl: brl,
    pct: pct,
    parseNumeroBR: parseNumeroBR,

    iso: iso,
    hojeISO: hojeISO,
    fmtData: fmtData,
    somarDias: somarDias,
    diasEntre: diasEntre,
    fmtDataFirestore: fmtDataFirestore,
    horaAgora: horaAgora,

    debounce: debounce,
    delegar: delegar,
    montarMenu: montarMenu,

    toast: toast,
    toastErro: toastErro,
    erroDe: erroDe,
    confirmar: confirmar,
    avisar: avisar,

    iniciarFirebase: iniciarFirebase,
    pedirLogin: pedirLogin,
    exigirLogin: exigirLogin,
    comAuth: comAuth,
    ehPermissaoNegada: ehPermissaoNegada,
    montarBarraConta: montarBarraConta,
    DOMINIO_LOGIN: DOMINIO_LOGIN,
    usuarioParaEmail: usuarioParaEmail,
    emailParaUsuario: emailParaUsuario,

    criarRouter: criarRouter,
    tabelaItensNota: tabelaItensNota,
    tabelaVencimentos: tabelaVencimentos,
    instalarErroGlobal: instalarErroGlobal
  };

  // No Node (testes, calculo-nucleo.js) nao existe window: cai no
  // globalThis e devolve o mesmo App pelo require().
  if (typeof module === 'object' && module.exports) module.exports = global.App;
})(typeof window !== 'undefined' ? window : globalThis);
