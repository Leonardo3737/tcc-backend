import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Publico } from '../../common/decorators/publico.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { ConfirmarRecuperacaoDto, SolicitarRecuperacaoDto } from './dto/recuperacao-senha.dto';
import { RecuperacaoSenhaService } from './recuperacao-senha.service';

/**
 * Recuperacao de senha por codigo enviado ao e-mail.
 *
 * Controller separado do AuthController de proposito. Aquele tem uma unica rota
 * e uma afirmacao forte a sustentar — nenhuma identidade nasce por ali. Estas
 * duas rotas sao publicas, mas nao criam identidade: operam sobre conta que ja
 * existe, e so por meio de um codigo entregue no e-mail dela.
 *
 * Fluxo em duas etapas:
 *   1. POST solicitar  { email }                        -> 202, sempre
 *   2. POST confirmar  { email, codigo, novaSenha }     -> 204
 *
 * Nao ha uma terceira rota para "apenas validar o codigo". Ela seria comodidade
 * de tela e, de quebra, um oraculo: permitiria testar codigos sem se
 * comprometer com uma senha. O frontend que queira duas telas guarda o codigo
 * entre elas.
 */
@ApiTags('Recuperacao de senha')
@Controller('auth/recuperacao')
export class RecuperacaoSenhaController {
  constructor(private readonly recuperacaoService: RecuperacaoSenhaService) {}

  /**
   * Teto baixo: 3 por minuto por IP.
   *
   * Cada chamada custa um argon2 e, potencialmente, um e-mail. Sem limite, a
   * rota serve tanto para inundar a caixa de uma pessoa quanto para queimar a
   * cota diaria do provedor.
   */
  @Throttle({ padrao: { ttl: 60_000, limit: 3 } })
  @Publico()
  @Post('solicitar')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Envia um codigo de recuperacao para o e-mail informado.',
    description:
      'Responde 202 SEMPRE, exista ou nao a conta: diferenciar os casos transformaria ' +
      'esta rota em um enumerador de contas. O custo dominante (argon2) tambem e pago ' +
      'nos dois caminhos. O codigo tem 6 digitos, vale 15 minutos e e de uso unico; ' +
      'pedir um novo invalida o anterior.',
  })
  @ApiAcceptedResponse({ description: 'Pedido recebido.' })
  solicitar(@Body() dto: SolicitarRecuperacaoDto): Promise<void> {
    return this.recuperacaoService.solicitar(dto);
  }

  /**
   * Teto de 10 por minuto, somado ao limite de 5 tentativas POR CODIGO.
   *
   * Os dois atacam problemas diferentes: o contador do codigo impede a forca
   * bruta sobre uma conta; o throttle impede que alguem varra varias contas a
   * partir do mesmo IP.
   */
  @Throttle({ padrao: { ttl: 60_000, limit: 10 } })
  @Publico()
  @Post('confirmar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirma o codigo e define a nova senha.',
    description:
      'Toda falha devolve 400 com a MESMA mensagem: codigo errado, expirado, ja ' +
      'usado ou e-mail inexistente sao indistinguiveis na resposta. Apos 5 tentativas ' +
      'erradas o codigo e invalidado e e preciso solicitar outro.',
  })
  @ApiNoContentResponse({ description: 'Senha redefinida.' })
  @ApiBadRequestResponse({ description: 'Codigo invalido ou expirado.', type: RespostaErro })
  confirmar(@Body() dto: ConfirmarRecuperacaoDto): Promise<void> {
    return this.recuperacaoService.confirmar(dto);
  }
}
