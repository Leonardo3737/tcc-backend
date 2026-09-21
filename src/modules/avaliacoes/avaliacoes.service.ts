import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/sequelize';

import { StatusAtendimento } from '../../common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../common/enums/status-inscricao.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AtendimentoParticipante } from '../atendimentos/entities/atendimento-participante.model';
import { Atendimento } from '../atendimentos/entities/atendimento.model';
import { EVENTO_AVALIACAO_REGISTRADA, AvaliacaoRegistradaEvento } from '../gamificacao/eventos';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { ParticipacaoService } from '../monitorias/participacao.service';
import { AvaliacaoRespostaDto, ResumoAvaliacoesDto } from './dto/avaliacao-resposta.dto';
import { CriarAvaliacaoDto } from './dto/criar-avaliacao.dto';
import { Avaliacao } from './entities/avaliacao.model';

@Injectable()
export class AvaliacoesService {
  constructor(
    @InjectModel(Avaliacao) private readonly avaliacaoModel: typeof Avaliacao,
    @InjectModel(AtendimentoParticipante)
    private readonly inscricaoModel: typeof AtendimentoParticipante,
    private readonly participacaoService: ParticipacaoService,
    private readonly eventos: EventEmitter2,
  ) {}

  /**
   * Registra a avaliacao de um atendimento pelo monitorado que participou dele.
   *
   * As quatro regras pedidas, e onde cada uma e garantida:
   *
   *  1. "somente participante autorizado pode avaliar" — a avaliacao referencia a
   *     INSCRICAO, e so criamos a partir da inscricao DO PROPRIO requisitante.
   *     Um terceiro nao tem inscricao para apontar (RN05);
   *  2. "atendimento deve estar concluido" — status REALIZADO (RN06);
   *  3. "nao permitir avaliacao de atendimento cancelado" — decorre de (2), mas e
   *     verificado com mensagem propria, porque o usuario merece saber o motivo;
   *  4. "preservar historico" — nada e apagado; a avaliacao e imutavel apos criada.
   *
   * Alem disso: quem faltou (AUSENTE) nao avalia. Avaliar uma sessao em que nao
   * se esteve presente nao mede nada.
   */
  async avaliar(
    atendimentoId: string,
    dto: CriarAvaliacaoDto,
    usuario: UsuarioAutenticado,
  ): Promise<AvaliacaoRespostaDto> {
    const inscricao = await this.inscricaoModel.findOne({
      where: { atendimentoId },
      include: [
        { model: Atendimento, as: 'atendimento' },
        { model: MonitoriaParticipante, where: { alunoId: usuario.id }, required: true },
      ],
    });

    if (!inscricao) {
      throw new ForbiddenException(
        'Somente um aluno monitorado que participou deste atendimento pode avalia-lo.',
      );
    }

    const atendimento = inscricao.atendimento!;

    if (atendimento.status === StatusAtendimento.CANCELADO) {
      throw new ConflictException('Nao e possivel avaliar um atendimento cancelado.');
    }

    if (atendimento.status !== StatusAtendimento.REALIZADO) {
      throw new ConflictException(
        'A avaliacao so pode ser registrada depois que o atendimento for concluido.',
      );
    }

    if (inscricao.status !== StatusInscricao.PRESENTE) {
      throw new ConflictException(
        'Somente quem teve presenca registrada neste atendimento pode avalia-lo.',
      );
    }

    const jaAvaliou = await this.avaliacaoModel.findOne({
      where: { atendimentoParticipanteId: inscricao.id },
    });

    // A garantia real e o UNIQUE em atendimento_participante_id; esta checagem
    // existe so para devolver 409 com mensagem de dominio em vez de erro de banco.
    if (jaAvaliou) {
      throw new ConflictException('Voce ja avaliou este atendimento.');
    }

    const avaliacao = await this.avaliacaoModel.create({
      atendimentoParticipanteId: inscricao.id,
      nota: dto.nota,
      comentario: dto.comentario ?? null,
    });

    /**
     * Emite um evento em vez de chamar a gamificacao.
     *
     * Avaliar e um ato do dominio de monitoria; pontuar e uma consequencia
     * opcional. Se a gamificacao for removida amanha, este service continua
     * correto sem nenhuma alteracao.
     */
    this.eventos.emit(
      EVENTO_AVALIACAO_REGISTRADA,
      new AvaliacaoRegistradaEvento(
        avaliacao.id,
        atendimento.monitoriaId,
        atendimento.monitorParticipanteId,
        dto.nota,
      ),
    );

    avaliacao.inscricao = inscricao;
    return AvaliacaoRespostaDto.deModelo(avaliacao);
  }

  /**
   * Avaliacoes de um atendimento. Visivel a quem participa da monitoria — a
   * autoria nao e exposta (ver AvaliacaoRespostaDto).
   */
  async listarPorAtendimento(
    atendimentoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ResumoAvaliacoesDto> {
    const inscricaoQualquer = await this.inscricaoModel.findOne({
      where: { atendimentoId },
      include: [{ model: Atendimento, as: 'atendimento' }],
    });

    if (!inscricaoQualquer) {
      throw new NotFoundException('Atendimento sem inscricoes ou inexistente.');
    }

    await this.participacaoService.exigirAcesso(
      inscricaoQualquer.atendimento!.monitoriaId,
      usuario,
    );

    const avaliacoes = await this.avaliacaoModel.findAll({
      include: [
        {
          model: AtendimentoParticipante,
          as: 'inscricao',
          where: { atendimentoId },
          required: true,
        },
      ],
      order: [['created_at', 'DESC']],
    });

    return this.montarResumo(avaliacoes);
  }

  /** Avaliacoes recebidas por um monitor, agregadas. Base do indicador de qualidade. */
  async listarPorMonitor(
    monitoriaId: string,
    monitorParticipanteId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ResumoAvaliacoesDto> {
    await this.participacaoService.exigirAcesso(monitoriaId, usuario);

    const avaliacoes = await this.avaliacaoModel.findAll({
      include: [
        {
          model: AtendimentoParticipante,
          as: 'inscricao',
          required: true,
          include: [
            {
              model: Atendimento,
              as: 'atendimento',
              required: true,
              where: { monitoriaId, monitorParticipanteId },
            },
          ],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    return this.montarResumo(avaliacoes);
  }

  private montarResumo(avaliacoes: Avaliacao[]): ResumoAvaliacoesDto {
    const total = avaliacoes.length;
    const media =
      total === 0
        ? null
        : Number((avaliacoes.reduce((soma, a) => soma + a.nota, 0) / total).toFixed(2));

    return { total, media, avaliacoes: avaliacoes.map(AvaliacaoRespostaDto.deModelo) };
  }
}
