import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { StatusMonitoria } from '../../common/enums/status-monitoria.enum';
import { Monitoria } from '../monitorias/entities/monitoria.model';
import { MonitoriasService } from '../monitorias/monitorias.service';
import { ParticipantesService } from '../monitorias/participantes.service';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { UsuariosService } from '../usuarios/usuarios.service';
import { AprovacaoRespostaDto, OrigemDaMonitoria } from './dto/aprovacao-resposta.dto';
import { Edital } from './entities/edital.model';
import { InscricaoEdital } from './entities/inscricao-edital.model';

/**
 * APROVACAO de uma candidatura: fecha o ciclo do processo seletivo.
 *
 * Recebe o id da inscricao e nada mais. Dela sai tudo: a disciplina e o curso
 * do candidato, o periodo (do edital) e os dados pessoais que viram a conta.
 * O professor nao redigita nada, e por isso nao ha como a monitoria nascer
 * divergente da candidatura que a originou.
 *
 * TRES PASSOS, cada um "ENCONTRAR OU CRIAR":
 *
 *   1. a CONTA do candidato — reaproveitada se o e-mail ja existe;
 *   2. a MONITORIA da oferta — reaproveitada se ja existe para o mesmo
 *      professor, disciplina e periodo;
 *   3. o VINCULO de MONITOR, que e o unico passo que nao se repete.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NAO E UMA TRANSACAO SO
 *
 * Os tres passos committam separadamente, e isso e escolha, nao descuido.
 * Torna-los atomicos exigiria passar `transaction` por dentro de
 * `UsuariosService.criarAluno`, `MonitoriasService.criar` e
 * `ParticipantesService.criarVinculo` — assinaturas de tres modulos que esta
 * feature nao tem motivo para reescrever. Pior: a criacao da conta ENVIA a
 * senha por e-mail dentro da propria transacao (AD-15), e estender essa
 * transacao para abrange o resto manteria uma conexao aberta esperando um
 * provedor externo.
 *
 * O que se faz no lugar e tornar a operacao REPETIVEL. Falhando no meio, o
 * estado parcial e sempre um dos dois abaixo, e os dois sao resolvidos
 * chamando o endpoint de novo:
 *
 *   - conta criada, sem monitoria  -> o passo 1 a reaproveita;
 *   - monitoria criada, sem monitor -> o passo 2 a reaproveita.
 *
 * O passo 3 e o unico irrepetivel, e e o ULTIMO de proposito: depois dele nao
 * resta nada para dar errado. Repetir a aprovacao ja concluida devolve 409 pela
 * RN09, que e a resposta correta — "este aluno ja e monitor aqui" —, e nao um
 * vinculo duplicado.
 */
@Injectable()
export class AprovacaoDeInscricaoService {
  constructor(
    @InjectModel(InscricaoEdital) private readonly inscricaoModel: typeof InscricaoEdital,
    /**
     * Somente LEITURA, para reaproveitar a monitoria da oferta. Import de
     * model, nao de modulo — a criacao continua indo por `MonitoriasService`,
     * que e quem tem as regras.
     */
    @InjectModel(Monitoria) private readonly monitoriaModel: typeof Monitoria,
    /** Somente LEITURA: ver `exigirMatriculaLivre`. */
    @InjectModel(Aluno) private readonly alunoModel: typeof Aluno,
    private readonly usuariosService: UsuariosService,
    private readonly monitoriasService: MonitoriasService,
    private readonly participantesService: ParticipantesService,
  ) {}

  async aprovar(inscricaoId: string, professor: UsuarioAutenticado): Promise<AprovacaoRespostaDto> {
    const inscricao = await this.buscarInscricaoOuFalhar(inscricaoId);
    const edital = inscricao.edital!;

    const { aluno, nome, email, contaCriada } = await this.resolverAluno(inscricao, professor);
    const { monitoria, origem } = await this.resolverMonitoria(inscricao, edital);

    /**
     * `habilitarMonitor` NAO e reimplementado aqui, e isso e deliberado. Ele
     * carrega a RN01 (registra quem habilitou), a RN09 (recusa acumulo de
     * papeis), a recusa de monitoria encerrada, a checagem de curso compativel
     * — e emite o evento que avisa o aluno por e-mail. Montar o vinculo na mao
     * perderia tudo isso em silencio.
     *
     * SOBRE A RN01 NESTE CAMINHO: a monitoria pertence ao professor INDICADO na
     * inscricao, que pode nao ser quem esta aprovando. A autorizacao da RN01
     * mora no `ParticipacaoGuard`, que protege `POST
     * /monitorias/:id/monitores` — ela nao e reaplicada aqui, e e por isso que
     * a aprovacao consegue habilitar em monitoria de outro docente.
     *
     * E uma excecao deliberada, com o preco pago em auditoria em vez de em
     * silencio: `habilitadoPorUsuarioId` grava quem APROVOU. Quem olhar o
     * vinculo depois ve que o ato partiu da banca, nao do responsavel.
     */
    const participante = await this.participantesService.habilitarMonitor(
      monitoria,
      aluno.usuarioId,
      professor,
    );

    return {
      inscricaoId: inscricao.id,
      monitoria: {
        id: monitoria.id,
        disciplinaId: monitoria.disciplinaId,
        ano: monitoria.ano,
        semestre: monitoria.semestre,
        origem,
      },
      monitor: {
        usuarioId: aluno.usuarioId,
        nome,
        email,
        participanteId: participante.id,
        contaCriada,
      },
    };
  }

