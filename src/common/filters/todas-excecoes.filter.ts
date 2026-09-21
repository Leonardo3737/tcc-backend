import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  BaseError,
  DatabaseError,
  ForeignKeyConstraintError,
  UniqueConstraintError,
} from 'sequelize';

import { RespostaErro } from '../dto/resposta-erro.dto';

/**
 * Traduz violacoes de constraint em mensagens de dominio.
 *
 * Este mapa vai crescer junto com o schema. Na fase 2 ele e o que transforma
 * `ex_monitor_sem_conflito` em "o monitor ja tem atendimento nesse horario"
 * (RN03) em vez de devolver um erro cru do PostgreSQL ao frontend.
 */
const MENSAGENS_POR_CONSTRAINT: Record<string, string> = {
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
};

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
