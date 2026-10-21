import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';

export class FiltroDisciplinasDto extends PaginacaoDto {
  @ApiPropertyOptional({ description: 'Busca parcial por codigo ou nome.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;

  @ApiPropertyOptional({ description: 'Filtra por disciplinas ativas ou inativas.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'ativa deve ser booleano' })
  ativa?: boolean;

  /**
   * Apenas disciplinas oferecidas neste curso.
   *
   * Como a relacao e N:M, o filtro e de PERTINENCIA: a disciplina aparece se o
   * curso estiver entre os dela. A resposta continua trazendo TODOS os cursos
   * de cada disciplina — filtrar a lista por tabela e diferente de filtrar o
   * conteudo de cada item.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'Apenas disciplinas deste curso.' })
  @IsOptional()
  @IsUUID('4', { message: 'cursoId deve ser um UUID valido' })
  cursoId?: string;
}