  private async buscarInscricaoOuFalhar(id: string): Promise<InscricaoEdital> {
    const inscricao = await this.inscricaoModel.findByPk(id, { include: [Edital] });

    if (!inscricao) {
      throw new NotFoundException('Inscricao nao encontrada.');
    }

    /**
     * Edital INATIVO nao impede aprovar.
     *
     * Parece contraintuitivo e e proposital: `ativo = false` e a exclusao
     * logica, e o uso tipico dela e tirar da vitrine um edital cujo processo
     * TERMINOU. Recusar a aprovacao nesse estado inverteria a ordem natural —
     * o professor encerraria o edital e perderia a capacidade de registrar os
     * aprovados dele. O periodo de inscricoes tambem nao e verificado: aprovar
     * acontece depois dele, por definicao.
     */
    return inscricao;
  }

  /**
   * ENCONTRA pelo e-mail ou CRIA a conta do candidato.
   *
   * A regra do escopo: se o e-mail da inscricao ja existe, nao se cria aluno de
   * novo — reaproveita-se o que existe e so o vinculo e criado. Tres casos de
   * conta existente precisam de resposta diferente, e nenhum deles pode cair em
   * violacao de constraint:
   *
   *   - ja e ALUNO            -> reaproveita, sem tocar em nada dele;
   *   - existe, mas sem perfil ALUNO (conta so de professor) -> 409. Nao se
   *     promove um docente a monitor por efeito colateral de uma aprovacao;
   *   - existe e esta INATIVA -> 409. Habilitar como monitor alguem que nao
   *     consegue entrar na plataforma produziria um monitor incapaz de atuar.
   *
   * O curso do aluno existente NAO e sobrescrito pelo da inscricao. Se os dois
   * divergirem, quem recusa e a FK composta de `monitoria_participantes`, pela
   * voz de `exigirCursoCompativel` — mensagem de dominio, no passo do vinculo.
   * Reescrever o curso de um aluno a partir de um formulario publico seria bem
   * pior que recusar.
   */
  private async resolverAluno(
    inscricao: InscricaoEdital,
    professor: UsuarioAutenticado,
  ): Promise<{ aluno: Aluno; nome: string; email: string; contaCriada: boolean }> {
    const existente = await this.usuariosService.buscarPorEmailComPerfis(inscricao.email);

    if (existente) {
      return {
        aluno: this.exigirContaUtilizavel(existente),
        nome: existente.nome,
        email: existente.email,
        contaCriada: false,
      };
    }

    /**
     * Conta nova. `criarAlunoComoProfessor` e o unico caminho de criacao de
     * aluno do sistema e continua sendo usado como esta: senha gerada pelo
     * servidor, enviada ao e-mail da PESSOA, e autoria registrada em
     * `criadoPorUsuarioId` — aqui, o professor que aprovou.
     *
     * CONSEQUENCIA QUE PRECISA ESTAR AS CLARAS: se o envio do e-mail falhar, a
     * criacao e desfeita e a aprovacao devolve 503 (AD-15). Esta correto —
     * conta cuja senha nunca chegou e conta inutilizavel —, mas significa que
     * aprovar um candidato novo DEPENDE do provedor de e-mail estar de pe.
     *
     * O dominio institucional tambem vale aqui: a inscricao publica aceita
     * e-mail de qualquer dominio de proposito (o candidato pode nao ter conta
     * institucional), mas a criacao de usuario respeita
     * EMAIL_DOMINIOS_PERMITIDOS. Com a variavel configurada, aprovar um
     * candidato de e-mail pessoal devolve 400 — e a mensagem de
     * `validarDominioDoEmail` diz exatamente qual dominio e exigido.
     */
    await this.exigirMatriculaLivre(inscricao);

    const criado = await this.usuariosService.criarAlunoComoProfessor(
      {
        nome: inscricao.nomeCompleto,
        email: inscricao.email,
        matricula: inscricao.matricula,
        cursoId: inscricao.cursoId,
      },
      professor.id,
    );

    const aluno = await this.usuariosService.buscarPorEmailComPerfis(inscricao.email);

    return {
      aluno: this.exigirContaUtilizavel(aluno!),
      nome: criado.nome,
      email: criado.email,
      contaCriada: true,
    };
  }

