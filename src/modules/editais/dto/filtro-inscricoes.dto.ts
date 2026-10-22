import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';
import { Turno } from '../../../common/enums/turno.enum';
import { DirecaoOrdenacao } from '../../atendimentos/dto/filtro-atendimentos.dto';

/**
 * Campos pelos quais a listagem de inscricoes pode ser ordenada.
 *
 * E um ENUM, nao uma string livre, pela mesma razao registrada em
 * `CampoOrdenacaoAtendimento`: o valor vira nome de coluna dentro do ORDER BY,
 * e o Sequelize nao escapa identificadores de ordenacao como escapa valores.
 * Aceitar texto do cliente ali e injecao de SQL. Qualquer valor fora deste enum
 * ja foi recusado pelo ValidationPipe antes de chegar ao service.
 */
export enum CampoOrdenacaoInscricao {
  MEDIA = 'media',
  N1 = 'n1',
  N2 = 'n2',
  NOME = 'nome',
  MATRICULA = 'matricula',
  CRIADO_EM = 'criadoEm',
}

/**
 * Consulta administrativa de candidaturas. Restrita a PROFESSOR.
 *
 * Os quatro filtros do escopo (edital, curso, disciplina, turno) estao aqui com
 * indice dedicado cada um. Os demais foram avaliados e os uteis foram
 * implementados:
 *
 *  - `busca` cobre nome, matricula e e-mail em um campo so. Tres parametros
 *    separados exigiriam que a banca soubesse ANTES qual dos tres esta
 *    digitando, e na pratica quem procura um candidato cola o que tem a mao.
 *  - `professorId` existe porque e assim que um professor ve "as candidaturas
 *    sob minha responsabilidade" sem que a plataforma precise restringir a
 *    listagem por dono (ver a nota de autorizacao em `InscricoesController`).
 *  - `ano` e `semestre` filtram pelo periodo do EDITAL, nao da inscricao.
 *
 * Avaliado e NAO implementado: filtro por periodo de inscricao. Ele seria
 * redundante — o periodo e propriedade do edital, e `editalId` ja seleciona
 * exatamente o conjunto de candidaturas daquele periodo. Um intervalo de datas
 * solto sobre `created_at` responderia "quem se inscreveu na primeira semana",
 * que e pergunta de relatorio, nao de selecao.
 */
