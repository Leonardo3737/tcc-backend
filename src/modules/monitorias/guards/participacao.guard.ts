import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  CHAVE_PARTICIPACAO,
  RequisitoParticipacao,
} from '../../../common/decorators/exige-participacao.decorator';
import { UsuarioAutenticado } from '../../../common/types/usuario-autenticado';
import { ParticipacaoService } from '../participacao.service';

/**
 * Guard de autorizacao contextual.
 *
 * O PerfilGuard responde "voce e ALUNO ou PROFESSOR?". Este responde a pergunta
 * que o dominio realmente faz: "voce e MONITOR desta monitoria?". Sem ele, a
 * unica alternativa seria repetir a mesma verificacao no inicio de cada service,
 * que e onde esse tipo de regra costuma ser esquecida.
 *
 * Ele resolve o contexto uma vez e o anexa a requisicao, para que o handler nao
 * precise consultar o banco de novo.
 */
@Injectable()
export class ParticipacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly participacaoService: ParticipacaoService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const requisito = this.reflector.getAllAndOverride<RequisitoParticipacao>(CHAVE_PARTICIPACAO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!requisito) {
      return true;
    }

    const requisicao = contexto.switchToHttp().getRequest();
    const usuario = requisicao.user as UsuarioAutenticado;
    const monitoriaId = requisicao.params?.monitoriaId;

    if (!monitoriaId) {
      // Erro de programacao, nao do cliente: a rota usou @ExigeParticipacao
      // sem expor :monitoriaId. Melhor falhar alto do que liberar acesso.
      throw new BadRequestException('Rota mal configurada: parametro monitoriaId ausente.');
    }

    // A decisao em si mora no ParticipacaoService, porque as ferramentas MCP
    // precisam da MESMA avaliacao sem ter uma rota HTTP para guardar.
    requisicao.contextoParticipacao = await this.participacaoService.exigirRequisito(
      monitoriaId,
      usuario,
      requisito,
    );

    return true;
  }
}