  /**
   * A conta e resolvida pelo E-MAIL, mas a matricula tambem e unica.
   *
   * O caso que esta checagem existe para explicar: o candidato se inscreveu com
   * um e-mail diferente do da conta que ja tem. A busca por e-mail nao encontra
   * nada, a criacao e tentada, e a constraint `alunos_matricula_key` recusa com
   * "ja existe um aluno com esta matricula" — verdade, mas que deixa o
   * professor sem saber o que fazer no fim do processo seletivo.
   *
   * Aqui a recusa nomeia o e-mail da conta que ocupa a matricula, que e a
   * informacao que resolve: ou se corrige o e-mail da inscricao, ou se habilita
   * aquela conta pela rota normal de monitores.
   */
  private async exigirMatriculaLivre(inscricao: InscricaoEdital): Promise<void> {
    const dono = await this.alunoModel.findOne({
      where: { matricula: inscricao.matricula },
      include: [Usuario],
    });

    if (dono) {
      throw new ConflictException(
        `A matricula ${inscricao.matricula} ja pertence a conta ${dono.usuario?.email}, ` +
          `mas esta inscricao foi feita com ${inscricao.email}. Corrija o e-mail da inscricao ` +
          'ou habilite aquela conta como monitor pela monitoria.',
      );
    }
  }

  private exigirContaUtilizavel(usuario: Usuario): Aluno {
    if (!usuario.aluno) {
      throw new ConflictException(
        `O e-mail ${usuario.email} pertence a uma conta sem perfil ALUNO e nao pode ser ` +
          'habilitada como monitor. Corrija o e-mail da inscricao ou cadastre o aluno ' +
          'separadamente.',
      );
    }

    if (!usuario.ativo) {
      throw new ConflictException(
        `A conta de ${usuario.email} esta inativa. Reative-a antes de habilitar o monitor.`,
      );
    }

    return usuario.aluno;
  }

