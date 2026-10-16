import { ApiProperty } from '@nestjs/swagger';

import { Disciplina } from '../entities/disciplina.model';

export class CursoDaDisciplinaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'SIS001' }) codigo: string;
  @ApiProperty({ example: 'Sistemas de Informacao' }) nome: string;
}

export class DisciplinaRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'MAT101' }) codigo: string;
  @ApiProperty({ example: 'Calculo I' }) nome: string;
  @ApiProperty({ example: true }) ativa: boolean;

  /**
   * Cursos que oferecem a disciplina.
   *
   * Vem vazio quando a relacao nao foi carregada na consulta — o cliente nao
   * deve concluir dai que a disciplina nao tem curso, ja que ter pelo menos um
   * e obrigatorio.
   */
  @ApiProperty({ type: [CursoDaDisciplinaDto] })
  cursos: CursoDaDisciplinaDto[];

  static deModelo(disciplina: Disciplina): DisciplinaRespostaDto {
    const dto = new DisciplinaRespostaDto();
    dto.id = disciplina.id;
    dto.codigo = disciplina.codigo;
    dto.nome = disciplina.nome;
    dto.ativa = disciplina.ativa;
    dto.cursos = (disciplina.cursos ?? []).map((curso) => ({
      id: curso.id,
      codigo: curso.codigo,
      nome: curso.nome,
    }));
    return dto;
  }
}
