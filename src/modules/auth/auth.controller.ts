import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { Publico } from '../../common/decorators/publico.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RespostaLoginDto } from './dto/resposta-login.dto';

/**
 * NAO existe auto-cadastro.
 *
 * Criar conta — de aluno ou de professor — e operacao de professor autenticado,
 * em POST /api/alunos e POST /api/professores. Este controller tem uma unica
 * rota publica, o login: nenhuma identidade nasce por aqui.
 *
 * A consequencia e o bootstrap: uma base nova nao tem professor nenhum e a API
 * nao oferece caminho para o primeiro. Ele e criado fora da API, por
 * `npm run criar-professor` (ver scripts/criar-professor.mjs), que exige acesso
 * ao banco — o que e justamente a barreira desejada.
 */
@ApiTags('Autenticacao')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Teto agressivo: 5 tentativas por minuto por IP.
   *
   * O login e o unico ponto da API em que adivinhar o corpo da requisicao da
   * acesso a uma conta. O argon2 ja torna cada tentativa cara no servidor, mas o
   * limite e o que impede que o custo seja pago por nos em volume.
   */
  @Throttle({ padrao: { ttl: 60_000, limit: 5 } })
  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica e devolve o token de acesso.' })
  @ApiOkResponse({ type: RespostaLoginDto })
  @ApiUnauthorizedResponse({ description: 'Credenciais invalidas.', type: RespostaErro })
  login(@Body() dto: LoginDto): Promise<RespostaLoginDto> {
    return this.authService.login(dto);
  }
}
