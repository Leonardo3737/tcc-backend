import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ModalidadeAtendimento } from '../../../common/enums/modalidade-atendimento.enum';
import { OrigemAtendimento } from '../../../common/enums/origem-atendimento.enum';
import { StatusAtendimento } from '../../../common/enums/status-atendimento.enum';
import { StatusInscricao } from '../../../common/enums/status-inscricao.enum';
import { Atendimento } from '../entities/atendimento.model';
import { AtendimentoParticipante } from '../entities/atendimento-participante.model';
import { AtendimentoStatusHistorico } from '../entities/atendimento-status-historico.model';

export class InscricaoRespostaDto {
  @ApiProperty({ format: 'uuid', description: 'ID da inscricao.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Vinculo do aluno com a monitoria.' })
  participanteId: string;

  @ApiPropertyOptional({ example: 'Ana Martins' }) nomeAluno?: string;
  @ApiProperty({ enum: StatusInscricao }) status: StatusInscricao;
  @ApiProperty() inscritoEm: Date;

  /**
   * Os tres campos abaixo aparecem SOMENTE na inscricao do proprio requisitante.
   *
   * E o que permite ao cliente decidir entre "Avaliar" e "ja avaliado" sem
   * tentar e tomar 409. Marcar tambem as inscricoes dos colegas revelaria quem
   * avaliou — exatamente o anonimato que a D-10 protege ao omitir a autoria.
   */
  @ApiPropertyOptional({ description: 'Presente apenas na inscricao do usuario autenticado.' })
  souEu?: boolean;

  @ApiPropertyOptional({ description: 'Se o proprio usuario ja avaliou este atendimento.' })
  jaAvaliei?: boolean;

  @ApiPropertyOptional({
    description:
      'Derivado no servidor: atendimento REALIZADO, presenca confirmada e ainda sem ' +
      'avaliacao. Quando false, o botao de avaliar nao deve aparecer.',
  })
  podeAvaliar?: boolean;

  static deModelo(
    inscricao: AtendimentoParticipante,
    contexto?: {
      statusAtendimento: StatusAtendimento;
      minhaInscricaoId: string;
      jaAvaliei: boolean;
    },
  ): InscricaoRespostaDto {
    const dto = new InscricaoRespostaDto();
    dto.id = inscricao.id;
    dto.participanteId = inscricao.participanteId;
    dto.status = inscricao.status;
    dto.inscritoEm = inscricao.inscritoEm;
    dto.nomeAluno = inscricao.participante?.aluno?.usuario?.nome;

    if (contexto && contexto.minhaInscricaoId === inscricao.id) {
      dto.souEu = true;
      dto.jaAvaliei = contexto.jaAvaliei;
      dto.podeAvaliar =
        contexto.statusAtendimento === StatusAtendimento.REALIZADO &&
        inscricao.status === StatusInscricao.PRESENTE &&
        !contexto.jaAvaliei;
    }

    return dto;
  }
}

export class HistoricoStatusRespostaDto {
  @ApiPropertyOptional({ enum: StatusAtendimento, nullable: true })
  statusAnterior: StatusAtendimento | null;

  @ApiProperty({ enum: StatusAtendimento }) statusNovo: StatusAtendimento;
  @ApiPropertyOptional({ nullable: true }) motivo: string | null;
  @ApiProperty({ format: 'uuid' }) alteradoPorUsuarioId: string;
  @ApiPropertyOptional({ example: 'Joao Ribeiro' }) alteradoPorNome?: string;
  @ApiProperty() criadoEm: Date;

  static deModelo(registro: AtendimentoStatusHistorico): HistoricoStatusRespostaDto {
    const dto = new HistoricoStatusRespostaDto();
    dto.statusAnterior = registro.statusAnterior;
    dto.statusNovo = registro.statusNovo;
    dto.motivo = registro.motivo;
    dto.alteradoPorUsuarioId = registro.alteradoPorUsuarioId;
    dto.alteradoPorNome = registro.alteradoPor?.nome;
    dto.criadoEm = registro.criadoEm;
    return dto;
  }
}

export class ResumoMonitoriaDoAtendimentoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: '2026/2' }) periodo: string;
  @ApiProperty({ example: 'MAT101' }) codigoDisciplina: string;
  @ApiProperty({ example: 'Calculo I' }) nomeDisciplina: string;
}

