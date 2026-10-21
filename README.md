# Backend — Plataforma de Apoio à Monitoria

Backend da **Plataforma Digital para Apoio à Monitoria no Ensino Superior** (TCC).

API REST em **NestJS · TypeScript · PostgreSQL · Sequelize**, construída para ser
consumida por um frontend Next.js independente.

---

## Objetivo

Centralizar e organizar programas de monitoria acadêmica: o professor cria a
monitoria de uma disciplina, habilita alunos como monitores, os monitores
declaram seus horários, os alunos monitorados agendam atendimentos, e todo o
histórico — inclusive cancelamentos — fica preservado e mensurável.

O backend é autossuficiente: não depende do frontend para nenhuma regra de
negócio ou de segurança.

---

## O conceito central do domínio

`MONITOR` e `MONITORADO` **não são tipos de usuário**. São papéis que um `ALUNO`
assume dentro de uma `MONITORIA` específica, guardados em
`monitoria_participantes.papel`.

```
João (usuário, aluno)
 ├── Monitoria de Cálculo I        → papel: MONITOR
 └── Monitoria de Banco de Dados   → papel: MONITORADO
```

São duas linhas, não dois usuários. Isso tem duas consequências que atravessam
todo o código:

1. **Não existe coluna `tipo` em `usuarios`.** O perfil (`ALUNO`/`PROFESSOR`) é
   derivado da existência das linhas em `alunos`/`professores`, e um mesmo
   usuário pode acumular os dois.
2. **A autorização é contextual.** Nenhum endpoint sensível decide por perfil
   global. O `ParticipacaoGuard` pergunta *"qual é o seu papel **nesta**
   monitoria?"* — a pergunta que o domínio realmente faz.

A modelagem completa, com alternativas rejeitadas e decisões em aberto, está em
[docs/arquitetura.md](docs/arquitetura.md).

---

## Arquitetura

**Monólito modular em camadas.** Sem CQRS, sem Event Sourcing, sem hexagonal
completa, sem camada de repositório genérica — nenhum desses resolve um problema
real deste domínio.

```
HTTP → Controller → Service → Model (Sequelize) → PostgreSQL
       (DTO +       (regras de   (persistência)
     validação)      negócio)
```

- **Controller** — rota, DTO, guards. Zero regra de negócio.
- **Service** — dono das regras. É onde RN01–RN10 são verificadas.
- **Model** — mapeamento e associações, injetado direto no service.
- **Guards** — autorização em duas camadas: perfil global e participação.

### O princípio que orienta o resto: o banco é a última linha de defesa

Regra que pode virar constraint **vira constraint**, além da validação no
service. O motivo é concorrência: duas requisições simultâneas de agendamento
passam pelo mesmo `SELECT` de verificação e ambas inserem. Só uma constraint
impede o conflito.

| Regra | Garantia no banco |
|---|---|
| RN09 — um aluno não acumula papéis | índice único **parcial** sobre vínculos `ATIVO` |
| RN01/RN02/RN04 — papel e monitoria corretos | **FKs compostas** com `monitoria_id` + `papel` |
| RN03 — conflito de horário | duas constraints **`EXCLUDE USING gist`** |
| RN10 — não destruir histórico | ausência de `ON DELETE CASCADE` + soft delete |

