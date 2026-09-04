# Calculadora de Custo + Controle de Notas

Dois aplicativos de página única que compartilham o mesmo projeto Firebase.

| Arquivo | O que é |
|---|---|
| `index.html` | Custo, impostos, frete, margem, cotações, concorrentes, NF-e emitidas |
| `controle-notas.html` | NF-e a importar, duplicatas, pagamentos, canceladas, vendas × compras, lançamentos contábeis + exportação para o contador |
| `assistencias.html` | Assistências/reclamações (gerentes de vendas, no celular) |
| `lancamentos.html` | Redireciona para o Controle de Notas (as telas Lançamentos e Cadastros moram lá desde 04/09/2026) |
| `dashboard.html` | Dashboard de vendas (Google Sheets) — relatório atrás de login |
| `calculo-nucleo.js` | **A fórmula**: alíquotas, custo, margem, preço-alvo, metas |
| `app-shared.css` | Design system comum aos apps |
| `app-shared.js` | Helpers, login, avisos, roteador — comum aos apps |
| `firestore.rules` | Regras de segurança do banco (**precisa ser publicada**) |
| `testes/` | Verificação automatizada, roda só com Node |

Os cinco primeiros precisam ficar **na mesma pasta**. Se você publica os
aplicativos em algum lugar, suba `calculo-nucleo.js`, `app-shared.css`,
`app-shared.js`, `icon-192.png`, `icon-512.png` e os dois
`manifest*.json` junto.

### ⚠ Sempre que alterar `app-shared.css`, `app-shared.js` ou `calculo-nucleo.js`

O navegador guarda esses arquivos em cache. Depois de publicar uma
mudança neles, as máquinas continuam usando a **cópia antiga** por um
tempo — e o sintoma é confuso: o app parece não ter mudado, ou mistura
comportamento novo com antigo.

Por isso os HTML referenciam os arquivos com um número de versão:

```html
<link rel="stylesheet" href="app-shared.css?v=14">
<script src="app-shared.js?v=13"></script>
<script src="calculo-nucleo.js?v=7"></script>
```

**Ao mexer nos arquivos compartilhados, aumente esse número nos dois
HTML.** Trocar `?v=12` por `?v=13` faz cada navegador baixar a versão nova
na hora, sem ninguém precisar limpar cache. O `node testes/executar.js`
reclama se a referência estiver sem `?v=`.

O `calculo-nucleo.js` só é carregado pelo `index.html` (o Controle de
Notas não faz conta de margem), e precisa vir **depois** do
`app-shared.js` — ele usa o arredondamento de centavos de lá.

---

## ⚠ Passo obrigatório: fechar o banco

Hoje qualquer pessoa que tenha o arquivo HTML consegue ler e apagar
**todas as notas, duplicatas, cotações e preços de fornecedor**. A
`apiKey` que aparece no código é pública por design — ela identifica o
projeto, não protege nada. Quem protege são as regras do Firestore, e as
atuais estão abertas.

