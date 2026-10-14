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

São 20 migrations. Outros comandos: `db:migrate:status`, `db:migrate:undo`,
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

250 testes de unidade, sem banco, cobrindo o que o PostgreSQL **não** alcança:
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
| `logs.spec.ts` | redação de senha, código e token em qualquer profundidade; identificação do usuário pelo token; falha isolada |
| `notificacoes.spec.ts` | destinatário por tipo, idempotência, chave de transição, fuso da mensagem, reenvio e falha isolada |
| `disciplinas.spec.ts` | geração do código (prefixo, acentos, numeração, largura) e nova tentativa quando a constraint recusa |
| `email.spec.ts` | modo log sem credencial, payload e cabeçalhos do Brevo, timeout, recusa do provedor e falha de rede sem lançar; corpo nunca no log |
| `recuperacao-senha.spec.ts` | anti-enumeração (resposta e custo idênticos), teto de tentativas, expiração, uso único, código e senha só como hash |

### Verificação ponta a ponta

As regras que dependem do PostgreSQL (constraints `EXCLUDE` de RN03, índice único
parcial de RN09) são verificadas contra um **banco real** — testá-las com model
mockado só provaria que o mock funciona.

Com o banco semeado (`npm run db:seed`) e o servidor rodando em outro terminal:

```bash
npm run test:fluxo
```

**125 verificações**, todas passando contra PostgreSQL 17. O seeder passou a ser
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
| `DisciplinasModule` | catálogo mínimo | `DisciplinasService` |
| `MonitoriasModule` | `Monitoria` + `MonitoriaParticipante` | `ParticipacaoService`, `ParticipacaoGuard` |
| `DisponibilidadesModule` | recorrência semanal do monitor | `DisponibilidadesService` |
| `AtendimentosModule` | sessão, inscrições, histórico de status | `AtendimentosService` |
| `AvaliacoesModule` | avaliação pós-atendimento | `AvaliacoesService` |
| `MateriaisModule` | acervo da monitoria | `MateriaisService` |
| `LogsModule` | trilha de requisições (`@Global()`): interceptor, middleware e redação | `LogsService` |
| `EmailModule` | serviço de e-mail (Brevo) — **preparado, sem envio**. `@Global()` | `EmailService` |
| `GamificacaoModule` | pontuação e ranking (módulo folha) | `GamificacaoService` |
| `AnalyticsModule` | indicadores agregados (somente leitura) | — |

### Grafo de dependências (acíclico)

```
Auth ─► Usuarios ◄─ Monitorias ◄─┬─ Disponibilidades
                       ▲          ├─ Materiais
Disciplinas ───────────┘          ├─ Avaliacoes
                                  ├─ Analytics
                            Atendimentos ─► Disponibilidades

Gamificacao ◄╌╌ (eventos) ╌╌ Atendimentos, Avaliacoes
```

A seta tracejada é a única comunicação por evento — e é intencional: nenhum
módulo do núcleo importa `GamificacaoModule`. `EmailModule` não aparece no grafo
porque ainda não tem consumidor.

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
| `LEMBRETE_DIA` | rotina, 30 em 30 min | monitor + inscritos | o atendimento é hoje |
| `ATENDIMENTO_CANCELADO` | evento | inscritos + monitor | sem isso a pessoa se desloca à toa |
| `ATENDIMENTO_REAGENDADO` | evento | inscritos + monitor | a inscrição é preservada (B5): a pessoa segue marcada num horário que não escolheu |
| `MONITOR_HABILITADO` | evento | o aluno promovido | RN01: ele passa a ter deveres por ato do professor |
| `ATENDIMENTO_SOLICITADO` | evento | o monitor | compromisso novo na agenda dele |
| `ATENDIMENTO_OFERTADO` | evento | monitorados ativos | é o que faz a oferta circular |
| `AVALIACAO_PENDENTE` | evento | presentes | fecha o ciclo da RN05/RN06 |

`AVALIACAO_PENDENTE` reaproveita o evento `atendimento.realizado` que a
gamificação já consumia — **nenhuma emissão nova foi precisa no núcleo** para
esse tipo.

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
públicas. **Não existe `DELETE` em nenhum lugar desta API**: sair, cancelar,
encerrar e remover são transições de estado (RN10).

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
| `GET` | `/api/professores` · `/api/professores/:usuarioId` | autenticado |
| `PATCH` | `/api/professores/eu` | **PROFESSOR** |

### Disciplinas

| Método | Rota | Acesso |
|---|---|---|
| `POST` `PATCH` | `/api/disciplinas` · `/api/disciplinas/:id` | **PROFESSOR** |
| `GET` | `/api/disciplinas` · `/api/disciplinas/:id` | autenticado |

### Monitorias

| Método | Rota | Acesso |
|---|---|---|
| `POST` | `/api/monitorias` | **PROFESSOR** |
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
| `GET` | `/api/gamificacao/ranking` | autenticado |
| `GET` | `/api/gamificacao/meus-pontos` | autenticado |
| `GET` | `/api/analytics/resumo` | **PROFESSOR** |
| `GET` | `/api/analytics/monitorias/:monitoriaId` | participante ou responsável |
| `GET` | `/api/analytics/monitorias/:monitoriaId/monitores` | professor responsável |

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
disciplinas, monitorias, participantes, disponibilidades, atendimentos,
cancelamentos, histórico de status, avaliações, materiais, gamificação
(pontuação e ranking) e analytics.

**Deliberadamente fora desta versão:**

| Item | Situação |
|---|---|
| **Upload de arquivo em materiais** | **Confirmado fora de escopo (C5).** O material é um **link**, e `MateriaisService` força `tipo: LINK`. As colunas `arquivo_*` e o valor `ARQUIVO` existem no schema como preparação documentada, mas **não há endpoint de upload nem `StorageService`** — o frontend não deve oferecer upload de arquivo. Construí-lo é uma fase própria: storage, MIME por magic number, limite de tamanho e download autenticado (nunca estático, senão RN07 é burlada). Desenho pronto em `docs/arquitetura.md` §7.4. |
| **Badges, níveis, recompensas** | O livro-razão de pontos já suporta: badge é uma regra que lê os eventos, nível é uma faixa da soma. Nenhum schema novo é necessário. |
| **Perfil ADMIN / coordenação** | Não há ator acima do professor no domínio descrito. |
| **Notificações, lista de espera, chat** | Não solicitados. |

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
| `npm run lint` · `format` | ESLint (com fix) e Prettier |
