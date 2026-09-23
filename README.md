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
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | **sim** | Conexão PostgreSQL |
| `DB_LOGGING` | não | `true` imprime o SQL gerado |
| `JWT_SECRET` | **sim** | Mínimo de 32 caracteres |
| `JWT_EXPIRES_IN` | não | Padrão `8h` (D-09). Não há refresh token — ver Decisões |
| `EMAIL_DOMINIOS_PERMITIDOS` | não | Restringe o cadastro a domínios institucionais. Vazio = qualquer domínio |
| `CODIGO_CADASTRO_PROFESSOR` | condicional | Fecha o auto-cadastro de professor. **Obrigatório em produção**: com `NODE_ENV=production` e este valor vazio a aplicação se recusa a subir |
| `TIMEZONE_INSTITUICAO` | não | Fuso que casa atendimento (UTC) com disponibilidade semanal (hora local). Padrão `America/Sao_Paulo` |

### 4. Migrations

```bash
npm run db:migrate
```

São 17 migrations. Outros comandos: `db:migrate:status`, `db:migrate:undo`,
`db:migrate:undo:all`.

O schema é **propriedade das migrations**. `synchronize` está desligado e não
deve ser ligado: índices parciais, `EXCLUDE` e FKs compostas — que são justamente
o que garante as regras de negócio — não são expressáveis pelo `sync` do ORM.

### 5. Dados de desenvolvimento (opcional)

```bash
npm run db:seed
```

Cria `joao.ribeiro@ufx.edu.br` (professor) e `ana.martins@ufx.edu.br` (aluno),
ambos com senha `senhaSegura123`. O seeder se recusa a rodar com
`NODE_ENV=production`.

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

94 testes de unidade, sem banco, cobrindo o que o PostgreSQL **não** alcança:
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

### Verificação ponta a ponta

As regras que dependem do PostgreSQL (constraints `EXCLUDE` de RN03, índice único
parcial de RN09) são verificadas contra um **banco real** — testá-las com model
mockado só provaria que o mock funciona.

Com o servidor rodando em outro terminal:

```bash
npm run test:fluxo
```

