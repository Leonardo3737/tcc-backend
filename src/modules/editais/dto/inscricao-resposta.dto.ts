import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Turno } from '../../../common/enums/turno.enum';
import { Aluno } from '../../usuarios/entities/aluno.model';
import { Boletim } from '../entities/boletim.model';
import { InscricaoEdital } from '../entities/inscricao-edital.model';

/**
 * `numeric` do PostgreSQL chega como STRING pelo driver, de proposito: e assim
 * que o `pg` evita que 9.1 se torne 9.099999999999999 no caminho. A conversao
 * para numero acontece aqui, na borda da API, onde o consumidor quer numero —
 * e nunca antes, para que nenhuma conta do sistema passe por ponto flutuante.
 */
function paraNumero(valor: string | number | null): number | null {
  if (valor === null || valor === undefined) {
    return null;
  }

  return typeof valor === 'number' ? valor : Number(valor);
}

class EditalResumoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 2026 }) ano: number;
  @ApiProperty({ example: 2 }) semestre: number;
}

class CatalogoResumoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'BAN001' }) codigo: string;
  @ApiProperty({ example: 'Banco de Dados' }) nome: string;
}

class ProfessorResumoDto {
  @ApiProperty({ format: 'uuid' }) usuarioId: string;
  @ApiPropertyOptional({ example: 'Prof. Carlos Lima', nullable: true }) nome: string | null;
}

/**
 * METADADO do PDF, nunca os bytes.
 *
 * O conteudo tem rota propria (`GET /inscricoes/:id/boletim`), autenticada e
 * restrita a PROFESSOR. Devolver o binario embutido em JSON de listagem seria
 * caro e, pior, faria o arquivo de cada candidato passar por qualquer cache ou
 * log que registre corpo de resposta.
 */
class BoletimResumoDto {
  @ApiProperty({ example: 'boletim-2021001234.pdf' }) nomeOriginal: string;
  @ApiProperty({ example: 184320 }) tamanhoBytes: number;
  @ApiProperty({ example: 'a3f1...', description: 'SHA-256 hexadecimal do arquivo.' })
  sha256: string;
}

/**
 * O candidato ja tem conta na plataforma?
 *
 * Resolvido na LEITURA, por matricula, e nao gravado na inscricao — ver o
 * cabecalho de `InscricaoEdital`. Serve ao proposito declarado no escopo: o
 * professor usa os dados da inscricao para cadastrar os aprovados, e precisa
 * saber de quem NAO precisa criar conta.
 *
 * `null` nao afirma que a pessoa nao estuda na instituicao: afirma que nenhuma
 * linha de `alunos` tem esta matricula.
 */
class AlunoVinculadoDto {
  @ApiProperty({ format: 'uuid' }) usuarioId: string;
  @ApiProperty({ format: 'uuid' }) cursoId: string;
}

/**
 * Candidatura vista pela banca. Rota AUTENTICADA, restrita a PROFESSOR.
 *
 * Carrega dado pessoal de quem pode nem ter conta (nome, matricula, e-mail), e
 * por isso nao existe versao publica desta representacao: a unica resposta que
 * um anonimo recebe sobre inscricao e a confirmacao da propria, em
 * `InscricaoConfirmacaoDto`.
 */