export class AtendimentoRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) monitoriaId: string;

  /**
   * Resumo legivel da monitoria, incluido em TODAS as rotas de atendimento.
   *
   * /atendimentos/meus e uma agenda que cruza monitorias: sem isto, montar
   * "Calculo I — terca, 14h" exigia uma requisicao por linha da lista (N+1).
   * Optei por incluir tambem nas rotas onde a monitoria ja e conhecida pela URL:
   * o custo e um JOIN em tabela pequena, e o ganho e o cliente nao precisar de
   * dois formatos de AtendimentoRespostaDto.
   */
  @ApiPropertyOptional({ type: ResumoMonitoriaDoAtendimentoDto })
  monitoria?: ResumoMonitoriaDoAtendimentoDto;
  @ApiProperty({ format: 'uuid' }) monitorParticipanteId: string;
  @ApiPropertyOptional({ example: 'Ana Martins' }) nomeMonitor?: string;
  @ApiProperty() inicio: Date;
  @ApiProperty() fim: Date;
  @ApiProperty({ example: 1 }) vagas: number;

  @ApiProperty({ example: 0, description: 'Inscricoes que ocupam vaga (INSCRITO ou PRESENTE).' })
  vagasOcupadas: number;

  @ApiProperty({ enum: ModalidadeAtendimento }) modalidade: ModalidadeAtendimento;
  @ApiPropertyOptional({ nullable: true }) local: string | null;
  @ApiProperty() assunto: string;
  @ApiProperty({ enum: StatusAtendimento }) status: StatusAtendimento;
  @ApiProperty({ enum: OrigemAtendimento }) origem: OrigemAtendimento;
  @ApiPropertyOptional({ nullable: true }) motivoCancelamento: string | null;

  /**
   * Calculado no SERVIDOR.
   *
   * Nao existe status ABERTO no dominio (ver arquitetura §6.1): a condicao e
   * derivada. Deixar a derivacao para o cliente faria cada um reimplementar a
   * regra e, pior, comparar `inicio > agora` com o relogio do navegador — que
   * pode estar errado.
   */
  @ApiProperty({
    example: true,
    description: 'AGENDADO, com vaga livre e ainda nao iniciado. Avaliado no relogio do servidor.',
  })
  aceitaInscricao: boolean;

  @ApiPropertyOptional({ type: [InscricaoRespostaDto] })
  inscricoes?: InscricaoRespostaDto[];

  @ApiPropertyOptional({ type: [HistoricoStatusRespostaDto] })
  historico?: HistoricoStatusRespostaDto[];

  static deModelo(
    atendimento: Atendimento,
    contextoInscricao?: {
      statusAtendimento: StatusAtendimento;
      minhaInscricaoId: string;
      jaAvaliei: boolean;
    },
  ): AtendimentoRespostaDto {
    const dto = new AtendimentoRespostaDto();
    dto.id = atendimento.id;
    dto.monitoriaId = atendimento.monitoriaId;
    dto.monitorParticipanteId = atendimento.monitorParticipanteId;
    dto.nomeMonitor = atendimento.monitor?.aluno?.usuario?.nome;
    dto.inicio = atendimento.inicio;
    dto.fim = atendimento.fim;
    dto.vagas = atendimento.vagas;
    dto.modalidade = atendimento.modalidade;
    dto.local = atendimento.local;
    dto.assunto = atendimento.assunto;
    dto.status = atendimento.status;
    dto.origem = atendimento.origem;
    dto.motivoCancelamento = atendimento.motivoCancelamento;

    const inscricoes = atendimento.inscricoes ?? [];
    dto.vagasOcupadas = inscricoes.filter(
      (i) => i.status === StatusInscricao.INSCRITO || i.status === StatusInscricao.PRESENTE,
    ).length;

    dto.aceitaInscricao =
      atendimento.status === StatusAtendimento.AGENDADO &&
      dto.vagasOcupadas < atendimento.vagas &&
      atendimento.inicio.getTime() > Date.now();

    if (atendimento.monitoria?.disciplina) {
      dto.monitoria = {
        id: atendimento.monitoria.id,
        periodo: `${atendimento.monitoria.ano}/${atendimento.monitoria.semestre}`,
        codigoDisciplina: atendimento.monitoria.disciplina.codigo,
        nomeDisciplina: atendimento.monitoria.disciplina.nome,
      };
    }

    if (atendimento.inscricoes) {
      dto.inscricoes = inscricoes.map((inscricao) =>
        InscricaoRespostaDto.deModelo(inscricao, contextoInscricao),
      );
    }

    if (atendimento.historico) {
      dto.historico = atendimento.historico
        .slice()
        .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
        .map(HistoricoStatusRespostaDto.deModelo);
    }

    return dto;
  }
}