**78 verificações**, todas passando contra PostgreSQL 17.
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
| `AuthModule` | login, registro, JWT, guards globais | `AuthService` |
| `UsuariosModule` | `Usuario`, `Aluno`, `Professor`, hash argon2id | `UsuariosService`, `HashService` |
| `DisciplinasModule` | catálogo mínimo | `DisciplinasService` |
| `MonitoriasModule` | `Monitoria` + `MonitoriaParticipante` | `ParticipacaoService`, `ParticipacaoGuard` |
| `DisponibilidadesModule` | recorrência semanal do monitor | `DisponibilidadesService` |
| `AtendimentosModule` | sessão, inscrições, histórico de status | `AtendimentosService` |
| `AvaliacoesModule` | avaliação pós-atendimento | `AvaliacoesService` |
| `MateriaisModule` | acervo da monitoria | `MateriaisService` |
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
módulo do núcleo importa `GamificacaoModule`.

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
| `POST` | `/api/auth/registro/aluno` | público (10 req/min) |
| `POST` | `/api/auth/registro/professor` | público + código opcional (10 req/min) |
| `POST` | `/api/auth/login` | público (**5 req/min**) |
| `GET` `PATCH` | `/api/usuarios/eu` | autenticado |
| `PATCH` | `/api/usuarios/eu/senha` | autenticado |
| `POST` | `/api/alunos` | **PROFESSOR** — cadastra um aluno |
| `GET` | `/api/alunos` | **PROFESSOR** — `?busca=`, `?semVinculoAtivoNaMonitoria=` |
| `PATCH` | `/api/alunos/eu` | **ALUNO** |
| `GET` | `/api/alunos/:usuarioId` | PROFESSOR ou o próprio |
| `POST` | `/api/professores` | **PROFESSOR** — cadastra outro professor |
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
POST /api/alunos          { nome, email, senhaProvisoria, matricula, curso? }
POST /api/professores     { nome, email, senhaProvisoria, identificacaoFuncional?, departamento? }
```

Convivem com o auto-cadastro público (`/api/auth/registro/*`): servem para o
professor cadastrar quem ainda não se cadastrou sozinho.

**`POST /api/professores` não exige `CODIGO_CADASTRO_PROFESSOR`.** Aquele código
protege o auto-cadastro *público*, onde é a única barreira entre um desconhecido
e o perfil PROFESSOR. Aqui a barreira é outra e mais forte: estar autenticado
como professor.

### O que isso implica, explicitamente

Sem ADMIN, **qualquer professor cria professores, e esses também poderão**. Não
há hierarquia contendo a expansão — o que existe é rastro: toda conta criada por
esse caminho grava `criadoPorUsuarioId`, e `GET /api/usuarios/eu` e as listagens
devolvem esse campo. É a mesma escolha já feita em
`monitoria_participantes.habilitado_por_usuario_id` para tornar a RN01 auditável.

Se um dia houver coordenação acima do professor, a contenção natural é um perfil
ADMIN restringindo `POST /api/professores` — e a trilha já estará lá para dizer
quem entrou por onde.

### A senha é provisória de verdade

Quem cria a conta inevitavelmente conhece a senha inicial. O combinado é que a
pessoa a troque no primeiro acesso, em `PATCH /api/usuarios/eu/senha`.

**O backend ainda não força essa troca.** Fazê-lo exigiria uma coluna
`deveTrocarSenha` e um guard que libera apenas a rota de troca enquanto ela
estiver marcada — um recurso próprio, não um detalhe. Fica registrado como
melhoria recomendada antes de uso institucional real.

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
→ { "fusoHorario": "America/Sao_Paulo",
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
| `criadoPorUsuarioId` | `UsuarioRespostaDto` | `null` = auto-cadastro; preenchido = conta criada por um professor |
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
| 16 | **Cadastro aberto de professor derruba o boot em produção** | um `logger.warn` rola para fora da tela; com o cadastro aberto, qualquer pessoa vira PROFESSOR e habilita monitores — RN01 vira decoração |
| 17 | **Disponibilidades legíveis por qualquer autenticado** | RN07 restringe *materiais*, não horários. Exigir participação invertia a descoberta: o aluno precisava entrar para só então saber se o horário servia |
| 18 | **Reagendamento em vez de cancelar-e-recriar** | usa a FK composta com `ON UPDATE CASCADE` já existente; as inscrições acompanham. Cancelar deixava no histórico um evento sugerindo que algo deu errado e fazia os inscritos perderem a vaga |
| 19 | **Professores administram usuários, com trilha de autoria** | não há ADMIN no domínio. A expansão do conjunto de professores não tem contenção hierárquica, então a resposta possível é auditoria: `usuarios.criado_por_usuario_id` registra quem criou cada conta |
| 20 | **Validação de domínio institucional no `UsuariosService`** | vale nos dois caminhos de criação (auto-cadastro e criação pelo professor). Mantida em um lugar só para que fechar um caminho não deixe o outro aberto |
| 21 | **Pontuação agregada por SQL, nunca em memória** | somar em memória uma janela de linhas fazia `/meus-pontos` e `/ranking` mostrarem totais diferentes para a mesma pessoa |

### Segurança

- **argon2id** (parâmetros OWASP) em vez de bcrypt: resiste melhor a GPU e não
  trunca senhas longas em 72 bytes silenciosamente.
- **Login com tempo constante**: e-mail inexistente ainda paga o custo de uma
  verificação real, senão o tempo de resposta denunciaria quais contas existem.
- **Rate limiting**: 5 tentativas/min no login, 10/min nos cadastros.
- **`forbidNonWhitelisted`**: campo não declarado no DTO gera `400` — é o que
  fecha mass assignment (`{"ativo": false}` no registro).
- **`senhaHash` fora de toda consulta** por `defaultScope`; só o login pede
  explicitamente.
- **Helmet** para cabeçalhos de segurança; **CORS fechado** quando
  `CORS_ORIGINS` está vazio.
- **URLs de material restritas a http/https**: um `javascript:` publicado viraria
  XSS no frontend.
- **Rate limiting no login** (5/min) e nos cadastros (10/min).

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
| `npm run lint` · `format` | ESLint (com fix) e Prettier |
