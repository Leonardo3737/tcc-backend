import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Registrar a realizacao inclui registrar a presenca.
 *
 * Como a sessao pode ser coletiva, faltar e um fato POR PESSOA: o atendimento
 * aconteceu, e um aluno especifico nao compareceu. Por isso a ausencia entra
 * como lista de inscricoes, e nao como um status do atendimento inteiro.
 * Quem nao for listado como ausente e considerado PRESENTE.
 */
export class RealizarAtendimentoDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'IDs das INSCRICOES cujos alunos nao compareceram.',
  })
  @IsOptional()
  @IsArray({ message: 'ausentes deve ser uma lista' })
  @IsUUID('4', { each: true, message: 'cada item de ausentes deve ser um UUID valido' })
  ausentes?: string[];
}
