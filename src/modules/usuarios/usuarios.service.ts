import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { UsuarioRespostaDto } from './dto/usuario-resposta.dto';
import { Aluno } from './entities/aluno.model';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { StatusParticipacao } from '../../common/enums/status-participacao.enum';
import { FiltroAlunosDto } from './dto/filtro-alunos.dto';
import { HashService } from './hash.service';
import { Professor } from './entities/professor.model';
import { Usuario } from './entities/usuario.model';

interface DadosBaseUsuario {
  nome: string;
  email: string;
  senhaHash: string;
}

@Injectable()
export class UsuariosService {
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
  ): Promise<UsuarioRespostaDto> {
    return this.sequelize.transaction(async (transaction) => {
      const usuario = await this.usuarioModel.create(
        { nome: dados.nome, email: dados.email, senhaHash: dados.senhaHash },
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

      return UsuarioRespostaDto.deModelo(usuario, aluno, null);
    });
  }

  /** Cria USUARIO + PROFESSOR em uma unica transacao. Ver criarAluno. */
  async criarProfessor(
    dados: DadosBaseUsuario & {
      identificacaoFuncional?: string | null;
      departamento?: string | null;
    },
  ): Promise<UsuarioRespostaDto> {
    return this.sequelize.transaction(async (transaction) => {
      const usuario = await this.usuarioModel.create(
        { nome: dados.nome, email: dados.email, senhaHash: dados.senhaHash },
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

      return UsuarioRespostaDto.deModelo(usuario, null, professor);
    });
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
