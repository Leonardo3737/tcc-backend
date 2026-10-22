import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { Perfis } from '../../common/decorators/perfis.decorator';
import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { AprovacaoDeInscricaoService } from './aprovacao-de-inscricao.service';
import { AprovacaoRespostaDto } from './dto/aprovacao-resposta.dto';
import {
  FiltroExportacaoInscricoesDto,
  FiltroInscricoesDto,
  FiltroResumoInscricoesDto,
} from './dto/filtro-inscricoes.dto';
import { InscricaoRespostaDto } from './dto/inscricao-resposta.dto';
import { ResumoPorDisciplinaDto } from './dto/resumo-por-disciplina.dto';
import { cabecalhoDeAnexo, InscricoesEditalService } from './inscricoes-edital.service';

/** O tipo MIME de .xlsx. Longo demais para repetir em quatro lugares. */
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Operacoes administrativas sobre as candidaturas. Tudo restrito a PROFESSOR.
 *
 * A invariante que a separacao em relacao a `InscricoesPublicasController`
 * preserva e UMA: nenhuma rota deste arquivo e publica. Nao e "nada escreve" —
 * a aprovacao de candidatura escreve, e bastante. E que uma classe inteira sem
 * `@Publico()` torna impossivel deixar passar um dado de candidato por rota
 * anonima.
 *
 * ESCOPO DE ACESSO, decidido pelo codigo existente e nao inventado aqui: o
 * perfil PROFESSOR e institucional, nao hierarquico — nao existe ADMIN no
 * sistema, e o conjunto de professores se expande por decisao de quem ja esta
 * dentro (ver `ProfessoresController.criar`). Um processo seletivo de monitoria
 * e conduzido por banca, nao pelo professor que cada candidato indicou, entao
 * restringir a listagem ao `professorId` de cada inscricao impediria exatamente
 * o uso para o qual ela existe.
 *
 * O que existe e o FILTRO `professorId`, com que um professor ve as
 * candidaturas que o indicaram como responsavel. Isso e recorte de consulta,
 * nao de permissao — e a distincao esta aqui registrada porque e uma decisao,
 * nao um esquecimento.
 *
 * Nao ha versao publica de nada daqui: a listagem carrega nome, matricula e
 * e-mail de pessoas que podem nem ter conta.
 */
@ApiTags('Inscricoes em edital')
@ApiBearerAuth()
@Controller('inscricoes')
export class InscricoesController {
  constructor(
    private readonly inscricoesService: InscricoesEditalService,
    private readonly aprovacaoService: AprovacaoDeInscricaoService,
  ) {}

