import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * O motivo e obrigatorio porque cancelamento nao apaga nada (RN10): a linha
 * permanece e vai para o historico. Sem motivo, o registro historico nao
 * explicaria por que o compromisso deixou de existir.
 */
export class CancelarAtendimentoDto {
  @ApiProperty({ example: 'Monitor ficou doente.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'motivo deve ser um texto' })
  @Length(5, 500, { message: 'motivo deve ter entre 5 e 500 caracteres' })
  motivo: string;
}
