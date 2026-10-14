import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { EmailService } from '../email/email.service';

import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { Aluno } from './entities/aluno.model';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { StatusParticipacao } from '../../common/enums/status-participacao.enum';
import {
  CriarAlunoPeloProfessorDto,
  CriarProfessorPeloProfessorDto,
} from './dto/criar-usuario-pelo-professor.dto';
import { FiltroAlunosDto } from './dto/filtro-alunos.dto';
import { HashService } from './hash.service';
import { Professor } from './entities/professor.model';
import { Usuario } from './entities/usuario.model';

/**
 * Entrega da senha gerada, executada DENTRO da transacao de criacao.
 *
 * O lugar nao e detalhe: rodando aqui, lancar desfaz a criacao inteira. E o
 * que evita o pior resultado possivel desta funcionalidade — uma conta que
 * existe, cuja senha ninguem conhece, e que nem o professor consegue consertar.
 *
 * Rodar depois do insert tambem importa: se o e-mail ja estiver cadastrado, a
 * constraint falha antes daqui e nenhuma mensagem e enviada. Sem isso, tentar
 * recriar um usuario existente mandaria uma senha para a caixa dele.
 */
type EntregaDeCredenciais = () => Promise<void>;

interface DadosBaseUsuario {
  nome: string;
  email: string;
  senhaHash: string;
  /**
   * Quem criou a conta. NULL so em conta de bootstrap, criada fora da API por
   * `npm run criar-professor` — nao ha auto-cadastro, logo toda conta nascida
   * pela API tem autor.
   */
  criadoPorUsuarioId?: string | null;
}

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectModel(Usuario) private readonly usuarioModel: typeof Usuario,
    @InjectModel(Aluno) private readonly alunoModel: typeof Aluno,
    @InjectModel(Professor) private readonly professorModel: typeof Professor,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly hashService: HashService,
    /**
     * Registrado apenas para LEITURA, para o filtro semVinculoAtivoNaMonitoria.
     * E um import de model, nao de modulo: nao cria ciclo de DI com
     * MonitoriasModule (mesmo padrao ja usado la para os models de atendimento).
     */
    @InjectModel(MonitoriaParticipante)
    private readonly participanteModel: typeof MonitoriaParticipante,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Cria USUARIO + ALUNO em uma unica transacao.
   *
   * A transacao nao e opcional: sem ela, uma matricula duplicada deixaria para
   * tras um `usuarios` orfao — um usuario sem perfil nenhum, que consegue logar
   * mas nao e aluno nem professor. Ou nascem as duas linhas, ou nenhuma.
   */
  async criarAluno(
    dados: DadosBaseUsuario & { matricula: string; curso?: string | null },
    entregarCredenciais?: EntregaDeCredenciais,
  ): Promise<UsuarioRespostaDto> {
    return this.sequelize.transaction(async (transaction) => {
      const usuario = await this.usuarioModel.create(
        {
          nome: dados.nome,
          email: dados.email,
          senhaHash: dados.senhaHash,
          criadoPorUsuarioId: dados.criadoPorUsuarioId ?? null,
        },
        { transaction },
      );

      const aluno = await this.alunoModel.create(
        {
          usuarioId: usuario.id,
          matricula: dados.matricula,
          curso: dados.curso ?? null,
        },
        { transaction },
      );

      await entregarCredenciais?.();

      return UsuarioRespostaDto.deModelo(usuario, aluno, null);
    });
  }

  /** Cria USUARIO + PROFESSOR em uma unica transacao. Ver criarAluno. */
  async criarProfessor(
    dados: DadosBaseUsuario & {
      identificacaoFuncional?: string | null;
      departamento?: string | null;
    },
    entregarCredenciais?: EntregaDeCredenciais,
  ): Promise<UsuarioRespostaDto> {
    return this.sequelize.transaction(async (transaction) => {
      const usuario = await this.usuarioModel.create(
        {
          nome: dados.nome,
          email: dados.email,
          senhaHash: dados.senhaHash,
          criadoPorUsuarioId: dados.criadoPorUsuarioId ?? null,
        },
        { transaction },
      );

      const professor = await this.professorModel.create(
        {
          usuarioId: usuario.id,
          identificacaoFuncional: dados.identificacaoFuncional ?? null,
          departamento: dados.departamento ?? null,
        },
        { transaction },
      );

      await entregarCredenciais?.();

      return UsuarioRespostaDto.deModelo(usuario, null, professor);
    });
  }

  /**
   * Criacao administrativa de ALUNO por um professor.
   *
   * Unico caminho pelo qual um aluno passa a existir: nao ha auto-cadastro. O
   * dominio institucional e a unicidade de e-mail e matricula continuam valendo;
   * a senha e provisoria, definida por quem cria, e a autoria fica registrada em
   * `criadoPorUsuarioId`.
   *
   * A autorizacao — ser PROFESSOR — e do controller. Aqui ficam as regras.
   */
  async criarAlunoComoProfessor(
    dto: CriarAlunoPeloProfessorDto,
    professorId: string,
  ): Promise<UsuarioRespostaDto> {
    this.validarDominioDoEmail(dto.email);

    const senha = gerarSenhaAleatoria();

    return this.criarAluno(
      {
        nome: dto.nome,
        email: dto.email,
        senhaHash: await this.hashService.gerar(senha),
        matricula: dto.matricula,
        curso: dto.curso ?? null,
        criadoPorUsuarioId: professorId,
      },
      () => this.entregarSenhaGerada(dto.nome, dto.email, senha),
    );
  }

  /**
   * Criacao administrativa de PROFESSOR por outro professor.
   *
   * Unico caminho pelo qual um professor passa a existir pela API — o
   * auto-cadastro publico foi removido, e com ele o CODIGO_CADASTRO_PROFESSOR,
   * que era a sua unica barreira. A barreira agora e mais forte e nao depende de
   * um segredo compartilhado: quem chama ja esta autenticado e ja e professor.
   *
   * O efeito colateral, que precisa estar as claras: como nao ha ADMIN, qualquer
   * professor pode criar professores, e esses tambem poderao. A contencao
   * disponivel e a trilha de auditoria, nao a hierarquia. O conjunto inicial de
   * professores, porem, deixou de ser aberto: o primeiro so nasce com acesso ao
   * banco (scripts/criar-professor.mjs).
   */
  async criarProfessorComoProfessor(
    dto: CriarProfessorPeloProfessorDto,
    professorId: string,
  ): Promise<UsuarioRespostaDto> {
    this.validarDominioDoEmail(dto.email);

    const senha = gerarSenhaAleatoria();

    return this.criarProfessor(
      {
        nome: dto.nome,
        email: dto.email,
        senhaHash: await this.hashService.gerar(senha),
        identificacaoFuncional: dto.identificacaoFuncional ?? null,
        departamento: dto.departamento ?? null,
        criadoPorUsuarioId: professorId,
      },
      () => this.entregarSenhaGerada(dto.nome, dto.email, senha),
    );
  }

  /**
   * Manda a senha gerada para o e-mail da PESSOA, nunca para quem criou a conta.
   *
   * Lanca se o e-mail estiver configurado e o envio falhar — e assim a criacao
   * inteira e desfeita (ver EntregaDeCredenciais). Isto contraria a politica
   * geral de que e-mail nao derruba operacao de dominio, e a contradicao e
   * aparente: aquela politica vale para NOTIFICACOES, avisos sobre algo que ja
   * aconteceu. Aqui o e-mail e o proprio meio de entrega da credencial. Uma
   * conta criada sem a senha chegar nao e uma conta com um aviso faltando: e
   * uma conta inutilizavel, que ninguem consegue acessar nem recuperar.
   *
   * Sem e-mail configurado (so possivel fora de producao — ver o guard de boot
   * em EmailService), a criacao segue e a senha vai para o log, sob a mesma
   * dupla condicao usada em RecuperacaoSenhaService. Sem isso, criar usuario em
   * desenvolvimento produziria contas que ninguem consegue usar.
   */
  private async entregarSenhaGerada(nome: string, email: string, senha: string): Promise<void> {
    if (!this.emailService.estaConfigurado()) {
      this.avisarEmDesenvolvimento(email, senha);
      return;
    }

    /**
     * Aponta para a RAIZ do sistema, e nao para uma rota de login.
     *
     * Uma aplicacao autenticada redireciona quem nao tem sessao para o proprio
     * login, entao a raiz sempre funciona; `/login` seria um palpite sobre uma
     * rota do frontend, e link quebrado em e-mail nao tem conserto depois de
     * enviado. Se houver rota dedicada, acrescentar o caminho aqui e uma linha.
     */
    const url = this.config.getOrThrow<string>('app.urlFront');

    const enviou = await this.emailService.enviar({
      para: [{ email, nome }],
      assunto: 'Sua conta na plataforma de monitoria',
      texto: [
        `Ola, ${nome}.`,
        '',
        'Uma conta foi criada para voce na plataforma de monitoria.',
        '',
        `Acesse com este e-mail e a senha provisoria: ${senha}`,
        '',
        'Troque a senha no primeiro acesso. Se preferir, use a opcao de',
        'recuperacao de senha para definir uma propria.',
        '',
        `Acessar o sistema: ${url}`,
      ].join('\n'),
    });

    if (!enviou) {
      throw new ServiceUnavailableException(
        'Nao foi possivel enviar a senha para o e-mail informado. A conta NAO foi criada; ' +
          'confira o endereco e tente novamente.',
      );
    }
  }

  /** Mesma guarda dupla de RecuperacaoSenhaService.avisarEmDesenvolvimento. */
  private avisarEmDesenvolvimento(email: string, senha: string): void {
    if (this.config.get<string>('app.ambiente') === 'production') {
      return;
    }

    this.logger.warn(
      `[DESENVOLVIMENTO] Senha gerada para ${email}: ${senha} — exibida porque o ` +
        'e-mail nao esta configurado. Em producao a aplicacao nao sobe sem e-mail.',
    );
  }

  /**
   * D-09: restringe a criacao de contas a dominios institucionais, se configurado.
   *
   * Voltou a ser privada quando o auto-cadastro foi removido: antes era publica
   * para que o AuthService a aplicasse tambem no registro publico. Hoje os dois
   * unicos caminhos de criacao estao neste service, e os dois passam por aqui —
   * o que impede que fechar um deixe o outro aberto.
   *
   * O script de bootstrap (scripts/criar-professor.mjs) repete a regra, porque
   * nao sobe o Nest.
   */
  private validarDominioDoEmail(email: string): void {
    const permitidos = this.config.get<string[]>('cadastro.dominiosPermitidos') ?? [];

    if (permitidos.length === 0) {
      return;
    }

    const dominio = email.split('@')[1]?.toLowerCase() ?? '';

    if (!permitidos.includes(dominio)) {
      throw new BadRequestException(
        `Cadastro permitido apenas para e-mails institucionais: ${permitidos.join(', ')}.`,
      );
    }
  }

  /** Unico ponto do sistema que carrega o hash da senha. Usado so no login. */
  async buscarPorEmailComSenha(email: string): Promise<Usuario | null> {
    return this.usuarioModel.scope('comSenha').findOne({
      where: { email },
      include: [Aluno, Professor],
    });
  }

  async buscarPorIdComPerfis(id: string): Promise<Usuario | null> {
    return this.usuarioModel.scope('comPerfis').findByPk(id);
  }

  async buscarPorIdOuFalhar(id: string): Promise<Usuario> {
    const usuario = await this.buscarPorIdComPerfis(id);

    if (!usuario) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    return usuario;
  }

  async atualizarNome(id: string, nome: string): Promise<UsuarioRespostaDto> {
    const usuario = await this.buscarPorIdOuFalhar(id);
    await usuario.update({ nome });

    return UsuarioRespostaDto.deModelo(usuario);
  }

  /**
   * Troca de senha do proprio usuario.
   *
   * Exige a senha atual mesmo com o usuario ja autenticado: se um token for
   * roubado, isso impede que o atacante tome a conta em definitivo trocando a
   * senha. O ID vem sempre do token, nunca do corpo da requisicao.
   */
  async alterarSenha(id: string, senhaAtual: string, novaSenha: string): Promise<void> {
    if (senhaAtual === novaSenha) {
      throw new BadRequestException('A nova senha deve ser diferente da atual.');
    }

    const usuario = await this.usuarioModel.scope('comSenha').findByPk(id);

    if (!usuario) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    if (!(await this.hashService.conferir(usuario.senhaHash, senhaAtual))) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    await usuario.update({ senhaHash: await this.hashService.gerar(novaSenha) });
  }

  /**
   * Lista alunos para o fluxo da RN01: o professor precisa LOCALIZAR alguem para
   * habilitar como monitor. Sem busca, em uma base institucional real isso vira
   * paginacao as cegas.
   */
  async listarAlunos(filtro: FiltroAlunosDto): Promise<RespostaPaginada<UsuarioRespostaDto>> {
    const whereAluno: Record<string, unknown> = {};

    if (filtro.busca) {
      const padrao = `%${filtro.busca}%`;

      // A busca cruza as duas tabelas: matricula vive em `alunos`, nome e email
      // em `usuarios`. O caminho `$usuario.campo$` permite o OR entre elas.
      whereAluno[Op.or as unknown as string] = [
        { matricula: { [Op.iLike]: padrao } },
        { '$usuario.nome$': { [Op.iLike]: padrao } },
        { '$usuario.email$': { [Op.iLike]: padrao } },
      ];
    }

    if (filtro.semVinculoAtivoNaMonitoria) {
      const vinculados = await this.participanteModel.findAll({
        where: {
          monitoriaId: filtro.semVinculoAtivoNaMonitoria,
          status: StatusParticipacao.ATIVO,
        },
        attributes: ['alunoId'],
      });

      if (vinculados.length > 0) {
        whereAluno.usuarioId = { [Op.notIn]: vinculados.map((v) => v.alunoId) };
      }
    }

    const { rows, count } = await this.alunoModel.findAndCountAll({
      where: whereAluno,
      include: [{ model: Usuario, required: true }],
      order: [[{ model: Usuario, as: 'usuario' }, 'nome', 'ASC']],
      limit: filtro.limite,
      offset: filtro.offset,
      subQuery: false,
      distinct: true,
    });

    const dados = rows.map((aluno) => UsuarioRespostaDto.deModelo(aluno.usuario!, aluno, null));

    return new RespostaPaginada(dados, count, filtro.pagina, filtro.limite);
  }

  async buscarAlunoOuFalhar(usuarioId: string): Promise<UsuarioRespostaDto> {
    const aluno = await this.alunoModel.findByPk(usuarioId, { include: [Usuario] });

    if (!aluno) {
      throw new NotFoundException('Aluno nao encontrado.');
    }

    return UsuarioRespostaDto.deModelo(aluno.usuario!, aluno, null);
  }

  async atualizarDadosAluno(
    usuarioId: string,
    dados: { curso?: string | null },
  ): Promise<UsuarioRespostaDto> {
    const aluno = await this.alunoModel.findByPk(usuarioId, { include: [Usuario] });

    if (!aluno) {
      throw new NotFoundException('Aluno nao encontrado.');
    }

    // `matricula` nao entra aqui de proposito: e dado de identidade institucional,
    // nao deve ser editavel pelo proprio aluno.
    await aluno.update({ curso: dados.curso ?? null });

    return UsuarioRespostaDto.deModelo(aluno.usuario!, aluno, null);
  }

  async listarProfessores(paginacao: PaginacaoDto): Promise<RespostaPaginada<UsuarioRespostaDto>> {
    const { rows, count } = await this.professorModel.findAndCountAll({
      include: [{ model: Usuario, required: true }],
      order: [[{ model: Usuario, as: 'usuario' }, 'nome', 'ASC']],
      limit: paginacao.limite,
      offset: paginacao.offset,
    });

    const dados = rows.map((professor) =>
      UsuarioRespostaDto.deModelo(professor.usuario!, null, professor),
    );

    return new RespostaPaginada(dados, count, paginacao.pagina, paginacao.limite);
  }

  async buscarProfessorOuFalhar(usuarioId: string): Promise<UsuarioRespostaDto> {
    const professor = await this.professorModel.findByPk(usuarioId, { include: [Usuario] });

    if (!professor) {
      throw new NotFoundException('Professor nao encontrado.');
    }

    return UsuarioRespostaDto.deModelo(professor.usuario!, null, professor);
  }

  async atualizarDadosProfessor(
    usuarioId: string,
    dados: { departamento?: string | null },
  ): Promise<UsuarioRespostaDto> {
    const professor = await this.professorModel.findByPk(usuarioId, { include: [Usuario] });

    if (!professor) {
      throw new NotFoundException('Professor nao encontrado.');
    }

    await professor.update({ departamento: dados.departamento ?? null });

    return UsuarioRespostaDto.deModelo(professor.usuario!, null, professor);
  }
}

/**
 * Senha provisoria aleatoria.
 *
 * `randomBytes` do modulo crypto, pelo mesmo motivo do codigo de recuperacao:
 * `Math.random` e previsivel a partir de saidas anteriores, e quem criasse
 * varias contas em sequencia conseguiria prever as senhas das seguintes.
 *
 * base64url rende 12 caracteres sem `+`, `/` ou `=` — que quebram ao ser
 * copiados de um e-mail ou colados em um terminal.
 */
function gerarSenhaAleatoria(): string {
  return randomBytes(9).toString('base64url');
}