export class InscricaoRespostaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Maria Oliveira dos Santos' }) nomeCompleto: string;
  @ApiProperty({ example: '2021001234' }) matricula: string;
  @ApiProperty({ example: 'maria@ufx.edu.br' }) email: string;
  @ApiProperty({ enum: Turno }) turno: Turno;

  @ApiPropertyOptional({ example: 8.5, nullable: true }) n1: number | null;
  @ApiPropertyOptional({ example: 9.25, nullable: true }) n2: number | null;

  @ApiPropertyOptional({
    example: 8.88,
    nullable: true,
    description:
      'Media aritmetica de n1 e n2, calculada pelo banco (coluna GENERATED). NULA quando ' +
      'alguma das notas esta ausente — ausencia nao e zero.',
  })
  media: number | null;

  @ApiProperty({ type: EditalResumoDto }) edital: EditalResumoDto;
  @ApiProperty({ type: CatalogoResumoDto }) curso: CatalogoResumoDto;
  @ApiProperty({ type: CatalogoResumoDto }) disciplina: CatalogoResumoDto;
  @ApiProperty({ type: ProfessorResumoDto }) professor: ProfessorResumoDto;

  @ApiPropertyOptional({ type: BoletimResumoDto, nullable: true })
  boletim: BoletimResumoDto | null;

  @ApiPropertyOptional({
    type: AlunoVinculadoDto,
    nullable: true,
    description: 'Aluno ja cadastrado com esta matricula, se houver. Resolvido na consulta.',
  })
  alunoCadastrado: AlunoVinculadoDto | null;

  @ApiProperty({ example: '2026-11-12T14:03:00.000Z' }) criadoEm: Date;

  static deModelo(
    inscricao: InscricaoEdital,
    boletim?: Boletim | null,
    aluno?: Aluno | null,
  ): InscricaoRespostaDto {
    const dto = new InscricaoRespostaDto();
    dto.id = inscricao.id;
    dto.nomeCompleto = inscricao.nomeCompleto;
    dto.matricula = inscricao.matricula;
    dto.email = inscricao.email;
    dto.turno = inscricao.turno;
    dto.n1 = paraNumero(inscricao.n1);
    dto.n2 = paraNumero(inscricao.n2);
    dto.media = paraNumero(inscricao.media);

    dto.edital = {
      id: inscricao.editalId,
      ano: inscricao.edital?.ano ?? 0,
      semestre: inscricao.edital?.semestre ?? 0,
    };

    dto.curso = {
      id: inscricao.cursoId,
      codigo: inscricao.curso?.codigo ?? '',
      nome: inscricao.curso?.nome ?? '',
    };

    dto.disciplina = {
      id: inscricao.disciplinaId,
      codigo: inscricao.disciplina?.codigo ?? '',
      nome: inscricao.disciplina?.nome ?? '',
    };

    dto.professor = {
      usuarioId: inscricao.professorId,
      nome: inscricao.professor?.usuario?.nome ?? null,
    };

    const arquivo = boletim ?? inscricao.boletim ?? null;

    dto.boletim = arquivo
      ? {
          nomeOriginal: arquivo.nomeOriginal,
          tamanhoBytes: arquivo.tamanhoBytes,
          sha256: arquivo.sha256,
        }
      : null;

    dto.alunoCadastrado = aluno ? { usuarioId: aluno.usuarioId, cursoId: aluno.cursoId } : null;

    dto.criadoEm = inscricao.createdAt;
    return dto;
  }
}

/**
 * Resposta do POST publico. Deliberadamente curta.
 *
 * Nao repete notas, curso, disciplina nem metadado do PDF: o candidato acabou
 * de enviar esses dados e nao ganha nada em recebe-los de volta, enquanto a
 * resposta de uma rota anonima e o lugar mais exposto da aplicacao. O que ele
 * precisa e a confirmacao de que ficou gravado e o identificador para citar em
 * um contato posterior.
 */
export class InscricaoConfirmacaoDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador da inscricao. Guarde-o.' })
  id: string;

  @ApiProperty({ format: 'uuid' }) editalId: string;
  @ApiProperty({ example: 'Maria Oliveira dos Santos' }) nomeCompleto: string;
  @ApiProperty({ example: '2026-11-12T14:03:00.000Z' }) criadoEm: Date;

  /**
   * A inscricao esta gravada nos dois casos.
   *
   * `false` significa apenas que o e-mail de confirmacao nao saiu — provedor
   * fora, endereco recusado ou e-mail desligado no ambiente. A inscricao NAO e
   * desfeita por isso (ver `InscricoesEditalService.criar`), e o campo existe
   * para a tela poder dizer "guarde este numero" em vez de "verifique sua
   * caixa de entrada". Nenhum detalhe do provedor e exposto aqui.
   */
  @ApiProperty({ example: true, description: 'O e-mail de confirmacao foi aceito pelo provedor.' })
  emailConfirmacaoEnviado: boolean;

  static deModelo(
    inscricao: InscricaoEdital,
    emailConfirmacaoEnviado: boolean,
  ): InscricaoConfirmacaoDto {
    const dto = new InscricaoConfirmacaoDto();
    dto.id = inscricao.id;
    dto.editalId = inscricao.editalId;
    dto.nomeCompleto = inscricao.nomeCompleto;
    dto.criadoEm = inscricao.createdAt;
    dto.emailConfirmacaoEnviado = emailConfirmacaoEnviado;
    return dto;
  }
}
