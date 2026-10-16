import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  BaseError,
  DatabaseError,
  ForeignKeyConstraintError,
  UniqueConstraintError,
} from 'sequelize';

import { RespostaErro } from '../dto/resposta-erro.dto';
import { LogsService } from '../../modules/logs/logs.service';

/**
 * Traduz violacoes de constraint em mensagens de dominio.
 *
 * Este mapa vai crescer junto com o schema. Na fase 2 ele e o que transforma
 * `ex_monitor_sem_conflito` em "o monitor ja tem atendimento nesse horario"
 * (RN03) em vez de devolver um erro cru do PostgreSQL ao frontend.
 */
export const MENSAGENS_POR_CONSTRAINT: Record<string, string> = {
  usuarios_email_key: 'Ja existe um usuario cadastrado com este e-mail.',
  alunos_matricula_key: 'Ja existe um aluno cadastrado com esta matricula.',
  professores_identificacao_funcional_key:
    'Ja existe um professor cadastrado com esta identificacao funcional.',
  disciplinas_codigo_key: 'Ja existe uma disciplina com este codigo.',
  uq_monitoria_oferta: 'Voce ja possui uma monitoria desta disciplina neste periodo.',

  // RN09 — indice unico parcial sobre vinculos ATIVOS.
  ux_participante_ativo:
    'Este aluno ja possui um vinculo ativo nesta monitoria. Um aluno nao pode ser ' +
    'MONITOR e MONITORADO simultaneamente na mesma monitoria (RN09).',

  // RN01/RN02/RN04 — FKs compostas que carregam monitoria_id e papel.
  fk_atendimento_monitor:
    'O monitor informado nao e um MONITOR habilitado nesta monitoria (RN01/RN02).',
  fk_inscricao_participante: 'O aluno informado nao e um MONITORADO ativo desta monitoria (RN04).',
  fk_disponibilidade_participante:
    'Somente um MONITOR habilitado nesta monitoria pode declarar disponibilidade.',

  // RN03 — constraints EXCLUDE de sobreposicao de intervalos.
  ex_monitor_sem_conflito:
    'Este monitor ja possui outro atendimento que se sobrepoe a este horario (RN03).',
  ex_aluno_sem_conflito: 'Voce ja possui um atendimento que se sobrepoe a este horario (RN03).',
  ex_disponibilidade_sem_sobreposicao:
    'Esta faixa de horario se sobrepoe a outra disponibilidade ja cadastrada.',

  uq_inscricao_unica: 'Este aluno ja possui inscricao neste atendimento.',

  // Editais — uma candidatura por pessoa em cada edital.
  uq_inscricao_edital_matricula: 'Ja existe uma inscricao com esta matricula neste edital.',
  uq_inscricao_edital_email: 'Ja existe uma inscricao com este e-mail neste edital.',

  /**
   * FK composta que sustenta "a disciplina tem de pertencer ao curso".
   *
   * O service verifica isso antes e devolve mensagem com os nomes; esta entrada
   * cobre a corrida — a associacao disciplina/curso ser desfeita entre a
   * validacao e o INSERT.
   */
  fk_inscricao_disciplina_curso: 'A disciplina informada nao e oferecida pelo curso informado.',

  // CHECKs de editais e inscricoes, que o service tambem valida antes.
  ck_edital_periodo: 'O fim das inscricoes nao pode ser anterior ao inicio.',
  ck_inscricao_n1: 'A nota N1 deve estar entre 0 e 10.',
  ck_inscricao_n2: 'A nota N2 deve estar entre 0 e 10.',
  ck_boletim_pdf: 'O arquivo enviado nao e um PDF valido.',
  ck_boletim_tamanho: 'O boletim excede o tamanho maximo permitido.',
};

/**
 * Mensagem de dominio de uma violacao de constraint, se houver.
 *
 * Exportada para o agendamento em lote (A2), que precisa transformar a recusa
 * de UMA ocorrencia em dado da resposta em vez de derrubar a serie inteira.
 * Sem isto, o lote duplicaria este mapa e as duas copias divergiriam na
 * primeira constraint nova.
 */
export function mensagemDeConstraint(excecao: unknown): string | null {
  if (!(excecao instanceof BaseError)) {
    return null;
  }

  const constraint =
    (excecao as { parent?: { constraint?: string } }).parent?.constraint ??
    (excecao as { index?: string }).index;

  return (constraint && MENSAGENS_POR_CONSTRAINT[constraint]) ?? null;
}

interface ErroTraduzido {
  status: number;
  erro: string;
  mensagem: string;
  detalhes?: string[];
}

/**
 * Filtro global. Garante que 100% das respostas de erro tenham o mesmo formato,
 * inclusive as que nascem fora dos controllers (erros do driver, do Sequelize,
 * ou bugs nao previstos).
 *
 * Regra de ouro: detalhe interno nunca chega ao cliente. Stack trace vai para o
 * log do servidor; o cliente recebe uma mensagem generica no caso 500.
 */
