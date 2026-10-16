import { ApiProperty } from '@nestjs/swagger';

import { Curso } from '../entities/curso.model';

export class CursoRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'ENG001' }) codigo: string;
  @ApiProperty({ example: 'Engenharia de Software' }) nome: string;
  @ApiProperty({ example: true }) ativo: boolean;

  static deModelo(curso: Curso): CursoRespostaDto {
    const dto = new CursoRespostaDto();
    dto.id = curso.id;
    dto.codigo = curso.codigo;
    dto.nome = curso.nome;
    dto.ativo = curso.ativo;
    return dto;
  }
}