Faça isto no [Firebase Console](https://console.firebase.google.com/):

1. **Authentication → Sign-in method →** ative **E-mail/senha**.
2. **Authentication → Users → Add user:** crie um usuário para cada
   função (veja a tabela abaixo).
3. **Firestore Database → Rules:** cole o conteúdo de `firestore.rules` e
   clique em **Publicar**.

### Usuários: cadastre com domínio, entre sem ele

O Firebase exige formato de e-mail, mas **ninguém precisa digitar
domínio**. Cadastre assim no Console:

| No Console, cadastre | Na tela de login, digite |
|---|---|
| `administrativo@calculadora.local` | `Administrativo` |
| `compras@calculadora.local` | `Compras` |
| `financeiro@calculadora.local` | `Financeiro` |

O app completa o `@calculadora.local` sozinho, e não faz diferença
maiúscula ou minúscula. Não precisa ser e-mail de verdade — o Firebase
não envia nada nem confirma nada. A senha tem mínimo de 6 caracteres.

Para usar o domínio real da empresa, troque `DOMINIO_LOGIN` no começo de
`app-shared.js` — e cadastre os usuários com esse mesmo domínio.

Crie **um usuário por função ou pessoa**, nunca um compartilhado: assim
você desativa o acesso de quem sai sem trocar a senha de todo mundo.

### Como fica no dia a dia

O login é **obrigatório na entrada**: sem entrar, os aplicativos não
mostram nenhum dado. A caixa não fecha com Esc nem clicando fora.

A opção **"Manter conectado neste computador"** vem marcada. Com ela, as
máquinas do escritório entram uma vez e continuam entrando sozinhas, para
sempre, até alguém clicar em **Sair**. Desmarque em computador
compartilhado ou emprestado: aí a sessão morre ao fechar o navegador.

O botão **Sair** fica no canto superior direito, ao lado dos botões de
tela, junto do nome de quem está conectado.

**Você pode publicar as regras sem parar o trabalho de ninguém.** Quem
já estiver com a sessão salva nem percebe; quem não estiver vê a caixa de
login. Se a sessão expirar no meio do uso, o app reabre o login e refaz
sozinho a operação que falhou.

### O que as regras permitem

- `notas`, `duplicatas`, `itensNotas` — o navegador **lê**, mas só pode
  alterar os campos de controle (`pago`, `status`, `previsaoEntrega`,
  `noSistema`, `vencimento`…). Criar e apagar nota fica proibido pelo
  navegador. O Apps Script usa conta de serviço e ignora estas regras,
  então a importação de XML continua igual.

  **A prorrogação de vencimento não é desfeita pelo Apps Script.** Ele
  grava duplicata com a precondição `currentDocument: { exists: false }`
  — se o documento já existe, a gravação é recusada (`FAILED_PRECONDITION`,
  contada no log como "já existiam") e nada é sobrescrito. É a mesma
  precondição que protege o `pago`, e vale até se você limpar os
  checkpoints e reprocessar a pasta inteira. O outro lado da moeda: se
  uma NF-e for reemitida com vencimentos diferentes, as duplicatas
  antigas **não** são atualizadas — corrigir isso é na mão, pelo app.
- `produtos`, `cotacoes`, `concorrentes` — leitura e escrita livres para
  quem está autenticado.
- Qualquer outra coleção: bloqueada.

---

## O preço de venda mora em um lugar só

O preço de venda de um produto fica em **Produtos salvos**
(`produtos/{nome}`, campo `venda`). Não existe outra cópia.

Quem identifica o produto é o **código interno** (campo `codigo`), não o
nome. Nome muda de planilha para planilha — `TELHA 2,44M`, `Telha 2.44
m` — e casar por texto erra justamente nos produtos que mais aparecem.
O nome fica como segunda tentativa, para os produtos salvos antes de
existir campo de código.

A ficha guarda os dois códigos: `codigo` (o nosso, da coluna Código da
planilha de cotação) e `codigoFornecedor` (o que vem no PDF do
fornecedor, só para conferência — não é usado para buscar).

Produto salvo sem código **ganha o código sozinho** na primeira cotação
em que aparecer: se ele foi achado pelo nome e a cotação traz um código,
o campo é preenchido na gravação. Código já preenchido nunca é
sobrescrito — quem manda é a ficha do produto.

Na tabela do card "3. Adicionar produtos", cada linha com preço mostra
de onde ele veio: **✓ por código** (casamento seguro) ou **≈ por nome**
(palpite — confira antes de salvar).

Dois produtos com o mesmo código interno é erro de cadastro: salvar pela
Calculadora pergunta antes, e na carga o segundo é ignorado com aviso no
console. O primeiro encontrado é que vale.

Isso vale para as três telas onde ele aparece:

| Tela | O que faz com o preço |
|---|---|
| Calculadora / Produtos salvos | Lê e grava — é a fonte |
| Cotação, card "3. Adicionar produtos" | Chega preenchido com o preço do produto (achado pelo código); o que você digitar passa a valer em Produtos salvos |
| Histórico e Pesquisar concorrentes | Só leem |

**Antes** o mesmo número era guardado duas vezes: em `produtos.venda` e
em `cotacoes.itens[].precoVenda`. Alterar um não alterava o outro, então
a mesma peça podia aparecer a R$ 90 no histórico e a R$ 110 na
Calculadora, sem nada dizendo qual dos dois valia.

Duas consequências de a fonte ser única, que valem saber:

- A coluna **Venda** do Histórico mostra o preço de **hoje**, não uma
  foto do dia da cotação. Trocar o preço em Produtos salvos muda a
  coluna e a margem em todas as cotações daquele produto.
- A coluna **Margem** do Histórico sai da mesma ficha: frete, ST, IPI e
  avarias vêm dela, e só o custo é o negociado naquela cotação. Produto
  que não está em Produtos salvos não tem de onde tirar isso — a margem
  dele considera só o custo do produto, sai maior que a real, e a célula
  marca com `*` avisando.
- **Apagar o campo Venda na cotação não apaga o preço do produto.**
  Tirar o preço de um produto é decisão da tela de Produtos salvos —
  uma cotação não mexe no catálogo por omissão.

Salvar a cotação grava os preços digitados em Produtos salvos e diz
quantos foram (`"Cotação salva no histórico. 3 preços de venda gravados
em Produtos salvos."`). Produto que ainda não existia nasce com a
configuração de custo que está na tela do modo em lote; produto que já
existe tem **só** o preço trocado — frete, impostos e o resto da ficha
dele ficam como estavam.

As cotações salvas antes dessa unificação ainda têm o `precoVenda`
gravado no item. Ele continua sendo lido quando o produto não tem preço
em Produtos salvos, para nada sumir da tela, mas nada volta a escrever
ali.

---

## Rodando os testes

```bash
node testes/executar.js
```

Não precisa instalar nada. São vinte e quatro etapas, em dezoito frentes:

1. **Núcleo de cálculo** — carrega o `calculo-nucleo.js` de verdade (o
   mesmo arquivo que a tela usa) e compara com a fórmula original em
   200 mil casos aleatórios. É a rede de proteção contra mexer nas
   alíquotas sem perceber. Também confere que a coluna TOTAL fecha com
   a soma das linhas, que o preço sugerido atinge a margem pedida, que
   a cotação sugere o mesmo número da calculadora, e que o `index.html`
   continua ligado no núcleo em vez de ter voltado a ter sua própria
   cópia da conta.
2. **Estrutura dos dois HTML** — sintaxe dos scripts, tags balanceadas,
   ids duplicados, `$()` apontando para id inexistente, `label for=`
   órfão, arquivo referenciado que sumiu.
3. **Carga em DOM simulado** — executa os scripts de verdade (os que
   cada página carrega, na ordem em que ela carrega) e pega referência
   quebrada em tempo de carga.
4. **Helpers** — 95 verificações em `app-shared.js` (escape de HTML,
   bloqueio de `javascript:`, aritmética de datas, arredondamento,
   busca sem acento). As
   últimas abrem os modais de verdade e **apertam o botão**, para
   conferir o valor que a Promise devolve — foi assim que apareceu um
   "Prorrogar vencimento" que não fazia nada. Inclui o `pedirTexto`
   (observação de pagamento): cancelar devolve `null`, confirmar em
   branco devolve `''` — limpar é resposta válida, diferente de
   desistir.
5. **Roteador de telas** — 12 verificações no endereço `#Tela`.
6. **Regras da tela de cotação** — campo escondido não entra na conta,
   a margem do histórico bate com a da cotação, e nada (barra de conta,
   escutas do Firestore) se multiplica a cada reconexão.
7. **Fornecedores e prazos** — 55 verificações: a separação da Vetrus
   por produto e a moda dos prazos com a folga de ±5 dias. Trava o
   principal: o prazo mostrado é sempre um que **existiu de verdade**
   numa nota, nunca uma média. E trava que a regra da Vetrus continue
   morando num lugar só (`app-shared.js`, seção 9c) — as seis telas que
   mostram fornecedor têm de chamar o mesmo fornecedor pelo mesmo nome.
8. **Pagamentos e recorrência** — 38 verificações: categorias (toda
   categoria precisa ter cor no CSS), o cálculo do próximo vencimento
   (dia 31 em mês de 30, fevereiro bissexto, virada de ano) e o filtro
   de período. Trava também que a tela espere as duas coleções antes de
   dizer "nenhum item" — zero é uma afirmação.
9. **Conferência de DDA** — 74 verificações em `dda-nucleo.js`. O parser
   roda contra a **camada de texto real** de um DDA do Bradesco
   (`testes/dda-fixture.js`, 36 boletos em 3 páginas), incluindo os dois
   registros que atravessam a quebra de página e a coluna "Situação" que
   o PDF desenha fora de ordem. Também trava as três estratégias de
   casamento (nota+parcela, nota sem parcela, valor escopado ao
   cedente), o CNPJ de 15 dígitos do Bradesco, a comparação em centavos
   inteiros e — principalmente — que boleto sem par **fora da janela de
   carga** vira ⚪ indeterminado, nunca 🔴 fraude.
10. **Painel de metas** — 81 verificações em `painel-nucleo.js`, com os
    números da planilha de 2026 como referência: dias de trabalho mês a
    mês (sem domingos e feriados; sábado é dia normal; feriado no
    domingo não desconta duas vezes), limite = 60% do objetivo, diários
    previsto/realizado e a previsão do mês corrente — que só projeta
    sobre os dias úteis restantes e **nunca inventa média de amostra
    vazia**. Também a **projeção anual** (vendas dos meses fechados +
    previsão do corrente + objetivos dos futuros; mês sem dado é
    **avisado**, nunca zero mudo) e o histórico mês a mês lançado na
    própria tabela (`metasMensais` — nenhum faturamento fica escrito
    em código, o repositório é público): total do ano anterior **só com
    os 12 meses** (parcial vira null, nunca "total do ano"), crescimento
    até agora (fechados × os mesmos meses, corrente fora) e a projeção
    por **sazonalidade** (média de até 4 anos-base completos; mês sem
    lançamento sai da conta inteiro, sem distorcer a proporção). E o
    **A pagar por semana de pagamento** (sáb–sex, a mesma regra do
    filtro "Pgto semana"): a soma das semanas fecha com o total do mês,
    e a semana que cruza a virada aparece nos dois meses, cada um com
    a sua parte.
11. **Simulador de compra** — 58 verificações em `simulador-nucleo.js`:
    a soma das parcelas **sempre bate** com o valor da compra (centavos
    inteiros, sobra na última), a **ST** como valor adicional cobrado
    junto da 1ª parcela (quando ela vence antes de 30 dias) ou em
    parcela própria aos 30 dias (parcela única ou 1ª aos 30+), datas
    de compra que encolhem no mês curto e voltam ao dia 31, "à vista"
    como parcela única na data da compra, a **rampa** (o 12º mês
    recebe a mesma carga de regime que o 6º), o **ajuste percentual
    por mês de compra** (escala mercadoria + ST + frete daquele mês,
    refazendo a divisão para a soma bater; trava em −100%), a projeção
    de recorrentes que **não conta em dobro** o mês cujo documento já
    existe, e `parcelasTotal` encerrando a corrente mesmo com
    `parcelaAtual` ausente.
12. **DANFE simplificado** — as duas leituras determinísticas do
    documento de conferência: a **UF do emitente** extraída dos 2
    primeiros dígitos da chave de acesso (código IBGE; desconhecido →
    "—", nunca chute) e a **classificação da operação pelo CFOP**
    (interna/interestadual/exterior; venda com/sem ST; e 5405/6404 como
    "ST retida anteriormente", que legitimamente vem sem cobrança e não
    pode virar alarme falso na checagem cruzada com o valor de ST).
13. **Fiscal (NCM & ST)** — 28 verificações em `fiscal-nucleo.js`: o
    agrupamento por **NCM + UF de origem** (da chave de acesso), o % de
    ST observado em centavos inteiros (null sem base, nunca zero
    inventado), a contagem por classe de CFOP (com "retida
    anteriormente" separada de "com ST"), a divergência cadastro ×
    observado — **só categórica**: percentual não ganha veredito
    automático, porque tolerância numérica seria invenção — e a trava
    de cadastro (`grupoCadastravel`), que espelha o regex do
    `firestore.rules`: item sem NCM ou UF desconhecida não ganha
    formulário, senão o salvamento morreria em permission-denied.
14. **Concorrentes em lote (planilha)** — 37 verificações em
    `concorrentes-nucleo.js`: leitura do catálogo (cabeçalho tolerante a
    ordem/acento/caixa, preço com sujeira de float → centavos inteiros,
    linha ruim **contada com motivo**, nunca engolida), a consulta de
    busca sem a notação interna (`*` e `(CX...)`) com o nome original
    intacto, fabricante **sem agrupamento** de grafias parecidas
    (variação é sinal, não ruído), o comparativo da substituição
    (novo/saiu/mudou/igual, chaveado pelo código) e os **três motivos**
    de desatualização — nunca pesquisado, preço mudou desde a pesquisa
    (vence o prazo: comparação contra preço que não praticamos mais diz
    a coisa errada) e prazo vencido.
15. **Assistências e reclamações** — 44 verificações em
    `assistencias-nucleo.js`: as listas de status/causa/solução e a cor
    do badge (status desconhecido cai no **vermelho**, nunca parece
    resolvido), o resumo dos cartões (em aberto = tudo que não está
    resolvido; custos só do mês corrente; líquido = custo −
    ressarcimento), o filtro (busca em cliente **e** sequência, sem
    acento), a **duplicidade de sequência** (outro documento avisa; o
    próprio em edição não conta), o **termo de acordo** no mesmo campo
    das fotos (marcado com `{termo:true}`; documento antigo só com
    strings continua funcionando, e juntar/separar fecham o ciclo) e a
    exportação (linha sem dinheiro sai com líquido em branco, não "0";
    fotos exportam como contagem, termo como "sim").
16. **Lançamentos contábeis** — 58 verificações em
    `lancamentos-nucleo.js`: as **partidas dobradas** montadas pelo app
    (saída = D categoria / C banco; entrada = D banco / C categoria;
    transferência = D destino / C origem — dado faltando não monta
    partida pela metade), pendência (sem data ou valor **trava a
    exportação**, que estoura em vez de queimar numeração com linha
    lixo), em qual arquivo a transferência sai (**banco de movimento**,
    como na amostra real do contador; empate fica na origem), o layout
    de 19 colunas (sem cabeçalho, duas linhas por lançamento com D
    primeiro, nº com 8 dígitos, histórico em maiúsculas, contadores
    das colunas 1 e 19 **contínuos entre exportações**), os seeds com
    a acentuação corrigida (os JSONs de origem vieram com UTF-8 lido
    como Latin-1) e a ponte com o Controle de Notas: **pagamento vira
    lançamento** com id determinístico (pagar de novo não duplica;
    desfazer sabe o que apagar), valor pago acima do devido vira
    **juros** em lançamento próprio, sem mapa de conta o doc nasce
    pendente (nunca trava o pagamento), e o espelho das categorias
    internas é conferido **textualmente** contra o controle-notas.html.

17. **Dashboard de vendas** — 53 verificações extraídas do próprio
    `dashboard.html` (o teste mede o código que roda na tela): o
    desembrulho do gviz do Google Sheets, colunas casadas pelo rótulo
    (ordem e acento não importam), a **regra de ouro** da margem
    (soma/soma, nunca média de margens — e null sem faturamento, nunca
    "0%"), séries mensais com mês vazio = null, a participação por
    categoria fechando 100%, o crescimento anual no período comparável
    (e a linha mês a mês quando há fornecedor/categoria filtrado),
    a canonização de nomes (grafias que só diferem em maiúsculas/acento
    viram um nome só — o caso real "Outros"/"OUTROS") e os destaques
    automáticos calculados por regra, sem IA.

18. **Vendas × Compras** — 18 verificações extraídas do
    `controle-notas.html`: o cruzamento da planilha pública de vendas
    com as notas (compra pela **emissão**) e os títulos (duplicatas
    pelo **vencimento** no período, **pagas ou não** — a comparação
    não depende de o pagamento ter sido efetivado, e o título vale
    pelo valor dele, nunca pelo valorPago), por marca da planilha. O
    vínculo por **rótulo** vence o por CNPJ (é o que separa a Vetrus:
    mesmo CNPJ, duas marcas decididas pelo produto), marca casa sem
    caixa/acento, nota cancelada fica fora dos dois lados, quem não
    tem vínculo vai para "sem vínculo" (nunca somado em silêncio) e
    o "não comparar" sai da conta somado em ignorados. A área logada do `dashboard.html`
    usa uma **cópia fiel** dessas funções — o teste compara os dois
    arquivos textualmente, então mudar num lado e esquecer o outro
    quebra aqui.

Rode antes de publicar qualquer alteração.

---

## Onde mexer em cada coisa

**Alíquotas de imposto** — `calculo-nucleo.js`, objeto `TRIBUTOS`, no
começo do arquivo:

```js
const TRIBUTOS = {
  pisCofins:  0.0925,
  icmsDebito: 0.205,
  irpj:       0.25,
  csll:       0.09
};
```

É o **único** lugar. Antes esses números estavam escritos à mão em duas
funções diferentes; se alguém mudasse só uma, a margem exibida e o preço
sugerido passariam a discordar sem erro nenhum. Agora `computeCalc` e
`precoParaMargem` saem os dois da mesma decomposição
(`custo = C0 + k × venda`).

**Metas de margem** (mínimo 4%, aceitável 8%, ideal 13%) — array `METAS`,
no mesmo arquivo. Mudar um percentual aí muda **tudo junto**: o preço de
cada faixa, o texto "margem de 13%" embaixo dele e a coluna "Sugerido"
da cotação. A meta marcada com `sugerida: true` é a que serve de
referência na cotação.

Antes esses três números apareciam em quatro lugares (o markup do HTML,
o array dentro de `calcular()`, a constante `MARGEM_SUGERIDA` e o
teste). Dava para trocar a meta e a tela continuar escrito "margem de
8%" ao lado de um preço de 13% — foi o que quase aconteceu quando o
preço sugerido da cotação passou de Aceitável para Ideal.

**Por que a fórmula não mora mais no `index.html`** — porque o teste não
tinha como chamá-la. Ele recortava o texto da função de dentro do HTML
com `indexOf` e remontava com `new Function()`: media uma cópia
remontada, não o código que roda na tela. Renomear uma função ou mover
um trecho era suficiente para o teste passar a medir outra coisa sem
avisar. Hoje a tela e o teste carregam o mesmo arquivo, e o teste
reclama se o `index.html` voltar a definir a fórmula por conta própria
ou parar de carregar o núcleo.

**Quanto de histórico o Controle de Notas baixa** — `controle-notas.html`:

```js
var DATA_CORTE_IMPORTACAO = '2026-01-01'; // o que conta como "a importar"
var MESES_HISTORICO       = 12;           // janela padrão de carga
var MESES_FOLGA_NOTAS     = 6;            // notas vêm com folga extra
```

O app baixa as duplicatas e os pagamentos internos que vencem nos
últimos 12 meses, e as notas dos últimos 18. A folga existe porque a
nota é emitida **antes** de a parcela vencer: sem ela, o app não saberia
dizer se a duplicata foi recebida ou se a nota foi cancelada. Quando
mesmo assim a nota de origem está fora da janela, a coluna "Recebido"
mostra `—` em vez de afirmar "NÃO" sem ter como saber.

Os pagamentos internos entraram na janela pelo mesmo motivo: cada
pagamento recorrente cria **um documento por mês**, então sem corte a
coleção só cresce e toda abertura do app paga por ela inteira.

Três coisas nunca são cortadas pela janela, porque some justamente o que
importa:

- **Notas canceladas** de qualquer época (consulta própria).
- **Duplicatas sem data de vencimento** — as que ninguém acha depois.
- **Pagamentos internos ainda em aberto**, de qualquer época. Um imposto
  de 14 meses atrás que ninguém pagou é exatamente o que não pode sumir
  da tela. O corte existe para não pagar leitura por histórico velho — e
  histórico velho é o que já **foi** pago.

O selo **"últimos 12 meses"** aparece na barra de cima, ao lado do
contador, junto com o botão **"carregar histórico completo"**, que refaz
a carga sem corte nenhum quando você precisar consultar algo antigo.

**Lojas pesquisadas** — textarea na aba Concorrentes; o padrão está na
constante `LOJAS_PADRAO`.

**Modelos do Gemini** — bloco `<script type="module">`, constantes
`MODELO_EXTRATOR`, `MODELO_PESQUISA`, `MODELO_FORMATADOR`.

**Esforço de raciocínio da pesquisa de preços** (`thinkingLevel`), no
mesmo bloco. São dois níveis:

| Nível | Onde roda | Volume |
|---|---|---|
| `medium` | toda pesquisa, em lote ou avulsa | produtos × lojas |
| `high` | 2ª tentativa do que não foi achado, e a lupa 🔍 de uma célula | só o que falhou |

O padrão já foi `low`. O barato saía caro: preço do produto errado passa
despercebido na tabela, enquanto "não encontrado" pelo menos se vê — e
cada falha voltava como uma segunda chamada, devolvendo parte da
economia em repetição.

O `high` fica onde não há custo de escala. É a última chance de acertar
aquela célula, e são poucas chamadas.

---

## Endereços das telas

As telas agora ficam no endereço, então dá para recarregar a página sem
voltar ao início e para mandar um link já aberto na tela certa:

- `controle-notas.html#Pagamentos`, `#Importar`, `#Canceladas`, `#Painel`
- `index.html#Historico`, `#Cotacao`, `#Concorrentes`,
  `#Produtos`, `#Notas`, `#Frete`, `#Sync`

As telas de comparação e de pesquisa em lote dependem de um pedido
selecionado, então caem na tela inicial se você abrir o link direto.

---

## Ponto em aberto, para você decidir

**Como ler "1.234" numa planilha de fornecedor.** A função
`parseNumeroBR` lê `"1.234,56"` como 1234,56 (certo) e `"1.234"` como
**1,234** — não como mil duzentos e trinta e quatro. Esse é o
comportamento original, mantido de propósito: não dá para adivinhar sem
ver como os seus fornecedores formatam as planilhas. Preços quase sempre
vêm com centavos e caem no caso certo; o risco é uma **quantidade**
escrita com ponto de milhar e sem casas decimais.

Se você confirmar que nenhum fornecedor usa três casas decimais em preço
unitário, dá para tratar `"1.234"` como 1234 com segurança — é uma linha.

---

## Notas técnicas

- Os dois SDKs do Firebase convivem na calculadora: `compat` v10.14 para
  o Firestore e o modular v12.15 (carregado sob demanda) para o Gemini,
  que só existe na versão modular. Unificar exigiria transformar o script
  principal em módulo ESM, o que quebraria a abertura por `file://`.
  Ficou como está de propósito.
- O cache local do Firestore (`enablePersistence`) fica ligado: a segunda
  visita abre na hora e o app continua útil sem internet. Ele falha de
  propósito quando há outra aba aberta — não é erro, o app segue sem cache.
- O Controle de Notas usa `onSnapshot` em vez de `get()`: a tela se
  atualiza sozinha quando o Apps Script importa algo, e as visitas
  seguintes só pagam pelos documentos que mudaram.
- O widget de sugestão de busca do Google roda dentro de um `<iframe
  sandbox>`. É HTML de fora, e o Google exige exibi-lo — mas ele não
  precisa (nem deve) ter acesso ao Firestore nem ao resto da página.
