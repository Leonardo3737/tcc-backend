import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Publico } from '../../common/decorators/publico.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { Turno } from '../../common/enums/turno.enum';
import { CriarInscricaoDto } from './dto/criar-inscricao.dto';
import { InscricaoConfirmacaoDto } from './dto/inscricao-resposta.dto';
import {
  ArquivoRecebido,
  InscricoesEditalService,
  LIMITE_BOLETIM_BYTES,
} from './inscricoes-edital.service';

/**
 * Inscricao de candidatos em edital. ROTA PUBLICA — a unica de escrita que o
 * sistema expoe sem autenticacao.
 *
 * Controller separado do administrativo (`InscricoesController`) de proposito.
 * Nao e organizacao por gosto: ter uma classe inteira cuja unica rota e publica
 * torna impossivel esquecer um `@Publico()` sobrando sobre uma consulta de
 * dados pessoais. Aqui tudo e publico e nada le; la tudo e PROFESSOR e nada
 * escreve.
 *
 * O que esta rota NAO faz, por exigencia do escopo: nao cria linha em `alunos`
 * nem em `usuarios`, e nao cria conta nenhuma. Os dados do candidato ficam na
 * propria inscricao, e e delas que o professor parte para cadastrar os
 * aprovados — depois, manualmente.
 */
@ApiTags('Editais')
@Controller('editais/:editalId/inscricoes')
export class InscricoesPublicasController {
  constructor(private readonly inscricoesService: InscricoesEditalService) {}

  /**
   * Teto de 20 por minuto por IP.
   *
   * Mais apertado que o padrao global (120/min) porque cada chamada custa um
   * upload de ate 5 MB, uma transacao e, no fim, um e-mail — e e anonima. Sem
   * limite, serve tanto para encher a tabela quanto para queimar a cota do
   * provedor de e-mail.
   *
   * Nao e tao apertado quanto o do login (5/min) por um motivo concreto: os
   * candidatos de um laboratorio saem todos pelo mesmo IP de saida da
   * instituicao, e um teto baixo recusaria inscricoes legitimas na vespera do
   * prazo — e a recusa cairia justamente sobre quem tem menos alternativa. A
   * protecao contra duplicidade nao e o throttle e nunca foi: e a UNIQUE por
   * edital em matricula e e-mail, que vale para qualquer origem.
   *
   * `files: 1` no multer importa: sem ele, um cliente pode anexar N arquivos no
   * mesmo campo e o processo le todos antes de descartar os excedentes.
   */
  @Throttle({ padrao: { ttl: 60_000, limit: 20 } })
  @Publico()
  @Post()
  @UseInterceptors(
    FileInterceptor('boletim', {
      limits: { fileSize: LIMITE_BOLETIM_BYTES, files: 1, fields: 20 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Inscreve um candidato no edital. PUBLICO, sem autenticacao.',
    description:
      'multipart/form-data: os campos de texto mais o arquivo em `boletim`. ' +
      'A media NAO e aceita na requisicao — ela e calculada pelo banco a partir de n1 e n2 ' +
      '(coluna GENERATED), e envia-la devolve 400. Nota em branco fica NULA, nunca zero, e ' +
      'nesse caso a media tambem e nula. O boletim deve ser PDF de verdade: o tipo ' +
      'declarado e a assinatura do arquivo sao os dois verificados. ' +
      'Uma segunda inscricao com a mesma matricula ou o mesmo e-mail no mesmo edital ' +
      'devolve 409 e nao envia novo e-mail. Esta rota nao cria conta nem registro de aluno.',
  })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: [
        'nomeCompleto',
        'matricula',
        'email',
        'cursoId',
        'disciplinaId',
        'professorId',
        'turno',
        'boletim',
      ],
      properties: {
        nomeCompleto: { type: 'string', example: 'Maria Oliveira dos Santos' },
        matricula: { type: 'string', example: '2021001234' },
        email: { type: 'string', format: 'email', example: 'maria@ufx.edu.br' },
        cursoId: { type: 'string', format: 'uuid' },
        disciplinaId: { type: 'string', format: 'uuid' },
        professorId: { type: 'string', format: 'uuid' },
        turno: { type: 'string', enum: Object.values(Turno) },
        n1: { type: 'number', example: 8.5, description: 'Opcional. Em branco = sem nota.' },
        n2: { type: 'number', example: 9.25, description: 'Opcional. Em branco = sem nota.' },
        boletim: { type: 'string', format: 'binary', description: 'PDF de ate 5 MB.' },
      },
    },
  })
  @ApiCreatedResponse({ type: InscricaoConfirmacaoDto })
  @ApiBadRequestResponse({
    description: 'Dados invalidos, boletim ausente ou arquivo que nao e PDF.',
    type: RespostaErro,
  })
  @ApiNotFoundResponse({
    description: 'Edital, curso, disciplina ou professor inexistentes.',
    type: RespostaErro,
  })
  @ApiConflictResponse({
    description:
      'Fora do periodo de inscricoes, disciplina incompativel com o curso, ou inscricao ' +
      'ja existente para esta matricula/e-mail neste edital.',
    type: RespostaErro,
  })
  @ApiPayloadTooLargeResponse({ description: 'Boletim acima de 5 MB.', type: RespostaErro })
  criar(
    @Param('editalId', ParseUUIDPipe) editalId: string,
    @Body() dto: CriarInscricaoDto,
    @UploadedFile() boletim?: ArquivoRecebido,
  ): Promise<InscricaoConfirmacaoDto> {
    return this.inscricoesService.criar(editalId, dto, boletim);
  }
}
