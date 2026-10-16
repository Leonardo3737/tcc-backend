import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { Perfis } from '../../common/decorators/perfis.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { FiltroInscricoesDto } from './dto/filtro-inscricoes.dto';
import { InscricaoRespostaDto } from './dto/inscricao-resposta.dto';
import { cabecalhoDeAnexo, InscricoesEditalService } from './inscricoes-edital.service';

/**
 * Consulta administrativa das candidaturas. Tudo restrito a PROFESSOR.
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
 * Nenhuma destas rotas e publica, e nao ha versao publica delas: a listagem
 * carrega nome, matricula e e-mail de pessoas que podem nem ter conta.
 */
@ApiTags('Inscricoes em edital')
@ApiBearerAuth()
@Controller('inscricoes')
export class InscricoesController {
  constructor(private readonly inscricoesService: InscricoesEditalService) {}

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
