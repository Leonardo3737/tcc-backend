import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';

export class FiltroAlunosDto extends PaginacaoDto {
  @ApiPropertyOptional({
    description: 'Busca parcial e sem distincao de caixa em nome, matricula ou e-mail.',
    example: 'ana',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;

  /**
   * Filtro do fluxo da RN01.
   *
   * O professor abre esta lista para habilitar um monitor. Alunos que ja tem
   * vinculo ativo naquela monitoria nao podem ser habilitados de novo (RN09) —
   * mostra-los so produziria um 409 previsivel depois de o professor escolher.
   * Melhor nao oferecer a opcao invalida.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Exclui alunos que ja possuem vinculo ATIVO na monitoria informada. ' +
      'Use ao montar a lista de candidatos a monitor (RN01/RN09).',
  })
  @IsOptional()
  @IsUUID('4', { message: 'semVinculoAtivoNaMonitoria deve ser um UUID valido' })
  semVinculoAtivoNaMonitoria?: string;

  /**
   * Restringe a um curso.
   *
   * Util no mesmo fluxo da RN01: como um aluno so participa de monitorias de
   * disciplinas do proprio curso, filtrar por curso reduz a lista de candidatos
   * ao conjunto que de fato pode ser habilitado.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'Apenas alunos deste curso.' })
  @IsOptional()
  @IsUUID('4', { message: 'cursoId deve ser um UUID valido' })
  cursoId?: string;
}
