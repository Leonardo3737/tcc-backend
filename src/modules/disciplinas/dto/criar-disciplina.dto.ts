import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class CriarDisciplinaDto {
  @ApiProperty({ example: 'MAT101' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'codigo deve ser um texto' })
  @Matches(/^[A-Za-z0-9.-]{2,20}$/, {
    message: 'codigo deve ter de 2 a 20 caracteres alfanumericos, ponto ou hifen',
  })
  codigo: string;

  @ApiProperty({ example: 'Calculo I' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nome deve ser um texto' })
  @Length(2, 150, { message: 'nome deve ter entre 2 e 150 caracteres' })
  nome: string;
}