Detalhamento na seção [Regras de negócio](#regras-de-negócio).

---

## Pré-requisitos

- Node.js 20+ (desenvolvido com 22)
- PostgreSQL 14+ (desenvolvido com 17)

---

## Configuração

### 1. Dependências

```bash
npm install
```

### 2. Banco de dados

**Com Docker:**

```bash
docker compose up -d
```

**Com PostgreSQL já instalado** (o `psql` pedirá a senha do superusuário):

```bash
psql -U postgres -c "CREATE ROLE monitoria LOGIN PASSWORD 'monitoria';" -c "CREATE DATABASE monitoria OWNER monitoria;"
```

No Windows, se o `psql` não estiver no PATH, use o caminho completo
(`"C:\Program Files\PostgreSQL\17\bin\psql.exe"`).

### 3. Variáveis de ambiente

```bash
cp .env.example .env
```

Gere um segredo real para o JWT e cole em `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

A aplicação **não sobe** se alguma variável obrigatória estiver ausente ou
inválida — a validação com Joi roda no boot, de propósito. É melhor quebrar
explicitamente do que descobrir em produção que `JWT_SECRET` estava vazio.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | não | `development` \| `test` \| `production` |
| `PORT` | não | Porta HTTP (padrão `3000`) |
| `API_PREFIX` | não | Prefixo global das rotas (padrão `api`) |
| `CORS_ORIGINS` | não | Origens liberadas, separadas por vírgula. **Vazio = CORS fechado** |
| `URL_FRONT` | não | Base dos links enviados nos e-mails (notificações **e** criação de conta). Padrão `http://localhost:3001`. Barra final é ignorada |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | **sim** | Conexão PostgreSQL |
| `DB_LOGGING` | não | `true` imprime o SQL gerado |
| `JWT_SECRET` | **sim** | Mínimo de 32 caracteres |
| `JWT_EXPIRES_IN` | não | Padrão `8h` (D-09). Não há refresh token — ver Decisões |
| `EMAIL_DOMINIOS_PERMITIDOS` | não | Restringe a criação de contas a domínios institucionais. Vazio = qualquer domínio |
| `NOTIFICACOES_HABILITADAS` | não | Liga os avisos por e-mail. **Padrão `false`** — ver *Notificações* |
| `LOGS_REQUISICAO_HABILITADOS` | não | Grava uma linha por requisição. Padrão `true` — ver *Trilha de requisições* |
| `TIMEZONE_INSTITUICAO` | não | Fuso que casa atendimento (UTC) com disponibilidade semanal (hora local). Padrão `America/Porto_Velho` |

### 4. Migrations

```bash
npm run db:migrate
```

São 22 migrations. Outros comandos: `db:migrate:status`, `db:migrate:undo`,
`db:migrate:undo:all`.

O schema é **propriedade das migrations**. `synchronize` está desligado e não
deve ser ligado: índices parciais, `EXCLUDE` e FKs compostas — que são justamente
o que garante as regras de negócio — não são expressáveis pelo `sync` do ORM.

### 5. O primeiro professor

**Não existe auto-cadastro.** Criar conta — de aluno ou de professor — é operação
de professor autenticado (`POST /api/alunos`, `POST /api/professores`). Uma base
nova, portanto, não tem como produzir o primeiro professor pela API: ele nasce
fora dela.

Em **desenvolvimento**, pelo seeder:

```bash
npm run db:seed
```

Cria `joao.ribeiro@ufx.edu.br` (professor) e `ana.martins@ufx.edu.br` (aluno),
ambos com senha `senhaSegura123`. O seeder se recusa a rodar com
`NODE_ENV=production`.

Em **produção**, pelo script de bootstrap:

```bash
npm run criar-professor -- --nome "Joao Ribeiro" --email joao.ribeiro@ufx.edu.br
```

Omitindo `--senha`, o script gera uma senha aleatória e a imprime uma única vez —
preferível, porque assim ela não fica no histórico do shell. Aceita também
`--identificacao` e `--departamento`.

A barreira aqui não é um segredo compartilhado, e sim possuir as credenciais do
PostgreSQL: quem as tem já poderia inserir a linha à mão. O script existe para
que o hash argon2 seja gerado com os mesmos parâmetros da aplicação, e para que
`usuarios` e `professores` nasçam na mesma transação. Depois disso, o caminho
normal é a API.

---

## Execução

```bash
npm run start:dev
```

- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs`

Produção: `npm run build` e depois `npm run start:prod`.

---

## Swagger

Documentação interativa em **`http://localhost:3000/docs`**, gerada a partir dos
DTOs e decorators (`@nestjs/swagger` com o plugin do CLI habilitado).

Para testar rotas protegidas: **Authorize** → cole o token do login (só o valor,
sem `Bearer`). O `persistAuthorization` mantém o token entre recarregamentos.

---

## Testes

```bash
npm run test
```

493 testes de unidade, sem banco, cobrindo o que o PostgreSQL **não** alcança:
autorização, papéis, transições de estado, propriedade de recurso, campos
derivados e tradução de erro.

| Arquivo | Cobre |
|---|---|
| `autorizacao.spec.ts` | `PerfilGuard`, `ParticipacaoGuard`, papéis, professor `NEGADO`/`EXIGIDO` |
| `participacao.spec.ts` | RN01 (habilitação), RN09 (acúmulo de papéis), encerramento sem apagar |
| `avaliacoes.spec.ts` | RN05, RN06, cancelado, ausência, avaliação duplicada, evento emitido |
| `materiais-gamificacao.spec.ts` | RN07, RN08, propriedade do material, pontuação, idempotência |
| `atendimentos-erros.spec.ts` | validações de agendamento, tradução de constraints, não vazamento de detalhe interno |
| `contratos-api.spec.ts` | agregação de pontos, expiração do token, filtros de `/minhas`, whitelist de ordenação |
| `bloco-b.spec.ts` | busca de alunos, campos derivados do atendimento, reagendamento |
| `swagger-paginacao.spec.ts` | gera o documento OpenAPI real e afirma que `dados` está descrito |
| `criacao-de-usuarios.spec.ts` | autorização e autoria, domínio institucional, ausência de rota pública de registro, senha gerada pelo servidor e rollback quando o e-mail não sai |
| `ajustes-api.spec.ts` | horários livres (janela, duração, agenda do solicitante), filtros de agenda pessoal, lote com falha parcial, promoção atômica, regras de pontuação |
| `logs.spec.ts` | redação de senha, código e token em qualquer profundidade; identificação do usuário pelo token; falha isolada |
| `notificacoes.spec.ts` | destinatário por tipo, idempotência, chave de transição, fuso da mensagem, reenvio e falha isolada |
| `disciplinas.spec.ts` | geração do código (prefixo, acentos, numeração, largura) e nova tentativa quando a constraint recusa |
| `email.spec.ts` | modo log sem credencial, payload e cabeçalhos do Brevo, timeout, recusa do provedor e falha de rede sem lançar; corpo nunca no log |
| `recuperacao-senha.spec.ts` | anti-enumeração (resposta e custo idênticos), teto de tentativas, expiração, uso único, código e senha só como hash |
| `relatorio-monitoria.spec.ts` | carga horária (minutos como unidade canônica, formatação), preenchimento sobre o modelo REAL do disco, remoção das linhas de exemplo, linhas em branco que sobram, escape de XML, pacote que só altera `document.xml` |
| `aprovacao-de-inscricao.spec.ts` | a inscrição como única entrada; conta reaproveitada e nunca alterada; responsável é quem aprova, não quem o candidato indicou; período vindo do edital; reuso da monitoria da oferta; ordem dos passos que torna a operação repetível |
| `professores.spec.ts` | busca na listagem de professores, e a assimetria entre as duas rotas: a pública varre menos campos, e nunca o e-mail |
| `editais.spec.ts` | resumo por disciplina (valores sempre por `replacements`, `semMedia` derivado, melhor média nula em vez de zero), período de inscrições (incluindo PATCH parcial), exclusão lógica idempotente, validação do PDF por assinatura, `media` nunca enviada no INSERT, nota em branco que não vira zero, e-mail depois do commit cuja falha não desfaz nada, `NULLS LAST` nas duas direções e ausência do binário nas listagens |

### Verificação ponta a ponta

As regras que dependem do PostgreSQL (constraints `EXCLUDE` de RN03, índice único
parcial de RN09) são verificadas contra um **banco real** — testá-las com model
mockado só provaria que o mock funciona.

Com o banco semeado (`npm run db:seed`) e o servidor rodando em outro terminal:

```bash
npm run test:fluxo
```

**316 verificações**, todas passando contra PostgreSQL 17. O seeder passou a ser
pré-requisito: sem auto-cadastro, o script precisa de um professor que ele não
pode criar — que é exatamente a restrição verificada nas primeiras linhas.
[scripts/fluxo-completo.mjs](scripts/fluxo-completo.mjs) percorre o fluxo inteiro
— professor cria monitoria → habilita monitor → aluno se inscreve → monitor
declara disponibilidade → monitorado agenda → atendimento realizado → histórico
preservado — e, a cada etapa, **tenta violar as regras** para confirmar que o
backend recusa.

---

## Módulos

| Módulo | Responsabilidade | Exporta |
|---|---|---|
| `ConfigModule` | env tipado e validado (Joi) | config |
| `DatabaseModule` | conexão Sequelize, registro de models | — |
| `AuthModule` | login, JWT, guards globais (não cria usuário) | `AuthService` |
| `UsuariosModule` | `Usuario`, `Aluno`, `Professor`, hash argon2id | `UsuariosService`, `HashService` |
| `DisciplinasModule` | catálogo mínimo (N:M com cursos) | `DisciplinasService` |
| `MonitoriasModule` | `Monitoria` + `MonitoriaParticipante` | `ParticipacaoService`, `ParticipacaoGuard` |
| `DisponibilidadesModule` | recorrência semanal do monitor | `DisponibilidadesService` |
| `AtendimentosModule` | sessão, inscrições, histórico de status | `AtendimentosService` |
| `AvaliacoesModule` | avaliação pós-atendimento | `AvaliacoesService` |
| `MateriaisModule` | acervo da monitoria | `MateriaisService` |
| `LogsModule` | trilha de requisições (`@Global()`): interceptor, middleware e redação | `LogsService` |
| `EmailModule` | serviço de e-mail (Brevo), ponto único de saída. `@Global()` | `EmailService` |
| `GamificacaoModule` | pontuação e ranking (módulo folha) | `GamificacaoService` |
| `AnalyticsModule` | indicadores agregados, incluindo carga horária (somente leitura) | `AnalyticsService` |
| `RelatoriosModule` | relatório final de monitoria em `.docx` (módulo folha, somente leitura) | — |
| `CursosModule` | catálogo de cursos | `CursosService` |
| `NotificacoesModule` | avisos por e-mail (outbox + agendador) | `NotificacoesService` |
| `EditaisModule` | editais de seleção, inscrições públicas e boletim em PDF (módulo folha) | — |

### Grafo de dependências (acíclico)

```
Auth ─► Usuarios ◄─ Monitorias ◄─┬─ Disponibilidades
                       ▲          ├─ Materiais
Cursos ◄─ Disciplinas ─┘          ├─ Avaliacoes
   ▲          ▲                   ├─ Analytics
   └──────────┴── Editais   Atendimentos ─► Disponibilidades

Gamificacao   ◄╌╌ (eventos) ╌╌ Atendimentos, Avaliacoes
Notificacoes  ◄╌╌ (eventos) ╌╌ Atendimentos, Participantes
```

As setas tracejadas são a única comunicação por evento — e é intencional: nenhum
módulo do núcleo importa `GamificacaoModule` nem `NotificacoesModule`.
`EditaisModule` é folha no outro sentido: ele importa (`Cursos`, `Disciplinas`,
e os models `Professor`/`Aluno` para leitura), mas ninguém o importa. A seleção
**termina** quando o professor cadastra o aprovado pelas rotas que já existem —
não há automação ligando inscrição aprovada a `usuarios`, por exigência do
escopo. `EmailModule` não aparece no grafo porque é `@Global()`.

---

## E-mail

[`src/modules/email/`](src/modules/email/) traz `EmailService`, o ponto único de
saída de e-mail da aplicação. Sem `BREVO_API_KEY` ou `EMAIL_REMETENTE_EMAIL` ele
opera em **modo log**: registra o que teria enviado, devolve `false` e não toca
na rede — comportamento padrão em desenvolvimento.

**Provedor: Brevo**, pelo plano gratuito permanente — 300 e-mails/dia
(~9.000/mês), API transacional e SMTP, sem exigir cartão. O volume de uma
plataforma de monitoria cabe nisso com folga.

**O e-mail é obrigatório em produção.** Com `NODE_ENV=production` e as variáveis
vazias, a aplicação **se recusa a subir**. Não é zelo excessivo: a senha de um
usuário novo e o código de recuperação só chegam por e-mail, então uma instalação
sem ele criaria contas que ninguém consegue acessar e não teria como recuperar
nenhuma senha — falha silenciosa, descoberta pelo usuário final. Em
desenvolvimento o modo log continua valendo.

O despacho HTTP **já foi exercitado contra a API real do Brevo**: com as
variáveis preenchidas, o provedor aceitou a mensagem (`E-mail enviado para ...`
no log). O que isso comprova é a chamada — URL, cabeçalhos, payload e
autenticação. *Entrega* na caixa do destinatário é outra coisa e depende do
endereço existir e do remetente estar verificado no painel do Brevo.

> ⚠️ **`npm run test:fluxo` dispara e-mails de verdade** quando o servidor sob
> teste está com o Brevo configurado. Cada execução cria 4 contas e pede uma
> recuperação — cinco mensagens para endereços `@ufx.edu.br` que não existem,
> que **viram bounce** e consomem a cota de 300/dia. Taxa de bounce alta
> prejudica a reputação do remetente e o Brevo pode suspender a conta.
>
> Rode o fluxo contra um servidor **sem** e-mail configurado — e, para exercitar
> também a seção de notificações, com elas ligadas:
>
> ```bash
> NOTIFICACOES_HABILITADAS=true BREVO_API_KEY= EMAIL_REMETENTE_EMAIL= npm run start:dev
> ```

```
BREVO_API_KEY=            # vazio = modo log
EMAIL_REMETENTE_EMAIL=    # precisa ser verificado no painel do Brevo
EMAIL_REMETENTE_NOME=Plataforma de Monitoria
```

Não há flag separada de liga/desliga: duas chaves capazes de se contradizer
("habilitado, mas sem chave") são uma fonte de confusão a mais. **A presença da
credencial é a decisão.** O estado aparece no log do boot, para que "o e-mail
não chegou" não vire investigação.

### Duas decisões que valem registro

**`enviar` nunca lança.** É a mesma política da gamificação, pelo mesmo motivo:
e-mail é canal lateral. Se a notificação de um atendimento agendado falhar, o
atendimento continua agendado. Deixar a exceção subir daria ao provedor de
e-mail poder de veto sobre regra de negócio. Quem precisa saber do resultado lê
o retorno (`boolean`); quem não precisa pode ignorar.

**O corpo da mensagem nunca vai para o log.** Destinatário e assunto bastam para
acompanhar o fluxo; a recuperação de senha carrega um código de troca de senha
dentro do corpo, e log costuma ser o lugar menos protegido da operação — em
produção vai para agregadores que muita gente lê.

O acoplamento com o provedor fica inteiro em
[`mensagem-email.ts`](src/modules/email/mensagem-email.ts) (formato) e no método
`despachar` (protocolo). Trocar de provedor não alcança quem chama.

---

## Edição de dados básicos

Três entidades aceitam edição, e o que **não** é editável em cada uma é a parte
que importa:

| Rota | Edita | Não edita, e por quê |
|---|---|---|
| `PATCH /api/disciplinas/:id` | `nome`, `ativa` | `codigo` — gerado e imutável; monitorias e materiais já o referenciam como identidade estável |
| `PATCH /api/monitorias/:id` | `descricao`, `dataInicio`, `dataFim` | `disciplinaId`, `ano`, `semestre` — identidade da oferta; `status` muda por `/ativar`, `/encerrar`, `/cancelar` |
| `PATCH /api/atendimentos/:id` | `assunto`, `local`, `vagas` | `inicio`/`fim` — mudam só por `/reagendar`; `status` — por `/realizar` e `/cancelar`; `modalidade` — definida no agendamento |

### Por que o horário fica fora do PATCH

Permitir `inicio`/`fim` aqui seria um atalho que contorna as quatro coisas que o
reagendamento faz: validar a janela de disponibilidade do monitor, recusar
conflito na agenda dos inscritos (RN03), registrar a transição no histórico
(RN10) e avisar quem já estava inscrito. É a mesma razão pela qual `/realizar` e
`/cancelar` são operações de domínio e não um `PATCH` em `status` — e por isso
`PATCH` é o **único** verbo de edição genérica no módulo de atendimentos.

Mandar `inicio` no corpo devolve `400` pelo `forbidNonWhitelisted`, em vez de
ser ignorado em silêncio.

### Duas regras do PATCH de atendimento

**Só `AGENDADO` aceita edição.** Atendimento realizado é fato consumado: mudar o
assunto depois reescreveria o que aconteceu, e a avaliação de quem participou
passaria a se referir a outra coisa.

**`modalidade` não é editável.** Quem se inscreveu escolheu comparecer a uma
sessão presencial ou remota; virar a chave depois mudaria o compromisso assumido
sem que a inscrição fosse refeita. `local` continua editável, o que cobre o caso
real — corrigir a sala ou o link sem alterar a natureza do encontro.

**`vagas` não pode ficar abaixo do número de inscritos.** A inscrição é barrada
por `ocupadas >= vagas`; sem essa verificação, a edição seria a porta dos fundos
dessa regra, deixando a sessão num estado que nenhuma outra operação produz.

Editar não gera linha de histórico — `atendimento_status_historico` registra
mudança de **estado**, e assunto, local e vagas não são estado. A
trilha dessas edições fica em `logs_requisicao`, que guarda corpo e autor.

---

## Trilha de requisições

`src/modules/logs/` grava uma linha em `logs_requisicao` por requisição
atendida: usuário, método, caminho, rota, status, duração, corpo, query,
resposta, erro, IP e user-agent.

Não é auditoria de domínio — *quem alterou o quê* já está nas próprias tabelas
(`atendimento_status_historico`, `criado_por_usuario_id`,
`habilitado_por_usuario_id`), com integridade garantida por FK. Esta tabela é
sobre o **transporte**: diagnosticar integração com o frontend e investigar
acesso indevido.

### A redação é o ponto mais importante

Gravar o corpo cru colocaria em texto claro, numa tabela que qualquer `SELECT`
alcança, exatamente o que o resto do projeto protege: a senha que o argon2
existe para nunca armazenar, o código de recuperação que só vive como hash, e o
token que dá acesso à conta.

```
POST /api/auth/login
corpo    -> {"email":"joao.ribeiro@ufx.edu.br","senha":"[REDACTED]"}
resposta -> {"tokenDeAcesso":"[REDACTED]","tipoToken":"Bearer",...}
```

A regra é **por nome de campo, em qualquer profundidade**, e cobre as três
grafias de senha que a API aceita (`senha`, `senhaAtual`/`novaSenha`,
`senhaProvisoria`), além de `codigo`, `token` e `authorization`. A lista é de
exclusão: campo desconhecido passa. O inverso seria mais seguro e tornaria o log
inútil — todo campo novo nasceria censurado sem ninguém perceber.

`codigo` também censura o código da disciplina. Falso positivo aceito de
propósito: é preferível ao inverso.

### Interceptor e filtro, divisão não óbvia

No Nest, **um guard que rejeita impede o interceptor de rodar**. Um interceptor
sozinho nunca veria `401` nem `403` — justamente as requisições que mais
interessam numa trilha de acesso.

| Caminho | Quem registra |
|---|---|
| Sucesso | `LogRequisicaoInterceptor` |
| Qualquer erro (inclusive de guard) | `TodasExcecoesFilter` |

Juntos cobrem tudo sem duplicar: o interceptor não tem `catchError`, senão todo
erro de handler seria gravado duas vezes. O `MarcarInicioMiddleware` existe só
para carimbar o instante de entrada — middleware roda antes dos guards, e é o
único ponto que enxerga o início de *toda* requisição.

O `LogsService` é injetado no filtro com `@Optional()`: tratamento de erro não
pode depender de um recurso acessório, então remover o `LogsModule` desliga o
log sem quebrar a tradução de exceções.

### Duas regras do módulo

**Registrar log nunca derruba nem atrasa uma requisição.** Toda falha é engolida
com aviso — banco de log indisponível não pode transformar uma API saudável em
`500` — e a escrita não é aguardada: o cliente não espera um `INSERT` que não
tem relação com a resposta dele.

**O usuário vem do token, nunca do corpo.** `request.user` é populado pelo
`JwtAuthGuard`; um `usuarioId` forjado no corpo não contamina a trilha.

### A coluna `rota`

Além do caminho concreto (`/api/alunos/abc-123`), guarda-se o padrão
(`/api/alunos/:usuarioId`). Sem ele, *"quais rotas mais falham?"* seria uma
consulta sobre milhares de caminhos únicos, um por id. Em `404` fica nula — o
que também é informação: ninguém reconheceu aquele caminho.

> ⚠️ **A tabela cresce sem limite.** Não há política de retenção: uma linha por
> requisição, para sempre. Antes de uso prolongado, defina um descarte (por
> exemplo, `DELETE` do que passar de 90 dias, via rotina ou `pg_cron`). É a
> pendência conhecida deste módulo.

---

## Notificações por e-mail

Módulo folha (`src/modules/notificacoes/`): ninguém o importa. Ele escuta eventos
do núcleo e roda rotinas próprias. Removê-lo do `AppModule` desliga os avisos sem
quebrar compilação nem regra de negócio — os `emit` continuam acontecendo, apenas
sem ouvinte. Mesma propriedade da gamificação.

### Os sete tipos

O critério para um tipo existir: **a pessoa precisa fazer algo diferente por ter
recebido**. Aviso que não muda comportamento é ruído, e ruído em e-mail
transacional tem custo — quem marca como spam derruba a entrega do que importa.

| Tipo | Gatilho | Quem recebe | Por quê |
|---|---|---|---|
| `LEMBRETE_DIA` | rotina, 30 em 30 min | monitor + inscritos | o atendimento é hoje — **texto diferente para cada lado**, ver abaixo |
| `ATENDIMENTO_CANCELADO` | evento | inscritos + monitor | sem isso a pessoa se desloca à toa |
| `ATENDIMENTO_REAGENDADO` | evento | inscritos + monitor | a inscrição é preservada (B5): a pessoa segue marcada num horário que não escolheu |
| `MONITOR_HABILITADO` | evento | o aluno promovido | RN01: ele passa a ter deveres por ato do professor |
| `ATENDIMENTO_SOLICITADO` | evento | o monitor | compromisso novo na agenda dele |
| `ATENDIMENTO_OFERTADO` | evento | monitorados ativos | é o que faz a oferta circular |
| `AVALIACAO_PENDENTE` | evento | presentes | fecha o ciclo da RN05/RN06 |

`AVALIACAO_PENDENTE` reaproveita o evento `atendimento.realizado` que a
gamificação já consumia — **nenhuma emissão nova foi precisa no núcleo** para
esse tipo.

### O lembrete tem dois textos

`LEMBRETE_DIA` é o mesmo fato para os dois lados do atendimento, mas eles
precisam de coisas diferentes:

| | Monitorado | Monitor |
|---|---|---|
| Assunto | "voce tem atendimento hoje" | "voce conduz um atendimento hoje" |
| Linha `Monitor(a):` | sim | **não** — é ele |
| Instrução | cancele sua inscrição para liberar a vaga | cancele ou mude o horário; os inscritos são avisados |
| Extra | — | **número de inscritos** |

Dizer "cancele sua inscrição" a quem conduz o atendimento seria instrução
impossível: ele não tem inscrição. E "Monitor(a): Ana Monitora" num e-mail
endereçado a Ana denuncia uma mensagem escrita para outra pessoa.

O número de inscritos é o dado que muda o que o monitor faz — preparar material
para um ou para oito, ou cancelar quando ninguém se inscreveu (nesse caso o
texto diz isso em palavras e sugere cancelar, em vez de exibir `Inscritos: 0`).

Não virou um segundo valor no enum: é o mesmo fato, e a chave de idempotência
`(tipo, referencia_id, usuario_id)` já separa por pessoa. O papel de quem recebe
viaja em `ContextoDaMensagem`, e o lembrete do dia é o único tipo que ramifica
por ele.

### Todo aviso leva a uma página

O corpo termina com um link para o frontend, montado a partir de `URL_FRONT`:

| Tipo | Destino | Chamada |
|---|---|---|
| `LEMBRETE_DIA` | `/atendimentos/{id}` | Ver atendimento |
| `ATENDIMENTO_CANCELADO` | `/atendimentos/{id}` | Ver detalhes |
| `ATENDIMENTO_REAGENDADO` | `/atendimentos/{id}` | Ver atendimento |
| `ATENDIMENTO_SOLICITADO` | `/atendimentos/{id}` | Ver atendimento |
| `ATENDIMENTO_OFERTADO` | `/atendimentos/{id}` | Inscrever-se |
| `AVALIACAO_PENDENTE` | `/atendimentos/{id}` | Avaliar atendimento |
| `MONITOR_HABILITADO` | `/monitorias/{id}` | Acessar a monitoria |

A regra mora em `montarLink`, função pura em `mensagens.ts` — não espalhada
pelos textos. **O link não usa `referencia_id`**: em avisos de transição a
referência é a linha de histórico, e `/atendimentos/{idDoHistorico}` daria 404
em quem clicasse. Sem o id esperado, o link cai na raiz do sistema em vez de
produzir `/atendimentos/undefined`, que não teria conserto depois de enviado.

`URL_FRONT` é separada de `CORS_ORIGINS` apesar de normalmente coincidirem:
aquela é uma *lista* de origens que o navegador pode usar para chamar a API,
esta é *uma* URL canônica para montar link clicável.

### O tipo é enum no banco, não `varchar` + CHECK

```sql
CREATE TYPE enum_notificacoes_tipo AS ENUM ('LEMBRETE_DIA', ...);
```

Diverge da convenção do resto do projeto, onde todo enum é `varchar` com `CHECK`.
Vale saber o preço: acrescentar um tipo passa a exigir `ALTER TYPE ... ADD VALUE`
em migration, e **remover** um tipo exige recriar o tipo inteiro. Com `CHECK`
bastaria trocar a constraint.

O nome segue a convenção do Sequelize (`enum_<tabela>_<coluna>`) de propósito: é
o nome que o ORM assume ao gerar casts para colunas `ENUM`. Batizar diferente
faria a aplicação referenciar um tipo inexistente em runtime.

### Reservar antes de enviar

Todo aviso passa pelo mesmo caminho: **reservar a linha → enviar → marcar como
enviada**. A ordem não é estilo.

```sql
UNIQUE (tipo, referencia_id, usuario_id)
```

Reservar primeiro é o que torna o envio único mesmo com duas instâncias: a
segunda perde para a constraint e **nem chega a montar a mensagem**. Se a ordem
fosse "enviar e depois registrar", as duas enviariam antes de descobrir a
duplicata. É o mesmo padrão de idempotência já usado em `pontuacao_eventos`.

O corpo da mensagem fica gravado na linha. Isso resolve o reenvio: uma
indisponibilidade do Brevo deixa a linha com `enviado_em` nulo, e a rotina de
reenvio (10 em 10 min, até 5 tentativas) a recolhe sem precisar reconstruir a
mensagem a partir de um estado que pode ter mudado. De quebra, responde
"o aluno foi avisado do cancelamento?" — pergunta que só aparece depois do fato.

### O cancelamento é a exceção: os destinatários viajam no evento

Todos os tipos descobrem os destinatários consultando o banco. `ATENDIMENTO_CANCELADO`
**não pode**, e a razão é de ordem de execução:

```
transação: colhe inscritos → cancela atendimento → cancela inscrições → commit
                                                                          ↓
                                                              emite o evento
```

Cancelar um atendimento também cancela as inscrições, para liberar a agenda dos
alunos (a `EXCLUDE` só ignora quem está fora de `INSCRITO`/`PRESENTE`). Quando o
ouvinte roda, **não existe mais nenhum `INSCRITO` para consultar** — o aviso
chegaria só ao monitor, e se fosse o próprio monitor cancelando, não chegaria a
ninguém.

Por isso `AtendimentoCanceladoEvento` carrega `inscritosUsuarioIds`, colhido
dentro da transação **antes** do update. Continua sendo só ids, como manda a
convenção de `eventos.ts`; o que muda é que esta é uma informação que deixa de
existir, e o único instante em que ela pode ser capturada é aquele.

### A armadilha da chave de transição

Para `LEMBRETE_DIA` a referência é o atendimento: avisa-se uma vez e pronto.

**Para transição de status, não pode ser.** Um atendimento pode ser reagendado
duas vezes. Com `referencia_id = atendimento_id`, o segundo reagendamento seria
engolido pela `UNIQUE` — o sistema *acharia* que avisou e ninguém receberia o
novo horário. A referência é o **id da linha de `atendimento_status_historico`**,
que é append-only e portanto única por transição. A tabela criada para a RN10
serve de chave de idempotência sem nenhuma adaptação.

### "Hoje" é o dia da instituição

```sql
AND (a.inicio AT TIME ZONE :fuso)::date = (now() AT TIME ZONE :fuso)::date
```

Com `TIMEZONE_INSTITUICAO=America/Porto_Velho` (UTC−4), um atendimento às 20h do
dia 13 é 00h UTC do dia 14. Comparar datas em UTC anunciaria esse atendimento no
dia errado — e só no fim da tarde, que é quando ninguém está olhando. A conversão
fica no PostgreSQL, como já faz a validação de disponibilidade.

### Desligado por padrão

`NOTIFICACOES_HABILITADAS=false` é o padrão, deliberadamente. Um recurso que envia
e-mail sozinho não deve nascer ligado: numa base de desenvolvimento cheia de
contas de teste com endereços inexistentes, ligar sem querer gera uma rajada de
bounces que consome cota e prejudica a reputação do remetente.

Para experimentar com segurança, suba sem credencial do Brevo (modo log):

```bash
NOTIFICACOES_HABILITADAS=true BREVO_API_KEY= EMAIL_REMETENTE_EMAIL= npm run start:dev
```

### Como testar sem esperar amanhecer

A condição de disparo do lembrete é "ser hoje", o que torna o recurso
intestável pelo relógio. O gatilho manual resolve:

```bash
npm run build
NOTIFICACOES_HABILITADAS=true BREVO_API_KEY= npm run enviar-lembretes
```

Ele sobe um contexto Nest **sem servidor HTTP** (nenhuma porta ocupada, roda com
a aplicação de pé) e executa as duas rotinas na hora. Serve também em operação:
se a aplicação ficou fora do ar na janela em que os lembretes sairiam, este
comando os recupera — e o registro no banco impede que alguém receba duas vezes.

Para forçar um atendimento "de hoje", empurre um `AGENDADO` para daqui a pouco
direto no banco, como já faz o `viajarNoTempo` do fluxo:

```sql
UPDATE atendimentos SET inicio = now() + interval '1 hour',
                        fim    = now() + interval '2 hours'
 WHERE id = '<id de um atendimento AGENDADO>';
```

### Nada escapa do módulo

Os ouvintes rodam fora da requisição que os originou: uma exceção ali não tem
para onde subir e viraria `unhandledRejection`, que derruba o processo. Toda ação
passa por um envelope que registra a falha e segue. **Um atendimento cancelado
continua cancelado mesmo que o aviso falhe** — mesma política da gamificação e do
`EmailService`.

---

## Curso, e a regra que ele introduz

`CURSO` tem a mesma forma de `DISCIPLINA` — nome livre, código gerado e
imutável, `ativo` em vez de `DELETE` (RN10). O CRUD é do professor:

```
POST  /api/cursos        { nome }            -> codigo gerado (ENG001)
GET   /api/cursos        ?busca= &ativo=
GET   /api/cursos/:id
PATCH /api/cursos/:id    { nome?, ativo? }   -> codigo nunca muda
```

**Uma disciplina pode ser de vários cursos** — "Banco de Dados" é de Sistemas de
Informação *e* de Engenharia da Computação, com um cadastro só. **Cada aluno
pertence a um curso. E um aluno só participa de monitoria de disciplina
oferecida no seu curso** — para os dois papéis, porque monitorar pressupõe ter
cursado a disciplina.

Uma monitoria de Banco de Dados atende alunos dos dois cursos: não é preciso
criar uma por curso.

### A regra é garantida pelo banco, não pelo service

Seguindo AD-05 e o mesmo recurso que já sustenta RN01, RN02 e RN04, a regra vira
uma cadeia de **FKs compostas**:

```
monitoria_participantes (aluno_id, curso_id)          -> alunos            (usuario_id, curso_id)
monitoria_participantes (monitoria_id, disciplina_id) -> monitorias        (id, disciplina_id)
monitoria_participantes (disciplina_id, curso_id)     -> disciplina_cursos (disciplina_id, curso_id)
```

Lidas juntas: o curso do vínculo é o do **aluno**; a disciplina do vínculo é a
da **monitoria**; e o par (disciplina, curso) tem de existir na associação. Logo
o curso do aluno está entre os cursos da disciplina — **e não há `INSERT` direto
que viole isso**, nem só pela API. Verificado com SQL cru, fora da aplicação:

| Tentativa | Constraint que recusou |
|---|---|
| aluno de curso que não oferece a disciplina | `fk_participante_disciplina_curso` |
| forjar o curso do vínculo | `fk_participante_aluno_curso` |
| forjar a disciplina do vínculo | `fk_participante_monitoria_disciplina` |
| trocar o curso de aluno que já participa | `fk_participante_aluno_curso` |
| remover associação disciplina-curso em uso | `fk_participante_disciplina_curso` |

A checagem no service existe para dar mensagem decente, não para garantir.

`curso_id` e `disciplina_id` aparecem denormalizados em
`monitoria_participantes` porque uma FK composta só referencia colunas da
própria linha. Não é dado solto: o `ON UPDATE CASCADE` propaga da origem, como
já acontece com `inicio`/`fim` das inscrições.

### Filtrar por curso

`GET /api/disciplinas?cursoId=` e `GET /api/alunos?cursoId=` restringem a
listagem a um curso. No caso das disciplinas o filtro é de **pertinência** (a
disciplina aparece se o curso estiver entre os dela) e é feito por subconsulta,
não por `where` dentro do `include` — este último transformaria o join em
`INNER` e faria cada disciplina voltar **só com o curso filtrado**, afirmando
que Banco de Dados pertence a um curso só. Filtrar quais itens aparecem é
diferente de filtrar o conteúdo de cada item.

### Consequência: trocar o aluno de curso

Fica bloqueado enquanto existir **qualquer** participação dele — inclusive
encerrada, já que a RN10 preserva histórico para sempre. Mudar o curso depois
reescreveria o passado, afirmando que uma monitoria cursada ocorreu em um curso
em que ela não ocorreu. `PATCH /api/alunos/eu` devolve `409` explicando quantas
participações existem.

### O que mudou nos contratos

| Antes | Agora |
|---|---|
| `POST /api/alunos` com `curso` (texto livre, opcional) | `cursoId` (uuid, **obrigatório**) |
| `POST /api/disciplinas` com `{ nome }` | `{ nome, cursosIds: [...] }` — pelo menos um curso |
| `PATCH /api/alunos/eu` com `curso` | `cursoId` |
| `PATCH /api/disciplinas/:id` | aceita `cursosIds`, que **substitui** o conjunto |
| resposta de disciplina | ganhou `cursos: [{ id, codigo, nome }]` |
| `aluno.curso` na resposta: texto digitado | **nome do curso vinculado** (campo preservado), com `aluno.cursoId` ao lado |

A coluna `alunos.curso` foi removida: mantê-la ao lado do FK faria a informação
divergir, e o valor nunca foi confiável — eram textos digitados à mão, como
"si" e "Engenharia".

---

## Código da disciplina

`POST /api/disciplinas` recebe **só o nome**. O código é gerado pelo servidor no
formato **prefixo + sequência**:

| Nome | Código |
|---|---|
| Cálculo I | `CAL001` |
| Cálculo I (segunda vez) | `CAL002` |
| Álgebra Linear | `ALG001` |
| Introdução à Computação | `INT001` |
| IA | `IAX001` |
| 101 | `DIS001` |

Antes era campo livre, com convenção diferente por professor (`MAT101`,
`mat-101`, `CALCULO1`) e colisão que só aparecia como `409` depois do formulário
preenchido. Enviar `codigo` hoje devolve `400` — melhor que ser ignorado em
silêncio. O código continua **imutável** depois de criado: monitorias e materiais
já publicados o referenciam como identidade estável.

O prefixo sai do nome normalizado: `NFD` separa a letra do acento e a faixa
combinante é removida, de modo que "Álgebra" e "Algebra" caem no mesmo `ALG`.
Nomes curtos são completados com `X` para manter a largura fixa, e um nome sem
letra nenhuma cai em `DIS`.

### Unicidade sob concorrência

Ler o maior número e inserir não são atômicos, e torná-los atômicos exigiria
serializar a criação de disciplinas. A escolha é a mesma do resto do projeto: **o
banco é a última linha de defesa**. A constraint `UNIQUE` recusa o código
repetido, o service tenta de novo (até 3 vezes) e, na segunda volta, a consulta
já enxerga a linha que ganhou a corrida. Só a colisão de código justifica nova
tentativa — qualquer outro erro sobe, para não transformar falha de banco em
laço inútil.

A largura do número acompanha a maior já usada no prefixo. Uma base que já tinha
`FIS0110` recebe `FIS0111`, não `FIS111`: os dois seriam únicos, mas uma família
com larguras misturadas é justamente o que o formato legível veio evitar.

> **Limitação, visível na sua base.** O prefixo vem do *nome*, não do
> departamento. Códigos como `MAT0101` para "Cálculo I" seguem convenção
> departamental, que nenhum gerador derivado do nome reproduz — "Cálculo I"
> passa a gerar `CAL001`. Códigos antigos continuam válidos e intocados; apenas
> não participam da numeração nova quando o prefixo difere.

---

## Recuperação de senha

Dois passos, código de 6 dígitos por e-mail:

```
POST /api/auth/recuperacao/solicitar   { email }                      -> 202 sempre
POST /api/auth/recuperacao/confirmar   { email, codigo, novaSenha }   -> 204
```

Não há uma terceira rota só para validar o código. Seria comodidade de tela e,
de quebra, um oráculo: permitiria testar códigos sem se comprometer com uma
senha. O frontend que queira duas telas guarda o código entre elas.

### As quatro defesas

| Defesa | Como |
|---|---|
| **Não revela quem tem conta** | `solicitar` responde `202` sempre, e `confirmar` devolve a **mesma** mensagem para código errado, expirado, já usado e e-mail inexistente. Conta desativada segue o mesmo caminho |
| **Nem de forma grosseira pelo tempo** | e-mail inexistente paga um argon2 descartável, como no login — sem isso a diferença seria ~1ms contra ~35ms. O envio não é aguardado, para que o tempo não dependa do provedor |
| **Resiste a força bruta** | 5 tentativas por código, depois ele queima. Com 6 dígitos, isso é 5 chances em 1.000.000 — o teto, não o tamanho do código, é o que sustenta a segurança |
| **O código não é recuperável do banco** | guarda-se o hash argon2id, como na senha. Uma cópia do banco não rende um código utilizável |

Mais: validade de 15 minutos, uso único, e pedir um código novo invalida o
anterior — garantido por **índice único parcial** (`uq_recuperacao_ativa_por_usuario`),
de modo que duas requisições simultâneas não conseguem deixar dois códigos
válidos para a mesma conta. Mesmo padrão da RN09.

Nada é apagado (RN10): `usado_em` e `invalidado_em` marcam o fim de vida do
código, e a linha permanece para auditoria — *quando* a troca foi pedida e
*quando* foi usada é exatamente o que se quer saber depois de um incidente.

#### Sobre o tempo de resposta, com medição

Não é tempo constante, e não adianta afirmar que é. Medindo a rota (3 rodadas,
processo reiniciado entre elas para zerar o throttler):

| Caminho | Tempo |
|---|---|
| e-mail inexistente | 34 ms · 41 ms · 34 ms |
| e-mail existente | 57 ms · 63 ms · 50 ms |

O argon2 descartável elimina a diferença *grosseira* — sem ele seriam ~1 ms
contra ~35 ms, legível em uma única requisição. O resíduo de ~20 ms vem das
escritas no banco do caminho real (invalidar o anterior, inserir o novo) e não
tem como sumir sem deixar de persistir o código. O que o torna pouco útil é o
teto de **3 requisições por minuto**: separar duas médias com essa diferença sob
ruído de rede exige muitas amostras, e o atacante tem três por minuto.

### Em desenvolvimento, sem Brevo configurado

O código só existe como hash no banco, então o fluxo seria impossível de testar
localmente. Para isso, ele é escrito no log — sob **duas** condições
simultâneas: e-mail não configurado **e** `NODE_ENV` diferente de `production`.
A segunda guarda é a que importa: sem ela, esquecer a chave do Brevo em produção
passaria a imprimir códigos de troca de senha no log.

### Limitação conhecida: tokens sobrevivem à troca

Redefinir a senha **não invalida sessões já abertas**. O JWT é stateless e não
há tabela de sessões (ver decisão 14), então um token emitido antes da troca
continua válido até expirar — no pior caso, 8 horas.

Isso importa no cenário clássico de recuperação: se a conta foi comprometida,
trocar a senha fecha a porta da frente, mas quem já estava dentro continua
dentro. A correção é pequena e conhecida — uma coluna `tokenVersion` em
`usuarios`, incluída no payload do token e conferida na `JwtStrategy`, que já
recarrega o usuário a cada requisição. Não foi feita aqui por ser mudança no
modelo de autenticação, não na recuperação de senha.

---

## Endpoints

Todas as rotas exigem `Authorization: Bearer <token>`, exceto as marcadas como
públicas.

**Existe exatamente um `DELETE` nesta API — e ele não apaga nada.**
`DELETE /api/editais/:id` marca `ativo = false`. O verbo está ali porque o
escopo da feature de editais pede "excluir edital" e é o que um cliente REST
espera; o efeito continua sendo transição de estado. Em todo o resto da API,
sair, cancelar, encerrar e remover também são transições de estado, sem verbo
`DELETE` (RN10 — nada de histórico é destruído).

### Metadados

| Método | Rota | Acesso |
|---|---|---|
| `GET` | `/api/configuracao` | **público** — fuso da instituição e limites de agendamento |

### Autenticação e usuários

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/auth/login` | público (**5 req/min**) |
| `POST` | `/api/auth/recuperacao/solicitar` | público (**3 req/min**) — envia código por e-mail |
| `POST` | `/api/auth/recuperacao/confirmar` | público (**10 req/min**) — troca a senha com o código |
| `GET` `PATCH` | `/api/usuarios/eu` | autenticado |
| `PATCH` | `/api/usuarios/eu/senha` | autenticado |
| `POST` | `/api/alunos` | **PROFESSOR** — único caminho de criação de aluno |
| `GET` | `/api/alunos` | **PROFESSOR** — `?busca=`, `?semVinculoAtivoNaMonitoria=` |
| `PATCH` | `/api/alunos/eu` | **ALUNO** |
| `GET` | `/api/alunos/:usuarioId` | PROFESSOR ou o próprio |
| `POST` | `/api/professores` | **PROFESSOR** — único caminho de criação de professor |
| `GET` | `/api/professores/publicos` | **público** — só id, nome e departamento (sem e-mail). `?busca=` em nome e departamento |
| `GET` | `/api/professores` · `/api/professores/:usuarioId` | autenticado — `?busca=` em nome, e-mail, identificação funcional e departamento |
| `PATCH` | `/api/professores/eu` | **PROFESSOR** |

### Cursos e disciplinas

| Método | Rota | Acesso |
|---|---|---|
| `POST` `PATCH` | `/api/cursos` · `/api/cursos/:id` | **PROFESSOR** |
| `GET` | `/api/cursos` · `/api/cursos/:id` | **público** — catálogo, sem dado pessoal |
| `POST` `PATCH` | `/api/disciplinas` · `/api/disciplinas/:id` | **PROFESSOR** |
| `GET` | `/api/disciplinas` · `/api/disciplinas/:id` | **público** — `?cursoId=` recorta por curso |

As quatro leituras de catálogo eram autenticadas e passaram a ser públicas com a
feature de editais: o formulário de inscrição precisa montar as listas de curso,
disciplina e professor **sem token**, porque o candidato ainda não tem conta. A
alternativa seria duplicar as três consultas em rotas públicas paralelas — o
endpoint redundante que o escopo manda evitar. Nenhuma delas expõe dado pessoal;
a de professores é a exceção e por isso ganhou projeção própria
(`/api/professores/publicos`, sem e-mail). **Toda a escrita continua restrita a
PROFESSOR.**

As duas listagens de professor aceitam `?busca=` (parcial, sem distinção de
caixa), com **escopos diferentes de propósito**:

| Rota | Campos varridos |
|---|---|
| `GET /api/professores` (autenticada) | nome, e-mail, identificação funcional, departamento |
| `GET /api/professores/publicos` | **nome e departamento, nada mais** |

A assimetria é de segurança, não de conveniência. A projeção pública omite o
e-mail para não entregar endereços a um anônimo; se a busca o aceitasse, isso
seria desfeito pelo outro lado — bastaria digitar `fulano@ufx.edu.br` e
descobrir, pelo acerto ou pelo vazio, se o endereço pertence a um docente. O
dado não apareceria na resposta, mas a resposta o **confirmaria**, e em
silêncio. É a mesma preocupação que faz `/auth/recuperacao/solicitar` responder
`202` para e-mail inexistente. A identificação funcional (SIAPE) fica fora pelo
mesmo motivo, agravado por ser dado administrativo.

O `fluxo-completo` verifica o par: o **mesmo** e-mail encontra na rota com token
e devolve zero na rota anônima.

### Monitorias

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/monitorias` | **PROFESSOR** — não aceita `professorId` (vem do token) nem `editalId` |
| `GET` | `/api/monitorias` · `/api/monitorias/:monitoriaId` | autenticado |
| `GET` | `/api/monitorias/minhas` | autenticado |
| `PATCH` | `/api/monitorias/:monitoriaId` | professor responsável |
| `POST` | `/api/monitorias/:monitoriaId/ativar` · `/encerrar` · `/cancelar` | professor responsável |

### Participantes

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/monitorias/:monitoriaId/monitores` | professor responsável (RN01) |
| `POST` | `/api/monitorias/:monitoriaId/monitorados` | professor responsável |
| `POST` | `/api/monitorias/:monitoriaId/inscricao` | **ALUNO** (auto-inscrição) |
| `GET` | `/api/monitorias/:monitoriaId/participantes` | participante ou responsável |
| `POST` | `/api/monitorias/:monitoriaId/participantes/:id/encerrar` | responsável ou o próprio |

### Disponibilidades

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/monitorias/:monitoriaId/disponibilidades` | **MONITOR** |
| `GET` | `/api/monitorias/:monitoriaId/disponibilidades` | **qualquer autenticado** (ver Decisões) |
| `POST` | `/api/monitorias/:monitoriaId/disponibilidades/:id/desativar` | **MONITOR** dono |

### Atendimentos

| Método | Rota | Acesso |
|---|---|---|
| `POST` `GET` | `/api/monitorias/:monitoriaId/atendimentos` | MONITOR ou MONITORADO / participante |
| `GET` | `/api/monitorias/:monitoriaId/atendimentos/horarios-livres` | autenticado — slots livres (**sugestão, não reserva**) |
| `POST` | `/api/monitorias/:monitoriaId/atendimentos/lote` | MONITOR ou MONITORADO — série recorrente, **sucesso parcial** (200) |
| `POST` | `/api/monitorias/:monitoriaId/participantes/:participanteId/promover-a-monitor` | professor responsável (RN01) |
| `GET` | `/api/atendimentos/meus` | autenticado |
| `GET` | `/api/atendimentos/:id` · `/:id/historico` | participante da monitoria |
| `POST` | `/api/atendimentos/:id/inscricao` · `/inscricao/cancelar` | MONITORADO |
| `POST` | `/api/atendimentos/:id/realizar` · `/cancelar` | monitor da sessão ou professor |

### Avaliações

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/atendimentos/:id/avaliacao` | MONITORADO presente (RN05/RN06) |
| `GET` | `/api/atendimentos/:id/avaliacoes` | participante da monitoria |
| `GET` | `/api/monitorias/:monitoriaId/monitores/:participanteId/avaliacoes` | participante |

### Materiais

| Método | Rota | Acesso |
|---|---|---|
| `POST` `PATCH` | `/api/monitorias/:monitoriaId/materiais` · `/:materialId` | professor responsável ou MONITOR autor (RN08) |
| `GET` | `/api/monitorias/:monitoriaId/materiais` · `/:materialId` | participante (RN07) |
| `POST` | `/api/monitorias/:monitoriaId/materiais/:materialId/remover` | autor ou responsável |

### Gamificação e analytics

| Método | Rota | Acesso |
|---|---|---|
| `GET` | `/api/gamificacao/regras` | autenticado — tabela de pontos |
| `GET` | `/api/gamificacao/ranking` | autenticado |
| `GET` | `/api/gamificacao/meus-pontos` | autenticado |
| `GET` | `/api/analytics/resumo` | **PROFESSOR** |
| `GET` | `/api/analytics/monitorias/:monitoriaId` | participante ou responsável |
| `GET` | `/api/analytics/monitorias/:monitoriaId/monitores` | professor responsável — inclui `cargaHorariaMinutos`/`Horas` |
| `GET` | `/api/monitorias/:monitoriaId/relatorio` | **MONITOR** com vínculo ativo — baixa o relatório final em `.docx` |

### Editais e inscrições

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/editais` | **PROFESSOR** |
| `GET` | `/api/editais` | **PROFESSOR** — `?ano=` `?semestre=` `?ativo=` `?direcao=` |
| `GET` | `/api/editais/abertos` | **público** — só os que aceitam inscrição hoje |
| `GET` `PATCH` | `/api/editais/:id` | **PROFESSOR** |
| `DELETE` | `/api/editais/:id` | **PROFESSOR** — exclusão **lógica** (`ativo = false`) |
| `POST` | `/api/editais/:editalId/inscricoes` | **público** (**20 req/min**) — `multipart/form-data` |
| `GET` | `/api/inscricoes` | **PROFESSOR** — filtros e ordenações abaixo |
| `GET` | `/api/inscricoes/resumo` | **PROFESSOR** — totais por disciplina (cabeçalho de acordeão) |
| `GET` | `/api/inscricoes/:id` | **PROFESSOR** |
| `GET` | `/api/inscricoes/:id/boletim` | **PROFESSOR** — devolve o PDF como anexo |
| `POST` | `/api/inscricoes/:id/aprovar` | **PROFESSOR** — cria a monitoria e habilita o monitor |

**Filtros de `GET /api/inscricoes`:** `editalId`, `cursoId`, `disciplinaId`,
`turno`, `professorId`, `ano` e `semestre` (do edital, por JOIN), `busca`
(parcial em nome, matrícula **ou** e-mail), `pagina`, `limite` (teto 100).

**Ordenações:** `media`, `n1`, `n2`, `nome`, `matricula`, `criadoEm` — cada uma
com `direcao=asc|desc`. Nota ausente vai **sempre para o fim** da lista, nas
duas direções.

`GET /api/inscricoes/resumo` aceita os **mesmos filtros** (sem paginação nem
ordenação) e devolve um total por disciplina. Ver *Agrupamento por disciplina*.

---

## Editais de seleção de monitores

[`src/modules/editais/`](src/modules/editais/) implementa o processo seletivo: o
professor publica o edital, qualquer pessoa se candidata **sem conta**, e a
banca consulta as candidaturas com filtros e ordenações.

É a primeira parte do sistema que aceita **escrita pública**, e isso define
quase todas as decisões abaixo.

### A candidatura não cria identidade

Nome, matrícula e e-mail do candidato são **colunas de `inscricoes_edital`**, não
FK para `alunos`. A ordem dos fatos exige isso: a conta do monitor é criada pelo
professor **depois** da aprovação, então exigir cadastro para se candidatar
inverteria o processo. `POST /api/editais/:id/inscricoes` não grava linha em
`usuarios` nem em `alunos` — o fluxo ponta a ponta verifica isso consultando as
duas tabelas após a inscrição.

Não existe FK opcional para `alunos`. Um candidato que já é aluno hoje seria
ligado, e um que se cadastrasse depois ficaria com a coluna nula para sempre — a
mesma pergunta teria duas respostas dependendo da ordem dos acontecimentos. O
cruzamento é feito na **leitura**, por matrícula, e aparece como
`alunoCadastrado` nas respostas do professor: é assim que ele sabe de quem não
precisa criar conta ao aprovar.

### A média é coluna gerada pelo PostgreSQL

```sql
media numeric(4,2) GENERATED ALWAYS AS (round((n1 + n2) / 2, 2)) STORED
```

A exigência era "o cliente não pode definir ou sobrescrever a média". Calcular no
service atenderia ao pedido pela via mais frágil possível — um seed, um script de
manutenção ou um `INSERT` direto furariam a garantia sem esforço. Coluna gerada é
**não-gravável pelo próprio banco**: o PostgreSQL recusa qualquer
`INSERT`/`UPDATE` que a mencione. O fluxo ponta a ponta tenta
`UPDATE inscricoes_edital SET media = 10` por SQL direto e registra a recusa.

São três barreiras independentes para a mesma regra: `media` não existe no DTO (e
mandá-la devolve `400` pelo `forbidNonWhitelisted`), o service não a menciona no
`create`, e o banco não deixa escrever.

**Nota ausente → média nula, nunca zero.** Em SQL, aritmética com `NULL` é
`NULL`, então a regra é consequência do tipo e não de um `if`. O ponto delicado
está no transporte: a inscrição chega como `multipart/form-data` por causa do
PDF, e ali um campo em branco chega como `''`. `@Type(() => Number)` converteria
isso em **zero** — o candidato apareceria na banca com uma nota que ninguém lhe
deu. Por isso a conversão é explícita (`notaInformada`) e `''` vira "não
informado".

E, como média nula não é média baixa, a ordenação usa `NULLS LAST` nas **duas**
direções: o padrão do PostgreSQL é `NULLS FIRST` em `DESC`, o que colocaria o
candidato sem nota como primeiro colocado.

### Curso × disciplina, garantido por FK composta

"A disciplina selecionada deve pertencer ao curso informado" é a mesma classe de
regra de RN01/RN02/RN04, e usa o mesmo recurso:

```
inscricoes_edital (disciplina_id, curso_id) -> disciplina_cursos (disciplina_id, curso_id)
```

O service faz a mesma pergunta antes, só para a resposta dizer *qual* curso e
*qual* disciplina não combinam, em vez de devolver uma violação de constraint.

### O PDF do boletim: BYTEA, em tabela separada

O projeto não tem camada de objetos (AD-12/D-19 prevê disco local, ainda não
implementado). Introduzir uma para este caso significaria adicionar provedor,
credenciais, política de expiração e um segundo lugar de onde o dado pode
desaparecer. O volume não justifica: um processo seletivo recebe dezenas a
centenas de candidaturas por semestre, com PDFs de poucas centenas de KB — ordem
de grandeza de MB por edital, dentro do que o backup lógico absorve sem mudança
de rotina.

O ganho concreto é transacional: o PDF entra e sai junto com a inscrição, no
mesmo `COMMIT`. Com objeto externo existiriam dois estados de falha que aqui
simplesmente não existem — arquivo gravado sem inscrição e inscrição gravada sem
arquivo.

**A tabela é separada, e isso é o que faz a decisão funcionar.** A listagem da
banca pagina candidaturas e nunca precisa dos bytes; se o `BYTEA` morasse na
mesma linha, qualquer consulta que não enumerasse colunas arrastaria megabytes
por página. Separado, o binário só é lido por quem faz o `JOIN` de propósito: uma
única rota, autenticada, que entrega um arquivo.

Validação do upload, em camadas que não se substituem:

| Camada | O que cobre |
|---|---|
| `limits.fileSize` no multer | corta o fluxo antes de encher a memória → `413` |
| `mimetype` no service | o tipo **declarado pelo cliente**; dá mensagem clara no caso honesto, mas não prova nada |
| assinatura `%PDF-` | está no **conteúdo**; é o que impede gravar um executável renomeado |

As duas últimas valem também no banco: `ck_boletim_pdf` confere a assinatura e
`ck_boletim_tamanho` exige `octet_length(conteudo) = tamanho_bytes` com teto de
5 MB. `conteudo` tem `STORAGE EXTERNAL` — PDF já é comprimido, e comprimir de
novo gasta CPU para ganhar quase nada.

O download sai com `Content-Disposition: attachment` (nunca `inline`: PDF
renderizado a partir do nosso domínio é superfície de execução de conteúdo de
terceiro), nome sanitizado no `filename` ASCII mais `filename*` em UTF-8, e
`Cache-Control: no-store`.

### O e-mail de confirmação, e por que não há outbox aqui

O envio acontece **depois do commit**, e sua falha não desfaz nada. É o inverso
da escolha feita na criação de usuário — e a diferença é que lá o e-mail
*entrega* a credencial, sem a qual a conta nasce inutilizável. Aqui ele apenas
*confirma* um fato já gravado: apagar a candidatura porque o provedor está fora
puniria o candidato por um problema nosso, e o prazo do edital pode nem permitir
nova tentativa. A resposta devolve `emailConfirmacaoEnviado` e o identificador —
que é o que ele precisa para cobrar a coordenação.

Não há outbox (ao contrário das notificações) porque **não há o que
desduplicar**: a mensagem é uma por candidatura, enviada em um ponto que só é
alcançado uma vez. Uma segunda tentativa do candidato é recusada pelo banco
(`UNIQUE (edital_id, matricula)` e `UNIQUE (edital_id, email)`) antes de qualquer
inserção — não há inscrição duplicada nem segundo e-mail. O e-mail não leva nota,
média nem o PDF: ele confirma um ato, não é comprovante de desempenho, e trafega
por servidor de terceiro.

### Exclusão de edital é lógica

`DELETE /api/editais/:id` marca `ativo = false`. O edital é o contexto das
candidaturas que ele recebeu; apagar a linha deixaria candidatos apontando para
um processo que o sistema afirma nunca ter existido, e a FK em
`inscricoes_edital` é `RESTRICT` — recusaria a remoção de qualquer forma (RN10).
É idempotente, e `PATCH { "ativo": true }` reativa.

Edital inexistente e edital excluído respondem **o mesmo `404`** na rota pública:
para quem não está autenticado, confirmar que um id existe mas foi retirado é
informação sobre a operação interna da instituição. Fora do período é `409` com
as datas, porque aí a informação é útil e não revela nada.

### "Hoje" é o dia da instituição

As datas do edital são `date`, não `timestamptz`: "inscrições de 10/11 a 25/11" é
uma afirmação sobre **dias do calendário local**, não sobre instantes. Guardar
instante obrigaria a escolher uma hora de corte arbitrária e faria o mesmo edital
abrir em dias diferentes conforme o fuso de quem lê.

Quem decide se hoje está no período é o PostgreSQL —
`(now() AT TIME ZONE :fuso)::date::text` —, o mesmo cuidado que disponibilidades
já tomam. O `::text` não é detalhe: sem ele o driver devolveria `date` como
`Date` à meia-noite do fuso do **processo**, reintroduzindo exatamente o fuso que
a consulta existe para tirar do caminho.

### Agrupamento por disciplina

Cada disciplina do edital vira **uma** monitoria, então a banca trabalha
disciplina por disciplina, não numa lista corrida.
`GET /api/inscricoes/resumo` devolve uma linha por disciplina — `totalInscricoes`,
`comMedia`, `semMedia` e `melhorMedia` — e é o **cabeçalho** de um acordeão: o
cliente desenha os grupos com ela e carrega os candidatos de cada um sob demanda
em `GET /api/inscricoes?editalId=…&disciplinaId=…`.

A divisão não é estética. O resumo tem tamanho limitado pelo catálogo de
disciplinas (dezenas de linhas minúsculas) e por isso **não é paginado**; a lista
de candidatos cresce sem teto e continua paginada no banco. Como o resumo não
pagina, reordenar no cliente ali é correto — ao contrário da lista, em que
ordenar dentro da página produz ordem errada assim que há mais de uma página.

A alternativa seria agrupar no navegador o que couber em uma página. É o que
quebra: com mais de 100 inscrições, o limite de página corta um grupo ao meio e
o ranking parcial **tem aparência de completo**. Esse era o defeito a eliminar.

Os dois endpoints aceitam **o mesmo conjunto de filtros**, e isso é estrutural:
`FiltroResumoInscricoesDto` é derivado de `FiltroInscricoesDto` com `OmitType`,
tirando só paginação e ordenação. Se os dois aceitassem conjuntos diferentes, o
total do cabeçalho não bateria com o conteúdo do grupo — e seria o cabeçalho a
mentir. Mandar `pagina`, `limite`, `ordenarPor` ou `direcao` no resumo devolve
`400` pelo `forbidNonWhitelisted`, em vez de ser aceito e ignorado em silêncio.

A consulta é SQL cru com `GROUP BY`, como em `AnalyticsService` — `findAndCountAll`
com `group` devolve `count` como **array** de grupos, não número. Os valores do
cliente saem por `replacements`; nenhum pedaço do texto da consulta vem da
requisição. O plano confirma que o índice criado para o filtro cobre o
agrupamento:

```
GroupAggregate
  Group Key: disciplina_id
  ->  Index Only Scan using ix_inscricao_edital_disciplina
```

Como uma pessoa só pode se inscrever uma vez por edital (`UNIQUE` em matrícula e
e-mail), os grupos são **disjuntos** e a soma dos totais é o total do edital — o
`fluxo-completo` verifica essa igualdade e, grupo por grupo, que cada total do
resumo é exatamente o que a listagem daquela disciplina devolve.

### Aprovação: a seleção vira monitoria

`POST /api/inscricoes/:id/aprovar` recebe **o id da inscrição e nada mais**.
Disciplina, curso, período e os dados da conta saem todos dela — o professor não
redigita nada, e por isso a monitoria não tem como nascer divergente da
candidatura que a originou.

São três passos, cada um **encontrar ou criar**:

| | Passo | Reaproveita quando |
|---|---|---|
1 | a **conta** do candidato | o e-mail da inscrição já tem conta |
2 | a **monitoria** da oferta | já existe para a mesma disciplina, professor, ano e semestre — reusada se vier deste edital, **adotada** se não tiver edital |
3 | o **vínculo de MONITOR** | nunca — é o único passo irrepetível |

A resposta diz, em cada um, o que de fato aconteceu (`monitoria.origem`,
`monitor.contaCriada`). Não é detalhe interno: é a diferença entre "abri a
monitoria de Banco de Dados", "acrescentei o segundo monitor" e "usei a
monitoria que você mesmo havia aberto" — e entre "a senha provisória foi
enviada" e "a conta já existia, nada foi enviado". O terceiro caso de
`origem` importa mais que os outros: a aprovação escreveu em um registro que
outra pessoa criou, e quem aprova tem o direito de saber disso.

#### Por que não é uma transação só

Os três passos committam separadamente. Torná-los atômicos exigiria passar
`transaction` por dentro de `UsuariosService.criarAluno`,
`MonitoriasService.criar` e `ParticipantesService.criarVinculo` — assinaturas de
três módulos que esta feature não tem motivo para reescrever. Pior: a criação da
conta **envia a senha por e-mail dentro da própria transação** (AD-15), e
estender essa transação manteria uma conexão aberta esperando um provedor
externo.

O que se faz no lugar é tornar a operação **repetível**. Falhando no meio, o
estado parcial é sempre um dos dois, e os dois se resolvem chamando o endpoint
de novo:

- conta criada, sem monitoria → o passo 1 a reaproveita;
- monitoria criada, sem monitor → o passo 2 a reaproveita.

O passo 3 é o único irrepetível e é o **último** de propósito: depois dele não
resta nada para dar errado. Repetir uma aprovação já concluída devolve `409` pela
RN09 — "este aluno já é monitor aqui" —, não um vínculo duplicado.

#### Reaproveitar a monitoria não é otimização

`uq_monitoria_oferta` é `UNIQUE (disciplina_id, professor_id, ano, semestre)`:
uma segunda monitoria da mesma oferta é **impossível** no banco. Sem o reuso,
uma disciplina com duas vagas travaria em `409` na segunda aprovação. O
resultado é o que o processo espera: uma monitoria por disciplina, com tantos
monitores quantos foram aprovados.

Como o banco garante **no máximo uma** monitoria por oferta, uma consulta basta.
Havendo uma, três caminhos — e a resposta diz qual, em `monitoria.origem`:

| `origem` | Quando | O que acontece |
|---|---|---|
`CRIADA` | não existia nada para a oferta | nasce agora, já com `edital_id` |
`REUSADA` | já existe, vinda **deste** edital | usada como está; é o segundo monitor da disciplina |
`ADOTADA` | existe **sem** edital | `edital_id` é gravado nela e ela é usada |

A **adoção** é o caso do professor que abre a monitoria à mão e só depois roda a
seleção — um fluxo legítimo. Recusar ali pediria trabalho manual sem razão de
domínio: a oferta é a mesma (mesma disciplina, mesmo professor, mesmo período) e
o banco garante que existe só uma.

Por que *gravar* `edital_id` em vez de só usar a monitoria: é essa coluna que o
resumo por disciplina consulta para dizer se o grupo foi resolvido. Usar sem
gravar deixaria a tela afirmando "pendente" com o monitor já habilitado —
inconsistência pior que a recusa que isso substitui. A adoção toca **uma** coluna:
dono, disciplina, período e status ficam como estavam, e o `fluxo-completo`
verifica que o responsável não muda.

Duas recusas sobram, as duas com razão de domínio:

- a oferta veio de **outro** edital → ela é o resultado de outro processo
  seletivo, e reescrever a procedência apagaria esse fato;
- a monitoria está **encerrada** ou **cancelada** → não aceita participante. A
  verificação vem **antes** da adoção, e a ordem é o ponto: adotar primeiro
  gravaria `edital_id` numa monitoria inutilizável, e o resumo passaria a
  mostrar "monitoria aberta, monitor pendente" — estado que sugere "tente de
  novo" quando nenhuma tentativa vai funcionar.

#### O responsável é o professor indicado na inscrição

A inscrição guarda um `professorId` — o professor que o **candidato** escolheu no
formulário público, e que vai supervisionar aquela disciplina. É dele que a
monitoria nasce. Quem aprova age como **banca**: registra o resultado da seleção,
não assume a monitoria.

Isso custou duas mudanças fora do módulo de editais, e as duas são visíveis:

- `professorId` passou a morar em `CriarMonitoriaDto` — **sem decorator de
  validação**. Esse é o mecanismo, não esquecimento: o `ValidationPipe` roda com
  `whitelist` e `forbidNonWhitelisted`, então propriedade sem decorator de
  validação não entra na whitelist e mandá-la devolve `400`. `@ApiHideProperty`
  impede o plugin CLI do Swagger de anunciar um campo que a API recusa;
- `POST /monitorias` passou a **injetar** o valor no controller, com o id do
  token. O efeito daquela rota não mudou — a monitoria continua sendo sempre de
  quem a criou —, mas a garantia saiu do service e virou responsabilidade do
  controller. Qualquer caminho novo que chame `criar` precisa decidir
  explicitamente de quem é a monitoria; não há default silencioso para cair.

A garantia de que o valor é de um professor de verdade continua sendo a FK
`monitorias_professor_id_fkey` → `professores(usuario_id)`.

Ano e semestre vêm do **edital**, não do relógio: uma aprovação feita em janeiro
cairia no semestre errado.

##### O que isso implica para a RN01

A RN01 diz que só o professor responsável habilita monitores, e a autorização
vive no `ParticipacaoGuard`, que protege `POST /monitorias/:id/monitores`. A
aprovação **não** passa por esse guard — ela chama `habilitarMonitor` direto —,
então aqui o monitor é habilitado por alguém que pode não ser o responsável.

É uma exceção deliberada, com o preço pago em auditoria em vez de em silêncio:
`habilitadoPorUsuarioId` grava **quem aprovou**, não o responsável. Quem olhar o
vínculo depois vê que o ato partiu da banca. O `fluxo-completo` verifica os dois
valores lado a lado: a monitoria é da Prof Maria, a habilitação está no nome de
quem conduziu a seleção.

Vale saber o que resta: um professor aprovando uma candidatura cria monitoria no
nome de um colega que não foi consultado. O `professorId` não é texto livre — vem
da inscrição, escolhido pelo candidato na lista pública de professores —, mas o
colega não autorizou. A contenção disponível, se algum dia for desejada, é exigir
que quem aprova **seja** o indicado; hoje isso não é exigido de propósito, para a
banca poder registrar os aprovados sem depender da agenda de cada docente.

#### Conta existente: reaproveitada, nunca alterada

A chave é o **e-mail**. Três casos de conta existente têm resposta diferente, e
nenhum cai em violação de constraint:

| Situação | Resposta |
|---|---|
já é ALUNO | reaproveita, sem tocar em nada dele |
existe, sem perfil ALUNO | `409` — não se promove um docente a monitor por efeito colateral |
existe e está inativa | `409` — monitor que não entra na plataforma não é monitor |
matrícula de outra conta | `409` nomeando o e-mail que ocupa a matrícula |

O **curso** do aluno existente não é sobrescrito pelo da inscrição. Divergindo,
quem recusa é a FK composta de `monitoria_participantes`, pela voz de
`exigirCursoCompativel` — reescrever o curso de alguém a partir de um formulário
público seria bem pior que recusar.

O último caso da tabela merece nota: a conta é resolvida por e-mail, mas a
matrícula também é única. Um candidato que se inscreveu com e-mail diferente do
da conta que já tem cairia em `alunos_matricula_key` — recusa verdadeira que não
diz o que fazer no fim de um processo seletivo. A mensagem nomeia o e-mail dono
da matrícula, que é a informação que resolve.

#### `monitorias.edital_id`

Coluna **nulável**: monitoria sem edital continua sendo o caminho normal, e
`POST /monitorias` não mudou em nada. Preenchida, diz que a monitoria nasceu de
uma aprovação — e é isso que permite ao resumo marcar o grupo como resolvido sem
confundir com uma monitoria que o professor abriu à mão no mesmo período.

Não existe `UNIQUE (edital_id, disciplina_id)`. Ela faria valer "cada disciplina
tem uma monitoria por edital", que é a leitura natural do processo, mas recusaria
no **momento da aprovação** o caso de dois candidatos da mesma disciplina que
indicaram professores diferentes — o pior momento possível para descobrir uma
regra. Como o serviço reaproveita a monitoria, o caso comum já resulta em uma só.

#### O que a aprovação **não** verifica

Nem que o período de inscrições encerrou, nem que o edital está ativo. Aprovar
acontece depois do processo, por definição; e `ativo = false` é a exclusão
lógica, cujo uso típico é tirar da vitrine um edital que **terminou**. Recusar
nesse estado inverteria a ordem natural: o professor encerraria o edital e
perderia a capacidade de registrar os aprovados dele.

#### Dependência do e-mail, que precisa estar às claras

Aprovar um candidato **sem conta** depende do provedor de e-mail estar de pé: a
senha provisória é entregue dentro da transação de criação e, falhando, a conta
não é criada e a aprovação devolve `503` (AD-15). Está correto — conta cuja senha
nunca chegou é conta inutilizável —, mas é uma dependência externa em cima de uma
operação administrativa.

Vale também o domínio institucional: a inscrição pública aceita e-mail de
qualquer domínio de propósito (o candidato pode não ter conta institucional), mas
a criação de usuário respeita `EMAIL_DOMINIOS_PERMITIDOS`. Com a variável
configurada, aprovar um candidato de e-mail pessoal devolve `400`.

#### No resumo por disciplina

`GET /api/inscricoes/resumo` ganhou três campos:

| Campo | Significado |
|---|---|
`monitoriaCadastrada` | existe monitoria **deste edital** para a disciplina **e** ela tem monitor |
`monitoriaId` | a monitoria vinda do edital, se houver — mesmo sem monitor ainda |
`monitoresHabilitados` | monitores ATIVOS nela |

As duas condições de `monitoriaCadastrada` andam juntas de propósito: monitoria
sem monitor é um passo pela metade — tipicamente uma aprovação interrompida — e
marcar o grupo como pronto nesse estado esconderia exatamente o caso que precisa
de atenção. Com `monitoriaId` preenchido e `monitoresHabilitados` em zero, a tela
pode oferecer "retomar".

A busca é uma **consulta separada**, não um join na agregada: juntar `monitorias`
e `monitoria_participantes` na consulta agrupada multiplicaria as linhas de
inscrição por monitor e inflaria `totalInscricoes` — erro silencioso, que nada
faria falhar.

#### Limite conhecido: disciplina sem candidato não aparece

E não é descuido da consulta. **O edital não declara quais disciplinas oferece** —
a tabela `editais` tem apenas período, link, ano, semestre e `ativo`, então o
conjunto de disciplinas de um edital é *derivado* das inscrições recebidas.

Na prática, o professor não distingue "ninguém se inscreveu em Cálculo I" de
"Cálculo I não faz parte deste edital". Resolver isso não é trabalho de consulta:
exige o edital passar a declarar suas vagas, em uma tabela `edital_disciplinas`.
Enquanto ela não existir, esta resposta é a lista do que **chegou**, não do que
foi **ofertado**.

### Escopo de acesso da banca

Todo **PROFESSOR** consulta todas as inscrições. Não é omissão: o perfil
PROFESSOR é institucional e não hierárquico (não existe ADMIN, e o conjunto de
professores se expande por decisão de quem já está dentro), e um processo seletivo
é conduzido por banca, não pelo professor que cada candidato indicou —
restringir a listagem ao `professorId` de cada inscrição impediria exatamente o
uso para o qual ela existe. O que existe é o **filtro** `professorId`, com que um
professor vê as candidaturas que o indicaram. Isso é recorte de consulta, não de
permissão.

Nenhuma rota pública devolve dado de candidato. `GET /editais/abertos` tem
projeção própria (sem `ativo`, sem timestamps) e a confirmação do `POST` devolve
apenas id, edital, nome e se o e-mail saiu — nem notas, nem média, nem metadado
do arquivo.

---

## Carga horária do monitor

`GET /api/analytics/monitorias/:monitoriaId/monitores` ganhou dois campos, **sem
remover nem alterar nenhum dos existentes**:

| Campo | Significado |
|---|---|
`cargaHorariaMinutos` | soma de `(fim - inicio)` dos atendimentos **REALIZADOS** do monitor |
`cargaHorariaHoras` | o mesmo valor em horas, com 2 casas, para exibição |

### Calculada sob demanda, sem coluna de duração

A alternativa era guardar a duração em `atendimentos`. **O schema já resolve
tudo o que uma coluna resolveria**, e é isso que decide a questão:

- `inicio` e `fim` são **NOT NULL** com `CHECK (fim > inicio)`. Não existe
  atendimento sem término nem intervalo invertido — os dois casos que o pedido
  manda excluir são **impossíveis**, não filtrados;
- `ex_monitor_sem_conflito` é um `EXCLUDE USING gist` sobre
  `(monitor_participante_id, tstzrange(inicio, fim))` com `WHERE status IN
  ('AGENDADO','REALIZADO')`. Dois atendimentos contáveis do **mesmo monitor** não
  podem se sobrepor. A soma é de intervalos disjuntos: não há tempo contado em
  dobro;
- não há `DELETE` em nenhum lugar da API (RN10), então "atendimentos excluídos"
  não existe como caso;
- `reagendar` altera `inicio`/`fim`. Uma coluna de duração passaria a precisar de
  sincronia, e derivada que pode divergir da origem é exatamente o que este
  projeto evita — quando guardar foi necessário (`inscricoes_edital.media`), só
  ficou confiável como `GENERATED ALWAYS`. E uma coluna gerada
  `(fim - inicio)` não adicionaria nada ao que `fim - inicio` já responde na
  leitura.

**Custo zero de consulta:** a soma entra no `GROUP BY` que já produz os outros
indicadores de cada monitor. Não há consulta por monitor — era o risco apontado
no pedido, e ele não existe aqui porque o indicador nasceu dentro da agregação
que já existia.

### Status considerados

Somente **REALIZADO**. `AGENDADO` é compromisso futuro (ou sessão que o monitor
ainda não registrou) e `CANCELADO` não aconteceu — e cancelado fica fora do
`EXCLUDE`, podendo sobrepor um realizado, o que é um segundo motivo para
excluí-lo.

### Arredondamento

A soma é feita em **segundos** no PostgreSQL e arredondada **uma vez**, no total.
Arredondar por atendimento acumularia erro. A unidade canônica é o **minuto**,
porque é exata: hora decimal não representa 1h20min sem dízima, e carga horária
que não fecha na conta de quem assina o relatório é pior que uma unidade menos
conveniente.

---

## Relatório final de monitoria (.docx)

```
GET /api/monitorias/:monitoriaId/relatorio     (somente o MONITOR)
```

Devolve o documento oficial preenchido, gerado **sob demanda** — nada é
armazenado. O relatório é uma fotografia dos dados no instante do download, e
guardar uma cópia criaria a pergunta "está desatualizada?" a cada atendimento
novo.

Disponível **a qualquer momento**, inclusive com a monitoria em andamento. Não há
nenhuma verificação de encerramento a remover se um dia essa restrição for
desejada.

### Autorização

`@ExigeParticipacao({ papeis: [MONITOR], professorResponsavel: 'NEGADO' })` sobre
o `ParticipacaoGuard`, o mesmo mecanismo de materiais e disponibilidades. O
vínculo vem do **token**; o relatório é do monitor autenticado. **Não existe
parâmetro de monitor em lugar algum** — trocar o id na URL muda a monitoria, e aí
o guard recusa.

O professor responsável também é recusado, e isso é decisão: o relatório final é
documento **pessoal** do monitor, que o professor assina como orientador no fim.
Com vários monitores na mesma monitoria, "o relatório do professor" seria ambíguo,
e resolver a ambiguidade exigiria um id de monitor na requisição — exatamente o
que esta rota evita. Mesmo critério do `DisponibilidadesController`, que também
nega o professor.

### Como o modelo é preenchido

O arquivo entregue é **o próprio modelo oficial**, versionado em
[`src/modules/relatorios/modelo/`](src/modules/relatorios/modelo/). Um `.docx` é
um ZIP de XMLs; a geração abre o pacote, troca **apenas** `word/document.xml` e
fecha. Cabeçalho com logotipo, estilos, tema, fontes, margens e bordas de tabela
voltam **byte a byte** como estavam — nenhuma linha de código descreve
formatação, porque nada é reconstruído.

A verificação confirma isso: o pacote gerado tem as **mesmas 22 entradas** do
modelo e **só** `word/document.xml` difere.

Não se usou `docxtemplater` (que exigiria marcar o modelo com `{placeholders}`)
porque o modelo é mantido e reenviado pela coordenação: uma versão nova chegaria
sem as marcações. Aqui a âncora é o **próprio rótulo visível** ("CURSO: "), então
um modelo atualizado continua funcionando — e quando um rótulo mudar, a aplicação
**se recusa a subir**, com a lista do que não casou. Isso é checado em
`onModuleInit`, pelo mesmo motivo do `EmailService`: defeito de configuração tem
de aparecer antes de produzir resultado errado, não meses depois num arquivo que
ninguém conferiu.

Também não se gerou o documento a partir de HTML nem de uma biblioteca de
construção (`docx`): as duas obrigariam a reescrever o layout, e cada divergência
seria descoberta por quem recebesse o relatório.

### Campos preenchidos automaticamente

| Campo do modelo | Origem |
|---|---|
Título (`... ACADÊMICA 2026-2`) | `monitorias.ano` e `semestre` |
`CURSO:` | curso do **monitor** (`alunos.curso_id`) — disciplina pertence a vários cursos, só o do aluno responde sem ambiguidade |
`DISCIPLINA:` | código e nome da disciplina da monitoria |
`PERÍODO:` | `data_inicio` a `data_fim` da monitoria, quando ambas existem |
`PROFESSOR-ORIENTADOR(A):` | nome do professor responsável |
`MONITOR(A):` | nome do monitor autenticado |
`MATRÍCULA DO ALUNO-MONITOR(A):` | `alunos.matricula` |
`EMAIL:` | `usuarios.email` |
Cabeçalho da tabela | carga horária acumulada + nº de atendimentos realizados |
Tabela, uma linha por atendimento | data + dia da semana, assunto, duração, presenças confirmadas |
`Porto Velho, ...` | data da geração, no fuso da instituição |
Nome e RA sob a assinatura | nome e matrícula do monitor |
`NOME DO PROFESSOR` | nome do professor responsável |

### Campos mantidos em branco — e por quê

| Campo | Motivo |
|---|---|
`TURNO:` | é da **turma** da disciplina. Turma não é entidade deste sistema |
`DIAS / HORÁRIOS DAS AULAS:` | idem. As disponibilidades do monitor são outra coisa |
`QUANTIDADE DE ALUNOS NA TURMA:` | idem. O nº de monitorados da monitoria é outro número, e trocar um pelo outro seria inventar |
`TELEFONE:` | não existe em `usuarios` |
`TITULAÇÃO DO PROFESSOR-ORIENTADOR(A):` | não existe em `professores` (`departamento` é outra informação) |
`ATIVIDADES REALIZADAS` (texto) | relato |
`BIBLIOGRAFIA E MATERIAL DE APOIO` | relato |
Colunas `OBSERVAÇÕES` e `Quantidade de Alunos` das linhas em branco | relato do monitor |
`Entrega:` e `Ciente e de acordo em __/__/__` | datas de atos que ainda não aconteceram |

Os dois últimos merecem nota: o modelo trazia **`Entrega: 01/12/2026`** e
**`01 / 12 /2025`** escritos à mão de semestres anteriores. São limpos, não
preservados — manter data errada em documento oficial é pior que deixar o campo
vazio.

### A tabela de atividades

Duas decisões visíveis no documento:

1. **Toda linha preenchida do modelo é descartada.** No modelo elas são exemplo
   ("Reforço da aula de Farmacologia da Esquizofrenia"), e um relatório oficial
   que chega com dados de outra pessoa é pior que um vazio. O critério é
   estrutural — linha com qualquer texto é exemplo, porque modelo preenchido não
   existe — e não uma lista de textos a remover;
2. **Sobram sempre 8 linhas em branco**, mesmo com muitos atendimentos. O
   relatório tem campos que só o monitor preenche, e as atividades que não
   viraram atendimento registrado (reunião com o orientador, preparo de
   material). Entregar a tabela cheia até a última linha obrigaria quem assina a
   inserir linhas no Word.

A linha em branco do modelo é o molde das linhas novas, então bordas, larguras e
alinhamento vêm do próprio documento.

A carga horária acumulada entra no **cabeçalho da tabela**, não como linha de
TOTAL: uma linha de total ficaria desatualizada no instante em que o monitor
acrescentasse uma atividade à mão — e o relatório existe para ser completado à
mão. No cabeçalho o número fica rotulado como o que é: *o que o sistema
registrou*.

### Download

`Content-Type` de documento Word, `Content-Disposition: attachment` com nome
gerado pelo servidor em ASCII
(`relatorio-monitoria-BAN001-2026-2-1214.docx`), e `Cache-Control: no-store`.

**O frontend precisa ler o `blob` da resposta e esse cabeçalho** — `fetch` +
`JSON.parse` produziria um arquivo corrompido, porque o corpo é binário.

### Dependência adicionada

**`jszip` 3.10.2** (MIT), única. Um `.docx` é um ZIP e o Node não traz leitor de
ZIP. Escolhida por ser a biblioteca mais estabelecida do ecossistema, trazer os
próprios tipos (sem `@types/*` extra) e não ter dependência nativa — importa para
um projeto que roda em Windows e em container Linux sem passo de compilação.
`npm audit` não a implica em nenhum aviso.

`nest-cli.json` ganhou `assets` para o `.docx` ser copiado para o `dist/`. Sem
essa entrada, `nest build` levaria apenas os `.js` e a geração falharia **somente
em produção**, no primeiro download.

---

## Gestão de usuários (sem perfil ADMIN)

O domínio não prevê um ator acima do professor, então **são os professores que
administram os usuários da plataforma**:

```
POST /api/alunos          { nome, email, matricula, curso? }
POST /api/professores     { nome, email, identificacaoFuncional?, departamento? }
```

**Não há campo de senha.** O servidor gera uma senha aleatória de 12 caracteres
e a envia ao e-mail da pessoa; quem cria a conta nunca vê a credencial, e ela
não aparece na resposta HTTP. Mandar `senhaProvisoria` devolve `400` pelo
`forbidNonWhitelisted` — melhor que ser ignorado em silêncio.

Estes são os **únicos** caminhos de criação de usuário: não há auto-cadastro. As
antigas rotas públicas `POST /api/auth/registro/aluno` e `/registro/professor`
foram removidas, e `/api/auth` passou a ter uma única rota — o login.

Com isso saiu também o `CODIGO_CADASTRO_PROFESSOR`. Ele existia para fechar o
auto-cadastro de professor, onde era a única barreira entre um desconhecido e o
perfil PROFESSOR, e tinha os defeitos de um segredo compartilhado: circulava por
fora do sistema, não identificava ninguém e não deixava rastro. A barreira que o
substitui é mais forte e nominal — estar autenticado como professor.

O primeiro professor, que por definição não pode ter sido criado por outro, nasce
fora da API (ver *O primeiro professor*, na instalação).

### O que isso implica, explicitamente

Sem ADMIN, **qualquer professor cria professores, e esses também poderão**. Não
há hierarquia contendo a expansão — o que existe é rastro: toda conta criada por
esse caminho grava `criadoPorUsuarioId`, e `GET /api/usuarios/eu` e as listagens
devolvem esse campo. É a mesma escolha já feita em
`monitoria_participantes.habilitado_por_usuario_id` para tornar a RN01 auditável.

Se um dia houver coordenação acima do professor, a contenção natural é um perfil
ADMIN restringindo `POST /api/professores` — e a trilha já estará lá para dizer
quem entrou por onde.

### A senha é gerada pelo servidor, não escolhida

Antes, quem criava a conta escolhia a senha — e ela nascia conhecida por duas
pessoas, sendo que a dona não tinha como saber se a outra a havia esquecido.
Agora a senha é gerada com `randomBytes` (CSPRNG, 12 caracteres em `base64url`,
sem `+ / =` que quebram ao copiar de um e-mail) e entregue direto no e-mail
cadastrado.

O e-mail termina com o link de acesso ao sistema, montado a partir de
`URL_FRONT`. Ele aponta para a **raiz**, não para `/login`: uma aplicação
autenticada redireciona quem não tem sessão para o próprio login, então a raiz
sempre funciona — `/login` seria palpite sobre uma rota do frontend, e link
quebrado em e-mail não tem conserto depois de enviado.

**Se o e-mail não puder ser entregue, a conta não é criada** — `503`, e o
registro é desfeito. Isso contraria a política geral de que e-mail não derruba
operação de domínio, e a contradição é aparente: aquela política vale para
*notificações*, avisos sobre algo que já aconteceu. Aqui o e-mail é o próprio
meio de entrega da credencial, e uma conta cuja senha não chegou a ninguém não é
uma conta com um aviso faltando — é uma conta inutilizável, que nem o professor
consegue consertar.

A entrega roda **dentro da transação**, depois dos `INSERT`. As duas posições
importam: dentro, porque é o que permite o rollback; depois, porque se o e-mail
já estiver cadastrado a constraint falha antes e nenhuma mensagem é enviada —
senão tentar recriar um usuário existente mandaria uma senha para a caixa dele.

**O backend ainda não força a troca no primeiro acesso.** Fazê-lo exigiria uma
coluna `deveTrocarSenha` e um guard que libera apenas a rota de troca enquanto
ela estiver marcada. Com a senha gerada e entregue só à pessoa, porém, a urgência
caiu: ninguém mais conhece a credencial além dela. Quem preferir pode simplesmente
usar a recuperação de senha para definir uma própria.

---

## Contrato para o frontend

### Fuso horário — a armadilha de integração mais provável

A disponibilidade do monitor é declarada em **hora local da instituição**
("terça, 14h–16h"); o atendimento é `TIMESTAMPTZ`. O servidor converte usando
`TIMEZONE_INSTITUICAO` antes de validar.

Se o cliente montar `inicio` a partir do fuso do **navegador**, o agendamento é
recusado com *"horário fora da disponibilidade"* e o usuário não entende o
motivo. Busque o fuso uma vez, no boot:

```
GET /api/configuracao
→ { "fusoHorario": "America/Porto_Velho",
    "agendamento": { "duracaoMinimaMinutos": 15, "duracaoMaximaMinutos": 240, ... } }
```

`inicio` e `fim` devem ir em ISO 8601 **com fuso** (`...Z` ou `...-03:00`).

### Sessão

`POST /api/auth/login` devolve `expiraEmSegundos` (para o `maxAge` do cookie) e
`expiraEmIso`, ambos derivados do claim `exp` do token assinado. O campo
`expiraEm` (`"8h"`) segue existindo por compatibilidade, mas está marcado como
deprecated — é a string de configuração, não um valor calculável.

Não há refresh token: o cliente deve tratar `401` reautenticando e preservando o
rascunho em tela.

### Campos derivados que o servidor já calcula

Não reimplemente estas regras no cliente:

| Campo | Onde | Por quê no servidor |
|---|---|---|
| `aceitaInscricao` | `AtendimentoRespostaDto` | Depende de `inicio > agora` — o relógio do navegador pode estar errado |
| `podeAvaliar` / `jaAvaliei` | própria inscrição, em `GET /atendimentos/:id` e `/meus` | Evita o clique que só descobre o `409` depois. Aparecem **apenas** na inscrição do requisitante: marcar as dos colegas revelaria quem avaliou |
| `meuPapel` / `meuParticipanteId` | `MonitoriaRespostaDto` | Vários endpoints pedem o id do **vínculo**, não do usuário |
| `criadoPorUsuarioId` | `UsuarioRespostaDto` | quem criou a conta. `null` apenas em conta de bootstrap, criada fora da API — não há auto-cadastro |
| `monitoria.disciplina` | `AtendimentoRespostaDto` | `GET /atendimentos/meus` cruza monitorias; sem isso seria um request por linha |

### Formato das listagens

**Paginadas** (`{ dados, meta }`): `/alunos`, `/professores`, `/disciplinas`,
`/monitorias`, `/monitorias/minhas`, `/monitorias/:id/participantes`,
`/monitorias/:id/atendimentos`, `/atendimentos/meus`, `/monitorias/:id/materiais`.

**Array simples**: `/monitorias/:id/disponibilidades`,
`/atendimentos/:id/historico`, `/gamificacao/ranking`,
`/analytics/monitorias/:id/monitores`.

A assimetria é deliberada: essas quatro são **limitadas por natureza** — faixas
semanais de um monitor, o histórico de um único atendimento, o top N do ranking
(o próprio parâmetro já limita), os monitores de uma monitoria. Envelopar
adicionaria um `meta` que nunca seria lido.

### Ordenação

Só as listagens de atendimento aceitam ordenação configurável
(`?ordenarPor=inicio|criadoEm&direcao=asc|desc`), porque são as únicas em que
duas leituras legítimas competem: agenda (próximos primeiro) e histórico
(recentes primeiro). As demais têm ordem fixa e adequada — disciplinas por nome,
materiais por recência, participantes por papel. **Limitação conhecida:** nelas o
cliente só consegue reordenar dentro da página atual.

---

## Formato de resposta

### Erro — idêntico em toda a API

```json
{
  "statusCode": 409,
  "erro": "Conflict",
  "mensagem": "Este monitor ja possui outro atendimento que se sobrepoe a este horario (RN03).",
  "detalhes": ["nota deve estar entre 1 e 5"],
  "caminho": "/api/monitorias/.../atendimentos",
  "timestamp": "2026-08-31T12:00:00.000Z"
}
```

`detalhes` só aparece em erros de validação. Um filtro global traduz violações de
constraint do PostgreSQL em mensagens de domínio — `ex_monitor_sem_conflito` vira
a frase acima, não um erro cru de banco. Erros inesperados viram `500` genérico:
stack trace vai para o log do servidor, nunca para o cliente.

### Listagem paginada

```json
{ "dados": [ ... ], "meta": { "total": 42, "pagina": 1, "limite": 20, "totalPaginas": 3 } }
```

---

## Regras de negócio

| RN | Regra | Onde é garantida |
|---|---|---|
| **RN01** | Só alunos habilitados pelo professor atuam como monitores | rota `/monitores` restrita ao responsável + FK composta com `papel` |
| **RN02** | Monitor habilitado para a disciplina correspondente | **estrutural**: monitoria → uma disciplina |
| **RN03** | Sem conflito de horários | `EXCLUDE USING gist` em `atendimentos` (monitor) e em `atendimento_participantes` (aluno) |
| **RN04** | Aluno associado à monitoria para participar | FK composta `(participante_id, monitoria_id, papel)` |
| **RN05** | Só o monitorado participante avalia | avaliação referencia a **inscrição**, não o atendimento |
| **RN06** | Avaliação só após conclusão | `AvaliacoesService` (status `REALIZADO` + presença) |
| **RN07** | Só participantes acessam materiais | `ParticipacaoGuard` + checagem de monitoria no service |
| **RN08** | Professores e monitores publicam | `@ExigeParticipacao({ papeis: [MONITOR] })` + autoria no service |
| **RN09** | Um aluno não acumula os dois papéis | índice único parcial `ux_participante_ativo` |
| **RN10** | Não destruir histórico | sem `DELETE` na API, soft delete, histórico de status |

### Ciclos de vida

```
MONITORIA    PLANEJADA ──► ATIVA ──► ENCERRADA
                  └──────────┴─────► CANCELADA

ATENDIMENTO  AGENDADO ──► REALIZADO
                  └─────► CANCELADO        (toda transição vira histórico)

INSCRIÇÃO    INSCRITO ──► PRESENTE | AUSENTE | CANCELADA
```

---

## Decisões arquiteturais

| # | Decisão | Motivo |
|---|---|---|
| 1 | **Papel como atributo da relação**, não tipo de usuário | é o requisito central do domínio; qualquer outra forma quebra o caso "monitor aqui, monitorado ali" e perde histórico |
| 2 | **Perfil derivado**, sem coluna `tipo` | impede o estado inconsistente "marcado como aluno sem linha em `alunos`" e permite acumular perfis |
| 3 | **Constraints no banco + validação no service** | validação sozinha não sobrevive a concorrência |
| 4 | **Migrations versionadas, `synchronize` proibido** | `sync` não cria índice parcial, `EXCLUDE` nem FK composta |
| 5 | **Guards globais** (`JwtAuthGuard`, `PerfilGuard`) | rota nova nasce protegida; liberar exige `@Publico()` explícito |
| 6 | **JWT prova autenticação, não autorização** | a `JwtStrategy` recarrega o usuário a cada requisição: usuário desativado perde acesso na hora |
| 7 | **Rotas `eu` em vez de `:id`** para dados próprios | elimina por construção a falha "trocar o ID na URL" |
| 8 | **Operações de domínio, não CRUD** | `/ativar`, `/realizar`, `/cancelar` têm pré-condições que um `PATCH status` não teria onde exigir |
| 9 | **Sem `DELETE` em nenhuma rota** | RN10 vira propriedade da API, não disciplina do desenvolvedor |
| 10 | **Gamificação por eventos** | pontuar é consequência, não pré-condição; o núcleo não conhece o módulo |
| 11 | **Livro-razão de pontos**, não coluna de saldo | auditável, permite mudar regras sem migrar dados, sem contenção de `UPDATE` |
| 12 | **Analytics por agregação ao vivo** | no volume desta plataforma, materializar só criaria o problema de invalidação |
| 13 | **`TIMESTAMPTZ` + conversão no PostgreSQL** | evita depender do fuso do processo Node, que difere entre a máquina do dev e o container |
| 14 | **Sessão de 8h, sem refresh token** (D-09) | rotação exigiria tabela de sessões, revogação e um módulo novo — superfície de segurança nova com benefício invisível na banca. A `JwtStrategy` recarrega o usuário a cada requisição, então desativar conta continua imediato. Refresh rotativo fica registrado como caminho de produção |
| 15 | **Limites de agendamento em configuração** (D-15) | duração 15–240 min; antecedência e janela de cancelamento com default `0`, preservando o comportamento anterior. A política é da instituição, não do código |
| 16 | **Sem auto-cadastro: toda conta é criada por um professor autenticado** | substitui a decisão anterior, que mantinha o auto-cadastro público fechado por `CODIGO_CADASTRO_PROFESSOR` e derrubava o boot em produção se o código estivesse vazio. Um segredo compartilhado circula por fora do sistema, não identifica ninguém e não deixa rastro; exigir um professor autenticado é mais forte e nominal. O preço é o bootstrap, que passou a ser explícito (`npm run criar-professor`) em vez de implícito numa rota pública |
| 17 | **Disponibilidades legíveis por qualquer autenticado** | RN07 restringe *materiais*, não horários. Exigir participação invertia a descoberta: o aluno precisava entrar para só então saber se o horário servia |
| 18 | **Reagendamento em vez de cancelar-e-recriar** | usa a FK composta com `ON UPDATE CASCADE` já existente; as inscrições acompanham. Cancelar deixava no histórico um evento sugerindo que algo deu errado e fazia os inscritos perderem a vaga |
| 19 | **Professores administram usuários, com trilha de autoria** | não há ADMIN no domínio. A expansão do conjunto de professores não tem contenção hierárquica, então a resposta possível é auditoria: `usuarios.criado_por_usuario_id` registra quem criou cada conta |
| 20 | **Validação de domínio institucional no `UsuariosService`** | vale nos dois caminhos de criação (`POST /api/alunos` e `POST /api/professores`). Mantida em um lugar só para que fechar um caminho não deixe o outro aberto; o script de bootstrap repete a regra porque não sobe o Nest |
| 22 | **Recuperação de senha por código de 6 dígitos, não por link** | link exige rota que consome token na URL, onde ele vaza em histórico, `Referer` e log de proxy. O código é digitado, não navegado. A resistência vem do teto de 5 tentativas, não do tamanho |
| 21 | **Pontuação agregada por SQL, nunca em memória** | somar em memória uma janela de linhas fazia `/meus-pontos` e `/ranking` mostrarem totais diferentes para a mesma pessoa |

### Segurança

- **argon2id** (parâmetros OWASP) em vez de bcrypt: resiste melhor a GPU e não
  trunca senhas longas em 72 bytes silenciosamente.
- **Login com tempo constante**: e-mail inexistente ainda paga o custo de uma
  verificação real, senão o tempo de resposta denunciaria quais contas existem.
- **Rate limiting**: 5 tentativas/min no login, 120/min no restante da API. O
  login é o único ponto em que adivinhar o corpo da requisição dá acesso a uma
  conta — as rotas de criação de usuário exigem token de professor.
- **Sem auto-cadastro**: nenhuma identidade nasce de requisição anônima. A
  superfície pública da API são duas rotas, `/api/auth/login` e
  `/api/configuracao`.
- **`forbidNonWhitelisted`**: campo não declarado no DTO gera `400` — é o que
  fecha mass assignment (`{"ativo": false}` na criação de usuário).
- **`senhaHash` fora de toda consulta** por `defaultScope`; só o login pede
  explicitamente.
- **Helmet** para cabeçalhos de segurança; **CORS fechado** quando
  `CORS_ORIGINS` está vazio.
- **URLs de material restritas a http/https**: um `javascript:` publicado viraria
  XSS no frontend.
- **Rate limiting no login** (5/min) e teto global de 120/min.

### CORS e o frontend (C7)

`CORS_ORIGINS` vem com `http://localhost:3001` no `.env.example` — a porta
prevista para o Next.js em desenvolvimento (3000 já é do backend). Vazio significa
**CORS fechado**, não liberado.

Se o frontend adotar o padrão BFF (chamadas servidor-a-servidor a partir dos route
handlers do Next.js), o CORS deixa de importar para o navegador — mas continua
necessário para o Swagger e para depuração direta contra a API, então mantenha a
origem configurada de qualquer forma.

---

## Escopo

**Implementado:** autenticação, autorização, usuários, alunos, professores,
cursos, disciplinas, monitorias, participantes, disponibilidades, atendimentos,
cancelamentos, histórico de status, avaliações, materiais, gamificação
(pontuação e ranking), analytics, trilha de requisições, recuperação de senha,
notificações por e-mail e **editais de seleção de monitores** — com inscrição
pública, boletim em PDF e aprovação que cria a monitoria e habilita o monitor —,
carga horária acumulada dos monitores e geração do relatório final em `.docx`.

**Deliberadamente fora desta versão:**

| Item | Situação |
|---|---|
| **Upload de arquivo em materiais** | **Confirmado fora de escopo (C5).** O material é um **link**, e `MateriaisService` força `tipo: LINK`. As colunas `arquivo_*` e o valor `ARQUIVO` existem no schema como preparação documentada, mas **não há endpoint de upload de material nem `StorageService`** — o frontend não deve oferecer upload ali. A feature de editais trouxe o **primeiro** upload binário da API (o boletim do candidato), e ele não serve de atalho para esta: é `BYTEA` em tabela 1:1, para um volume de MB por semestre, e não uma camada de arquivos reutilizável. Material é acervo que cresce sem teto e precisaria de storage próprio, com a autorização de RN07 em cada download. Desenho pronto em `docs/arquitetura.md` §7.4. |
| **Badges, níveis, recompensas** | O livro-razão de pontos já suporta: badge é uma regra que lê os eventos, nível é uma faixa da soma. Nenhum schema novo é necessário. |
| **Perfil ADMIN / coordenação** | Não há ator acima do professor no domínio descrito. |
| **Lista de espera, chat** | Não solicitados. |

---

## Scripts

| Comando | O que faz |
|---|---|
| `npm run start:dev` | API com hot reload |
| `npm run build` · `start:prod` | build e execução de produção |
| `npm run test` · `test:cov` | testes de unidade (com cobertura) |
| `npm run test:fluxo` | verificação ponta a ponta contra banco real |
| `npm run db:migrate` · `db:seed` | migrations e dados de desenvolvimento |
| `npm run criar-professor` | cria o primeiro professor fora da API (bootstrap) |
| `npm run enviar-lembretes` | dispara as rotinas de notificação agora, sem esperar o agendador |
| `npm run ver-emails` | imprime todos os textos de e-mail já renderizados, com as variações de singular/plural — para revisar redação sem enviar nada |
| `npm run ver-relatorio` | confere a carga horária contra uma soma independente em SQL e gera um `.docx` a partir dos dados reais, só leitura |
| `npm run lint` · `format` | ESLint (com fix) e Prettier |
