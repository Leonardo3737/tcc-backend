import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { StatusAtendimento } from '../../common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../common/enums/status-inscricao.enum';
import { StatusMonitoria } from '../../common/enums/status-monitoria.enum';
import { StatusParticipacao } from '../../common/enums/status-participacao.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { Atendimento } from '../atendimentos/entities/atendimento.model';
import { AtendimentoParticipante } from '../atendimentos/entities/atendimento-participante.model';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { FiltroParticipantesDto } from './dto/filtro-participantes.dto';
import { ParticipanteRespostaDto } from './dto/participante-resposta.dto';
import { Monitoria } from './entities/monitoria.model';
import { MonitoriaParticipante } from './entities/monitoria-participante.model';
import { ParticipacaoService } from './participacao.service';

@Injectable()
export class ParticipantesService {
  constructor(
    @InjectModel(MonitoriaParticipante)
    private readonly participanteModel: typeof MonitoriaParticipante,
    @InjectModel(Aluno) private readonly alunoModel: typeof Aluno,
    @InjectModel(Atendimento) private readonly atendimentoModel: typeof Atendimento,
    @InjectModel(AtendimentoParticipante)
    private readonly inscricaoModel: typeof AtendimentoParticipante,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  /**
   * RN01 — habilitacao de monitor.
   *
   * Nao existe "tabela de monitores": habilitar e criar o vinculo com
   * papel = MONITOR. O professor que autorizou fica registrado em
   * `habilitadoPorUsuarioId`, o que torna a RN01 auditavel e nao apenas obedecida.
   *
   * A autorizacao (ser o professor responsavel) e verificada pelo
   * ParticipacaoGuard antes de chegar aqui.
   */
  async habilitarMonitor(
    monitoria: Monitoria,
    alunoId: string,
    professor: UsuarioAutenticado,
  ): Promise<ParticipanteRespostaDto> {
    return this.criarVinculo(monitoria, alunoId, PapelMonitoria.MONITOR, professor.id);
  }

  /**
   * RN04 — o aluno precisa estar associado a monitoria para participar dos
   * atendimentos dela. Este e o ato de se associar.
   */
  async inscreverMonitorado(
    monitoria: Monitoria,
    alunoId: string,
    autorUsuarioId: string,
  ): Promise<ParticipanteRespostaDto> {
    const habilitadoPor = autorUsuarioId === alunoId ? null : autorUsuarioId;
    return this.criarVinculo(monitoria, alunoId, PapelMonitoria.MONITORADO, habilitadoPor);
  }

  private async criarVinculo(
    monitoria: Monitoria,
    alunoId: string,
    papel: PapelMonitoria,
    habilitadoPorUsuarioId: string | null,
  ): Promise<ParticipanteRespostaDto> {
    if (
      monitoria.status === StatusMonitoria.ENCERRADA ||
      monitoria.status === StatusMonitoria.CANCELADA
    ) {
      throw new ConflictException(
        `Monitoria ${monitoria.status.toLowerCase()} nao aceita novos participantes.`,
      );
    }

    const aluno = await this.alunoModel.findByPk(alunoId);

    if (!aluno) {
      throw new NotFoundException('Aluno nao encontrado. O usuario precisa ter perfil ALUNO.');
    }

    /**
     * Pre-checagem apenas para produzir uma mensagem util. A garantia REAL da
     * RN09 e o indice unico parcial `ux_participante_ativo`: sob duas
     * requisicoes simultaneas, este SELECT nao impediria nada — o indice impede.
     */
    const vinculoAtivo = await this.participacaoService.buscarParticipanteAtivo(
      monitoria.id,
      alunoId,
    );

    if (vinculoAtivo) {
      throw new ConflictException(
        `Este aluno ja participa desta monitoria como ${vinculoAtivo.papel}. ` +
          'Um aluno nao pode acumular os dois papeis na mesma monitoria (RN09).',
      );
    }

    const participante = await this.participanteModel.create({
      monitoriaId: monitoria.id,
      alunoId,
      papel,
      status: StatusParticipacao.ATIVO,
      ingressouEm: new Date(),
      habilitadoPorUsuarioId,
    });

    return this.detalhar(participante.id);
  }

  async listar(
    monitoriaId: string,
    filtro: FiltroParticipantesDto,
  ): Promise<RespostaPaginada<ParticipanteRespostaDto>> {
    const where: Record<string, unknown> = {
      monitoriaId,
      // Padrao ATIVO: o historico so aparece quando pedido explicitamente.
      status: filtro.status ?? StatusParticipacao.ATIVO,
    };

    if (filtro.papel) {
      where.papel = filtro.papel;
    }

    const { rows, count } = await this.participanteModel.findAndCountAll({
      where,
      include: [{ model: Aluno, include: [{ model: Usuario, attributes: ['id', 'nome'] }] }],
      order: [
        ['papel', 'ASC'],
        ['ingressou_em', 'ASC'],
      ],
      limit: filtro.limite,
      offset: filtro.offset,
      distinct: true,
    });

    return new RespostaPaginada(
      rows.map(ParticipanteRespostaDto.deModelo),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  async detalhar(participanteId: string): Promise<ParticipanteRespostaDto> {
    const participante = await this.participanteModel.findByPk(participanteId, {
      include: [{ model: Aluno, include: [{ model: Usuario, attributes: ['id', 'nome'] }] }],
    });

    if (!participante) {
      throw new NotFoundException('Participante nao encontrado.');
    }

    return ParticipanteRespostaDto.deModelo(participante);
  }

  /**
   * Encerra o vinculo — nunca apaga (RN10).
   *
   * Pode ser feito pelo professor responsavel ou pelo proprio aluno que sai.
   * Depois disso, o participante perde acesso a monitoria, mas continua existindo
   * como sujeito dos atendimentos passados.
   */
  async encerrarVinculo(
    monitoriaId: string,
    participanteId: string,
    usuario: UsuarioAutenticado,
    ehProfessorResponsavel: boolean,
  ): Promise<ParticipanteRespostaDto> {
    const participante = await this.participacaoService.buscarParticipantePorIdOuFalhar(
      participanteId,
      monitoriaId,
    );

    if (!ehProfessorResponsavel && participante.alunoId !== usuario.id) {
      throw new ForbiddenException('Voce so pode encerrar a sua propria participacao.');
    }

    if (participante.status === StatusParticipacao.ENCERRADO) {
      throw new ConflictException('Este vinculo ja esta encerrado.');
    }

    await this.exigirAgendaLimpa(participante);

    await participante.update({
      status: StatusParticipacao.ENCERRADO,
      encerradoEm: new Date(),
    });

    return this.detalhar(participante.id);
  }

  /**
   * Sair da monitoria com atendimentos AGENDADOS deixaria compromissos orfaos:
   * um monitor sem vinculo conduzindo sessao, ou um aluno inscrito em algo de que
   * nao participa mais. Exigimos o cancelamento explicito antes.
   */
  private async exigirAgendaLimpa(participante: MonitoriaParticipante): Promise<void> {
    if (participante.papel === PapelMonitoria.MONITOR) {
      const pendentes = await this.atendimentoModel.count({
        where: {
          monitorParticipanteId: participante.id,
          status: StatusAtendimento.AGENDADO,
        },
      });

      if (pendentes > 0) {
        throw new ConflictException(
          `Este monitor possui ${pendentes} atendimento(s) AGENDADO(s). ` +
            'Cancele-os antes de encerrar a participacao.',
        );
      }

      return;
    }

    const pendentes = await this.inscricaoModel.count({
      where: {
        participanteId: participante.id,
        status: StatusInscricao.INSCRITO,
      },
    });

    if (pendentes > 0) {
      throw new ConflictException(
        `Este aluno possui ${pendentes} inscricao(oes) ativa(s) em atendimentos. ` +
          'Cancele-as antes de encerrar a participacao.',
      );
    }
  }

  /** Usado ao agendar: valida que o alvo e um MONITOR ativo daquela monitoria. */
  async exigirMonitorAtivo(
    monitoriaId: string,
    participanteId: string,
  ): Promise<MonitoriaParticipante> {
    const participante = await this.participacaoService.buscarParticipantePorIdOuFalhar(
      participanteId,
      monitoriaId,
    );

    if (participante.papel !== PapelMonitoria.MONITOR) {
      throw new BadRequestException('O participante informado nao e MONITOR desta monitoria.');
    }

    if (participante.status !== StatusParticipacao.ATIVO) {
      throw new ConflictException('Este monitor nao esta mais ativo na monitoria.');
    }

    return participante;
  }
}