  @Get()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Lista candidaturas com filtros, ordenacao e paginacao. Somente PROFESSOR.',
    description:
      'Filtros: edital, curso, disciplina, turno, professor responsavel, ano e semestre do ' +
      'edital, e `busca` parcial por nome, matricula ou e-mail. Ordenacao por media, n1, n2, ' +
      'nome, matricula ou data de inscricao, em ordem crescente ou decrescente — com notas ' +
      'ausentes sempre no FIM da lista nas duas direcoes, para que "sem nota" nunca seja ' +
      'lido como "nota baixa". Paginacao no banco, com teto de 100 itens por pagina. ' +
      'O PDF do boletim NAO vem aqui: so o metadado (nome, tamanho, sha256).',
  })
  @ApiRespostaPaginada(InscricaoRespostaDto)
  listar(@Query() filtro: FiltroInscricoesDto): Promise<RespostaPaginada<InscricaoRespostaDto>> {
    return this.inscricoesService.listar(filtro);
  }

  /**
   * Declarada ANTES de `GET /:id` de proposito.
   *
   * O Nest resolve rotas na ordem do arquivo. Depois de `:id`, "resumo" seria
   * lido como identificador e o ParseUUIDPipe devolveria 400 — mesmo cuidado
   * de `/editais/abertos` e `/professores/publicos`.
   */
  @Get('resumo')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Totais de candidaturas agrupados por disciplina. Somente PROFESSOR.',
    description:
      'Uma linha por disciplina que RECEBEU candidatura, pensada como cabecalho de acordeao: ' +
      'o cliente desenha os grupos com esta resposta e carrega os candidatos de cada um sob ' +
      'demanda, em GET /inscricoes?editalId=...&disciplinaId=.... ' +
      'Aceita exatamente os mesmos filtros da listagem — e precisa aceitar, senao o total do ' +
      'cabecalho nao bate com o conteudo do grupo. ' +
      'NAO e paginado: o resultado e limitado pelo catalogo de disciplinas, nao pelo numero ' +
      'de candidatos; por isso reordenar no cliente aqui e correto. ' +
      'ATENCAO: disciplina com ZERO candidatos nao aparece, porque o edital nao declara as ' +
      'disciplinas que oferece — esta e a lista do que chegou, nao do que foi ofertado.',
  })
  @ApiOkResponse({ type: [ResumoPorDisciplinaDto] })
  resumo(@Query() filtro: FiltroResumoInscricoesDto): Promise<ResumoPorDisciplinaDto[]> {
    return this.inscricoesService.resumoPorDisciplina(filtro);
  }

  /**
   * Declarada ANTES de `GET /:id`, como `resumo` — depois dele, "exportar"
   * seria lido como identificador e o ParseUUIDPipe devolveria 400.
   */
  @Get('exportar')
  @Perfis(PerfilUsuario.PROFESSOR)
  @Header('Cache-Control', 'no-store')
  @ApiProduces(TIPO_XLSX)
  @ApiOperation({
    summary: 'Exporta as inscricoes do edital em planilha .xlsx. Somente PROFESSOR.',
    description:
      'Colunas: e-mail, nome e matricula do aluno, curso, disciplina, nome do professor, ' +
      'turno, N1, N2 e media. Notas e media saem como NUMERO, nao texto, e nota ausente vira ' +
      'celula VAZIA — nunca zero, que falsearia qualquer media calculada na planilha. ' +
      '`editalId` e obrigatorio: planilha que mistura editais poe candidatos de processos ' +
      'diferentes na mesma coluna de media. ' +
      'Aceita os mesmos filtros da listagem (curso, disciplina, turno, professor, busca, ano, ' +
      'semestre) e a mesma ordenacao, com notas ausentes sempre no fim. ' +
      'NAO e paginada: devolve todas as linhas do recorte. Acima do teto a exportacao e ' +
      'RECUSADA com 409, em vez de entregar um arquivo truncado que parece completo.',
  })
  @ApiOkResponse({
    description: 'A planilha com as inscricoes do recorte.',
    content: { [TIPO_XLSX]: { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiConflictResponse({
    description: 'O recorte excede o teto de linhas da exportacao.',
    type: RespostaErro,
  })
  async exportar(
    @Query() filtro: FiltroExportacaoInscricoesDto,
    @Res() resposta: Response,
  ): Promise<void> {
    const { conteudo, nomeDoArquivo, total } = await this.inscricoesService.exportar(filtro);

    resposta.setHeader('Content-Type', TIPO_XLSX);
    resposta.setHeader('Content-Length', conteudo.length);
    resposta.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivo}"`);
    /**
     * Cabecalho proprio com a contagem: o corpo e binario, entao a unica forma
     * de o cliente saber quantas linhas vieram sem abrir o arquivo. Util para a
     * tela confirmar "245 inscricoes exportadas" depois do download.
     */
    resposta.setHeader('X-Total-Inscricoes', String(total));

    resposta.end(conteudo);
  }
  @Get(':id')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Detalha uma candidatura. Somente PROFESSOR.',
    description:
      'Inclui `alunoCadastrado`: se a matricula informada pertence a um aluno que ja tem ' +
      'conta, vem o usuarioId dele. E o que diz ao professor de quem ele NAO precisa criar ' +
      'cadastro ao aprovar. Resolvido na consulta, nao gravado na inscricao.',
  })
  @ApiOkResponse({ type: InscricaoRespostaDto })
  @ApiNotFoundResponse({ description: 'Inscricao nao encontrada.', type: RespostaErro })
  detalhar(@Param('id', ParseUUIDPipe) id: string): Promise<InscricaoRespostaDto> {
    return this.inscricoesService.detalhar(id);
  }

  /**
   * APROVACAO — o unico ponto em que a selecao vira monitoria.
   *
   * Recebe o id da inscricao e NADA MAIS: disciplina, curso, periodo e os dados
   * da conta saem todos dela. Nao ha corpo porque nao ha nada para o professor
   * redigitar — e redigitar permitiria a monitoria nascer divergente da
   * candidatura que a originou.
   *
   * O que acontece, em tres passos de "encontrar ou criar" (ver
   * `AprovacaoDeInscricaoService`): a conta do candidato e reaproveitada se o
   * e-mail ja existir, ou criada com senha enviada por e-mail; a monitoria da
   * disciplina e reaproveitada se ja existir para a mesma oferta, ou criada com
   * `editalId` preenchido; e o candidato e habilitado como MONITOR por
   * `habilitarMonitor`, com RN01 e RN09 inteiras.
   *
   * POST e nao PATCH: a operacao nao edita a inscricao — ela nao e alterada em
   * nada — e sim CRIA recursos a partir dela.
   */
  @Post(':id/aprovar')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Aprova a candidatura: cria a monitoria e habilita o monitor. Somente PROFESSOR.',
    description:
      'Sem corpo: tudo vem da inscricao. O professor AUTENTICADO fica como responsavel pela ' +
      'monitoria (a RN01 exige que quem habilita seja o responsavel; o professor indicado pelo ' +
      'candidato segue gravado na inscricao como indicacao). Ano e semestre vem do EDITAL. ' +
      'Se o e-mail da inscricao ja tem conta, ela e reaproveitada e nenhuma credencial e ' +
      'enviada; se nao tem, a conta e criada e a senha provisoria vai para o e-mail do ' +
      'candidato — e se esse envio falhar, a aprovacao devolve 503 e nada e criado (AD-15). ' +
      'Aprovar um segundo candidato da mesma disciplina REUSA a monitoria e acrescenta outro ' +
      'monitor. Repetir a aprovacao de quem ja e monitor devolve 409 (RN09). ' +
      'Nao exige que o periodo de inscricoes tenha encerrado, nem que o edital esteja ativo: ' +
      'aprovar acontece depois do processo, e um edital excluido logicamente e tipicamente um ' +
      'processo que terminou.',
  })
  @ApiCreatedResponse({ type: AprovacaoRespostaDto })
  @ApiNotFoundResponse({ description: 'Inscricao nao encontrada.', type: RespostaErro })
  @ApiBadRequestResponse({
    description: 'E-mail fora do dominio institucional exigido para criar conta.',
    type: RespostaErro,
  })
  @ApiConflictResponse({
    description:
      'Conta sem perfil ALUNO ou inativa; aluno ja e monitor nesta monitoria (RN09); curso do ' +
      'aluno nao oferece a disciplina; ou ja existe monitoria da oferta fora deste edital.',
    type: RespostaErro,
  })
  @ApiServiceUnavailableResponse({
    description: 'Falha ao enviar a senha da conta nova. Nada foi criado.',
    type: RespostaErro,
  })
  aprovar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioAtual() professor: UsuarioAutenticado,
  ): Promise<AprovacaoRespostaDto> {
    return this.aprovacaoService.aprovar(id, professor);
  }

  /**
   * Download do boletim. Operacao PROTEGIDA — e a unica forma de obter o PDF.
   *
   * Decisoes de transporte, todas com consequencia:
   *
   *  - `Content-Disposition: attachment`. Nunca `inline`. PDF renderizado no
   *    navegador a partir do nosso dominio e superficie de execucao de
   *    conteudo de terceiro; `attachment` manda o navegador salvar, nao abrir.
   *    O nome e sanitizado de novo aqui, mesmo tendo sido na gravacao, porque e
   *    ele que vai dentro de um cabecalho HTTP;
   *  - `no-store`. Boletim de candidato nao deve ficar em cache de proxy nem no
   *    disco do navegador depois de fechada a aba;
   *  - `nosniff` ja vem do helmet globalmente, e e o que impede o navegador de
   *    reinterpretar o tipo declarado.
   *
   * `@Res()` desliga a serializacao automatica do Nest, que e o ponto: o corpo
   * e um Buffer, nao JSON. Como o handler nao devolve valor, o interceptor de
   * log registra a requisicao sem corpo de resposta — os bytes do PDF nao
   * entram na trilha, que seria o pior lugar possivel para eles.
   */
  @Get(':id/boletim')
  @Perfis(PerfilUsuario.PROFESSOR)
  @Header('Cache-Control', 'no-store')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Baixa o boletim em PDF de uma candidatura. Somente PROFESSOR.',
    description:
      'Devolve o arquivo como anexo (`Content-Disposition: attachment`), nunca para exibicao ' +
      'embutida. E a unica rota que le os bytes do PDF; nenhuma listagem os expoe.',
  })
  @ApiOkResponse({
    description: 'O PDF do boletim.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiNotFoundResponse({ description: 'Boletim nao encontrado.', type: RespostaErro })
  async baixarBoletim(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() resposta: Response,
  ): Promise<void> {
    const boletim = await this.inscricoesService.conteudoDoBoletim(id);

    resposta.setHeader('Content-Type', 'application/pdf');
    resposta.setHeader('Content-Length', boletim.conteudo.length);
    resposta.setHeader('Content-Disposition', cabecalhoDeAnexo(boletim.nomeOriginal));

    resposta.end(boletim.conteudo);
  }
}
