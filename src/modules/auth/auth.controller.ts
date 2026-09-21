import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Publico } from '../../common/decorators/publico.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { UsuarioRespostaDto } from '../usuarios/dto/usuario-resposta.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegistrarAlunoDto } from './dto/registrar-aluno.dto';
import { RegistrarProfessorDto } from './dto/registrar-professor.dto';
import { RespostaLoginDto } from './dto/resposta-login.dto';

@ApiTags('Autenticacao')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ padrao: { ttl: 60_000, limit: 10 } })
  @Publico()
  @Post('registro/aluno')
  @ApiOperation({ summary: 'Cadastra um novo usuario com perfil ALUNO.' })
  @ApiCreatedResponse({ type: UsuarioRespostaDto })
  @ApiConflictResponse({ description: 'E-mail ou matricula ja cadastrados.', type: RespostaErro })
  registrarAluno(@Body() dto: RegistrarAlunoDto): Promise<UsuarioRespostaDto> {
    return this.authService.registrarAluno(dto);
  }

  @Throttle({ padrao: { ttl: 60_000, limit: 10 } })
  @Publico()
  @Post('registro/professor')
  @ApiOperation({
    summary: 'Cadastra um novo usuario com perfil PROFESSOR.',
    description:
      'Exige o campo codigoCadastro quando a variavel CODIGO_CADASTRO_PROFESSOR esta ' +
      'configurada no servidor.',
  })
  @ApiCreatedResponse({ type: UsuarioRespostaDto })
  @ApiForbiddenResponse({ description: 'Codigo de cadastro invalido.', type: RespostaErro })
  @ApiConflictResponse({ description: 'E-mail ja cadastrado.', type: RespostaErro })
  registrarProfessor(@Body() dto: RegistrarProfessorDto): Promise<UsuarioRespostaDto> {
    return this.authService.registrarProfessor(dto);
  }

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
