import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';

import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { StatusParticipacao } from '../../common/enums/status-participacao.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { Disciplina } from '../disciplinas/entities/disciplina.model';
import { Monitoria } from './entities/monitoria.model';
import { MonitoriaParticipante } from './entities/monitoria-participante.model';

/**
 * Resultado da pergunta que todo endpoint sensivel precisa fazer:
 * "quem e esta pessoa DENTRO desta monitoria?"
 */
export interface ContextoParticipacao {
  monitoria: Monitoria;
  ehProfessorResponsavel: boolean;
  /** Vinculo ATIVO do usuario nesta monitoria, se existir. */
  participacao: MonitoriaParticipante | null;
  papel: PapelMonitoria | null;
}

/**
 * O servico mais reutilizado do sistema.
 *
 * Toda a autorizacao do nucleo do dominio e CONTEXTUAL: nao basta saber que o
 * requisitante e ALUNO, e preciso saber se ele e MONITOR ou MONITORADO NAQUELA
 * monitoria. Nenhum guard baseado apenas em perfil global consegue responder
 * isso, e por isso este servico existe e e exportado para Disponibilidades e
 * Atendimentos.
 */
@Injectable()
export class ParticipacaoService {
  constructor(
    @InjectModel(Monitoria) private readonly monitoriaModel: typeof Monitoria,
    @InjectModel(MonitoriaParticipante)
    private readonly participanteModel: typeof MonitoriaParticipante,
  ) {}

  async buscarMonitoriaOuFalhar(monitoriaId: string): Promise<Monitoria> {
    const monitoria = await this.monitoriaModel.findByPk(monitoriaId, {
      include: [Disciplina],
    });

    if (!monitoria) {
      throw new NotFoundException('Monitoria nao encontrada.');
    }

    return monitoria;
  }

  async obterContexto(
    monitoriaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ContextoParticipacao> {
    const monitoria = await this.buscarMonitoriaOuFalhar(monitoriaId);

    const ehProfessorResponsavel =
      usuario.perfis.includes(PerfilUsuario.PROFESSOR) && monitoria.professorId === usuario.id;

    // Somente o vinculo ATIVO importa para autorizacao. Vinculos encerrados
    // permanecem no banco como historico (RN10), mas nao dao acesso a nada.
    const participacao = usuario.perfis.includes(PerfilUsuario.ALUNO)
      ? await this.participanteModel.findOne({
          where: {
            monitoriaId,
            alunoId: usuario.id,
            status: StatusParticipacao.ATIVO,
          },
        })
      : null;

    return {
      monitoria,
      ehProfessorResponsavel,
      participacao,
      papel: participacao?.papel ?? null,
    };
  }

  /** Acesso de leitura ao conteudo da monitoria: responsavel ou participante ativo. */
  async exigirAcesso(
    monitoriaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ContextoParticipacao> {
    const contexto = await this.obterContexto(monitoriaId, usuario);

    if (!contexto.ehProfessorResponsavel && !contexto.participacao) {
      throw new ForbiddenException('Voce nao participa desta monitoria.');
    }

    return contexto;
  }

  /**
   * Administracao da monitoria. Note que nao basta ser PROFESSOR: e preciso ser
   * o professor RESPONSAVEL por esta monitoria especifica.
   */
  async exigirProfessorResponsavel(
    monitoriaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ContextoParticipacao> {
    const contexto = await this.obterContexto(monitoriaId, usuario);

    if (!contexto.ehProfessorResponsavel) {
      throw new ForbiddenException(
        'Apenas o professor responsavel pode administrar esta monitoria.',
      );
    }

    return contexto;
  }

  /** Exige um papel especifico e devolve o vinculo, que e o sujeito das operacoes. */
  async exigirPapel(
    monitoriaId: string,
    usuario: UsuarioAutenticado,
    papel: PapelMonitoria,
  ): Promise<MonitoriaParticipante> {
    const contexto = await this.obterContexto(monitoriaId, usuario);

    if (!contexto.participacao || contexto.papel !== papel) {
      throw new ForbiddenException(
        `Esta operacao exige que voce seja ${papel} ativo nesta monitoria.`,
      );
    }

    return contexto.participacao;
  }

  async buscarParticipanteAtivo(
    monitoriaId: string,
    alunoId: string,
    transaction?: Transaction,
  ): Promise<MonitoriaParticipante | null> {
    return this.participanteModel.findOne({
      where: { monitoriaId, alunoId, status: StatusParticipacao.ATIVO },
      transaction,
    });
  }

  /**
   * Todos os vinculos do aluno, ATIVOS e ENCERRADOS.
   *
   * Inclui encerrados de proposito: a agenda historica de uma pessoa nao pode
   * sumir porque ela saiu da monitoria (RN10).
   */
  async listarVinculosDoAluno(alunoId: string): Promise<MonitoriaParticipante[]> {
    return this.participanteModel.findAll({
      where: { alunoId },
      attributes: ['id', 'papel', 'monitoriaId', 'status'],
    });
  }

  async buscarParticipantePorIdOuFalhar(
    participanteId: string,
    monitoriaId?: string,
  ): Promise<MonitoriaParticipante> {
    const participante = await this.participanteModel.findByPk(participanteId);

    if (!participante || (monitoriaId && participante.monitoriaId !== monitoriaId)) {
      throw new NotFoundException('Participante nao encontrado nesta monitoria.');
    }

    return participante;
  }

  /** Exige vinculo ATIVO com o papel indicado — usado ao validar terceiros. */
  exigirParticipanteAtivoComPapel(
    participante: MonitoriaParticipante,
    papel: PapelMonitoria,
  ): MonitoriaParticipante {
    if (participante.status !== StatusParticipacao.ATIVO) {
      throw new ForbiddenException('Este vinculo com a monitoria esta encerrado.');
    }

    if (participante.papel !== papel) {
      throw new ForbiddenException(`Este participante nao possui o papel ${papel}.`);
    }

    return participante;
  }
}