  /**
   * ENCONTRA a monitoria da oferta, ADOTA ou CRIA.
   *
   * A chave e a da constraint `uq_monitoria_oferta` —
   * `(disciplina_id, professor_id, ano, semestre)` —, e e por isso que UMA
   * consulta basta: o banco garante no maximo uma linha por oferta. Criar uma
   * segunda e impossivel, entao reaproveitar nao e otimizacao, e a unica forma
   * de aprovar o SEGUNDO candidato de uma disciplina. Sem isto, uma disciplina
   * com duas vagas travaria em 409 na segunda aprovacao.
   *
   * Havendo monitoria da oferta, tres caminhos:
   *
   *   - ja veio DESTE edital       -> reusa, sem tocar em nada (REUSADA);
   *   - nao veio de edital nenhum  -> ADOTA: grava `edital_id` e usa. E o caso
   *     do professor que abriu a monitoria a mao antes de rodar a selecao, que
   *     e um fluxo legitimo e comum. Recusar ali seria pedir trabalho manual
   *     sem razao de dominio: a oferta e a MESMA — mesma disciplina, mesmo
   *     professor, mesmo periodo —, e o banco garante que existe so uma;
   *   - veio de OUTRO edital       -> recusa. Aqui ha razao de dominio: a
   *     monitoria e o resultado de outro processo seletivo, e reescrever a
   *     procedencia apagaria esse fato.
   *
   * Por que ADOTAR em vez de apenas usar: `edital_id` e o que o resumo por
   * disciplina consulta para dizer se o grupo foi resolvido. Usar a monitoria
   * sem gravar o vinculo deixaria a tela afirmando "pendente" com o monitor ja
   * habilitado — inconsistencia pior que a recusa que isto substitui. A adocao
   * mexe SO nessa coluna: dono, disciplina, periodo e status ficam como estavam.
   *
   * O resultado e o que o processo espera: uma monitoria por disciplina, com
   * tantos monitores quantos foram aprovados.
   *
   * ANO E SEMESTRE vem do EDITAL, nao do relogio nem do cliente. O edital e o
   * documento que define o periodo do processo seletivo; usar a data de hoje
   * faria uma aprovacao feita em janeiro cair no semestre errado.
   *
   * O PROFESSOR RESPONSAVEL e o INDICADO NA INSCRICAO, nao quem aprova.
   *
   * E o professor que vai supervisionar aquela disciplina — e o candidato o
   * escolheu no formulario justamente por isso. Quem aprova age como banca:
   * registra o resultado da selecao, nao assume a monitoria.
   *
   * Isto custou duas mudancas fora deste arquivo, e as duas sao visiveis:
   * `professorId` passou a morar em `CriarMonitoriaDto` (sem decorator de
   * validacao, entao o cliente nao o manda — ver o DTO), e `POST /monitorias`
   * passou a injeta-lo no controller com o usuario do token. O efeito daquela
   * rota nao mudou; o que mudou e que agora existe um segundo caminho capaz de
   * decidir de quem e a monitoria.
   *
   * CONSEQUENCIA QUE PRECISA ESTAR AS CLARAS: a habilitacao do monitor passa a
   * ser feita por alguem que pode nao ser o professor responsavel, o que a RN01
   * nao previa. O ato continua rastreavel — `habilitadoPorUsuarioId` grava quem
   * aprovou, nao o responsavel —, e por isso a trilha fica mais informativa, nao
   * menos. Mas vale saber: um professor aprovando uma candidatura cria monitoria
   * no nome de um colega que nao foi consultado. A contencao disponivel, se
   * algum dia for desejada, e exigir que quem aprova SEJA o indicado; hoje isso
   * nao e exigido de proposito, para a banca poder registrar os aprovados sem
   * depender da agenda de cada docente.
   */
  private async resolverMonitoria(
    inscricao: InscricaoEdital,
    edital: Edital,
  ): Promise<{ monitoria: Monitoria; origem: OrigemDaMonitoria }> {
    const oferta = {
      disciplinaId: inscricao.disciplinaId,
      professorId: inscricao.professorId,
      ano: edital.ano,
      semestre: edital.semestre,
    };

    // `uq_monitoria_oferta` garante no maximo uma: esta consulta e exaustiva.
    const existente = await this.monitoriaModel.findOne({ where: oferta });

    if (existente) {
      return this.reaproveitar(existente, edital);
    }

    const dto = await this.monitoriasService.criar(
      {
        disciplinaId: inscricao.disciplinaId,
        professorId: inscricao.professorId,
        ano: edital.ano,
        semestre: edital.semestre,
        descricao: `Monitoria criada a partir do edital ${edital.ano}/${edital.semestre}.`,
      },
      edital.id,
    );

    const monitoria = await this.monitoriaModel.findByPk(dto.id);

    if (!monitoria) {
      // Inalcancavel: o insert acabou de ocorrer. Explicito para nao usar `!`.
      throw new BadRequestException('Falha ao carregar a monitoria recem-criada.');
    }

    return { monitoria, origem: OrigemDaMonitoria.CRIADA };
  }

  /**
   * Decide entre REUSAR, ADOTAR e recusar a monitoria que ja existe.
   *
   * A checagem de status vem ANTES da adocao, e a ordem e o ponto: adotar
   * primeiro gravaria `edital_id` em uma monitoria que nao aceita participante,
   * e o resumo passaria a mostrar o grupo como "monitoria aberta, monitor
   * pendente" — um estado que sugere "tente de novo" quando nenhuma tentativa
   * vai funcionar. `criarVinculo` tambem recusaria depois, mas ja com a escrita
   * feita.
   */
  private async reaproveitar(
    monitoria: Monitoria,
    edital: Edital,
  ): Promise<{ monitoria: Monitoria; origem: OrigemDaMonitoria }> {
    if (monitoria.editalId && monitoria.editalId !== edital.id) {
      throw new ConflictException(
        `A monitoria desta oferta (${monitoria.id}) veio de outro edital e nao pode ser ` +
          'reaproveitada aqui: ela e o resultado de outro processo seletivo. Use outro ' +
          'periodo ou habilite o monitor diretamente nela.',
      );
    }

    if (
      monitoria.status === StatusMonitoria.ENCERRADA ||
      monitoria.status === StatusMonitoria.CANCELADA
    ) {
      throw new ConflictException(
        `A monitoria desta oferta (${monitoria.id}) esta ` +
          `${monitoria.status.toLowerCase()} e nao aceita novos participantes. ` +
          'Use outro periodo.',
      );
    }

    if (monitoria.editalId === edital.id) {
      return { monitoria, origem: OrigemDaMonitoria.REUSADA };
    }

    /**
     * ADOCAO: grava a procedencia e nada mais. O `update` toca uma coluna que
     * estava nula, nao reescreve decisao de ninguem.
     */
    await monitoria.update({ editalId: edital.id });

    return { monitoria, origem: OrigemDaMonitoria.ADOTADA };
  }
}
