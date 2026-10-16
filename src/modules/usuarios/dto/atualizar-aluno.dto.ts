import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * `matricula` nao e editavel: e dado de identidade institucional.
 *
 * `curso` deixou de ser texto livre e virou `cursoId`. A troca e permitida, mas
 * so enquanto o aluno nao tiver participacao registrada em monitoria: as FKs
 * compostas exigem que o curso do vinculo seja ao mesmo tempo o do aluno e o da
 * monitoria, e a RN10 preserva vinculos encerrados para sempre. Mudar o curso
 * depois reescreveria o passado, afirmando que uma monitoria cursada ocorreu em
 * um curso em que ela nao ocorreu.
 */
export class AtualizarAlunoDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Novo curso. Recusado com 409 se o aluno ja participa de alguma monitoria.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'cursoId deve ser um UUID valido' })
  cursoId?: string;
}
