import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class DisciplinaDoResumoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'BAN001' }) codigo: string;
  @ApiProperty({ example: 'Banco de Dados' }) nome: string;
}

/**
 * Uma linha por disciplina que RECEBEU candidatura no recorte consultado.
 *
 * E o cabecalho de um acordeao: o cliente desenha os grupos a partir daqui e
 * carrega os candidatos de cada um sob demanda, com
 * `GET /inscricoes?editalId=...&disciplinaId=...`. A divisao de trabalho e
 * proposital — o resumo tem tamanho limitado pelo catalogo de disciplinas,
 * enquanto a lista de candidatos cresce sem teto e por isso continua paginada
 * no banco.
 *
 * ---------------------------------------------------------------------------
 * LIMITE QUE PRECISA ESTAR AS CLARAS
 *
 * Disciplina com ZERO candidatos nao aparece — e nao e descuido da consulta: o
 * edital nao declara quais disciplinas oferece. A tabela `editais` tem apenas
 * periodo, link e semestre, entao o conjunto de disciplinas de um edital e
 * DERIVADO das inscricoes recebidas.
 *
 * A consequencia pratica: o professor nao consegue distinguir "ninguem se
 * inscreveu em Calculo I" de "Calculo I nao faz parte deste edital". Resolver
 * isso nao e trabalho de consulta — exige o edital passar a declarar suas
 * vagas, em uma tabela `edital_disciplinas`. Enquanto ela nao existir, esta
 * resposta e a lista do que CHEGOU, nao a do que foi OFERTADO.
 */
export class ResumoPorDisciplinaDto {
  @ApiProperty({ type: DisciplinaDoResumoDto })
  disciplina: DisciplinaDoResumoDto;

  @ApiProperty({
    example: 7,
    description:
      'Candidaturas desta disciplina no recorte consultado. Como uma pessoa so pode se ' +
      'inscrever uma vez por edital (UNIQUE em matricula e e-mail), os grupos sao ' +
      'disjuntos e a soma dos totais e o total do edital — nao ha contagem dupla.',
  })
  totalInscricoes: number;

  /**
   * Quantos dao para RANQUEAR.
   *
   * A banca escolhe o monitor pela media, e candidato sem nota nao entra na
   * ordenacao de verdade (vai para o fim, por NULLS LAST). Ver os dois numeros
   * no cabecalho evita a leitura errada de "7 candidatos" quando so 3 sao
   * comparaveis.
   */
  @ApiProperty({ example: 5, description: 'Candidaturas com media calculada (n1 e n2 presentes).' })
  comMedia: number;

  @ApiProperty({
    example: 2,
    description: 'Candidaturas sem media, por falta de n1 ou n2. Derivado de totalInscricoes.',
  })
  semMedia: number;

  @ApiPropertyOptional({
    example: 8.85,
    nullable: true,
    description:
      'Maior media da disciplina. Nula quando nenhum candidato tem media — nunca zero, ' +
      'porque ausencia de nota nao e nota baixa.',
  })
  melhorMedia: number | null;

  /**
   * A disciplina JA FOI RESOLVIDA: existe monitoria deste edital para ela, com
   * pelo menos um monitor habilitado.
   *
   * E o campo que a tela usa para marcar o grupo como concluido. As duas
   * condicoes andam juntas de proposito: monitoria sem monitor e um passo pela
   * metade — pode ser o resultado de uma aprovacao que falhou entre criar a
   * monitoria e habilitar o candidato —, e marcar o grupo como pronto nesse
   * estado esconderia exatamente o caso que precisa de atencao.
   */
  @ApiProperty({
    example: true,
    description:
      'Ja existe monitoria DESTE edital para a disciplina E ela tem monitor habilitado. ' +
      'Monitoria criada sem monitor nao conta como resolvida.',
  })
  monitoriaCadastrada: boolean;

  /**
   * A monitoria vinda deste edital, se houver — mesmo sem monitor ainda.
   *
   * Diferente de `monitoriaCadastrada`: preenchido com `monitoresHabilitados`
   * em zero e o estado "monitoria aberta, monitor pendente", que o cliente pode
   * tratar como retomavel (aprovar de novo a candidatura conclui o passo que
   * faltou).
   */
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Monitoria originada deste edital para a disciplina. Nula se nao houver.',
  })
  monitoriaId: string | null;

  @ApiProperty({
    example: 1,
    description:
      'Monitores ATIVOS na monitoria vinda do edital. Mais de um e o caso normal de ' +
      'disciplina com varias vagas.',
  })
  monitoresHabilitados: number;

  /**
   * A consulta e agregada e vem por SQL cru, entao as colunas chegam em
   * snake_case e TODO numero chega como string — `count(...)::int` inclusive,
   * porque o driver nao tipa o retorno de uma query solta. A conversao mora
   * aqui, na borda da API, como em `InscricaoRespostaDto`.
   */
  static deLinha(
    linha: Record<string, string | null>,
    monitoria?: { id: string; monitores: number } | null,
  ): ResumoPorDisciplinaDto {
    const total = Number(linha.total_inscricoes);
    const comMedia = Number(linha.com_media);

    const dto = new ResumoPorDisciplinaDto();
    dto.disciplina = {
      id: linha.disciplina_id as string,
      codigo: linha.disciplina_codigo as string,
      nome: linha.disciplina_nome as string,
    };
    dto.totalInscricoes = total;
    dto.comMedia = comMedia;
    dto.semMedia = total - comMedia;
    dto.melhorMedia = linha.melhor_media === null ? null : Number(linha.melhor_media);
    dto.monitoriaId = monitoria?.id ?? null;
    dto.monitoresHabilitados = monitoria?.monitores ?? 0;
    dto.monitoriaCadastrada = Boolean(monitoria && monitoria.monitores > 0);
    return dto;
  }
}
