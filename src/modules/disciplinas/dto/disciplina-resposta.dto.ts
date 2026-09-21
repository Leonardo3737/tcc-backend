import { ApiProperty } from '@nestjs/swagger';

import { Disciplina } from '../entities/disciplina.model';

export class DisciplinaRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'MAT101' }) codigo: string;
  @ApiProperty({ example: 'Calculo I' }) nome: string;
  @ApiProperty({ example: true }) ativa: boolean;

  static deModelo(disciplina: Disciplina): DisciplinaRespostaDto {
    const dto = new DisciplinaRespostaDto();
    dto.id = disciplina.id;
    dto.codigo = disciplina.codigo;
    dto.nome = disciplina.nome;
    dto.ativa = disciplina.ativa;
    return dto;
  }
}
