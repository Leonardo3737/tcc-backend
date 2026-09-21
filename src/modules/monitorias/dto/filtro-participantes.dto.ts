import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';
import { PapelMonitoria } from '../../../common/enums/papel-monitoria.enum';
import { StatusParticipacao } from '../../../common/enums/status-participacao.enum';

export class FiltroParticipantesDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: PapelMonitoria })
  @IsOptional()
  @IsEnum(PapelMonitoria, { message: 'papel deve ser MONITOR ou MONITORADO' })
  papel?: PapelMonitoria;

  @ApiPropertyOptional({
    enum: StatusParticipacao,
    description: 'Padrao: ATIVO. Use ENCERRADO para consultar o historico (RN10).',
  })
  @IsOptional()
  @IsEnum(StatusParticipacao, { message: 'status deve ser ATIVO ou ENCERRADO' })
  status?: StatusParticipacao;
}
