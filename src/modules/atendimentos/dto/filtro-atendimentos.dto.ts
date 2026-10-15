import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';
import { StatusAtendimento } from '../../../common/enums/status-atendimento.enum';

/**
 * Campos pelos quais a listagem de atendimentos pode ser ordenada.
 *
 * E um ENUM, nao uma string livre. O valor vira nome de coluna dentro do
 * ORDER BY, e aceitar texto do cliente ali e injecao de SQL — o Sequelize nao
 * escapa identificadores de ordenacao como escapa valores.
 */
export enum CampoOrdenacaoAtendimento {
  INICIO = 'inicio',
  CRIADO_EM = 'criadoEm',
}

export enum DirecaoOrdenacao {
  ASC = 'asc',
  DESC = 'desc',
}

export class FiltroAtendimentosDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: StatusAtendimento })
  @IsOptional()
  @IsEnum(StatusAtendimento, { message: 'status invalido' })
  status?: StatusAtendimento;

  @ApiPropertyOptional({ format: 'date-time', description: 'Limite inferior de `inicio`.' })
  @IsOptional()
  @IsDateString({}, { message: 'de deve ser uma data ISO 8601 valida' })
  de?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Limite superior de `inicio`.' })
  @IsOptional()
  @IsDateString({}, { message: 'ate deve ser uma data ISO 8601 valida' })
  ate?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra pelo vinculo do monitor.' })
  @IsOptional()
  @IsUUID('4', { message: 'monitorParticipanteId deve ser um UUID valido' })
  monitorParticipanteId?: string;

  /**
   * Contrapartida do campo derivado `aceitaInscricao`: filtra as sessoes em que
   * ainda da para entrar, sem obrigar o cliente a paginar tudo e descartar.
   */
  @ApiPropertyOptional({
    description: 'true devolve apenas sessoes AGENDADAS, com vaga livre e ainda nao iniciadas.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'aceitandoInscricao deve ser booleano' })
  aceitandoInscricao?: boolean;

  /**
   * A4 — fila de registro de presenca do MONITOR.
   *
   * Sessao que ja comecou e continua AGENDADA esta esperando um ato dele. A
   * consequencia de ninguem ver essa fila nao e cosmetica: sem REALIZADO e
   * PRESENTE, o aluno nao pode avaliar (RN06) e ninguem pontua.
   */
  @ApiPropertyOptional({
    description:
      'true devolve apenas sessoes AGENDADAS que ja comecaram e em que voce e o MONITOR. ' +
      'So funciona em GET /atendimentos/meus.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'aguardandoRegistro deve ser booleano' })
  aguardandoRegistro?: boolean;

  /**
   * A4 — o que VOCE ainda pode avaliar.
   *
   * Usa o mesmo criterio de `InscricaoRespostaDto.podeAvaliar`, para que a
   * lista e o botao nunca discordem.
   */
  @ApiPropertyOptional({
    description:
      'true devolve apenas atendimentos REALIZADOS em que voce esteve PRESENTE e ainda ' +
      'nao avaliou. So funciona em GET /atendimentos/meus.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'pendentesDeAvaliacao deve ser booleano' })
  pendentesDeAvaliacao?: boolean;

  @ApiPropertyOptional({
    enum: CampoOrdenacaoAtendimento,
    default: CampoOrdenacaoAtendimento.INICIO,
  })
  @IsOptional()
  @IsEnum(CampoOrdenacaoAtendimento, { message: 'ordenarPor deve ser inicio ou criadoEm' })
  ordenarPor: CampoOrdenacaoAtendimento = CampoOrdenacaoAtendimento.INICIO;

  /**
   * `desc` por padrao (mais recentes primeiro), que e a leitura de historico.
   * A agenda "proximos primeiro" pede `asc` — e o motivo de este parametro
   * existir: sem ele, o cliente so consegue reordenar DENTRO da pagina atual, o
   * que produz ordem errada assim que ha mais de uma pagina.
   */
  @ApiPropertyOptional({ enum: DirecaoOrdenacao, default: DirecaoOrdenacao.DESC })
  @IsOptional()
  @IsEnum(DirecaoOrdenacao, { message: 'direcao deve ser asc ou desc' })
  direcao: DirecaoOrdenacao = DirecaoOrdenacao.DESC;
}
