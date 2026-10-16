import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PerfilUsuario } from '../../../common/enums/perfil-usuario.enum';
import { Aluno } from '../entities/aluno.model';
import { Professor } from '../entities/professor.model';
import { Usuario } from '../entities/usuario.model';

export class DadosAlunoDto {
  @ApiProperty({ example: '2021001234' })
  matricula: string;

  @ApiProperty({ format: 'uuid', description: 'Curso a que o aluno pertence.' })
  cursoId: string;

  /**
   * NOME do curso, nao mais texto livre.
   *
   * O campo existia como `varchar` digitado a mao e virou relacao. O nome foi
   * mantido para nao quebrar quem ja consome `aluno.curso`, mas o valor agora
   * vem de `cursos.nome` — e so aparece quando a relacao foi carregada na
   * consulta, por isso continua anulavel.
   */
  @ApiPropertyOptional({ example: 'Ciencia da Computacao', nullable: true })
  curso: string | null;
}

export class DadosProfessorDto {
  @ApiPropertyOptional({ example: '1234567', nullable: true })
  identificacaoFuncional: string | null;

  @ApiPropertyOptional({ example: 'Departamento de Computacao', nullable: true })
  departamento: string | null;
}

/**
 * Representacao de saida de um usuario.
 *
 * Montada por mapeamento explicito a partir do model. Nao devolvemos a instancia
 * do Sequelize direto: e o mapeamento manual que garante que um campo novo so
 * aparece na API quando alguem decidir expo-lo — inclusive `senhaHash`, que
 * simplesmente nao tem caminho ate aqui.
 */
export class UsuarioRespostaDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Joao da Silva' })
  nome: string;

  @ApiProperty({ example: 'joao@ufx.edu.br' })
  email: string;

  @ApiProperty({ example: true })
  ativo: boolean;

  @ApiProperty({
    enum: PerfilUsuario,
    isArray: true,
    example: [PerfilUsuario.ALUNO],
    description:
      'Perfis de identidade, derivados da existencia das linhas em alunos/professores. ' +
      'Nunca contem MONITOR ou MONITORADO: esses sao papeis por monitoria (fase 2).',
  })
  perfis: PerfilUsuario[];

  @ApiPropertyOptional({ type: DadosAlunoDto })
  aluno?: DadosAlunoDto;

  @ApiPropertyOptional({ type: DadosProfessorDto })
  professor?: DadosProfessorDto;

  @ApiProperty({ example: '2026-08-20T12:00:00.000Z' })
  criadoEm: Date;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Professor que criou esta conta administrativamente. null quando a pessoa ' +
      'se cadastrou sozinha em /auth/registro.',
  })
  criadoPorUsuarioId: string | null;

  static deModelo(usuario: Usuario, aluno?: Aluno | null, professor?: Professor | null) {
    const alunoVinculado = aluno ?? usuario.aluno;
    const professorVinculado = professor ?? usuario.professor;

    const dto = new UsuarioRespostaDto();
    dto.id = usuario.id;
    dto.nome = usuario.nome;
    dto.email = usuario.email;
    dto.ativo = usuario.ativo;
    dto.perfis = UsuarioRespostaDto.derivarPerfis(alunoVinculado, professorVinculado);
    dto.criadoEm = usuario.createdAt;
    dto.criadoPorUsuarioId = usuario.criadoPorUsuarioId ?? null;

    if (alunoVinculado) {
      dto.aluno = {
        matricula: alunoVinculado.matricula,
        cursoId: alunoVinculado.cursoId,
        curso: alunoVinculado.curso?.nome ?? null,
      };
    }

    if (professorVinculado) {
      dto.professor = {
        identificacaoFuncional: professorVinculado.identificacaoFuncional,
        departamento: professorVinculado.departamento,
      };
    }

    return dto;
  }

  /**
   * O perfil e DERIVADO, nunca armazenado (AD-03). Nao existe coluna `tipo` em
   * `usuarios`: se ha linha em `alunos`, o usuario e ALUNO; se ha em
   * `professores`, e PROFESSOR; e pode ser os dois (D-12).
   */
  static derivarPerfis(aluno?: Aluno | null, professor?: Professor | null): PerfilUsuario[] {
    const perfis: PerfilUsuario[] = [];
    if (aluno) perfis.push(PerfilUsuario.ALUNO);
    if (professor) perfis.push(PerfilUsuario.PROFESSOR);
    return perfis;
  }
}