@Catch()
export class TodasExcecoesFilter implements ExceptionFilter {
  private readonly logger = new Logger(TodasExcecoesFilter.name);

  /**
   * Opcional de proposito.
   *
   * O filtro e registrado via APP_FILTER e tem de continuar funcionando se o
   * LogsModule for removido do AppModule — tratamento de erro nao pode depender
   * de um recurso acessorio. `@Optional()` e o que permite desligar o log sem
   * quebrar a traducao de excecoes.
   */
  constructor(@Optional() private readonly logsService?: LogsService) {}

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const resposta = contexto.getResponse<Response>();
    const requisicao = contexto.getRequest<Request>();

    const traduzido = this.traduzir(excecao);

    if (traduzido.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${requisicao.method} ${requisicao.url} -> ${traduzido.status}`,
        excecao instanceof Error ? excecao.stack : String(excecao),
      );
    }

    const corpo: RespostaErro = {
      statusCode: traduzido.status,
      erro: traduzido.erro,
      mensagem: traduzido.mensagem,
      ...(traduzido.detalhes?.length ? { detalhes: traduzido.detalhes } : {}),
      caminho: requisicao.url,
      timestamp: new Date().toISOString(),
    };

    /**
     * TODO erro passa por aqui, inclusive os que o interceptor de log nunca ve.
     *
     * Guard que rejeita impede o interceptor de rodar, entao 401 e 403 — as
     * requisicoes mais relevantes de uma trilha de acesso — so existem neste
     * ponto. Por isso o filtro registra os erros e o interceptor, apenas os
     * sucessos: juntos cobrem tudo, sem duplicar.
     *
     * A duracao e medida a partir de `requisicao.inicioEmMs`, gravado pelo
     * middleware; sem ele vai zero, em vez de um numero inventado.
     */
    const inicio = (requisicao as Request & { inicioEmMs?: number }).inicioEmMs;

    this.logsService?.agendar({
      requisicao,
      statusHttp: traduzido.status,
      duracaoMs: inicio ? Date.now() - inicio : 0,
      resposta: corpo,
      erro: excecao,
    });

    resposta.status(traduzido.status).json(corpo);
  }

  private traduzir(excecao: unknown): ErroTraduzido {
    if (excecao instanceof HttpException) {
      return this.deHttpException(excecao);
    }

    if (excecao instanceof BaseError) {
      return this.deSequelize(excecao);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      erro: 'Internal Server Error',
      mensagem: 'Erro interno no servidor.',
    };
  }

  private deHttpException(excecao: HttpException): ErroTraduzido {
    const status = excecao.getStatus();
    const resposta = excecao.getResponse();

    if (typeof resposta === 'string') {
      return { status, erro: excecao.name, mensagem: resposta };
    }

    const corpo = resposta as { message?: string | string[]; error?: string };
    const mensagem = corpo.message;

    // O ValidationPipe devolve um array de mensagens: viram `detalhes`,
    // e a mensagem principal fica estavel para o cliente tratar.
    if (Array.isArray(mensagem)) {
      return {
        status,
        erro: corpo.error ?? 'Bad Request',
        mensagem: 'Dados invalidos na requisicao.',
        detalhes: mensagem,
      };
    }

    return {
      status,
      erro: corpo.error ?? excecao.name,
      mensagem: mensagem ?? 'Erro ao processar a requisicao.',
    };
  }

  private deSequelize(excecao: BaseError): ErroTraduzido {
    if (excecao instanceof UniqueConstraintError) {
      const constraint = (excecao.parent as { constraint?: string } | undefined)?.constraint;
      const campo = excecao.errors?.[0]?.path;

      return {
        status: HttpStatus.CONFLICT,
        erro: 'Conflict',
        mensagem:
          (constraint && MENSAGENS_POR_CONSTRAINT[constraint]) ??
          `Ja existe um registro com este valor${campo ? ` para "${campo}"` : ''}.`,
      };
    }

    if (excecao instanceof ForeignKeyConstraintError) {
      // As FKs compostas carregam regras de dominio (papel + monitoria), entao
      // consultamos o mapa antes de cair na mensagem generica.
      const constraint =
        (excecao.parent as { constraint?: string } | undefined)?.constraint ?? excecao.index;

      return {
        status: HttpStatus.CONFLICT,
        erro: 'Conflict',
        mensagem:
          (constraint && MENSAGENS_POR_CONSTRAINT[constraint]) ??
          'Operacao viola um vinculo existente entre registros.',
      };
    }

    if (excecao instanceof DatabaseError) {
      const constraint = (excecao.parent as { constraint?: string } | undefined)?.constraint;

      if (constraint && MENSAGENS_POR_CONSTRAINT[constraint]) {
        return {
          status: HttpStatus.CONFLICT,
          erro: 'Conflict',
          mensagem: MENSAGENS_POR_CONSTRAINT[constraint],
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      erro: 'Internal Server Error',
      mensagem: 'Erro ao acessar o banco de dados.',
    };
  }
}