export class FiltroInscricoesDto extends PaginacaoDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Inscricoes deste edital.' })
  @IsOptional()
  @IsUUID('4', { message: 'editalId deve ser um UUID valido' })
  editalId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Inscricoes de candidatos deste curso.' })
  @IsOptional()
  @IsUUID('4', { message: 'cursoId deve ser um UUID valido' })
  cursoId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Inscricoes para esta disciplina.' })
  @IsOptional()
  @IsUUID('4', { message: 'disciplinaId deve ser um UUID valido' })
  disciplinaId?: string;

  @ApiPropertyOptional({ enum: Turno })
  @IsOptional()
  @IsEnum(Turno, { message: 'turno deve ser MATUTINO, VESPERTINO ou NOTURNO' })
  turno?: Turno;

  @ApiPropertyOptional({ format: 'uuid', description: 'Professor responsavel.' })
  @IsOptional()
  @IsUUID('4', { message: 'professorId deve ser um UUID valido' })
  professorId?: string;

  @ApiPropertyOptional({ description: 'Busca parcial por nome, matricula ou e-mail.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;

  @ApiPropertyOptional({ example: 2026, description: 'Ano do edital.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano?: number;

  @ApiPropertyOptional({ example: 2, enum: [1, 2], description: 'Semestre do edital.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre?: number;

  /**
   * `media` por padrao: e a ordem em que uma banca le uma lista de candidatos.
   */
  @ApiPropertyOptional({
    enum: CampoOrdenacaoInscricao,
    default: CampoOrdenacaoInscricao.MEDIA,
    description:
      'Notas e media ausentes vao sempre para o FIM da lista (NULLS LAST), nas duas ' +
      'direcoes: ordenar por media nao pode fazer "sem nota" parecer "nota baixa".',
  })
  @IsOptional()
  @IsEnum(CampoOrdenacaoInscricao, { message: 'ordenarPor invalido' })
  ordenarPor: CampoOrdenacaoInscricao = CampoOrdenacaoInscricao.MEDIA;

  @ApiPropertyOptional({ enum: DirecaoOrdenacao, default: DirecaoOrdenacao.DESC })
  @IsOptional()
  @IsEnum(DirecaoOrdenacao, { message: 'direcao deve ser asc ou desc' })
  direcao: DirecaoOrdenacao = DirecaoOrdenacao.DESC;
}

/**
 * Filtros do RESUMO por disciplina, derivados da listagem.
 *
 * `OmitType` em vez de uma classe nova escrita a mao, e a razao e a consistencia
 * que o resumo precisa manter: ele e o CABECALHO de uma lista que o cliente
 * carrega depois pelo endpoint plano. Se os dois aceitassem conjuntos de
 * filtros diferentes, o total do grupo nao bateria com o que o grupo mostra ao
 * ser aberto — e seria o cabecalho a mentir, porque ele e quem some com o
 * filtro ignorado.
 *
 * Derivando um do outro, um filtro novo em `FiltroInscricoesDto` passa a valer
 * nos dois no mesmo commit. Duas classes irmas escritas a mao divergiriam na
 * primeira adicao que alguem esquecesse de replicar.
 *
 * O que SAI e so o que nao tem sentido aqui:
 *
 *  - `pagina` e `limite`: o resumo nao pagina. Uma linha por disciplina do
 *    edital e um resultado limitado pelo catalogo da instituicao, nao pelo
 *    numero de candidatos — paginar cabecalhos de acordeao seria pior que
 *    inutil. Com `forbidNonWhitelisted`, manda-los devolve 400, que e melhor
 *    que aceitar e ignorar em silencio;
 *  - `ordenarPor` e `direcao`: a ordem e fixa (nome da disciplina). Como a
 *    resposta nao e paginada, reordenar no cliente e CORRETO aqui — ao
 *    contrario da lista de candidatos, onde ordenar dentro da pagina produz
 *    ordem errada assim que ha mais de uma pagina.
 */
export class FiltroResumoInscricoesDto extends OmitType(FiltroInscricoesDto, [
  'pagina',
  'limite',
  'ordenarPor',
  'direcao',
] as const) {}

/**
 * Filtros da EXPORTACAO em planilha, tambem derivados da listagem.
 *
 * Sai a paginacao: exportar devolve TODAS as linhas do recorte, e uma planilha
 * com 20 de 300 candidatos seria pior que nenhuma — ela abre, parece completa e
 * nao esta. O teto existe no service, e estourar o teto RECUSA em vez de
 * truncar.
 *
 * Ficam `ordenarPor` e `direcao`, ao contrario do resumo: aqui a ordem importa
 * de verdade, porque a planilha e lida na ordem em que vem — e ordenar depois
 * no Excel, numa tabela que mistura notas ausentes, e justamente onde o
 * `NULLS LAST` do servidor se perde.
 *
 * `editalId` passa a ser OBRIGATORIO, e e a unica divergencia em relacao a
 * listagem. Uma planilha que mistura editais poe candidatos de processos
 * seletivos diferentes na mesma coluna "Media", e comparar essas medias nao
 * significa nada — o recorte deixaria de ser util justamente na coluna pela
 * qual a banca decide.
 */
export class FiltroExportacaoInscricoesDto extends OmitType(FiltroInscricoesDto, [
  'pagina',
  'limite',
  'editalId',
] as const) {
  @ApiProperty({
    format: 'uuid',
    description: 'Obrigatorio: a planilha e de UM edital. Ver a nota no DTO.',
  })
  @IsUUID('4', { message: 'editalId deve ser um UUID valido' })
  editalId: string;
}
